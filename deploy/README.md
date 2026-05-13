# دليل نقل Moken Store SaaS إلى VPS (Hostinger KVM 2)

> Ubuntu 24.04 · Node 22 · Nginx · PM2 · SQLite

## 🎯 ملخص المعمارية الجديدة

```
                         ┌─────────────────────────────┐
                         │  Cloudflare DNS             │
                         │  *.moken-saas.online → IP   │
                         └──────────────┬──────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │   VPS (Nginx 80)  │
                              └─────────┬─────────┘
              ┌───────────────┬─────────┴─────────┬───────────────┐
              ▼               ▼                   ▼               ▼
       api.moken-saas    company.moken     merchant.moken    *.moken-saas
       Express :4100     static SPA        static SPA        Storefront SPA
              │
              ▼
     SQLite + uploads/
```

**فرق جوهري عن الإعداد المحلي:**
- لا توجد حاجة لـ `cloudflared tunnel` ولا لـ `edge-router.mjs`
- Nginx يحل محلهما (أسرع وأبسط)
- DNS عادي يشير لـ IP الخادم مباشرة
- Apps تُبنى للإنتاج (Vite production build)، API بـ TypeScript compiled

---

## 📋 المتطلبات قبل البدء

- VPS مع Ubuntu 24.04 + root SSH access
- نطاق `moken-saas.online` مع وصول لـ Cloudflare DNS
- مفتاح SSH (موصى به) أو كلمة مرور root

---

## 🚀 خطوات النقل (مرة واحدة)

### الخطوة 1: تجهيز الخادم

```powershell
# من جهازك، اتصل بالـ VPS
ssh root@YOUR_VPS_IP

# انسخ سكربت الإعداد
nano /tmp/setup-server.sh    # الصق محتوى deploy/setup-server.sh
bash /tmp/setup-server.sh
```

أو ارفع السكربت أولاً ثم نفّذه:

```powershell
scp deploy/setup-server.sh root@YOUR_VPS_IP:/tmp/
ssh root@YOUR_VPS_IP "bash /tmp/setup-server.sh"
```

### الخطوة 2: رفع المشروع

```powershell
# من جهازك (PowerShell من مجلد المشروع)
.\deploy\upload.ps1 -VpsIp YOUR_VPS_IP
```

### الخطوة 3: بناء التطبيقات وتشغيلها

```powershell
ssh root@YOUR_VPS_IP "bash /var/www/moken/deploy/install-app.sh"
```

سترى عند النجاح:
```
✅ App installed & started
moken-api  │ online │ pid: 1234
```

### الخطوة 4: تثبيت Nginx

```powershell
ssh root@YOUR_VPS_IP "bash /var/www/moken/deploy/install-nginx.sh"
```

### الخطوة 5: إعداد Cloudflare DNS

في dashboard `cloudflare.com` → `moken-saas.online` → DNS → Records:

**احذف أي records قديمة** (التي كانت تشير لـ cloudflared tunnel)، وأضف:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| A | `@` | `YOUR_VPS_IP` | 🟠 Proxied |
| A | `*` | `YOUR_VPS_IP` | 🟠 Proxied |

**ذلك كل شيء!** نطاقان فقط (`@` و `*`) يغطّيان كل المتاجر الحالية والمستقبلية.

### الخطوة 6: SSL

Cloudflare Proxy (🟠 orange cloud) يوفر **HTTPS تلقائياً** بدون أي إعدادات إضافية. اذهب لـ SSL/TLS → Overview → اختر **Full** (أو Flexible كبداية).

> إذا أردت SSL على مستوى الخادم نفسه (موصى به للأمان الكامل)، استخدم certbot:
> ```bash
> apt install -y certbot python3-certbot-nginx
> certbot --nginx -d moken-saas.online -d "*.moken-saas.online" --email you@example.com --agree-tos
> ```

### الخطوة 7: الإصدار الأول من النسخ الاحتياطي

```bash
ssh root@YOUR_VPS_IP
crontab -e
# أضف هذا السطر:
0 3 * * * /var/www/moken/deploy/backup.sh >> /var/log/moken/backup.log 2>&1
```

النسخ الاحتياطي يومياً الساعة 3 صباحاً UTC، يحفظ آخر 14 يوماً في `/var/backups/moken/`.

---

## ✅ التحقق من النجاح

```bash
# على الخادم
pm2 status                                       # moken-api online
systemctl status nginx                           # active
curl -I http://localhost:4100/api/health         # 200 + {"ok":true}

# من المتصفح أو PowerShell
https://api.moken-saas.online/api/health         # JSON صحيح
https://company.moken-saas.online                # لوحة الشركة
https://merchant.moken-saas.online               # لوحة التاجر
https://moken-saas.online                        # Landing
https://أي_متجر.moken-saas.online                # storefront تلقائياً
```

---

## 🔄 التحديثات اللاحقة

كل ما تحدّث الكود، فقط:

```powershell
.\deploy\upload.ps1 -VpsIp YOUR_VPS_IP
ssh root@YOUR_VPS_IP "cd /var/www/moken && npm ci && npm run build && pm2 restart moken-api && systemctl reload nginx"
```

أو اختصرها في سكربت `redeploy.ps1`.

---

## 🛠️ أوامر مفيدة

```bash
# مراقبة API
pm2 logs moken-api
pm2 monit

# إعادة تشغيل
pm2 restart moken-api
systemctl reload nginx

# مراقبة Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# نسخة احتياطية يدوية
/var/www/moken/deploy/backup.sh
ls -lh /var/backups/moken/

# مساحة القرص
df -h
du -sh /var/www/moken/apps/api/data/
```

---

## 🆘 استكشاف الأخطاء

| المشكلة | الفحص |
|---------|--------|
| 502 Bad Gateway | `pm2 status` - هل moken-api شغّال؟ |
| 404 لكل subdomain | `nginx -t` ثم `systemctl reload nginx` |
| DNS لا يتحول | تحقق من Cloudflare DNS records (Proxied) |
| API يرفض CORS | راجع `apps/api/.env` ALLOWED_ORIGINS |
| Database مفقودة | `ls /var/www/moken/apps/api/data/` |

---

## 📈 الميزات المكتسبة بعد النقل

- ✅ Uptime 99.9% بدون اعتماد على جهازك
- ✅ Wildcard subdomain يعمل فوراً (لا حاجة لتحديث Cloudflare لكل متجر جديد)
- ✅ HTTPS تلقائي عبر Cloudflare
- ✅ Nginx caching + gzip للأصول
- ✅ Auto-restart للـ API عند الأعطال (PM2)
- ✅ Auto-start عند إعادة تشغيل الخادم
- ✅ Backups يومية لـ DB + uploads
- ✅ Firewall + fail2ban
- ✅ Production builds (×10 أصغر وأسرع من dev)
