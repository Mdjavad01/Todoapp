import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa, formatToman } from '@/lib/format';
import { PRO_BENEFITS, PRO_SOON } from '@/lib/proBenefits';
import { fetchGiftQuote, fetchPlans, type GiftQuote } from '@/sync/payments';

/**
 * استاب صفحه‌ی اشتراک — مخصوص بیلد bazaar (VITE_PAYMENTS_BUILD=off)
 *
 * در این بیلد، PaywallView واقعی و شیت روش پرداخت به‌طور فیزیکی از باندل حذف می‌شوند
 * (alias در vite.config.ts) و این استاب جایش را می‌گیرد. خروجی بصری عیناً همان
 * حالت «بسته» است که PaywallView واقعی هنگام بسته‌بودن پرداخت نشان می‌دهد:
 *   - سربرگ و وضعیت اشتراک فعلی
 *   - کارت مزایای پرو
 *   - پیام «خرید اشتراک موقتاً بسته است»
 *   - فیلد کد هدیه (کد هدیه کلید مستقل دارد — gift_codes_enabled — و در این بیلد هم کار می‌کند)
 * هیچ کد خرید/درگاه/پلن در این فایل نیست؛ پس هیچ‌کدام وارد باندل بازار نمی‌شود.
 */

// v1.9 — صداقت پی‌وال: فقط مزایای واقعاً قفل‌شده + «به‌زودی» بدون قیمت (منبع واحد: lib/proBenefits.ts)
const BENEFITS = PRO_BENEFITS;
const SOON_FEATURES = PRO_SOON;

export function PaywallView() {
  const session = useAppStore((s) => s.session);
  const premium = useAppStore((s) => s.premium);
  const paywallTitle = useAppStore((s) => s.appSettings.paywallTitle);

  // پلن مبنا برای استعلام کد هدیه — مثل نسخه‌ی اصلی از سرور
  const [planCode, setPlanCode] = useState('annual');
  const [giftCode, setGiftCode] = useState('');
  const [giftChecking, setGiftChecking] = useState(false);
  const [giftQuote, setGiftQuote] = useState<GiftQuote | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPlans()
      .then((list) => {
        if (!alive) return;
        if (Array.isArray(list) && list.length > 0) {
          setPlanCode(list.some((p) => p.code === 'annual') ? 'annual' : list[0].code);
        }
      })
      .catch(() => {
        /* آفلاین — همان annual پیش‌فرض */
      });
    return () => {
      alive = false;
    };
  }, []);

  const isPro = Boolean(session) && premium.loaded && premium.isPremium;

  const checkGift = async () => {
    if (giftCode.trim().length < 3 || giftChecking) return;
    setGiftChecking(true);
    setGiftError(null);
    try {
      const q = await fetchGiftQuote(giftCode, planCode);
      setGiftQuote(q);
      if (!q.valid) setGiftError(q.error ?? 'کد هدیه معتبر نیست');
    } catch (e) {
      setGiftQuote(null);
      setGiftError(e instanceof Error ? e.message : 'استعلام کد ناموفق بود');
    } finally {
      setGiftChecking(false);
    }
  };

  return (
    <section className="p-margin flex flex-col gap-4" id="view-paywall">
      <div className="text-center py-2">
        <span className="inline-block p-2 rounded-2xl bg-amber-400/20 text-amber-500 mb-2">
          <Icon name="workspace_premium" size={36} />
        </span>
        <h2 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">{paywallTitle}</h2>
        <p className="text-body-sm text-on-surface-variant">پتانسیل نامحدود برنامه‌ریزی بدون حواس‌پرتی</p>
      </div>

      {/* وضعیت اشتراک فعلی */}
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

      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 space-y-2.5 text-body-sm">
        {BENEFITS.map((b) => (
          <div key={b} className="flex items-center gap-2">
            <Icon name="check_circle" size={18} className="text-emerald-600" />
            <span>{b}</span>
          </div>
        ))}
        {/* v1.9 — قابلیت‌های در مسیر ساخت: برچسب «به‌زودی» بدون قیمت */}
        <div className="pt-1.5 border-t border-outline-variant/20" />
        <p className="text-[11px] text-on-surface-variant">به‌زودی (فعلاً در دسترس نیست — بدون قیمت):</p>
        {SOON_FEATURES.map((b) => (
          <div key={b} className="flex items-center gap-2 opacity-70">
            <Icon name="schedule" size={18} className="text-on-surface-variant" />
            <span className="text-on-surface-variant">{b} — به‌زودی</span>
          </div>
        ))}
        <p className="text-[11px] text-on-surface-variant leading-5 pt-1">
          سینک ابری و قفل بیومتریک برای همه‌ی کاربران رایگان است و جزو اشتراک پرو فروخته نمی‌شود.
        </p>
      </div>

      {/* بیلد bazaar — پرداخت در این نسخه وجود ندارد؛ فقط پیام + کد هدیه مستقل */}
      <div className="rounded-2xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex p-2 rounded-xl bg-amber-400/20 text-amber-600 shrink-0">
            <Icon name="lock" size={22} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-body-md font-black text-amber-800 dark:text-amber-200">خرید اشتراک موقتاً بسته است</p>
            <p className="text-body-sm text-amber-700/90 dark:text-amber-300/90 mt-1 leading-6">
              خرید اشتراک در این نسخه فعال نیست.
            </p>
            {isPro ? (
              <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-1">
                اشتراک فعال شما تحت‌تأثیر قرار نمی‌گیرد.
              </p>
            ) : null}
          </div>
        </div>
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
              onClick={() => void checkGift()}
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
      </div>
    </section>
  );
}
