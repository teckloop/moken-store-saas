import type {
  AuditLogEntry,
  AuthSession,
  BulkProductAction,
  CreateProductInput,
  CreateOrderInput,
  CreateCategoryInput,
  CreateDiscountCodeInput,
  CreateDomainInput,
  CreateShippingZoneInput,
  CreateStoreUserInput,
  CreateTenantInput,
  Category,
  Customer,
  DiscountCode,
  MokenIntegrationSettings,
  Order,
  OrderDetail,
  Product,
  StoreReportSummary,
  StoreDomain,
  StoreImageAsset,
  StoreNotification,
  StoreSettings,
  StoreUser,
  StoreTheme,
  ShippingZone,
  Tenant,
  UploadedImage,
  UpdateCategoryInput,
  UpdateDiscountCodeInput,
  UpdateProductInput,
  UpdateShippingZoneInput,
  UpdateStoreUserInput,
  UpdateStoreSettingsInput
} from "@moken-store/shared";

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:4100/api";
  }

  return `${window.location.protocol}//api.moken-store.cloud/api`;
}

const apiBaseUrl = resolveApiBaseUrl();
const authTokenKey = "moken.store.authToken";
const storeDomainKey = "moken.store.domain";

function resolveStoreDomain() {
  if (import.meta.env.VITE_STORE_DOMAIN) {
    return import.meta.env.VITE_STORE_DOMAIN;
  }

  const host = window.location.hostname;
  const storedDomain = localStorage.getItem(storeDomainKey);
  if (storedDomain) {
    return storedDomain;
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "merchant.moken-store.cloud") {
    return "demo.localhost";
  }

  return host;
}

export function getAuthToken() {
  return localStorage.getItem(authTokenKey) ?? "";
}

export function setAuthToken(token: string) {
  localStorage.setItem(authTokenKey, token);
}

export function clearAuthToken() {
  localStorage.removeItem(authTokenKey);
}

export function setStoreDomain(domain: string) {
  localStorage.setItem(storeDomainKey, domain);
}

export function clearStoreDomain() {
  localStorage.removeItem(storeDomainKey);
}

let sessionExpiredHandler: (() => void) | null = null;
export function onSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-store-domain": resolveStoreDomain(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (response.status === 401 && !path.startsWith("/auth/login")) {
    clearAuthToken();
    if (sessionExpiredHandler) sessionExpiredHandler();
    throw new Error("انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function login(input: { email: string; password: string }) {
  return request<{ session: AuthSession }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => {
    setAuthToken(response.session.token);
    return response;
  });
}

export function getCurrentUser() {
  return request<{ user: AuthSession["user"] }>("/auth/me");
}

export function logout() {
  return request<{ ok: true }>("/auth/logout", { method: "POST" }).finally(clearAuthToken);
}

export function getTenants() {
  return request<{ tenants: Tenant[] }>("/admin/tenants");
}

export function createTenant(input: CreateTenantInput) {
  return request<{ tenant: Tenant }>("/admin/tenants", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateTenantStatus(id: string, status: Tenant["status"]) {
  return request<{ tenant: Pick<Tenant, "id" | "status"> }>(`/admin/tenants/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function getStore() {
  return request<{ tenant: Tenant }>("/store");
}

export type ProductFilters = {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
};

export function getProducts(filters: ProductFilters = {}) {
  return request<{ products: Product[]; total: number; page: number; limit: number; totalPages: number }>(
    `/store/products${toQueryString({ q: filters.q, category: filters.category, page: filters.page, limit: filters.limit })}`
  );
}

export function deleteProduct(id: string) {
  return request<{ ok: true }>(`/store/products/${id}`, { method: "DELETE" });
}

export function bulkUpdateProducts(input: BulkProductAction) {
  return request<{ ok: true; count: number }>("/store/products/bulk", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getCategories() {
  return request<{ categories: Category[]; total: number }>("/store/categories?all=1");
}

export function deleteCategory(id: string) {
  return request<{ ok: true }>(`/store/categories/${id}`, { method: "DELETE" });
}

export function deleteDiscountCode(id: string) {
  return request<{ ok: true }>(`/store/discount-codes/${id}`, { method: "DELETE" });
}

export function deleteShippingZone(id: string) {
  return request<{ ok: true }>(`/store/shipping-zones/${id}`, { method: "DELETE" });
}

export type AuditLogFilters = {
  entity?: string;
  entityId?: string;
  page?: number;
  limit?: number;
};

export function getAuditLog(filters: AuditLogFilters = {}) {
  return request<{ entries: AuditLogEntry[]; total: number; page: number; limit: number; totalPages: number }>(
    `/store/audit-log${toQueryString({ entity: filters.entity, entityId: filters.entityId, page: filters.page, limit: filters.limit })}`
  );
}

export type CustomerFilters = {
  q?: string;
  minOrders?: number;
};

function toQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function getCustomers(filters: CustomerFilters = {}) {
  return request<{ customers: Customer[] }>(`/store/customers${toQueryString({
    q: filters.q,
    minOrders: filters.minOrders
  })}`);
}

export function getStoreUsers() {
  return request<{ users: StoreUser[] }>("/store/users");
}

export function createStoreUser(input: CreateStoreUserInput) {
  return request<{ user: StoreUser }>("/store/users", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateStoreUser(id: string, input: UpdateStoreUserInput) {
  return request<{ user: StoreUser }>(`/store/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getShippingZones() {
  return request<{ zones: ShippingZone[] }>("/store/shipping-zones?all=1");
}

export function createShippingZone(input: CreateShippingZoneInput) {
  return request<{ zone: ShippingZone }>("/store/shipping-zones", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateShippingZone(id: string, input: UpdateShippingZoneInput) {
  return request<{ zone: ShippingZone }>(`/store/shipping-zones/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getDiscountCodes() {
  return request<{ discounts: DiscountCode[] }>("/store/discount-codes");
}

export function createDiscountCode(input: CreateDiscountCodeInput) {
  return request<{ discount: DiscountCode }>("/store/discount-codes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDiscountCode(id: string, input: UpdateDiscountCodeInput) {
  return request<{ discount: DiscountCode }>(`/store/discount-codes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function createCategory(input: CreateCategoryInput) {
  return request<{ category: Category }>("/store/categories", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateCategory(id: string, input: UpdateCategoryInput) {
  return request<{ category: Category }>(`/store/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getDomains() {
  return request<{ domains: StoreDomain[] }>("/store/domains");
}

export function createDomain(input: CreateDomainInput) {
  return request<{ domain: StoreDomain }>("/store/domains", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDomainVerification(id: string, verificationStatus: StoreDomain["verificationStatus"]) {
  return request<{ domain: Pick<StoreDomain, "id" | "verificationStatus"> }>(`/store/domains/${id}/verification`, {
    method: "PATCH",
    body: JSON.stringify({ verificationStatus })
  });
}

export function updateTheme(input: StoreTheme) {
  return request<{ theme: StoreTheme }>("/store/theme", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getStoreSettings() {
  return request<{ settings: StoreSettings }>("/store/settings");
}

export function updateStoreSettings(input: UpdateStoreSettingsInput) {
  return request<{ settings: StoreSettings }>("/store/settings", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export type OrderFilters = {
  q?: string;
  status?: Order["status"] | "";
  paymentStatus?: Order["paymentStatus"] | "";
  dateFrom?: string;
  dateTo?: string;
};

export function getOrders(filters: OrderFilters = {}) {
  return request<{ orders: Order[] }>(`/store/orders${toQueryString({
    q: filters.q,
    status: filters.status,
    paymentStatus: filters.paymentStatus,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  })}`);
}

export function getReportSummary() {
  return request<{ report: StoreReportSummary }>("/store/reports/summary");
}

export function getNotifications() {
  return request<{ notifications: StoreNotification[]; unreadCount: number }>("/store/notifications");
}

export function markNotificationRead(id: string) {
  return request<{ ok: true }>(`/store/notifications/${id}/read`, {
    method: "PATCH"
  });
}

export function markAllNotificationsRead() {
  return request<{ ok: true }>("/store/notifications/read-all", {
    method: "PATCH"
  });
}

export function getOrder(id: string) {
  return request<{ order: OrderDetail }>(`/store/orders/${id}`);
}

export function createOrder(input: CreateOrderInput) {
  return request<{ order: Pick<Order, "id" | "status" | "total" | "itemCount"> }>("/store/orders", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateOrderStatus(id: string, status: Order["status"]) {
  return request<{ order: Pick<Order, "id" | "status"> }>(`/store/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function updateOrderPayment(id: string, input: Pick<Order, "paymentStatus" | "paidAmount" | "paymentReference">) {
  return request<{ order: Pick<Order, "id" | "paymentStatus" | "paidAmount" | "paymentReference"> }>(`/store/orders/${id}/payment`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function addOrderNote(id: string, message: string) {
  return request<{ event: OrderDetail["events"][number] }>(`/store/orders/${id}/notes`, {
    method: "POST",
    body: JSON.stringify({ message })
  });
}

export function downloadOrdersCsv(filters: OrderFilters = {}) {
  const token = getAuthToken();
  return fetch(`${apiBaseUrl}/store/orders/export.csv${toQueryString({
    q: filters.q,
    status: filters.status,
    paymentStatus: filters.paymentStatus,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  })}`, {
    headers: {
      "x-store-domain": resolveStoreDomain(),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? `Export failed: ${response.status}`);
    }

    return response.blob();
  });
}

export function getMokenIntegration() {
  return request<{ settings: MokenIntegrationSettings & { updatedAt: string } }>("/store/integration/moken")
    .then((response) => ({
      settings: {
        ...response.settings,
        enabled: Boolean(response.settings.enabled),
        syncProducts: Boolean(response.settings.syncProducts),
        syncInventory: Boolean(response.settings.syncInventory),
        pushOrders: Boolean(response.settings.pushOrders)
      }
    }));
}

export function createProduct(input: CreateProductInput) {
  return request<{ product: Product }>("/store/products", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateProduct(id: string, input: UpdateProductInput) {
  return request<{ product: Product }>(`/store/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function updateMokenIntegration(input: MokenIntegrationSettings) {
  return request<{ settings: MokenIntegrationSettings }>("/store/integration/moken", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getImages() {
  return request<{ images: StoreImageAsset[] }>("/store/uploads/images");
}

export function deleteImage(id: string) {
  return request<{ ok: true }>(`/store/uploads/images/${id}`, {
    method: "DELETE"
  });
}

export function uploadImage(file: File) {
  const token = getAuthToken();
  const form = new FormData();
  form.append("image", file);

  return fetch(`${apiBaseUrl}/store/uploads/images`, {
    method: "POST",
    headers: {
      "x-store-domain": resolveStoreDomain(),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: form
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? `Image upload failed: ${response.status}`);
    }

    return response.json() as Promise<{ image: StoreImageAsset }>;
  });
}
