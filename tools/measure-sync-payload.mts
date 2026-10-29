/**
 * کارام — اندازه‌گیری حجم/زمان سینک با داده‌ی مصنوعی (فقط گزارش PROJECT-QA؛ جزو کد اجرایی نیست)
 *
 * چه چیزی اندازه می‌گیرد:
 *  ۱) حجم JSON خروجی pull برای ۱۰۰۰ / ۵۰۰۰ / ۲۰۰۰۰ کار (شکل رکورد = همان فیلدهایی که
 *     Entities::toClient به کلاینت می‌فرستد و کلاینت در push می‌فرستد).
 *  ۲) تعداد درخواست pull با PULL_LIMIT=800 سرور (backend/src/Services/SyncService.php:38) و
 *     حجم هر چانک push با سقف ۵۰۰ آیتم (api_max_sync_items پیش‌فرض ۲۰۰۰، کلاینت ۵۰۰ — engine.ts:62-72).
 *  ۳) حجم gzip (HTTP معمولاً فشرده می‌کند — در هاست باید http Compression فعال باشد؛ INSTALL.md:206-210).
 *  ۴) زمان انتقال برآوردی در پهنای‌باند ۲ و ۸ مگابیت + تأخیر ۸۰ms هر درخواست.
 *  ۵) برآورد فضای محلی کلاینت (IndexedDB ≈ ۱.۲ برابر JSON — برآورد متعارف، نه اندازه‌گیری).
 *
 * اجرا: bun tools/measure-sync-payload.mts
 */

import { gzipSync } from 'node:zlib';

const TITLE_WORDS = [
  'بازبینی قیمت سهم', 'تماس با مشتری', 'ارسال فاکتور', 'جلسه هفتگی تیم', 'پیگیری سفارش',
  'به‌روزرسانی موجودی', 'چک کردن ایمیل‌ها', 'تمرین انگلیسی', 'خرید مواد غذایی', 'پرداخت قبض برق',
];
const NOTE = 'با آقای رضایی هماهنگ شود و نتیجه در گروه اعلام گردد؛ مستندات در پوشه پروژه است.';
const PULL_LIMIT = 800; // SyncService.php:38
const PUSH_CHUNK = 500; // engine.ts:62-72 (پیش‌فرض کلاینت)

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const iso = (d: Date) => d.toISOString();

// رکورد کار — دقیقاً فیلدهای مسیر سینک (Entities::normalize / toClient و lww.ts)
function makeTask(i: number, rnd: () => number) {
  const hasNotes = rnd() < 0.55;
  const hasRem = rnd() < 0.4;
  const due = new Date(Date.UTC(2026, 9, 28) + Math.floor((rnd() - 0.5) * 60 * 86400_000));
  return {
    id: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }),
    listId: 'list-' + (i % 8),
    title: TITLE_WORDS[i % TITLE_WORDS.length] + ' #' + i,
    notes: hasNotes ? NOTE : null,
    priority: ['normal', 'high', 'low', 'urgent'][Math.floor(rnd() * 4)],
    dueDate: rnd() < 0.8 ? due.toISOString().slice(0, 10) : null,
    dueTime: rnd() < 0.5 ? due.toISOString().slice(11, 19) : null,
    reminderMinutes: hasRem ? [10, 30, 60, 1440][Math.floor(rnd() * 4)] : null,
    repeat: rnd() < 0.15 ? 'daily' : 'none',
    starred: rnd() < 0.1,
    repeatMeta: null,
    completedAt: rnd() < 0.35 ? iso(due) : null,
    createdAt: iso(new Date(Date.UTC(2026, 6, 1))),
    updatedAt: iso(new Date(Date.UTC(2026, 9, 20))),
    deletedAt: null,
    rev: 1 + Math.floor(rnd() * 5),
    revDevice: 'd-' + Math.random().toString(36).slice(2, 14),
  };
}
function makeSub(i: number, rnd: () => number) {
  return {
    id: crypto.randomUUID(),
    taskId: 'task-' + i,
    title: 'زیرکار ' + (i % 3 + 1),
    done: rnd() < 0.4,
    sortOrder: i % 3,
    createdAt: iso(new Date(Date.UTC(2026, 6, 1))),
    updatedAt: iso(new Date(Date.UTC(2026, 9, 20))),
    deletedAt: null,
    rev: 1,
    revDevice: 'd-' + Math.random().toString(36).slice(2, 14),
  };
}

function kb(b: number) {
  return (b / 1024).toFixed(1) + ' KB';
}
function transferSeconds(bytes: number, mbps: number, reqs: number, latencyMs = 80) {
  return bytes * 8 / (mbps * 1024 * 1024) + (reqs * latencyMs) / 1000;
}

// سناریوها: کل داده‌ی کاربر (tasks + subtasks متناسب) — متناسب با پروفایل‌های گزارش DB
const scenarios: Array<{ name: string; tasks: number; subRatio: number }> = [
  { name: 'سبک — ۳۰ کار', tasks: 30, subRatio: 0.5 },
  { name: 'متوسط — ۳۰۰ کار', tasks: 300, subRatio: 1.5 },
  { name: 'سنگین — ۱٬۰۰۰ کار', tasks: 1000, subRatio: 2 },
  { name: 'خیلی سنگین — ۵٬۰۰۰ کار', tasks: 5000, subRatio: 2 },
  { name: 'حد نهایی — ۲۰٬۰۰۰ کار', tasks: 20000, subRatio: 2 },
];

console.log('=== حجم pull اول (کل داده‌ی کاربر — بدون کرسر) با PULL_LIMIT=' + PULL_LIMIT + ' ===');
console.log('سناریو | رکوردها | JSON خام | gzip | درخواست‌ها | @۲Mbps | @۸Mbps');
for (const sc of scenarios) {
  const rnd = makeRng(7 + sc.tasks);
  const tasks = Array.from({ length: sc.tasks }, (_, i) => makeTask(i, rnd));
  const subs = Array.from({ length: Math.round(sc.tasks * sc.subRatio) }, (_, i) => makeSub(i, rnd));
  const lists = Math.max(1, Math.round(sc.tasks / 40));
  const payload = {
    applied: { lists: 0, tasks: 0, subtasks: 0 }, rejected: [],
    server: {
      lists: Array.from({ length: lists }, (_, i) => ({ id: 'list-' + i, name: 'لیست ' + (i + 1), emoji: '💼', color: 'teal', sortOrder: i, deletedAt: null, createdAt: iso(new Date(Date.UTC(2026, 6, 1))), updatedAt: iso(new Date(Date.UTC(2026, 9, 20))), rev: 1, revDevice: 'd0' })),
      tasks, subtasks: subs,
    },
    cursor: '2026-10-28T12:00:00.000Z', serverTime: '2026-10-28T12:00:00.000Z',
    incomplete: false, clockSkew: [], pageCursor: null,
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const gz = gzipSync(json);
  const records = tasks.length + subs.length + lists;
  // pull صفحه‌بندی‌شده: هر موجودیت سقف ۸۰۰ در هر درخواست
  const pullReqs = Math.max(
    Math.ceil(tasks.length / PULL_LIMIT),
    Math.ceil(subs.length / PULL_LIMIT),
    Math.ceil(lists / PULL_LIMIT),
  );
  const t2 = transferSeconds(json.length, 2, pullReqs);
  const t8 = transferSeconds(json.length, 8, pullReqs);
  console.log(
    `${sc.name} | ${records.toLocaleString('fa-IR')} | ${kb(json.length)} | ${kb(gz.length)} | ${pullReqs} | ${t2.toFixed(1)}s | ${t8.toFixed(1)}s`,
  );
}

console.log('\n=== حجم push دسته‌ای (چانک ' + PUSH_CHUNK + ' آیتمی — تغییرات محلی) ===');
{
  const rnd = makeRng(99);
  const chunk = Array.from({ length: PUSH_CHUNK }, (_, i) => {
    const t = makeTask(i, rnd);
    (t as any).updatedAt = iso(new Date()); // همه «تغییر کرده»
    return t;
  });
  const json = Buffer.from(JSON.stringify({ changes: { lists: [], tasks: chunk, subtasks: [] }, cursor: '', pull: 0, deviceUuid: 'd-test' }), 'utf8');
  const gz = gzipSync(json);
  console.log(`چانک ۵۰۰ کار (۱۰۰٪ تغییر): ${kb(json.length)} JSON | ${kb(gz.length)} gzip | درخواست‌های لازم برای ۱٬۰۰۰ کار: ${Math.ceil(1000 / PUSH_CHUNK)}`);
  console.log(`زمان آپلود چانک @۱Mbps (پهنای‌باند آپلود ضعیف): ${transferSeconds(json.length, 1, 1).toFixed(1)}s`);
}

console.log('\n=== برآورد فضای محلی کلاینت (IndexedDB) ===');
{
  const rnd = makeRng(5);
  const one = makeTask(1, rnd);
  const bytesPerTask = Buffer.from(JSON.stringify(one), 'utf8').length;
  const oneSub = makeSub(1, rnd);
  const bytesPerSub = Buffer.from(JSON.stringify(oneSub), 'utf8').length;
  for (const n of [30, 300, 1000, 5000]) {
    const jsonBytes = n * bytesPerTask + n * 2 * bytesPerSub;
    console.log(`${n.toLocaleString('fa-IR')} کار (+۲ زیرکار): JSON ${kb(jsonBytes)} → IndexedDB ≈ ${kb(jsonBytes * 1.2)} (برآورد ×۱.۲)`);
  }
}
console.log('\nنکته: این اندازه‌گیری «حجم انتقال» است؛ زمان CPU سرور نیازمند بنچ واقعی روی هاست است (نیاز به تست دستی).');
