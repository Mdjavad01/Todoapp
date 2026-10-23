import { idbGet, idbGetAll, idbPut, STORES, type StoreName } from '@/db/idb';
import type { ListEntity, TaskEntity, SubtaskEntity, ReminderEntity } from '@/types';

/**
 * پشتیبان‌گیری و بازیابی داده‌های کاربر (فاز ۴.۵)
 *
 * خروجی: یک فایل JSON شامل همه‌ی موجودیت‌های این دستگاه (حتی حذف‌شده‌های نرم،
 * تا بازیابی دقیق باشد). بازیابی با قاعده‌ی LWW (newer updatedAt برنده) ادغام
 * می‌شود؛ پس هیچ‌چیز از دست نمی‌رود و اگر حساب ابری فعال باشد، بعد از بازیابی
 * همه‌چیز خودکار به سرور هم سینک می‌شود.
 */

const BACKUP_VERSION = 1;

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

/** ساخت و دانلود فایل پشتیبان — خروجی: تعداد رکوردها برای پیام موفقیت */
export async function downloadBackup(): Promise<string> {
  const backup = await createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // نام فایل با تاریخ میلادی — خوانا و مرتب‌شدنی
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `karam-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  const total = backup.counts.lists + backup.counts.tasks + backup.counts.subtasks + backup.counts.reminders;
  return `${total}`;
}

export interface RestoreReport {
  added: number;
  updated: number;
  kept: number; // نسخه‌ی محلی جدیدتر بود
  invalid: boolean;
}

/** بازیابی از فایل پشتیبان با ادغام LWW — هیچ رکوردی حذف نمی‌شود */
export async function restoreBackup(raw: string): Promise<RestoreReport> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { added: 0, updated: 0, kept: 0, invalid: true };
  }
  const b = data as Partial<BackupFile>;
  if (!b || b.app !== 'karam' || b.kind !== 'backup' || typeof b !== 'object') {
    return { added: 0, updated: 0, kept: 0, invalid: true };
  }

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

  return { added, updated, kept, invalid: false };
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
