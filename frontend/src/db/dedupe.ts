/**
 * کارام — ادغام و پاک‌سازی محلی لیست‌ها (ترمیم جریان — فاز ۱)
 *
 * dedupeSeedLists: لیست‌های آزمایشی (seed) تکراریِ به‌جامانده از نسخه‌های قدیمی را
 * محلی ادغام می‌کند: قدیمی‌ترین (createdAt کوچک‌تر؛ تساوی → id کوچک‌تر) نگه داشته
 * می‌شود، بقیه تومب‌استون و کارهایشان به نگه‌دارنده منتقل می‌شود. تومب‌استون‌ها با
 * سینک بعدی به سرور و بقیه‌ی دستگاه‌ها می‌رسند — همگرایی کامل بدون هیچ حذف قطعی.
 *
 * pruneEmptyDefaultList: هنگام ورود به حساب، اگر تنها داده‌ی محلی «لیست پیش‌فرض
 * خالی» باشد، حذف نرم می‌شود تا حسابِ دارای داده با لیست بی‌فایده شلوغ نشود.
 */

import { idbGetAll, idbPut, STORES } from './idb';
import { nowIso } from '@/lib/uuid';
import { DEFAULT_LIST_ID, DEFAULT_LIST_NAME, SEED_LIST_NAMES } from '@/sync/lww';
import type { ListEntity, TaskEntity } from '@/types';

/**
 * نام‌های مشمول ادغام هم‌نام — سیدهای قدیمی + لیست پیش‌فرض (فاز نصب تمیز):
 * نصب‌های قدیمی‌تر از «شناسه‌ی قطعی»، لیست پیش‌فرض را با UUID تصادفی می‌ساختند؛
 * اگر دو دستگاه چنین لیستی را پوش کرده باشند، ادغام قطعی (قدیمی‌ترین نگه‌دار) رخ می‌دهد.
 */
export const MERGEABLE_LIST_NAMES: readonly string[] = [...SEED_LIST_NAMES, DEFAULT_LIST_NAME];

/** true یعنی تغییری کرد (کلاینت باید refresh + سینک بعدی) */
export async function dedupeSeedLists(): Promise<boolean> {
  const lists = await idbGetAll<ListEntity>(STORES.lists);
  const alive = lists.filter((l) => !l.deletedAt && MERGEABLE_LIST_NAMES.includes(l.name));
  if (alive.length < 2) return false;

  const byName = new Map<string, ListEntity[]>();
  for (const l of alive) {
    const arr = byName.get(l.name) ?? [];
    arr.push(l);
    byName.set(l.name, arr);
  }

  let changed = false;
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    // قطعی: قدیمی‌ترین برنده؛ تساوی → uuid کوچک‌تر
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const keeper = group[0];
    for (const loser of group.slice(1)) {
      const now = nowIso();
      await idbPut(STORES.lists, { ...loser, deletedAt: now, updatedAt: now });
      await reParentTasks(loser.id, keeper.id, now);
      changed = true;
    }
  }
  return changed;
}

async function reParentTasks(fromListId: string, toListId: string, now: string): Promise<void> {
  const tasks = await idbGetAll<TaskEntity>(STORES.tasks);
  for (const t of tasks) {
    if (t.listId === fromListId && !t.deletedAt) {
      await idbPut(STORES.tasks, { ...t, listId: toListId, updatedAt: now });
    }
  }
}

/**
 * هنگام ورود به حساب: اگر فقط یک لیستِ پیش‌فرضِ خالی داریم (هیچ کار زنده‌ای نیست)،
 * آن را حذف نرم می‌کنیم تا با سینک به حساب پوش نشود و در دستگاه دیگر هم ظاهر نشود.
 *
 * استثنا (فاز نصب تمیز): لیست پیش‌فرضِ «شناسه‌قطعی» (DEFAULT_LIST_ID) تومب‌استون
 * «نمی‌شود» — این لیست خودش «لیست حساب» است و در همه‌ی دستگاه‌ها همان شناسه را دارد؛
 * تومب‌استونِ تازه‌ترِ این دستگاه، رکورد زنده‌ی حساب را روی دستگاه‌های دیگر می‌کُشت و
 * دوباره‌سازی لازم می‌شد (جارِ LWW). ادغام هم‌شناسه در سرور تکراری بودن را ناممکن می‌کند.
 */
export async function pruneEmptyDefaultList(): Promise<void> {
  const lists = await idbGetAll<ListEntity>(STORES.lists);
  const alive = lists.filter((l) => !l.deletedAt);
  if (alive.length !== 1 || alive[0].name !== DEFAULT_LIST_NAME) return;
  if (alive[0].id === DEFAULT_LIST_ID) return;

  const tasks = await idbGetAll<TaskEntity>(STORES.tasks);
  const hasContent = tasks.some((t) => !t.deletedAt);
  if (hasContent) return;

  const now = nowIso();
  await idbPut(STORES.lists, { ...alive[0], deletedAt: now, updatedAt: now });
}
