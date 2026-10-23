import { Icon } from '@/components/Icon';
import { useAppStore, ACCENTS, type AccentColor } from '@/store/useAppStore';
import { toFa } from '@/lib/format';

const APP_VERSION = '۳.۲.۱';

const ACCENT_DOTS: Record<AccentColor, { bg: string; ring: string }> = {
  teal: { bg: 'bg-teal-600', ring: 'ring-teal-600' },
  indigo: { bg: 'bg-indigo-600', ring: 'ring-indigo-600' },
  amber: { bg: 'bg-amber-500', ring: 'ring-amber-500' },
  emerald: { bg: 'bg-emerald-600', ring: 'ring-emerald-600' },
  rose: { bg: 'bg-rose-500', ring: 'ring-rose-500' },
  purple: { bg: 'bg-purple-600', ring: 'ring-purple-600' },
};

/** بخش ۱۳: تنظیمات — همه‌ی ترجیحات در IndexedDB ذخیره می‌شوند */
export function SettingsView() {
  const accent = useAppStore((s) => s.accent);
  const setAccent = useAppStore((s) => s.setAccent);
  const biometricLock = useAppStore((s) => s.biometricLock);
  const alerts = useAppStore((s) => s.alerts);
  const setPref = useAppStore((s) => s.setPref);
  const setView = useAppStore((s) => s.setView);
  const showToast = useAppStore((s) => s.showToast);

  return (
    <section className="p-margin flex flex-col gap-4" id="view-settings">
      <h2 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">تنظیمات</h2>

      {/* انتخاب رنگ برند */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex flex-col gap-3">
        <span className="text-label-md font-bold">رنگ تم و برجستگی برند</span>
        <div className="flex items-center justify-between px-2">
          {(Object.keys(ACCENT_DOTS) as AccentColor[]).map((a) => {
            const d = ACCENT_DOTS[a];
            const active = accent === a;
            return (
              <button
                key={a}
                className={`w-8 h-8 rounded-full ${d.bg} ${active ? `ring-2 ring-offset-2 ${d.ring} dark:ring-offset-slate-800` : ''}`}
                onClick={() => setAccent(a)}
                title={ACCENTS[a].label}
                aria-label={`رنگ ${ACCENTS[a].label}`}
                aria-pressed={active}
              />
            );
          })}
        </div>
      </div>

      {/* لیست ترجیحات */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 overflow-hidden divide-y divide-outline-variant/20 text-body-md">
        <div className="p-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <Icon name="fingerprint" size={22} className="text-outline" />
            <span>قفل بیومتریک و اثرانگشت</span>
          </div>
          <input
            type="checkbox"
            className="rounded text-primary focus:ring-0"
            checked={biometricLock}
            onChange={(e) => setPref('biometricLock', e.target.checked)}
            aria-label="قفل بیومتریک"
          />
        </div>
        <div className="p-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <Icon name="notifications_active" size={22} className="text-outline" />
            <span>اعلان‌ها و دورزدن باتری (هشدار دقیق)</span>
          </div>
          <input
            type="checkbox"
            className="rounded text-primary focus:ring-0"
            checked={alerts}
            onChange={(e) => setPref('alerts', e.target.checked)}
            aria-label="اعلان‌ها"
          />
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => showToast('سینک ابری با ورود به حساب کاربری فعال می‌شود (فاز ۳)')}
        >
          <div className="flex items-center gap-2.5">
            <Icon name="cloud_sync" size={22} className="text-outline" />
            <span>پشتیبان‌گیری در حساب کاربری</span>
          </div>
          <span className="text-xs text-primary font-bold">ورود به حساب</span>
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => setView('paywall')}
        >
          <div className="flex items-center gap-2.5">
            <Icon name="star" size={22} className="text-amber-500" />
            <span className="font-bold text-amber-600">ارتقا به نسخه پرو</span>
          </div>
          <Icon name="arrow_back_ios" size={16} className="text-outline" />
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => showToast('به‌زودی در کافه‌بازار منتشر می‌شود')}
        >
          <div className="flex items-center gap-2.5">
            <Icon name="shop" size={22} className="text-outline" />
            <span>ثبت نظر در کافه‌بازار</span>
          </div>
          <span className="text-xs text-outline">نسخه {toFa(APP_VERSION)}</span>
        </div>
      </div>

      {/* حالت مهمان */}
      <p className="text-body-sm text-on-surface-variant text-center leading-relaxed">
        شما در <span className="font-bold text-primary">حالت مهمان</span> هستید؛ همه‌ی داده‌ها فقط روی همین دستگاه
        (IndexedDB) ذخیره می‌شوند و کاملاً آفلاین کار می‌کنند.
      </p>
    </section>
  );
}

/** بخش ۱۴: وضعیت خالی (نمایش مستقل) */
export function EmptyStateView() {
  const openModal = useAppStore((s) => s.openModal);
  return (
    <section className="p-margin flex flex-col items-center justify-center text-center gap-3 py-16" id="view-emptyState">
      <div className="w-24 h-24 rounded-full bg-teal-50 dark:bg-teal-950/40 flex items-center justify-center text-primary text-4xl mb-2 animate-bounce">
        ☕
      </div>
      <h3 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">هیچ کاری برای امروز نمانده!</h3>
      <p className="text-body-sm text-on-surface-variant max-w-[260px] leading-relaxed">
        تمام وظایف تعیین‌شده با موفقیت انجام شده‌اند. وقت یک استراحت کوتاه و چای داغ است.
      </p>
      <button
        className="mt-4 px-6 py-2.5 bg-primary text-white font-bold rounded-2xl shadow-md active:scale-95 text-body-sm flex items-center gap-1.5"
        onClick={() => openModal('quickAdd')}
      >
        <Icon name="add" size={18} />
        <span>افزودن کار جدید</span>
      </button>
    </section>
  );
}
