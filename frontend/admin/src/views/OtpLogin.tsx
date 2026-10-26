/**
 * کارام — پنل مدیریت: شورتکد ورود OTP (فاز ۴.۵ — فاز ۵: بله ← تلگرام)
 * میان‌بر مالک برای تست کامل جریان ورود بدون دسترسی به ایمیل/تلگرام/پیامک:
 * کد از سرور مستقیماً همین‌جا نمایش و تأیید داده می‌شود (همه‌ی اعمال در audit ثبت می‌شوند).
 *
 * گام ۱ — میان‌برها دیگر در کد هاردکد نیستند؛ از تنظیمات سرور
 * (کلید admin_otp_shortcuts — فقط برای ادمین با users.manage) خوانده می‌شوند.
 * اگر شورتکدی تنظیم نشده باشد، همان جریان به‌صورت دستی (انتخاب کانال + تایپ هدف) کار می‌کند.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Spinner } from '../ui';
import { IconCheck, IconKey, IconWarning } from '../icons';

type Channel = 'email' | 'telegram' | 'sms';

interface Shortcut {
  label: string;
  channel: Channel;
  target: string;
}

interface VerifyOk {
  isNew: boolean;
  user: { uuid: string; displayName: string | null; gender: string; email?: string; mobile?: string; telegramChatId?: string };
  accessToken: string;
  refreshToken: string;
}

const CHANNELS: { key: Channel; label: string; hint: string; targetLabel: string }[] = [
  { key: 'telegram', label: 'ربات تلگرام', hint: 'بعد از شروع، باید از حساب تلگرام خودتان روی دکمه‌ی «باز کردن تلگرام» بزنید و START را بفرستید؛ کد همان‌جا در پنل ظاهر می‌شود.', targetLabel: 'شناسه تلگرام (نمایشی — نیازی نیست)' },
  { key: 'email', label: 'ایمیل', hint: 'کد به صندوق ایمیل ارسال می‌شود؛ در شورتکد ادمین همان‌جا زیر هم نشان داده می‌شود.', targetLabel: 'آدرس ایمیل' },
  { key: 'sms', label: 'پیامک موبایل', hint: 'اگر پروایدر پیامک تنظیم نشده باشد، کد فقط در همین پنل نمایش داده می‌شود (حالت log).', targetLabel: 'شماره موبایل' },
];

const channelLabel = (c: Channel) => CHANNELS.find((x) => x.key === c)?.label ?? c;

export default function OtpLogin({ onToast }: { onToast: (kind: 'success' | 'error', text: string) => void }) {
  const [channel, setChannel] = useState<Channel>('email');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  // شورتکدهای داینامیک از سرور (گام ۱)
  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // وضعیت جریان
  const [code, setCode] = useState<string | null>(null); // کد نمایشی از سرور
  const [ticket, setTicket] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [pollStatus, setPollStatus] = useState<'idle' | 'polling' | 'sent'>('idle');
  const [enteredCode, setEnteredCode] = useState('');
  const [result, setResult] = useState<VerifyOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta = CHANNELS.find((c) => c.key === channel)!;

  useEffect(() => {
    api
      .otpShortcuts()
      .then((res) => setShortcuts(res.items ?? []))
      .catch(() => setShortcuts([])); // بدون شورتکد = جریان دستی
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  // انتخاب یک شورتکد از تنظیمات
  const applyShortcut = (idx: number) => {
    const sc = shortcuts?.[idx];
    if (!sc) return;
    setSelected(idx);
    setChannel(sc.channel);
    setTarget(sc.target);
    resetFlow();
  };

  // جریان دستی — بدون هدف پیش‌فرض (گام ۱: هیچ مقدار هاردکدی)
  const switchChannel = (c: Channel) => {
    setChannel(c);
    setSelected(null);
    setTarget('');
    resetFlow();
  };

  const resetFlow = () => {
    stopPolling();
    setCode(null);
    setTicket('');
    setDeepLink('');
    setPollStatus('idle');
    setEnteredCode('');
    setResult(null);
    setError(null);
  };

  const start = async () => {
    setError(null);
    setBusy(true);
    setResult(null);
    setEnteredCode('');
    setCode(null);
    try {
      const res = await api.otpRequest(channel, channel === 'telegram' ? undefined : target.trim());
      if (channel === 'telegram') {
        setTicket(res.ticket ?? '');
        setDeepLink(res.deepLink ?? '');
        setPollStatus('polling');
        // poll خودکار تا اتصال چت
        stopPolling();
        const t = res.ticket ?? '';
        pollRef.current = setInterval(async () => {
          try {
            const p = await api.otpTelegramPoll(t);
            if (p.status === 'code_sent' && p.code) {
              stopPolling();
              setCode(p.code);
              setPollStatus('sent');
              onToast('success', 'چت تلگرام متصل شد و کد صادر شد');
            } else if (p.status === 'expired') {
              stopPolling();
              setPollStatus('idle');
              setError('مهلت بلیت تمام شد؛ دوباره شروع کنید');
            }
          } catch {
            /* خطای موقت شبکه — دور بعد */
          }
        }, 3000);
      } else {
        setCode(res.code ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'درخواست ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const body: Parameters<typeof api.otpVerify>[0] = {
        channel,
        code: enteredCode.trim(),
      };
      if (channel === 'telegram') body.ticket = ticket;
      else body.target = target.trim();
      const res = await api.otpVerify(body);
      setResult(res);
      onToast('success', res.isNew ? 'ورود موفق — حساب جدید ساخته شد' : 'ورود موفق — کاربر موجود');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تأیید ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const canVerify = channel === 'telegram' ? ticket !== '' && pollStatus === 'sent' : target.includes('@') || channel === 'sms';

  return (
    <div className="space-y-4">
      {/* کارت معرفی */}
      <div className="card flex items-start gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <IconKey size={22} />
        </span>
        <div className="min-w-0 text-xs leading-6 text-slate-500">
          <p className="text-sm font-bold text-slate-700">شورتکد ورود OTP</p>
          <p>
            برای تست سریع ورود مالک: کد یک‌بارمصرف از سرور صادر و مستقیماً در همین صفحه نمایش داده می‌شود — بدون نیاز به
            صندوق ایمیل، تلگرام یا پیامک. میان‌برها از تنظیمات سرور می‌آیند (تنظیمات ← «شورتکد ورود مالک») و فقط برای
            ادمین با دسترسی مدیریت کاربران دیده می‌شوند.
          </p>
        </div>
      </div>

      {/* شورتکدهای تنظیم‌شده (داینامیک — گام ۱) */}
      {shortcuts === null ? (
        <Spinner />
      ) : shortcuts.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {shortcuts.map((sc, idx) => (
            <button
              key={`${sc.channel}-${sc.target}-${idx}`}
              type="button"
              onClick={() => applyShortcut(idx)}
              className={`card p-4 text-right transition-colors ${selected === idx && channel === sc.channel ? 'ring-2 ring-brand-500' : 'hover:bg-slate-50'}`}
            >
              <p className="text-sm font-bold text-slate-700">{sc.label}</p>
              <p dir="ltr" className="mt-1 truncate text-xs text-slate-400">
                {sc.channel === 'telegram' ? 'ربات تلگرام' : sc.target}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">{channelLabel(sc.channel)}</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-500">
          شورتکی تنظیم نشده است. از «تنظیمات ← شورتکد ورود مالک» میان‌بر بسازید، یا همین حالا کانال را دستی انتخاب و هدف
          را وارد کنید.
        </p>
      )}

      {/* انتخاب کانال دستی */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">کانال دستی:</span>
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => switchChannel(c.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              channel === c.key && selected === null
                ? 'border-brand-500 bg-brand-50 font-bold text-brand-700'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* جریان ورود */}
      <div className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="otp-target">{meta.targetLabel}</label>
          <div className="flex gap-2">
            <input
              id="otp-target"
              className="field"
              dir="ltr"
              value={target}
              disabled={channel === 'telegram' || busy}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={channel === 'email' ? 'you@example.com' : '09xxxxxxxxx'}
            />
            <button type="button" className="btn-primary shrink-0" disabled={busy || pollStatus === 'polling'} onClick={() => void start()}>
              {busy ? '…' : channel === 'telegram' ? 'شروع اتصال' : 'دریافت کد'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-400">{meta.hint}</p>
        </div>

        {/* تلگرام: بلیت + لینک + وضعیت */}
        {channel === 'telegram' && ticket ? (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">
              بلیت: <span dir="ltr" className="font-black tracking-widest text-slate-700">{ticket}</span>
            </p>
            {deepLink ? (
              <a href={deepLink} target="_blank" rel="noreferrer" className="btn-ghost mt-2 inline-flex text-brand-600">
                باز کردن تلگرام و ارسال START ↗
              </a>
            ) : null}
            {pollStatus === 'polling' ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <Spinner label="" /> در انتظار پیام START از حساب تلگرام شما…
              </p>
            ) : null}
          </div>
        ) : null}

        {/* کد نمایشی */}
        {code ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-700">کد صادرشده (از سرور — فقط در پنل):</p>
            <p dir="ltr" className="mt-1 text-center text-2xl font-black tracking-[0.5em] text-emerald-800">{code}</p>
            <button
              type="button"
              className="btn-ghost mt-1 w-full justify-center text-xs"
              onClick={() => {
                setEnteredCode(code);
                onToast('success', 'کد در فیلد تأیید قرار گرفت');
              }}
            >
              درج خودکار در فیلد پایین ↓
            </button>
          </div>
        ) : null}

        {/* تأیید */}
        {canVerify ? (
          <div>
            <label className="label" htmlFor="otp-code">کد دریافتی</label>
            <div className="flex gap-2">
              <input
                id="otp-code"
                className="field text-center tracking-[0.4em]"
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                value={enteredCode}
                onChange={(e) => setEnteredCode(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                placeholder="······"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && enteredCode.trim().length >= 4 && !busy) void verify();
                }}
              />
              <button type="button" className="btn-primary shrink-0" disabled={busy || enteredCode.trim().length < 4} onClick={() => void verify()}>
                {busy ? '…' : 'تأیید و ورود'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-600">
            <IconWarning size={16} /> {error}
          </p>
        ) : null}

        {/* نتیجه موفق */}
        {result ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-6 text-emerald-800">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <IconCheck size={18} /> ورود OTP موفق بود
            </p>
            <p className="mt-1">کاربر: {result.isNew ? 'جدید' : 'موجود'} — {result.user.displayName ?? 'بدون نام'}</p>
            <p dir="ltr" className="text-left">{result.user.email ?? result.user.mobile ?? result.user.telegramChatId}</p>
            <p dir="ltr" className="text-left text-[10px] text-emerald-600">uuid: {result.user.uuid}</p>
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-emerald-700">توکن‌های نشست (برای تست API)</summary>
              <p className="mt-1 break-all" dir="ltr">access: {result.accessToken}</p>
              <p className="break-all" dir="ltr">refresh: {result.refreshToken}</p>
            </details>
          </div>
        ) : null}

        {(code || ticket) && !result ? (
          <button type="button" className="btn-ghost w-full justify-center" onClick={resetFlow}>
            شروع دوباره
          </button>
        ) : null}
      </div>
    </div>
  );
}
