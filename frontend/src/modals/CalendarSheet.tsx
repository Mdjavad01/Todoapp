import { useMemo, useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { buildMonthGrid, toJalali, JALALI_MONTHS, WEEK_HEADER } from '@/lib/jalali';
import { toFa, toIsoDate } from '@/lib/format';

/** مودال ۶: تقویم شمسی — ماه جاری با ناوبری ماه و انتخاب روز */
export function CalendarSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const confirmCalendar = useAppStore((s) => s.confirmCalendar);
  const today = new Date();

  const [cursor, setCursor] = useState(() => {
    const j = toJalali(today);
    return { jy: j.jy, jm: j.jm };
  });
  const [selected, setSelected] = useState<Date>(() => new Date(today));

  const visible = modal === 'calendar';
  const grid = useMemo(() => buildMonthGrid(cursor.jy, cursor.jm, today), [cursor.jy, cursor.jm, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveMonth = (delta: number) => {
    setCursor((c) => {
      let jm = c.jm + delta;
      let jy = c.jy;
      if (jm > 12) {
        jm = 1;
        jy += 1;
      }
      if (jm < 1) {
        jm = 12;
        jy -= 1;
      }
      return { jy, jm };
    });
  };

  const pick = (cell: (typeof grid)[number]) => {
    if (!cell.gregorian) return;
    setSelected(new Date(cell.gregorian));
  };

  const selectToday = () => {
    const j = toJalali(today);
    setCursor({ jy: j.jy, jm: j.jm });
    setSelected(new Date(today));
  };

  const confirm = () => {
    confirmCalendar(toIsoDate(selected));
  };

  return (
    <Sheet open={visible} onClose={() => openModal(null)}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <button
            className="w-8 h-8 rounded-full hover:bg-surface-container dark:bg-slate-800 flex items-center justify-center text-on-surface-variant"
            onClick={() => moveMonth(-1)}
            aria-label="ماه قبل"
          >
            <Icon name="arrow_forward" size={18} />
          </button>
          <h3 className="text-headline-sm font-bold text-on-surface dark:text-inverse-on-surface">
            تقویم شمسی • {JALALI_MONTHS[cursor.jm - 1]} {toFa(String(cursor.jy))}
          </h3>
          <button
            className="w-8 h-8 rounded-full hover:bg-surface-container dark:bg-slate-800 flex items-center justify-center text-on-surface-variant"
            onClick={() => moveMonth(1)}
            aria-label="ماه بعد"
          >
            <Icon name="arrow_back" size={18} />
          </button>
        </div>
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container dark:bg-slate-800"
          onClick={() => openModal(null)}
          aria-label="بستن"
        >
          <Icon name="close" size={24} />
        </button>
      </div>

      {/* سربرگ روزهای هفته شنبه تا جمعه */}
      <div className="grid grid-cols-7 text-center text-xs font-bold text-outline py-1">
        {WEEK_HEADER.map((w, i) => (
          <span key={w} className={i === 6 ? 'text-red-500' : ''}>
            {w}
          </span>
        ))}
      </div>

      {/* شبکه‌ی روزها */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-on-surface dark:text-inverse-on-surface">
        {grid.map((cell, idx) => {
          if (cell.jd === null || !cell.gregorian) {
            return <span key={`x-${idx}`} className="py-2 opacity-30">{toFa(cell.jd ?? '')}</span>;
          }
          const selectedDay = toIsoDate(selected) === toIsoDate(cell.gregorian);
          const isCurrentMonth = toJalali(cell.gregorian).jm === cursor.jm && toJalali(cell.gregorian).jy === cursor.jy;
          if (selectedDay) {
            return (
              <button
                key={`d-${idx}`}
                className="py-2 bg-primary text-on-primary rounded-xl shadow-md"
                onClick={() => pick(cell)}
                aria-current="date"
              >
                {toFa(cell.jd)}
              </button>
            );
          }
          if (!isCurrentMonth) {
            return (
              <span key={`d-${idx}`} className="py-2 opacity-30">
                {toFa(cell.jd)}
              </span>
            );
          }
          return (
            <button
              key={`d-${idx}`}
              className={`py-2 hover:bg-surface-container dark:hover:bg-slate-800 rounded-lg ${
                cell.isFriday ? 'text-red-500' : ''
              } ${cell.isToday ? 'text-primary font-black' : ''}`}
              onClick={() => pick(cell)}
            >
              {toFa(cell.jd)}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          className="flex-1 py-2 bg-surface-container dark:bg-slate-800 rounded-xl text-xs font-bold"
          onClick={selectToday}
        >
          انتخاب امروز
        </button>
        <button
          className="flex-1 py-2 bg-primary text-on-primary rounded-xl text-xs font-bold active:scale-95 transition-transform"
          onClick={confirm}
        >
          تأیید تاریخ
        </button>
      </div>
    </Sheet>
  );
}
