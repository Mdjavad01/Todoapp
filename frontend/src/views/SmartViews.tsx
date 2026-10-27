import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { TaskCard, CompletedRow } from '@/components/TaskCard';
import { useAppStore } from '@/store/useAppStore';
import { myDayTasks, starredPending, plannedSections, allPendingByList } from '@/lib/selectors';
import { toFa, relativeDayLabel, faFullDate, faShort, parseIsoDate } from '@/lib/format';
import type { TaskEntity, ListEntity } from '@/types';

/**
 * فاز ۳ — چهار نمای هوشمند واقعی (مطابق الگوی رفتاری Microsoft To Do):
 *   «روزهای من» / «مهم» / «برنامه‌ریزی‌شده» / «همه‌ی کارها»
 * همه از سِلکتورهای خالص lib/selectors.ts تغذیه می‌شوند و TaskCard مشترک دارند.
 */

/* ---------------- قاب مشترک نمای هوشمند ---------------- */

function SmartShell({
  id,
  title,
  subtitle,
  count,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}) {
  const goHome = useAppStore((s) => s.goHome);
  return (
    <section className="p-margin flex flex-col gap-4" id={id}>
      <div className="bg-primary/10 dark:bg-primary/20 p-4 rounded-2xl flex flex-col gap-2 border border-primary/20">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 rounded-full bg-surface dark:bg-slate-700 flex items-center justify-center text-on-surface"
              onClick={goHome}
              aria-label="بازگشت به خانه"
            >
              <Icon name="arrow_forward" size={18} />
            </button>
            <h2 className="text-headline-md font-bold text-on-surface dark:text-inverse-on-surface">{title}</h2>
          </div>
          <span className="px-3 py-1 bg-primary/15 text-primary text-label-md font-bold rounded-full">
            {toFa(count)} کار
          </span>
        </div>
        <p className="text-body-sm text-on-surface-variant">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

/** فهرست کارها + آکاردئون انجام‌شده‌ها (مشترک بین نماها) */
function SmartTaskList({ pending, completed }: { pending: TaskEntity[]; completed: TaskEntity[] }) {
  const subtasks = useAppStore((s) => s.subtasks);
  const [expanded, setExpanded] = useState(false);

  if (pending.length === 0 && completed.length === 0) return null;

  return (
    <>
      {pending.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {pending.map((t) => {
            const subs = subtasks.filter((s) => s.taskId === t.id && !s.deletedAt);
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
      ) : null}

      {completed.length > 0 ? (
        <div className="border-t border-outline-variant/40 pt-3">
          <button
            className="flex justify-between items-center w-full text-label-md font-bold text-on-surface-variant py-2"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <span className="flex items-center gap-1.5">
              <span>انجام‌شده‌ها</span>
              <span className="bg-surface-container dark:bg-slate-700 px-2 py-0.5 rounded-full text-xs">
                {toFa(completed.length)}
              </span>
            </span>
            <span
              className="transition-transform duration-200 inline-flex"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <Icon name="expand_more" size={22} />
            </span>
          </button>
          {expanded ? (
            <div className="flex flex-col gap-2 pt-2">
              {completed.map((t) => (
                <CompletedRow
                  key={t.id}
                  title={t.title}
                  when={relativeDayLabel((t.completedAt ?? '').slice(0, 10), new Date())}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** حالت خالی مشترک */
function SmartEmpty({ emoji, title, hint }: { emoji: string; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-12">
      <div className="w-20 h-20 rounded-full bg-primary-container/15 flex items-center justify-center text-4xl mb-1">
        {emoji}
      </div>
      <h3 className="text-headline-sm font-bold text-on-surface dark:text-inverse-on-surface">{title}</h3>
      <p className="text-body-sm text-on-surface-variant max-w-[260px] leading-relaxed">{hint}</p>
    </div>
  );
}

function completedOf(tasks: TaskEntity[], ids: Set<string>): TaskEntity[] {
  return tasks
    .filter((t) => ids.has(t.id) && t.completedAt)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

/* ---------------- ۱) روزهای من ---------------- */

export function MyDayView() {
  const tasks = useAppStore((s) => s.tasks);
  const myDayIds = useAppStore((s) => s.myDayIds);
  const addMyDayTask = useAppStore((s) => s.addMyDayTask);
  const [quick, setQuick] = useState('');
  const today = new Date();

  const pending = useMemo(() => myDayTasks(tasks, myDayIds, today).filter((t) => !t.completedAt), [tasks, myDayIds]);
  const completed = useMemo(() => {
    const todayIso = toIso(today);
    return myDayTasks(tasks, myDayIds, today).filter(
      (t) => t.completedAt && (t.completedAt ?? '').slice(0, 10) === todayIso,
    );
  }, [tasks, myDayIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!quick.trim()) return;
    void addMyDayTask(quick);
    setQuick('');
  };

  return (
    <SmartShell id="view-myday" title="روزهای من" subtitle={faFullDate(today)} count={pending.length}>
      {/* افزودن دستی — کار بی‌تاریخ فقط همین‌جا می‌ماند (قاعده هرس: فردا می‌رود مگر تکمیل نشده) */}
      <div className="p-2 bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/40 flex items-center gap-2 shadow-sm">
        <input
          className="flex-1 bg-transparent border-0 text-body-sm text-on-surface dark:text-inverse-on-surface focus:ring-0 placeholder:text-outline outline-none px-2"
          placeholder="افزودن به روزهای من..."
          type="text"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="افزودن سریع به روزهای من"
        />
        <button
          className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-sm active:scale-95"
          onClick={submit}
          disabled={!quick.trim()}
          aria-label="افزودن"
        >
          <Icon name="arrow_back" size={20} />
        </button>
      </div>

      {pending.length === 0 && completed.length === 0 ? (
        <SmartEmpty emoji="☀️" title="روز پاکی است!" hint="کارهای امروز این‌جا جمع می‌شوند: هر کاری سررسیدش امروز باشد خودکار می‌آید و می‌توانید کار دلخواه هم اضافه کنید." />
      ) : (
        <SmartTaskList pending={pending} completed={completed} />
      )}
    </SmartShell>
  );
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ---------------- ۲) مهم (ستاره‌دار) ---------------- */

export function ImportantView() {
  const tasks = useAppStore((s) => s.tasks);
  const pending = useMemo(() => starredPending(tasks), [tasks]);
  const starredIds = useMemo(() => new Set(tasks.filter((t) => t.starred && !t.deletedAt).map((t) => t.id)), [tasks]);
  const completed = useMemo(() => completedOf(tasks, starredIds), [tasks, starredIds]);

  return (
    <SmartShell id="view-important" title="مهم" subtitle="همه‌ی کارهای ستاره‌دار — اولویت واقعی شما" count={pending.length}>
      {pending.length === 0 && completed.length === 0 ? (
        <SmartEmpty emoji="⭐" title="هنوز چیزی ستاره‌دار نشده" hint="در جزئیات هر کار، ستاره را بزنید تا این‌جا جمع شود — مهم‌ترین‌هایتان همیشه یک‌دست‌رس است." />
      ) : (
        <SmartTaskList pending={pending} completed={completed} />
      )}
    </SmartShell>
  );
}

/* ---------------- ۳) برنامه‌ریزی‌شده ---------------- */

export function PlannedView() {
  const tasks = useAppStore((s) => s.tasks);
  const today = new Date();
  const sections = useMemo(() => plannedSections(tasks, today), [tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = sections.overdue.length + sections.today.length + sections.upcoming.length;
  const datedIds = useMemo(
    () => new Set(tasks.filter((t) => !t.deletedAt && t.dueDate !== null).map((t) => t.id)),
    [tasks],
  );
  const completed = useMemo(() => completedOf(tasks, datedIds).slice(0, 30), [tasks, datedIds]);

  return (
    <SmartShell id="view-planned" title="برنامه‌ریزی‌شده" subtitle="همه‌ی کارهای تاریخ‌دار به ترتیب سررسید" count={total}>
      {total === 0 && completed.length === 0 ? (
        <SmartEmpty emoji="📅" title="هیچ کارِ تاریخ‌داری نیست" hint="هنگام افزودن کار، تاریخ سررسید بگذارید (مثال: «فردا گزارش را بفرست») تا این‌جا مرتب دیده شود." />
      ) : (
        <>
          {sections.overdue.length > 0 ? (
            <TaskSection title="معوقه" accent="text-red-600 dark:text-red-300" tasks={sections.overdue} />
          ) : null}
          {sections.today.length > 0 ? <TaskSection title="امروز" accent="text-primary" tasks={sections.today} /> : null}
          {sections.upcoming.length > 0 ? <TaskSection title="آینده" accent="text-on-surface-variant" tasks={sections.upcoming} /> : null}
          {completed.length > 0 ? (
            <CompletedAccordion title="انجام‌شده‌های تاریخ‌دار" completed={completed} />
          ) : null}
        </>
      )}
    </SmartShell>
  );
}

function TaskSection({ title, accent, tasks }: { title: string; accent: string; tasks: TaskEntity[] }) {
  const subtasks = useAppStore((s) => s.subtasks);
  return (
    <div className="flex flex-col gap-2.5">
      <span className={`text-label-md font-bold flex items-center gap-1.5 ${accent}`}>
        <Icon name="event_note" size={15} />
        {title}
        <span className="text-outline font-semibold">({toFa(tasks.length)})</span>
      </span>
      {tasks.map((t) => {
        const subs = subtasks.filter((s) => s.taskId === t.id && !s.deletedAt);
        return (
          <TaskCard key={t.id} task={t} subtaskCount={subs.length} subtaskDone={subs.filter((s) => s.done).length} />
        );
      })}
    </div>
  );
}

function CompletedAccordion({ title, completed }: { title: string; completed: TaskEntity[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-t border-outline-variant/40 pt-3">
      <button
        className="flex justify-between items-center w-full text-label-md font-bold text-on-surface-variant py-2"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5">
          <span>{title}</span>
          <span className="bg-surface-container dark:bg-slate-700 px-2 py-0.5 rounded-full text-xs">{toFa(completed.length)}</span>
        </span>
        <span
          className="transition-transform duration-200 inline-flex"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <Icon name="expand_more" size={22} />
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-2 pt-2">
          {completed.map((t) => (
            <CompletedRow
              key={t.id}
              title={t.title}
              when={`${relativeDayLabel((t.completedAt ?? '').slice(0, 10), new Date())}${t.dueDate ? ` • ${faShort(parseIsoDate(t.dueDate))}` : ''}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- ۴) همه‌ی کارها ---------------- */

export function AllView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const openList = useAppStore((s) => s.openList);
  const groups = useMemo(() => allPendingByList(tasks, lists), [tasks, lists]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.tasks.length, 0), [groups]);
  const liveIds = useMemo(() => new Set(lists.filter((l) => !l.deletedAt).map((l) => l.id)), [lists]);
  const completed = useMemo(
    () => tasks.filter((t) => t.completedAt && liveIds.has(t.listId)).slice(0, 30),
    [tasks, liveIds],
  );

  return (
    <SmartShell id="view-all" title="همه‌ی کارها" subtitle="ناتمام‌های همه‌ی لیست‌ها، گروه‌بندی‌شده" count={total}>
      {total === 0 ? (
        <SmartEmpty emoji="🗂️" title="هیچ کارِ ناتمامی ندارید" hint="از دکمه‌ی + یا نوار افزودن سریع پایین صفحه، اولین کارتان را بسازید." />
      ) : (
        groups.map((g) => <ListGroupBlock key={g.list.id} list={g.list} tasks={g.tasks} onOpen={openList} />)
      )}
      {total === 0 && completed.length > 0 ? <CompletedAccordion title="انجام‌شده‌ها" completed={completed} /> : null}
    </SmartShell>
  );
}

function ListGroupBlock({
  list,
  tasks,
  onOpen,
}: {
  list: ListEntity;
  tasks: TaskEntity[];
  onOpen(id: string): void;
}) {
  const subtasks = useAppStore((s) => s.subtasks);
  return (
    <div className="flex flex-col gap-2.5">
      <button
        className="text-label-md font-bold text-on-surface-variant flex items-center gap-1.5 text-right"
        onClick={() => onOpen(list.id)}
        aria-label={`بازکردن لیست ${list.name}`}
      >
        <span>{list.emoji}</span>
        <span>{list.name}</span>
        <span className="text-outline font-semibold">({toFa(tasks.length)})</span>
        <Icon name="arrow_back" size={14} className="text-outline" />
      </button>
      {tasks.map((t) => {
        const subs = subtasks.filter((s) => s.taskId === t.id && !s.deletedAt);
        return (
          <TaskCard key={t.id} task={t} subtaskCount={subs.length} subtaskDone={subs.filter((s) => s.done).length} />
        );
      })}
    </div>
  );
}
