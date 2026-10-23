/**
 * کارام — نشست سینک کاربر (فاز ۲)
 * نشست و شناسه‌ی دستگاه در IndexedDB (prefs) ذخیره می‌شوند — نه در localStorage — تا با بقیه‌ی داده هم‌مسیر باشد.
 */

import { idbGet, idbPut, STORES } from '@/db/idb';
import type { PrefEntity } from '@/types';

export interface SyncSession {
  userUuid: string;
  email: string;
  displayName: string | null;
  accessToken: string;
  expiresAt: string; // ISO UTC
  deviceUuid: string;
  deviceName: string;
}

async function prefGet<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<PrefEntity>(STORES.prefs, key);
  return row ? (row.value as T) : undefined;
}

async function prefSet(key: string, value: unknown): Promise<void> {
  await idbPut(STORES.prefs, { key, value } satisfies PrefEntity);
}

/** شناسه‌ی پایدار دستگاه (برای گزارش‌های سینک — در فاز ۳ به refresh_tokens وصل می‌شود) */
export async function getDeviceUuid(): Promise<string> {
  const existing = await prefGet<string>('device-uuid');
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  await prefSet('device-uuid', fresh);
  return fresh;
}

export async function getSession(): Promise<SyncSession | null> {
  const s = await prefGet<SyncSession>('sync-session');
  if (!s || !s.accessToken) return null;
  // انقضای قطعی توکن — ۳۰ ثانیه زودتر برای اطمینان
  if (new Date(s.expiresAt).getTime() < Date.now() + 30_000) return null;
  return s;
}

export async function setSession(s: SyncSession): Promise<void> {
  await prefSet('sync-session', s);
}

export async function clearSession(): Promise<void> {
  await prefSet('sync-session', null);
  // کرسرهای سینک هم پاک می‌شوند تا ورود بعدی از نو همگام شود
  await prefSet('sync-cursor', null);
  await prefSet('sync-last-push', null);
}
