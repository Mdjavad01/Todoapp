import { Icon } from './Icon';
import { TaskItemFields } from './TaskItemFields';
import { useAppStore } from '@/store/useAppStore';
import { relativeDayLabel, faShort, faTime, parseIsoDate, toFa } from '@/lib/format';
import { PRIORITY_BADGE, REPEAT_LABEL } from '@/lib/selectors';
import type { TaskEntity } from '@/types';

/** ویژگی‌های دستگیره‌ی کشیدن (مرتب‌سازی دستی — فاز ۲) */
export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  style: { touchAction: 'none' };
  role: 'button';
  'aria-label': string;
}

/** کارت کار — دقیقاً مطابق طرح (بخش ۳) */
/**
 * بسته A (خلوت‌سازی UX) — برچسب اولویت فقط برای «فوری/بالا» نشان داده می‌شود؛
 * «متوسط» (پیش‌فرض) و «کم» دیگر ردیف را شلوغ نمی‌کنند. ستاره = تنها نشان «مهم» در سطح اول.
 * (بسته B: اولویت کامل پشت «بیشتر» در جزئیات کار می‌رود و فقط «فوری» روی ردیف می‌ماند.)
 */
const SHOW_PRIORITY_BADGE: Record<TaskEntity['priority'], boolean> = {
  urgent: true,
  high: true,
  normal: false,
  low: false,
};

export function TaskCard({
  task,
  subtaskCount,
  subtaskDone,
  dragHandle,
}: {
  task: TaskEntity;
  subtaskCount: number;
  subtaskDone: number;
  /** اگر داده شود، دستگیره‌ی کشیدن برای مرتب‌سازی دستی نمایش داده می‌شود */
  dragHandle?: DragHandleProps;
}) {
  const toggleTask = useAppStore((s) => s.toggleTask);
  const openModal = useAppStore((s) => s.openModal);
  const done = task.completedAt !== null;
  const badge = PRIORITY_BADGE[task.priority];
  const today = new Date();

  return (
    <div
      className={`bg-surface-container-lowest dark:bg-slate-800 p-3.5 rounded-2xl border border-outline-variant/30 shadow-sm flex items-start gap-3 transition-all duration-300 ${
        done ? 'opacity-50' : ''
      }`}
    >
      <button
        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors shrink-0 ${
          done ? 'bg-primary border-primary' : 'border-outline-variant'
        }`}
        onClick={() => toggleTask(task.id)}
        aria-label={done ? 'علامت‌زدن به‌عنوان انجام‌نشده' : 'علامت‌زدن به‌عنوان انجام‌شده'}
        aria-pressed={done}
      >
        <span className={`text-white transition-opacity ${done ? 'opacity-100' : 'opacity-0'}`}>
          <Icon name="check" size={14} />
        </span>
      </button>
      <div className="flex-1 cursor-pointer" onClick={() => openModal('taskDetail', task.id)}>
        <h3
          className={`text-label-lg font-bold text-on-surface dark:text-inverse-on-surface leading-snug ${
            done ? 'line-through opacity-60' : ''
          }`}
        >
          {task.starred ? (
            <span className="text-amber-500 inline-flex align-[-3px] ml-1" aria-label="مهم (ستاره‌دار)">
              <Icon name="star_filled" size={15} />
            </span>
          ) : null}
          {task.title}
        </h3>
        {/* فاز تریدر — فیلدهای سریع مقدار (عدد/یادداشت/انتخاب/امتیاز) — تیک مستقل می‌ماند */}
        <TaskItemFields task={task} />
        {task.notes ? <p className="text-body-sm text-on-surface-variant mt-0.5">{task.notes}</p> : null}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {SHOW_PRIORITY_BADGE[task.priority] ? (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
          ) : null}
          {task.dueDate ? (
            <span className="text-[11px] text-on-surface-variant flex items-center gap-0.5">
              <Icon name="calendar_today" size={13} />
              {relativeDayLabel(task.dueDate, today)} {faShort(parseIsoDate(task.dueDate))}
            </span>
          ) : null}
          {task.dueTime ? (
            <span className="text-[11px] text-on-surface-variant flex items-center gap-0.5">
              <Icon name="notifications" size={13} />
              {faTime(task.dueTime)}
            </span>
          ) : null}
          {task.repeat !== 'none' ? (
            <span className="text-[11px] text-on-surface-variant flex items-center gap-0.5">
              <Icon name="replay" size={13} />
              {REPEAT_LABEL[task.repeat]}
            </span>
          ) : null}
          {subtaskCount > 0 ? (
            <span className="text-[11px] text-primary flex items-center gap-0.5 font-bold">
              <Icon name="checklist" size={13} />
              {toFa(subtaskDone)}/{toFa(subtaskCount)}
            </span>
          ) : null}
        </div>
      </div>
      <button
        className="text-on-surface-variant"
        onClick={() => openModal('taskDetail', task.id)}
        aria-label="جزئیات کار"
      >
        <Icon name="more_vert" size={20} />
      </button>
      {dragHandle ? (
        <button
          {...dragHandle}
          className="mt-1 text-outline hover:text-on-surface-variant cursor-grab active:cursor-grabbing touch-none"
          title="کشیدن برای تغییر ترتیب"
        >
          <Icon name="drag_indicator" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/** ردیف کار انجام‌شده (آکاردئون) — detail = خلاصه‌ی مقدار آیتم تریدر (اختیاری) */
export function CompletedRow({ title, when, detail }: { title: string; when: string; detail?: string }) {
  return (
    <div className="p-3 bg-surface-container-low dark:bg-slate-800/50 rounded-xl flex items-center justify-between opacity-60">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center text-white shrink-0">
          <Icon name="check" size={13} />
        </div>
        <span className="line-through text-body-sm font-semibold truncate">
          {title}
          {detail ? <span className="text-primary font-bold no-underline"> — {detail}</span> : null}
        </span>
      </div>
      <span className="text-[11px] text-outline shrink-0">{when}</span>
    </div>
  );
}
