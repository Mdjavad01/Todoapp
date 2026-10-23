/**
 * تولید آیکن‌های PWA از لوگوی کارام (یک‌بار در توسعه اجرا می‌شود)
 * خروجی: public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png و favicon.svg
 * اجرا: node scripts/generate-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// مسیر آیکن checklist از پکیج محلی Material Symbols (بدون CDN)
const checklistRaw = readFileSync(
  join(__dirname, '..', 'node_modules', '@material-symbols', 'svg-400', 'outlined', 'checklist.svg'),
  'utf8',
);
const d = /d="([^"]+)"/.exec(checklistRaw)?.[1];
if (!d) throw new Error('checklist path not found');

/** لوگو: مربع گرد فیروزه‌ای + آیکن چک‌لیست سفید */
function logoSvg(size, withBg = true) {
  const pad = withBg ? size * 0.19 : 0;
  const glyph = size - pad * 2;
  // viewBox آیکن متریال: 0 -960 960 960 → مقیاس و جابه‌جایی به مرکز
  const s = glyph / 960;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${withBg ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#00685f"/>` : ''}
  <g transform="translate(${pad} ${pad}) scale(${s}) translate(0 -960)">
    <path d="${d}" fill="#ffffff"/>
  </g>
</svg>`;
}

async function png(size, file, withBg = true) {
  await sharp(Buffer.from(logoSvg(size, withBg))).png().toFile(join(outDir, file));
  console.log('✔', file);
}

await png(512, 'icon-512.png');
await png(192, 'icon-192.png');
await png(512, 'icon-maskable-512.png');
await png(180, 'apple-touch-icon.png');
writeFileSync(join(outDir, 'favicon.svg'), logoSvg(96), 'utf8');
console.log('✔ favicon.svg');
console.log('همه‌ی آیکن‌ها ساخته شدند.');
