import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { detectSmartDate } from '@/lib/smartDate';
import { defaultListId } from '@/lib/selectors';

/**
 * فاز ۳ — نوار افزودن پایین‌ثابت با میانبرها (بالای ناوبری پایین):
 *  - تایپ + Enter = افزودن با تشخیص هوشمند تاریخ/ساعت («فردا ساعت ۱۷ …»)
 *  - دکمه‌ی تاریخ = تقویم شمسی برای کار جدید
 *  - دکمه‌ی باز شدن = شیت کامل افزودن (با پیش‌نویس همین متن)
 * در نمای لیست، هدف همان لیست است؛ در بقیه، لیست پیش‌فرض (اولین لیست).
 */

const VISIBLE_VIEWS = ['home', 'listView', 'myday', 'important', 'planned', 'all'];

export function QuickBar() {
  const view = useAppStore((s) => s.view);
  const lists = useAppStore((s) => s.lists);
  const activeListId = useAppStore((s) => s.activeListId);
  const addQuickTask = useAppStore((s) => s.addQuickTask);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const openModal = useAppStore((s) => s.openModal);
  const setQuickDraft = useAppStore((s) => s.setQuickDraft);

  const [text, setText] = useState('');

  const targetList = useMemo(() => {
    const id = view === 'listView' ? activeListId : (defaultListId(lists) ?? lists[0]?.id ?? null);
    return lists.find((l) => l.id === id) ?? lists[0] ?? null;
  }, [view, activeListId, lists]);

  const smart = useMemo(() => (text.trim() ? detectSmartDate(text, new Date()) : null), [text]);

  if (!VISIBLE_VIEWS.includes(view) || !targetList) return null;

  const submit = () => {
    if (!text.trim()) return;
    void addQuickTask({
      title: text,
      listId: targetList.id,
      dueDate: smart?.dueDate ?? null,
      dueTime: smart?.dueTime ?? null,
      titleText: smart?.cleanTitle,
    });
    setText('');
  };

  return (
    <div
      className="absolute bottom-16 left-0 right-0 z-40 px-3 pb-1.5 pt-1"
      id="quick-bar"
    >
      <div className="bg-surface-container-high dark:bg-slate-800 rounded-2xl shadow-lg border border-outline-variant/40 flex items-center gap-1.5 p-1.5">
        <Icon name="add" size={20} className="text-primary shrink-0 mx-1.5" />
        <input
          className="flex-1 min-w-0 bg-transparent border-0 text-body-sm text-on-surface dark:text-inverse-on-surface focus:ring-0 placeholder:text-outline outline-none px-1"
          placeholder={`افزودن به ${targetList.name}…`}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="افزودن سریع کار"
          enterKeyHint="done"
        />
        {smart ? (
          <span
            className="hidden sm:flex shrink-0 max-w-[38%] truncate text-[10px] font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5"
            title={smart.label}
          >
            {smart.label}
          </span>
        ) : null}
        <button
          className="w-9 h-9 rounded-xl flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-transform shrink-0"
          onClick={() => openCalendar('quickAdd')}
          title="تقویم شمسی"
          aria-label="انتخاب تاریخ برای کار جدید"
        >
          <Icon name="calendar_today" size={19} />
        </button>
        <button
          className="w-9 h-9 rounded-xl flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-transform shrink-0"
          onClick={() => {
            setQuickDraft(text);
            setText('');
            openModal('quickAdd');
          }}
          title="گزینه‌های بیشتر (اولویت، لیست، یادآور)"
          aria-label="بازکردن فرم کامل افزودن"
        >
          <Icon name="expand_more" size={20} className="rotate-180" />
        </button>
        <button
          className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-sm active:scale-95 transition-transform shrink-0 disabled:opacity-40"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="افزودن کار"
        >
          <Icon name="send" size={19} />
        </button>
      </div>
    </div>
  );
}
