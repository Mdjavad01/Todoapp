/**
 * کارام — نشست کاربر (فاز ۳)
 *
 * نشست کامل = Access Token کوتاه‌عمر + Refresh Token بلندعمر (چرخشی).
 * همه‌چیز در IndexedDB (prefs) ذخیره می‌شود تا با بقیه‌ی داده هم‌مسیر باشد.
 */

import { idbGet, idbPut, STORES } from '@/db/idb';
import type { PrefEntity } from '@/types';

export type AuthChannel = 'email' | 'telegram' | 'sms';

export interface SyncSession {
  userUuid: string;
  /** شناسه‌ی حساب برای نمایش: ایمیل یا «تلگرام: ۱۲۳۴…» */
  email: string;
  channel: AuthChannel;
  displayName: string | null;
  /** جنسیت/ظاهر انتخابی (unset تا بعد از ورود انتخاب شود) */
  gender?: 'unset' | 'male' | 'female';
  accessToken: string;
  expiresAt: string; // ISO UTC — انقضای access
  refreshToken: string;
  refreshExpiresAt: string; // ISO UTC — انقضای refresh
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

/** شناسه‌ی پایدار دستگاه — به refresh token سمت سرور گره می‌خورد */
export async function getDeviceUuid(): Promise<string> {
  const existing = await prefGet<string>('device-uuid');
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  await prefSet('device-uuid', fresh);
  return fresh;
}

/**
 * نشست جاری — حتی اگر access منقضی شده باشد برمی‌گردد (refresh معتبر = قابل تمدید).
 * فقط وقتی refresh هم نباشد/منقضی باشد null است.
 */
export async function getSession(): Promise<SyncSession | null> {
  const s = await prefGet<SyncSession>('sync-session');
  if (!s || !s.refreshToken) return null;
  // ۳۰ ثانیه زودتر از انقضای refresh، نشست را تمام‌شده بگیر
  if (new Date(s.refreshExpiresAt).getTime() < Date.now() + 30_000) return null;
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
