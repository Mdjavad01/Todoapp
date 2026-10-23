import { create } from 'zustand';
import type { ListEntity, TaskEntity, SubtaskEntity, ViewName, ListColor, TemplateDef } from '@/types';
import * as repo from '@/db/repo';
import { ensureSeeded } from '@/db/seed';
import { toIsoDate } from '@/lib/format';
import { queueSync, runSync, setSyncListeners, startSyncLoop, type SyncState } from '@/sync/engine';
import { getSession, type SyncSession } from '@/sync/session';
import { refreshSession } from '@/sync/api';
import * as auth from '@/sync/auth';

export type AccentColor = Extract<ListColor, 'teal' | 'indigo' | 'amber' | 'emerald' | 'rose' | 'purple'>;
export type ModalName = 'quickAdd' | 'taskDetail' | 'calendar' | 'newList' | null;
export type CalendarTarget = 'quickAdd' | 'hub' | null;

/** نگاشت اکسنت به مقادیر RGB برای متغیرهای CSS */
export const ACCENTS: Record<AccentColor, { label: string; primary: string; container: string; fixed: string; dim: string; deep: string }> = {
  teal: { label: 'فیروزه‌ای', primary: '0 104 95', container: '0 131 120', fixed: '137 245 231', dim: '107 216 203', deep: '17 94 89' },
  indigo: { label: 'نیلی', primary: '79 70 229', container: '99 102 241', fixed: '165 180 252', dim: '129 140 248', deep: '49 46 129' },
  amber: { label: 'کهربایی', primary: '217 119 6', container: '245 158 11', fixed: '253 230 138', dim: '251 191 36', deep: '146 64 14' },
  emerald: { label: 'زمردی', primary: '5 150 105', container: '16 185 129', fixed: '167 243 208', dim: '110 231 183', deep: '6 95 70' },
  rose: { label: 'سرخابی', primary: '225 29 72', container: '244 63 94', fixed: '254 205 211', dim: '253 164 175', deep: '159 18 57' },
  purple: { label: 'بنفش', primary: '147 51 234', container: '168 85 247', fixed: '233 213 255', dim: '192 132 252', deep: '88 28 135' },
};

interface AppState {
  ready: boolean;
  lists: ListEntity[];
  tasks: TaskEntity[];
  subtasks: SubtaskEntity[];
  view: ViewName;
  activeListId: string | null;
  dark: boolean;
  accent: AccentColor;
  biometricLock: boolean;
  alerts: boolean;
  userName: string;
  modal: ModalName;
  detailTaskId: string | null;
  calendarTarget: CalendarTarget;
  pendingDate: string | null; // تاریخ انتخابی برای کار جدید
  toast: { id: number; text: string } | null;
  completedExpanded: boolean;
  searchQuery: string;
  searchFilter: string;
  accountSheet: boolean;
  session: SyncSession | null;
  syncState: SyncState;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setView(v: ViewName): void;
  openList(id: string): void;
  goHome(): void;

  openAccountSheet(): void;
  reloadSession(): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): Promise<void>;

  setDark(d: boolean): void;
  setAccent(a: AccentColor): void;
  setPref(key: 'biometricLock' | 'alerts', value: boolean): void;

  openModal(m: ModalName, taskId?: string | null): void;
  openCalendar(target: CalendarTarget): void;
  confirmCalendar(dateIso: string): void;
  showToast(text: string): void;
  clearToast(): void;
  toggleCompletedAccordion(): void;
  setSearch(q: string, filter?: string): void;

  toggleTask(id: string): Promise<void>;
  addQuickTask(input: { title: string; listId: string; dueDate: string | null }): Promise<void>;
  addInlineTask(listId: string, title: string): Promise<void>;
  updateTask(id: string, patch: Partial<Pick<TaskEntity, 'title' | 'notes' | 'priority' | 'dueDate' | 'dueTime' | 'reminderMinutes' | 'repeat'>>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  moveOverdueToToday(): Promise<void>;
  toggleSubtask(id: string): Promise<void>;
  addSubtask(taskId: string, title: string): Promise<void>;
  createList(name: string, emoji: string): Promise<void>;
  applyTemplate(tpl: TemplateDef): Promise<void>;
}

function applyAccent(a: AccentColor): void {
  const v = ACCENTS[a] ?? ACCENTS.teal;
  const root = document.documentElement;
  root.style.setProperty('--karam-primary-rgb', v.primary);
  root.style.setProperty('--karam-primary-container-rgb', v.container);
  root.style.setProperty('--karam-primary-fixed-rgb', v.fixed);
  root.style.setProperty('--karam-primary-fixed-dim-rgb', v.dim);
  root.style.setProperty('--karam-primary-deep-rgb', v.deep);
}

function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  lists: [],
  tasks: [],
  subtasks: [],
  view: 'home',
  activeListId: null,
  dark: false,
  accent: 'teal',
  biometricLock: true,
  alerts: true,
  userName: 'علی',
  modal: null,
  detailTaskId: null,
  calendarTarget: null,
  pendingDate: null,
  toast: null,
  completedExpanded: false,
  searchQuery: '',
  searchFilter: 'all',
  accountSheet: false,
  session: null,
  syncState: { status: 'idle', lastSyncAt: null, error: null },

  async init() {
    await ensureSeeded();
    await get().refresh();
    const [dark, accent, biometric, alerts, userName] = await Promise.all([
      repo.prefsGet<boolean>('theme-dark', false),
      repo.prefsGet<AccentColor>('accent', 'teal'),
      repo.prefsGet<boolean>('biometricLock', true),
      repo.prefsGet<boolean>('alerts', true),
      repo.prefsGet<string>('userName', 'علی'),
    ]);
    set({ dark, accent, biometricLock: biometric, alerts, userName });
    applyDark(dark);
    applyAccent(accent);

    // اتصال موتور سینک به store (فاز ۲)
    setSyncListeners({
      onState: (syncState) => useAppStore.setState({ syncState }),
      onApplied: () => {
        void useAppStore.getState().refresh();
      },
    });
    startSyncLoop();
    await get().reloadSession();
    // اگر access نزدیک انقضاست همین‌جا تمدید می‌شود (فاز ۳)
    if (get().session) void refreshSession().then(() => get().reloadSession());

    set({ ready: true });
  },

  async refresh() {
    const [lists, tasks, subtasks] = await Promise.all([repo.listsAll(), repo.tasksAll(), repo.subtasksAll()]);
    set({ lists, tasks, subtasks });
  },

  setView(v) {
    set({ view: v });
  },

  openList(id) {
    set({ view: 'listView', activeListId: id, completedExpanded: false });
  },

  goHome() {
    set({ view: 'home', activeListId: null });
  },

  openAccountSheet() {
    set({ accountSheet: true });
  },

  async reloadSession() {
    const session = await getSession();
    set({ session });
    if (session) void runSync();
  },

  async signOut() {
    await auth.logout();
    set({ session: null, syncState: { status: 'idle', lastSyncAt: null, error: null } });
  },

  async syncNow() {
    await runSync();
  },

  setDark(dark) {
    set({ dark });
    applyDark(dark);
    void repo.prefsSet('theme-dark', dark);
  },

  setAccent(accent) {
    set({ accent });
    applyAccent(accent);
    void repo.prefsSet('accent', accent);
  },

  async setPref(key, value) {
    set({ [key]: value } as Partial<AppState>);
    await repo.prefsSet(key === 'biometricLock' ? 'biometricLock' : 'alerts', value);
  },

  openModal(modal, taskId = null) {
    if (modal === 'quickAdd') set({ pendingDate: null });
    set({ modal, detailTaskId: modal === 'taskDetail' ? taskId : null });
  },

  async createList(name, emoji) {
    if (!name.trim()) return;
    await repo.listsCreate({ name: name.trim(), emoji, color: 'teal' });
    await get().refresh();
    queueSync();
    set({ modal: null });
    get().showToast(`لیست «${name.trim()}» ساخته شد`);
  },

  openCalendar(target) {
    set({ calendarTarget: target, modal: 'calendar' });
  },

  confirmCalendar(dateIso) {
    const target = get().calendarTarget;
    if (target === 'quickAdd') set({ pendingDate: dateIso, modal: 'quickAdd', calendarTarget: null });
    else set({ modal: null, calendarTarget: null });
  },

  showToast(text) {
    const id = Date.now();
    set({ toast: { id, text } });
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3200);
  },

  clearToast() {
    set({ toast: null });
  },

  toggleCompletedAccordion() {
    set({ completedExpanded: !get().completedExpanded });
  },

  setSearch(q, filter) {
    if (filter !== undefined) set({ searchFilter: filter });
    set({ searchQuery: q });
  },

  async toggleTask(id) {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    await repo.tasksToggleComplete(id, !task.completedAt);
    await get().refresh();
    queueSync();
  },

  async addQuickTask({ title, listId, dueDate }) {
    if (!title.trim()) return;
    // تشخیص ساده‌ی ساعت از متن
    const timeMatch = title.match(/(?:ساعت\s*)([۰-۹0-9]{1,2})\s*[:：]\s*([۰-۹0-9]{2})/);
    let dueTime: string | null = null;
    let cleanTitle = title;
    if (timeMatch) {
      const lat = (s: string) => s.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
      dueTime = `${lat(timeMatch[1]).padStart(2, '0')}:${lat(timeMatch[2])}`;
      cleanTitle = title.replace(timeMatch[0], '').trim();
    }
    await repo.tasksCreate({
      listId,
      title: cleanTitle || title,
      dueDate,
      dueTime,
    });
    await get().refresh();
    queueSync();
    set({ modal: null, pendingDate: null });
    get().showToast(`کار «${cleanTitle || title}» افزوده شد ✨`);
  },

  async addInlineTask(listId, title) {
    if (!title.trim()) return;
    await repo.tasksCreate({ listId, title: title.trim(), dueDate: toIsoDate(new Date()) });
    await get().refresh();
    queueSync();
    get().showToast('کار جدید به لیست افزوده شد');
  },

  async updateTask(id, patch) {
    await repo.tasksUpdate(id, patch);
    await get().refresh();
    queueSync();
  },

  async deleteTask(id) {
    await repo.tasksSoftDelete(id);
    await get().refresh();
    queueSync();
    set({ modal: null, detailTaskId: null });
    get().showToast('کار حذف شد');
  },

  async moveOverdueToToday() {
    const today = toIsoDate(new Date());
    const overdue = get().tasks.filter(
      (t) => !t.completedAt && t.dueDate && t.dueDate < today,
    );
    for (const t of overdue) {
      await repo.tasksUpdate(t.id, { dueDate: today });
    }
    await get().refresh();
    if (overdue.length > 0) queueSync();
    get().showToast(`${overdue.length} کار معوقه به امروز منتقل شد`);
  },

  async toggleSubtask(id) {
    const sub = get().subtasks.find((s) => s.id === id);
    if (!sub) return;
    await repo.subtasksUpdate(id, { done: !sub.done });
    await get().refresh();
    queueSync();
  },

  async addSubtask(taskId, title) {
    if (!title.trim()) return;
    await repo.subtasksCreate(taskId, title.trim());
    await get().refresh();
    queueSync();
  },

  async applyTemplate(tpl) {
    // اگر لیستی با همین نام هست، آیتم‌ها به همان اضافه می‌شود؛ وگرنه لیست جدید ساخته می‌شود
    const existing = get().lists.find((l) => l.name === tpl.listName);
    const list = existing ?? (await repo.listsCreate({ name: tpl.listName, emoji: tpl.emoji, color: tpl.color }));
    for (const item of tpl.items) {
      await repo.tasksCreate({ listId: list.id, title: item, priority: 'normal' });
    }
    await get().refresh();
    queueSync();
    set({ activeListId: list.id, view: 'listView' });
    get().showToast(`قالب «${tpl.title}» به لیست‌های شما افزوده شد!`);
  },
}));
