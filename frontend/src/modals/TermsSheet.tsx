import { useEffect } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';

/**
 * کارام v17 — قوانین استفاده، حریم خصوصی و پشتیبانی
 * محتوای آفلاین و ثابت؛ اطلاعات تماس پشتیبانی از تنظیمات سرور می‌آید
 * (پنل ادمین ← تنظیمات ← به‌روزرسانی اپ و پشتیبانی) با پیش‌فرض مطمئن.
 */

interface TermItem {
  icon: IconName;
  chip: string;
  t: string;
}

const RULES: TermItem[] = [
  { icon: 'checklist', chip: 'bg-teal-500/10 text-teal-700 dark:text-teal-300', t: 'کارام ابزار شخصی مدیریت وظایف است؛ مسئولیت محتوای کارها و لیست‌ها با خودتان است.' },
  { icon: 'fingerprint', chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', t: 'ورود با کد یک‌بارمصرف انجام می‌شود؛ نگهداری از دسترسی دستگاه و حساب بر عهده‌ی شماست.' },
  { icon: 'star', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', t: 'اشتراک پرو دوره‌ای است؛ در پایان دوره اگر تمدید نکنید، اپ به نسخه‌ی رایگان برمی‌گردد ولی هیچ داده‌ای حذف نمی‌شود.' },
  { icon: 'credit_card', chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', t: 'پرداخت از درگاه بانکی یا کارت‌به‌کارت (با تأیید ادمین) است؛ وضعیت هر پرداخت در صفحه‌ی پرو قابل پیگیری است.' },
  { icon: 'warning', chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', t: 'سوءاستفاده از سرویس — تلاش برای نفوذ، بار مصنوعی یا ربات — موجب مسدودسازی حساب می‌شود.' },
  { icon: 'cloud_sync', chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', t: 'قطع موقت سرویس برای نگهداری با «حالت تعمیر» اعلام می‌شود؛ در این بازه داده‌ها محفوظ است.' },
  { icon: 'auto_awesome', chip: 'bg-primary/10 text-primary', t: 'این قواعد با به‌روزرسانی اپ ممکن است تغییر کند؛ نسخه‌ی جدید در همین صفحه اعلام می‌شود.' },
];

const PRIVACY: TermItem[] = [
  { icon: 'home', chip: 'bg-teal-500/10 text-teal-700 dark:text-teal-300', t: 'داده‌های کارها همیشه روی دستگاه شما ذخیره می‌شوند و اپ بدون اینترنت هم کامل کار می‌کند.' },
  { icon: 'person', chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', t: 'فقط اگر وارد حساب شوید داده‌ها برای سینک روی سرور کارام ذخیره می‌شود؛ در حالت مهمان هیچ داده‌ای از دستگاه خارج نمی‌شود.' },
  { icon: 'shield', chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', t: 'از محتوای کارهای شما برای تبلیغات یا فروش استفاده نمی‌کنیم؛ داده‌ی شما داده‌ی شماست.' },
  { icon: 'mail', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', t: 'برای ورود فقط ایمیل یا موبایل یا شناسه‌ی تلگرام شما نگهداری می‌شود؛ رمز عبوری وجود ندارد.' },
  { icon: 'delete', chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', t: 'درخواست حذف حساب = حذف کامل داده‌های سمت سرور؛ کافی است به پشتیبانی پیام بدهید.' },
];

function TermRow({ it }: { it: TermItem }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${it.chip}`}>
        <Icon name={it.icon} size={17} />
      </span>
      <p className="text-body-sm leading-relaxed text-on-surface dark:text-inverse-on-surface pt-1">{it.t}</p>
    </li>
  );
}

export function TermsSheet() {
  const open = useAppStore((s) => s.termsSheet);
  const appSettings = useAppStore((s) => s.appSettings);
  const onClose = () => useAppStore.setState({ termsSheet: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const email = appSettings.support?.email?.trim() || '';
  const telegram = appSettings.support?.telegram?.trim() || '';

  return (
    <div
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-5 fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="قوانین و حریم خصوصی کارام"
    >
      <div
        className="bg-surface dark:bg-slate-900 w-full rounded-[28px] shadow-2xl pop-in flex flex-col overflow-hidden"
        style={{ maxHeight: '84%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* هدر گرادیانی */}
        <div className="relative overflow-hidden bg-gradient-to-bl from-primary to-primary-deep px-5 pt-5 pb-4 shrink-0">
          <div className="absolute -top-8 -left-8 w-28 h-28 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute -bottom-10 -right-6 w-24 h-24 rounded-full bg-white/10" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/25 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Icon name="shield" size={26} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-headline-md font-black text-white">قوانین و حریم خصوصی</h3>
              <p className="text-body-sm text-white/85 mt-0.5">
                {toFa(RULES.length + PRIVACY.length)} بند کوتاه و شفاف
              </p>
            </div>
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/85 hover:bg-white/15 active:scale-95 transition-all shrink-0"
              onClick={onClose}
              aria-label="بستن"
            >
              <Icon name="close" size={22} />
            </button>
          </div>
        </div>

        {/* محتوا */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4" id="terms-body">
          {/* قوانین */}
          <p className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-2">
            <Icon name="checklist" size={18} className="text-primary" />
            قوانین استفاده
          </p>
          <ul className="divide-y divide-outline-variant/15">
            {RULES.map((it) => (
              <TermRow key={it.t} it={it} />
            ))}
          </ul>

          {/* حریم خصوصی */}
          <p className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-2 mt-4">
            <Icon name="lock" size={18} className="text-primary" />
            حریم خصوصی
          </p>
          <ul className="divide-y divide-outline-variant/15">
            {PRIVACY.map((it) => (
              <TermRow key={it.t} it={it} />
            ))}
          </ul>

          {/* پشتیبانی */}
          <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/5 dark:bg-primary/10 p-4">
            <p className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-2">
              <Icon name="help" size={18} className="text-primary" />
              پشتیبانی کارام
            </p>
            <p className="text-body-sm text-on-surface-variant mt-1.5 leading-relaxed">
              مشکل در پرداخت، حذف حساب یا هر سؤال دیگر؟ از همین راه‌ها پیام بدهید؛ سریع جواب می‌گیرید.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {email ? (
                <a
                  href={`mailto:${email}`}
                  dir="ltr"
                  className="flex items-center gap-2.5 rounded-xl bg-surface-container dark:bg-slate-800 px-3.5 py-3 text-body-sm font-bold text-on-surface dark:text-inverse-on-surface active:scale-[0.99] transition-transform"
                >
                  <Icon name="mail" size={18} className="text-primary shrink-0" />
                  {email}
                </a>
              ) : null}
              {telegram ? (
                <a
                  href={`https://t.me/${telegram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="flex items-center gap-2.5 rounded-xl bg-surface-container dark:bg-slate-800 px-3.5 py-3 text-body-sm font-bold text-on-surface dark:text-inverse-on-surface active:scale-[0.99] transition-transform"
                >
                  <Icon name="send" size={18} className="text-primary shrink-0" />
                  {telegram.startsWith('@') ? telegram : `@${telegram}`}
                </a>
              ) : null}
              {!email && !telegram ? (
                <p className="text-body-sm text-on-surface-variant leading-relaxed">
                  راه ارتباطی هنوز ثبت نشده — از تنظیمات سرور، اطلاعات پشتیبانی اضافه می‌شود.
                </p>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-on-surface-variant text-center mt-4 mb-1 leading-relaxed">
            استفاده‌ی شما از کارام به معنای پذیرش همین قواعد است · نسخه‌ی {toFa('3.7.0')}
          </p>
        </div>
      </div>
    </div>
  );
}
