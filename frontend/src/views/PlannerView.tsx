import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { TaskCard, CompletedRow } from '@/components/TaskCard';
import { useAppStore } from '@/store/useAppStore';
import { traderListIdSet } from '@/db/traderTemplate';
import { sortedLists } from '@/lib/selectors';
import { toFa, toIsoDate, startOfDay, faFullDate, weekdayName, parseIsoDate } from '@/lib/format';
import { toJalali, JALALI_MONTHS, WEEK_HEADER, jalaliWeekday } from '@/lib/jalali';
import type { ListEntity, TaskEntity } from '@/types';

/**
 * v1.13.0 — بازطراحی کامل تب «پلن‌ها» (نام قبلی: پلنر) — نسخه‌ی فارسی سبک Microsoft To Do:
 *
 *  ۱) نمای روز (مثل «My Day»): پلن روزِ انتخاب‌شده با چیپ «انجام‌شده» تاشو در بالا (مثل عکس مرجع)،
 *     ردیف کارها و افزودن با نوار پایین (QuickBar به همین روز می‌نویسد — بدون تشخیص هوشمند تاریخ).
 *  ۲) پیشنهادها (مثل «Suggestions»): آیتم‌های بی‌تاریخِ باز از «پلن‌های کلی» — با + به پلنِ این روز
 *     اضافه می‌شوند (سررسید می‌گیرند) و در لیست خودشان هم می‌مانند — نمای روز، فیلترِ روی داده است،
 *     نه ظرف جدا؛ پس هیچ دوگانگی یا تداخل داده ساخته نمی‌شود.
 *  ۳) پلن‌های کلی (کتابخانه): درخت جمع‌وجورِ دسته ← پلن ← آیتم‌ها؛ دسته‌ها همان گروه‌های لیست‌های
 *     خانه‌اند (مدیریت از همان شیت‌های موجود) — چک‌لیست تریدر عمداً از این نما خارج است (کارتهای
 *     خودش را در قالب‌ها دارد) تا دیگر «پخش و پلا» دیده نشود.
 *
 * یکپارچگی: هیچ موجودیت یا موتور جدیدی ساخته نشده — همه‌چیز روی لیست/کار/گروه موجود سوار است و
 * سینک/یادآور/آمار دست‌نخورده می‌مانند.
 */
export function PlannerView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const subtasks = useAppStore((s) => s.subtasks);
  const planDay = useAppStore((s) => s.planDay);
  const setPlanDay = useAppStore((s) => s.setPlanDay);
  const moveOverdueToToday = useAppStore((s) => s.moveOverdueToToday);
  const updateTask = useAppStore((s) => s.updateTask);
  const openList = useAppStore((s) => s.openList);
  const openModal = useAppStore((s) => s.openModal);
  const showToast = useAppStore((s) => s.showToast);

  const today = new Date();
  const todayIso = toIsoDate(today);
  const selectedIso = planDay ?? todayIso;
  const isToday = selectedIso === todayIso;

  const [completedOpen, setCompletedOpen] = useState(false);
  const [suggOpen, setSuggOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // چک‌لیست تریدر از نمای «پلن‌ها» خارج است — خانه‌اش کارت تریدر در قالب‌هاست (درخواست صاحب محصول)
  const traderIds = useMemo(() => traderListIdSet(lists), [lists]);
  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);

  const dayPending = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            !t.deletedAt &&
            !traderIds.has(t.listId) &&
            t.dueDate === selectedIso &&
            !t.completedAt,
        )
        .sort(
          (a, b) =>
            (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') ||
            Number(b.starred) - Number(a.starred) ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
    [tasks, traderIds, selectedIso],
  );

  const dayCompleted = useMemo(
    () =>
      tasks
        .filter((t) => !t.deletedAt && !traderIds.has(t.listId) && t.dueDate === selectedIso && t.completedAt)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [tasks, traderIds, selectedIso],
  );

  const overdue = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            !t.deletedAt &&
            !traderIds.has(t.listId) &&
            !t.completedAt &&
            t.dueDate !== null &&
            t.dueDate < todayIso,
        )
        .sort(
          (a, b) =>
            (a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
            (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'),
        ),
    [tasks, traderIds, todayIso],
  );

  /** پیشنهادها = آیتم‌های بی‌تاریخِ باز از پلن‌های کلی (لیست‌های خود کاربر، بی‌تریدر) */
  const suggestions = useMemo(() => {
    const planLists = sortedLists(lists.filter((l) => !l.deletedAt && !traderIds.has(l.id)));
    const listOrder = new Map(planLists.map((l, i) => [l.id, i]));
    return tasks
      .filter((t) => !t.deletedAt && !traderIds.has(t.listId) && !t.completedAt && t.dueDate === null)
      .sort(
        (a, b) =>
          Number(b.starred) - Number(a.starred) ||
          (listOrder.get(a.listId) ?? 999) - (listOrder.get(b.listId) ?? 999) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 12);
  }, [tasks, lists, traderIds]);

  /** کتابخانه‌ی «پلن‌های کلی» — درخت دسته ← پلن (همان گروه‌های لیست‌های خانه) */
  const tree = useMemo(() => {
    const planLists = lists.filter((l) => !l.deletedAt && !traderIds.has(l.id));
    const sections = groups
      .map((g) => ({ id: g.id, name: g.name, lists: sortedLists(planLists.filter((l) => g.listIds.includes(l.id))) }))
      .filter((g) => g.lists.length > 0);
    const assigned = new Set(groups.flatMap((g) => g.listIds));
    const ungrouped = sortedLists(planLists.filter((l) => !assigned.has(l.id)));
    return { sections, ungrouped };
  }, [lists, groups, traderIds]);

  const openCountOf = (listId: string) =>
    tasks.filter((t) => t.listId === listId && !t.deletedAt && !t.completedAt).length;

  const toggleCollapsed = (id: string) => {
    setCollapsed((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const addSuggestion = (t: TaskEntity) => {
    void updateTask(t.id, { dueDate: selectedIso });
    showToast(isToday ? 'به پلن امروز اضافه شد ✨' : 'به پلن این روز اضافه شد ✨');
  };

  /* نوار تقویم شمسی: از ۷ روز قبل تا ۲۱ روز بعد + نقطه‌ی کارهای همان روز */
  const stripDays = useMemo(() => {
    const days: { iso: string; letter: string; jd: number; month: string; isToday: boolean; count: number }[] = [];
    const pendingDated = new Set(
      tasks
        .filter((t) => !t.deletedAt && !traderIds.has(t.listId) && !t.completedAt && t.dueDate !== null)
        .map((t) => t.dueDate as string),
    );
    const base = parseIsoDate(todayIso);
    for (let i = -7; i <= 21; i++) {
      const d = startOfDay(base);
      d.setDate(d.getDate() + i);
      const iso = toIsoDate(d);
      const j = toJalali(d);
      days.push({
        iso,
        letter: WEEK_HEADER[jalaliWeekday(d)],
        jd: j.jd,
        month: JALALI_MONTHS[j.jm - 1],
        isToday: iso === todayIso,
        count: pendingDated.has(iso) ? 1 : 0,
      });
    }
    return days;
  }, [tasks, traderIds, todayIso]);

  const selectedDate = parseIsoDate(selectedIso);
  const subtasksOf = (taskId: string) => subtasks.filter((s) => s.taskId === taskId && !s.deletedAt);

  return (
    <section className="p-margin flex flex-col gap-4" id="view-planned" data-testid="plans-view">
      <div className="flex justify-between items-center">
        <h1 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">پلن‌ها</h1>
        <span className="text-body-sm text-on-surface-variant">
          {weekdayName(selectedDate)} • {faFullDate(selectedDate)}
        </span>
      </div>

      {/* نوار تقویم شمسی کوچک — پرش به روز */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-margin px-margin" role="listbox" aria-label="نوار تقویم شمسی">
        {stripDays.map((d) => {
          const active = selectedIso === d.iso;
          return (
            <button
              key={d.iso}
              role="option"
              aria-selected={active}
              aria-label={`${d.jd} ${d.month}${d.count > 0 ? ' — پلن دارد' : ''}`}
              className={`shrink-0 w-12 min-h-[56px] py-1.5 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active
                  ? 'bg-primary text-on-primary border-primary shadow-sm'
                  : d.isToday
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-surface-container-lowest dark:bg-slate-800 border-outline-variant/30 text-on-surface dark:text-inverse-on-surface'
              }`}
              onClick={() => setPlanDay(active && !d.isToday ? null : d.iso)}
            >
              <span className="text-[10px] leading-none opacity-80">{d.letter}</span>
              <span className="text-[15px] font-bold leading-none">{toFa(d.jd)}</span>
              <span className={`text-[9px] leading-none ${active ? 'opacity-90' : 'text-outline'}`}>
                {d.jd === 1 ? d.month : ' '}
              </span>
              {d.count > 0 ? (
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-on-primary' : 'bg-primary'}`} aria-hidden="true" />
              ) : (
                <span className="w-1.5 h-0.5" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {/* هشدار عقب‌افتاده‌ها (بی‌تریدر) — فقط برای روز امروز */}
      {isToday && overdue.length > 0 ? (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 rounded-2xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="warning" size={20} className="text-red-600 shrink-0" />
            <span className="text-xs font-bold text-red-800 dark:text-red-200 leading-5">
              {toFa(overdue.length)} کار عقب‌افتاده از روزهای قبل
            </span>
          </div>
          <button
            className="px-2.5 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm shrink-0 active:scale-95 transition-transform"
            onClick={() => void moveOverdueToToday()}
          >
            انتقال به امروز
          </button>
        </div>
      ) : null}

      {/* هیروی پلن روز — سبک My Day: عنوان روز + شمارنده، خلوت و برند */}
      <div className="rounded-2xl p-4 bg-gradient-to-l from-primary/10 via-primary-container/25 to-primary/10 border border-primary/20 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-headline-md font-black text-on-surface dark:text-inverse-on-surface">
            {isToday ? 'پلن امروز' : 'پلن این روز'}
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            {toFa(dayPending.length)} کار مانده
            {dayCompleted.length > 0 ? ` • ${toFa(dayCompleted.length)} انجام‌شده` : ''}
          </p>
        </div>
        {!isToday ? (
          <button
            className="shrink-0 px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-black active:scale-95 transition-transform"
            onClick={() => setPlanDay(null)}
            aria-label="بازگشت به امروز"
          >
            امروز
          </button>
        ) : null}
      </div>

      {/* کارت پلن روز — چیپ «انجام‌شده» در بالا (مثل عکس مرجع) + ردیف کارها */}
      <div className="rounded-2xl bg-surface-container-low dark:bg-slate-800/60 border border-outline-variant/30 p-2.5 flex flex-col gap-2">
        {dayCompleted.length > 0 ? (
          <button
            className="self-start inline-flex items-center gap-1.5 rounded-xl bg-surface-container-high dark:bg-slate-700 px-3 py-1.5 text-label-md font-bold text-on-surface dark:text-inverse-on-surface"
            onClick={() => setCompletedOpen((v) => !v)}
            aria-expanded={completedOpen}
            aria-label="نمایش کارهای انجام‌شده‌ی این روز"
            data-testid="plans-completed-toggle"
          >
            <Icon name="checklist" size={15} className="text-primary" />
            انجام‌شده
            <span className="bg-primary/15 text-primary text-[11px] font-black px-1.5 rounded-full">{toFa(dayCompleted.length)}</span>
            <span className="inline-flex transition-transform duration-200" style={{ transform: completedOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              <Icon name="expand_more" size={16} />
            </span>
          </button>
        ) : null}

        {completedOpen && dayCompleted.length > 0 ? (
          <div className="flex flex-col gap-1.5 pb-1">
            {dayCompleted.map((t) => (
              <CompletedRow
                key={t.id}
                title={t.title}
                when={`${listById.get(t.listId)?.emoji ?? ''} ${(listById.get(t.listId)?.name ?? '').trim()}`.trim() || 'بدون لیست'}
              />
            ))}
          </div>
        ) : null}

        {dayPending.length > 0 ? (
          <div className="flex flex-col gap-2">
            {dayPending.map((t) => {
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
        ) : (
          <p className="text-body-sm text-on-surface-variant text-center py-5 leading-6">
            پلنی برای این روز ثبت نشده — از نوار پایین اضافه کن
            {suggestions.length > 0 ? ' یا از «پیشنهادها» یکی از پلن‌های کلی‌ات را بگذار.' : '.'}
          </p>
        )}
      </div>

      {/* پیشنهادها — از پلن‌های کلی (مثل Suggestions در My Day) */}
      {suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            className="self-start inline-flex items-center gap-1.5 rounded-full bg-secondary/15 text-secondary dark:bg-secondary/25 dark:text-secondary-fixed px-4 py-2 text-label-md font-black active:scale-95 transition-transform"
            onClick={() => setSuggOpen((v) => !v)}
            aria-expanded={suggOpen}
            data-testid="plans-suggestions-toggle"
          >
            <Icon name="auto_awesome" size={16} />
            پیشنهادها
            <span className="text-[11px] opacity-80 font-bold">({toFa(suggestions.length)})</span>
          </button>
          {suggOpen ? (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-2 flex flex-col gap-0.5" data-testid="plans-suggestions-panel">
              {suggestions.map((t) => {
                const l: ListEntity | undefined = listById.get(t.listId);
                return (
                  <div key={t.id} className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 hover:bg-surface-container-light dark:hover:bg-slate-700 transition-colors">
                    <button
                      className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                      onClick={() => addSuggestion(t)}
                      aria-label={`افزودن «${t.title}» به پلن این روز`}
                      title="افزودن به پلن این روز"
                    >
                      <Icon name="add" size={17} />
                    </button>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openList(t.listId)}>
                      <p className="text-label-md font-bold text-on-surface dark:text-inverse-on-surface truncate">
                        {t.starred ? <span className="text-amber-500 ml-1">★</span> : null}
                        {t.title}
                      </p>
                      <p className="text-[11px] text-on-surface-variant truncate">
                        {l ? `${l.emoji} ${l.name}` : 'بدون لیست'}
                      </p>
                    </div>
                  </div>
                );
              })}
              <p className="text-[10px] leading-4 text-outline px-2 pt-1.5">
                این آیتم‌ها در لیست خودشان می‌مانند و فقط سررسیدِ این روز را می‌گیرند.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* پلن‌های کلی — درخت جمع‌وجور دسته ← پلن */}
      <div className="rounded-2xl bg-surface-container-low dark:bg-slate-800/60 border border-outline-variant/30 p-3 flex flex-col gap-2" data-testid="plans-library">
        <div className="flex items-center justify-between">
          <span className="text-label-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-1.5">
            <Icon name="folder" size={17} className="text-primary" />
            پلن‌های کلی
          </span>
          <div className="flex items-center gap-1">
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-transform"
              onClick={() => openModal('newList')}
              aria-label="پلن جدید"
              title="پلن جدید"
            >
              <Icon name="add" size={19} />
            </button>
            <button
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-primary hover:bg-primary/10 active:scale-95 transition-transform"
              onClick={() => openModal('manageLists')}
              aria-label="مدیریت پلن‌ها و دسته‌ها"
            >
              مدیریت
            </button>
          </div>
        </div>

        {tree.sections.length === 0 && tree.ungrouped.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant leading-6 py-2">
            هنوز پلنی نساخته‌ای — با «+» یک پلن کلی بساز (مثلاً «ورزش» یا «پروژه‌ها») و آیتم‌هایش را داخلش ثبت کن؛
            بعد هر روز از «پیشنهادها» به پلن روزت بیاور.
          </p>
        ) : null}

        {tree.sections.map((sec) => {
          const isCollapsed = collapsed.includes(sec.id);
          return (
            <div key={sec.id} className="flex flex-col">
              <button
                className="flex items-center gap-2 py-2 text-right"
                onClick={() => toggleCollapsed(sec.id)}
                aria-expanded={!isCollapsed}
              >
                <span className="inline-flex transition-transform duration-200 text-outline" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                  <Icon name="expand_more" size={18} />
                </span>
                <span className="text-label-md font-black text-on-surface dark:text-inverse-on-surface flex-1">{sec.name}</span>
                <span className="text-[11px] text-outline font-bold">
                  {toFa(sec.lists.length)} پلن • {toFa(sec.lists.reduce((n, l) => n + openCountOf(l.id), 0))} باز
                </span>
              </button>
              {!isCollapsed ? (
                <div className="flex flex-col gap-1 pr-5 pb-1">
                  {sec.lists.map((l) => (
                    <PlanRow key={l.id} list={l} openCount={openCountOf(l.id)} onOpen={openList} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {tree.ungrouped.length > 0 ? (
          <div className="flex flex-col">
            <button
              className="flex items-center gap-2 py-2 text-right"
              onClick={() => toggleCollapsed('__ungrouped__')}
              aria-expanded={!collapsed.includes('__ungrouped__')}
            >
              <span className="inline-flex transition-transform duration-200 text-outline" style={{ transform: collapsed.includes('__ungrouped__') ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                <Icon name="expand_more" size={18} />
              </span>
              <span className="text-label-md font-bold text-on-surface-variant flex-1">بدون دسته</span>
              <span className="text-[11px] text-outline font-bold">
                {toFa(tree.ungrouped.length)} پلن • {toFa(tree.ungrouped.reduce((n, l) => n + openCountOf(l.id), 0))} باز
              </span>
            </button>
            {!collapsed.includes('__ungrouped__') ? (
              <div className="flex flex-col gap-1 pr-5 pb-1">
                {tree.ungrouped.map((l) => (
                  <PlanRow key={l.id} list={l} openCount={openCountOf(l.id)} onOpen={openList} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-[10px] leading-4 text-outline pt-1 border-t border-outline-variant/30">
          دسته‌ها همان گروه‌های لیست‌های خانه‌اند — ساخت/تغییر دسته از «مدیریت» (سطح دستگاه).
        </p>
      </div>
    </section>
  );
}

/** ردیف یک پلن در درخت کتابخانه — بازکردن لیست (همان ListView موجود) */
function PlanRow({ list, openCount, onOpen }: { list: ListEntity; openCount: number; onOpen(id: string): void }) {
  return (
    <button
      className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-surface-container-light dark:hover:bg-slate-700 active:scale-[0.99] transition-all text-right"
      onClick={() => onOpen(list.id)}
      aria-label={`بازکردن پلن ${list.name}`}
    >
      <span className="text-base shrink-0">{list.emoji}</span>
      <span className="text-label-md font-bold text-on-surface dark:text-inverse-on-surface flex-1 min-w-0 truncate">{list.name}</span>
      {list.pinned ? <Icon name="flag" size={13} className="text-primary shrink-0" /> : null}
      <span className={`text-[11px] font-bold shrink-0 ${openCount > 0 ? 'text-primary' : 'text-outline'}`}>
        {toFa(openCount)} باز
      </span>
      <Icon name="arrow_back" size={13} className="text-outline shrink-0" />
    </button>
  );
}
