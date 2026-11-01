import { idbGet, idbGetAll, idbPut, STORES, type StoreName } from '@/db/idb';
import type { ListEntity, TaskEntity, SubtaskEntity, ReminderEntity } from '@/types';
import { saveFileForUser, type SaveFileOutcome } from '@/lib/saveFile';
import { resetSyncPointsAfterRestore } from '@/sync/engine';

/**
 * پشتیبان‌گیری و بازیابی داده‌های کاربر (فاز ۴.۵ + P1.3)
 *
 * خروجی: یک فایل JSON شامل همه‌ی موجودیت‌های این دستگاه (حتی حذف‌شده‌های نرم،
 * تا بازیابی دقیق باشد). بازیابی با قاعده‌ی LWW (newer updatedAt برنده) ادغام
 * می‌شود؛ پس هیچ‌چیز از دست نمی‌رود و اگر حساب ابری فعال باشد، بعد از بازیابی
 * همه‌چیز خودکار به سرور هم سینک می‌شود.
 *
 * P1.3 — ذخیره با helper واحد lib/saveFile (در اپ اندروید با منوی اشتراک سیستم
 * و انتخاب مقصد توسط کاربر)، اعتبارسنجی صریح فایل (parseBackupFile) با خطاهای
 * فارسی تفکیک‌شده، و ثبت زمان آخرین پشتیبان موفق.
 */

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'karam';
  kind: 'backup';
  version: number;
  exportedAt: string; // ISO UTC
  counts: { lists: number; tasks: number; subtasks: number; reminders: number };
  lists: ListEntity[];
  tasks: TaskEntity[];
  subtasks: SubtaskEntity[];
  reminders: ReminderEntity[];
}

interface BackupItem {
  id: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export async function createBackup(): Promise<BackupFile> {
  const [lists, tasks, subtasks, reminders] = await Promise.all([
    idbGetAll<ListEntity>(STORES.lists),
    idbGetAll<TaskEntity>(STORES.tasks),
    idbGetAll<SubtaskEntity>(STORES.subtasks),
    idbGetAll<ReminderEntity>(STORES.reminders),
  ]);
  return {
    app: 'karam',
    kind: 'backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      lists: lists.length,
      tasks: tasks.length,
      subtasks: subtasks.length,
      reminders: reminders.length,
    },
    lists,
    tasks,
    subtasks,
    reminders,
  };
}

/** ساخت فایل پشتیبان و تحویل آن به کاربر (وب: دانلود؛ اپ: منوی اشتراک) — خروجی برای پیام موفقیت */
export async function downloadBackup(): Promise<{ name: string; total: number; outcome: SaveFileOutcome }> {
  const backup = await createBackup();
  const content = JSON.stringify(backup, null, 2);
  // نام فایل با تاریخ میلادی — خوانا و مرتب‌شدنی
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `karam-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const outcome = await saveFileForUser(name, content, 'application/json');
  const total = backup.counts.lists + backup.counts.tasks + backup.counts.subtasks + backup.counts.reminders;
  return { name, total, outcome };
}

/* ---------- P1.3 — اعتبارسنجی و پیش‌نمایش فایل پشتیبان ---------- */

/** علت رد فایل — هر مورد یک پیام فارسی مشخص دارد */
export type BackupParseError = 'not-karam' | 'corrupt' | 'newer-version';

export type BackupParseResult =
  | { ok: true; file: BackupFile }
  | { ok: false; reason: BackupParseError };

/** متن فارسی خطا برای نمایش به کاربر */
export function parseErrorText(reason: BackupParseError): string {
  switch (reason) {
    case 'not-karam':
      return 'فایل پشتیبان کارام نیست';
    case 'newer-version':
      return 'این فایل از نسخه‌ی جدیدتر کارام است؛ اول اپ را به‌روزرسانی کنید';
    case 'corrupt':
      return 'فایل خراب است یا ساختار پشتیبان کارام را ندارد';
  }
}

/**
 * اعتبارسنجی فایل پشتیبان بدون اعمال — برای پیش‌نمایش و دیالوگ تأیید.
 * سالم: app=karam + kind=backup + version عددی ≤ BACKUP_VERSION.
 */
export function parseBackupFile(raw: string): BackupParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'corrupt' };
  const b = data as Partial<BackupFile>;
  if (b.app !== 'karam' || b.kind !== 'backup') return { ok: false, reason: 'not-karam' };
  if (typeof b.version !== 'number' || !Number.isFinite(b.version) || b.version < 1) {
    return { ok: false, reason: 'corrupt' };
  }
  if (b.version > BACKUP_VERSION) return { ok: false, reason: 'newer-version' };
  return { ok: true, file: data as BackupFile };
}

/**
 * شمارنده‌های پیش‌نمایش — P1.4: همیشه از روی طول آرایه‌های واقعی شمرده می‌شود و
 * فیلد counts فایل کاملاً نادیده گرفته می‌شود (فایل دست‌کاری‌شده نمی‌تواند دیالوگ
 * تأیید را با عدد غلط یا undefined گمراه کند؛ آرایه نبودن هر فیلد = ۰).
 */
export function backupCountsOf(file: BackupFile): { lists: number; tasks: number; subtasks: number; reminders: number } {
  return {
    lists: Array.isArray(file.lists) ? file.lists.length : 0,
    tasks: Array.isArray(file.tasks) ? file.tasks.length : 0,
    subtasks: Array.isArray(file.subtasks) ? file.subtasks.length : 0,
    reminders: Array.isArray(file.reminders) ? file.reminders.length : 0,
  };
}

export interface RestoreReport {
  added: number;
  updated: number;
  kept: number; // نسخه‌ی محلی جدیدتر بود
  invalid: boolean;
  /** وقتی invalid — علت دقیق برای پیام فارسی */
  reason?: BackupParseError;
}

/** بازیابی از فایل پشتیبان با ادغام LWW — هیچ رکوردی حذف نمی‌شود */
export async function restoreBackup(raw: string): Promise<RestoreReport> {
  // P1.3 — اعتبارسنجی یکسان با پیش‌نمایش (شامل گارد نسخه‌ی جدیدتر — دفاع دوم)
  const parsed = parseBackupFile(raw);
  if (!parsed.ok) {
    return { added: 0, updated: 0, kept: 0, invalid: true, reason: parsed.reason };
  }
  const b = parsed.file;

  let added = 0;
  let updated = 0;
  let kept = 0;

  const merge = async <T extends BackupItem>(store: StoreName, items: T[] | undefined, coerce?: (x: T) => T): Promise<void> => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length < 8) continue;
      const clean = coerce ? coerce(item) : item;
      const local = await idbGet<T>(store, clean.id);
      if (!local) {
        await idbPut(store, clean);
        added++;
        continue;
      }
      const localAt = Date.parse(local.updatedAt ?? '') || 0;
      const remoteAt = Date.parse(clean.updatedAt ?? '') || 0;
      if (remoteAt > localAt) {
        await idbPut(store, clean);
        updated++;
      } else {
        kept++;
      }
    }
  };

  await merge(STORES.lists, b.lists);
  await merge(STORES.tasks, b.tasks);
  await merge(STORES.subtasks, b.subtasks);
  await merge(STORES.reminders, b.reminders);

  // P1.4 — ممیزی بازیابی ↔ سینک: رکوردهای بازیابی‌شده با updatedAt اصلی فایل نوشته
  // می‌شوند و collectChanges فقط جدیدترهای «sync-last-push» را push می‌کند ⇒ رکورد
  // افزوده/به‌روزشده با updatedAt قدیمی‌تر از آخرین سینک هرگز به سرور نمی‌رفت.
  // اصلاح کم‌خطر: نقطه‌های سینک ریست می‌شود تا رکوردها صرفاً دوباره ارسال شوند
  // (updatedAt هرگز دستکاری نمی‌شود — قاعده‌ی LWW به آن وابسته است؛ هیچ‌چیز حذف نمی‌شود).
  if (added > 0 || updated > 0) {
    await resetSyncPointsAfterRestore();
  }

  return { added, updated, kept, invalid: false };
}

/* ---------- P1.3 — زمان آخرین پشتیبان موفق (فقط محلی، هرگز سینک نمی‌شود) ---------- */

const LAST_BACKUP_KEY = 'karam-last-backup-at';

/** زمان آخرین پشتیبان موفق (ISO) — null = هنوز پشتیبانی نگرفته */
export function getLastBackupAt(): string | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** ثبت «الان» به‌عنوان آخرین پشتیبان — فقط بعد از ذخیره‌ی موفق صدا زده می‌شود */
export function markLastBackupNow(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  } catch {
    // حریم خصوصی/مرورگر محدود — نمایش تاریخ حیاتی نیست، حبس نشو
  }
}

/** شمارش رکوردهای این دستگاه (برای نمایش در تنظیمات) */
export async function localCounts(): Promise<{ lists: number; tasks: number; subtasks: number; reminders: number }> {
  const [lists, tasks, subtasks, reminders] = await Promise.all([
    idbGetAll<ListEntity>(STORES.lists),
    idbGetAll<TaskEntity>(STORES.tasks),
    idbGetAll<SubtaskEntity>(STORES.subtasks),
    idbGetAll<ReminderEntity>(STORES.reminders),
  ]);
  return {
    lists: lists.filter((x) => !x.deletedAt).length,
    tasks: tasks.filter((x) => !x.deletedAt).length,
    subtasks: subtasks.filter((x) => !x.deletedAt).length,
    reminders: reminders.filter((x) => !x.deletedAt).length,
  };
}
