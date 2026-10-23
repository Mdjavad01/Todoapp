import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';

/** بخش ۱۱: صفحه‌ی اشتراک کارام پرو — قیمت‌ها فعلاً نمایشی؛ در فاز ۵ از سرور خوانده می‌شود */
interface Plan {
  key: string;
  label: string;
  price: string;
  note: string;
  featured?: boolean;
  badge?: string;
}

const PLANS: Plan[] = [
  { key: 'monthly', label: 'ماهانه', price: '۴۹', note: 'عادی' },
  { key: 'annual', label: 'سالانه', price: '۱۹۰', note: 'محبوب‌ترین پلن', featured: true, badge: '۶۰٪ تخفیف ویژه' },
  { key: 'lifetime', label: 'مادام‌العمر', price: '۴۹۰', note: 'یکبار پرداخت' },
];

const BENEFITS = [
  'تبدیل نامحدود وویس به وظیفه هوشمند با هوش مصنوعی',
  'دسترسی به تمامی بسته‌های شغلی تخصصی و مالی',
  'همگام‌سازی ابری و بک‌آپ خودکار نامحدود',
  'قفل امنیتی بیومتریک و تم‌های اختصاصی لوکس',
];

export function PaywallView() {
  const showToast = useAppStore((s) => s.showToast);
  const [selected, setSelected] = useState<string>('annual');
  return (
    <section className="p-margin flex flex-col gap-4" id="view-paywall">
      <div className="text-center py-2">
        <span className="inline-block p-2 rounded-2xl bg-amber-400/20 text-amber-500 mb-2">
          <Icon name="workspace_premium" size={36} />
        </span>
        <h2 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">کارام پرو (Karam Pro)</h2>
        <p className="text-body-sm text-on-surface-variant">پتانسیل نامحدود برنامه‌ریزی بدون حواس‌پرتی</p>
      </div>

      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 space-y-2.5 text-body-sm">
        {BENEFITS.map((b) => (
          <div key={b} className="flex items-center gap-2">
            <Icon name="check_circle" size={18} className="text-emerald-600" />
            <span>{b}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PLANS.map((p) => {
          const active = selected === p.key;
          return (
            <div
              key={p.key}
              className={`p-3 rounded-2xl text-center flex flex-col justify-between relative cursor-pointer ${
                p.featured
                  ? 'border-2 border-primary bg-primary/10 shadow-md'
                  : 'border border-outline-variant/40 bg-surface-container dark:bg-slate-800'
              } ${active ? 'ring-2 ring-primary/40' : ''}`}
              onClick={() => setSelected(p.key)}
              role="radio"
              aria-checked={active}
            >
              {p.featured ? (
                <span className="absolute -top-2.5 right-1/2 translate-x-1/2 bg-primary text-on-primary text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                  {p.badge}
                </span>
              ) : null}
              <span className={`text-xs font-bold ${p.featured ? 'text-primary' : 'text-outline'}`}>{p.label}</span>
              <div className="my-2">
                <span className={`font-black ${p.featured ? 'text-lg text-primary' : 'text-base'}`}>{toFa(p.price)}</span>
                <span className={`text-[10px] block ${p.featured ? 'font-bold text-primary' : ''}`}>هزار تومان</span>
              </div>
              <span className={`text-[9px] ${p.featured ? 'text-emerald-600 font-bold' : 'text-outline'}`}>{p.note}</span>
            </div>
          );
        })}
      </div>

      <button
        className="w-full py-3.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        onClick={() => showToast('برای خرید اشتراک، ابتدا وارد حساب کاربری شوید (فاز ۳)')}
      >
        <Icon name="verified" size={22} />
        <span>ارتقا به کارام پریمیوم</span>
      </button>
    </section>
  );
}
