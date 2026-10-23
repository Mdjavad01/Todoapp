/**
 * رجیستری آیکن‌ها — همه‌ی SVGهای پوشه‌ی icons به‌صورت رشته‌ی خام داخل باندل.
 * (import.meta.glob در زمان بیلد حل می‌شود؛ هیچ درخواست شبکه‌ای وجود ندارد)
 */
const modules = import.meta.glob('./icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const ICON_RAW: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split('/').pop()!.replace('.svg', '');
  ICON_RAW[name] = raw;
}
