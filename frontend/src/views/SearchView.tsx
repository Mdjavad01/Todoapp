import { useMemo } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { PRIORITY_BADGE } from '@/lib/selectors';
import { toIsoDate, relativeDayLabel } from '@/lib/format';
import type { TaskEntity } from '@/types';

/** بخش ۱۵: جستجوی زنده در همه‌ی لیست‌ها و کارها */
export function SearchView() {
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchFilter = useAppStore((s) => s.searchFilter);
  const setSearch = useAppStore((s) => s.setSearch);
  const goHome = useAppStore((s) => s.goHome);
  const openList = useAppStore((s) => s.openList);
  const openModal = useAppStore((s) => s.openModal);

  const today = new Date();
  const todayIso = toIsoDate(today);

  const homeList = lists.find((l) => l.color === 'teal');
  const billsList = lists.find((l) => l.color === 'rose');

  const chips: { key: string; label: string }[] = [
    { key: 'all', label: 'همه' },
    { key: 'urgent', label: 'فوری' },
    { key: 'home', label: homeList?.name ?? 'کارهای خانه' },
    { key: 'bills', label: billsList?.name ?? 'مالی و قبوض' },
  ];

  const results = useMemo(() => {
    const q = searchQuery.trim();
    let pool = tasks.filter((t) => !t.deletedAt);
    if (searchFilter === 'urgent') pool = pool.filter((t) => t.priority === 'urgent' || t.priority === 'high');
    else if (searchFilter === 'home') pool = pool.filter((t) => t.listId === homeList?.id);
    else if (searchFilter === 'bills') pool = pool.filter((t) => t.listId === billsList?.id);
    if (q) {
      pool = pool.filter((t) => t.title.includes(q) || t.notes.includes(q));
    } else {
      pool = pool.filter((t) => !t.completedAt).slice(0, 5);
    }
    return pool.slice(0, 12);
  }, [tasks, searchQuery, searchFilter, homeList, billsList]);

  const statusOf = (t: TaskEntity): { label: string; cls: string } => {
    if (t.completedAt) return { label: 'انجام شد', cls: 'text-outline' };
    if (t.dueDate && t.dueDate < todayIso) return { label: 'معوقه', cls: 'text-red-500 font-bold' };
    if (t.dueDate === todayIso) return { label: 'امروز', cls: 'text-primary font-bold' };
    if (t.dueDate) return { label: relativeDayLabel(t.dueDate, today), cls: 'text-on-surface-variant font-bold' };
    return { label: 'بدون تاریخ', cls: 'text-outline' };
  };

  return (
    <section className="p-margin flex flex-col gap-4" id="view-search">
      <div className="flex items-center gap-2">
        <button
          className="w-8 h-8 rounded-full bg-surface-container dark:bg-slate-700 flex items-center justify-center"
          onClick={goHome}
          aria-label="بازگشت"
        >
          <Icon name="arrow_forward" size={18} />
        </button>
        <div className="flex-1 bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-primary px-3 py-2 flex items-center gap-2">
          <Icon name="search" size={20} className="text-primary" />
          <input
            className="w-full bg-transparent border-0 text-body-sm focus:ring-0 outline-none text-on-surface dark:text-inverse-on-surface"
            placeholder="جستجو در تمام لیست‌ها و یادداشت‌ها..."
            type="text"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="جستجو"
          />
        </div>
      </div>

      {/* چیپ‌های فیلتر */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar text-xs">
        {chips.map((c) => (
          <button
            key={c.key}
            className={`px-3 py-1 rounded-full font-bold cursor-pointer shrink-0 transition-colors ${
              searchFilter === c.key ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant'
            }`}
            onClick={() => setSearch(searchQuery, c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* نتایج */}
      <div className="flex flex-col gap-2 mt-2">
        {results.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant text-center py-8">
            {searchQuery ? `نتیجه‌ای برای «${searchQuery}» پیدا نشد.` : 'موردی موجود نیست.'}
          </p>
        ) : (
          results.map((t) => {
            const list = lists.find((l) => l.id === t.listId);
            const st = statusOf(t);
            return (
              <div
                key={t.id}
                className="p-3 bg-surface-container-lowest dark:bg-slate-800 rounded-xl border border-outline-variant/30 flex justify-between items-center cursor-pointer hover:border-primary/50 transition-all"
                onClick={() => (list ? openList(list.id) : undefined)}
              >
                <div>
                  <span className={`text-label-md font-bold block ${t.completedAt ? 'line-through opacity-60' : ''}`}>
                    {t.title}
                  </span>
                  <span className="text-xs text-outline">
                    لیست: {list?.name ?? '—'} • اولویت {PRIORITY_BADGE[t.priority].label}
                  </span>
                </div>
                <span className={`text-xs ${st.cls}`}>{st.label}</span>
              </div>
            );
          })
        )}
      </div>

      {results.length > 0 && searchQuery.trim() ? (
        <button
          className="text-xs text-primary font-bold self-center"
          onClick={() => results[0] && openModal('taskDetail', results[0].id)}
        >
          بازکردن اولین نتیجه
        </button>
      ) : null}
    </section>
  );
}
