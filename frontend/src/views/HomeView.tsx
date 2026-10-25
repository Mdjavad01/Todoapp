import { Icon } from '@/components/Icon';
import { MicButton } from '@/components/Sheet';
import { useAppStore } from '@/store/useAppStore';
import { homeStats, sortedLists, LIST_BAR_COLORS, GREETING_TEXT } from '@/lib/selectors';
import { toFa, faFullDate } from '@/lib/format';

/** بخش ۲: صفحه‌ی خانه — دقیقاً مطابق طرح با داده‌ی زنده */
export function HomeView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const userName = useAppStore((s) => s.userName);
  const session = useAppStore((s) => s.session);
  // اولویت نام: پروفایل کاربر وارد‌شده ← تنظیم محلی ← بدون نام (سلام خنثی)
  const displayName = session?.displayName?.trim() || userName.trim();
  const setView = useAppStore((s) => s.setView);
  const openList = useAppStore((s) => s.openList);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const openModal = useAppStore((s) => s.openModal);
  const today = new Date();
  const stats = homeStats(tasks, today);
  const hour = today.getHours();

  return (
    <section className="p-margin flex flex-col gap-5" id="view-home">
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

      {/* شبکه‌ی ۴تایی دسته‌بندی‌ها */}
      <div className="grid grid-cols-2 gap-3">
        <HubCard
          icon="today"
          iconCls="bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
          title="امروز"
          count={stats.todayTotal}
          onClick={() => setView('todayView')}
        />
        <HubCard
          icon="priority_high"
          iconCls="bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
          title="مهم و فوری"
          count={stats.urgentCount}
          onClick={() => setView('listView')}
        />
        <HubCard
          icon="event_note"
          iconCls="bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
          title="برنامه‌ریزی‌شده"
          count={stats.plannedCount}
          onClick={() => openCalendar('hub')}
        />
        <HubCard
          icon="folder"
          iconCls="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
          title="همه‌ی کارها"
          count={stats.allCount}
          onClick={() => setView('listView')}
        />
      </div>

      {/* لیست‌های من */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-headline-md font-headline-md text-on-surface dark:text-inverse-on-surface">لیست‌های من</h2>
          <button
            className="text-label-md text-primary font-bold flex items-center gap-0.5"
            onClick={() => openModal('newList')}
          >
            <span>لیست جدید</span>
            <Icon name="add" size={18} />
          </button>
        </div>
        {sortedLists(lists).map((list) => {
          const p = listProgressOf(tasks, list.id);
          return (
            <div
              key={list.id}
              className="bg-surface-container-lowest dark:bg-slate-800 p-3.5 rounded-2xl border border-outline-variant/30 shadow-sm flex flex-col gap-2.5 cursor-pointer hover:shadow-md transition-all"
              onClick={() => openList(list.id)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{list.emoji}</span>
                  <span className="text-label-lg font-bold text-on-surface dark:text-inverse-on-surface">{list.name}</span>
                </div>
                <span className="text-body-sm font-bold text-primary">{toFa(p.pending)} کار</span>
              </div>
              <div className="w-full bg-surface-container dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`${LIST_BAR_COLORS[list.color]} h-full rounded-full transition-all duration-500`}
                  style={{ width: `${p.pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function listProgressOf(tasks: { listId: string; completedAt: string | null }[], listId: string) {
  const inList = tasks.filter((t) => t.listId === listId);
  const done = inList.filter((t) => t.completedAt).length;
  const total = inList.length;
  return { pending: total - done, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
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
