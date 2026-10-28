/**
 * کارام — پنل مدیریت: پلن‌های اشتراک (ویرایش قیمت/عنوان/فعال بودن)
 * دسترسی: plans.manage
 *
 * فاز تومان: ورودی قیمت «هزار تومان» است (مثلاً ۴۹ = ۴۹٬۰۰۰ تومان) با پیش‌نمایش زنده؛
 * نمایش قیمت‌ها دوحالته است: «خلاصه» (پیش‌فرض) / «عدد کامل» — کلید پایین صفحه.
 */
import { useEffect, useState } from 'react';
import { api, hasPerm, type AdminPlan, type AdminSession } from '../api';
import { faNum, formatToman } from '../format';
import { priceText, usePriceDisplay, type PriceDisplay } from '../usePriceDisplay';
import { Spinner, Badge } from '../ui';
import { IconEdit, IconCheck } from '../icons';

/** ارقام فارسی/عربی → لاتین */
function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** سقف قیمت: ۹۹٬۹۹۹٬۹۹۹ تومان (هماهنگ با Validator سمت سرور) */
const MAX_TOMANS = 99_999_999;

export default function Plans({
  onToast,
  session,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
  session: AdminSession;
}) {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; priceHezar: string; description: string }>({ title: '', priceHezar: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [priceMode, setPriceMode] = usePriceDisplay();

  const canManage = hasPerm(session, 'plans.manage');

  /** «۴۹۰» یا «49» → تومان صحیح؛ نامعتبر = null */
  const hezarToTomans = (raw: string): number | null => {
    const digits = toLatinDigits(raw).replace(/[^\d]/g, '');
    if (digits === '') return null;
    const hezar = Number(digits);
    if (!Number.isFinite(hezar) || hezar < 1) return null;
    const tomans = hezar * 1000;
    if (tomans > MAX_TOMANS) return null;
    return tomans;
  };

  /** پیش‌نمایش زنده: «= ۴۹۰٬۰۰۰ تومان» */
  const previewTomans = hezarToTomans(draft.priceHezar);

  const load = async () => {
    try {
      const res = await api.plans();
      setPlans(res.items);
    } catch {
      onToast('error', 'بارگذاری پلن‌ها ناموفق بود');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (p: AdminPlan) => {
    setEditing(p.id);
    // ورودی «هزار تومان» — قیمت‌های مضرب ۱۰۰۰ مستقیم تقسیم می‌شوند؛ بقیه به نزدیک‌ترین هزار گرد می‌شود
    const hezar = p.priceTomans % 1000 === 0 ? String(p.priceTomans / 1000) : String(Math.max(1, Math.round(p.priceTomans / 1000)));
    setDraft({ title: p.title, priceHezar: hezar, description: p.description ?? '' });
  };

  const save = async (p: AdminPlan) => {
    const tomans = hezarToTomans(draft.priceHezar);
    if (tomans === null) {
      onToast('error', 'قیمت را به «هزار تومان» وارد کنید (عدد مثبت — حداکثر ۹۹٬۹۹۹) ');
      return;
    }
    setBusy(true);
    try {
      await api.updatePlan(p.id, {
        title: draft.title,
        priceTomans: tomans,
        description: draft.description || null,
      });
      onToast('success', 'پلن ذخیره شد');
      setEditing(null);
      await load();
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (p: AdminPlan) => {
    setBusy(true);
    try {
      await api.updatePlan(p.id, { isActive: !p.isActive });
      await load();
      onToast('success', p.isActive ? 'پلن غیرفعال شد' : 'پلن فعال شد');
    } catch {
      onToast('error', 'تغییر وضعیت ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const modeButtons: { key: PriceDisplay; label: string }[] = [
    { key: 'summary', label: 'خلاصه' },
    { key: 'full', label: 'عدد کامل' },
  ];

  if (!plans) return <Spinner />;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-6 text-slate-400">
        قیمت‌ها به «تومان» است و مستقیم از سرور به صفحه‌ی پرداخت اپ می‌رود (قانون: قیمت فقط از سرور).
        {!canManage && ' — شما اجازه‌ی ویرایش ندارید (فقط مشاهده).'}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500">نمایش قیمت‌ها:</span>
        <div className="flex overflow-hidden rounded-xl border border-slate-200" role="group" aria-label="حالت نمایش قیمت">
          {modeButtons.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setPriceMode(m.key)}
              aria-pressed={priceMode === m.key}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                priceMode === m.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => {
          const isEditing = editing === p.id;
          return (
            <div key={p.id} className="card flex flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">{p.title}</h3>
                  <p dir="ltr" className="text-right text-[11px] text-slate-400">
                    {p.code} · {p.months === 0 ? 'دائمی' : `${faNum(p.months)} ماه`}
                  </p>
                </div>
                {p.isActive ? <Badge tone="green">فعال</Badge> : <Badge tone="gray">غیرفعال</Badge>}
              </div>

              {isEditing ? (
                <div className="space-y-3">
                  <div>
                    <label className="label" htmlFor={`t-${p.id}`}>عنوان</label>
                    <input id={`t-${p.id}`} className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`p-${p.id}`}>قیمت (هزار تومان)</label>
                    <input
                      id={`p-${p.id}`}
                      dir="ltr"
                      className="field text-left"
                      value={draft.priceHezar}
                      onChange={(e) => setDraft({ ...draft, priceHezar: toLatinDigits(e.target.value).replace(/[^\d]/g, '') })}
                      inputMode="numeric"
                      aria-describedby={`pp-${p.id}`}
                    />
                    <p id={`pp-${p.id}`} className="mt-1 text-xs text-slate-400" aria-live="polite">
                      {previewTomans !== null ? (
                        <span className="font-bold text-brand-700">= {formatToman(previewTomans)}</span>
                      ) : (
                        'عدد مثبت وارد کنید — مثلاً ۴۹ = ۴۹٬۰۰۰ تومان'
                      )}
                    </p>
                  </div>
                  <div>
                    <label className="label" htmlFor={`d-${p.id}`}>توضیح</label>
                    <input id={`d-${p.id}`} className="field" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={255} />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary flex-1" disabled={busy || previewTomans === null} onClick={() => void save(p)}>
                      <IconCheck size={16} /> ذخیره
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-2xl font-black text-brand-700">
                    {priceText(p.priceTomans, priceMode)}
                  </p>
                  <p className="mt-1.5 min-h-10 text-xs leading-5 text-slate-500">{p.description ?? '—'}</p>
                  <p className="mt-1 text-[10px] text-slate-300">آخرین تغییر: {new Date(p.updatedAt.replace(' ', 'T') + 'Z').toLocaleDateString('fa-IR')}</p>
                  {canManage && (
                    <div className="mt-4 flex gap-2 border-t border-dashed border-slate-100 pt-3">
                      <button type="button" className="btn-outline flex-1 !py-1.5 text-xs" onClick={() => startEdit(p)}>
                        <IconEdit size={15} /> ویرایش
                      </button>
                      <button
                        type="button"
                        className={`${p.isActive ? 'btn-ghost text-rose-600 hover:!bg-rose-50' : 'btn-outline'} !py-1.5 text-xs`}
                        disabled={busy}
                        onClick={() => void toggleActive(p)}
                      >
                        {p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
