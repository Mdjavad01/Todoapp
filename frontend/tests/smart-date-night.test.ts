/**
 * کارام — تست واحد «ساعت محاوره‌ای» (v1.13.1 / v17 — قفل قرارداد پارسر تاریخ هوشمند)
 *
 * اجرا:  cd frontend && bun test tests/smart-date-night.test.ts
 *
 * چرا: باگ گزارش مالک — «فردا ساعت 10 شب» به‌جای ۲۲:۰۰ روی ۱۰:۰۰ می‌نشست
 * و «ده شب» اصلاً تشخیص داده نمی‌شد. این فایل قرارداد v17 (پیاده‌سازی رسمی
 * روی main) را قفل می‌کند: بخش روز (شب: ۱۲→۰۰ و ۱..۴→بامداد و ۵..۱۱→+۱۲)،
 * اعداد حروفی، «و نیم/و ربع»، «امشب» فقط با ساعت صریح، و دفاع واژه‌ای.
 * اکنون مرجع: دوشنبه ۲۰۲۶-۱۱-۰۹ ساعت ۱۵:۰۰ (ثابت و قطعی).
 */

import { describe, expect, it } from 'bun:test';
import { detectSmartDate } from '../src/lib/smartDate';

/** دوشنبه ۹ نوامبر ۲۰۲۶ — ۱۵:۰۰ */
const NOW = new Date(2026, 10, 9, 15, 0, 0);
const TODAY = '2026-11-09';
const TOMORROW = '2026-11-10';
const PASAFARDA = '2026-11-11';
const JOME = '2026-11-13'; // جمعه‌ی همین هفته از دوشنبه

describe('ساعت محاوره‌ای — بخش روز (شب/صبح/ظهر/عصر)', () => {
  it('«فردا ساعت 10 شب» → ۲۲:۰۰ (باگ اصلی مالک)', () => {
    const h = detectSmartDate('فردا ساعت 10 شب خرید نان', NOW);
    expect(h).not.toBeNull();
    expect(h!.dueDate).toBe(TOMORROW);
    expect(h!.dueTime).toBe('22:00');
    expect(h!.cleanTitle).toBe('خرید نان');
  });

  it('«فردا ساعت ۱۰ شب» با ارقام فارسی هم ۲۲:۰۰', () => {
    const h = detectSmartDate('فردا ساعت ۱۰ شب خرید نان', NOW);
    expect(h!.dueTime).toBe('22:00');
  });

  it('«ده شب» — عدد حروفی بدون واژه‌ی ساعت', () => {
    const h = detectSmartDate('ده شب تماس با علی', NOW);
    expect(h!.dueDate).toBe(TODAY);
    expect(h!.dueTime).toBe('22:00');
    expect(h!.cleanTitle).toBe('تماس با علی');
  });

  it('«یازده شب دارو» → ۲۳:۰۰', () => {
    const h = detectSmartDate('یازده شب دارو', NOW);
    expect(h!.dueTime).toBe('23:00');
  });

  it('«ساعت ۱۲ شب» → ۰۰:۰۰ (نیمه‌شب)', () => {
    const h = detectSmartDate('ساعت ۱۲ شب زنگ امنیتی', NOW);
    expect(h!.dueTime).toBe('00:00');
  });

  it('«فردا ساعت ۷ صبح ورزش» → ۰۷:۰۰', () => {
    const h = detectSmartDate('فردا ساعت ۷ صبح ورزش', NOW);
    expect(h!.dueDate).toBe(TOMORROW);
    expect(h!.dueTime).toBe('07:00');
  });

  it('«یازده صبح جلسه» → ۱۱:۰۰ (صبح تغییر نمی‌کند)', () => {
    const h = detectSmartDate('یازده صبح جلسه', NOW);
    expect(h!.dueTime).toBe('11:00');
  });

  it('«پس‌فردا ظهر ناهار با تیم» — تاریخ می‌گیرد، بدون ساعت صریح ساعت نمی‌گیرد (v17)', () => {
    const h = detectSmartDate('پس‌فردا ظهر ناهار با تیم', NOW);
    expect(h!.dueDate).toBe(PASAFARDA);
    expect(h!.dueTime).toBeNull();
    expect(h!.cleanTitle).toBe('ظهر ناهار با تیم');
  });

  it('«فردا 9 عصر پیوی» → ۲۱:۰۰', () => {
    const h = detectSmartDate('فردا 9 عصر پیوی', NOW);
    expect(h!.dueDate).toBe(TOMORROW);
    expect(h!.dueTime).toBe('21:00');
  });
});

describe('«و نیم» و «و ربع»', () => {
  it('«ساعت ۹ و ربع جلسه اسکرام» → ۰۹:۱۵', () => {
    const h = detectSmartDate('ساعت ۹ و ربع جلسه اسکرام', NOW);
    expect(h!.dueTime).toBe('09:15');
    expect(h!.cleanTitle).toBe('جلسه اسکرام');
  });

  it('«7 و نیم شب پیوی» → ۱۹:۳۰ (بدون واژه‌ی ساعت)', () => {
    const h = detectSmartDate('7 و نیم شب پیوی', NOW);
    expect(h!.dueTime).toBe('19:30');
    expect(h!.cleanTitle).toBe('شب پیوی');
  });

  it('«ساعت ده و نیم شب مطالعه» → ۲۲:۳۰', () => {
    const h = detectSmartDate('ساعت ده و نیم شب مطالعه', NOW);
    expect(h!.dueTime).toBe('22:30');
  });

  it('«۷ و نیم کیلو بدو» ساعت نمی‌گیرد (بدون بخش روز)', () => {
    const h = detectSmartDate('فردا 7 و نیم کیلو بدو', NOW);
    expect(h).not.toBeNull(); // فقط «فردا» تشخیص داده می‌شود
    expect(h!.dueDate).toBe(TOMORROW);
    expect(h!.dueTime).toBeNull();
    expect(h!.cleanTitle).toBe('7 و نیم کیلو بدو');
  });
});

describe('«امشب» و بخش روز بدون ساعت صریح', () => {
  it('«امشب تماس با مدیر» → امروز ۲۱:۰۰', () => {
    const h = detectSmartDate('امشب تماس با مدیر', NOW);
    expect(h!.dueDate).toBe(TODAY);
    expect(h!.dueTime).toBeNull();
    expect(h!.cleanTitle).toBe('تماس با مدیر');
  });

  it('«امشب ساعت ۱۰ گزارش» → ۲۲:۰۰ (ارث‌بردی بخش روز)', () => {
    const h = detectSmartDate('امشب ساعت ۱۰ گزارش', NOW);
    expect(h!.dueTime).toBe('22:00');
  });

  it('«فردا صبح گزارش هفتگی» — فردا بدون ساعت صریح', () => {
    const h = detectSmartDate('فردا صبح گزارش هفتگی', NOW);
    expect(h!.dueDate).toBe(TOMORROW);
    expect(h!.dueTime).toBeNull();
    // v17 — پاک‌سازی عبارت ساعت فقط وقتی ساعت واقعاً تشخیص داده شده؛ «صبح» می‌ماند
    expect(h!.cleanTitle).toBe('صبح گزارش هفتگی');
  });

  it('«جمعه شب قرار ورزشی» — جمعه بدون ساعت صریح', () => {
    const h = detectSmartDate('جمعه شب قرار ورزشی', NOW);
    expect(h!.dueDate).toBe(JOME);
    expect(h!.dueTime).toBeNull();
    expect(h!.cleanTitle).toBe('شب قرار ورزشی');
  });

  it('بخش روز تنها بدون تاریخ — ساعت پیش‌فرض نمی‌گیرد (دفاع واژه‌ای)', () => {
    // «دارو صبح و شام» بدون هیچ تاریخ دیگری — بی‌صدا رد می‌شود تا عنوان‌های
    // معمولی ناخواسته ساعت نگیرند (قرارداد v17: ساعت فقط از متن)
    const h = detectSmartDate('دارو صبح و شام', NOW);
    expect(h).toBeNull();
  });
});

describe('رفتارهای قبلی دست‌نخورده (رگرسیون)', () => {
  it('«ساعت 17 کلاس آنلاین» → ۱۷:۰۰ (بدون بخش روز، ساعت بزرگ)', () => {
    const h = detectSmartDate('ساعت 17 کلاس آنلاین', NOW);
    expect(h!.dueTime).toBe('17:00');
  });

  it('«فردا ساعت ۱۷» → ۱۷:۰۰', () => {
    const h = detectSmartDate('فردا ساعت ۱۷ تمرین', NOW);
    expect(h!.dueDate).toBe(TOMORROW);
    expect(h!.dueTime).toBe('17:00');
  });

  it('«2 هفته بعد سفر شمال» → ۱۴ روز بعد، بدون ساعت', () => {
    const h = detectSmartDate('2 هفته بعد سفر شمال', NOW);
    expect(h!.dueDate).toBe('2026-11-23');
    expect(h!.dueTime).toBeNull();
    expect(h!.cleanTitle).toBe('سفر شمال');
  });

  it('«10:30 شب» با فرمت دو نقطه → ۲۲:۳۰', () => {
    const h = detectSmartDate('10:30 شب تماس', NOW);
    expect(h!.dueTime).toBe('22:30');
  });

  it('«ساعت 9:30 جلسه» مثل قبل → ۰۹:۳۰', () => {
    const h = detectSmartDate('ساعت 9:30 جلسه', NOW);
    expect(h!.dueTime).toBe('09:30');
  });

  it('«25 مهر جلسه» — تاریخ شمسی سالم', () => {
    const h = detectSmartDate('25 مهر جلسه', NOW);
    expect(h).not.toBeNull();
    expect(h!.dueTime).toBeNull();
    expect(h!.cleanTitle).toBe('جلسه');
  });
});

describe('دفاع واژه‌ای — تشخیص اشتباه ممنوع', () => {
  it('«صبحانه سرِ میز» هیچ چیزی تشخیص نمی‌دهد', () => {
    expect(detectSmartDate('صبحانه سرِ میز', NOW)).toBeNull();
  });

  it('«شب‌گردی جنگل» (نیم‌فاصله) هیچ چیزی تشخیص نمی‌دهد', () => {
    expect(detectSmartDate('شب‌گردی جنگل', NOW)).toBeNull();
  });

  it('«عصرها مطالعه» (جمع) ساعت پیش‌فرض نمی‌گیرد', () => {
    expect(detectSmartDate('عصرها مطالعه', NOW)).toBeNull();
  });
});


describe('قرارداد اختصاصی شب در v17 و اعداد محاوره‌ای', () => {
  it('«دو شب» → ۰۲:۰۰ بامداد (قاعده‌ی ۱..۴ شب = بامداد)', () => {
    const h = detectSmartDate('دو شب چک سرور', NOW);
    expect(h!.dueTime).toBe('02:00');
  });

  it('«امشب ساعت ۹:۳۰ فیلم» → ۲۱:۳۰ (مثال سند v17)', () => {
    const h = detectSmartDate('امشب ساعت ۹:۳۰ فیلم', NOW);
    expect(h!.dueDate).toBe(TODAY);
    expect(h!.dueTime).toBe('21:30');
  });

  it('«یه ساعت دیگه یادم بنداز» → اکنون + ۱ ساعت و پاک‌سازی عدد حروفی از عنوان', () => {
    const h = detectSmartDate('یه ساعت دیگه یادم بنداز', NOW);
    expect(h!.dueTime).toBe('16:00'); // اکنون ۱۵:۰۰
    expect(h!.cleanTitle).toBe('یادم بنداز');
  });

  it('«ساعت یه صبح تماس» → ۰۱:۰۰ («یه» = یک)', () => {
    const h = detectSmartDate('ساعت یه صبح تماس', NOW);
    expect(h!.dueTime).toBe('01:00');
  });
});
