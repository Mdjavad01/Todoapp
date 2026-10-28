/**
 * کارام — پنل مدیریت: داشبورد آمار
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { faNum, faDayShort, faMonthShort } from '../format';
import { priceText, usePriceDisplay } from '../usePriceDisplay';
import { Spinner, Bar } from '../ui';
import { IconUsers, IconVerified, IconBlock, IconRefresh, IconCard, IconCrown, IconChart, IconWarning } from '../icons';

type Stats = Awaited<ReturnType<typeof api.stats>>['stats'];

interface HealthWarning {
  code: string;
  message: string;
}

export default function Dashboard({ onToast }: { onToast: (kind: 'success' | 'error', text: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [priceMode] = usePriceDisplay();
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<HealthWarning[]>([]);

  const load = async () => {
    setBusy(true);
    try {
      const res = await api.stats();
      setStats(res.stats);
    } catch {
      onToast('error', 'بارگذاری آمار ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // گام ۱ — هشدارهای پیکربندی از سلامت سرویس (endpoint عمومی)
    fetch('/api/health', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((j: { warnings?: HealthWarning[] }) => setWarnings(Array.isArray(j.warnings) ? j.warnings : []))
      .catch(() => setWarnings([]));
  }, []);

  if (!stats) return busy ? <Spinner /> : null;

  const maxSignup = Math.max(1, ...stats.signupsSeries.map((s) => s.count));
  const completionPct = stats.content.tasks > 0 ? (stats.content.tasksCompleted / stats.content.tasks) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* هشدارهای پیکربندی (گام ۱) */}
      {warnings.map((w) => (
        <div
          key={w.code}
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs leading-6 text-amber-800"
        >
          <IconWarning size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <b>هشدار امنیتی:</b> {w.message}
          </span>
        </div>
      ))}

      {/* گام ۲ — وضعیت کلید پرداخت‌ها: وقتی هر پلتفرم بسته است بنر زرد می‌ماند */}
      {stats.payments && (!stats.payments.effectiveWeb || !stats.payments.effectiveAndroid) ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs leading-6 text-amber-800"
        >
          <IconWarning size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <b>کلید پرداخت‌ها بسته است:</b> وب {stats.payments.effectiveWeb ? 'باز ✓' : 'بسته ✕'} · اندروید{' '}
            {stats.payments.effectiveAndroid ? 'باز ✓' : 'بسته ✕'}
            {!stats.payments.anyMethodEnabled ? ' · هیچ روش پرداختی فعال نیست' : ''}
            {' — '}برای تغییر: <b>تنظیمات ← کلید اصلی پرداخت</b>
          </span>
        </div>
      ) : null}

      {/* کارت‌های آمار */}
      <section aria-label="آمار کلی" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={<IconUsers size={20} />} label="کل کاربران" value={faNum(stats.users.total)} />
        <StatCard icon={<IconUsers size={20} />} label="ثبت‌نام امروز" value={faNum(stats.users.today)} tone="brand" />
        <StatCard icon={<IconUsers size={20} />} label="۷ روز اخیر" value={faNum(stats.users.last7d)} tone="brand" />
        <StatCard icon={<IconVerified size={20} />} label="کاربران پرو" value={faNum(stats.users.premium)} tone="amber" />
        <StatCard icon={<IconBlock size={20} />} label="مسدود" value={faNum(stats.users.blocked)} tone="rose" />
        <StatCard icon={<IconRefresh size={20} />} label="نشست‌های فعال" value={faNum(stats.sessions)} />
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* نمودار ثبت‌نام */}
        <section aria-label="نمودار ثبت‌نام" className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">ثبت‌نام ۷ روز اخیر</h2>
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void load()} disabled={busy}>
              <IconRefresh size={16} /> به‌روزرسانی
            </button>
          </div>
          <div className="flex h-44 items-end justify-between gap-2" dir="ltr">
            {[...stats.signupsSeries].reverse().map((s) => (
              <div key={s.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" dir="rtl">
                <span className="text-[11px] font-semibold text-slate-500">{s.count > 0 ? faNum(s.count) : ''}</span>
                <SignupBar pct={(s.count / maxSignup) * 100} />
                <span className="max-w-full truncate text-[10px] text-slate-400">{faDayShort(s.date)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* محتوای اپ */}
        <section aria-label="آمار محتوا" className="card p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-700">محتوای کاربران</h2>
          <dl className="space-y-3 text-sm">
            <Row label="لیست‌ها" value={faNum(stats.content.lists)} />
            <Row label="کارها" value={faNum(stats.content.tasks)} />
            <Row label="زیرکارها" value={faNum(stats.content.subtasks)} />
          </dl>
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
              <span>نرخ انجام کارها</span>
              <span className="font-bold text-slate-700">{faNum(Math.round(completionPct))}٪</span>
            </div>
            <Bar percent={completionPct} />
          </div>
        </section>
      </div>

      {/* فروش و درآمد (گام ۱۹) */}
      <section aria-label="فروش و درآمد" className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">فروش و درآمد — ماه جاری</h2>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void load()} disabled={busy}>
            <IconRefresh size={16} /> به‌روزرسانی
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={<IconCard size={20} />}
            label="درآمد این ماه (تومان)"
            value={priceText(stats.sales.monthTotalTomans, priceMode)}
            tone="brand"
          />
          <StatCard
            icon={<IconVerified size={20} />}
            label="پرداخت موفق این ماه"
            value={faNum(stats.orders.monthPaidCount + stats.sales.monthDeposits)}
          />
          <StatCard
            icon={<IconCrown size={20} />}
            label="اشتراک فعال (پرو)"
            value={faNum(stats.sales.activePremium)}
            tone="amber"
          />
          <StatCard
            icon={<IconChart size={20} />}
            label="نرخ تبدیل ثبت‌نام ← پرداخت"
            value={`${faNum(stats.sales.conversionPercent)}٪`}
          />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          درآمد = درگاه بانکی ({priceText(stats.sales.monthOrderTomans, priceMode)}) + کارت‌به‌کارت تأییدشده ({priceText(stats.sales.monthDepositTomans, priceMode)}) · درآمد کل تا امروز: {priceText(stats.sales.lifetimeTotalTomans, priceMode)}
        </p>

        {/* نمودار ۶ماهه درآمد */}
        <div className="mt-4">
          <h3 className="mb-3 text-xs font-bold text-slate-500">روند درآمد ۶ ماه اخیر (تومان)</h3>
          <div className="flex h-36 items-end justify-between gap-2" dir="ltr">
            {[...stats.salesSeries].reverse().map((s) => {
              const maxRev = Math.max(1, ...stats.salesSeries.map((x) => x.revenueTomans));
              return (
                <div key={s.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" dir="rtl">
                  <span className="text-[11px] font-semibold text-slate-500">
                    {s.revenueTomans > 0 ? priceText(s.revenueTomans, priceMode) : ''}
                  </span>
                  <SignupBar pct={(s.revenueTomans / maxRev) * 100} />
                  <span className="max-w-full truncate text-[10px] text-slate-400">{faMonthShort(s.month)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* سفارش‌ها */}
      <section aria-label="سفارش‌ها" className="card p-5">
        <h2 className="mb-4 text-sm font-bold text-slate-700">سفارش‌ها و درآمد (پیش‌درآمد فاز ۵)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="سفارش‌های پرداخت‌شده" value={faNum(stats.orders.paidCount)} />
          <StatCard label="درآمد ثبت‌شده" value={priceText(stats.orders.paidAmountTomans, priceMode)} tone="brand" />
          <StatCard
            label="در انتظار بررسی"
            value={faNum(stats.orders.pendingReview)}
            tone={stats.orders.pendingReview > 0 ? 'amber' : 'slate'}
          />
        </div>
      </section>
    </div>
  );
}

/** ستون نمودار — ارتفاع داینامیک با CSSOM (سازگار با CSP؛ بدون style inline) */
function SignupBar({ pct }: { pct: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.setProperty('--h', `${Math.max(3, pct)}%`);
  }, [pct]);
  return <div ref={ref} className="signup-bar w-full max-w-10 rounded-t-lg bg-brand-500/90" />;
}

function StatCard({
  icon,
  label,
  value,
  tone = 'slate',
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: 'slate' | 'brand' | 'rose' | 'amber';
}) {
  const toneCls =
    tone === 'brand'
      ? 'bg-brand-50 text-brand-700'
      : tone === 'rose'
        ? 'bg-rose-50 text-rose-600'
        : tone === 'amber'
          ? 'bg-amber-50 text-amber-600'
          : 'bg-slate-100 text-slate-500';
  return (
    <div className="card flex items-center gap-3 p-4">
      {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneCls}`}>{icon}</span>}
      <div className="min-w-0">
        <p className="truncate text-[11px] text-slate-400">{label}</p>
        <p className="text-lg font-black leading-6 text-slate-800">{value}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-bold text-slate-800">{value}</dd>
    </div>
  );
}
