import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { PRO_BENEFITS, PRO_SOON } from '@/lib/proBenefits';
import { toFa, faDateTimeUtc, formatToman } from '@/lib/format';
import { isNativeApp, onBrowserFinished, openExternal } from '@/lib/native';
import { PaymentMethodSheet } from '@/modals/PaymentMethodSheet';
import {
  createPaymentOrder,
  fetchOrderStatus,
  fetchPlans,
  fetchDepositConfig,
  fetchMyDepositRequests,
  fetchPaymentMethods,
  fetchGiftQuote,
  loadPaymentsConfig,
  PAYMENTS_BUILD,
  type Plan,
  type DepositConfig,
  type DepositRequest,
  type PaymentMethod,
  type PaymentsConfig,
  type GiftQuote,
} from '@/sync/payments';

/**
 * بخش ۱۱ — صفحه‌ی اشتراک کارام پرو (فاز ۵) + انتخاب روش پرداخت (فاز ۹)
 * پلن‌ها از سرور خوانده می‌شوند (قیمت از پنل ادمین)، خرید فقط با حساب کاربری.
 * دکمه‌ی «پرداخت و ارتقا» شیت انتخاب روش پرداخت را باز می‌کند؛ بعد از انتخاب روش،
 * یا به درگاه آنلاین می‌رود یا جریان کارت‌به‌کارت داخل شیت ادامه می‌یابد.
 */

const FALLBACK_PLANS: Plan[] = [
  { code: 'monthly', title: 'اشتراک ماهانه', months: 1, priceTomans: 49000, description: 'یک ماه دسترسی کامل به کارام پرو' },
  { code: 'annual', title: 'اشتراک سالانه', months: 12, priceTomans: 190000, description: 'دوازده ماه دسترسی کامل — ۶۰٪ تخفیف' },
  { code: 'lifetime', title: 'دائمی', months: 0, priceTomans: 490000, description: 'یکبار پرداخت، همیشه پرو' },
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

// v1.9 — صداقت پی‌وال: فقط مزایای واقعاً قفل‌شده + «به‌زودی» بدون قیمت (منبع واحد: lib/proBenefits.ts)
const BENEFITS = PRO_BENEFITS;
const SOON_FEATURES = PRO_SOON;

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
  const goHome = useAppStore((s) => s.goHome); // فاز الف — دکمه‌ی بازگشت صفحه‌ی داخلی

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [selected, setSelected] = useState<string>('annual');
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  // کاربر پرو صفحه‌ی خرید نمی‌بیند مگر خودش تمدید/ارتقا را بخواهد (v16)
  const [showRenew, setShowRenew] = useState(false);

  // کارت‌به‌کارت با تأیید ادمین (فاز ۸) + روش‌های پرداخت (فاز ۹)
  const [depositCfg, setDepositCfg] = useState<DepositConfig | null>(null);
  const [depositRequests, setDepositRequests] = useState<DepositRequest[]>([]);
  const [payMethods, setPayMethods] = useState<PaymentMethod[] | null>(null);
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  // v20 — کد هدیه (مالکیت با این ویو؛ شیت پرداخت آن را ویرایش می‌کند و هر دو مسیر از آن استفاده می‌کنند)
  const [giftCode, setGiftCode] = useState('');

  // گام ۲ — وضعیت کلید پرداخت‌ها از سرور (null = در حال دریافت)
  const [payCfg, setPayCfg] = useState<PaymentsConfig | null>(null);
  // استعلام کد هدیه در حالت بسته‌بودن پرداخت (فیلد کد مستقل از کلید می‌ماند)
  const [giftChecking, setGiftChecking] = useState(false);
  const [giftQuote, setGiftQuote] = useState<GiftQuote | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);

  // نتیجه‌ی پرداخت (بازگشت از درگاه)
  const [resultState, setResultState] = useState<'checking' | 'succeeded' | 'failed' | null>(null);
  const [resultPlan, setResultPlan] = useState<string | null>(null);
  // گام ۲ — تصمیم نمایش: بیلد bazaar همیشه بسته؛ بقیه از پاسخ سرور (null = در حال دریافت)
  const paymentsClosed = PAYMENTS_BUILD === 'off' || (payCfg !== null && !payCfg.effective);
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
      // ریست نتیجه‌ی پرداخت هنگام پاک‌کردن paymentResult
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

  // گام ۲ — وضعیت کلید پرداخت‌ها: سرور + کش IndexedDB (اندروید fail-closed / وب fail-open)
  // مهمان هم رد می‌شود (۴۰۱ → پیش‌فرض پلتفرم) تا از همان اول UI درست نشان داده شود
  useEffect(() => {
    let alive = true;
    loadPaymentsConfig()
      .then((c) => {
        if (alive) setPayCfg(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [session]);

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
    if (paymentsClosed) return; // گام ۲ — کلید بسته است (دفاع دوم؛ گیت اصلی سمت سرور است)
    if (!session) {
      showToast('برای خرید اشتراک، ابتدا وارد حساب کاربری شوید');
      openAccountSheet();
      return;
    }
    setBuyError(null);
    setBuying(true);
    try {
      const res = await createPaymentOrder(selected, giftCode);
      if (res.discountTomans && res.discountTomans > 0) {
        showToast(`کد هدیه ${res.couponCode ?? ''} اعمال شد — ${formatToman(res.discountTomans)} کمتر`);
      }
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
  const selectedPlan = list.find((p) => p.code === selected);
  const isPro = Boolean(session) && premium.loaded && premium.isPremium;

  /** گام ۲ — استعلام زنده‌ی کد هدیه وقتی پرداخت بسته است (کد هدیه کلید مستقل دارد) */
  const checkGiftStandalone = async () => {
    if (!selectedPlan || giftCode.trim().length < 3 || giftChecking) return;
    setGiftChecking(true);
    setGiftError(null);
    try {
      const q = await fetchGiftQuote(giftCode, selectedPlan.code);
      setGiftQuote(q);
      if (!q.valid) setGiftError(q.error ?? 'کد هدیه معتبر نیست');
    } catch (e) {
      setGiftQuote(null);
      setGiftError(e instanceof Error ? e.message : 'استعلام کد ناموفق بود');
    } finally {
      setGiftChecking(false);
    }
  };

  /* ---------- کارت‌به‌کارت (فاز ۸) ---------- */

  const refreshDeposits = useCallback(() => {
    fetchMyDepositRequests()
      .then((items) => {
        setDepositRequests(Array.isArray(items) ? items : []);
        if (items.some((r) => r.status === 'approved')) void reloadPremium();
      })
      .catch(() => {});
  }, [reloadPremium]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetchDepositConfig()
      .then((c) => {
        if (alive) setDepositCfg(c);
      })
      .catch(() => {});
    fetchPaymentMethods()
      .then((m) => {
        if (alive) setPayMethods(Array.isArray(m) ? m : []);
      })
      .catch(() => {
        if (alive) setPayMethods([]);
      });
    refreshDeposits();
    return () => {
      alive = false;
    };
  }, [session, refreshDeposits]);

  const depositStatusLabel: Record<DepositRequest['status'], string> = {
    pending: 'در انتظار بررسی',
    approved: 'تأیید شد ✓',
    rejected: 'رد شد',
  };
  const depositStatusClass: Record<DepositRequest['status'], string> = {
    pending: 'bg-amber-400/15 text-amber-600 dark:text-amber-300',
    approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    rejected: 'bg-red-500/15 text-red-600 dark:text-red-300',
  };

  /** دکمه‌ی اصلی: مهمان ← ورود؛ کاربر ← شیت انتخاب روش پرداخت (فاز ۹) */
  const openPayFlow = () => {
    if (!session) {
      showToast('برای خرید اشتراک، ابتدا وارد حساب کاربری شوید');
      openAccountSheet();
      return;
    }
    setPaySheetOpen(true);
  };

  /** روش آنلاین انتخاب شد — بستن شیت و رفتن به درگاه */
  const pickOnline = () => {
    setPaySheetOpen(false);
    void buy();
  };

  return (
    <section className="p-margin flex flex-col gap-4" id="view-paywall">
      {/* فاز الف — بازگشت به صفحه‌ی قبل (صفحه‌ی داخلی) */}
      <button
        className="w-9 h-9 rounded-full bg-surface-container dark:bg-slate-700 flex items-center justify-center text-on-surface self-start"
        onClick={goHome}
        aria-label="بازگشت به خانه"
      >
        <Icon name="arrow_forward" size={18} />
      </button>
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
              <p className="text-body-md font-bold text-emerald-700 dark:text-emerald-300">
                {premium.source === 'trial'
                  ? 'دوره آزمایشی کارام پرو فعال است'
                  : premium.source === 'referral'
                    ? 'کارام پرو فعال است (هدیه‌ی دعوت دوست)'
                    : 'کارام پرو فعال است'}
              </p>
              <p className="text-body-sm text-emerald-600/80 dark:text-emerald-400/80">
                {premium.lifetime
                  ? 'اشتراک دائمی — همیشه پرو'
                  : premium.daysLeft !== null
                    ? `${premium.source === 'trial' ? 'آزمایشی' : premium.plan?.title ?? 'اشتراک پرو'} · ${toFa(premium.daysLeft)} روز باقی‌مانده${premium.source === 'trial' ? ' — در پایان، یکی از پلن‌های زیر را فعال کنید' : ''}`
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
        {/* v1.9 — قابلیت‌های در مسیر ساخت: برچسب «به‌زودی» بدون قیمت — هیچ وعده‌ی فروخته‌شده‌ای وجود ندارد */}
        <div className="pt-1.5 border-t border-outline-variant/20" />
        <p className="text-[11px] text-on-surface-variant">به‌زودی (فعلاً در دسترس نیست — بدون قیمت):</p>
        {SOON_FEATURES.map((b) => (
          <div key={b} className="flex items-center gap-2 opacity-70">
            <Icon name="schedule" size={18} className="text-on-surface-variant" />
            <span className="text-on-surface-variant">{b} — به‌زودی</span>
          </div>
        ))}
        {/* شفافیت رایگان: این‌ها با خرید پرو خریداری نمی‌شوند — همه رایگان‌اند */}
        <p className="text-[11px] text-on-surface-variant leading-5 pt-1">
          سینک ابری و قفل بیومتریک برای همه‌ی کاربران رایگان است و جزو اشتراک پرو فروخته نمی‌شود.
        </p>
      </div>

      {paymentsClosed ? (
        /* گام ۲ — کلید پرداخت بسته است: UI پرداخت کامل مخفی؛ فقط پیام + فیلد کد هدیه
           (کد هدیه کلید مستقل دارد — gift_codes_enabled — و وضعیت اشتراک فعلی دست‌نخورده می‌ماند) */
        <div className="rounded-2xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className="inline-flex p-2 rounded-xl bg-amber-400/20 text-amber-600 shrink-0">
              <Icon name="lock" size={22} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-body-md font-black text-amber-800 dark:text-amber-200">خرید اشتراک موقتاً بسته است</p>
              <p className="text-body-sm text-amber-700/90 dark:text-amber-300/90 mt-1 leading-6">
                {payCfg?.message ?? 'پرداخت‌ها موقتاً غیرفعال است؛ لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید.'}
              </p>
              {isPro ? (
                <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-1">
                  اشتراک فعال شما تحت‌تأثیر قرار نمی‌گیرد.
                </p>
              ) : null}
            </div>
          </div>
          {payCfg?.giftCodesEnabled !== false ? (
            <div className="rounded-xl border border-amber-300/50 bg-white/60 dark:bg-slate-900/30 p-3 space-y-2">
              <label htmlFor="pw-gift-closed" className="text-xs font-bold text-amber-800 dark:text-amber-200 block">
                کد هدیه دارید؟ کد شما باقی می‌ماند
              </label>
              <div className="flex gap-1.5">
                <input
                  id="pw-gift-closed"
                  type="text"
                  dir="ltr"
                  autoComplete="off"
                  className="flex-1 min-w-0 rounded-xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-700/60 px-3 py-2 text-body-sm text-left font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="مثلاً NOWRUZ1404"
                  value={giftCode}
                  onChange={(e) => {
                    setGiftCode(e.target.value.toUpperCase());
                    setGiftQuote(null);
                    setGiftError(null);
                  }}
                  maxLength={50}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-xl bg-primary/10 text-primary px-3 py-2 text-xs font-bold active:scale-95 transition-transform disabled:opacity-40"
                  onClick={() => void checkGiftStandalone()}
                  disabled={giftCode.trim().length < 3 || giftChecking}
                >
                  {giftChecking ? '…' : 'بررسی کد'}
                </button>
              </div>
              {giftQuote?.valid ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 rounded-xl p-2.5 leading-5">
                  کد <span dir="ltr" className="font-bold">{giftQuote.code}</span> معتبر است: {formatToman(giftQuote.discountTomans ?? 0)} تخفیف — دفعه‌ی بعد که خرید باز شد اعمال می‌شود
                </p>
              ) : null}
              {giftError ? (
                <p className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl p-2.5">{giftError}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : isPro && !showRenew ? (
        <button
          type="button"
          className="w-full py-3 rounded-2xl border border-outline-variant/40 bg-surface-container dark:bg-slate-800 text-on-surface dark:text-inverse-on-surface font-bold text-body-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          onClick={() => setShowRenew(true)}
        >
          <Icon name="replay" size={20} />
          تمدید یا ارتقای اشتراک
        </button>
      ) : (
        <>
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
                    <span className={`font-black ${featured ? 'text-lg text-primary' : 'text-base'}`}>{formatToman(p.priceTomans)}</span>
                    <span className={`text-[10px] block ${featured ? 'font-bold text-primary' : ''}`}>تومان</span>
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
            onClick={openPayFlow}
            disabled={plans === null}
          >
            <Icon name="verified" size={22} />
            <span>{isPro ? 'تمدید اشتراک کارام پرو' : session ? 'پرداخت و ارتقا به کارام پریمیوم' : 'ورود به حساب و ارتقا'}</span>
          </button>

          {session ? (
            <p className="text-[11px] text-on-surface-variant text-center leading-5">
              در گام بعد روش پرداخت را انتخاب می‌کنید؛ درگاه آنلاین یا کارت به کارت · فعال‌سازی خودکار روی همه‌ی دستگاه‌ها
            </p>
          ) : (
            <p className="text-[11px] text-on-surface-variant text-center leading-5">
              خرید اشتراک نیاز به حساب کاربری دارد؛ داده‌های آفلاین شما بعد از ورود حفظ و سینک می‌شود
            </p>
          )}
          {isPro ? (
            <button
              type="button"
              className="text-[11px] font-bold text-on-surface-variant underline underline-offset-4 self-center"
              onClick={() => setShowRenew(false)}
            >
              بستن بخش تمدید
            </button>
          ) : null}
        </>
      )}

      {/* وضعیت درخواست‌های واریز من (کارت‌به‌کارت — فاز ۸) — خلاصه در صفحه، جریان کامل داخل شیت */}
      {session && depositRequests.length > 0 ? (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-on-surface-variant">درخواست‌های واریز من</p>
            <button
              type="button"
              className="text-[11px] font-bold text-primary flex items-center gap-1"
              onClick={() => {
                refreshDeposits();
                showToast('وضعیت به‌روز شد');
              }}
            >
              <Icon name="refresh" size={14} />
              به‌روزرسانی
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-2 custom-scrollbar">
            {depositRequests.map((r) => (
              <div key={r.uuid} className="rounded-xl border border-outline-variant/30 bg-surface-container dark:bg-slate-700/60 p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold truncate">
                    {r.planTitle ?? r.planCode} · {formatToman(r.amountTomans)}
                  </p>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${depositStatusClass[r.status]}`}>
                    {depositStatusLabel[r.status]}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant">
                  پیگیری: <span dir="ltr">{toFa(r.reference)}</span> · {faDateTimeUtc(r.createdAt)}
                </p>
                {r.status === 'rejected' && r.reviewNote ? (
                  <p className="text-[11px] text-red-600 dark:text-red-300">دلیل رد: {r.reviewNote}</p>
                ) : null}
                {r.status === 'approved' ? (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-300">اشتراک شما فعال شد — اگر به‌روز نشد، سینک بزنید</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* شیت انتخاب روش پرداخت (فاز ۹) — انتخاب روش → درگاه یا کارت‌به‌کارت */}
      <PaymentMethodSheet
        open={paySheetOpen}
        onClose={() => setPaySheetOpen(false)}
        plan={selectedPlan}
        methods={payMethods}
        depositCfg={depositCfg}
        depositRequests={depositRequests}
        onDepositSuccess={(req) => setDepositRequests((prev) => [req, ...prev].slice(0, 10))}
        onPickOnline={pickOnline}
        giftCode={giftCode}
        onGiftCodeChange={setGiftCode}
      />
    </section>
  );
}
