import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';
import { PRO_BENEFITS, PRO_SOON } from '@/lib/proBenefits';

/**
 * استاب صفحه‌ی اشتراک — مخصوص بیلد bazaar (VITE_PAYMENTS_BUILD=off)
 *
 * در این بیلد، PaywallView واقعی و شیت روش پرداخت به‌طور فیزیکی از باندل حذف می‌شوند
 * (alias در vite.config.ts) و این استاب جایش را می‌گیرد.
 *
 * v1.13.3 — تصمیم صاحب محصول برای انتشار کافه‌بازار:
 *   - ورودی کد هدیه از این نسخه حذف شد؛ هیچ اشاره‌ای به کد هدیه، نسخه‌ی کامل،
 *     سایت یا بیلد karam-latest در این استاب نیست (تست قراردادی + اسکن CI رد می‌کنند).
 *   - جای بخش خرید فقط یک پیام خنثی می‌آید: «این بخش در حال حاضر فعال نیست».
 *   - وضعیت اشتراک فعلی، مزایا و فهرست «به‌زودی» سر جایشان است — بدون هیچ وعده.
 */

// v1.9 — صداقت پی‌وال: فقط مزایای واقعاً قفل‌شده + «به‌زودی» بدون قیمت (منبع واحد: lib/proBenefits.ts)
const BENEFITS = PRO_BENEFITS;
const SOON_FEATURES = PRO_SOON;

export function PaywallView() {
  const session = useAppStore((s) => s.session);
  const premium = useAppStore((s) => s.premium);
  const paywallTitle = useAppStore((s) => s.appSettings.paywallTitle);
  const [closedNotice] = useState('این بخش در حال حاضر فعال نیست');

  const isPro = Boolean(session) && premium.loaded && premium.isPremium;

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
                    ? `${premium.source === 'trial' ? 'آزمایشی' : premium.plan?.title ?? 'اشتراک پرو'} · ${toFa(premium.daysLeft)} روز باقی‌مانده${premium.source === 'trial' ? ' — در پایان، امکانات ویژه در این نسخه فعال نمی‌شود' : ''}`
                    : premium.plan?.title ?? 'اشتراک پرو'}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-4 flex items-center gap-3">
            <Icon name="star" size={24} className="text-on-surface-variant shrink-0" />
            <p className="text-body-sm text-on-surface-variant flex-1">
              در حال حاضر از نسخه‌ی رایگان استفاده می‌کنید؛ امکانات ویژه در این نسخه فعلاً فعال نیست.
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
          سینک ابری و قفل بیومتریک برای همه‌ی کاربران رایگان است.
        </p>
      </div>

      {/* بیلد bazaar — بخش خرید در این نسخه وجود ندارد؛ فقط پیام خنثی (بدون ورودی، بدون ارجاع بیرونی) */}
      <div className="rounded-2xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex p-2 rounded-xl bg-amber-400/20 text-amber-600 shrink-0">
            <Icon name="lock" size={22} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-body-md font-black text-amber-800 dark:text-amber-200">{closedNotice}</p>
            <p className="text-body-sm text-amber-700/90 dark:text-amber-300/90 mt-1 leading-6">
              فعال‌سازی امکانات ویژه در این نسخه فعلاً انجام نمی‌شود؛ همه‌ی قابلیت‌های اصلی کارام رایگان و کامل است.
            </p>
            {isPro ? (
              <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-1">
                اشتراک فعال شما تحت‌تأثیر قرار نمی‌گیرد.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
