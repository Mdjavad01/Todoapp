/**
 * کارام — تولید همه‌ی آیکن‌ها از یک منبع وکتوری واحد (لوگوی رسمی ۱۴۰۴)
 *
 * طرح: مربع گرد روشن + سه میله (بالا/پایین روشن، وسط آبی) + تیک گرادیانی آبی
 * این اسکریپت فقط یک‌بار در توسعه اجرا می‌شود و خروجی‌ها کامیت می‌شوند:
 *   ۱) PWA:        frontend/public/icons/{icon-512,icon-192,icon-maskable-512,apple-touch-icon}.png + favicon.svg
 *   ۲) پنل ادمین:  frontend/admin/public/favicon.svg
 *   ۳) اندروید:    mobile/android … mipmap-{mdpi..xxxhdpi}/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png
 *   ۴) اسپلش:      mobile/android … drawable(land/port)-*(splash.png) همه‌ی تراکم‌ها
 *
 * اجرا:  node scripts/generate-icons.mjs   (یا bun scripts/generate-icons.mjs)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(__dirname, '..');
const repoRoot = join(frontendDir, '..');
const pwaOut = join(frontendDir, 'public', 'icons');
const adminOut = join(frontendDir, 'admin', 'public');
const resOut = join(repoRoot, 'mobile', 'android', 'app', 'src', 'main', 'res');

/* ---------- طرح وکتوری لوگو (فضای ۵۱۲×۵۱۲) — مطابق فایل رسمی طراح ---------- */

const BG = { from: '#FDFEFD', to: '#F1F4F9' }; // زمینه‌ی مربع: سفید → آبی‌خیلی‌روشن (مورب)
const BAR_LIGHT = '#D8E1F0'; // میله‌ی روشن (بالا و پایین)
const BAR_BLUE = '#4F83FB'; // میله‌ی وسط (آبی)
const CHK = { from: '#1E5BF2', to: '#4A9EFD' }; // تیک: تیره (پایین-چپ) → روشن (بالا-راست)
const RADIUS = 102; // شعاع گردی مربع (~۲۰٪)
// جعبه‌ی محتوا (میله‌ها + تیک) برای مرکز‌کردن در واریانت‌ها
const GLYPH = { x0: 93, y0: 121, x1: 460, y1: 425 };

/** گروه محتوا در فضای ۵۱۲ — بدون زمینه */
function glyph() {
  return `
  <rect x="93" y="121" width="264" height="60" rx="30" fill="${BAR_LIGHT}"/>
  <rect x="93" y="210" width="189" height="62" rx="31" fill="${BAR_BLUE}"/>
  <rect x="93" y="300" width="189" height="62" rx="31" fill="${BAR_LIGHT}"/>
  <path d="M196 332 L260 397 L432 190" fill="none" stroke="url(#chk)"
        stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * SVG آیکن در اندازه‌ی دلخواه
 * kind: full (مربع گرد) | bleed (تمام‌صفحه — maskable و apple-touch) | round (دایره)
 *       | fg (فقط محتوا — لایه‌ی foreground اندروید) | splash (زمینه‌ی سفید w×h)
 */
function svgFor(kind, size, sizeH) {
  const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG.from}"/>
      <stop offset="1" stop-color="${BG.to}"/>
    </linearGradient>
    <linearGradient id="chk" x1="0.15" y1="0.95" x2="0.9" y2="0.1">
      <stop offset="0" stop-color="${CHK.from}"/>
      <stop offset="1" stop-color="${CHK.to}"/>
    </linearGradient>
  </defs>`;

  if (kind === 'splash') {
    const w = size, h = sizeH ?? size;
    // عرض محتوا = ۳۰٪ ضلع کوچک؛ مرکز دقیق جعبه‌ی محتوا
    const s = (0.30 * Math.min(w, h)) / (GLYPH.x1 - GLYPH.x0);
    const cx = (GLYPH.x0 + GLYPH.x1) / 2, cy = (GLYPH.y0 + GLYPH.y1) / 2;
    const tx = w / 2 - cx * s, ty = h / 2 - cy * s;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${defs}
    <rect width="${w}" height="${h}" fill="#ffffff"/>
    <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${glyph()}</g>
  </svg>`;
  }

  const scale = kind === 'bleed' ? 0.78 : kind === 'round' ? 0.80 : kind === 'fg' ? 0.50 : 1;
  const inner =
    scale === 1
      ? glyph()
      : `<g transform="translate(${(256 * (1 - scale)).toFixed(2)} ${(256 * (1 - scale)).toFixed(2)}) scale(${scale})">${glyph()}</g>`;
  const bgShape =
    kind === 'round'
      ? `<circle cx="256" cy="256" r="256" fill="url(#bg)"/>`
      : kind === 'bleed' || kind === 'fg'
        ? kind === 'bleed'
          ? `<rect width="512" height="512" fill="url(#bg)"/>`
          : ''
        : `<rect width="512" height="512" rx="${RADIUS}" fill="url(#bg)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  ${defs}
  ${bgShape}
  ${inner}
</svg>`;
}

/** favicon.svg وکتوری (۴۸ پایه — بدون وابستگی به sharp) */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG.from}"/>
      <stop offset="1" stop-color="${BG.to}"/>
    </linearGradient>
    <linearGradient id="chk" x1="0.15" y1="0.95" x2="0.9" y2="0.1">
      <stop offset="0" stop-color="${CHK.from}"/>
      <stop offset="1" stop-color="${CHK.to}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${RADIUS}" fill="url(#bg)"/>
  ${glyph()}
</svg>`;

async function png(kind, size, file, sizeH) {
  await sharp(Buffer.from(svgFor(kind, size, sizeH)))
    .png()
    .toFile(file);
  console.log('✔', file.replace(repoRoot + '/', ''));
}

/* ---------- ۱) آیکن‌های PWA ---------- */
mkdirSync(pwaOut, { recursive: true });
await png('full', 512, join(pwaOut, 'icon-512.png'));
await png('full', 192, join(pwaOut, 'icon-192.png'));
await png('bleed', 512, join(pwaOut, 'icon-maskable-512.png'));
await png('bleed', 180, join(pwaOut, 'apple-touch-icon.png'));
writeFileSync(join(pwaOut, 'favicon.svg'), FAVICON_SVG, 'utf8');
console.log('✔ favicon.svg (PWA)');

/* ---------- ۲) فاوآیکن پنل ادمین ---------- */
writeFileSync(join(adminOut, 'favicon.svg'), FAVICON_SVG, 'utf8');
console.log('✔ admin favicon.svg');

/* ---------- ۳) آیکن‌های لانچر اندروید ---------- */
// تراکم → ضلع آیکن و foreground (۱۰۸dp)
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, side] of Object.entries(DENSITIES)) {
  const dir = join(resOut, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  await png('full', side, join(dir, 'ic_launcher.png'));
  await png('round', side, join(dir, 'ic_launcher_round.png'));
  await png('fg', side * 2.25, join(dir, 'ic_launcher_foreground.png')); // 108dp
}

/* ---------- ۴) اسپلش‌ها (زمینه سفید + لوگو وسط) ---------- */
const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];
for (const [d, w, h] of SPLASHES) {
  const dir = join(resOut, d);
  mkdirSync(dir, { recursive: true });
  await png('splash', w, join(dir, 'splash.png'), h);
}

console.log('\nهمه‌ی آیکن‌ها از منبع وکتوری واحد ساخته شدند ✅');
