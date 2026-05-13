export type Tenant = {
  id: string;
  name: string;
  slug: string;
  primaryDomain: string;
  status: "active" | "paused";
  theme: StoreTheme;
};

export type UserRole = "platform_owner" | "store_owner" | "products_manager" | "orders_manager";

export type AuthUser = {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  role: UserRole;
};

export type StoreUserRole = "store_owner" | "products_manager" | "orders_manager";

export type StoreUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: StoreUserRole;
  status: "active" | "inactive";
  createdAt: string;
};

export type StoreTheme = {
  brandColor: string;
  accentColor: string;
  radius: "compact" | "soft" | "round";
  storefrontStyle: "minimal" | "editorial" | "luxury" | "playful";
};

export type Product = {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  price: number;
  currency: string;
  inventory: number;
  imageUrl: string;
  images: string[];
  specs: Array<{
    name: string;
    value: string;
  }>;
  variants: ProductVariant[];
  isActive: boolean;
};

export type ProductVariant = {
  id: string;
  productId: string;
  optionName: string;
  optionValue: string;
  sku: string;
  priceDelta: number;
  inventory: number;
  isActive: boolean;
};

export type Category = {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
};

export type StoreDomain = {
  id: string;
  tenantId: string;
  domain: string;
  isPrimary: boolean;
  verificationStatus: "pending" | "verified" | "failed";
  verificationToken: string;
};

export type ShippingZone = {
  id: string;
  tenantId: string;
  name: string;
  city: string;
  fee: number;
  estimatedDays: string;
  isActive: boolean;
};

export type DiscountCode = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: "fixed" | "percentage";
  value: number;
  minSubtotal: number;
  maxRedemptions: number;
  redemptionCount: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  createdAt: string;
};

export type AppliedDiscount = {
  code: string;
  name: string;
  type: DiscountCode["type"];
  value: number;
  amount: number;
};

export type Order = {
  id: string;
  tenantId: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  notes: string;
  paymentMethod: string;
  paymentStatus: "pending" | "authorized" | "paid" | "failed" | "refunded";
  paidAmount: number;
  paymentReference: string;
  shippingZoneId: string;
  shippingZoneName: string;
  shippingFee: number;
  discountCodeId: string;
  discountCode: string;
  discountAmount: number;
  status: "new" | "confirmed" | "processing" | "shipped" | "cancelled";
  total: number;
  itemCount: number;
  createdAt: string;
};

export type PlatformOrder = Order & {
  tenantName: string;
  tenantSlug: string;
  tenantDomain: string;
};

export type Customer = {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string;
  createdAt: string;
};

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type OrderEvent = {
  id: string;
  orderId: string;
  type: "created" | "status_changed" | "payment_changed" | "note";
  title: string;
  message: string;
  createdAt: string;
};

export type OrderDetail = Order & {
  items: OrderItem[];
  events: OrderEvent[];
};

export type TrackedOrder = Pick<
  Order,
  | "id"
  | "customerName"
  | "customerPhone"
  | "customerCity"
  | "paymentMethod"
  | "paymentStatus"
  | "shippingZoneName"
  | "shippingFee"
  | "discountAmount"
  | "status"
  | "total"
  | "itemCount"
  | "createdAt"
> & {
  items: OrderItem[];
  events: OrderEvent[];
};

export type StoreNotification = {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  type: OrderEvent["type"];
  title: string;
  message: string;
  createdAt: string;
  isRead: boolean;
};

export type MokenIntegrationSettings = {
  enabled: boolean;
  apiBaseUrl: string;
  syncProducts: boolean;
  syncInventory: boolean;
  pushOrders: boolean;
};

export type StoreSettings = {
  storeName: string;
  publicEmail: string;
  publicPhone: string;
  whatsappPhone: string;
  currency: string;
  defaultCity: string;
  shippingPolicy: string;
  paymentMethods: string[];
};

export type StoreReportSummary = {
  revenue: {
    today: number;
    week: number;
    month: number;
    allTime: number;
  };
  orders: {
    today: number;
    week: number;
    month: number;
    allTime: number;
  };
  averageOrderValue: number;
  statusCounts: Array<{
    status: Order["status"];
    count: number;
    total: number;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    total: number;
  }>;
  topCustomers: Array<{
    customerId: string;
    name: string;
    phone: string;
    orderCount: number;
    totalSpent: number;
  }>;
};

export type UploadedImage = {
  url: string;
  filename: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  format: "webp";
};

export type StoreImageAsset = UploadedImage & {
  id: string;
  tenantId: string;
  createdAt: string;
};

export type CreateTenantInput = {
  name: string;
  slug: string;
  primaryDomain: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
};

export type CreateProductInput = {
  categoryId?: string;
  name: string;
  slug: string;
  shortDescription?: string;
  description: string;
  price: number;
  currency: string;
  inventory: number;
  imageUrl: string;
  images?: string[];
  specs?: Array<{
    name: string;
    value: string;
  }>;
  variants?: Array<{
    optionName: string;
    optionValue: string;
    sku?: string;
    priceDelta?: number;
    inventory?: number;
    isActive?: boolean;
  }>;
};

export type UpdateProductInput = Partial<CreateProductInput> & {
  isActive?: boolean;
};

export type CreateCategoryInput = {
  parentId?: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  sortOrder?: number;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput> & {
  isActive?: boolean;
};

export type CreateDomainInput = {
  domain: string;
};

export type CreateStoreUserInput = {
  name: string;
  email: string;
  password: string;
  role: StoreUserRole;
};

export type UpdateStoreUserInput = {
  name?: string;
  role?: StoreUserRole;
  status?: StoreUser["status"];
  password?: string;
};

export type CreateShippingZoneInput = {
  name: string;
  city?: string;
  fee: number;
  estimatedDays?: string;
  isActive?: boolean;
};

export type UpdateShippingZoneInput = Partial<CreateShippingZoneInput>;

export type CreateDiscountCodeInput = {
  code: string;
  name: string;
  type: DiscountCode["type"];
  value: number;
  minSubtotal?: number;
  maxRedemptions?: number;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
};

export type UpdateDiscountCodeInput = Partial<CreateDiscountCodeInput>;

export type UpdateThemeInput = StoreTheme;

export type UpdateStoreSettingsInput = StoreSettings;

export type LoginInput = {
  email: string;
  password: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type CreateOrderInput = {
  customerName: string;
  customerPhone: string;
  customerCity?: string;
  customerAddress?: string;
  notes?: string;
  paymentMethod?: string;
  shippingZoneId?: string;
  discountCode?: string;
  items: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
  }>;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type AuditLogEntry = {
  id: string;
  action: "create" | "update" | "delete" | "bulk_update";
  entity: string;
  entityId: string;
  changes: Record<string, unknown>;
  createdAt: string;
  userName?: string;
  userEmail?: string;
};

export type BulkProductAction = {
  ids: string[];
  action?: "activate" | "deactivate" | "delete";
  priceAdjustment?: {
    type: "percent" | "fixed";
    value: number;
  };
};
