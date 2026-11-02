import type { JobPackDef, ListEntity } from '@/types';
import { templateListKey, findTemplateLists, isTemplateActive } from '@/db/templateKey';

/**
 * P2.0 — بسته‌های شغلی پرو (بازطراحی — طبق docs/P2-JOB-PACKS-AUDIT.md)
 *
 * قواعد طراحی (تصمیم تأییدشده‌ی صاحب محصول):
 *  - فقط داده‌ی تمپلیت روی موتور فعلی: لیست/کار/تکرار روزانه و هفتگی شمسی/انواع آیتم فاز تریدر —
 *    هیچ ستون، جدول یا موتور جدیدی.
 *  - یادآورها = «کارِ لنگر» داخل خود لیست (dueTime + reminderMinutes — همان خط لوله‌ی یادآور بومی)؛
 *    ساعت‌ها پیش‌فرض ثابت‌اند (تصمیم ۵) و کاربر از جزئیات همان کار عوضشان می‌کند.
 *  - یادآورها فقط در اپ اندروید زنگ می‌زنند؛ نمونه‌ی تازه‌ی آیتم تکرارشونده فقط با تیکِ آیتم قبلی
 *    ساخته می‌شود (محدودیت صادقانه‌ی موجود — در راهنمای هر بسته تکرار شده است).
 *  - هویت پایدار: هر لیست با کلید «kit-<id>.<index>» ساخته/تشخیص داده می‌شود (db/templateKey.ts)؛
 *    فعال‌سازی دوباره حتی بعد از تغییر نام لیست، هیچ تکراری نمی‌سازد.
 *  - بسته‌های قدیمی (kit-student/kit-freelance v16) با محتوای نو بازطراحی شدند؛ داده‌ی کاربرانی که
 *    قبلاً نسخه‌ی قدیمی را فعال کرده‌اند، لیست/کار عادی سینک‌شده است و دست‌نخورده می‌ماند.
 */

/** یادداشت صادقانه‌ی مشترک همه‌ی بسته‌ها — در پیش‌نمایش هر بسته می‌آید */
export const PACK_REPEAT_NOTICE =
  'آیتم‌های تکرارشونده وقتی نوبت تازه می‌سازند که آیتم امروز را تیک بزنی. یادآورها فقط در اپ اندروید زنگ می‌زنند؛ ساعت هر یادآور را از جزئیات همان کار می‌توانی عوض کنی.';

/** یکتایی جهانی نام لیست‌های قالبی — گارد داده (در تست هم چک می‌شود) */
export const RESERVED_TEMPLATE_LIST_NAMES: readonly string[] = [
  // قالب رایگان (catalog.ts)
  'خرید سوپرمارکت',
  'برنامه کنکور',
  'وسایل سفر',
  'خانه‌تکانی',
  // چک‌لیست تریدر (traderTemplate.ts)
  'قوانین من',
  'پیش از بازار',
  'قبل از معامله',
  'بعد از بازار',
  'ریویو هفتگی',
  // kit-trader قدیمی حذف‌شده (v16) — برای جلوگیری از ادغام نامی با داده‌ی کاربران قدیمی
  'روتین قبل سشن معاملاتی',
  'ژورنال معاملات روزانه',
  // kit های قدیمی v16 — نام‌های بسته‌های نو عمداً از این‌ها متمایز است
  'برنامه مطالعه روزانه',
  'روتین کاری روزانه',
];

/* ---------------- بسته ۱ — فریلنسر و دورکار (بازطراحی kit-freelance) ---------------- */

const KIT_FREELANCE: JobPackDef = {
  id: 'kit-freelance',
  emoji: '💼',
  title: 'بسته‌ی فریلنسر و دورکار',
  subtitle: 'چرخه‌ی روزانه‌ی شروع، کار عمیق، پیگیری و مرور هفتگی کسب‌وکار',
  cta: 'فعال‌سازی بسته',
  lists: [
    {
      name: 'شروع روز کاری',
      emoji: '🌅',
      color: 'amber',
      guide: 'روتین هر روز کاری — یادآورش ساعت ۹:۰۰ زنگ می‌زند (قابل تغییر از جزئیات همان کار).',
      items: [
        { title: 'شروع روز کاری', repeat: 'daily', dueTime: '09:00', reminderMinutes: 15 },
        { title: 'تقویم و ددلاین‌های امروز را مرور کردم', repeat: 'daily' },
        { title: 'مهم‌ترین کار امروز (فقط یکی)', type: 'note', repeat: 'daily' },
        { title: 'ایمیل و پیام‌های فوری کارفرماها را پاسخ دادم', repeat: 'daily' },
        { title: 'میز و ابزار کارم آماده است', repeat: 'daily' },
      ],
    },
    {
      name: 'کار عمیق',
      emoji: '🎯',
      color: 'teal',
      guide: 'بلوک بی‌وقفه‌ی ۹۰ دقیقه‌ای برای مهم‌ترین کار — ساعتش دست خودت است؛ یادآورش را از جزئیات کار بگذار.',
      items: [
        { title: 'بلوک کار عمیق امروز (حداقل ۹۰ دقیقه بدون وقفه)', repeat: 'daily' },
        { title: 'اعلان‌ها را هنگام کار عمیق بستم', repeat: 'daily' },
        { title: 'ساعت کار عمیق امروز', type: 'num', repeat: 'daily' },
        { title: 'بزرگ‌ترین مزاحم امروز چه بود؟', type: 'note', repeat: 'daily' },
      ],
    },
    {
      name: 'پیگیری مشتری‌ها',
      emoji: '💬',
      color: 'emerald',
      guide: 'هیچ پیگیری‌ای گم نمی‌شود: گزارش روزانه به کارفرما، فاکتور معوق و جلسه‌ها.',
      items: [
        { title: 'وضعیت پروژه‌های جاری را به کارفرماها گزارش کردم', repeat: 'daily' },
        { title: 'فاکتورهای معوق را پیگیری کردم', repeat: 'daily' },
        { title: 'جلسه یا کال با مشتری داشتم؟', type: 'choice', repeat: 'daily' },
        { title: 'پیش‌فاکتور/قرارداد در انتظار پاسخ', type: 'num', repeat: 'daily' },
      ],
    },
    {
      name: 'پایان روز کاری',
      emoji: '🌆',
      color: 'rose',
      guide: 'جمع‌بندی روز — یادآورش ساعت ۱۸:۰۰ زنگ می‌زند؛ ثبت ساعت کارکرد و یادداشت فردا.',
      items: [
        { title: 'پایان روز کاری', repeat: 'daily', dueTime: '18:00', reminderMinutes: 15 },
        { title: 'ساعت کارکرد امروز را ثبت کردم', type: 'num', repeat: 'daily' },
        { title: 'کارهای نیمه‌تمام را برای فردا یادداشت کردم', type: 'note', repeat: 'daily' },
        { title: 'فایل‌های پروژه را بکاپ گرفتم', repeat: 'daily' },
      ],
    },
    {
      name: 'مرور هفتگی کسب‌وکار',
      emoji: '🗓️',
      color: 'emerald',
      guide: 'جمع‌بندی هفته با اعداد (درآمد/ساعت/پروژه) — پیش‌فرض جمعه؛ روزش را از جزئیات هر آیتم می‌توانی عوض کنی.',
      items: [
        { title: 'درآمد این هفته (هزار تومان)', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'ساعت‌های فاکتورشده‌ی این هفته', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'پروژه/مشتری جدید این هفته', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'بزرگ‌ترین اتلاف وقت هفته', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'یک بهبود برای هفته‌ی بعد', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'امتیاز رضایت من از این هفته', type: 'score', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
      ],
    },
  ],
};

/* ---------------- بسته ۲ — فروشگاه آنلاین (جدید — kit-store) ---------------- */

const KIT_STORE: JobPackDef = {
  id: 'kit-store',
  emoji: '🛍️',
  title: 'بسته‌ی فروشگاه آنلاین',
  subtitle: 'چرخه‌ی سفارش، موجودی، پیگیری مشتری و مالی برای کسب‌وکار کوچک',
  cta: 'فعال‌سازی بسته',
  lists: [
    {
      name: 'سفارش‌های امروز',
      emoji: '📦',
      color: 'amber',
      guide: 'روتین روزانه‌ی سفارش تا ارسال — یادآورش ساعت ۱۰:۰۰ زنگ می‌زند (قابل تغییر از جزئیات همان کار).',
      items: [
        { title: 'بررسی سفارش‌های امروز', repeat: 'daily', dueTime: '10:00', reminderMinutes: 15 },
        { title: 'سفارش‌های جدید امروز', type: 'num', repeat: 'daily' },
        { title: 'بسته‌بندی و ارسال امروز انجام شد', repeat: 'daily' },
        { title: 'کد رهگیری همه‌ی مرسوله‌ها ثبت شد', repeat: 'daily' },
        { title: 'سوالات خرید مشتری‌ها پاسخ داده شد', repeat: 'daily' },
      ],
    },
    {
      name: 'موجودی و انبار',
      emoji: '🏷️',
      color: 'teal',
      guide: 'شمارش و سفارش دوباره — پیش‌فرض شنبه‌ها؛ «کمبود بحرانی» هر روز چک می‌شود تا کمبودها به شنبه نماند.',
      items: [
        { title: 'کالاهای پرفروش شمارش شد', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
        { title: 'کالاهای رو به اتمام را ثبت کردم', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
        { title: 'سفارش دوباره‌ی لازم را دادم؟', type: 'choice', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [0] } },
        { title: 'کمبود بحرانی موجودی امروز', type: 'note', repeat: 'daily' },
      ],
    },
    {
      name: 'پیگیری مشتری',
      emoji: '💬',
      color: 'emerald',
      guide: 'مشتری بعد از خرید فراموش نمی‌شود: سفارش معوق، نظرات و پیگیری رضایت.',
      items: [
        { title: 'سفارش‌های معوق/ناتمام مشتری‌ها را پیگیری کردم', repeat: 'daily' },
        { title: 'نظرات و پیام‌های امروز پاسخ داده شد', repeat: 'daily' },
        { title: 'مرجوعی یا مشکل باز', type: 'num', repeat: 'daily' },
        { title: 'پیگیری رضایت بعد از تحویل (چند مشتری نمونه)', repeat: 'daily' },
      ],
    },
    {
      name: 'مالی و تسویه',
      emoji: '💰',
      color: 'rose',
      guide: 'ثبت روزانه‌ی فروش و هزینه + تسویه‌ی هفتگی — یادآور «ثبت حساب روز» ساعت ۲۱:۰۰ زنگ می‌زند.',
      items: [
        { title: 'فروش امروز (هزار تومان)', type: 'num', repeat: 'daily' },
        { title: 'هزینه‌ی امروز (هزار تومان)', type: 'num', repeat: 'daily' },
        { title: 'تسویه با تامین‌کننده‌ها انجام شد', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] } },
        { title: 'جمع فروش هفته (هزار تومان)', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'امتیاز سلامت مالی هفته', type: 'score', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [6] } },
        { title: 'ثبت حساب روز', repeat: 'daily', dueTime: '21:00', reminderMinutes: 15 },
      ],
    },
  ],
};

/* ---------------- بسته ۳ — دانشجو و کنکور (بازطراحی kit-student) ---------------- */

const KIT_STUDENT: JobPackDef = {
  id: 'kit-student',
  emoji: '🎓',
  title: 'بسته‌ی دانشجو و کنکور',
  subtitle: 'چرخه‌ی مطالعه، مرور، آزمون هفتگی و سلامت — با اعداد و یادآور شروع',
  cta: 'فعال‌سازی بسته',
  lists: [
    {
      name: 'برنامه مطالعه امروز',
      emoji: '📚',
      color: 'indigo',
      guide: 'مطالعه‌ی روزانه با اعداد — یادآور «شروع مطالعه» ساعت ۱۶:۰۰ زنگ می‌زند (قابل تغییر از جزئیات همان کار).',
      items: [
        { title: 'شروع مطالعه', repeat: 'daily', dueTime: '16:00', reminderMinutes: 15 },
        { title: 'مطالعه‌ی درس اصلی امروز (حداقل ۲ بلوک ۵۰دقیقه‌ای)', repeat: 'daily' },
        { title: 'تعداد تست تایم‌دار امروز', type: 'num', repeat: 'daily' },
        { title: 'مرور ابینگهاوس (مطالب ۱/۷/۳۰ روز قبل)', repeat: 'daily' },
        { title: 'کارت‌های لایتنر مرور شد', repeat: 'daily' },
        { title: 'ساعت مطالعه‌ی مؤثر امروز', type: 'num', repeat: 'daily' },
      ],
    },
    {
      name: 'مرور و جمع‌بندی',
      emoji: '🔁',
      color: 'teal',
      guide: 'تثبیت آموخته‌های امروز — خلاصه‌نویسی و رفع اشکال قبل از خواب.',
      items: [
        { title: 'خلاصه‌نویسی نکات درس جدید', repeat: 'daily' },
        { title: 'رفع اشکال سوال‌های دشوار امروز', repeat: 'daily' },
        { title: 'یک نکته برای مرور آخر', type: 'note', repeat: 'daily' },
      ],
    },
    {
      name: 'آزمون و تحلیل',
      emoji: '📝',
      color: 'rose',
      guide: 'آزمون هفتگی و تحلیل خطا — پیش‌فرض پنجشنبه‌ها با یادآور ۸:۰۰ صبح (قابل تغییر از جزئیات همان کار).',
      items: [
        { title: 'شروع آزمون هفتگی', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] }, dueTime: '08:00', reminderMinutes: 30 },
        { title: 'آزمون این هفته برگزار شد', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] } },
        { title: 'درصد/نمره‌ی آزمون', type: 'num', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] } },
        { title: 'تحلیل خطاها انجام شد', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] } },
        { title: 'درسی که هفته‌ی بعد ترمیم می‌شود', type: 'note', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] } },
        { title: 'امتیاز نظم مطالعه‌ی این هفته', type: 'score', repeat: 'custom', repeatMeta: { every: 1, unit: 'week', days: [5] } },
      ],
    },
    {
      name: 'سلامت و انرژی',
      emoji: '🌿',
      color: 'emerald',
      guide: 'بدون خواب و حرکت، برنامه‌ی مطالعه دوام نمی‌آورد — چهار چک روزانه‌ی ساده.',
      items: [
        { title: 'خواب کافی (حداقل ۷ ساعت)', repeat: 'daily' },
        { title: 'حرکت یا ورزش کوتاه', repeat: 'daily' },
        { title: 'استراحت چشم بین بلوک‌ها رعایت شد', repeat: 'daily' },
        { title: 'حالم امروز چطور بود؟', type: 'score', repeat: 'daily' },
      ],
    },
  ],
};

/** کاتالوگ بسته‌های شغلی — فقط همین سه (ترتیب نمایش) */
export const JOB_PACKS: JobPackDef[] = [KIT_FREELANCE, KIT_STORE, KIT_STUDENT];

/* ---------------- توابع کمکی خالص ---------------- */

/** کلید لیست i-ام بسته — «kit-freelance.2» */
export function packListKey(packId: string, index: number): string {
  return templateListKey(packId, index);
}

/** لیست‌های بسته به ترتیب تعریف — جاهای پیدا نشده undefined (تشخیص کلید-اول + فال‌بک نامی) */
export function findPackLists(lists: ListEntity[], pack: JobPackDef): (ListEntity | undefined)[] {
  return findTemplateLists(lists, pack.lists, (i) => packListKey(pack.id, i));
}

/** بسته فعال است اگر همه‌ی لیست‌هایش موجود باشند (قاعده‌ی سینک‌پذیر بین دستگاه‌ها) */
export function isPackActive(lists: ListEntity[], pack: JobPackDef): boolean {
  return isTemplateActive(lists, pack.lists, (i) => packListKey(pack.id, i));
}

/** تعداد کل آیتم‌های بسته (برای پیش‌نمایش) */
export function packItemCount(pack: JobPackDef): number {
  return pack.lists.reduce((sum, l) => sum + l.items.length, 0);
}
