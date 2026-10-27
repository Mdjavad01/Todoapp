/**
 * کارام — موتور سینک دوسویه (فاز ۲ + ترمیم جریان فاز ۱)
 *
 * قرارداد: هر موجودیت = UUID سمت کلاینت + updatedAt + حذف نرم (deletedAt).
 *  - push تکه‌تکه (chunk): تغییرات به بخش‌های زیر سقف سرور تقسیم و به‌ترتیب فرستاده می‌شود
 *    (چانک‌های میانی pull=0) — سقف آیتم دیگر کل درخواست را ۴۲۲ نمی‌کند.
 *  - pull صفحه‌بندی‌شده: پاسخ با پرچم incomplete ناتمام را اعلام می‌کند؛ ادامه با همان کرسر
 *    تا تکمیل — کرسر فقط در پایان چرخه ذخیره می‌شود (هیچ تغییری از دست نمی‌رود).
 *  - تضارب LWW قطعی (یکسان با سرور): (updatedAt, rev, revDevice) — sync/lww.ts
 *  - ساعت: serverTime هر پاسخ، اختلاف ساعت دستگاه را جبران می‌کند (lib/clock.ts)؛
 *    هشدار clockSkew سرور پیام فارسی می‌دهد — دیگر هیچ آیتمی بی‌صدا رد نمی‌شود.
 * یادآورها موجودیت مستقل سینک نمی‌شوند (تصمیم سند ممیزی، بخش هـ): فیلد reminderMinutes
 * روی خود کار سینک می‌شود و fireAt در هر دستگاه به‌صورت قطعی از آن ساخته می‌شود (فاز ۴).
 */

import { idbGet, idbGetAll, idbPut, STORES, type StoreName } from '@/db/idb';
import { dedupeSeedLists } from '@/db/dedupe';
import { setClockOffset } from '@/lib/clock';
import { revTupleStrictlyNewer, chunkChanges, emptyChanges, type SyncChanges } from './lww';
import { authedFetch, ApiError } from './api';
import { getSession, clearSession, type SyncSession } from './session';
import type { ListEntity, PrefEntity, SubtaskEntity, TaskEntity } from '@/types';

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  error: string | null;
}

type Listeners = {
  onState?: (s: SyncState) => void;
  onApplied?: () => void;
  /** پیام‌های فارسی موقت (مثل جبران ساعت) */
  onNotice?: (text: string) => void;
};

const listeners: Listeners = {};

export function setSyncListeners(l: Listeners): void {
  listeners.onState = l.onState;
  listeners.onApplied = l.onApplied;
  listeners.onNotice = l.onNotice;
}

let state: SyncState = { status: 'idle', lastSyncAt: null, error: null };

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  listeners.onState?.(state);
}

export function getSyncState(): SyncState {
  return state;
}

/* ---------------- پیکربندی (از bootstrap سرور) ---------------- */

interface SyncConfig {
  /** اندازه‌ی هر چانک push — از سقف سرور (bootstrap.sync.maxItems) می‌آید */
  chunkSize: number;
}

const config: SyncConfig = { chunkSize: 500 };

export function setSyncConfig(patch: Partial<SyncConfig>): void {
  if (patch.chunkSize !== undefined) {
    config.chunkSize = Math.max(50, Math.min(500, Math.floor(patch.chunkSize)));
  }
}

/* ---------------- ابزار meta ---------------- */

async function metaGet<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<PrefEntity>(STORES.meta, key);
  return row ? (row.value as T) : undefined;
}

async function metaSet(key: string, value: unknown): Promise<void> {
  await idbPut(STORES.meta, { key, value } satisfies PrefEntity);
}

/* ---------------- گردآوری تغییرات محلی ---------------- */

interface SyncPayload {
  cursor: string | null;
  /** ۱ = با pull برگرد (چانک آخر/سینک خالی) — ۰ = فقط push (چانک‌های میانی) */
  pull: 0 | 1;
  /** شناسه‌ی دستگاه برای شکستن تساوی LWW سمت سرور */
  deviceUuid: string;
  changes: SyncChanges;
}

async function collectChanges(sinceIso: string | null): Promise<SyncChanges> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : Number.NEGATIVE_INFINITY;
  const fresh = <T extends { updatedAt: string }>(rows: T[]): T[] =>
    rows.filter((r) => Date.parse(r.updatedAt) > sinceMs);

  const [lists, tasks, subtasks] = await Promise.all([
    idbGetAll<ListEntity>(STORES.lists),
    idbGetAll<TaskEntity>(STORES.tasks),
    idbGetAll<SubtaskEntity>(STORES.subtasks),
  ]);

  return {
    lists: fresh(lists),
    tasks: fresh(tasks),
    subtasks: fresh(subtasks),
  };
}

/** اعمال رکوردهای سرور — با همان قاعده‌ی قطعی سرور؛ فقط «کاملاً جدیدتر» اعمال می‌شود */
async function applyServerRows(server: SyncResponse['server']): Promise<boolean> {
  let changed = false;

  const merge = async <T extends { id: string; updatedAt: string; rev?: number; revDevice?: string }>(
    store: StoreName,
    rows: T[],
  ): Promise<void> => {
    for (const row of rows) {
      const local = await idbGet<T>(store, row.id);
      if (!local || revTupleStrictlyNewer(row, local)) {
        await idbPut(store, row);
        changed = true;
      }
    }
  };

  await merge(STORES.lists, server.lists ?? []);
  await merge(STORES.tasks, server.tasks ?? []);
  await merge(STORES.subtasks, server.subtasks ?? []);
  return changed;
}

/* ---------------- چرخه‌ی سینک ---------------- */

interface SyncResponse {
  applied: Record<string, number>;
  rejected: { entity: string; id: string; reason: string }[];
  server: { lists: ListEntity[]; tasks: TaskEntity[]; subtasks: SubtaskEntity[] };
  cursor: string;
  serverTime: string;
  /** pull ناتمام — ادامه با pageCursor تا هیچ رکوردی از دست نرود */
  incomplete?: boolean;
  /** آیتم‌هایی که ساعتشان جلو بود و به زمان سرور بریده شد */
  clockSkew?: { entity: string; id: string; offset: number }[];
  /** کرسرِ ادامه‌ی صفحه‌بندی — فقط وقتی incomplete=true معنا دارد (ذخیره نمی‌شود) */
  pageCursor?: string | null;
}

let running = false;
let rerunRequested = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function runSync(): Promise<SyncState> {
  if (running) {
    rerunRequested = true;
    return state;
  }
  running = true;
  setState({ status: 'syncing', error: null });

  try {
    const session: SyncSession | null = await getSession();
    if (!session) {
      setState({ status: 'idle', error: 'برای سینک باید وارد حساب شوید' });
      return state;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState({ status: 'error', error: 'دستگاه آفلاین است؛ بعد از اتصال دوباره سینک می‌شود' });
      return state;
    }

    // نقطه‌ی شروع چرخه (۱ ثانیه احتیاط برای رکوردهای هم‌میلی‌ثانیه‌ای)
    const cycleStart = new Date(Date.now() - 1000).toISOString();
    const storedCursor = (await metaGet<string>('sync-cursor')) ?? null;
    const changes = await collectChanges((await metaGet<string>('sync-last-push')) ?? null);
    const chunks = chunkChanges(changes, config.chunkSize);

    let res: SyncResponse;

    // ---------- PUSH تکه‌تکه ----------
    if (chunks.length > 0) {
      let last!: SyncResponse; // حلقه حداقل یک‌بار اجرا می‌شود (chunks.length > 0)
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const payload: SyncPayload = {
          cursor: storedCursor, // pull فقط روی چانک آخر انجام می‌شود
          pull: isLast ? 1 : 0,
          deviceUuid: session.deviceUuid,
          changes: chunks[i],
        };
        // authedFetch روی ۴۰۱ خودکار refresh می‌کند و یک‌بار تلاش را تکرار می‌کند (فاز ۳)
        last = await authedFetch<SyncResponse>('/v1/sync', { method: 'POST', body: payload });
        // هر چانکِ موفق، نقطه‌ی بازگشت idempotent است (شکست چانک بعدی = تلاش مجدد همین‌ها)
        await metaSet('sync-last-push', cycleStart);
      }
      res = last;
    } else {
      const payload: SyncPayload = {
        cursor: storedCursor,
        pull: 1,
        deviceUuid: session.deviceUuid,
        changes: emptyChanges(),
      };
      res = await authedFetch<SyncResponse>('/v1/sync', { method: 'POST', body: payload });
    }

    // ---------- PULL صفحه‌بندی‌شده ----------
    let applied = await applyServerRows(res.server);
    if (!res.incomplete) {
      await metaSet('sync-cursor', res.cursor);
    }
    // ناتمام = ادامه از انتهای صفحه‌ی دریافتی (pageCursor) تا هیچ رکوردی از دست نرود؛
    // کرسرِ ذخیره‌شده فقط در پایان چرخه به‌روز می‌شود.
    let continuationCursor = storedCursor;
    for (let round = 0; res.incomplete === true && round < 20; round++) {
      if (res.pageCursor) continuationCursor = res.pageCursor;
      const more: SyncPayload = {
        cursor: continuationCursor,
        pull: 1,
        deviceUuid: session.deviceUuid,
        changes: emptyChanges(),
      };
      res = await authedFetch<SyncResponse>('/v1/sync', { method: 'POST', body: more });
      applied = (await applyServerRows(res.server)) || applied;
      if (!res.incomplete) {
        await metaSet('sync-cursor', res.cursor);
      }
    }

    // ---------- جبران ساعت ----------
    if (setClockOffset(res.serverTime)) {
      listeners.onNotice?.('ساعت دستگاه شما با سرور هماهنگ شد');
    }
    if (res.clockSkew && res.clockSkew.length > 0) {
      listeners.onNotice?.('چند مورد با ساعت جلوتر ثبت شده بود؛ به زمان سرور اصلاح شد');
    }

    // ---------- ادغام لیست‌های سید تکراری (نصب‌های قدیمی) ----------
    if (applied && (await dedupeSeedLists())) {
      applied = true; // تومب‌استون‌های محلی با سینک بعدی به سرور می‌روند
    }

    setState({
      status: 'ok',
      lastSyncAt: new Date().toISOString(),
      error: res.rejected.length > 0 ? `${res.rejected.length} آیتم سینک نشد` : null,
    });
    if (applied) listeners.onApplied?.();
    return state;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === 'unauthorized')) {
      // تمدید خودکار هم ناموفق بود — نشست واقعاً تمام است (clearSession انجام شده)
      await clearSession();
      setState({ status: 'idle', error: 'نشست منقضی شده است؛ دوباره وارد شوید' });
      listeners.onApplied?.();
      return state;
    }
    setState({
      status: 'error',
      error: e instanceof Error ? e.message : 'خطای ناشناخته در سینک',
    });
    return state;
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      queueSync(300);
    }
  }
}

/** زمان‌بندی سینک با تأخیر (debounce) — بعد از هر تغییر داده صدا زده می‌شود */
export function queueSync(delayMs = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runSync();
  }, delayMs);
}

let loopStarted = false;

/**
 * تریگرهای خودکار — یک‌بار در init اپ:
 *  - رفتن به حالت آنلاین
 *  - بازه‌ی ۶۰ ثانیه‌ای
 *  - برگشتن به تب/پیش‌زمینه در وب (visibilitychange) — اندروید از طریق onAppResume (App.tsx)
 */
export function startSyncLoop(): void {
  if (loopStarted || typeof window === 'undefined') return;
  loopStarted = true;
  window.addEventListener('online', () => void runSync());
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void getSession().then((s) => {
          if (s) void runSync();
        });
      }
    });
  }
  window.setInterval(() => {
    void getSession().then((s) => {
      if (s) queueSync(0);
    });
  }, 60_000);
}
