/**
 * کارام — پنل مدیریت: کدهای هدیه (v20 — گام ۲۰ رشد)
 * ساخت کد تخفیف (درصد یا مبلغ ثابت) + سقف استفاده + انقضا.
 * کد در اپ، داخل شیت انتخاب روش پرداخت وارد می‌شود؛ شمارش استفاده فقط
 * بعد از تأیید قطعی (پرداخت درگاه / تأیید واریز) بالا می‌رود.
 * دسترسی: plans.manage
 */
import { useEffect, useState } from 'react';
import { api, hasPerm, type AdminGiftCode, type AdminSession } from '../api';
import { faMoney, faDateTime, faNum } from '../format';
import { Spinner, Badge, EmptyState, Modal } from '../ui';
import { IconPlus, IconRefresh, IconGift, IconCheck, IconClose } from '../icons';

export default function GiftCodes({
  session,
  onToast,
}: {
  session: AdminSession | null;
  onToast: (kind: 'success' | 'error', text: string) => void;
}) {
  const [rows, setRows] = useState<AdminGiftCode[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // فرم ساخت
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('0');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | null>(null);

  const canManage = hasPerm(session, 'plans.manage');

  const load = async () => {
    setRows(null);
    try {
      const res = await api.giftcodes();
      setRows(res.items);
    } catch {
      onToast('error', 'بارگذاری کدهای هدیه ناموفق بود');
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  const doCreate = async () => {
    const valueNum = Number(value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
    if (!valueNum || valueNum < 1) {
      onToast('error', kind === 'percent' ? 'درصد تخفیف را وارد کنید (۱ تا ۱۰۰)' : 'مبلغ تخفیف (ریال) را وارد کنید');
      return;
    }
    if (kind === 'percent' && valueNum > 100) {
      onToast('error', 'درصد تخفیف حداکثر ۱۰۰ است');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createGiftcode({
        code: code.trim() || undefined,
        kind,
        value: valueNum,
        maxUses: Number(maxUses) || 0,
        expiresAt: expiresAt || undefined,
      });
      onToast('success', `${res.message} — کد: ${res.code}`);
      setLastCreated(res.code);
      setCreateOpen(false);
      setCode('');
      setValue('');
      setMaxUses('0');
      setExpiresAt('');
      await load();
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'ساخت کد ناموفق بود');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (row: AdminGiftCode) => {
    if (busyId === row.id) return;
    setBusyId(row.id);
    try {
      await api.updateGiftcode(row.id, { active: !row.active });
      onToast('success', row.active ? 'کد غیرفعال شد' : 'کد فعال شد');
      await load();
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'تغییر وضعیت ناموفق بود');
    } finally {
      setBusyId(null);
    }
  };

  const valueLabel = (r: AdminGiftCode): string =>
    r.kind === 'percent' ? `${faNum(r.value)}٪ تخفیف` : `${faMoney(r.value)} ریال تخفیف`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs leading-6 text-slate-500">
          کد هدیه روی هر دو روش پرداخت کار می‌کند (درگاه و کارت‌به‌کارت). هر کاربر هر کد را فقط یک‌بار
          می‌تواند استفاده کند؛ «سقف استفاده = ۰» یعنی بی‌نهایت.
        </p>
        <div className="flex gap-1.5">
          <button type="button" className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => void load()}>
            <IconRefresh size={15} /> به‌روزرسانی
          </button>
          {canManage && (
            <button
              type="button"
              className="btn-primary !px-2.5 !py-1.5 text-xs"
              onClick={() => {
                setLastCreated(null);
                setCreateOpen(true);
              }}
            >
              <IconPlus size={15} /> کد جدید
            </button>
          )}
        </div>
      </div>

      {lastCreated ? (
        <div className="card flex items-center gap-3 border-emerald-200 bg-emerald-50/60 p-4">
          <IconGift size={22} className="shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-800">
            آخرین کد ساخته‌شده: <b dir="ltr" className="font-mono">{lastCreated}</b> — برای دوست/مشتری خود بفرستید.
          </p>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState text="هنوز کد هدی‌ای ساخته نشده — با «کد جدید» اولین کد را بسازید" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span dir="ltr" className="font-mono text-sm font-black text-slate-800">{r.code}</span>
                    <Badge tone={r.active ? 'green' : 'red'}>{r.active ? 'فعال' : 'غیرفعال'}</Badge>
                    <span className="text-xs font-bold text-brand-700">{valueLabel(r)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    استفاده: {faNum(r.usedCount)} از {r.maxUses > 0 ? faNum(r.maxUses) : 'بی‌نهایت'}
                    {' · ساخته: '}
                    {faDateTime(r.createdAt, false)}
                    {r.expiresAt ? ` · انقضا: ${faDateTime(r.expiresAt, false)}` : ' · بدون انقضا'}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className={`shrink-0 ${r.active ? 'btn-ghost !px-2.5 !py-1.5 text-rose-600 hover:!bg-rose-50' : 'btn-primary !px-2.5 !py-1.5 text-xs'}`}
                    disabled={busyId === r.id}
                    onClick={() => void toggleActive(r)}
                  >
                    {busyId === r.id ? '…' : r.active ? 'غیرفعال کن' : 'فعال کن'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* مودال ساخت کد */}
      <Modal
        open={createOpen}
        title="ساخت کد هدیه جدید"
        onClose={() => setCreateOpen(false)}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            کد (اختیاری — خالی = خودکار تولید می‌شود)
            <input
              dir="ltr"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-left font-mono text-sm focus:border-brand-500 focus:outline-none"
              placeholder="مثلاً NOWRUZ1404"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={50}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-slate-600">
              نوع تخفیف
              <select
                className="field mt-1"
                value={kind}
                onChange={(e) => setKind(e.target.value === 'amount' ? 'amount' : 'percent')}
              >
                <option value="percent">درصد</option>
                <option value="amount">مبلغ ثابت (ریال)</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {kind === 'percent' ? 'مقدار (۱ تا ۱۰۰)' : 'مبلغ (ریال)'}
              <input
                dir="ltr"
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm focus:border-brand-500 focus:outline-none"
                placeholder={kind === 'percent' ? '20' : '490000'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={12}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              سقف استفاده (۰ = بی‌نهایت)
              <input
                dir="ltr"
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm focus:border-brand-500 focus:outline-none"
                placeholder="0"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                maxLength={7}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              تاریخ انقضا (اختیاری)
              <input
                type="date"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </label>
          </div>
          <p className="rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">
            نمونه: کد «NOWRUZ1404» با ۲۰٪ تخفیف و سقف ۵۰ بار — پلن سالانه ۱٬۹۰۰٬۰۰۰ ریال → ۱٬۵۲۰٬۰۰۰ ریال
            قابل پرداخت.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>
              <IconClose size={16} /> انصراف
            </button>
            <button type="button" className="btn-primary" disabled={creating} onClick={() => void doCreate()}>
              <IconCheck size={16} /> {creating ? 'در حال ساخت…' : 'ساخت کد'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
