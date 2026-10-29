import { idbGetAll, idbPut, seedTransaction, STORES } from './idb';
import { metaGet, metaSet } from './repo';
import { nowIso, uuid } from '@/lib/uuid';
import { DEFAULT_LIST_ID } from '@/sync/lww';
import type { ListEntity, ReminderEntity, PrefEntity } from '@/types';

/**
 * داده‌ی اولیه (ترمیم جریان — فاز ۱):
 *  - داده‌ی آزمایشی چندلیستی/چندکارِ نسخه‌های قدیمی «حذف شد» — همان عامل اصلی لیست‌های
 *    تکراری بین دستگاه‌ها بود (هر دستگاه UUIDهای تصادفی خودش را می‌ساخت و با سینک پوش می‌کرد).
 *  - مهمانِ تازه فقط «یک لیست پیش‌فرض قطعی» می‌گیرد؛ کاربرِ واردشده لیست‌هایش از سینک می‌آید.
 *  - نصب‌های موجود دست نمی‌خورند (seededVersion موجود = حفظ داده‌ی واقعی کاربر).
 *  - مهاجرت شناسه‌های سید خیلی قدیمی (فاز ۱ اولیه: «seed-list-bills» → UUID) حفظ شده است.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** در اولین اجرا لیست پیش‌فرض ساخته می‌شود؛ اجراهای بعدی دست نمی‌زنند */
export async function ensureDefaultData(): Promise<void> {
  const seeded = await metaGet<number>('seededVersion');
  if (seeded) {
    if (seeded < 2) await migrateSeedIds();
    await metaSet('seededVersion', 2);
  }

  const marked = await metaGet<number>('default-list-v1');
  if (marked) return;

  // فقط وقتی هیچ لیست زنده‌ای نیست، لیست پیش‌فرض ساخته می‌شود — با «شناسه‌ی قطعی» تا
  // دو دستگاه هرگز دو لیست پیش‌فرض جدا نسازند (فاز نصب تمیز)
  const lists = await idbGetAll<ListEntity>(STORES.lists);
  if (!lists.some((l) => !l.deletedAt)) {
    const now = nowIso();
    const entity: ListEntity = {
      id: DEFAULT_LIST_ID,
      name: 'کارهای من',
      emoji: '🗂️',
      color: 'teal',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await idbPut(STORES.lists, entity);
  }
  await metaSet('default-list-v1', 1);
}

/**
 * بعد از سینک (فاز نصب تمیز): اگر حساب/دستگاه هیچ لیست زنده‌ای ندارد (مثلاً ورود به
 * حساب تازه که لیست خالی مهمان آن با prune حذف شده)، لیست پیش‌فرضِ قطعی ساخته می‌شود.
 * چون شناسه ثابت است، اگر دستگاه دیگری هم همین را ساخته باشد، در سرور ادغام می‌شود.
 * @returns true اگر لیستی ساخته شد (تماس‌دهنده باید refresh + سینک بعدی کند)
 */
export async function ensureAliveDefaultList(): Promise<boolean> {
  const lists = await idbGetAll<ListEntity>(STORES.lists);
  if (lists.some((l) => !l.deletedAt)) return false;
  const now = nowIso();
  await idbPut(STORES.lists, {
    id: DEFAULT_LIST_ID,
    name: 'کارهای من',
    emoji: '🗂️',
    color: 'teal',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return true;
}

/**
 * مهاجرت نصب‌های فاز ۱: شناسه‌های seed (مثل «seed-list-bills») به UUID واقعی تبدیل می‌شوند
 * تا قرارداد سینک سرور (UUID) رعایت شود. روابط (listId/taskId) بازنگاشت می‌شوند.
 */
async function migrateSeedIds(): Promise<void> {
  const [lists, tasks, subs, rems] = await Promise.all([
    idbGetAll<ListEntity>(STORES.lists),
    idbGetAll<{ id: string; listId?: string; taskId?: string; updatedAt: string }>(STORES.tasks),
    idbGetAll<{ id: string; taskId?: string; updatedAt: string }>(STORES.subtasks),
    idbGetAll<ReminderEntity>(STORES.reminders),
  ]);

  const needs =
    lists.some((l) => !UUID_RE.test(l.id)) ||
    tasks.some((t) => !UUID_RE.test(t.id)) ||
    subs.some((s) => !UUID_RE.test(s.id)) ||
    rems.some((r) => !UUID_RE.test(r.id));

  if (!needs) {
    await metaSet('seededVersion', 2);
    return;
  }

  const now = nowIso();
  const listMap = new Map(lists.map((l) => [l.id, UUID_RE.test(l.id) ? l.id : uuid()]));
  const taskMap = new Map(tasks.map((t) => [t.id, UUID_RE.test(t.id) ? t.id : uuid()]));

  await seedTransaction(async (stores) => {
    for (const l of lists) {
      const id = listMap.get(l.id)!;
      stores[STORES.lists].delete(l.id);
      stores[STORES.lists].put({ ...l, id, updatedAt: now });
    }
    for (const t of tasks) {
      const id = taskMap.get(t.id)!;
      stores[STORES.tasks].delete(t.id);
      stores[STORES.tasks].put({ ...t, id, listId: t.listId ? listMap.get(t.listId) ?? t.listId : t.listId, updatedAt: now });
    }
    for (const s of subs) {
      const id = UUID_RE.test(s.id) ? s.id : uuid();
      stores[STORES.subtasks].delete(s.id);
      stores[STORES.subtasks].put({ ...s, id, taskId: s.taskId ? taskMap.get(s.taskId) ?? s.taskId : s.taskId, updatedAt: now });
    }
    for (const r of rems) {
      const id = UUID_RE.test(r.id) ? r.id : uuid();
      stores[STORES.reminders].delete(r.id);
      stores[STORES.reminders].put({ ...r, id, taskId: taskMap.get(r.taskId) ?? r.taskId, updatedAt: now });
    }
    stores[STORES.meta].put({ key: 'seededVersion', value: 2 } satisfies PrefEntity);
  });
}
