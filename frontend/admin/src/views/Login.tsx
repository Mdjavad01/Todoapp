/**
 * کارام — پنل مدیریت: صفحه‌ی ورود
 */
import { useState, type FormEvent } from 'react';
import { api, saveSession, ApiError, type AdminSession } from '../api';
import { faNum } from '../format';

export default function Login({ onLogin }: { onLogin: (s: AdminSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(username.trim(), password);
      const session: AdminSession = {
        token: res.token,
        csrfToken: res.csrfToken,
        expiresAt: res.expiresAt,
        username: res.admin.username,
        roleCode: res.admin.roleCode,
        roleTitle: res.admin.roleTitle,
        permissions: res.permissions ?? [],
      };
      saveSession(session);
      onLogin(session);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message + (err.status === 423 ? ' — چند دقیقه بعد دوباره تلاش کنید' : ''));
      } else {
        setError('خطای نامشخص؛ دوباره تلاش کنید');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-700 via-brand-600 to-brand-800 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-pop">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-card">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <h1 className="text-lg font-black text-slate-800">ورود به پنل مدیریت کارام</h1>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            با نام کاربری و رمز عبور مدیر وارد شوید — {faNum(5)} تلاش ناموفق، حساب {faNum(15)} دقیقه قفل می‌شود.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label className="label" htmlFor="username">نام کاربری</label>
            <input
              id="username"
              className="field"
              autoComplete="username"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={4}
              maxLength={64}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">رمز عبور</label>
            <input
              id="password"
              type="password"
              className="field"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full !py-2.5" disabled={busy}>
            {busy ? 'در حال ورود…' : 'ورود'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">
          ادمین اصلی با اسکریپت یک‌بارمصرف <code dir="ltr" className="rounded bg-slate-100 px-1">setup-admin.php</code> ساخته می‌شود.
        </p>
      </div>
    </div>
  );
}
