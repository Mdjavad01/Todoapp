import { useEffect } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';

/** پرسش‌های راهنمای کارام (v11) — محتوای واقعی و آفلاین؛ رنگ چیپ‌ها در هر دو تم با جفتِ dark تعریف شده */
interface GuideItem {
  icon: IconName;
  chip: string;
  q: string;
  a: string;
}

const GUIDE_ITEMS: GuideItem[] = [
  {
    icon: 'add',
    chip: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
    q: 'چطور کار جدید اضافه کنم؟',
    a: 'دکمه‌ی سبز + پایین صفحه را بزنید، عنوان کار را بنویسید و «ثبت و ذخیره کار» را بزنید. اگر تاریخ و ساعت داخل عنوان باشد — مثلاً «فردا ساعت ۱۷ خرید نان» — کارام خودش تشخیص می‌دهد و زمان‌بندی می‌کند. برای انتخاب دقیق تاریخ از دکمه‌ی «تقویم شمسی» در همان صفحه استفاده کنید.',
  },
  {
    icon: 'checklist',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    q: 'لیست جدید چطور بسازم؟',
    a: 'در صفحه‌ی خانه کنار «لیست‌های من» روی «لیست جدید» بزنید و یک نام و ایموجی انتخاب کنید. برای شروع سریع، از بخش «قالب‌ها» چک‌لیست آماده مثل خرید هفتگی را با یک ضربه به لیست‌هایتان اضافه کنید.',
  },
  {
    icon: 'event_note',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    q: 'قالب‌های آماده چه هستند؟',
    a: 'در تب «قالب‌ها» چک‌لیست‌های آماده‌ی کارام (مثل خرید هفتگی) و کیت‌های شغلی دسته‌بندی‌شده قرار دارد. با یک ضربه، همه‌ی آیتم‌ها به لیست شما اضافه می‌شود و لازم نیست از صفر بنویسید — بعدش هر آیتم را مثل کار عادی تیک بزنید.',
  },
  {
    icon: 'mail',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    q: 'ورود با تلگرام و سینک ابری چگونه است؟',
    a: 'از تنظیمات ← «حساب کاربری و سینک ابری» وارد شوید؛ ربات تلگرام کارام کد تأیید را می‌فرستد. بعد از ورود، داده‌ها بین همه‌ی دستگاه‌های شما سینک می‌شود. بدون ورود هم اپ کامل و آفلاین کار می‌کند (حالت مهمان).',
  },
  {
    icon: 'cloud_sync',
    chip: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
    q: 'چطور از داده‌هایم پشتیبان بگیرم؟',
    a: 'تنظیمات ← «پشتیبان‌گیری از داده‌ها» ← «دریافت فایل پشتیبان». فایل را در جای امن نگه دارید؛ روی هر دستگاهی با «بازیابی از فایل» همه‌ی لیست‌ها و کارها برمی‌گردد.',
  },
  {
    icon: 'auto_awesome',
    chip: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
    q: 'ظاهر اپ را چطور شخصی‌سازی کنم؟',
    a: 'تم روز/شب با آیکن ماه و خورشید بالای صفحه عوض می‌شود؛ رنگ برجستگی برند و اندازه‌ی فونت (کوچک، متوسط، بزرگ) در تنظیمات است و ظاهر دخترانه/پسرانه از گزینه‌ی «ظاهر اپ» تغییر می‌کند.',
  },
  {
    icon: 'notifications_active',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    q: 'اطلاع‌رسانی ساعت‌دار نمی‌آید؛ چه کنم؟',
    a: 'اول گزینه‌ی «اعلان‌ها و دورزدن باتری (هشدار دقیق)» در تنظیمات فعال باشد. بعد در تنظیمات خود گوشی، اعلان کارام را روی حالت «صدا و نمایش روی صفحه» بگذارید و اپ را از بهینه‌سازی باتری مستثنا کنید — بعضی گوشی‌ها اپ را در پس‌زمینه می‌بندند.',
  },
  {
    icon: 'home',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    q: 'چطور کارام را روی گوشی نصب کنم؟',
    a: 'در مرورگر گوشی، منوی سه‌نقطه را باز کنید و «افزودن به صفحه اصلی» یا «نصب برنامه» را بزنید. کارام مثل یک اپ واقعی تمام‌صفحه و با آیکن اختصاصی باز می‌شود و حتی بدون اینترنت هم کامل کار می‌کند.',
  },
  {
    icon: 'folder',
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    q: 'داده‌هایم کجا ذخیره می‌شود؟',
    a: 'همه‌ی داده‌ها اول روی همین دستگاه (IndexedDB) ذخیره می‌شود و کاملاً آفلاین کار می‌کند. اگر وارد حساب شده باشید، همان داده‌ها برای سینک بین دستگاه‌ها به سرور کارام هم همگام می‌شود.',
  },
];

/** پاپ‌آپ راهنمای کارام (v11) — پنجره‌ی مرکزی با ورود فِید + پاپ جذاب، هدر گرادیانی و آکاردئون رنگی */
export function GuideSheet() {
  const open = useAppStore((s) => s.guideSheet);
  const openTour = useAppStore((s) => s.openTour);
  const onClose = () => useAppStore.setState({ guideSheet: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-5 fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="راهنمای کارام"
    >
      <div
        className="bg-surface dark:bg-slate-900 w-full rounded-[28px] shadow-2xl pop-in flex flex-col overflow-hidden"
        style={{ maxHeight: '84%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* هدر گرادیانی با نقش‌های تزئینی */}
        <div className="relative overflow-hidden bg-gradient-to-bl from-primary to-primary-deep px-5 pt-5 pb-4 shrink-0">
          <div className="absolute -top-8 -left-8 w-28 h-28 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute -bottom-10 -right-6 w-24 h-24 rounded-full bg-white/10" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/25 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Icon name="help" size={26} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-headline-md font-black text-white">راهنمای کارام</h3>
              <p className="text-body-sm text-white/85 mt-0.5">
                تور تعاملی + {toFa(GUIDE_ITEMS.length)} پرسش و پاسخ
              </p>
            </div>
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/85 hover:bg-white/15 active:scale-95 transition-all shrink-0"
              onClick={onClose}
              aria-label="بستن راهنما"
            >
              <Icon name="close" size={22} />
            </button>
          </div>
        </div>

        {/* تور تعاملی مرحله‌به‌مرحله (v12) */}
        <div className="m-3.5 mb-0 rounded-2xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-4 relative overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Icon name="auto_awesome" size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-body-md text-on-surface dark:text-inverse-on-surface">تور تعاملی کارام</p>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">۳ گام کوتاه؛ هر گام یک بخش واقعی از اپ را با نورافکن نشانتان می‌دهد</p>
            </div>
          </div>
          <button
            className="mt-3 w-full py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-1.5"
            onClick={() => {
              onClose();
              openTour();
            }}
          >
            <Icon name="flag" size={17} />
            شروع تور مرحله‌به‌مرحله
          </button>
        </div>

        {/* آکاردئون پرسش‌ها — لیست بلند با اسکرول */}
        <div className="flex-1 overflow-y-auto custom-scrollbar text-body-md" id="guide-body">
          {GUIDE_ITEMS.map((it, i) => (
            <details key={it.q} className={`group ${i > 0 ? 'border-t border-outline-variant/20' : ''}`} open={i === 0}>
              <summary className="flex items-center gap-3 p-3.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden active:bg-surface-container/60 transition-colors">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${it.chip}`}>
                  <Icon name={it.icon} size={20} />
                </span>
                <span className="font-semibold flex-1 min-w-0">{it.q}</span>
                <Icon
                  name="expand_more"
                  size={18}
                  className="text-outline transition-transform duration-200 group-open:rotate-180 shrink-0"
                />
              </summary>
              <p className="px-3.5 pb-4 pr-[60px] text-body-sm text-on-surface-variant leading-relaxed">{it.a}</p>
            </details>
          ))}
        </div>

        {/* دکمه‌ی پایانی */}
        <div className="p-4 border-t border-outline-variant/20 shrink-0">
          <button
            className="w-full py-3.5 rounded-2xl bg-primary text-on-primary font-bold text-body-md active:scale-95 transition-transform flex items-center justify-center gap-1.5 shadow-sm"
            onClick={onClose}
          >
            <Icon name="check" size={19} />
            متوجه شدم!
          </button>
        </div>
      </div>
    </div>
  );
}
