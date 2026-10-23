import { useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';

/**
 * شیت «حساب کاربری و سینک» — فاز ۲
 * ورود با ایمیل (بدون کد OTP — OTP در فاز ۳ به همین جریان اضافه می‌شود)
 * نقطه‌ی ورود: سطر «پشتیبان‌گیری در حساب کاربری» در تنظیمات (مطابق طرح)
 */
export function AccountSheet() {
  const open = useAppStore((s) => s.accountSheet);
  const onClose = () => useAppStore.setState({ accountSheet: false });
  const session = useAppStore((s) => s.session);
  const syncState = useAppStore((s) => s.syncState);
  const signIn = useAppStore((s) => s.signIn);
  const signOut = useAppStore((s) => s.signOut);
  const syncNow = useAppStore((s) => s.syncNow);
  const showToast = useAppStore((s) => s.showToast);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    setBusy(true);
    const res = await signIn(email.trim());
    setBusy(false);
    if (res.ok) {
      showToast('ورود موفق؛ سینک ابری فعال شد ✨');
      setEmail('');
    } else {
      setError(res.error ?? 'ورود ناموفق بود');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    showToast('از حساب خارج شدید؛ داده‌ها روی همین دستگاه باقی می‌مانند');
  };

  const syncLabel = (): string => {
    if (syncState.status === 'syncing') return 'در حال سینک…';
    if (syncState.status === 'error') return 'خطا در سینک';
    if (syncState.lastSyncAt) {
      const t = new Date(syncState.lastSyncAt);
      return `آخرین سینک ${toFa(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`)}`;
    }
    return 'هنوز سینکی انجام نشده';
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="حساب کاربری و سینک" onClose={onClose} />

      {session ? (
        <>
          {/* کاربر وارد شده */}
          <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-bold text-headline-sm">
              {(session.displayName ?? session.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-md font-bold truncate">{session.displayName ?? session.email}</p>
              <p className="text-body-sm text-on-surface-variant truncate" dir="ltr">{session.email}</p>
            </div>
            <span className="text-xs font-bold text-primary whitespace-nowrap">{syncLabel()}</span>
          </div>

          {syncState.status === 'error' && syncState.error ? (
            <p className="text-body-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl p-3">
              {syncState.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              className="flex-1 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={() => void syncNow()}
              disabled={syncState.status === 'syncing'}
            >
              <Icon name="cloud_sync" size={18} />
              <span>{syncState.status === 'syncing' ? 'در حال سینک…' : 'سینک الان'}</span>
            </button>
            <button
              className="px-4 py-3 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform"
              onClick={() => void handleSignOut()}
            >
              خروج از حساب
            </button>
          </div>

          <p className="text-body-sm text-on-surface-variant leading-relaxed">
            داده‌های شما بین همه‌ی دستگاه‌هایی که با این حساب وارد شوند همگام می‌شود؛ حتی وقتی اینترنت نیست، تغییرات
            آفلاین ذخیره و بعداً سینک می‌شوند.
          </p>
        </>
      ) : (
        <>
          {/* حالت مهمان */}
          <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center">
              <Icon name="person" size={24} />
            </div>
            <div>
              <p className="text-body-md font-bold">حالت مهمان</p>
              <p className="text-body-sm text-on-surface-variant">داده‌ها فقط روی همین دستگاه ذخیره می‌شوند</p>
            </div>
          </div>

          <div>
            <label className="text-label-md font-bold mb-2 block" htmlFor="karam-login-email">
              ورود با ایمیل
            </label>
            <div className="flex gap-2">
              <input
                id="karam-login-email"
                type="email"
                dir="ltr"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email.includes('@') && !busy) void handleSignIn();
                }}
                className="flex-1 px-4 py-3 rounded-2xl bg-surface-container dark:bg-slate-800 text-body-md outline-none border border-outline-variant/40 focus:border-primary transition-colors text-on-surface dark:text-slate-100 placeholder:text-outline"
              />
              <button
                className="px-5 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50 whitespace-nowrap"
                onClick={() => void handleSignIn()}
                disabled={busy || !email.includes('@')}
              >
                {busy ? '…' : 'ورود'}
              </button>
            </div>
            {error ? (
              <p className="text-body-sm text-red-600 dark:text-red-300 mt-2">{error}</p>
            ) : null}
          </div>

          <p className="text-body-sm text-on-surface-variant leading-relaxed">
            با ورود، داده‌های این دستگاه با حساب شما سینک می‌شود و روی دستگاه‌های دیگر هم در دسترس خواهد بود.
            ورود با کد یک‌بارمصرف (OTP) و از طریق ربات بله در فاز بعدی اضافه می‌شود.
          </p>
        </>
      )}
    </Sheet>
  );
}
