/**
 * کپی آیکن‌های مورداستفاده از @material-symbols/svg-400 به src/assets/icons
 * تا بیلد کاملاً خودکفا باشد و به ساختار node_modules وابسته نباشد.
 * اجرا: node scripts/copy-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(__dirname, '..', 'node_modules', '@material-symbols', 'svg-400', 'outlined');
const outDir = join(__dirname, '..', 'src', 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

const ICON_NAMES = [
  'add', 'arrow_back', 'arrow_back_ios', 'arrow_forward', 'arrow_downward', 'arrow_upward', 'auto_awesome', 'bar_chart',
  'battery_full', 'calendar_month', 'calendar_today', 'check', 'check_circle', 'checklist',
  'close', 'cloud_sync', 'dark_mode', 'delete', 'drag_indicator', 'edit', 'event_note', 'expand_more', 'filter_list',
  'fingerprint', 'flag', 'folder', 'home', 'light_mode', 'lock', 'mic', 'more_vert',
  'notifications', 'notifications_active', 'priority_high', 'psychology', 'replay', 'search',
  'settings', 'shop', 'signal_cellular_4_bar', 'sort', 'star', 'star_filled', 'today', 'verified', 'warning',
  'wifi', 'workspace_premium',
];

let copied = 0;
// آیکن auto_awesome در این نسخه‌ی پکیج نیست؛ مسیر رسمی Material Icons به‌صورت دستی:
const MANUAL_ICONS = {
  'auto_awesome':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>',
  'expand_more':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>',
  'star_filled':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m12 17.27 4.15 2.51c.76.46 1.69-.22 1.49-1.08l-1.1-4.72 3.67-3.18c.67-.58.31-1.68-.57-1.75l-4.83-.41-1.89-4.46c-.34-.81-1.5-.81-1.84 0L9.19 8.63l-4.83.41c-.88.07-1.24 1.17-.57 1.75l3.67 3.18-1.1 4.72c-.2.86.73 1.54 1.49 1.08L12 17.27z"/></svg>',
};

for (const name of ICON_NAMES) {
  const raw = MANUAL_ICONS[name] ?? readFileSync(join(srcDir, `${name}.svg`), 'utf8');
  writeFileSync(join(outDir, `${name}.svg`), raw, 'utf8');
  copied++;
}
console.log(`✔ ${copied} آیکن کپی شد به src/assets/icons`);
