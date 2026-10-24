import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import * as repo from '@/db/repo';
import { toFa } from '@/lib/format';
import { openExternal } from '@/lib/native';
import {
  fetchChannels,
  pollTelegramTicket,
  requestOtp,
  verifyOtp,
  listSessions,
  revokeSession,
  updateProfile,
  type ActiveSession,
  type AuthChannels,
} from '@/sync/auth';

/**
 * شیت «حساب کاربری و سینک» — فاز ۳ (فاز ۵: بله ← تلگرام)
 * ورود با کد یک‌بارمصرف از دو راه: ایمیل و ربات تلگرام.
 * نقطه‌ی ورود: سطر «پشتیبان‌گیری در حساب کاربری» در تنظیمات (مطابق طرح)
 */

type Step = 'choose' | 'email' | 'telegram' | 'sms' | 'code';

const toFaDigits = (v: string | number): string =>
  toFa(String(v)).replace(/,/g, '');

export function AccountSheet() {
  const open = useAppStore((s) => s.accountSheet);
  const onClose = () => useAppStore.setState({ accountSheet: false });
  const session = useAppStore((s) => s.session);
  const syncState = useAppStore((s) => s.syncState);
  const signOut = useAppStore((s) => s.signOut);
  const reloadSession = useAppStore((s) => s.reloadSession);
  const syncNow = useAppStore((s) => s.syncNow);
  const showToast = useAppStore((s) => s.showToast);

  // ورود
  const [step, setStep] = useState<Step>('choose');
  const [channel, setChannel] = useState<'email' | 'telegram' | 'sms' | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<AuthChannels | null>(null);

  // ایمیل
  const [resendIn, setResendIn] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  // تلگرام
  const [ticket, setTicket] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [tgState, setTgState] = useState<'waiting' | 'sent'>('waiting');
  const [copied, setCopied] = useState(false);

  // پروفایل
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  // باز شدن شیت: کانال‌ها + نشست‌ها را بگیر
  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setError(null);
    setCode('');
    setDevCode(null);
    setTgState('waiting');
    void fetchChannels().then(setChannels).catch(() => setChannels({ email: true, telegram: false, sms: false, botUsername: '' }));
    if (useAppStore.getState().session) {
      void listSessions().then(setSessions).catch(() => setSessions([]));
    }
  }, [open]);

  // شمارش معکوس ارسال مجدد
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // poll تلگرام — تا وقتی روی مرحله‌ی تلگرامی‌ایم و منتظر کد هستیم
  useEffect(() => {
    if (step !== 'telegram' || tgState !== 'waiting' || !ticket) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const res = await pollTelegramTicket(ticket);
        if (!alive) return;
        if (res.status === 'code_sent') {
          setTgState('sent');
          setResendIn(0);
          setStep('code');
          setTimeout(() => codeRef.current?.focus(), 50);
        } else if (res.status === 'expired') {
          setError('مهلت بلیت تمام شد؛ کد جدید بگیرید');
          setStep('choose');
        }
      } catch {
        /* خطای شبکه در poll بی‌اهمیت است — دور بعد تلاش می‌شود */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [step, tgState, ticket]);

  const startEmail = () => {
    setError(null);
    setChannel('email');
    setStep('email');
  };

  const startTelegram = () => {
    setError(null);
    setChannel('telegram');
    setStep('telegram');
  };

  const startSms = () => {
    setError(null);
    setChannel('sms');
    setStep('sms');
  };

  const sendSmsCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestOtp('sms', phone.trim());
      setResendIn(res.resendAfter ?? 60);
      setDevCode(res.devCode ?? null);
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ارسال کد ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const sendEmailCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestOtp('email', email.trim());
      setResendIn(res.resendAfter ?? 60);
      setDevCode(res.devCode ?? null);
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ارسال کد ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const resendEmailCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestOtp('email', email.trim());
      setResendIn(res.resendAfter ?? 60);
      setDevCode(res.devCode ?? null);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ارسال مجدد ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const startTelegramLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestOtp('telegram');
      setTicket(res.ticket ?? '');
      setDeepLink(res.deepLink ?? '');
      setTgState('waiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت بلیت ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res =
        channel === 'telegram'
          ? await verifyOtp({ channel: 'telegram', ticket, code: code.trim() })
          : channel === 'sms'
            ? await verifyOtp({ channel: 'sms', target: phone.trim(), code: code.trim() })
            : await verifyOtp({ channel: 'email', target: email.trim(), code: code.trim() });
      await reloadSession();
      void listSessions().then(setSessions).catch(() => setSessions([]));
      showToast(res.isNew ? 'حساب شما ساخته شد و سینک ابری فعال شد' : 'ورود موفق؛ سینک ابری فعال شد');
      setStep('choose');
      setChannel(null);
      setEmail('');
      setPhone('');
      setCode('');
      setTicket('');
      setDevCode(null);
      setTgState('waiting');
      // آنبوردینگ ظاهر (فاز ۴.۵) — برای حسابی که هنوز جنسیت/تم انتخاب نکرده
      const needsOnboarding = (res.user.gender ?? 'unset') === 'unset';
      const localChoice = await repo.prefsGet<string>('gender-choice', 'none');
      if (needsOnboarding && localChoice === 'none') {
        useAppStore.setState({ accountSheet: false, genderSheet: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'کد تأیید نشد');
    } finally {
      setBusy(false);
    }
  };

  const copyTicket = async () => {
    try {
      await navigator.clipboard.writeText(ticket);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* کلیپ‌بورد در دسترس نیست */
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setSessions([]);
    showToast('از حساب خارج شدید؛ داده‌ها روی همین دستگاه باقی می‌مانند');
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setBusy(true);
    try {
      await updateProfile(name);
      await reloadSession();
      setEditingName(false);
      showToast('نام نمایشی به‌روزرسانی شد');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ذخیره‌ی نام ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const removeSession = async (id: number) => {
    try {
      await revokeSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      showToast('نشست بسته شد');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'بستن نشست ناموفق بود');
    }
  };

  const syncLabel = (): string => {
    if (syncState.status === 'syncing') return 'در حال سینک…';
    if (syncState.status === 'error') return 'خطا در سینک';
    if (syncState.lastSyncAt) {
      const t = new Date(syncState.lastSyncAt);
      return `آخرین سینک ${toFa(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`)}`;
    }
    return 'هنوز سینکی انجام نشده';
  };

  const codeDisabled = code.trim().length < 4 || busy;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="حساب کاربری و سینک" onClose={onClose} />

      {session ? (
        <>
          {/* ---------- کاربر وارد شده ---------- */}
          <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-bold text-headline-sm">
              {(session.displayName ?? session.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void saveName()}
                    maxLength={100}
                    aria-label="نام نمایشی"
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-surface-container dark:bg-slate-700 text-body-sm outline-none border border-outline-variant/40 focus:border-primary text-on-surface dark:text-slate-100"
                  />
                  <button
                    aria-label="ذخیره نام"
                    onClick={() => void saveName()}
                    disabled={busy || !nameDraft.trim()}
                    className="p-1.5 rounded-lg bg-primary text-on-primary disabled:opacity-40"
                  >
                    <Icon name="check" size={16} />
                  </button>
                  <button
                    aria-label="انصراف"
                    onClick={() => setEditingName(false)}
                    className="p-1.5 rounded-lg bg-surface-container text-on-surface-variant"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1 text-body-md font-bold truncate max-w-full"
                  onClick={() => {
                    setNameDraft(session.displayName ?? '');
                    setEditingName(true);
                  }}
                  aria-label="تغییر نام نمایشی"
                >
                  <span className="truncate">{session.displayName ?? 'بدون نام'}</span>
                  <Icon name="settings" size={13} className="text-outline shrink-0" />
                </button>
              )}
              <p className="text-body-sm text-on-surface-variant truncate" dir="ltr">{session.email}</p>
            </div>
            <span className="text-xs font-bold text-primary whitespace-nowrap">{syncLabel()}</span>
          </div>

          {syncState.status === 'error' && syncState.error ? (
            <p className="text-body-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl p-3">
              {syncState.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              className="flex-1 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={() => void syncNow()}
              disabled={syncState.status === 'syncing'}
            >
              <Icon name="cloud_sync" size={18} />
              <span>{syncState.status === 'syncing' ? 'در حال سینک…' : 'سینک الان'}</span>
            </button>
            <button
              className="px-4 py-3 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform"
              onClick={() => void handleSignOut()}
            >
              خروج از حساب
            </button>
          </div>

          {/* نشست‌های فعال */}
          <div>
            <p className="text-label-md font-bold mb-2">نشست‌های فعال ({toFaDigits(sessions.length)})</p>
            {sessions.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">نشستی یافت نشد</p>
            ) : (
              <div className="max-h-48 overflow-y-auto flex flex-col gap-2 pr-1 karam-scroll">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="bg-surface-container-lowest dark:bg-slate-800 rounded-xl p-3 flex items-center gap-2 border border-outline-variant/30"
                  >
                    <Icon name={s.current ? 'check_circle' : 'person'} size={18} className={s.current ? 'text-primary' : 'text-outline'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-body-sm font-bold truncate">
                        {s.deviceName ?? 'دستگاه'} {s.current ? <span className="text-primary text-xs">(همین دستگاه)</span> : null}
                      </p>
                      <p className="text-xs text-on-surface-variant" dir="ltr">
                        {s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleDateString('fa-IR') : new Date(s.issuedAt).toLocaleDateString('fa-IR')}
                      </p>
                    </div>
                    {!s.current ? (
                      <button
                        aria-label={`بستن نشست ${s.deviceName ?? ''}`}
                        onClick={() => void removeSession(s.id)}
                        className="p-2 rounded-lg text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {error ? (
            <p className="text-body-sm text-red-600 dark:text-red-300">{error}</p>
          ) : null}

          <p className="text-body-sm text-on-surface-variant leading-relaxed">
            داده‌های شما بین همه‌ی دستگاه‌هایی که با این حساب وارد شوند همگام می‌شود؛ حتی وقتی اینترنت نیست، تغییرات
            آفلاین ذخیره و بعداً سینک می‌شوند.
          </p>
        </>
      ) : (
        <>
          {/* ---------- حالت مهمان ---------- */}
          <div className="bg-surface-container-lowest dark:bg-slate-800 p-4 rounded-2xl border border-outline-variant/30 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center">
              <Icon name="person" size={24} />
            </div>
            <div>
              <p className="text-body-md font-bold">حالت مهمان</p>
              <p className="text-body-sm text-on-surface-variant">داده‌ها فقط روی همین دستگاه ذخیره می‌شوند</p>
            </div>
          </div>

          {step === 'choose' ? (
            <>
              <p className="text-label-md font-bold">ورود با کد یک‌بارمصرف</p>
              <div className="flex flex-col gap-2">
                <button
                  className="w-full py-3.5 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                  onClick={startEmail}
                >
                  <Icon name="mail" size={18} />
                  ورود با ایمیل
                </button>
                {channels?.sms ? (
                  <button
                    className="w-full py-3.5 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                    onClick={startSms}
                  >
                    <Icon name="notifications_active" size={18} />
                    ورود با شماره موبایل
                  </button>
                ) : null}
                {channels?.telegram ? (
                  <button
                    className="w-full py-3.5 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                    onClick={startTelegram}
                  >
                    <Icon name="fingerprint" size={18} />
                    ورود با ربات تلگرام
                  </button>
                ) : null}
              </div>
              {error ? <p className="text-body-sm text-red-600 dark:text-red-300">{error}</p> : null}
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                با ورود، داده‌های این دستگاه با حساب شما سینک می‌شود و روی دستگاه‌های دیگر هم در دسترس خواهد بود.
              </p>
            </>
          ) : null}

          {step === 'email' ? (
            <div>
              <label className="text-label-md font-bold mb-2 block" htmlFor="karam-login-email">
                ایمیل شما
              </label>
              <div className="flex gap-2">
                <input
                  id="karam-login-email"
                  type="email"
                  dir="ltr"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && email.includes('@') && !busy) void sendEmailCode();
                  }}
                  className="flex-1 px-4 py-3 rounded-2xl bg-surface-container dark:bg-slate-800 text-body-md outline-none border border-outline-variant/40 focus:border-primary transition-colors text-on-surface dark:text-slate-100 placeholder:text-outline"
                />
                <button
                  className="px-5 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50 whitespace-nowrap"
                  onClick={() => void sendEmailCode()}
                  disabled={busy || !email.includes('@')}
                >
                  {busy ? '…' : 'دریافت کد'}
                </button>
              </div>
              {error ? <p className="text-body-sm text-red-600 dark:text-red-300 mt-2">{error}</p> : null}
              <button
                className="text-body-sm text-primary font-bold mt-3"
                onClick={() => {
                  setError(null);
                  setStep('choose');
                }}
              >
                بازگشت
              </button>
            </div>
          ) : null}

          {step === 'telegram' ? (
            <div className="flex flex-col gap-3">
              <p className="text-label-md font-bold">ورود با ربات تلگرام</p>
              {tgState === 'waiting' && !ticket ? (
                <>
                  <p className="text-body-sm text-on-surface-variant leading-relaxed">
                    برای اطمینان از مالکیت چت تلگرام، یک کد کوتاه به شما می‌دهیم که برای ربات می‌فرستید؛ بعد کد ورود به
                    همان چت ارسال می‌شود.
                  </p>
                  <button
                    className="w-full py-3.5 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
                    onClick={() => void startTelegramLogin()}
                    disabled={busy}
                  >
                    {busy ? '…' : 'ساخت کد اتصال'}
                  </button>
                </>
              ) : null}
              {tgState === 'waiting' && ticket ? (
                <>
                  <p className="text-body-sm text-on-surface-variant leading-relaxed">
                    این کد را برای ربات <span dir="ltr" className="font-bold">@{channels?.botUsername}</span> در تلگرام
                    بفرستید (روی دکمه‌ی پایین بزنید تا چت باز شود):
                  </p>
                  <div className="flex items-center justify-center py-4 rounded-2xl bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30">
                    <span className="text-headline-lg font-black tracking-[0.5em] text-primary" dir="ltr">{ticket}</span>
                  </div>
                  <div className="flex gap-2">
                    {deepLink ? (
                      <button
                        className="flex-1 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm text-center active:scale-95 transition-transform"
                        onClick={() => void openExternal(deepLink)}
                      >
                        باز کردن تلگرام
                      </button>
                    ) : null}
                    <button
                      className="flex-1 py-3 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform"
                      onClick={() => void copyTicket()}
                    >
                      {copied ? 'کپی شد ✓' : 'کپی کد'}
                    </button>
                  </div>
                  <p className="text-body-sm text-on-surface-variant flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                    در انتظار پیام شما به ربات…
                  </p>
                </>
              ) : null}
              {tgState === 'sent' ? (
                <p className="text-body-sm text-primary font-bold">کد ورود به چت تلگرام شما ارسال شد ✓</p>
              ) : null}
              {error ? <p className="text-body-sm text-red-600 dark:text-red-300">{error}</p> : null}
              <button
                className="text-body-sm text-primary font-bold"
                onClick={() => {
                  setError(null);
                  setTicket('');
                  setTgState('waiting');
                  setStep('choose');
                }}
              >
                بازگشت
              </button>
            </div>
          ) : null}

          {step === 'sms' ? (
            <div>
              <label className="text-label-md font-bold mb-2 block" htmlFor="karam-login-phone">
                شماره موبایل شما
              </label>
              <div className="flex gap-2">
                <input
                  id="karam-login-phone"
                  type="tel"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="tel"
                  autoFocus
                  placeholder="09xxxxxxxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^0-9۰-۹+ ]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && phone.trim().length >= 10 && !busy) void sendSmsCode();
                  }}
                  className="flex-1 px-4 py-3 rounded-2xl bg-surface-container dark:bg-slate-800 text-body-md outline-none border border-outline-variant/40 focus:border-primary transition-colors text-on-surface dark:text-slate-100 placeholder:text-outline"
                />
                <button
                  className="px-5 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50 whitespace-nowrap"
                  onClick={() => void sendSmsCode()}
                  disabled={busy || phone.trim().length < 10}
                >
                  {busy ? '…' : 'دریافت کد'}
                </button>
              </div>
              {error ? <p className="text-body-sm text-red-600 dark:text-red-300 mt-2">{error}</p> : null}
              <button
                className="text-body-sm text-primary font-bold mt-3"
                onClick={() => {
                  setError(null);
                  setStep('choose');
                }}
              >
                بازگشت
              </button>
            </div>
          ) : null}

          {step === 'code' ? (
            <div>
              <label className="text-label-md font-bold mb-2 block" htmlFor="karam-login-code">
                کد ۶ رقمی
              </label>
              <p className="text-body-sm text-on-surface-variant mb-3">
                {channel === 'telegram'
                  ? 'کد ارسال‌شده به چت تلگرام‌تان را وارد کنید'
                  : channel === 'sms'
                    ? `کد به شماره ${phone} پیامک شد`
                    : `کد به ${email} ارسال شد`}
              </p>
              <input
                id="karam-login-code"
                ref={codeRef}
                type="text"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="······"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !codeDisabled) void confirmCode();
                }}
                className="w-full px-4 py-3.5 rounded-2xl bg-surface-container dark:bg-slate-800 text-headline-md text-center tracking-[0.6em] outline-none border border-outline-variant/40 focus:border-primary transition-colors text-on-surface dark:text-slate-100 placeholder:text-outline"
              />
              {devCode ? (
                <p className="text-xs text-on-surface-variant mt-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2" dir="ltr">
                  dev: {devCode}
                </p>
              ) : null}
              <div className="flex gap-2 mt-3">
                <button
                  className="flex-1 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
                  onClick={() => void confirmCode()}
                  disabled={codeDisabled}
                >
                  {busy ? '…' : 'تأیید و ورود'}
                </button>
                {channel === 'email' ? (
                  <button
                    className="px-4 py-3 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm disabled:opacity-40"
                    onClick={() => void resendEmailCode()}
                    disabled={resendIn > 0 || busy}
                  >
                    {resendIn > 0 ? `ارسال مجدد ${toFaDigits(resendIn)}ث` : 'ارسال مجدد'}
                  </button>
                ) : null}
              </div>
              {error ? <p className="text-body-sm text-red-600 dark:text-red-300 mt-2">{error}</p> : null}
              <button
                className="text-body-sm text-primary font-bold mt-3"
                onClick={() => {
                  setError(null);
                  setCode('');
                  setStep(channel === 'telegram' ? 'telegram' : 'email');
                }}
              >
                بازگشت
              </button>
            </div>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
