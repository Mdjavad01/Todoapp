import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import * as repo from '@/db/repo';
import {
  TRADER_TEMPLATE,
  TRADER_REPEAT_NOTICE,
  TRADER_PRETRADE_FOOTER,
  isTraderActive,
  findTraderLists,
} from '@/db/traderTemplate';
import { toFa, faTime } from '@/lib/format';

/**
 * فاز تریدر — کارت «چک‌لیست تریدر» در قالب‌های آماده (رایگان — جایگزین بسته‌ی قدیمی kit-trader).
 * فعال‌سازی ایدمپوتنت؛ دیالوگ دو‌سؤالی ساعت سشن (بدون پیش‌فرض ثابت)؛
 * دسترسی سریع به ۵ لیست + ریست تیک‌های «قبل از معامله» + بازنشانی با تأیید.
 */
export function TraderCard() {
  const lists = useAppStore((s) => s.lists);
  const traderPref = useAppStore((s) => s.traderPref);
  const activateTraderTemplate = useAppStore((s) => s.activateTraderTemplate);
  const setTraderSessionTimes = useAppStore((s) => s.setTraderSessionTimes);
  const resetTraderTemplate = useAppStore((s) => s.resetTraderTemplate);
  const resetPretradeTicks = useAppStore((s) => s.resetPretradeTicks);
  const openList = useAppStore((s) => s.openList);

  const active = isTraderActive(lists) || traderPref !== null;
  const traderLists = findTraderLists(lists);

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<'activate' | 'retime'>('activate');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

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
    setSetupMode(mode);
    setStart(traderPref?.start ?? '');
    setEnd(traderPref?.end ?? '');
    setSetupOpen(true);
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
      className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-4 rounded-2xl shadow-md border border-emerald-500/30 flex flex-col gap-3 relative"
      id="trader-card"
    >
      <span className="absolute top-3 left-3 font-black text-[10px] px-2 py-0.5 rounded-full bg-emerald-500 text-white flex items-center gap-1">
        <Icon name="check_circle" size={12} />
        رایگان
      </span>
      <div className="flex items-center gap-2.5">
        <span className="text-3xl">📈</span>
        <div>
          <h3 className="text-headline-sm font-bold text-amber-400">چک‌لیست تریدر</h3>
          <p className="text-xs text-slate-300">
            ۵ لیست آماده: قوانین من، پیش از بازار، قبل از معامله، بعد از بازار و ریویو هفتگی — با یادآور سشن
          </p>
        </div>
      </div>

      {!active ? (
        <>
          <div className="text-xs text-slate-300 space-y-1 rounded-xl bg-white/5 p-2.5">
            <div>✓ قوانین ثابت تو — همیشه بالای لیست‌ها (پین‌شده)</div>
            <div>✓ روتین روزانه‌ی قبل و بعد از بازار با یادآور ۳۰ دقیقه‌ای</div>
            <div>✓ چک‌لیست قبل از هر معامله + ریویو هفتگی با امتیاز انضباط</div>
          </div>
          <button
            className="w-full py-2.5 font-bold rounded-xl text-sm bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
            onClick={() => openSetup('activate')}
          >
            فعال‌سازی تمپلیت ترید
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 font-bold flex items-center gap-1">
              <Icon name="check_circle" size={13} />
              تمپلیت فعال است
            </span>
            {traderPref ? (
              <span className="px-2 py-1 rounded-full bg-white/10 text-slate-200">
                سشن: {faTime(traderPref.start)} تا {faTime(traderPref.end)}
              </span>
            ) : null}
          </div>

          {/* دسترسی سریع به ۵ لیست — بدون شلوغ‌کردن خانه */}
          <div className="flex flex-wrap gap-1.5">
            {TRADER_TEMPLATE.map((def) => {
              const l = traderLists.find((x) => x.name === def.name);
              return (
                <button
                  key={def.name}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                    l
                      ? 'bg-white/10 hover:bg-white/20 border-white/15 text-slate-100'
                      : 'bg-transparent border-dashed border-white/25 text-slate-400'
                  }`}
                  onClick={() => (l ? openList(l.id) : openSetup('activate'))}
                  title={def.guide}
                >
                  {def.emoji} {def.name}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              className="py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors"
              onClick={() => openSetup('retime')}
            >
              تغییر ساعت سشن
            </button>
            <button
              className="py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors"
              onClick={() => void resetPretradeTicks()}
              title={TRADER_PRETRADE_FOOTER}
            >
              ریست تیک‌های «قبل از معامله»
            </button>
            <button
              className="py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition-colors"
              onClick={() => setGuideOpen(true)}
            >
              راهنمای لیست‌ها
            </button>
            <button
              className="py-2 rounded-xl text-xs font-bold text-rose-300 hover:text-rose-200 transition-colors"
              onClick={() => setResetConfirm(true)}
            >
              بازنشانی به حالت پیش‌فرض
            </button>
          </div>

          {guideOpen ? (
            <div className="rounded-xl bg-white/5 p-3 text-xs text-slate-200 space-y-1.5" role="note">
              {TRADER_TEMPLATE.map((def) => (
                <div key={def.name}>
                  <span className="font-bold text-amber-300">{def.emoji} {def.name}:</span>{' '}
                  <span className="text-slate-300">{def.guide}</span>
                </div>
              ))}
              <p className="text-slate-400 leading-5 pt-1 border-t border-white/10">{TRADER_REPEAT_NOTICE}</p>
              <button
                className="mt-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white font-bold"
                onClick={dismissGuide}
              >
                فهمیدم
              </button>
            </div>
          ) : null}
        </>
      )}

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
            <h4 className="text-label-lg font-bold text-rose-500">بازنشانی به حالت پیش‌فرض؟</h4>
            <p className="text-body-sm text-on-surface-variant leading-6">
              هر ۵ لیست تریدر ({toFa(5)} لیست: قوانین من، پیش از بازار، قبل از معامله، بعد از بازار، ریویو هفتگی)
              با همین نام‌ها حذف و با محتوای پیش‌فرض از نو ساخته می‌شود. ویرایش‌ها و تیک‌های فعلی از بین می‌رود
              (تا لحظه‌ی نگه‌داری تومب‌استون در سینک باقی می‌ماند). لیست‌هایی که نامشان را عوض کرده‌ای دست نخورده می‌مانند.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-rose-500 hover:bg-rose-400 text-white"
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
