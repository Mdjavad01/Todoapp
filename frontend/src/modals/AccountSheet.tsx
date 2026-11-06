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
  fetchMyIdentities,
  requestLinkCode,
  confirmLinkIdentity,
  type ActiveSession,
  type AuthChannels,
  type MeIdentity,
} from '@/sync/auth';
import { fetchReferral, redeemReferral, referralShareText, type ReferralInfo } from '@/sync/referral';
import { referralShareLabel, referralShareAria } from '@/lib/bazaarTexts';
// موج ۲ — کارت «روش‌های ورود»: متن‌ها از خزانه‌ی دو‌شاخه‌ای (bazaarTexts) + منطق خالص (loginMethods)
import {
  methodsCardTitle,
  methodsConnectHint,
  methodsConnectEmail,
  methodsConnectTelegram,
  methodsLaterLabel,
} from '@/lib/bazaarTexts';
import { METHODS_SNOOZE_KEY, methodRowsOf, snoozeIsActive, snoozeValueFor } from '@/lib/loginMethods';
import { ApiError } from '@/sync/api';

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
  // موج ۱ — waiting = در انتظار پیام کاربر به ربات؛ send_failed = ارسال کد شکست خورد
  // ولی بلیت تا پایان TTL زنده است (لینک دوباره باز می‌شود یا با ایمیل وارد می‌شوند)
  const [tgState, setTgState] = useState<'waiting' | 'send_failed'>('waiting');
  const [copied, setCopied] = useState(false);
  // موج ۱ — ثانیه‌های باقی‌مانده تا پایان مهلت بلیت (از expiresIn پاسخ درخواست بلیت)
  const [ticketTtl, setTicketTtl] = useState(0);

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

  // موج ۲ — روش‌های ورود: کارت وضعیت + جریان اتصال روش دوم + snooze نشان
  const [identities, setIdentities] = useState<MeIdentity[] | null>(null);
  const [methodsSnooze, setMethodsSnooze] = useState<string | null>(null);
  const [linkStep, setLinkStep] = useState<'idle' | 'email' | 'email-code' | 'telegram' | 'telegram-code'>('idle');
  const [linkEmail, setLinkEmail] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [linkTicket, setLinkTicket] = useState('');
  const [linkDeepLink, setLinkDeepLink] = useState('');
  const [linkTtl, setLinkTtl] = useState(0);
  const [linkTgFailed, setLinkTgFailed] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkResendIn, setLinkResendIn] = useState(0);
  // رفع اشکال گزارش مالک — ۴۲۹ نرخ‌سنج با شمارش معکوس زنده: «همان لحظه» معلوم است کِی می‌شود دوباره زد
  const [linkRetryIn, setLinkRetryIn] = useState(0);
  const [tgRetryIn, setTgRetryIn] = useState(0); // همان رفتار برای «ساخت کد اتصال» ورود مهمان
  const [linkDevCode, setLinkDevCode] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // باز شدن شیت: کانال‌ها + نشست‌ها را بگیر
  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setError(null);
    setCode('');
    setDevCode(null);
    setTgState('waiting');
    setTicketTtl(0);
    void fetchChannels().then(setChannels).catch(() => setChannels({ email: true, telegram: false, sms: false, botUsername: '' }));
    if (useAppStore.getState().session) {
      void listSessions().then(setSessions).catch(() => setSessions([]));
      // v20 — وضعیت رفرال (اگر فعال باشد کارت دعوت نشان داده می‌شود)
      setReferral(null);
      setRefError(null);
      fetchReferral()
        .then((r) => setReferral(r.enabled ? r : { ...r, enabled: false }))
        .catch(() => setReferral(null));
      // موج ۲ — identities حساب برای کارت «روش‌های ورود» + وضعیت snooze نشان
      setIdentities(null);
      setLinkStep('idle');
      setLinkError(null);
      setLinkEmail('');
      setLinkCode('');
      setLinkTicket('');
      setLinkDeepLink('');
      setLinkTtl(0);
      setLinkTgFailed(false);
      setLinkDevCode(null);
      setLinkRetryIn(0);
      void fetchMyIdentities().then(setIdentities).catch(() => setIdentities(null));
      void repo.prefsGet<string>(METHODS_SNOOZE_KEY, '').then((v) => setMethodsSnooze(v || null)).catch(() => setMethodsSnooze(null));
    }
  }, [open]);

  // شمارش معکوس ارسال مجدد
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // موج ۱ — شمارش معکوس مهلت بلیت تلگرام (TTL)
  useEffect(() => {
    if (ticketTtl <= 0) return;
    const t = setTimeout(() => setTicketTtl((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [ticketTtl]);

  // موج ۲ — شمارش معکوس ارسال مجدد کد اتصال ایمیل
  useEffect(() => {
    if (linkResendIn <= 0) return;
    const t = setTimeout(() => setLinkResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [linkResendIn]);

  // موج ۲ — شمارش معکوس مهلت بلیت اتصال تلگرام
  useEffect(() => {
    if (linkTtl <= 0) return;
    const t = setTimeout(() => setLinkTtl((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [linkTtl]);

  // رفع اشکال — شمارش معکوس ۴۲۹ اتصال روش دوم و ورود تلگرام
  useEffect(() => {
    if (linkRetryIn <= 0) return;
    const t = setTimeout(() => setLinkRetryIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [linkRetryIn]);

  useEffect(() => {
    if (tgRetryIn <= 0) return;
    const t = setTimeout(() => setTgRetryIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [tgRetryIn]);

  // poll تلگرام — در هر دو حالت waiting و send_failed ادامه دارد؛ send_failed از این بعد
  // فقط پیام وضعیت است نه پایان مسیر: با زدن دوباره‌ی لینک (تا پایان TTL) کد می‌تواند برسد
  useEffect(() => {
    if (step !== 'telegram' || !ticket) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const res = await pollTelegramTicket(ticket);
        if (!alive) return;
        if (res.status === 'code_sent') {
          // «ارسال شد» فقط برای وضعیت واقعی ارسال موفق از سرور می‌آید (موج ۱)
          setResendIn(0);
          setStep('code');
          setTimeout(() => codeRef.current?.focus(), 50);
        } else if (res.status === 'send_failed') {
          setTgState('send_failed');
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

  // موج ۲ — poll بلیت اتصال تلگرام (مثل poll ورود: code_sent → گام کد؛ send_failed → پیام روشن با بلیت زنده)
  useEffect(() => {
    if (linkStep !== 'telegram' || !linkTicket) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const res = await pollTelegramTicket(linkTicket);
        if (!alive) return;
        if (res.status === 'code_sent') {
          setLinkStep('telegram-code');
        } else if (res.status === 'send_failed') {
          setLinkTgFailed(true);
        } else if (res.status === 'expired') {
          setLinkError('مهلت بلیت تمام شد؛ اتصال را دوباره شروع کنید');
          setLinkTicket('');
          setLinkStep('idle');
        }
      } catch {
        /* خطای شبکه در poll بی‌اهمیت است — دور بعد تلاش می‌شود */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [linkStep, linkTicket]);

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
      // موج ۱ — شمارش معکوس مهلت بلیت (expiresIn ثانیه؛ پیش‌فرض سرور ۶۰۰ = ۱۰ دقیقه)
      setTicketTtl(Math.max(0, Math.floor(res.expiresIn ?? 600)));
    } catch (e) {
      // رفع اشکال — ۴۲۹ با شمارش معکوس زنده؛ دکمه تا فعال‌شدن دوباره شفاف و غیرفعال است
      if (e instanceof ApiError && e.code === 'rate_limited' && typeof e.retryAfter === 'number' && e.retryAfter > 0) {
        setTgRetryIn(e.retryAfter);
        setError(`${e.message} — دکمه پس از ${toFaDigits(e.retryAfter)} ثانیه فعال می‌شود`);
        return;
      }
      setError(e instanceof Error ? e.message : 'دریافت بلیت ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  /** موج ۱ — قالب m:ss برای نمایش مهلت بلیت */
  const fmtTtl = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

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
      // اصلاح بسته‌ی D (۱.۱۱.۱) — تصمیم قبلیِ 'empty-local' (مهمان) بعد از ورود به حساب اعتبار ندارد:
      // داده‌ی ابری ممکن است بعداً کارهای نمونه بیاورد ⇒ pref به حالت «تصمیم‌نگرفته» برمی‌گردد
      // تا بوتِ بعد از اولین سینک، دوباره اسکن و تصمیم قطعی بگیرد
      try {
        const prevCleanupPref = await repo.prefsGet<string>('demo-cleanup-v1', '');
        if (prevCleanupPref === 'empty-local') void repo.prefsSet('demo-cleanup-v1', '');
      } catch {
        /* pref در دسترس نیست — نادیده */
      }
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
      setTicketTtl(0);
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

  /* ---------- موج ۲ — اتصال روش دوم ---------- */

  const methodRows = methodRowsOf(identities);
  const emailLinked = methodRows[0].linked;
  const telegramLinked = methodRows[1].linked;
  const bothMethods = emailLinked && telegramLinked;
  // نشان غیرمزاحم = توضیح یک‌خطی + «بعداً» (قابل خواب تا ۳۰ روز)؛ اما دکمه‌ی اتصال هرگز
  // از دسترس خارج نمی‌شود — رفع اشکال گزارش مالک: بعد از «بعداً» دیگر هیچ راهی برای اتصال نمی‌ماند.
  // دوروشی‌ها فقط سطرهای وضعیت می‌بینند؛ snooze هیچ داده‌ی ابری نمی‌سازد و فقط محلی است
  const methodsHintVisible =
    identities !== null && !bothMethods && !snoozeIsActive(methodsSnooze) && linkStep === 'idle';
  const connectAlwaysVisible = identities !== null && !bothMethods && linkStep === 'idle';
  // روش ناقص حساب — اتصال تلگرام فقط وقتی پیشنهاد می‌شود که سرور تلگرام را فعال دارد؛ اتصال ایمیل همیشه ممکن است
  const missingChannel: 'email' | 'telegram' | null = emailLinked ? (telegramLinked ? null : 'telegram') : 'email';
  const missingAvailable = missingChannel === 'telegram' ? !!channels?.telegram : true;

  const resetLinkFlow = () => {
    setLinkStep('idle');
    setLinkEmail('');
    setLinkCode('');
    setLinkTicket('');
    setLinkDeepLink('');
    setLinkTtl(0);
    setLinkTgFailed(false);
    setLinkError(null);
    setLinkResendIn(0);
    setLinkDevCode(null);
    setLinkRetryIn(0);
  };

  /** خطای جریان اتصال — ۴۲۹ نرخ‌سنج با retryAfter سرور به شمارش معکوس زنده تبدیل می‌شود */
  const linkApplyError = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.code === 'rate_limited' && typeof e.retryAfter === 'number' && e.retryAfter > 0) {
      setLinkRetryIn(e.retryAfter);
      setLinkError(`${e.message} — دکمه پس از ${toFaDigits(e.retryAfter)} ثانیه فعال می‌شود`);
      return;
    }
    setLinkError(e instanceof Error ? e.message : fallback);
  };

  const refreshIdentities = () => {
    void fetchMyIdentities().then(setIdentities).catch(() => setIdentities(null));
  };

  const openLinkEmail = () => {
    setLinkError(null);
    setLinkStep('email');
  };

  const startLinkTelegram = async () => {
    setLinkError(null);
    setLinkTgFailed(false);
    setLinkStep('telegram');
    setLinkBusy(true);
    try {
      const res = await requestLinkCode('telegram');
      setLinkTicket(res.ticket ?? '');
      setLinkDeepLink(res.deepLink ?? '');
      // TTL بلیت اتصال همان ۱۰ دقیقه‌ی سرور است (expiresIn؛ پیش‌فرض ۶۰۰)
      setLinkTtl(Math.max(0, Math.floor(res.expiresIn ?? 600)));
    } catch (e) {
      // ۴۲۹ → به گام شروع برمی‌گردیم تا دکمه با شمارش معکوس همین‌جا دیده شود
      if (e instanceof ApiError && e.code === 'rate_limited' && typeof e.retryAfter === 'number' && e.retryAfter > 0) {
        setLinkStep('idle');
        setLinkRetryIn(e.retryAfter);
        setLinkError(`${e.message} — دکمه پس از ${toFaDigits(e.retryAfter)} ثانیه فعال می‌شود`);
        return;
      }
      setLinkError(e instanceof Error ? e.message : 'دریافت بلیت ناموفق بود');
    } finally {
      setLinkBusy(false);
    }
  };

  const sendLinkEmailCode = async () => {
    setLinkError(null);
    setLinkBusy(true);
    try {
      const res = await requestLinkCode('email', linkEmail.trim());
      setLinkResendIn(res.resendAfter ?? 60);
      setLinkDevCode(res.devCode ?? null);
      setLinkStep('email-code');
    } catch (e) {
      linkApplyError(e, 'ارسال کد ناموفق بود');
    } finally {
      setLinkBusy(false);
    }
  };

  const resendLinkEmailCode = async () => {
    setLinkError(null);
    setLinkBusy(true);
    try {
      const res = await requestLinkCode('email', linkEmail.trim());
      setLinkResendIn(res.resendAfter ?? 60);
      setLinkDevCode(res.devCode ?? null);
      setLinkCode('');
    } catch (e) {
      linkApplyError(e, 'ارسال مجدد ناموفق بود');
    } finally {
      setLinkBusy(false);
    }
  };

  const confirmLink = async () => {
    if (linkCode.trim().length < 4 || linkBusy) return;
    setLinkError(null);
    setLinkBusy(true);
    try {
      const res =
        linkStep === 'telegram-code'
          ? await confirmLinkIdentity({ channel: 'telegram', ticket: linkTicket, code: linkCode.trim() })
          : await confirmLinkIdentity({ channel: 'email', target: linkEmail.trim(), code: linkCode.trim() });
      showToast(res.already ? 'این روش از قبل به حساب شما متصل بود' : 'روش دوم به حساب شما متصل شد ✓');
      resetLinkFlow();
      refreshIdentities();
    } catch (e) {
      // ۴۰۹ conflict_identity — پیام فارسی سرور (ارجاع به پشتیبانی) مستقیم نشان داده می‌شود
      linkApplyError(e, 'اتصال ناموفق بود');
    } finally {
      setLinkBusy(false);
    }
  };

  /** «بعداً» — نشان ۳۰ روز خواب می‌شود (pref محلی؛ بدون هیچ تماس سروری) */
  const snoozeMethods = async () => {
    try {
      const v = snoozeValueFor();
      await repo.prefsSet(METHODS_SNOOZE_KEY, v);
      setMethodsSnooze(v);
    } catch {
      /* pref در دسترس نیست — نادیده */
    }
  };

  const copyLinkTicket = async () => {
    try {
      await navigator.clipboard.writeText(linkTicket);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* کلیپ‌بورد در دسترس نیست */
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

          {/* ---------- موج ۲ — کارت «روش‌های ورود» (فقط داخل شیت حساب؛ مهمان رندر نمی‌شود) ---------- */}
          {identities !== null ? (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Icon name="manage_accounts" size={18} className="text-primary shrink-0" />
                <p className="text-body-sm font-bold text-on-surface dark:text-slate-100 flex-1">{methodsCardTitle}</p>
              </div>

              {/* دو سطر وضعیت — فقط ماسک نمایش داده می‌شود، هرگز مقدار خام */}
              {methodRows.map((row) => (
                <div key={row.channel} className="flex items-center gap-2">
                  <Icon
                    name={row.channel === 'email' ? 'mail' : 'fingerprint'}
                    size={17}
                    className={row.linked ? 'text-primary' : 'text-outline'}
                  />
                  <span className="text-body-sm font-bold flex-1">{row.channel === 'email' ? 'ایمیل' : 'تلگرام'}</span>
                  {row.linked ? (
                    <span className="text-xs text-primary font-bold truncate max-w-[55%]" dir="ltr">
                      متصل ✓{row.masked ? ` · ${row.masked}` : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-on-surface-variant">متصل نیست</span>
                  )}
                </div>
              ))}

              {/* نشان اتصال — دکمه حتی بعد از «بعداً» همیشه همین‌جاست (ضد بن‌بست — رفع اشکال گزارش مالک)؛
                  فقط توضیح یک‌خطی و «بعداً» با snooze ۳۰ روزه خواب می‌روند */}
              {connectAlwaysVisible && missingChannel && missingAvailable ? (
                <div className="border-t border-outline-variant/20 pt-2.5 space-y-2">
                  {methodsHintVisible ? (
                    <p className="text-[11px] leading-5 text-on-surface-variant">{methodsConnectHint}</p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex-1 py-2.5 rounded-xl border-2 border-primary text-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
                      onClick={() => (missingChannel === 'email' ? openLinkEmail() : void startLinkTelegram())}
                      disabled={linkBusy || linkRetryIn > 0}
                    >
                      {linkRetryIn > 0
                        ? `تلاش مجدد تا ${toFaDigits(linkRetryIn)}ث`
                        : missingChannel === 'email'
                          ? methodsConnectEmail
                          : methodsConnectTelegram}
                    </button>
                    {methodsHintVisible ? (
                      <button
                        type="button"
                        className="px-3 py-2.5 text-xs text-on-surface-variant font-bold"
                        onClick={() => void snoozeMethods()}
                        aria-label="به بعد موکول کن"
                      >
                        {methodsLaterLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* جریان اتصال ایمیل — گام ۱: گرفتن ایمیل و ارسال کد */}
              {linkStep === 'email' ? (
                <div className="border-t border-outline-variant/20 pt-2.5 space-y-2">
                  <label className="text-[11px] font-bold text-on-surface-variant block" htmlFor="karam-link-email">
                    ایمیل جدید برای اتصال به این حساب
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="karam-link-email"
                      type="email"
                      dir="ltr"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="you@example.com"
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && linkEmail.includes('@') && !linkBusy) void sendLinkEmailCode();
                      }}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-surface-container dark:bg-slate-700/60 text-body-sm outline-none border border-outline-variant/40 focus:border-primary text-on-surface dark:text-slate-100 placeholder:text-outline"
                    />
                    <button
                      type="button"
                      className="shrink-0 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
                      onClick={() => void sendLinkEmailCode()}
                      disabled={linkBusy || !linkEmail.includes('@')}
                    >
                      {linkBusy ? '…' : 'دریافت کد'}
                    </button>
                  </div>
                  {linkError ? <p className="text-[11px] text-red-600 dark:text-red-300">{linkError}</p> : null}
                  <button type="button" className="text-[11px] text-primary font-bold" onClick={resetLinkFlow}>
                    انصراف
                  </button>
                </div>
              ) : null}

              {/* جریان اتصال ایمیل — گام ۲: کد */}
              {linkStep === 'email-code' ? (
                <div className="border-t border-outline-variant/20 pt-2.5 space-y-2">
                  <p className="text-[11px] text-on-surface-variant">کد اتصال به ایمیل وارد‌شده رفت؛ کد ۶ رقمی را وارد کنید</p>
                  <input
                    id="karam-link-code"
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="······"
                    value={linkCode}
                    onChange={(e) => setLinkCode(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && linkCode.trim().length >= 4 && !linkBusy) void confirmLink();
                    }}
                    className="w-full px-3 py-2.5 rounded-xl bg-surface-container dark:bg-slate-700/60 text-body-md text-center tracking-[0.5em] outline-none border border-outline-variant/40 focus:border-primary text-on-surface dark:text-slate-100 placeholder:text-outline"
                  />
                  {linkDevCode ? (
                    <p className="text-[10px] text-on-surface-variant bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-1.5" dir="ltr">
                      dev: {linkDevCode}
                    </p>
                  ) : null}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
                      onClick={() => void confirmLink()}
                      disabled={linkBusy || linkCode.trim().length < 4}
                    >
                      {linkBusy ? '…' : 'تأیید اتصال'}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2.5 rounded-xl bg-surface-container text-on-surface font-bold text-xs disabled:opacity-40"
                      onClick={() => void resendLinkEmailCode()}
                      disabled={linkResendIn > 0 || linkBusy}
                    >
                      {linkResendIn > 0 ? `ارسال مجدد ${toFaDigits(linkResendIn)}ث` : 'ارسال مجدد'}
                    </button>
                  </div>
                  {linkError ? <p className="text-[11px] text-red-600 dark:text-red-300">{linkError}</p> : null}
                  <button type="button" className="text-[11px] text-primary font-bold" onClick={resetLinkFlow}>
                    انصراف
                  </button>
                </div>
              ) : null}

              {/* جریان اتصال تلگرام — بلیت + انتظار اتصال چت (send_failed: پیام روشن + بلیت تا پایان TTL زنده) */}
              {linkStep === 'telegram' && linkTicket ? (
                <div className="border-t border-outline-variant/20 pt-2.5 space-y-2">
                  <p className="text-[11px] text-on-surface-variant leading-5">
                    این کد را برای ربات <span dir="ltr" className="font-bold">@{channels?.botUsername}</span> در تلگرام بفرستید؛ کد اتصال به همان چت می‌آید:
                  </p>
                  <div className="flex items-center justify-center py-2.5 rounded-xl bg-surface-container dark:bg-slate-700/60 border border-outline-variant/30">
                    <span className="text-body-lg font-black tracking-[0.4em] text-primary" dir="ltr">{linkTicket}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {linkDeepLink ? (
                      <button
                        type="button"
                        className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-body-sm text-center active:scale-95 transition-transform"
                        onClick={() => void openExternal(linkDeepLink)}
                      >
                        باز کردن تلگرام
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="flex-1 py-2.5 rounded-xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform"
                      onClick={() => void copyLinkTicket()}
                    >
                      {linkCopied ? 'کپی شد ✓' : 'کپی کد'}
                    </button>
                  </div>
                  {linkTtl > 0 ? (
                    <p className="text-[11px] text-on-surface-variant text-center" dir="ltr">
                      {toFaDigits(fmtTtl(linkTtl))}
                    </p>
                  ) : null}
                  {linkTgFailed ? (
                    <p className="text-[11px] leading-5 text-red-600 dark:text-red-300">
                      ارسال کد به تلگرام ناموفق بود — بعد از Unblock کردن ربات، «باز کردن تلگرام» را دوباره بزنید یا با ایمیل متصل شوید.
                    </p>
                  ) : (
                    <p className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      در انتظار پیام شما به ربات…
                    </p>
                  )}
                  {linkError ? <p className="text-[11px] text-red-600 dark:text-red-300">{linkError}</p> : null}
                  <button type="button" className="text-[11px] text-primary font-bold" onClick={resetLinkFlow}>
                    انصراف
                  </button>
                </div>
              ) : null}

              {/* جریان اتصال تلگرام — گام کد */}
              {linkStep === 'telegram-code' ? (
                <div className="border-t border-outline-variant/20 pt-2.5 space-y-2">
                  <p className="text-[11px] text-on-surface-variant">کد ارسال‌شده به چت تلگرام‌تان را وارد کنید</p>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="······"
                    value={linkCode}
                    onChange={(e) => setLinkCode(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && linkCode.trim().length >= 4 && !linkBusy) void confirmLink();
                    }}
                    className="w-full px-3 py-2.5 rounded-xl bg-surface-container dark:bg-slate-700/60 text-body-md text-center tracking-[0.5em] outline-none border border-outline-variant/40 focus:border-primary text-on-surface dark:text-slate-100 placeholder:text-outline"
                  />
                  <button
                    type="button"
                    className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
                    onClick={() => void confirmLink()}
                    disabled={linkBusy || linkCode.trim().length < 4}
                  >
                    {linkBusy ? '…' : 'تأیید اتصال'}
                  </button>
                  {linkError ? <p className="text-[11px] text-red-600 dark:text-red-300">{linkError}</p> : null}
                  <button type="button" className="text-[11px] text-primary font-bold" onClick={resetLinkFlow}>
                    انصراف
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

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
                  aria-label={referralShareAria}
                >
                  <Icon name="send" size={15} />
                  {referralShareLabel}
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
                    disabled={busy || tgRetryIn > 0}
                  >
                    {busy ? '…' : tgRetryIn > 0 ? `تلاش مجدد تا ${toFaDigits(tgRetryIn)}ث` : 'ساخت کد اتصال'}
                  </button>
                </>
              ) : null}
              {/* موج ۱ — کارت بلیت در هر دو حالت waiting و send_failed نمایان است تا کاربر بتواند
                  لینک را دوباره باز کند (تلاش مجدد ارسال تا پایان TTL — سقف تلاش سمت سرور رعایت می‌شود) */}
              {ticket ? (
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
                  {ticketTtl > 0 ? (
                    <p className="text-label-md text-on-surface-variant text-center" dir="ltr">
                      {toFaDigits(fmtTtl(ticketTtl))}
                    </p>
                  ) : null}
                  {tgState === 'waiting' ? (
                    <p className="text-body-sm text-on-surface-variant flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                      در انتظار پیام شما به ربات…
                    </p>
                  ) : (
                    <div className="rounded-2xl border border-red-300/50 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 p-3 flex flex-col gap-2">
                      <p className="text-body-sm text-red-700 dark:text-red-300 font-bold">
                        ارسال کد به تلگرام ناموفق بود.
                      </p>
                      <p className="text-body-xs text-red-700/90 dark:text-red-300/90 leading-relaxed">
                        معمولاً یعنی ربات اجازه‌ی فرستادن پیام به شما را ندارد (مثلاً ربات را بلاک کرده‌اید). بعد از
                        Unblock کردن ربات، «باز کردن تلگرام» را دوباره بزنید — یا با ایمیل وارد شوید.
                      </p>
                      <button
                        type="button"
                        className="w-full py-3 rounded-xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform"
                        onClick={startEmail}
                      >
                        ورود با ایمیل
                      </button>
                    </div>
                  )}
                </>
              ) : null}
              {error ? <p className="text-body-sm text-red-600 dark:text-red-300">{error}</p> : null}
              <button
                className="text-body-sm text-primary font-bold"
                onClick={() => {
                  setError(null);
                  setTicket('');
                  setTgState('waiting');
                  setTicketTtl(0);
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
              {/* موج ۱ (تصمیم مالک) — متن ثابت همیشه‌نمایش در گام کد همه‌ی کانال‌ها؛
                  بدون هیچ شرط روی حساب و بدون هیچ endpoint جدید: فقط برمی‌گرداند به انتخاب روش.
                  چون شرطی ندارد، هیچ چیزی درباره‌ی وجود/نبود حساب افشا نمی‌شود. */}
              <button
                type="button"
                className="text-body-sm text-primary font-bold mt-3"
                onClick={() => {
                  setError(null);
                  setCode('');
                  setChannel(null);
                  setStep('choose');
                }}
              >
                کد نرسید؟ با روش دیگر وارد شو
              </button>
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
