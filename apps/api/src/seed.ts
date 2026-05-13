import { nanoid } from "nanoid";
import { hashPassword } from "./auth.js";
import { db } from "./db.js";

const theme = {
  brandColor: "#111827",
  accentColor: "#14b8a6",
  radius: "soft",
  storefrontStyle: "minimal"
};

export function seedDemoStore() {
  const existing = db.prepare("select id from tenants where slug = ?").get("demo") as { id: string } | undefined;
  if (existing) {
    seedDemoDomains(existing.id);
    ensureStoreSettings(existing.id, "Demo Store");
    ensureShippingZones(existing.id);
    ensureDiscountCodes(existing.id);
    seedDemoUsers(existing.id);
    seedDemoCatalog(existing.id);
    return;
  }

  const tenantId = nanoid();

  db.prepare(`
    insert into tenants (id, name, slug, primary_domain, theme_json)
    values (@id, @name, @slug, @primaryDomain, @themeJson)
  `).run({
    id: tenantId,
    name: "Demo Store",
    slug: "demo",
    primaryDomain: "demo.localhost",
    themeJson: JSON.stringify(theme)
  });

  db.prepare(`
    insert into tenant_domains (id, tenant_id, domain, is_primary, verification_status, verification_token)
    values (?, ?, ?, 1, 'verified', ?)
  `).run(nanoid(), tenantId, "demo.localhost", `moken-verify-${nanoid(10)}`);

  seedDemoDomains(tenantId);

  db.prepare(`
    insert into integration_settings (tenant_id, enabled, api_base_url, sync_products, sync_inventory, push_orders)
    values (?, 0, '', 0, 0, 0)
  `).run(tenantId);

  ensureStoreSettings(tenantId, "Demo Store");
  ensureShippingZones(tenantId);
  ensureDiscountCodes(tenantId);
  seedDemoCatalog(tenantId);
  seedDemoUsers(tenantId);
}

function seedDemoDomains(tenantId: string) {
  const domains = ["demo.localhost", "moken-store.cloud", "www.moken-store.cloud", "store.moken-store.cloud"];
  const insertDomain = db.prepare(`
    insert into tenant_domains (id, tenant_id, domain, is_primary, verification_status, verification_token)
    values (?, ?, ?, ?, 'verified', ?)
  `);

  domains.forEach((domain) => {
    const existing = db.prepare("select id from tenant_domains where domain = ?").get(domain);
    if (existing) return;

    insertDomain.run(
      nanoid(),
      tenantId,
      domain,
      Number(domain === "demo.localhost"),
      domain === "demo.localhost" ? "moken-verify-demo" : `moken-verify-${nanoid(10)}`
    );
  });
}

function ensureStoreSettings(tenantId: string, storeName: string) {
  const existing = db.prepare("select tenant_id from store_settings where tenant_id = ?").get(tenantId);
  if (existing) return;

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
    values (?, ?, ?, ?, ?, 'LYD', ?, ?, ?)
  `).run(
    tenantId,
    storeName,
    "hello@moken-store.cloud",
    "0910000000",
    "0910000000",
    "طرابلس",
    "توصيل داخل المدينة خلال 24 إلى 48 ساعة، وخارجها حسب شركة الشحن.",
    JSON.stringify(["cash_on_delivery", "bank_transfer"])
  );
}

function ensureShippingZones(tenantId: string) {
  const existing = db.prepare("select count(*) as count from shipping_zones where tenant_id = ?").get(tenantId) as { count: number };
  if (existing.count > 0) return;

  const insertZone = db.prepare(`
    insert into shipping_zones (id, tenant_id, name, city, fee, estimated_days, is_active)
    values (?, ?, ?, ?, ?, ?, 1)
  `);

  [
    { name: "داخل طرابلس", city: "طرابلس", fee: 1000, estimatedDays: "24-48 ساعة" },
    { name: "مدن الساحل", city: "مصراتة، الخمس، الزاوية", fee: 2000, estimatedDays: "2-3 أيام" },
    { name: "باقي المدن", city: "كل المدن الأخرى", fee: 3000, estimatedDays: "3-5 أيام" }
  ].forEach((zone) => {
    insertZone.run(nanoid(), tenantId, zone.name, zone.city, zone.fee, zone.estimatedDays);
  });
}

function ensureDiscountCodes(tenantId: string) {
  const existing = db.prepare("select count(*) as count from discount_codes where tenant_id = ?").get(tenantId) as { count: number };
  if (existing.count > 0) return;

  const insertDiscount = db.prepare(`
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
    values (?, ?, ?, ?, ?, ?, ?, ?, '', '', 1)
  `);

  [
    { code: "WELCOME10", name: "خصم الترحيب", type: "percentage", value: 10, minSubtotal: 0, maxRedemptions: 0 },
    { code: "SAVE20", name: "خصم 20 دينار", type: "fixed", value: 2000, minSubtotal: 10000, maxRedemptions: 100 }
  ].forEach((discount) => {
    insertDiscount.run(
      nanoid(),
      tenantId,
      discount.code,
      discount.name,
      discount.type,
      discount.value,
      discount.minSubtotal,
      discount.maxRedemptions
    );
  });
}

function seedDemoUsers(tenantId: string) {
  const insertUser = db.prepare(`
    insert into users (id, tenant_id, name, email, password_hash, role)
    values (?, ?, ?, ?, ?, ?)
  `);

  const ensureUser = (email: string, input: { tenantId: string | null; name: string; password: string; role: string }) => {
    const existing = db.prepare("select id from users where email = ?").get(email);
    if (existing) return;

    insertUser.run(nanoid(), input.tenantId, input.name, email, hashPassword(input.password), input.role);
  };

  ensureUser("owner@moken-store.cloud", {
    tenantId: null,
    name: "Moken Platform Owner",
    password: "Moken@2026",
    role: "platform_owner"
  });

  ensureUser("merchant@moken-store.cloud", {
    tenantId,
    name: "Demo Store Owner",
    password: "Store@2026",
    role: "store_owner"
  });
}

function seedDemoCatalog(tenantId: string) {
  const existingCategories = db.prepare("select count(*) as count from categories where tenant_id = ?").get(tenantId) as { count: number };
  if (existingCategories.count > 0) {
    enrichDemoProducts(tenantId);
    return;
  }

  const categories = [
    {
      key: "fashion",
      name: "الأزياء",
      slug: "fashion",
      description: "ملابس واكسسوارات يومية قابلة للتخصيص.",
      imageUrl: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
      children: [
        { key: "hoodies", name: "هوديز", slug: "hoodies" },
        { key: "bags", name: "حقائب", slug: "bags" }
      ]
    },
    {
      key: "home",
      name: "المنزل",
      slug: "home",
      description: "قطع منزلية وإضاءة وديكور.",
      imageUrl: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=900&q=80",
      children: [
        { key: "lighting", name: "إضاءة", slug: "lighting" },
        { key: "decor", name: "ديكور", slug: "decor" }
      ]
    },
    {
      key: "tech",
      name: "التقنية",
      slug: "tech",
      description: "منتجات عملية للمتاجر التقنية والهدايا.",
      imageUrl: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
      children: [
        { key: "gadgets", name: "أجهزة", slug: "gadgets" },
        { key: "accessories", name: "ملحقات", slug: "accessories" }
      ]
    }
  ];

  const categoryIds = new Map<string, string>();
  const insertCategory = db.prepare(`
    insert into categories (id, tenant_id, parent_id, name, slug, description, image_url, sort_order)
    values (@id, @tenantId, @parentId, @name, @slug, @description, @imageUrl, @sortOrder)
  `);

  categories.forEach((category, index) => {
    const id = nanoid();
    categoryIds.set(category.key, id);
    insertCategory.run({
      id,
      tenantId,
      parentId: null,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageUrl,
      sortOrder: index + 1
    });

    category.children.forEach((child, childIndex) => {
      const childId = nanoid();
      categoryIds.set(child.key, childId);
      insertCategory.run({
        id: childId,
        tenantId,
        parentId: id,
        name: child.name,
        slug: child.slug,
        description: "",
        imageUrl: "",
        sortOrder: childIndex + 1
      });
    });
  });

  const existingProducts = db.prepare("select count(*) as count from products where tenant_id = ?").get(tenantId) as { count: number };
  if (existingProducts.count > 0) {
    db.prepare("update products set category_id = ? where tenant_id = ? and slug = ?")
      .run(categoryIds.get("hoodies"), tenantId, "signature-hoodie");
    db.prepare("update products set category_id = ? where tenant_id = ? and slug = ?")
      .run(categoryIds.get("bags"), tenantId, "urban-backpack");
    db.prepare("update products set category_id = ? where tenant_id = ? and slug = ?")
      .run(categoryIds.get("lighting"), tenantId, "desk-lamp");
    enrichDemoProducts(tenantId);
    return;
  }

  const insertProduct = db.prepare(`
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
    values (
      @id,
      @tenantId,
      @categoryId,
      @name,
      @slug,
      @shortDescription,
      @description,
      @price,
      @currency,
      @inventory,
      @imageUrl,
      @imagesJson,
      @specsJson
    )
  `);

  [
    {
      categoryId: categoryIds.get("hoodies"),
      name: "Signature Hoodie",
      slug: "signature-hoodie",
      shortDescription: "هودي يومي فاخر بقصة مريحة.",
      description: "هودي مصنوع من قطن ناعم مناسب للعلامات التجارية، فرق العمل، ومتاجر الأزياء اليومية. تصميمه بسيط ويقبل التخصيص بالألوان والطباعة.",
      price: 12900,
      currency: "LYD",
      inventory: 24,
      imageUrl: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80",
      images: [
        "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "الخامة", value: "قطن ثقيل مخلوط" },
        { name: "الاستخدام", value: "أزياء، فرق، هدايا" },
        { name: "التخصيص", value: "ألوان وطباعة" }
      ]
    },
    {
      categoryId: categoryIds.get("bags"),
      name: "Urban Backpack",
      slug: "urban-backpack",
      shortDescription: "حقيبة خفيفة للعمل والسفر.",
      description: "حقيبة عملية بسعة جيدة وجيوب منظمة، مناسبة لمتاجر الهدايا، التقنية، والمنتجات اليومية.",
      price: 18900,
      currency: "LYD",
      inventory: 12,
      imageUrl: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80",
      images: [
        "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "السعة", value: "متوسطة" },
        { name: "الجيوب", value: "داخلية وخارجية" },
        { name: "مناسبة لـ", value: "العمل والسفر" }
      ]
    },
    {
      categoryId: categoryIds.get("lighting"),
      name: "Desk Lamp",
      slug: "desk-lamp",
      shortDescription: "إضاءة مكتبية أنيقة وقابلة للتعديل.",
      description: "مصباح مكتبي بإنارة دافئة وتصميم بسيط مناسب لمتاجر المنزل، المكاتب، والهدايا.",
      price: 7900,
      currency: "LYD",
      inventory: 31,
      imageUrl: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80",
      images: [
        "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "نوع الإضاءة", value: "دافئة" },
        { name: "الاستخدام", value: "مكتب ومنزل" },
        { name: "التعديل", value: "زاوية مرنة" }
      ]
    },
    {
      categoryId: categoryIds.get("gadgets"),
      name: "Wireless Charger",
      slug: "wireless-charger",
      shortDescription: "شاحن لاسلكي سريع بتصميم نظيف.",
      description: "شاحن مناسب لمتاجر التقنية والهدايا، يدعم الاستخدام اليومي ويظهر بشكل أنيق على المكتب.",
      price: 9900,
      currency: "LYD",
      inventory: 18,
      imageUrl: "https://images.unsplash.com/photo-1615526675159-e248c3021d3f?auto=format&fit=crop&w=900&q=80",
      images: [
        "https://images.unsplash.com/photo-1615526675159-e248c3021d3f?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1586816879360-004f5b0c51e3?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "القدرة", value: "15W" },
        { name: "التوافق", value: "هواتف تدعم الشحن اللاسلكي" },
        { name: "اللون", value: "أسود مطفي" }
      ]
    }
  ].forEach((product) => insertProduct.run({
    ...product,
    id: nanoid(),
    tenantId,
    imagesJson: JSON.stringify(product.images),
    specsJson: JSON.stringify(product.specs)
  }));
}

function enrichDemoProducts(tenantId: string) {
  const categories = db.prepare("select id, slug from categories where tenant_id = ?").all(tenantId) as Array<{ id: string; slug: string }>;
  const categoryId = (slug: string) => categories.find((category) => category.slug === slug)?.id ?? "";

  const updates = [
    {
      slug: "signature-hoodie",
      categoryId: categoryId("hoodies"),
      shortDescription: "هودي يومي فاخر بقصة مريحة.",
      description: "هودي مصنوع من قطن ناعم مناسب للعلامات التجارية، فرق العمل، ومتاجر الأزياء اليومية. تصميمه بسيط ويقبل التخصيص بالألوان والطباعة.",
      images: [
        "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "الخامة", value: "قطن ثقيل مخلوط" },
        { name: "الاستخدام", value: "أزياء، فرق، هدايا" },
        { name: "التخصيص", value: "ألوان وطباعة" }
      ]
    },
    {
      slug: "urban-backpack",
      categoryId: categoryId("bags"),
      shortDescription: "حقيبة خفيفة للعمل والسفر.",
      description: "حقيبة عملية بسعة جيدة وجيوب منظمة، مناسبة لمتاجر الهدايا، التقنية، والمنتجات اليومية.",
      images: [
        "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "السعة", value: "متوسطة" },
        { name: "الجيوب", value: "داخلية وخارجية" },
        { name: "مناسبة لـ", value: "العمل والسفر" }
      ]
    },
    {
      slug: "desk-lamp",
      categoryId: categoryId("lighting"),
      shortDescription: "إضاءة مكتبية أنيقة وقابلة للتعديل.",
      description: "مصباح مكتبي بإنارة دافئة وتصميم بسيط مناسب لمتاجر المنزل، المكاتب، والهدايا.",
      images: [
        "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=1200&q=80"
      ],
      specs: [
        { name: "نوع الإضاءة", value: "دافئة" },
        { name: "الاستخدام", value: "مكتب ومنزل" },
        { name: "التعديل", value: "زاوية مرنة" }
      ]
    }
  ];

  const update = db.prepare(`
    update products
    set
      category_id = ?,
      short_description = ?,
      description = ?,
      images_json = ?,
      specs_json = ?
    where tenant_id = ? and slug = ?
  `);

  updates.forEach((product) => {
    update.run(
      product.categoryId,
      product.shortDescription,
      product.description,
      JSON.stringify(product.images),
      JSON.stringify(product.specs),
      tenantId,
      product.slug
    );
  });

  const existingWireless = db.prepare("select id from products where tenant_id = ? and slug = ?")
    .get(tenantId, "wireless-charger");
  if (existingWireless) return;

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
    nanoid(),
    tenantId,
    categoryId("gadgets"),
    "Wireless Charger",
    "wireless-charger",
    "شاحن لاسلكي سريع بتصميم نظيف.",
    "شاحن مناسب لمتاجر التقنية والهدايا، يدعم الاستخدام اليومي ويظهر بشكل أنيق على المكتب.",
    9900,
    "LYD",
    18,
    "https://images.unsplash.com/photo-1615526675159-e248c3021d3f?auto=format&fit=crop&w=900&q=80",
    JSON.stringify([
      "https://images.unsplash.com/photo-1615526675159-e248c3021d3f?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1586816879360-004f5b0c51e3?auto=format&fit=crop&w=1200&q=80"
    ]),
    JSON.stringify([
      { name: "القدرة", value: "15W" },
      { name: "التوافق", value: "هواتف تدعم الشحن اللاسلكي" },
      { name: "اللون", value: "أسود مطفي" }
    ])
  );
}
