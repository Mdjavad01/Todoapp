/**
 * v1.9 — منطق خالص «حساب و داده‌های من» — جدا از UI تا قابل تست مستقیم باشد.
 */

/** متن تأیید حذف حساب — یکسان با سمت سرور (AccountDeletion::CONFIRM_TEXT) */
export const ACCOUNT_DELETE_CONFIRM_TEXT = 'حذف حساب';

/**
 * اعتبارسنجی متن تأیید حذف حساب (همان قاعده‌ی سمت سرور):
 *  - فاصله‌های ابتدا/انتها نادیده
 *  - «ي» عربی با «ی» فارسی یکسان
 *  - مقایسه‌ی بدون حساسیت به بزرگی/کوچکی
 */
export function isConfirmTextValid(input: string, expected: string = ACCOUNT_DELETE_CONFIRM_TEXT): boolean {
  const normalize = (v: string) => v.trim().replace(/ي/g, 'ی').toLowerCase();
  return input.length > 0 && normalize(input) === normalize(expected);
}

/** کلید pref بنر مهمان (یک‌بار برای همیشه — نه روزانه) */
export const GUEST_NOTICE_PREF = 'guest-data-notice-dismissed';

/** تصمیم خالص نمایش بنر مهمان: فقط مهمانِ واقعی و بنابر-dismiss نشده */
export function shouldShowGuestBanner(
  session: { userUuid?: string } | null | undefined,
  dismissed: boolean,
): boolean {
  return !session && !dismissed;
}
