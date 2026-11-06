/**
 * بنر «به‌روزرسانی آماده است» — فقط وب (داخل اپ اندروید سرویس‌ورکری نیست).
 * وقتی سرویس‌ورکر نو در صف waiting باشد نمایش داده می‌شود؛
 * «بروزرسانی» = فعال‌سازی نسخه‌ی نو + یک‌بار بارگذاری مجدد (pwa/register.ts).
 */
import { useEffect, useState } from 'react';
import { applySwUpdate, onSwWaiting } from '@/pwa/register';
import { isNativeApp } from '@/lib/native';

export function UpdateBanner() {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (isNativeApp()) return undefined;
    return onSwWaiting((w) => setWaiting(w !== null));
  }, []);

  if (isNativeApp() || !waiting) return null;

  return (
    <div className="shrink-0 px-3 pt-2" role="status" aria-label="به‌روزرسانی کارام آماده است">
      <div className="flex items-center gap-2 rounded-xl bg-primary/10 dark:bg-primary/20 border border-primary/30 px-3 py-2 text-[11px] leading-5 text-on-surface dark:text-inverse-on-surface">
        <span className="flex-1 font-bold">نسخه‌ی جدید کارام آماده است — برای اعمال، بروزرسانی کنید.</span>
        <button
          className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[11px] font-black text-on-primary active:scale-95 transition-transform"
          onClick={applySwUpdate}
        >
          بروزرسانی
        </button>
      </div>
    </div>
  );
}
