/**
 * کارام — سرویس ورود با کد یک‌بارمصرف (فاز ۳)
 * دو کانال: ایمیل (کد مستقیم) و بله (بلیت اتصال به ربات، بعد کد).
 */

import { apiFetch, authedFetch } from './api';
import { clearSession, getDeviceUuid, getSession, setSession, type AuthChannel, type SyncSession } from './session';

export interface AuthChannels {
  email: boolean;
  bale: boolean;
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
  user: { uuid: string; displayName: string | null; email?: string; baleChatId?: string };
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

export type BalePollStatus = 'pending' | 'code_sent' | 'expired' | 'unknown';

export async function pollBaleTicket(ticket: string): Promise<{ status: BalePollStatus }> {
  return apiFetch<{ status: BalePollStatus }>('/auth/otp/bale/poll', {
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

  const identity = res.user.email ?? (res.user.baleChatId ? `بله: ${res.user.baleChatId}` : '');
  const session: SyncSession = {
    userUuid: res.user.uuid,
    email: identity,
    channel: params.channel,
    displayName: res.user.displayName,
    accessToken: res.accessToken,
    expiresAt: res.expiresAt,
    refreshToken: res.refreshToken,
    refreshExpiresAt: res.refreshExpiresAt,
    deviceUuid,
    deviceName: 'مرورگر وب',
  };
  await setSession(session);
  return { isNew: res.isNew, user: res.user };
}

/** خروج: ابطال refresh token سمت سرور + پاک‌سازی محلی */
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
