/**
 * انواع داده‌ی کارام — طراحی‌شده برای سینک ابری در آینده:
 * هر موجودیت: شناسه‌ی UUID سمت کلاینت + updated_at + حذف نرم (deleted_at)
 */

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';
export type ListColor = 'teal' | 'amber' | 'indigo' | 'emerald' | 'rose' | 'purple';

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
  | 'todayView'
  | 'analytics'
  | 'templates'
  | 'jobkits'
  | 'paywall'
  | 'emptyState'
  | 'settings'
  | 'search';

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
