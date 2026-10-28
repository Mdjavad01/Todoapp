import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa, faDateTimeUtc, formatToman, groupCardNumber } from '@/lib/format';
import {
  createDepositRequest,
  fetchGiftQuote,
  type DepositConfig,
  type DepositRequest,
  type GiftQuote,
  type PaymentMethod,
  type Plan,
} from '@/sync/payments';

/**
 * شیت «انتخاب روش پرداخت» (فاز ۹ — بازطراحی UX پرداخت)
 *
 * جریان درست: کاربر «پرداخت و ارتقا» را می‌زند → روش پرداخت را انتخاب می‌کند
 * (روش‌های فعال + روش‌های آینده با بج «به‌زودی») → بعد وارد جریان همان روش می‌شود:
 *   - درگاه آنلاین → رفتن به درگاه زیبال (با دکمه‌ی والد)
 *   - کارت به کارت → شماره کارت + فرم پیگیری، همه داخل همین شیت
 */

const METHOD_ICONS: Record<string, 'verified' | 'credit_card' | 'lock'> = {
  online: 'verified',
  card: 'credit_card',
  agpay: 'lock',
};

interface PaymentMethodSheetProps {
  open: boolean;
  onClose(): void;
  plan: Plan | undefined;
  methods: PaymentMethod[] | null;
  depositCfg: DepositConfig | null;
  depositRequests: DepositRequest[];
  onDepositSuccess(req: DepositRequest): void;
  /** روش آنلاین انتخاب شد — والد شیت را می‌بندد و به درگاه می‌رود */
  onPickOnline(): void;
  /** v20 — کد هدیه (مالکیت با والد؛ برای استفاده در هر دو مسیر پرداخت) */
  giftCode: string;
  onGiftCodeChange(code: string): void;
}

export function PaymentMethodSheet({
  open,
  onClose,
  plan,
  methods,
  depositCfg,
  depositRequests,
  onDepositSuccess,
  onPickOnline,
  giftCode,
  onGiftCodeChange,
}: PaymentMethodSheetProps) {
  const showToast = useAppStore((s) => s.showToast);

  const [step, setStep] = useState<'select' | 'deposit'>('select');
  const [picked, setPicked] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // v20 — کد هدیه: استعلام زنده‌ی تخفیف
  const [giftChecking, setGiftChecking] = useState(false);
  const [giftQuote, setGiftQuote] = useState<GiftQuote | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);

  // هر بار باز شدن از گام انتخاب شروع می‌شود
  useEffect(() => {
    if (open) {
      setStep('select');
      setPicked(null);
      setError(null);
      setGiftQuote(null);
      setGiftError(null);
    }
  }, [open]);

  const checkGift = async () => {
    if (!plan || giftCode.trim().length < 3 || giftChecking) return;
    setGiftChecking(true);
    setGiftError(null);
    try {
      const q = await fetchGiftQuote(giftCode, plan.code);
      setGiftQuote(q);
      if (!q.valid) setGiftError(q.error ?? 'کد هدیه معتبر نیست');
    } catch (e) {
      setGiftQuote(null);
      setGiftError(e instanceof Error ? e.message : 'استعلام کد ناموفق بود');
    } finally {
      setGiftChecking(false);
    }
  };

  const selected = methods?.find((m) => m.code === picked) ?? null;
  const anyEnabled = (methods ?? []).some((m) => m.enabled);

  const continuePick = () => {
    if (!selected?.enabled) return;
    if (selected.code === 'card') {
      setStep('deposit');
      return;
    }
    if (selected.code === 'online') onPickOnline();
  };

  const copyCard = async () => {
    if (!depositCfg?.card) return;
    try {
      await navigator.clipboard.writeText(depositCfg.card.number);
      showToast('شماره کارت کپی شد');
      return;
    } catch {
      /* فالبک مرورگرهای قدیمی پایین‌تر */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = depositCfg.card.number;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('شماره کارت کپی شد');
    } catch {
      showToast('کپی خودکار نشد؛ لطفاً دستی انتخاب و کپی کنید');
    }
  };

  const submitDeposit = async () => {
    if (submitting || !plan) return;
    const value = ref.trim();
    if (value.length < 4) {
      setError('شماره پیگیری را وارد کنید (حداقل ۴ رقم)');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const req = await createDepositRequest(plan.code, value, note, giftCode);
      setRef('');
      setNote('');
      onDepositSuccess(req);
      showToast('درخواست واریز ثبت شد؛ پس از بررسی ادمین فعال می‌شود');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ثبت درخواست ناموفق بود');
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel: Record<DepositRequest['status'], string> = {
    pending: 'در انتظار بررسی',
    approved: 'تأیید شد ✓',
    rejected: 'رد شد',
  };
  const statusClass: Record<DepositRequest['status'], string> = {
    pending: 'bg-amber-400/15 text-amber-600 dark:text-amber-300',
    approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    rejected: 'bg-red-500/15 text-red-600 dark:text-red-300',
  };

  return (
    <Sheet open={open} onClose={onClose}>
      {step === 'select' ? (
        <>
          <SheetHeader title="انتخاب روش پرداخت" onClose={onClose} />

          {/* خلاصه‌ی پلن انتخاب‌شده */}
          {plan ? (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 flex items-center justify-between gap-2">
              <span className="text-xs text-on-surface-variant">
                پلن انتخابی: <span className="font-black text-on-surface dark:text-inverse-on-surface">{plan.title}</span>
              </span>
              <span className="text-sm font-black text-primary shrink-0">{formatToman(giftQuote?.valid ? giftQuote.payableTomans! : plan.priceTomans)}</span>
            </div>
          ) : null}

          {/* v20 — ورودی کد هدیه + استعلام زنده */}
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-800 p-3 space-y-2">
            <label htmlFor="pm-gift-code" className="text-xs font-bold text-on-surface-variant block">
              کد هدیه دارید؟ (اختیاری)
            </label>
            <div className="flex gap-1.5">
              <input
                id="pm-gift-code"
                type="text"
                dir="ltr"
                autoComplete="off"
                className="flex-1 min-w-0 rounded-xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-700/60 px-3 py-2 text-body-sm text-left font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="مثلاً NOWRUZ1404"
                value={giftCode}
                onChange={(e) => {
                  onGiftCodeChange(e.target.value.toUpperCase());
                  setGiftQuote(null);
                  setGiftError(null);
                }}
                maxLength={50}
              />
              <button
                type="button"
                className="shrink-0 rounded-xl bg-primary/10 text-primary px-3 py-2 text-xs font-bold active:scale-95 transition-transform disabled:opacity-40"
                onClick={() => void checkGift()}
                disabled={giftCode.trim().length < 3 || giftChecking}
              >
                {giftChecking ? '…' : 'بررسی کد'}
              </button>
            </div>
            {giftQuote?.valid ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 rounded-xl p-2.5 leading-5">
                کد <span dir="ltr" className="font-bold">{giftQuote.code}</span> اعمال شد: {formatToman(giftQuote.discountTomans ?? 0)} تخفیف — قابل پرداخت{' '}
                <b>{formatToman(giftQuote.payableTomans ?? 0)}</b>
              </p>
            ) : null}
            {giftError ? (
              <p className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl p-2.5">{giftError}</p>
            ) : null}
          </div>

          {/* فهرست روش‌ها — فعال و به‌زودی */}
          {methods === null ? (
            <div className="py-6 flex items-center justify-center gap-2 text-on-surface-variant text-body-sm">
              <span className="inline-block w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              در حال دریافت روش‌های پرداخت…
            </div>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="روش پرداخت">
              {methods.map((m) => {
                const active = picked === m.code;
                const IconName = METHOD_ICONS[m.code] ?? 'credit_card';
                return (
                  <button
                    key={m.code}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!m.enabled}
                    onClick={() => setPicked(m.code)}
                    className={`w-full text-right rounded-2xl border p-3.5 flex items-center gap-3 transition-all ${
                      !m.enabled
                        ? 'opacity-55 cursor-not-allowed border-outline-variant/30 bg-surface-container/60 dark:bg-slate-800/60'
                        : active
                          ? 'border-2 border-primary bg-primary/5 shadow-sm'
                          : 'border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-800 active:scale-[0.99]'
                    }`}
                  >
                    <span
                      className={`inline-flex p-2 rounded-xl shrink-0 ${
                        m.enabled ? 'bg-primary/10 text-primary' : 'bg-surface-container dark:bg-slate-700 text-on-surface-variant'
                      }`}
                    >
                      <Icon name={IconName} size={22} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-body-sm font-black text-on-surface dark:text-inverse-on-surface">{m.title}</span>
                      <span className="block text-[11px] text-on-surface-variant mt-0.5 leading-4">{m.description}</span>
                    </span>
                    {m.enabled ? (
                      active ? (
                        <Icon name="check_circle" size={22} className="text-primary shrink-0" />
                      ) : (
                        <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                          فعال
                        </span>
                      )
                    ) : (
                      <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-surface-container dark:bg-slate-700 text-on-surface-variant">
                        به‌زودی
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {!anyEnabled && methods !== null ? (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3 leading-5">
              فعلاً روش پرداختی فعال نیست؛ به‌زودی درگاه پرداخت راه‌اندازی می‌شود.
            </p>
          ) : null}

          <button
            type="button"
            className="w-full py-3.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            onClick={continuePick}
            disabled={!selected?.enabled}
          >
            <span>ادامه</span>
            <Icon name="arrow_back" size={20} />
          </button>
        </>
      ) : (
        <>
          {/* گام کارت‌به‌کارت — تغییر روش */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-xs font-bold text-primary flex items-center gap-1 active:scale-95"
              onClick={() => setStep('select')}
            >
              <Icon name="arrow_forward" size={16} />
              تغییر روش پرداخت
            </button>
            <button
              type="button"
              className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container active:scale-95 transition-all"
              onClick={onClose}
              aria-label="بستن"
            >
              <Icon name="close" size={24} />
            </button>
          </div>
          <h3 className="text-headline-md font-bold text-on-surface dark:text-inverse-on-surface -mt-2">پرداخت کارت به کارت</h3>

          {/* شماره کارت + کپی */}
          {depositCfg?.card ? (
            <>
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p dir="ltr" className="text-right text-lg font-black tracking-widest text-primary">
                    {toFa(groupCardNumber(depositCfg.card.number))}
                  </p>
                  {depositCfg.card.holder ? (
                    <p className="text-[11px] text-on-surface-variant mt-0.5">به نام: {depositCfg.card.holder}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary text-on-primary px-3 py-2 text-xs font-bold active:scale-95 transition-transform"
                  onClick={() => void copyCard()}
                >
                  <Icon name="content_copy" size={16} />
                  کپی
                </button>
              </div>

              {depositCfg.card.guide ? (
                <p className="text-xs text-on-surface-variant leading-6 whitespace-pre-line bg-surface-container dark:bg-slate-700/60 rounded-xl p-3">
                  {depositCfg.card.guide}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3">
              اطلاعات کارت دریافت نشد؛ اتصال اینترنت را بررسی و شیت را دوباره باز کنید.
            </p>
          )}

          {/* مبلغ پلن انتخابی */}
          {plan ? (
            <p className="text-xs text-on-surface-variant">
              مبلغ دقیق برای پلن «<span className="font-black text-on-surface dark:text-inverse-on-surface">{plan.title}</span>»:{' '}
              {giftQuote?.valid ? (
                <>
                  <s className="text-slate-400">{formatToman(plan.priceTomans)}</s>{' '}
                  <span className="font-black text-primary">{formatToman(giftQuote.payableTomans ?? plan.priceTomans)}</span>
                  {' '}(با کد هدیه <span dir="ltr" className="font-mono">{giftQuote.code}</span>)
                </>
              ) : (
                <span className="font-black text-primary">{formatToman(plan.priceTomans)}</span>
              )}
            </p>
          ) : null}

          {/* فرم ثبت درخواست */}
          <div className="space-y-2">
            <div>
              <label htmlFor="pm-deposit-ref" className="text-xs font-bold text-on-surface-variant block mb-1">
                شماره پیگیری حواله <span className="text-red-500">*</span>
              </label>
              <input
                id="pm-deposit-ref"
                type="text"
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-700/60 px-3 py-2.5 text-body-sm text-left focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="۴ تا ۴۰ رقم"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                maxLength={40}
              />
            </div>
            <div>
              <label htmlFor="pm-deposit-note" className="text-xs font-bold text-on-surface-variant block mb-1">
                یادداشت (اختیاری)
              </label>
              <textarea
                id="pm-deposit-note"
                rows={2}
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-700/60 px-3 py-2.5 text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="مثلاً نام بانک یا زمان واریز"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
              />
            </div>

            {error ? (
              <p className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl p-3">{error}</p>
            ) : null}

            <button
              type="button"
              className="w-full py-3 rounded-2xl border-2 border-primary text-primary font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={() => void submitDeposit()}
              disabled={submitting}
            >
              {submitting ? (
                <span className="inline-block w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              ) : (
                <Icon name="task_alt" size={20} />
              )}
              <span>{submitting ? 'در حال ثبت…' : 'ثبت درخواست واریز'}</span>
            </button>
          </div>

          {/* درخواست‌های قبلی من */}
          {depositRequests.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-black text-on-surface-variant">درخواست‌های قبلی من</p>
              <div className="max-h-44 overflow-y-auto space-y-2 custom-scrollbar">
                {depositRequests.map((r) => (
                  <div
                    key={r.uuid}
                    className="rounded-xl border border-outline-variant/30 bg-surface-container dark:bg-slate-700/60 p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold truncate">
                        {r.planTitle ?? r.planCode} · {formatToman(r.amountTomans)}
                      </p>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${statusClass[r.status]}`}>
                        {statusLabel[r.status]}
                      </span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant">
                      پیگیری: <span dir="ltr">{toFa(r.reference)}</span> · {faDateTimeUtc(r.createdAt)}
                    </p>
                    {r.status === 'rejected' && r.reviewNote ? (
                      <p className="text-[11px] text-red-600 dark:text-red-300">دلیل رد: {r.reviewNote}</p>
                    ) : null}
                    {r.status === 'approved' ? (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-300">اشتراک شما فعال شد — اگر به‌روز نشد، سینک بزنید</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
