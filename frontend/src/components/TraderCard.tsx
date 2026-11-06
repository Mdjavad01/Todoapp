import { useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import * as repo from '@/db/repo';
import {
  TRADER_TEMPLATE,
  TRADER_REPEAT_NOTICE,
  isTraderActive,
  findTraderLists,
  traderLockedFor,
} from '@/db/traderTemplate';
import { TRADER_REQUIRES_PRO } from '@/sync/payments';
import { traderLockedNote, unlockCta } from '@/lib/bazaarTexts';
import { faTime, toFa } from '@/lib/format';

/**
 * فاز تریدر — کارت «چک‌لیست تریدر» در صفحه‌ی قالب‌ها (جایگزین بسته‌ی قدیمی kit-trader).
 * فعال‌سازی ایدمپوتنت؛ دیالوگ دو‌سؤالی ساعت سشن (بدون پیش‌فرض ثابت)؛
 * دسترسی سریع به ۵ لیست + ریست تیک‌های «قبل از معامله» + بازنشانی با تأیید.
 *
 * بسته B (خلوت‌سازی UX) — بازطراحی: کارت هماهنگ با تم (به‌جای گرادیان تیره‌ی هاردکد)؛
 * اقدامات کم‌استفاده (تغییر ساعت / ریست تیک‌ها / راهنما / بازنشانی) از بدنه‌ی همیشه‌باز به
 * منوی «⋯» رفت و راهنمای لیست‌ها با دکمه‌ی «؟» سر جایش باز/بسته می‌شود (بازشدن خودکارِ
 * اولین‌بار باقی است) — بدنه‌ی کارت فقط وضعیت + دسترسی سریع ۵ لیست را نشان می‌دهد.
 *
 * بسته C — قفل کلاینت با ثابت واحد TRADER_REQUIRES_PRO (sync/payments.ts):
 * بیلد پرداخت‌دار → کاربر رایگانِ غیرفعال پیش‌نمایش فقط‌خواندنی ۵ لیست + دکمه‌ی قفل (→ پی‌وال)
 * می‌بیند؛ فعالِ قبلی (لیست‌ها با کلید/نام یا pref) و پرو همیشه دسترسی کامل دارند؛
 * بیلد بازار (پرداخت خاموش) → برای همه رایگان (TRADER_REQUIRES_PRO=false).
 */

const MENU_ACTIONS: { key: 'retime' | 'ticks' | 'guide' | 'reset'; label: string; icon: IconName; danger?: boolean }[] = [
  { key: 'retime', label: 'تغییر ساعت سشن', icon: 'schedule' },
  { key: 'ticks', label: 'ریست تیک‌های «قبل از معامله»', icon: 'replay' },
  { key: 'guide', label: 'راهنمای لیست‌ها', icon: 'help' },
  { key: 'reset', label: 'بازنشانی به حالت پیش‌فرض', icon: 'delete_forever', danger: true },
];

export function TraderCard() {
  const lists = useAppStore((s) => s.lists);
  const traderPref = useAppStore((s) => s.traderPref);
  const premium = useAppStore((s) => s.premium);
  const activateTraderTemplate = useAppStore((s) => s.activateTraderTemplate);
  const setTraderSessionTimes = useAppStore((s) => s.setTraderSessionTimes);
  const resetTraderTemplate = useAppStore((s) => s.resetTraderTemplate);
  const resetPretradeTicks = useAppStore((s) => s.resetPretradeTicks);
  const openList = useAppStore((s) => s.openList);
  const setView = useAppStore((s) => s.setView);

  const active = isTraderActive(lists) || traderPref !== null;
  const isPro = premium.loaded && premium.isPremium;
  // بسته C — قفل کلاینت با ثابت واحد TRADER_REQUIRES_PRO: فعالِ قبلی/پرو/بیلد بازار = دسترسی کامل؛
  // کاربر رایگانِ غیرفعال فقط پیش‌نمایش فقط‌خواندنی ۵ لیست + دکمه‌ی قفل می‌بیند
  const locked = traderLockedFor(TRADER_REQUIRES_PRO, isPro, active);
  const traderLists = findTraderLists(lists);

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<'activate' | 'retime'>('activate');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // راهنمای اولین‌بار — یک‌بار در هر دستگاه (pref محلی)
  useEffect(() => {
    if (active) {
      void repo.prefsGet<boolean>('trader-guide-seen', false).then((seen) => setGuideOpen(!seen));
    }
  }, [active]);

  const dismissGuide = () => {
    setGuideOpen(false);
    void repo.prefsSet('trader-guide-seen', true);
  };

  const openSetup = (mode: 'activate' | 'retime') => {
    setMenuOpen(false);
    setSetupMode(mode);
    setStart(traderPref?.start ?? '');
    setEnd(traderPref?.end ?? '');
    setSetupOpen(true);
  };

  const runMenuAction = (key: 'retime' | 'ticks' | 'guide' | 'reset') => {
    setMenuOpen(false);
    if (key === 'retime') openSetup('retime');
    else if (key === 'ticks') void resetPretradeTicks();
    else if (key === 'guide') setGuideOpen(true);
    else if (key === 'reset') setResetConfirm(true);
  };

  const submitSetup = async () => {
    if (!start || !end) return;
    const ok =
      setupMode === 'activate'
        ? await activateTraderTemplate(start, end)
        : (await setTraderSessionTimes(start, end), true);
    if (ok) setSetupOpen(false);
  };

  return (
    <div
      className="bg-surface-container-high dark:bg-slate-800 text-on-surface dark:text-inverse-on-surface p-4 rounded-2xl shadow-md border border-outline-variant/40 flex flex-col gap-3 relative"
      id="trader-card"
    >
      {/* هدر: عنوان + راهنمای «؟» + منوی «⋯» */}
      <div className="flex items-start gap-2.5">
        <span className="text-3xl shrink-0">📈</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-headline-sm font-bold text-primary">چک‌لیست تریدر</h3>
            {/* بسته C — برچسب صادقانه: بیلد پرداخت‌دار = «پرو»، بیلد بازار = «رایگان» */}
            <span
              className={`font-bold text-[10px] px-2 py-0.5 rounded-full ${
                TRADER_REQUIRES_PRO ? 'bg-secondary/15 text-secondary' : 'bg-primary/10 text-primary'
              }`}
              data-trader-tier
            >
              {TRADER_REQUIRES_PRO ? 'پرو' : 'رایگان'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5">
            ۵ لیست آماده: قوانین من، پیش از بازار، قبل از معامله، بعد از بازار و ریویو هفتگی — با یادآور سشن
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container-lightest dark:hover:bg-slate-700 active:scale-90 transition-transform"
            onClick={() => setGuideOpen((v) => !v)}
            aria-label="راهنمای چک‌لیست تریدر"
            aria-expanded={guideOpen}
            title="راهنمای لیست‌ها"
          >
            <Icon name={guideOpen ? 'close' : 'help'} size={19} />
          </button>
          {active ? (
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container-lightest dark:hover:bg-slate-700 active:scale-90 transition-transform"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="گزینه‌های کارت تریدر"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title="تغییر ساعت، ریست تیک‌ها، راهنما، بازنشانی"
            >
              <Icon name="more_vert" size={20} />
            </button>
          ) : null}
        </div>
      </div>

      {/* منوی «⋯» — چهار اقدام کم‌استفاده، فقط وقتی خواستی */}
      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
          <div
            className="absolute left-3 top-12 z-50 min-w-[230px] py-1 rounded-xl bg-surface-container-lowest dark:bg-slate-800 shadow-xl border border-outline-variant/40"
            role="menu"
            aria-label="گزینه‌های کارت تریدر"
          >
            {MENU_ACTIONS.map((a) => (
              <button
                key={a.key}
                role="menuitem"
                className={`w-full px-3.5 py-2.5 text-right text-xs font-bold flex items-center gap-2 hover:bg-surface-container-lightest dark:hover:bg-slate-700 transition-colors ${
                  a.danger ? 'text-red-600 dark:text-red-400' : 'text-on-surface dark:text-inverse-on-surface'
                }`}
                onClick={() => runMenuAction(a.key)}
              >
                <Icon name={a.icon} size={16} />
                {a.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {!active ? (
        locked ? (
          <>
            {/* بسته C — کاربر رایگانِ غیرفعال در بیلد پرداخت‌دار: پیش‌نمایش فقط‌خواندنی هر ۵ لیست */}
            {/* (محتوای قالب پنهان نیست — فقط فعال‌سازی قفل است؛ همان صداقتِ بسته‌های شغلی) */}
            <div
              className="rounded-xl bg-surface-container-low dark:bg-slate-700/60 p-2.5 flex flex-col gap-1.5"
              data-trader-preview
            >
              {TRADER_TEMPLATE.map((def) => (
                <div key={def.name} className="flex items-baseline gap-1.5 text-xs">
                  <span className="shrink-0">{def.emoji}</span>
                  <span className="shrink-0 font-bold">{def.name}</span>
                  <span className="flex-1 min-w-0 truncate text-on-surface-variant" title={def.guide}>
                    {def.guide}
                  </span>
                  <span className="shrink-0 text-[10px] text-outline">{toFa(def.items.length)} آیتم</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-5 text-on-surface-variant">
              {traderLockedNote}
            </p>
            <button
              className="w-full py-2.5 font-bold rounded-xl text-sm bg-secondary text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
              onClick={() => setView('paywall')}
              data-trader-locked
            >
              <Icon name="lock" size={16} />
              {unlockCta}
            </button>
            <p className="text-[10px] leading-4 text-on-surface-variant/80">
              اگر قبلاً چک‌لیست تریدر را فعال کرده بودی (حتی در نسخه‌های قدیمی)، لیست‌هایت سر جایشان است و دسترسی کامل داری.
            </p>
          </>
        ) : (
          <>
            <div className="text-xs text-on-surface-variant space-y-1 rounded-xl bg-surface-container-low dark:bg-slate-700/60 p-2.5">
              <div>✓ قوانین ثابت تو — همیشه بالای لیست‌ها (پین‌شده)</div>
              <div>✓ روتین روزانه‌ی قبل و بعد از بازار با یادآور ۳۰ دقیقه‌ای</div>
              <div>✓ چک‌لیست قبل از هر معامله + ریویو هفتگی با امتیاز انضباط</div>
            </div>
            <button
              className="w-full py-2.5 font-bold rounded-xl text-sm bg-primary text-on-primary hover:opacity-90 transition-opacity"
              onClick={() => openSetup('activate')}
            >
              فعال‌سازی تمپلیت ترید
            </button>
            <p className="text-[10px] leading-4 text-on-surface-variant/80">
              اگر قبلاً بسته‌ی قدیمی «تریدر» را فعال کرده بودی، لیست‌هایش سر جایشان است — نگهشان دار یا خودت از مدیریت لیست‌ها حذفشان کن.
            </p>
          </>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-primary/15 text-primary font-bold flex items-center gap-1">
              <Icon name="check_circle" size={13} />
              تمپلیت فعال است
            </span>
            {traderPref ? (
              <span className="px-2 py-1 rounded-full bg-surface-container-low dark:bg-slate-700/60 text-on-surface-variant">
                سشن: {faTime(traderPref.start)} تا {faTime(traderPref.end)}
              </span>
            ) : null}
          </div>

          {/* دسترسی سریع به ۵ لیست — به ترتیب تمپلیت (کلید/نام — P2.0) */}
          <div className="flex flex-wrap gap-1.5">
            {TRADER_TEMPLATE.map((def, idx) => {
              const l = traderLists[idx];
              return (
                <button
                  key={def.name}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                    l
                      ? 'bg-surface-container-lowest dark:bg-slate-700 hover:bg-surface-container-light dark:hover:bg-slate-600 border-outline-variant/50 text-on-surface dark:text-inverse-on-surface'
                      : 'bg-transparent border-dashed border-outline-variant/60 text-on-surface-variant'
                  }`}
                  onClick={() => (l ? openList(l.id) : openSetup('activate'))}
                  title={def.guide}
                >
                  {def.emoji} {def.name}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* راهنمای «؟» — باز/بسته با دکمه‌ی سربرگ */}
      {guideOpen ? (
        <div className="rounded-xl bg-surface-container-low dark:bg-slate-700/60 p-3 text-xs text-on-surface-variant space-y-1.5" role="note">
          {TRADER_TEMPLATE.map((def) => (
            <div key={def.name}>
              <span className="font-bold text-primary">{def.emoji} {def.name}:</span>{' '}
              <span>{def.guide}</span>
            </div>
          ))}
          <p className="leading-5 pt-1 border-t border-outline-variant/40">{TRADER_REPEAT_NOTICE}</p>
          <button
            className="mt-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold"
            onClick={dismissGuide}
          >
            فهمیدم
          </button>
        </div>
      ) : null}

      {/* دیالوگ دو‌سؤالی ساعت سشن — بدون پیش‌فرض ثابت */}
      {setupOpen ? (
        <div
          className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="ساعت سشن معاملاتی"
          onClick={() => setSetupOpen(false)}
        >
          <div
            className="bg-surface-container-lowest dark:bg-slate-800 text-on-surface dark:text-inverse-on-surface w-full max-w-sm rounded-2xl p-4 shadow-xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-label-lg font-bold">
              {setupMode === 'activate' ? 'فعال‌سازی تمپلیت ترید' : 'تغییر ساعت سشن'}
            </h4>
            <p className="text-body-sm text-on-surface-variant">
              ساعت شروع و پایان سشن معاملاتی‌ات را بگو — یادآور «پیش از بازار» ۳۰ دقیقه قبل از شروع و «بعد از بازار» ۳۰ دقیقه بعد از پایان زنگ می‌زند (فقط در اپ اندروید).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs font-bold text-on-surface-variant">
                ساعت شروع سشن
                <input
                  type="time"
                  className="px-2 py-2 rounded-xl bg-surface-container dark:bg-slate-700 border border-outline-variant/40 outline-none focus:border-primary text-on-surface"
                  value={start}
                  required
                  onChange={(e) => setStart(e.target.value)}
                  aria-label="ساعت شروع سشن"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-on-surface-variant">
                ساعت پایان سشن
                <input
                  type="time"
                  className="px-2 py-2 rounded-xl bg-surface-container dark:bg-slate-700 border border-outline-variant/40 outline-none focus:border-primary text-on-surface"
                  value={end}
                  required
                  onChange={(e) => setEnd(e.target.value)}
                  aria-label="ساعت پایان سشن"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary disabled:opacity-40"
                disabled={!start || !end}
                onClick={() => void submitSetup()}
              >
                {setupMode === 'activate' ? 'فعال‌سازی' : 'ذخیره'}
              </button>
              <button
                className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container dark:bg-slate-700 text-on-surface-variant"
                onClick={() => setSetupOpen(false)}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* دیالوگ تأیید بازنشانی — حذف نرم ۵ لیست تریدر (فقط با نام دقیق) */}
      {resetConfirm ? (
        <div
          className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="تأیید بازنشانی تمپلیت تریدر"
          onClick={() => setResetConfirm(false)}
        >
          <div
            className="bg-surface-container-lowest dark:bg-slate-800 text-on-surface dark:text-inverse-on-surface w-full max-w-sm rounded-2xl p-4 shadow-xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-label-lg font-bold text-red-600 dark:text-red-400">بازنشانی به حالت پیش‌فرض؟</h4>
            <p className="text-body-sm text-on-surface-variant leading-6">
              هر ۵ لیست تریدر (۵ لیست: قوانین من، پیش از بازار، قبل از معامله، بعد از بازار، ریویو هفتگی) حذف و با محتوای
              پیش‌فرض از نو ساخته می‌شود. لیست‌ها با کلید قالب شناخته می‌شوند — حتی اگر نامشان را عوض کرده باشی حذف می‌شوند.
              ویرایش‌ها و تیک‌های فعلی از بین می‌رود (تا لحظه‌ی نگه‌داری تومب‌استون در سینک باقی می‌ماند).
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-500 text-white"
                onClick={() => {
                  setResetConfirm(false);
                  void resetTraderTemplate();
                }}
              >
                بازنشانی کن
              </button>
              <button
                className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container dark:bg-slate-700 text-on-surface-variant"
                onClick={() => setResetConfirm(false)}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
