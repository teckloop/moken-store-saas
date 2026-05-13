import type {
  AppliedDiscount,
  CreateProductInput,
  CreateOrderInput,
  CreateDomainInput,
  CreateTenantInput,
  Category,
  MokenIntegrationSettings,
  Order,
  Product,
  ShippingZone,
  StoreDomain,
  StoreSettings,
  StoreTheme,
  TrackedOrder,
  Tenant,
  UpdateProductInput
} from "@moken-store/shared";

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:4100/api";
  }

  return `${window.location.protocol}//api.moken-saas.online/api`;
}

const apiBaseUrl = resolveApiBaseUrl();

function resolveStoreDomain() {
  if (import.meta.env.VITE_STORE_DOMAIN) {
    return import.meta.env.VITE_STORE_DOMAIN;
  }

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "demo.localhost";
  }

  return host;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-store-domain": resolveStoreDomain(),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
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

export function getStoreSettings() {
  return request<{ settings: StoreSettings }>("/store/settings");
}

export function getShippingZones() {
  return request<{ zones: ShippingZone[] }>("/store/shipping-zones");
}

export function validateDiscountCode(input: { code: string; subtotal: number }) {
  return request<{ discount: AppliedDiscount }>("/store/discount-codes/validate", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getProducts(params?: { q?: string; category?: string }) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.category) qs.set("category", params.category);
  const query = qs.toString();
  return request<{ products: Product[] }>(`/store/products${query ? `?${query}` : ""}`);
}

export function getCategories() {
  return request<{ categories: Category[] }>("/store/categories");
}

export function getProductsByCategory(category: string) {
  return request<{ products: Product[] }>(`/store/products?category=${encodeURIComponent(category)}`);
}

export function getProduct(slug: string) {
  return request<{ product: Product }>(`/store/products/${slug}`);
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

export function getOrders() {
  return request<{ orders: Order[] }>("/store/orders");
}

export function createOrder(input: CreateOrderInput) {
  return request<{ order: Pick<Order, "id" | "status" | "total" | "itemCount"> }>("/store/orders", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function trackOrders(input: { phone: string; orderId?: string }) {
  return request<{ orders: TrackedOrder[] }>("/store/orders/track", {
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
