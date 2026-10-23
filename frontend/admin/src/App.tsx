/**
 * کارام — پنل مدیریت: چیدمان اصلی + مسیریابی hash (سازگار با هر هاست استاتیک)
 */
import { useCallback, useEffect, useState } from 'react';
import {
  clearSession,
  loadSession,
  saveSession,
  setUnauthorizedHandler,
  api,
  hasPerm,
  type AdminSession,
} from './api';
import { Toast, Spinner, useToast } from './ui';
import { IconDashboard, IconUsers, IconCard, IconMegaphone, IconSettings, IconHistory, IconLogout, IconMenu, IconClose, IconKey } from './icons';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import Users from './views/Users';
import Plans from './views/Plans';
import Announcements from './views/Announcements';
import Settings from './views/Settings';
import OtpLogin from './views/OtpLogin';
import Audit from './views/Audit';
type Route = 'dashboard' | 'users' | 'otplogin' | 'plans' | 'announcements' | 'settings' | 'audit';

const NAV: { key: Route; label: string; icon: typeof IconDashboard; perm?: string }[] = [
  { key: 'dashboard', label: 'داشبورد', icon: IconDashboard },
  { key: 'otplogin', label: 'شورتکد ورود OTP', icon: IconKey, perm: 'users.manage' },
  { key: 'users', label: 'کاربران', icon: IconUsers, perm: 'users.view' },
  { key: 'plans', label: 'پلن‌ها', icon: IconCard, perm: 'plans.manage' },
  { key: 'announcements', label: 'اطلاعیه‌ها', icon: IconMegaphone, perm: 'announcements.manage' },
  { key: 'settings', label: 'تنظیمات', icon: IconSettings, perm: 'settings.manage' },
  { key: 'audit', label: 'رخدادها', icon: IconHistory, perm: 'audit.view' },
];

function currentRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  return (NAV.some((n) => n.key === h) ? h : 'dashboard') as Route;
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(() => loadSession());
  const [route, setRoute] = useState<Route>(currentRoute);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast, show } = useToast();

  // ۴۰۱ از هر جا → خروج و صفحه‌ی ورود
  const handleUnauthorized = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
  }, [handleUnauthorized]);

  // روتر hash
  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute());
      setSidebarOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // تازه‌سازی دسترسی‌ها از سرور (تغییر نقش وسط نشست هم اعمال می‌شود)
  useEffect(() => {
    if (!session) return;
    api
      .me()
      .then((res) => {
        const fresh: AdminSession = {
          ...session,
          username: res.admin.username,
          roleCode: res.admin.roleCode,
          roleTitle: res.admin.roleTitle,
          permissions: res.permissions ?? [],
        };
        saveSession(fresh);
        setSession(fresh);
      })
      .catch(() => {
        /* ۴۰۱ خودش هندل می‌شود؛ بقیه‌ی خطاها مهم نیستند */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (r: Route) => {
    location.hash = `/${r}`;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* حتی اگر شبکه قطع بود، سمت کلاینت خارج می‌شویم */
    }
    clearSession();
    setSession(null);
    show('success', 'خارج شدید');
  };

  if (!session) {
    return (
      <>
        <Login
          onLogin={(s) => {
            setSession(s);
            navigate('dashboard');
          }}
        />
        <Toast toast={toast} />
      </>
    );
  }

  const visibleNav = NAV.filter((n) => !n.perm || hasPerm(session, n.perm));
  // مسیر بدون دسترسی → داشبورد
  const activeRoute = visibleNav.some((n) => n.key === route) ? route : 'dashboard';

  return (
    <div className="flex min-h-screen">
      {/* ستون کنار (دسکتاپ) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
        <Brand />
        <NavList nav={visibleNav} route={activeRoute} onNavigate={navigate} />
        <SessionFooter session={session} onLogout={logout} />
      </aside>

      {/* کشوی کنار (موبایل) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="absolute right-0 top-0 flex h-full w-64 flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between pl-3">
              <Brand />
              <button type="button" className="btn-ghost !p-1.5" onClick={() => setSidebarOpen(false)} aria-label="بستن منو">
                <IconClose size={20} />
              </button>
            </div>
            <NavList nav={visibleNav} route={activeRoute} onNavigate={navigate} />
            <SessionFooter session={session} onLogout={logout} />
          </aside>
        </div>
      )}

      {/* محتوا */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-7">
          <button type="button" className="btn-ghost !p-1.5 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="باز کردن منو">
            <IconMenu size={22} />
          </button>
          <h1 className="text-base font-bold text-slate-800">{NAV.find((n) => n.key === activeRoute)?.label}</h1>
          <span className="mr-auto hidden text-xs text-slate-400 sm:inline">
            {session.roleTitle} — {session.username}
          </span>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 lg:px-7 lg:py-7">
          {activeRoute === 'dashboard' && <Dashboard onToast={show} />}
          {activeRoute === 'otplogin' && <OtpLogin onToast={show} />}
          {activeRoute === 'users' && <Users onToast={show} session={session} />}
          {activeRoute === 'plans' && <Plans onToast={show} session={session} />}
          {activeRoute === 'announcements' && <Announcements onToast={show} />}
          {activeRoute === 'settings' && <Settings onToast={show} session={session} />}
          {activeRoute === 'audit' && <Audit onToast={show} />}
        </main>

        <footer className="mt-auto border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400 lg:px-7">
          کارام — پنل مدیریت · نسخه {`۱.۰.۰`} · همه‌ی رخدادهای مدیریتی ثبت می‌شوند
        </footer>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

/** ذخیره‌ی نشست در Login انجام می‌شود (saveSession) */

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </span>
      <div>
        <p className="text-sm font-black text-slate-800">کارام</p>
        <p className="text-[11px] leading-4 text-slate-400">پنل مدیریت</p>
      </div>
    </div>
  );
}

function NavList({ nav, route, onNavigate }: { nav: typeof NAV; route: Route; onNavigate: (r: Route) => void }) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="ناوبری پنل">
      {nav.map((n) => {
        const active = route === n.key;
        return (
          <button
            key={n.key}
            type="button"
            onClick={() => onNavigate(n.key)}
            aria-current={active ? 'page' : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? 'bg-brand-600 text-white shadow-card' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <n.icon size={20} />
            {n.label}
          </button>
        );
      })}
    </nav>
  );
}

function SessionFooter({ session, onLogout }: { session: AdminSession; onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="border-t border-slate-100 p-3">
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-dim px-3 py-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-black text-brand-700">
          {session.username.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-slate-700">{session.username}</p>
          <p className="text-[11px] text-slate-400">{session.roleTitle}</p>
        </div>
      </div>
      <button
        type="button"
        className="btn-ghost w-full justify-start text-rose-600 hover:!bg-rose-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onLogout();
          setBusy(false);
        }}
      >
        {busy ? <Spinner label="" /> : <IconLogout size={18} />}
        خروج از پنل
      </button>
    </div>
  );
}
