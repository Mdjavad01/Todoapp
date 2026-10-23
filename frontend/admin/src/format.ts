/**
 * کارام — پنل مدیریت: فرمت فارسی اعداد/تاریخ (آفلاین، بدون کتابخانه‌ی خارجی)
 * تبدیل میلادی↔جلالی: الگوریتم استاندارد (منبع عمومی Jalaali)
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function faNum(value: number | string): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** 4900000 → «۴۹۰,۰۰۰» (بدون واحد؛ واحد در UI می‌آید) */
export function faMoney(rials: number): string {
  const grouped = new Intl.NumberFormat('en-US').format(Math.round(rials));
  return faNum(grouped);
}

/* ---------------- جلالی ---------------- */

function div(a: number, b: number): number {
  return Math.floor(a / b);
}

/** میلادی → جلالی */
export function toJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

const JMONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** «2025-01-05 14:33:21» (UTC سرور) → «۱۴ دی ۱۴۰۳، ۱۷:۳۳» — ساعت به وقت ایران */
export function faDateTime(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return faNum(iso);
  // تبدیل به وقت محلی ایران (+03:30) — پنل برای مدیر ایرانی است
  const tehran = new Date(d.getTime() + 3.5 * 3600 * 1000);
  const [jy, jm, jd] = toJalali(tehran.getUTCFullYear(), tehran.getUTCMonth() + 1, tehran.getUTCDate());
  const base = `${faNum(jd)} ${JMONTHS[jm - 1]} ${faNum(jy)}`;
  if (!withTime) return base;
  const hh = String(tehran.getUTCHours()).padStart(2, '0');
  const mm = String(tehran.getUTCMinutes()).padStart(2, '0');
  return `${base}، ${faNum(hh)}:${faNum(mm)}`;
}

/** تاریخ کوتاه برای نمودار: «۱۴ دی» */
export function faDayShort(dateIso: string): string {
  const real = toJalali(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)),
    Number(dateIso.slice(8, 10)),
  );
  return `${faNum(real[2])} ${JMONTHS[real[1] - 1]}`;
}

/* ---------------- متن‌های ثابت ---------------- */

export const STATUS_LABELS: Record<string, string> = {
  active: 'فعال',
  blocked: 'مسدود',
  deleted: 'حذف‌شده',
};

export const SOURCE_LABELS: Record<string, string> = {
  web_gateway: 'درگاه وب',
  card_to_card: 'کارت‌به‌کارت',
  admin_grant: 'اعطای مدیر',
  store_bazaar: 'مارکت',
};

export const TYPE_LABELS: Record<string, string> = {
  info: 'اطلاعیه',
  warning: 'هشدار',
  premium: 'پرو',
};

export const ACTION_LABELS: Record<string, string> = {
  'admin.login': 'ورود مدیر',
  'admin.login_failed': 'ورود ناموفق',
  'admin.logout': 'خروج مدیر',
  'user.update': 'ویرایش کاربر',
  'user.premium_grant': 'اعطای اشتراک',
  'user.sessions_revoke': 'ابطال نشست‌های کاربر',
  'plan.update': 'ویرایش پلن',
  'announcement.create': 'ساخت اطلاعیه',
  'announcement.update': 'ویرایش اطلاعیه',
  'announcement.delete': 'حذف اطلاعیه',
  'settings.update': 'تغییر تنظیمات',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
