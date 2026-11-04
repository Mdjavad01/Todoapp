import type { ListEntity, TaskEntity, TaskItemType, RepeatMeta } from '@/types';
import { toIsoDate } from '@/lib/format';
import { templateListKey, findTemplateList, findTemplateLists, isTemplateActive } from '@/db/templateKey';

/**
 * فاز تریدر — تعریف و منطق خالص «چک‌لیست تریدر»
 *
 * قواعد طراحی (تصمیم مرحله‌ی ۰):
 *  - داده فقط با مکانیزم‌های موجود: لیست/کار/تکرار روزانه و هفتگیِ موتور شمسی فعلی — هیچ سیستم موازی‌ای ساخته نمی‌شود.
 *  - یادآور سشن = «کارِ لنگر» داخل خود لیست (repeat='daily' + dueTime + reminderMinutes) — از همان خط لوله‌ی یادآور بومی.
 *  - محدودیت صادقانه: نمونه‌ی تازه‌ی آیتم تکرارشونده فقط وقتی ساخته می‌شود که آیتم قبلی تیک بزند (repo.completeRecurring) —
 *    اگر روزی تیک نزنی، همان آیتم بی‌تیک می‌ماند. این متن در راهنمای کاربر هم آمده است.
 *  - ایدمپوتنس (P2.0): تشخیص با کلید پایدار «trader.<index>» (سینک‌شونده بین دستگاه‌ها) + فال‌بک نامی
 *    برای داده‌ی قدیمیِ بدون کلید + نشانگر pref سطح دستگاه برای حالت دکمه — تغییر نام لیست دیگر فعال‌سازی
 *    دوباره را تکراری نمی‌کند.
 */

/** نام‌های دقیق ۵ لیست تریدر — فال‌بک تشخیص برای داده‌ی قدیمیِ بدون کلید (بعد از تغییر نام توسط کاربر،
 *  لیست همچنان با کلید پیدا می‌شود — نام دیگر هویت نیست) */
export const TRADER_RULES_LIST = 'قوانین من';
export const TRADER_PREMARKET_LIST = 'پیش از بازار';
export const TRADER_PRETRADE_LIST = 'قبل از معامله';
export const TRADER_POSTMARKET_LIST = 'بعد از بازار';
export const TRADER_REVIEW_LIST = 'ریویو هفتگی';
export const TRADER_LIST_NAMES: readonly string[] = [
  TRADER_RULES_LIST,
  TRADER_PREMARKET_LIST,
  TRADER_PRETRADE_LIST,
  TRADER_POSTMARKET_LIST,
  TRADER_REVIEW_LIST,
];

/** P2.0 — کلیدهای پایدار ۵ لیست (سینک‌پذیر — بستن بدهی templateKey)؛ سمت سرور: lists.template_key */
export const TRADER_LIST_KEYS: readonly string[] = TRADER_LIST_NAMES.map((_, i) => templateListKey('trader', i));

/** عناوین کلیدی برای بنر «قوانین من» و آمار انضباط */
export const TRADER_RULE_MAX_LOSS = 'حداکثر ضرر روزانه';
export const TRADER_RULE_RISK = 'ریسک هر معامله';
export const TRADER_SCORE_DAILY = 'امتیاز انضباط امروز';

/** عنوان کارهای لنگر یادآور سشن (داخل خود لیست‌ها — قابل ویرایش مثل هر کار دیگری) */
export const TRADER_ANCHOR_START = 'شروع سشن معاملاتی';
export const TRADER_ANCHOR_END = 'پایان سشن معاملاتی';

/** ریویو هفتگی — پیش‌فرض شنبه به‌ازای درخواست صاحب محصول v1.10.2 (jalaliWeekday: 0=شنبه … 6=جمعه)؛ کاربر از جزئیات آیتم عوضش می‌کند */
export const TRADER_REVIEW_DAY_DEFAULT = 0;

export interface TraderItemDef {
  title: string;
  /** پیش‌فرض 'check' */
  type?: TaskItemType;
  /** پیش‌فرض 'none' */
  repeat?: TaskEntity['repeat'];
  /** فقط برای تکرار سفارشی هفتگی */
  repeatMeta?: RepeatMeta | null;
}

export interface TraderListDef {
  name: string;
  emoji: string;
  color: ListEntity['color'];
  pinned?: boolean;
  /** شرح کوتاه هر لیست — در راهنمای اولین‌بار نمایش داده می‌شود */
  guide: string;
  items: TraderItemDef[];
}

/** محتوای دقیق تمپلیت تریدر — ۵ لیست */
export const TRADER_TEMPLATE: TraderListDef[] = [
  {
    name: TRADER_RULES_LIST,
    emoji: '📌',
    color: 'rose',
    pinned: true,
    guide: 'قوانین ثابت معاملگی‌ات — همیشه بالای همه‌ی لیست‌هاست (پین‌شده)؛ هر وقت خواستی ویرایشش کن.',
    items: [
      { title: TRADER_RULE_MAX_LOSS, type: 'note' }, // عدد یا متن — مثلاً «۲٪» یا «۵۰۰ دلار»
      { title: TRADER_RULE_RISK, type: 'note' },
      { title: 'حداکثر تعداد معامله در روز', type: 'num' },
      { title: 'اگر ضرر روزانه پر شد، پلتفرم را می‌بندم و دیگر معامله نمی‌کنم' },
      { title: 'هیچ‌وقت استاپ‌لاس را برای ضرر بیشتر جابجا نمی‌کنم' },
      { title: 'از روی FOMO یا انتقام معامله نمی‌کنم' },
    ],
  },
  {
    name: TRADER_PREMARKET_LIST,
    emoji: '🌅',
    color: 'amber',
    guide: 'روتین هر روز قبل از شروع سشن — یادآورش ۳۰ دقیقه قبل از ساعت شروع سشن زنگ می‌زند.',
    items: [
      { title: 'تقویم اقتصادی و اخبار مهم امروز را چک کردم', repeat: 'daily' },
      { title: 'حرکت شبانه بازار / گپ‌ها را دیدم', repeat: 'daily' },
      { title: 'واچ‌لیست امروز را ساختم (حداکثر ۵ نماد)', repeat: 'daily' },
      { title: 'سطوح کلیدی (حمایت و مقاومت) را مشخص کردم', repeat: 'daily' },
      { title: 'حداکثر ضرر امروز', type: 'num', repeat: 'daily' },
      { title: 'ریسک هر معامله', type: 'num', repeat: 'daily' },
      { title: 'حالم خوب و آماده است (خواب کافی داشتم، عصبانی نیستم)', repeat: 'daily' },
      { title: 'پلن امروز را نوشتم (فقط ستاپ‌های A+)', type: 'note', repeat: 'daily' },
    ],
  },
  {
    name: TRADER_PRETRADE_LIST,
    emoji: '🎯',
    color: 'teal',
    guide: 'قبل از هر معامله یک‌بار مرور کن — تکرارشونده نیست؛ با دکمه‌ی «ریست تیک‌ها» در کارت تریدر صفر می‌شود.',
    items: [
      { title: 'این معامله دقیقاً طبق پلنم است؟' },
      { title: 'نسبت سود به ضرر حداقل ۲ به ۱ است؟' },
      { title: 'حجم معامله را بر اساس استاپ‌لاس حساب کردم؟' },
      { title: 'خبر مهمی در ۳۰ دقیقه آینده ندارم؟' },
      { title: 'از روی هیجان یا انتقام وارد نمی‌شوم؟' },
    ],
  },
  {
    name: TRADER_POSTMARKET_LIST,
    emoji: '🌆',
    color: 'indigo',
    guide: 'پس از بستن پلتفرم — یادآورش ۳۰ دقیقه بعد از ساعت پایان سشن زنگ می‌زند؛ درس روز و امتیاز انضباط را ثبت کن.',
    items: [
      { title: 'همه‌ی معاملات امروز را ثبت کردم', repeat: 'daily' },
      { title: 'طبق پلنم معامله کردم؟', type: 'choice', repeat: 'daily' },
      { title: 'یک درس اصلی امروز', type: 'note', repeat: 'daily' },
      { title: TRADER_SCORE_DAILY, type: 'score', repeat: 'daily' },
      { title: 'نکته‌ی مهم برای فردا', type: 'note', repeat: 'daily' },
    ],
  },
  {
    name: TRADER_REVIEW_LIST,
    emoji: '🗓️',
    color: 'emerald',
    guide: 'جمع‌بندی هفته — پیش‌فرض شنبه است؛ روزش را از جزئیات هر آیتم می‌توانی عوض کنی.',
    items: [
      { title: 'تعداد کل معاملات هفته', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [TRADER_REVIEW_DAY_DEFAULT] } },
      { title: 'چند معامله طبق پلن بود', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [TRADER_REVIEW_DAY_DEFAULT] } },
      { title: 'بیشترین اشتباه تکراری', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [TRADER_REVIEW_DAY_DEFAULT] } },
      { title: 'کدام ستاپ بهتر جواب داد', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [TRADER_REVIEW_DAY_DEFAULT] } },
      { title: 'یک عادت یا قانون که هفته‌ی بعد تغییر می‌دهم', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [TRADER_REVIEW_DAY_DEFAULT] } },
      { title: 'امتیاز کلی انضباط هفته', type: 'score', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [TRADER_REVIEW_DAY_DEFAULT] } },
    ],
  },
];

/** متن ثابت برجسته‌ی پایین لیست «قبل از معامله» */
export const TRADER_PRETRADE_FOOTER = 'اگر حتی یکی از این‌ها «نه» بود، معامله نکن.';

/** متن صادقانه‌ی محدودیت تکرار — در راهنمای کارت تریدر */
export const TRADER_REPEAT_NOTICE =
  'آیتم‌های تکرارشونده وقتی نوبت تازه می‌سازند که آیتم امروز را تیک بزنی — اگر روزی تیک نزنی، همان آیتم بی‌تیک سر جایش می‌ماند و تاریخچه‌ی تیک‌شده‌ها در «انجام‌شده‌ها» می‌ماند. یادآورها فقط در اپ اندروید زنگ می‌زنند.';

/* ---------------- توابع کمکی خالص ---------------- */

/** «9:5» یا «09:05» → «09:05»؛ نامعتبر = null */
export function normalizeTime(t: string): string | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** «HH:mm» + دقیقه → «HH:mm» (چرخه‌ی شبانه‌روزی) */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * نزدیک‌ترین روز هفتگی (jalaliWeekday: 0=شنبه … 6=جمعه) از امروز به‌صورت «YYYY-MM-DD» میلادی ISO.
 * اگر امروز همان روز است = امروز.
 */
export function nextWeekdayIso(jalaliWeekday: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const jw = (d.getDay() + 1) % 7;
  const delta = (jalaliWeekday - jw + 7) % 7;
  d.setDate(d.getDate() + delta);
  return toIsoDate(d);
}

/** لیست‌های تریدر موجود به ترتیب تعریف تمپلیت — تشخیص کلید-اول + فال‌بک نامی (P2.0)؛ جای خالی undefined */
export function findTraderLists(lists: ListEntity[]): (ListEntity | undefined)[] {
  return findTemplateLists(lists, TRADER_TEMPLATE, (i) => TRADER_LIST_KEYS[i]);
}

/** تمپلیت فعال است اگر هر ۵ لیست (با کلید یا نام) موجود باشند (قاعده‌ی سینک‌پذیر بین دستگاه‌ها) */
export function isTraderActive(lists: ListEntity[]): boolean {
  return isTemplateActive(lists, TRADER_TEMPLATE, (i) => TRADER_LIST_KEYS[i]);
}

/** مقادیر فعلی «قوانین من» برای بنر فقط‌خواندنی بالای «پیش از بازار» (کلید-اول + فال‌بک نامی) */
export function traderRulesValues(
  lists: ListEntity[],
  tasks: TaskEntity[],
): { maxLoss: string | null; risk: string | null } {
  const rules = findTemplateList(lists, TRADER_LIST_KEYS[0], TRADER_RULES_LIST);
  const pick = (title: string): string | null => {
    if (!rules) return null;
    const t = tasks.find((x) => x.listId === rules.id && !x.deletedAt && x.title === title);
    const v = t?.itemValue?.trim();
    return v ? v : null;
  };
  return { maxLoss: pick(TRADER_RULE_MAX_LOSS), risk: pick(TRADER_RULE_RISK) };
}

/**
 * میانگین امتیاز انضباط ۷ روز اخیر — از آیتم‌های «امتیاز انضباط امروز» (type=score) تکمیل‌شده.
 * فقط نمونه‌های completedAt در ۷ روز اخیر؛ نامعتبرها نادیده.
 */
export function traderDisciplineAvg(
  tasks: TaskEntity[],
  now: Date = new Date(),
): { avg: number | null; count: number } {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const scores: number[] = [];
  for (const t of tasks) {
    if (t.deletedAt || t.itemType !== 'score' || t.title !== TRADER_SCORE_DAILY) continue;
    if (!t.completedAt) continue;
    const ts = Date.parse(t.completedAt);
    if (!Number.isFinite(ts) || ts < since || ts > now.getTime() + 60_000) continue;
    const v = Number(t.itemValue);
    if (Number.isFinite(v) && v >= 1 && v <= 10) scores.push(v);
  }
  if (scores.length === 0) return { avg: null, count: 0 };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { avg: Math.round(avg * 10) / 10, count: scores.length };
}

/** نشانی pref نشانگر فعال‌سازی (سطح دستگاه — هویت واقعی لیست‌ها کلید «trader.*» سینک‌شونده است) */
export const TRADER_PREF_KEY = 'trader-template';

/** v1.10.2 — pref بستن بنر «چک‌لیست تریدر آماده است» در خانه (سطح دستگاه؛ با فعال‌سازی، بنر خودش می‌رود) */
export const TRADER_BANNER_PREF = 'trader-banner-dismissed';

export interface TraderPref {
  activatedAt: string;
  start: string; // «HH:mm»
  end: string; // «HH:mm»
}
