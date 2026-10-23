/**
 * کارام — لایه‌ی ارتباط با API (فاز ۲)
 * همه‌ی درخواست‌ها هم‌مبدا (relative) هستند — مطابق قانون CSP 'self'.
 */

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
