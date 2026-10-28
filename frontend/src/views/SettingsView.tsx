import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore, ACCENTS, type AccentColor, type FontScale } from '@/store/useAppStore';
import { toFa } from '@/lib/format';
import { downloadBackup, restoreBackup, localCounts } from '@/lib/backup';
import { isNativeApp } from '@/lib/native';
import { queueSync } from '@/sync/engine';

const APP_VERSION = '۴.۱.۰';
/** نسخه ماشینی برای مقایسه با «آخرین نسخه» سرور (چک‌کننده به‌روزرسانی v17) */
const APP_VERSION_RAW = '4.1.0';

/** آیا نسخه‌ی سرویس از نسخه‌ی فعلی اپ جدیدتر است؟ (مقایسه‌ی عددی سه‌بخشی) */
function isNewerVersion(latest: string | null | undefined, current: string): boolean {
  if (!latest) return false;
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

/** گزینه‌های اندازه‌ی فونت — preview فقط برای پیش‌نمایش دکمه‌هاست */
const FONT_SIZES: { value: FontScale; label: string; hint: string; preview: number }[] = [
  { value: 'small', label: 'کوچک', hint: 'فشرده', preview: 12 },
  { value: 'medium', label: 'متوسط', hint: 'پیشنهادی', preview: 14 },
  { value: 'large', label: 'بزرگ', hint: 'راحت‌تر', preview: 16 },
];

/** پرسش‌های راهنما به پاپ‌آپ GuideSheet (v11) منتقل شدند — اینجا فقط ردیف بازکننده است */

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
  const fontScale = useAppStore((s) => s.fontScale);
  const setFontScale = useAppStore((s) => s.setFontScale);
  const biometricLock = useAppStore((s) => s.biometricLock);
  const alerts = useAppStore((s) => s.alerts);
  const setPref = useAppStore((s) => s.setPref);
  const setView = useAppStore((s) => s.setView);
  const openAccountSheet = useAppStore((s) => s.openAccountSheet);
  const openGenderSheet = useAppStore((s) => s.openGenderSheet);
  const openGuideSheet = useAppStore((s) => s.openGuideSheet);
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const syncState = useAppStore((s) => s.syncState);
  const appSettings = useAppStore((s) => s.appSettings);
  const openTermsSheet = useAppStore((s) => s.openTermsSheet);
  const openModal = useAppStore((s) => s.openModal);
  const premium = useAppStore((s) => s.premium);
  const isPro = premium.loaded && premium.isPremium;

  // چک‌کننده به‌روزرسانی (v17) — «آخرین نسخه» از پنل ادمین ثبت می‌شود
  const update = appSettings.update;
  const hasUpdate = isNewerVersion(update?.latest, APP_VERSION_RAW);

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
      <h1 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">تنظیمات</h1>

      {/* فاز الف — کارت کوچک اشتراک پرو (بالای تنظیمات). کلید خاموشی پرداخت‌ها در شیت پرداخت
          مثل قبل مدیریت می‌شود — این کارت فقط مسیر ورود را حفظ می‌کند */}
      <div
        className="rounded-2xl border border-secondary/30 bg-secondary/5 dark:bg-secondary/10 p-4 flex items-center justify-between gap-3 cursor-pointer active:scale-[0.99] transition-transform"
        onClick={() => setView('paywall')}
        role="button"
        aria-label={isPro ? 'وضعیت اشتراک کارام پرو' : 'ارتقا به کارام پرو'}
        id="settings-pro"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon name="workspace_premium" size={26} className="text-secondary shrink-0" />
          <div className="min-w-0">
            <p className="text-body-md font-bold text-on-surface dark:text-inverse-on-surface">
              {isPro ? 'اشتراک کارام پرو فعال است' : 'ارتقا به کارام پرو'}
            </p>
            <p className="text-xs text-on-surface-variant truncate">
              {isPro
                ? premium.daysLeft !== null
                  ? `${toFa(premium.daysLeft)} روز باقی‌مانده`
                  : 'بدون محدودیت زمانی'
                : 'تحلیل عمقی، بسته‌های شغلی و تم‌های اختصاصی'}
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 bg-secondary text-white text-xs font-bold rounded-lg shadow shrink-0">
          {isPro ? 'پرو' : 'مشاهده'}
        </span>
      </div>

      {/* فاز الف — قالب‌ها و بسته‌های شغلی (از خانه به تنظیمات منتقل شدند) + مدیریت لیست‌ها */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 overflow-hidden divide-y divide-outline-variant/20 text-body-md">
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => setView('templates')}
          role="button"
          aria-label="قالب‌های آماده"
        >
          <div className="flex items-center gap-2.5">
            <Icon name="auto_awesome" size={22} className="text-outline" />
            <span>قالب‌های آماده</span>
          </div>
          <Icon name="arrow_back_ios" size={14} className="text-outline" />
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => setView('jobkits')}
          role="button"
          aria-label="بسته‌های شغلی تخصصی"
        >
          <div className="flex items-center gap-2.5">
            <Icon name="psychology" size={22} className="text-outline" />
            <span>بسته‌های شغلی تخصصی</span>
          </div>
          <Icon name="arrow_back_ios" size={14} className="text-outline" />
        </div>
        <div
          className="p-3.5 flex justify-between items-center cursor-pointer"
          onClick={() => openModal('manageLists')}
          role="button"
          aria-label="مدیریت لیست‌ها و ردیف‌های خانه"
        >
          <div className="flex items-center gap-2.5">
            <Icon name="folder" size={22} className="text-outline" />
            <span>مدیریت لیست‌ها و ردیف‌های خانه</span>
          </div>
          <Icon name="arrow_back_ios" size={14} className="text-outline" />
        </div>
      </div>

      {/* کارت به‌روزرسانی (v17) — فقط وقتی سرور نسخه‌ی جدیدتری ثبت کرده باشد */}
      {hasUpdate ? (
        <div
          className="rounded-2xl border border-primary/35 bg-primary/10 p-4 relative overflow-hidden"
          id="settings-update"
          role="status"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary text-on-primary flex items-center justify-center shrink-0 shadow-sm">
              <Icon name="auto_awesome" size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-body-md text-on-surface dark:text-inverse-on-surface">
                نسخه‌ی جدید کارام ({toFa(update?.latest ?? '')}) منتشر شده
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">شما روی نسخه‌ی {toFa(APP_VERSION)} هستید</p>
            </div>
          </div>
          {update?.notes ? (
            <p className="text-body-sm text-on-surface-variant leading-relaxed mt-3 whitespace-pre-line">{update.notes}</p>
          ) : null}
          {update?.url ? (
            <a
              href={update.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 w-full py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-1.5"
            >
              <Icon name="refresh" size={17} />
              دانلود به‌روزرسانی
            </a>
          ) : (
            <p className="text-xs text-on-surface-variant mt-3 leading-relaxed">
              برای به‌روزرسانی، پک جدید را از داشبورد فرماندهی بگیرید و طبق نصب.txt در هاست استخراج کنید.
            </p>
          )}
        </div>
      ) : null}

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

      {/* اندازه‌ی فونت اپ (v9) */}
      <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex flex-col gap-3">
        <span className="text-label-md font-bold flex items-center gap-2">
          <Icon name="format_size" size={20} className="text-outline" />
          اندازه‌ی فونت اپ
        </span>
        <div className="grid grid-cols-3 gap-2">
          {FONT_SIZES.map((f) => {
            const active = fontScale === f.value;
            return (
              <button
                key={f.value}
                className={`py-2.5 rounded-xl font-bold active:scale-95 transition-all flex flex-col items-center gap-0.5 border ${
                  active
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container text-on-surface-variant border-transparent'
                }`}
                onClick={() => setFontScale(f.value)}
                aria-pressed={active}
                aria-label={`اندازه‌ی فونت ${f.label}`}
              >
                <span style={{ fontSize: `${f.preview}px`, lineHeight: 1.4 }}>{f.label}</span>
                <span className="text-[10px] opacity-80">{f.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="text-body-sm text-on-surface-variant leading-relaxed rounded-xl bg-surface-container dark:bg-slate-700/50 p-3">
          نمونه‌ی متن — ۳ کار برای امروز داری ✨ همه‌ی صفحه‌ها با همین اندازه نشان داده می‌شوند.
        </p>
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
        {isNativeApp() ? (
          <p className="px-3.5 pb-3 -mt-1 text-[11px] leading-5 text-on-surface-variant">
            یادآور سررسید با اعلان بومی اندروید زده می‌شود. اگر یادآور نیامد: مجوز اعلان برنامه را بدهید، «آلارم‌ها و یادآورها» (زمان‌بندی دقیق) را فعال کنید و در گوشی‌های شیائومی/سامسونگ «شروع خودکار» و «بدون محدودیت باتری» را برای کارام روشن کنید.
          </p>
        ) : null}
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
          onClick={() => showToast('به‌زودی در کافه‌بازار منتشر می‌شود')}
        >
          <div className="flex items-center gap-2.5">
            <Icon name="shop" size={22} className="text-outline" />
            <span>ثبت نظر در کافه‌بازار</span>
          </div>
          <span className="text-xs text-outline">نسخه {toFa(APP_VERSION)}</span>
        </div>
      </div>

      {/* راهنمای کارام (v11) — پاپ‌آپ مرکزی جذاب */}
      <div
        className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 p-3.5 flex justify-between items-center cursor-pointer active:scale-[0.99] transition-transform"
        onClick={openGuideSheet}
        role="button"
        aria-label="باز کردن راهنمای کارام"
        id="settings-guide"
      >
        <div className="flex items-center gap-2.5">
          <Icon name="help" size={22} className="text-outline" />
          <div className="flex flex-col">
            <span className="font-bold">راهنمای کارام</span>
            <span className="text-xs text-on-surface-variant">۹ پرسش و پاسخ — همه‌چیز درباره‌ی کارام</span>
          </div>
        </div>
        <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Icon name="arrow_back_ios" size={14} />
        </span>
      </div>

      {/* قوانین، حریم خصوصی و پشتیبانی (v17) */}
      <div
        className="bg-surface-container-lowest dark:bg-slate-800 rounded-2xl border border-outline-variant/30 p-3.5 flex justify-between items-center cursor-pointer active:scale-[0.99] transition-transform"
        onClick={openTermsSheet}
        role="button"
        aria-label="قوانین، حریم خصوصی و پشتیبانی"
        id="settings-terms"
      >
        <div className="flex items-center gap-2.5">
          <Icon name="shield" size={22} className="text-outline" />
          <div className="flex flex-col">
            <span className="font-bold">قوانین، حریم خصوصی و پشتیبانی</span>
            <span className="text-xs text-on-surface-variant">۱۳ بند شفاف + راه ارتباطی تیم کارام</span>
          </div>
        </div>
        <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Icon name="arrow_back_ios" size={14} />
        </span>
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
