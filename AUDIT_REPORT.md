# تقرير مشاكل الروابط، النطاقات الفرعية، الفصل بين التطبيقات، وصفحات الدخول

> تاريخ التقرير: 2026-05-13
> المشروع: Moken Store SaaS — Multi-tenant E-commerce Platform

---

## ملخص تنفيذي

تم اكتشاف **12 مشكلة** موزّعة على 4 فئات:

| # | الفئة | عدد المشاكل | الخطورة |
|---|------|-------------|----------|
| 1 | Routing & Cloudflare | 3 | 🔴 حرجة |
| 2 | تطبيق `apps/web` المكرر | 4 | 🔴 حرجة |
| 3 | صفحات تسجيل الدخول | 2 | 🟠 عالية |
| 4 | فصل التطبيقات و CSS | 3 | 🟡 متوسطة |

---

## 1. مشاكل Routing و Cloudflare 🔴

### 1.1 Remote config يطغى على YAML المحلي ⛔
**الحالة الراهنة:**
```
moken-saas.online           → localhost:5173  (web)
www.moken-saas.online       → localhost:5173  (web)
company.moken-saas.online   → localhost:5173  (web)  ❌ يجب: 5174
merchant.moken-saas.online  → localhost:5173  (web)  ❌ يجب: 5175
store.moken-saas.online     → 403 Forbidden    ❌ غير مكوّن
api.moken-saas.online       → localhost:4100  ✓
```

**التأثير:** المستخدمون يصلون لـ `company.moken-saas.online` ويرون تطبيق `apps/web` القديم (بدون auth صحيح، بدون معالجة 401)، لا `apps/company-admin` المحدّث.

**الإصلاح:**
- يدوياً عبر [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com) → Networks → Tunnels → moken-saas → Public Hostname
- لا يمكن إصلاحها من ملف YAML أبداً ما دام النفق مرتبط بـ dashboard

**الإعدادات الصحيحة المطلوبة:**

| Subdomain | Service URL | App |
|-----------|-------------|-----|
| (root) | `http://localhost:5173` | web (landing) |
| www | `http://localhost:5173` | web |
| store | `http://localhost:5176` | storefront |
| company | `http://localhost:5174` | company-admin |
| merchant | `http://localhost:5175` | store-admin |
| api | `http://localhost:4100` | API |

### 1.2 store.moken-saas.online غير مكوّن أصلاً (403)
**الفحص:** `Invoke-WebRequest https://store.moken-saas.online/` يرجع 403 Forbidden، أي Cloudflare ما يعرف هذا الـ hostname.

**في `seed.ts:57`:** الـ tenant_domains يحتوي `store.moken-saas.online` كنطاق للـ demo tenant، لكن لا يوجد Public Hostname مطابق في Cloudflare.

**الإصلاح:** أضف Public Hostname جديد في dashboard:
- Subdomain: `store`
- Domain: `moken-saas.online`
- Service: `http://localhost:5176`

### 1.3 ملف YAML المحلي يخلط منافذ غير متوافقة مع dashboard
**الموقع:** `C:\Users\Malik\.cloudflared\moken-saas-config.yml`

```yaml
- hostname: moken-saas.online
  service: http://localhost:5176  ❌ web موجود على 5173
- hostname: store.moken-saas.online
  service: http://localhost:5176  ✓
```

**التضارب:** الملف المحلي يضع root + www + store على 5176 (storefront)، لكن:
- web (port 5173) يحتوي على EntryGateway الذي يستحق أن يكون landing
- storefront (5176) يجب أن يكون فقط لـ store subdomain

**الإصلاح:** بعد تحديث dashboard، يمكن حذف هذا الملف لأنه غير مستخدم فعلياً. أو تحديث root → 5173.

---

## 2. مشاكل `apps/web` التطبيق المكرر 🔴

### 2.1 web يكرّر وظائف company-admin + store-admin معاً
**الموقع:** `apps/web/src/App.tsx`

يحتوي على:
- EntryGateway (شاشة اختيار: company أو store-admin)
- نفس forms لإنشاء tenants (مكرر مع company-admin)
- نفس forms لإنشاء products (مكرر مع store-admin)
- routing داخلي بـ `path` state بدلاً من React Router

**التأثير:**
- تكرار الكود (~470 سطر مكررة)
- أي تحديث في company-admin أو store-admin لا ينعكس في web
- المستخدم يرى نسختين مختلفتين من نفس الواجهة

**الإصلاح المقترح:** اختر واحد من:
- **(أ) تقليص web ليكون landing page فقط** (موصى به): إزالة forms والاحتفاظ بـ EntryGateway فقط مع روابط للتطبيقات الأخرى
- **(ب) حذف web كاملاً** ونقل `/` و `/www` إلى storefront مع شاشة hero

### 2.2 web/api.ts بدون Bearer Authentication
**الموقع:** `apps/web/src/api.ts:30-46`

```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      "x-store-domain": import.meta.env.VITE_STORE_DOMAIN ?? "demo.localhost",
      // ❌ لا يوجد Authorization header
    }
  });
  ...
}
```

**التأثير:** كل استدعاءات `/admin/*` و `/store/*` تفشل بـ 401 لأن لا يوجد token. هذا سبب رسالة "Login is required" التي رآها المستخدم.

**الإصلاح:** إما:
- إزالة استدعاءات الـ admin/store من web كاملاً (الموصى به ضمن تقليص web)
- أو إضافة auth flow كامل مثل company-admin

### 2.3 web بدون شاشة تسجيل دخول
رغم استدعائه endpoints محمية، web لا يحتوي على نموذج login. يعرض المستخدم على شاشة الـ dashboard مع errors فقط.

### 2.4 web/api.ts بدون معالجة 401
على عكس company-admin و store-admin، web لا يستخدم `onSessionExpired` ولا يحوّل لشاشة دخول عند انتهاء الجلسة.

---

## 3. مشاكل صفحات تسجيل الدخول 🟠

### 3.1 الحالة الحالية في كل التطبيقات

| التطبيق | شاشة دخول | معالجة 401 | تخزين token | endpoint /auth/me عند الإقلاع |
|---------|------------|------------|--------------|-------------------------------|
| company-admin | ✅ موجودة | ✅ تم إصلاحها | localStorage `moken.company.authToken` | ✅ |
| store-admin | ✅ موجودة | ✅ تم إصلاحها | localStorage `moken.store.authToken` | ✅ |
| storefront | ⚪ لا تحتاج (عام) | ⚪ غير مطلوب | — | ⚪ |
| **web** | ❌ مفقودة | ❌ مفقودة | — | ❌ |

### 3.2 storefront يستخدم x-store-domain خاطئ في بعض الحالات
**الموقع:** `apps/storefront/src/api.ts:40`

```ts
const host = window.location.hostname;
if (host === "localhost" || host === "127.0.0.1") {
  return "demo.localhost";
}
return host;
```

عند الوصول من `store.moken-saas.online`، يرسل `x-store-domain: store.moken-saas.online` — وهذا في seed.ts موجود كـ tenant_domains، فيجب أن يعمل. لكن إن أحد لم يُسجَّل في DB، تفشل العملية.

---

## 4. مشاكل فصل التطبيقات و CSS 🟡

### 4.1 styles.css مكرر في 4 تطبيقات
**المواقع:**
- `apps/web/src/styles.css` (`.utility-link` السطر 161)
- `apps/store-admin/src/styles.css` (السطر 179)
- `apps/storefront/src/styles.css` (السطر 1002)
- `apps/company-admin/src/styles.css` (السطر 178)

**التأثير:** أي تعديل تصميمي يجب تكراره 4 مرات. وقد يحدث drift بين التطبيقات.

**الإصلاح المقترح:** إنشاء `packages/ui-styles/` يحتوي CSS مشترك وكل تطبيق يستورده.

### 4.2 store-admin يحوّل `merchant.moken-saas.online` إلى `demo.localhost`
**الموقع:** `apps/store-admin/src/api.ts:66`

```ts
if (host === "localhost" || host === "127.0.0.1" || host === "merchant.moken-saas.online") {
  return "demo.localhost";
}
```

**المنطق:** المنطقي لأن merchant.moken-saas.online هو نطاق لوحة الإدارة، ليس نطاق المتجر. يستخدم demo كافتراضي حتى يسجّل المستخدم الدخول ويتم تخزين `tenant.primaryDomain` في localStorage.

**المخاطر:** لو كانت هناك tenants متعددة، أي تاجر يسجل دخول من merchant.moken-saas.online يبدأ بـ demo data حتى يستجيب login.

### 4.3 روابط بين-تطبيقات hardcoded
**المواقع:**
- `company-admin/App.tsx:191`: `<a href="https://merchant.moken-saas.online">`
- `store-admin/App.tsx:1077`: `<a href="https://company.moken-saas.online">`

**التأثير:** عند التطوير المحلي على localhost، هذه الروابط تذهب للإنتاج.

**الإصلاح:** استخدام env var:
```ts
const merchantUrl = import.meta.env.VITE_MERCHANT_URL || "https://merchant.moken-saas.online";
```

---

## 5. ترتيب التنفيذ الموصى به

### 🚨 عاجل (احتمال انقطاع المستخدمين عن الخدمة):

1. **تحديث Cloudflare dashboard** (المشكلة 1.1) — لا يمكن استخدام company/merchant/store حتى يتم
2. **إضافة Public Hostname لـ store** (1.2)
3. **تقليص web إلى landing page** أو حذفه (2.1-2.4)

### 📋 مهم (تحسينات أساسية):

4. **توحيد CSS في package مشترك** (4.1)
5. **استخدام env vars للروابط** بدل hardcode (4.3)
6. **إنشاء حسابات tenants متعددة** للاختبار الحقيقي multi-tenant (4.2)

### 🔧 اختياري (جودة):

7. توثيق آلية الـ tenant resolution
8. اختبارات E2E لتدفق تسجيل الدخول
9. مراقبة الأخطاء (Sentry/LogRocket) للالتقاط 401s غير متوقعة

---

## 6. الإصلاحات المُنجَزة سابقاً (للمرجعية)

| ✅ | الإصلاح | الموقع |
|----|---------|---------|
| ✅ | معالجة 401 في company-admin + store-admin | `api.ts` + `App.tsx` |
| ✅ | CORS مفتوح لكل نطاقات الإنتاج | `apps/api/.env` |
| ✅ | إعادة بناء FTS5 لحل corruption | `db.ts` |
| ✅ | شاشات تسجيل دخول لكلا التطبيقين | `App.tsx` |

---

## 7. أوامر فحص سريعة

```powershell
# تأكد المنافذ شغّالة
4100,5173,5174,5175,5176 | % { (Get-NetTCPConnection -State Listen -LocalPort $_ -EA SilentlyContinue) -ne $null }

# اختبر النطاقات
"moken-saas.online","company.moken-saas.online","merchant.moken-saas.online","store.moken-saas.online","api.moken-saas.online" |
  % { try { (Invoke-WebRequest "https://$_/" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "ERR" } }

# تحقق من النفق
cloudflared tunnel info acd52331-7221-42d2-ad13-027a74bf62dc
```

---

## خاتمة

**السبب الجذري الأساسي للمشاكل الحالية:** Cloudflare dashboard config يوجّه `company` و `merchant` إلى تطبيق `web` القديم بدل التطبيقات الصحيحة، فيرى المستخدم نسخة قديمة بدون auth flow ويواجه أخطاء 401 المستمرة.

**الحلّان الواجبان:**
1. تحديث Public Hostnames في Cloudflare dashboard (لا يمكن تجاوزه)
2. تقليص أو حذف `apps/web` لتفادي ارتباك مستقبلي

بعد هذين الإصلاحين، التطبيق سيكون جاهزاً للإنتاج بشكل كامل.
