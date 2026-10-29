/** سنجه‌ی موقت بایت/ردیف تک‌جدولی — نتایج به docs/PROJECT-QA.md منتقل می‌شود؛ فایل موقت است */
import { Database } from 'bun:sqlite';
import { statSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const hash = () => Buffer.from(randomUUID() + randomUUID()).toString('base64').slice(0, 44);

function measure(name: string, ddl: string, sql: string, params: (i: number) => unknown[], n: number) {
  const p = '/tmp/karam-one-' + name + '.sqlite3';
  rmSync(p, { force: true });
  const db = new Database(p);
  db.run('PRAGMA journal_mode=MEMORY');
  db.run('PRAGMA synchronous=OFF');
  db.run('PRAGMA page_size=8192');
  db.run(ddl);
  db.run('BEGIN');
  const st = db.prepare(sql);
  for (let i = 0; i < n; i++) st.run(...params(i));
  db.run('COMMIT');
  db.close();
  const b = statSync(p).size;
  rmSync(p, { force: true });
  console.log(`${name.padEnd(9)}: ${Math.round(b / n)} بایت/ردیف (کل ${(b / 1024 / 1024).toFixed(1)} MB در ${n.toLocaleString('fa-IR')} ردیف)`);
}

const N = 400000;
const T = `CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, list_id INTEGER NOT NULL, title TEXT(255) NOT NULL, notes TEXT, priority TEXT(8) NOT NULL DEFAULT 'normal', due_date TEXT(10), due_time TEXT(8), reminder_minutes INTEGER, repeat TEXT(8) NOT NULL DEFAULT 'none', starred INTEGER NOT NULL DEFAULT 0, repeat_meta TEXT, completed_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');`;
measure('tasks', T, 'INSERT INTO tasks VALUES (null,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (i) => {
  const r = (i * 2654435761) >>> 0, rr = (v: number) => (r % 100) < v;
  const notes = rr(55) ? 'با آقای رضایی هماهنگ شود و نتیجه در گروه اعلام گردد.' : null;
  const due = rr(80) ? '2026-10-15' : null;
  const tm = rr(50) ? '09:30:00' : null;
  const rem = rr(40) ? 30 : null;
  return [randomUUID(), 1, 1, 'بازبینی قیمت سهم #' + i, notes, 'normal', due, tm, rem, rr(15) ? 'daily' : 'none', rr(10) ? 1 : 0, null, null, iso(new Date(NOW)), iso(new Date(NOW)), null, iso(new Date(NOW)), 1, 'dev123456'];
}, N);

const S = `CREATE TABLE subtasks (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, title TEXT(255) NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');`;
measure('subtasks', S, 'INSERT INTO subtasks VALUES (null,?,?,?,?,?,?,?,?,?,?,?,?)', (i) => [randomUUID(), i, 1, 'زیرکار ۱', i % 2, 0, iso(new Date(NOW)), iso(new Date(NOW)), null, iso(new Date(NOW)), 1, 'dev123456'], N);

const R = `CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, fire_at TEXT(19) NOT NULL, fired_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19));`;
measure('reminders', R, 'INSERT INTO reminders VALUES (null,?,?,?,?,?,?,?,?)', (i) => [randomUUID(), i, 1, iso(new Date(NOW)), null, iso(new Date(NOW)), iso(new Date(NOW)), null], N);

const M = 200000;
const O = `CREATE TABLE otp_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, identity_type TEXT(16) NOT NULL, identity_value TEXT(190) NOT NULL, code_hash TEXT(255) NOT NULL, purpose TEXT(16) NOT NULL DEFAULT 'login', attempts INTEGER NOT NULL DEFAULT 0, ip TEXT(45), expires_at TEXT(19) NOT NULL, consumed_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '');`;
measure('otp', O, 'INSERT INTO otp_requests VALUES (null,?,?,?,?,?,?,?,?,?)', (i) => ['email', 'user' + i + '@mail.example', hash(), 'login', 0, '5.10.0.1', iso(new Date(NOW)), iso(new Date(NOW)), iso(new Date(NOW))], M);

const A = `CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT(8) NOT NULL DEFAULT 'admin', actor_id INTEGER, action TEXT(80) NOT NULL, entity TEXT(60), entity_id TEXT(64), details TEXT, ip TEXT(45), user_agent TEXT(255), created_at TEXT(19) NOT NULL DEFAULT '');`;
measure('audit', A, 'INSERT INTO audit_logs VALUES (null,?,?,?,?,?,?,?,?,?)', (i) => ['user', i, 'auth.login', 'users', String(i), '{"channel":"email"}', '5.10.0.1', 'Karam/1.0.7', iso(new Date(NOW))], M);

const RT = `CREATE TABLE refresh_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_id TEXT(36) NOT NULL, device_name TEXT(120), token_hash TEXT(255) NOT NULL, user_agent TEXT(255), ip TEXT(45), issued_at TEXT(19) NOT NULL DEFAULT '', expires_at TEXT(19) NOT NULL, revoked_at TEXT(19), last_used_at TEXT(19));`;
measure('refresh', RT, 'INSERT INTO refresh_tokens VALUES (null,?,?,?,?,?,?,?,?,?,?)', (i) => [i, randomUUID(), 'Android / Karam 1.0.7', hash(), 'Mozilla/5.0 (Linux; Android 14)', '5.10.0.1', iso(new Date(NOW)), iso(new Date(NOW)), null, iso(new Date(NOW))], M);

const P = `CREATE TABLE provider_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT(20) NOT NULL, direction TEXT(8) NOT NULL DEFAULT 'out', status TEXT(12) NOT NULL, identity TEXT(190), subject TEXT(190), message TEXT(500), context TEXT, created_at TEXT(19) NOT NULL DEFAULT '');`;
measure('provider', P, 'INSERT INTO provider_logs VALUES (null,?,?,?,?,?,?,?,?)', (i) => ['zibal', 'out', 'success', String(i), 'verify', '{"amount":490000,"status":100}', '{"synthetic":true}', iso(new Date(NOW))], M);

const O2 = `CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, plan_id INTEGER NOT NULL, coupon_id INTEGER, amount_tomans INTEGER NOT NULL, discount_tomans INTEGER NOT NULL DEFAULT 0, status TEXT(16) NOT NULL DEFAULT 'created', description TEXT(255), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '');`;
measure('orders', O2, 'INSERT INTO orders VALUES (null,?,?,?,?,?,?,?,?,?,?)', (i) => [randomUUID(), i, 1, null, 49000, 0, 'paid', 'اشتراک مصنوعی', iso(new Date(NOW)), iso(new Date(NOW))], M);
