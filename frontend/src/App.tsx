import { useEffect, useRef } from 'react';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { BottomNav, Toast } from '@/components/BottomNav';
import { HomeView } from '@/views/HomeView';
import { ListView } from '@/views/ListView';
import { TodayTab } from '@/views/TodayTab';
import { PlannerView } from '@/views/PlannerView';
import { AnalyticsView } from '@/views/AnalyticsView';
import { ImportantView, AllView } from '@/views/SmartViews';
import { TemplatesView, JobKitsView } from '@/views/TemplatesView';
import { PaywallView } from '@/views/PaywallView';
import { SettingsView } from '@/views/SettingsView';
import { SearchView } from '@/views/SearchView';
import { QuickAddSheet } from '@/modals/QuickAddSheet';
import { TaskDetailSheet } from '@/modals/TaskDetailSheet';
import { CalendarSheet } from '@/modals/CalendarSheet';
import { QuickBar } from '@/components/QuickBar';
import { NewListSheet } from '@/modals/NewListSheet';
import { EditListSheet } from '@/modals/EditListSheet';
import { ManageListsSheet } from '@/modals/ManageListsSheet';
import { AccountSheet } from '@/modals/AccountSheet';
import { DeleteAccountSheet } from '@/modals/DeleteAccountSheet';
import { GuideSheet } from '@/modals/GuideSheet';
import { TermsSheet } from '@/modals/TermsSheet';
import { TourOverlay } from '@/modals/TourOverlay';
import { GenderOnboardingSheet } from '@/modals/GenderOnboardingSheet';
import { WelcomeOnboardingSheet } from '@/modals/WelcomeOnboardingSheet';
import { useAppStore } from '@/store/useAppStore';
import { Icon } from '@/components/Icon';
import { onAppResume, onAppPause, isNativeApp } from '@/lib/native';
import { syncReminders } from '@/lib/reminderScheduler';
import { openExactAlarmSettings } from '@/lib/reminderBridge';

/** پوسته‌ی اپ — قاب موبایل مطابق طرح (فول‌اسکرین در موبایل، قاب ۴۱۰px در دسکتاپ) */
export default function App() {
  const ready = useAppStore((s) => s.ready);
  const view = useAppStore((s) => s.view);
  const dark = useAppStore((s) => s.dark);
  const mainRef = useRef<HTMLElement>(null);

  // رنگ نوار مرورگر/نوار وضعیت هم‌رنگ تم — حذف حس «نوار سیاه» بالا
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#283044' : '#00685f');
  }, [dark]);

  // اسکرول به بالای محتوا در تغییر صفحه (مطابق رفتار طرح)
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [view]);

  // فاز ۶ — اپ اندروید: با بازگشت به پیش‌زمینه، سینک و وضعیت اشتراک تازه می‌شود
  useEffect(() => {
    const off = onAppResume(() => {
      const st = useAppStore.getState();
      if (!st.ready) return;
      void st.syncNow();
      void st.reloadPremium();
      // فاز ۴ — یادآور: بازبینی اجباری زنگ‌ها (زمان گذشته ممکن است زنگ‌ها را عوض کند؛
      // کاربر شاید مجوز را از تنظیمات سیستم داده باشد)
      void syncReminders(st.tasks, st.alerts, true);
      // فاز ۲ (ممیزی یادآور) — وضعیت مجوز/آلارم دقیق بعد از بازگشت (مثلاً از تنظیمات سیستم) تازه می‌شود
      void st.refreshReminderStatus();
      // فاز ۳ — وضعیت بیومتریک تازه می‌شود (مثلاً اثر انگشت تازه ثبت شده) + اگر قفل است، پاپ‌آپ ورود دوباره باز می‌شود
      void st.refreshBiometry();
      if (st.lockState.locked) void useAppStore.getState().unlockAttempt();
    });
    return off;
  }, []);

  // فاز ۳ — پس‌زمینه رفتن اپ = قفل (اگر کلید بیومتریک روشن باشد) — هم شنونده بومی هم visibilitychange (جینگل‌بند)
  useEffect(() => {
    const off = onAppPause(() => {
      useAppStore.getState().appBackgrounded();
    });
    const onVis = () => {
      if (document.visibilityState === 'hidden') useAppStore.getState().appBackgrounded();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // min-h-dvh در موبایل: ارتفاع پویای واقعی ویوپورت — با min-h-screen (100vh) وقتی نوار آدرس مرورگر باز است،
  // قاب از صفحه کوتاه‌تر می‌شود و items-center فاصله‌ی خالی بالا/پایین می‌سازد
  return (
    <div className="min-h-dvh sm:min-h-screen w-full flex items-center justify-center p-0 sm:p-4 transition-colors duration-300">
      {/* موبایل: تمام‌صفحه زیر نوار وضعیت واقعی (safe-area) — دسکتاپ: قاب تلفن با نوار شبیه‌سازی‌شده */}
      <div className="relative w-full max-w-[410px] h-[100dvh] sm:h-[calc(100dvh-2rem)] sm:max-h-[884px] bg-background dark:bg-inverse-surface rounded-none sm:rounded-[40px] shadow-2xl flex flex-col overflow-hidden border-0 sm:border-[8px] sm:border-slate-800 transition-colors duration-200 pt-safe sm:pt-0">
        <StatusBar />
        <TopBar />
        <ReminderWarningBanner />

        <main className="flex-1 overflow-y-auto no-scrollbar relative pb-36" id="appContent" ref={mainRef}>
          {!ready ? (
            <SplashScreen />
          ) : (
            <>
              {view === 'home' ? <HomeView /> : null}
              {view === 'listView' ? <ListView /> : null}
              {/* ناوبری ۵تبی (فاز الف): امروز = myday، پلنر = planned */}
              {view === 'myday' ? <TodayTab /> : null}
              {view === 'planned' ? <PlannerView /> : null}
              {view === 'analytics' ? <AnalyticsView /> : null}
              {/* صفحات داخلی از ردیف‌های خانه */}
              {view === 'important' ? <ImportantView /> : null}
              {view === 'all' ? <AllView /> : null}
              {view === 'templates' ? <TemplatesView /> : null}
              {view === 'jobkits' ? <JobKitsView /> : null}
              {view === 'paywall' ? <PaywallView /> : null}
              {view === 'settings' ? <SettingsView /> : null}
              {view === 'search' ? <SearchView /> : null}
            </>
          )}
        </main>

        {ready ? <QuickBar /> : null}
        <BottomNav />
        <Toast />

        {/* فاز ۳ — صفحه‌ی قفل بیومتریک (فقط اپ اندروید با کلید روشن) — بالای همه‌چیز و مات */}
        {ready ? <LockGate /> : null}

        <QuickAddSheet />
        <TaskDetailSheet />
        <CalendarSheet />
        <NewListSheet />
        <EditListSheet />
        <ManageListsSheet />
        <AccountSheet />
        <DeleteAccountSheet />
        <GuideSheet />
        <TermsSheet />
        <TourOverlay />
        <GenderOnboardingSheet />
        <WelcomeOnboardingSheet />
      </div>
    </div>
  );
}

/**
 * فاز ۲ (ممیزی یادآور) — بنر هشدار وضعیت یادآور (فقط اپ اندروید):
 *  - «آلارم دقیق غیرفعال» (اندروید ۱۴+ پیش‌فرض رد است) → یادآور تقریبی می‌رسد، نه دقیق
 *  - «مجوز اعلان رد شده» → یادآور اصلاً نمی‌رسد
 * بستن بنر سطح نشست است؛ وضعیت در هر resume از سیستم بازخوانی می‌شود.
 */
function ReminderWarningBanner() {
  const ready = useAppStore((s) => s.ready);
  const warning = useAppStore((s) => s.reminderWarning);
  const dismiss = useAppStore((s) => s.dismissReminderWarning);
  const setView = useAppStore((s) => s.setView);
  if (!ready || !warning || !isNativeApp()) return null;
  const exact = warning === 'exact-denied';
  return (
    <div
      className="px-3 pt-2 shrink-0"
      role="status"
      aria-label={exact ? 'هشدار: آلارم دقیق غیرفعال است' : 'هشدار: مجوز اعلان رد شده است'}
    >
      <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
        <Icon name="notifications_active" size={16} className="shrink-0" />
        <span className="flex-1 font-bold">
          {exact
            ? 'یادآورها ممکن است دیر برسند — «آلارم دقیق» اندروید برای کارام فعال نیست.'
            : 'اعلان‌ها رد شده‌اند؛ یادآورها به دستگاه شما نمی‌رسند.'}
        </span>
        <button
          className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-black text-white active:scale-95 transition-transform"
          onClick={() => {
            if (exact) void openExactAlarmSettings();
            else setView('settings');
          }}
        >
          {exact ? 'فعال‌سازی' : 'راهنما'}
        </button>
        <button
          className="shrink-0 p-1 rounded-lg active:scale-95 transition-transform"
          onClick={dismiss}
          aria-label="بستن هشدار"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * فاز ۳ — صفحه‌ی قفل بیومتریک: بالای همه‌ی محتوا (z-50، پس‌زمینه‌ی مات) — با هر خروج از
 * برنامه و بازگشت، ورود نیازمند اثر انگشت/چهره یا رمز دستگاه است (ماشین حالت: lib/appLock).
 * در وب هرگز رندر نمی‌شود (قفل فقط در اپ اندروید معنا دارد).
 */
function LockGate() {
  const locked = useAppStore((s) => s.lockState.locked);
  const lastMessage = useAppStore((s) => s.lockState.lastMessage);
  const unlockAttempt = useAppStore((s) => s.unlockAttempt);
  const triedRef = useRef(false);

  // پاپ‌آپ احراز هویت خودکار در اولین نمایش صفحه‌ی قفل
  useEffect(() => {
    if (locked && !triedRef.current) {
      triedRef.current = true;
      void unlockAttempt();
    }
  }, [locked, unlockAttempt]);

  if (!locked || !isNativeApp()) return null;
  return (
    <div
      className="absolute inset-0 z-[70] bg-background dark:bg-inverse-surface flex flex-col items-center justify-center gap-4 px-8"
      role="dialog"
      aria-modal="true"
      aria-label="برنامه قفل است — برای ورود احراز هویت کنید"
      data-testid="lock-gate"
    >
      <div className="w-16 h-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center">
        <Icon name="lock" size={32} />
      </div>
      <span className="text-headline-md font-black">کارام قفل است</span>
      <span className="text-body-sm text-on-surface-variant text-center leading-6">
        برای ورود، اثر انگشت/چهره یا رمز دستگاه خود را وارد کنید.
      </span>
      {lastMessage ? (
        <span className="text-xs text-center leading-5 text-amber-700 dark:text-amber-300 max-w-[280px]" role="status">
          {lastMessage}
        </span>
      ) : null}
      <button
        className="mt-2 rounded-xl bg-primary text-on-primary px-6 py-3 font-bold text-body-sm active:scale-95 transition-transform min-h-[44px]"
        onClick={() => void unlockAttempt()}
        aria-label="تلاش دوباره برای احراز هویت"
      >
        تلاش دوباره
      </button>
    </div>
  );
}

function SplashScreen() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-primary">
      <div className="w-14 h-14 rounded-2xl bg-primary text-on-primary flex items-center justify-center shadow-lg">
        <Icon name="checklist" size={28} />
      </div>
      <span className="text-headline-md font-black">کارام</span>
      <span className="text-body-sm text-on-surface-variant">در حال آماده‌سازی فضای آفلاین…</span>
    </div>
  );
}
