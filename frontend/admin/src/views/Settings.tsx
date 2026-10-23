/**
 * کارام — پنل مدیریت: تنظیمات سرور (کلیدهای مجاز فقط)
 * دسترسی: settings.manage
 */
import { useEffect, useMemo, useState } from 'react';
import { api, hasPerm, type AdminSession } from '../api';
import { faDateTime } from '../format';
import { Spinner } from '../ui';
import { IconCheck } from '../icons';

interface SettingRow {
  key: string;
  value: string;
  updatedAt: string;
}

const KEY_LABELS: Record<string, string> = {
  app_name: 'نام اپ',
  maintenance_mode: 'حالت تعمیر و نگهداری',
  min_app_version: 'حداقل نسخه‌ی اپ',
  paywall_title: 'عنوان صفحه‌ی پرو',
  gateway_zibal_enabled: 'درگاه زیبال',
  gateway_aqayepardakht_enabled: 'درگاه آقای پرداخت',
  gateway_card_enabled: 'پرداخت کارت‌به‌کارت',
  card_numbers: 'کارت‌های بانکی (JSON)',
  provider_email_enabled: 'سرویس ایمیل',
  provider_bale_enabled: 'سرویس بله',
};

const BOOL_KEYS = new Set([
  'maintenance_mode',
  'gateway_zibal_enabled',
  'gateway_aqayepardakht_enabled',
  'gateway_card_enabled',
  'provider_email_enabled',
  'provider_bale_enabled',
]);

export default function Settings({
  onToast,
  session,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
  session: AdminSession;
}) {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const canManage = hasPerm(session, 'settings.manage');

  const load = async () => {
    try {
      const res = await api.settings();
      const map: Record<string, string> = {};
      for (const it of res.items) map[it.key] = it.value;
      setRows(res.items);
      setDraft(map);
    } catch {
      onToast('error', 'بارگذاری تنظیمات ناموفق بود');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirtyKeys = useMemo(() => {
    if (!rows) return [] as string[];
    return rows.filter((r) => draft[r.key] !== undefined && draft[r.key] !== r.value).map((r) => r.key);
  }, [rows, draft]);

  const save = async () => {
    if (dirtyKeys.length === 0) return;
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      for (const k of dirtyKeys) body[k] = draft[k];
      await api.updateSettings(body);
      onToast('success', 'تنظیمات ذخیره شد');
      await load();
    } catch (e) {
      onToast('error', e instanceof Error ? e.message : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <Spinner />;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-6 text-slate-400">
        فقط این کلیدها از پنل قابل تغییرند؛ بقیه‌ی تنظیمات حساس (رازها و درگاه‌ها) فقط در فایل <code dir="ltr">.env</code> سرور است.
        {!canManage && ' — شما اجازه‌ی ذخیره ندارید (فقط مشاهده).'}
      </p>

      <div className="card divide-y divide-slate-100">
        {rows.map((r) => {
          const isBool = BOOL_KEYS.has(r.key);
          const value = draft[r.key] ?? r.value;
          const dirty = value !== r.value;
          return (
            <div key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700">{KEY_LABELS[r.key] ?? r.key}</p>
                <p dir="ltr" className="text-right text-[10px] text-slate-300">
                  {r.key} · {faDateTime(r.updatedAt)}
                </p>
              </div>

              {isBool ? (
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${value === '1' ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {value === '1' ? 'روشن' : 'خاموش'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={value === '1'}
                    aria-label={KEY_LABELS[r.key] ?? r.key}
                    disabled={!canManage}
                    onClick={() => setDraft({ ...draft, [r.key]: value === '1' ? '0' : '1' })}
                    className={`relative flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${value === '1' ? 'bg-brand-600' : 'bg-slate-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value === '1' ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              ) : r.key === 'card_numbers' ? (
                <textarea
                  dir="ltr"
                  className="field min-h-20 max-w-sm text-left text-xs"
                  value={value}
                  disabled={!canManage}
                  onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                  aria-label={KEY_LABELS[r.key]}
                />
              ) : (
                <input
                  className="field max-w-xs"
                  value={value}
                  disabled={!canManage}
                  onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                  aria-label={KEY_LABELS[r.key]}
                  dir={r.key === 'min_app_version' ? 'ltr' : undefined}
                />
              )}

              {dirty && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">تغییر ناشده در سرور</span>}
            </div>
          );
        })}
      </div>

      {canManage && (
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy || dirtyKeys.length === 0} onClick={() => void save()}>
            <IconCheck size={17} /> ذخیره‌ی {dirtyKeys.length > 0 ? `(${dirtyKeys.length}) تغییر` : ''}
          </button>
          {dirtyKeys.length > 0 && (
            <button type="button" className="btn-ghost" onClick={() => void load()} disabled={busy}>
              بازگرداندن تغییرات
            </button>
          )}
        </div>
      )}
    </div>
  );
}
