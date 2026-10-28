import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { TaskCard } from '@/components/TaskCard';
import { useAppStore } from '@/store/useAppStore';
import { plannerSections } from '@/lib/selectors';
import { toFa, faShort, toIsoDate, startOfDay, parseIsoDate } from '@/lib/format';
import { toJalali, JALALI_MONTHS, WEEK_HEADER, jalaliWeekday } from '@/lib/jalali';
import { TaskSection, CompletedAccordion, SmartEmpty } from '@/views/SmartViews';
import type { TaskEntity } from '@/types';

/**
 * فاز الف — تب «پلنر» (ناوبری ۵تبی): همه‌ی کارهای دارای سررسید، گروه‌بندی‌شده به
 * عقب‌افتاده / امروز / فردا / این هفته / بعداً — با نوار تقویم شمسی کوچک بالا برای
 * پرش به یک روز خاص. داده و مرتب‌سازی از سِلکتور خالص plannerSections می‌آید.
 */
export function PlannerView() {
  const tasks = useAppStore((s) => s.tasks);
  const subtasks = useAppStore((s) => s.subtasks);
  const [selected, setSelected] = useState<string | null>(null);
  const today = new Date();
  const todayIso = toIsoDate(today);

  const subtasksOf = (taskId: string) => subtasks.filter((s) => s.taskId === taskId && !s.deletedAt);

  const sections = useMemo(() => plannerSections(tasks, today), [tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = sections.overdue.length + sections.today.length + sections.tomorrow.length + sections.thisWeek.length + sections.later.length;

  /* نوار تقویم شمسی: از ۷ روز قبل تا ۲۱ روز بعد + نقطه‌ی کارهای همان روز */
  const stripDays = useMemo(() => {
    const days: { iso: string; letter: string; jd: number; month: string; isToday: boolean; count: number }[] = [];
    const pendingDated = tasks.filter((t) => !t.deletedAt && !t.completedAt && t.dueDate !== null);
    for (let i = -7; i <= 21; i++) {
      const d = startOfDay(today);
      d.setDate(d.getDate() + i);
      const iso = toIsoDate(d);
      const j = toJalali(d);
      days.push({
        iso,
        letter: WEEK_HEADER[jalaliWeekday(d)],
        jd: j.jd,
        month: JALALI_MONTHS[j.jm - 1],
        isToday: iso === todayIso,
        count: pendingDated.filter((t) => t.dueDate === iso).length,
      });
    }
    return days;
  }, [tasks, todayIso]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTasks: TaskEntity[] = useMemo(
    () =>
      selected
        ? tasks
            .filter((t) => !t.deletedAt && !t.completedAt && t.dueDate === selected)
            .sort(
              (a, b) =>
                (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') ||
                a.createdAt.localeCompare(b.createdAt) ||
                a.id.localeCompare(b.id),
            )
        : [],
    [tasks, selected],
  );

  const datedIds = useMemo(
    () => new Set(tasks.filter((t) => !t.deletedAt && t.dueDate !== null).map((t) => t.id)),
    [tasks],
  );
  const completed = useMemo(
    () =>
      tasks
        .filter((t) => datedIds.has(t.id) && t.completedAt)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, 30),
    [tasks, datedIds],
  );

  return (
    <section className="p-margin flex flex-col gap-4" id="view-planned">
      <div className="flex justify-between items-center">
        <h1 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">پلنر</h1>
        <span className="text-body-sm text-on-surface-variant">
          {total > 0 ? `${toFa(total)} کار تاریخ‌دار` : 'بدون کار تاریخ‌دار'}
        </span>
      </div>

      {/* نوار تقویم شمسی کوچک — پرش به روز */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-margin px-margin" role="listbox" aria-label="نوار تقویم شمسی">
        {stripDays.map((d) => {
          const active = selected === d.iso;
          return (
            <button
              key={d.iso}
              role="option"
              aria-selected={active}
              aria-label={`${d.jd} ${d.month}${d.count > 0 ? ` — ${toFa(d.count)} کار` : ''}`}
              className={`shrink-0 w-12 min-h-[56px] py-1.5 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active
                  ? 'bg-primary text-on-primary border-primary shadow-sm'
                  : d.isToday
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-surface-container-lowest dark:bg-slate-800 border-outline-variant/30 text-on-surface dark:text-inverse-on-surface'
              }`}
              onClick={() => setSelected(active ? null : d.iso)}
            >
              <span className="text-[10px] leading-none opacity-80">{d.letter}</span>
              <span className="text-[15px] font-bold leading-none">{toFa(d.jd)}</span>
              <span className={`text-[9px] leading-none ${active ? 'opacity-90' : 'text-outline'}`}>
                {d.jd === 1 ? d.month : ' '}
              </span>
              {d.count > 0 ? (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-on-primary' : 'bg-primary'}`}
                  aria-hidden="true"
                />
              ) : (
                <span className="w-1.5 h-0.5" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {selected ? (
        /* نمای روز انتخاب‌شده از نوار تقویم */
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-label-md font-bold text-primary flex items-center gap-1.5">
              <Icon name="event_note" size={16} />
              کارهای {faShort(parseIsoDate(selected))}
            </span>
            <button
              className="text-xs font-bold text-on-surface-variant flex items-center gap-1"
              onClick={() => setSelected(null)}
              aria-label="پاک کردن فیلتر روز"
            >
              <Icon name="close" size={14} />
              همه‌ی روزها
            </button>
          </div>
          {selectedTasks.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant text-center py-6">کاری برای این روز نیست.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {selectedTasks.map((t) => {
                const subs = subtasksOf(t.id);
                return (
                  <TaskCard
                    key={t.id}
                    task={t}
                    subtaskCount={subs.length}
                    subtaskDone={subs.filter((s) => s.done).length}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : total === 0 && completed.length === 0 ? (
        <SmartEmpty
          emoji="📅"
          title="هیچ کارِ تاریخ‌داری نیست"
          hint="هنگام افزودن کار، تاریخ سررسید بگذارید (مثال: «فردا گزارش را بفرست») تا این‌جا مرتب دیده شود."
        />
      ) : (
        <>
          {sections.overdue.length > 0 ? (
            <TaskSection title="عقب‌افتاده" accent="text-red-600 dark:text-red-300" tasks={sections.overdue} />
          ) : null}
          {sections.today.length > 0 ? (
            <TaskSection title="امروز" accent="text-primary" tasks={sections.today} />
          ) : null}
          {sections.tomorrow.length > 0 ? (
            <TaskSection title="فردا" accent="text-on-surface" tasks={sections.tomorrow} />
          ) : null}
          {sections.thisWeek.length > 0 ? (
            <TaskSection title="این هفته" accent="text-on-surface-variant" tasks={sections.thisWeek} />
          ) : null}
          {sections.later.length > 0 ? (
            <TaskSection title="بعداً" accent="text-on-surface-variant" tasks={sections.later} />
          ) : null}
          {total === 0 && completed.length > 0 ? (
            <p className="text-body-sm text-on-surface-variant text-center py-4">همه‌ی کارهای تاریخ‌دار انجام شده‌اند ✨</p>
          ) : null}
          {completed.length > 0 ? <CompletedAccordion title="انجام‌شده‌های تاریخ‌دار" completed={completed} /> : null}
        </>
      )}
    </section>
  );
}
