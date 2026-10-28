import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import { faJalaliDate } from '@/lib/jalali';

/**
 * فاز الف — هدر ساده‌ی سراسری: نام «کارام» + جستجو + تم + تقویم شمسی.
 * ردیف چیپ‌های بخش‌ها حذف شد (ناوبری ۵تبی جای آن را گرفت).
 */
export function TopBar() {
  const setView = useAppStore((s) => s.setView);
  const dark = useAppStore((s) => s.dark);
  const setDark = useAppStore((s) => s.setDark);
  const openCalendar = useAppStore((s) => s.openCalendar);

  return (
    <header className="bg-surface dark:bg-inverse-surface px-margin h-16 flex justify-between items-center w-full z-40 transition-colors shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-headline-md font-headline-md font-bold text-primary dark:text-inverse-primary leading-tight">
          کارام
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant dark:text-inverse-on-surface hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
          onClick={() => setView('search')}
          title="جستجو"
          aria-label="جستجو"
        >
          <Icon name="search" size={22} />
        </button>
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant dark:text-inverse-on-surface hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
          onClick={() => setDark(!dark)}
          title="سوییچ تم روز/شب"
          aria-label="سوییچ تم روز/شب"
        >
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size={20} />
        </button>
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center text-primary dark:text-inverse-primary hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
          onClick={() => openCalendar('hub')}
          title={`تقویم شمسی — ${faJalaliDate(new Date())}`}
          aria-label="تقویم شمسی"
        >
          <Icon name="calendar_today" size={22} />
        </button>
      </div>
    </header>
  );
}
