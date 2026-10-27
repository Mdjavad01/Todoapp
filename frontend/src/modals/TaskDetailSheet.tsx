import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { REPEAT_LABEL, PRIORITY_BADGE, sortedLists } from '@/lib/selectors';
import {
  nextOccurrence,
  normalizeRepeatMeta,
  describeRepeat,
  REPEAT_UNITS,
  WEEKDAY_LETTERS,
  type RepeatKind,
  type RepeatMeta,
  type RepeatUnit,
} from '@/lib/repeat';
import { faShort, parseIsoDate, faTime } from '@/lib/format';
import type { TaskEntity } from '@/types';

const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'بدون یادآور' },
  { value: 5, label: '۵ دقیقه قبل' },
  { value: 10, label: '۱۰ دقیقه قبل' },
  { value: 15, label: '۱۵ دقیقه قبل' },
  { value: 30, label: '۳۰ دقیقه قبل' },
  { value: 60, label: '۱ ساعت قبل' },
];

/** فاز ۳ — هفت نوع تکرار (ماهانه/سالانه شمسی + سفارشی) */
const REPEAT_OPTIONS: TaskEntity['repeat'][] = ['none', 'daily', 'workdays', 'weekly', 'monthly', 'yearly', 'custom'];

/** مودال ۵: جزئیات و ویرایش کار — نسخه‌ی کامل فاز ۳:
 *  سررسید+ساعت، اولویت، ستاره، روزهای من، انتقال به لیست، تکرار شمسی با سفارشی، زیرکار حذف/ویرایش.
 *  همه‌ی فیلدها بلافاصله ذخیره می‌شوند؛ فقط عنوان/یادداشت با دکمه‌ی ذخیره. */
export function TaskDetailSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const detailTaskId = useAppStore((s) => s.detailTaskId);
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const subtasks = useAppStore((s) => s.subtasks);
  const myDayIds = useAppStore((s) => s.myDayIds);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const toggleSubtask = useAppStore((s) => s.toggleSubtask);
  const addSubtask = useAppStore((s) => s.addSubtask);
  const deleteSubtask = useAppStore((s) => s.deleteSubtask);
  const renameSubtask = useAppStore((s) => s.renameSubtask);
  const toggleStar = useAppStore((s) => s.toggleStar);
  const toggleMyDay = useAppStore((s) => s.toggleMyDay);
  const showToast = useAppStore((s) => s.showToast);
  const openCalendar = useAppStore((s) => s.openCalendar);

  const task = tasks.find((t) => t.id === detailTaskId) ?? null;
  const list = lists.find((l) => l.id === task?.listId);
  const subs = subtasks.filter((s) => s.taskId === task?.id && !s.deletedAt);
  const inMyDay = task ? myDayIds.includes(task.id) : false;

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [reminder, setReminder] = useState<number | null>(null);
  const [repeat, setRepeat] = useState<TaskEntity['repeat']>('none');
  const [meta, setMeta] = useState<RepeatMeta>({ every: 1, unit: 'day' });
  const [newSub, setNewSub] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editingSubTitle, setEditingSubTitle] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const appSettings = useAppStore((s) => s.appSettings);

  // خواندن صوتی کار (فاز ۴.۵) — با موتور صوتی خود دستگاه؛ بدون هیچ وابستگی خارجی
  // دفاع v10: اگر bootstrap ناقص بود (پاسخ HTML سرور با 200)، اپ نچسبد
  const voiceAvailable =
    !!appSettings.voice?.enabled &&
    appSettings.voice?.provider === 'web_speech' &&
    typeof window !== 'undefined' &&
    'speechSynthesis' in window;

  const stopSpeaking = () => {
    if (voiceAvailable) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  const speak = () => {
    if (!voiceAvailable || !task) return;
    window.speechSynthesis.cancel();
    const text = [task.title, task.notes, ...subs.filter((s) => !s.done).map((s) => s.title)].filter(Boolean).join('. ');
    if (!text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = appSettings.voice.lang || 'fa-IR';
    u.rate = Math.min(2, Math.max(0.5, appSettings.voice.rate || 1));
    u.pitch = Math.min(2, Math.max(0.5, appSettings.voice.pitch || 1));
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    if (!voiceAvailable) return;
    return () => window.speechSynthesis.cancel();
  }, [voiceAvailable]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes);
      setReminder(task.reminderMinutes);
      setRepeat(task.repeat);
      setMeta(normalizeRepeatMeta(task.repeatMeta) ?? { every: 1, unit: 'day' });
      setNewSub('');
      setAddingSub(false);
      setEditingSubId(null);
      setEditingSubTitle('');
    } else {
      stopSpeaking();
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!task) return;
    updateTask(task.id, {
      title: title.trim() || task.title,
      notes,
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

  /* ---------- اعمال فوری فیلدها (فاز ۳) ---------- */

  const applyReminder = (value: number | null) => {
    if (!task) return;
    setReminder(value);
    void updateTask(task.id, { reminderMinutes: value });
  };

  const applyRepeat = (value: TaskEntity['repeat']) => {
    if (!task) return;
    setRepeat(value);
    void updateTask(task.id, { repeat: value, repeatMeta: value === 'custom' ? meta : null });
  };

  const applyRepeatMeta = (next: RepeatMeta) => {
    if (!task) return;
    const clean = normalizeRepeatMeta(next);
    if (!clean) {
      showToast('تنظیم تکرار نامعتبر است (فاصله ۱ تا ۳۶۵)');
      return;
    }
    setMeta(clean);
    void updateTask(task.id, { repeatMeta: clean });
  };

  const previewNext = (): string => {
    if (!task || repeat === 'none') return '';
    const due = nextOccurrence(task.dueDate, repeat as RepeatKind, repeat === 'custom' ? meta : null, new Date());
    return due ? faShort(parseIsoDate(due)) : '';
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

          {/* ردیف ستاره / روزهای من / حذف */}
          <div className="flex gap-2">
            <button
              className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform ${
                task.starred
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
              }`}
              onClick={() => void toggleStar(task.id)}
              aria-pressed={task.starred}
              aria-label={task.starred ? 'برداشتن ستاره' : 'افزودن ستاره (مهم)'}
            >
              <Icon name={task.starred ? 'star_filled' : 'star'} size={17} />
              {task.starred ? 'مهم' : 'ستاره'}
            </button>
            <button
              className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform ${
                inMyDay
                  ? 'bg-primary/15 text-primary'
                  : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
              }`}
              onClick={() => void toggleMyDay(task.id)}
              aria-pressed={inMyDay}
              aria-label={inMyDay ? 'برداشتن از روزهای من' : 'افزودن به روزهای من'}
            >
              <Icon name="today" size={17} />
              {inMyDay ? 'در روزهای من' : 'روزهای من'}
            </button>
          </div>

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

          {voiceAvailable ? (
            <button
              className={`self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold active:scale-95 transition-transform ${
                speaking ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
              }`}
              onClick={() => (speaking ? stopSpeaking() : speak())}
              aria-label={speaking ? 'توقف خواندن' : 'خواندن کار با صدا'}
            >
              <Icon name="mic" size={15} />
              {speaking ? 'توقف خواندن' : 'خواندن کار با صدا'}
            </button>
          ) : null}

          {/* سررسید و ساعت — فاز ۳ */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-outline font-semibold">سررسید:</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${task.dueDate === null ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'}`}
                onClick={() => void updateTask(task.id, { dueDate: null, dueTime: null })}
              >
                بدون تاریخ
              </button>
              <button
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${task.dueDate === toIsoToday() ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'}`}
                onClick={() => void updateTask(task.id, { dueDate: toIsoToday() })}
              >
                امروز
              </button>
              <button
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${task.dueDate === toIsoPlus(1) ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'}`}
                onClick={() => void updateTask(task.id, { dueDate: toIsoPlus(1) })}
              >
                فردا
              </button>
              <button
                className="px-3 py-1.5 rounded-full text-xs font-bold bg-surface-container dark:bg-slate-800 text-on-surface flex items-center gap-1"
                onClick={() => openCalendar('detail')}
                aria-label="انتخاب از تقویم شمسی"
              >
                <Icon name="calendar_today" size={14} />
                تقویم
              </button>
              {task.dueDate ? (
                <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-primary/10 text-primary flex items-center gap-1">
                  <Icon name="event_note" size={14} />
                  {faShort(parseIsoDate(task.dueDate))}
                  {task.dueTime ? ` • ${faTime(task.dueTime)}` : ''}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="time"
                className="bg-surface-container dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold border-0 focus:ring-1 focus:ring-primary outline-none text-on-surface"
                value={task.dueTime ?? ''}
                onChange={(e) => void updateTask(task.id, { dueTime: e.target.value === '' ? null : e.target.value })}
                aria-label="ساعت سررسید"
              />
              {task.dueTime ? (
                <button
                  className="text-xs font-bold text-on-surface-variant px-2 py-1.5"
                  onClick={() => void updateTask(task.id, { dueTime: null })}
                >
                  حذف ساعت
                </button>
              ) : null}
            </div>
          </div>

          {/* اولویت — فاز ۳ (همان برچسب‌های افزودن سریع) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-outline font-semibold">اولویت و فوریت:</span>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="اولویت و فوریت کار">
              {(['urgent', 'high', 'normal', 'low'] as const).map((p) => {
                const m = PRIORITY_BADGE[p];
                const active = task.priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => void updateTask(task.id, { priority: p })}
                    className={`py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 ${
                      active ? `${m.cls} ring-2 ring-current/40` : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
                    }`}
                  >
                    {p === 'urgent' ? <Icon name="priority_high" size={14} /> : null}
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* زیرکارها — با حذف و ویرایش (فاز ۳) */}
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
                <div
                  key={s.id}
                  className="flex items-center gap-2 text-body-sm bg-surface-container-low dark:bg-slate-800/60 p-2 rounded-lg"
                >
                  <input
                    type="checkbox"
                    className="rounded text-primary focus:ring-0"
                    checked={s.done}
                    onChange={() => void toggleSubtask(s.id)}
                    aria-label={`انجام زیرکار ${s.title}`}
                  />
                  {editingSubId === s.id ? (
                    <input
                      className="flex-1 bg-transparent border-0 border-b border-primary/40 text-body-sm outline-none focus:ring-0 text-on-surface"
                      value={editingSubTitle}
                      autoFocus
                      onChange={(e) => setEditingSubTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void renameSubtask(s.id, editingSubTitle);
                          setEditingSubId(null);
                        }
                        if (e.key === 'Escape') setEditingSubId(null);
                      }}
                      onBlur={() => {
                        void renameSubtask(s.id, editingSubTitle);
                        setEditingSubId(null);
                      }}
                      aria-label="ویرایش عنوان زیرکار"
                    />
                  ) : (
                    <span
                      className={`flex-1 cursor-pointer ${s.done ? 'line-through text-outline' : ''}`}
                      onClick={() => {
                        setEditingSubId(s.id);
                        setEditingSubTitle(s.title);
                      }}
                      title="برای ویرایش بزنید"
                    >
                      {s.title}
                    </span>
                  )}
                  <button
                    className="text-outline hover:text-red-600 active:scale-90 transition-transform shrink-0"
                    onClick={() => void deleteSubtask(s.id)}
                    aria-label={`حذف زیرکار ${s.title}`}
                  >
                    <Icon name="delete" size={16} />
                  </button>
                </div>
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

          {/* یادآور */}
          <div className="bg-surface-container dark:bg-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-1 text-body-sm">
            <span className="text-outline text-xs shrink-0">یادآور:</span>
            <select
              className="bg-transparent text-xs font-bold text-primary outline-none border-0 focus:ring-0 cursor-pointer"
              value={reminder === null ? '' : String(reminder)}
              onChange={(e) => applyReminder(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="یادآور"
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value === null ? '' : String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* تکرار — فاز ۳: هفت نوع + ویرایشگر سفارشی */}
          <div className="flex flex-col gap-2">
            <div className="bg-surface-container dark:bg-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-1 text-body-sm">
              <span className="text-outline text-xs shrink-0">تکرار:</span>
              <select
                className="bg-transparent text-xs font-bold outline-none border-0 focus:ring-0 cursor-pointer"
                value={repeat}
                onChange={(e) => applyRepeat(e.target.value as TaskEntity['repeat'])}
                aria-label="تکرار"
              >
                {REPEAT_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {REPEAT_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            {repeat !== 'none' ? (
              <p className="text-[11px] text-on-surface-variant px-1">
                نوبت بعدی بعد از انجام: {repeat === 'custom' ? describeRepeat('custom', meta) : REPEAT_LABEL[repeat]}
                {previewNext() ? ` → ${previewNext()}` : ''}
              </p>
            ) : null}
            {repeat === 'custom' ? (
              <div className="bg-surface-container-low dark:bg-slate-800/60 rounded-xl p-2.5 flex flex-col gap-2 border border-outline-variant/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-outline shrink-0">هر</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="w-16 bg-surface-container dark:bg-slate-800 rounded-lg px-2 py-1 text-xs font-bold border-0 focus:ring-1 focus:ring-primary outline-none text-center text-on-surface"
                    value={meta.every}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 1)));
                      applyRepeatMeta({ ...meta, every: v });
                    }}
                    aria-label="فاصله تکرار"
                  />
                  <select
                    className="flex-1 bg-transparent text-xs font-bold outline-none border-0 focus:ring-0 cursor-pointer"
                    value={meta.unit}
                    onChange={(e) => {
                      const unit = e.target.value as RepeatUnit;
                      applyRepeatMeta({ ...meta, unit, days: unit === 'week' ? (meta.days ?? [jalaliTodayWd()]) : undefined });
                    }}
                    aria-label="واحد تکرار"
                  >
                    {REPEAT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                {meta.unit === 'week' ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-outline">روزهای هفته:</span>
                    <div className="flex gap-1.5" role="group" aria-label="روزهای هفته‌ی تکرار">
                      {WEEKDAY_LETTERS.map((letter, idx) => {
                        const active = (meta.days ?? []).includes(idx);
                        return (
                          <button
                            key={idx}
                            className={`w-8 h-8 rounded-full text-xs font-bold transition-colors ${
                              active ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
                            }`}
                            onClick={() => {
                              const set = new Set(meta.days ?? []);
                              if (set.has(idx)) set.delete(idx);
                              else set.add(idx);
                              if (set.size === 0) {
                                showToast('حداقل یک روز هفته انتخاب کنید');
                                return;
                              }
                              applyRepeatMeta({ ...meta, days: [...set].sort((a, b) => a - b) });
                            }}
                            aria-pressed={active}
                            aria-label={`روز ${letter}`}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {meta.unit === 'month' || meta.unit === 'year' ? (
                  <p className="text-[11px] text-on-surface-variant">بر پایه‌ی تقویم شمسی؛ روز ۳۱ در ماه‌های کوتاه‌تر به آخرین روز می‌چسبد.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* انتقال به لیست — فاز ۳ */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-outline font-semibold">انتقال به لیست:</span>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {sortedLists(lists.filter((l) => !l.deletedAt)).map((l) => {
                const active = l.id === task.listId;
                return (
                  <button
                    key={l.id}
                    className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer shrink-0 transition-colors ${
                      active ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant'
                    }`}
                    onClick={() => {
                      if (!active) {
                        void updateTask(task.id, { listId: l.id });
                        showToast(`به «${l.name}» منتقل شد`);
                      }
                    }}
                  >
                    {l.emoji} {l.name}
                  </button>
                );
              })}
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
              ذخیره عنوان و یادداشت
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

/* ---------- ابزار تاریخ محلی جزئیات ---------- */

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toIsoToday(): string {
  return isoOf(new Date());
}

function toIsoPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** ایندکس روز هفته‌ی شمسی امروز — پیش‌فرض ویرایشگر سفارشی هفتگی */
function jalaliTodayWd(): number {
  return (new Date().getDay() + 1) % 7;
}
