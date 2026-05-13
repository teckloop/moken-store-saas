#!/usr/bin/env bash
# Install dependencies, build apps, and start with PM2
# Run as root from /var/www/moken:
#   bash deploy/install-app.sh
set -euo pipefail

cd /var/www/moken

echo "==> Installing dependencies (this may take a few minutes)"
npm ci --include=dev

echo "==> Building all apps for production"
npm run build

echo "==> Ensuring API .env exists"
if [ ! -f apps/api/.env ]; then
  cat > apps/api/.env <<'EOF'
PORT=4100
ALLOWED_ORIGINS=https://moken-store.cloud,https://www.moken-store.cloud,https://store.moken-store.cloud,https://company.moken-store.cloud,https://merchant.moken-store.cloud
EOF
fi

echo "==> Ensuring data directory exists"
mkdir -p apps/api/data/uploads
chown -R moken:moken apps/api/data || true

echo "==> Starting services with PM2"
pm2 delete moken-api moken-static 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs
pm2 save

echo ""
echo "============================================"
echo "✅ App installed & started"
echo "============================================"
pm2 status
echo "============================================"
echo "Tail logs:    pm2 logs"
echo "Restart all:  pm2 restart all"
echo "============================================"
