/**
 * کارام — پنل مدیریت: لایه‌ی API
 * - هم‌مبدا (relative) — مطابق قانون CSP 'self'
 * - توکن نشست ادمین در Bearer + هدر X-CSRF-Token برای درخواست‌های تغییردهنده
 * - ۴۰۱ → پاک‌سازی نشست و بازگشت به صفحه‌ی ورود
 */

export interface AdminSession {
  token: string;
  csrfToken: string;
  expiresAt: string;
  username: string;
  roleCode: string;
  roleTitle: string;
  permissions: string[];
}

/** آیا نشست جاری این دسترسی را دارد؟ (مدیر کل = همه‌چیز؛ مقاوم در برابر نشست‌های قدیمی) */
export function hasPerm(s: AdminSession | null, perm: string): boolean {
  if (!s) return false;
  if (s.roleCode === 'superadmin') return true;
  return Array.isArray(s.permissions) && s.permissions.includes(perm);
}

const STORAGE_KEY = 'karam-admin-session';

// فقط برای پیش‌نمایش سندباکس (پارامتر گیت‌وی) — در بیلد production خالی است
const EXTRA_QUERY: string = (import.meta.env.VITE_API_EXTRA_QUERY as string | undefined) ?? '';

function withExtraQuery(path: string): string {
  if (!EXTRA_QUERY) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${EXTRA_QUERY}`;
}

export function loadSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (!s.token || !s.csrfToken) return null;
    if (!Array.isArray(s.permissions)) s.permissions = []; // نشست قدیمی
    if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: AdminSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

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

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, opts: ApiOptions = {}, auth = true): Promise<T> {
  const session = auth ? loadSession() : null;
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) {
    headers['Authorization'] = `Bearer ${session.token}`;
    if (method !== 'GET') headers['X-CSRF-Token'] = session.csrfToken;
  }

  let res: Response;
  try {
    res = await fetch(withExtraQuery(`/api/admin${path}`), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'اتصال به سرور برقرار نشد', 'network');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* پاسخ غیر JSON */
  }
  const payload = (data ?? {}) as Record<string, unknown>;

  if (res.status === 401 && auth) {
    clearSession();
    if (onUnauthorized) onUnauthorized();
  }
  if (!res.ok || payload.ok === false) {
    throw new ApiError(
      res.status,
      (payload.error as string) ?? `خطای سرور (${res.status})`,
      payload.code as string | undefined,
    );
  }
  return payload as T;
}

export const api = {
  /** بدون احراز — فقط ورود */
  login: (username: string, password: string) =>
    request<{
      token: string;
      csrfToken: string;
      expiresAt: string;
      admin: { username: string; roleCode: string; roleTitle: string };
      permissions: string[];
    }>(
      '/login',
      { method: 'POST', body: { username, password } },
      false,
    ),
  logout: () => request<{ ok: boolean }>('/logout', { method: 'POST' }),
  me: () =>
    request<{
      admin: { id: number; username: string; roleCode: string; roleTitle: string };
      permissions: string[];
    }>('/me'),

  stats: () =>
    request<{
      stats: {
        users: { total: number; today: number; last7d: number; blocked: number; premium: number };
        content: { lists: number; tasks: number; subtasks: number; tasksCompleted: number };
        sessions: number;
        orders: { paidCount: number; paidAmountRials: number; pendingReview: number; monthPaidCount: number; monthPaidRials: number };
        sales: {
          monthOrderRials: number;
          monthDepositRials: number;
          monthTotalRials: number;
          monthDeposits: number;
          lifetimeTotalRials: number;
          paidUsers: number;
          activePremium: number;
          conversionPercent: number;
        };
        signupsSeries: { date: string; count: number }[];
        salesSeries: { month: string; revenueRials: number }[];
      };
    }>('/stats'),

  users: (params: { q?: string; status?: string; page?: number; perPage?: number }) =>
    request<Paginated<AdminUserRow>>(`/users${qs(params)}`),
  user: (id: number) => request<AdminUserDetail>(`/users/${id}`),
  updateUser: (id: number, body: Record<string, unknown>) =>
    request<{ message: string }>(`/users/${id}`, { method: 'PATCH', body }),
  grantPremium: (id: number, body: Record<string, unknown>) =>
    request<{ message: string; premiumUntil: string }>(`/users/${id}/premium`, { method: 'POST', body }),
  revokeSessions: (id: number) =>
    request<{ message: string }>(`/users/${id}/revoke-sessions`, { method: 'POST' }),

  plans: () => request<{ items: AdminPlan[] }>('/plans'),
  updatePlan: (id: number, body: Record<string, unknown>) =>
    request<{ message: string }>(`/plans/${id}`, { method: 'PATCH', body }),

  announcements: (page = 1) => request<Paginated<AdminAnnouncement>>(`/announcements?page=${page}`),
  createAnnouncement: (body: Record<string, unknown>) =>
    request<{ message: string; id: number }>('/announcements', { method: 'POST', body }),
  updateAnnouncement: (id: number, body: Record<string, unknown>) =>
    request<{ message: string }>(`/announcements/${id}`, { method: 'PATCH', body }),
  deleteAnnouncement: (id: number) =>
    request<{ message: string }>(`/announcements/${id}`, { method: 'DELETE' }),

  settings: () => request<{ items: { key: string; value: string; updatedAt: string }[]; editable: string[] }>('/settings'),
  updateSettings: (body: Record<string, string>) =>
    request<{ message: string; changed: string[]; telegram?: { ok: boolean; bot?: string; error?: string } }>('/settings', { method: 'PATCH', body }),

  // ---- واریزی کارت‌به‌کارت (فاز ۸) ----
  deposits: (params: { status?: string; page?: number }) =>
    request<Paginated<AdminDepositRow>>(`/deposits${qs(params)}`),
  approveDeposit: (id: number, note?: string) =>
    request<{ message: string; premiumUntil: string }>(`/deposits/${id}/approve`, { method: 'POST', body: note ? { note } : {} }),
  rejectDeposit: (id: number, note?: string) =>
    request<{ message: string }>(`/deposits/${id}/reject`, { method: 'POST', body: note ? { note } : {} }),

  // ---- کدهای هدیه (v20) ----
  giftcodes: () => request<{ items: AdminGiftCode[] }>('/giftcodes'),
  createGiftcode: (body: Record<string, unknown>) =>
    request<{ message: string; id: number; code: string }>('/giftcodes', { method: 'POST', body }),
  updateGiftcode: (id: number, body: Record<string, unknown>) =>
    request<{ message: string }>(`/giftcodes/${id}`, { method: 'PATCH', body }),

  // ---- شورتکد ورود OTP (فاز ۴.۵ — فاز ۵: بله ← تلگرام) ----
  otpRequest: (channel: 'email' | 'telegram' | 'sms', target?: string) =>
    request<{
      channel: 'email' | 'telegram' | 'sms';
      target?: string;
      code?: string;
      ticket?: string;
      deepLink?: string;
      botUsername?: string;
      expiresAt?: string;
      sent?: { ok: boolean; mode: string };
    }>('/otp/request', { method: 'POST', body: target ? { channel, target } : { channel } }),
  otpTelegramPoll: (ticket: string) =>
    request<{ status: 'pending' | 'code_sent' | 'expired' | 'unknown'; code?: string; chatId?: string; botUsername?: string }>(
      '/otp/telegram/poll',
      { method: 'POST', body: { ticket } },
    ),
  otpVerify: (body: { channel: 'email' | 'telegram' | 'sms'; target?: string; ticket?: string; code: string }) =>
    request<{
      isNew: boolean;
      user: { uuid: string; displayName: string | null; gender: string; email?: string; mobile?: string; telegramChatId?: string };
      accessToken: string;
      refreshToken: string;
    }>('/otp/verify', { method: 'POST', body }),

  audit: (params: { actor?: string; action?: string; page?: number }) =>
    request<Paginated<AdminAuditRow>>(`/audit${qs(params)}`),
};

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/* ---------------- انواع داده ---------------- */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export interface AdminUserRow {
  id: number;
  uuid: string;
  displayName: string | null;
  email: string | null;
  status: 'active' | 'blocked' | 'deleted';
  premiumUntil: string | null;
  isPremium: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  listsCount: number;
  tasksCount: number;
}

export interface AdminUserDetail {
  user: {
    id: number;
    uuid: string;
    displayName: string | null;
    status: 'active' | 'blocked' | 'deleted';
    premiumUntil: string | null;
    isPremium: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  identities: { type: string; value: string; isPrimary: boolean; verifiedAt: string | null; createdAt: string }[];
  subscriptions: { uuid: string; source: string; planTitle: string | null; startsAt: string; expiresAt: string | null; createdAt: string }[];
  counts: { lists: number; tasks: number; subtasks: number; activeSessions: number };
}

export interface AdminPlan {
  id: number;
  uuid: string;
  code: string;
  title: string;
  months: number;
  priceRials: number;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface AdminAnnouncement {
  id: number;
  uuid: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'premium';
  linkUrl: string | null;
  imageUrl: string | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditRow {
  id: number;
  actorType: 'admin' | 'user' | 'system';
  actorId: number | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminDepositRow {
  id: number;
  uuid: string;
  user: { uuid: string | null; displayName: string | null };
  planCode: string;
  planTitle: string | null;
  amountRials: number;
  discountRials?: number;
  couponCode?: string | null;
  reference: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** v20 — کد هدیه (جدول coupons از فاز ۵) */
export interface AdminGiftCode {
  id: number;
  uuid: string;
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  maxUses: number; // ۰ = بی‌نهایت
  usedCount: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}
