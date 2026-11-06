import { useMemo, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { AdBanner } from '@/components/AdBanner';
import { GuestDataBanner } from '@/components/GuestDataBanner';
import { useAppStore } from '@/store/useAppStore';
import {
  sortedLists,
  listProgress,
  myDayTasks,
  starredPending,
  plannerSections,
  homeStats,
  HUB_CARDS,
} from '@/lib/selectors';
import { toFa } from '@/lib/format';
import { traderListIdSet } from '@/db/traderTemplate';
import type { ListEntity, HubKey, TaskEntity } from '@/types';

/**
 * فاز الف — صفحه‌ی خانه‌ی ساده (الگوی سادگی):
 *   ردیف‌های هوشمند (امروز/مهم/برنامه‌ریزی‌شده/همه‌ی کارها) + جداکننده +
 *   لیست‌های کاربر (ایموجی، نام، تعداد باقی‌مانده — بدون نوار پیشرفت) با گروه‌های جمع‌شونده +
 *   ردیف «لیست جدید». ویرایش/ترتیب/حذف فقط از منوی ⋮ یا نگه‌داشتن طولانی.
 *   بدون چیپ، بدون کارت خوش‌آمد، بدون میکروفون، بدون دکمه‌ی شناور و نوار افزودن.
 *   نوار اندازه‌ی فونت: ۱۵px (عنوان‌ها/نام‌ها) و ۱۲px (تعدادها) — دو وزن: bold/normal.
 *
 * بسته A (خلوت‌سازی UX):
 *   - بنر «چک‌لیست تریدر آماده است» و ردیف دائمی «قالب‌های آماده» از خانه حذف شد —
 *     تنها مسیر قالب: «لیست جدید → یا از قالب آماده» (+ ردیف تنظیمات تا بسته C).
 *   - کارت 🌱 حالت خالی حذف شد؛ فقط یک خط کم‌رنگ می‌ماند — افزودن اولین کار با QuickBar پایین صفحه.
 */

const ROW_H = 'min-h-[48px]'; // ناحیه‌ی لمس حداقل ۴۸ پیکسل

export function HomeView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const groupsCollapsed = useAppStore((s) => s.groupsCollapsed);
  const toggleGroupCollapsed = useAppStore((s) => s.toggleGroupCollapsed);
  const hubHidden = useAppStore((s) => s.hubHidden);
  const myDayIds = useAppStore((s) => s.myDayIds);
  const setView = useAppStore((s) => s.setView);
  const openList = useAppStore((s) => s.openList);
  const openModal = useAppStore((s) => s.openModal);
  const openEditList = useAppStore((s) => s.openEditList);

  const today = new Date();

  /* ---- شمارنده‌های ردیف‌های هوشمند (هم‌جهت با مقصدهای واقعی) ---- */
  /* v1.13.0 — شمارنده‌ی «برنامه‌ریزی‌شده» با تب مقصدش (پلن‌ها) هم‌قرارداد است: چک‌لیست تریدر در آن شمرده نمی‌شود */
  const traderIds = useMemo(() => traderListIdSet(lists), [lists]);
  const counts: Record<HubKey, number> = useMemo(() => {
    const stats = homeStats(tasks, today);
    const planner = plannerSections(tasks, today);
    const dated = (arr: TaskEntity[]) => arr.filter((t) => !traderIds.has(t.listId)).length;
    return {
      today: myDayTasks(tasks, myDayIds, today).filter((t) => !t.completedAt).length,
      urgent: starredPending(tasks).length,
      planned:
        dated(planner.overdue) +
        dated(planner.today) +
        dated(planner.tomorrow) +
        dated(planner.thisWeek) +
        dated(planner.later),
      all: stats.allCount,
    };
  }, [tasks, myDayIds, traderIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const hubClicks: Record<HubKey, () => void> = {
    today: () => setView('myday'),
    urgent: () => setView('important'),
    planned: () => setView('planned'),
    all: () => setView('all'),
  };
  const hubIcons: Record<HubKey, 'today' | 'star' | 'event_note' | 'checklist'> = {
    today: 'today',
    urgent: 'star',
    planned: 'event_note',
    all: 'checklist',
  };
  const visibleHubs = HUB_CARDS.filter((h) => !hubHidden.includes(h.key));

  /* ---- لیست‌های کاربر: بدون گروه + گروه‌های فعال (قاعده‌ی فاز ۲ حفظ شده) ---- */
  const live = sortedLists(lists);
  const liveIds = new Set(live.map((l) => l.id));
  const activeGroups = groups
    .map((g) => ({ ...g, listIds: g.listIds.filter((id) => liveIds.has(id)) }))
    .filter((g) => g.listIds.length > 0);
  const groupedIds = new Set(activeGroups.flatMap((g) => g.listIds));
  const ungrouped = live.filter((l) => !groupedIds.has(l.id));
  const hasGroups = activeGroups.length > 0;

  /* ---- حالت خالی: هیچ کار زنده‌ای در هیچ لیستی نیست ---- */
  const isEmpty = useMemo(
    () => live.every((l) => tasks.filter((t) => t.listId === l.id && !t.deletedAt).length === 0),
    [live, tasks],
  );

  return (
    <section className="p-margin flex flex-col gap-4 pb-6" id="view-home">
      <AdBanner />

      {/* v1.9 — شفافیت داده‌ی مهمان: داده فقط روی همین گوشی است (یک‌بار، قابل‌بستن) */}
      <GuestDataBanner />

      {/* ردیف‌های هوشمند — ساده، لیستی، قابل پنهان‌سازی از تنظیمات */}
      {visibleHubs.length > 0 ? (
        <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 divide-y divide-outline-variant/20 overflow-hidden">
          {visibleHubs.map((h) => (
            <button
              key={h.key}
              className={`w-full ${ROW_H} px-3 flex items-center gap-3 text-right hover:bg-surface-container/60 dark:hover:bg-slate-700/50 active:bg-surface-container transition-colors`}
              onClick={hubClicks[h.key]}
              aria-label={`${h.label} — ${toFa(counts[h.key])} کار`}
            >
              <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Icon name={hubIcons[h.key]} size={20} />
              </span>
              <span className="flex-1 text-[15px] font-bold text-on-surface dark:text-inverse-on-surface">{h.label}</span>
              <span className="text-xs text-on-surface-variant">{toFa(counts[h.key])}</span>
              <Icon name="arrow_back" size={16} className="text-outline shrink-0" />
            </button>
          ))}
        </div>
      ) : null}

      {/* جداکننده‌ی بخش‌ها */}
      <div className="border-t border-outline-variant/40" aria-hidden="true" />

      {/* لیست‌های کاربر */}
      <div className="flex flex-col gap-1" aria-label="لیست‌های من">
        <h2 className="text-[15px] font-bold text-on-surface-variant px-1 pb-1">لیست‌های من</h2>

        {ungrouped.map((l) => (
          <ListRow key={l.id} list={l} tasks={tasks} onOpen={openList} onEdit={openEditList} />
        ))}

        {hasGroups
          ? activeGroups.map((g) => {
              const collapsed = groupsCollapsed.includes(g.id);
              const gLists = g.listIds.map((id) => live.find((l) => l.id === id)!).filter(Boolean);
              return (
                <div key={g.id} className="flex flex-col">
                  <button
                    className={`w-full ${ROW_H} px-1 flex items-center gap-2 text-right rounded-xl hover:bg-surface-container/60 dark:hover:bg-slate-700/50 transition-colors`}
                    onClick={() => toggleGroupCollapsed(g.id)}
                    aria-expanded={!collapsed}
                    aria-label={`گروه ${g.name}${collapsed ? ' — باز کردن' : ' — جمع کردن'}`}
                  >
                    <Icon name="folder" size={17} className="text-on-surface-variant shrink-0" />
                    <span className="flex-1 text-[15px] font-bold text-on-surface dark:text-inverse-on-surface">{g.name}</span>
                    <span className="text-xs text-on-surface-variant">{toFa(gLists.length)}</span>
                    <span
                      className="w-8 h-8 flex items-center justify-center text-outline transition-transform duration-200"
                      style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                    >
                      <Icon name="expand_more" size={20} />
                    </span>
                  </button>
                  {!collapsed
                    ? gLists.map((l) => (
                        <ListRow key={l.id} list={l} tasks={tasks} onOpen={openList} onEdit={openEditList} />
                      ))
                    : null}
                </div>
              );
            })
          : null}

        {/* ردیف «لیست جدید» — با گزینه‌ی قالب آماده داخل شیت */}
        <button
          className={`w-full ${ROW_H} mt-1 px-3 flex items-center gap-3 text-right rounded-2xl border border-dashed border-primary/40 text-primary hover:bg-primary/5 active:bg-primary/10 transition-colors`}
          onClick={() => openModal('newList')}
          aria-label="ساخت لیست جدید"
        >
          <span className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Icon name="add" size={20} />
          </span>
          <span className="flex-1 text-[15px] font-bold">لیست جدید</span>
          <span className="text-xs text-on-surface-variant">یا از قالب آماده</span>
        </button>
      </div>

      {/* بسته A — حالت خالی: فقط یک خط کم‌رنگ؛ افزودن اولین کار با QuickBar پایین صفحه */}
      {isEmpty ? (
        <p className="text-center text-xs text-on-surface-variant/70 py-4" id="home-empty">
          برای شروع، اولین کارت را از نوار پایین اضافه کن.
        </p>
      ) : null}
    </section>
  );
}

/**
 * ردیف لیست — ایموجی، نام، تعداد باقی‌مانده (بدون نوار پیشرفت).
 * ویرایش/کپی/حذف/ترتیب: منوی ⋮ یا نگه‌داشتن طولانی → شیت ویرایش لیست (فاز ۲).
 */
function ListRow({
  list,
  tasks,
  onOpen,
  onEdit,
}: {
  list: ListEntity;
  tasks: import('@/types').TaskEntity[];
  onOpen(id: string): void;
  onEdit(id: string): void;
}) {
  const pending = listProgress(tasks, list.id).pending;
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      onEdit(list.id);
    }, 500);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  return (
    <div
      className={`w-full ${ROW_H} px-3 flex items-center gap-3 rounded-xl hover:bg-surface-container/60 dark:hover:bg-slate-700/50 active:bg-surface-container transition-colors cursor-pointer select-none`}
      onClick={() => {
        if (!longPressed.current) onOpen(list.id);
        longPressed.current = false;
      }}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      role="button"
      aria-label={`باز کردن لیست ${list.name} — ${toFa(pending)} کار باقی‌مانده`}
    >
      <span className="text-xl shrink-0" aria-hidden="true">
        {list.emoji}
      </span>
      <span className="flex-1 min-w-0 truncate text-[15px] font-bold text-on-surface dark:text-inverse-on-surface">
        {list.name}
      </span>
      <span className="text-xs text-on-surface-variant shrink-0">{toFa(pending)}</span>
      <button
        className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-transform shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          cancelPress();
          onEdit(list.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`ویرایش لیست ${list.name}`}
        title="ویرایش، کپی، ترتیب یا حذف لیست"
      >
        <Icon name="more_vert" size={18} />
      </button>
    </div>
  );
}
