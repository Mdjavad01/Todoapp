/**
 * کارام — پنل مدیریت: تنظیمات سرور (فاز ۵ — گروه‌بندی کامل)
 * گروه‌ها: کلید اصلی پرداخت (گام ۲) · عمومی و API · ظاهر اپ و ویس · پروایدر ایمیل · پروایدر تلگرام ·
 *          پروایدر پیامک · پرداخت آنلاین (زیبال) · دوره آزمایشی ·
 *          کارت‌به‌کارت · به‌روزرسانی و پشتیبانی · بکاپ (v19) ·
 *          رفرال / کد هدیه / یادآور تلگرامی (v20)
 * دسترسی: settings.manage
 */
import { useEffect, useMemo, useState } from 'react';
import { api, hasPerm, type AdminSession } from '../api';
import { faDateTime } from '../format';
import { Modal, Spinner } from '../ui';
import { IconCheck, IconWarning } from '../icons';

interface SettingRow {
  key: string;
  value: string;
  updatedAt: string;
}

interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'bool' | 'select' | 'textarea' | 'shortcuts' | 'payments_master';
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
    title: 'کلید اصلی پرداخت (توقف اضطراری فروش) — گام ۲',
    description: 'با بستن کلید اصلی، شروع همه‌ی پرداخت‌های جدید در وب و اندروید همان لحظه سمت سرور بسته می‌شود (۴۰۳ با code=payments_disabled). سفارش‌های در جریان و پروِ فعلی‌ها دست‌نخورده می‌مانند؛ استعلام و مصرف کد هدیه کلید مستقل دارد (گروه «کد هدیه»).',
    fields: [
      { key: 'payments_master_enabled', label: 'کلید اصلی پرداخت', kind: 'payments_master', help: 'خاموش = هیچ کاربر جدیدی نمی‌تواند پرداخت را شروع کند؛ دکمه‌ی خرید در اپ با کارت پیام + فیلد کد هدیه جایگزین می‌شود' },
      { key: 'payments_enabled_web', label: 'پرداخت در وب فعال', kind: 'bool', help: 'فقط نسخه‌ی وب (PWA) — اندروید سوییچ مستقل دارد. پلتفرم از هدر X-App-Platform تشخیص داده می‌شود' },
      { key: 'payments_enabled_android', label: 'پرداخت در اندروید فعال', kind: 'bool', help: 'فقط اپ اندروید — مثلاً قبل از بازبینی بازار خاموش کنید تا فقط در وب فروش بماند' },
      { key: 'payments_disabled_message', label: 'پیام نمایشی به کاربر (وقتی بسته است)', kind: 'textarea', help: 'خالی = پیام پیش‌فرض «پرداخت‌ها موقتاً غیرفعال است…» — در کارت کهربایی صفحه‌ی پرو اپ دیده می‌شود' },
    ],
  },
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
    title: 'شورتکد ورود مالک (OTP) — گام ۱ امنیت',
    description: 'میان‌برهای تب «شورتکد ورود OTP» — به‌جای مقادیر هاردکد، از این‌جا مدیریت می‌شوند. فقط برای ادمین با دسترسی مدیریت کاربران نمایش داده می‌شوند؛ ایمیل و شماره‌ی شما دیگر در کد نیست.',
    fields: [
      { key: 'admin_otp_shortcuts', label: 'میان‌برها', kind: 'shortcuts', help: 'برای کانال تلگرام هدف لازم نیست (اتصال با بلیت انجام می‌شود). حداکثر ۱۰ میان‌بر.' },
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
    title: 'پروایدر تلگرام',
    description: 'ربات کد تأیید ورود — توکن را از @BotFather تلگرام بگیرید. با پر بودن توکن، کانال ورود با تلگرام فعال می‌شود.',
    fields: [
      { key: 'telegram_bot_token', label: 'توکن ربات', kind: 'text', dir: 'ltr', secret: true },
      { key: 'telegram_bot_username', label: 'نام کاربری ربات (بدون @)', kind: 'text', dir: 'ltr' },
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
    title: 'پرداخت آنلاین (درگاه زیبال)',
    description: 'فروش اشتراک کارام پرو از درگاه زیبال — کد مرچنت را از پنل زیبال بگیرید (برای تست: zibal).',
    fields: [
      { key: 'gateway_zibal_enabled', label: 'درگاه زیبال فعال', kind: 'bool', help: 'با روشن کردن این گزینه، دکمه‌ی خرید در اپ به درگاه وصل می‌شود' },
      { key: 'zibal_merchant', label: 'کد مرچنت زیبال', kind: 'text', dir: 'ltr', help: 'مرچنت واقعی از panel.zibal.ir — مقدار zibal فقط برای تست' },
    ],
  },
  {
    title: 'دوره آزمایشی (ثبت‌نام جدید)',
    description: 'هر کاربر جدید به‌طور خودکار چند روز کارام پرو می‌گیرد — بدون پرداخت. پاسخ ساده به تردید «اول امتحان کنم بعد بخرم».',
    fields: [
      { key: 'trial_enabled', label: 'دوره آزمایشی فعال', kind: 'bool', help: 'با روشن کردنش، هر ثبت‌نام جدید به‌طور خودکار پرو می‌شود (بج «دوره آزمایشی» در اپ دیده می‌شود)' },
      { key: 'trial_days', label: 'طول دوره آزمایشی (روز)', kind: 'number', help: 'پیش‌فرض ۷ — بین ۱ تا ۳۰ روز. فقط به ثبت‌نام‌های جدید اعمال می‌شود؛ به اشتراک‌های فعلی دست نمی‌زند' },
    ],
  },
  {
    title: 'کارت به کارت (واریز با تأیید ادمین)',
    description: 'روش پرداخت دستی: کاربر کارت‌به‌کارت می‌کند و شماره پیگیری را در اپ ثبت می‌کند؛ شما از تب «واریزی‌ها» تأیید یا رد می‌کنید.',
    fields: [
      { key: 'deposit_card_enabled', label: 'کارت‌به‌کارت فعال', kind: 'bool', help: 'با روشن کردنش، کارت «پرداخت کارت به کارت» در صفحه‌ی پرو اپ نشان داده می‌شود' },
      { key: 'deposit_card_number', label: 'شماره کارت (۱۶ رقم، بدون فاصله)', kind: 'text', dir: 'ltr', help: 'مثال: 6104337812345678 — در اپ گروه‌چهاررقمی و با کپی نشان داده می‌شود' },
      { key: 'deposit_card_holder', label: 'نام صاحب حساب', kind: 'text', help: 'مثال: علی محمدی — کنار شماره کارت نمایش داده می‌شود' },
      { key: 'deposit_card_guide', label: 'راهنمای پرداخت (برای کاربر)', kind: 'textarea', help: 'مثلاً ساعات بررسی، بانک مقصد، الزام مبلغ دقیق' },
    ],
  },
  {
    title: 'به‌روزرسانی اپ و پشتیبانی',
    description: 'کارت «نسخه‌ی جدید موجود است» در تنظیمات اپ کاربر + اطلاعات پشتیبانی در شیت قوانین و صفحه‌ی ورود. همه‌ی فیلدها اختیاری‌اند؛ خالی = غیرفعال.',
    fields: [
      { key: 'app_latest_version', label: 'آخرین نسخه‌ی اپ (x.y.z)', kind: 'text', dir: 'ltr', help: 'مثال: 3.7.1 — اگر از نسخه‌ی نصب‌شده‌ی کاربر جدیدتر باشد، کارت آبی به‌روزرسانی در تنظیمات اپ دیده می‌شود. خالی = کارت خاموش' },
      { key: 'app_update_url', label: 'لینک دانلود پک جدید (اختیاری)', kind: 'text', dir: 'ltr', help: 'مثال: https://app.hojre24shop.ir/karam-fix-v17.zip — دکمه‌ی «دانلود به‌روزرسانی» به این لینک وصل می‌شود' },
      { key: 'app_update_notes', label: 'توضیح نسخه‌ی جدید (اختیاری)', kind: 'textarea', help: 'چند خط کوتاه درباره‌ی تغییرات — زیر کارت به‌روزرسانی نشان داده می‌شود' },
      { key: 'support_email', label: 'ایمیل پشتیبانی', kind: 'text', dir: 'ltr', help: 'در شیت «قوانین و حریم خصوصی» و پشتیبانی اپ نمایش داده می‌شود' },
      { key: 'support_telegram', label: 'آیدی تلگرام پشتیبانی', kind: 'text', dir: 'ltr', help: 'بدون @ یا با @ — مثل: karam_support' },
    ],
  },
  {
    title: 'بکاپ و پشتیبان (v19)',
    description: 'بکاپ روزانه خودکار با کرون هاست انجام می‌شود (api/cron/backup-db.php — راهنما در INSTALL بخش ۱۵). فایل‌ها در storage/backups بیرون از webroot نگه‌داری می‌شوند (۷ نسخه‌ی آخر).',
    fields: [
      { key: 'backup_telegram_chat', label: 'شناسه چت تلگرام ادمین (اختیاری)', kind: 'text', dir: 'ltr', help: 'عددِ chat_id حساب/گروه تلگرام شما — اگر پر باشد، ربات همان فایل بکاپ را هر روز می‌فرستد (تا ۴۵MB؛ بزرگ‌تر = فقط پیام گزارش). برای پیدا کردن chat_id: به ربات @userinfobot پیام بدهید' },
    ],
  },
  {
    title: 'دعوت دوستان — رفرال (v20)',
    description: 'هر کاربر یک کد دعوت یکتا دارد (شیت حساب کاربری اپ). با فعال‌سازی کد دوستش، هر دو طرف N روز پرو می‌گیرند. هر حساب فقط یک‌بار می‌تواند کد کسی را فعال کند.',
    fields: [
      { key: 'referral_enabled', label: 'دعوت دوستان فعال', kind: 'bool', help: 'با روشن کردنش، کارت «دعوت دوستان» با کد دعوت و دکمه اشتراک در شیت حساب کاربری اپ ظاهر می‌شود' },
      { key: 'referral_days', label: 'پاداش هر طرف (روز)', kind: 'number', help: 'پیش‌فرض ۷ — بین ۱ تا ۳۰ روز. هم دعوت‌کننده و هم دعوت‌شده این تعداد روز پرو می‌گیرند' },
    ],
  },
  {
    title: 'کد هدیه (v20)',
    description: 'ساخت و مدیریت کدهای تخفیف در تب «کدهای هدیه» پنل؛ کاربر در شیت انتخاب روش پرداخت اپ کد را وارد می‌کند. این کلید فقط سوئیچ کلی خاموش/روشن است.',
    fields: [
      { key: 'gift_enabled', label: 'کد هدیه فعال', kind: 'bool', help: 'خاموش = هیچ کدی (حتی کدهای فعال) پذیرفته نمی‌شود؛ مناسب جلوی استفاده در دوره‌ی خاص مثل فروش ویژه' },
    ],
  },
  {
    title: 'یادآور تلگرامی (v20)',
    description: 'کرون روزانه api/cron/reminder-cron.php (راهنما در INSTALL بخش ۱۶) به کاربرانی که با تلگرام وارد شده‌اند و کار عقب‌افتاده دارند پیام «شما N کار عقب‌افتاده داری» می‌فرستد.',
    fields: [
      { key: 'reminder_enabled', label: 'یادآور تلگرامی فعال', kind: 'bool', help: 'فقط برای کاربرانی که حداقل یک‌بار با ربات وارد شده‌اند می‌رسد (ربات حق شروع گفت‌وگو ندارد)؛ روزی حداکثر یک پیام' },
      { key: 'reminder_lookback_days', label: 'بازه عقب‌افتادگی (روز)', kind: 'number', help: 'پیش‌فرض ۳۰ — فقط کارهایی که ۱ تا ۳۰ روز از موعدشان گذشته (جلوگیری از اسپم کارهای قدیمی)' },
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
  const [busy, setBusy] = useState(false);
  // گام ۲ — دیالوگ تأیید بستن کلید اصلی پرداخت (عملیت حساس — لاگ Audit هم می‌شود)
  const [confirmMasterOff, setConfirmMasterOff] = useState(false);
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
      for (const k of dirtyKeys) body[k] = draft[k] ?? '';
      const res = await api.updateSettings(body);
      // تست زنده‌ی توکن ربات تلگرام (سرور هنگام ذخیره انجام می‌دهد)
      if (res?.telegram) {
        if (res.telegram.ok) {
          onToast('success', `توکن ربات معتبر است (${res.telegram.bot ?? 'ربات'}) — تداخل webhook هم پاک شد`);
        } else {
          onToast('error', `توکن ربات نامعتبر است: ${res.telegram.error ?? 'خطای ناشناخته'}`);
        }
      } else {
        onToast('success', 'تنظیمات ذخیره شد');
      }
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

    if (f.kind === 'shortcuts') {
      return <ShortcutsEditor key={f.key} help={f.help} value={value} dirty={dirty} disabled={!canManage} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />;
    }

    // گام ۲ — کلید اصلی پرداخت: برجسته + خاموش‌کردن فقط با دیالوگ تأیید
    if (f.kind === 'payments_master') {
      const on = value === '1';
      return (
        <div
          key={f.key}
          role="group"
          aria-label={f.label}
          className={`rounded-xl border p-3.5 ${on ? 'border-emerald-200 bg-emerald-50/70' : 'border-rose-300 bg-rose-50'}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-sm font-black ${on ? 'text-emerald-700' : 'text-rose-700'}`}>
                {on ? 'پرداخت‌ها فعال است' : 'پرداخت‌ها بسته است (همه‌ی پلتفرم‌ها)'}
              </p>
              {f.help ? <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{f.help}</p> : null}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={f.label}
              disabled={!canManage}
              onClick={() => {
                if (on) {
                  setConfirmMasterOff(true); // خاموش‌کردن → تأیید می‌خواهد
                } else {
                  setDraft({ ...draft, [f.key]: '1' }); // روشن‌کردن بی‌خطر است
                }
              }}
              className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-brand-600' : 'bg-rose-500'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {dirty ? <DirtyNote updatedAt={rows?.find((r) => r.key === f.key)?.updatedAt} /> : null}
        </div>
      );
    }

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

      {/* گام ۲ — دیالوگ تأیید بستن کلید اصلی پرداخت */}
      <Modal open={confirmMasterOff} title="بستن کلید اصلی پرداخت؟" onClose={() => setConfirmMasterOff(false)} width="max-w-md">
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-6 text-amber-800">
          <IconWarning size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <ul className="list-inside list-disc space-y-1">
            <li>شروع همه‌ی پرداخت‌های جدید در وب و اندروید بسته می‌شود (همان لحظه، سمت سرور).</li>
            <li>دکمه‌ی خرید در اپ کاربران با پیام شما جایگزین می‌شود.</li>
            <li>سفارش‌های در جریان و پروِ فعلی‌ها دست‌نخورده می‌مانند.</li>
            <li>کدهای هدیه همچنان معتبرند (کلید مستقل).</li>
          </ul>
        </div>
        <p className="mt-3 text-xs leading-6 text-slate-500">
          تغییر پس از زدن «ذخیره» در پایین صفحه اعمال و در Audit ثبت می‌شود. مطمئنید؟
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirmMasterOff(false)}>
            انصراف
          </button>
          <button
            type="button"
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            onClick={() => {
              setDraft((d) => ({ ...d, payments_master_enabled: '0' }));
              setConfirmMasterOff(false);
            }}
          >
            بله، ببند
          </button>
        </div>
      </Modal>
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

interface ShortcutRow {
  label: string;
  channel: 'email' | 'telegram' | 'sms';
  target: string;
}

const SHORTCUT_CHANNELS: { value: ShortcutRow['channel']; label: string }[] = [
  { value: 'email', label: 'ایمیل' },
  { value: 'telegram', label: 'ربات تلگرام' },
  { value: 'sms', label: 'پیامک موبایل' },
];

function parseShortcuts(raw: string): ShortcutRow[] {
  try {
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        label: String(r.label ?? ''),
        channel: (['email', 'telegram', 'sms'].includes(r.channel) ? r.channel : 'email') as ShortcutRow['channel'],
        target: String(r.target ?? ''),
      }));
  } catch {
    return [];
  }
}

/** ویرایشگر شورتکدهای ورود مالک (گام ۱) — همان ظاهر بقیه‌ی فرم تنظیمات */
function ShortcutsEditor({
  value,
  help,
  dirty,
  disabled,
  onChange,
}: {
  value: string;
  help?: string;
  dirty: boolean;
  disabled: boolean;
  onChange: (json: string) => void;
}) {
  const rows = parseShortcuts(value);
  const update = (next: ShortcutRow[]) => onChange(JSON.stringify(next));
  return (
    <div className="py-2">
      <p className="text-sm font-semibold text-slate-700">میان‌برهای ورود</p>
      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-slate-400">هیچ میان‌بری ثبت نشده — با دکمه‌ی پایین یکی بسازید.</p>
        ) : null}
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-center gap-2">
              <input
                className="field min-w-0 flex-1"
                placeholder="برچسب (مثل: ورود خودم)"
                value={row.label}
                disabled={disabled}
                aria-label={`برچسب میان‌بر ${i + 1}`}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, label: e.target.value };
                  update(next);
                }}
              />
              <select
                className="field w-36 shrink-0"
                value={row.channel}
                disabled={disabled}
                aria-label={`کانال میان‌بر ${i + 1}`}
                onChange={(e) => {
                  const ch = e.target.value as ShortcutRow['channel'];
                  const next = [...rows];
                  next[i] = { ...row, channel: ch, target: ch === 'telegram' ? '' : row.target };
                  update(next);
                }}
              >
                {SHORTCUT_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs text-rose-600"
                disabled={disabled}
                onClick={() => update(rows.filter((_, j) => j !== i))}
              >
                حذف
              </button>
            </div>
            {row.channel !== 'telegram' ? (
              <input
                className="field mt-1.5 text-left"
                dir="ltr"
                placeholder={row.channel === 'email' ? 'you@example.com' : '09xxxxxxxxx'}
                value={row.target}
                disabled={disabled}
                aria-label={`هدف میان‌بر ${i + 1}`}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, target: e.target.value };
                  update(next);
                }}
              />
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">این کانال هدف نمی‌خواهد — کد از طریق اتصال چت تلگرام صادر می‌شود.</p>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn-ghost mt-2 text-xs"
        disabled={disabled || rows.length >= 10}
        onClick={() => update([...rows, { label: '', channel: 'email', target: '' }])}
      >
        + افزودن میان‌بر
      </button>
      {help ? <p className="mt-0.5 text-[11px] text-slate-400">{help}</p> : null}
      {dirty ? <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-amber-600"><span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium">تغییر داده‌شده (ذخیره نشده)</span></p> : null}
    </div>
  );
}
