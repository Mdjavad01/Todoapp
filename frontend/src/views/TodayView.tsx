import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { homeStats, weekBars as weekBarsOf, weekCompletionRate, currentStreak } from '@/lib/selectors';
import { toFa, faShort, weekdayName } from '@/lib/format';
import type { TaskEntity } from '@/types';
import { InlineEmpty } from './ListView';

const TEXT_COLORS: Record<string, string> = {
  teal: 'text-teal-600 dark:text-teal-300',
  amber: 'text-amber-500 dark:text-amber-300',
  indigo: 'text-indigo-600 dark:text-indigo-300',
  emerald: 'text-emerald-600 dark:text-emerald-300',
  rose: 'text-rose-500 dark:text-rose-300',
  purple: 'text-purple-600 dark:text-purple-300',
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
            const color = list ? TEXT_COLORS[list.color] : 'text-teal-600 dark:text-teal-300';
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

/** تحلیل عمقی بهره‌وری (v16 — ویژگی کاربران پرو) — کاملاً آفلاین از داده‌ی خود کاربر */
export interface DeepAnalysis {
  enough: boolean;
  peakHourLabel: string;
  peakHourCount: number;
  bestDayLabel: string;
  bestDayCount: number;
  trendPct: number | null; // اختلاف نرخ تکمیل این هفته نسبت به هفته قبل
  dailyAvg: number;
}

const HOUR_BUCKETS: Array<{ label: string; from: number; to: number }> = [
  { label: 'بامداد (۰ تا ۶)', from: 0, to: 5 },
  { label: 'صبح (۶ تا ۱۲)', from: 6, to: 11 },
  { label: 'بعدازظهر (۱۲ تا ۱۸)', from: 12, to: 17 },
  { label: 'عصر (۱۸ تا ۲۱)', from: 18, to: 20 },
  { label: 'شب (۲۱ تا ۲۴)', from: 21, to: 23 },
];

export function deepAnalysis(tasks: TaskEntity[], today: Date): DeepAnalysis {
  const done = tasks.filter((t) => t.completedAt);
  const nowMs = today.getTime();
  const inLast = (iso: string, days: number): boolean => {
    const d = new Date(iso).getTime();
    return !isNaN(d) && d <= nowMs && d >= nowMs - days * 86400000;
  };

  // ساعات اوج تمرکز — سطل‌های ۳۰ روز اخیر
  const buckets = HOUR_BUCKETS.map(() => 0);
  for (const t of done) {
    if (!inLast(t.completedAt as string, 30)) continue;
    const h = new Date(t.completedAt as string).getHours();
    const idx = HOUR_BUCKETS.findIndex((b) => h >= b.from && h <= b.to);
    if (idx >= 0) buckets[idx] += 1;
  }
  const peakIdx = buckets.indexOf(Math.max(...buckets));
  const peakCount = buckets[peakIdx] ?? 0;

  // بهترین روز هفته — ۳۰ روز اخیر
  const dayCounts = new Array(7).fill(0) as number[]; // ۰=شنبه (شمسی)
  for (const t of done) {
    if (!inLast(t.completedAt as string, 30)) continue;
    dayCounts[(new Date(t.completedAt as string).getDay() + 1) % 7] += 1;
  }
  const dayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
  const bestDay = dayCounts.indexOf(Math.max(...dayCounts));

  // روند هفتگی — نرخ تکمیل ۷ روز اخیر نسبت به ۷ روز قبلش
  const rateOf = (fromDays: number, toDays: number): { done: number; total: number } => {
    let d = 0;
    let tot = 0;
    for (const t of tasks) {
      const created = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
      if (isNaN(created)) continue;
      if (created > nowMs - fromDays * 86400000 || created <= nowMs - toDays * 86400000) continue;
      tot += 1;
      if (t.completedAt) d += 1;
    }
    return { done: d, total: tot };
  };
  const cur = rateOf(7, 0);
  const prev = rateOf(14, 7);
  const trendPct =
    cur.total >= 3 && prev.total >= 3
      ? Math.round(((cur.done / cur.total - prev.done / prev.total) * 100) / 1)
      : null;

  // میانگین روزانه — ۱۴ روز اخیر
  let avgDays = 0;
  for (const t of done) {
    if (inLast(t.completedAt as string, 14)) avgDays += 1;
  }

  return {
    enough: done.length >= 5,
    peakHourLabel: HOUR_BUCKETS[peakIdx]?.label ?? '—',
    peakHourCount: peakCount,
    bestDayLabel: dayNames[bestDay] ?? '—',
    bestDayCount: dayCounts[bestDay] ?? 0,
    trendPct,
    dailyAvg: Math.round((avgDays / 14) * 10) / 10,
  };
}

/** بخش ۸: آمار و عملکرد */
export function AnalyticsView() {
  const tasks = useAppStore((s) => s.tasks);
  const premium = useAppStore((s) => s.premium);
  const setView = useAppStore((s) => s.setView);
  const today = new Date();
  const bars = weekBarsOf(tasks, today);
  const rate = weekCompletionRate(tasks, today);
  const streak = currentStreak(tasks, today);
  const isPro = premium.loaded && premium.isPremium;
  const deep = deepAnalysis(tasks, today);

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

      {/* تحلیل عمقی بهره‌وری — برای کاربر پرو پنل واقعی است (v16) */}
      {isPro ? (
        <div className="bg-gradient-to-br from-secondary/10 to-secondary/5 dark:from-secondary/15 dark:to-secondary/5 border border-secondary/30 p-4 rounded-2xl shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="bar_chart" size={22} className="text-secondary" />
              <h4 className="text-label-lg font-bold text-secondary">تحلیل عمقی بهره‌وری</h4>
            </div>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-secondary text-white">پرو فعال</span>
          </div>
          {deep.enough ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] text-on-surface-variant">ساعات اوج تمرکز شما</span>
                <span className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface">{deep.peakHourLabel}</span>
                <span className="text-[10px] text-on-surface-variant">{toFa(deep.peakHourCount)} تکمیل در ۳۰ روز اخیر</span>
              </div>
              <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] text-on-surface-variant">مولدترین روز هفته</span>
                <span className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface">{deep.bestDayLabel}</span>
                <span className="text-[10px] text-on-surface-variant">{toFa(deep.bestDayCount)} تکمیل در ۳۰ روز اخیر</span>
              </div>
              <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] text-on-surface-variant">روند هفتگی</span>
                {deep.trendPct === null ? (
                  <span className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface">در حال جمع‌آوری</span>
                ) : (
                  <span className={`text-label-lg font-black ${deep.trendPct >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
                    {deep.trendPct >= 0 ? '▲' : '▼'} {toFa(Math.abs(deep.trendPct))}٪
                  </span>
                )}
                <span className="text-[10px] text-on-surface-variant">نسبت به هفته قبل</span>
              </div>
              <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] text-on-surface-variant">میانگین روزانه</span>
                <span className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface">{toFa(deep.dailyAvg)} کار</span>
                <span className="text-[10px] text-on-surface-variant">میانگین ۱۴ روز اخیر</span>
              </div>
            </div>
          ) : (
            <p className="text-body-sm text-on-surface-variant leading-6">
              برای تحلیل دقیق‌تر، چند کار دیگر را کامل کنید — ساعات اوج تمرکز، بهترین روز هفته و روند شما اینجا خودکار ساخته می‌شود.
            </p>
          )}
        </div>
      ) : (
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
      )}
    </section>
  );
}
