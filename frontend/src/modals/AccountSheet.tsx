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
  fetchMyData,
  requestDeleteCode,
  confirmAccountDeletion,
  type ActiveSession,
  type AuthChannels,
} from '@/sync/auth';
import { fetchReferral, redeemReferral, referralShareText, type ReferralInfo } from '@/sync/referral';

/**
 * شیت «حساب کاربری و سینک» — فاز ۳ (فاز ۵: بله ← تلگرام)
 * ورود با کد یک‌بارمصرف از دو راه: ایمیل و ربات تلگرام.
 * نقطه‌ی ورود: سطر «پشتیبان‌گیری در حساب کاربری» در تنظیمات (مطابق طرح)
 */

type Step = 'choose' | 'email' | 'telegram' | 'sms' | 'code';

/** P1 — مراحل شیت حذف حساب */
type DeleteStep = 'none' | 'warn' | 'code' | 'confirm';

/** عبارت تأیید حذف — باید دقیقاً همین باشد (سمت سرور هم کنترل می‌شود) */
const DELETE_CONFIRM_TEXT = 'حذف حساب';

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

  // v20 — دعوت دوستان (رفرال)
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [refInput, setRefInput] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [refCopied, setRefCopied] = useState(false);

  // P1 — دریافت داده و حذف حساب
  const [exportBusy, setExportBusy] = useState(false);
  const [delStep, setDelStep] = useState<DeleteStep>('none');
  const [delChannel, setDelChannel] = useState<'email' | 'telegram' | 'sms' | null>(null);
  const [delTarget, setDelTarget] = useState('');
  const [delCode, setDelCode] = useState('');
  const [delConfirmText, setDelConfirmText] = useState('');
  const [delDevCode, setDelDevCode] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const delCodeRef = useRef<HTMLInputElement>(null);

  // باز شدن شیت: کانال‌ها + نشست‌ها را بگیر
  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setError(null);
    setCode('');
    setDevCode(null);
    setTgState('waiting');
    // P1 — وضعیت حذف حساب هم صفر شود
    setDelStep('none');
    setDelError(null);
    setDelCode('');
    setDelConfirmText('');
    setDelDevCode(null);
    void fetchChannels().then(setChannels).catch(() => setChannels({ email: true, telegram: false, sms: false, botUsername: '' }));
    if (useAppStore.getState().session) {
      void listSessions().then(setSessions).catch(() => setSessions([]));
      // v20 — وضعیت رفرال (اگر فعال باشد کارت دعوت نشان داده می‌شود)
      setReferral(null);
      setRefError(null);
      fetchReferral()
        .then((r) => setReferral(r.enabled ? r : { ...r, enabled: false }))
        .catch(() => setReferral(null));
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
      // آنبوردینگ کامل (v10) — حساب تازه: خوش‌آمد + ثبت نام + انتخاب ظاهر
      if (res.isNew) {
        await repo.prefsSet('welcome-done', 'none');
        useAppStore.setState({ accountSheet: false, welcomeSheet: true });
      } else if ((res.user.gender ?? 'unset') === 'unset') {
        // حساب‌های قدیمی‌تر: فقط شیت ظاهر (مثل قبل)
        const localChoice = await repo.prefsGet<string>('gender-choice', 'none');
        if (localChoice === 'none') {
          useAppStore.setState({ accountSheet: false, genderSheet: true });
        }
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
    // کانال‌های ورود ممکن است از آخرین خواندن تغییر کرده باشند (مثلاً فعال‌شدن تلگرام از پنل) — تازه بگیر
    void fetchChannels().then(setChannels).catch(() => setChannels({ email: true, telegram: false, sms: false, botUsername: '' }));
    showToast('از حساب خارج شدید؛ داده‌های این حساب از دستگاه پاک شد');
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

  /* ---------- P1 — دریافت داده‌های من (Export) ---------- */

  const downloadMyData = async (): Promise<boolean> => {
    setExportBusy(true);
    try {
      const data = await fetchMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `karam-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('داده‌های شما دانلود شد؛ فایل را در جای امن نگه دارید');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت داده‌ها ناموفق بود');
      return false;
    } finally {
      setExportBusy(false);
    }
  };

  /* ---------- P1 — حذف حساب (سه مرحله: هشدار ← کد ← تأیید متنی) ---------- */

  const keepDays = useAppStore((s) => s.appSettings.backup?.keepDays ?? 7);

  const requestDelete = async () => {
    setDelError(null);
    setDelBusy(true);
    try {
      const res = await requestDeleteCode();
      setDelChannel(res.channel);
      setDelTarget(res.target ?? '');
      setDelDevCode(res.devCode ?? null);
      setDelCode('');
      setDelStep('code');
      setTimeout(() => delCodeRef.current?.focus(), 50);
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'ارسال کد حذف ناموفق بود');
    } finally {
      setDelBusy(false);
    }
  };

  const verifyDeleteCode = async () => {
    // کد اینجا مصرف نمی‌شود؛ فقط غیرخالی بودنش برای رفتن به مرحله‌ی تأیید متنی چک می‌شود —
    // راستی‌آزمایی واقعی فقط با confirm سمت سرور انجام می‌شود (تلاش ناموفق سعی را نمی‌سوزاند)
    if (delCode.trim().length < 4) return;
    setDelError(null);
    setDelStep('confirm');
  };

  const doDeleteAccount = async () => {
    if (delConfirmText.trim() !== DELETE_CONFIRM_TEXT) return;
    setDelBusy(true);
    setDelError(null);
    try {
      await confirmAccountDeletion(delCode.trim(), delConfirmText.trim());
      // حساب سمت سرور حذف شد → پاک‌سازی کامل محلی (نشست + داده) مثل خروج
      await signOut();
      showToast('حساب شما حذف شد؛ داده‌های این دستگاه هم پاک شد');
      setDelStep('none');
      onClose();
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'حذف حساب ناموفق بود');
    } finally {
      setDelBusy(false);
    }
  };

  /* ---------- v20 — دعوت دوستان ---------- */

  const copyReferral = async () => {
    if (!referral?.code) return;
    try {
      await navigator.clipboard.writeText(referral.code);
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2000);
      showToast('کد دعوت کپی شد');
    } catch {
      showToast('کپی خودکار نشد؛ کد را دستی انتخاب کنید');
    }
  };

  const shareReferral = () => {
    if (!referral?.code) return;
    const text = referralShareText(referral.code, referral.days);
    const url = referral.shareUrl ?? 'https://app.hojre24shop.ir';
    void openExternal(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  };

  const doRedeem = async () => {
    const code = refInput.trim();
    if (code.length < 4 || refBusy) return;
    setRefBusy(true);
    setRefError(null);
    try {
      const res = await redeemReferral(code);
      showToast(res.message);
      setRefInput('');
      void useAppStore.getState().reloadPremium();
      fetchReferral()
        .then((r) => setReferral(r.enabled ? r : { ...r, enabled: false }))
        .catch(() => setReferral(null));
    } catch (e) {
      setRefError(e instanceof Error ? e.message : 'فعال‌سازی کد ناموفق بود');
    } finally {
      setRefBusy(false);
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

          {/* ---------- v20 — دعوت دوستان (رفرال) ---------- */}
          {referral?.enabled && referral.code ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Icon name="workspace_premium" size={20} className="text-primary shrink-0" />
                <p className="text-body-sm font-black text-on-surface dark:text-inverse-on-surface flex-1">
                  دعوت دوستان — هر دو طرف {toFa(referral.days)} روز پرو
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <code
                  dir="ltr"
                  className="flex-1 min-w-0 rounded-xl bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 px-3 py-2.5 text-center text-body-md font-black tracking-widest text-primary"
                >
                  {referral.code}
                </code>
                <button
                  type="button"
                  className="shrink-0 rounded-xl bg-primary text-on-primary px-3 py-2.5 text-xs font-bold active:scale-95 transition-transform flex items-center gap-1"
                  onClick={() => void copyReferral()}
                  aria-label="کپی کد دعوت"
                >
                  <Icon name="content_copy" size={15} />
                  {refCopied ? 'کپی شد' : 'کپی'}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded-xl bg-surface-container dark:bg-slate-700 text-on-surface dark:text-slate-100 px-3 py-2.5 text-xs font-bold active:scale-95 transition-transform flex items-center gap-1"
                  onClick={shareReferral}
                  aria-label="اشتراک کد دعوت در تلگرام"
                >
                  <Icon name="send" size={15} />
                  اشتراک
                </button>
              </div>
              <p className="text-[11px] leading-5 text-on-surface-variant">
                دوستتان کد را در «حساب کاربری» وارد می‌کند؛ {toFa(referral.days)} روز پرو برای شما و او فعال می‌شود
                {referral.invitedCount > 0 ? ` · تا حالا ${toFa(referral.invitedCount)} دوست دعوت کرده‌اید` : ''}.
              </p>
              {referral.canRedeem ? (
                <div className="border-t border-primary/15 pt-2.5 space-y-1.5">
                  <label htmlFor="ref-input" className="text-[11px] font-bold text-on-surface-variant block">
                    کد دعوت دوستتان را دارید؟
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="ref-input"
                      type="text"
                      dir="ltr"
                      autoComplete="off"
                      className="flex-1 min-w-0 rounded-xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-700/60 px-3 py-2 text-body-sm text-left font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="مثلاً KRM7AB2X"
                      value={refInput}
                      onChange={(e) => setRefInput(e.target.value.toUpperCase())}
                      maxLength={16}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-xl border-2 border-primary text-primary px-3 py-2 text-xs font-bold active:scale-95 transition-transform disabled:opacity-40"
                      onClick={() => void doRedeem()}
                      disabled={refInput.trim().length < 4 || refBusy}
                    >
                      {refBusy ? '…' : 'فعال‌سازی'}
                    </button>
                  </div>
                  {refError ? <p className="text-[11px] text-red-600 dark:text-red-300">{refError}</p> : null}
                </div>
              ) : null}
            </div>
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

          {/* ---------- P1 — داده و حریم خصوصی: دریافت داده + حذف حساب ---------- */}
          {delStep === 'none' ? (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 divide-y divide-outline-variant/20 overflow-hidden">
              <button
                type="button"
                aria-label="دریافت داده‌های من"
                onClick={() => void downloadMyData()}
                disabled={exportBusy}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-right active:bg-surface-container transition-colors disabled:opacity-50"
              >
                <Icon name="content_copy" size={18} className="text-primary shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-body-sm font-bold">دریافت داده‌های من</span>
                  <span className="block text-xs text-on-surface-variant mt-0.5">
                    فایل JSON همه‌ی لیست‌ها، کارها و زیرکارهای حساب شما
                  </span>
                </span>
                {exportBusy ? <span className="text-xs text-on-surface-variant">…</span> : null}
              </button>
              <button
                type="button"
                aria-label="حذف حساب"
                onClick={() => {
                  setDelError(null);
                  setDelStep('warn');
                }}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-right text-red-600 dark:text-red-300 active:bg-red-50 dark:active:bg-red-950/30 transition-colors"
              >
                <Icon name="delete" size={18} className="shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-body-sm font-bold">حذف حساب</span>
                  <span className="block text-xs text-on-surface-variant mt-0.5">
                    حذف کامل حساب و همه‌ی داده‌های سمت سرور — غیرقابل بازگشت
                  </span>
                </span>
              </button>
            </div>
          ) : null}

          {delStep === 'warn' ? (
            <div className="rounded-2xl border border-red-300/60 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 p-4 space-y-2.5" aria-label="هشدار حذف حساب" role="alertdialog">
              <p className="text-body-sm font-black text-red-700 dark:text-red-300 flex items-center gap-2">
                <Icon name="warning" size={18} />
                حذف کامل حساب کارام
              </p>
              <ul className="text-xs leading-6 text-red-800/90 dark:text-red-200/90 list-disc ps-4 space-y-1">
                <li>همه‌ی لیست‌ها، کارها، زیرکارها و یادآورهای سمت سرور برای همیشه پاک می‌شوند.</li>
                <li>از همه‌ی دستگاه‌ها بیرون می‌افتید (همه‌ی نشست‌ها بی‌اعتبار می‌شوند).</li>
                <li>داده‌ی حذف‌شده تا {toFa(keepDays)} روز در بکاپ‌های سروری می‌ماند و بعد برای همیشه پاک می‌شود.</li>
                <li>سوابق مالی (سفارش و واریز) بی‌نام‌شده و بدون ارتباط با شما برای حسابداری می‌مانند.</li>
              </ul>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  className="w-full py-2.5 rounded-xl bg-surface-container dark:bg-slate-800 text-on-surface dark:text-slate-100 text-body-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
                  onClick={() => void downloadMyData()}
                  disabled={exportBusy}
                >
                  {exportBusy ? '…' : 'اول بک‌آپ بگیر (فایل JSON)'}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label="ادامه — ارسال کد حذف"
                    className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-body-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
                    onClick={() => void requestDelete()}
                    disabled={delBusy || exportBusy}
                  >
                    {delBusy ? '…' : 'ادامه — ارسال کد حذف'}
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2.5 rounded-xl bg-surface-container dark:bg-slate-800 text-on-surface dark:text-slate-100 text-body-sm font-bold"
                    onClick={() => {
                      setDelStep('none');
                      setDelError(null);
                    }}
                  >
                    انصراف
                  </button>
                </div>
              </div>
              {delError ? <p className="text-xs text-red-700 dark:text-red-300">{delError}</p> : null}
            </div>
          ) : null}

          {delStep === 'code' ? (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-4 space-y-3">
              <p className="text-body-sm font-black flex items-center gap-2">
                <Icon name="delete" size={17} className="text-red-600 dark:text-red-300" />
                کد حذف حساب
              </p>
              <p className="text-xs text-on-surface-variant leading-6">
                کد حذف به {delChannel === 'sms' ? 'شماره' : delChannel === 'telegram' ? 'چت تلگرام' : 'ایمیل'}{' '}
                <span dir="ltr" className="font-bold">{delTarget}</span> ارسال شد.
                این کد جدا از کد ورود است و فقط برای همین حذف کار می‌کند.
              </p>
              <input
                id="karam-delete-code"
                ref={delCodeRef}
                aria-label="کد حذف حساب"
                type="text"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="······"
                value={delCode}
                onChange={(e) => setDelCode(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && delCode.trim().length >= 4) void verifyDeleteCode();
                }}
                className="w-full px-4 py-3 rounded-xl bg-surface-container dark:bg-slate-700/60 text-headline-sm text-center tracking-[0.6em] outline-none border border-outline-variant/40 focus:border-primary text-on-surface dark:text-slate-100 placeholder:text-outline"
              />
              {delDevCode ? (
                <p className="text-xs text-on-surface-variant bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2" dir="ltr">
                  dev: {delDevCode}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="ادامه به تأیید حذف"
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-body-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
                  onClick={() => void verifyDeleteCode()}
                  disabled={delCode.trim().length < 4}
                >
                  ادامه
                </button>
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-xl bg-surface-container dark:bg-slate-700 text-on-surface dark:text-slate-100 text-body-sm font-bold"
                  onClick={() => void requestDelete()}
                  disabled={delBusy}
                >
                  {delBusy ? '…' : 'ارسال مجدد'}
                </button>
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-xl bg-surface-container dark:bg-slate-700 text-on-surface dark:text-slate-100 text-body-sm font-bold"
                  onClick={() => {
                    setDelStep('none');
                    setDelError(null);
                    setDelCode('');
                  }}
                >
                  انصراف
                </button>
              </div>
              {delError ? <p className="text-xs text-red-700 dark:text-red-300">{delError}</p> : null}
            </div>
          ) : null}

          {delStep === 'confirm' ? (
            <div className="rounded-2xl border border-red-300/60 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 p-4 space-y-3" role="alertdialog" aria-label="تأیید نهایی حذف حساب">
              <p className="text-body-sm font-black text-red-700 dark:text-red-300">مرحله‌ی آخر — تصمیم غیرقابل بازگشت</p>
              <p className="text-xs leading-6 text-red-800/90 dark:text-red-200/90">
                برای تأیید، عبارت <span className="font-black">«حذف حساب»</span> را دقیقاً تایپ کنید و کد حذف را وارد کنید.
                بعد از این مرحله همه‌ی داده‌های سمت سرور پاک و همه‌ی دستگاه‌ها بیرون می‌افتند.
              </p>
              <input
                id="karam-delete-confirm"
                aria-label="تایید حذف حساب"
                type="text"
                autoComplete="off"
                maxLength={20}
                placeholder="حذف حساب"
                value={delConfirmText}
                onChange={(e) => setDelConfirmText(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-surface dark:bg-slate-800 text-body-md outline-none border border-outline-variant/40 focus:border-red-500 text-on-surface dark:text-slate-100 placeholder:text-outline"
              />
              <input
                id="karam-delete-code-final"
                aria-label="کد حذف حساب نهایی"
                type="text"
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                placeholder="کد ۶ رقمی"
                value={delCode}
                onChange={(e) => setDelCode(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                className="w-full px-4 py-3 rounded-xl bg-surface dark:bg-slate-800 text-body-md text-center tracking-[0.4em] outline-none border border-outline-variant/40 focus:border-red-500 text-on-surface dark:text-slate-100 placeholder:text-outline"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="حذف کامل حساب"
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white text-body-sm font-black active:scale-95 transition-transform disabled:opacity-40"
                  onClick={() => void doDeleteAccount()}
                  disabled={delBusy || delConfirmText.trim() !== DELETE_CONFIRM_TEXT || delCode.trim().length < 4}
                >
                  {delBusy ? '…' : 'حذف کامل حساب'}
                </button>
                <button
                  type="button"
                  className="px-4 py-3 rounded-xl bg-surface-container dark:bg-slate-800 text-on-surface dark:text-slate-100 text-body-sm font-bold"
                  onClick={() => {
                    setDelStep('none');
                    setDelError(null);
                    setDelCode('');
                    setDelConfirmText('');
                  }}
                >
                  انصراف
                </button>
              </div>
              {delError ? <p className="text-xs text-red-700 dark:text-red-300">{delError}</p> : null}
            </div>
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
              {/* پذیرش قوانین (v17) — لینک بازکننده‌ی شیت قوانین */}
              <p className="text-xs text-on-surface-variant leading-relaxed">
                ورود شما به معنای پذیرش{' '}
                <button
                  className="text-primary font-bold underline underline-offset-2"
                  onClick={() => useAppStore.setState({ termsSheet: true })}
                  type="button"
                >
                  قوانین و حریم خصوصی کارام
                </button>{' '}
                است.
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
