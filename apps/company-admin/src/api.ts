import type {
  AuthSession,
  CreateProductInput,
  CreateOrderInput,
  CreateDomainInput,
  CreateTenantInput,
  MokenIntegrationSettings,
  Order,
  PlatformOrder,
  Product,
  StoreDomain,
  StoreTheme,
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

  return `${window.location.protocol}//api.moken-store.cloud/api`;
}

const apiBaseUrl = resolveApiBaseUrl();
const authTokenKey = "moken.company.authToken";

export function getAuthToken() {
  return localStorage.getItem(authTokenKey) ?? "";
}

export function setAuthToken(token: string) {
  localStorage.setItem(authTokenKey, token);
}

export function clearAuthToken() {
  localStorage.removeItem(authTokenKey);
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
      "x-store-domain": import.meta.env.VITE_STORE_DOMAIN ?? "demo.localhost",
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

export function getTenants(params?: { page?: number; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return request<{ tenants: Tenant[]; total?: number; page?: number; limit?: number; totalPages?: number }>(
    `/admin/tenants${query ? `?${query}` : ""}`
  );
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

export function getProducts() {
  return request<{ products: Product[] }>("/store/products");
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
  return request<{ orders: PlatformOrder[] }>("/admin/orders");
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
