#!/usr/bin/env bash
# Moken Store SaaS — Server Bootstrap
# Run once as root on a fresh Ubuntu 24.04 VPS:
#   bash setup-server.sh
set -euo pipefail

echo "==> [1/8] Updating system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> [2/8] Installing base packages"
apt-get install -y \
  build-essential git curl wget unzip ca-certificates gnupg lsb-release \
  ufw fail2ban nginx sqlite3 cron rsync logrotate \
  python3 python3-pip software-properties-common

echo "==> [3/8] Installing Node.js 22 LTS"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version
npm --version

echo "==> [4/8] Installing PM2 globally"
npm install -g pm2@latest
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

echo "==> [5/8] Configuring firewall (UFW)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "==> [6/8] Hardening fail2ban for SSH"
systemctl enable --now fail2ban

echo "==> [7/8] Creating deploy user 'moken'"
if ! id -u moken >/dev/null 2>&1; then
  useradd -m -s /bin/bash moken
  mkdir -p /home/moken/.ssh
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/moken/.ssh/authorized_keys
    chmod 600 /home/moken/.ssh/authorized_keys
  fi
  chown -R moken:moken /home/moken/.ssh
  chmod 700 /home/moken/.ssh
fi

echo "==> [8/8] Creating app directory"
mkdir -p /var/www/moken
chown -R moken:moken /var/www/moken

echo ""
echo "============================================"
echo "✅ Server bootstrap complete!"
echo "============================================"
echo "Next steps:"
echo "  1. Upload project: from your Windows PC run deploy/upload.ps1"
echo "  2. Build & start:   ssh root@<VPS_IP> 'bash /var/www/moken/deploy/install-app.sh'"
echo "  3. Configure Nginx: ssh root@<VPS_IP> 'bash /var/www/moken/deploy/install-nginx.sh'"
echo "  4. SSL via Cloudflare proxy (recommended)"
echo "============================================"
