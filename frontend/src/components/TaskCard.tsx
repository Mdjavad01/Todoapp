import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';
import { relativeDayLabel, faShort, faTime, parseIsoDate, toFa } from '@/lib/format';
import { PRIORITY_BADGE, REPEAT_LABEL } from '@/lib/selectors';
import type { TaskEntity } from '@/types';

/** کارت کار — دقیقاً مطابق طرح (بخش ۳) */
export function TaskCard({ task, subtaskCount, subtaskDone }: { task: TaskEntity; subtaskCount: number; subtaskDone: number }) {
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
          {task.title}
        </h3>
        {task.notes ? <p className="text-body-sm text-on-surface-variant mt-0.5">{task.notes}</p> : null}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
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
    </div>
  );
}

/** ردیف کار انجام‌شده (آکاردئون) */
export function CompletedRow({ title, when }: { title: string; when: string }) {
  return (
    <div className="p-3 bg-surface-container-low dark:bg-slate-800/50 rounded-xl flex items-center justify-between opacity-60">
      <div className="flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center text-white">
          <Icon name="check" size={13} />
        </div>
        <span className="line-through text-body-sm font-semibold">{title}</span>
      </div>
      <span className="text-[11px] text-outline">{when}</span>
    </div>
  );
}
