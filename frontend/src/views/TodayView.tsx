import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { homeStats, weekBars as weekBarsOf, weekCompletionRate, currentStreak } from '@/lib/selectors';
import { toFa, faShort, weekdayName } from '@/lib/format';
import { InlineEmpty } from './ListView';

const TEXT_COLORS: Record<string, string> = {
  teal: 'text-teal-600',
  amber: 'text-amber-500',
  indigo: 'text-indigo-600',
  emerald: 'text-emerald-600',
  rose: 'text-rose-500',
  purple: 'text-purple-600',
};

const LIST_TITLES: Record<string, string> = {
  teal: 'خانه',
  amber: 'خرید',
  indigo: 'مطالعه',
  emerald: 'مالی',
  rose: 'قبوض',
  purple: 'کاری',
};

/** بخش ۷: برنامه‌ی امروز با هشدار معوقه، تایم‌لاین و پیشنهاد هوشمند */
export function TodayView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const moveOverdueToToday = useAppStore((s) => s.moveOverdueToToday);
  const setView = useAppStore((s) => s.setView);
  const today = new Date();
  const stats = homeStats(tasks, today);
  const timed = stats.todayTasks.filter((t) => !t.completedAt && t.dueTime);

  return (
    <section className="p-margin flex flex-col gap-4" id="view-todayView">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">برنامه امروز</h2>
          <p className="text-body-sm text-on-surface-variant">
            {weekdayName(today)} {faShort(today)} • تمرکز روی کارهای فوری
          </p>
        </div>
        <span className="px-3 py-1 bg-primary/10 text-primary text-label-md font-bold rounded-full">امروز</span>
      </div>

      {/* هشدار کارهای معوقه */}
      {stats.overdue.length > 0 ? (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3.5 rounded-2xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Icon name="warning" size={24} className="text-red-600" />
            <div>
              <h4 className="text-label-md font-bold text-red-800 dark:text-red-200">
                {toFa(stats.overdue.length)} کار معوقه از دیروز
              </h4>
              <p className="text-body-sm text-red-600 dark:text-red-300">
                {stats.overdue
                  .slice(0, 3)
                  .map((t) => t.title)
                  .join(' • ')}
              </p>
            </div>
          </div>
          <button
            className="px-2.5 py-1 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm shrink-0 active:scale-95 transition-transform"
            onClick={moveOverdueToToday}
          >
            انتقال به امروز
          </button>
        </div>
      ) : null}

      {/* تایم‌لاین ساعتی امروز */}
      {timed.length > 0 ? (
        <div className="flex flex-col gap-3">
          <span className="text-label-md font-bold text-on-surface-variant">زمان‌بندی امروز</span>
          {timed.map((t) => {
            const list = lists.find((l) => l.id === t.listId);
            const color = list ? TEXT_COLORS[list.color] : 'text-teal-600';
            const shortTitle = list ? LIST_TITLES[list.color] : 'کار';
            const isUrgent = t.priority === 'urgent';
            return (
              <div key={t.id} className="flex gap-3 items-start">
                <span className="text-xs font-bold text-primary w-12 pt-1 text-left shrink-0">{toFa(t.dueTime!)}</span>
                <div
                  className={`flex-1 bg-surface-container-lowest dark:bg-slate-800 p-3 rounded-xl border border-outline-variant/30 shadow-sm ${
                    isUrgent ? 'border-r-4 border-r-red-500' : ''
                  }`}
                >
                  <span className={`text-xs font-bold block ${color}`}>
                    {list?.emoji} {shortTitle}
                    {isUrgent ? ' (فوری)' : ''}
                  </span>
                  <span className="text-label-md font-bold">{t.title}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : stats.todayRemaining === 0 && stats.todayTotal > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-label-md font-bold text-on-surface-variant">زمان‌بندی امروز</span>
          <InlineEmpty />
        </div>
      ) : null}

      {/* پیشنهاد هوشمند */}
      <div className="bg-primary-container/10 p-3.5 rounded-2xl border border-primary/20 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-primary font-bold text-label-md">
          <Icon name="auto_awesome" size={18} />
          پیشنهاد هوشمند کارام
        </div>
        <p className="text-body-sm text-on-surface-variant">
          «شما معمولاً عصر چهارشنبه خرید هفتگی انجام می‌دهید. آیا چک‌لیست سوپرمارکت آماده شود؟»
        </p>
        <div className="flex justify-end gap-2 mt-1">
          <button
            className="px-3 py-1 bg-primary text-white text-xs font-bold rounded-lg active:scale-95 transition-transform"
            onClick={() => setView('templates')}
          >
            مشاهده چک‌لیست خرید
          </button>
        </div>
      </div>
    </section>
  );
}

/** بخش ۸: آمار و عملکرد */
export function AnalyticsView() {
  const tasks = useAppStore((s) => s.tasks);
  const setView = useAppStore((s) => s.setView);
  const today = new Date();
  const bars = weekBarsOf(tasks, today);
  const rate = weekCompletionRate(tasks, today);
  const streak = currentStreak(tasks, today);

  return (
    <section className="p-margin flex flex-col gap-4" id="view-analytics">
      <h2 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">آمار و عملکرد</h2>

      {/* کارت استریک */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white p-4 rounded-2xl flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🔥</span>
          <div>
            <h3 className="text-headline-sm font-bold">{toFa(streak)} روز پیاپی منظم!</h3>
            <p className="text-body-sm opacity-90">استریک شما در بالاترین رکورد ماهانه است</p>
          </div>
        </div>
        <span className="text-2xl font-black bg-white/20 px-3 py-1 rounded-xl">{toFa(streak)}</span>
      </div>

      {/* نمودار هفتگی */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 shadow-sm flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="text-label-lg font-bold">میزان انجام وظایف (هفته جاری)</span>
          <span className="text-xs text-primary font-bold">نرخ تکمیل: {toFa(rate)}٪</span>
        </div>
        <div className="h-36 flex items-end justify-between pt-6 px-2 border-b border-outline-variant/20">
          {bars.map((b) => (
            <div key={b.letter} className="flex flex-col items-center gap-1">
              <div
                className={`w-6 rounded-t-lg transition-all relative ${
                  b.isToday
                    ? 'bg-primary-fixed-dim'
                    : b.count >= 3
                      ? 'bg-primary'
                      : b.count > 0
                        ? 'bg-primary-container/40'
                        : 'bg-surface-container dark:bg-slate-700'
                }`}
                style={{ height: `${b.height}px` }}
              >
                {b.isToday ? (
                  <span className="absolute -top-4 right-0.5 text-[9px] font-bold text-primary">امروز</span>
                ) : null}
              </div>
              <span className={`text-[10px] ${b.isToday ? 'font-bold text-primary' : 'text-outline'}`}>{b.letter}</span>
            </div>
          ))}
        </div>
        <p className="text-body-sm text-center text-on-surface-variant font-semibold">
          عالی پیش رفتی! تنها ۲ کار تا ثبت رکورد این هفته فاصله داری ✨
        </p>
      </div>

      {/* کارت قفل‌شده‌ی پرو */}
      <div
        className="relative overflow-hidden bg-surface-container-high/60 dark:bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-secondary/30 flex items-center justify-between cursor-pointer"
        onClick={() => setView('paywall')}
      >
        <div className="flex items-center gap-3">
          <Icon name="lock" size={28} className="text-secondary" />
          <div>
            <h4 className="text-label-lg font-bold text-secondary">تحلیل عمقی بهره‌وری و ساعات اوج تمرکز</h4>
            <p className="text-[11px] text-on-surface-variant">مخصوص کاربران نسخه پرو کارام</p>
          </div>
        </div>
        <span className="px-2.5 py-1 bg-secondary text-white text-xs font-bold rounded-lg shadow">مشاهده</span>
      </div>
    </section>
  );
}
