#!/bin/bash
# Nightly Mautic backup to Cloudflare R2 (any S3-compatible bucket works).
# Install: copy to ~/backup.sh, configure the rclone remote "r2" (guide Part 10),
# set BUCKET, chmod +x, run once by hand, then cron it.
set -euo pipefail

REMOTE="r2:YOURNAME-mautic-backups"
STACK="$HOME/docker-mautic/examples/basic"
OUT="$HOME/backups"
D=$(date +%F)

mkdir -p "$OUT"
cd "$STACK"

# 1. Database. The db container already has MYSQL_ROOT_PASSWORD in its
#    environment, so the single quotes are deliberate: it expands inside it.
docker compose exec -T db sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --all-databases' \
  | gzip > "$OUT/db-$D.sql.gz"

# 2. Files. Config (including local.php), media and logs are bind-mounted
#    folders under ./mautic, not a Docker volume. They are owned by www-data,
#    so tar them from a throwaway container instead of needing sudo.
docker run --rm -v "$STACK/mautic":/data:ro -v "$OUT":/out alpine \
  tar czf "/out/files-$D.tar.gz" -C /data .

# 3. Ship off the box, then prune: 7 days locally, 30 days in the bucket.
rclone copy "$OUT" "$REMOTE" --include "*-$D.*"
rclone delete "$REMOTE" --min-age 30d
find "$OUT" -type f -mtime +7 -delete

echo "backup $D ok"
