import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore, ACCENTS, type AccentColor } from '@/store/useAppStore';
import { toFa } from '@/lib/format';
import { downloadBackup, restoreBackup, localCounts } from '@/lib/backup';
import { queueSync } from '@/sync/engine';

const APP_VERSION = '۳.۲.۱';

const ACCENT_DOTS: Record<AccentColor, { bg: string; ring: string }> = {
  teal: { bg: 'bg-teal-600', ring: 'ring-teal-600' },
  indigo: { bg: 'bg-indigo-600', ring: 'ring-indigo-600' },
  amber: { bg: 'bg-amber-500', ring: 'ring-amber-500' },
  emerald: { bg: 'bg-emerald-600', ring: 'ring-emerald-600' },
  rose: { bg: 'bg-rose-500', ring: 'ring-rose-500' },
  purple: { bg: 'bg-purple-600', ring: 'ring-purple-600' },
};

/** بخش ۱۳: تنظیمات — همه‌ی ترجیحات در IndexedDB ذخیره می‌شوند */
export function SettingsView() {
  const accent = useAppStore((s) => s.accent);
  const setAccent = useAppStore((s) => s.setAccent);
  const biometricLock = useAppStore((s) => s.biometricLock);
  const alerts = useAppStore((s) => s.alerts);
  const setPref = useAppStore((s) => s.setPref);
  const setView = useAppStore((s) => s.setView);
  const openAccountSheet = useAppStore((s) => s.openAccountSheet);
  const openGenderSheet = useAppStore((s) => s.openGenderSheet);
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const syncState = useAppStore((s) => s.syncState);

  // پشتیبان‌گیری
  const fileRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [counts, setCounts] = useState<{ lists: number; tasks: number; subtasks: number; reminders: number } | null>(null);

  const refreshCounts = () => {
    void localCounts().then(setCounts).catch(() => setCounts(null));
  };
  // شمارش در اولین رندر و بازگشت به این صفحه
  useEffect(() => {
    refreshCounts();
  }, []);

  const syncHint = session
    ? syncState.status === 'syncing'
      ? 'در حال سینک…'
      : syncState.status === 'error'
        ? 'خطا در سینک'
        : syncState.lastSyncAt
          ? 'سینک شد ✓'
          : 'فعال'
    : 'ورود به حساب';

  const doExport = async () => {
    setBackupBusy(true);
    try {
      const total = await downloadBackup();
      showToast(`فایل پشتیبان (${toFa(total)} رکورد) دانلود شد؛ آن را در جای امن نگه دارید`);
      refreshCounts();
    } catch {
      showToast('ساخت فایل پشتیبان ناموفق بود');
    } finally {
      setBackupBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBackupBusy(true);
    try {
      const raw = await file.text();
      const report = await restoreBackup(raw);
      if (report.invalid) {
        showToast('این فایل پشتیبان کارام نیست');
        return;
      }
      queueSync(); // اگر حساب ابری فعال باشد، داده‌ی بازیابی‌شده به سرور هم می‌رود
      showToast(`بازیابی شد: ${toFa(report.added + report.updated)} رکورد افزوده/به‌روز شد${report.kept > 0 ? `، ${toFa(report.kept)} مورد محلی جدیدتر ماند` : ''}`);
      refreshCounts();
    } catch {
      showToast('خواندن فایل پشتیبان ناموفق بود');
    } finally {
      setBackupBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="p-margin flex flex-col gap-4" id="view-settings">
      <h2 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">تنظیمات</h2>

      {/* ظاهر و تم (جنسیت) */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 overflow-hidden divide-y divide-outline-variant/20 text-body-md">
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={openGenderSheet}
          role="button"
          aria-label="انتخاب ظاهر دخترانه یا پسرانه"
        >
          <div className="flex items-center gap-2.5">
            <Icon name="auto_awesome" size={22} className="text-outline" />
            <span>ظاهر اپ (دخترانه / پسرانه)</span>
          </div>
          <span className="text-xs text-primary font-bold">{ACCENTS[accent].label}</span>
        </div>
      </div>

      {/* انتخاب رنگ برند */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex flex-col gap-3">
        <span className="text-label-md font-bold">رنگ برجستگی برند</span>
        <div className="flex items-center justify-between px-2">
          {(Object.keys(ACCENT_DOTS) as AccentColor[]).map((a) => {
            const d = ACCENT_DOTS[a];
            const active = accent === a;
            return (
              <button
                key={a}
                className={`w-8 h-8 rounded-full ${d.bg} ${active ? `ring-2 ring-offset-2 ${d.ring} dark:ring-offset-slate-800` : ''}`}
                onClick={() => setAccent(a)}
                title={ACCENTS[a].label}
                aria-label={`رنگ ${ACCENTS[a].label}`}
                aria-pressed={active}
              />
            );
          })}
        </div>
      </div>

      {/* پشتیبان‌گیری و بازیابی */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-label-md font-bold flex items-center gap-2">
            <Icon name="cloud_sync" size={20} className="text-outline" />
            پشتیبان‌گیری از داده‌ها
          </span>
          {counts ? (
            <span className="text-xs text-on-surface-variant">
              {toFa(counts.lists)} لیست · {toFa(counts.tasks)} کار · {toFa(counts.subtasks)} زیرکار
            </span>
          ) : null}
        </div>
        <p className="text-body-sm text-on-surface-variant leading-relaxed">
          از همه‌ی داده‌های این دستگاه یک فایل پشتیبان بگیرید و هر وقت خواستید روی همین یا دستگاه دیگر بازیابی کنید.
          {session ? ' چون وارد حساب شده‌اید، بعد از بازیابی خودکار به فضای ابری هم سینک می‌شود.' : ''}
        </p>
        <div className="flex gap-2">
          <button
            className="flex-1 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
            onClick={() => void doExport()}
            disabled={backupBusy}
          >
            <Icon name="check_circle" size={18} />
            دریافت فایل پشتیبان
          </button>
          <button
            className="flex-1 py-3 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={backupBusy}
          >
            بازیابی از فایل
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="انتخاب فایل پشتیبان"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
            }}
          />
        </div>
      </div>

      {/* لیست ترجیحات */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 overflow-hidden divide-y divide-outline-variant/20 text-body-md">
        <div className="p-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <Icon name="fingerprint" size={22} className="text-outline" />
            <span>قفل بیومتریک و اثرانگشت</span>
          </div>
          <input
            type="checkbox"
            className="rounded text-primary focus:ring-0"
            checked={biometricLock}
            onChange={(e) => setPref('biometricLock', e.target.checked)}
            aria-label="قفل بیومتریک"
          />
        </div>
        <div className="p-3.5 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <Icon name="notifications_active" size={22} className="text-outline" />
            <span>اعلان‌ها و دورزدن باتری (هشدار دقیق)</span>
          </div>
          <input
            type="checkbox"
            className="rounded text-primary focus:ring-0"
            checked={alerts}
            onChange={(e) => setPref('alerts', e.target.checked)}
            aria-label="اعلان‌ها"
          />
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={openAccountSheet}
          role="button"
          aria-label="حساب کاربری و سینک"
        >
          <div className="flex items-center gap-2.5">
            <Icon name="person" size={22} className="text-outline" />
            <span>حساب کاربری و سینک ابری</span>
          </div>
          <span className="text-xs text-primary font-bold">{syncHint}</span>
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => setView('paywall')}
        >
          <div className="flex items-center gap-2.5">
            <Icon name="star" size={22} className="text-outline" />
            <span className="font-bold">ارتقا به نسخه پرو</span>
          </div>
          <Icon name="arrow_back_ios" size={16} className="text-outline" />
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => showToast('به‌زودی در کافه‌بازار منتشر می‌شود')}
        >
          <div className="flex items-center gap-2.5">
            <Icon name="shop" size={22} className="text-outline" />
            <span>ثبت نظر در کافه‌بازار</span>
          </div>
          <span className="text-xs text-outline">نسخه {toFa(APP_VERSION)}</span>
        </div>
      </div>

      {/* حالت مهمان / حساب */}
      <p className="text-body-sm text-on-surface-variant text-center leading-relaxed">
        {session ? (
          <>
            وارد حساب <span className="font-bold text-primary" dir="ltr">{session.email}</span> شده‌اید؛ داده‌ها بین
            دستگاه‌های شما سینک می‌شوند.
          </>
        ) : (
          <>
            شما در <span className="font-bold text-primary">حالت مهمان</span> هستید؛ همه‌ی داده‌ها فقط روی همین دستگاه
            (IndexedDB) ذخیره می‌شوند و کاملاً آفلاین کار می‌کنند.
          </>
        )}
      </p>
    </section>
  );
}

/** بخش ۱۴: وضعیت خالی (نمایش مستقل) */
export function EmptyStateView() {
  const openModal = useAppStore((s) => s.openModal);
  return (
    <section className="p-margin flex flex-col items-center justify-center text-center gap-3 py-16" id="view-emptyState">
      <div className="w-20 h-20 rounded-2xl bg-surface-container dark:bg-slate-800 flex items-center justify-center text-primary mb-2">
        <Icon name="checklist" size={36} />
      </div>
      <h3 className="text-headline-lg font-bold text-on-surface dark:text-inverse-on-surface">هیچ کاری برای امروز نمانده!</h3>
      <p className="text-body-sm text-on-surface-variant max-w-[260px] leading-relaxed">
        تمام وظایف تعیین‌شده با موفقیت انجام شده‌اند. وقت یک استراحت کوتاه است.
      </p>
      <button
        className="mt-4 px-6 py-2.5 bg-primary text-white font-bold rounded-2xl shadow-md active:scale-95 text-body-sm flex items-center gap-1.5"
        onClick={() => openModal('quickAdd')}
      >
        <Icon name="add" size={18} />
        <span>افزودن کار جدید</span>
      </button>
    </section>
  );
}
