/**
 * کارام — اندازه‌گیری حجم دیتابیس با داده‌ی مصنوعی (فقط برای گزارش PROJECT-QA؛ جزو کد اجرایی نیست)
 *
 * روش:
 *  - اسکیمای SQLite مطابق deploy/install.sqlite.sql (آینه‌ی MySQL هاست).
 *  - جداول بدون ایندکس ثانویه ساخته می‌شوند → درج داده → اندازه‌ی فایل → ساخت ایندکس‌ها یکی‌یکی
 *    و اندازه‌گیری تفاضلی حجم هر ایندکس (روش قطعی و مستقل از dbstat).
 *  - همه‌ی اعداد «بایت فایل SQLite» هستند؛ اعداد MySQL ممکن است حدود ±۲۰٪ متفاوت باشد.
 *  - dbstat (اگر در بیلد SQLite موجود باشد) اندازه‌ی دقیق هر جدول را هم می‌دهد.
 *
 * اجرا:
 *   bun tools/measure-db-size.mts run --users 1000 --profile medium --label S2
 *   bun tools/measure-db-size.mts estimate   ← برون‌یابی خطی سناریوهای سنگین از نتایج واقعی
 *
 * خروجی: tools/measurements/results.jsonl + چاپ خلاصه در stdout
 */

import { Database } from 'bun:sqlite';
import { statSync, mkdirSync, rmSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const OUT_DIR = new URL('./measurements/', import.meta.url).pathname;
const TMP_DB = OUT_DIR + 'tmp-karam.sqlite3';

type Profile = { tasks: number; subRatio: number; remRatio: number };
const PROFILES: Record<string, Profile> = {
  light: { tasks: 30, subRatio: 0.5, remRatio: 0.3 },
  medium: { tasks: 300, subRatio: 1.5, remRatio: 0.4 },
  heavy: { tasks: 1000, subRatio: 2.0, remRatio: 0.5 },
};

// ---------- داده‌ی مصنوعی فارسی (طول واقع‌گرا) ----------
const TITLE_WORDS = [
  'بازبینی قیمت سهم', 'تماس با مشتری', 'ارسال فاکتور', 'جلسه هفتگی تیم', 'پیگیری سفارش',
  'به‌روزرسانی موجودی', 'چک کردن ایمیل‌ها', 'تمرین انگلیسی', 'خرید مواد غذایی', 'پرداخت قبض برق',
  'مطالعه ۳۰ دقیقه', 'تمرین ورزشی', 'بازدید انبار', 'جوابگوی پیام‌ها', 'برنامه‌ریزی هفته',
];
const NOTE_WORDS = [
  'با آقای رضایی هماهنگ شود و نتیجه در گروه اعلام گردد.',
  'اولویت با سفارش‌های این هفته است؛ اگر جواب نداد پیگیری تلفنی انجام شود.',
  'مستندات قبلی در پوشه‌ی پروژه ذخیره شده است؛ قبل از شروع مطالعه شود.',
  'بودجه‌ی تاییدشده حدود دو میلیون تومان است؛ فاکتور رسمی نیاز است.',
  'یادآوری: جلسه در اتاق دوم برگزار می‌شود و گزارش قبل از جلسه ارسال گردد.',
];
const SUB_TITLE = (i: number, t: number) => `زیرکار ${i + 1} برای کار ${t}`;
function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const timeOnly = (d: Date) => d.toISOString().slice(11, 16) + ':00';
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

// ---------- اسکیما (بدون ایندکس ثانویه؛ UNIQUE ها هم بعداً ساخته می‌شوند) ----------
const DDL = `
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, display_name TEXT(100), gender TEXT(16) NOT NULL DEFAULT 'unset', status TEXT(16) NOT NULL DEFAULT 'active', premium_until TEXT(19), last_login_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE user_identities (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT(16) NOT NULL, value TEXT(190) NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, verified_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE otp_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, identity_type TEXT(16) NOT NULL, identity_value TEXT(190) NOT NULL, code_hash TEXT(255) NOT NULL, purpose TEXT(16) NOT NULL DEFAULT 'login', attempts INTEGER NOT NULL DEFAULT 0, ip TEXT(45), expires_at TEXT(19) NOT NULL, consumed_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE refresh_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_id TEXT(36) NOT NULL, device_name TEXT(120), token_hash TEXT(255) NOT NULL, user_agent TEXT(255), ip TEXT(45), issued_at TEXT(19) NOT NULL DEFAULT '', expires_at TEXT(19) NOT NULL, revoked_at TEXT(19), last_used_at TEXT(19));
CREATE TABLE lists (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, name TEXT(120) NOT NULL, emoji TEXT(16), color TEXT(16) NOT NULL DEFAULT 'teal', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, list_id INTEGER NOT NULL, title TEXT(255) NOT NULL, notes TEXT, priority TEXT(8) NOT NULL DEFAULT 'normal', due_date TEXT(10), due_time TEXT(8), reminder_minutes INTEGER, repeat TEXT(8) NOT NULL DEFAULT 'none', starred INTEGER NOT NULL DEFAULT 0, repeat_meta TEXT, completed_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');
CREATE TABLE subtasks (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, title TEXT(255) NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');
CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, fire_at TEXT(19) NOT NULL, fired_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19));
CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, plan_id INTEGER NOT NULL, coupon_id INTEGER, amount_tomans INTEGER NOT NULL, discount_tomans INTEGER NOT NULL DEFAULT 0, status TEXT(16) NOT NULL DEFAULT 'created', description TEXT(255), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, order_id INTEGER NOT NULL, gateway TEXT(16) NOT NULL, status TEXT(16) NOT NULL DEFAULT 'created', amount_tomans INTEGER NOT NULL, gateway_ref TEXT(190), verified_at TEXT(19), verify_payload TEXT, created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, plan_id INTEGER, order_id INTEGER, source TEXT(16) NOT NULL, starts_at TEXT(19) NOT NULL, expires_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT(8) NOT NULL DEFAULT 'admin', actor_id INTEGER, action TEXT(80) NOT NULL, entity TEXT(60), entity_id TEXT(64), details TEXT, ip TEXT(45), user_agent TEXT(255), created_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE provider_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT(20) NOT NULL, direction TEXT(8) NOT NULL DEFAULT 'out', status TEXT(12) NOT NULL, identity TEXT(190), subject TEXT(190), message TEXT(500), context TEXT, created_at TEXT(19) NOT NULL DEFAULT '');
`;

// ایندکس‌های ثانویه به ترتیب ساخت تفاضلی (نام → DDL)
const INDEXES: Array<[string, string]> = [
  ['uq_users_uuid', 'CREATE UNIQUE INDEX uq_users_uuid ON users (uuid)'],
  ['idx_users_status', 'CREATE INDEX idx_users_status ON users (status)'],
  ['idx_users_created', 'CREATE INDEX idx_users_created ON users (created_at)'],
  ['uq_identity', 'CREATE UNIQUE INDEX uq_identity ON user_identities (type, value)'],
  ['idx_identities_user', 'CREATE INDEX idx_identities_user ON user_identities (user_id)'],
  ['idx_otp_identity', 'CREATE INDEX idx_otp_identity ON otp_requests (identity_value, created_at)'],
  ['idx_otp_ip', 'CREATE INDEX idx_otp_ip ON otp_requests (ip, created_at)'],
  ['idx_otp_expires', 'CREATE INDEX idx_otp_expires ON otp_requests (expires_at)'],
  ['uq_refresh_hash', 'CREATE UNIQUE INDEX uq_refresh_hash ON refresh_tokens (token_hash)'],
  ['idx_refresh_user', 'CREATE INDEX idx_refresh_user ON refresh_tokens (user_id, revoked_at)'],
  ['idx_refresh_expires', 'CREATE INDEX idx_refresh_expires ON refresh_tokens (expires_at)'],
  ['uq_lists_uuid', 'CREATE UNIQUE INDEX uq_lists_uuid ON lists (uuid)'],
  ['idx_lists_user', 'CREATE INDEX idx_lists_user ON lists (user_id, deleted_at)'],
  ['idx_lists_applied', 'CREATE INDEX idx_lists_applied ON lists (user_id, applied_at)'],
  ['uq_tasks_uuid', 'CREATE UNIQUE INDEX uq_tasks_uuid ON tasks (uuid)'],
  ['idx_tasks_user', 'CREATE INDEX idx_tasks_user ON tasks (user_id, deleted_at)'],
  ['idx_tasks_list', 'CREATE INDEX idx_tasks_list ON tasks (list_id)'],
  ['idx_tasks_due', 'CREATE INDEX idx_tasks_due ON tasks (due_date)'],
  ['idx_tasks_applied', 'CREATE INDEX idx_tasks_applied ON tasks (user_id, applied_at)'],
  ['uq_subtasks_uuid', 'CREATE UNIQUE INDEX uq_subtasks_uuid ON subtasks (uuid)'],
  ['idx_subtasks_task', 'CREATE INDEX idx_subtasks_task ON subtasks (task_id)'],
  ['idx_subtasks_user', 'CREATE INDEX idx_subtasks_user ON subtasks (user_id, deleted_at)'],
  ['idx_subtasks_applied', 'CREATE INDEX idx_subtasks_applied ON subtasks (user_id, applied_at)'],
  ['uq_reminders_uuid', 'CREATE UNIQUE INDEX uq_reminders_uuid ON reminders (uuid)'],
  ['idx_reminders_fire', 'CREATE INDEX idx_reminders_fire ON reminders (fire_at, fired_at)'],
  ['idx_reminders_task', 'CREATE INDEX idx_reminders_task ON reminders (task_id)'],
  ['uq_orders_uuid', 'CREATE UNIQUE INDEX uq_orders_uuid ON orders (uuid)'],
  ['idx_orders_user', 'CREATE INDEX idx_orders_user ON orders (user_id, status)'],
  ['idx_orders_status', 'CREATE INDEX idx_orders_status ON orders (status, created_at)'],
  ['uq_payments_uuid', 'CREATE UNIQUE INDEX uq_payments_uuid ON payments (uuid)'],
  ['idx_payments_order', 'CREATE INDEX idx_payments_order ON payments (order_id)'],
  ['idx_payments_status', 'CREATE INDEX idx_payments_status ON payments (status)'],
  ['uq_subs_uuid', 'CREATE UNIQUE INDEX uq_subs_uuid ON subscriptions (uuid)'],
  ['idx_subs_user', 'CREATE INDEX idx_subs_user ON subscriptions (user_id, expires_at)'],
  ['idx_audit_created', 'CREATE INDEX idx_audit_created ON audit_logs (created_at)'],
  ['idx_audit_actor', 'CREATE INDEX idx_audit_actor ON audit_logs (actor_type, actor_id)'],
  ['idx_provider_logs', 'CREATE INDEX idx_provider_logs ON provider_logs (provider, created_at)'],
];

function fileSize(): number {
  return statSync(TMP_DB).size;
}

async function runScenario(users: number, profileName: string, label: string) {
  const prof = PROFILES[profileName];
  if (!prof) throw new Error('profile must be light|medium|heavy');
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(TMP_DB, { force: true });

  const t0 = Date.now();
  const db = new Database(TMP_DB);
  db.run('PRAGMA journal_mode = MEMORY');
  db.run('PRAGMA synchronous = OFF');
  db.run('PRAGMA page_size = 8192');
  db.run(DDL);
  db.run('BEGIN');
  const rnd = makeRng(42 + users);

  const insUser = db.prepare('INSERT INTO users (uuid, display_name, gender, status, premium_until, last_login_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
  const insIdentity = db.prepare('INSERT INTO user_identities (user_id, type, value, is_primary, verified_at, created_at) VALUES (?,?,?,?,?,?)');
  const insOtp = db.prepare('INSERT INTO otp_requests (identity_type, identity_value, code_hash, purpose, attempts, ip, expires_at, consumed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insToken = db.prepare('INSERT INTO refresh_tokens (user_id, device_id, device_name, token_hash, user_agent, ip, issued_at, expires_at, revoked_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insList = db.prepare('INSERT INTO lists (uuid, user_id, name, emoji, color, sort_order, created_at, updated_at, deleted_at, applied_at, rev, rev_device) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const insTask = db.prepare('INSERT INTO tasks (uuid, user_id, list_id, title, notes, priority, due_date, due_time, reminder_minutes, repeat, starred, repeat_meta, completed_at, created_at, updated_at, deleted_at, applied_at, rev, rev_device) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insSub = db.prepare('INSERT INTO subtasks (uuid, task_id, user_id, title, done, sort_order, created_at, updated_at, deleted_at, applied_at, rev, rev_device) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const insRem = db.prepare('INSERT INTO reminders (uuid, task_id, user_id, fire_at, fired_at, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?)');
  const insOrder = db.prepare('INSERT INTO orders (uuid, user_id, plan_id, coupon_id, amount_tomans, discount_tomans, status, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insPayment = db.prepare('INSERT INTO payments (uuid, order_id, gateway, status, amount_tomans, gateway_ref, verified_at, verify_payload, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insSubs = db.prepare('INSERT INTO subscriptions (uuid, user_id, plan_id, order_id, source, starts_at, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insAudit = db.prepare('INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, details, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insProv = db.prepare('INSERT INTO provider_logs (provider, direction, status, identity, subject, message, context, created_at) VALUES (?,?,?,?,?,?,?,?)');

  let listsN = 0, tasksN = 0, subsN = 0, remsN = 0, ordersN = 0;
  const hash = () => Buffer.from(randomUUID() + randomUUID()).toString('base64').slice(0, 44);

  for (let u = 1; u <= users; u++) {
    const created = iso(new Date(NOW - Math.floor(rnd() * 90 * 86400_000)));
    const lastLogin = iso(new Date(NOW - Math.floor(rnd() * 7 * 86400_000)));
    const isPro = rnd() < 0.08;
    insUser.run(randomUUID(), pick(['سارا', 'امیر', 'نرگس', 'محمد', 'الینا'], rnd) + ' ' + (u % 97), rnd() < 0.5 ? 'female' : 'male', 'active', isPro ? iso(new Date(NOW + 30 * 86400_000)) : null, lastLogin, created, created);
    insIdentity.run(u, 'email', `user${u}@mail.example`, 1, lastLogin, created);
    // ۲ OTP در ۳۰ روز + یک توکن دستگاه + ۲ audit
    for (let o = 0; o < 2; o++) {
      const t = new Date(NOW - Math.floor(rnd() * 30 * 86400_000));
      insOtp.run('email', `user${u}@mail.example`, hash(), 'login', rnd() < 0.1 ? 1 : 0, `5.10.${(u % 250)}.${(u * 7) % 250}`, iso(new Date(t.getTime() + 300_000)), iso(t), iso(t));
    }
    insToken.run(u, randomUUID(), 'Android / Karam 1.0.7', hash(), 'Mozilla/5.0 (Linux; Android 14)', `5.10.${(u % 250)}.${(u * 7) % 250}`, lastLogin, iso(new Date(NOW + 180 * 86400_000)), null, lastLogin);
    insAudit.run('user', u, 'auth.login', 'users', String(u), '{"channel":"email"}', `5.10.${(u % 250)}.${(u * 7) % 250}`, 'Karam/1.0.7', lastLogin);
    insAudit.run('system', u, 'sync.pull', 'tasks', null, '{"items":120}', null, 'Karam/1.0.7', lastLogin);
    if (rnd() < 0.05) {
      const oid = ++ordersN;
      insOrder.run(randomUUID(), u, 1 + (u % 3), null, pick([49000, 190000, 490000], rnd), 0, 'paid', 'اشتراک مصنوعی', lastLogin, lastLogin);
      insPayment.run(randomUUID(), oid, 'zibal', 'paid', 49000, 'T' + u, lastLogin, '{"ref":"synthetic"}', lastLogin, lastLogin);
      insSubs.run(randomUUID(), u, 1 + (u % 3), null, 'web_gateway', lastLogin, iso(new Date(NOW + 365 * 86400_000)), lastLogin, lastLogin);
      insProv.run('zibal', 'out', 'success', String(u), 'verify', '{"amount":490000,"status":100}', '{"synthetic":true}', lastLogin);
    }
    // لیست‌ها: هر ~۴۰ کار یک لیست
    const listCount = Math.max(1, Math.round(prof.tasks / 40));
    const listIds: number[] = [];
    for (let l = 0; l < listCount; l++) {
      insList.run(randomUUID(), u, `لیست ${l + 1} کاربر ${u}`, pick(['🏠', '💼', '📚'], rnd), 'teal', l, created, created, null, created, 1, randomUUID().slice(0, 12));
      listIds.push(++listsN);
    }
    for (let t = 0; t < prof.tasks; t++) {
      const taskId = ++tasksN;
      const due = new Date(NOW + Math.floor((rnd() - 0.5) * 60 * 86400_000));
      const hasRem = rnd() < prof.remRatio;
      const done = rnd() < 0.35;
      const updated = iso(new Date(NOW - Math.floor(rnd() * 30 * 86400_000)));
      insTask.run(
        randomUUID(), u, listIds[t % listIds.length],
        pick(TITLE_WORDS, rnd) + ' #' + t,
        rnd() < 0.55 ? pick(NOTE_WORDS, rnd) : null,
        pick(['normal', 'normal', 'high', 'low', 'urgent'], rnd),
        rnd() < 0.8 ? dateOnly(due) : null,
        rnd() < 0.5 ? timeOnly(due) : null,
        hasRem ? pick([10, 30, 60, 1440], rnd) : null,
        rnd() < 0.15 ? 'daily' : 'none',
        rnd() < 0.1 ? 1 : 0,
        rnd() < 0.05 ? '{"every":1,"unit":"week","days":[0,2]}' : null,
        done ? updated : null, updated, updated, null, updated, 1, randomUUID().slice(0, 12),
      );
      const subCount = Math.floor(prof.subRatio) + (rnd() < prof.subRatio % 1 ? 1 : 0);
      for (let s = 0; s < subCount; s++) {
        subsN++;
        insSub.run(randomUUID(), taskId, u, SUB_TITLE(s, t), rnd() < 0.4 ? 1 : 0, s, updated, updated, null, updated, 1, randomUUID().slice(0, 12));
      }
      if (hasRem) {
        remsN++;
        insRem.run(randomUUID(), taskId, u, iso(new Date(due.getTime() - 3600_000)), done ? iso(due) : null, updated, updated, null);
      }
    }
    if (u % 500 === 0) { db.run('COMMIT'); db.run('BEGIN'); } // تراکنش‌های دوره‌ای
  }
  db.run('COMMIT');

  const counts = {
    users, lists: listsN, tasks: tasksN, subtasks: subsN, reminders: remsN,
    otp: (db.query('SELECT COUNT(*) c FROM otp_requests').get() as any).c,
    refresh: (db.query('SELECT COUNT(*) c FROM refresh_tokens').get() as any).c,
    audit: (db.query('SELECT COUNT(*) c FROM audit_logs').get() as any).c,
    provider: (db.query('SELECT COUNT(*) c FROM provider_logs').get() as any).c,
    orders: ordersN,
  };
  db.close();

  const baseBytes = fileSize();
  const perIndex: Record<string, number> = {};
  for (const [name, ddl] of INDEXES) {
    const d = new Database(TMP_DB);
    d.run('PRAGMA page_size = 8192');
    d.run(ddl);
    d.close();
    perIndex[name] = fileSize();
  }
  const totalBytes = fileSize();
  const idxBytes = totalBytes - baseBytes;

  const result: Record<string, any> = {
    label, users, profile: profileName,
    counts, baseBytes, idxBytes, totalBytes, perIndex,
    measuredSeconds: Math.round((Date.now() - t0) / 100) / 10,
  };

  // اندازه‌ی دقیق هر جدول با dbstat (در صورت دسترس‌پذیری)
  let dbstatOk = false;
  try {
    const d = new Database(TMP_DB);
    const rows = d.query('SELECT name, SUM(pgsize) pgsize FROM dbstat GROUP BY name').all() as any[];
    d.close();
    dbstatOk = true;
    const tables: Record<string, number> = {};
    for (const r of rows) {
      if (!r.name.startsWith('sqlite_autoindex') && !INDEXES.some(([n]) => n === r.name) && r.name !== 'sqlite_stat1') {
        tables[r.name] = (tables[r.name] ?? 0) + r.pgsize;
      }
    }
    result.dbstat = { ok: true, tables };
  } catch {
    result.dbstat = { ok: false };
  }

  appendFileSync(OUT_DIR + 'results.jsonl', JSON.stringify(result) + '\n');
  rmSync(TMP_DB, { force: true });

  const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + ' MB';
  console.log(`\n=== ${label} — ${users.toLocaleString('fa-IR')} کاربر × ${profileName} — اندازه‌گیری واقعی (${result.measuredSeconds}s) ===`);
  console.log(`جداول (بدون ایندکس): ${mb(baseBytes)} | ایندکس‌ها: ${mb(idxBytes)} | کل فایل: ${mb(totalBytes)}`);
  if (dbstatOk) {
    const t = result.dbstat.tables;
    for (const k of ['tasks', 'subtasks', 'reminders', 'lists', 'users', 'otp_requests', 'refresh_tokens', 'audit_logs', 'provider_logs'] as const) {
      if (t[k]) {
        const n = counts[k as keyof typeof counts] as number;
        console.log(`  جدول ${k}: ${mb(t[k])} (${n.toLocaleString('fa-IR')} ردیف ≈ ${Math.round(t[k] / n)} بایت/ردیف)`);
      }
    }
  }
}

async function estimate() {
  const path = OUT_DIR + 'results.jsonl';
  if (!existsSync(path)) throw new Error('اول run را اجرا کنید');
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const find = (u: number, p: string) => lines.find((l: any) => l.users === u && l.profile === p);
  const perUser = (p: string): number => {
    const a = find(1000, p), b = find(2000, p);
    if (a && b) return (b.totalBytes - a.totalBytes) / (b.users - a.users);
    if (a) return a.totalBytes / a.users;
    throw new Error('کالیبراسیون برای پروفایل ' + p + ' یافت نشد (run با ۱۰۰۰ و ۲۰۰۰ کاربر لازم است)');
  };
  const light = perUser('light'), medium = perUser('medium'), heavy = perUser('heavy');
  console.log('\n=== برون‌یابی خطی از اندازه‌گیری واقعی (برآورد — نه اندازه‌گیری) ===');
  console.log(`هزینه‌ی هر کاربر — سبک: ${(light / 1024).toFixed(1)} KB | متوسط: ${(medium / 1024).toFixed(1)} KB | سنگین: ${(heavy / 1024).toFixed(1)} KB`);
  const plan: Array<[string, number, string, boolean]> = [
    ['۵٬۰۰۰ × سنگین', 5000, 'heavy', true],
    ['۲۰٬۰۰۰ × سبک', 20000, 'light', find(20000, 'light') == null],
    ['۲۰٬۰۰۰ × متوسط', 20000, 'medium', true],
    ['۲۰٬۰۰۰ × سنگین', 20000, 'heavy', true],
  ];
  for (const [name, n, p, isEst] of plan) {
    const measured = find(n, p);
    if (measured) {
      console.log(`${name}: ${(measured.totalBytes / 1024 / 1024).toFixed(1)} MB (اندازه‌گیری‌شده)`);
      continue;
    }
    const perUser2 = p === 'light' ? light : p === 'medium' ? medium : heavy;
    console.log(`${name}: ≈ ${(perUser2 * n / 1024 / 1024 / 1024).toFixed(2)} GB (برآورد خطی${isEst ? '؛ روی هاست MySQL باید با داده‌ی واقعی صحه‌گذاری شود' : ''})`);
  }
}

const [, , mode, ...rest] = process.argv;
function arg(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}
if (mode === 'run') {
  await runScenario(Number(arg('--users') ?? 1000), arg('--profile') ?? 'medium', arg('--label') ?? '');
} else if (mode === 'estimate') {
  await estimate();
} else {
  console.log('usage: bun tools/measure-db-size.mts run --users 1000 --profile medium --label S2');
  console.log('       bun tools/measure-db-size.mts estimate');
}
