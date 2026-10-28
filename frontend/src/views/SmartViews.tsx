import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { TaskCard, CompletedRow } from '@/components/TaskCard';
import { useAppStore } from '@/store/useAppStore';
import { starredPending, allPendingByList } from '@/lib/selectors';
import { toFa, relativeDayLabel, faShort, parseIsoDate } from '@/lib/format';
import type { TaskEntity, ListEntity } from '@/types';

/**
 * نمای‌های هوشمند (مطابق الگوی رفتاری Microsoft To Do):
 *   «مهم» و «همه‌ی کارها» — صفحات داخلی که از ردیف‌های خانه باز می‌شوند.
 *   «امروز» و «پلنر» به تب‌های مستقل ناوبری ۵تبی منتقل شدند (views/TodayTab و views/PlannerView).
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

/** فهرست کارها + آکاردئون انجام‌شده‌ها (مشترک بین نماها — در TodayTab هم استفاده می‌شود) */
export function SmartTaskList({ pending, completed }: { pending: TaskEntity[]; completed: TaskEntity[] }) {
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

/** حالت خالی مشترک (در TodayTab و PlannerView هم استفاده می‌شود) */
export function SmartEmpty({ emoji, title, hint }: { emoji: string; title: string; hint: string }) {
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

/* ---------------- ۱) مهم (ستاره‌دار) — صفحه‌ی داخلی از ردیف خانه ---------------- */

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

/* ---------------- ۲) برنامه‌ریزی‌شده → به تب «پلنر» منتقل شد (views/PlannerView) ---------------- */

/** بخش عنوان‌دار کارها — در PlannerView هم استفاده می‌شود */
export function TaskSection({ title, accent, tasks }: { title: string; accent: string; tasks: TaskEntity[] }) {
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

/** آکاردئون انجام‌شده‌ها — در PlannerView هم استفاده می‌شود */
export function CompletedAccordion({ title, completed }: { title: string; completed: TaskEntity[] }) {
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

/* ---------------- ۳) همه‌ی کارها — صفحه‌ی داخلی از ردیف خانه ---------------- */

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
