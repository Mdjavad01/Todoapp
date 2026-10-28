import { useCallback, useEffect, useState } from 'react';
import { formatToman, priceFull } from './format';

/**
 * کارام پنل — نمایش دوحالته‌ی قیمت‌ها (فاز تومان)
 *   summary (پیش‌فرض) = خلاصه‌ی خوانا: «۴۹۰ هزار تومان» (formatToman)
 *   full              = عدد کامل: «۴۹۰٬۰۰۰ تومان» (priceFull)
 * انتخاب مدیر در localStorage ذخیره می‌شود و همه‌ی تب‌ها (پلن‌ها/داشبورد/واریز/کدهای هدیه)
 * با یک رویداد سفارسی هم‌گام می‌شوند.
 */
export type PriceDisplay = 'summary' | 'full';

const KEY = 'karam-panel-price-display';
const EVENT = 'karam-price-display-changed';

function read(): PriceDisplay {
  try {
    return localStorage.getItem(KEY) === 'full' ? 'full' : 'summary';
  } catch {
    return 'summary';
  }
}

export function usePriceDisplay(): [PriceDisplay, (m: PriceDisplay) => void] {
  const [mode, setMode] = useState<PriceDisplay>(read);

  useEffect(() => {
    const on = () => setMode(read());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);

  const update = useCallback((m: PriceDisplay) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* حالت خصوصی مرورگر — فقط همین نشست */
    }
    setMode(m);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [mode, update];
}

/** متن قیمت بر اساس حالت انتخابی */
export function priceText(tomans: number, mode: PriceDisplay): string {
  return mode === 'full' ? priceFull(tomans) : formatToman(tomans);
}
