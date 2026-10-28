import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import type { ViewName } from '@/types';

/**
 * فاز الف — ناوبری پایین، دقیقاً ۵ تب: خانه / امروز / پلنر / آمار / تنظیمات.
 * تب فعال با رنگ برند و وزن بولد کاملاً مشخص است. صفحات داخلی (لیست، مهم، همه،
 * جستجو) زیر تب «خانه» هایلایت می‌شوند.
 */
const TABS: { view: ViewName; icon: 'home' | 'today' | 'event_note' | 'bar_chart' | 'settings'; label: string }[] = [
  { view: 'home', icon: 'home', label: 'خانه' },
  { view: 'myday', icon: 'today', label: 'امروز' },
  { view: 'planned', icon: 'event_note', label: 'پلنر' },
  { view: 'analytics', icon: 'bar_chart', label: 'آمار' },
  { view: 'settings', icon: 'settings', label: 'تنظیمات' },
];

export function BottomNav() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  const isActive = (tab: ViewName): boolean =>
    tab === view ||
    ((view === 'listView' || view === 'important' || view === 'all' || view === 'search') && tab === 'home');

  return (
    <nav
      className="absolute bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 px-gutter pb-safe bg-surface dark:bg-inverse-surface shadow-lg dark:shadow-none transition-colors border-t border-outline-variant/20"
      aria-label="ناوبری اصلی"
    >
      {TABS.map((tab) => (
        <button
          key={tab.view}
          className={`flex flex-col items-center justify-center w-16 h-full active:scale-95 transition-transform duration-150 ${
            isActive(tab.view)
              ? 'text-primary dark:text-inverse-primary font-bold'
              : 'text-on-surface-variant dark:text-slate-300'
          }`}
          onClick={() => setView(tab.view)}
          aria-current={isActive(tab.view) ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={24} />
          <span className="text-label-sm font-label-sm mt-0.5">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** توست کوچک بازخورد اقدامات — با اقدام اختیاری (واگرد — فاز ۲) */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const clearToast = useAppStore((s) => s.clearToast);
  if (!toast) return null;
  return (
    <div
      className="absolute bottom-36 left-1/2 -translate-x-1/2 z-[60] bg-inverse-surface dark:bg-slate-600 text-inverse-on-surface dark:text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl fade-in max-w-[85%] text-center flex items-center gap-3"
      role="status"
      onClick={clearToast}
    >
      <span>{toast.text}</span>
      {toast.action ? (
        <button
          className="shrink-0 text-primary-fixed font-black underline underline-offset-2 px-1 active:scale-95 transition-transform"
          onClick={(e) => {
            e.stopPropagation();
            toast.action!.run();
            clearToast();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}
