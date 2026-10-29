import { useMemo, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { AdBanner } from '@/components/AdBanner';
import { useAppStore } from '@/store/useAppStore';
import {
  sortedLists,
  listProgress,
  myDayTasks,
  starredPending,
  plannerSections,
  homeStats,
  HUB_CARDS,
  defaultListId,
} from '@/lib/selectors';
import { toFa } from '@/lib/format';
import type { ListEntity, HubKey } from '@/types';

/**
 * فاز الف — صفحه‌ی خانه‌ی ساده (الگوی سادگی):
 *   ردیف‌های هوشمند (امروز/مهم/برنامه‌ریزی‌شده/همه‌ی کارها) + جداکننده +
 *   لیست‌های کاربر (ایموجی، نام، تعداد باقی‌مانده — بدون نوار پیشرفت) با گروه‌های جمع‌شونده +
 *   ردیف «لیست جدید». ویرایش/ترتیب/حذف فقط از منوی ⋮ یا نگه‌داشتن طولانی.
 *   بدون چیپ، بدون کارت خوش‌آمد، بدون میکروفون، بدون دکمه‌ی شناور و نوار افزودن.
 *   نوار اندازه‌ی فونت: ۱۵px (عنوان‌ها/نام‌ها) و ۱۲px (تعدادها) — دو وزن: bold/normal.
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
  const demoCleanupBanner = useAppStore((s) => s.demoCleanupBanner);
  const dismissDemoCleanup = useAppStore((s) => s.dismissDemoCleanup);
  const cleanLegacyDemos = useAppStore((s) => s.cleanLegacyDemos);

  const today = new Date();

  /* ---- شمارنده‌های ردیف‌های هوشمند (هم‌جهت با مقصدهای واقعی) ---- */
  const counts: Record<HubKey, number> = useMemo(() => {
    const stats = homeStats(tasks, today);
    const planner = plannerSections(tasks, today);
    return {
      today: myDayTasks(tasks, myDayIds, today).filter((t) => !t.completedAt).length,
      urgent: starredPending(tasks).length,
      planned:
        planner.overdue.length +
        planner.today.length +
        planner.tomorrow.length +
        planner.thisWeek.length +
        planner.later.length,
      all: stats.allCount,
    };
  }, [tasks, myDayIds]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const addFirst = () => {
    const id = defaultListId(lists);
    if (id) openList(id);
    openModal('quickAdd');
  };

  return (
    <section className="p-margin flex flex-col gap-4 pb-6" id="view-home">
      <AdBanner />

      {/* فاز نصب تمیز — بنر یک‌بارمصرف پاک‌سازی داده‌ی نمونه‌ی نصب‌های قدیمی (هیچ‌چیز بی‌صدا حذف نمی‌شود) */}
      {demoCleanupBanner ? (
        <div
          className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300/60 dark:border-amber-700/50 rounded-2xl p-3.5"
          role="alertdialog"
          aria-label="پاک‌سازی کارهای نمونه‌ی قدیمی"
        >
          <div className="flex items-start gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Icon name="delete" size={20} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-amber-900 dark:text-amber-200">
                کارهای نمونه‌ی قدیمی پیدا شد. پاک شوند؟
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                {demoCleanupBanner.taskCount > 0 ? (
                  <>
                    {toFa(demoCleanupBanner.taskCount)} کار نمونه از نسخه‌های قبلی
                    {demoCleanupBanner.listCount > 0 ? ` و ${toFa(demoCleanupBanner.listCount)} لیست نمونه` : ''}{' '}
                    شناسایی شد. کارهای خودت دست نمی‌خورند و تا لحظه‌ی حذف می‌توانی واگرد کنی.
                  </>
                ) : (
                  <>
                    {toFa(demoCleanupBanner.listCount)} لیست نمونه‌ی بدون کار از نسخه‌های قبلی شناسایی شد. لیست‌های واقعی‌ات دست
                    نمی‌خورند.
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              className="flex-1 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-black active:scale-[0.98] transition-transform"
              onClick={() => void cleanLegacyDemos()}
              aria-label="پاک کردن کارهای نمونه"
            >
              پاک کن
            </button>
            <button
              className="flex-1 min-h-[44px] rounded-xl bg-transparent border border-amber-400/70 dark:border-amber-600/60 text-amber-800 dark:text-amber-300 text-[13px] font-bold active:scale-[0.98] transition-transform"
              onClick={dismissDemoCleanup}
              aria-label="نگه داشتن کارهای نمونه"
            >
              نگه دار
            </button>
          </div>
        </div>
      ) : null}

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

      {/* حالت خالی — پیام کوتاه و دوستانه */}
      {isEmpty ? (
        <div className="flex flex-col items-center text-center gap-2 py-6" id="home-empty">
          <div className="w-16 h-16 rounded-full bg-primary-container/15 flex items-center justify-center text-3xl">
            🌱
          </div>
          <p className="text-[15px] font-bold text-on-surface dark:text-inverse-on-surface">
            همه‌چیز آماده است!
          </p>
          <p className="text-xs text-on-surface-variant max-w-[240px] leading-relaxed">
            لیست‌هایت ساخته شده‌اند؛ اولین کارت را اضافه کن تا کارام از همین لحظه همراهت باشد.
          </p>
          <button
            className="mt-2 h-12 px-5 rounded-2xl bg-primary text-on-primary text-[15px] font-bold shadow-md active:scale-95 transition-transform flex items-center gap-1.5"
            onClick={addFirst}
          >
            <Icon name="add" size={18} />
            <span>اولین کارت را اضافه کن</span>
          </button>
        </div>
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
