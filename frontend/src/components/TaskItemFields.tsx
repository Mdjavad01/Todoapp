import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';
import { CHOICE_VALUES, type TaskEntity, type TaskItemChoice } from '@/types';

/** فاز تریدر — برچسب فارسی گزینه‌های «انتخاب» */
const CHOICE_LABELS: Record<TaskItemChoice, string> = { yes: 'بله', partial: 'تا حدی', no: 'نه' };

/**
 * فیلدهای سریع مقدار آیتم چک‌لیست تریدر (عدد/یادداشت/انتخاب/امتیاز).
 *  - عدد: کیبورد عددی (inputMode=decimal) — ذخیره در blur/Enter
 *  - یادداشت کوتاه: ذخیره در blur/Enter
 *  - انتخاب و امتیاز: کلیک = ذخیره فوری؛ کلیک روی انتخاب فعال = پاک‌کردن
 * هیچ‌کدام از این فیلدها تیک را عوض نمی‌کنند — تیک همان چک‌باکس اصلی است.
 */
export function TaskItemFields({ task }: { task: TaskEntity }) {
  const updateTaskValue = useAppStore((s) => s.updateTaskValue);
  const type = task.itemType ?? 'check';
  const [draft, setDraft] = useState(task.itemValue ?? '');

  // هم‌گام با رکورد واقعی (بعد از سینک/بازیابی/تغییر از جزئیات)
  useEffect(() => {
    setDraft(task.itemValue ?? '');
  }, [task.id, task.itemValue]);

  if (type === 'check') return null;

  const save = (v: string | null) => {
    const clean = v === null || v.trim() === '' ? null : v.trim().slice(0, 255);
    if ((task.itemValue ?? null) !== clean) void updateTaskValue(task.id, { itemValue: clean });
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (type === 'num' || type === 'note') {
    const numeric = type === 'num';
    return (
      <div className="mt-1.5" onClick={stop}>
        <input
          type="text"
          inputMode={numeric ? 'decimal' : 'text'}
          className={`w-full max-w-xs px-2.5 py-1.5 rounded-lg bg-surface-container dark:bg-slate-700 text-body-sm border border-outline-variant/40 focus:border-primary outline-none text-on-surface dark:text-inverse-on-surface placeholder:text-outline`}
          placeholder={numeric ? 'عدد…' : 'یادداشت کوتاه…'}
          value={draft}
          aria-label={numeric ? 'مقدار عددی' : 'یادداشت کوتاه'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    );
  }

  if (type === 'choice') {
    const current = (task.itemValue ?? '') as TaskItemChoice | '';
    return (
      <div className="mt-2 flex items-center gap-1.5" onClick={stop} role="group" aria-label="انتخاب پاسخ">
        {CHOICE_VALUES.map((v) => {
          const active = current === v;
          return (
            <button
              key={v}
              className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                active
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant border-outline-variant/40 hover:border-primary/50'
              }`}
              onClick={() => save(active ? null : v)}
              aria-pressed={active}
            >
              {CHOICE_LABELS[v]}
            </button>
          );
        })}
      </div>
    );
  }

  // score — ۱ تا ۱۰
  const currentScore = task.itemValue ?? '';
  return (
    <div className="mt-2 flex items-center gap-1 flex-wrap" onClick={stop} role="group" aria-label="امتیاز از ۱ تا ۱۰">
      <span className="text-[10px] text-outline ml-0.5">امتیاز:</span>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const active = currentScore === String(n);
        return (
          <button
            key={n}
            className={`w-7 h-7 rounded-lg text-[11px] font-bold border transition-colors ${
              active
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant border-outline-variant/40 hover:border-primary/50'
            }`}
            onClick={() => save(active ? null : String(n))}
            aria-pressed={active}
            aria-label={`امتیاز ${toFa(n)}`}
          >
            {toFa(n)}
          </button>
        );
      })}
    </div>
  );
}

/** خلاصه‌ی مقدار آیتم برای نمایش در تاریخچه/ردیف انجام‌شده */
export function itemValueSummary(task: TaskEntity): string | null {
  const type = task.itemType ?? 'check';
  const v = task.itemValue;
  if (!v) return null;
  if (type === 'choice') {
    const c = v as TaskItemChoice;
    return CHOICE_LABELS[c] ?? v;
  }
  if (type === 'score') return `امتیاز ${toFa(Number(v) || v)}`;
  return toFa(v);
}
