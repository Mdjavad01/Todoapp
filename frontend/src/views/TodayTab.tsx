import { useMemo } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { homeStats, myDayTasks } from '@/lib/selectors';
import { traderListIdSet } from '@/db/traderTemplate';
import { toFa, faFullDate, weekdayName } from '@/lib/format';
import { SmartTaskList, SmartEmpty } from '@/views/SmartViews';

/**
 * فاز الف — تب «امروز» (ناوبری ۵تبی): همان «روزهای من» + کارت «برنامه‌ی امروز»
 * که از خانه به این‌جا منتقل شد (تعداد/درصد پیشرفت) + هشدار معوقه‌ها.
 * افزودن کار فقط با نوار پایین‌ثابت (QuickBar) — کار تازه به «روزهای من» پین می‌شود.
 *
 * بسته A (خلوت‌سازی UX): کارت «برنامه‌ی امروز» تا وقتی داده‌ی امروز وجود ندارد مخفی است و
 * جمله‌ی هاردکد «تمرکز روی پروژه‌های اصلی» حذف شد؛ ردیف افزودنِ داخل صفحه هم حذف شد (تک‌نوار QuickBar).
 */
export function TodayTab() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const myDayIds = useAppStore((s) => s.myDayIds);
  const moveOverdueToToday = useAppStore((s) => s.moveOverdueToToday);
  const today = new Date();

  // v1.13.0 — معوقه‌های چک‌لیست تریدر در هشدار این تب نمی‌آیند (روتین بازار، مدیریت خودش را دارد)
  const traderIds = useMemo(() => traderListIdSet(lists), [lists]);
  const stats = homeStats(tasks, today, traderIds);
  const overdue = stats.overdue;

  const pending = useMemo(() => myDayTasks(tasks, myDayIds, today).filter((t) => !t.completedAt), [tasks, myDayIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const completed = useMemo(() => {
    const todayIso = toIso(today);
    return myDayTasks(tasks, myDayIds, today).filter(
      (t) => t.completedAt && (t.completedAt ?? '').slice(0, 10) === todayIso,
    );
  }, [tasks, myDayIds]); // eslint-disable-line react-hooks/exhaustive-deps

  /* بسته A — کارت «برنامه‌ی امروز» فقط با داده‌ی واقعی همین تب:
     مبنای عدد = همان لیست پایین صفحه (کارهای سررسید-امروز + پین‌شده‌های «روزهای من»)؛
     بدون داده ⇒ کارت کلاً مخفی (صفرِ بی‌معنا و جمله‌ی هاردکد حذف شد). */
  const listTotal = pending.length + completed.length;
  const listPct = listTotal === 0 ? 0 : Math.round((completed.length / listTotal) * 100);

  return (
    <section className="p-margin flex flex-col gap-4" id="view-myday">
      {/* عنوان صفحه — کاربر همیشه بداند کجاست */}
      <div className="flex justify-between items-center">
        <h1 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">امروز</h1>
        <span className="text-body-sm text-on-surface-variant">
          {weekdayName(today)} • {faFullDate(today)}
        </span>
      </div>

      {/* کارت قهرمان پیشرفت امروز — از خانه به این‌جا منتقل شد (فاز الف) */}
      {/* بسته A — تا وقتی «برنامه‌ی امروز» داده‌ای ندارد مخفی است (صفرِ بی‌معنا نشان داده نمی‌شود) */}
      {listTotal > 0 ? (
      <div
        className="bg-gradient-to-l from-primary via-primary-container to-primary-deep text-on-primary rounded-2xl p-4 shadow-md relative overflow-hidden"
        id="today-progress"
      >
        <div className="absolute -left-6 -bottom-6 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5">
            <Icon name="flag" size={20} />
            <span className="text-headline-sm font-headline-sm">برنامه‌ی امروز</span>
          </div>
          <span className="text-label-lg font-bold bg-white/20 px-2 py-0.5 rounded-full">
            {toFa(listPct)}٪ تکمیل
          </span>
        </div>
        <p className="text-body-sm opacity-90 mb-3">
          {toFa(pending.length)} از {toFa(listTotal)} کار مانده
        </p>
        <div className="w-full bg-black/20 h-2.5 rounded-full overflow-hidden p-0.5">
          <div
            className="bg-primary-fixed h-full rounded-full transition-all duration-700"
            style={{ width: `${listPct}%` }}
          />
        </div>
      </div>
      ) : null}

      {/* هشدار کارهای معوقه — از نمای «برنامه امروز» قبلی حفظ شد */}
      {overdue.length > 0 ? (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3.5 rounded-2xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Icon name="warning" size={24} className="text-red-600" />
            <div>
              <h4 className="text-label-md font-bold text-red-800 dark:text-red-200">
                {toFa(overdue.length)} کار معوقه از قبل
              </h4>
              <p className="text-body-sm text-red-600 dark:text-red-300">
                {overdue
                  .slice(0, 3)
                  .map((t) => t.title)
                  .join(' • ')}
              </p>
            </div>
          </div>
          <button
            className="px-2.5 py-1 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm shrink-0 active:scale-95 transition-transform"
            onClick={() => void moveOverdueToToday()}
          >
            انتقال به امروز
          </button>
        </div>
      ) : null}

      {pending.length === 0 && completed.length === 0 ? (
        <SmartEmpty
          emoji="☀️"
          title="روز پاکی است!"
          hint="هر کاری سررسیدش امروز باشد خودکار این‌جا می‌آید؛ از نوار پایین هم می‌توانی کاری را به امروز اضافه کنی."
        />
      ) : (
        <SmartTaskList pending={pending} completed={completed} />
      )}
    </section>
  );
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
