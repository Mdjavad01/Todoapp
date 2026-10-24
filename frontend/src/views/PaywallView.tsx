import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';
import { isNativeApp, onBrowserFinished, openExternal } from '@/lib/native';
import { createPaymentOrder, fetchOrderStatus, fetchPlans, type Plan } from '@/sync/payments';

/**
 * بخش ۱۱ — صفحه‌ی اشتراک کارام پرو (فاز ۵)
 * پلن‌ها از سرور خوانده می‌شوند (قیمت از پنل ادمین)، خرید فقط با حساب کاربری
 * و از درگاه آنلاین زیبال. نتیجه‌ی پرداخت بعد از بازگشت از درگاه همین‌جا نشان داده می‌شود.
 */

const FALLBACK_PLANS: Plan[] = [
  { code: 'monthly', title: 'اشتراک ماهانه', months: 1, priceRials: 490000, description: 'یک ماه دسترسی کامل به کارام پرو' },
  { code: 'annual', title: 'اشتراک سالانه', months: 12, priceRials: 1900000, description: 'دوازده ماه دسترسی کامل — ۶۰٪ تخفیف' },
  { code: 'lifetime', title: 'دائمی', months: 0, priceRials: 4900000, description: 'یکبار پرداخت، همیشه پرو' },
];

const PLAN_LABELS: Record<string, string> = {
  monthly: 'ماهانه',
  annual: 'سالانه',
  lifetime: 'مادام‌العمر',
};

const PLAN_NOTES: Record<string, string> = {
  monthly: 'عادی',
  annual: 'محبوب‌ترین پلن',
  lifetime: 'یکبار پرداخت',
};

const BENEFITS = [
  'تبدیل نامحدود وویس به وظیفه هوشمند با هوش مصنوعی',
  'دسترسی به تمامی بسته‌های شغلی تخصصی و مالی',
  'همگام‌سازی ابری و بک‌آپ خودکار نامحدود',
  'قفل امنیتی بیومتریک و تم‌های اختصاصی لوکس',
];

/** هزار تومان — قیمت‌ها سمت سرور ریال هستند (۱۰٫۰۰۰ ریال = ۱ هزار تومان) */
const hezarToman = (priceRials: number): string => toFa(String(Math.round(priceRials / 10000)));

export function PaywallView() {
  const showToast = useAppStore((s) => s.showToast);
  const session = useAppStore((s) => s.session);
  const premium = useAppStore((s) => s.premium);
  const reloadPremium = useAppStore((s) => s.reloadPremium);
  const paywallTitle = useAppStore((s) => s.appSettings.paywallTitle);
  const paymentResult = useAppStore((s) => s.paymentResult);
  const clearPaymentResult = useAppStore((s) => s.clearPaymentResult);
  const setPaymentResult = useAppStore((s) => s.setPaymentResult);
  const openAccountSheet = useAppStore((s) => s.openAccountSheet);

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [selected, setSelected] = useState<string>('annual');
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  // نتیجه‌ی پرداخت (بازگشت از درگاه)
  const [resultState, setResultState] = useState<'checking' | 'succeeded' | 'failed' | null>(null);
  const [resultPlan, setResultPlan] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  // فاز ۶ — سفارش در جریان بومی (درگاه در تب مرورگر باز می‌شود)
  const pendingOrderRef = useRef<string | null>(null);

  // پلن‌ها — از سرور؛ آفلاین با پیش‌فرض‌ها
  useEffect(() => {
    let alive = true;
    fetchPlans()
      .then((list) => {
        if (!alive) return;
        if (Array.isArray(list) && list.length > 0) {
          setPlans(list);
          if (list.some((p) => p.code === 'annual')) setSelected('annual');
          else setSelected(list[0].code);
        } else {
          setPlans(FALLBACK_PLANS);
        }
      })
      .catch(() => {
        if (alive) setPlans(FALLBACK_PLANS);
      });
    return () => {
      alive = false;
    };
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // نتیجه‌ی سفارش بعد از بازگشت از درگاه — poll تا قطعی شدن وضعیت
  const checkResult = useCallback(async (orderUuid: string) => {
    try {
      const order = await fetchOrderStatus(orderUuid);
      setResultPlan(order.planTitle);
      if (order.status === 'paid' || order.status === 'approved') {
        setResultState('succeeded');
        stopPoll();
        void reloadPremium();
        showToast('اشتراک کارام پرو فعال شد 🎉');
        return;
      }
      if (order.status === 'failed' || order.status === 'rejected') {
        setResultState('failed');
        stopPoll();
        return;
      }
      // created/redirected — احتمالاً verify سرور هنوز نرسیده؛ کمی بعد دوباره
      if (pollCountRef.current >= 15) {
        setResultState('failed');
        stopPoll();
        return;
      }
    } catch {
      // مهمان/نشست منقضی یا آفلاین — با state درگاه قضاوت اولیه می‌کنیم
      const state = new URLSearchParams(window.location.search).get('state');
      setResultState(state === 'succeeded' ? 'succeeded' : 'failed');
      stopPoll();
    }
  }, [reloadPremium, showToast, stopPoll]);

  useEffect(() => {
    stopPoll();
    if (!paymentResult) {
      setResultState(null);
      setResultPlan(null);
      return;
    }
    setResultState('checking');
    pollCountRef.current = 0;
    void checkResult(paymentResult);
    pollRef.current = setInterval(() => {
      pollCountRef.current += 1;
      void checkResult(paymentResult);
    }, 4000);
    return stopPoll;
  }, [paymentResult, checkResult, stopPoll]);

  // بعد از برگشتن به اپ (تبلیغ تب/بازگشت از درگاه) وضعیت تازه می‌شود
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && session) {
        void reloadPremium();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [session, reloadPremium]);

  // فاز ۶ — اپ اندروید: با بسته‌شدن تب مرورگر (بازگشت از درگاه) poll نتیجه شروع می‌شود
  useEffect(() => {
    const off = onBrowserFinished(() => {
      const uuid = pendingOrderRef.current;
      if (uuid) {
        pendingOrderRef.current = null;
        setPaymentResult(uuid);
      }
    });
    return off;
  }, [setPaymentResult]);

  const buy = async () => {
    if (buying) return;
    if (!session) {
      showToast('برای خرید اشتراک، ابتدا وارد حساب کاربری شوید');
      openAccountSheet();
      return;
    }
    setBuyError(null);
    setBuying(true);
    try {
      const res = await createPaymentOrder(selected);
      if (isNativeApp()) {
        // فاز ۶ — اپ اندروید: درگاه در تب مرورگر سیستم باز می‌شود؛ با بسته‌شدن تب
        // رویداد browserFinished شروع بررسی نتیجه را می‌زند (بدون خروج از اپ)
        pendingOrderRef.current = res.orderUuid;
        setBuying(false);
        await openExternal(res.payUrl);
        return;
      }
      // وب — رفتن به درگاه زیبال؛ بازگشت به اپ با ?payResult=
      window.location.href = res.payUrl;
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : 'ساخت تراکنش ناموفق بود');
      setBuying(false);
    }
  };

  const list = plans ?? FALLBACK_PLANS;

  return (
    <section className="p-margin flex flex-col gap-4" id="view-paywall">
      <div className="text-center py-2">
        <span className="inline-block p-2 rounded-2xl bg-amber-400/20 text-amber-500 mb-2">
          <Icon name="workspace_premium" size={36} />
        </span>
        <h2 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">{paywallTitle}</h2>
        <p className="text-body-sm text-on-surface-variant">پتانسیل نامحدود برنامه‌ریزی بدون حواس‌پرتی</p>
      </div>

      {/* وضعیت اشتراک فعلی (فاز ۵) */}
      {session ? (
        premium.loaded && premium.isPremium ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-center gap-3">
            <Icon name="verified" size={26} className="text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-body-md font-bold text-emerald-700 dark:text-emerald-300">کارام پرو فعال است</p>
              <p className="text-body-sm text-emerald-600/80 dark:text-emerald-400/80">
                {premium.lifetime
                  ? 'اشتراک دائمی — همیشه پرو'
                  : premium.daysLeft !== null
                    ? `${premium.plan?.title ?? 'اشتراک پرو'} · ${toFa(premium.daysLeft)} روز باقی‌مانده`
                    : premium.plan?.title ?? 'اشتراک پرو'}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-4 flex items-center gap-3">
            <Icon name="star" size={24} className="text-on-surface-variant shrink-0" />
            <p className="text-body-sm text-on-surface-variant flex-1">
              در حال حاضر از نسخه‌ی رایگان استفاده می‌کنید؛ با خرید یکی از پلن‌های زیر همه‌ی امکانات پرو باز می‌شود.
            </p>
          </div>
        )
      ) : null}

      {/* نتیجه‌ی پرداخت بعد از بازگشت از درگاه */}
      {resultState === 'checking' ? (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-4 flex items-center gap-3">
          <span className="inline-block w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
          <p className="text-body-sm text-on-surface-variant">در حال بررسی نتیجه‌ی پرداخت…</p>
        </div>
      ) : null}
      {resultState === 'succeeded' ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex items-start gap-3">
          <Icon name="check_circle" size={26} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-body-md font-black text-emerald-700 dark:text-emerald-300">پرداخت با موفقیت انجام شد</p>
            <p className="text-body-sm text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
              {resultPlan ? `اشتراک «${resultPlan}» فعال شد.` : 'اشتراک شما فعال شد.'} اگر صفحه به‌روز نشد، یک‌بار سینک بزنید.
            </p>
            <button
              type="button"
              className="text-body-sm font-bold text-emerald-700 dark:text-emerald-300 mt-2 underline underline-offset-4"
              onClick={() => clearPaymentResult()}
            >
              بستن این پیام
            </button>
          </div>
        </div>
      ) : null}
      {resultState === 'failed' ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-50 dark:bg-red-950/40 p-4 flex items-start gap-3">
          <Icon name="warning" size={26} className="text-red-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-body-md font-black text-red-700 dark:text-red-300">پرداخت کامل نشد</p>
            <p className="text-body-sm text-red-600/80 dark:text-red-400/80 mt-0.5">
              مبلغی از حساب شما کم نشده یا به‌زودی برمی‌گردد. می‌توانید دوباره تلاش کنید.
            </p>
            <button
              type="button"
              className="text-body-sm font-bold text-red-700 dark:text-red-300 mt-2 underline underline-offset-4"
              onClick={() => clearPaymentResult()}
            >
              بستن این پیام
            </button>
          </div>
        </div>
      ) : null}

      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 space-y-2.5 text-body-sm">
        {BENEFITS.map((b) => (
          <div key={b} className="flex items-center gap-2">
            <Icon name="check_circle" size={18} className="text-emerald-600" />
            <span>{b}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {list.map((p) => {
          const featured = p.code === 'annual';
          const active = selected === p.code;
          return (
            <div
              key={p.code}
              className={`p-3 rounded-2xl text-center flex flex-col justify-between relative cursor-pointer ${
                featured
                  ? 'border-2 border-primary bg-primary/10 shadow-md'
                  : 'border border-outline-variant/40 bg-surface-container dark:bg-slate-800'
              } ${active ? 'ring-2 ring-primary/40' : ''}`}
              onClick={() => setSelected(p.code)}
              role="radio"
              aria-checked={active}
            >
              {featured ? (
                <span className="absolute -top-2.5 right-1/2 translate-x-1/2 bg-primary text-on-primary text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                  ۶۰٪ تخفیف ویژه
                </span>
              ) : null}
              <span className={`text-xs font-bold ${featured ? 'text-primary' : 'text-outline'}`}>
                {PLAN_LABELS[p.code] ?? p.title}
              </span>
              <div className="my-2">
                <span className={`font-black ${featured ? 'text-lg text-primary' : 'text-base'}`}>{hezarToman(p.priceRials)}</span>
                <span className={`text-[10px] block ${featured ? 'font-bold text-primary' : ''}`}>هزار تومان</span>
              </div>
              <span className={`text-[9px] ${featured ? 'text-emerald-600 font-bold' : 'text-outline'}`}>
                {PLAN_NOTES[p.code] ?? p.description ?? ''}
              </span>
            </div>
          );
        })}
      </div>

      {buyError ? (
        <p className="text-body-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl p-3">{buyError}</p>
      ) : null}

      <button
        className="w-full py-3.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        onClick={() => void buy()}
        disabled={buying || plans === null}
      >
        <Icon name="verified" size={22} />
        <span>{buying ? 'در حال اتصال به درگاه…' : session ? 'پرداخت و ارتقا به کارام پریمیوم' : 'ورود به حساب و ارتقا'}</span>
      </button>

      {session ? (
        <p className="text-[11px] text-on-surface-variant text-center leading-5">
          پرداخت امن از طریق درگاه زیبال · اشتراک بلافاصله بعد از پرداخت روی همه‌ی دستگاه‌های شما فعال می‌شود
        </p>
      ) : (
        <p className="text-[11px] text-on-surface-variant text-center leading-5">
          خرید اشتراک نیاز به حساب کاربری دارد؛ داده‌های آفلاین شما بعد از ورود حفظ و سینک می‌شود
        </p>
      )}
    </section>
  );
}
