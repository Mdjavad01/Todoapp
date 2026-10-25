import { useEffect, useRef } from 'react';
import { StatusBar } from '@/components/StatusBar';
import { TopBar, SectionChips } from '@/components/TopBar';
import { BottomNav, Fab, Toast } from '@/components/BottomNav';
import { HomeView } from '@/views/HomeView';
import { ListView } from '@/views/ListView';
import { TodayView, AnalyticsView } from '@/views/TodayView';
import { TemplatesView, JobKitsView } from '@/views/TemplatesView';
import { PaywallView } from '@/views/PaywallView';
import { SettingsView, EmptyStateView } from '@/views/SettingsView';
import { SearchView } from '@/views/SearchView';
import { QuickAddSheet } from '@/modals/QuickAddSheet';
import { TaskDetailSheet } from '@/modals/TaskDetailSheet';
import { CalendarSheet } from '@/modals/CalendarSheet';
import { NewListSheet } from '@/modals/NewListSheet';
import { AccountSheet } from '@/modals/AccountSheet';
import { GuideSheet } from '@/modals/GuideSheet';
import { GenderOnboardingSheet } from '@/modals/GenderOnboardingSheet';
import { WelcomeOnboardingSheet } from '@/modals/WelcomeOnboardingSheet';
import { CoachAdd } from '@/components/CoachAdd';
import { useAppStore } from '@/store/useAppStore';
import { Icon } from '@/components/Icon';
import { onAppResume } from '@/lib/native';

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
    });
    return off;
  }, []);

  // min-h-dvh در موبایل: ارتفاع پویای واقعی ویوپورت — با min-h-screen (100vh) وقتی نوار آدرس مرورگر باز است،
  // قاب از صفحه کوتاه‌تر می‌شود و items-center فاصله‌ی خالی بالا/پایین می‌سازد
  return (
    <div className="min-h-dvh sm:min-h-screen w-full flex items-center justify-center p-0 sm:p-4 transition-colors duration-300">
      {/* موبایل: تمام‌صفحه زیر نوار وضعیت واقعی (safe-area) — دسکتاپ: قاب تلفن با نوار شبیه‌سازی‌شده */}
      <div className="relative w-full max-w-[410px] h-[100dvh] sm:h-[calc(100dvh-2rem)] sm:max-h-[884px] bg-background dark:bg-inverse-surface rounded-none sm:rounded-[40px] shadow-2xl flex flex-col overflow-hidden border-0 sm:border-[8px] sm:border-slate-800 transition-colors duration-200 pt-safe sm:pt-0">
        <StatusBar />
        <TopBar />
        <SectionChips />

        <main className="flex-1 overflow-y-auto no-scrollbar relative pb-24" id="appContent" ref={mainRef}>
          {!ready ? (
            <SplashScreen />
          ) : (
            <>
              {view === 'home' ? <HomeView /> : null}
              {view === 'listView' ? <ListView /> : null}
              {view === 'todayView' ? <TodayView /> : null}
              {view === 'analytics' ? <AnalyticsView /> : null}
              {view === 'templates' ? <TemplatesView /> : null}
              {view === 'jobkits' ? <JobKitsView /> : null}
              {view === 'paywall' ? <PaywallView /> : null}
              {view === 'emptyState' ? <EmptyStateView /> : null}
              {view === 'settings' ? <SettingsView /> : null}
              {view === 'search' ? <SearchView /> : null}
            </>
          )}
        </main>

        {ready ? <Fab /> : null}
        <CoachAdd />
        <BottomNav />
        <Toast />

        <QuickAddSheet />
        <TaskDetailSheet />
        <CalendarSheet />
        <NewListSheet />
        <AccountSheet />
        <GuideSheet />
        <GenderOnboardingSheet />
        <WelcomeOnboardingSheet />
      </div>
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
