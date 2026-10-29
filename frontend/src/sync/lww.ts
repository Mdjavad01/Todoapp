/**
 * کارام — قواعد مشترک سینک سمت کلاینت (ترمیم جریان — فاز ۱)
 * این فایل عمداً «خالص» است (بدون دسترسی به IndexedDB/شبکه) تا تست‌پذیر باشد.
 */

import type { ListEntity, SubtaskEntity, TaskEntity } from '@/types';

/** نام‌های دقیق لیست‌های آزمایشی نسخه‌های قدیمی — مرز dedupe (هم‌قرارداد با SyncService::SEED_LIST_NAMES سرور) */
export const SEED_LIST_NAMES: readonly string[] = [
  'کارهای خانه',
  'خرید هفتگی',
  'کنکور و مطالعه',
  'ترید و بازارهای مالی',
  'مالی و قبوض',
  'کاری',
];

/** نام لیست پیش‌فرض قطعی (جای داده‌ی آزمایشی چندلیستی) */
export const DEFAULT_LIST_NAME = 'کارهای من';

/**
 * شناسه‌ی قطعی لیست پیش‌فرض (فاز نصب تمیز):
 * همه‌ی دستگاه‌ها همین UUID را می‌سازند تا حتی اگر دو دستگاه پیش از ورود، لیست پیش‌فرض
 * خودشان را بسازند و پوش کنند، در سرور «همان یک رکورد» ادغام شود — نه دو لیست هم‌نام.
 * قالب UUIDv4 معتبر (نسخه=4، واریانت=8) تا UUID_RE و اعتبارسنجی سرور قبولش کند.
 */
export const DEFAULT_LIST_ID = '00000000-0000-4000-8000-000000000001';

/** رکورد دارای کلیدهای مقایسه‌ی LWW */
export interface RevAware {
  updatedAt: string;
  rev?: number;
  revDevice?: string;
}

/**
 * مقایسه‌ی سه‌تایی قطعی (updatedAt, rev, revDevice) — «برابر یا جدیدتر».
 * قرارداد سرور (SyncService::tupleGreaterOrEqual) دقیقاً همین است؛
 * تساوی کامل = برنده‌ی متقاضی (اعمال مجدد بی‌ضرر/idempotent).
 * مقایسه‌ی رشته‌ای updatedAt (ISO UTC) = مقایسه‌ی زمانی؛ rev عددی؛ revDevice متنی (UUID = ASCII).
 */
export function revTupleNewerOrEqual(a: RevAware, b: RevAware): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  const ar = a.rev ?? 0;
  const br = b.rev ?? 0;
  if (ar !== br) return ar > br;
  return (a.revDevice ?? '') >= (b.revDevice ?? '');
}

/**
 * «کاملاً جدیدتر» — برای اعمال رکورد سرور روی نسخه‌ی محلی:
 * تساوی کامل یعنی همان رکوردیم؛ کاری نکن.
 */
export function revTupleStrictlyNewer(a: RevAware, b: RevAware): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  const ar = a.rev ?? 0;
  const br = b.rev ?? 0;
  if (ar !== br) return ar > br;
  return (a.revDevice ?? '') > (b.revDevice ?? '');
}

export interface SyncChanges {
  lists: ListEntity[];
  tasks: TaskEntity[];
  subtasks: SubtaskEntity[];
}

export function emptyChanges(): SyncChanges {
  return { lists: [], tasks: [], subtasks: [] };
}

/**
 * push تکه‌تکه: هر موجودیت به بخش‌های ≤ size تقسیم می‌شود (هیچ درخواستی از سقف سرور عبور نمی‌کند).
 * هر چانک فقط یک موجودیت دارد تا سقفِ «هر موجودیت در هر درخواست» سرور تضمین شود.
 */
export function chunkChanges(changes: SyncChanges, size: number): SyncChanges[] {
  const safe = Math.max(1, Math.floor(size));
  const chunks: SyncChanges[] = [];
  const pushSlices = (key: keyof SyncChanges, rows: SyncChanges[keyof SyncChanges]): void => {
    for (let i = 0; i < rows.length; i += safe) {
      chunks.push({ ...emptyChanges(), [key]: rows.slice(i, i + safe) } as SyncChanges);
    }
  };
  pushSlices('lists', changes.lists);
  pushSlices('tasks', changes.tasks);
  pushSlices('subtasks', changes.subtasks);
  return chunks;
}
