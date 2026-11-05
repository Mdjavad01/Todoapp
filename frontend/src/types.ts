/**
 * انواع داده‌ی کارام — طراحی‌شده برای سینک ابری در آینده:
 * هر موجودیت: شناسه‌ی UUID سمت کلاینت + updated_at + حذف نرم (deleted_at)
 */

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
/** فاز ۳ — انواع تکرار؛ ماهانه/سالانه شمسی است (lib/repeat.ts) و «سفارشی» تنظیمش در repeatMeta */
export type Repeat = 'none' | 'daily' | 'workdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type ListColor = 'teal' | 'amber' | 'indigo' | 'emerald' | 'rose' | 'purple';

/** فاز تریدر — انواع آیتم چک‌لیست: تیک ساده / تیک+عدد / تیک+یادداشت کوتاه / انتخاب بله‑تا حدی‑نه / امتیاز ۱ تا ۱۰ */
export type TaskItemType = 'check' | 'num' | 'note' | 'choice' | 'score';
/** فاز تریدر — برچسب گزینه‌های «انتخاب» (قرارداد مقدار ذخیره‌شده در itemValue) */
export const CHOICE_VALUES = ['yes', 'partial', 'no'] as const;
export type TaskItemChoice = (typeof CHOICE_VALUES)[number];

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
  /** فاز تریدر — لیست پین‌شده: همیشه بالای فهرست (سطرهای قدیمی = undefined → ناپین) */
  pinned: boolean;
  /**
   * P2.0 — کلید داخلی قالب (هویت پایدار لیست قالبی — بدهی templateKey بسته شد).
   * قالب «trader.0..4»، قالب‌های رایگان «tpl-*.0»، بسته‌های شغلی «kit-*.<index>» —
   * حروف کوچک لاتین/رقم/نقطه/خط‌تیره، حداکثر ۳۲. سطرهای قدیمی/عادی = undefined/null.
   * تشخیص همیشه اول با کلید، فال‌بک نامی برای داده‌ی قدیمی (db/templateKey.ts).
   */
  templateKey?: string | null;
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
  /** فاز تریدر — نوع آیتم؛ null = تیک ساده (سازگار با داده‌ی قدیمی و APKهای قدیمی) */
  itemType: TaskItemType | null;
  /** فاز تریدر — مقدار آیتم (عدد/انتخاب/امتیاز به‌صورت رشته لاتین)؛ یادداشتِ کوتاه هم همین‌جاست (notes = یادداشت بلند) */
  itemValue: string | null;
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
  /** بسته C — صفحه‌ی واحد «قالب‌ها» (ادغام قالب‌های رایگان + تریدر + بسته‌های شغلی؛ 'jobkits' حذف شد) */
  | 'templates'
  | 'paywall'
  | 'settings'
  | 'search'
  /** ناوبری ۵تبی — «امروز» = myday و «پلنر» = planned؛ بقیه صفحات داخلی‌اند */
  | 'myday'
  | 'important'
  | 'planned'
  | 'all';

/** قالب آماده — کاتالوگ محلی رایگان؛ فعال‌سازی ایدمپوتنت با کلید (P2.0) */
export interface TemplateDef {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  listName: string;
  color: ListColor;
  items: string[];
  /** کلید پایدار لیست قالبی — «tpl-<id>.0» (db/templateKey.ts) */
  templateKey: string;
}

/* ---------------- P2.0 — بسته‌های شغلی (بازطراحی — داده‌ی خالص روی موتور فعلی) ---------------- */

/** آیتم بسته — همان توانمندی‌های فاز تریدر: نوع آیتم + تکرار + (فقط لنگر یادآور) ساعت/یادآور */
export interface JobPackItem {
  title: string;
  /** پیش‌فرض null = تیک ساده */
  type?: TaskItemType;
  /** پیش‌فرض 'none' */
  repeat?: TaskEntity['repeat'];
  /** فقط برای تکرار سفارشی هفتگی (روز شمسی ۰=شنبه…۶=جمعه) */
  repeatMeta?: RepeatMeta | null;
  /** فقط برای لنگر یادآور — «HH:mm» روی خود آیتم (همان خط لوله‌ی یادآور بومی) */
  dueTime?: string;
  /** چند دقیقه قبل از dueTime زنگ بزند (فقط لنگر) */
  reminderMinutes?: number;
}

export interface JobPackList {
  name: string;
  emoji: string;
  color: ListColor;
  pinned?: boolean;
  /** شرح کوتاه لیست — در پیش‌نمایش بسته نمایش داده می‌شود */
  guide: string;
  items: JobPackItem[];
}

/** بسته‌ی شغلی — فقط داده؛ فعال‌سازی = ساخت لیست/کار با همان موتور فاز تریدر (هیچ موتور نو) */
export interface JobPackDef {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  /** متن دکمه‌ی فعال‌سازی */
  cta: string;
  lists: JobPackList[];
}
