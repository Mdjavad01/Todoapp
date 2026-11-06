import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { detectSmartDate } from '@/lib/smartDate';
import { toIsoDate } from '@/lib/format';
import { defaultListId } from '@/lib/selectors';

/**
 * نوار افزودن پایین‌ثابت با میانبرها (بالای ناوبری پایین):
 *  - تایپ + Enter = افزودن با تشخیص هوشمند تاریخ/ساعت («فردا ساعت ۱۷ …»)
 *  - دکمه‌ی تاریخ = تقویم شمسی برای کار جدید
 *  - دکمه‌ی باز شدن = شیت کامل افزودن (با پیش‌نویس همین متن)
 * فاز الف — فقط داخل لیست‌ها و صفحه‌ی «امروز» نشان داده می‌شود (خانه/آمار/تنظیمات نه).
 * P1.3 — دکمه‌ی میکروفون حذف شد (سرویس وویس‌به‌متن ساخته نمی‌شود؛ نه دکمه‌ی غیرفعال، نه وعده‌ی «به‌زودی»).
 *
 * بسته A (خلوت‌سازی UX) — تک‌نوارشدن: ردیف‌های افزودنِ داخل صفحه (لیست و امروز) حذف شدند و
 * این نوار تنها راه سریعِ افزودن است — روی «خانه» هم دیده می‌شود با هدف لیست پیش‌فرض؛
 * در تب «امروز» کار ساخته‌شده خودکار به «روزهای من» پین می‌شود (همان معنای ردیف حذف‌شده).
 * v1.13.0 — تب «پلن‌ها» هم به همین نوار وصل شد: کار تازه با سررسیدِ روزِ انتخاب‌شده (planDay)
 * ساخته می‌شود — بدون تشخیص هوشمند تاریخ، تا هرگز برخلاف روزِ انتخابی در نوار تقویم ننویسد.
 * حالت صفر لیست: نوار هرگز مخفی نمی‌شود — با اولین ارسال، لیست پیش‌فرض قطعی «کارهای من»
 * ساخته و کار در آن ثبت می‌شود (addQuickTaskBootstrap — e2e: tests/e2e-quickbar-fresh.mjs).
 * رفتار کیبورد: پنجره با interactive-widget=resizes-content در موبایل کوچک می‌شود و نوار
 * بالای ناوبری می‌ماند؛ مکانیزم --kb-height در lib/keyboard.ts تست unit دارد (tests/keyboard.test.ts)
 * و چیدمان در tests/e2e-quickbar.mjs راستی‌آزمایی می‌شود.
 */

const VISIBLE_VIEWS = ['home', 'listView', 'myday', 'planned'];

export function QuickBar() {
  const view = useAppStore((s) => s.view);
  const lists = useAppStore((s) => s.lists);
  const activeListId = useAppStore((s) => s.activeListId);
  const myDayIds = useAppStore((s) => s.myDayIds);
  const addQuickTask = useAppStore((s) => s.addQuickTask);
  const addQuickTaskBootstrap = useAppStore((s) => s.addQuickTaskBootstrap);
  const persistMyDay = useAppStore((s) => s.persistMyDay);
  const openCalendar = useAppStore((s) => s.openCalendar);
  const openModal = useAppStore((s) => s.openModal);
  const setQuickDraft = useAppStore((s) => s.setQuickDraft);

  const [text, setText] = useState('');
  const isMyDay = view === 'myday';
  const isPlanned = view === 'planned';
  const planDay = useAppStore((s) => s.planDay);

  const targetList = useMemo(() => {
    const id = view === 'listView' ? activeListId : (defaultListId(lists) ?? lists[0]?.id ?? null);
    return lists.find((l) => l.id === id) ?? lists[0] ?? null;
  }, [view, activeListId, lists]);

  // در تب «پلن‌ها» تشخیص هوشمند تاریخ عمداً خاموش است — هدف همیشه روزِ انتخاب‌شده است
  const smart = useMemo(() => (text.trim() && !isPlanned ? detectSmartDate(text, new Date()) : null), [text, isPlanned]);

  // بسته A — نوار بدون هدف هم دیده می‌شود؛ ارسال اول لیست پیش‌فرض را می‌سازد (نه مخفی‌شدن، نه خطا)
  if (!VISIBLE_VIEWS.includes(view)) return null;

  const submit = () => {
    if (!text.trim()) return;
    const value = text;
    setText('');
    void (async () => {
      const smartNow = smart;
      // v1.13.0 — تب «پلن‌ها»: سررسید = روزِ انتخاب‌شده (null = امروز)؛ تشخیص هوشمند تاریخ خاموش
      const plannedDue = isPlanned ? (planDay ?? toIsoDate(new Date())) : null;
      const createdId = targetList
        ? await addQuickTask({
            title: value,
            listId: targetList.id,
            dueDate: isPlanned ? plannedDue : (smartNow?.dueDate ?? null),
            dueTime: isPlanned ? null : (smartNow?.dueTime ?? null),
            titleText: isPlanned ? undefined : smartNow?.cleanTitle,
          })
        : await addQuickTaskBootstrap({
            title: value,
            dueDate: isPlanned ? plannedDue : (smartNow?.dueDate ?? null),
            dueTime: isPlanned ? null : (smartNow?.dueTime ?? null),
            titleText: isPlanned ? undefined : smartNow?.cleanTitle,
          });
      // تب «امروز» — همان معنای ردیف حذف‌شده: کار تازه به «روزهای من» پین می‌شود
      if (isMyDay && createdId) await persistMyDay([...myDayIds, createdId]);
    })();
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
          placeholder={
            isMyDay
              ? 'افزودن به امروز…'
              : isPlanned
                ? 'افزودن به پلن این روز…'
                : targetList
                  ? `افزودن به ${targetList.name}…`
                  : 'افزودن به کارهای من…'
          }
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
