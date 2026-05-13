#!/usr/bin/env bash
# Install Nginx config and reload
set -euo pipefail

echo "==> Installing Moken site config"
cp /var/www/moken/deploy/nginx.conf /etc/nginx/sites-available/moken
ln -sf /etc/nginx/sites-available/moken /etc/nginx/sites-enabled/moken

# Remove the default site to avoid conflicts with default_server
rm -f /etc/nginx/sites-enabled/default

echo "==> Creating log directory"
mkdir -p /var/log/moken
chown -R moken:moken /var/log/moken

echo "==> Testing config"
nginx -t

echo "==> Reloading Nginx"
systemctl reload nginx
systemctl enable nginx

echo ""
echo "============================================"
echo "✅ Nginx configured"
echo "============================================"
echo "Sites enabled:"
ls -la /etc/nginx/sites-enabled/
echo ""
echo "Status:"
systemctl status nginx --no-pager -l | head -n 8
echo "============================================"
