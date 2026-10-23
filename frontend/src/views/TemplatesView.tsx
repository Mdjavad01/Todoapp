import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { TEMPLATES, JOB_KITS } from '@/db/catalog';
import { toFa } from '@/lib/format';

/** بخش ۹: قالب‌های آماده */
export function TemplatesView() {
  const applyTemplate = useAppStore((s) => s.applyTemplate);
  return (
    <section className="p-margin flex flex-col gap-4" id="view-templates">
      <div>
        <h2 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">قالب‌های آماده</h2>
        <p className="text-body-sm text-on-surface-variant">چک‌لیست‌های تخصصی آماده برای شروع بدون اتلاف وقت</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 shadow-sm flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{tpl.emoji}</span>
              <div>
                <h4 className="text-label-lg font-bold">{tpl.title}</h4>
                <p className="text-body-sm text-outline">
                  {toFa(tpl.items.length)} {tpl.subtitle}
                </p>
              </div>
            </div>
            <button
              className="px-3 py-1.5 bg-primary/10 hover:bg-primary hover:text-on-primary text-primary text-xs font-bold rounded-xl transition-all shrink-0"
              onClick={() => applyTemplate(tpl)}
            >
              افزودن
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** بخش ۱۰: بسته‌های شغلی تخصصی */
export function JobKitsView() {
  const setView = useAppStore((s) => s.setView);
  return (
    <section className="p-margin flex flex-col gap-4" id="view-jobkits">
      <div>
        <h2 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">بسته‌های شغلی تخصصی</h2>
        <p className="text-body-sm text-on-surface-variant">روتین‌ها و فریم‌ورک‌های استاندارد برای حرفه‌ای‌ها</p>
      </div>
      {JOB_KITS.map((kit) =>
        kit.pro ? (
          <div
            key={kit.id}
            className={`p-4 rounded-2xl shadow-md flex flex-col gap-3 relative ${
              kit.id === 'kit-trader'
                ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white border border-amber-500/30'
                : 'bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 shadow-sm'
            }`}
          >
            {kit.id === 'kit-trader' ? (
              <span className="absolute top-3 left-3 bg-amber-500 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                <Icon name="star" size={12} /> پرو
              </span>
            ) : null}
            <div className="flex items-center gap-2.5">
              <span className="text-3xl">{kit.emoji}</span>
              <div>
                <h3 className={`text-headline-sm font-bold ${kit.id === 'kit-trader' ? 'text-amber-400' : ''}`}>{kit.title}</h3>
                <p className={`text-xs ${kit.id === 'kit-trader' ? 'text-slate-300' : 'text-outline'}`}>{kit.subtitle}</p>
              </div>
            </div>
            {kit.features.length > 0 ? (
              <div
                className={`text-xs space-y-1 rounded-xl ${
                  kit.id === 'kit-trader' ? 'text-slate-300 bg-white/5 p-2.5' : 'text-on-surface-variant bg-surface-container-low dark:bg-slate-800/60 p-2.5'
                }`}
              >
                {kit.features.map((f) => (
                  <div key={f}>✓ {f}</div>
                ))}
              </div>
            ) : null}
            <button
              className={`w-full py-2 font-bold rounded-xl text-xs transition-colors ${
                kit.id === 'kit-trader'
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  : 'bg-primary/10 text-primary'
              }`}
              onClick={() => setView('paywall')}
            >
              {kit.cta}
            </button>
          </div>
        ) : null,
      )}
    </section>
  );
}
