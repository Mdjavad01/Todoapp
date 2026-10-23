import type { ListEntity, ListColor, TaskEntity } from '@/types';
import { startOfDay, toIsoDate } from './format';

/** توابع محاسباتی آمار — همه از داده‌ی واقعی IndexedDB */

export function listProgress(tasks: TaskEntity[], listId: string): { total: number; done: number; pending: number; pct: number } {
  const inList = tasks.filter((t) => t.listId === listId);
  const done = inList.filter((t) => t.completedAt).length;
  const total = inList.length;
  const pending = total - done;
  return { total, done, pending, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export interface HomeStats {
  todayTotal: number;
  todayDone: number;
  todayRemaining: number;
  todayPct: number;
  urgentCount: number;
  plannedCount: number;
  allCount: number;
  overdue: TaskEntity[];
  todayTasks: TaskEntity[];
}

export function homeStats(tasks: TaskEntity[], today: Date): HomeStats {
  const todayIso = toIsoDate(today);
  const todayTasks = tasks
    .filter((t) => t.dueDate === todayIso)
    .sort((a, b) => (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'));
  const todayDone = todayTasks.filter((t) => t.completedAt).length;
  const todayTotal = todayTasks.length;
  const overdue = tasks
    .filter((t) => !t.completedAt && t.dueDate !== null && t.dueDate < todayIso)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return {
    todayTotal,
    todayDone,
    todayRemaining: todayTotal - todayDone,
    todayPct: todayTotal === 0 ? 0 : Math.round((todayDone / todayTotal) * 100),
    urgentCount: tasks.filter((t) => !t.completedAt && (t.priority === 'urgent' || t.priority === 'high')).length,
    plannedCount: tasks.filter((t) => !t.completedAt && t.dueDate !== null && t.dueDate > todayIso).length,
    allCount: tasks.filter((t) => !t.completedAt).length,
    overdue,
    todayTasks,
  };
}

/** رنگ نوار پیشرفت هر لیست */
export const LIST_BAR_COLORS: Record<ListColor, string> = {
  teal: 'bg-teal-600',
  amber: 'bg-amber-500',
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  purple: 'bg-purple-600',
};

/** برچسب اولویت + رنگ */
export const PRIORITY_BADGE: Record<TaskEntity['priority'], { label: string; cls: string }> = {
  urgent: { label: 'فوری', cls: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' },
  high: { label: 'بالا', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300' },
  normal: { label: 'متوسط', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  low: { label: 'کم', cls: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300' },
};

export const REPEAT_LABEL: Record<TaskEntity['repeat'], string> = {
  none: 'بدون تکرار',
  daily: 'روزانه',
  weekly: 'هفتگی',
  monthly: 'ماهانه',
};

export interface WeekBar {
  letter: string;
  count: number;
  height: number;
  isToday: boolean;
}

const WEEK_LETTERS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/** نمودار هفته: تعداد کارهای انجام‌شده در هر روز (شنبه تا جمعه) */
export function weekBars(tasks: TaskEntity[], today: Date): WeekBar[] {
  const start = startOfDay(today);
  start.setDate(start.getDate() - ((start.getDay() + 1) % 7)); // شنبه‌ی این هفته
  const counts: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = toIsoDate(d);
    counts.push(tasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) === iso).length);
  }
  const todayIso = toIsoDate(today);
  const isTodayArr: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    isTodayArr.push(toIsoDate(d) === todayIso);
  }
  return counts.map((c, i) => ({
    letter: WEEK_LETTERS[i],
    count: c,
    height: c === 0 ? 8 : Math.min(105, 18 + c * 18),
    isToday: isTodayArr[i],
  }));
}

/** نرخ تکمیل هفته جاری */
export function weekCompletionRate(tasks: TaskEntity[], today: Date): number {
  const start = startOfDay(today);
  start.setDate(start.getDate() - ((start.getDay() + 1) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  const done = tasks.filter(
    (t) => t.completedAt && t.completedAt.slice(0, 10) >= startIso && t.completedAt.slice(0, 10) < endIso,
  ).length;
  const duePending = tasks.filter((t) => !t.completedAt && t.dueDate && t.dueDate >= startIso && t.dueDate < endIso).length;
  const denom = done + duePending;
  return denom === 0 ? 0 : Math.round((done / denom) * 100);
}

/** استریک: روزهای پیاپی منتهی به امروز که حداقل یک کار انجام شده */
export function currentStreak(tasks: TaskEntity[], today: Date): number {
  const doneDays = new Set(tasks.filter((t) => t.completedAt).map((t) => t.completedAt!.slice(0, 10)));
  let streak = 0;
  const d = startOfDay(new Date(today));
  // اگر امروز هنوز کاری انجام نشده، از دیروز شروع می‌شود
  if (!doneDays.has(toIsoDate(d))) d.setDate(d.getDate() - 1);
  while (doneDays.has(toIsoDate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** ترتیب لیست‌ها برای نمایش در خانه */
export function sortedLists(lists: ListEntity[]): ListEntity[] {
  return [...lists].sort((a, b) => a.sortOrder - b.sortOrder);
}

export const GREETING_EMOJI = (hour: number): string =>
  hour < 12 ? '☀️' : hour < 17 ? '🌤️' : hour < 20 ? '🌆' : '🌙';

export const GREETING_TEXT = (hour: number): string =>
  hour < 5 ? 'شب بخیر' : hour < 12 ? 'صبح بخیر' : hour < 17 ? 'ظهر بخیر' : hour < 20 ? 'عصر بخیر' : 'شب بخیر';
