import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';
import { isConfirmTextValid } from '@/lib/account';
import { confirmAccountDeletion, requestAccountDeletion, type DeleteRequestResult } from '@/sync/auth';

/**
 * v1.9 — شیت «حذف حساب» — دومرحله‌ای و صادقانه:
 *   گام ۱ (گام‌شمار) — توضیح دقیق چه چیزی پاک می‌شود + هشدار اشتراک فعال (اگر هست)
 *   گام ۲ — کد تأیید تازه به هویت اصلی حساب می‌رود (ایمیل/موبایل/تلگرام — جدا از کد ورود)
 *   گام ۳ — کد + تایپ دقیق «حذف حساب» → حذف نهایی + پاک‌سازی محلی + خروج
 * هیچ چیز بی‌صدا حذف نمی‌شود؛ سوابق مالی بی‌نام برای حسابداری می‌ماند (در متن هم گفته می‌شود).
 */

type Step = 'intro' | 'code' | 'final';

export function DeleteAccountSheet() {
  const open = useAppStore((s) => s.deleteAccountSheet);
  const onClose = () => useAppStore.setState({ deleteAccountSheet: false });
  const premium = useAppStore((s) => s.premium);
  const showToast = useAppStore((s) => s.showToast);
  const signOut = useAppStore((s) => s.signOut);

  const [step, setStep] = useState<Step>('intro');
  const [req, setReq] = useState<DeleteRequestResult | null>(null);
  const [code, setCode] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('intro');
      setReq(null);
      setCode('');
      setConfirmText('');
      setError(null);
      setBusy(false);
      setResendIn(0);
    }
  }, [open]);

  useEffect(() => {
    if (resendIn <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setResendIn((v) => Math.max(0, v - 1)), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resendIn]);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await requestAccountDeletion();
      setReq(r);
      setResendIn(Math.max(0, Math.floor((r.resendAfter ?? 60) / 1)));
      setStep('code');
      showToast('کد تأیید به راه ارتباطی حساب شما ارسال شد');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'درخواست کد ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!req || busy) return;
    if (!isConfirmTextValid(confirmText, req.confirmText)) {
      setError(`برای تأیید، عبارت «${req.confirmText}» را دقیقاً تایپ کنید`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmAccountDeletion(code.trim(), confirmText);
      setStep('final');
      // پاک‌سازی کامل محلی + خروج (wipeUserData داخل logout است)
      setTimeout(() => {
        void signOut();
        showToast('حساب شما حذف شد؛ داده‌های محلی هم پاک شد');
        onClose();
      }, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حذف حساب ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const premiumActive = premium.loaded && premium.isPremium;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="حذف حساب کارام" onClose={onClose} />

      {step === 'intro' ? (
        <div className="flex flex-col gap-3.5">
          <div className="rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <Icon name="warning" size={22} />
              <span className="font-black">این کار برگشت‌پذیر نیست</span>
            </div>
            <ul className="text-xs leading-6 text-red-800 dark:text-red-200/90 list-disc ps-5">
              <li>همه‌ی لیست‌ها، کارها، زیرکارها و یادآورهای حساب شما از سرور پاک می‌شود.</li>
              <li>همه‌ی دستگاه‌هایتان از حساب خارج و توکن‌ها باطل می‌شود.</li>
              <li>ایمیل/موبایل/تلگرامِ شما از تمام رکوردهای ما پاک می‌شود.</li>
              <li>فقط سوابق مالی (سفارش و پرداخت) بی‌نام‌شده برای حسابداری می‌ماند.</li>
              <li>داده‌های روی این گوشی هم بعد از حذف پاک می‌شوند.</li>
            </ul>
          </div>

          {premiumActive ? (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300/60 dark:border-amber-700/50 p-3.5 flex items-start gap-2.5">
              <Icon name="workspace_premium" size={20} className="text-amber-600 shrink-0" />
              <p className="text-xs leading-6 text-amber-800 dark:text-amber-200">
                <b>هشدار:</b> اشتراک کارام پروی فعال دارید
                {premium.daysLeft ? ` (${toFa(premium.daysLeft)} روز باقی‌مانده)` : ''}
                {' — '}با حذف حساب، باقی‌مانده‌ی اشتراک و مبلغ پرداخت‌شده بازگردانده نمی‌شود.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>
          ) : null}

          <div className="flex gap-2">
            <button
              className="flex-1 py-3 rounded-2xl bg-surface-container dark:bg-slate-800 text-on-surface-variant font-bold text-body-sm active:scale-95 transition-transform"
              onClick={onClose}
            >
              منصرف شدم
            </button>
            <button
              className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5"
              onClick={() => void request()}
              disabled={busy}
            >
              <Icon name="delete_forever" size={18} />
              {busy ? 'در حال ارسال کد…' : 'ادامه — ارسال کد تأیید'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'code' && req ? (
        <div className="flex flex-col gap-3.5">
          <p className="text-body-sm text-on-surface-variant leading-relaxed">
            کد تأیید ۶ رقمی به <b dir="ltr">{req.target}</b> ارسال شد. این کد مخصوص حذف حساب است و با کد ورود فرق دارد.
          </p>

          <label className="text-xs font-bold text-on-surface-variant" htmlFor="del-code">کد تأیید</label>
          <input
            id="del-code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="field text-center tracking-[0.4em] text-lg"
            placeholder="------"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
            aria-label="کد تأیید حذف حساب"
          />

          <label className="text-xs font-bold text-on-surface-variant" htmlFor="del-confirm">
            برای تأیید نهایی، عبارت «{req.confirmText}» را تایپ کنید
          </label>
          <input
            id="del-confirm"
            className="field"
            placeholder={req.confirmText}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="متن تأیید حذف حساب"
          />

          {/* پشتیبانی از چسباندن کد پیامکی (WebOTP/دستی) — devCode فقط در محیط توسعه */}
          {req.devCode ? (
            <p className="text-[11px] text-on-surface-variant" dir="ltr">(dev) code: {req.devCode}</p>
          ) : null}

          {error ? (
            <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>
          ) : null}

          <div className="flex gap-2">
            <button
              className="flex-1 py-3 rounded-2xl bg-surface-container dark:bg-slate-800 text-on-surface-variant font-bold text-body-sm active:scale-95 transition-transform"
              onClick={() => {
                setStep('intro');
                setError(null);
              }}
            >
              بازگشت
            </button>
            <button
              className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-40"
              onClick={() => void doDelete()}
              disabled={busy || code.trim().length < 4 || !isConfirmTextValid(confirmText, req.confirmText)}
            >
              {busy ? 'در حال حذف…' : 'حذف نهایی حساب'}
            </button>
          </div>

          <button
            className="text-xs text-primary font-bold disabled:text-on-surface-variant disabled:font-normal"
            onClick={() => void request()}
            disabled={busy || resendIn > 0}
          >
            {resendIn > 0 ? `ارسال دوباره‌ی کد تا ${toFa(resendIn)} ثانیه` : 'کد نرسید؟ ارسال دوباره'}
          </button>
        </div>
      ) : null}

      {step === 'final' ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <Icon name="check_circle" size={34} />
          </span>
          <p className="font-black text-on-surface dark:text-inverse-on-surface">حساب شما حذف شد</p>
          <p className="text-xs text-on-surface-variant leading-6">
            همه‌ی داده‌ها از سرور پاک شد و این دستگاه هم خالی می‌شود. اگر روزی برگشتید، با همان راه ارتباطی می‌توانید حساب تازه بسازید.
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}
