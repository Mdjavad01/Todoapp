/**
 * کارام — پنل مدیریت: اطلاعیه‌ها (CRUD کامل)
 * دسترسی: announcements.manage
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api, type AdminAnnouncement } from '../api';
import { faNum, faDateTime, TYPE_LABELS } from '../format';
import { Spinner, Badge, Modal, Pagination, EmptyState } from '../ui';
import { IconPlus, IconEdit, IconTrash, IconWarning } from '../icons';

export default function Announcements({
  onToast,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
}) {
  const [rows, setRows] = useState<AdminAnnouncement[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<AdminAnnouncement | 'new' | null>(null);

  const load = async (p = page) => {
    try {
      const res = await api.announcements(p);
      setRows(res.items);
      setPage(res.page);
      setPages(res.pages);
      setTotal(res.total);
    } catch {
      onToast('error', 'بارگذاری اطلاعیه‌ها ناموفق بود');
    }
  };

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (a: AdminAnnouncement) => {
    if (!window.confirm(`اطلاعیه «${a.title}» حذف شود؟`)) return;
    try {
      await api.deleteAnnouncement(a.id);
      onToast('success', 'اطلاعیه حذف شد');
      await load(page);
    } catch {
      onToast('error', 'حذف ناموفق بود');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">مجموع: {faNum(total)}</p>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          <IconPlus size={17} /> اطلاعیه جدید
        </button>
      </div>

      <div className="card overflow-hidden">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState text="هنوز اطلاعیه‌ای نساخته‌اید" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-800">{a.title}</h3>
                    <Badge tone={a.type === 'warning' ? 'amber' : a.type === 'premium' ? 'brand' : 'gray'}>
                      {TYPE_LABELS[a.type]}
                    </Badge>
                    {a.isActive ? <Badge tone="green">فعال</Badge> : <Badge tone="gray">غیرفعال</Badge>}
                    {a.imageUrl ? <Badge tone="gray">تصویر</Badge> : null}
                    {a.linkUrl ? <Badge tone="gray">لینک</Badge> : null}
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-slate-500">{a.body}</p>
                  <p className="mt-1 text-[10px] text-slate-300">ساخته‌شده: {faDateTime(a.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => setEditing(a)}>
                    <IconEdit size={15} /> ویرایش
                  </button>
                  <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-rose-600 hover:!bg-rose-50" onClick={() => void remove(a)}>
                    <IconTrash size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100">
          <Pagination page={page} pages={pages} total={total} onChange={(p) => void load(p)} />
        </div>
      </div>

      {editing && (
        <AnnouncementForm
          initial={editing === 'new' ? null : editing}
          onToast={onToast}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(page);
          }}
        />
      )}
    </div>
  );
}

/* ================= فرم ساخت/ویرایش ================= */

function AnnouncementForm({
  initial,
  onToast,
  onClose,
  onSaved,
}: {
  initial: AdminAnnouncement | null;
  onToast: (kind: 'success' | 'error', text: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [type, setType] = useState<AdminAnnouncement['type']>(initial?.type ?? 'info');
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const payload = {
      title,
      body,
      type,
      isActive,
      linkUrl: linkUrl.trim(),
      imageUrl: imageUrl.trim(),
    };
    try {
      if (initial) {
        await api.updateAnnouncement(initial.id, payload);
        onToast('success', 'اطلاعیه ذخیره شد');
      } else {
        await api.createAnnouncement(payload);
        onToast('success', 'اطلاعیه ساخته شد');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={initial ? 'ویرایش اطلاعیه' : 'اطلاعیه جدید'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="a-title">عنوان</label>
          <input id="a-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={150} />
        </div>
        <div>
          <label className="label" htmlFor="a-body">متن اطلاعیه</label>
          <textarea id="a-body" className="field min-h-28" value={body} onChange={(e) => setBody(e.target.value)} required minLength={3} maxLength={2000} />
          <p className="mt-1 text-[10px] text-slate-400">{faNum(body.length)} از ۲۰۰۰ کاراکتر</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="a-type">نوع</label>
            <select id="a-type" className="field" value={type} onChange={(e) => setType(e.target.value as AdminAnnouncement['type'])}>
              <option value="info">اطلاعیه</option>
              <option value="warning">هشدار</option>
              <option value="premium">پرو</option>
            </select>
          </div>
          <div>
            <span className="label">وضعیت</span>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => setIsActive(!isActive)}
              className={`relative flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? 'bg-brand-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="a-link">لینک دکمه (اختیاری)</label>
            <input
              id="a-link"
              dir="ltr"
              className="field text-left"
              placeholder="https://…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              maxLength={500}
            />
          </div>
          <div>
            <label className="label" htmlFor="a-image">تصویر / GIF (اختیاری)</label>
            <input
              id="a-image"
              dir="ltr"
              className="field text-left"
              placeholder="https://app.hojre24shop.ir/…"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1" disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
        </div>
        <p className="flex items-start gap-1.5 text-[10px] leading-5 text-slate-400">
          <IconWarning size={13} />
          اطلاعیه‌های فعال در بنر صفحه‌ی خانه‌ی اپ نمایش داده می‌شود؛ کاربر می‌تواند تا پایان روز ببندد. تصویر/GIF فقط از همین دامنه
          (آپلود از فایل‌منیجر هاست) نمایش داده می‌شود — قانون امنیتی CSP.
        </p>
      </form>
    </Modal>
  );
}
