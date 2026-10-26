#!/usr/bin/env bash
# کارام — ساخت پک نصب سه‌بخشی (اپ + پنل + API)
# استفاده: bash build-pack.sh v18
set -euo pipefail
VER="${1:?usage: build-pack.sh vNN}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # hojre24-tasks/
STAGE="/tmp/karam-pack-$VER"
OUT="/home/z/my-project/public/karam-fix-$VER.zip"

rm -rf "$STAGE" && mkdir -p "$STAGE/api/storage/cache" "$STAGE/api/storage/logs" "$STAGE/deploy"

# ۱) ریشه اپ (dist) + htaccess اپ
cp -r "$ROOT/frontend/dist/." "$STAGE/"
cp "$ROOT/frontend/public/.htaccess" "$STAGE/.htaccess"

# ۲) پنل ادمین
mkdir -p "$STAGE/panel"
cp -r "$ROOT/frontend/admin/dist/." "$STAGE/panel/"

# ۳) API کامل + کرون (v19: کرون تلگرام + کرون بکاپ روزانه)
cp "$ROOT/backend/public/index.php" "$STAGE/api/index.php"
cp "$ROOT/backend/public/.htaccess" "$STAGE/api/.htaccess"
cp -r "$ROOT/backend/src" "$STAGE/api/src"
cp -r "$ROOT/backend/cron" "$STAGE/api/cron"
cp "$ROOT/backend/storage/.htaccess" "$STAGE/api/storage/.htaccess"
cp "$ROOT/backend/storage/.htaccess" "$STAGE/api/storage/cache/.htaccess"
cp "$ROOT/backend/storage/logs/.gitkeep" "$STAGE/api/storage/logs/.gitkeep" 2>/dev/null || touch "$STAGE/api/storage/logs/.gitkeep"

# ۴) SQL ارتقا + راهنمای نصب
cp "$ROOT"/deploy/upgrade-*.sql "$STAGE/deploy/"
cp "$ROOT/scripts/نصب.txt" "$STAGE/نصب.txt"

# ۵) zip نهایی (همراه فایل‌های مخفی .htaccess)
rm -f "$OUT"
cd "$STAGE" && zip -qr "$OUT" .
echo "پک ساخته شد: $OUT"
unzip -l "$OUT" | tail -2
