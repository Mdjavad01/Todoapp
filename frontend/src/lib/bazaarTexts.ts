/**
 * کارام — v1.12.1: صداقت متن‌های «پرو» در بیلد بازار
 *
 * این فایل = شاخه‌ی «latest» (بیلد کامل با پرداخت — سایت و karam-latest.apk).
 * در بیلد بازار، vite (vite.config.ts → alias وقتی VITE_PAYMENTS_BUILD=off) همین
 * ماژول را به‌طور فیزیکی با `bazaarTexts.bazaar.ts` (شاخه‌ی صادقانه‌ی بدون پرداخت)
 * جابه‌جا می‌کند — همان مکانیزم ثابت‌شده‌ی alias صفحه‌ی پی‌وال (PaywallView.bazaar).
 * نتیجه: متن‌های پرداخت‌دار این فایل هرگز وارد باندل بازار نمی‌شوند.
 *
 * قرارداد (تست قراردادی: tests/bazaar-trust.test.ts):
 *   - هر دو ماژول دقیقاً همین فهرست export را دارند (هم‌نام) — این قرارداد را هیچ‌کدام نشکند.
 *   - شاخه‌ی bazaar هرگز «درگاه/کارت‌به‌کارت/ارتقا به کارام پرو/زیبال» ندارد.
 *   - شاخه‌ی latest (این فایل) رفتار قبلی را عیناً حفظ می‌کند (پینِ تست).
 */

/** false — این ماژول فقط در بیلد کامل (پرداخت‌دار) بسته می‌شود */
export const BAZAAR_BUILD: boolean = false;

/** کارت بالای تنظیمات — عنوان برای غیرپرو (SettingsView) */
export const settingsProCardTitle: string = 'ارتقا به کارام پرو';
/** کارت بالای تنظیمات — aria برای غیرپرو (SettingsView) */
export const settingsProCardAria: string = 'ارتقا به کارام پرو';
/** CTA قفل بسته‌های شغلی (TemplatesView — PackCard) و چک‌لیست تریدر (TraderCard) */
export const unlockCta: string = 'بازکردن با کارام پرو';
/** زیرعنوان سربرگ صفحه‌ی قالب‌ها (TemplatesView) */
export const templatesSubtitle: string =
  'چک‌لیست‌های آماده برای شروع سریع — رایگان‌ها برای همه؛ فعال‌سازی بسته‌های پرو مخصوص کارام پرو';
/** عنوان بخش بسته‌های تخصصی (TemplatesView) */
export const proSectionTitle: string = 'مخصوص کارام پرو';
/** چیپ سطح بسته‌ی شغلی (TemplatesView — PackCard؛ تریدر چیپ خودش را دارد: «پرو/رایگان») */
export const packTierChip: string = 'پرو';
/** جمله‌ی پیش‌نمایش فقط‌خواندنی چک‌لیست تریدر (TraderCard — شاخه‌ی قفل) */
export const traderLockedNote: string =
  'محتوای هر ۵ لیست بالا را کامل می‌بینید — فعال‌سازی چک‌لیست تریدر (با یادآور سشن) مخصوص کارام پرو است.';
/** توضیح کارت قفل «تحلیل عمقی» (AnalyticsView) */
export const deepAnalyticsLockNote: string = 'مخصوص کاربران نسخه پرو کارام';
/** لیبل دکمه‌ی هم‌رسانی کد دعوت در تلگرام (AccountSheet) */
export const referralShareLabel: string = 'اشتراک';
/** aria دکمه‌ی هم‌رسانی کد دعوت در تلگرام (AccountSheet) */
export const referralShareAria: string = 'اشتراک کد دعوت در تلگرام';
/** بند ۳ قوانین درون‌اپ (TermsSheet) */
export const rulesSubscription: string =
  'اشتراک پرو دوره‌ای است؛ در پایان دوره اگر تمدید نکنید، اپ به نسخه‌ی رایگان برمی‌گردد ولی هیچ داده‌ای حذف نمی‌شود.';
/** بند ۴ قوانین درون‌اپ (TermsSheet) */
export const rulesPayment: string =
  'پرداخت از درگاه بانکی یا کارت‌به‌کارت (با تأیید ادمین) است؛ وضعیت هر پرداخت در صفحه‌ی پرو قابل پیگیری است.';
/** خط پشتیبانی (TermsSheet) */
export const supportIntro: string =
  'مشکل در پرداخت، حذف حساب یا هر سؤال دیگر؟ از همین راه‌ها پیام بدهید؛ سریع جواب می‌گیرید.';
