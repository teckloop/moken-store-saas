import { Router } from "express";
import type { Request } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getUserByEmail,
  hashPassword,
  requireAuth,
  requirePlatform,
  requireStoreRole,
  verifyPassword
} from "./auth.js";
import { db } from "./db.js";
import { resolveTenant } from "./tenant.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "محاولات كثيرة، يرجى الانتظار." },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "تجاوزت حد رفع الملفات." },
});

export const routes = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  }
});
const uploadsDir = join(process.cwd(), "data", "uploads");

routes.get("/health", (_req, res) => {
  try {
    db.prepare("select 1").get();
    res.json({ ok: true, service: "moken-store-api", db: "ok" });
  } catch {
    res.status(503).json({ ok: false, service: "moken-store-api", db: "error" });
  }
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(6)
});

routes.post("/auth/login", authLimiter, (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = getUserByEmail(input.email);

  if (!user || user.status !== "active" || !verifyPassword(input.password, user.passwordHash)) {
    res.status(401).json({ error: "invalid_login", message: "Email or password is incorrect." });
    return;
  }

  const token = createSession(user.id);
  res.json({
    session: {
      token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        name: user.name,
        email: user.email,
        role: user.role
      }
    }
  });
});

routes.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

routes.post("/auth/logout", requireAuth, (req, res) => {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    destroySession(token);
  }
  res.json({ ok: true });
});

const tenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  primaryDomain: z.string().min(3).transform((value) => value.toLowerCase()),
  ownerName: z.string().min(2),
  ownerEmail: z.string().email().transform((value) => value.toLowerCase()),
  ownerPassword: z.string().min(8)
});

const defaultTheme = {
  brandColor: "#111827",
  accentColor: "#14b8a6",
  radius: "soft",
  storefrontStyle: "minimal"
};

function toBoolean(value: unknown) {
  return Boolean(Number(value));
}

function parseJsonArray(value: unknown) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePhone(value: string) {
  const normalized = value.trim().replace(/[\s()-]/g, "");
  return normalized || value.trim();
}

function publicUploadUrl(req: Request, filename: string) {
  const configuredBaseUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, "");
  if (configuredBaseUrl) return `${configuredBaseUrl}/uploads/${filename}`;

  const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0] || req.protocol;
  return `${protocol}://${req.get("host")}/uploads/${filename}`;
}

function mapProduct(product: any) {
  const variants = db.prepare(`
    select
      id,
      product_id as productId,
      option_name as optionName,
      option_value as optionValue,
      sku,
      price_delta as priceDelta,
      inventory,
      is_active as isActive
    from product_variants
    where product_id = ?
    order by option_name asc, option_value asc
  `).all(product.id).map((variant: any) => ({
    ...variant,
    isActive: toBoolean(variant.isActive)
  }));

  return {
    ...product,
    isActive: toBoolean(product.isActive),
    images: parseJsonArray(product.imagesJson),
    specs: parseJsonArray(product.specsJson),
    variants,
    imagesJson: undefined,
    specsJson: undefined
  };
}

// دالة لجلب منتجات مع متغيراتها بـ JOIN واحد (بدل N+1)
function fetchProductsWithVariants(productIds: string[]): Map<string, any> {
  if (productIds.length === 0) return new Map();
  const placeholders = productIds.map(() => "?").join(",");
  const variants = db.prepare(`
    select
      id,
      product_id as productId,
      option_name as optionName,
      option_value as optionValue,
      sku,
      price_delta as priceDelta,
      inventory,
      is_active as isActive
    from product_variants
    where product_id in (${placeholders})
    order by option_name asc, option_value asc
  `).all(...productIds) as any[];

  const map = new Map<string, any[]>();
  for (const v of variants) {
    if (!map.has(v.productId)) map.set(v.productId, []);
    map.get(v.productId)!.push({ ...v, isActive: toBoolean(v.isActive) });
  }
  return map;
}

function replaceProductVariants(productId: string, variants: Array<{
  optionName: string;
  optionValue: string;
  sku?: string;
  priceDelta?: number;
  inventory?: number;
  isActive?: boolean;
}>) {
  db.prepare("delete from product_variants where product_id = ?").run(productId);

  const insertVariant = db.prepare(`
    insert into product_variants (
      id,
      product_id,
      option_name,
      option_value,
      sku,
      price_delta,
      inventory,
      is_active
    )
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  variants
    .filter((variant) => variant.optionName.trim() && variant.optionValue.trim())
    .forEach((variant) => {
      insertVariant.run(
        nanoid(),
        productId,
        variant.optionName.trim(),
        variant.optionValue.trim(),
        variant.sku?.trim() ?? "",
        variant.priceDelta ?? 0,
        variant.inventory ?? 0,
        Number(variant.isActive ?? true)
      );
    });
}

const orderStatusLabels: Record<string, string> = {
  new: "جديد",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  cancelled: "ملغي"
};

const paymentStatusLabels: Record<string, string> = {
  pending: "بانتظار الدفع",
  authorized: "مصرح",
  paid: "مدفوع",
  failed: "فشل الدفع",
  refunded: "مسترجع"
};

function logAudit(tenantId: string, userId: string | undefined, action: string, entity: string, entityId: string, changes: Record<string, unknown> = {}) {
  try {
    db.prepare(`
      insert into audit_log (id, tenant_id, user_id, action, entity, entity_id, changes)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(), tenantId, userId ?? null, action, entity, entityId, JSON.stringify(changes));
  } catch {
    // لا نوقف العملية إذا فشل الـ audit log
  }
}

function hasCategoryCircle(categoryId: string, newParentId: string, tenantId: string): boolean {
  const visited = new Set([categoryId]);
  let current = db.prepare("select parent_id from categories where id = ? and tenant_id = ?")
    .get(newParentId, tenantId) as { parent_id: string | null } | undefined;
  while (current?.parent_id) {
    if (visited.has(current.parent_id)) return true;
    visited.add(current.parent_id);
    current = db.prepare("select parent_id from categories where id = ? and tenant_id = ?")
      .get(current.parent_id, tenantId) as { parent_id: string | null } | undefined;
  }
  return visited.has(newParentId);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function restockCancelledOrder(orderId: string, tenantId: string, discountCodeId: string) {
  const items = db.prepare(`
    select product_id as productId, variant_id as variantId, quantity
    from order_items
    where order_id = ?
  `).all(orderId) as Array<{ productId: string; variantId: string; quantity: number }>;

  const restockProduct = db.prepare(`
    update products
    set inventory = inventory + ?
    where id = ? and tenant_id = ?
  `);
  const restockVariant = db.prepare(`
    update product_variants
    set inventory = inventory + ?
    where id = ? and product_id = ?
  `);

  for (const item of items) {
    if (item.variantId) {
      restockVariant.run(item.quantity, item.variantId, item.productId);
    } else {
      restockProduct.run(item.quantity, item.productId, tenantId);
    }
  }

  if (discountCodeId) {
    db.prepare(`
      update discount_codes
      set redemption_count = max(0, redemption_count - 1)
      where id = ? and tenant_id = ?
    `).run(discountCodeId, tenantId);
  }

  db.prepare(`
    update orders
    set inventory_restocked = 1,
        discount_released = case when ? <> '' then 1 else discount_released end
    where id = ? and tenant_id = ?
  `).run(discountCodeId, orderId, tenantId);
}

function getOrderDetail(orderId: string, tenantId: string) {
  const order = db.prepare(`
    select
      o.id,
      o.tenant_id as tenantId,
      o.customer_name as customerName,
      o.customer_phone as customerPhone,
      o.customer_city as customerCity,
      o.customer_address as customerAddress,
      o.notes,
      o.payment_method as paymentMethod,
      o.payment_status as paymentStatus,
      o.paid_amount as paidAmount,
      o.payment_reference as paymentReference,
      o.shipping_zone_id as shippingZoneId,
      o.shipping_zone_name as shippingZoneName,
      o.shipping_fee as shippingFee,
      o.discount_code_id as discountCodeId,
      o.discount_code as discountCode,
      o.discount_amount as discountAmount,
      o.status,
      o.total,
      o.created_at as createdAt,
      coalesce(sum(oi.quantity), 0) as itemCount
    from orders o
    left join order_items oi on oi.order_id = o.id
    where o.tenant_id = ? and o.id = ?
    group by o.id
  `).get(tenantId, orderId) as any;

  if (!order) return undefined;

  const items = db.prepare(`
    select
      id,
      order_id as orderId,
      product_id as productId,
      variant_id as variantId,
      product_name as productName,
      variant_name as variantName,
      sku,
      unit_price as unitPrice,
      quantity,
      line_total as lineTotal
    from order_items
    where order_id = ?
    order by rowid asc
  `).all(orderId);

  const events = db.prepare(`
    select
      id,
      order_id as orderId,
      type,
      title,
      message,
      created_at as createdAt
    from order_events
    where order_id = ?
    order by created_at asc
  `).all(orderId);

  return { ...order, items, events };
}

routes.get("/admin/tenants", requireAuth, requirePlatform, (req, res) => {
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const offset = (page - 1) * limit;

  const total = (db.prepare("select count(*) as count from tenants").get() as { count: number }).count;
  const tenants = db.prepare(`
    select
      id,
      name,
      slug,
      primary_domain as primaryDomain,
      status,
      theme_json as themeJson,
      created_at as createdAt
    from tenants
    order by created_at desc
    limit ? offset ?
  `).all(limit, offset).map((tenant: any) => ({
    ...tenant,
    theme: JSON.parse(tenant.themeJson),
    themeJson: undefined
  }));

  res.json({ tenants, total, page, limit, totalPages: Math.ceil(total / limit) });
});

routes.post("/admin/tenants", requireAuth, requirePlatform, (req, res) => {
  const input = tenantSchema.parse(req.body);
  const id = nanoid();
  const ownerId = nanoid();
  const verificationToken = `moken-verify-${nanoid(16)}`;

  const transaction = db.transaction(() => {
    db.prepare(`
      insert into tenants (id, name, slug, primary_domain, theme_json)
      values (?, ?, ?, ?, ?)
    `).run(id, input.name, input.slug, input.primaryDomain, JSON.stringify(defaultTheme));

    db.prepare(`
      insert into tenant_domains (id, tenant_id, domain, is_primary, verification_status, verification_token)
      values (?, ?, ?, 1, 'pending', ?)
    `).run(nanoid(), id, input.primaryDomain, verificationToken);

    db.prepare(`
      insert into integration_settings (tenant_id)
      values (?)
    `).run(id);

    db.prepare(`
      insert into store_settings (
        tenant_id,
        store_name,
        public_email,
        public_phone,
        whatsapp_phone,
        currency,
        default_city,
        shipping_policy,
        payment_methods_json
      )
      values (?, ?, ?, '', '', 'LYD', '', '', ?)
    `).run(id, input.name, input.ownerEmail, JSON.stringify(["cash_on_delivery"]));

    db.prepare(`
      insert into users (id, tenant_id, name, email, password_hash, role)
      values (?, ?, ?, ?, ?, 'store_owner')
    `).run(ownerId, id, input.ownerName, input.ownerEmail, hashPassword(input.ownerPassword));
  });

  transaction();
  res.status(201).json({
    tenant: {
      id,
      name: input.name,
      slug: input.slug,
      primaryDomain: input.primaryDomain,
      status: "active",
      theme: defaultTheme
    }
  });
});

const tenantStatusSchema = z.object({
  status: z.enum(["active", "paused"])
});

routes.patch("/admin/tenants/:id/status", requireAuth, requirePlatform, (req, res) => {
  const input = tenantStatusSchema.parse(req.body);
  const result = db.prepare("update tenants set status = ? where id = ?").run(input.status, req.params.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "tenant_not_found", message: "Tenant was not found." });
    return;
  }

  res.json({ tenant: { id: req.params.id, status: input.status } });
});

routes.get("/admin/orders", requireAuth, requirePlatform, (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  const status = String(req.query.status ?? "");
  const params: string[] = [];
  const where = [
    tenantId ? "o.tenant_id = ?" : "",
    status ? "o.status = ?" : ""
  ].filter(Boolean);

  if (tenantId) params.push(tenantId);
  if (status) params.push(status);

  const orders = db.prepare(`
    select
      o.id,
      o.tenant_id as tenantId,
      t.name as tenantName,
      t.slug as tenantSlug,
      t.primary_domain as tenantDomain,
      o.customer_name as customerName,
      o.customer_phone as customerPhone,
      o.customer_city as customerCity,
      o.customer_address as customerAddress,
      o.notes,
      o.payment_method as paymentMethod,
      o.payment_status as paymentStatus,
      o.paid_amount as paidAmount,
      o.payment_reference as paymentReference,
      o.shipping_zone_id as shippingZoneId,
      o.shipping_zone_name as shippingZoneName,
      o.shipping_fee as shippingFee,
      o.discount_code_id as discountCodeId,
      o.discount_code as discountCode,
      o.discount_amount as discountAmount,
      o.status,
      o.total,
      o.created_at as createdAt,
      coalesce(sum(oi.quantity), 0) as itemCount
    from orders o
    join tenants t on t.id = o.tenant_id
    left join order_items oi on oi.order_id = o.id
    ${where.length ? `where ${where.join(" and ")}` : ""}
    group by o.id
    order by o.created_at desc
    limit 250
  `).all(...params);

  res.json({ orders });
});

routes.use("/store", resolveTenant);

routes.get("/store", (req, res) => {
  res.json({ tenant: req.tenant });
});

function mapImageAsset(asset: any) {
  return {
    id: asset.id,
    tenantId: asset.tenantId,
    url: asset.url,
    filename: asset.filename,
    width: asset.width,
    height: asset.height,
    originalSize: asset.originalSize,
    compressedSize: asset.compressedSize,
    format: "webp",
    createdAt: asset.createdAt
  };
}

routes.get("/store/uploads/images", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const images = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      filename,
      url,
      width,
      height,
      original_size as originalSize,
      compressed_size as compressedSize,
      format,
      created_at as createdAt
    from image_assets
    where tenant_id = ?
    order by created_at desc
    limit 200
  `).all(req.tenant!.id).map(mapImageAsset);

  res.json({ images });
});

const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

routes.post("/store/uploads/images", requireStoreRole(["store_owner", "products_manager"]), uploadLimiter, upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(422).json({ error: "image_required", message: "Image file is required." });
      return;
    }

    if (!ALLOWED_IMAGE_MIMES.includes(req.file.mimetype)) {
      res.status(422).json({ error: "invalid_image_type", message: "نوع الملف غير مدعوم. الأنواع المسموح بها: JPEG, PNG, WebP, GIF, AVIF." });
      return;
    }

    const id = nanoid();
    const filename = `${req.tenant!.id}-${nanoid(18)}.webp`;
    const outputPath = join(uploadsDir, filename);
    const processor = sharp(req.file.buffer, { failOn: "none", animated: false }).rotate();
    const metadata = await processor.metadata();
    if (!metadata.width || !metadata.height) {
      res.status(422).json({ error: "invalid_image", message: "Uploaded file is not a supported image." });
      return;
    }

    const resized = processor.resize({
      width: Math.min(metadata.width, 2200),
      height: Math.min(metadata.height, 2200),
      fit: "inside",
      withoutEnlargement: true
    });
    const output = await resized.webp({ quality: 78, effort: 6 }).toBuffer();

    await mkdir(uploadsDir, { recursive: true });
    await writeFile(outputPath, output);

    const outputMetadata = await sharp(output).metadata();
    const storedImage = {
      id,
      tenantId: req.tenant!.id,
      url: publicUploadUrl(req, filename),
      filename,
      width: outputMetadata.width ?? metadata.width,
      height: outputMetadata.height ?? metadata.height,
      originalSize: req.file.size,
      compressedSize: output.length,
      format: "webp" as const,
      createdAt: new Date().toISOString()
    };

    db.prepare(`
      insert into image_assets (
        id,
        tenant_id,
        filename,
        url,
        width,
        height,
        original_size,
        compressed_size,
        format,
        created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, 'webp', ?)
    `).run(
      storedImage.id,
      storedImage.tenantId,
      storedImage.filename,
      storedImage.url,
      storedImage.width,
      storedImage.height,
      storedImage.originalSize,
      storedImage.compressedSize,
      storedImage.createdAt
    );

    res.status(201).json({ image: storedImage });
  } catch (error) {
    next(error);
  }
});

routes.delete("/store/uploads/images/:id", requireStoreRole(["store_owner", "products_manager"]), async (req, res, next) => {
  try {
    const asset = db.prepare(`
      select id, filename
      from image_assets
      where id = ? and tenant_id = ?
    `).get(req.params.id, req.tenant!.id) as { id: string; filename: string } | undefined;

    if (!asset) {
      res.status(404).json({ error: "image_not_found", message: "Image was not found for this store." });
      return;
    }

    db.prepare("delete from image_assets where id = ? and tenant_id = ?").run(asset.id, req.tenant!.id);
    await unlink(join(uploadsDir, asset.filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

routes.patch("/store/theme", requireStoreRole(["store_owner"]), (req, res) => {
  const themeSchema = z.object({
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    radius: z.enum(["compact", "soft", "round"]),
    storefrontStyle: z.enum(["minimal", "editorial", "luxury", "playful"])
  });
  const input = themeSchema.parse(req.body);

  db.prepare("update tenants set theme_json = ? where id = ?").run(JSON.stringify(input), req.tenant!.id);

  res.json({ theme: input });
});

const storeSettingsSchema = z.object({
  storeName: z.string().min(2),
  publicEmail: z.string().email().or(z.literal("")),
  publicPhone: z.string().default(""),
  whatsappPhone: z.string().default(""),
  currency: z.string().min(3).max(3).default("LYD"),
  defaultCity: z.string().default(""),
  shippingPolicy: z.string().default(""),
  paymentMethods: z.array(z.string()).default([])
});

function mapStoreSettings(settings: any, tenantName: string) {
  return {
    storeName: settings?.storeName || tenantName,
    publicEmail: settings?.publicEmail ?? "",
    publicPhone: settings?.publicPhone ?? "",
    whatsappPhone: settings?.whatsappPhone ?? "",
    currency: settings?.currency ?? "LYD",
    defaultCity: settings?.defaultCity ?? "",
    shippingPolicy: settings?.shippingPolicy ?? "",
    paymentMethods: parseJsonArray(settings?.paymentMethodsJson)
  };
}

routes.get("/store/settings", (req, res) => {
  const settings = db.prepare(`
    select
      store_name as storeName,
      public_email as publicEmail,
      public_phone as publicPhone,
      whatsapp_phone as whatsappPhone,
      currency,
      default_city as defaultCity,
      shipping_policy as shippingPolicy,
      payment_methods_json as paymentMethodsJson
    from store_settings
    where tenant_id = ?
  `).get(req.tenant!.id);

  res.json({ settings: mapStoreSettings(settings, req.tenant!.name) });
});

routes.patch("/store/settings", requireStoreRole(["store_owner"]), (req, res) => {
  const input = storeSettingsSchema.parse(req.body);

  db.prepare(`
    insert into store_settings (
      tenant_id,
      store_name,
      public_email,
      public_phone,
      whatsapp_phone,
      currency,
      default_city,
      shipping_policy,
      payment_methods_json,
      updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
    on conflict(tenant_id) do update set
      store_name = excluded.store_name,
      public_email = excluded.public_email,
      public_phone = excluded.public_phone,
      whatsapp_phone = excluded.whatsapp_phone,
      currency = excluded.currency,
      default_city = excluded.default_city,
      shipping_policy = excluded.shipping_policy,
      payment_methods_json = excluded.payment_methods_json,
      updated_at = current_timestamp
  `).run(
    req.tenant!.id,
    input.storeName,
    input.publicEmail,
    input.publicPhone,
    input.whatsappPhone,
    input.currency,
    input.defaultCity,
    input.shippingPolicy,
    JSON.stringify(input.paymentMethods)
  );

  res.json({ settings: input });
});

const storeUserRoles = ["store_owner", "products_manager", "orders_manager"] as const;

const storeUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  role: z.enum(storeUserRoles)
});

const storeUserUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(storeUserRoles).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  password: z.string().min(8).optional()
});

routes.get("/store/users", requireStoreRole(["store_owner"]), (req, res) => {
  const users = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      name,
      email,
      role,
      status,
      created_at as createdAt
    from users
    where tenant_id = ?
      and role in ('store_owner', 'products_manager', 'orders_manager')
    order by
      case role
        when 'store_owner' then 1
        when 'products_manager' then 2
        when 'orders_manager' then 3
        else 4
      end,
      created_at asc
  `).all(req.tenant!.id);

  res.json({ users });
});

routes.post("/store/users", requireStoreRole(["store_owner"]), (req, res) => {
  const input = storeUserSchema.parse(req.body);
  const id = nanoid();

  db.prepare(`
    insert into users (id, tenant_id, name, email, password_hash, role)
    values (?, ?, ?, ?, ?, ?)
  `).run(id, req.tenant!.id, input.name, input.email, hashPassword(input.password), input.role);

  res.status(201).json({
    user: {
      id,
      tenantId: req.tenant!.id,
      name: input.name,
      email: input.email,
      role: input.role,
      status: "active",
      createdAt: new Date().toISOString()
    }
  });
});

routes.patch("/store/users/:id", requireStoreRole(["store_owner"]), (req, res) => {
  const input = storeUserUpdateSchema.parse(req.body);
  const userId = String(req.params.id);
  const current = db.prepare(`
    select id, name, email, role, status
    from users
    where id = ? and tenant_id = ?
      and role in ('store_owner', 'products_manager', 'orders_manager')
  `).get(userId, req.tenant!.id) as { id: string; name: string; email: string; role: string; status: string } | undefined;

  if (!current) {
    res.status(404).json({ error: "user_not_found", message: "User was not found for this store." });
    return;
  }

  if (req.user?.id === userId && input.status === "inactive") {
    res.status(422).json({ error: "cannot_disable_self", message: "You cannot disable your own account." });
    return;
  }

  if (req.user?.id === userId && input.role && input.role !== current.role) {
    res.status(422).json({ error: "cannot_change_self_role", message: "You cannot change your own role." });
    return;
  }

  const next = {
    name: input.name ?? current.name,
    role: input.role ?? current.role,
    status: input.status ?? current.status
  };

  if (input.password) {
    db.prepare(`
      update users
      set name = ?, role = ?, status = ?, password_hash = ?
      where id = ? and tenant_id = ?
    `).run(next.name, next.role, next.status, hashPassword(input.password), userId, req.tenant!.id);
  } else {
    db.prepare(`
      update users
      set name = ?, role = ?, status = ?
      where id = ? and tenant_id = ?
    `).run(next.name, next.role, next.status, userId, req.tenant!.id);
  }

  res.json({
    user: {
      id: userId,
      tenantId: req.tenant!.id,
      email: current.email,
      ...next
    }
  });
});

function mapShippingZone(zone: any) {
  return {
    ...zone,
    isActive: toBoolean(zone.isActive)
  };
}

const shippingZoneSchema = z.object({
  name: z.string().min(2),
  city: z.string().default(""),
  fee: z.number().int().nonnegative(),
  estimatedDays: z.string().default(""),
  isActive: z.boolean().default(true)
});

const shippingZoneUpdateSchema = shippingZoneSchema.partial();

routes.get("/store/shipping-zones", (req, res) => {
  const includeAll = req.query.all === "1" && req.user?.tenantId === req.tenant!.id;
  const zones = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      name,
      city,
      fee,
      estimated_days as estimatedDays,
      is_active as isActive
    from shipping_zones
    where tenant_id = ?
      ${includeAll ? "" : "and is_active = 1"}
    order by is_active desc, fee asc, name asc
  `).all(req.tenant!.id).map(mapShippingZone);

  res.json({ zones });
});

routes.post("/store/shipping-zones", requireStoreRole(["store_owner"]), (req, res) => {
  const input = shippingZoneSchema.parse(req.body);
  const id = nanoid();

  db.prepare(`
    insert into shipping_zones (
      id,
      tenant_id,
      name,
      city,
      fee,
      estimated_days,
      is_active
    )
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.tenant!.id,
    input.name.trim(),
    input.city.trim(),
    input.fee,
    input.estimatedDays.trim(),
    Number(input.isActive)
  );

  res.status(201).json({
    zone: {
      id,
      tenantId: req.tenant!.id,
      name: input.name.trim(),
      city: input.city.trim(),
      fee: input.fee,
      estimatedDays: input.estimatedDays.trim(),
      isActive: input.isActive
    }
  });
});

routes.patch("/store/shipping-zones/:id", requireStoreRole(["store_owner"]), (req, res) => {
  const input = shippingZoneUpdateSchema.parse(req.body);
  const zoneId = String(req.params.id);
  const current = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      name,
      city,
      fee,
      estimated_days as estimatedDays,
      is_active as isActive
    from shipping_zones
    where id = ? and tenant_id = ?
  `).get(zoneId, req.tenant!.id) as any;

  if (!current) {
    res.status(404).json({ error: "shipping_zone_not_found", message: "Shipping zone was not found for this store." });
    return;
  }

  const next = {
    name: input.name?.trim() ?? current.name,
    city: input.city?.trim() ?? current.city,
    fee: input.fee ?? current.fee,
    estimatedDays: input.estimatedDays?.trim() ?? current.estimatedDays,
    isActive: input.isActive ?? toBoolean(current.isActive)
  };

  db.prepare(`
    update shipping_zones
    set name = ?, city = ?, fee = ?, estimated_days = ?, is_active = ?
    where id = ? and tenant_id = ?
  `).run(
    next.name,
    next.city,
    next.fee,
    next.estimatedDays,
    Number(next.isActive),
    zoneId,
    req.tenant!.id
  );

  res.json({
    zone: {
      id: zoneId,
      tenantId: req.tenant!.id,
      ...next
    }
  });
});

function normalizeDiscountCode(code: string) {
  return code.trim().toUpperCase();
}

function normalizeDateTime(value: string) {
  return value.trim().replace("T", " ");
}

function mapDiscountCode(discount: any) {
  return {
    ...discount,
    isActive: toBoolean(discount.isActive)
  };
}

function calculateDiscountAmount(discount: { type: string; value: number }, subtotal: number) {
  if (discount.type === "percentage") {
    return Math.min(subtotal, Math.round(subtotal * Math.min(discount.value, 100) / 100));
  }

  return Math.min(subtotal, discount.value);
}

function getAvailableDiscount(tenantId: string, code: string, subtotal: number) {
  if (!code.trim()) return undefined;

  const discount = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      code,
      name,
      type,
      value,
      min_subtotal as minSubtotal,
      max_redemptions as maxRedemptions,
      redemption_count as redemptionCount,
      starts_at as startsAt,
      ends_at as endsAt,
      is_active as isActive,
      created_at as createdAt
    from discount_codes
    where tenant_id = ?
      and code = ?
      and is_active = 1
      and min_subtotal <= ?
      and (max_redemptions = 0 or redemption_count < max_redemptions)
      and (starts_at = '' or starts_at <= current_timestamp)
      and (ends_at = '' or ends_at >= current_timestamp)
  `).get(tenantId, normalizeDiscountCode(code), subtotal) as any;

  if (!discount) return undefined;
  return {
    ...mapDiscountCode(discount),
    amount: calculateDiscountAmount(discount, subtotal)
  };
}

const discountTypes = ["fixed", "percentage"] as const;

const discountCodeBaseSchema = z.object({
  code: z.string().min(2).transform(normalizeDiscountCode),
  name: z.string().min(2),
  type: z.enum(discountTypes),
  value: z.number().int().positive(),
  minSubtotal: z.number().int().nonnegative().default(0),
  maxRedemptions: z.number().int().nonnegative().default(0),
  startsAt: z.string().default("").transform(normalizeDateTime),
  endsAt: z.string().default("").transform(normalizeDateTime),
  isActive: z.boolean().default(true)
});

const discountCodeSchema = discountCodeBaseSchema.refine((input) => input.type !== "percentage" || input.value <= 100, {
  message: "Percentage discount must be 100 or less.",
  path: ["value"]
});

const discountCodeUpdateSchema = discountCodeBaseSchema.partial().refine((input) => input.type !== "percentage" || !input.value || input.value <= 100, {
  message: "Percentage discount must be 100 or less.",
  path: ["value"]
});

const discountValidationSchema = z.object({
  code: z.string().min(2),
  subtotal: z.number().int().nonnegative()
});

routes.get("/store/discount-codes", requireStoreRole(["store_owner"]), (req, res) => {
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const offset = (page - 1) * limit;

  const total = (db.prepare("select count(*) as count from discount_codes where tenant_id = ?")
    .get(req.tenant!.id) as { count: number }).count;

  const discounts = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      code,
      name,
      type,
      value,
      min_subtotal as minSubtotal,
      max_redemptions as maxRedemptions,
      redemption_count as redemptionCount,
      starts_at as startsAt,
      ends_at as endsAt,
      is_active as isActive,
      created_at as createdAt
    from discount_codes
    where tenant_id = ?
    order by is_active desc, created_at desc
    limit ? offset ?
  `).all(req.tenant!.id, limit, offset).map(mapDiscountCode);

  res.json({ discounts, total, page, limit, totalPages: Math.ceil(total / limit) });
});

routes.post("/store/discount-codes/validate", (req, res) => {
  const input = discountValidationSchema.parse(req.body);
  const discount = getAvailableDiscount(req.tenant!.id, input.code, input.subtotal);

  if (!discount) {
    res.status(422).json({ error: "discount_not_available", message: "Discount code is not available for this order." });
    return;
  }

  res.json({
    discount: {
      code: discount.code,
      name: discount.name,
      type: discount.type,
      value: discount.value,
      amount: discount.amount
    }
  });
});

routes.post("/store/discount-codes", requireStoreRole(["store_owner"]), (req, res) => {
  const input = discountCodeSchema.parse(req.body);
  const id = nanoid();

  db.prepare(`
    insert into discount_codes (
      id,
      tenant_id,
      code,
      name,
      type,
      value,
      min_subtotal,
      max_redemptions,
      starts_at,
      ends_at,
      is_active
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.tenant!.id,
    input.code,
    input.name.trim(),
    input.type,
    input.value,
    input.minSubtotal,
    input.maxRedemptions,
    input.startsAt,
    input.endsAt,
    Number(input.isActive)
  );

  res.status(201).json({
    discount: {
      id,
      tenantId: req.tenant!.id,
      ...input,
      name: input.name.trim(),
      redemptionCount: 0,
      createdAt: new Date().toISOString()
    }
  });
});

routes.patch("/store/discount-codes/:id", requireStoreRole(["store_owner"]), (req, res) => {
  const input = discountCodeUpdateSchema.parse(req.body);
  const discountId = String(req.params.id);
  const current = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      code,
      name,
      type,
      value,
      min_subtotal as minSubtotal,
      max_redemptions as maxRedemptions,
      redemption_count as redemptionCount,
      starts_at as startsAt,
      ends_at as endsAt,
      is_active as isActive,
      created_at as createdAt
    from discount_codes
    where id = ? and tenant_id = ?
  `).get(discountId, req.tenant!.id) as any;

  if (!current) {
    res.status(404).json({ error: "discount_not_found", message: "Discount code was not found for this store." });
    return;
  }

  const next = {
    code: input.code ?? current.code,
    name: input.name?.trim() ?? current.name,
    type: input.type ?? current.type,
    value: input.value ?? current.value,
    minSubtotal: input.minSubtotal ?? current.minSubtotal,
    maxRedemptions: input.maxRedemptions ?? current.maxRedemptions,
    startsAt: input.startsAt ?? current.startsAt,
    endsAt: input.endsAt ?? current.endsAt,
    isActive: input.isActive ?? toBoolean(current.isActive)
  };

  db.prepare(`
    update discount_codes
    set code = ?, name = ?, type = ?, value = ?, min_subtotal = ?, max_redemptions = ?, starts_at = ?, ends_at = ?, is_active = ?
    where id = ? and tenant_id = ?
  `).run(
    next.code,
    next.name,
    next.type,
    next.value,
    next.minSubtotal,
    next.maxRedemptions,
    next.startsAt,
    next.endsAt,
    Number(next.isActive),
    discountId,
    req.tenant!.id
  );

  res.json({
    discount: {
      id: discountId,
      tenantId: req.tenant!.id,
      ...next,
      redemptionCount: current.redemptionCount,
      createdAt: current.createdAt
    }
  });
});

routes.get("/store/domains", requireStoreRole(["store_owner"]), (req, res) => {
  const domains = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      domain,
      is_primary as isPrimary,
      verification_status as verificationStatus,
      verification_token as verificationToken
    from tenant_domains
    where tenant_id = ?
    order by is_primary desc, domain asc
  `).all(req.tenant!.id).map((domain: any) => ({
    ...domain,
    isPrimary: toBoolean(domain.isPrimary)
  }));

  res.json({ domains });
});

const domainSchema = z.object({
  domain: z.string().min(3).transform((value) => value.toLowerCase())
});

routes.post("/store/domains", requireStoreRole(["store_owner"]), (req, res) => {
  const input = domainSchema.parse(req.body);
  const id = nanoid();
  const verificationToken = `moken-verify-${nanoid(16)}`;

  db.prepare(`
    insert into tenant_domains (id, tenant_id, domain, is_primary, verification_status, verification_token)
    values (?, ?, ?, 0, 'pending', ?)
  `).run(id, req.tenant!.id, input.domain, verificationToken);

  res.status(201).json({
    domain: {
      id,
      tenantId: req.tenant!.id,
      domain: input.domain,
      isPrimary: false,
      verificationStatus: "pending",
      verificationToken
    }
  });
});

const domainVerificationSchema = z.object({
  verificationStatus: z.enum(["pending", "verified", "failed"])
});

routes.patch("/store/domains/:id/verification", requireStoreRole(["store_owner"]), (req, res) => {
  const input = domainVerificationSchema.parse(req.body);
  const result = db.prepare(`
    update tenant_domains
    set verification_status = ?
    where id = ? and tenant_id = ?
  `).run(input.verificationStatus, req.params.id, req.tenant!.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "domain_not_found", message: "Domain was not found for this store." });
    return;
  }

  res.json({ domain: { id: req.params.id, verificationStatus: input.verificationStatus } });
});

routes.get("/store/products", (req, res) => {
  const category = String(req.query.category ?? "");
  const q = String(req.query.q ?? "").trim();
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const offset = (page - 1) * limit;
  const canManageProducts = req.user?.role === "platform_owner" || req.user?.tenantId === req.tenant!.id;

  // البحث النصي (FTS)
  if (q) {
    const activeFilter = canManageProducts ? "" : "and p.is_active = 1";
    const searchResults = db.prepare(`
      select p.id, p.tenant_id as tenantId, p.category_id as categoryId, p.name, p.slug,
        p.short_description as shortDescription, p.description, p.price, p.currency,
        p.inventory, p.image_url as imageUrl, p.images_json as imagesJson,
        p.specs_json as specsJson, p.is_active as isActive
      from products_fts
      join products p on p.rowid = products_fts.rowid
      where products_fts match ? and p.tenant_id = ? ${activeFilter}
      order by rank
      limit ? offset ?
    `).all(q + "*", req.tenant!.id, limit, offset) as any[];

    const total = (db.prepare(`
      select count(*) as count from products_fts
      join products p on p.rowid = products_fts.rowid
      where products_fts match ? and p.tenant_id = ? ${activeFilter}
    `).get(q + "*", req.tenant!.id) as { count: number }).count;

    const variantsMap = fetchProductsWithVariants(searchResults.map((p: any) => p.id));
    const products = searchResults.map((p: any) => ({
      ...p,
      isActive: toBoolean(p.isActive),
      images: parseJsonArray(p.imagesJson),
      specs: parseJsonArray(p.specsJson),
      variants: variantsMap.get(p.id) ?? [],
      imagesJson: undefined,
      specsJson: undefined
    }));

    res.json({ products, total, page, limit, totalPages: Math.ceil(total / limit) });
    return;
  }

  const categoryRow = category
    ? db.prepare("select id from categories where tenant_id = ? and slug = ?").get(req.tenant!.id, category) as { id: string } | undefined
    : undefined;
  const categoryIds = categoryRow
    ? [
        categoryRow.id,
        ...db.prepare("select id from categories where tenant_id = ? and parent_id = ?")
          .all(req.tenant!.id, categoryRow.id)
          .map((row: any) => row.id)
      ]
    : [];

  const activeFilter = canManageProducts ? "" : "and is_active = 1";
  const categoryFilter = categoryIds.length ? `and category_id in (${categoryIds.map(() => "?").join(",")})` : "";
  const baseParams = [req.tenant!.id, ...categoryIds];

  const total = (db.prepare(`
    select count(*) as count from products where tenant_id = ? ${activeFilter} ${categoryFilter}
  `).get(...baseParams) as { count: number }).count;

  const rows = db.prepare(`
    select
      id, tenant_id as tenantId, category_id as categoryId, name, slug,
      short_description as shortDescription, description, price, currency,
      inventory, image_url as imageUrl, images_json as imagesJson,
      specs_json as specsJson, is_active as isActive
    from products
    where tenant_id = ? ${activeFilter} ${categoryFilter}
    order by created_at desc
    limit ? offset ?
  `).all(...baseParams, limit, offset) as any[];

  const variantsMap = fetchProductsWithVariants(rows.map((p) => p.id));
  const products = rows.map((p) => ({
    ...p,
    isActive: toBoolean(p.isActive),
    images: parseJsonArray(p.imagesJson),
    specs: parseJsonArray(p.specsJson),
    variants: variantsMap.get(p.id) ?? [],
    imagesJson: undefined,
    specsJson: undefined
  }));

  res.json({ products, total, page, limit, totalPages: Math.ceil(total / limit) });
});

routes.get("/store/products/:slug", (req, res) => {
  const canManageProducts = req.user?.role === "platform_owner" || req.user?.tenantId === req.tenant!.id;
  const product = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      category_id as categoryId,
      name,
      slug,
      short_description as shortDescription,
      description,
      price,
      currency,
      inventory,
      image_url as imageUrl,
      images_json as imagesJson,
      specs_json as specsJson,
      is_active as isActive
    from products
    where tenant_id = ? and slug = ?
      ${canManageProducts ? "" : "and is_active = 1"}
  `).get(req.tenant!.id, req.params.slug);

  if (!product) {
    res.status(404).json({ error: "product_not_found", message: "Product was not found for this store." });
    return;
  }

  res.json({ product: mapProduct(product) });
});

routes.get("/store/categories", (req, res) => {
  const includeInactive = req.query.all === "1";
  const canManageCategories = req.user?.role === "platform_owner" || req.user?.tenantId === req.tenant!.id;

  if (includeInactive && !canManageCategories) {
    res.status(401).json({ error: "unauthorized", message: "Login is required." });
    return;
  }

  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 500);
  const offset = (page - 1) * limit;
  const activeFilter = includeInactive ? "" : "and is_active = 1";

  const total = (db.prepare(`select count(*) as count from categories where tenant_id = ? ${activeFilter}`)
    .get(req.tenant!.id) as { count: number }).count;

  const categories = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      parent_id as parentId,
      name,
      slug,
      description,
      image_url as imageUrl,
      sort_order as sortOrder,
      is_active as isActive
    from categories
    where tenant_id = ?
      ${activeFilter}
    order by parent_id asc, sort_order asc, name asc
    limit ? offset ?
  `).all(req.tenant!.id, limit, offset).map((category: any) => ({
    ...category,
    isActive: toBoolean(category.isActive)
  }));

  res.json({ categories, total, page, limit, totalPages: Math.ceil(total / limit) });
});

routes.get("/store/customers", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const minOrders = Math.max(Number(req.query.minOrders ?? 0) || 0, 0);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 250) || 250, 1), 500);
  const params: Array<string | number> = [req.tenant!.id];
  const where = ["c.tenant_id = ?"];

  if (q) {
    where.push("(c.name like ? or c.phone like ? or c.city like ? or c.address like ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const customers = db.prepare(`
    select *
    from (
      select
        c.id,
        c.tenant_id as tenantId,
        c.name,
        c.phone,
        c.city,
        c.address,
        c.notes,
        c.created_at as createdAt,
        coalesce(count(o.id), 0) as orderCount,
        coalesce(sum(case when o.status <> 'cancelled' and o.payment_status = 'paid' then o.total else 0 end), 0) as totalSpent,
        coalesce(max(o.created_at), c.updated_at) as lastOrderAt
      from customers c
      left join orders o on o.tenant_id = c.tenant_id and o.customer_phone = c.phone
      where ${where.join(" and ")}
      group by c.id
    )
    where orderCount >= ?
    order by lastOrderAt desc
    limit ?
  `).all(...params, minOrders, limit);

  res.json({ customers });
});

const categorySchema = z.object({
  parentId: z.string().optional().nullable().default(null),
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  description: z.string().default(""),
  imageUrl: z.string().url().or(z.literal("")).default(""),
  sortOrder: z.number().int().nonnegative().default(0)
});

routes.post("/store/categories", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const input = categorySchema.parse(req.body);
  const id = nanoid();

  const existingSlug = db.prepare("select id from categories where tenant_id = ? and slug = ?")
    .get(req.tenant!.id, input.slug);
  if (existingSlug) {
    res.status(409).json({ error: "slug_taken", message: "هذا الـ slug مستخدم بالفعل في تصنيف آخر." });
    return;
  }

  if (input.parentId) {
    const parent = db.prepare("select id from categories where id = ? and tenant_id = ?")
      .get(input.parentId, req.tenant!.id);
    if (!parent) {
      res.status(422).json({ error: "parent_category_not_found", message: "Parent category was not found." });
      return;
    }
  }

  db.prepare(`
    insert into categories (id, tenant_id, parent_id, name, slug, description, image_url, sort_order)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.tenant!.id,
    input.parentId || null,
    input.name,
    input.slug,
    input.description,
    input.imageUrl,
    input.sortOrder
  );

  logAudit(req.tenant!.id, req.user?.id, "create", "category", id, { name: input.name, slug: input.slug });

  res.status(201).json({
    category: {
      id,
      tenantId: req.tenant!.id,
      parentId: input.parentId || null,
      name: input.name,
      slug: input.slug,
      description: input.description,
      imageUrl: input.imageUrl,
      sortOrder: input.sortOrder,
      isActive: true
    }
  });
});

const categoryUpdateSchema = categorySchema.partial().extend({
  isActive: z.boolean().optional()
});

routes.patch("/store/categories/:id", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const input = categoryUpdateSchema.parse(req.body);
  const current = db.prepare("select * from categories where id = ? and tenant_id = ?")
    .get(req.params.id, req.tenant!.id) as any;

  if (!current) {
    res.status(404).json({ error: "category_not_found", message: "Category was not found for this store." });
    return;
  }

  if (input.parentId && input.parentId === req.params.id) {
    res.status(422).json({ error: "invalid_parent_category", message: "Category cannot be its own parent." });
    return;
  }

  if (input.parentId) {
    const parent = db.prepare("select id from categories where id = ? and tenant_id = ?")
      .get(input.parentId, req.tenant!.id);
    if (!parent) {
      res.status(422).json({ error: "parent_category_not_found", message: "Parent category was not found." });
      return;
    }

    if (hasCategoryCircle(String(req.params.id), input.parentId, req.tenant!.id)) {
      res.status(422).json({ error: "circular_category", message: "هذا التغيير سيخلق دائرة في هرمية التصنيفات." });
      return;
    }
  }

  const next = {
    parentId: input.parentId === undefined ? current.parent_id : input.parentId || null,
    name: input.name ?? current.name,
    slug: input.slug ?? current.slug,
    description: input.description ?? current.description,
    imageUrl: input.imageUrl ?? current.image_url,
    sortOrder: input.sortOrder ?? current.sort_order,
    isActive: input.isActive ?? toBoolean(current.is_active)
  };

  db.prepare(`
    update categories
    set
      parent_id = ?,
      name = ?,
      slug = ?,
      description = ?,
      image_url = ?,
      sort_order = ?,
      is_active = ?
    where id = ? and tenant_id = ?
  `).run(
    next.parentId,
    next.name,
    next.slug,
    next.description,
    next.imageUrl,
    next.sortOrder,
    Number(next.isActive),
    req.params.id,
    req.tenant!.id
  );

  logAudit(req.tenant!.id, req.user?.id, "update", "category", String(req.params.id));

  res.json({
    category: {
      id: req.params.id,
      tenantId: req.tenant!.id,
      ...next
    }
  });
});

const productSchema = z.object({
  categoryId: z.string().optional().default(""),
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  shortDescription: z.string().default(""),
  description: z.string().default(""),
  price: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("LYD"),
  inventory: z.number().int().nonnegative().default(0),
  imageUrl: z.string().url().or(z.literal("")).default(""),
  images: z.array(z.string().url()).default([]),
  specs: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  variants: z.array(z.object({
    optionName: z.string().min(1),
    optionValue: z.string().min(1),
    sku: z.string().default(""),
    priceDelta: z.number().int().default(0),
    inventory: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true)
  })).default([])
});

routes.post("/store/products", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const input = productSchema.parse(req.body);
  const id = nanoid();

  const existingSlug = db.prepare("select id from products where tenant_id = ? and slug = ?")
    .get(req.tenant!.id, input.slug);
  if (existingSlug) {
    res.status(409).json({ error: "slug_taken", message: "هذا الـ slug مستخدم بالفعل، يرجى اختيار slug مختلف." });
    return;
  }

  const createProduct = db.transaction(() => {
    db.prepare(`
      insert into products (
        id,
        tenant_id,
        category_id,
        name,
        slug,
        short_description,
        description,
        price,
        currency,
        inventory,
        image_url,
        images_json,
        specs_json
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.tenant!.id,
      input.categoryId,
      input.name,
      input.slug,
      input.shortDescription,
      input.description,
      input.price,
      input.currency,
      input.inventory,
      input.imageUrl,
      JSON.stringify(input.images),
      JSON.stringify(input.specs)
    );

    replaceProductVariants(id, input.variants);
  });

  createProduct();
  logAudit(req.tenant!.id, req.user?.id, "create", "product", id, { name: input.name, slug: input.slug });

  res.status(201).json({
    product: {
      id,
      tenantId: req.tenant!.id,
      ...input,
      variants: db.prepare(`
        select
          id,
          product_id as productId,
          option_name as optionName,
          option_value as optionValue,
          sku,
          price_delta as priceDelta,
          inventory,
          is_active as isActive
        from product_variants
        where product_id = ?
      `).all(id).map((variant: any) => ({ ...variant, isActive: toBoolean(variant.isActive) })),
      isActive: true
    }
  });
});

const productUpdateSchema = productSchema.partial().extend({
  isActive: z.boolean().optional()
});

routes.patch("/store/products/:id", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const input = productUpdateSchema.parse(req.body);
  const productId = String(req.params.id);
  const current = db.prepare("select * from products where id = ? and tenant_id = ?")
    .get(productId, req.tenant!.id) as any;

  if (!current) {
    res.status(404).json({ error: "product_not_found", message: "Product was not found for this store." });
    return;
  }

  const next = {
    name: input.name ?? current.name,
    slug: input.slug ?? current.slug,
    description: input.description ?? current.description,
    price: input.price ?? current.price,
    currency: input.currency ?? current.currency,
    inventory: input.inventory ?? current.inventory,
    imageUrl: input.imageUrl ?? current.image_url,
    shortDescription: input.shortDescription ?? current.short_description,
    categoryId: input.categoryId ?? current.category_id,
    images: input.images ?? parseJsonArray(current.images_json),
    specs: input.specs ?? parseJsonArray(current.specs_json),
    variants: input.variants,
    isActive: input.isActive ?? toBoolean(current.is_active)
  };

  const update = db.transaction(() => {
    db.prepare(`
      update products
      set
        name = ?,
        slug = ?,
        category_id = ?,
        short_description = ?,
        description = ?,
        price = ?,
        currency = ?,
        inventory = ?,
        image_url = ?,
        images_json = ?,
        specs_json = ?,
        is_active = ?
      where id = ? and tenant_id = ?
    `).run(
      next.name,
      next.slug,
      next.categoryId,
      next.shortDescription,
      next.description,
      next.price,
      next.currency,
      next.inventory,
      next.imageUrl,
      JSON.stringify(next.images),
      JSON.stringify(next.specs),
      Number(next.isActive),
      productId,
      req.tenant!.id
    );

    if (next.variants) {
      replaceProductVariants(productId, next.variants);
    }
  });

  update();
  logAudit(req.tenant!.id, req.user?.id, "update", "product", productId);

  const updated = db.prepare(`
    select
      id,
      tenant_id as tenantId,
      category_id as categoryId,
      name,
      slug,
      short_description as shortDescription,
      description,
      price,
      currency,
      inventory,
      image_url as imageUrl,
      images_json as imagesJson,
      specs_json as specsJson,
      is_active as isActive
    from products
    where id = ? and tenant_id = ?
  `).get(productId, req.tenant!.id);

  res.json({
    product: mapProduct(updated)
  });
});

const bulkProductSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["activate", "deactivate", "delete"]).optional(),
  priceAdjustment: z.object({
    type: z.enum(["percent", "fixed"]),
    value: z.number().int()
  }).optional()
}).refine((d) => d.action || d.priceAdjustment, { message: "يجب تحديد action أو priceAdjustment." });

routes.patch("/store/products/bulk", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const input = bulkProductSchema.parse(req.body);
  const placeholders = input.ids.map(() => "?").join(",");

  const bulkUpdate = db.transaction(() => {
    if (input.action === "activate") {
      db.prepare(`update products set is_active = 1 where id in (${placeholders}) and tenant_id = ?`)
        .run(...input.ids, req.tenant!.id);
    } else if (input.action === "deactivate") {
      db.prepare(`update products set is_active = 0 where id in (${placeholders}) and tenant_id = ?`)
        .run(...input.ids, req.tenant!.id);
    } else if (input.action === "delete") {
      db.prepare(`delete from products where id in (${placeholders}) and tenant_id = ?`)
        .run(...input.ids, req.tenant!.id);
    } else if (input.priceAdjustment) {
      const adj = input.priceAdjustment;
      for (const id of input.ids) {
        const product = db.prepare("select price from products where id = ? and tenant_id = ?")
          .get(id, req.tenant!.id) as { price: number } | undefined;
        if (!product) continue;
        const newPrice = adj.type === "percent"
          ? Math.max(1, Math.round(product.price * (1 + adj.value / 100)))
          : Math.max(1, product.price + adj.value);
        db.prepare("update products set price = ? where id = ? and tenant_id = ?")
          .run(newPrice, id, req.tenant!.id);
      }
    }
  });

  bulkUpdate();
  logAudit(req.tenant!.id, req.user?.id, "bulk_update", "product", "multiple", { ids: input.ids, action: input.action ?? "price_adjustment" });

  res.json({ ok: true, count: input.ids.length });
});

routes.delete("/store/products/:id", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const productId = String(req.params.id);
  const product = db.prepare("select id, name from products where id = ? and tenant_id = ?")
    .get(productId, req.tenant!.id) as { id: string; name: string } | undefined;

  if (!product) {
    res.status(404).json({ error: "product_not_found", message: "المنتج غير موجود." });
    return;
  }

  db.prepare("delete from products where id = ? and tenant_id = ?").run(productId, req.tenant!.id);
  logAudit(req.tenant!.id, req.user?.id, "delete", "product", productId, { name: product.name });

  res.json({ ok: true });
});

routes.delete("/store/categories/:id", requireStoreRole(["store_owner", "products_manager"]), (req, res) => {
  const categoryId = String(req.params.id);
  const category = db.prepare("select id, name from categories where id = ? and tenant_id = ?")
    .get(categoryId, req.tenant!.id) as { id: string; name: string } | undefined;

  if (!category) {
    res.status(404).json({ error: "category_not_found", message: "التصنيف غير موجود." });
    return;
  }

  const hasProducts = db.prepare("select id from products where category_id = ? and tenant_id = ? limit 1")
    .get(categoryId, req.tenant!.id);
  if (hasProducts) {
    res.status(409).json({ error: "category_has_products", message: "لا يمكن حذف التصنيف لأنه يحتوي على منتجات. يرجى نقل المنتجات أولاً." });
    return;
  }

  const hasChildren = db.prepare("select id from categories where parent_id = ? and tenant_id = ? limit 1")
    .get(categoryId, req.tenant!.id);
  if (hasChildren) {
    res.status(409).json({ error: "category_has_children", message: "لا يمكن حذف التصنيف لأنه يحتوي على تصنيفات فرعية." });
    return;
  }

  db.prepare("delete from categories where id = ? and tenant_id = ?").run(categoryId, req.tenant!.id);
  logAudit(req.tenant!.id, req.user?.id, "delete", "category", categoryId, { name: category.name });

  res.json({ ok: true });
});

routes.delete("/store/discount-codes/:id", requireStoreRole(["store_owner"]), (req, res) => {
  const discountId = String(req.params.id);
  const discount = db.prepare("select id, code from discount_codes where id = ? and tenant_id = ?")
    .get(discountId, req.tenant!.id) as { id: string; code: string } | undefined;

  if (!discount) {
    res.status(404).json({ error: "discount_not_found", message: "كوبون الخصم غير موجود." });
    return;
  }

  db.prepare("delete from discount_codes where id = ? and tenant_id = ?").run(discountId, req.tenant!.id);
  logAudit(req.tenant!.id, req.user?.id, "delete", "discount_code", discountId, { code: discount.code });

  res.json({ ok: true });
});

routes.delete("/store/shipping-zones/:id", requireStoreRole(["store_owner"]), (req, res) => {
  const zoneId = String(req.params.id);
  const zone = db.prepare("select id, name from shipping_zones where id = ? and tenant_id = ?")
    .get(zoneId, req.tenant!.id) as { id: string; name: string } | undefined;

  if (!zone) {
    res.status(404).json({ error: "shipping_zone_not_found", message: "منطقة الشحن غير موجودة." });
    return;
  }

  db.prepare("delete from shipping_zones where id = ? and tenant_id = ?").run(zoneId, req.tenant!.id);
  logAudit(req.tenant!.id, req.user?.id, "delete", "shipping_zone", zoneId, { name: zone.name });

  res.json({ ok: true });
});

routes.get("/store/audit-log", requireStoreRole(["store_owner"]), (req, res) => {
  const entity = String(req.query.entity ?? "").trim();
  const entityId = String(req.query.entityId ?? "").trim();
  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const offset = (page - 1) * limit;
  const params: Array<string | number> = [req.tenant!.id];
  const where = ["a.tenant_id = ?"];

  if (entity) {
    where.push("a.entity = ?");
    params.push(entity);
  }

  if (entityId) {
    where.push("a.entity_id = ?");
    params.push(entityId);
  }

  const total = (db.prepare(`select count(*) as count from audit_log a where ${where.join(" and ")}`)
    .get(...params) as { count: number }).count;

  const entries = db.prepare(`
    select
      a.id,
      a.action,
      a.entity,
      a.entity_id as entityId,
      a.changes,
      a.created_at as createdAt,
      u.name as userName,
      u.email as userEmail
    from audit_log a
    left join users u on u.id = a.user_id
    where ${where.join(" and ")}
    order by a.created_at desc
    limit ? offset ?
  `).all(...params, limit, offset).map((row: any) => ({
    ...row,
    changes: (() => { try { return JSON.parse(row.changes); } catch { return {}; } })()
  }));

  res.json({ entries, total, page, limit, totalPages: Math.ceil(total / limit) });
});

routes.get("/store/integration/moken", requireStoreRole(["store_owner"]), (req, res) => {
  const settings = db.prepare(`
    select
      enabled,
      api_base_url as apiBaseUrl,
      sync_products as syncProducts,
      sync_inventory as syncInventory,
      push_orders as pushOrders,
      updated_at as updatedAt
    from integration_settings
    where tenant_id = ?
  `).get(req.tenant!.id);

  res.json({ settings });
});

const integrationSchema = z.object({
  enabled: z.boolean(),
  apiBaseUrl: z.string().url().or(z.literal("")),
  syncProducts: z.boolean(),
  syncInventory: z.boolean(),
  pushOrders: z.boolean()
});

routes.patch("/store/integration/moken", requireStoreRole(["store_owner"]), (req, res) => {
  const input = integrationSchema.parse(req.body);

  db.prepare(`
    update integration_settings
    set
      enabled = ?,
      api_base_url = ?,
      sync_products = ?,
      sync_inventory = ?,
      push_orders = ?,
      updated_at = current_timestamp
    where tenant_id = ?
  `).run(
    Number(input.enabled),
    input.apiBaseUrl,
    Number(input.syncProducts),
    Number(input.syncInventory),
    Number(input.pushOrders),
    req.tenant!.id
  );

  res.json({ settings: input });
});

routes.get("/store/reports/summary", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const tenantId = req.tenant!.id;
  const sales = db.prepare(`
    select
      coalesce(sum(case when date(created_at) = date('now') and payment_status = 'paid' and status <> 'cancelled' then total else 0 end), 0) as revenueToday,
      coalesce(sum(case when datetime(created_at) >= datetime('now', '-7 days') and payment_status = 'paid' and status <> 'cancelled' then total else 0 end), 0) as revenueWeek,
      coalesce(sum(case when datetime(created_at) >= datetime('now', '-30 days') and payment_status = 'paid' and status <> 'cancelled' then total else 0 end), 0) as revenueMonth,
      coalesce(sum(case when payment_status = 'paid' and status <> 'cancelled' then total else 0 end), 0) as revenueAllTime,
      coalesce(sum(case when date(created_at) = date('now') and status <> 'cancelled' then 1 else 0 end), 0) as ordersToday,
      coalesce(sum(case when datetime(created_at) >= datetime('now', '-7 days') and status <> 'cancelled' then 1 else 0 end), 0) as ordersWeek,
      coalesce(sum(case when datetime(created_at) >= datetime('now', '-30 days') and status <> 'cancelled' then 1 else 0 end), 0) as ordersMonth,
      coalesce(sum(case when status <> 'cancelled' then 1 else 0 end), 0) as ordersAllTime,
      coalesce(avg(case when payment_status = 'paid' and status <> 'cancelled' then total end), 0) as averageOrderValue
    from orders
    where tenant_id = ?
  `).get(tenantId) as any;

  const statusCounts = db.prepare(`
    select
      status,
      count(*) as count,
      coalesce(sum(total), 0) as total
    from orders
    where tenant_id = ?
    group by status
    order by count desc
  `).all(tenantId);

  const topProducts = db.prepare(`
    select
      oi.product_id as productId,
      oi.product_name as productName,
      coalesce(sum(oi.quantity), 0) as quantity,
      coalesce(sum(oi.line_total), 0) as total
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.tenant_id = ? and o.status <> 'cancelled'
    group by oi.product_id, oi.product_name
    order by quantity desc, total desc
    limit 8
  `).all(tenantId);

  const topCustomers = db.prepare(`
    select
      c.id as customerId,
      c.name,
      c.phone,
      count(o.id) as orderCount,
      coalesce(sum(o.total), 0) as totalSpent
    from customers c
    left join orders o on o.tenant_id = c.tenant_id and o.customer_phone = c.phone and o.status <> 'cancelled' and o.payment_status = 'paid'
    where c.tenant_id = ?
    group by c.id
    order by totalSpent desc, orderCount desc
    limit 8
  `).all(tenantId);

  res.json({
    report: {
      revenue: {
        today: sales.revenueToday,
        week: sales.revenueWeek,
        month: sales.revenueMonth,
        allTime: sales.revenueAllTime
      },
      orders: {
        today: sales.ordersToday,
        week: sales.ordersWeek,
        month: sales.ordersMonth,
        allTime: sales.ordersAllTime
      },
      averageOrderValue: Math.round(Number(sales.averageOrderValue ?? 0)),
      statusCounts,
      topProducts,
      topCustomers
    }
  });
});

function mapNotification(row: any) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderId.slice(0, 8),
    customerName: row.customerName,
    type: row.type,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    isRead: toBoolean(row.isRead)
  };
}

routes.get("/store/notifications", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 100);
  const notifications = db.prepare(`
    select
      e.id,
      e.order_id as orderId,
      e.type,
      e.title,
      e.message,
      e.created_at as createdAt,
      o.customer_name as customerName,
      case when r.event_id is null then 0 else 1 end as isRead
    from order_events e
    join orders o on o.id = e.order_id
    left join order_event_reads r on r.event_id = e.id and r.user_id = ?
    where o.tenant_id = ?
    order by e.created_at desc
    limit ?
  `).all(req.user!.id, req.tenant!.id, limit).map(mapNotification);
  const unread = db.prepare(`
    select count(*) as count
    from order_events e
    join orders o on o.id = e.order_id
    left join order_event_reads r on r.event_id = e.id and r.user_id = ?
    where o.tenant_id = ? and r.event_id is null
  `).get(req.user!.id, req.tenant!.id) as { count: number };

  res.json({
    notifications,
    unreadCount: Number(unread.count ?? 0)
  });
});

routes.patch("/store/notifications/read-all", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  db.prepare(`
    insert or ignore into order_event_reads (event_id, user_id)
    select e.id, ?
    from order_events e
    join orders o on o.id = e.order_id
    where o.tenant_id = ?
  `).run(req.user!.id, req.tenant!.id);

  res.json({ ok: true });
});

routes.patch("/store/notifications/:id/read", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const event = db.prepare(`
    select e.id
    from order_events e
    join orders o on o.id = e.order_id
    where e.id = ? and o.tenant_id = ?
  `).get(req.params.id, req.tenant!.id);

  if (!event) {
    res.status(404).json({ error: "notification_not_found", message: "Notification was not found for this store." });
    return;
  }

  db.prepare("insert or ignore into order_event_reads (event_id, user_id) values (?, ?)")
    .run(req.params.id, req.user!.id);

  res.json({ ok: true });
});

const orderSchema = z.object({
  customerName: z.string().min(2),
  customerPhone: z.string().min(5),
  customerCity: z.string().default(""),
  customerAddress: z.string().default(""),
  notes: z.string().default(""),
  paymentMethod: z.string().default("cash_on_delivery"),
  shippingZoneId: z.string().optional().default(""),
  discountCode: z.string().optional().default(""),
  items: z.array(z.object({
    productId: z.string().min(1),
    variantId: z.string().optional().default(""),
    quantity: z.number().int().positive()
  })).min(1)
});

const orderTrackingSchema = z.object({
  phone: z.string().min(5),
  orderId: z.string().optional().default("")
});

const orderStatusValues = ["new", "confirmed", "processing", "shipped", "cancelled"] as const;
const paymentStatusValues = ["pending", "authorized", "paid", "failed", "refunded"] as const;

function buildOrderFilters(req: Request) {
  const params: Array<string | number> = [req.tenant!.id];
  const where = ["o.tenant_id = ?"];
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const paymentStatus = String(req.query.paymentStatus ?? "").trim();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 250) || 250, 1), 500);

  if (q) {
    where.push(`(
      o.id like ?
      or o.customer_name like ?
      or o.customer_phone like ?
      or o.customer_city like ?
      or o.payment_reference like ?
      or o.discount_code like ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }

  if (orderStatusValues.includes(status as any)) {
    where.push("o.status = ?");
    params.push(status);
  }

  if (paymentStatusValues.includes(paymentStatus as any)) {
    where.push("o.payment_status = ?");
    params.push(paymentStatus);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    where.push("date(o.created_at) >= date(?)");
    params.push(dateFrom);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    where.push("date(o.created_at) <= date(?)");
    params.push(dateTo);
  }

  return {
    whereSql: where.join(" and "),
    params,
    limit
  };
}

routes.get("/store/orders", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const filters = buildOrderFilters(req);
  const orders = db.prepare(`
    select
      o.id,
      o.tenant_id as tenantId,
      o.customer_name as customerName,
      o.customer_phone as customerPhone,
      o.customer_city as customerCity,
      o.customer_address as customerAddress,
      o.notes,
      o.payment_method as paymentMethod,
      o.payment_status as paymentStatus,
      o.paid_amount as paidAmount,
      o.payment_reference as paymentReference,
      o.shipping_zone_id as shippingZoneId,
      o.shipping_zone_name as shippingZoneName,
      o.shipping_fee as shippingFee,
      o.discount_code_id as discountCodeId,
      o.discount_code as discountCode,
      o.discount_amount as discountAmount,
      o.status,
      o.total,
      o.created_at as createdAt,
      coalesce(sum(oi.quantity), 0) as itemCount
    from orders o
    left join order_items oi on oi.order_id = o.id
    where ${filters.whereSql}
    group by o.id
    order by o.created_at desc
    limit ?
  `).all(...filters.params, filters.limit);

  res.json({ orders });
});

routes.get("/store/orders/export.csv", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const filters = buildOrderFilters(req);
  const orders = db.prepare(`
    select
      o.id,
      o.customer_name as customerName,
      o.customer_phone as customerPhone,
      o.customer_city as customerCity,
      o.payment_method as paymentMethod,
      o.payment_status as paymentStatus,
      o.paid_amount as paidAmount,
      o.payment_reference as paymentReference,
      o.shipping_zone_name as shippingZoneName,
      o.shipping_fee as shippingFee,
      o.discount_code as discountCode,
      o.discount_amount as discountAmount,
      o.status,
      o.total,
      o.created_at as createdAt,
      coalesce(sum(oi.quantity), 0) as itemCount
    from orders o
    left join order_items oi on oi.order_id = o.id
    where ${filters.whereSql}
    group by o.id
    order by o.created_at desc
    limit ?
  `).all(...filters.params, filters.limit) as any[];

  const header = [
    "id",
    "customerName",
    "customerPhone",
    "customerCity",
    "status",
    "paymentMethod",
    "paymentStatus",
    "paidAmount",
    "paymentReference",
    "shippingZone",
    "shippingFee",
    "discountCode",
    "discountAmount",
    "itemCount",
    "total",
    "createdAt"
  ];
  const rows = orders.map((order) => [
    order.id,
    order.customerName,
    order.customerPhone,
    order.customerCity,
    order.status,
    order.paymentMethod,
    order.paymentStatus,
    order.paidAmount,
    order.paymentReference,
    order.shippingZoneName,
    order.shippingFee,
    order.discountCode,
    order.discountAmount,
    order.itemCount,
    order.total,
    order.createdAt
  ].map(csvCell).join(","));

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="orders-${req.tenant!.slug}.csv"`);
  res.send(`\uFEFF${header.map(csvCell).join(",")}\n${rows.join("\n")}`);
});

routes.post("/store/orders/track", (req, res) => {
  const input = orderTrackingSchema.parse(req.body);
  const phone = normalizePhone(input.phone);
  const orderId = input.orderId.trim();
  const where = [
    "o.tenant_id = ?",
    "o.customer_phone = ?"
  ];
  const params: string[] = [req.tenant!.id, phone];

  if (orderId) {
    where.push("o.id = ?");
    params.push(orderId);
  }

  const orders = db.prepare(`
    select
      o.id,
      o.customer_name as customerName,
      o.customer_phone as customerPhone,
      o.customer_city as customerCity,
      o.payment_method as paymentMethod,
      o.payment_status as paymentStatus,
      o.shipping_zone_name as shippingZoneName,
      o.shipping_fee as shippingFee,
      o.discount_amount as discountAmount,
      o.status,
      o.total,
      o.created_at as createdAt,
      coalesce(sum(oi.quantity), 0) as itemCount
    from orders o
    left join order_items oi on oi.order_id = o.id
    where ${where.join(" and ")}
    group by o.id
    order by o.created_at desc
    limit 10
  `).all(...params) as any[];

  const itemsByOrder = db.prepare(`
    select
      id,
      order_id as orderId,
      product_id as productId,
      variant_id as variantId,
      product_name as productName,
      variant_name as variantName,
      sku,
      unit_price as unitPrice,
      quantity,
      line_total as lineTotal
    from order_items
    where order_id = ?
    order by rowid asc
  `);
  const eventsByOrder = db.prepare(`
    select
      id,
      order_id as orderId,
      type,
      title,
      message,
      created_at as createdAt
    from order_events
    where order_id = ?
    order by created_at asc
  `);

  res.json({
    orders: orders.map((order) => ({
      ...order,
      items: itemsByOrder.all(order.id),
      events: eventsByOrder.all(order.id)
    }))
  });
});

routes.get("/store/orders/:id", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const orderId = String(req.params.id);
  const order = getOrderDetail(orderId, req.tenant!.id);

  if (!order) {
    res.status(404).json({ error: "order_not_found", message: "Order was not found for this store." });
    return;
  }

  res.json({ order });
});

routes.post("/store/orders", (req, res) => {
  const input = orderSchema.parse(req.body);
  const id = nanoid();
  const customerId = nanoid();
  const customerPhone = normalizePhone(input.customerPhone);

  const createOrder = db.transaction(() => {
    const productLookup = db.prepare(`
      select id, name, price, inventory
      from products
      where id = ? and tenant_id = ? and is_active = 1
    `);
    const variantLookup = db.prepare(`
      select
        id,
        option_name as optionName,
        option_value as optionValue,
        sku,
        price_delta as priceDelta,
        inventory
      from product_variants
      where id = ? and product_id = ? and is_active = 1
    `);
    const insertItem = db.prepare(`
      insert into order_items (
        id,
        order_id,
        product_id,
        variant_id,
        product_name,
        variant_name,
        sku,
        unit_price,
        quantity,
        line_total
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const decrementInventory = db.prepare(`
      update products
      set inventory = inventory - ?
      where id = ? and tenant_id = ? and inventory >= ?
    `);
    const decrementVariantInventory = db.prepare(`
      update product_variants
      set inventory = inventory - ?
      where id = ? and product_id = ? and inventory >= ?
    `);

    const lines = input.items.map((item) => {
      const product = productLookup.get(item.productId, req.tenant!.id) as
        | { id: string; name: string; price: number; inventory: number }
        | undefined;

      if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      const variant = item.variantId
        ? variantLookup.get(item.variantId, product.id) as
          | { id: string; optionName: string; optionValue: string; sku: string; priceDelta: number; inventory: number }
          | undefined
        : undefined;

      if (item.variantId && !variant) {
        throw new Error("VARIANT_NOT_FOUND");
      }

      const availableInventory = variant ? variant.inventory : product.inventory;
      if (availableInventory < item.quantity) {
        throw new Error("INSUFFICIENT_INVENTORY");
      }

      const unitPrice = product.price + (variant?.priceDelta ?? 0);
      return {
        product,
        variant,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice * item.quantity
      };
    });

    const selectedShippingZone = input.shippingZoneId
      ? db.prepare(`
        select
          id,
          name,
          fee,
          is_active as isActive
        from shipping_zones
        where id = ? and tenant_id = ? and is_active = 1
      `).get(input.shippingZoneId, req.tenant!.id) as
        | { id: string; name: string; fee: number; isActive: number }
        | undefined
      : undefined;

    if (input.shippingZoneId && !selectedShippingZone) {
      throw new Error("SHIPPING_ZONE_NOT_FOUND");
    }

    const itemsTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const shippingFee = selectedShippingZone?.fee ?? 0;
    const appliedDiscount = input.discountCode
      ? getAvailableDiscount(req.tenant!.id, input.discountCode, itemsTotal)
      : undefined;

    if (input.discountCode && !appliedDiscount) {
      throw new Error("DISCOUNT_NOT_AVAILABLE");
    }

    const discountAmount = appliedDiscount?.amount ?? 0;
    const total = Math.max(0, itemsTotal - discountAmount) + shippingFee;

    db.prepare(`
      insert into customers (
        id,
        tenant_id,
        name,
        phone,
        city,
        address,
        notes,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, current_timestamp)
      on conflict(tenant_id, phone) do update set
        name = excluded.name,
        city = case when excluded.city <> '' then excluded.city else customers.city end,
        address = case when excluded.address <> '' then excluded.address else customers.address end,
        notes = case when excluded.notes <> '' then excluded.notes else customers.notes end,
        updated_at = current_timestamp
    `).run(
      customerId,
      req.tenant!.id,
      input.customerName,
      customerPhone,
      input.customerCity,
      input.customerAddress,
      input.notes
    );

    const customer = db.prepare("select id from customers where tenant_id = ? and phone = ?")
      .get(req.tenant!.id, customerPhone) as { id: string };

    db.prepare(`
      insert into orders (
        id,
        tenant_id,
        customer_id,
        customer_name,
        customer_phone,
        customer_city,
        customer_address,
        notes,
        payment_method,
        shipping_zone_id,
        shipping_zone_name,
        shipping_fee,
        discount_code_id,
        discount_code,
        discount_amount,
        total
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.tenant!.id,
      customer.id,
      input.customerName,
      customerPhone,
      input.customerCity,
      input.customerAddress,
      input.notes,
      input.paymentMethod,
      selectedShippingZone?.id ?? "",
      selectedShippingZone?.name ?? "",
      shippingFee,
      appliedDiscount?.id ?? "",
      appliedDiscount?.code ?? "",
      discountAmount,
      total
    );

    if (appliedDiscount) {
      db.prepare(`
        update discount_codes
        set redemption_count = redemption_count + 1
        where id = ? and tenant_id = ?
      `).run(appliedDiscount.id, req.tenant!.id);
    }

    db.prepare(`
      insert into order_events (id, order_id, type, title, message)
      values (?, ?, 'created', ?, ?)
    `).run(
      nanoid(),
      id,
      "تم إنشاء الطلب",
      `طريقة الدفع: ${input.paymentMethod || "غير محددة"}. ${
        selectedShippingZone
          ? `الشحن: ${selectedShippingZone.name} برسوم ${shippingFee / 100} LYD. `
          : ""
      }${
        appliedDiscount
          ? `الخصم: ${appliedDiscount.code} بقيمة ${discountAmount / 100} LYD. `
          : ""
      }${
        input.customerCity || input.customerAddress
          ? `العميل أرسل بياناته من ${input.customerCity || "مدينة غير محددة"}.`
          : "تم استلام الطلب من واجهة المتجر."
      }`
    );

    for (const line of lines) {
      const result = line.variant
        ? decrementVariantInventory.run(line.quantity, line.variant.id, line.product.id, line.quantity)
        : decrementInventory.run(line.quantity, line.product.id, req.tenant!.id, line.quantity);
      if (result.changes === 0) {
        throw new Error("INSUFFICIENT_INVENTORY");
      }

      insertItem.run(
        nanoid(),
        id,
        line.product.id,
        line.variant?.id ?? "",
        line.product.name,
        line.variant ? `${line.variant.optionName}: ${line.variant.optionValue}` : "",
        line.variant?.sku ?? "",
        line.unitPrice,
        line.quantity,
        line.lineTotal
      );
    }

    return {
      id,
      status: "new",
      total,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0)
    };
  });

  const order = createOrder();

  res.status(201).json({ order });
});

const orderStatusSchema = z.object({
  status: z.enum(["new", "confirmed", "processing", "shipped", "cancelled"])
});

const orderPaymentSchema = z.object({
  paymentStatus: z.enum(["pending", "authorized", "paid", "failed", "refunded"]),
  paidAmount: z.number().int().nonnegative().default(0),
  paymentReference: z.string().default("")
});

routes.patch("/store/orders/:id/payment", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const input = orderPaymentSchema.parse(req.body);
  const current = db.prepare(`
    select
      payment_status as paymentStatus,
      paid_amount as paidAmount,
      payment_reference as paymentReference,
      total
    from orders
    where id = ? and tenant_id = ?
  `).get(req.params.id, req.tenant!.id) as { paymentStatus: string; paidAmount: number; paymentReference: string; total: number } | undefined;

  if (!current) {
    res.status(404).json({ error: "order_not_found", message: "Order was not found for this store." });
    return;
  }

  if (input.paidAmount > current.total) {
    res.status(422).json({ error: "invalid_paid_amount", message: "Paid amount cannot exceed order total." });
    return;
  }

  if (input.paymentStatus === "paid" && input.paidAmount !== current.total) {
    res.status(422).json({ error: "invalid_paid_amount", message: "Paid orders must have a paid amount equal to the order total." });
    return;
  }

  db.prepare(`
    update orders
    set payment_status = ?, paid_amount = ?, payment_reference = ?
    where id = ? and tenant_id = ?
  `).run(input.paymentStatus, input.paidAmount, input.paymentReference.trim(), req.params.id, req.tenant!.id);

  if (
    current.paymentStatus !== input.paymentStatus ||
    current.paidAmount !== input.paidAmount ||
    current.paymentReference !== input.paymentReference.trim()
  ) {
    db.prepare(`
      insert into order_events (id, order_id, type, title, message)
      values (?, ?, 'payment_changed', ?, ?)
    `).run(
      nanoid(),
      req.params.id,
      `تغير الدفع إلى ${paymentStatusLabels[input.paymentStatus] ?? input.paymentStatus}`,
      `المبلغ المحصل: ${input.paidAmount / 100} LYD. المرجع: ${input.paymentReference.trim() || "غير محدد"}`
    );
  }

  res.json({
    order: {
      id: req.params.id,
      paymentStatus: input.paymentStatus,
      paidAmount: input.paidAmount,
      paymentReference: input.paymentReference.trim()
    }
  });
});

const orderNoteSchema = z.object({
  message: z.string().min(2)
});

routes.post("/store/orders/:id/notes", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const input = orderNoteSchema.parse(req.body);
  const order = db.prepare("select id from orders where id = ? and tenant_id = ?")
    .get(req.params.id, req.tenant!.id) as { id: string } | undefined;

  if (!order) {
    res.status(404).json({ error: "order_not_found", message: "Order was not found for this store." });
    return;
  }

  const id = nanoid();
  db.prepare(`
    insert into order_events (id, order_id, type, title, message)
    values (?, ?, 'note', ?, ?)
  `).run(id, req.params.id, "ملاحظة داخلية", input.message.trim());

  res.status(201).json({
    event: {
      id,
      orderId: req.params.id,
      type: "note",
      title: "ملاحظة داخلية",
      message: input.message.trim(),
      createdAt: new Date().toISOString()
    }
  });
});

routes.patch("/store/orders/:id/status", requireStoreRole(["store_owner", "orders_manager"]), (req, res) => {
  const input = orderStatusSchema.parse(req.body);
  const current = db.prepare(`
    select
      status,
      discount_code_id as discountCodeId,
      inventory_restocked as inventoryRestocked
    from orders
    where id = ? and tenant_id = ?
  `).get(req.params.id, req.tenant!.id) as { status: string; discountCodeId: string; inventoryRestocked: number } | undefined;
  if (!current) {
    res.status(404).json({ error: "order_not_found", message: "Order was not found for this store." });
    return;
  }

  if (current.status === "cancelled" && input.status !== "cancelled") {
    res.status(422).json({ error: "cannot_reopen_cancelled_order", message: "Cancelled orders cannot be reopened after inventory is restored." });
    return;
  }

  const updateStatus = db.transaction(() => {
    if (input.status === "cancelled" && current.status !== "cancelled" && !current.inventoryRestocked) {
      restockCancelledOrder(String(req.params.id), req.tenant!.id, current.discountCodeId);
    }

    const result = db.prepare(`
      update orders
      set status = ?
      where id = ? and tenant_id = ?
    `).run(input.status, req.params.id, req.tenant!.id);

    if (current.status !== input.status) {
      db.prepare(`
        insert into order_events (id, order_id, type, title, message)
        values (?, ?, 'status_changed', ?, ?)
      `).run(
        nanoid(),
        req.params.id,
        `تغيرت الحالة إلى ${orderStatusLabels[input.status] ?? input.status}`,
        input.status === "cancelled"
          ? `الحالة السابقة: ${orderStatusLabels[current.status] ?? current.status}. تم إرجاع المخزون وتحرير الكوبون إن وجد.`
          : `الحالة السابقة: ${orderStatusLabels[current.status] ?? current.status}`
      );
    }

    return result;
  });

  const result = updateStatus();

  if (result.changes === 0) {
    res.status(404).json({ error: "order_not_found", message: "Order was not found for this store." });
    return;
  }

  if (current.status !== input.status) {
    logAudit(req.tenant!.id, req.user?.id, "update", "order", String(req.params.id), { status: [current.status, input.status] });
  }

  res.json({ order: { id: req.params.id, status: input.status } });
});
