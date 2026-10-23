/**
 * کارام — پنل مدیریت: تنظیمات سرور (فاز ۴.۵ — گروه‌بندی کامل)
 * گروه‌ها: عمومی و API · ظاهر اپ و ویس · پروایدر ایمیل · پروایدر بله ·
 *          پروایدر پیامک · پرداخت و کارت‌به‌کارت (ویرایشگر کامل کارت‌ها)
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

interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'bool' | 'select' | 'textarea';
  options?: { value: string; label: string }[];
  help?: string;
  dir?: 'ltr' | 'rtl';
  secret?: boolean;
}

interface GroupDef {
  title: string;
  description?: string;
  fields: FieldDef[];
}

const GROUPS: GroupDef[] = [
  {
    title: 'عمومی و API',
    description: 'هویت سرویس، حالت تعمیر و سقف‌های سمت سرور',
    fields: [
      { key: 'app_name', label: 'نام اپ', kind: 'text' },
      { key: 'min_app_version', label: 'حداقل نسخه‌ی اپ (x.y.z)', kind: 'text', dir: 'ltr' },
      { key: 'maintenance_mode', label: 'حالت تعمیر و نگهداری', kind: 'bool', help: 'همه‌ی API به‌جز سلامت سرویس و پنل، ۵۰۳ می‌شود' },
      { key: 'api_allow_registration', label: 'ثبت‌نام حساب جدید', kind: 'bool', help: 'خاموش = فقط کاربران موجود می‌توانند وارد شوند' },
      { key: 'api_max_sync_items', label: 'سقف آیتم در هر درخواست سینک', kind: 'number', help: 'بین ۱۰۰ تا ۵۰۰۰' },
    ],
  },
  {
    title: 'ظاهر اپ و ویس',
    description: 'عنوان صفحه‌ی پرو و تنظیمات خواندن صوتی کارها',
    fields: [
      { key: 'paywall_title', label: 'عنوان صفحه‌ی پرو', kind: 'text' },
      { key: 'voice_enabled', label: 'خواندن صوتی کارها', kind: 'bool' },
      { key: 'voice_provider', label: 'پروایدر ویس', kind: 'select', options: [
        { value: 'off', label: 'خاموش' },
        { value: 'web_speech', label: 'موتور صوتی دستگاه (Web Speech — بدون وابستگی)' },
      ] },
      { key: 'voice_rate', label: 'سرعت خواندن (٪)', kind: 'number', help: '۵۰ تا ۲۰۰' },
      { key: 'voice_pitch', label: 'زیر و بمی صدا (٪)', kind: 'number', help: '۵۰ تا ۱۵۰' },
      { key: 'voice_lang', label: 'زبان صدا', kind: 'text', dir: 'ltr' },
    ],
  },
  {
    title: 'پروایدر ایمیل',
    description: 'خالی گذاشتن فیلدها = استفاده از .env سرور',
    fields: [
      { key: 'provider_email_enabled', label: 'سرویس ایمیل فعال', kind: 'bool' },
      { key: 'mail_transport', label: 'مسیر ارسال', kind: 'select', options: [
        { value: '', label: 'پیش‌فرض (.env)' },
        { value: 'mail', label: 'mail() هاست (cPanel)' },
        { value: 'smtp', label: 'SMTP' },
        { value: 'log', label: 'فقط لاگ (توسعه)' },
      ] },
      { key: 'smtp_host', label: 'SMTP Host', kind: 'text', dir: 'ltr' },
      { key: 'smtp_port', label: 'SMTP Port', kind: 'number', dir: 'ltr' },
      { key: 'smtp_secure', label: 'رمزنگاری', kind: 'select', options: [
        { value: '', label: 'پیش‌فرض (.env)' },
        { value: 'tls', label: 'TLS (STARTTLS)' },
        { value: 'ssl', label: 'SSL' },
        { value: 'none', label: 'بدون رمزنگاری' },
      ] },
      { key: 'smtp_user', label: 'SMTP User', kind: 'text', dir: 'ltr' },
      { key: 'smtp_pass', label: 'SMTP Password', kind: 'text', dir: 'ltr', secret: true },
      { key: 'smtp_from', label: 'فرستنده (From)', kind: 'text', dir: 'ltr' },
    ],
  },
  {
    title: 'پروایدر بله',
    description: 'توکن ربات ورود با بله — از @BotFather بله',
    fields: [
      { key: 'provider_bale_enabled', label: 'سرویس بله فعال', kind: 'bool' },
      { key: 'bale_bot_token', label: 'توکن ربات', kind: 'text', dir: 'ltr', secret: true },
      { key: 'bale_bot_username', label: 'نام کاربری ربات (بدون @)', kind: 'text', dir: 'ltr' },
    ],
  },
  {
    title: 'پروایدر پیامک (HTTP عمومی)',
    description: 'درایور عمومی — آدرس و قالب هر شرکت پیامکی قابل تنظیم است. {phone} و {code} جایگزین می‌شوند.',
    fields: [
      { key: 'provider_sms_enabled', label: 'کانال ورود با موبایل', kind: 'bool' },
      { key: 'provider_sms_url', label: 'آدرس API ارسال', kind: 'text', dir: 'ltr' },
      { key: 'provider_sms_method', label: 'متد', kind: 'select', options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
      ] },
      { key: 'provider_sms_headers', label: 'هدرها (JSON)', kind: 'textarea', dir: 'ltr', help: 'نمونه: {"Authorization":"Bearer xxx"}' },
      { key: 'provider_sms_body', label: 'قالب بدنه', kind: 'textarea', dir: 'ltr', help: 'خالی = پارامتر phone و code · نمونه: {"mobile":"{phone}","message":"کد: {code}"}' },
    ],
  },
  {
    title: 'پرداخت و کارت‌به‌کارت',
    description: 'درگاه‌ها (فاز ۵) و کارت‌های بانکی — کاملاً قابل شخصی‌سازی',
    fields: [
      { key: 'gateway_zibal_enabled', label: 'درگاه زیبال', kind: 'bool' },
      { key: 'gateway_aqayepardakht_enabled', label: 'درگاه آقای پرداخت', kind: 'bool' },
      { key: 'gateway_card_enabled', label: 'پرداخت کارت‌به‌کارت', kind: 'bool' },
      { key: 'card_payment_guide', label: 'راهنمای پرداخت کارت‌به‌کارت (در اپ نمایش داده می‌شود)', kind: 'textarea' },
    ],
  },
];

const SECRET_MASK = '••••••••';

export default function Settings({
  onToast,
  session,
}: {
  onToast: (kind: 'success' | 'error', text: string) => void;
  session: AdminSession;
}) {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shownSecrets, setShownSecrets] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<{ number: string; holder: string; bank: string; note: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const canManage = hasPerm(session, 'settings.manage');

  const load = async () => {
    try {
      const res = await api.settings();
      const map: Record<string, string> = {};
      for (const it of res.items) map[it.key] = it.value;
      setRows(res.items);
      setDraft(map);
      try {
        const parsed = JSON.parse(map['card_numbers'] || '[]');
        setCards(
          Array.isArray(parsed)
            ? parsed.map((c: unknown) => {
                const card = typeof c === 'string' ? { number: c } : (c as Record<string, string>);
                return {
                  number: String(card.number ?? ''),
                  holder: String(card.holder ?? ''),
                  bank: String(card.bank ?? ''),
                  note: String(card.note ?? ''),
                };
              })
            : [],
        );
      } catch {
        setCards([]);
      }
    } catch {
      onToast('error', 'بارگذاری تنظیمات ناموفق بود');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // تغییرات کارت‌ها هم در draft منعکس می‌شود
  const setCardsDirty = (next: typeof cards) => {
    setCards(next);
    setDraft((d) => ({ ...d, card_numbers: JSON.stringify(next) }));
  };

  const dirtyKeys = useMemo(() => {
    if (!rows) return [] as string[];
    const keys = rows.filter((r) => draft[r.key] !== undefined && draft[r.key] !== r.value).map((r) => r.key);
    if (!keys.includes('card_numbers') && JSON.stringify(cards) !== (rows.find((r) => r.key === 'card_numbers')?.value ?? '')) {
      keys.push('card_numbers');
    }
    return keys;
  }, [rows, draft, cards]);

  const save = async () => {
    if (dirtyKeys.length === 0) return;
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      for (const k of dirtyKeys) body[k] = draft[k] ?? '';
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

  const serverMap: Record<string, string> = {};
  for (const r of rows) serverMap[r.key] = r.value;

  const renderField = (f: FieldDef) => {
    const server = serverMap[f.key] ?? '';
    let value = draft[f.key] ?? server;
    const dirty = draft[f.key] !== undefined && draft[f.key] !== server;

    if (f.kind === 'bool') {
      return (
        <div className="flex items-center justify-between gap-3 py-2.5" key={f.key}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700">{f.label}</p>
            {f.help ? <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{f.help}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`text-xs font-medium ${value === '1' ? 'text-emerald-600' : 'text-slate-400'}`}>
              {value === '1' ? 'روشن' : 'خاموش'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={value === '1'}
              aria-label={f.label}
              disabled={!canManage}
              onClick={() => setDraft({ ...draft, [f.key]: value === '1' ? '0' : '1' })}
              className={`relative flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${value === '1' ? 'bg-brand-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value === '1' ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      );
    }

    if (f.kind === 'select') {
      return (
        <div className="py-2" key={f.key}>
          <p className="text-sm font-semibold text-slate-700">{f.label}</p>
          <select
            className="field mt-1"
            value={value}
            disabled={!canManage}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            aria-label={f.label}
          >
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {dirty ? <DirtyNote updatedAt={rows?.find((r) => r.key === f.key)?.updatedAt} /> : null}
        </div>
      );
    }

    if (f.kind === 'textarea') {
      return (
        <div className="py-2" key={f.key}>
          <p className="text-sm font-semibold text-slate-700">{f.label}</p>
          <textarea
            className={`field mt-1 min-h-20 ${f.dir === 'ltr' ? 'text-left' : ''}`}
            dir={f.dir}
            value={value}
            disabled={!canManage}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            aria-label={f.label}
          />
          {f.help ? <p className="mt-0.5 text-[11px] text-slate-400">{f.help}</p> : null}
          {dirty ? <DirtyNote updatedAt={rows?.find((r) => r.key === f.key)?.updatedAt} /> : null}
        </div>
      );
    }

    // text / number
    const isMasked = f.secret && !shownSecrets.has(f.key) && value !== '';
    return (
      <div className="py-2" key={f.key}>
        <p className="text-sm font-semibold text-slate-700">{f.label}</p>
        <div className="mt-1 flex gap-1.5">
          <input
            className={`field ${f.dir === 'ltr' ? 'text-left' : ''}`}
            dir={f.dir}
            type={f.kind === 'number' ? 'text' : 'text'}
            inputMode={f.kind === 'number' ? 'numeric' : undefined}
            value={isMasked ? SECRET_MASK : value}
            disabled={!canManage}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            onFocus={() => {
              if (f.secret && !shownSecrets.has(f.key)) {
                setShownSecrets((s) => new Set(s).add(f.key));
                setDraft((d) => ({ ...d, [f.key]: d[f.key] ?? server }));
              }
            }}
            aria-label={f.label}
          />
          {f.secret ? (
            <button
              type="button"
              className="btn-ghost shrink-0 text-xs"
              onClick={() =>
                setShownSecrets((s) => {
                  const n = new Set(s);
                  if (n.has(f.key)) n.delete(f.key);
                  else n.add(f.key);
                  return n;
                })
              }
            >
              {shownSecrets.has(f.key) ? 'پنهان' : 'نمایش'}
            </button>
          ) : null}
        </div>
        {f.help ? <p className="mt-0.5 text-[11px] text-slate-400">{f.help}</p> : null}
        {dirty ? <DirtyNote updatedAt={rows?.find((r) => r.key === f.key)?.updatedAt} /> : null}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <p className="text-xs leading-6 text-slate-400">
        تنظیمات زیر بدون تغییر در کد، رفتار سرویس را کنترل می‌کنند. فیلدهای پروایدر اگر خالی باشند از <code dir="ltr">.env</code> سرور خوانده می‌شوند.
        {!canManage && ' — شما اجازه‌ی ذخیره ندارید (فقط مشاهده).'}
      </p>

      {GROUPS.map((g) => (
        <div key={g.title} className="card p-4">
          <p className="text-sm font-black text-slate-800">{g.title}</p>
          {g.description ? <p className="mt-0.5 text-[11px] text-slate-400">{g.description}</p> : null}
          <div className="mt-2 divide-y divide-slate-100">
            {g.fields.map(renderField)}
          </div>

          {/* ویرایشگر کارت‌های بانکی — فقط در گروه پرداخت */}
          {g.title === 'پرداخت و کارت‌به‌کارت' ? (
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">کارت‌های بانکی ({cards.length.toLocaleString('fa-IR')})</p>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={!canManage}
                  onClick={() => setCardsDirty([...cards, { number: '', holder: '', bank: '', note: '' }])}
                >
                  + افزودن کارت
                </button>
              </div>
              {cards.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">هنوز کارتی ثبت نشده است.</p>
              ) : (
                <div className="mt-2 space-y-3">
                  {cards.map((c, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="label">شماره کارت (۱۶ رقم)</p>
                          <input
                            className="field text-left"
                            dir="ltr"
                            inputMode="numeric"
                            placeholder="6037997512345678"
                            disabled={!canManage}
                            value={c.number}
                            onChange={(e) => {
                              const next = [...cards];
                              next[i] = { ...c, number: e.target.value };
                              setCardsDirty(next);
                            }}
                          />
                        </div>
                        <div>
                          <p className="label">به نام</p>
                          <input
                            className="field"
                            disabled={!canManage}
                            value={c.holder}
                            onChange={(e) => {
                              const next = [...cards];
                              next[i] = { ...c, holder: e.target.value };
                              setCardsDirty(next);
                            }}
                          />
                        </div>
                        <div>
                          <p className="label">بانک</p>
                          <input
                            className="field"
                            disabled={!canManage}
                            value={c.bank}
                            onChange={(e) => {
                              const next = [...cards];
                              next[i] = { ...c, bank: e.target.value };
                              setCardsDirty(next);
                            }}
                          />
                        </div>
                        <div>
                          <p className="label">یادداشت (مثلاً «کارت اصلی»)</p>
                          <input
                            className="field"
                            disabled={!canManage}
                            value={c.note}
                            onChange={(e) => {
                              const next = [...cards];
                              next[i] = { ...c, note: e.target.value };
                              setCardsDirty(next);
                            }}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost mt-2 text-xs text-rose-600 hover:!bg-rose-50"
                        disabled={!canManage}
                        onClick={() => setCardsDirty(cards.filter((_, idx) => idx !== i))}
                      >
                        حذف این کارت
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                این کارت‌ها در صفحه‌ی پرداخت اپ (کارت‌به‌کارت) نمایش داده می‌شوند؛ شماره به‌صورت خودکار از ارقام اضافه پاک می‌شود.
              </p>
            </div>
          ) : null}
        </div>
      ))}

      {canManage && (
        <div className="sticky bottom-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-pop backdrop-blur">
          <button type="button" className="btn-primary" disabled={busy || dirtyKeys.length === 0} onClick={() => void save()}>
            <IconCheck size={17} /> ذخیره‌ی {dirtyKeys.length > 0 ? `(${dirtyKeys.length.toLocaleString('fa-IR')} تغییر)` : ''}
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

function DirtyNote({ updatedAt }: { updatedAt?: string }) {
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-amber-600">
      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium">تغییر داده‌شده (ذخیره نشده)</span>
      {updatedAt ? <span className="text-slate-300">· نسخه‌ی سرور: {faDateTime(updatedAt)}</span> : null}
    </p>
  );
}
