/**
 * کارام — پنل مدیریت: واریزی‌های کارت‌به‌کارت (فاز ۸)
 * لیست درخواست‌های واریز کاربران با فیلتر وضعیت؛ تأیید = فعال‌سازی اشتراک،
 * رد = با دلیل (دلیل برای کاربر در اپ نمایش داده می‌شود).
 * دسترسی مشاهده: orders.view · تأیید/رد: orders.review
 */
import { useEffect, useState } from 'react';
import { api, hasPerm, type AdminDepositRow, type AdminSession } from '../api';
import { faDateTime } from '../format';
import { priceText, usePriceDisplay } from '../usePriceDisplay';
import { Spinner, Badge, Pagination, EmptyState, Modal } from '../ui';
import { IconCheck, IconWarning, IconRefresh } from '../icons';

const STATUS_TABS: { key: 'pending' | 'approved' | 'rejected' | ''; label: string }[] = [
  { key: 'pending', label: 'در انتظار بررسی' },
  { key: 'approved', label: 'تأییدشده' },
  { key: 'rejected', label: 'ردشده' },
  { key: '', label: 'همه' },
];

const STATUS_BADGE: Record<AdminDepositRow['status'], { tone: 'amber' | 'green' | 'red'; label: string }> = {
  pending: { tone: 'amber', label: 'در انتظار' },
  approved: { tone: 'green', label: 'تأیید شد' },
  rejected: { tone: 'red', label: 'رد شد' },
};

export default function Deposits({
  session,
  onToast,
}: {
  session: AdminSession | null;
  onToast: (kind: 'success' | 'error', text: string) => void;
}) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [priceMode] = usePriceDisplay();
  const [rows, setRows] = useState<AdminDepositRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);

  // مودال‌های تأیید / رد
  const [approveRow, setApproveRow] = useState<AdminDepositRow | null>(null);
  const [approveNote, setApproveNote] = useState('');
  const [rejectRow, setRejectRow] = useState<AdminDepositRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const canReview = hasPerm(session, 'orders.review');

  const load = async (p = page, st = status) => {
    setRows(null);
    try {
      const res = await api.deposits({ status: st || undefined, page: p });
      setRows(res.items);
      setPage(res.page);
      setPages(res.pages);
      setTotal(res.total);
    } catch {
      onToast('error', 'بارگذاری واریزی‌ها ناموفق بود');
    }
  };

  useEffect(() => {
    void load(1, 'pending');
     
  }, []);

  const switchTab = (st: 'pending' | 'approved' | 'rejected' | '') => {
    setStatus(st);
    void load(1, st);
  };

  const doApprove = async () => {
    if (!approveRow || busyId === approveRow.id) return;
    setBusyId(approveRow.id);
    try {
      const res = await api.approveDeposit(approveRow.id, approveNote.trim() || undefined);
      onToast('success', res.message);
      setApproveRow(null);
      setApproveNote('');
      await load(page, status);
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'تأیید ناموفق بود');
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async () => {
    if (!rejectRow || busyId === rejectRow.id) return;
    setBusyId(rejectRow.id);
    try {
      const res = await api.rejectDeposit(rejectRow.id, rejectNote.trim() || undefined);
      onToast('success', res.message);
      setRejectRow(null);
      setRejectNote('');
      await load(page, status);
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'رد ناموفق بود');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* فیلتر وضعیت */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                status === t.key ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => void load(page, status)}>
          <IconRefresh size={15} /> به‌روزرسانی
        </button>
      </div>

      <div className="card overflow-hidden">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState text={status === 'pending' ? 'درخواست واریز در انتظار بررسی نیست 🎉' : 'موردی یافت نشد'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-800">
                      {d.user.displayName ?? 'بدون نام'}
                    </h3>
                    <Badge tone={STATUS_BADGE[d.status].tone}>{STATUS_BADGE[d.status].label}</Badge>
                    {d.discountTomans && d.discountTomans > 0 ? (
                      <Badge tone="amber">کد هدیه {d.couponCode ?? ''}</Badge>
                    ) : null}
                    <span className="text-xs text-slate-500">
                      {d.planTitle ?? d.planCode} ·{' '}
                      {d.discountTomans && d.discountTomans > 0 ? (
                        <>
                          <s className="text-slate-400">{priceText(d.amountTomans + d.discountTomans, priceMode)}</s>{' '}
                        </>
                      ) : (
                        <>{priceText(d.amountTomans, priceMode)}</>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    شماره پیگیری: <span dir="ltr" className="font-mono font-bold">{d.reference}</span>
                  </p>
                  {d.note ? <p className="text-xs text-slate-500">یادداشت کاربر: {d.note}</p> : null}
                  {d.reviewNote ? (
                    <p className="text-xs text-slate-500">
                      {d.status === 'rejected' ? 'دلیل رد: ' : 'یادداشت مدیر: '}
                      {d.reviewNote}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-slate-300">
                    ثبت: {faDateTime(d.createdAt)}
                    {d.reviewedAt ? ` · بررسی: ${faDateTime(d.reviewedAt)}` : ''}
                  </p>
                </div>
                {d.status === 'pending' && canReview ? (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      className="btn-primary !px-2.5 !py-1.5 text-xs"
                      onClick={() => {
                        setApproveRow(d);
                        setApproveNote('');
                      }}
                    >
                      <IconCheck size={15} /> تأیید
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-2.5 !py-1.5 text-rose-600 hover:!bg-rose-50"
                      onClick={() => {
                        setRejectRow(d);
                        setRejectNote('');
                      }}
                    >
                      <IconWarning size={15} /> رد
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100">
          <Pagination page={page} pages={pages} total={total} onChange={(p) => void load(p, status)} />
        </div>
      </div>

      {/* مودال تأیید */}
      <Modal open={approveRow !== null} title="تأیید واریز و فعال‌سازی اشتراک" onClose={() => setApproveRow(null)}>
        {approveRow ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 space-y-1">
              <p>
                کاربر: <b>{approveRow.user.displayName ?? 'بدون نام'}</b>
              </p>
              <p>
                پلن: <b>{approveRow.planTitle ?? approveRow.planCode}</b> · مبلغ:{' '}
                {approveRow.discountTomans && approveRow.discountTomans > 0 ? (
                  <>
                    <s className="text-slate-400">{priceText(approveRow.amountTomans + approveRow.discountTomans, priceMode)}</s>{' '}
                    <b>{priceText(approveRow.amountTomans, priceMode)}</b> (با کد هدیه {approveRow.couponCode})
                  </>
                ) : (
                  <b>{priceText(approveRow.amountTomans, priceMode)}</b>
                )}
              </p>
              <p>
                شماره پیگیری: <span dir="ltr" className="font-mono">{approveRow.reference}</span>
              </p>
              <p className="text-xs text-slate-500">با تأیید، اشتراک از انتهای اعتبار فعلی کاربر تمدید می‌شود.</p>
            </div>
            <label className="block text-xs font-medium text-slate-600">
              یادداشت (اختیاری — در پرونده‌ی رخداد ثبت می‌شود)
              <textarea
                rows={2}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                maxLength={300}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setApproveRow(null)}>
                انصراف
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busyId === approveRow.id}
                onClick={() => void doApprove()}
              >
                {busyId === approveRow.id ? 'در حال تأیید…' : 'تأیید و فعال‌سازی'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* مودال رد */}
      <Modal open={rejectRow !== null} title="رد درخواست واریز" onClose={() => setRejectRow(null)}>
        {rejectRow ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-rose-50 p-3 text-sm text-slate-700">
              کاربر: <b>{rejectRow.user.displayName ?? 'بدون نام'}</b> · پیگیری:{' '}
              <span dir="ltr" className="font-mono">{rejectRow.reference}</span>
            </div>
            <label className="block text-xs font-medium text-slate-600">
              دلیل رد (برای کاربر در اپ نمایش داده می‌شود)
              <textarea
                rows={2}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                placeholder="مثلاً: واریزی با شماره پیگیری داده‌شده پیدا نشد"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                maxLength={300}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setRejectRow(null)}>
                انصراف
              </button>
              <button
                type="button"
                className="btn-ghost !bg-rose-500 !text-white hover:!bg-rose-600"
                disabled={busyId === rejectRow.id}
                onClick={() => void doReject()}
              >
                {busyId === rejectRow.id ? 'در حال ثبت…' : 'ثبت رد'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
