/**
 * کارام — موتور سینک دوسویه (فاز ۲)
 *
 * قرارداد: هر موجودیت = UUID سمت کلاینت + updatedAt + حذف نرم (deletedAt).
 *  - push: همه‌ی رکوردهای محلی که از آخرین push موفق تغییر کرده‌اند (شامل تومب‌استون‌ها).
 *  - pull: رکوردهای معتبر سرور از روی کرسر + تضارب‌های LWW.
 *  - اعمال سرور: فقط اگر server.updatedAt جدیدتر از محلی باشد (محتوای یکسان بی‌اثر است).
 * یادآورها (reminders) در فاز ۲ محلی می‌مانند و سینک نمی‌شوند.
 */

import { idbGet, idbGetAll, idbPut, STORES, type StoreName } from '@/db/idb';
import { apiFetch, ApiError } from './api';
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
};

const listeners: Listeners = {};

export function setSyncListeners(l: Listeners): void {
  listeners.onState = l.onState;
  listeners.onApplied = l.onApplied;
}

let state: SyncState = { status: 'idle', lastSyncAt: null, error: null };

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  listeners.onState?.(state);
}

export function getSyncState(): SyncState {
  return state;
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
  changes: {
    lists: ListEntity[];
    tasks: TaskEntity[];
    subtasks: SubtaskEntity[];
  };
}

async function collectChanges(sinceIso: string | null): Promise<SyncPayload> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : Number.NEGATIVE_INFINITY;
  const fresh = <T extends { updatedAt: string }>(rows: T[]): T[] =>
    rows.filter((r) => Date.parse(r.updatedAt) > sinceMs);

  const [lists, tasks, subtasks] = await Promise.all([
    idbGetAll<ListEntity>(STORES.lists),
    idbGetAll<TaskEntity>(STORES.tasks),
    idbGetAll<SubtaskEntity>(STORES.subtasks),
  ]);

  return {
    cursor: await metaGet<string>('sync-cursor') ?? null,
    changes: {
      lists: fresh(lists),
      tasks: fresh(tasks),
      subtasks: fresh(subtasks),
    },
  };
}

/** اعمال رکوردهای معتبر سرور — فقط اگر جدیدتر از نسخه‌ی محلی باشد */
async function applyServerRows(
  lists: ListEntity[],
  tasks: TaskEntity[],
  subtasks: SubtaskEntity[],
): Promise<boolean> {
  let changed = false;

  const merge = async <T extends { id: string; updatedAt: string }>(store: StoreName, rows: T[]): Promise<void> => {
    for (const row of rows) {
      const local = await idbGet<T>(store, row.id);
      if (!local || Date.parse(row.updatedAt) > Date.parse(local.updatedAt)) {
        await idbPut(store, row);
        changed = true;
      }
    }
  };

  await merge(STORES.lists, lists);
  await merge(STORES.tasks, tasks);
  await merge(STORES.subtasks, subtasks);
  return changed;
}

/* ---------------- چرخه‌ی سینک ---------------- */

interface SyncResponse {
  applied: Record<string, number>;
  rejected: { entity: string; id: string; reason: string }[];
  server: { lists: ListEntity[]; tasks: TaskEntity[]; subtasks: SubtaskEntity[] };
  cursor: string;
  serverTime: string;
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
    const payload = await collectChanges(await metaGet<string>('sync-last-push') ?? null);

    const res = await apiFetch<SyncResponse>('/v1/sync', {
      method: 'POST',
      token: session.accessToken,
      body: payload,
    });

    const changed = await applyServerRows(res.server.lists, res.server.tasks, res.server.subtasks);
    await metaSet('sync-cursor', res.cursor);
    await metaSet('sync-last-push', cycleStart);

    setState({
      status: 'ok',
      lastSyncAt: new Date().toISOString(),
      error: res.rejected.length > 0 ? `${res.rejected.length} آیتم سینک نشد` : null,
    });
    if (changed) listeners.onApplied?.();
    return state;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === 'unauthorized')) {
      // توکن باطل/منقضی — نشست پاک می‌شود (فاز ۳: با refresh token بدون خروج خودکار می‌شود)
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

/** تریگرهای خودکار: رفتن به حالت آنلاین + بازه‌ی ۶۰ ثانیه‌ای — یک‌بار در init اپ */
export function startSyncLoop(): void {
  if (loopStarted || typeof window === 'undefined') return;
  loopStarted = true;
  window.addEventListener('online', () => void runSync());
  window.setInterval(() => {
    void getSession().then((s) => {
      if (s) queueSync(0);
    });
  }, 60_000);
}
