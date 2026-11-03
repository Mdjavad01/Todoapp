#!/usr/bin/env bash
# ============================================================================
# کارام — ساخت «پک استقرار کامل هاست»
# قرارداد تحویل (از بهار v1.10): هر انتشار = یک پک کامل و مستقل که هاست را از
# هر وضعیت پشتیبانی‌شده مستقیم به همین نسخه می‌رساند — اپ + پنل + API + همه‌ی
# SQLها (نسخه‌ای + تجمعی + install) + README-نصب.md (گام‌ها + بازگشت هر گام) +
# نصب.txt + CHECKSUMS.sha256. هیچ رازی داخل بسته نیست.
#
# استفاده:  bash scripts/build-host-pack.sh vN.N
# خروجی:    /home/z/my-project/public/karam-host-update-vN.N.zip
# پیش‌نیاز: scripts/README-نصب-vN.N.md وجود داشته باشد (راهنمای رسمی همین نسخه)
# ============================================================================
set -euo pipefail
VER="${1:?usage: build-host-pack.sh vN.N}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="/tmp/karam-host-pack-$VER"
OUT="/home/z/my-project/public/karam-host-update-$VER.zip"
README_SRC="$ROOT/scripts/README-نصب-$VER.md"

# — گاردها: پک فقط از وضعیت تمیز گیت ساخته می‌شود —
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "✗ درخت کاری گیت تمیز نیست — پک باید دقیقاً از وضعیت تأییدشده ساخته شود:" >&2
  git -C "$ROOT" status --short >&2
  exit 1
fi
[ -f "$README_SRC" ] || { echo "✗ $README_SRC نیست — اول راهنمای رسمی این نسخه را بنویسید." >&2; exit 1; }
[ -f "$ROOT/frontend/dist/index.html" ] || { echo "✗ frontend/dist نیست — اول بیلد وب (bun run build در frontend)." >&2; exit 1; }
[ -f "$ROOT/frontend/admin/dist/index.html" ] || { echo "✗ frontend/admin/dist نیست — اول بیلد پنل." >&2; exit 1; }
[ -f "$ROOT/backend/public/index.php" ] || { echo "✗ backend نیست." >&2; exit 1; }

rm -rf "$STAGE"
mkdir -p "$STAGE/api/storage/cache" "$STAGE/api/storage/logs" "$STAGE/panel" "$STAGE/deploy"

# ۱) ریشه‌ی وب‌اپ (بیلد تازه + htaccess مخفی)
cp -r "$ROOT/frontend/dist/." "$STAGE/"
cp "$ROOT/frontend/public/.htaccess" "$STAGE/.htaccess"

# ۲) پنل ادمین
cp -r "$ROOT/frontend/admin/dist/." "$STAGE/panel/"

# ۳) API کامل + کرون‌ها — بدون .env و بدون storage واقعی هاست
cp "$ROOT/backend/public/index.php" "$STAGE/api/index.php"
cp "$ROOT/backend/public/.htaccess" "$STAGE/api/.htaccess"
cp -r "$ROOT/backend/src" "$STAGE/api/src"
cp -r "$ROOT/backend/cron" "$STAGE/api/cron"
cp "$ROOT/backend/storage/.htaccess" "$STAGE/api/storage/.htaccess"
cp "$ROOT/backend/storage/.htaccess" "$STAGE/api/storage/cache/.htaccess"
touch "$STAGE/api/storage/logs/.gitkeep"

# ۴) همه‌ی SQLها — نسخه‌ای (v0.5…v1.10) + تجمعی + install
cp "$ROOT"/deploy/*.sql "$STAGE/deploy/"

# ۵) راهنماها (نام داخل بسته ثابت است: README-نصب.md و نصب.txt)
cp "$README_SRC" "$STAGE/README-نصب.md"
cp "$ROOT/scripts/نصب.txt" "$STAGE/نصب.txt"

# ۶) CHECKSUMS — همه‌ی فایل‌ها حتی مخفی‌ها، مرتب‌شده، بدون خود CHECKSUMS
cd "$STAGE"
find . -type f ! -name CHECKSUMS.sha256 -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > CHECKSUMS.sha256

# ۷) zip نهایی
rm -f "$OUT"
zip -qr "$OUT" .
FILES=$(find . -type f | wc -l)
echo "پک ساخته شد: $OUT"
echo "— شمار فایل‌های داخل بسته: $FILES — حجم: $(du -h "$OUT" | cut -f1)"

# ۸) راستی‌آزمایی خودکار: استخراج + sha256sum -c + گارد نام خراب (mojibake)
VERIFY="/tmp/karam-host-pack-verify-$VER"
rm -rf "$VERIFY" && mkdir -p "$VERIFY"
unzip -q "$OUT" -d "$VERIFY"
( cd "$VERIFY" && sha256sum -c CHECKSUMS.sha256 --quiet ) && echo "✅ CHECKSUMS: همه‌ی $FILES فایل OK"
if find "$VERIFY" -type f \( -name '*╪*' -o -name '*┘*' -o -name '*╪╪*' \) | grep -q .; then
  echo "❌ نام فایل mojibake داخل بسته پیدا شد — ساخت را رد کنید!" >&2
  exit 1
fi
echo "✅ بدون نام mojibake — پک استقرار کامل آماده است."
echo "— فایل‌های SQL داخل deploy/: $(ls "$STAGE/deploy" | wc -l)"
