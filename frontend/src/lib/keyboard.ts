/**
 * کارام — مکانیزم جهانی «پنجره‌ها زیر کیبورد نروند» (v15)
 *
 * مسئله: در موبایل وقتی کیبورد باز می‌شود، ویوپورتِ بصری کوچک می‌شود ولی
 * لایه‌ی چیدمان همان اندازه می‌ماند؛ نتیجه: بات‌شیت‌ها و فرم‌های پایین‌چسب
 * پشت کیبورد پنهان می‌شوند.
 *
 * راه‌حل سه‌لایه:
 *  ۱) ارتفاع کیبورد لحظه‌ای در متغیر CSS سراسری --kb-height روی <html> ست می‌شود
 *     (از visualViewport — روی iOS و همه‌ی مرورگرها کار می‌کند)
 *  ۲) Sheet.tsx و هر پنجره‌ی پایین‌چسب با padding-bottom: var(--kb-height) بالا کشیده می‌شوند
 *  ۳) متای viewport با interactive-widget=resizes-content در اندروید کروم خودِ
 *     لایه‌ی چیدمان هم کوچک می‌شود (این ماژول آن حالت را هم پوشش می‌دهد: کیبورد = ۰)
 */

let started = false;

export function initKeyboardAwareness(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  const vv = window.visualViewport;
  if (!vv) return; // مرورگر خیلی قدیمی — مرورگر خودش اسکرول می‌کند

  const update = () => {
    // ارتفاع کیبورد = ارتفاع لایه‌ی چیدمان − بخش دیده‌شده‌ی ویوپورت بصری
    const kb = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
    const root = document.documentElement;
    if (kb > 0) {
      root.style.setProperty('--kb-height', `${kb}px`);
      document.body.classList.add('kb-open');
    } else {
      root.style.setProperty('--kb-height', '0px');
      document.body.classList.remove('kb-open');
    }
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', update);
  update();
}
