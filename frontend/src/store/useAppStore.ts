import { create } from 'zustand';
import type { ListEntity, ListGroup, ListColor, ListSortKey, HubKey, TaskEntity, SubtaskEntity, ViewName, TemplateDef, JobKitDef } from '@/types';
import * as repo from '@/db/repo';
import { ensureDefaultData } from '@/db/seed';
import { toIsoDate, faShort, toFa } from '@/lib/format';
import { defaultListId, sortedLists } from '@/lib/selectors';
import { pruneMyDay, type RepeatMeta } from '@/lib/repeat';
import { applySectionOrder } from '@/lib/dragSort';
import { uuid } from '@/lib/uuid';
import { queueSync, runSync, setSyncConfig, setSyncListeners, startSyncLoop, type SyncState } from '@/sync/engine';
import { getSession, type SyncSession } from '@/sync/session';
import { refreshSession } from '@/sync/api';
import * as auth from '@/sync/auth';
import * as payments from '@/sync/payments';
// فاز ۴ — یادآور بومی: فقط در اپ اندروید فعال می‌شود (وب بی‌عمل)
import { syncReminders, clearReminders, registerSnooze, reminderDiag, setReminderActionHandlers, handleReminderAction, type ReminderDiag } from '@/lib/reminderScheduler';
import { onReminderAction } from '@/lib/reminderBridge';
import { scanLegacyDemos, runDemoCleanup, undoDemoCleanup, type DemoScanResult, type DemoCleanupSnapshot } from '@/db/demoCleanup';

/* فاز نصب تمیز — اسکن جاری و اسنپ‌شات واگرد (خارج از state — نیازی به رندر ندارند) */
let currentDemoScan: DemoScanResult | null = null;
let lastDemoSnapshot: DemoCleanupSnapshot | null = null;

export type AccentColor = Extract<ListColor, 'teal' | 'indigo' | 'amber' | 'emerald' | 'rose' | 'purple'>;
export type FontScale = 'small' | 'medium' | 'large';
export type ModalName = 'quickAdd' | 'taskDetail' | 'calendar' | 'newList' | 'editList' | 'manageLists' | null;
/** هدف تقویم: افزودن سریع / کارت هوشمند خانه / جزئیات کار (فاز ۳) */
export type CalendarTarget = 'quickAdd' | 'hub' | 'detail' | null;

/** توست با اقدام اختیاری (واگرد) — فاز ۲ */
export interface ToastState {
  id: number;
  text: string;
  action?: { label: string; run(): void };
}

/** تنظیمات عمومی سرور (از /api/v1/bootstrap) — آفلاین با پیش‌فرض‌ها */
export interface AppSettings {
  appName: string;
  paywallTitle: string;
  minAppVersion: string;
  maintenance: boolean;
  voice: { enabled: boolean; provider: 'off' | 'web_speech'; rate: number; pitch: number; lang: string };
  channels: { email: boolean; telegram: boolean; sms: boolean; botUsername: string } | null;
  /** v17 — چک‌کننده به‌روزرسانی + پشتیبانی (پاسخ سرورهای قدیمی بدون این‌هاست) */
  update?: { latest: string | null; url: string | null; notes: string | null } | null;
  support?: { email: string | null; telegram: string | null } | null;
}

/** وضعیت اشتراک پرو (فاز ۵ — از /api/v1/me/subscription؛ source='trial' = دوره آزمایشی v18) */
export interface PremiumState {
  loaded: boolean;
  isPremium: boolean;
  lifetime: boolean;
  daysLeft: number | null;
  plan: { code: string; title: string } | null;
  source: string | null;
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
  toast: { id: number; text: string; action?: { label: string; run(): void } } | null;
  completedExpanded: boolean;
  searchQuery: string;
  searchFilter: string;
  accountSheet: boolean;
  genderSheet: boolean;
  /** راهنمای کارام (v11) — پاپ‌آپ مرکزی با پرسش‌های پرتکرار */
  guideSheet: boolean;
  /** قوانین، حریم خصوصی و پشتیبانی (v17) */
  termsSheet: boolean;
  /** تور تعاملی مرحله‌به‌مرحله (v12) — توولتیپ روی المان‌های واقعی اپ */
  tourOpen: boolean;
  /** آنبوردینگ کامل (v10) — خوش‌آمد + نام + ظاهر؛ بعد از اولین ورود */
  welcomeSheet: boolean;
  /** حباب راهنمای «اولین کار» (v10) — بالای دکمه‌ی + تا اولین افزودن یا بستن */
  coachAdd: boolean;
  /** فاز نصب تمیز — بنر یک‌بارمصرف «کارهای نمونه‌ی قدیمی» (اسکن demoCleanup) */
  demoCleanupBanner: { taskCount: number; listCount: number } | null;
  /** فاز ۲ — هشدار یادآور (ممیزی آلارم): «آلارم دقیق غیرفعال» یا «مجوز اعلان رد شده» — سطح نشست */
  reminderWarning: 'exact-denied' | 'permission-denied' | null;
  /** فاز ۲ — وضعیت تشخیصی یادآور برای کارت «اطمینان از دریافت یادآور» در تنظیمات */
  reminderDiag: ReminderDiag | null;
  appSettings: AppSettings;
  session: SyncSession | null;
  syncState: SyncState;
  premium: PremiumState;
  /** سفارشی که بعد از بازگشت از درگاه باید نتیجه‌اش نشان داده شود (فاز ۵) */
  paymentResult: string | null;

  /* ---- فاز ۲ — قابلیت کامل لیست‌ها ---- */
  /** گروه‌های لیست‌ها (سطح دستگاه؛ با خروج پاک می‌شود) */
  groups: ListGroup[];
  /** فاز الف — گروه‌های جمع‌شده‌ی خانه (سطح دستگاه؛ pref «groups-collapsed») */
  groupsCollapsed: string[];
  /** کارت‌های هوشمند پنهان‌شده‌ی خانه */
  hubHidden: HubKey[];
  /** ترتیب به‌یادماندنی هر لیست — کلید: شناسه‌ی لیست */
  listSorts: Record<string, ListSortKey>;
  /** ترتیب دستی کارهای هر لیست — کلید: شناسه‌ی لیست */
  taskOrders: Record<string, string[]>;
  /** لیستِ در حال ویرایش (شیت ویرایش لیست) */
  editListId: string | null;

  /* ---- فاز ۳ — فلوی افزودن و جزئیات کار ---- */
  /** «روزهای من» — افزوده‌های دستی (سطح دستگاه؛ قاعده هرس در lib/repeat.ts) */
  myDayIds: string[];
  /** پیش‌نویس نوار افزودن سریع — برای انتقال به شیت کامل */
  quickDraft: string;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setView(v: ViewName): void;
  openList(id: string): void;
  goHome(): void;

  openAccountSheet(): void;
  openGenderSheet(): void;
  /** باز کردن پاپ‌آپ راهنمای کارام (v11) */
  openGuideSheet(): void;
  openTermsSheet(): void;
  /** شروع تور تعاملی (v12) — شیت راهنما و حباب آموزشی بسته می‌شوند */
  openTour(): void;
  /** فاز ۲ (ممیزی یادآور) — خواندن وضعیت واقعی مجوز/آلارم دقیق/صف و به‌روزرسانی بنر و کارت تشخیص */
  refreshReminderStatus(): Promise<void>;
  /** بستن بنر هشدار یادآور (سطح نشست — در بازبینی بعدی اگر رفع نشده باشد دوباره می‌آید) */
  dismissReminderWarning(): void;
  /** فاز ۲ — دکمه‌ی «۱۰ دقیقه دیگر» روی اعلان */
  snoozeReminderFromAction(taskId: string): Promise<void>;
  /** فاز نصب تمیز — اسکن داده‌ی نمونه‌ی قدیمی و نمایش بنر (اگر چیزی پیدا شد) */
  scanLegacyDemoBanner(): Promise<void>;
  /** «نگه دار» — دیگر هرگز پرسیده نمی‌شود */
  dismissDemoCleanup(): void;
  /** «پاک کن» — حذف نرم سینک‌پذیر با واگرد توست‌دار */
  cleanLegacyDemos(): Promise<void>;
  /** واگرد پاک‌سازی نمونه‌ها */
  undoLegacyDemoCleanup(): Promise<void>;
  /** ثبت نام کاربر — محلی + پروفایل سرور در صورت ورود (v10 آنبوردینگ) */
  saveDisplayName(name: string): Promise<void>;
  /** بستن حباب راهنمای اولین کار — دیگر نمایش داده نمی‌شود */
  dismissCoachAdd(): void;
  reloadSession(autoSync?: boolean): Promise<void>;
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
  showToast(text: string, action?: { label: string; run(): void }): void;
  clearToast(): void;
  toggleCompletedAccordion(): void;
  setSearch(q: string, filter?: string): void;

  toggleTask(id: string): Promise<void>;
  addQuickTask(input: { title: string; listId: string; dueDate: string | null; dueTime?: string | null; titleText?: string; priority?: TaskEntity['priority']; repeat?: TaskEntity['repeat']; repeatMeta?: RepeatMeta | null }): Promise<string | null>;
  addInlineTask(listId: string, title: string): Promise<void>;
  updateTask(id: string, patch: Partial<Pick<TaskEntity, 'title' | 'notes' | 'priority' | 'dueDate' | 'dueTime' | 'reminderMinutes' | 'repeat' | 'repeatMeta' | 'starred' | 'listId'>>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  moveOverdueToToday(): Promise<void>;
  toggleSubtask(id: string): Promise<void>;
  addSubtask(taskId: string, title: string): Promise<void>;
  /** فاز ۳ — حذف زیرکار (نرم) */
  deleteSubtask(id: string): Promise<void>;
  /** فاز ۳ — تغییر نام زیرکار */
  renameSubtask(id: string, title: string): Promise<void>;
  /** فاز ۳ — ستاره‌ی «مهم» */
  toggleStar(id: string): Promise<void>;
  /** فاز ۳ — افزودن/برداشتن از «روزهای من» */
  toggleMyDay(id: string): Promise<void>;
  /** فاز ۳ — ذخیره‌ی فهرست روزهای من (داخلی) */
  persistMyDay(ids: string[]): Promise<void>;
  /** فاز ۳ — افزودن سریع از «روزهای من» (کار بی‌تاریخ در لیست پیش‌فرض + عضویت روزهای من) */
  addMyDayTask(title: string): Promise<void>;
  /** فاز ۳ — پیش‌نویس نوار افزودن سریع */
  setQuickDraft(text: string): void;
  createList(name: string, emoji: string): Promise<void>;
  applyTemplate(tpl: TemplateDef): Promise<void>;
  applyJobKit(kit: JobKitDef): Promise<void>;

  /* ---- فاز ۲ — قابلیت کامل لیست‌ها ---- */
  openEditList(id: string): void;
  /** ویرایش لیست (نام/ایموجی/رنگ) — سینک با فیلدهای موجود */
  updateList(id: string, patch: { name?: string; emoji?: string; color?: ListColor }): Promise<void>;
  /** حذف لیست با تأیید (در UI) + توست واگرد — لیست پیش‌فرض (اولین لیست) حذف نمی‌شود */
  deleteList(id: string): Promise<void>;
  /** کپی لیست با همه‌ی کارها و زیرکارها (شناسه‌های نو) */
  copyList(id: string): Promise<void>;
  /** جابه‌جایی یک پله بالا/پایین (دسترس‌پذیری) */
  moveList(id: string, dir: -1 | 1): void;
  /** نوشتن ترتیب کامل سراسری (sortOrder = اندیس) — فقط ردیف‌های تغییرکرده */
  reorderAll(ids: string[]): Promise<void>;
  /** اعمال ترتیب تازه‌ی یک بخش (بدون گروه/گروه) داخل ترتیب سراسری */
  reorderWithin(sectionIds: string[], nextOrder: string[]): Promise<void>;
  setListSort(listId: string, key: ListSortKey): void;
  setTaskOrder(listId: string, ids: string[]): void;
  setHubHidden(key: HubKey, hidden: boolean): void;
  addGroup(name: string): string;
  renameGroup(groupId: string, name: string): void;
  deleteGroup(groupId: string): void;
  setListGroup(listId: string, groupId: string | null): void;
  /** فاز الف — جمع/باز کردن گروه در خانه */
  toggleGroupCollapsed(groupId: string): void;
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
  termsSheet: false,
  tourOpen: false,
  welcomeSheet: false,
  coachAdd: false,
  demoCleanupBanner: null,
  reminderWarning: null,
  reminderDiag: null,
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
  premium: { loaded: false, isPremium: false, lifetime: false, daysLeft: null, plan: null, source: null },
  paymentResult: null,

  groups: [],
  groupsCollapsed: [],
  hubHidden: [],
  listSorts: {},
  taskOrders: {},
  editListId: null,

  myDayIds: [],
  quickDraft: '',

  async init() {
    await ensureDefaultData();
    await get().refresh();
    const [dark, accent, biometric, alerts, savedName, fontScale, coachSeen] = await Promise.all([
      repo.prefsGet<boolean>('theme-dark', false),
      repo.prefsGet<AccentColor>('accent', 'teal'),
      repo.prefsGet<boolean>('biometricLock', true),
      repo.prefsGet<boolean>('alerts', true),
      repo.prefsGet<string>('userName', ''),
      repo.prefsGet<FontScale>('fontScale', 'medium'),
      // v10 — حباب راهنمای اولین کار (فاز نصب تمیز: آنبوردینگ مودالی حذف شد — راهنمای Tooltip جایگزین شد)
      repo.prefsGet<boolean>('coach-add-seen', false),
    ]);
    // فاز ۲ — گروه‌ها/هوشمندهای پنهان/مرتب‌سازی هر لیست/ترتیب دستی کارها (سطح دستگاه، با خروج پاک می‌شوند)
    const prefs = await repo.prefsAll();
    const groups = (prefs.find((p) => p.key === 'list-groups')?.value as ListGroup[] | undefined) ?? [];
    const hubHidden = (prefs.find((p) => p.key === 'hubs-hidden')?.value as HubKey[] | undefined) ?? [];
    // فاز الف — وضعیت جمع‌شده‌ی گروه‌های خانه
    const groupsCollapsed = (prefs.find((p) => p.key === 'groups-collapsed')?.value as string[] | undefined) ?? [];
    const listSorts: Record<string, ListSortKey> = {};
    const taskOrders: Record<string, string[]> = {};
    for (const p of prefs) {
      if (p.key.startsWith('list-sort:')) listSorts[p.key.slice('list-sort:'.length)] = p.value as ListSortKey;
      else if (p.key.startsWith('task-order:')) taskOrders[p.key.slice('task-order:'.length)] = (p.value as string[]) ?? [];
    }
    // فاز ۳ — «روزهای من»: هرس قاعده‌مند (انجام‌شده‌های روزهای قبل و کارهای حذف‌شده بیرون می‌روند)
    const rawMyDay = (prefs.find((p) => p.key === 'myday-ids')?.value as string[] | undefined) ?? [];
    const myDayIds = pruneMyDay(rawMyDay, get().tasks, new Date());
    if (myDayIds.length !== rawMyDay.length) {
      void repo.prefsSet('myday-ids', myDayIds);
    }
    // مهاجرت یک‌باره: اسم پیش‌فرض جعلی نسخه‌های قبل پاک می‌شود (نام واقعی از پروفایل کاربر می‌آید)
    const userName = savedName === 'علی' ? '' : savedName;
    if (savedName === 'علی') {
      void repo.prefsSet('userName', '');
    }
    set({ dark, accent, fontScale, biometricLock: biometric, alerts, userName, coachAdd: !coachSeen, groups, groupsCollapsed, hubHidden, listSorts, taskOrders, myDayIds });
    // فاز ۴ — ترجیح واقعی اعلان‌ها خوانده شد؛ بازبینی اجباری (اگر خاموش باشد زنگ‌های اولیه پاک می‌شوند)
    void syncReminders(get().tasks, alerts, true);
    applyDark(dark);
    applyAccent(accent);
    applyFontScale(fontScale);

    // اتصال موتور سینک به store (فاز ۲) — پیام‌های موقت مثل جبران ساعت هم از همین مسیر
    setSyncListeners({
      onState: (syncState) => useAppStore.setState({ syncState }),
      onApplied: () => {
        void useAppStore.getState().refresh();
      },
      onNotice: (text) => {
        useAppStore.getState().showToast(text);
      },
    });
    startSyncLoop();

    // فاز ۲ (ممیزی یادآور) — اقدام روی اعلان («انجام شد»/«۱۰ دقیقه دیگر»/ضربه به بدنه)
    // یک‌بار در هر فرایند وصل می‌شود؛ شنونده‌ها به store می‌رسند (بدون چرخه‌ی import)
    setReminderActionHandlers({
      onDone: (taskId) => {
        void useAppStore.getState().toggleTask(taskId);
      },
      onSnooze10: (taskId) => {
        void useAppStore.getState().snoozeReminderFromAction(taskId);
      },
      onOpen: (taskId) => {
        const st = useAppStore.getState();
        if (st.tasks.some((t) => t.id === taskId && !t.deletedAt)) st.openModal('taskDetail', taskId);
      },
    });
    onReminderAction((ev) => handleReminderAction(ev.actionId, ev.taskId));
    await get().reloadSession(false);
    // اگر access نزدیک انقضاست همین‌جا تمدید می‌شود (فاز ۳) — و فقط «یک» سینک در init
    if (get().session) {
      await refreshSession();
      await get().reloadSession(false);
      void runSync();
    }

    // فاز نصب تمیز — هیچ مودال مزاحمی در باز شدن اپ نیست؛ راهنمای ۳مرحله‌ای Tooltip
    // فقط یک‌بار در هر نصب و فقط در خانه باز می‌شود (پرچم 'coach-guide-seen')؛
    // نمایش دوباره از: تنظیمات ← راهنمای کارام ← تور آموزشی
    {
      const coachGuideSeen = await repo.prefsGet<boolean>('coach-guide-seen', false);
      if (!coachGuideSeen && get().view === 'home' && typeof window !== 'undefined') {
        window.setTimeout(() => {
          // پرچم همان لحظه ثبت می‌شود تا رفرش وسط راه هم باعث تکرار نشود
          void repo.prefsSet('coach-guide-seen', true);
          if (useAppStore.getState().view === 'home' && !useAppStore.getState().welcomeSheet) {
            useAppStore.setState({ tourOpen: true });
          }
        }, 900);
      }
    }

    // فاز نصب تمیز — اسکن محافظه‌کارانه‌ی داده‌ی نمونه‌ی نصب‌های قدیمی (بنر یک‌بارمصرف)
    {
      const cleanupPref = await repo.prefsGet<string>('demo-cleanup-v1', '');
      if (cleanupPref === '') void get().scanLegacyDemoBanner();
    }

    // تنظیمات عمومی سرور (فاز ۴.۵) — در نبود شبکه با پیش‌فرض‌ها ادامه می‌دهیم
    try {
      const bs = await auth.fetchBootstrap();
      // دفاع v10: اگر پاسخ JSON معتبرِ بوت‌استرپ نبود (مثلاً صفحه‌ی HTML با کد 200)، پیش‌فرض‌ها می‌مانند
      if (bs && bs.voice && typeof bs.voice.enabled === 'boolean') {
        useAppStore.setState({ appSettings: bs });
      }
      // ترمیم جریان — اندازه‌ی چانک push از سقف سرور (کلاینت هرگز ۴۲۲ سقف نمی‌گیرد)
      if (bs?.sync?.maxItems) {
        setSyncConfig({ chunkSize: bs.sync.maxItems });
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
    // فاز ۴ — همگام‌سازی زنگ‌های یادآور دستگاه با داده‌ی فعلی (هر مسیر تغییر داده از همین‌جا رد می‌شود:
    // افزودن/ویرایش/انجام/حذف کار، نوبت بعدی تکرار و اعمال رکوردهای سرور). اثر انگشت جلوی تماس اضافی را می‌گیرد.
    void syncReminders(tasks, get().alerts);
  },

  /* ---- فاز ۲ (ممیزی یادآور) — وضعیت، بنر و snooze ---- */

  async refreshReminderStatus() {
    try {
      const diag = await reminderDiag(get().tasks, get().alerts);
      let warning: 'exact-denied' | 'permission-denied' | null = null;
      if (diag.native && diag.alertsOn) {
        if (diag.permission === 'denied') warning = 'permission-denied';
        else if (diag.exactAlarm === 'denied') warning = 'exact-denied';
      }
      set({ reminderDiag: diag, reminderWarning: warning });
    } catch {
      /* تشخیص حیاتی نیست */
    }
  },

  dismissReminderWarning() {
    set({ reminderWarning: null });
  },

  async snoozeReminderFromAction(taskId) {
    const t = get().tasks.find((x) => x.id === taskId);
    if (!t || t.deletedAt || t.completedAt || !t.dueDate) return;
    // ۱۰ دقیقه از همین لحظه (پایدار در prefs — تا لغو در انجام/حذف کار از دست نرود)
    registerSnooze(taskId, t.title, t.dueDate, t.dueTime, Date.now() + 10 * 60_000);
    await get().refresh(); // فینگرپرینت عوض شده → دیفرانسول زنگ snooze را ثبت می‌کند
    get().showToast('یادآور ۱۰ دقیقه دیگر زده می‌شود');
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

  openTermsSheet() {
    set({ termsSheet: true });
  },

  openTour() {
    if (get().coachAdd) get().dismissCoachAdd();
    set({ tourOpen: true, guideSheet: false });
  },

  /* ---- فاز نصب تمیز — پاک‌سازی ایمن داده‌ی نمونه‌ی نصب‌های قدیمی ---- */

  async scanLegacyDemoBanner() {
    try {
      const [tasks, lists] = await Promise.all([repo.tasksAll(), repo.listsAll()]);
      const scan = scanLegacyDemos(tasks, lists);
      currentDemoScan = scan;
      set({ demoCleanupBanner: scan ? { taskCount: scan.tasks.length, listCount: scan.lists.length } : null });
    } catch {
      /* محیط بدون IndexedDB — نادیده */
    }
  },

  dismissDemoCleanup() {
    void repo.prefsSet('demo-cleanup-v1', 'kept');
    currentDemoScan = null;
    set({ demoCleanupBanner: null });
  },

  async cleanLegacyDemos() {
    const scan = currentDemoScan;
    if (!scan) return;
    currentDemoScan = null;
    set({ demoCleanupBanner: null });
    void repo.prefsSet('demo-cleanup-v1', 'cleaned');
    lastDemoSnapshot = await runDemoCleanup(scan);
    await get().refresh();
    queueSync();
    // زنگ‌های کارهای نمونه‌ی حذف‌شده هم از دستگاه برداشته شود
    void syncReminders(get().tasks, get().alerts, true);
    const n = toFa(lastDemoSnapshot.tasks.length + lastDemoSnapshot.subtasks.length + lastDemoSnapshot.reminders.length);
    get().showToast(`${n} مورد نمونه پاک شد`, {
      label: 'واگرد',
      run: () => void get().undoLegacyDemoCleanup(),
    });
  },

  async undoLegacyDemoCleanup() {
    const snap = lastDemoSnapshot;
    if (!snap) return;
    lastDemoSnapshot = null;
    await undoDemoCleanup(snap);
    await get().refresh();
    queueSync();
    void syncReminders(get().tasks, get().alerts, true);
    get().showToast('واگرد شد؛ همه‌چیز سر جای قبلی برگشت');
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

  async reloadSession(autoSync = true) {
    const session = await getSession();
    set({ session });
    // autoSync=false فقط برای init — تا هر راه‌اندازی دقیقاً یک سینک داشته باشد
    if (session && autoSync) void runSync();
  },

  async signOut() {
    await auth.logout();
    // فاز ۴ — زنگ‌های یادآور دستگاه هم پاک می‌شوند (داده‌ی کاربر دیگر نباید زنگ بزند)
    await clearReminders();
    // حریم خصوصی: حافظه‌ی درون‌برنامه‌ای هم خالی می‌شود (داده‌ی IndexedDB در logout پاک شده)
    await ensureDefaultData();
    await get().refresh();
    set({
      session: null,
      detailTaskId: null,
      modal: null,
      syncState: { status: 'idle', lastSyncAt: null, error: null },
      premium: { loaded: false, isPremium: false, lifetime: false, daysLeft: null, plan: null, source: null },
      paymentResult: null,
      myDayIds: [],
      quickDraft: '',
      groupsCollapsed: [],
    });
  },

  async syncNow() {
    await runSync();
  },

  async reloadPremium() {
    if (!get().session) {
      set({ premium: { loaded: false, isPremium: false, lifetime: false, daysLeft: null, plan: null, source: null } });
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
          source: sub.source ?? null,
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
    // فاز ۴ — کلید اعلان‌ها فوراً روی زنگ‌های دستگاه اثر می‌گذارد
    if (key === 'alerts') {
      if (value) void syncReminders(get().tasks, true, true);
      else void clearReminders();
      // فاز ۲ — بنر/کارت تشخیص با وضعیت جدید هماهنگ شود
      void get().refreshReminderStatus();
    }
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
    else if (target === 'detail') {
      // فاز ۳ — تغییر سررسید از جزئیات کار
      const taskId = get().detailTaskId;
      set({ modal: 'taskDetail', calendarTarget: null });
      if (taskId) void get().updateTask(taskId, { dueDate: dateIso });
    } else set({ modal: null, calendarTarget: null });
  },

  showToast(text, action) {
    const id = Date.now();
    set({ toast: { id, text, action } });
    // توست دارای اقدام (واگرد) زمان بیشتری می‌گیرد
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, action ? 6000 : 3200);
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
    // (اول اجرا می‌شود تا توست مهم‌ترِ «نوبت بعدی» زیرش گم نشود)
    if (completing && !(await repo.prefsGet<boolean>('first-done-celebrated', false))) {
      await repo.prefsSet('first-done-celebrated', true);
      get().showToast('🎯 آفرین! اولین کارت انجام شد؛ همین‌طور ادامه بده');
    }
    // فاز ۳ — کارِ تکرارشونده: نوبت بعدی ساخته می‌شود (کارِ اصلی انجام‌شده می‌ماند)
    if (completing && task.repeat !== 'none') {
      const next = await repo.completeRecurring(id);
      if (next) {
        await get().refresh();
        queueSync();
        const when = next.dueDate ? ` برای ${faShort(new Date(next.dueDate + 'T00:00:00'))}` : '';
        get().showToast(`نوبت بعدی این کارِ تکراری${when} ساخته شد`);
      }
    }
  },

  /** @returns شناسه‌ی کار ساخته‌شده (برای پیوست‌های پس از افزودن مثل «روزهای من») */
  async addQuickTask(input) {
    const { title, listId, dueDate, priority } = input;
    if (!title.trim()) return null;
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
    const created = await repo.tasksCreate({
      listId,
      title: cleanTitle || title,
      dueDate,
      dueTime,
      priority: priority ?? 'normal',
      repeat: input.repeat ?? 'none',
      repeatMeta: input.repeatMeta ?? null,
    });
    await get().refresh();
    queueSync();
    set({ modal: null, pendingDate: null });
    get().showToast(`کار «${cleanTitle || title}» افزوده شد`);
    return created.id;
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

  /* ================= فاز ۳ — فلوی افزودن و جزئیات کار ================= */

  async deleteSubtask(id) {
    await repo.subtasksSoftDelete(id);
    await get().refresh();
    queueSync();
  },

  async renameSubtask(id, title) {
    const clean = title.trim().replace(/\s+/g, ' ').slice(0, 255);
    if (!clean) return;
    await repo.subtasksUpdate(id, { title: clean });
    await get().refresh();
    queueSync();
  },

  async toggleStar(id) {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    await repo.tasksUpdate(id, { starred: !task.starred });
    await get().refresh();
    queueSync();
    if (!task.starred) get().showToast('به «مهم» اضافه شد ⭐');
  },

  /** هرس و ذخیره‌ی فهرست «روزهای من» */
  async persistMyDay(ids) {
    set({ myDayIds: ids });
    await repo.prefsSet('myday-ids', ids);
  },

  async toggleMyDay(id) {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const has = get().myDayIds.includes(id);
    const next = has ? get().myDayIds.filter((x) => x !== id) : [...get().myDayIds, id];
    await get().persistMyDay(next);
    get().showToast(has ? 'از «روزهای من» برداشته شد' : 'به «روزهای من» اضافه شد ☀️');
  },

  async addMyDayTask(title) {
    const clean = title.trim();
    if (!clean) return;
    const lists = get().lists;
    const target = defaultListId(lists) ?? lists[0]?.id;
    if (!target) {
      get().showToast('اول یک لیست بسازید');
      return;
    }
    const created = await repo.tasksCreate({ listId: target, title: clean });
    await get().persistMyDay([...get().myDayIds, created.id]);
    await get().refresh();
    queueSync();
    get().showToast('به «روزهای من» اضافه شد ☀️');
  },

  setQuickDraft(text) {
    set({ quickDraft: text });
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

  /* ================= فاز ۲ — قابلیت کامل لیست‌ها ================= */

  openEditList(id) {
    set({ modal: 'editList', editListId: id });
  },

  async updateList(id, patch) {
    const clean: { name?: string; emoji?: string; color?: ListColor } = {};
    if (patch.name !== undefined) {
      const n = patch.name.trim().replace(/\s+/g, ' ').slice(0, 120);
      if (!n) return;
      clean.name = n;
    }
    if (patch.emoji !== undefined) {
      const e = patch.emoji.trim().slice(0, 16);
      if (!e) return;
      clean.emoji = e;
    }
    if (patch.color !== undefined) clean.color = patch.color;
    if (Object.keys(clean).length === 0) return;
    await repo.listsUpdate(id, clean);
    await get().refresh();
    queueSync();
  },

  async deleteList(id) {
    const lists = get().lists;
    const target = lists.find((l) => l.id === id);
    if (!target) return;
    // محافظت لیست پیش‌فرض: اولین لیستِ ترتیب = هدف پیش‌فرض افزودن سریع؛ حذف آن همیشه یک لیست باقی می‌گذارد
    if (defaultListId(lists) === id) {
      get().showToast('اولین لیست، پیش‌فرضِ افزودن کارهاست و حذف نمی‌شود — ابتدا ترتیب را تغییر دهید');
      return;
    }
    const snap = await repo.snapshotListForUndo(id);
    if (!snap) return;
    await repo.listsSoftDelete(id);
    lastListUndo = snap;
    await get().refresh();
    queueSync();
    // گروه‌بندی: لیست حذف‌شده از گروه‌هایش بیرون می‌آید
    const groups = get().groups.map((g) => ({ ...g, listIds: g.listIds.filter((x) => x !== id) }));
    if (groups.some((g, i) => g.listIds.length !== get().groups[i].listIds.length)) {
      set({ groups });
      void repo.prefsSet('list-groups', groups);
    }
    set({ modal: null, editListId: null });
    get().showToast(`لیست «${target.name}» حذف شد`, {
      label: 'واگرد',
      run: () => void undoLastListDelete(),
    });
  },

  async copyList(id) {
    const src = get().lists.find((l) => l.id === id);
    if (!src) return;
    const name = `${src.name} (کپی)`.slice(0, 120);
    const created = await repo.listsCreate({ name, emoji: src.emoji, color: src.color });
    for (const t of get().tasks.filter((x) => x.listId === id)) {
      const copy = await repo.tasksCopyRow(t.id, created.id);
      if (copy) await repo.subtasksCopyRow(t.id, copy.id);
    }
    await get().refresh();
    queueSync();
    set({ modal: null, editListId: null, activeListId: created.id, view: 'listView' });
    get().showToast(`لیست «${name}» ساخته شد (${get().tasks.filter((x) => x.listId === created.id).length} کار)`);
  },

  moveList(id, dir) {
    const ids = sortedLists(get().lists).map((l) => l.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void get().reorderAll(ids);
  },

  async reorderAll(ids) {
    const current = new Map(get().lists.map((l) => [l.id, l.sortOrder]));
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      if (current.get(ids[i]) !== i) {
        await repo.listsUpdate(ids[i], { sortOrder: i });
        changed = true;
      }
    }
    if (!changed) return;
    await get().refresh();
    queueSync();
  },

  async reorderWithin(sectionIds, nextOrder) {
    await get().reorderAll(applySectionOrder(sortedLists(get().lists).map((l) => l.id), sectionIds, nextOrder));
  },

  setListSort(listId, key) {
    set({ listSorts: { ...get().listSorts, [listId]: key } });
    void repo.prefsSet(`list-sort:${listId}`, key);
  },

  setTaskOrder(listId, ids) {
    set({ taskOrders: { ...get().taskOrders, [listId]: ids } });
    void repo.prefsSet(`task-order:${listId}`, ids);
  },

  setHubHidden(key, hidden) {
    const cur = new Set(get().hubHidden);
    if (hidden) cur.add(key);
    else cur.delete(key);
    const arr = [...cur];
    set({ hubHidden: arr });
    void repo.prefsSet('hubs-hidden', arr);
  },

  /** فاز الف — جمع/باز کردن یک گروه در خانه (سطح دستگاه، به‌یادماندنی) */
  toggleGroupCollapsed(groupId) {
    const cur = new Set(get().groupsCollapsed);
    if (cur.has(groupId)) cur.delete(groupId);
    else cur.add(groupId);
    const arr = [...cur];
    set({ groupsCollapsed: arr });
    void repo.prefsSet('groups-collapsed', arr);
  },

  addGroup(name) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
    const id = uuid();
    if (!clean) return id;
    const groups = [...get().groups, { id, name: clean, listIds: [] }];
    set({ groups });
    void repo.prefsSet('list-groups', groups);
    return id;
  },

  renameGroup(groupId, name) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!clean) return;
    const groups = get().groups.map((g) => (g.id === groupId ? { ...g, name: clean } : g));
    set({ groups });
    void repo.prefsSet('list-groups', groups);
  },

  deleteGroup(groupId) {
    const groups = get().groups.filter((g) => g.id !== groupId);
    set({ groups });
    void repo.prefsSet('list-groups', groups);
  },

  setListGroup(listId, groupId) {
    // اول از همه‌ی گروه‌ها بیرون می‌آید؛ سپس در گروه هدف (اگر باشد) قرار می‌گیرد
    const groups = get().groups.map((g) => ({ ...g, listIds: g.listIds.filter((x) => x !== listId) }));
    if (groupId) {
      const target = groups.find((g) => g.id === groupId);
      if (target) target.listIds.push(listId);
    }
    set({ groups });
    void repo.prefsSet('list-groups', groups);
  },
}));

/* ---------- واگرد حذف لیست (پشت صحنه‌ی توست — فاز ۲) ---------- */

let lastListUndo: repo.ListUndoSnapshot | null = null;

async function undoLastListDelete(): Promise<void> {
  const snap = lastListUndo;
  if (!snap) return;
  lastListUndo = null;
  await repo.restoreListSnapshot(snap);
  await useAppStore.getState().refresh();
  queueSync();
  useAppStore.getState().showToast(`لیست «${snap.list.name}» بازگردانده شد`);
}
