import { Check, ChevronLeft, ClipboardList, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppliedDiscount, Category, Product, ProductVariant, ShippingZone, StoreSettings, Tenant, TrackedOrder } from "@moken-store/shared";
import { createOrder, getCategories, getProducts, getProductsByCategory, getShippingZones, getStore, getStoreSettings, trackOrders, validateDiscountCode } from "./api";

type CartLine = {
  product: Product;
  variant?: ProductVariant;
  quantity: number;
};

type Page = "catalog" | "product" | "checkout" | "tracking";

type StorefrontState = {
  tenant?: Tenant;
  settings?: StoreSettings;
  shippingZones: ShippingZone[];
  categories: Category[];
  products: Product[];
  selectedProduct?: Product;
  error?: string;
  notice?: string;
};

const fallbackImage =
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80";

const formatPrice = (price: number, currency = "LYD") => {
  return new Intl.NumberFormat("ar-LY", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(price / 100);
};

const getLineKey = (productId: string, variantId = "") => `${productId}:${variantId}`;
const variantPrice = (product: Product, variant?: ProductVariant) => product.price + (variant?.priceDelta ?? 0);
const lineTotal = (line: CartLine) => variantPrice(line.product, line.variant) * line.quantity;
const activeVariants = (product: Product) => product.variants.filter((variant) => variant.isActive);
const availableProductInventory = (product: Product) => {
  const variants = activeVariants(product);
  return variants.length ? variants.reduce((sum, variant) => sum + variant.inventory, 0) : product.inventory;
};
const paymentLabels: Record<string, string> = {
  cash_on_delivery: "الدفع عند الاستلام",
  bank_transfer: "تحويل مصرفي",
  card: "بطاقة مصرفية",
  wallet: "محفظة إلكترونية"
};
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
const orderStatusFlow = ["new", "confirmed", "processing", "shipped"] as const;

const calculateDiscountAmount = (discount: AppliedDiscount | undefined, subtotal: number) => {
  if (!discount) return 0;
  if (discount.type === "percentage") {
    return Math.min(subtotal, Math.round(subtotal * Math.min(discount.value, 100) / 100));
  }

  return Math.min(subtotal, discount.value);
};

export function App() {
  const [state, setState] = useState<StorefrontState>({ categories: [], products: [], shippingZones: [] });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [page, setPage] = useState<Page>("catalog");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeImage, setActiveImage] = useState<string>("");
  const [customer, setCustomer] = useState({ name: "", phone: "", city: "", address: "", notes: "" });
  const [paymentMethod, setPaymentMethod] = useState("cash_on_delivery");
  const [shippingZoneId, setShippingZoneId] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | undefined>();
  const [discountError, setDiscountError] = useState("");
  const [trackingPhone, setTrackingPhone] = useState("");
  const [trackingOrderId, setTrackingOrderId] = useState("");
  const [trackedOrders, setTrackedOrders] = useState<TrackedOrder[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    Promise.all([getStore(), getStoreSettings(), getShippingZones(), getCategories(), getProducts()])
      .then(([store, settings, shippingZones, categories, products]) => {
        const methods = settings.settings.paymentMethods.length
          ? settings.settings.paymentMethods
          : ["cash_on_delivery"];
        const defaultZone = shippingZones.zones[0];
        setState({
          tenant: store.tenant,
          settings: settings.settings,
          shippingZones: shippingZones.zones,
          categories: categories.categories,
          products: products.products.filter((product) => product.isActive)
        });
        setPaymentMethod(methods[0]);
        setShippingZoneId(defaultZone?.id ?? "");
        setCustomer((current) => ({ ...current, city: current.city || defaultZone?.city || settings.settings.defaultCity }));
      })
      .catch((error: unknown) => {
        setState({
          categories: [],
          products: [],
          shippingZones: [],
          error: error instanceof Error ? error.message : "Unexpected error"
        });
      });
  }, []);

  const parentCategories = useMemo(
    () => state.categories.filter((category) => !category.parentId),
    [state.categories]
  );
  const childCategories = useMemo(
    () => state.categories.filter((category) => category.parentId),
    [state.categories]
  );
  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + lineTotal(line), 0),
    [cart]
  );
  const selectedShippingZone = state.shippingZones.find((zone) => zone.id === shippingZoneId);
  const shippingFee = selectedShippingZone?.fee ?? 0;
  const discountAmount = calculateDiscountAmount(appliedDiscount, subtotal);
  const total = Math.max(0, subtotal - discountAmount) + (cart.length ? shippingFee : 0);
  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const theme = state.tenant?.theme;

  const selectCategory = (slug: string) => {
    setActiveCategory(slug);
    setSearchQuery("");
    const load = slug === "all" ? getProducts() : getProductsByCategory(slug);
    load
      .then((response) => {
        setState((current) => ({
          ...current,
          products: response.products.filter((product) => product.isActive)
        }));
      })
      .catch((error: unknown) => {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Unexpected error"
        }));
      });
  };

  const searchProducts = (q: string) => {
    setSearchLoading(true);
    getProducts({ q })
      .then((response) => {
        setState((current) => ({
          ...current,
          products: response.products.filter((product) => product.isActive)
        }));
        setActiveCategory("all");
      })
      .catch((error: unknown) => {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Unexpected error"
        }));
      })
      .finally(() => setSearchLoading(false));
  };

  const openProduct = (product: Product) => {
    setState((current) => ({ ...current, selectedProduct: product }));
    setActiveImage(product.images[0] ?? product.imageUrl ?? fallbackImage);
    setPage("product");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const addToCart = (product: Product, quantity = 1, variant?: ProductVariant) => {
    const maxInventory = variant ? variant.inventory : product.inventory;
    const lineKey = getLineKey(product.id, variant?.id);
    setCart((current) => {
      const existing = current.find((line) => getLineKey(line.product.id, line.variant?.id) === lineKey);
      if (existing) {
        return current.map((line) =>
          getLineKey(line.product.id, line.variant?.id) === lineKey
            ? { ...line, quantity: Math.min(line.quantity + quantity, maxInventory) }
            : line
        );
      }
      return [...current, { product, variant, quantity: Math.min(quantity, maxInventory) }];
    });
  };

  const changeQuantity = (lineKey: string, quantity: number) => {
    setCart((current) =>
      current.map((line) => {
        if (getLineKey(line.product.id, line.variant?.id) !== lineKey) return line;
        const maxInventory = line.variant ? line.variant.inventory : line.product.inventory;
        return { ...line, quantity: Math.min(Math.max(1, quantity), maxInventory) };
      })
    );
  };

  const removeLine = (lineKey: string) => {
    setCart((current) => current.filter((line) => getLineKey(line.product.id, line.variant?.id) !== lineKey));
  };

  const applyDiscount = () => {
    if (!discountCode.trim() || !subtotal) return;
    validateDiscountCode({ code: discountCode, subtotal })
      .then((result) => {
        setAppliedDiscount(result.discount);
        setDiscountCode(result.discount.code);
        setDiscountError("");
      })
      .catch((error: unknown) => {
        setAppliedDiscount(undefined);
        setDiscountError(error instanceof Error ? error.message : "لم يتم قبول الكوبون");
      });
  };

  useEffect(() => {
    if (!appliedDiscount?.code || !subtotal) return;
    validateDiscountCode({ code: appliedDiscount.code, subtotal })
      .then((result) => {
        setAppliedDiscount(result.discount);
        setDiscountError("");
      })
      .catch(() => {
        setAppliedDiscount(undefined);
        setDiscountError("تغيرت السلة ولم يعد الكوبون صالحا");
      });
  }, [subtotal, appliedDiscount?.code]);

  const checkout = () => {
    if (!cart.length) return;
    if (customer.name.trim().length < 2 || customer.phone.trim().length < 5) {
      setState((current) => ({
        ...current,
        error: "يرجى إدخال الاسم ورقم الهاتف قبل تأكيد الطلب."
      }));
      return;
    }

    createOrder({
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim(),
      customerCity: customer.city,
      customerAddress: customer.address,
      notes: customer.notes,
      paymentMethod,
      shippingZoneId,
      discountCode: appliedDiscount?.code,
      items: cart.map((line) => ({ productId: line.product.id, variantId: line.variant?.id, quantity: line.quantity }))
    })
      .then((result) => {
        setCart([]);
        setAppliedDiscount(undefined);
        setDiscountCode("");
        setDiscountError("");
        setCustomer({ name: "", phone: "", city: selectedShippingZone?.city || state.settings?.defaultCity || "", address: "", notes: "" });
        setTrackingPhone(customer.phone.trim());
        setPage("catalog");
        setState((current) => ({
          ...current,
          products: current.products.map((product) => {
            const productLines = cart.filter((item) => item.product.id === product.id);
            if (!productLines.length) return product;

            const variantQuantities = new Map<string, number>();
            let productQuantity = 0;
            productLines.forEach((line) => {
              if (line.variant?.id) {
                variantQuantities.set(line.variant.id, (variantQuantities.get(line.variant.id) ?? 0) + line.quantity);
              } else {
                productQuantity += line.quantity;
              }
            });

            return {
              ...product,
              inventory: Math.max(0, product.inventory - productQuantity),
              variants: product.variants.map((variant) => ({
                ...variant,
                inventory: Math.max(0, variant.inventory - (variantQuantities.get(variant.id) ?? 0))
              }))
            };
          }),
          notice: `تم استلام الطلب ${result.order.id.slice(0, 6)} ويمكن تتبعه برقم الهاتف`,
          error: undefined
        }));
      })
      .catch((error: unknown) => {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Unexpected error"
        }));
      });
  };

  const submitTracking = () => {
    if (trackingPhone.trim().length < 5) {
      setTrackingError("أدخل رقم الهاتف المستخدم في الطلب.");
      return;
    }

    setTrackingLoading(true);
    setTrackingError("");
    trackOrders({ phone: trackingPhone.trim(), orderId: trackingOrderId.trim() || undefined })
      .then((result) => {
        setTrackedOrders(result.orders);
        setTrackingError(result.orders.length ? "" : "لم نجد طلبات مرتبطة بهذا الرقم.");
      })
      .catch((error: unknown) => {
        setTrackedOrders([]);
        setTrackingError(error instanceof Error ? error.message : "تعذر تتبع الطلب الآن.");
      })
      .finally(() => setTrackingLoading(false));
  };

  return (
    <main
      className="storefront-shell"
      style={{
        "--brand": theme?.brandColor ?? "#111827",
        "--accent": theme?.accentColor ?? "#14b8a6"
      } as React.CSSProperties}
    >
      <header className="storefront-header">
        <button className="store-logo" type="button" onClick={() => setPage("catalog")}>
          <ShoppingBag size={22} />
          <span>{state.settings?.storeName || state.tenant?.name || "Moken Store"}</span>
        </button>
        <nav className="store-nav" aria-label="Store navigation">
          <button className={page === "catalog" ? "active" : ""} onClick={() => setPage("catalog")}>
            المنتجات
          </button>
          <button className={page === "checkout" ? "active" : ""} onClick={() => setPage("checkout")}>
            إتمام الطلب
          </button>
          <button className={page === "tracking" ? "active" : ""} onClick={() => setPage("tracking")}>
            تتبع الطلب
          </button>
        </nav>
        <button className="cart-summary" type="button" onClick={() => setPage("checkout")}>
          <ShoppingBag size={18} />
          {cartCount} عناصر
        </button>
      </header>

      {state.error ? <div className="alert">{state.error}</div> : null}
      {state.notice ? <div className="notice">{state.notice}</div> : null}

      {page === "catalog" ? (
        <CatalogPage
          activeCategory={activeCategory}
          addToCart={addToCart}
          childCategories={childCategories}
          openProduct={openProduct}
          parentCategories={parentCategories}
          products={state.products}
          searchLoading={searchLoading}
          searchProducts={searchProducts}
          searchQuery={searchQuery}
          selectCategory={selectCategory}
          setSearchQuery={setSearchQuery}
          settings={state.settings}
        />
      ) : null}

      {page === "product" && state.selectedProduct ? (
        <ProductPage
          activeImage={activeImage}
          addToCart={addToCart}
          product={state.selectedProduct}
          setActiveImage={setActiveImage}
          setPage={setPage}
        />
      ) : null}

      {page === "checkout" ? (
        <CheckoutPage
          cart={cart}
          changeQuantity={changeQuantity}
          checkout={checkout}
          customer={customer}
          paymentMethod={paymentMethod}
          removeLine={removeLine}
          appliedDiscount={appliedDiscount}
          applyDiscount={applyDiscount}
          setCustomer={setCustomer}
          discountAmount={discountAmount}
          discountCode={discountCode}
          discountError={discountError}
          setDiscountCode={setDiscountCode}
          setPaymentMethod={setPaymentMethod}
          setPage={setPage}
          setShippingZoneId={(zoneId) => {
            setShippingZoneId(zoneId);
            const zone = state.shippingZones.find((item) => item.id === zoneId);
            if (zone?.city) {
              setCustomer((current) => ({ ...current, city: zone.city }));
            }
          }}
          settings={state.settings}
          shippingFee={cart.length ? shippingFee : 0}
          shippingZoneId={shippingZoneId}
          shippingZones={state.shippingZones}
          subtotal={subtotal}
          total={total}
        />
      ) : null}

      {page === "tracking" ? (
        <TrackingPage
          currency={state.settings?.currency ?? "LYD"}
          error={trackingError}
          loading={trackingLoading}
          orderId={trackingOrderId}
          orders={trackedOrders}
          phone={trackingPhone}
          setOrderId={setTrackingOrderId}
          setPage={setPage}
          setPhone={setTrackingPhone}
          submitTracking={submitTracking}
        />
      ) : null}
    </main>
  );
}

function CatalogPage(props: {
  activeCategory: string;
  addToCart: (product: Product, quantity?: number, variant?: ProductVariant) => void;
  childCategories: Category[];
  openProduct: (product: Product) => void;
  parentCategories: Category[];
  products: Product[];
  searchLoading?: boolean;
  searchProducts: (q: string) => void;
  searchQuery: string;
  selectCategory: (slug: string) => void;
  setSearchQuery: (q: string) => void;
  settings?: StoreSettings;
}) {
  return (
    <>
      <section className="storefront-hero">
        <div>
          <span>{props.settings?.defaultCity || "متجر قابل للتخصيص لكل نشاط"}</span>
          <strong>{props.settings?.storeName || "منتجات، تصنيفات، تفاصيل واضحة، وطلب سريع."}</strong>
          {props.settings?.shippingPolicy ? <p>{props.settings.shippingPolicy}</p> : null}
        </div>
        <form
          className="storefront-search"
          onSubmit={(e) => { e.preventDefault(); props.searchProducts(props.searchQuery); }}
          style={{ display: "flex", gap: 8, marginTop: 16 }}
        >
          <input
            aria-label="Search products"
            value={props.searchQuery}
            onChange={(e) => props.setSearchQuery(e.target.value)}
            placeholder="ابحث عن منتج..."
            style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.15)", color: "inherit", fontSize: 15 }}
          />
          <button type="submit" disabled={props.searchLoading} style={{ padding: "10px 18px", borderRadius: 8, background: "var(--brand)", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Search size={16} />{props.searchLoading ? "..." : "بحث"}
          </button>
          {props.searchQuery ? (
            <button type="button" onClick={() => { props.setSearchQuery(""); props.searchProducts(""); }} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.15)", color: "inherit", cursor: "pointer" }}>مسح</button>
          ) : null}
        </form>
      </section>

      <section className="catalog-layout">
        <aside className="category-panel">
          <button
            className={props.activeCategory === "all" ? "selected" : ""}
            type="button"
            onClick={() => props.selectCategory("all")}
          >
            كل المنتجات
          </button>
          {props.parentCategories.map((category) => (
            <div className="category-group" key={category.id}>
              <button
                className={props.activeCategory === category.slug ? "selected" : ""}
                type="button"
                onClick={() => props.selectCategory(category.slug)}
              >
                {category.name}
              </button>
              <div>
                {props.childCategories
                  .filter((child) => child.parentId === category.id)
                  .map((child) => (
                    <button
                      className={props.activeCategory === child.slug ? "selected child" : "child"}
                      type="button"
                      key={child.id}
                      onClick={() => props.selectCategory(child.slug)}
                    >
                      {child.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </aside>

        <section>
          <div className="catalog-heading">
            <div>
              <p className="eyebrow">الكتالوج</p>
              <h2>المنتجات</h2>
            </div>
            <span>{props.products.length} منتج</span>
          </div>
          <div className="product-grid storefront-products">
            {props.products.map((product) => (
              <article className="product-card storefront-product-card" key={product.id}>
                <button type="button" onClick={() => props.openProduct(product)}>
                  <img src={product.imageUrl || fallbackImage} alt="" />
                </button>
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.shortDescription || product.description}</p>
                  <div className="product-meta">
                    <strong>{formatPrice(product.price, product.currency)}</strong>
                    <span>{availableProductInventory(product)} متوفر</span>
                  </div>
                  <div className="product-card-actions">
                    <button type="button" onClick={() => props.openProduct(product)}>
                      التفاصيل
                    </button>
                    <button
                      type="button"
                      onClick={() => props.addToCart(product, 1, activeVariants(product)[0])}
                      disabled={availableProductInventory(product) === 0}
                    >
                      <Plus size={16} />
                      السلة
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}

function ProductPage(props: {
  activeImage: string;
  addToCart: (product: Product, quantity?: number, variant?: ProductVariant) => void;
  product: Product;
  setActiveImage: (image: string) => void;
  setPage: (page: Page) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const variants = activeVariants(props.product);
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? "");
  useEffect(() => {
    setSelectedVariantId(variants[0]?.id ?? "");
    setQuantity(1);
  }, [props.product.id]);
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId);
  const maxInventory = selectedVariant ? selectedVariant.inventory : props.product.inventory;
  const displayPrice = variantPrice(props.product, selectedVariant);
  const images = props.product.images.length ? props.product.images : [props.product.imageUrl || fallbackImage];

  return (
    <section className="product-detail-page">
      <button className="back-button" type="button" onClick={() => props.setPage("catalog")}>
        <ChevronLeft size={18} />
        العودة للمنتجات
      </button>
      <div className="product-detail-grid">
        <div className="gallery-panel">
          <img className="main-product-image" src={props.activeImage || images[0]} alt="" />
          <div className="thumbnail-row">
            {images.map((image) => (
              <button type="button" key={image} onClick={() => props.setActiveImage(image)}>
                <img src={image} alt="" />
              </button>
            ))}
          </div>
        </div>
        <div className="product-info-panel">
          <p className="eyebrow">تفاصيل المنتج</p>
          <h1>{props.product.name}</h1>
          <p>{props.product.shortDescription}</p>
          <strong className="detail-price">{formatPrice(displayPrice, props.product.currency)}</strong>
          <p className="long-description">{props.product.description}</p>

          <div className="spec-grid">
            {(props.product.specs.length ? props.product.specs : [{ name: "النوع", value: "منتج قابل للتخصيص" }]).map((spec) => (
              <div key={`${spec.name}-${spec.value}`}>
                <span>{spec.name}</span>
                <strong>{spec.value}</strong>
              </div>
            ))}
          </div>

          {variants.length ? (
            <div className="variant-picker">
              <p className="eyebrow">اختيارات المنتج</p>
              <div>
                {variants.map((variant) => (
                  <button
                    className={selectedVariantId === variant.id ? "selected" : ""}
                    type="button"
                    key={variant.id}
                    onClick={() => {
                      setSelectedVariantId(variant.id);
                      setQuantity(1);
                    }}
                    disabled={variant.inventory === 0}
                  >
                    <strong>{variant.optionName}: {variant.optionValue}</strong>
                    <span>
                      {variant.sku || "بدون SKU"} · {variant.inventory} متوفر
                      {variant.priceDelta ? ` · +${formatPrice(variant.priceDelta, props.product.currency)}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="detail-actions">
            <input
              aria-label="Quantity"
              type="number"
              min={1}
              max={maxInventory}
              value={quantity}
              onChange={(event) => setQuantity(Math.min(Number(event.target.value), maxInventory))}
            />
            <button
              type="button"
              onClick={() => props.addToCart(props.product, quantity, selectedVariant)}
              disabled={maxInventory === 0}
            >
              <ShoppingBag size={18} />
              أضف للسلة
            </button>
            <button type="button" onClick={() => props.setPage("checkout")}>
              إتمام الطلب
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckoutPage(props: {
  appliedDiscount?: AppliedDiscount;
  applyDiscount: () => void;
  cart: CartLine[];
  changeQuantity: (lineKey: string, quantity: number) => void;
  checkout: () => void;
  customer: { name: string; phone: string; city: string; address: string; notes: string };
  discountAmount: number;
  discountCode: string;
  discountError: string;
  paymentMethod: string;
  removeLine: (lineKey: string) => void;
  setCustomer: (customer: { name: string; phone: string; city: string; address: string; notes: string }) => void;
  setDiscountCode: (code: string) => void;
  setPaymentMethod: (method: string) => void;
  setPage: (page: Page) => void;
  setShippingZoneId: (zoneId: string) => void;
  settings?: StoreSettings;
  shippingFee: number;
  shippingZoneId: string;
  shippingZones: ShippingZone[];
  subtotal: number;
  total: number;
}) {
  const paymentMethods = props.settings?.paymentMethods.length ? props.settings.paymentMethods : ["cash_on_delivery"];
  const displayCurrency = props.settings?.currency ?? props.cart[0]?.product.currency ?? "LYD";

  return (
    <section className="checkout-page">
      <button className="back-button" type="button" onClick={() => props.setPage("catalog")}>
        <ChevronLeft size={18} />
        متابعة التسوق
      </button>
      <div className="checkout-grid">
        <div className="checkout-form-panel">
          <p className="eyebrow">إتمام الطلب</p>
          <h1>بيانات العميل</h1>
          <div className="checkout-form">
            <input
              aria-label="Customer name"
              value={props.customer.name}
              onChange={(event) => props.setCustomer({ ...props.customer, name: event.target.value })}
              placeholder="الاسم الكامل"
            />
            <input
              aria-label="Customer phone"
              value={props.customer.phone}
              onChange={(event) => props.setCustomer({ ...props.customer, phone: event.target.value })}
              placeholder="رقم الهاتف"
            />
            <input
              aria-label="Customer city"
              value={props.customer.city}
              onChange={(event) => props.setCustomer({ ...props.customer, city: event.target.value })}
              placeholder="المدينة"
            />
            <input
              aria-label="Customer address"
              value={props.customer.address}
              onChange={(event) => props.setCustomer({ ...props.customer, address: event.target.value })}
              placeholder="العنوان"
            />
            <textarea
              aria-label="Order notes"
              value={props.customer.notes}
              onChange={(event) => props.setCustomer({ ...props.customer, notes: event.target.value })}
              placeholder="ملاحظات للطلب"
            />
          </div>
          <div className="checkout-options">
            {props.shippingZones.length ? (
              <>
                <p className="eyebrow">منطقة الشحن</p>
                <div className="shipping-choice-grid">
                  {props.shippingZones.map((zone) => (
                    <button
                      className={props.shippingZoneId === zone.id ? "selected" : ""}
                      type="button"
                      key={zone.id}
                      onClick={() => props.setShippingZoneId(zone.id)}
                    >
                      <strong>{zone.name}</strong>
                      <span>{zone.city || "كل المدن"} · {zone.estimatedDays || "حسب شركة الشحن"}</span>
                      <b>{formatPrice(zone.fee, displayCurrency)}</b>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <p className="eyebrow">كوبون الخصم</p>
            <div className="discount-apply-box">
              <input
                aria-label="Discount code"
                value={props.discountCode}
                onChange={(event) => props.setDiscountCode(event.target.value)}
                placeholder="WELCOME10"
              />
              <button type="button" onClick={props.applyDiscount} disabled={!props.cart.length || !props.discountCode.trim()}>
                تطبيق
              </button>
              {props.appliedDiscount ? (
                <span>تم تطبيق {props.appliedDiscount.name}</span>
              ) : props.discountError ? (
                <em>{props.discountError}</em>
              ) : null}
            </div>
            <p className="eyebrow">طريقة الدفع</p>
            <div className="payment-choice-grid">
              {paymentMethods.map((method) => (
                <button
                  className={props.paymentMethod === method ? "selected" : ""}
                  type="button"
                  key={method}
                  onClick={() => props.setPaymentMethod(method)}
                >
                  {paymentLabels[method] ?? method}
                </button>
              ))}
            </div>
            {props.settings?.shippingPolicy ? (
              <div className="shipping-policy-box">
                <strong>الشحن</strong>
                <span>{props.settings.shippingPolicy}</span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="checkout-panel checkout-summary-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ملخص الطلب</p>
              <h2>السلة</h2>
            </div>
            <ShoppingBag size={20} />
          </div>
          <div className="cart-lines">
            {props.cart.length ? (
              props.cart.map((line) => (
                <article className="cart-line" key={getLineKey(line.product.id, line.variant?.id)}>
                  <div>
                    <strong>{line.product.name}</strong>
                    {line.variant ? (
                      <em>{line.variant.optionName}: {line.variant.optionValue} · {line.variant.sku || "بدون SKU"}</em>
                    ) : null}
                    <span>{formatPrice(lineTotal(line), line.product.currency)}</span>
                  </div>
                  <div className="quantity-control">
                    <button
                      type="button"
                      onClick={() => props.changeQuantity(getLineKey(line.product.id, line.variant?.id), line.quantity - 1)}
                    >
                      <Minus size={14} />
                    </button>
                    <b>{line.quantity}</b>
                    <button
                      type="button"
                      onClick={() => props.changeQuantity(getLineKey(line.product.id, line.variant?.id), line.quantity + 1)}
                    >
                      <Plus size={14} />
                    </button>
                    <button type="button" onClick={() => props.removeLine(getLineKey(line.product.id, line.variant?.id))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-cart">السلة فارغة</p>
            )}
          </div>
          <div className="checkout-totals">
            <div>
              <span>المنتجات</span>
              <strong>{formatPrice(props.subtotal, displayCurrency)}</strong>
            </div>
            <div>
              <span>الشحن</span>
              <strong>{formatPrice(props.shippingFee, displayCurrency)}</strong>
            </div>
            <div>
              <span>الخصم</span>
              <strong>-{formatPrice(props.discountAmount, displayCurrency)}</strong>
            </div>
            <div className="checkout-total">
              <span>الإجمالي</span>
              <strong>{formatPrice(props.total, displayCurrency)}</strong>
            </div>
          </div>
          <button className="checkout-button" type="button" onClick={props.checkout} disabled={!props.cart.length}>
            <Check size={18} />
            تأكيد الطلب
          </button>
        </aside>
      </div>
    </section>
  );
}

function TrackingPage(props: {
  currency: string;
  error: string;
  loading: boolean;
  orderId: string;
  orders: TrackedOrder[];
  phone: string;
  setOrderId: (value: string) => void;
  setPage: (page: Page) => void;
  setPhone: (value: string) => void;
  submitTracking: () => void;
}) {
  return (
    <section className="tracking-page">
      <button className="back-button" type="button" onClick={() => props.setPage("catalog")}>
        <ChevronLeft size={18} />
        العودة للمتجر
      </button>

      <div className="tracking-grid">
        <div className="tracking-form-panel">
          <p className="eyebrow">تتبع الطلب</p>
          <h1>حالة الطلب برقم الهاتف</h1>
          <div className="tracking-form">
            <input
              aria-label="Tracking phone"
              value={props.phone}
              onChange={(event) => props.setPhone(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.submitTracking();
              }}
              placeholder="رقم الهاتف"
            />
            <input
              aria-label="Tracking order id"
              value={props.orderId}
              onChange={(event) => props.setOrderId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.submitTracking();
              }}
              placeholder="رقم الطلب اختياري"
            />
            <button type="button" onClick={props.submitTracking} disabled={props.loading}>
              <Search size={18} />
              {props.loading ? "جاري البحث" : "بحث"}
            </button>
          </div>
          {props.error ? <div className="tracking-message">{props.error}</div> : null}
        </div>

        <div className="tracking-results">
          {props.orders.map((order) => (
            <article className="tracked-order-card" key={order.id}>
              <div className="tracked-order-head">
                <div>
                  <p className="eyebrow">طلب #{order.id.slice(0, 8)}</p>
                  <h2>{orderStatusLabels[order.status] ?? order.status}</h2>
                </div>
                <ClipboardList size={22} />
              </div>

              <div className="tracking-status-line">
                {order.status === "cancelled" ? (
                  <span className="cancelled">ملغي</span>
                ) : orderStatusFlow.map((status) => {
                  const currentIndex = orderStatusFlow.indexOf(order.status as (typeof orderStatusFlow)[number]);
                  const statusIndex = orderStatusFlow.indexOf(status);

                  return (
                    <span className={statusIndex <= currentIndex ? "done" : ""} key={status}>
                      {orderStatusLabels[status]}
                    </span>
                  );
                })}
              </div>

              <div className="tracked-order-meta">
                <div>
                  <span>العميل</span>
                  <strong>{order.customerName}</strong>
                </div>
                <div>
                  <span>المدينة</span>
                  <strong>{order.customerCity || "غير محددة"}</strong>
                </div>
                <div>
                  <span>الدفع</span>
                  <strong>{paymentStatusLabels[order.paymentStatus] ?? order.paymentStatus}</strong>
                </div>
                <div>
                  <span>الإجمالي</span>
                  <strong>{formatPrice(order.total, props.currency)}</strong>
                </div>
              </div>

              <div className="tracked-items">
                {order.items.map((item) => (
                  <div key={item.id}>
                    <span>{item.quantity} × {item.productName}</span>
                    <strong>{formatPrice(item.lineTotal, props.currency)}</strong>
                  </div>
                ))}
              </div>

              <div className="tracked-events">
                {order.events.map((event) => (
                  <div key={event.id}>
                    <span>{new Date(event.createdAt).toLocaleString("ar-LY")}</span>
                    <strong>{event.title}</strong>
                    <em>{event.message}</em>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
