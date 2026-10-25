import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import type { ViewName } from '@/types';

const TABS: { view: ViewName; icon: 'home' | 'check_circle' | 'bar_chart' | 'settings'; label: string }[] = [
  { view: 'home', icon: 'home', label: 'خانه' },
  { view: 'todayView', icon: 'check_circle', label: 'امروز' },
  { view: 'analytics', icon: 'bar_chart', label: 'آمار' },
  { view: 'settings', icon: 'settings', label: 'تنظیمات' },
];

/** ناوبری پایین — دقیقاً مطابق طرح */
export function BottomNav() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  const isActive = (tab: ViewName): boolean =>
    tab === view || (view === 'listView' && tab === 'home');

  return (
    <nav
      className="absolute bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 px-gutter pb-safe bg-surface dark:bg-inverse-surface shadow-lg dark:shadow-none transition-colors border-t border-outline-variant/20"
      aria-label="ناوبری اصلی"
    >
      {TABS.map((tab) => (
        <button
          key={tab.view}
          className={`flex flex-col items-center justify-center active:scale-95 transition-transform duration-150 ${
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

/** دکمه‌ی شناور افزودن */
export function Fab() {
  const openModal = useAppStore((s) => s.openModal);
  return (
    <button
      className="absolute bottom-20 left-5 w-14 h-14 rounded-full bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center shadow-lg active:scale-95 transition-all z-40"
      onClick={() => openModal('quickAdd')}
      title="افزودن کار جدید"
      aria-label="افزودن کار جدید"
    >
      <Icon name="add" size={30} />
    </button>
  );
}

/** توست کوچک بازخورد اقدامات */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const clearToast = useAppStore((s) => s.clearToast);
  if (!toast) return null;
  return (
    <div
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[60] bg-inverse-surface dark:bg-slate-600 text-inverse-on-surface dark:text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl fade-in max-w-[85%] text-center"
      role="status"
      onClick={clearToast}
    >
      {toast.text}
    </div>
  );
}
