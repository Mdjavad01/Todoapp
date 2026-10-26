import { create } from 'zustand';
import type { ListEntity, TaskEntity, SubtaskEntity, ViewName, ListColor, TemplateDef, JobKitDef } from '@/types';
import * as repo from '@/db/repo';
import { ensureSeeded } from '@/db/seed';
import { toIsoDate } from '@/lib/format';
import { queueSync, runSync, setSyncListeners, startSyncLoop, type SyncState } from '@/sync/engine';
import { getSession, type SyncSession } from '@/sync/session';
import { refreshSession } from '@/sync/api';
import * as auth from '@/sync/auth';
import * as payments from '@/sync/payments';

export type AccentColor = Extract<ListColor, 'teal' | 'indigo' | 'amber' | 'emerald' | 'rose' | 'purple'>;
export type FontScale = 'small' | 'medium' | 'large';
export type ModalName = 'quickAdd' | 'taskDetail' | 'calendar' | 'newList' | null;
export type CalendarTarget = 'quickAdd' | 'hub' | null;

/** تنظیمات عمومی سرور (از /api/v1/bootstrap) — آفلاین با پیش‌فرض‌ها */
export interface AppSettings {
  appName: string;
  paywallTitle: string;
  minAppVersion: string;
  maintenance: boolean;
  voice: { enabled: boolean; provider: 'off' | 'web_speech'; rate: number; pitch: number; lang: string };
  channels: { email: boolean; telegram: boolean; sms: boolean; botUsername: string } | null;
}

/** وضعیت اشتراک پرو (فاز ۵ — از /api/v1/me/subscription) */
export interface PremiumState {
  loaded: boolean;
  isPremium: boolean;
  lifetime: boolean;
  daysLeft: number | null;
  plan: { code: string; title: string } | null;
}

/** نگاشت اکسنت به مقادیر RGB برای متغیرهای CSS */
export const ACCENTS: Record<AccentColor, { label: string; primary: string; container: string; fixed: string; dim: string; deep: string }> = {
  teal: { label: 'فیروزه‌ای', primary: '0 104 95', container: '0 131 120', fixed: '137 245 231', dim: '107 216 203', deep: '17 94 89' },
  indigo: { label: 'نیلی', primary: '79 70 229', container: '99 102 241', fixed: '165 180 252', dim: '129 140 248', deep: '49 46 129' },
  amber: { label: 'کهربایی', primary: '217 119 6', container: '245 158 11', fixed: '253 230 138', dim: '251 191 36', deep: '146 64 14' },
  emerald: { label: 'زمردی', primary: '5 150 105', container: '16 185 129', fixed: '167 243 208', dim: '110 231 183', deep: '6 95 70' },
  rose: { label: 'صورتی', primary: '190 24 93', container: '219 39 119', fixed: '251 207 232', dim: '249 168 212', deep: '131 24 67' },
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
  fontScale: FontScale;
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
  genderSheet: boolean;
  /** راهنمای کارام (v11) — پاپ‌آپ مرکزی با پرسش‌های پرتکرار */
  guideSheet: boolean;
  /** تور تعاملی مرحله‌به‌مرحله (v12) — توولتیپ روی المان‌های واقعی اپ */
  tourOpen: boolean;
  /** آنبوردینگ کامل (v10) — خوش‌آمد + نام + ظاهر؛ بعد از اولین ورود */
  welcomeSheet: boolean;
  /** حباب راهنمای «اولین کار» (v10) — بالای دکمه‌ی + تا اولین افزودن یا بستن */
  coachAdd: boolean;
  appSettings: AppSettings;
  session: SyncSession | null;
  syncState: SyncState;
  premium: PremiumState;
  /** سفارشی که بعد از بازگشت از درگاه باید نتیجه‌اش نشان داده شود (فاز ۵) */
  paymentResult: string | null;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setView(v: ViewName): void;
  openList(id: string): void;
  goHome(): void;

  openAccountSheet(): void;
  openGenderSheet(): void;
  /** باز کردن پاپ‌آپ راهنمای کارام (v11) */
  openGuideSheet(): void;
  /** شروع تور تعاملی (v12) — شیت راهنما و حباب آموزشی بسته می‌شوند */
  openTour(): void;
  /** ثبت نام کاربر — محلی + پروفایل سرور در صورت ورود (v10 آنبوردینگ) */
  saveDisplayName(name: string): Promise<void>;
  /** بستن حباب راهنمای اولین کار — دیگر نمایش داده نمی‌شود */
  dismissCoachAdd(): void;
  reloadSession(): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): Promise<void>;
  reloadPremium(): Promise<void>;
  clearPaymentResult(): void;
  /** فاز ۶ — تنظیم نتیجه‌ی پرداخت در جریان بومی (بدون پارامتر URL) */
  setPaymentResult(orderUuid: string | null): void;

  setDark(d: boolean): void;
  setAccent(a: AccentColor): void;
  setFontScale(f: FontScale): void;
  setPref(key: 'biometricLock' | 'alerts', value: boolean): void;

  openModal(m: ModalName, taskId?: string | null): void;
  openCalendar(target: CalendarTarget): void;
  confirmCalendar(dateIso: string): void;
  showToast(text: string): void;
  clearToast(): void;
  toggleCompletedAccordion(): void;
  setSearch(q: string, filter?: string): void;

  toggleTask(id: string): Promise<void>;
  addQuickTask(input: { title: string; listId: string; dueDate: string | null; dueTime?: string | null; titleText?: string; priority?: TaskEntity['priority'] }): Promise<void>;
  addInlineTask(listId: string, title: string): Promise<void>;
  updateTask(id: string, patch: Partial<Pick<TaskEntity, 'title' | 'notes' | 'priority' | 'dueDate' | 'dueTime' | 'reminderMinutes' | 'repeat'>>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  moveOverdueToToday(): Promise<void>;
  toggleSubtask(id: string): Promise<void>;
  addSubtask(taskId: string, title: string): Promise<void>;
  createList(name: string, emoji: string): Promise<void>;
  applyTemplate(tpl: TemplateDef): Promise<void>;
  applyJobKit(kit: JobKitDef): Promise<void>;
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

/** اندازه‌ی فونت اپ — کلاس روی html اعمال می‌شود (CSS مقیاس توکن‌های تایپوگرافی را عوض می‌کند) */
function applyFontScale(f: FontScale): void {
  const root = document.documentElement;
  root.classList.toggle('font-small', f === 'small');
  root.classList.toggle('font-large', f === 'large');
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
  fontScale: 'medium',
  biometricLock: true,
  alerts: true,
  userName: '',
  modal: null,
  detailTaskId: null,
  calendarTarget: null,
  pendingDate: null,
  toast: null,
  completedExpanded: false,
  searchQuery: '',
  searchFilter: 'all',
  accountSheet: false,
  genderSheet: false,
  guideSheet: false,
  tourOpen: false,
  welcomeSheet: false,
  coachAdd: false,
  appSettings: {
    appName: 'کارام',
    paywallTitle: 'کارام پرو',
    minAppVersion: '1.0.0',
    maintenance: false,
    voice: { enabled: false, provider: 'off', rate: 1, pitch: 1, lang: 'fa-IR' },
    channels: null,
  },
  session: null,
  syncState: { status: 'idle', lastSyncAt: null, error: null },
  premium: { loaded: false, isPremium: false, lifetime: false, daysLeft: null, plan: null },
  paymentResult: null,

  async init() {
    await ensureSeeded();
    await get().refresh();
    const [dark, accent, biometric, alerts, savedName, fontScale, coachSeen, welcomeDone] = await Promise.all([
      repo.prefsGet<boolean>('theme-dark', false),
      repo.prefsGet<AccentColor>('accent', 'teal'),
      repo.prefsGet<boolean>('biometricLock', true),
      repo.prefsGet<boolean>('alerts', true),
      repo.prefsGet<string>('userName', ''),
      repo.prefsGet<FontScale>('fontScale', 'medium'),
      // v10 — حباب راهنمای اولین کار و وضعیت آنبوردینگ کامل
      repo.prefsGet<boolean>('coach-add-seen', false),
      repo.prefsGet<string>('welcome-done', 'none'),
    ]);
    // مهاجرت یک‌باره: اسم پیش‌فرض جعلی نسخه‌های قبل پاک می‌شود (نام واقعی از پروفایل کاربر می‌آید)
    const userName = savedName === 'علی' ? '' : savedName;
    if (savedName === 'علی') {
      void repo.prefsSet('userName', '');
    }
    set({ dark, accent, fontScale, biometricLock: biometric, alerts, userName, coachAdd: !coachSeen });
    applyDark(dark);
    applyAccent(accent);
    applyFontScale(fontScale);

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

    // آنبوردینگ کامل (v10) — نشست فعال بدون نام و بدون تکمیل آنبوردینگ قبلی
    {
      const sess = get().session;
      const hasName = !!sess?.displayName?.trim() || !!userName.trim();
      if (sess && !hasName && welcomeDone === 'none') set({ welcomeSheet: true });
    }

    // تنظیمات عمومی سرور (فاز ۴.۵) — در نبود شبکه با پیش‌فرض‌ها ادامه می‌دهیم
    try {
      const bs = await auth.fetchBootstrap();
      // دفاع v10: اگر پاسخ JSON معتبرِ بوت‌استرپ نبود (مثلاً صفحه‌ی HTML با کد 200)، پیش‌فرض‌ها می‌مانند
      if (bs && bs.voice && typeof bs.voice.enabled === 'boolean') {
        useAppStore.setState({ appSettings: bs });
      }
    } catch {
      /* آفلاین — پیش‌فرض‌ها */
    }

    // بازگشت از درگاه پرداخت (فاز ۵) — ?payResult={orderUuid}&state=…
    try {
      const params = new URLSearchParams(window.location.search);
      const payResult = params.get('payResult');
      if (payResult) {
        params.delete('payResult');
        params.delete('state');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
        if (get().session) void get().reloadPremium();
        set({ view: 'paywall', paymentResult: payResult });
      }
    } catch {
      /* محیط بدون history — نادیده */
    }

    // وضعیت اشتراک (فاز ۵) — اگر وارد شده باشد
    if (get().session) void get().reloadPremium();

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

  openGenderSheet() {
    set({ genderSheet: true });
  },

  openGuideSheet() {
    set({ guideSheet: true });
  },

  openTour() {
    if (get().coachAdd) get().dismissCoachAdd();
    set({ tourOpen: true, guideSheet: false });
  },

  async saveDisplayName(name) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!clean) return;
    set({ userName: clean });
    await repo.prefsSet('userName', clean);
    if (get().session) {
      try {
        await auth.updateProfile(clean);
        await get().reloadSession();
      } catch {
        /* آفلاین — نام محلی ذخیره شد؛ با سینک بعدی پروفایل هم به‌روز می‌شود */
      }
    }
  },

  dismissCoachAdd() {
    if (!get().coachAdd) return;
    set({ coachAdd: false });
    void repo.prefsSet('coach-add-seen', true);
  },

  async reloadSession() {
    const session = await getSession();
    set({ session });
    if (session) void runSync();
  },

  async signOut() {
    await auth.logout();
    set({
      session: null,
      syncState: { status: 'idle', lastSyncAt: null, error: null },
      premium: { loaded: false, isPremium: false, lifetime: false, daysLeft: null, plan: null },
      paymentResult: null,
    });
  },

  async syncNow() {
    await runSync();
  },

  async reloadPremium() {
    if (!get().session) {
      set({ premium: { loaded: false, isPremium: false, lifetime: false, daysLeft: null, plan: null } });
      return;
    }
    try {
      const sub = await payments.fetchSubscription();
      set({
        premium: {
          loaded: true,
          isPremium: sub.isPremium,
          lifetime: sub.lifetime,
          daysLeft: sub.daysLeft,
          plan: sub.plan,
        },
      });
    } catch {
      /* آفلاین/نشست منقضی — آخرین وضعیت می‌ماند */
    }
  },

  clearPaymentResult() {
    set({ paymentResult: null });
  },

  setPaymentResult(orderUuid) {
    if (orderUuid === null) {
      set({ paymentResult: null });
      return;
    }
    // جریان بومی اندروید — مثل بازگشت از درگاه وب
    set({ view: 'paywall', paymentResult: orderUuid });
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

  setFontScale(fontScale) {
    set({ fontScale });
    applyFontScale(fontScale);
    void repo.prefsSet('fontScale', fontScale);
  },

  async setPref(key, value) {
    set({ [key]: value } as Partial<AppState>);
    await repo.prefsSet(key === 'biometricLock' ? 'biometricLock' : 'alerts', value);
  },

  openModal(modal, taskId = null) {
    if (modal === 'quickAdd') {
      set({ pendingDate: null });
      // حباب راهنما رسالتش را ادا کرد — کاربر راه افزودن را بلد است
      if (get().coachAdd) get().dismissCoachAdd();
    }
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
    const completing = !task.completedAt;
    await repo.tasksToggleComplete(id, !task.completedAt);
    await get().refresh();
    queueSync();
    // جشن اولین تکمیل واقعی کاربر (v10) — مستقل از داده‌ی دمو، با pref کنترل می‌شود
    if (completing && !(await repo.prefsGet<boolean>('first-done-celebrated', false))) {
      await repo.prefsSet('first-done-celebrated', true);
      get().showToast('🎯 آفرین! اولین کارت انجام شد؛ همین‌طور ادامه بده');
    }
  },

  async addQuickTask(input) {
    const { title, listId, dueDate, priority } = input;
    if (!title.trim()) return;
    // پایه‌ی عنوان: اگر تشخیص هوشمند عبارت تاریخ را پاک کرده باشد همان استفاده می‌شود (v16)
    const base = (input.titleText ?? '').trim() || title;
    // تشخیص ساده‌ی ساعت از متن (وقتی تشخیص هوشمند قبلاً ساعت نداده باشد)
    const lat = (s: string) => s.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
    const timeMatch = base.match(/(?:ساعت\s*)([۰-۹0-9]{1,2})\s*[:：]\s*([۰-۹0-9]{2})/);
    let dueTime: string | null = input.dueTime ?? null;
    let cleanTitle = base;
    if (timeMatch) {
      dueTime = dueTime ?? `${lat(timeMatch[1]).padStart(2, '0')}:${lat(timeMatch[2])}`;
      cleanTitle = base.replace(timeMatch[0], '').trim();
    }
    await repo.tasksCreate({
      listId,
      title: cleanTitle || title,
      dueDate,
      dueTime,
      priority: priority ?? 'normal',
    });
    await get().refresh();
    queueSync();
    set({ modal: null, pendingDate: null });
    get().showToast(`کار «${cleanTitle || title}» افزوده شد`);
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

  /** فعال‌سازی بسته‌ی شغلی (مخصوص کاربر پرو — v16) — ساخت لیست‌ها و آیتم‌های روتین بسته */
  async applyJobKit(kit) {
    for (const l of kit.lists) {
      const existing = get().lists.find((x) => x.name === l.name);
      const list = existing ?? (await repo.listsCreate({ name: l.name, emoji: l.emoji, color: l.color }));
      for (const item of l.items) {
        // جلوگیری از تکرار: آیتم هم‌عنوانِ ناتمام در همان لیست دوباره ساخته نمی‌شود
        const dup = get().tasks.find((t) => t.listId === list.id && t.title === item && !t.completedAt);
        if (dup) continue;
        await repo.tasksCreate({ listId: list.id, title: item, priority: 'normal' });
      }
    }
    await get().refresh();
    queueSync();
    get().showToast(`بسته‌ی «${kit.title}» فعال شد و روتین‌هایش به لیست‌ها اضافه شد!`);
  },
}));
