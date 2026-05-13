import {
  Activity,
  AlertCircle,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  PauseCircle,
  PlayCircle,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Store,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AuthUser, CreateTenantInput, PlatformOrder, Tenant } from "@moken-store/shared";
import {
  createTenant,
  getAuthToken,
  getCurrentUser,
  getOrders,
  getTenants,
  login,
  logout,
  onSessionExpired,
  updateTenantStatus
} from "./api";

type Page = "dashboard" | "tenants" | "orders" | "settings";

type ToastItem = { id: string; type: "success" | "error" | "info"; message: string };

type CompanyState = {
  user?: AuthUser;
  tenants: Tenant[];
  orders: PlatformOrder[];
  loading: boolean;
  error?: string;
};

const merchantAdminUrl = import.meta.env.VITE_MERCHANT_URL || "https://merchant.moken-store.cloud";
const storefrontUrl = import.meta.env.VITE_STOREFRONT_URL || "https://store.moken-store.cloud";

const formatPrice = (price: number, currency = "LYD") =>
  new Intl.NumberFormat("ar-LY", { style: "currency", currency, maximumFractionDigits: 0 }).format(price / 100);

const formatNumber = (value: number) => new Intl.NumberFormat("ar-LY").format(value);

const formatDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("ar-LY", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

function readSessionExpiredFlag() {
  try {
    if (sessionStorage.getItem("moken.sessionExpired") === "1") {
      sessionStorage.removeItem("moken.sessionExpired");
      return "انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى.";
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

const orderStatusVariant: Record<string, "success" | "warning" | "danger" | "muted" | "info" | "accent"> = {
  new: "info",
  confirmed: "accent",
  processing: "warning",
  shipped: "success",
  cancelled: "danger"
};

const orderStatusLabel: Record<string, string> = {
  new: "جديد",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  cancelled: "ملغي"
};

export function App() {
  const [state, setState] = useState<CompanyState>({ tenants: [], orders: [], loading: false, error: readSessionExpiredFlag() });
  const [page, setPage] = useState<Page>("dashboard");
  const [loginForm, setLoginForm] = useState({ email: "owner@moken-store.cloud", password: "Moken@2026" });
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState<"all" | "active" | "paused">("all");
  const [orderFilter, setOrderFilter] = useState<string>("all");
  const [tenantForm, setTenantForm] = useState<CreateTenantInput>({
    name: "",
    slug: "",
    primaryDomain: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: ""
  });

  const showToast = (type: ToastItem["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = setTimeout(() => dismissToast(id), 4500);
    toastTimers.current.set(id, timer);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  };

  const reportError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "حدث خطأ غير متوقع";
    showToast("error", message);
  };

  const loadDashboard = (user: AuthUser) => {
    setState((current) => ({ ...current, loading: true, user }));
    Promise.all([getTenants({ limit: 200 }), getOrders()])
      .then(([tenantsResp, ordersResp]) => {
        setState({ user, tenants: tenantsResp.tenants, orders: ordersResp.orders, loading: false });
      })
      .catch((error: unknown) => {
        reportError(error);
        setState({ user, tenants: [], orders: [], loading: false });
      });
  };

  useEffect(() => {
    onSessionExpired(() => {
      try {
        sessionStorage.setItem("moken.sessionExpired", "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
    });
    if (!getAuthToken()) return;
    getCurrentUser()
      .then((result) => {
        if (result.user.role !== "platform_owner") {
          showToast("error", "هذا الحساب لا يملك صلاحية إدارة الشركة.");
          return;
        }
        loadDashboard(result.user);
      })
      .catch(() => {
        setState({ tenants: [], orders: [], loading: false });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    setLoginSubmitting(true);
    login(loginForm)
      .then((result) => {
        if (result.session.user.role !== "platform_owner") {
          showToast("error", "هذا الحساب لا يملك صلاحية إدارة الشركة.");
          return;
        }
        showToast("success", `أهلاً بك ${result.session.user.name}`);
        loadDashboard(result.session.user);
      })
      .catch(reportError)
      .finally(() => setLoginSubmitting(false));
  };

  const signOut = () => {
    logout().finally(() => {
      setState({ tenants: [], orders: [], loading: false });
      showToast("info", "تم تسجيل الخروج");
    });
  };

  const openCreateModal = () => {
    setTenantForm({
      name: "متجر جديد",
      slug: "new-store",
      primaryDomain: "new-store.moken-store.cloud",
      ownerName: "مالك المتجر",
      ownerEmail: "owner@new-store.com",
      ownerPassword: "Store@2026"
    });
    setCreateOpen(true);
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    setCreateSubmitting(true);
    createTenant(tenantForm)
      .then((result) => {
        setState((current) => ({ ...current, tenants: [result.tenant, ...current.tenants] }));
        showToast("success", `تم إنشاء "${result.tenant.name}" بنجاح`);
        setCreateOpen(false);
      })
      .catch(reportError)
      .finally(() => setCreateSubmitting(false));
  };

  const toggleTenantStatus = (tenant: Tenant) => {
    const nextStatus: Tenant["status"] = tenant.status === "active" ? "paused" : "active";
    updateTenantStatus(tenant.id, nextStatus)
      .then(() => {
        setState((current) => ({
          ...current,
          tenants: current.tenants.map((item) => (item.id === tenant.id ? { ...item, status: nextStatus } : item))
        }));
        showToast("success", nextStatus === "active" ? "تم تفعيل المتجر" : "تم إيقاف المتجر مؤقتاً");
      })
      .catch(reportError);
  };

  const activeTenants = useMemo(() => state.tenants.filter((t) => t.status === "active").length, [state.tenants]);
  const pausedTenants = state.tenants.length - activeTenants;
  const revenue = useMemo(() => state.orders.reduce((sum, o) => sum + o.total, 0), [state.orders]);
  const ordersToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return state.orders.filter((o) => o.createdAt.startsWith(today)).length;
  }, [state.orders]);

  const filteredTenants = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.tenants.filter((tenant) => {
      if (tenantFilter !== "all" && tenant.status !== tenantFilter) return false;
      if (!term) return true;
      return (
        tenant.name.toLowerCase().includes(term) ||
        tenant.slug.toLowerCase().includes(term) ||
        tenant.primaryDomain.toLowerCase().includes(term)
      );
    });
  }, [state.tenants, search, tenantFilter]);

  const filteredOrders = useMemo(() => {
    return state.orders.filter((order) => {
      if (orderFilter !== "all" && order.status !== orderFilter) return false;
      return true;
    });
  }, [state.orders, orderFilter]);

  const tenantStats = useMemo(() => {
    const map = new Map<string, { tenant: Tenant; orders: number; revenue: number }>();
    state.tenants.forEach((tenant) => map.set(tenant.id, { tenant, orders: 0, revenue: 0 }));
    state.orders.forEach((order) => {
      const entry = map.get(order.tenantId);
      if (entry) {
        entry.orders += 1;
        entry.revenue += order.total;
      }
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [state.tenants, state.orders]);

  const ordersTrend = useMemo(() => {
    const buckets: { label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("ar-LY", { weekday: "short" });
      const count = state.orders.filter((o) => o.createdAt.startsWith(key)).length;
      buckets.push({ label, count });
    }
    return buckets;
  }, [state.orders]);

  const maxTrend = Math.max(1, ...ordersTrend.map((b) => b.count));

  if (!state.user) {
    return (
      <>
        <main className="auth-shell">
          <section className="auth-card">
            <div className="auth-logo">
              <span className="logo-mark">
                <ShieldCheck size={22} />
              </span>
              <div>
                <strong>Company Console</strong>
                <span>إدارة منصة Moken</span>
              </div>
            </div>
            <h1>تسجيل الدخول</h1>
            <p className="auth-subtitle">أدخل بياناتك للوصول للوحة تشغيل المنصة.</p>
            <form className="auth-form" onSubmit={submitLogin}>
              <label>
                البريد الإلكتروني
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                  placeholder="owner@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                كلمة المرور
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" disabled={loginSubmitting}>
                {loginSubmitting ? <span className="spinner" /> : null}
                {loginSubmitting ? "جارٍ الدخول..." : "دخول"}
              </button>
            </form>
            <div className="auth-hint">
              للاختبار: <code>owner@moken-store.cloud</code> / <code>Moken@2026</code>
            </div>
          </section>
        </main>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const navItems: Array<{ key: Page; label: string; icon: ReactNode; badge?: ReactNode }> = [
    { key: "dashboard", label: "لوحة التحكم", icon: <LayoutDashboard size={17} /> },
    { key: "tenants", label: "المتاجر", icon: <Store size={17} />, badge: state.tenants.length || undefined },
    { key: "orders", label: "الطلبات", icon: <Receipt size={17} />, badge: state.orders.length || undefined },
    { key: "settings", label: "إعدادات النظام", icon: <Settings size={17} /> }
  ];

  return (
    <>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="logo-mark">
              <Building2 size={20} />
            </span>
            <div>
              <strong>Company Console</strong>
              <span>منصة Moken SaaS</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            <div className="sidebar-section-label">الأقسام</div>
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`nav-link ${page === item.key ? "active" : ""}`}
                onClick={() => setPage(item.key)}
              >
                {item.icon}
                {item.label}
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </button>
            ))}
            <div className="sidebar-section-label">روابط سريعة</div>
            <a className="nav-link" href={merchantAdminUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              لوحة التاجر
            </a>
            <a className="nav-link" href={storefrontUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              الواجهة العامة
            </a>
          </nav>

          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials(state.user.name)}</div>
            <div className="sidebar-user-info">
              <strong>{state.user.name}</strong>
              <span>{state.user.email}</span>
            </div>
            <button type="button" className="icon-btn" onClick={signOut} title="خروج">
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        <main className="workspace">
          {page === "dashboard" ? (
            <DashboardPage
              state={state}
              activeTenants={activeTenants}
              pausedTenants={pausedTenants}
              revenue={revenue}
              ordersToday={ordersToday}
              tenantStats={tenantStats}
              ordersTrend={ordersTrend}
              maxTrend={maxTrend}
              onCreate={openCreateModal}
              onViewTenants={() => setPage("tenants")}
              onViewOrders={() => setPage("orders")}
            />
          ) : null}

          {page === "tenants" ? (
            <TenantsPage
              tenants={filteredTenants}
              total={state.tenants.length}
              tenantStats={tenantStats}
              search={search}
              setSearch={setSearch}
              filter={tenantFilter}
              setFilter={setTenantFilter}
              onCreate={openCreateModal}
              onToggle={toggleTenantStatus}
              loading={state.loading}
            />
          ) : null}

          {page === "orders" ? (
            <OrdersPage
              orders={filteredOrders}
              totalOrders={state.orders.length}
              filter={orderFilter}
              setFilter={setOrderFilter}
              loading={state.loading}
            />
          ) : null}

          {page === "settings" ? <SettingsPage user={state.user} tenantCount={state.tenants.length} /> : null}
        </main>
      </div>

      {createOpen ? (
        <CreateTenantModal
          form={tenantForm}
          setForm={setTenantForm}
          onClose={() => setCreateOpen(false)}
          onSubmit={submitCreate}
          submitting={createSubmitting}
        />
      ) : null}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

/* ============================================
   Dashboard Page
   ============================================ */

function DashboardPage(props: {
  state: CompanyState;
  activeTenants: number;
  pausedTenants: number;
  revenue: number;
  ordersToday: number;
  tenantStats: Array<{ tenant: Tenant; orders: number; revenue: number }>;
  ordersTrend: Array<{ label: string; count: number }>;
  maxTrend: number;
  onCreate: () => void;
  onViewTenants: () => void;
  onViewOrders: () => void;
}) {
  const recentOrders = props.state.orders.slice(0, 6);
  const topTenants = props.tenantStats.slice(0, 5);

  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>لوحة التحكم</h1>
          <p className="subtitle">نظرة شاملة على أداء جميع المتاجر في المنصة</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-accent" onClick={props.onCreate}>
            <Plus size={15} />
            إنشاء متجر
          </button>
        </div>
      </header>

      <section className="kpi-grid">
        <Kpi
          icon={<Store size={20} />}
          color="indigo"
          label="إجمالي المتاجر"
          value={formatNumber(props.state.tenants.length)}
          trend={`${props.activeTenants} نشط · ${props.pausedTenants} متوقف`}
        />
        <Kpi
          icon={<BadgeCheck size={20} />}
          color="green"
          label="المتاجر النشطة"
          value={formatNumber(props.activeTenants)}
          trend={props.state.tenants.length ? `${Math.round((props.activeTenants / props.state.tenants.length) * 100)}% من الإجمالي` : "—"}
        />
        <Kpi
          icon={<Receipt size={20} />}
          color="amber"
          label="إجمالي الطلبات"
          value={formatNumber(props.state.orders.length)}
          trend={`${props.ordersToday} طلب اليوم`}
        />
        <Kpi
          icon={<Wallet size={20} />}
          color="sky"
          label="إجمالي المبيعات"
          value={formatPrice(props.revenue)}
          trend="عبر جميع المتاجر"
        />
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2>الطلبات خلال آخر 7 أيام</h2>
              <p className="card-subtitle">حركة الطلبات اليومية على مستوى المنصة</p>
            </div>
            <TrendingUp size={18} color="var(--accent)" />
          </div>
          <div className="chart">
            {props.ordersTrend.map((bucket, i) => (
              <div className="chart-bar" key={i} title={`${bucket.label}: ${bucket.count} طلب`}>
                <i style={{ height: `${(bucket.count / props.maxTrend) * 100}%` }} />
                <small>{bucket.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2>أعلى المتاجر مبيعاً</h2>
              <p className="card-subtitle">المتاجر الخمسة الأولى حسب الإيرادات</p>
            </div>
            <Activity size={18} color="var(--accent)" />
          </div>
          {topTenants.length === 0 ? (
            <div className="empty-state" style={{ padding: "20px 0" }}>
              <Store size={28} />
              <p>لا توجد متاجر بعد</p>
            </div>
          ) : (
            <div className="activity-list">
              {topTenants.map((entry) => (
                <article className="activity-item" key={entry.tenant.id}>
                  <div className="activity-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    {initials(entry.tenant.name)}
                  </div>
                  <div>
                    <strong>{entry.tenant.name}</strong>
                    <span>{entry.orders} طلب · {entry.tenant.primaryDomain}</span>
                  </div>
                  <time>{formatPrice(entry.revenue)}</time>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="table-wrapper">
        <div className="table-toolbar">
          <h2>أحدث الطلبات</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={props.onViewOrders}>
            عرض الكل
          </button>
        </div>
        {recentOrders.length === 0 ? (
          <div className="empty-state">
            <Receipt size={32} />
            <h3>لا توجد طلبات بعد</h3>
            <p>ستظهر هنا الطلبات الجديدة بمجرد إنشائها في أي متجر</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>المتجر</th>
                <th>الحالة</th>
                <th>الإجمالي</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="row-strong">{order.customerName}</span>
                    <div className="cell-meta">{order.customerPhone}</div>
                  </td>
                  <td>
                    <span>{order.tenantName}</span>
                    <div className="cell-meta">{order.tenantDomain}</div>
                  </td>
                  <td>
                    <span className={`badge ${orderStatusVariant[order.status] || "muted"}`}>
                      {orderStatusLabel[order.status] || order.status}
                    </span>
                  </td>
                  <td className="row-strong">{formatPrice(order.total)}</td>
                  <td>
                    <span className="cell-meta">{formatDateTime(order.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ============================================
   Tenants Page
   ============================================ */

function TenantsPage(props: {
  tenants: Tenant[];
  total: number;
  tenantStats: Array<{ tenant: Tenant; orders: number; revenue: number }>;
  search: string;
  setSearch: (s: string) => void;
  filter: "all" | "active" | "paused";
  setFilter: (f: "all" | "active" | "paused") => void;
  onCreate: () => void;
  onToggle: (tenant: Tenant) => void;
  loading: boolean;
}) {
  const statsMap = useMemo(() => {
    const map = new Map<string, { orders: number; revenue: number }>();
    props.tenantStats.forEach((entry) => map.set(entry.tenant.id, { orders: entry.orders, revenue: entry.revenue }));
    return map;
  }, [props.tenantStats]);

  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>المتاجر</h1>
          <p className="subtitle">إدارة كل المتاجر المسجّلة في المنصة ({props.total})</p>
        </div>
        <div className="header-actions">
          <div className="search-input">
            <Search size={16} />
            <input
              placeholder="ابحث بالاسم أو الدومين..."
              value={props.search}
              onChange={(e) => props.setSearch(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-accent" onClick={props.onCreate}>
            <Plus size={15} />
            متجر جديد
          </button>
        </div>
      </header>

      <div className="filter-chips">
        <button
          type="button"
          className={`filter-chip ${props.filter === "all" ? "active" : ""}`}
          onClick={() => props.setFilter("all")}
        >
          الكل ({props.total})
        </button>
        <button
          type="button"
          className={`filter-chip ${props.filter === "active" ? "active" : ""}`}
          onClick={() => props.setFilter("active")}
        >
          نشط
        </button>
        <button
          type="button"
          className={`filter-chip ${props.filter === "paused" ? "active" : ""}`}
          onClick={() => props.setFilter("paused")}
        >
          متوقف
        </button>
      </div>

      {props.tenants.length === 0 ? (
        <div className="card empty-state">
          <Store size={36} />
          <h3>لا توجد متاجر مطابقة</h3>
          <p>جرّب تغيير الفلتر أو أنشئ متجراً جديداً.</p>
        </div>
      ) : (
        <div className="tenant-grid">
          {props.tenants.map((tenant) => {
            const stats = statsMap.get(tenant.id) ?? { orders: 0, revenue: 0 };
            return (
              <article className="tenant-card" key={tenant.id}>
                <div className="tenant-card-header">
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div
                      className="tenant-avatar"
                      style={{
                        background: tenant.theme?.brandColor
                          ? `linear-gradient(135deg, ${tenant.theme.brandColor}, ${tenant.theme.accentColor || tenant.theme.brandColor})`
                          : undefined
                      }}
                    >
                      {initials(tenant.name)}
                    </div>
                    <div className="tenant-card-body">
                      <strong>{tenant.name}</strong>
                      <span>{tenant.primaryDomain}</span>
                    </div>
                  </div>
                  <span className={`badge ${tenant.status === "active" ? "success" : "muted"}`}>
                    {tenant.status === "active" ? "نشط" : "متوقف"}
                  </span>
                </div>

                <div className="tenant-stats">
                  <div className="tenant-stat">
                    <strong>{formatNumber(stats.orders)}</strong>
                    <span>طلب</span>
                  </div>
                  <div className="tenant-stat">
                    <strong>{formatPrice(stats.revenue)}</strong>
                    <span>إيراد</span>
                  </div>
                  <div className="tenant-stat">
                    <strong>{tenant.slug}</strong>
                    <span>المعرف</span>
                  </div>
                </div>

                <div className="tenant-actions">
                  <button type="button" className="btn btn-sm" onClick={() => props.onToggle(tenant)}>
                    {tenant.status === "active" ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
                    {tenant.status === "active" ? "إيقاف" : "تفعيل"}
                  </button>
                  <a
                    className="btn btn-sm"
                    href={`https://${tenant.primaryDomain}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} />
                    زيارة
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ============================================
   Orders Page
   ============================================ */

function OrdersPage(props: {
  orders: PlatformOrder[];
  totalOrders: number;
  filter: string;
  setFilter: (f: string) => void;
  loading: boolean;
}) {
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>الطلبات</h1>
          <p className="subtitle">كل الطلبات على مستوى المنصة ({props.totalOrders})</p>
        </div>
      </header>

      <div className="filter-chips">
        {["all", "new", "confirmed", "processing", "shipped", "cancelled"].map((status) => (
          <button
            key={status}
            type="button"
            className={`filter-chip ${props.filter === status ? "active" : ""}`}
            onClick={() => props.setFilter(status)}
          >
            {status === "all" ? "كل الحالات" : orderStatusLabel[status] || status}
          </button>
        ))}
      </div>

      <div className="table-wrapper">
        {props.orders.length === 0 ? (
          <div className="empty-state">
            <Receipt size={36} />
            <h3>لا توجد طلبات</h3>
            <p>غيّر فلتر الحالة أو انتظر تسجيل طلبات جديدة.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>الهاتف</th>
                <th>المتجر</th>
                <th>الحالة</th>
                <th>الدفع</th>
                <th>الإجمالي</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {props.orders.map((order) => (
                <tr key={order.id}>
                  <td className="row-strong">{order.customerName}</td>
                  <td>
                    <span className="cell-meta">{order.customerPhone}</span>
                  </td>
                  <td>
                    <span>{order.tenantName}</span>
                    <div className="cell-meta">{order.tenantDomain}</div>
                  </td>
                  <td>
                    <span className={`badge ${orderStatusVariant[order.status] || "muted"}`}>
                      {orderStatusLabel[order.status] || order.status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${order.paymentStatus === "paid" ? "success" : "muted"}`}>
                      {order.paymentStatus === "paid" ? "مدفوع" : "بانتظار"}
                    </span>
                  </td>
                  <td className="row-strong">{formatPrice(order.total)}</td>
                  <td>
                    <span className="cell-meta">{formatDateTime(order.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ============================================
   Settings Page
   ============================================ */

function SettingsPage(props: { user: AuthUser; tenantCount: number }) {
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>إعدادات النظام</h1>
          <p className="subtitle">معلومات الحساب والمنصة</p>
        </div>
      </header>

      <section className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2>حساب المالك</h2>
              <p className="card-subtitle">معلومات حساب المالك الحالي</p>
            </div>
            <ShieldCheck size={18} color="var(--accent)" />
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <InfoRow label="الاسم" value={props.user.name} />
            <InfoRow label="البريد الإلكتروني" value={props.user.email} />
            <InfoRow label="الدور" value="مالك المنصة" />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2>معلومات المنصة</h2>
              <p className="card-subtitle">إحصائيات عامة</p>
            </div>
            <CheckCircle2 size={18} color="var(--success)" />
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <InfoRow label="عدد المتاجر" value={formatNumber(props.tenantCount)} />
            <InfoRow label="حالة الـ API" value={<span className="badge success">يعمل</span>} />
            <InfoRow label="إصدار المنصة" value="v0.1.0" />
          </div>
        </div>
      </section>
    </>
  );
}

function InfoRow(props: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid var(--border)"
      }}
    >
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{props.label}</span>
      <strong style={{ color: "var(--brand)", fontSize: 13.5 }}>{props.value}</strong>
    </div>
  );
}

/* ============================================
   Create Tenant Modal
   ============================================ */

function CreateTenantModal(props: {
  form: CreateTenantInput;
  setForm: (form: CreateTenantInput) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  submitting: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>إنشاء متجر جديد</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} title="إغلاق">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={props.onSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-row">
                <div className="form-field">
                  <label>اسم المتجر</label>
                  <input
                    value={props.form.name}
                    onChange={(e) => props.setForm({ ...props.form, name: e.target.value })}
                    placeholder="متجر جديد"
                    required
                  />
                </div>
                <div className="form-field">
                  <label>المعرف (slug)</label>
                  <input
                    value={props.form.slug}
                    onChange={(e) => props.setForm({ ...props.form, slug: e.target.value })}
                    placeholder="store-slug"
                    required
                  />
                </div>
              </div>
              <div className="form-field">
                <label>الدومين الأساسي</label>
                <input
                  value={props.form.primaryDomain}
                  onChange={(e) => props.setForm({ ...props.form, primaryDomain: e.target.value })}
                  placeholder="store.moken-store.cloud"
                  required
                />
                <span className="hint">
                  إذا كان فرعياً تحت <code>moken-store.cloud</code> فسيعمل تلقائياً مع wildcard DNS.
                </span>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label>اسم المالك</label>
                  <input
                    value={props.form.ownerName}
                    onChange={(e) => props.setForm({ ...props.form, ownerName: e.target.value })}
                    placeholder="مالك المتجر"
                    required
                  />
                </div>
                <div className="form-field">
                  <label>بريد المالك</label>
                  <input
                    type="email"
                    value={props.form.ownerEmail}
                    onChange={(e) => props.setForm({ ...props.form, ownerEmail: e.target.value })}
                    placeholder="owner@example.com"
                    required
                  />
                </div>
              </div>
              <div className="form-field">
                <label>كلمة مرور المالك</label>
                <input
                  type="text"
                  value={props.form.ownerPassword}
                  onChange={(e) => props.setForm({ ...props.form, ownerPassword: e.target.value })}
                  placeholder="كلمة مرور قوية"
                  required
                />
                <span className="hint">سيستخدمها المالك لتسجيل الدخول إلى لوحة التاجر.</span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={props.onClose}>
              إلغاء
            </button>
            <button type="submit" className="btn btn-primary" disabled={props.submitting}>
              {props.submitting ? <span className="spinner" /> : <Check size={15} />}
              {props.submitting ? "جارٍ الإنشاء..." : "إنشاء المتجر"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================
   Reusable: KPI Card
   ============================================ */

function Kpi(props: {
  icon: ReactNode;
  color: "indigo" | "green" | "amber" | "sky";
  label: string;
  value: string;
  trend?: string;
}) {
  return (
    <article className="kpi">
      <div className={`kpi-icon ${props.color}`}>{props.icon}</div>
      <div className="kpi-label">{props.label}</div>
      <div className="kpi-value">{props.value}</div>
      {props.trend ? <div className="kpi-trend flat">{props.trend}</div> : null}
    </article>
  );
}

/* ============================================
   Reusable: Toast Stack
   ============================================ */

function ToastStack(props: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-stack">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : null}
          {toast.type === "error" ? <AlertCircle size={16} /> : null}
          {toast.type === "info" ? <Activity size={16} /> : null}
          <span>{toast.message}</span>
          <button type="button" onClick={() => props.onDismiss(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
