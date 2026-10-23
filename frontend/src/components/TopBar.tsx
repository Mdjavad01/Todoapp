import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import { faJalaliDate } from '@/lib/jalali';
import type { ViewName } from '@/types';

/** هدر بالا: پروفایل، نام اپ، جستجو، تم و تقویم */
export function TopBar() {
  const setView = useAppStore((s) => s.setView);
  const dark = useAppStore((s) => s.dark);
  const setDark = useAppStore((s) => s.setDark);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const userName = useAppStore((s) => s.userName);

  return (
    <header className="bg-surface dark:bg-inverse-surface px-margin h-16 flex justify-between items-center w-full z-40 transition-colors shrink-0">
      <div className="flex items-center gap-2">
        <div
          className="w-9 h-9 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-bold text-headline-sm shadow-sm"
          title={`تصویر پروفایل کاربر ${userName} کارام`}
        >
          {userName.trim().charAt(0) || 'ع'}
        </div>
        <div className="flex flex-col">
          <span className="text-headline-md font-headline-md font-bold text-primary dark:text-inverse-primary leading-tight">
            کارام
          </span>
          <span className="text-[10px] text-on-surface-variant dark:text-outline leading-none">
            مدیریت هوشمند کارها
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant dark:text-inverse-on-surface hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
          onClick={() => setView('search')}
          title="جستجو"
          aria-label="جستجو"
        >
          <Icon name="search" size={22} />
        </button>
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant dark:text-inverse-on-surface hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
          onClick={() => setDark(!dark)}
          title="سوییچ تم روز/شب"
          aria-label="سوییچ تم روز/شب"
        >
          <Icon name={dark ? 'light_mode' : 'dark_mode'} size={20} />
        </button>
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-primary dark:text-inverse-primary hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
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

const CHIPS: { view: ViewName; label: string }[] = [
  { view: 'home', label: '۱. خانه' },
  { view: 'listView', label: '۳. لیست خانه' },
  { view: 'todayView', label: '۷. امروز' },
  { view: 'analytics', label: '۸. آمار' },
  { view: 'templates', label: '۹. قالب‌ها' },
  { view: 'jobkits', label: '۱۰. بسته‌های شغلی' },
  { view: 'paywall', label: '۱۱. اشتراک پرو' },
  { view: 'emptyState', label: '۱۴. وضعیت خالی' },
  { view: 'settings', label: '۱۳. تنظیمات' },
];

/** نوار انتخاب بخش‌ها (بالای محتوا) */
export function SectionChips() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const activeListId = useAppStore((s) => s.activeListId);
  const lists = useAppStore((s) => s.lists);

  const activeChip: ViewName = view === 'search' ? 'home' : view;
  return (
    <div className="w-full bg-surface-container-low dark:bg-slate-800/60 px-3 py-1.5 overflow-x-auto no-scrollbar flex items-center gap-1.5 border-b border-outline-variant/30 text-body-sm z-30 shrink-0">
      <span className="text-[10px] font-bold text-primary px-1 shrink-0">بخش‌ها:</span>
      {CHIPS.map((c) => {
        const active = activeChip === c.view;
        const label = c.view === 'listView' && activeListId
          ? `۳. ${lists.find((l) => l.id === activeListId)?.name ?? 'لیست خانه'}`
          : c.label;
        return (
          <button
            key={c.view}
            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              active ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant dark:text-outline'
            }`}
            onClick={() => setView(c.view)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
