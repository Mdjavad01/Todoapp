import { useEffect, useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import * as repo from '@/db/repo';
import { GREETING_TEXT } from '@/lib/selectors';
import { updateGender } from '@/sync/auth';

/**
 * آنبوردینگ کامل کارام (v10) — بعد از اولین ورود نمایش داده می‌شود:
 * گام ۱: خوش‌آمد و معرفی • گام ۲: ثبت نام (سلام هوشمند خانه) • گام ۳: انتخاب ظاهر.
 * هر گام قابل رد شدن است؛ پس از پایان، حباب راهنمای «اولین کار» بالای دکمه‌ی + نشان داده می‌شود.
 */

const FEATURES: { icon: 'checklist' | 'event_note' | 'cloud_sync'; title: string; desc: string }[] = [
  { icon: 'checklist', title: 'چک‌لیست و کارها', desc: 'لیست بساز، قالب آماده اضافه کن، همه‌چیز مرتب بماند' },
  { icon: 'event_note', title: 'زمان‌بندی و یادآوری', desc: 'هر کار سر موعدش یادت می‌آید' },
  { icon: 'cloud_sync', title: 'پشتیبان ابری امن', desc: 'با ورود به حساب، داده‌ها همه‌جا همراهت است' },
];

export function WelcomeOnboardingSheet() {
  const open = useAppStore((s) => s.welcomeSheet);
  const showToast = useAppStore((s) => s.showToast);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // هر بار که شیت باز می‌شود از گام اول شروع می‌شود (بستن وسط راه = اتمام‌نشده و دوباره می‌آید)
  useEffect(() => {
    if (open) {
      setStep(0);
      setName('');
      setBusy(false);
    }
  }, [open]);

  const close = () => useAppStore.setState({ welcomeSheet: false });

  /** پایان آنبوردینگ — نام (اگر وارد شده) و ظاهر (اگر انتخاب شده) ذخیره و حباب راهنما فعال می‌شود */
  const finish = async (g: 'male' | 'female' | null) => {
    setBusy(true);
    try {
      const clean = name.trim().replace(/\s+/g, ' ');
      if (clean) await useAppStore.getState().saveDisplayName(clean);
      if (g) {
        useAppStore.getState().setAccent(g === 'female' ? 'rose' : 'teal');
        await repo.prefsSet('gender-choice', g);
        if (useAppStore.getState().session) await updateGender(g);
      }
      await repo.prefsSet('welcome-done', 'done');
      const coachSeen = await repo.prefsGet<boolean>('coach-add-seen', false);
      if (!coachSeen) useAppStore.setState({ coachAdd: true });
      close();
      showToast('همه‌چیز آماده است؛ خوش بدرخشی! ✨');
    } catch {
      close();
      showToast('ذخیره نشد؛ بعداً از تنظیمات می‌توانی تکمیلش کنی');
    } finally {
      setBusy(false);
    }
  };

  /** رد کردن کل آنبوردینگ — دیگر نمایش داده نمی‌شود */
  const skipAll = async () => {
    await repo.prefsSet('welcome-done', 'done');
    close();
  };

  return (
    <Sheet open={open} onClose={close} maxHeight="92%">
      {/* نشانگر گام‌ها */}
      <div className="flex justify-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              step === i ? 'w-6 bg-primary' : 'w-1.5 bg-outline-variant/60'
            }`}
          />
        ))}
      </div>

      {step === 0 ? (
        <>
          <div className="flex flex-col items-center text-center gap-2 pt-1">
            <div className="w-16 h-16 rounded-3xl bg-primary text-on-primary flex items-center justify-center shadow-lg">
              <Icon name="checklist" size={32} />
            </div>
            <h3 className="text-headline-lg font-black text-on-surface dark:text-inverse-on-surface">
              سلام! به کارام خوش آمدی 👋
            </h3>
            <p className="text-body-md text-on-surface-variant">
              قرار است دستیار کارهای روزانه‌ات باشیم؛ فقط ۳۰ ثانیه وقت می‌گیرد.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            {FEATURES.map((f) => (
              <div
                key={f.icon}
                className="flex items-center gap-3 bg-surface-container-lowest dark:bg-slate-800 rounded-2xl p-3.5 border border-outline-variant/30"
              >
                <span className="w-10 h-10 rounded-xl bg-primary-container/20 text-primary flex items-center justify-center shrink-0">
                  <Icon name={f.icon} size={22} />
                </span>
                <div className="flex flex-col">
                  <span className="text-label-lg font-bold text-on-surface dark:text-inverse-on-surface">{f.title}</span>
                  <span className="text-body-sm text-on-surface-variant">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            className="w-full rounded-2xl bg-primary text-on-primary py-3.5 text-label-lg font-bold shadow-md active:scale-[0.98] transition-transform"
            onClick={() => setStep(1)}
          >
            بزن بریم!
          </button>
          <button
            className="text-body-sm text-on-surface-variant font-bold self-center"
            onClick={() => void skipAll()}
          >
            بعداً تکمیلش می‌کنم
          </button>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div className="text-center pt-1">
            <h3 className="text-headline-md font-black text-on-surface dark:text-inverse-on-surface">
              چطور صدامتان کنیم؟
            </h3>
            <p className="text-body-sm text-on-surface-variant mt-1">
              این نام در سلام خانه‌ی کارام و پروفایلت استفاده می‌شود.
            </p>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً: علی"
            maxLength={30}
            autoFocus
            className="w-full rounded-2xl border border-outline-variant/50 bg-surface-container-lowest dark:bg-slate-800 px-4 py-3.5 text-body-lg text-on-surface dark:text-white outline-none focus:border-primary transition-colors placeholder:text-on-surface-variant"
            aria-label="نام شما"
          />

          {/* پیش‌نمایش زنده‌ی سلام هوشمند */}
          {name.trim() ? (
            <div className="flex items-center gap-2 bg-primary-container/15 rounded-2xl p-3.5" aria-live="polite">
              <Icon name="auto_awesome" size={18} className="text-primary shrink-0" />
              <p className="text-body-md text-on-surface dark:text-inverse-on-surface">
                {GREETING_TEXT(new Date().getHours())}، <b>{name.trim()}</b> عزیز!
              </p>
            </div>
          ) : null}

          <button
            className="w-full rounded-2xl bg-primary text-on-primary py-3.5 text-label-lg font-bold shadow-md active:scale-[0.98] transition-transform disabled:opacity-40"
            disabled={!name.trim() || busy}
            onClick={() => setStep(2)}
          >
            ثبت کن
          </button>
          <button
            className="text-body-sm text-on-surface-variant font-bold self-center"
            onClick={() => {
              setName('');
              setStep(2);
            }}
          >
            فعلاً بی‌نام ادامه می‌دهم
          </button>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className="text-center pt-1">
            <h3 className="text-headline-md font-black text-on-surface dark:text-inverse-on-surface">
              ظاهر کارام را انتخاب کن
            </h3>
            <p className="text-body-sm text-on-surface-variant mt-1">
              هر وقت خواستی از تنظیمات می‌توانی عوضش کنی.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* دخترانه — صورتی */}
            <button
              className="relative overflow-hidden rounded-2xl border-2 border-outline-variant/40 hover:border-pink-400 p-4 text-right active:scale-95 transition-all disabled:opacity-50"
              onClick={() => void finish('female')}
              disabled={busy}
              aria-label="تم دخترانه صورتی"
            >
              <div
                className="mb-3 flex h-14 items-center justify-center rounded-xl"
                style={{ background: 'linear-gradient(135deg, #fbcfe8 0%, #f472b6 100%)' }}
              >
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-white/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/40" />
                </div>
              </div>
              <p className="text-body-md font-bold text-on-surface dark:text-inverse-on-surface">دخترانه</p>
              <p className="text-body-sm text-on-surface-variant">تم صورتی ملایم</p>
            </button>

            {/* پسرانه — فیروزه‌ای */}
            <button
              className="relative overflow-hidden rounded-2xl border-2 border-outline-variant/40 hover:border-teal-500 p-4 text-right active:scale-95 transition-all disabled:opacity-50"
              onClick={() => void finish('male')}
              disabled={busy}
              aria-label="تم پسرانه فیروزه‌ای"
            >
              <div
                className="mb-3 flex h-14 items-center justify-center rounded-xl"
                style={{ background: 'linear-gradient(135deg, #99f6e4 0%, #0d9488 100%)' }}
              >
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-white/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/40" />
                </div>
              </div>
              <p className="text-body-md font-bold text-on-surface dark:text-inverse-on-surface">پسرانه</p>
              <p className="text-body-sm text-on-surface-variant">تم فیروزه‌ای کلاسیک</p>
            </button>
          </div>

          <button
            className="text-body-sm text-on-surface-variant font-bold self-center"
            disabled={busy}
            onClick={() => void finish(null)}
          >
            همین تم پیش‌فرض خوبه
          </button>
        </>
      ) : null}
    </Sheet>
  );
}
