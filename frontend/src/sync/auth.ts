/**
 * کارام — سرویس ورود با کد یک‌بارمصرف (فاز ۳ — فاز ۵: بله ← تلگرام)
 * دو کانال: ایمیل (کد مستقیم) و تلگرام (بلیت اتصال به ربات، بعد کد).
 */

import { apiFetch, authedFetch } from './api';
import { clearSession, getDeviceUuid, getSession, setSession, type AuthChannel, type SyncSession } from './session';
import { wipeUserData } from '@/db/wipe';
import { pruneEmptyDefaultList } from '@/db/dedupe';

export interface AuthChannels {
  email: boolean;
  telegram: boolean;
  sms: boolean;
  botUsername: string;
}

export interface OtpRequestResult {
  channel: AuthChannel;
  target?: string;
  ticket?: string;
  botUsername?: string;
  deepLink?: string;
  expiresIn: number;
  resendAfter: number;
  devCode?: string; // فقط در حالت توسعه‌ی سرور
}

export interface VerifyResult {
  isNew: boolean;
  user: { uuid: string; displayName: string | null; gender?: 'unset' | 'male' | 'female'; email?: string; mobile?: string; telegramChatId?: string };
}

export interface ActiveSession {
  id: number;
  deviceId: string;
  deviceName: string | null;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export async function fetchChannels(): Promise<AuthChannels> {
  return apiFetch<AuthChannels>('/auth/channels');
}

export async function requestOtp(channel: AuthChannel, target?: string): Promise<OtpRequestResult> {
  const body: Record<string, unknown> = { channel };
  if (target) body.target = target;
  return apiFetch<OtpRequestResult>('/auth/otp/request', { method: 'POST', body });
}

export type TelegramPollStatus = 'pending' | 'code_sent' | 'expired' | 'unknown';

export async function pollTelegramTicket(ticket: string): Promise<{ status: TelegramPollStatus }> {
  return apiFetch<{ status: TelegramPollStatus }>('/auth/otp/telegram/poll', {
    method: 'POST',
    body: { ticket },
  });
}

interface VerifyResponse extends VerifyResult {
  device: { uuid: string; name: string };
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export async function verifyOtp(params: {
  channel: AuthChannel;
  target?: string;
  ticket?: string;
  code: string;
}): Promise<VerifyResult> {
  const deviceUuid = await getDeviceUuid();
  const res = await apiFetch<VerifyResponse>('/auth/otp/verify', {
    method: 'POST',
    body: {
      ...params,
      deviceUuid,
      deviceName: 'مرورگر وب',
    },
  });

  const identity = res.user.email
    ?? (res.user.mobile ? `موبایل: ${res.user.mobile}` : res.user.telegramChatId ? `تلگرام: ${res.user.telegramChatId}` : '');
  const session: SyncSession = {
    userUuid: res.user.uuid,
    email: identity,
    channel: params.channel,
    displayName: res.user.displayName,
    gender: res.user.gender ?? 'unset',
    accessToken: res.accessToken,
    expiresAt: res.expiresAt,
    refreshToken: res.refreshToken,
    refreshExpiresAt: res.refreshExpiresAt,
    deviceUuid,
    deviceName: 'مرورگر وب',
  };
  await setSession(session);
  // حریم خصوصی/شستشویی: اگر مهمان فقط لیست پیش‌فرضِ خالی داشته، با ورود به حساب پوش نشود
  try {
    await pruneEmptyDefaultList();
  } catch {
    /* محیط بدون IndexedDB — نادیده */
  }
  return { isNew: res.isNew, user: res.user };
}

/** خروج: ابطال refresh token سمت سرور + پاک‌سازی نشست + پاک‌سازی کامل داده‌ی محلی کاربر */
export async function logout(): Promise<void> {
  const s = await getSession();
  if (s) {
    try {
      await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken: s.refreshToken } });
    } catch {
      /* حتی اگر سرور در دسترس نبود، نشست محلی پاک می‌شود */
    }
  }
  await clearSession();
  // حریم خصوصی (ترمیم جریان — فاز ۱): داده‌ی این حساب هرگز نباید به حساب بعدی روی
  // همین دستگاه برسد — همه‌ی لیست‌ها/کارها/زیرکارها/یادآورها/meta پاک می‌شوند.
  await wipeUserData();
}

export async function updateProfile(displayName: string): Promise<{ displayName: string }> {
  const res = await authedFetch<{ user: { displayName: string } }>('/v1/me', {
    method: 'PATCH',
    body: { displayName },
  });
  const s = await getSession();
  if (s) {
    await setSession({ ...s, displayName: res.user.displayName });
  }
  return { displayName: res.user.displayName };
}

/** ثبت جنسیت/ظاهر انتخابی روی پروفایل (فاز ۴.۵) */
export async function updateGender(gender: 'male' | 'female' | 'unset'): Promise<void> {
  await authedFetch('/v1/me', { method: 'PATCH', body: { gender } });
  const s = await getSession();
  if (s) {
    await setSession({ ...s, gender });
  }
}

/** تنظیمات عمومی سرور — بدون احراز (فاز ۴.۵) */
export interface BootstrapPayload {
  appName: string;
  paywallTitle: string;
  minAppVersion: string;
  maintenance: boolean;
  voice: { enabled: boolean; provider: 'off' | 'web_speech'; rate: number; pitch: number; lang: string };
  channels: { email: boolean; telegram: boolean; sms: boolean; botUsername: string };
  /** v17 — کارت «نسخه جدید» در تنظیمات (خالی/ناموجود = غیرفعال) */
  update?: { latest: string | null; url: string | null; notes: string | null } | null;
  /** v17 — اطلاعات پشتیبانی در شیت قوانین و صفحه ورود */
  support?: { email: string | null; telegram: string | null } | null;
  /** ترمیم جریان — سقف آیتم سینک برای push تکه‌تکه (سرورهای قدیمی بدون این فیلد) */
  sync?: { maxItems?: number } | null;
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>('/v1/bootstrap');
}

export async function listSessions(): Promise<ActiveSession[]> {
  const s = await getSession();
  const res = await authedFetch<{ sessions: ActiveSession[] }>(
    `/v1/me/sessions${s ? `?deviceUuid=${encodeURIComponent(s.deviceUuid)}` : ''}`,
  );
  return res.sessions;
}

export async function revokeSession(id: number): Promise<void> {
  await authedFetch(`/v1/me/sessions/${id}`, { method: 'DELETE' });
}
