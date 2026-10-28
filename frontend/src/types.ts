/**
 * انواع داده‌ی کارام — طراحی‌شده برای سینک ابری در آینده:
 * هر موجودیت: شناسه‌ی UUID سمت کلاینت + updated_at + حذف نرم (deleted_at)
 */

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
/** فاز ۳ — انواع تکرار؛ ماهانه/سالانه شمسی است (lib/repeat.ts) و «سفارشی» تنظیمش در repeatMeta */
export type Repeat = 'none' | 'daily' | 'workdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type ListColor = 'teal' | 'amber' | 'indigo' | 'emerald' | 'rose' | 'purple';

/** تنظیم تکرار سفارشی — هم‌شکل lib/repeat.ts RepeatMeta؛ سمت سرور JSON معتبر نگهداری می‌شود */
export type RepeatMeta = import('./lib/repeat').RepeatMeta;

/** موجودیت پایه — قانون سینک: UUID + updated_at + deleted_at */
export interface SyncBase {
  id: string; // UUID سمت کلاینت
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC — برای مقایسه در سینک
  deletedAt: string | null; // حذف نرم
  /** شکستن تساوی LWW (ترمیم جریان) — نسخه‌ی سرور؛ رکورد قدیمی/محلی ندارند = ۰ */
  rev?: number;
  /** شناسه‌ی دستگاه آخرین نویسنده برای شکستن تساوی کامل */
  revDevice?: string;
}

export interface ListEntity extends SyncBase {
  name: string;
  emoji: string;
  color: ListColor;
  sortOrder: number;
}

/** گروه لیست‌ها (فاز ۲) — ترجیح نمایش سطح دستگاه؛ با خروج از حساب پاک می‌شود (wipe) */
export interface ListGroup {
  id: string;
  name: string;
  listIds: string[];
}

/** ترتیب نمایش کارهای یک لیست (فاز ۲ — به‌یادماندنی هر لیست با pref «list-sort:» */
export type ListSortKey = 'importance' | 'due' | 'alpha' | 'created' | 'manual';

/** کارت‌های هوشمند خانه (فاز ۲ — هر کدام قابل پنهان‌سازی با pref «hubs-hidden») */
export type HubKey = 'today' | 'urgent' | 'planned' | 'all';

export interface TaskEntity extends SyncBase {
  listId: string;
  title: string;
  notes: string;
  priority: Priority;
  /** تاریخ سررسید به‌صورت «YYYY-MM-DD» شمسی یا ISO؟ → برای سادگی سینک، میلادی UTC ISO «YYYY-MM-DD» */
  dueDate: string | null;
  dueTime: string | null; // «HH:mm»
  reminderMinutes: number | null; // چند دقیقه قبل
  repeat: Repeat;
  /** فاز ۳ — ستاره‌ی «مهم» (سینک کامل؛ در APKهای قدیمی = false) */
  starred: boolean;
  /** فاز ۳ — تنظیم تکرار سفارشی (فقط با repeat='custom')؛ سمت سرور JSON معتبر */
  repeatMeta: import('./lib/repeat').RepeatMeta | null;
  completedAt: string | null;
}

export interface SubtaskEntity extends SyncBase {
  taskId: string;
  title: string;
  done: boolean;
}

/** برگزاری رکورد تفضیلی یادآور — فعلاً فقط داده؛ اجرای نوتیفیکیشن فاز بعد */
export interface ReminderEntity extends SyncBase {
  taskId: string;
  fireAt: string; // ISO UTC
  fired: boolean;
}

export interface PrefEntity {
  key: string;
  value: unknown;
}

export type ViewName =
  | 'home'
  | 'listView'
  | 'analytics'
  | 'templates'
  | 'jobkits'
  | 'paywall'
  | 'settings'
  | 'search'
  /** ناوبری ۵تبی — «امروز» = myday و «پلنر» = planned؛ بقیه صفحات داخلی‌اند */
  | 'myday'
  | 'important'
  | 'planned'
  | 'all';

/** قالب آماده — در فاز ۴ از سرور می‌آید؛ فعلاً کاتالوگ محلی برای حالت مهمان */
export interface TemplateDef {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  listName: string;
  color: ListColor;
  items: string[];
}

/** بسته‌ی شغلی */
export interface JobKitList {
  name: string;
  emoji: string;
  color: ListColor;
  items: string[];
}

export interface JobKitDef {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  features: string[];
  pro: boolean;
  cta: string;
  /** روتین‌های واقعی بسته — با فعال‌سازی، به لیست‌های کاربر اضافه می‌شود (v16) */
  lists: JobKitList[];
}
