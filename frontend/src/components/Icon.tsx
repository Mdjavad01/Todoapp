/**
 * آیکن‌های SVG محلی — جایگزین کامل Material Symbols گوگل (بدون هیچ CDN).
 * فایل‌های SVG در src/assets/icons — از باندل خروجی خوانده می‌شوند.
 */
import { CSSProperties } from 'react';
import { ICON_RAW } from '@/assets/iconRegistry';

/** آماده‌سازی: حذف ابعاد ثابت و رنگ‌پذیری با currentColor */
function prepare(raw: string): string {
  return raw.replace(/width="48" height="48" /, '').replace('<svg ', '<svg fill="currentColor" ');
}

export const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(ICON_RAW).map(([name, raw]) => [name, prepare(raw)]),
);

export type IconName =
  | 'add'
  | 'arrow_back'
  | 'arrow_back_ios'
  | 'arrow_forward'
  | 'auto_awesome'
  | 'bar_chart'
  | 'battery_full'
  | 'calendar_month'
  | 'calendar_today'
  | 'check'
  | 'check_circle'
  | 'content_copy'
  | 'credit_card'
  | 'checklist'
  | 'close'
  | 'cloud_sync'
  | 'dark_mode'
  | 'delete'
  | 'event_note'
  | 'expand_more'
  | 'filter_list'
  | 'fingerprint'
  | 'flag'
  | 'folder'
  | 'home'
  | 'light_mode'
  | 'lock'
  | 'mail'
  | 'mic'
  | 'more_vert'
  | 'notifications'
  | 'notifications_active'
  | 'person'
  | 'priority_high'
  | 'psychology'
  | 'refresh'
  | 'replay'
  | 'search'
  | 'settings'
  | 'send'
  | 'shield'
  | 'shop'
  | 'signal_cellular_4_bar'
  | 'star'
  | 'task_alt'
  | 'today'
  | 'verified'
  | 'warning'
  | 'wifi'
  | 'workspace_premium'
  | 'format_size'
  | 'help';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 24, className = '', style }: IconProps) {
  const svg = ICONS[name];
  if (!svg) return null;
  return (
    <span
      className={`ms-icon ${className}`}
      style={{ width: size, height: size, ...style }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
