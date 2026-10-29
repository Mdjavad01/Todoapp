import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { GUEST_NOTICE_PREF, shouldShowGuestBanner } from '@/lib/account';
import * as repo from '@/db/repo';

/**
 * v1.9 — بنر شفافیت داده‌ی مهمان (صفحه‌ی خانه — یک‌بار، قابل‌بستن)
 *
 * کاربر مهمان باید روشن بداند: داده‌هایش فقط روی همین گوشی (IndexedDB) است و
 * با حذف اپ یا پاک‌کردن داده‌ی برنامه برای همیشه از بین می‌رود.
 *  - بستن با ✗ → دیگر نشان داده نمی‌شود (پایا در prefs — نه روزانه)
 *  - دکمه‌ی «بک‌آپ بگیر یا وارد شو» → شیت حساب (پشتیبان‌گیری + ورود)
 *  - یادآوریِ دوم هم هنگام حذفِ لیست برای مهمان است (EditListSheet)
 */

export function GuestDataBanner() {
  const session = useAppStore((s) => s.session);
  const openAccountSheet = useAppStore((s) => s.openAccountSheet);
  const [dismissed, setDismissed] = useState(true); // پیش‌فرض: پنهان تا pref خوانده شود (بدون پرش)

  useEffect(() => {
    void repo
      .prefsGet<boolean>(GUEST_NOTICE_PREF, false)
      .then((v) => setDismissed(Boolean(v)))
      .catch(() => undefined);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    void repo.prefsSet(GUEST_NOTICE_PREF, true).catch(() => undefined);
  };

  if (!shouldShowGuestBanner(session, dismissed)) return null;

  return (
    <div
      className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300/60 dark:border-amber-700/50 rounded-2xl p-3.5"
      role="status"
      aria-label="هشدار داده‌ی مهمان"
      id="guest-data-banner"
    >
      <div className="flex items-start gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <Icon name="smartphone" size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-amber-800 dark:text-amber-200">
            داده‌های شما فقط روی همین گوشی است
          </p>
          <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-300/90 mt-0.5">
            تا وقتی وارد حساب نشده‌اید، کارها فقط روی همین دستگاه ذخیره می‌شوند و با حذف برنامه یا پاک‌کردن داده‌ی آن،
            برای همیشه از بین می‌روند.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              className="rounded-xl bg-amber-500 text-white px-3 py-1.5 text-[11px] font-black active:scale-95 transition-transform"
              onClick={openAccountSheet}
              aria-label="بک‌آپ بگیر یا وارد شو"
            >
              بک‌آپ بگیر یا وارد شو
            </button>
          </div>
        </div>
        <button
          className="w-7 h-7 rounded-full text-amber-700 dark:text-amber-300 flex items-center justify-center hover:bg-amber-100 dark:hover:bg-amber-900/60 shrink-0"
          onClick={dismiss}
          aria-label="بستن هشدار داده‌ی مهمان (دیده شد)"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
