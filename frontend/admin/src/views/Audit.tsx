/**
 * کارام — پنل مدیریت: لاگ رخدادها (audit logs)
 * دسترسی: audit.view
 */
import { useEffect, useState } from 'react';
import { api, type AdminAuditRow } from '../api';
import { faNum, faDateTime, actionLabel } from '../format';
import { Spinner, Pagination, EmptyState } from '../ui';
import { IconSearch } from '../icons';

export default function Audit({
  onToast,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
}) {

  const [rows, setRows] = useState<AdminAuditRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');

  const load = async (p = page) => {
    try {
      const res = await api.audit({ actor: actor || undefined, action: action || undefined, page: p });
      setRows(res.items);
      setPage(res.page);
      setPages(res.pages);
      setTotal(res.total);
    } catch {
      onToast('error', 'بارگذاری رخدادها ناموفق بود');
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1);
        }}
      >
        <select className="field !w-auto" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="فیلتر بازیگر">
          <option value="">همه‌ی بازیگرها</option>
          <option value="admin">مدیر</option>
          <option value="user">کاربر</option>
          <option value="system">سیستم</option>
        </select>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconSearch size={18} />
          </span>
          <input
            className="field !pr-10"
            placeholder="نوع رخداد (مثل user. یا settings)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            aria-label="جستجوی نوع رخداد"
          />
        </div>
        <button type="submit" className="btn-primary">
          فیلتر
        </button>
      </form>

      <div className="card overflow-hidden">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState text="رخدادی یافت نشد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="border-b border-slate-200 bg-surface-dim/60">
                <tr>
                  <th className="th">رخداد</th>
                  <th className="th">بازیگر</th>
                  <th className="th">موجودیت</th>
                  <th className="th">جزئیات</th>
                  <th className="th">IP</th>
                  <th className="th">زمان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="table-row-hover align-top">
                    <td className="td">
                      <p className="font-semibold text-slate-800">{actionLabel(r.action)}</p>
                      <p dir="ltr" className="text-right text-[10px] text-slate-400">
                        {r.action}
                      </p>
                    </td>
                    <td className="td text-xs text-slate-500">
                      {r.actorType === 'admin' ? `مدیر #${faNum(r.actorId ?? 0)}` : r.actorType === 'user' ? `کاربر #${faNum(r.actorId ?? 0)}` : 'سیستم'}
                    </td>
                    <td className="td text-xs text-slate-500">
                      {r.entity ? `${r.entity}${r.entityId ? `: ${r.entityId.slice(0, 12)}…` : ''}` : '—'}
                    </td>
                    <td className="td max-w-64">
                      <p dir="ltr" className="break-all text-right text-[10px] leading-4 text-slate-400">
                        {r.details ? JSON.stringify(r.details) : '—'}
                      </p>
                    </td>
                    <td className="td text-xs text-slate-400">{r.ip ?? '—'}</td>
                    <td className="td text-xs text-slate-500">{faDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100">
          <Pagination page={page} pages={pages} total={total} onChange={(p) => void load(p)} />
        </div>
      </div>
    </div>
  );
}
