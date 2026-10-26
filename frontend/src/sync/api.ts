/**
 * کارام — لایه‌ی ارتباط با API (فاز ۳)
 * همه‌ی درخواست‌ها هم‌مبدا (relative) هستند — مطابق قانون CSP 'self'.
 *
 * authedFetch: توکن می‌گذارد و روی ۴۰۱ یک‌بار با Refresh Token تمدید و درخواست را تکرار می‌کند.
 * تمدید single-flight است تا چند درخواست هم‌زمان فقط یک‌بار refresh بزنند.
 */

import { clearSession, getSession, setSession, type SyncSession } from './session';
import { appPlatform } from '@/lib/native';

const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
// فقط برای پیش‌نمایش سندباکس (پارامتر گیت‌وی) — در بیلد production خالی است
const EXTRA_QUERY: string = (import.meta.env.VITE_API_EXTRA_QUERY as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function withExtraQuery(path: string): string {
  if (!EXTRA_QUERY) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${EXTRA_QUERY}`;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // گام ۲ — پلتفرم اپ برای کلید خاموش‌کردن پرداخت‌ها (نبودن = وب سمت سرور)
  headers['X-App-Platform'] = appPlatform();

  let res: Response;
  try {
    res = await fetch(withExtraQuery(`${API_BASE}${path}`), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'اتصال به سرور برقرار نشد؛ اینترنت را بررسی کنید', 'network');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* پاسخ غیر JSON */
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  if (!res.ok || payload.ok === false) {
    throw new ApiError(
      res.status,
      (payload.error as string) ?? `خطای سرور (${res.status})`,
      payload.code as string | undefined,
    );
  }
  return payload as T;
}

/* ---------------- تمدید خودکار نشست (فاز ۳) ---------------- */

let refreshInFlight: Promise<boolean> | null = null;

/** یک‌بارمصرف: با Refresh Token فعلی نشست را تمدید می‌کند؛ موفق = true */
export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const s = await getSession();
    if (!s) return false;
    try {
      const res = await apiFetch<{
        accessToken: string;
        expiresAt: string;
        refreshToken: string;
        refreshExpiresAt: string;
        user: { uuid: string; displayName: string | null };
      }>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: s.refreshToken, deviceUuid: s.deviceUuid },
      });
      const fresh: SyncSession = {
        ...s,
        userUuid: res.user.uuid,
        displayName: res.user.displayName ?? s.displayName,
        accessToken: res.accessToken,
        expiresAt: res.expiresAt,
        refreshToken: res.refreshToken,
        refreshExpiresAt: res.refreshExpiresAt,
      };
      await setSession(fresh);
      return true;
    } catch (e) {
      // دفاع v10: فقط خطای احراز (۴۰۱) یعنی نشست واقعاً تمام است؛
      // قطعی اینترنت یا خطای سرور نباید کاربر آفلاین را لاگ‌اوت کند
      if (e instanceof ApiError && e.status === 401) {
        await clearSession();
      }
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * درخواست احرازشده — با تمدید خودکار روی ۴۰۱.
 * خطای ۴۰۱ِ نهایی یعنی نشست واقعاً تمام شده (clearSession انجام شده است).
 */
export async function authedFetch<T>(path: string, opts: Omit<ApiOptions, 'token'> = {}): Promise<T> {
  const session = await getSession();
  if (!session) {
    throw new ApiError(401, 'برای این کار باید وارد حساب شوید', 'unauthorized');
  }
  try {
    return await apiFetch<T>(path, { ...opts, token: session.accessToken });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === 'unauthorized')) {
      const ok = await refreshSession();
      if (!ok) throw new ApiError(401, 'نشست منقضی شده است؛ دوباره وارد شوید', 'unauthorized');
      const fresh = await getSession();
      if (!fresh) throw new ApiError(401, 'نشست منقضی شده است؛ دوباره وارد شوید', 'unauthorized');
      return apiFetch<T>(path, { ...opts, token: fresh.accessToken });
    }
    throw e;
  }
}
