/**
 * کارام — پنل مدیریت: مدیریت کاربران (جستجو، جزئیات، مسدودسازی، اعطای پرو، ابطال نشست)
 * دسترسی: users.view برای دیدن — users.manage برای تغییر
 */
import { useEffect, useState } from 'react';
import { api, hasPerm, type AdminUserRow, type AdminUserDetail, type AdminSession } from '../api';
import { faNum, faDateTime, STATUS_LABELS, SOURCE_LABELS } from '../format';
import { Spinner, Badge, Modal, Pagination, EmptyState } from '../ui';
import { IconSearch, IconEye, IconBlock, IconCheck, IconCrown, IconRefresh, IconWarning } from '../icons';

export default function Users({
  onToast,
  session,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
  session: AdminSession;
}) {
  const canManage = hasPerm(session, 'users.manage');
  const canView = hasPerm(session, 'users.view');

  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async (p = page) => {
    setLoading(true);
    try {
      const res = await api.users({ q: q || undefined, status: status || undefined, page: p, perPage: 15 });
      setRows(res.items);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
    } catch {
      onToast('error', 'بارگذاری کاربران ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await api.user(id);
      setDetail(res);
    } catch {
      onToast('error', 'بارگذاری جزئیات ناموفق بود');
    } finally {
      setDetailLoading(false);
    }
  };

  if (!canView) {
    return <EmptyState text="دسترسی مشاهده‌ی کاربران را ندارید" />;
  }

  return (
    <div className="space-y-4">
      {/* نوار جستجو */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1);
        }}
        role="search"
      >
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconSearch size={18} />
          </span>
          <input
            className="field !pr-10"
            placeholder="جستجو با ایمیل، نام یا UUID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="جستجوی کاربر"
          />
        </div>
        <select
          className="field !w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="فیلتر وضعیت"
        >
          <option value="">همه‌ی وضعیت‌ها</option>
          <option value="active">فعال</option>
          <option value="blocked">مسدود</option>
        </select>
        <button type="submit" className="btn-primary">
          جستجو
        </button>
      </form>

      {/* جدول */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="border-b border-slate-200 bg-surface-dim/60">
              <tr>
                <th className="th">کاربر</th>
                <th className="th">وضعیت</th>
                <th className="th">اشتراک</th>
                <th className="th">داده‌ها</th>
                <th className="th">آخرین ورود</th>
                <th className="th">عضویت</th>
                <th className="th sr-only">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={7}>
                    <Spinner />
                  </td>
                </tr>
              )}
              {!loading && rows && rows.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState text="کاربری یافت نشد" />
                  </td>
                </tr>
              )}
              {!loading &&
                rows?.map((u) => (
                  <tr key={u.id} className="table-row-hover">
                    <td className="td">
                      <p className="font-semibold text-slate-800">{u.displayName ?? 'بدون نام'}</p>
                      <p dir="ltr" className="text-right text-xs text-slate-400">
                        {u.email ?? u.uuid.slice(0, 18) + '…'}
                      </p>
                    </td>
                    <td className="td">
                      {u.status === 'active' ? (
                        <Badge tone="green">فعال</Badge>
                      ) : u.status === 'blocked' ? (
                        <Badge tone="red">مسدود</Badge>
                      ) : (
                        <Badge tone="gray">{STATUS_LABELS[u.status]}</Badge>
                      )}
                    </td>
                    <td className="td">
                      {u.isPremium ? (
                        <Badge tone="amber">
                          پرو — {faDateTime(u.premiumUntil, false)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">عادی</span>
                      )}
                    </td>
                    <td className="td">
                      <span className="text-xs text-slate-500">
                        {faNum(u.listsCount)} لیست · {faNum(u.tasksCount)} کار
                      </span>
                    </td>
                    <td className="td">
                      <span className="text-xs text-slate-500">{u.lastLoginAt ? faDateTime(u.lastLoginAt) : '—'}</span>
                    </td>
                    <td className="td">
                      <span className="text-xs text-slate-500">{faDateTime(u.createdAt, false)}</span>
                    </td>
                    <td className="td">
                      <button
                        type="button"
                        className="btn-outline !px-2.5 !py-1.5 text-xs"
                        onClick={() => void openDetail(u.id)}
                      >
                        <IconEye size={15} /> جزئیات
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100">
          <Pagination page={page} pages={pages} total={total} onChange={(p) => void load(p)} />
        </div>
      </div>

      {/* پنجره‌ی جزئیات کاربر */}
      {detailLoading && <Spinner label="در حال دریافت جزئیات…" />}
      {detail && (
        <UserDetailModal
          detail={detail}
          canManage={canManage}
          onToast={onToast}
          onClose={() => setDetail(null)}
          onChanged={() => {
            void openDetail(detail.user.id);
            void load(page);
          }}
        />
      )}
    </div>
  );
}

/* ================= جزئیات کاربر ================= */

function UserDetailModal({
  detail,
  canManage,
  onToast,
  onClose,
  onChanged,
}: {
  detail: AdminUserDetail;
  canManage: boolean;
  onToast: (kind: 'success' | 'error', text: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const u = detail.user;
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(u.displayName ?? '');
  const [planCode, setPlanCode] = useState('monthly');

  const run = async (key: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(key);
    try {
      const res = await fn();
      onToast('success', res.message ?? 'انجام شد');
      onChanged();
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'خطا در انجام عملیات');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open title={`کاربر: ${u.displayName ?? u.uuid.slice(0, 8)}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">
        {/* خلاصه */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="لیست‌ها" value={faNum(detail.counts.lists)} />
          <MiniStat label="کارها" value={faNum(detail.counts.tasks)} />
          <MiniStat label="زیرکارها" value={faNum(detail.counts.subtasks)} />
          <MiniStat label="نشست فعال" value={faNum(detail.counts.activeSessions)} />
        </div>

        <dl className="space-y-1.5 rounded-xl bg-surface-dim/60 p-3 text-xs leading-6">
          <RowLine label="شناسه (UUID)" value={u.uuid} ltr />
          <RowLine label="وضعیت" value={STATUS_LABELS[u.status] ?? u.status} />
          <RowLine label="اشتراک" value={u.isPremium ? `پرو تا ${faDateTime(u.premiumUntil)}` : 'عادی'} />
          <RowLine label="آخرین ورود" value={u.lastLoginAt ? faDateTime(u.lastLoginAt) : '—'} />
          <RowLine label="عضویت" value={faDateTime(u.createdAt)} />
        </dl>

        {/* هویت‌ها */}
        <section aria-label="هویت‌ها">
          <h4 className="mb-2 text-xs font-bold text-slate-500">هویت‌های ورود</h4>
          <div className="flex flex-wrap gap-2">
            {detail.identities.length === 0 && <span className="text-xs text-slate-400">هویتی ثبت نشده</span>}
            {detail.identities.map((i) => (
              <span key={i.type + i.value} dir="ltr" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
                <span className="font-medium text-slate-800">{i.value}</span>
                <span className="rounded bg-white px-1 text-[10px] text-slate-400">{i.type}</span>
              </span>
            ))}
          </div>
        </section>

        {/* اشتراک‌ها */}
        <section aria-label="اشتراک‌ها">
          <h4 className="mb-2 text-xs font-bold text-slate-500">تاریخچه‌ی اشتراک</h4>
          {detail.subscriptions.length === 0 && <span className="text-xs text-slate-400">اشتراکی ثبت نشده</span>}
          <ul className="space-y-1.5">
            {detail.subscriptions.map((s) => (
              <li key={s.uuid} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
                <span className="font-medium text-slate-700">
                  {s.planTitle ?? 'بدون پلن'} — {SOURCE_LABELS[s.source] ?? s.source}
                </span>
                <span className="text-slate-400">
                  از {faDateTime(s.startsAt, false)} {s.expiresAt ? `تا ${faDateTime(s.expiresAt, false)}` : '(دائمی)'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* عملیات مدیریتی */}
        {canManage && (
          <section aria-label="عملیات مدیریتی" className="space-y-3 rounded-xl border border-slate-200 p-3.5">
            <h4 className="text-xs font-bold text-slate-500">عملیات مدیریتی</h4>

            {/* نام نمایشی */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="dn">نام نمایشی</label>
                <input id="dn" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null || name === (u.displayName ?? '')}
                onClick={() => void run('name', () => api.updateUser(u.id, { displayName: name }))}
              >
                ذخیره نام
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {u.status === 'active' ? (
                <button
                  type="button"
                  className="btn-danger !py-1.5 text-xs"
                  disabled={busy !== null}
                  onClick={() => void run('block', () => api.updateUser(u.id, { status: 'blocked' }))}
                >
                  <IconBlock size={15} /> مسدودسازی (خروج فوری همه‌ی دستگاه‌ها)
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-outline !py-1.5 text-xs"
                  disabled={busy !== null}
                  onClick={() => void run('unblock', () => api.updateUser(u.id, { status: 'active' }))}
                >
                  <IconCheck size={15} /> رفع مسدودی
                </button>
              )}
              <button
                type="button"
                className="btn-outline !py-1.5 text-xs"
                disabled={busy !== null}
                onClick={() => void run('revoke', () => api.revokeSessions(u.id))}
              >
                <IconRefresh size={15} /> ابطال همه‌ی نشست‌ها
              </button>
              {u.isPremium && (
                <button
                  type="button"
                  className="btn-outline !py-1.5 text-xs"
                  disabled={busy !== null}
                  onClick={() => void run('demote', () => api.updateUser(u.id, { premiumUntil: null }))}
                >
                  <IconWarning size={15} /> لغو اشتراک پرو
                </button>
              )}
            </div>

            {/* اعطای پرو */}
            <div className="flex flex-wrap items-end gap-2 border-t border-dashed border-slate-200 pt-3">
              <div>
                <label className="label" htmlFor="plan">اعطای اشتراک</label>
                <select id="plan" className="field !w-auto" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  <option value="monthly">ماهانه (۱ ماه)</option>
                  <option value="annual">سالانه (۱۲ ماه)</option>
                  <option value="lifetime">دائمی</option>
                </select>
              </div>
              <button
                type="button"
                className="btn-primary !py-1.5 text-xs"
                disabled={busy !== null}
                onClick={() =>
                  void run('grant', () =>
                    api.grantPremium(u.id, planCode === 'lifetime' ? { lifetime: true } : { planCode }),
                  )
                }
              >
                <IconCrown size={15} /> فعال‌سازی/تمدید
              </button>
              <p className="text-[11px] leading-5 text-slate-400">
                تمدید از انتهای اشتراک فعلی محاسبه می‌شود و در تاریخچه با منبع «اعطای مدیر» ثبت می‌گردد.
              </p>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-dim/70 px-3 py-2 text-center">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-base font-black text-slate-800">{value}</p>
    </div>
  );
}

function RowLine({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd dir={ltr ? 'ltr' : undefined} className="break-all text-left text-slate-700">
        {value}
      </dd>
    </div>
  );
}
