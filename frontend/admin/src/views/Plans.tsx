/**
 * کارام — پنل مدیریت: پلن‌های اشتراک (ویرایش قیمت/عنوان/فعال بودن)
 * دسترسی: plans.manage
 */
import { useEffect, useState } from 'react';
import { api, hasPerm, type AdminPlan, type AdminSession } from '../api';
import { faNum, faMoney } from '../format';
import { Spinner, Badge } from '../ui';
import { IconEdit, IconCheck } from '../icons';

export default function Plans({
  onToast,
  session,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
  session: AdminSession;
}) {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; priceRials: string; description: string }>({ title: '', priceRials: '', description: '' });
  const [busy, setBusy] = useState(false);

  const canManage = hasPerm(session, 'plans.manage');

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
    setDraft({ title: p.title, priceRials: String(p.priceRials), description: p.description ?? '' });
  };

  const save = async (p: AdminPlan) => {
    setBusy(true);
    try {
      const price = Number(draft.priceRials.replace(/[^\d]/g, ''));
      if (!Number.isFinite(price) || price < 0) throw new Error('قیمت نامعتبر است');
      await api.updatePlan(p.id, {
        title: draft.title,
        priceRials: price,
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

  if (!plans) return <Spinner />;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-6 text-slate-400">
        قیمت‌ها به ریال است و مستقیم از سرور به صفحه‌ی پرداخت اپ می‌رود (قانون: قیمت فقط از سرور).
        {!canManage && ' — شما اجازه‌ی ویرایش ندارید (فقط مشاهده).'}
      </p>

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
                    <label className="label" htmlFor={`p-${p.id}`}>قیمت (ریال)</label>
                    <input id={`p-${p.id}`} dir="ltr" className="field text-left" value={draft.priceRials} onChange={(e) => setDraft({ ...draft, priceRials: e.target.value })} inputMode="numeric" />
                  </div>
                  <div>
                    <label className="label" htmlFor={`d-${p.id}`}>توضیح</label>
                    <input id={`d-${p.id}`} className="field" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={255} />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void save(p)}>
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
                    {faMoney(p.priceRials)} <span className="text-xs font-medium text-slate-400">ریال</span>
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
