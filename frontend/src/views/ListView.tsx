import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { MicButton } from '@/components/Sheet';
import { TaskCard, CompletedRow } from '@/components/TaskCard';
import { useAppStore } from '@/store/useAppStore';
import { listProgress, sortTasks, LIST_SORTS } from '@/lib/selectors';
import { useDragSort } from '@/lib/dragSort';
import { toFa, relativeDayLabel } from '@/lib/format';
import type { TaskEntity } from '@/types';

type ListFilter = 'all' | 'urgent' | 'done';

/** بخش ۳: نمای لیست — با فیلتر، مرتب‌سازی پنج‌حالته‌ی به‌یادماندنی (فاز ۲)، آکاردئون انجام‌شده‌ها و افزودن سریع */
export function ListView() {
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const subtasks = useAppStore((s) => s.subtasks);
  const activeListId = useAppStore((s) => s.activeListId);
  const goHome = useAppStore((s) => s.goHome);
  const setView = useAppStore((s) => s.setView);
  const addInlineTask = useAppStore((s) => s.addInlineTask);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const completedExpanded = useAppStore((s) => s.completedExpanded);
  const toggleCompletedAccordion = useAppStore((s) => s.toggleCompletedAccordion);
  const openEditList = useAppStore((s) => s.openEditList);
  // فاز ۲ — ترتیب به‌یادماندنی هر لیست + ترتیب دستی کارها
  const listSorts = useAppStore((s) => s.listSorts);
  const setListSort = useAppStore((s) => s.setListSort);
  const taskOrders = useAppStore((s) => s.taskOrders);
  const setTaskOrder = useAppStore((s) => s.setTaskOrder);

  const [quickValue, setQuickValue] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const list = lists.find((l) => l.id === activeListId) ?? lists[0];
  const sortKey = list ? (listSorts[list.id] ?? 'importance') : 'importance';

  const listTasks = useMemo(() => tasks.filter((t) => t.listId === list?.id), [tasks, list]);
  const pending = useMemo(
    () =>
      sortTasks(
        listTasks
          .filter((t) => !t.completedAt)
          .filter((t) => (filter === 'urgent' ? t.priority === 'urgent' || t.priority === 'high' : true)),
        sortKey,
        list ? (taskOrders[list.id] ?? []) : [],
      ),
    [listTasks, filter, sortKey, list, taskOrders],
  );
  const completed = useMemo(
    () => listTasks.filter((t) => t.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [listTasks],
  );
  const progress = listProgress(tasks, list?.id ?? '');

  /* مرتب‌سازی دستی — کشیدنی فقط در حالت «دستی» (فاز ۲) */
  const manualIds = useMemo(() => pending.map((t) => t.id), [pending]);
  const drag = useDragSort(manualIds, (next) => {
    if (list) setTaskOrder(list.id, next);
  });
  const manual = sortKey === 'manual' && pending.length > 1;

  if (!list) {
    return (
      <section className="p-margin flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-body-md text-on-surface-variant">هنوز لیستی ندارید.</p>
      </section>
    );
  }

  const submitInline = () => {
    if (!quickValue.trim()) return;
    addInlineTask(list.id, quickValue);
    setQuickValue('');
  };

  const pendingSorted: TaskEntity[] = manual ? (drag.order.map((id) => pending.find((t) => t.id === id)!).filter(Boolean) as TaskEntity[]) : pending;

  return (
    <section className="p-margin flex flex-col gap-4" id="view-listView">
      {/* سربرگ لیست */}
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
            <h2 className="text-headline-md font-bold text-on-surface dark:text-inverse-on-surface">
              {list.emoji} {list.name}
            </h2>
          </div>
          <div className="flex items-center gap-1 text-on-surface-variant">
            {/* مرتب‌سازی (فاز ۲) */}
            <button
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                sortOpen ? 'bg-primary/20 text-primary' : 'hover:bg-white/50 dark:hover:bg-white/10'
              }`}
              onClick={() => {
                setSortOpen(!sortOpen);
                setFilterOpen(false);
              }}
              title="مرتب‌سازی"
              aria-label="مرتب‌سازی کارها"
              aria-expanded={sortOpen}
            >
              <Icon name="sort" size={20} />
            </button>
            <button
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                filterOpen ? 'bg-primary/20 text-primary' : 'hover:bg-white/50 dark:hover:bg-white/10'
              }`}
              onClick={() => {
                setFilterOpen(!filterOpen);
                setSortOpen(false);
              }}
              title="فیلتر"
              aria-label="فیلتر"
              aria-expanded={filterOpen}
            >
              <Icon name="filter_list" size={20} />
            </button>
            <button
              className="w-8 h-8 rounded-full hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center"
              onClick={() => openEditList(list.id)}
              title="ویرایش لیست"
              aria-label="ویرایش لیست"
            >
              <Icon name="edit" size={19} />
            </button>
            <button
              className="w-8 h-8 rounded-full hover:bg-white/50 dark:hover:bg-white/10 flex items-center justify-center"
              onClick={() => setView('search')}
              title="جستجو"
              aria-label="جستجو"
            >
              <Icon name="search" size={20} />
            </button>
          </div>
        </div>
        {/* منوی مرتب‌سازی (فاز ۲) — انتخاب هر لیست به‌یادماندنی است */}
        {sortOpen ? (
          <div className="flex gap-1.5 flex-wrap pt-1" role="radiogroup" aria-label="ترتیب نمایش کارها">
            {LIST_SORTS.map((s) => (
              <button
                key={s.key}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors ${
                  sortKey === s.key ? 'bg-primary text-on-primary' : 'bg-white/60 dark:bg-slate-700 text-on-surface-variant'
                }`}
                onClick={() => {
                  setListSort(list.id, s.key);
                  setSortOpen(false);
                }}
                role="radio"
                aria-checked={sortKey === s.key}
              >
                {s.label}
                {s.key === 'manual' ? ' (کشیدن)' : ''}
              </button>
            ))}
          </div>
        ) : null}
        {filterOpen ? (
          <div className="flex gap-1.5 flex-wrap pt-1">
            {(
              [
                { key: 'all', label: 'همه' },
                { key: 'urgent', label: 'فوری' },
                { key: 'done', label: 'انجام‌شده' },
              ] as { key: ListFilter; label: string }[]
            ).map((f) => (
              <button
                key={f.key}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors ${
                  filter === f.key ? 'bg-primary text-on-primary' : 'bg-white/60 dark:bg-slate-700 text-on-surface-variant'
                }`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex justify-between items-center text-body-sm text-on-surface-variant">
          <span>پیشرفت این لیست</span>
          <span className="font-bold text-primary">
            {toFa(progress.pct)}٪ ({toFa(progress.done)} از {toFa(progress.total)} کار)
          </span>
        </div>
        <div className="w-full bg-surface-container dark:bg-slate-700 h-2 rounded-full overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-500"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>

      {/* کارهای در انتظار */}
      {filter !== 'done' ? (
        <div className="flex flex-col gap-2.5">
          <div className="text-label-md font-bold text-on-surface-variant">
            کارهای در حال انتظار
            {sortKey !== 'importance' ? (
              <span className="text-[11px] font-semibold text-outline mr-1.5">
                • مرتب‌شده بر اساس {LIST_SORTS.find((s) => s.key === sortKey)?.label}
              </span>
            ) : null}
          </div>
          {pendingSorted.length === 0 ? (
            <InlineEmpty />
          ) : (
            <div
              className="flex flex-col gap-2.5"
              ref={manual ? (drag.containerRef as (el: HTMLDivElement | null) => void) : undefined}
            >
              {pendingSorted.map((t) => {
                const subs = subtasks.filter((s) => s.taskId === t.id);
                return (
                  <div key={t.id} data-drag-item={manual ? '' : undefined} className={manual ? drag.itemClass(t.id) : ''}>
                    <TaskCard
                      task={t}
                      subtaskCount={subs.length}
                      subtaskDone={subs.filter((s) => s.done).length}
                      dragHandle={manual ? drag.handleProps(t.id) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* آکاردئون انجام‌شده‌ها */}
      {completed.length > 0 ? (
        <div className="border-t border-outline-variant/40 pt-3">
          <button
            className="flex justify-between items-center w-full text-label-md font-bold text-on-surface-variant py-2"
            onClick={toggleCompletedAccordion}
          >
            <span className="flex items-center gap-1.5">
              <span>کارهای انجام‌شده</span>
              <span className="bg-surface-container dark:bg-slate-700 px-2 py-0.5 rounded-full text-xs">
                {toFa(completed.length)}
              </span>
            </span>
            <span
              className="transition-transform duration-200 inline-flex"
              style={{ transform: completedExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <Icon name="expand_more" size={22} />
            </span>
          </button>
          {completedExpanded ? (
            <div className="flex flex-col gap-2 pt-2">
              {completed.map((t) => (
                <CompletedRow
                  key={t.id}
                  title={t.title}
                  when={relativeDayLabel(t.completedAt!.slice(0, 10), new Date())}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* افزودن سریع کار */}
      <div className="mt-4 p-2 bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/40 flex items-center gap-2 shadow-sm">
        <input
          className="flex-1 bg-transparent border-0 text-body-sm text-on-surface dark:text-inverse-on-surface focus:ring-0 placeholder:text-outline outline-none px-2"
          placeholder="افزودن سریع کار به این لیست..."
          type="text"
          value={quickValue}
          onChange={(e) => setQuickValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitInline()}
          aria-label="افزودن سریع کار"
        />
        <MicButton size={20} className="w-8 h-8" />
        <button
          className="w-8 h-8 rounded-full text-on-surface-variant hover:text-primary flex items-center justify-center"
          onClick={() => openCalendar('quickAdd')}
          aria-label="انتخاب تاریخ"
        >
          <Icon name="calendar_month" size={20} />
        </button>
        <button
          className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-sm active:scale-95"
          onClick={submitInline}
          aria-label="افزودن"
        >
          <Icon name="arrow_back" size={20} />
        </button>
      </div>
    </section>
  );
}
/** حالت خالی داخل لیست (بخش ۱۴ طرح) */
export function InlineEmpty() {
  const openModal = useAppStore((s) => s.openModal);
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-10">
      <div className="w-24 h-24 rounded-full bg-teal-50 dark:bg-teal-950/40 flex items-center justify-center text-primary text-4xl mb-2 animate-bounce">
        ☕
      </div>
      <h3 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">هیچ کاری برای امروز نمانده!</h3>
      <p className="text-body-sm text-on-surface-variant max-w-[260px] leading-relaxed">
        تمام وظایف تعیین‌شده با موفقیت انجام شده‌اند. وقت یک استراحت کوتاه و چای داغ است.
      </p>
      <button
        className="mt-4 px-6 py-2.5 bg-primary text-white font-bold rounded-2xl shadow-md active:scale-95 text-body-sm flex items-center gap-1.5"
        onClick={() => openModal('quickAdd')}
      >
        <Icon name="add" size={18} />
        <span>افزودن کار جدید</span>
      </button>
    </div>
  );
}
