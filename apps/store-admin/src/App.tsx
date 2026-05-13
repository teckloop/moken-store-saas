import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  CreditCard,
  Download,
  Edit3,
  Globe,
  Layers,
  Link,
  LogOut,
  Package,
  Palette,
  PlugZap,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  AuditLogEntry,
  AuthUser,
  BulkProductAction,
  Category,
  CreateCategoryInput,
  CreateDiscountCodeInput,
  CreateProductInput,
  CreateShippingZoneInput,
  CreateStoreUserInput,
  Customer,
  DiscountCode,
  MokenIntegrationSettings,
  Order,
  OrderDetail,
  Product,
  ShippingZone,
  StoreDomain,
  StoreImageAsset,
  StoreNotification,
  StoreReportSummary,
  StoreSettings,
  StoreTheme,
  StoreUser,
  StoreUserRole,
  Tenant
} from "@moken-store/shared";
import type { AuditLogFilters, CustomerFilters, OrderFilters, ProductFilters } from "./api";
import {
  bulkUpdateProducts,
  createCategory,
  createDiscountCode,
  createDomain,
  createOrder,
  createProduct,
  createShippingZone,
  createStoreUser,
  deleteCategory,
  deleteDiscountCode,
  deleteImage,
  deleteProduct,
  deleteShippingZone,
  addOrderNote,
  clearStoreDomain,
  downloadOrdersCsv,
  getAuditLog,
  getCategories,
  getAuthToken,
  getCurrentUser,
  getCustomers,
  getDiscountCodes,
  getDomains,
  getImages,
  getMokenIntegration,
  getNotifications,
  getOrder,
  getOrders,
  getProducts,
  getReportSummary,
  getShippingZones,
  getStore,
  getStoreSettings,
  getStoreUsers,
  login,
  logout,
  markAllNotificationsRead,
  markNotificationRead,
  onSessionExpired,
  setStoreDomain,
  updateCategory,
  updateDiscountCode,
  updateDomainVerification,
  updateMokenIntegration,
  updateOrderStatus,
  updateOrderPayment,
  updateProduct,
  updateShippingZone,
  updateStoreSettings,
  updateStoreUser,
  updateTheme,
  uploadImage
} from "./api";

type StorePage = "overview" | "products" | "categories" | "orders" | "shipping" | "discounts" | "customers" | "reports" | "media" | "team" | "identity" | "settings" | "domains" | "integration" | "audit";

type ToastItem = { id: string; type: "success" | "error" | "info"; message: string };

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
};

function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div style={{ position: "fixed", bottom: 24, left: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      {toasts.map((toast) => (
        <div key={toast.id} style={{
          padding: "12px 16px",
          borderRadius: 8,
          background: toast.type === "error" ? "#dc2626" : toast.type === "success" ? "#16a34a" : "#0369a1",
          color: "#fff",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,.2)"
        }}>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => onDismiss(toast.id)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 2, fontSize: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({ dialog, onCancel }: { dialog: ConfirmDialogState; onCancel: () => void }) {
  if (!dialog.open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{dialog.title}</h3>
        <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14 }}>{dialog.message}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>إلغاء</button>
          <button
            onClick={() => { dialog.onConfirm(); onCancel(); }}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: dialog.danger ? "#dc2626" : "var(--brand, #111827)", color: "#fff", cursor: "pointer" }}
          >تأكيد</button>
        </div>
      </div>
    </div>
  );
}

type StoreState = {
  user?: AuthUser;
  tenant?: Tenant;
  categories: Category[];
  customers: Customer[];
  products: Product[];
  storeUsers: StoreUser[];
  shippingZones: ShippingZone[];
  discountCodes: DiscountCode[];
  notifications: StoreNotification[];
  notificationUnreadCount: number;
  orders: Order[];
  report?: StoreReportSummary;
  selectedOrder?: OrderDetail;
  domains: StoreDomain[];
  images: StoreImageAsset[];
  settings?: StoreSettings;
  integration?: MokenIntegrationSettings & { updatedAt: string };
  error?: string;
  notice?: string;
};

const defaultProductImage =
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80";

const formatPrice = (price: number, currency = "LYD") => {
  return new Intl.NumberFormat("ar-LY", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(price / 100);
};

const companyAdminUrl = import.meta.env.VITE_COMPANY_URL || "https://company.moken-saas.online";

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function readSessionExpiredFlag() {
  try {
    if (sessionStorage.getItem("moken.sessionExpired") === "1") {
      sessionStorage.removeItem("moken.sessionExpired");
      return "انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى.";
    }
  } catch {}
  return undefined;
}

export function App() {
  const [state, setState] = useState<StoreState>({ categories: [], customers: [], products: [], storeUsers: [], shippingZones: [], discountCodes: [], notifications: [], notificationUnreadCount: 0, orders: [], domains: [], images: [], error: readSessionExpiredFlag() });
  const [storePage, setStorePage] = useState<StorePage>("overview");
  const [showNotifications, setShowNotifications] = useState(false);
  const [orderFilters, setOrderFilters] = useState<OrderFilters>({ q: "", status: "", paymentStatus: "", dateFrom: "", dateTo: "" });
  const [customerFilters, setCustomerFilters] = useState<CustomerFilters>({ q: "", minOrders: 0 });
  const [productFilters, setProductFilters] = useState<ProductFilters>({ q: "", page: 1, limit: 50 });
  const [productsTotalPages, setProductsTotalPages] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, title: "", message: "", onConfirm: () => {} });
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditFilters, setAuditFilters] = useState<AuditLogFilters>({ page: 1, limit: 50 });
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const showToast = (type: ToastItem["type"], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = setTimeout(() => dismissToast(id), 4000);
    toastTimers.current.set(id, timer);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id); }
  };

  const confirmAction = (title: string, message: string, onConfirm: () => void, danger = true) => {
    setConfirmDialog({ open: true, title, message, danger, onConfirm });
  };
  const [loginForm, setLoginForm] = useState({ email: "merchant@moken-saas.online", password: "Store@2026" });
  const [productForm, setProductForm] = useState<CreateProductInput>({
    name: "New Product",
    slug: "new-product",
    categoryId: "",
    shortDescription: "وصف قصير يظهر في بطاقة المنتج.",
    description: "وصف تفصيلي للمنتج مناسب لكل أنواع المتاجر، يشرح القيمة والاستخدام وخيارات التخصيص.",
    price: 9900,
    currency: "LYD",
    inventory: 10,
    imageUrl: defaultProductImage,
    images: [defaultProductImage],
    specs: [
      { name: "الخامة", value: "قابل للتخصيص" },
      { name: "الاستخدام", value: "بيع مباشر" }
    ],
    variants: [
      { optionName: "الحجم", optionValue: "عادي", sku: "DEFAULT", priceDelta: 0, inventory: 10, isActive: true }
    ]
  });
  const [categoryForm, setCategoryForm] = useState<CreateCategoryInput>({
    name: "تصنيف جديد",
    slug: "new-category",
    parentId: "",
    description: "تصنيف قابل للاستخدام في أكثر من نوع متجر.",
    imageUrl: "",
    sortOrder: 10
  });
  const [domain, setDomain] = useState("shop.example.com");
  const [userForm, setUserForm] = useState<CreateStoreUserInput>({
    name: "موظف جديد",
    email: "staff@example.com",
    password: "Staff@2026",
    role: "orders_manager"
  });
  const [shippingForm, setShippingForm] = useState<CreateShippingZoneInput>({
    name: "منطقة شحن جديدة",
    city: "طرابلس",
    fee: 1000,
    estimatedDays: "24-48 ساعة",
    isActive: true
  });
  const [discountForm, setDiscountForm] = useState<CreateDiscountCodeInput>({
    code: "NEW10",
    name: "عرض جديد",
    type: "percentage",
    value: 10,
    minSubtotal: 0,
    maxRedemptions: 0,
    startsAt: "",
    endsAt: "",
    isActive: true
  });
  const [orderForm, setOrderForm] = useState({
    customerName: "عميل جديد",
    customerPhone: "0910000000",
    productId: "",
    quantity: 1
  });

  const loadDashboard = (user: AuthUser) => {
    Promise.all([
      getStore(),
      getCategories(),
      getCustomers(),
      getProducts(),
      getStoreSettings(),
      getStoreUsers(),
      getShippingZones(),
      getDiscountCodes(),
      getMokenIntegration(),
      getDomains(),
      getImages(),
      getNotifications(),
      getOrders(),
      getReportSummary()
    ])
      .then(([store, categories, customers, products, settings, storeUsers, shippingZones, discountCodes, integration, domains, images, notifications, orders, report]) => {
        setStoreDomain(store.tenant.primaryDomain);
        setProductsTotalPages(products.totalPages ?? 1);
        setState({
          user,
          tenant: store.tenant,
          categories: categories.categories,
          customers: customers.customers,
          products: products.products,
          storeUsers: storeUsers.users,
          shippingZones: shippingZones.zones,
          discountCodes: discountCodes.discounts,
          settings: settings.settings,
          integration: integration.settings,
          domains: domains.domains,
          images: images.images,
          notifications: notifications.notifications,
          notificationUnreadCount: notifications.unreadCount,
          orders: orders.orders,
          report: report.report
        });
      })
      .catch((error: unknown) => {
        setState({
          categories: [],
          customers: [],
          products: [],
          storeUsers: [],
          shippingZones: [],
          discountCodes: [],
          notifications: [],
          notificationUnreadCount: 0,
          domains: [],
          images: [],
          orders: [],
          error: error instanceof Error ? error.message : "Unexpected error"
        });
      });
  };

  useEffect(() => {
    onSessionExpired(() => {
      try { sessionStorage.setItem("moken.sessionExpired", "1"); } catch {}
      window.location.reload();
    });
    if (!getAuthToken()) return;
    getCurrentUser()
      .then((result) => {
        if (result.user.role === "platform_owner") {
          setState((current) => ({ ...current, error: "استخدم حساب متجر لإدارة التاجر." }));
          return;
        }
        loadDashboard(result.user);
      })
      .catch(() => {
      setState({ categories: [], customers: [], products: [], storeUsers: [], shippingZones: [], discountCodes: [], notifications: [], notificationUnreadCount: 0, domains: [], images: [], orders: [] });
      });
  }, []);

  const totalInventory = useMemo(
    () => state.products.reduce((sum, product) => sum + product.inventory, 0),
    [state.products]
  );
  const activeProducts = useMemo(() => state.products.filter((product) => product.isActive).length, [state.products]);
  const activeCategories = useMemo(
    () => state.categories.filter((category) => category.isActive).length,
    [state.categories]
  );
  const orderRevenue = useMemo(() => state.orders.reduce((sum, order) => sum + order.total, 0), [state.orders]);
  const selectedProduct = state.products.find((product) => product.id === orderForm.productId) ?? state.products[0];
  const expectedOrderTotal = selectedProduct ? selectedProduct.price * orderForm.quantity : 0;
  const theme = state.tenant?.theme;
  const unreadNotifications = state.notificationUnreadCount;

  const setError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "خطأ غير متوقع";
    showToast("error", message);
    setState((current) => ({ ...current, error: message }));
  };

  const setNotice = (notice: string) => {
    showToast("success", notice);
    setState((current) => ({ ...current, error: undefined, notice }));
  };

  const reloadOrders = (filters = orderFilters) => {
    getOrders(filters)
      .then((result) => {
        setState((current) => ({
          ...current,
          orders: result.orders,
          selectedOrder: result.orders.some((order) => order.id === current.selectedOrder?.id) ? current.selectedOrder : undefined,
          error: undefined
        }));
      })
      .catch(setError);
  };

  const reloadCustomers = (filters = customerFilters) => {
    getCustomers(filters)
      .then((result) => {
        setState((current) => ({
          ...current,
          customers: result.customers,
          error: undefined
        }));
      })
      .catch(setError);
  };

  const refreshNotifications = () => {
    getNotifications()
      .then((result) => {
        setState((current) => ({
          ...current,
          notifications: result.notifications,
          notificationUnreadCount: result.unreadCount
        }));
      })
      .catch(setError);
  };

  const openNotification = (notification: StoreNotification) => {
    markNotificationRead(notification.id)
      .catch(() => undefined)
      .finally(() => {
        setState((current) => ({
          ...current,
          notifications: current.notifications.map((item) =>
            item.id === notification.id ? { ...item, isRead: true } : item
          ),
          notificationUnreadCount: notification.isRead ? current.notificationUnreadCount : Math.max(current.notificationUnreadCount - 1, 0)
        }));
        setStorePage("orders");
        setShowNotifications(false);
        openOrder(notification.orderId);
      });
  };

  const readAllNotifications = () => {
    markAllNotificationsRead()
      .then(() => {
        setState((current) => ({
          ...current,
          notifications: current.notifications.map((notification) => ({ ...notification, isRead: true })),
          notificationUnreadCount: 0
        }));
      })
      .catch(setError);
  };

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    login(loginForm)
      .then((result) => {
        if (result.session.user.role === "platform_owner") {
          setState((current) => ({ ...current, error: "استخدم حساب متجر لإدارة التاجر." }));
          return;
        }
        loadDashboard(result.session.user);
      })
      .catch(setError);
  };

  const signOut = () => {
    logout().finally(() => {
      clearStoreDomain();
      setState({ categories: [], customers: [], products: [], storeUsers: [], shippingZones: [], discountCodes: [], notifications: [], notificationUnreadCount: 0, orders: [], domains: [], images: [], notice: "تم تسجيل الخروج" });
    });
  };

  const reloadProducts = (filters = productFilters) => {
    getProducts(filters)
      .then((result) => {
        setState((current) => ({ ...current, products: result.products }));
        setProductsTotalPages(result.totalPages ?? 1);
      })
      .catch(setError);
  };

  const submitProduct = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    createProduct(productForm)
      .then((result) => {
        setState((current) => ({
          ...current,
          products: [result.product, ...current.products],
          notice: `تمت إضافة ${result.product.name}`,
          error: undefined
        }));
      })
      .catch(setError)
      .finally(() => setSubmitting(false));
  };

  const removeProduct = (product: Product) => {
    confirmAction("حذف المنتج", `هل تريد حذف "${product.name}" نهائياً؟ لا يمكن التراجع عن هذا.`, () => {
      deleteProduct(product.id)
        .then(() => {
          setState((current) => ({ ...current, products: current.products.filter((p) => p.id !== product.id) }));
          setNotice("تم حذف المنتج");
        })
        .catch(setError);
    });
  };

  const executeBulkProducts = (action: BulkProductAction["action"], priceAdjustment?: BulkProductAction["priceAdjustment"]) => {
    if (selectedProductIds.size === 0) return;
    const ids = Array.from(selectedProductIds);
    bulkUpdateProducts({ ids, action, priceAdjustment })
      .then((result) => {
        setNotice(`تم تطبيق العملية على ${result.count} منتج`);
        setSelectedProductIds(new Set());
        reloadProducts();
      })
      .catch(setError);
  };

  const submitCategory = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    createCategory({
      ...categoryForm,
      parentId: categoryForm.parentId || undefined,
      sortOrder: Number(categoryForm.sortOrder ?? 0)
    })
      .then((result) => {
        setState((current) => ({
          ...current,
          categories: [...current.categories, result.category],
          notice: `تمت إضافة ${result.category.name}`,
          error: undefined
        }));
      })
      .catch(setError)
      .finally(() => setSubmitting(false));
  };

  const removeCategory = (category: Category) => {
    confirmAction("حذف التصنيف", `هل تريد حذف "${category.name}"؟ يجب أن يكون خالياً من المنتجات والتصنيفات الفرعية.`, () => {
      deleteCategory(category.id)
        .then(() => {
          setState((current) => ({ ...current, categories: current.categories.filter((c) => c.id !== category.id) }));
          setNotice("تم حذف التصنيف");
        })
        .catch(setError);
    });
  };

  const toggleCategoryActive = (category: Category) => {
    updateCategory(category.id, { isActive: !category.isActive })
      .then((result) => {
        setState((current) => ({
          ...current,
          categories: current.categories.map((item) => (item.id === category.id ? result.category : item)),
          notice: result.category.isActive ? "تم تفعيل التصنيف" : "تم تعطيل التصنيف",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const renameCategory = (category: Category, patch: Partial<Category>) => {
    updateCategory(category.id, {
      name: patch.name,
      slug: patch.slug,
      description: patch.description,
      imageUrl: patch.imageUrl,
      sortOrder: patch.sortOrder
    })
      .then((result) => {
        setState((current) => ({
          ...current,
          categories: current.categories.map((item) => (item.id === category.id ? result.category : item)),
          notice: "تم تحديث التصنيف",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const submitOrder = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProduct) return;

    createOrder({
      customerName: orderForm.customerName,
      customerPhone: orderForm.customerPhone,
      items: [{ productId: selectedProduct.id, quantity: orderForm.quantity }]
    })
      .then((result) => {
        const order: Order = {
          id: result.order.id,
          tenantId: state.tenant?.id ?? "",
          customerName: orderForm.customerName,
          customerPhone: orderForm.customerPhone,
          customerCity: "",
          customerAddress: "",
          notes: "",
          paymentMethod: "cash_on_delivery",
          paymentStatus: "pending",
          paidAmount: 0,
          paymentReference: "",
          shippingZoneId: "",
          shippingZoneName: "",
          shippingFee: 0,
          discountCodeId: "",
          discountCode: "",
          discountAmount: 0,
          status: result.order.status,
          total: result.order.total,
          itemCount: result.order.itemCount,
          createdAt: new Date().toISOString()
        };

        setState((current) => ({
          ...current,
          orders: [order, ...current.orders],
          products: current.products.map((product) =>
            product.id === selectedProduct.id
              ? { ...product, inventory: Math.max(0, product.inventory - orderForm.quantity) }
              : product
          ),
          notice: `تم إنشاء طلب ${order.id.slice(0, 6)}`,
          error: undefined
        }));
        refreshNotifications();
        return getCustomers();
      })
      .then((result) => {
        if (!result) return;
        setState((current) => ({
          ...current,
          customers: result.customers
        }));
      })
      .catch(setError);
  };

  const openOrder = (orderId: string) => {
    getOrder(orderId)
      .then((result) => {
        setState((current) => ({
          ...current,
          selectedOrder: result.order,
          error: undefined
        }));
      })
      .catch(setError);
  };

  const submitDomain = (event: FormEvent) => {
    event.preventDefault();
    createDomain({ domain })
      .then((result) => {
        setState((current) => ({
          ...current,
          domains: [result.domain, ...current.domains],
          notice: `تمت إضافة الدومين ${result.domain.domain}`,
          error: undefined
        }));
      })
      .catch(setError);
  };

  const changeOrderStatus = (orderId: string, status: Order["status"]) => {
    updateOrderStatus(orderId, status)
      .then(() => {
        setState((current) => ({
          ...current,
          orders: current.orders.map((order) => (order.id === orderId ? { ...order, status } : order)),
          selectedOrder: current.selectedOrder?.id === orderId ? { ...current.selectedOrder, status } : current.selectedOrder,
          notice: "تم تحديث حالة الطلب",
          error: undefined
        }));
        return getOrder(orderId);
      })
      .then((result) => {
        setState((current) => ({
          ...current,
          selectedOrder: result.order
        }));
        refreshNotifications();
      })
      .catch(setError);
  };

  const changeOrderPayment = (orderId: string, input: Pick<Order, "paymentStatus" | "paidAmount" | "paymentReference">) => {
    updateOrderPayment(orderId, input)
      .then(() => getOrder(orderId))
      .then((result) => {
        setState((current) => ({
          ...current,
          orders: current.orders.map((order) => (order.id === orderId ? { ...order, ...input } : order)),
          selectedOrder: result.order,
          notice: "تم تحديث بيانات الدفع",
          error: undefined
        }));
        refreshNotifications();
      })
      .catch(setError);
  };

  const addInternalOrderNote = (orderId: string, message: string) => {
    addOrderNote(orderId, message)
      .then(() => getOrder(orderId))
      .then((result) => {
        setState((current) => ({
          ...current,
          selectedOrder: result.order,
          notice: "تمت إضافة الملاحظة",
          error: undefined
        }));
        refreshNotifications();
      })
      .catch(setError);
  };

  const exportOrders = (filters = orderFilters) => {
    downloadOrdersCsv(filters)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setNotice("تم تجهيز ملف الطلبات");
      })
      .catch(setError);
  };

  const changeProductInventory = (product: Product, inventory: number) => {
    updateProduct(product.id, { inventory })
      .then((result) => {
        setState((current) => ({
          ...current,
          products: current.products.map((item) => (item.id === product.id ? result.product : item)),
          notice: "تم تحديث المخزون",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const toggleProductActive = (product: Product) => {
    updateProduct(product.id, { isActive: !product.isActive })
      .then((result) => {
        setState((current) => ({
          ...current,
          products: current.products.map((item) => (item.id === product.id ? result.product : item)),
          notice: result.product.isActive ? "تم تفعيل المنتج" : "تم تعطيل المنتج",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const saveProductDetails = (product: Product, input: CreateProductInput & { isActive?: boolean }) => {
    updateProduct(product.id, input)
      .then((result) => {
        setState((current) => ({
          ...current,
          products: current.products.map((item) => (item.id === product.id ? result.product : item)),
          notice: "تم حفظ المنتج",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const changeTheme = (patch: Partial<StoreTheme>) => {
    if (!state.tenant) return;
    const nextTheme = { ...state.tenant.theme, ...patch };
    setState((current) => ({
      ...current,
      tenant: current.tenant ? { ...current.tenant, theme: nextTheme } : current.tenant
    }));
    updateTheme(nextTheme).then(() => setNotice("تم تحديث هوية المتجر")).catch(setError);
  };

  const verifyDomain = (domainId: string, verificationStatus: StoreDomain["verificationStatus"]) => {
    updateDomainVerification(domainId, verificationStatus)
      .then(() => {
        setState((current) => ({
          ...current,
          domains: current.domains.map((item) => (item.id === domainId ? { ...item, verificationStatus } : item)),
          notice: "تم تحديث حالة الدومين",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const toggleIntegration = (key: keyof MokenIntegrationSettings, value: boolean | string) => {
    if (!state.integration) return;
    const next = { ...state.integration, [key]: value };
    setState((current) => ({ ...current, integration: next }));
    updateMokenIntegration(next).then(() => setNotice("تم حفظ إعدادات التكامل")).catch(setError);
  };

  const saveSettings = (settings: StoreSettings) => {
    setState((current) => ({ ...current, settings }));
    updateStoreSettings(settings).then(() => setNotice("تم حفظ إعدادات المتجر")).catch(setError);
  };

  const submitShippingZone = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    createShippingZone({
      ...shippingForm,
      fee: Number(shippingForm.fee)
    })
      .then((result) => {
        setState((current) => ({
          ...current,
          shippingZones: [...current.shippingZones, result.zone],
          notice: `تمت إضافة ${result.zone.name}`,
          error: undefined
        }));
      })
      .catch(setError)
      .finally(() => setSubmitting(false));
  };

  const removeShippingZone = (zone: ShippingZone) => {
    confirmAction("حذف منطقة الشحن", `هل تريد حذف منطقة "${zone.name}"؟`, () => {
      deleteShippingZone(zone.id)
        .then(() => {
          setState((current) => ({ ...current, shippingZones: current.shippingZones.filter((z) => z.id !== zone.id) }));
          setNotice("تم حذف منطقة الشحن");
        })
        .catch(setError);
    });
  };

  const changeShippingZone = (zone: ShippingZone, patch: Partial<ShippingZone>) => {
    updateShippingZone(zone.id, patch)
      .then((result) => {
        setState((current) => ({
          ...current,
          shippingZones: current.shippingZones.map((item) => (item.id === zone.id ? result.zone : item)),
          notice: "تم تحديث منطقة الشحن",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const submitDiscountCode = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    createDiscountCode({
      ...discountForm,
      code: discountForm.code.trim().toUpperCase(),
      value: Number(discountForm.value),
      minSubtotal: Number(discountForm.minSubtotal ?? 0),
      maxRedemptions: Number(discountForm.maxRedemptions ?? 0)
    })
      .then((result) => {
        setState((current) => ({
          ...current,
          discountCodes: [result.discount, ...current.discountCodes],
          notice: `تمت إضافة الكوبون ${result.discount.code}`,
          error: undefined
        }));
      })
      .catch(setError)
      .finally(() => setSubmitting(false));
  };

  const removeDiscountCode = (discount: DiscountCode) => {
    confirmAction("حذف الكوبون", `هل تريد حذف كوبون "${discount.code}"؟`, () => {
      deleteDiscountCode(discount.id)
        .then(() => {
          setState((current) => ({ ...current, discountCodes: current.discountCodes.filter((d) => d.id !== discount.id) }));
          setNotice("تم حذف الكوبون");
        })
        .catch(setError);
    });
  };

  const changeDiscountCode = (discount: DiscountCode, patch: Partial<DiscountCode>) => {
    updateDiscountCode(discount.id, patch)
      .then((result) => {
        setState((current) => ({
          ...current,
          discountCodes: current.discountCodes.map((item) => (item.id === discount.id ? result.discount : item)),
          notice: "تم تحديث الكوبون",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const uploadStoreImage = (file: File) => {
    return uploadImage(file)
      .then((result) => {
        const saved = Math.max(0, result.image.originalSize - result.image.compressedSize);
        setNotice(`تم ضغط الصورة وحفظ ${Math.round(saved / 1024)}KB`);
        setState((current) => ({ ...current, images: [result.image, ...current.images] }));
        return result.image.url;
      })
      .catch((error: unknown) => {
        setError(error);
        throw error;
      });
  };

  const removeImageAsset = (image: StoreImageAsset) => {
    confirmAction("حذف الصورة", "هل تريد حذف هذه الصورة؟ لا يمكن التراجع.", () => {
      deleteImage(image.id)
        .then(() => {
          setState((current) => ({
            ...current,
            images: current.images.filter((item) => item.id !== image.id),
            notice: "تم حذف الصورة المضغوطة",
            error: undefined
          }));
        })
        .catch(setError);
    });
  };

  const loadAuditLog = (filters = auditFilters) => {
    getAuditLog(filters)
      .then((result) => {
        setAuditEntries(result.entries);
        setAuditTotalPages(result.totalPages ?? 1);
      })
      .catch(setError);
  };

  const submitStoreUser = (event: FormEvent) => {
    event.preventDefault();
    createStoreUser(userForm)
      .then((result) => {
        setState((current) => ({
          ...current,
          storeUsers: [...current.storeUsers, result.user],
          notice: `تم إنشاء حساب ${result.user.name}`,
          error: undefined
        }));
      })
      .catch(setError);
  };

  const changeStoreUser = (user: StoreUser, patch: Partial<StoreUser> & { password?: string }) => {
    updateStoreUser(user.id, patch)
      .then((result) => {
        setState((current) => ({
          ...current,
          storeUsers: current.storeUsers.map((item) => (item.id === user.id ? { ...item, ...result.user } : item)),
          notice: "تم تحديث المستخدم",
          error: undefined
        }));
      })
      .catch(setError);
  };

  const pages: Array<{ key: StorePage; label: string; icon: ReactNode }> = [
    { key: "overview", label: "نظرة عامة", icon: <Settings size={17} /> },
    { key: "products", label: "المنتجات", icon: <Package size={17} /> },
    { key: "categories", label: "التصنيفات", icon: <Layers size={17} /> },
    { key: "orders", label: "الطلبات", icon: <Truck size={17} /> },
    { key: "shipping", label: "الشحن", icon: <Truck size={17} /> },
    { key: "discounts", label: "الخصومات", icon: <CreditCard size={17} /> },
    { key: "customers", label: "العملاء", icon: <UserRound size={17} /> },
    { key: "reports", label: "التقارير", icon: <BarChart3 size={17} /> },
    { key: "media", label: "الصور", icon: <ShoppingBag size={17} /> },
    { key: "team", label: "الفريق", icon: <UserRound size={17} /> },
    { key: "identity", label: "الهوية", icon: <Palette size={17} /> },
    { key: "settings", label: "الإعدادات", icon: <Settings size={17} /> },
    { key: "domains", label: "الدومينات", icon: <Globe size={17} /> },
    { key: "integration", label: "تكامل مكن", icon: <PlugZap size={17} /> },
    { key: "audit", label: "سجل التعديلات", icon: <ClipboardList size={17} /> }
  ];

  if (!state.user) {
    return (
      <main className="entry-shell">
        <section className="login-panel">
          <div className="brand-mark">
            <ShieldCheck size={24} />
            <span>Store Admin</span>
          </div>
          <p className="eyebrow">دخول إدارة المتجر</p>
          <h1>تسجيل دخول التاجر</h1>
          {state.error ? <div className="alert">{state.error}</div> : null}
          {state.notice ? <div className="notice">{state.notice}</div> : null}
          <form className="stack-form" onSubmit={submitLogin}>
            <input
              aria-label="Email"
              type="email"
              value={loginForm.email}
              onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
              placeholder="البريد الإلكتروني"
            />
            <input
              aria-label="Password"
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
              placeholder="كلمة المرور"
            />
            <button type="submit">دخول</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main
      className="app-shell store-shell"
      style={{
        "--brand": theme?.brandColor ?? "#111827",
        "--accent": theme?.accentColor ?? "#14b8a6"
      } as React.CSSProperties}
    >
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <ConfirmDialog dialog={confirmDialog} onCancel={() => setConfirmDialog((d) => ({ ...d, open: false }))} />
      <aside className="sidebar">
        <div className="brand-mark">
          <ShoppingBag size={22} />
          <span>Store Admin</span>
        </div>
        <nav className="nav-list" aria-label="Store pages">
          {pages.map((page) => (
            <button
              className={`nav-item ${storePage === page.key ? "active" : ""}`}
              key={page.key}
              onClick={() => setStorePage(page.key)}
            >
              {page.icon}
              {page.label}
            </button>
          ))}
        </nav>
        <a className="utility-link" href={companyAdminUrl}>
          فتح إدارة الشركة
        </a>
        <button className="utility-link" type="button" onClick={signOut}>
          <LogOut size={16} />
          خروج
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">إدارة المتجر</p>
            <h1>{state.tenant?.primaryDomain ?? "demo.localhost"}</h1>
          </div>
          <div className="topbar-actions">
            <div className="notification-shell">
              <button
                className="notification-button"
                type="button"
                onClick={() => {
                  setShowNotifications((value) => !value);
                  refreshNotifications();
                }}
                aria-label="Notifications"
              >
                <Bell size={18} />
                {unreadNotifications ? <span>{unreadNotifications}</span> : null}
              </button>
              {showNotifications ? (
                <section className="notification-popover">
                  <div className="notification-heading">
                    <strong>إشعارات الطلبات</strong>
                    <button type="button" onClick={readAllNotifications}>
                      <CheckCheck size={15} />
                      قراءة الكل
                    </button>
                  </div>
                  <div className="notification-list">
                    {state.notifications.map((notification) => (
                      <button
                        className={notification.isRead ? "" : "unread"}
                        type="button"
                        key={notification.id}
                        onClick={() => openNotification(notification)}
                      >
                        <strong>{notification.title}</strong>
                        <span>{notification.customerName} · #{notification.orderNumber}</span>
                        <em>{notification.message}</em>
                        <time>{new Date(notification.createdAt).toLocaleString("ar-LY")}</time>
                      </button>
                    ))}
                    {state.notifications.length === 0 ? (
                      <div className="notification-empty">لا توجد إشعارات بعد</div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
            <div className="search-box">
              <Search size={18} />
              <input aria-label="Search products or orders" placeholder="ابحث عن منتج أو طلب" />
            </div>
          </div>
        </header>

        {state.error ? <div className="alert">{state.error}</div> : null}
        {state.notice ? <div className="notice">{state.notice}</div> : null}

        {storePage === "overview" ? (
          <>
            <section className="stats-grid" aria-label="Store summary">
              <Stat label="منتجات نشطة" value={activeProducts} />
              <Stat label="تصنيفات" value={activeCategories} />
              <Stat label="المخزون" value={totalInventory} />
              <Stat label="الطلبات" value={state.orders.length} />
              <Stat label="المبيعات" value={formatPrice(orderRevenue)} />
              <Stat label="العملاء" value={state.customers.length} />
            </section>
            <section className="page-grid">
              <ProductsPanel
                compact
                categories={state.categories}
                changeProductInventory={changeProductInventory}
                productForm={productForm}
                products={state.products}
                saveProductDetails={saveProductDetails}
                setProductForm={setProductForm}
                submitProduct={submitProduct}
                toggleProductActive={toggleProductActive}
                uploadStoreImage={uploadStoreImage}
              />
              <OrdersPanel
                compact
                addInternalOrderNote={addInternalOrderNote}
                changeOrderStatus={changeOrderStatus}
                changeOrderPayment={changeOrderPayment}
                exportOrders={exportOrders}
                expectedOrderTotal={expectedOrderTotal}
                filters={orderFilters}
                openOrder={openOrder}
                orderForm={orderForm}
                orders={state.orders}
                products={state.products}
                selectedOrder={state.selectedOrder}
                selectedProduct={selectedProduct}
                setFilters={setOrderFilters}
                setOrderForm={setOrderForm}
                applyFilters={(filters) => {
                  setOrderFilters(filters);
                  reloadOrders(filters);
                }}
                submitOrder={submitOrder}
              />
            </section>
          </>
        ) : null}

        {storePage === "products" ? (
          <ProductsPanel
            categories={state.categories}
            changeProductInventory={changeProductInventory}
            executeBulkProducts={executeBulkProducts}
            productFilters={productFilters}
            productForm={productForm}
            products={state.products}
            productsTotalPages={productsTotalPages}
            removeProduct={removeProduct}
            reloadProducts={reloadProducts}
            saveProductDetails={saveProductDetails}
            selectedProductIds={selectedProductIds}
            setProductFilters={setProductFilters}
            setProductForm={setProductForm}
            setSelectedProductIds={setSelectedProductIds}
            submitting={submitting}
            submitProduct={submitProduct}
            toggleProductActive={toggleProductActive}
            uploadStoreImage={uploadStoreImage}
          />
        ) : null}

        {storePage === "categories" ? (
          <CategoriesPanel
            categories={state.categories}
            categoryForm={categoryForm}
            removeCategory={removeCategory}
            renameCategory={renameCategory}
            setCategoryForm={setCategoryForm}
            submitting={submitting}
            submitCategory={submitCategory}
            toggleCategoryActive={toggleCategoryActive}
            uploadStoreImage={uploadStoreImage}
          />
        ) : null}

        {storePage === "orders" ? (
          <OrdersPanel
            addInternalOrderNote={addInternalOrderNote}
            changeOrderStatus={changeOrderStatus}
            changeOrderPayment={changeOrderPayment}
            exportOrders={exportOrders}
            expectedOrderTotal={expectedOrderTotal}
            filters={orderFilters}
            openOrder={openOrder}
            orderForm={orderForm}
            orders={state.orders}
            products={state.products}
            selectedOrder={state.selectedOrder}
            selectedProduct={selectedProduct}
            setFilters={setOrderFilters}
            setOrderForm={setOrderForm}
            applyFilters={(filters) => {
              setOrderFilters(filters);
              reloadOrders(filters);
            }}
            submitOrder={submitOrder}
          />
        ) : null}

        {storePage === "shipping" ? (
          <ShippingPanel
            changeShippingZone={changeShippingZone}
            currency={state.settings?.currency ?? "LYD"}
            removeShippingZone={removeShippingZone}
            setShippingForm={setShippingForm}
            shippingForm={shippingForm}
            submitting={submitting}
            submitShippingZone={submitShippingZone}
            zones={state.shippingZones}
          />
        ) : null}

        {storePage === "discounts" ? (
          <DiscountsPanel
            changeDiscountCode={changeDiscountCode}
            currency={state.settings?.currency ?? "LYD"}
            discountForm={discountForm}
            discounts={state.discountCodes}
            removeDiscountCode={removeDiscountCode}
            setDiscountForm={setDiscountForm}
            submitting={submitting}
            submitDiscountCode={submitDiscountCode}
          />
        ) : null}

        {storePage === "customers" ? (
          <CustomersPanel
            customers={state.customers}
            filters={customerFilters}
            setFilters={setCustomerFilters}
            applyFilters={(filters) => {
              setCustomerFilters(filters);
              reloadCustomers(filters);
            }}
          />
        ) : null}

        {storePage === "reports" ? <ReportsPanel report={state.report} /> : null}

        {storePage === "media" ? (
          <MediaPanel images={state.images} removeImageAsset={removeImageAsset} uploadStoreImage={uploadStoreImage} />
        ) : null}

        {storePage === "team" ? (
          <TeamPanel
            currentUser={state.user}
            submitStoreUser={submitStoreUser}
            userForm={userForm}
            users={state.storeUsers}
            changeStoreUser={changeStoreUser}
            setUserForm={setUserForm}
          />
        ) : null}

        {storePage === "identity" ? <IdentityPanel changeTheme={changeTheme} theme={theme} /> : null}
        {storePage === "settings" ? (
          <SettingsPanel
            settings={state.settings}
            storeName={state.tenant?.name ?? "Store"}
            saveSettings={saveSettings}
          />
        ) : null}
        {storePage === "domains" ? (
          <DomainsPanel
            domain={domain}
            domains={state.domains}
            setDomain={setDomain}
            submitDomain={submitDomain}
            verifyDomain={verifyDomain}
          />
        ) : null}
        {storePage === "integration" ? (
          <IntegrationPanel integration={state.integration} toggleIntegration={toggleIntegration} />
        ) : null}
        {storePage === "audit" ? (
          <AuditLogPanel
            entries={auditEntries}
            filters={auditFilters}
            totalPages={auditTotalPages}
            onLoad={loadAuditLog}
            onFilterChange={(f) => { setAuditFilters(f); loadAuditLog(f); }}
          />
        ) : null}
      </section>
    </main>
  );
}

function AuditLogPanel(props: {
  entries: AuditLogEntry[];
  filters: AuditLogFilters;
  totalPages: number;
  onLoad: () => void;
  onFilterChange: (filters: AuditLogFilters) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const { entries, filters, totalPages, onLoad, onFilterChange } = props;

  useEffect(() => {
    if (!loaded) { onLoad(); setLoaded(true); }
  }, [loaded]);

  const entityLabels: Record<string, string> = {
    product: "منتج", category: "تصنيف", order: "طلب",
    discount_code: "كوبون", shipping_zone: "منطقة شحن"
  };
  const actionLabels: Record<string, string> = {
    create: "إنشاء", update: "تعديل", delete: "حذف", bulk_update: "تعديل جماعي"
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>سجل التعديلات</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={filters.entity ?? ""} onChange={(e) => onFilterChange({ ...filters, entity: e.target.value || undefined, page: 1 })} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db" }}>
            <option value="">كل الكيانات</option>
            {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={onLoad} style={{ padding: "6px 14px", borderRadius: 6, background: "var(--brand)", color: "#fff", border: "none", cursor: "pointer" }}>تحديث</button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p style={{ textAlign: "center", color: "#9ca3af", padding: 32 }}>لا توجد سجلات بعد.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>التاريخ</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>الإجراء</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>الكيان</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>المستخدم</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px 12px", color: "#6b7280", whiteSpace: "nowrap" }}>{new Date(entry.createdAt).toLocaleString("ar-LY")}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, background: entry.action === "delete" ? "#fee2e2" : entry.action === "create" ? "#dcfce7" : "#e0f2fe", color: entry.action === "delete" ? "#dc2626" : entry.action === "create" ? "#16a34a" : "#0369a1" }}>
                    {actionLabels[entry.action] ?? entry.action}
                  </span>
                </td>
                <td style={{ padding: "8px 12px" }}>{entityLabels[entry.entity] ?? entry.entity} <span style={{ color: "#9ca3af", fontSize: 11 }}>#{entry.entityId.slice(0, 8)}</span></td>
                <td style={{ padding: "8px 12px", color: "#374151" }}>{entry.userName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 4, justifyContent: "center", padding: 16 }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button key={p} onClick={() => onFilterChange({ ...filters, page: p })} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: (filters.page ?? 1) === p ? "var(--brand)" : "#fff", color: (filters.page ?? 1) === p ? "#fff" : "#374151", cursor: "pointer" }}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductsPanel(props: {
  categories: Category[];
  compact?: boolean;
  changeProductInventory: (product: Product, inventory: number) => void;
  executeBulkProducts?: (action: BulkProductAction["action"], priceAdjustment?: BulkProductAction["priceAdjustment"]) => void;
  productFilters?: ProductFilters;
  productForm: CreateProductInput;
  products: Product[];
  productsTotalPages?: number;
  removeProduct?: (product: Product) => void;
  reloadProducts?: (filters?: ProductFilters) => void;
  saveProductDetails: (product: Product, input: CreateProductInput & { isActive?: boolean }) => void;
  selectedProductIds?: Set<string>;
  setProductFilters?: (f: ProductFilters) => void;
  setProductForm: (value: CreateProductInput) => void;
  setSelectedProductIds?: (s: Set<string>) => void;
  submitting?: boolean;
  submitProduct: (event: FormEvent) => void;
  toggleProductActive: (product: Product) => void;
  uploadStoreImage: (file: File) => Promise<string>;
}) {
  const [editingProduct, setEditingProduct] = useState<Product | undefined>();
  const [editForm, setEditForm] = useState<CreateProductInput & { isActive?: boolean } | undefined>();
  const [bulkPriceType, setBulkPriceType] = useState<"percent" | "fixed">("percent");
  const [bulkPriceValue, setBulkPriceValue] = useState(10);
  const mainCategories = props.categories.filter((category) => !category.parentId && category.isActive);
  const childCategories = props.categories.filter((category) => category.parentId && category.isActive);
  const selectedIds = props.selectedProductIds ?? new Set<string>();
  const setSelectedIds = props.setSelectedProductIds ?? (() => undefined);
  const categoryName = (categoryId: string) =>
    props.categories.find((category) => category.id === categoryId)?.name ?? "بدون تصنيف";
  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      categoryId: product.categoryId,
      name: product.name,
      slug: product.slug,
      shortDescription: product.shortDescription,
      description: product.description,
      price: product.price,
      currency: product.currency,
      inventory: product.inventory,
      imageUrl: product.imageUrl,
      images: product.images,
      specs: product.specs,
      variants: product.variants,
      isActive: product.isActive
    });
  };
  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingProduct || !editForm) return;
    props.saveProductDetails(editingProduct, editForm);
    setEditingProduct(undefined);
    setEditForm(undefined);
  };

  return (
    <Panel eyebrow="إدارة المتجر" title="المنتجات والمخزون" icon={<Package size={20} />} wide>
      {!props.compact && props.productFilters !== undefined && props.setProductFilters && props.reloadProducts ? (
        <form className="filter-toolbar" onSubmit={(e) => { e.preventDefault(); props.reloadProducts!(props.productFilters); }} style={{ marginBottom: 12 }}>
          <input
            aria-label="Product search"
            value={props.productFilters.q ?? ""}
            onChange={(e) => props.setProductFilters!({ ...props.productFilters!, q: e.target.value })}
            placeholder="ابحث في المنتجات..."
          />
          <button type="submit"><Search size={16} />بحث</button>
          {props.productFilters.q ? (
            <button type="button" onClick={() => {
              const f = { ...props.productFilters!, q: "", page: 1 };
              props.setProductFilters!(f);
              props.reloadProducts!(f);
            }}>مسح</button>
          ) : null}
        </form>
      ) : null}
      {!props.compact && selectedIds.size > 0 && props.executeBulkProducts ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "#374151" }}>{selectedIds.size} منتج محدد</span>
          <button type="button" onClick={() => props.executeBulkProducts!("activate")} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#dcfce7", color: "#15803d", cursor: "pointer", fontSize: 13 }}>تفعيل</button>
          <button type="button" onClick={() => props.executeBulkProducts!("deactivate")} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fef9c3", color: "#854d0e", cursor: "pointer", fontSize: 13 }}>تعطيل</button>
          <button type="button" onClick={() => props.executeBulkProducts!("delete")} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #fecaca", background: "#fee2e2", color: "#dc2626", cursor: "pointer", fontSize: 13 }}>حذف</button>
          <input type="number" min={1} value={bulkPriceValue} onChange={(e) => setBulkPriceValue(Number(e.target.value))} style={{ width: 70, padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }} />
          <select value={bulkPriceType} onChange={(e) => setBulkPriceType(e.target.value as "percent" | "fixed")} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}>
            <option value="percent">% تعديل سعر</option>
            <option value="fixed">ثابت (قروش)</option>
          </select>
          <button type="button" onClick={() => props.executeBulkProducts!(undefined, { type: bulkPriceType, value: bulkPriceValue })} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#e0f2fe", color: "#0369a1", cursor: "pointer", fontSize: 13 }}>تطبيق تعديل السعر</button>
          <button type="button" onClick={() => setSelectedIds(new Set())} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>إلغاء التحديد</button>
        </div>
      ) : null}
      <form className="product-editor" onSubmit={props.submitProduct}>
        <input
          aria-label="Product name"
          value={props.productForm.name}
          onChange={(event) => props.setProductForm({ ...props.productForm, name: event.target.value })}
          placeholder="اسم المنتج"
        />
        <input
          aria-label="Product slug"
          value={props.productForm.slug}
          onChange={(event) => props.setProductForm({ ...props.productForm, slug: event.target.value })}
          placeholder="product-slug"
        />
        <select
          aria-label="Product category"
          value={props.productForm.categoryId ?? ""}
          onChange={(event) => props.setProductForm({ ...props.productForm, categoryId: event.target.value })}
        >
          <option value="">بدون تصنيف</option>
          {mainCategories.map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
          {childCategories.map((category) => (
            <option value={category.id} key={category.id}>
              {categoryName(category.parentId ?? "")} / {category.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Product price"
          type="number"
          value={props.productForm.price}
          onChange={(event) => props.setProductForm({ ...props.productForm, price: Number(event.target.value) })}
          placeholder="السعر بالقروش"
        />
        <input
          aria-label="Product inventory"
          type="number"
          min={0}
          value={props.productForm.inventory}
          onChange={(event) => props.setProductForm({ ...props.productForm, inventory: Number(event.target.value) })}
          placeholder="المخزون"
        />
        <input
          aria-label="Product main image"
          value={props.productForm.imageUrl}
          onChange={(event) => props.setProductForm({ ...props.productForm, imageUrl: event.target.value })}
          placeholder="رابط الصورة الرئيسية"
        />
        <ImageUploadButton
          label="رفع صورة رئيسية"
          onUploaded={(url) => props.setProductForm({
            ...props.productForm,
            imageUrl: url,
            images: Array.from(new Set([url, ...(props.productForm.images ?? [])]))
          })}
          uploadStoreImage={props.uploadStoreImage}
        />
        <textarea
          aria-label="Product short description"
          value={props.productForm.shortDescription ?? ""}
          onChange={(event) => props.setProductForm({ ...props.productForm, shortDescription: event.target.value })}
          placeholder="وصف قصير"
        />
        <textarea
          aria-label="Product description"
          value={props.productForm.description}
          onChange={(event) => props.setProductForm({ ...props.productForm, description: event.target.value })}
          placeholder="وصف المنتج"
        />
        <textarea
          aria-label="Product images"
          value={(props.productForm.images ?? []).join("\n")}
          onChange={(event) =>
            props.setProductForm({
              ...props.productForm,
              images: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean)
            })
          }
          placeholder="صور إضافية، رابط في كل سطر"
        />
        <ImageUploadButton
          label="رفع صورة إضافية"
          onUploaded={(url) => props.setProductForm({
            ...props.productForm,
            images: [...(props.productForm.images ?? []), url]
          })}
          uploadStoreImage={props.uploadStoreImage}
        />
        <textarea
          aria-label="Product specs"
          value={(props.productForm.specs ?? []).map((spec) => `${spec.name}: ${spec.value}`).join("\n")}
          onChange={(event) =>
            props.setProductForm({
              ...props.productForm,
              specs: event.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                  const [name, ...value] = line.split(":");
                  return { name: name.trim(), value: value.join(":").trim() || "-" };
                })
            })
          }
          placeholder="المواصفات: اسم: قيمة"
        />
        <textarea
          aria-label="Product variants"
          value={(props.productForm.variants ?? []).map(variantToLine).join("\n")}
          onChange={(event) =>
            props.setProductForm({
              ...props.productForm,
              variants: parseVariantLines(event.target.value)
            })
          }
          placeholder="الخيارات: الاسم | القيمة | SKU | فرق السعر | المخزون"
        />
        <button type="submit" disabled={props.submitting}>
          <Plus size={16} />
          {props.submitting ? "جارٍ الحفظ..." : "إضافة"}
        </button>
      </form>

      <div className={props.compact ? "product-list" : "product-grid"}>
        {props.products.slice(0, props.compact ? 4 : undefined).map((product) => (
          <article className={`product-card ${product.isActive ? "" : "muted-card"}`} key={product.id}>
            {!props.compact && props.setSelectedProductIds ? (
              <input
                type="checkbox"
                checked={selectedIds.has(product.id)}
                onChange={(e) => {
                  const next = new Set(selectedIds);
                  if (e.target.checked) next.add(product.id); else next.delete(product.id);
                  setSelectedIds(next);
                }}
                style={{ position: "absolute", top: 8, right: 8, width: 16, height: 16, cursor: "pointer" }}
              />
            ) : null}
            <img src={product.imageUrl || defaultProductImage} alt="" />
            <div>
              <h3>{product.name}</h3>
              <p>{product.shortDescription || product.description}</p>
              <div className="product-meta">
                <strong>{formatPrice(product.price, product.currency)}</strong>
                <span>{product.inventory} متوفر</span>
              </div>
              <span className="category-chip">{categoryName(product.categoryId)}</span>
              <div className="card-actions">
                <input
                  aria-label="Product inventory"
                  type="number"
                  min={0}
                  value={product.inventory}
                  onChange={(event) => props.changeProductInventory(product, Number(event.target.value))}
                />
                <button type="button" onClick={() => props.toggleProductActive(product)}>
                  {product.isActive ? "تعطيل" : "تفعيل"}
                </button>
                <button type="button" onClick={() => startEdit(product)}>
                  <Edit3 size={15} />
                  تعديل
                </button>
                {props.removeProduct ? (
                  <button type="button" onClick={() => props.removeProduct!(product)} style={{ color: "#dc2626" }}>
                    <X size={14} />
                    حذف
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!props.compact && (props.productsTotalPages ?? 1) > 1 && props.productFilters && props.setProductFilters && props.reloadProducts ? (
        <div style={{ display: "flex", gap: 4, justifyContent: "center", padding: "16px 0" }}>
          {Array.from({ length: props.productsTotalPages! }, (_, i) => i + 1).map((p) => (
            <button key={p} type="button" onClick={() => {
              const f = { ...props.productFilters!, page: p };
              props.setProductFilters!(f);
              props.reloadProducts!(f);
            }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: (props.productFilters!.page ?? 1) === p ? "var(--brand)" : "#fff", color: (props.productFilters!.page ?? 1) === p ? "#fff" : "#374151", cursor: "pointer" }}>{p}</button>
          ))}
        </div>
      ) : null}

      {editingProduct && editForm ? (
        <section className="product-edit-drawer" aria-label="Product editor">
          <form onSubmit={saveEdit}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">تحرير المنتج</p>
                <h2>{editingProduct.name}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingProduct(undefined)}>
                <X size={18} />
              </button>
            </div>

            <div className="product-edit-grid">
              <input
                aria-label="Edit product name"
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                placeholder="اسم المنتج"
              />
              <input
                aria-label="Edit product slug"
                value={editForm.slug}
                onChange={(event) => setEditForm({ ...editForm, slug: event.target.value })}
                placeholder="slug"
              />
              <select
                aria-label="Edit product category"
                value={editForm.categoryId ?? ""}
                onChange={(event) => setEditForm({ ...editForm, categoryId: event.target.value })}
              >
                <option value="">بدون تصنيف</option>
                {mainCategories.map((category) => (
                  <option value={category.id} key={category.id}>{category.name}</option>
                ))}
                {childCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {categoryName(category.parentId ?? "")} / {category.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Edit product price"
                type="number"
                value={editForm.price}
                onChange={(event) => setEditForm({ ...editForm, price: Number(event.target.value) })}
                placeholder="السعر"
              />
              <input
                aria-label="Edit product inventory"
                type="number"
                min={0}
                value={editForm.inventory}
                onChange={(event) => setEditForm({ ...editForm, inventory: Number(event.target.value) })}
                placeholder="المخزون"
              />
              <input
                aria-label="Edit product image"
                value={editForm.imageUrl}
                onChange={(event) => setEditForm({ ...editForm, imageUrl: event.target.value })}
                placeholder="الصورة الرئيسية"
              />
              <ImageUploadButton
                label="رفع صورة رئيسية"
                onUploaded={(url) => setEditForm({
                  ...editForm,
                  imageUrl: url,
                  images: Array.from(new Set([url, ...(editForm.images ?? [])]))
                })}
                uploadStoreImage={props.uploadStoreImage}
              />
              <textarea
                aria-label="Edit short description"
                value={editForm.shortDescription ?? ""}
                onChange={(event) => setEditForm({ ...editForm, shortDescription: event.target.value })}
                placeholder="وصف قصير"
              />
              <textarea
                aria-label="Edit description"
                value={editForm.description}
                onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
                placeholder="الوصف الكامل"
              />
              <textarea
                aria-label="Edit images"
                value={(editForm.images ?? []).join("\n")}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    images: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean)
                  })
                }
                placeholder="صور إضافية، رابط في كل سطر"
              />
              <ImageUploadButton
                label="رفع صورة إضافية"
                onUploaded={(url) => setEditForm({
                  ...editForm,
                  images: [...(editForm.images ?? []), url]
                })}
                uploadStoreImage={props.uploadStoreImage}
              />
              <textarea
                aria-label="Edit specs"
                value={(editForm.specs ?? []).map((spec) => `${spec.name}: ${spec.value}`).join("\n")}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    specs: event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => {
                        const [name, ...value] = line.split(":");
                        return { name: name.trim(), value: value.join(":").trim() || "-" };
                      })
                  })
                }
                placeholder="المواصفات: اسم: قيمة"
              />
              <textarea
                aria-label="Edit variants"
                value={(editForm.variants ?? []).map(variantToLine).join("\n")}
                onChange={(event) => setEditForm({ ...editForm, variants: parseVariantLines(event.target.value) })}
                placeholder="الخيارات: الاسم | القيمة | SKU | فرق السعر | المخزون"
              />
            </div>

            <div className="drawer-actions">
              <label className="toggle-row edit-toggle">
                <span>المنتج نشط</span>
                <input
                  type="checkbox"
                  checked={Boolean(editForm.isActive)}
                  onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
                />
              </label>
              <button type="button" onClick={() => setEditForm({ ...editForm, isActive: false })}>
                أرشفة
              </button>
              <button type="submit">
                <Save size={16} />
                حفظ التعديلات
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </Panel>
  );
}

function variantToLine(variant: NonNullable<CreateProductInput["variants"]>[number]) {
  return [
    variant.optionName,
    variant.optionValue,
    variant.sku ?? "",
    variant.priceDelta ?? 0,
    variant.inventory ?? 0,
    variant.isActive === false ? "inactive" : "active"
  ].join(" | ");
}

function parseVariantLines(value: string): NonNullable<CreateProductInput["variants"]> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [optionName = "", optionValue = "", sku = "", priceDelta = "0", inventory = "0", state = "active"] =
        line.split("|").map((part) => part.trim());
      return {
        optionName,
        optionValue,
        sku,
        priceDelta: Number(priceDelta) || 0,
        inventory: Math.max(0, Number(inventory) || 0),
        isActive: state !== "inactive"
      };
    });
}

function CategoriesPanel(props: {
  categories: Category[];
  categoryForm: CreateCategoryInput;
  removeCategory?: (category: Category) => void;
  renameCategory: (category: Category, patch: Partial<Category>) => void;
  setCategoryForm: (value: CreateCategoryInput) => void;
  submitting?: boolean;
  submitCategory: (event: FormEvent) => void;
  toggleCategoryActive: (category: Category) => void;
  uploadStoreImage: (file: File) => Promise<string>;
}) {
  const mainCategories = props.categories.filter((category) => !category.parentId);
  const childCategories = (parentId: string) => props.categories.filter((category) => category.parentId === parentId);

  return (
    <Panel eyebrow="هيكلة الكتالوج" title="التصنيفات والتصنيفات الفرعية" icon={<Layers size={20} />} wide>
      <form className="category-editor" onSubmit={props.submitCategory}>
        <input
          aria-label="Category name"
          value={props.categoryForm.name}
          onChange={(event) => props.setCategoryForm({ ...props.categoryForm, name: event.target.value })}
          placeholder="اسم التصنيف"
        />
        <input
          aria-label="Category slug"
          value={props.categoryForm.slug}
          onChange={(event) => props.setCategoryForm({ ...props.categoryForm, slug: event.target.value })}
          placeholder="category-slug"
        />
        <select
          aria-label="Parent category"
          value={props.categoryForm.parentId ?? ""}
          onChange={(event) => props.setCategoryForm({ ...props.categoryForm, parentId: event.target.value })}
        >
          <option value="">تصنيف رئيسي</option>
          {mainCategories.map((category) => (
            <option value={category.id} key={category.id}>
              فرعي داخل {category.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Category image"
          value={props.categoryForm.imageUrl ?? ""}
          onChange={(event) => props.setCategoryForm({ ...props.categoryForm, imageUrl: event.target.value })}
          placeholder="رابط صورة التصنيف"
        />
        <ImageUploadButton
          label="رفع صورة التصنيف"
          onUploaded={(url) => props.setCategoryForm({ ...props.categoryForm, imageUrl: url })}
          uploadStoreImage={props.uploadStoreImage}
        />
        <input
          aria-label="Category sort order"
          type="number"
          min={0}
          value={props.categoryForm.sortOrder ?? 0}
          onChange={(event) => props.setCategoryForm({ ...props.categoryForm, sortOrder: Number(event.target.value) })}
          placeholder="الترتيب"
        />
        <textarea
          aria-label="Category description"
          value={props.categoryForm.description ?? ""}
          onChange={(event) => props.setCategoryForm({ ...props.categoryForm, description: event.target.value })}
          placeholder="وصف التصنيف"
        />
        <button type="submit" disabled={props.submitting}>
          <Plus size={16} />
          {props.submitting ? "جارٍ الحفظ..." : "إضافة تصنيف"}
        </button>
      </form>

      <div className="category-tree">
        {mainCategories.map((category) => (
          <article className={`category-node ${category.isActive ? "" : "muted-card"}`} key={category.id}>
            <div className="category-node-main">
              <img src={category.imageUrl || defaultProductImage} alt="" />
              <div>
                <input
                  aria-label="Category name"
                  defaultValue={category.name}
                  onBlur={(event) => {
                    if (event.target.value !== category.name) props.renameCategory(category, { name: event.target.value });
                  }}
                />
                <input
                  aria-label="Category slug"
                  defaultValue={category.slug}
                  onBlur={(event) => {
                    if (event.target.value !== category.slug) props.renameCategory(category, { slug: event.target.value });
                  }}
                />
                <span>{category.description || "لا يوجد وصف"}</span>
              </div>
              <button type="button" onClick={() => props.toggleCategoryActive(category)}>
                {category.isActive ? "تعطيل" : "تفعيل"}
              </button>
              {props.removeCategory ? (
                <button type="button" onClick={() => props.removeCategory!(category)} style={{ color: "#dc2626" }}>
                  <X size={14} />حذف
                </button>
              ) : null}
            </div>
            <div className="subcategory-list">
              {childCategories(category.id).map((child) => (
                <div className={`subcategory-row ${child.isActive ? "" : "muted-card"}`} key={child.id}>
                  <span>{child.name}</span>
                  <b>{child.slug}</b>
                  <button type="button" onClick={() => props.toggleCategoryActive(child)}>
                    {child.isActive ? "تعطيل" : "تفعيل"}
                  </button>
                  {props.removeCategory ? (
                    <button type="button" onClick={() => props.removeCategory!(child)} style={{ color: "#dc2626" }}>
                      <X size={14} />حذف
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function CustomersPanel(props: {
  applyFilters: (filters: CustomerFilters) => void;
  customers: Customer[];
  filters: CustomerFilters;
  setFilters: (filters: CustomerFilters) => void;
}) {
  const totalRevenue = props.customers.reduce((sum, customer) => sum + customer.totalSpent, 0);
  const repeatCustomers = props.customers.filter((customer) => customer.orderCount > 1).length;

  return (
    <Panel eyebrow="علاقات العملاء" title="العملاء حسب رقم الهاتف" icon={<UserRound size={20} />} wide>
      <form
        className="filter-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          props.applyFilters(props.filters);
        }}
      >
        <input
          aria-label="Customer search"
          value={props.filters.q ?? ""}
          onChange={(event) => props.setFilters({ ...props.filters, q: event.target.value })}
          placeholder="ابحث باسم، رقم، مدينة، عنوان"
        />
        <select
          aria-label="Minimum customer orders"
          value={props.filters.minOrders ?? 0}
          onChange={(event) => props.setFilters({ ...props.filters, minOrders: Number(event.target.value) })}
        >
          <option value={0}>كل العملاء</option>
          <option value={1}>لديهم طلب واحد فأكثر</option>
          <option value={2}>عملاء متكررون</option>
        </select>
        <button type="submit">
          <Search size={16} />
          تطبيق
        </button>
        <button
          type="button"
          onClick={() => {
            const next = { q: "", minOrders: 0 };
            props.setFilters(next);
            props.applyFilters(next);
          }}
        >
          مسح
        </button>
      </form>
      <section className="detail-metrics customer-metrics">
        <div>
          <UserRound size={18} />
          <span>إجمالي العملاء</span>
          <strong>{props.customers.length}</strong>
        </div>
        <div>
          <Truck size={18} />
          <span>عملاء متكررون</span>
          <strong>{repeatCustomers}</strong>
        </div>
        <div>
          <CreditCard size={18} />
          <span>إجمالي مشترياتهم</span>
          <strong>{formatPrice(totalRevenue)}</strong>
        </div>
      </section>

      <div className="customer-list">
        {props.customers.map((customer) => (
          <article className="customer-card" key={customer.id}>
            <div>
              <strong>{customer.name}</strong>
              <span>{customer.phone}</span>
            </div>
            <div className="customer-card-body">
              <span>{customer.city || "مدينة غير محددة"}</span>
              <span>{customer.address || "لا يوجد عنوان محفوظ"}</span>
              {customer.notes ? <span>{customer.notes}</span> : null}
            </div>
            <div className="customer-card-stats">
              <b>{customer.orderCount} طلب</b>
              <b>{formatPrice(customer.totalSpent)}</b>
              <time>{customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString("ar-LY") : "لا يوجد تاريخ"}</time>
            </div>
          </article>
        ))}
        {props.customers.length === 0 ? (
          <div className="order-detail-empty">
            <UserRound size={28} />
            <strong>لا يوجد عملاء بعد</strong>
            <span>أول طلب سيبني سجل العميل تلقائيًا من رقم الهاتف.</span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ReportsPanel(props: { report?: StoreReportSummary }) {
  const report = props.report;

  if (!report) {
    return (
      <Panel eyebrow="التقارير" title="ملخص الأداء" icon={<BarChart3 size={20} />} wide>
        <div className="order-detail-empty">
          <BarChart3 size={28} />
          <strong>جاري تجهيز التقارير</strong>
          <span>ستظهر الأرقام بعد تحميل بيانات المتجر.</span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel eyebrow="قراءة تشغيلية" title="تقارير المتجر" icon={<BarChart3 size={20} />} wide>
      <section className="report-kpi-grid">
        <Stat label="مبيعات اليوم" value={formatPrice(report.revenue.today)} />
        <Stat label="مبيعات 7 أيام" value={formatPrice(report.revenue.week)} />
        <Stat label="مبيعات 30 يوم" value={formatPrice(report.revenue.month)} />
        <Stat label="متوسط الطلب" value={formatPrice(report.averageOrderValue)} />
      </section>

      <section className="report-grid">
        <div className="report-block">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">حالات الطلبات</p>
              <h3>{report.orders.allTime} طلب</h3>
            </div>
            <ClipboardList size={19} />
          </div>
          <div className="report-bars">
            {report.statusCounts.map((item) => (
              <article key={item.status}>
                <div>
                  <strong>{orderStatusLabels[item.status]}</strong>
                  <span>{item.count} طلب · {formatPrice(item.total)}</span>
                </div>
                <i style={{ width: `${Math.max(8, (item.count / Math.max(1, report.orders.allTime)) * 100)}%` }} />
              </article>
            ))}
          </div>
        </div>

        <div className="report-block">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">أفضل المنتجات</p>
              <h3>حسب الكمية</h3>
            </div>
            <Package size={19} />
          </div>
          <div className="ranked-list">
            {report.topProducts.map((product, index) => (
              <article key={product.productId}>
                <b>{index + 1}</b>
                <div>
                  <strong>{product.productName}</strong>
                  <span>{product.quantity} قطعة · {formatPrice(product.total)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="report-block">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">أفضل العملاء</p>
              <h3>حسب المشتريات</h3>
            </div>
            <UserRound size={19} />
          </div>
          <div className="ranked-list">
            {report.topCustomers.map((customer, index) => (
              <article key={customer.customerId}>
                <b>{index + 1}</b>
                <div>
                  <strong>{customer.name}</strong>
                  <span>{customer.phone} · {customer.orderCount} طلب · {formatPrice(customer.totalSpent)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </Panel>
  );
}

function MediaPanel(props: {
  images: StoreImageAsset[];
  removeImageAsset: (image: StoreImageAsset) => void;
  uploadStoreImage: (file: File) => Promise<string>;
}) {
  const totalOriginal = props.images.reduce((sum, image) => sum + image.originalSize, 0);
  const totalCompressed = props.images.reduce((sum, image) => sum + image.compressedSize, 0);
  const saved = Math.max(0, totalOriginal - totalCompressed);

  return (
    <Panel eyebrow="إدارة الملفات" title="مكتبة الصور المضغوطة" icon={<ShoppingBag size={20} />} wide>
      <section className="detail-metrics media-metrics">
        <div>
          <ShoppingBag size={18} />
          <span>عدد الصور</span>
          <strong>{props.images.length}</strong>
        </div>
        <div>
          <Package size={18} />
          <span>الحجم المضغوط</span>
          <strong>{formatBytes(totalCompressed)}</strong>
        </div>
        <div>
          <CreditCard size={18} />
          <span>توفير مساحة</span>
          <strong>{formatBytes(saved)}</strong>
        </div>
      </section>

      <div className="media-toolbar">
        <ImageUploadButton
          label="رفع صورة جديدة"
          onUploaded={() => undefined}
          uploadStoreImage={props.uploadStoreImage}
        />
      </div>

      <div className="media-grid">
        {props.images.map((image) => (
          <article className="media-card" key={image.id}>
            <img src={image.url} alt="" />
            <div>
              <strong>{image.width} × {image.height}</strong>
              <span>{formatBytes(image.originalSize)} → {formatBytes(image.compressedSize)}</span>
              <span>{new Date(image.createdAt).toLocaleString("ar-LY")}</span>
            </div>
            <div className="media-actions">
              <button type="button" onClick={() => navigator.clipboard?.writeText(image.url)}>
                نسخ الرابط
              </button>
              <button type="button" onClick={() => props.removeImageAsset(image)}>
                حذف
              </button>
            </div>
          </article>
        ))}
        {props.images.length === 0 ? (
          <div className="order-detail-empty">
            <ShoppingBag size={28} />
            <strong>لا توجد صور محفوظة بعد</strong>
            <span>ارفع صورة وسيتم ضغطها وحفظ النسخة الخفيفة فقط.</span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

const storeRoleLabels: Record<StoreUserRole, string> = {
  store_owner: "مالك المتجر",
  products_manager: "مدير المنتجات",
  orders_manager: "مدير الطلبات"
};

function TeamPanel(props: {
  currentUser?: AuthUser;
  submitStoreUser: (event: FormEvent) => void;
  userForm: CreateStoreUserInput;
  users: StoreUser[];
  changeStoreUser: (user: StoreUser, patch: Partial<StoreUser> & { password?: string }) => void;
  setUserForm: (value: CreateStoreUserInput) => void;
}) {
  return (
    <Panel eyebrow="الصلاحيات" title="فريق المتجر" icon={<UserRound size={20} />} wide>
      <form className="team-form" onSubmit={props.submitStoreUser}>
        <input
          aria-label="Staff name"
          value={props.userForm.name}
          onChange={(event) => props.setUserForm({ ...props.userForm, name: event.target.value })}
          placeholder="اسم الموظف"
        />
        <input
          aria-label="Staff email"
          type="email"
          value={props.userForm.email}
          onChange={(event) => props.setUserForm({ ...props.userForm, email: event.target.value })}
          placeholder="staff@example.com"
        />
        <input
          aria-label="Staff password"
          type="password"
          value={props.userForm.password}
          onChange={(event) => props.setUserForm({ ...props.userForm, password: event.target.value })}
          placeholder="كلمة المرور"
        />
        <select
          aria-label="Staff role"
          value={props.userForm.role}
          onChange={(event) => props.setUserForm({ ...props.userForm, role: event.target.value as StoreUserRole })}
        >
          <option value="orders_manager">مدير الطلبات</option>
          <option value="products_manager">مدير المنتجات</option>
          <option value="store_owner">مالك المتجر</option>
        </select>
        <button type="submit">
          <Plus size={16} />
          إضافة مستخدم
        </button>
      </form>

      <div className="team-grid">
        {props.users.map((user) => (
          <article className="team-card" key={user.id}>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              {props.currentUser?.id === user.id ? <em>حسابك الحالي</em> : null}
            </div>
            <select
              aria-label="User role"
              value={user.role}
              disabled={props.currentUser?.id === user.id}
              onChange={(event) => props.changeStoreUser(user, { role: event.target.value as StoreUserRole })}
            >
              <option value="store_owner">مالك المتجر</option>
              <option value="products_manager">مدير المنتجات</option>
              <option value="orders_manager">مدير الطلبات</option>
            </select>
            <StatusPill tone={user.status === "active" ? "good" : "muted"}>
              {user.status === "active" ? "نشط" : "متوقف"}
            </StatusPill>
            <button
              type="button"
              disabled={props.currentUser?.id === user.id}
              onClick={() => props.changeStoreUser(user, { status: user.status === "active" ? "inactive" : "active" })}
            >
              {user.status === "active" ? "إيقاف" : "تفعيل"}
            </button>
            <small>{storeRoleLabels[user.role]} · {new Date(user.createdAt).toLocaleDateString("ar-LY")}</small>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ShippingPanel(props: {
  changeShippingZone: (zone: ShippingZone, patch: Partial<ShippingZone>) => void;
  currency: string;
  removeShippingZone?: (zone: ShippingZone) => void;
  setShippingForm: (value: CreateShippingZoneInput) => void;
  shippingForm: CreateShippingZoneInput;
  submitting?: boolean;
  submitShippingZone: (event: FormEvent) => void;
  zones: ShippingZone[];
}) {
  const activeZones = props.zones.filter((zone) => zone.isActive).length;
  const averageFee = props.zones.length
    ? Math.round(props.zones.reduce((sum, zone) => sum + zone.fee, 0) / props.zones.length)
    : 0;

  return (
    <section className="page-grid">
      <Panel eyebrow="قواعد التوصيل" title="مناطق الشحن" icon={<Truck size={20} />}>
        <form className="shipping-form" onSubmit={props.submitShippingZone}>
          <input
            aria-label="Shipping zone name"
            value={props.shippingForm.name}
            onChange={(event) => props.setShippingForm({ ...props.shippingForm, name: event.target.value })}
            placeholder="اسم المنطقة"
          />
          <input
            aria-label="Shipping city"
            value={props.shippingForm.city ?? ""}
            onChange={(event) => props.setShippingForm({ ...props.shippingForm, city: event.target.value })}
            placeholder="المدينة أو النطاق"
          />
          <input
            aria-label="Shipping fee"
            type="number"
            min={0}
            value={props.shippingForm.fee}
            onChange={(event) => props.setShippingForm({ ...props.shippingForm, fee: Number(event.target.value) })}
            placeholder="الرسوم"
          />
          <input
            aria-label="Shipping estimate"
            value={props.shippingForm.estimatedDays ?? ""}
            onChange={(event) => props.setShippingForm({ ...props.shippingForm, estimatedDays: event.target.value })}
            placeholder="المدة المتوقعة"
          />
          <button type="submit" disabled={props.submitting}>
            <Plus size={16} />
            {props.submitting ? "جارٍ الحفظ..." : "إضافة منطقة"}
          </button>
        </form>
        <div className="shipping-list">
          {props.zones.map((zone) => (
            <article className="shipping-card" key={zone.id}>
              <div>
                <strong>{zone.name}</strong>
                <span>{zone.city || "كل المدن"} · {zone.estimatedDays || "حسب شركة الشحن"}</span>
              </div>
              <input
                aria-label={`Shipping fee ${zone.name}`}
                type="number"
                min={0}
                defaultValue={zone.fee}
                onBlur={(event) => props.changeShippingZone(zone, { fee: Number(event.target.value) })}
              />
              <b>{formatPrice(zone.fee, props.currency)}</b>
              <StatusPill tone={zone.isActive ? "good" : "muted"}>
                {zone.isActive ? "نشطة" : "متوقفة"}
              </StatusPill>
              <button type="button" onClick={() => props.changeShippingZone(zone, { isActive: !zone.isActive })}>
                {zone.isActive ? "إيقاف" : "تفعيل"}
              </button>
              {props.removeShippingZone ? (
                <button type="button" onClick={() => props.removeShippingZone!(zone)} style={{ color: "#dc2626" }}>
                  <X size={14} />حذف
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>
      <Panel eyebrow="قراءة تشغيلية" title="ملخص الشحن" icon={<ClipboardList size={20} />}>
        <div className="shipping-summary">
          <Stat label="المناطق" value={props.zones.length} />
          <Stat label="النشطة" value={activeZones} />
          <Stat label="متوسط الرسوم" value={formatPrice(averageFee, props.currency)} />
        </div>
        <div className="settings-summary">
          <p>كل منطقة نشطة تظهر في صفحة إتمام الطلب. رسوم الشحن تحفظ داخل الطلب نفسه حتى تبقى الفاتورة صحيحة بعد أي تعديل لاحق.</p>
        </div>
      </Panel>
    </section>
  );
}

function DiscountsPanel(props: {
  changeDiscountCode: (discount: DiscountCode, patch: Partial<DiscountCode>) => void;
  currency: string;
  discountForm: CreateDiscountCodeInput;
  discounts: DiscountCode[];
  removeDiscountCode?: (discount: DiscountCode) => void;
  setDiscountForm: (value: CreateDiscountCodeInput) => void;
  submitting?: boolean;
  submitDiscountCode: (event: FormEvent) => void;
}) {
  const activeDiscounts = props.discounts.filter((discount) => discount.isActive).length;
  const usedCount = props.discounts.reduce((sum, discount) => sum + discount.redemptionCount, 0);

  return (
    <section className="page-grid">
      <Panel eyebrow="تنشيط المبيعات" title="الكوبونات والخصومات" icon={<CreditCard size={20} />}>
        <form className="discount-form" onSubmit={props.submitDiscountCode}>
          <input
            aria-label="Discount code"
            value={props.discountForm.code}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, code: event.target.value })}
            placeholder="CODE"
          />
          <input
            aria-label="Discount name"
            value={props.discountForm.name}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, name: event.target.value })}
            placeholder="اسم العرض"
          />
          <select
            aria-label="Discount type"
            value={props.discountForm.type}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, type: event.target.value as DiscountCode["type"] })}
          >
            <option value="percentage">نسبة مئوية</option>
            <option value="fixed">مبلغ ثابت</option>
          </select>
          <input
            aria-label="Discount value"
            type="number"
            min={1}
            max={props.discountForm.type === "percentage" ? 100 : undefined}
            value={props.discountForm.value}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, value: Number(event.target.value) })}
            placeholder="القيمة"
          />
          <input
            aria-label="Minimum subtotal"
            type="number"
            min={0}
            value={props.discountForm.minSubtotal ?? 0}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, minSubtotal: Number(event.target.value) })}
            placeholder="حد أدنى"
          />
          <input
            aria-label="Maximum redemptions"
            type="number"
            min={0}
            value={props.discountForm.maxRedemptions ?? 0}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, maxRedemptions: Number(event.target.value) })}
            placeholder="عدد الاستخدامات"
          />
          <input
            aria-label="Discount starts at"
            type="datetime-local"
            value={props.discountForm.startsAt ?? ""}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, startsAt: event.target.value })}
          />
          <input
            aria-label="Discount ends at"
            type="datetime-local"
            value={props.discountForm.endsAt ?? ""}
            onChange={(event) => props.setDiscountForm({ ...props.discountForm, endsAt: event.target.value })}
          />
          <button type="submit" disabled={props.submitting}>
            <Plus size={16} />
            {props.submitting ? "جارٍ الحفظ..." : "إضافة كوبون"}
          </button>
        </form>
        <div className="discount-list">
          {props.discounts.map((discount) => (
            <article className="discount-card" key={discount.id}>
              <div>
                <strong>{discount.code}</strong>
                <span>{discount.name}</span>
                {discount.startsAt || discount.endsAt ? (
                  <span>{discount.startsAt || "الآن"} → {discount.endsAt || "بدون نهاية"}</span>
                ) : null}
              </div>
              <b>
                {discount.type === "percentage"
                  ? `${discount.value}%`
                  : formatPrice(discount.value, props.currency)}
              </b>
              <span>
                حد أدنى {formatPrice(discount.minSubtotal, props.currency)}
              </span>
              <span>
                {discount.maxRedemptions ? `${discount.redemptionCount}/${discount.maxRedemptions}` : `${discount.redemptionCount} استخدام`}
              </span>
              <StatusPill tone={discount.isActive ? "good" : "muted"}>
                {discount.isActive ? "نشط" : "متوقف"}
              </StatusPill>
              <button type="button" onClick={() => props.changeDiscountCode(discount, { isActive: !discount.isActive })}>
                {discount.isActive ? "إيقاف" : "تفعيل"}
              </button>
              {props.removeDiscountCode ? (
                <button type="button" onClick={() => props.removeDiscountCode!(discount)} style={{ color: "#dc2626" }}>
                  <X size={14} />حذف
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </Panel>
      <Panel eyebrow="أداء العروض" title="ملخص الخصومات" icon={<BarChart3 size={20} />}>
        <div className="shipping-summary">
          <Stat label="الكوبونات" value={props.discounts.length} />
          <Stat label="النشطة" value={activeDiscounts} />
          <Stat label="الاستخدامات" value={usedCount} />
        </div>
        <div className="settings-summary">
          <p>الكوبون يطبق على قيمة المنتجات قبل الشحن. يمكن تحديد نسبة أو مبلغ ثابت وحد أدنى للطلب وعدد استخدامات.</p>
        </div>
      </Panel>
    </section>
  );
}

function OrdersPanel(props: {
  addInternalOrderNote: (orderId: string, message: string) => void;
  applyFilters: (filters: OrderFilters) => void;
  compact?: boolean;
  changeOrderPayment: (orderId: string, input: Pick<Order, "paymentStatus" | "paidAmount" | "paymentReference">) => void;
  changeOrderStatus: (orderId: string, status: Order["status"]) => void;
  exportOrders: (filters?: OrderFilters) => void;
  expectedOrderTotal: number;
  filters: OrderFilters;
  openOrder: (orderId: string) => void;
  orderForm: { customerName: string; customerPhone: string; productId: string; quantity: number };
  orders: Order[];
  products: Product[];
  selectedOrder?: OrderDetail;
  selectedProduct?: Product;
  setFilters: (filters: OrderFilters) => void;
  setOrderForm: (value: { customerName: string; customerPhone: string; productId: string; quantity: number }) => void;
  submitOrder: (event: FormEvent) => void;
}) {
  return (
    <Panel eyebrow="تشغيل يومي" title="الطلبات" icon={<Truck size={20} />} wide>
      {!props.compact ? (
        <div className="orders-toolbar">
          <button type="button" onClick={() => props.exportOrders(props.filters)}>
            <Download size={16} />
            تصدير CSV
          </button>
        </div>
      ) : null}
      {!props.compact ? (
        <form
          className="filter-toolbar order-filter-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            props.applyFilters(props.filters);
          }}
        >
          <input
            aria-label="Order search"
            value={props.filters.q ?? ""}
            onChange={(event) => props.setFilters({ ...props.filters, q: event.target.value })}
            placeholder="ابحث برقم الطلب، العميل، الهاتف، المدينة"
          />
          <select
            aria-label="Order status filter"
            value={props.filters.status ?? ""}
            onChange={(event) => props.setFilters({ ...props.filters, status: event.target.value as OrderFilters["status"] })}
          >
            <option value="">كل الحالات</option>
            <option value="new">جديد</option>
            <option value="confirmed">مؤكد</option>
            <option value="processing">قيد التجهيز</option>
            <option value="shipped">تم الشحن</option>
            <option value="cancelled">ملغي</option>
          </select>
          <select
            aria-label="Payment status filter"
            value={props.filters.paymentStatus ?? ""}
            onChange={(event) => props.setFilters({ ...props.filters, paymentStatus: event.target.value as OrderFilters["paymentStatus"] })}
          >
            <option value="">كل الدفع</option>
            <option value="pending">بانتظار الدفع</option>
            <option value="authorized">مصرح</option>
            <option value="paid">مدفوع</option>
            <option value="failed">فشل الدفع</option>
            <option value="refunded">مسترجع</option>
          </select>
          <input
            aria-label="Date from"
            type="date"
            value={props.filters.dateFrom ?? ""}
            onChange={(event) => props.setFilters({ ...props.filters, dateFrom: event.target.value })}
          />
          <input
            aria-label="Date to"
            type="date"
            value={props.filters.dateTo ?? ""}
            onChange={(event) => props.setFilters({ ...props.filters, dateTo: event.target.value })}
          />
          <button type="submit">
            <Search size={16} />
            تطبيق
          </button>
          <button
            type="button"
            onClick={() => {
              const next: OrderFilters = { q: "", status: "", paymentStatus: "", dateFrom: "", dateTo: "" };
              props.setFilters(next);
              props.applyFilters(next);
            }}
          >
            مسح
          </button>
        </form>
      ) : null}
      <form className="inline-form order-form" onSubmit={props.submitOrder}>
        <input
          aria-label="Customer name"
          value={props.orderForm.customerName}
          onChange={(event) => props.setOrderForm({ ...props.orderForm, customerName: event.target.value })}
          placeholder="اسم العميل"
        />
        <input
          aria-label="Customer phone"
          value={props.orderForm.customerPhone}
          onChange={(event) => props.setOrderForm({ ...props.orderForm, customerPhone: event.target.value })}
          placeholder="رقم الهاتف"
        />
        <select
          aria-label="Order product"
          value={props.selectedProduct?.id ?? ""}
          onChange={(event) => props.setOrderForm({ ...props.orderForm, productId: event.target.value })}
        >
          {props.products.map((product) => (
            <option value={product.id} key={product.id}>
              {product.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Order quantity"
          type="number"
          min={1}
          max={props.selectedProduct?.inventory ?? 1}
          value={props.orderForm.quantity}
          onChange={(event) => props.setOrderForm({ ...props.orderForm, quantity: Number(event.target.value) })}
          placeholder="الكمية"
        />
        <button type="submit">
          <Plus size={16} />
          {formatPrice(props.expectedOrderTotal)}
        </button>
      </form>
      <div className="orders-workbench">
        <div className="order-list-column">
          {props.orders.slice(0, props.compact ? 5 : undefined).map((order) => (
            <article
              className={`data-row order-row-card ${props.selectedOrder?.id === order.id ? "selected-order" : ""}`}
              key={order.id}
            >
              <button className="order-open-button" type="button" onClick={() => props.openOrder(order.id)}>
                <div>
                  <strong>{order.customerName}</strong>
                  <span>
                    {order.customerPhone} · {order.customerCity || "بدون مدينة"} · {order.itemCount} قطعة
                  </span>
                  {order.customerAddress ? <span>{order.customerAddress}</span> : null}
                  {order.notes ? <span>{order.notes}</span> : null}
                </div>
              </button>
              <b>{formatPrice(order.total)}</b>
              <select
                aria-label="Order status"
                value={order.status}
                onChange={(event) => props.changeOrderStatus(order.id, event.target.value as Order["status"])}
              >
                <option value="new">جديد</option>
                <option value="confirmed">مؤكد</option>
                <option value="processing">قيد التجهيز</option>
                <option value="shipped">تم الشحن</option>
                <option value="cancelled">ملغي</option>
              </select>
            </article>
          ))}
        </div>
        {!props.compact ? (
          <OrderDetailPanel
            addInternalOrderNote={props.addInternalOrderNote}
            changeOrderPayment={props.changeOrderPayment}
            changeOrderStatus={props.changeOrderStatus}
            order={props.selectedOrder}
            orders={props.orders}
            openOrder={props.openOrder}
          />
        ) : null}
      </div>
    </Panel>
  );
}

const orderStatusLabels: Record<Order["status"], string> = {
  new: "جديد",
  confirmed: "مؤكد",
  processing: "قيد التجهيز",
  shipped: "تم الشحن",
  cancelled: "ملغي"
};

const paymentLabels: Record<string, string> = {
  cash_on_delivery: "الدفع عند الاستلام",
  bank_transfer: "تحويل مصرفي",
  card: "بطاقة مصرفية",
  wallet: "محفظة إلكترونية"
};

const paymentStatusLabels: Record<Order["paymentStatus"], string> = {
  pending: "بانتظار الدفع",
  authorized: "مصرح",
  paid: "مدفوع",
  failed: "فشل الدفع",
  refunded: "مسترجع"
};

const orderStatusSequence: Array<Order["status"]> = ["new", "confirmed", "processing", "shipped"];

function OrderDetailPanel(props: {
  addInternalOrderNote: (orderId: string, message: string) => void;
  changeOrderPayment: (orderId: string, input: Pick<Order, "paymentStatus" | "paidAmount" | "paymentReference">) => void;
  changeOrderStatus: (orderId: string, status: Order["status"]) => void;
  order?: OrderDetail;
  orders: Order[];
  openOrder: (orderId: string) => void;
}) {
  const fallbackOrder = props.order ?? props.orders[0];
  const [note, setNote] = useState("");
  const [paymentDraft, setPaymentDraft] = useState<Pick<Order, "paymentStatus" | "paidAmount" | "paymentReference">>({
    paymentStatus: fallbackOrder?.paymentStatus ?? "pending",
    paidAmount: fallbackOrder?.paidAmount ?? 0,
    paymentReference: fallbackOrder?.paymentReference ?? ""
  });
  const currentStatusIndex = fallbackOrder
    ? orderStatusSequence.findIndex((status) => status === fallbackOrder.status)
    : -1;
  const orderEvents = props.order?.events.length
    ? props.order.events
    : fallbackOrder
      ? [
          {
            id: `${fallbackOrder.id}-created`,
            orderId: fallbackOrder.id,
            type: "created" as const,
            title: "تم إنشاء الطلب",
            message: "لا يوجد سجل تفصيلي قديم لهذا الطلب.",
            createdAt: fallbackOrder.createdAt
          }
        ]
      : [];

  useEffect(() => {
    if (!fallbackOrder) return;
    setPaymentDraft({
      paymentStatus: fallbackOrder.paymentStatus ?? "pending",
      paidAmount: fallbackOrder.paidAmount ?? 0,
      paymentReference: fallbackOrder.paymentReference ?? ""
    });
    setNote("");
  }, [fallbackOrder?.id, fallbackOrder?.paymentStatus, fallbackOrder?.paidAmount, fallbackOrder?.paymentReference]);

  const printInvoice = () => {
    if (!props.order) {
      props.openOrder(fallbackOrder!.id);
      return;
    }

    const itemsHtml = props.order.items.map((item) => `
      <tr>
        <td>${escapeHtml(item.productName)}${item.variantName ? `<small>${escapeHtml(item.variantName)}</small>` : ""}</td>
        <td>${item.quantity}</td>
        <td>${formatPrice(item.unitPrice)}</td>
        <td>${formatPrice(item.lineTotal)}</td>
      </tr>
    `).join("");
    const itemsSubtotal = props.order.items.reduce((sum, item) => sum + item.lineTotal, 0);
    const popup = window.open("", "_blank", "width=860,height=900");
    if (!popup) return;

    popup.document.write(`
      <!doctype html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>فاتورة ${props.order.id}</title>
          <style>
            body { font-family: Tahoma, Arial, sans-serif; color: #111827; margin: 32px; }
            header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 18px; margin-bottom: 24px; }
            h1, h2, p { margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin: 18px 0; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; text-align: right; }
            small { display: block; color: #6b7280; margin-top: 4px; }
            .summary { width: 320px; margin-right: auto; display: grid; gap: 8px; }
            .summary div { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding: 8px 0; }
            .total { font-size: 20px; font-weight: 800; }
            @media print { button { display: none; } body { margin: 18px; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>فاتورة طلب</h1>
              <p>#${props.order.id.slice(0, 8)}</p>
            </div>
            <div>
              <strong>${escapeHtml(props.order.customerName)}</strong>
              <p>${escapeHtml(props.order.customerPhone)}<br />${escapeHtml(props.order.customerCity || "")} ${escapeHtml(props.order.customerAddress || "")}</p>
            </div>
          </header>
          <section>
            <p>الحالة: ${orderStatusLabels[props.order.status]} | الدفع: ${paymentStatusLabels[props.order.paymentStatus]}</p>
            <p>طريقة الدفع: ${paymentLabels[props.order.paymentMethod] ?? props.order.paymentMethod}</p>
          </section>
          <table>
            <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <section class="summary">
            <div><span>المنتجات</span><strong>${formatPrice(itemsSubtotal)}</strong></div>
            <div><span>الشحن</span><strong>${formatPrice(props.order.shippingFee)}</strong></div>
            <div><span>الخصم</span><strong>-${formatPrice(props.order.discountAmount)}</strong></div>
            <div class="total"><span>الإجمالي</span><strong>${formatPrice(props.order.total)}</strong></div>
          </section>
          <button onclick="window.print()">طباعة</button>
        </body>
      </html>
    `);
    popup.document.close();
  };

  if (!fallbackOrder) {
    return (
      <aside className="order-detail-empty">
        <ClipboardList size={28} />
        <strong>لا توجد طلبات بعد</strong>
        <span>عند وصول أول طلب ستظهر تفاصيله هنا.</span>
      </aside>
    );
  }

  return (
    <aside className="order-detail-panel">
      {!props.order ? (
        <button className="load-detail-button" type="button" onClick={() => props.openOrder(fallbackOrder.id)}>
          <ArrowRight size={16} />
          فتح تفاصيل الطلب الأول
        </button>
      ) : null}

      <div className="order-detail-header">
        <div>
          <p className="eyebrow">تفاصيل الطلب</p>
          <h2>#{fallbackOrder.id.slice(0, 8)}</h2>
          <span>{new Date(fallbackOrder.createdAt).toLocaleString("ar-LY")}</span>
        </div>
        <div className="order-detail-actions">
          <button type="button" onClick={printInvoice}>
            <Printer size={16} />
            فاتورة
          </button>
          <StatusPill tone={fallbackOrder.status === "cancelled" ? "warn" : fallbackOrder.status === "shipped" ? "good" : "muted"}>
            {orderStatusLabels[fallbackOrder.status]}
          </StatusPill>
        </div>
      </div>

      <div className="status-stepper" aria-label="Order progress">
        {orderStatusSequence.map((status, index) => (
          <button
            className={index <= currentStatusIndex ? "done" : ""}
            type="button"
            key={status}
            onClick={() => props.changeOrderStatus(fallbackOrder.id, status)}
          >
            <span>{index + 1}</span>
            {orderStatusLabels[status]}
          </button>
        ))}
        <button
          className={fallbackOrder.status === "cancelled" ? "danger done" : "danger"}
          type="button"
          onClick={() => props.changeOrderStatus(fallbackOrder.id, "cancelled")}
        >
          <span>!</span>
          ملغي
        </button>
      </div>

      <section className="detail-metrics">
        <div>
          <CreditCard size={18} />
          <span>الإجمالي</span>
          <strong>{formatPrice(fallbackOrder.total)}</strong>
        </div>
        <div>
          <Package size={18} />
          <span>القطع</span>
          <strong>{fallbackOrder.itemCount}</strong>
        </div>
        <div>
          <CalendarClock size={18} />
          <span>الحالة</span>
          <strong>{orderStatusLabels[fallbackOrder.status]}</strong>
        </div>
        <div>
          <Truck size={18} />
          <span>الشحن</span>
          <strong>{formatPrice(fallbackOrder.shippingFee ?? 0)}</strong>
        </div>
        <div>
          <CreditCard size={18} />
          <span>الخصم</span>
          <strong>{formatPrice(fallbackOrder.discountAmount ?? 0)}</strong>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">العميل والشحن</p>
            <h3>{fallbackOrder.customerName}</h3>
          </div>
          <UserRound size={19} />
        </div>
        <div className="customer-grid">
          <span>الهاتف</span>
          <strong>{fallbackOrder.customerPhone}</strong>
          <span>المدينة</span>
          <strong>{fallbackOrder.customerCity || "غير محددة"}</strong>
          <span>العنوان</span>
          <strong>{fallbackOrder.customerAddress || "غير محدد"}</strong>
          <span>منطقة الشحن</span>
          <strong>{fallbackOrder.shippingZoneName || "غير محددة"}</strong>
          <span>الملاحظات</span>
          <strong>{fallbackOrder.notes || "لا توجد ملاحظات"}</strong>
          <span>الدفع</span>
          <strong>{paymentLabels[fallbackOrder.paymentMethod] ?? (fallbackOrder.paymentMethod || "غير محددة")}</strong>
          <span>حالة الدفع</span>
          <strong>{paymentStatusLabels[fallbackOrder.paymentStatus]}</strong>
          <span>المحصل</span>
          <strong>{formatPrice(fallbackOrder.paidAmount ?? 0)}</strong>
          <span>مرجع الدفع</span>
          <strong>{fallbackOrder.paymentReference || "غير محدد"}</strong>
          <span>الكوبون</span>
          <strong>{fallbackOrder.discountCode || "لا يوجد"}</strong>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">التحصيل</p>
            <h3>حالة الدفع</h3>
          </div>
          <CreditCard size={19} />
        </div>
        <div className="payment-control-grid">
          <select
            aria-label="Payment status"
            value={paymentDraft.paymentStatus}
            onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentStatus: event.target.value as Order["paymentStatus"] })}
          >
            <option value="pending">بانتظار الدفع</option>
            <option value="authorized">مصرح</option>
            <option value="paid">مدفوع</option>
            <option value="failed">فشل الدفع</option>
            <option value="refunded">مسترجع</option>
          </select>
          <input
            aria-label="Paid amount"
            type="number"
            min={0}
            step="0.01"
            value={paymentDraft.paidAmount / 100}
            onChange={(event) => setPaymentDraft({ ...paymentDraft, paidAmount: Math.round(Number(event.target.value) * 100) })}
            placeholder="المبلغ المحصل بالدينار"
          />
          <input
            aria-label="Payment reference"
            value={paymentDraft.paymentReference}
            onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentReference: event.target.value })}
            placeholder="مرجع الدفع أو التحويل"
          />
          <button type="button" onClick={() => props.changeOrderPayment(fallbackOrder.id, paymentDraft)}>
            <Save size={16} />
            حفظ الدفع
          </button>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">عناصر الطلب</p>
            <h3>{props.order?.items.length ?? 0} منتجات</h3>
          </div>
          <ShoppingBag size={19} />
        </div>
        <div className="order-items-list">
          {props.order?.items.length ? (
            props.order.items.map((item) => (
              <article className="order-item-row" key={item.id}>
                <div>
                  <strong>{item.productName}</strong>
                  {item.variantName ? <em>{item.variantName} · {item.sku || "بدون SKU"}</em> : null}
                  <span>{item.quantity} × {formatPrice(item.unitPrice)}</span>
                </div>
                <b>{formatPrice(item.lineTotal)}</b>
              </article>
            ))
          ) : (
            <span className="muted-text">افتح التفاصيل لجلب عناصر الطلب.</span>
          )}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">سجل الحركة</p>
            <h3>تتبع الطلب</h3>
          </div>
          <Truck size={19} />
        </div>
        <form
          className="order-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!note.trim()) return;
            props.addInternalOrderNote(fallbackOrder.id, note);
          }}
        >
          <input
            aria-label="Internal order note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="أضف ملاحظة داخلية للطلب"
          />
          <button type="submit">
            <Plus size={16} />
            إضافة
          </button>
        </form>
        <div className="order-timeline">
          {orderEvents.map((event) => (
            <article key={event.id}>
              <i />
              <div>
                <strong>{event.title}</strong>
                <span>{event.message}</span>
                <time>{new Date(event.createdAt).toLocaleString("ar-LY")}</time>
              </div>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function IdentityPanel(props: { changeTheme: (patch: Partial<StoreTheme>) => void; theme?: StoreTheme }) {
  return (
    <section className="page-grid">
      <Panel eyebrow="تخصيص عالي" title="هوية المتجر" icon={<Sparkles size={20} />}>
        <label className="field-row">
          <span>لون العلامة</span>
          <input
            type="color"
            value={props.theme?.brandColor ?? "#111827"}
            onChange={(event) => props.changeTheme({ brandColor: event.target.value })}
          />
        </label>
        <label className="field-row">
          <span>لون التفاعل</span>
          <input
            type="color"
            value={props.theme?.accentColor ?? "#14b8a6"}
            onChange={(event) => props.changeTheme({ accentColor: event.target.value })}
          />
        </label>
        <label className="field-row">
          <span>نمط الواجهة</span>
          <select
            value={props.theme?.storefrontStyle ?? "minimal"}
            onChange={(event) => props.changeTheme({ storefrontStyle: event.target.value as StoreTheme["storefrontStyle"] })}
          >
            <option value="minimal">minimal</option>
            <option value="editorial">editorial</option>
            <option value="luxury">luxury</option>
            <option value="playful">playful</option>
          </select>
        </label>
      </Panel>
      <Panel eyebrow="معاينة" title="إحساس الواجهة" icon={<Palette size={20} />}>
        <div className="store-preview">
          <span>متجر تجريبي</span>
          <strong>منتجات مختارة بعناية</strong>
          <button type="button">أضف للسلة</button>
        </div>
      </Panel>
    </section>
  );
}

function SettingsPanel(props: {
  settings?: StoreSettings;
  storeName: string;
  saveSettings: (settings: StoreSettings) => void;
}) {
  const [draft, setDraft] = useState<StoreSettings>({
    storeName: props.settings?.storeName ?? props.storeName,
    publicEmail: props.settings?.publicEmail ?? "",
    publicPhone: props.settings?.publicPhone ?? "",
    whatsappPhone: props.settings?.whatsappPhone ?? "",
    currency: props.settings?.currency ?? "LYD",
    defaultCity: props.settings?.defaultCity ?? "",
    shippingPolicy: props.settings?.shippingPolicy ?? "",
    paymentMethods: props.settings?.paymentMethods ?? ["cash_on_delivery"]
  });

  useEffect(() => {
    setDraft({
      storeName: props.settings?.storeName ?? props.storeName,
      publicEmail: props.settings?.publicEmail ?? "",
      publicPhone: props.settings?.publicPhone ?? "",
      whatsappPhone: props.settings?.whatsappPhone ?? "",
      currency: props.settings?.currency ?? "LYD",
      defaultCity: props.settings?.defaultCity ?? "",
      shippingPolicy: props.settings?.shippingPolicy ?? "",
      paymentMethods: props.settings?.paymentMethods ?? ["cash_on_delivery"]
    });
  }, [props.settings, props.storeName]);

  const togglePayment = (method: string) => {
    setDraft((current) => ({
      ...current,
      paymentMethods: current.paymentMethods.includes(method)
        ? current.paymentMethods.filter((item) => item !== method)
        : [...current.paymentMethods, method]
    }));
  };

  return (
    <section className="page-grid">
      <Panel eyebrow="تشغيل المتجر" title="الإعدادات العامة" icon={<Settings size={20} />}>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.saveSettings(draft);
          }}
        >
          <label>
            <span>اسم المتجر</span>
            <input
              value={draft.storeName}
              onChange={(event) => setDraft({ ...draft, storeName: event.target.value })}
            />
          </label>
          <label>
            <span>البريد العام</span>
            <input
              type="email"
              value={draft.publicEmail}
              onChange={(event) => setDraft({ ...draft, publicEmail: event.target.value })}
            />
          </label>
          <label>
            <span>رقم الاتصال</span>
            <input
              value={draft.publicPhone}
              onChange={(event) => setDraft({ ...draft, publicPhone: event.target.value })}
            />
          </label>
          <label>
            <span>واتساب</span>
            <input
              value={draft.whatsappPhone}
              onChange={(event) => setDraft({ ...draft, whatsappPhone: event.target.value })}
            />
          </label>
          <label>
            <span>العملة</span>
            <select
              value={draft.currency}
              onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
            >
              <option value="LYD">LYD</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="SAR">SAR</option>
            </select>
          </label>
          <label>
            <span>المدينة الافتراضية</span>
            <input
              value={draft.defaultCity}
              onChange={(event) => setDraft({ ...draft, defaultCity: event.target.value })}
            />
          </label>
          <label className="full-field">
            <span>سياسة الشحن</span>
            <textarea
              value={draft.shippingPolicy}
              onChange={(event) => setDraft({ ...draft, shippingPolicy: event.target.value })}
            />
          </label>
          <button type="submit">
            <Save size={16} />
            حفظ الإعدادات
          </button>
        </form>
      </Panel>
      <Panel eyebrow="طرق الدفع" title="خيارات الطلب" icon={<CreditCard size={20} />}>
        <div className="payment-methods">
          {[
            ["cash_on_delivery", "الدفع عند الاستلام"],
            ["bank_transfer", "تحويل مصرفي"],
            ["card", "بطاقة مصرفية"],
            ["wallet", "محفظة إلكترونية"]
          ].map(([key, label]) => (
            <label className="toggle-row" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={draft.paymentMethods.includes(key)}
                onChange={() => togglePayment(key)}
              />
            </label>
          ))}
        </div>
        <div className="settings-summary">
          <strong>{draft.storeName}</strong>
          <span>{draft.publicPhone || "لا يوجد رقم اتصال"} · {draft.defaultCity || "مدينة غير محددة"}</span>
          <p>{draft.shippingPolicy || "لم يتم تحديد سياسة الشحن بعد."}</p>
        </div>
      </Panel>
    </section>
  );
}

function DomainsPanel(props: {
  domain: string;
  domains: StoreDomain[];
  setDomain: (value: string) => void;
  submitDomain: (event: FormEvent) => void;
  verifyDomain: (domainId: string, verificationStatus: StoreDomain["verificationStatus"]) => void;
}) {
  return (
    <Panel eyebrow="ملكية الدومين" title="الدومينات" icon={<Globe size={20} />} wide>
      <form className="stack-form narrow-form" onSubmit={props.submitDomain}>
        <input
          aria-label="Domain"
          value={props.domain}
          onChange={(event) => props.setDomain(event.target.value)}
          placeholder="store.example.com"
        />
        <button type="submit">
          <Plus size={16} />
          إضافة دومين
        </button>
      </form>
      <div className="data-list">
        {props.domains.map((item) => (
          <article className="data-row" key={item.id}>
            <div>
              <strong>{item.domain}</strong>
              <span>{item.verificationStatus === "verified" ? "تم التحقق" : item.verificationToken}</span>
            </div>
            <StatusPill tone={item.verificationStatus === "verified" ? "good" : "warn"}>
              {item.verificationStatus === "verified" ? "موثق" : "بانتظار التحقق"}
            </StatusPill>
            <div className="row-actions">
              <button type="button" onClick={() => props.verifyDomain(item.id, "verified")}>
                تحقق
              </button>
              <button type="button" onClick={() => props.verifyDomain(item.id, "failed")}>
                فشل
              </button>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function IntegrationPanel(props: {
  integration?: MokenIntegrationSettings & { updatedAt: string };
  toggleIntegration: (key: keyof MokenIntegrationSettings, value: boolean | string) => void;
}) {
  return (
    <Panel eyebrow="ربط اختياري" title="تكامل مكن" icon={<Link size={20} />}>
      <label className="field-row">
        <span>API</span>
        <input
          value={props.integration?.apiBaseUrl ?? ""}
          onChange={(event) => props.toggleIntegration("apiBaseUrl", event.target.value)}
          placeholder="https://moken.example.com/api"
        />
      </label>
      <IntegrationToggle label="تفعيل الربط" checked={Boolean(props.integration?.enabled)} onChange={(value) => props.toggleIntegration("enabled", value)} />
      <IntegrationToggle label="مزامنة المنتجات" checked={Boolean(props.integration?.syncProducts)} onChange={(value) => props.toggleIntegration("syncProducts", value)} />
      <IntegrationToggle label="مزامنة المخزون" checked={Boolean(props.integration?.syncInventory)} onChange={(value) => props.toggleIntegration("syncInventory", value)} />
      <IntegrationToggle label="إرسال الطلبات" checked={Boolean(props.integration?.pushOrders)} onChange={(value) => props.toggleIntegration("pushOrders", value)} />
    </Panel>
  );
}

function ImageUploadButton(props: {
  label: string;
  onUploaded: (url: string) => void;
  uploadStoreImage: (file: File) => Promise<string>;
}) {
  const [uploading, setUploading] = useState(false);

  return (
    <label className={`image-upload-control ${uploading ? "uploading" : ""}`}>
      <span>{uploading ? "جاري الضغط..." : props.label}</span>
      <input
        type="file"
        accept="image/*"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;

          setUploading(true);
          props.uploadStoreImage(file)
            .then(props.onUploaded)
            .finally(() => setUploading(false));
        }}
      />
    </label>
  );
}

function Panel(props: { eyebrow: string; title: string; icon: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`panel ${props.wide ? "wide-panel" : ""}`}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{props.eyebrow}</p>
          <h2>{props.title}</h2>
        </div>
        {props.icon}
      </div>
      {props.children}
    </section>
  );
}

function Stat(props: { label: string; value: ReactNode }) {
  return (
    <article className="stat-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function StatusPill(props: { children: ReactNode; tone: "good" | "warn" | "muted" }) {
  return <span className={`status-pill ${props.tone}`}>{props.children}</span>;
}

function IntegrationToggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
    </label>
  );
}
