import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { REPEAT_LABEL } from '@/lib/selectors';
import type { TaskEntity } from '@/types';

const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'بدون یادآور' },
  { value: 5, label: '۵ دقیقه قبل' },
  { value: 10, label: '۱۰ دقیقه قبل' },
  { value: 15, label: '۱۵ دقیقه قبل' },
  { value: 30, label: '۳۰ دقیقه قبل' },
  { value: 60, label: '۱ ساعت قبل' },
];

const REPEAT_OPTIONS: TaskEntity['repeat'][] = ['none', 'daily', 'weekly', 'monthly'];

/** مودال ۵: جزئیات و ویرایش کار */
export function TaskDetailSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const detailTaskId = useAppStore((s) => s.detailTaskId);
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const subtasks = useAppStore((s) => s.subtasks);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const toggleSubtask = useAppStore((s) => s.toggleSubtask);
  const addSubtask = useAppStore((s) => s.addSubtask);

  const task = tasks.find((t) => t.id === detailTaskId) ?? null;
  const list = lists.find((l) => l.id === task?.listId);
  const subs = subtasks.filter((s) => s.taskId === task?.id);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [reminder, setReminder] = useState<number | null>(null);
  const [repeat, setRepeat] = useState<TaskEntity['repeat']>('none');
  const [newSub, setNewSub] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes);
      setReminder(task.reminderMinutes);
      setRepeat(task.repeat);
      setNewSub('');
      setAddingSub(false);
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!task) return;
    updateTask(task.id, {
      title: title.trim() || task.title,
      notes,
      reminderMinutes: reminder,
      repeat,
    });
    openModal(null);
  };

  const remove = () => {
    if (!task) return;
    if (window.confirm('آیا از حذف این کار اطمینان دارید؟')) {
      deleteTask(task.id);
    }
  };

  const submitSub = () => {
    if (!task || !newSub.trim()) return;
    addSubtask(task.id, newSub);
    setNewSub('');
  };

  return (
    <Sheet open={modal === 'taskDetail' && !!task} onClose={() => openModal(null)} maxHeight="92%">
      {task ? (
        <>
          <SheetHeader
            title={
              <span className="text-xs font-bold text-primary px-2.5 py-0.5 rounded-full bg-primary/10">
                {list?.emoji} {list?.name}
              </span>
            }
            onClose={() => openModal(null)}
          />

          <input
            className="text-headline-md font-bold bg-transparent border-0 border-b border-outline-variant/30 text-on-surface dark:text-inverse-on-surface focus:ring-0 p-1 outline-none"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="عنوان کار"
          />
          <textarea
            className="bg-surface-container dark:bg-slate-800 rounded-xl p-3 text-body-sm border-0 focus:ring-1 focus:ring-primary outline-none resize-none text-on-surface dark:text-inverse-on-surface placeholder:text-outline"
            placeholder="یادداشت و توضیحات تکمیلی..."
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="یادداشت"
          />

          {/* زیرکارها */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-label-md font-bold">
              <span>زیرکارها (Subtasks)</span>
              <button
                className="text-xs text-primary font-bold flex items-center gap-0.5"
                onClick={() => setAddingSub(true)}
              >
                <Icon name="add" size={16} /> افزودن
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {subs.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-body-sm bg-surface-container-low dark:bg-slate-800/60 p-2 rounded-lg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="rounded text-primary focus:ring-0"
                    checked={s.done}
                    onChange={() => toggleSubtask(s.id)}
                  />
                  <span className={s.done ? 'line-through text-outline' : ''}>{s.title}</span>
                </label>
              ))}
              {addingSub ? (
                <div className="flex items-center gap-1.5">
                  <input
                    className="flex-1 bg-surface-container dark:bg-slate-800 rounded-lg px-2 py-1.5 text-body-sm border-0 focus:ring-1 focus:ring-primary outline-none"
                    placeholder="عنوان زیرکار جدید..."
                    value={newSub}
                    onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitSub();
                      if (e.key === 'Escape') setAddingSub(false);
                    }}
                    autoFocus
                  />
                  <button
                    className="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0"
                    onClick={submitSub}
                    aria-label="افزودن زیرکار"
                  >
                    <Icon name="check" size={16} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* یادآور و تکرار */}
          <div className="grid grid-cols-2 gap-2 text-body-sm">
            <div className="bg-surface-container dark:bg-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-1">
              <span className="text-outline text-xs shrink-0">یادآور:</span>
              <select
                className="bg-transparent text-xs font-bold text-primary outline-none border-0 focus:ring-0 cursor-pointer"
                value={reminder === null ? '' : String(reminder)}
                onChange={(e) => setReminder(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="یادآور"
              >
                {REMINDER_OPTIONS.map((o) => (
                  <option key={String(o.value)} value={o.value === null ? '' : String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="bg-surface-container dark:bg-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-1">
              <span className="text-outline text-xs shrink-0">تکرار:</span>
              <select
                className="bg-transparent text-xs font-bold outline-none border-0 focus:ring-0 cursor-pointer"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as TaskEntity['repeat'])}
                aria-label="تکرار"
              >
                {REPEAT_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {REPEAT_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* اقدامات */}
          <div className="flex gap-2 pt-2 pb-2">
            <button
              className="flex-1 py-2.5 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition-transform"
              onClick={remove}
            >
              <Icon name="delete" size={18} />
              <span>حذف کار</span>
            </button>
            <button
              className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-xs active:scale-95 transition-transform"
              onClick={save}
            >
              ذخیره تغییرات
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
