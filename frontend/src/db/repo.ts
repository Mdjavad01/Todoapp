import { idbGetAll, idbGet, idbPut, idbDelete, STORES } from './idb';
import { uuid, nowIso } from '@/lib/uuid';
import { compareLists } from '@/lib/selectors';
import { nextOccurrence, type RepeatKind, type RepeatMeta } from '@/lib/repeat';
import type { ListEntity, TaskEntity, SubtaskEntity, ReminderEntity, PrefEntity } from '@/types';

/**
 * مخازن داده‌ی حالت مهمان — تمام عملیات روی IndexedDB.
 * قانون سینک آینده: UUID سمت کلاینت، updated_at روی هر تغییر، حذف نرم با deleted_at.
 */

/* ---------------- لیست‌ها ---------------- */

export async function listsAll(): Promise<ListEntity[]> {
  const rows = await idbGetAll<ListEntity>(STORES.lists);
  // ترتیب قطعی: sortOrder سپس createdAt سپس id (فاز ۲ — پایدار بین دستگاه‌ها پس از سینک)
  return rows.filter((r) => !r.deletedAt).sort(compareLists);
}

export async function listsCreate(input: { name: string; emoji: string; color: ListEntity['color'] }): Promise<ListEntity> {
  const now = nowIso();
  // انتهای ترتیب = بزرگ‌ترین sortOrder زنده + ۱ (تومب‌استون‌ها شمرده نمی‌شوند — فاز ۲)
  const live = (await idbGetAll<ListEntity>(STORES.lists)).filter((r) => !r.deletedAt);
  const sortOrder = live.length === 0 ? 0 : Math.max(...live.map((l) => l.sortOrder)) + 1;
  const entity: ListEntity = {
    id: uuid(),
    name: input.name,
    emoji: input.emoji,
    color: input.color,
    sortOrder,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await idbPut(STORES.lists, entity);
  return entity;
}

export async function listsUpdate(id: string, patch: Partial<Pick<ListEntity, 'name' | 'emoji' | 'color' | 'sortOrder'>>): Promise<void> {
  const row = await idbGet<ListEntity>(STORES.lists, id);
  if (!row) return;
  await idbPut(STORES.lists, { ...row, ...patch, updatedAt: nowIso() });
}

export async function listsSoftDelete(id: string): Promise<void> {
  const row = await idbGet<ListEntity>(STORES.lists, id);
  if (!row) return;
  const now = nowIso();
  await idbPut(STORES.lists, { ...row, deletedAt: now, updatedAt: now });
  // حذف نرم کارها و زیرکارهای وابسته
  const tasks = await idbGetAll<TaskEntity>(STORES.tasks);
  for (const t of tasks.filter((x) => x.listId === id && !x.deletedAt)) {
    await tasksSoftDelete(t.id);
  }
}

/* ---------------- واگرد حذف لیست (فاز ۲) ---------------- */

/** عکسِ لحظه‌ای حالت زنده‌ی لیست قبل از حذف — برای «واگرد» توست حذف */
export interface ListUndoSnapshot {
  list: ListEntity;
  tasks: TaskEntity[];
  subtasks: SubtaskEntity[];
}

export async function snapshotListForUndo(listId: string): Promise<ListUndoSnapshot | null> {
  const list = await idbGet<ListEntity>(STORES.lists, listId);
  if (!list || list.deletedAt) return null;
  const tasks = (await idbGetAll<TaskEntity>(STORES.tasks)).filter((t) => t.listId === listId && !t.deletedAt);
  const taskIds = new Set(tasks.map((t) => t.id));
  const subtasks = (await idbGetAll<SubtaskEntity>(STORES.subtasks)).filter(
    (s) => taskIds.has(s.taskId) && !s.deletedAt,
  );
  return { list, tasks, subtasks };
}

/** بازگردانی دقیق عکسِ قبل از حذف — فقط ردیف‌هایی که همین حذف تومب‌استون کرده (حذف‌های قدیمی‌تر دست نمی‌خورند) */
export async function restoreListSnapshot(snap: ListUndoSnapshot): Promise<void> {
  const now = nowIso();
  await idbPut(STORES.lists, { ...snap.list, deletedAt: null, updatedAt: now });
  for (const t of snap.tasks) await idbPut(STORES.tasks, { ...t, deletedAt: null, updatedAt: now });
  for (const s of snap.subtasks) await idbPut(STORES.subtasks, { ...s, deletedAt: null, updatedAt: now });
}

/* ---------------- کپی لیست (فاز ۲) ---------------- */

/** کپی یک کار به لیست دیگر با شناسه‌ی نو — همه‌ی فیلدها (حتی completedAt) عیناً حفظ می‌شود */
export async function tasksCopyRow(taskId: string, newListId: string): Promise<TaskEntity | null> {
  const row = await idbGet<TaskEntity>(STORES.tasks, taskId);
  if (!row || row.deletedAt) return null;
  const now = nowIso();
  const copy: TaskEntity = { ...row, id: uuid(), listId: newListId, createdAt: now, updatedAt: now };
  await idbPut(STORES.tasks, copy);
  return copy;
}

/** کپی زیرکارهای یک کار برای نسخه‌ی کپی‌شده‌ی آن */
export async function subtasksCopyRow(taskId: string, newTaskId: string): Promise<void> {
  const rows = await idbGetAll<SubtaskEntity>(STORES.subtasks);
  const now = nowIso();
  for (const s of rows.filter((x) => x.taskId === taskId && !x.deletedAt)) {
    await idbPut(STORES.subtasks, { ...s, id: uuid(), taskId: newTaskId, createdAt: now, updatedAt: now });
  }
}

/* ---------------- کارها ---------------- */

export async function tasksAll(): Promise<TaskEntity[]> {
  const rows = await idbGetAll<TaskEntity>(STORES.tasks);
  return rows.filter((r) => !r.deletedAt);
}

export async function tasksByList(listId: string): Promise<TaskEntity[]> {
  const rows = await tasksAll();
  return rows.filter((t) => t.listId === listId);
}

export interface TaskInput {
  listId: string;
  title: string;
  notes?: string;
  priority?: TaskEntity['priority'];
  dueDate?: string | null;
  dueTime?: string | null;
  reminderMinutes?: number | null;
  repeat?: TaskEntity['repeat'];
  /** فاز ۳ — ستاره‌ی «مهم» */
  starred?: boolean;
  /** فاز ۳ — تنظیم تکرار سفارشی */
  repeatMeta?: RepeatMeta | null;
}

export async function tasksCreate(input: TaskInput): Promise<TaskEntity> {
  const now = nowIso();
  const entity: TaskEntity = {
    id: uuid(),
    listId: input.listId,
    title: input.title,
    notes: input.notes ?? '',
    priority: input.priority ?? 'normal',
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    reminderMinutes: input.reminderMinutes ?? null,
    repeat: input.repeat ?? 'none',
    starred: input.starred ?? false,
    repeatMeta: input.repeatMeta ?? null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await idbPut(STORES.tasks, entity);
  return entity;
}

export async function tasksUpdate(id: string, patch: Partial<Omit<TaskEntity, 'id' | 'createdAt'>>): Promise<void> {
  const row = await idbGet<TaskEntity>(STORES.tasks, id);
  if (!row) return;
  await idbPut(STORES.tasks, { ...row, ...patch, updatedAt: nowIso() });
}

export async function tasksToggleComplete(id: string, completed: boolean): Promise<void> {
  const row = await idbGet<TaskEntity>(STORES.tasks, id);
  if (!row) return;
  await idbPut(STORES.tasks, {
    ...row,
    completedAt: completed ? nowIso() : null,
    updatedAt: nowIso(),
  });
}

/**
 * فاز ۳ — تکمیل کارِ تکرارشونده: کارِ اصلی «انجام‌شده» می‌ماند (آمار و آکاردئون) و
 * نوبت بعدی با همان فیلدها و سررسیدِ محاسبه‌شده از موتور تکرار ساخته می‌شود
 * (شناسه‌ی نو؛ زیرکارها با وضعیت باز کپی می‌شوند). اگر تکرار نبود = null.
 */
export async function completeRecurring(taskId: string, completedOn: Date = new Date()): Promise<TaskEntity | null> {
  const row = await idbGet<TaskEntity>(STORES.tasks, taskId);
  if (!row || row.deletedAt || row.repeat === 'none') return null;
  const nextDue = nextOccurrence(row.dueDate, row.repeat as RepeatKind, row.repeatMeta ?? null, completedOn);
  if (nextDue === null) return null;
  const now = nowIso();
  const next: TaskEntity = {
    ...row,
    id: uuid(),
    dueDate: nextDue,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await idbPut(STORES.tasks, next);
  // کپی زیرکارهای باز برای نوبت بعدی (وضعیت تیک ریست می‌شود)
  const subs = await idbGetAll<SubtaskEntity>(STORES.subtasks);
  for (const s of subs.filter((x) => x.taskId === taskId && !x.deletedAt)) {
    await idbPut(STORES.subtasks, { ...s, id: uuid(), taskId: next.id, done: false, createdAt: now, updatedAt: now });
  }
  return next;
}

export async function tasksSoftDelete(id: string): Promise<void> {
  const row = await idbGet<TaskEntity>(STORES.tasks, id);
  if (!row) return;
  const now = nowIso();
  await idbPut(STORES.tasks, { ...row, deletedAt: now, updatedAt: now });
  // حذف نرم زیرکارها و یادآورها
  const subs = await idbGetAll<SubtaskEntity>(STORES.subtasks);
  for (const s of subs.filter((x) => x.taskId === id && !x.deletedAt)) {
    await idbPut(STORES.subtasks, { ...s, deletedAt: now, updatedAt: now });
  }
  const rems = await idbGetAll<ReminderEntity>(STORES.reminders);
  for (const r of rems.filter((x) => x.taskId === id && !x.deletedAt)) {
    await idbPut(STORES.reminders, { ...r, deletedAt: now, updatedAt: now });
  }
}

/* ---------------- زیرکارها ---------------- */

export async function subtasksAll(): Promise<SubtaskEntity[]> {
  const rows = await idbGetAll<SubtaskEntity>(STORES.subtasks);
  return rows.filter((r) => !r.deletedAt);
}

export async function subtasksByTask(taskId: string): Promise<SubtaskEntity[]> {
  const rows = await subtasksAll();
  return rows.filter((s) => s.taskId === taskId);
}

export async function subtasksCreate(taskId: string, title: string): Promise<SubtaskEntity> {
  const now = nowIso();
  const entity: SubtaskEntity = {
    id: uuid(),
    taskId,
    title,
    done: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await idbPut(STORES.subtasks, entity);
  return entity;
}

export async function subtasksUpdate(id: string, patch: Partial<Pick<SubtaskEntity, 'title' | 'done'>>): Promise<void> {
  const row = await idbGet<SubtaskEntity>(STORES.subtasks, id);
  if (!row) return;
  await idbPut(STORES.subtasks, { ...row, ...patch, updatedAt: nowIso() });
}

export async function subtasksSoftDelete(id: string): Promise<void> {
  const row = await idbGet<SubtaskEntity>(STORES.subtasks, id);
  if (!row) return;
  const now = nowIso();
  await idbPut(STORES.subtasks, { ...row, deletedAt: now, updatedAt: now });
}

/* ---------------- یادآورها ---------------- */

export async function remindersUpsert(taskId: string, fireAt: string | null): Promise<void> {
  const rows = await idbGetAll<ReminderEntity>(STORES.reminders);
  const existing = rows.find((r) => r.taskId === taskId && !r.deletedAt);
  if (!fireAt) {
    if (existing) await idbDelete(STORES.reminders, existing.id);
    return;
  }
  const now = nowIso();
  if (existing) {
    await idbPut(STORES.reminders, { ...existing, fireAt, updatedAt: now });
  } else {
    await idbPut(STORES.reminders, {
      id: uuid(),
      taskId,
      fireAt,
      fired: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
}

/* ---------------- تنظیمات (Prefs) ---------------- */

export async function prefsGet<T>(key: string, fallback: T): Promise<T> {
  const row = await idbGet<PrefEntity>(STORES.prefs, key);
  return row ? (row.value as T) : fallback;
}

/** همه‌ی prefها — برای خواندن یک‌جای کلیدهای «list-sort:*» و «task-order:*» در init (فاز ۲) */
export async function prefsAll(): Promise<PrefEntity[]> {
  return idbGetAll<PrefEntity>(STORES.prefs);
}

export async function prefsSet(key: string, value: unknown): Promise<void> {
  await idbPut(STORES.prefs, { key, value } satisfies PrefEntity);
}

/* ---------------- Meta ---------------- */

export async function metaGet<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<PrefEntity>(STORES.meta, key);
  return row ? (row.value as T) : undefined;
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  await idbPut(STORES.meta, { key, value } satisfies PrefEntity);
}
