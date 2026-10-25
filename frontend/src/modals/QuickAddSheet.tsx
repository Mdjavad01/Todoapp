import { useMemo, useState } from 'react';
import { Sheet, SheetHeader, MicButton } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { detectSmartDateTime } from '@/lib/smartDate';
import { faShort } from '@/lib/format';
import { parseIsoDate } from '@/lib/format';
import { PRIORITY_BADGE } from '@/lib/selectors';
import type { TaskEntity } from '@/types';

/** مودال ۴: افزودن سریع کار (بات‌شیت پایین) */
export function QuickAddSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const lists = useAppStore((s) => s.lists);
  const activeListId = useAppStore((s) => s.activeListId);
  const pendingDate = useAppStore((s) => s.pendingDate);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const addQuickTask = useAppStore((s) => s.addQuickTask);

  const [title, setTitle] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskEntity['priority']>('normal');

  const effectiveList = useMemo(() => {
    const target = listId ?? activeListId ?? lists[0]?.id ?? null;
    return lists.find((l) => l.id === target) ?? lists[0] ?? null;
  }, [listId, activeListId, lists]);

  const smart = useMemo(() => detectSmartDateTime(title, new Date()), [title]);

  const save = () => {
    if (!title.trim() || !effectiveList) return;
    addQuickTask({ title, listId: effectiveList.id, dueDate: pendingDate, priority });
    setTitle('');
    setListId(null);
    setPriority('normal');
  };

  return (
    <Sheet open={modal === 'quickAdd'} onClose={() => openModal(null)}>
      <SheetHeader title="افزودن کار جدید" onClose={() => openModal(null)} />

      <input
        className="w-full bg-surface-container dark:bg-slate-800 border-0 rounded-2xl px-4 py-3 text-body-md text-on-surface dark:text-inverse-on-surface focus:ring-2 focus:ring-primary outline-none"
        placeholder="مثال: فردا ساعت ۱۷ خرید نان سنگک..."
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        aria-label="عنوان کار جدید"
        autoFocus
      />

      {/* پیش‌نمایش تشخیص هوشمند تاریخ */}
      <div className="bg-primary/10 border border-primary/20 p-2.5 rounded-xl flex items-center gap-2 text-xs text-primary font-bold">
        <Icon name="psychology" size={16} />
        <span>
          تشخیص هوشمند تاریخ:{' '}
          {pendingDate ? `انتخاب‌شده: ${faShort(parseIsoDate(pendingDate))}` : smart}
        </span>
      </div>

      {/* اولویت و فوریت (v15) — همان برچسب‌ها و رنگ‌های کارت کارها */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-outline font-semibold">اولویت و فوریت:</span>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="اولویت و فوریت کار">
          {(['urgent', 'high', 'normal', 'low'] as const).map((p) => {
            const meta = PRIORITY_BADGE[p];
            const active = priority === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPriority(p)}
                className={`py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 ${
                  active ? `${meta.cls} ring-2 ring-current/40` : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
                }`}
              >
                {p === 'urgent' ? <Icon name="priority_high" size={14} /> : null}
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* انتخاب لیست */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-outline font-semibold">انتخاب لیست:</span>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {lists.map((l) => {
            const active = effectiveList?.id === l.id;
            return (
              <button
                key={l.id}
                className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer shrink-0 transition-colors ${
                  active ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant'
                }`}
                onClick={() => setListId(l.id)}
              >
                {l.emoji} {l.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* چیپ‌های سریع تاریخ */}
      <div className="flex gap-2">
        <button
          className="flex-1 py-2 bg-surface-container dark:bg-slate-800 rounded-xl text-xs font-bold text-on-surface flex items-center justify-center gap-1"
          onClick={() => openCalendar('quickAdd')}
        >
          <Icon name="calendar_today" size={16} />
          <span>تقویم شمسی</span>
        </button>
        <span className="w-12 py-2 bg-surface-container dark:bg-slate-800 rounded-xl text-xs font-bold text-on-surface flex items-center justify-center">
          <MicButton size={20} />
        </span>
      </div>

      <button
        className="w-full py-3 bg-primary text-on-primary font-bold rounded-2xl shadow-md active:scale-95 text-body-md"
        onClick={save}
        disabled={!title.trim()}
      >
        ثبت و ذخیره کار
      </button>
    </Sheet>
  );
}
