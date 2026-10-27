import { Icon } from '@/components/Icon';
import { MicButton } from '@/components/Sheet';
import { AdBanner } from '@/components/AdBanner';
import { useAppStore } from '@/store/useAppStore';
import { homeStats, sortedLists, listProgress, LIST_BAR_COLORS, GREETING_TEXT, HUB_CARDS } from '@/lib/selectors';
import { useDragSort } from '@/lib/dragSort';
import type { DragHandleProps } from '@/components/TaskCard';
import { toFa, faFullDate } from '@/lib/format';
import type { ListEntity, TaskEntity } from '@/types';

/** بخش ۲: صفحه‌ی خانه — دقیقاً مطابق طرح با داده‌ی زنده (فاز ۲: بخش‌بندی گروهی + ترتیب کشیدنی) */
export function HomeView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const hubHidden = useAppStore((s) => s.hubHidden);
  const userName = useAppStore((s) => s.userName);
  const session = useAppStore((s) => s.session);
  // اولویت نام: پروفایل کاربر وارد‌شده ← تنظیم محلی ← بدون نام (سلام خنثی)
  const displayName = session?.displayName?.trim() || userName.trim();
  const setView = useAppStore((s) => s.setView);
  const openList = useAppStore((s) => s.openList);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const openModal = useAppStore((s) => s.openModal);
  const reorderWithin = useAppStore((s) => s.reorderWithin);
  const openEditList = useAppStore((s) => s.openEditList);
  const today = new Date();
  const stats = homeStats(tasks, today);
  const hour = today.getHours();

  /* ---- فاز ۲: بخش‌بندی لیست‌ها (بدون گروه + گروه‌ها) و کارت‌های هوشمند قابل پنهان‌سازی ---- */
  const live = sortedLists(lists);
  const liveIds = new Set(live.map((l) => l.id));
  const activeGroups = groups
    .map((g) => ({ ...g, listIds: g.listIds.filter((id) => liveIds.has(id)) }))
    .filter((g) => g.listIds.length > 0);
  const groupedIds = new Set(activeGroups.flatMap((g) => g.listIds));
  const ungrouped = live.filter((l) => !groupedIds.has(l.id));
  const hasGroups = activeGroups.length > 0;

  const hubCounts: Record<string, number> = {
    today: stats.todayTotal,
    urgent: stats.urgentCount,
    planned: stats.plannedCount,
    all: stats.allCount,
  };
  const hubClicks: Record<string, () => void> = {
    today: () => setView('todayView'),
    urgent: () => setView('listView'),
    planned: () => openCalendar('hub'),
    all: () => setView('listView'),
  };
  const hubIconCls: Record<string, string> = {
    today: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
    urgent: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
    planned: 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300',
    all: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  };
  const hubIcons: Record<string, 'today' | 'priority_high' | 'event_note' | 'folder'> = {
    today: 'today',
    urgent: 'priority_high',
    planned: 'event_note',
    all: 'folder',
  };
  const visibleHubs = HUB_CARDS.filter((h) => !hubHidden.includes(h.key));

  return (
    <section className="p-margin flex flex-col gap-5" id="view-home">
      {/* بنر تبلیغ/اطلاعیه از پنل ادمین (فاز ۹) — اگر اطلاعیه‌ی فعالی باشد */}
      <AdBanner />

      {/* خوش‌آمدگویی و تاریخ شمسی */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-headline-lg font-headline-lg text-on-surface dark:text-inverse-on-surface">
            {displayName ? `${GREETING_TEXT(hour)}، ${displayName} عزیز` : `${GREETING_TEXT(hour)}!`}
          </h1>
          <p className="text-body-sm font-body-sm text-on-surface-variant dark:text-outline mt-0.5">
            {faFullDate(today)} • <span className="text-primary font-bold">روز پرباری پیش روست</span>
          </p>
        </div>
        <MicButton size={20} className="w-10 h-10 rounded-full bg-primary-container/15 text-primary" />
      </div>

      {/* کارت قهرمان پیشرفت امروز */}
      <div className="bg-gradient-to-l from-primary via-primary-container to-primary-deep text-on-primary rounded-2xl p-4 shadow-md relative overflow-hidden">
        <div className="absolute -left-6 -bottom-6 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5">
            <Icon name="flag" size={20} />
            <span className="text-headline-sm font-headline-sm">برنامه‌ی امروز</span>
          </div>
          <span className="text-label-lg font-bold bg-white/20 px-2 py-0.5 rounded-full">
            {toFa(stats.todayPct)}٪ تکمیل
          </span>
        </div>
        <p className="text-body-sm opacity-90 mb-3">
          {toFa(stats.todayRemaining)} از {toFa(stats.todayTotal)} کار مانده • تمرکز روی پروژه‌های اصلی
        </p>
        <div className="w-full bg-black/20 h-2.5 rounded-full overflow-hidden p-0.5">
          <div
            className="bg-primary-fixed h-full rounded-full transition-all duration-700"
            style={{ width: `${stats.todayPct}%` }}
          />
        </div>
      </div>

      {/* شبکه‌ی ۴تایی دسته‌بندی‌ها — هر کارت قابل پنهان‌سازی (فاز ۲) */}
      {visibleHubs.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {visibleHubs.map((h) => (
            <HubCard
              key={h.key}
              icon={hubIcons[h.key]}
              iconCls={hubIconCls[h.key]}
              title={h.label}
              count={hubCounts[h.key]}
              onClick={hubClicks[h.key]}
            />
          ))}
        </div>
      ) : null}

      {/* لیست‌های من — با بخش‌بندی گروهی و ترتیب کشیدنی (فاز ۲) */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-headline-md font-headline-md text-on-surface dark:text-inverse-on-surface">لیست‌های من</h2>
          <div className="flex items-center gap-3">
            <button
              className="text-label-md text-on-surface-variant font-bold flex items-center gap-0.5"
              onClick={() => openModal('manageLists')}
              aria-label="مدیریت لیست‌ها"
            >
              <Icon name="edit" size={17} />
              <span>ویرایش</span>
            </button>
            <button
              className="text-label-md text-primary font-bold flex items-center gap-0.5"
              onClick={() => openModal('newList')}
            >
              <span>لیست جدید</span>
              <Icon name="add" size={18} />
            </button>
          </div>
        </div>

        {hasGroups && ungrouped.length > 0 ? (
          <ListSection
            title="بدون گروه"
            lists={ungrouped}
            tasks={tasks}
            onCommit={(next) => void reorderWithin(ungrouped.map((l) => l.id), next)}
            onOpen={openList}
            onEdit={openEditList}
          />
        ) : null}

        {!hasGroups ? (
          <ListSection
            lists={ungrouped}
            tasks={tasks}
            onCommit={(next) => void reorderWithin(ungrouped.map((l) => l.id), next)}
            onOpen={openList}
            onEdit={openEditList}
          />
        ) : null}

        {activeGroups.map((g) => (
          <ListSection
            key={g.id}
            title={g.name}
            lists={g.listIds.map((id) => live.find((l) => l.id === id)!).filter(Boolean)}
            tasks={tasks}
            onCommit={(next) => void reorderWithin(g.listIds, next)}
            onOpen={openList}
            onEdit={openEditList}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------- بخش لیست‌ها (بدون گروه یا یک گروه) با کشیدنی درون‌بخشی — فاز ۲ ---------- */
function ListSection({
  title,
  lists,
  tasks,
  onCommit,
  onOpen,
  onEdit,
}: {
  title?: string;
  lists: ListEntity[];
  tasks: TaskEntity[];
  onCommit(next: string[]): void;
  onOpen(id: string): void;
  onEdit(id: string): void;
}) {
  const ids = lists.map((l) => l.id);
  const drag = useDragSort(ids, onCommit);
  if (lists.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5" ref={drag.containerRef as (el: HTMLDivElement | null) => void}>
      {title ? (
        <div className="flex justify-between items-center pt-1">
          <span className="text-label-md font-bold text-on-surface-variant flex items-center gap-1.5">
            <Icon name="folder" size={15} />
            {title}
          </span>
          <span className="text-[11px] text-outline">{toFa(lists.length)} لیست</span>
        </div>
      ) : null}
      {drag.order.map((id) => {
        const list = lists.find((l) => l.id === id);
        if (!list) return null;
        return (
          <ListCard
            key={list.id}
            list={list}
            tasks={tasks}
            dragging={drag.draggingId === list.id}
            itemClass={drag.itemClass(list.id)}
            handleProps={lists.length > 1 ? drag.handleProps(list.id) : undefined}
            ignoreClick={drag.shouldIgnoreClick}
            onOpen={onOpen}
            onEdit={onEdit}
          />
        );
      })}
    </div>
  );
}

function ListCard({
  list,
  tasks,
  dragging,
  itemClass,
  handleProps,
  ignoreClick,
  onOpen,
  onEdit,
}: {
  list: ListEntity;
  tasks: TaskEntity[];
  dragging: boolean;
  itemClass: string;
  handleProps?: DragHandleProps;
  ignoreClick(): boolean;
  onOpen(id: string): void;
  onEdit(id: string): void;
}) {
  const p = listProgress(tasks, list.id);
  return (
    <div
      data-drag-item
      className={`${itemClass} ${dragging ? 'shadow-lg ring-1 ring-primary/40' : ''} bg-surface-container-lowest dark:bg-slate-800 p-3.5 rounded-2xl border border-outline-variant/30 shadow-sm flex flex-col gap-2.5 cursor-pointer hover:shadow-md transition-all`}
      onClick={() => {
        if (!ignoreClick()) onOpen(list.id);
      }}
    >
      <div className="flex justify-between items-center gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{list.emoji}</span>
          <span className="text-label-lg font-bold text-on-surface dark:text-inverse-on-surface truncate">{list.name}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="text-body-sm font-bold text-primary">{toFa(p.pending)} کار</span>
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-white/50 dark:hover:bg-white/10 active:scale-90 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(list.id);
            }}
            aria-label={`ویرایش لیست ${list.name}`}
            title="ویرایش، کپی یا حذف لیست"
          >
            <Icon name="more_vert" size={18} />
          </button>
          {handleProps ? (
            <button
              {...handleProps}
              className="w-7 h-8 rounded-full flex items-center justify-center text-outline hover:text-on-surface-variant cursor-grab active:cursor-grabbing"
              title="کشیدن برای تغییر ترتیب"
            >
              <Icon name="drag_indicator" size={17} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="w-full bg-surface-container dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
        <div
          className={`${LIST_BAR_COLORS[list.color]} h-full rounded-full transition-all duration-500`}
          style={{ width: `${p.pct}%` }}
        />
      </div>
    </div>
  );
}

function HubCard({
  icon,
  iconCls,
  title,
  count,
  onClick,
}: {
  icon: 'today' | 'priority_high' | 'event_note' | 'folder';
  iconCls: string;
  title: string;
  count: number;
  onClick(): void;
}) {
  return (
    <div
      className="bg-surface-container-lowest dark:bg-slate-800 p-3.5 rounded-2xl shadow-sm border border-outline-variant/30 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition-all active:scale-[0.98]"
      onClick={onClick}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>
        <Icon name={icon} size={24} />
      </div>
      <div className="flex flex-col">
        <span className="text-label-lg font-label-lg text-on-surface dark:text-inverse-on-surface">{title}</span>
        <span className="text-body-sm text-on-surface-variant dark:text-outline font-semibold">{toFa(count)} کار</span>
      </div>
    </div>
  );
}
