import { Building2, ExternalLink, ShoppingBag, Store } from "lucide-react";

function appUrl(kind: "company" | "merchant" | "store") {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";

  if (isLocal) {
    return {
      company: "http://localhost:5174",
      merchant: "http://localhost:5175",
      store: "http://localhost:5176"
    }[kind];
  }

  return {
    company: import.meta.env.VITE_COMPANY_URL || "https://company.moken-store.cloud",
    merchant: import.meta.env.VITE_MERCHANT_URL || "https://merchant.moken-store.cloud",
    store: import.meta.env.VITE_STOREFRONT_URL || "https://store.moken-store.cloud"
  }[kind];
}

export function App() {
  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="brand-pill">
          <ShoppingBag size={18} />
          Moken Store SaaS
        </div>
        <h1>منصة متاجر مستقلة، سريعة، وقابلة للتخصيص.</h1>
        <p>
          هذه الصفحة بوابة فقط. إدارة الشركة، إدارة المتجر، وواجهة المتجر تعمل كتطبيقات منفصلة بالكامل على منافذ وروابط مختلفة.
        </p>
        <div className="route-grid">
          <a className="route-card" href={appUrl("store")}>
            <Store size={24} />
            <strong>واجهة المتجر</strong>
            <span>الكتالوج، تفاصيل المنتجات، السلة، إتمام الطلب، وتتبع الطلب.</span>
            <b>
              فتح المتجر
              <ExternalLink size={15} />
            </b>
          </a>
          <a className="route-card" href={appUrl("merchant")}>
            <ShoppingBag size={24} />
            <strong>إدارة المتجر</strong>
            <span>المنتجات، التصنيفات، الطلبات، الشحن، الخصومات، الصور، والفريق.</span>
            <b>
              دخول التاجر
              <ExternalLink size={15} />
            </b>
          </a>
          <a className="route-card" href={appUrl("company")}>
            <Building2 size={24} />
            <strong>إدارة الشركة</strong>
            <span>إدارة المتاجر والعملاء وحالة المنصة من لوحة مستقلة.</span>
            <b>
              دخول الشركة
              <ExternalLink size={15} />
            </b>
          </a>
        </div>
      </section>
    </main>
  );
}
