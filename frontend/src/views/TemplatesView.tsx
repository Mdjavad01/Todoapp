import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { TraderCard } from '@/components/TraderCard';
import { useAppStore } from '@/store/useAppStore';
import { TEMPLATES } from '@/db/catalog';
import { JOB_PACKS, packItemCount, PACK_REPEAT_NOTICE, isPackActive } from '@/db/jobPacks';
import { toFa } from '@/lib/format';
import type { JobPackDef, JobPackItem, JobPackList } from '@/types';

/**
 * بسته C — صفحه‌ی واحد «قالب‌ها» (ادغام TemplatesView و JobKitsView سابق):
 *  - بخش «رایگان برای همه»: ۴ قالب کاتالوگ (سوپرمارکت، کنکور، سفر، خانه‌تکانی) با برچسب «رایگان»
 *  - بخش «مخصوص کارام پرو»: چک‌لیست تریدر (قفل کلاینت TRADER_REQUIRES_PRO) + ۳ بسته‌ی شغلی با برچسب «پرو»
 * تنها ورود به این صفحه: «لیست جدید ← یا از قالب‌های آماده شروع کنید» — ردیف‌های تنظیمات حذف شدند و
 * کارت ارتقا به پرو (تنظیمات/آمار) به همین صفحه راه می‌برد.
 */

/** فاز الف — سربرگ مشترک صفحات داخلی: دکمه‌ی بازگشت + عنوان روشن */
function InnerHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const goHome = useAppStore((s) => s.goHome);
  return (
    <div className="flex items-center gap-2">
      <button
        className="w-9 h-9 rounded-full bg-surface-container dark:bg-slate-700 flex items-center justify-center text-on-surface shrink-0"
        onClick={goHome}
        aria-label="بازگشت به خانه"
      >
        <Icon name="arrow_forward" size={18} />
      </button>
      <div>
        <h1 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">{title}</h1>
        <p className="text-body-sm text-on-surface-variant">{subtitle}</p>
      </div>
    </div>
  );
}

/** بسته C — صفحه‌ی واحد قالب‌ها: دو بخش با برچسب رایگان/پرو */
export function TemplatesView() {
  const applyTemplate = useAppStore((s) => s.applyTemplate);
  const setView = useAppStore((s) => s.setView);
  const activateJobPack = useAppStore((s) => s.activateJobPack);
  const resetJobPack = useAppStore((s) => s.resetJobPack);
  const premium = useAppStore((s) => s.premium);
  const isPro = premium.loaded && premium.isPremium;

  return (
    <section className="p-margin flex flex-col gap-4" id="view-templates">
      <InnerHeader
        title="قالب‌ها"
        subtitle="چک‌لیست‌های آماده برای شروع سریع — رایگان‌ها برای همه؛ فعال‌سازی بسته‌های پرو مخصوص کارام پرو"
      />

      {/* بخش رایگان — ۴ قالب کاتالوگ */}
      <h2 className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-1.5">
        <Icon name="check_circle" size={18} className="text-primary" />
        رایگان برای همه
      </h2>
      <div className="grid grid-cols-1 gap-3" id="templates-free">
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 shadow-sm flex items-center justify-between gap-3"
            data-template={tpl.id}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-3xl shrink-0">{tpl.emoji}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h4 className="text-label-lg font-bold">{tpl.title}</h4>
                  <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                    رایگان
                  </span>
                </div>
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

      {/* بخش پرو — چک‌لیست تریدر + ۳ بسته‌ی شغلی */}
      <h2 className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-1.5">
        <Icon name="workspace_premium" size={18} className="text-secondary" />
        مخصوص کارام پرو
      </h2>
      <div className="flex flex-col gap-3" id="templates-pro">
        {/* چک‌لیست تریدر — قفل کلاینت TRADER_REQUIRES_PRO؛ فعالِ قبلی/پرو/بیلد بازار = دسترسی کامل */}
        <TraderCard />
        {JOB_PACKS.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            isPro={isPro}
            onLocked={() => setView('paywall')}
            onActivate={() => void activateJobPack(pack)}
            onReset={() => void resetJobPack(pack.id)}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------------- P2.0 — کارت بسته با پیش‌نمایش کامل ---------------- */

/** برچسب نوع آیتم — همان واژگان فاز تریدر */
function itemTypeBadge(t: JobPackItem['type']): string | null {
  switch (t) {
    case 'num':
      return 'عدد';
    case 'note':
      return 'یادداشت';
    case 'choice':
      return 'بله/نه';
    case 'score':
      return 'امتیاز';
    default:
      return null; // تیک ساده — نشان نمی‌خواهد
  }
}

const JALALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

/** برچسب تکرار/یادآور آیتم — صادقانه و کوتاه */
function repeatBadge(t: JobPackItem): string | null {
  if (t.dueTime) return `یادآور ${t.dueTime}`;
  if (t.repeat === 'daily') return 'روزانه';
  if (t.repeat === 'custom' && t.repeatMeta?.unit === 'week') {
    const d = t.repeatMeta.days?.[0] ?? 6;
    return `هفتگی (${JALALI_WEEKDAYS[d] ?? ''})`;
  }
  return null;
}

function PackListPreview({ list }: { list: JobPackList }) {
  return (
    <div className="rounded-xl bg-surface-container-low dark:bg-slate-800/60 p-2.5">
      <p className="text-xs font-bold mb-1">
        {list.emoji} {list.name}
      </p>
      <p className="text-[11px] text-on-surface-variant leading-5 mb-1.5">{list.guide}</p>
      <ul className="text-xs space-y-0.5 text-on-surface-variant">
        {list.items.map((it) => {
          const badge = itemTypeBadge(it.type);
          const rep = repeatBadge(it);
          return (
            <li key={it.title} className="flex items-start gap-1">
              <span className="shrink-0 text-primary">•</span>
              <span className="flex-1">{it.title}</span>
              {badge ? <span className="shrink-0 px-1.5 rounded-full bg-primary/10 text-primary text-[10px] leading-5">{badge}</span> : null}
              {rep ? <span className="shrink-0 px-1.5 rounded-full bg-outline-variant/40 text-on-surface-variant text-[10px] leading-5">{rep}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PackCard({
  pack,
  isPro,
  onLocked,
  onActivate,
  onReset,
}: {
  pack: JobPackDef;
  isPro: boolean;
  onLocked: () => void;
  onActivate: () => void;
  onReset: () => void;
}) {
  const lists = useAppStore((s) => s.lists);
  const active = isPackActive(lists, pack);
  const [open, setOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  return (
    <div
      className="p-4 rounded-2xl bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 shadow-sm flex flex-col gap-3"
      data-pack={pack.id}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-3xl">{pack.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-headline-sm font-bold">{pack.title}</h3>
            {/* بسته C — برچسب سطح بسته (بعد از فعال‌سازی، چیپ «فعال است» کنارش می‌آید) */}
            <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-secondary/15 text-secondary shrink-0">
              پرو
            </span>
          </div>
          <p className="text-xs text-outline">{pack.subtitle}</p>
        </div>
        {active ? (
          <span className="shrink-0 px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold flex items-center gap-1">
            <Icon name="check_circle" size={13} />
            فعال است
          </span>
        ) : null}
      </div>

      <p className="text-xs text-on-surface-variant">
        {toFa(pack.lists.length)} لیست · {toFa(packItemCount(pack))} آیتم — با پیش‌نمایش کامل پایین، همه‌چیز را قبل از فعال‌سازی ببین.
      </p>

      {/* پیش‌نمایش کامل — برای همه آزاد (داده در خود اپ است؛ پنهان‌کردنش صادقانه نیست) */}
      <button
        className="self-start px-3 py-1.5 rounded-xl text-xs font-bold bg-surface-container dark:bg-slate-700 text-on-surface-variant hover:bg-surface-container-high transition-colors flex items-center gap-1"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? `بستن پیش‌نمایش ${pack.title}` : `نمایش پیش‌نمایش ${pack.title}`}
      >
        <Icon name={open ? 'expand_more' : 'arrow_back'} size={14} />
        {open ? 'بستن پیش‌نمایش محتوا' : 'دیدن محتوای کامل بسته'}
      </button>
      {open ? (
        <div className="flex flex-col gap-2" data-pack-preview={pack.id}>
          {pack.lists.map((l) => (
            <PackListPreview key={l.name} list={l} />
          ))}
          <p className="text-[11px] text-outline leading-5 border-t border-outline-variant/30 pt-2">{PACK_REPEAT_NOTICE}</p>
        </div>
      ) : null}

      {/* قفل فقط روی فعال‌سازی — متن خنثی بدون وعده خرید، یکسان در وب و بازار */}
      {active ? (
        <div className="flex gap-2">
          <button
            className="flex-1 py-2 font-bold rounded-xl text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            onClick={() => setOpen(true)}
          >
            دیدن لیست‌ها
          </button>
          <button
            className="px-4 py-2 font-bold rounded-xl text-xs text-rose-500 hover:bg-rose-500/10 transition-colors"
            onClick={() => setResetConfirm(true)}
          >
            بازنشانی بسته
          </button>
        </div>
      ) : isPro ? (
        <button
          className="w-full py-2 font-bold rounded-xl text-xs bg-primary text-on-primary hover:opacity-90 transition-opacity"
          onClick={onActivate}
        >
          {pack.cta}
        </button>
      ) : (
        <button
          className="w-full py-2 font-bold rounded-xl text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5"
          onClick={onLocked}
          data-pack-locked={pack.id}
        >
          <Icon name="lock" size={14} />
          بازکردن با کارام پرو
        </button>
      )}

      {/* دیالوگ تأیید بازنشانی — حذف نرم لیست‌های بسته (با کلید یا نام) */}
      {resetConfirm ? (
        <div
          className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`تأیید بازنشانی ${pack.title}`}
          onClick={() => setResetConfirm(false)}
        >
          <div
            className="bg-surface-container-lowest dark:bg-slate-800 text-on-surface dark:text-inverse-on-surface w-full max-w-sm rounded-2xl p-4 shadow-xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-label-lg font-bold text-rose-500">بازنشانی {pack.title}؟</h4>
            <p className="text-body-sm text-on-surface-variant leading-6">
              هر {toFa(pack.lists.length)} لیست این بسته حذف می‌شود (لیست‌هایی که نامشان را عوض کرده‌ای هم — با کلید قالب شناخته می‌شوند).
              ویرایش‌ها و تیک‌های فعلی از بین می‌رود؛ بعداً می‌توانی دوباره فعالش کنی.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-xl text-sm font-bold bg-rose-500 hover:bg-rose-400 text-white"
                onClick={() => {
                  setResetConfirm(false);
                  onReset();
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
