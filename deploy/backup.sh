#!/usr/bin/env bash
# Backup SQLite DB + uploaded images
# Cron: 0 3 * * * /var/www/moken/deploy/backup.sh
set -euo pipefail

BACKUP_DIR="/var/backups/moken"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%d-%H%M%S)

# Use SQLite's online backup (safe while DB is in use)
sqlite3 /var/www/moken/apps/api/data/store.sqlite ".backup '$BACKUP_DIR/store-$STAMP.sqlite'"

# Compress uploads
tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C /var/www/moken/apps/api/data uploads 2>/dev/null || true

# Keep last 14 days only
find "$BACKUP_DIR" -name "store-*.sqlite" -mtime +14 -delete
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +14 -delete

echo "[$(date -u)] Backup complete: $BACKUP_DIR/store-$STAMP.sqlite"
