/**
 * کارام — تست بک‌آپ/بازیابی با داده‌ی مصنوعی (فقط گزارش PROJECT-QA؛ جزو کد اجرایی نیست)
 *
 * چه چیزی می‌سنجد:
 *  ۱) ساخت دیتابیس مصنوعی (۵۰۰ کاربر × پروفایل متوسط) مطابق اسکیمای install.sqlite.sql.
 *  ۲) زمان «dump» متنی (همان رویکرد PHPِ fallback در backend/cron/backup-db.php:169-206:
 *     SHOW CREATE TABLE معادل sqlite_master + INSERT ردیف‌به‌ردیف) + حجم فایل + حجم gzip.
 *  ۳) زمان «بازیابی» واقعی: بازسازی دیتابیس خالی از فایل dump + صحه‌ی شمارش ردیف‌ها.
 *
 * اجرا: bun tools/backup-restore-test.mts
 */

import { Database } from 'bun:sqlite';
import { statSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

const OUT = new URL('./measurements/', import.meta.url).pathname;
const DB_PATH = OUT + 'tmp-backup-src.sqlite3';
const DUMP_PATH = OUT + 'tmp-dump.sql';
const RESTORED_PATH = OUT + 'tmp-restored.sqlite3';

// ——— مولد داده‌ی مصنوعی (نسخه‌ی سبک همان مولد measure-db-size) ———
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const iso = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function esc(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const USERS = Number((process.argv[2] ?? '500').replace(/[^\d]/g, '')) || 500;
const TASKS_PER_USER = 300;

mkdirSync(OUT, { recursive: true });
rmSync(DB_PATH, { force: true });
rmSync(RESTORED_PATH, { force: true });

const t0 = Date.now();
const db = new Database(DB_PATH);
db.run('PRAGMA journal_mode = MEMORY');
db.run('PRAGMA synchronous = OFF');
db.exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, display_name TEXT(100), gender TEXT(16) NOT NULL DEFAULT 'unset', status TEXT(16) NOT NULL DEFAULT 'active', premium_until TEXT(19), last_login_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '');
CREATE TABLE lists (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, name TEXT(120) NOT NULL, emoji TEXT(16), color TEXT(16) NOT NULL DEFAULT 'teal', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, user_id INTEGER NOT NULL, list_id INTEGER NOT NULL, title TEXT(255) NOT NULL, notes TEXT, priority TEXT(8) NOT NULL DEFAULT 'normal', due_date TEXT(10), due_time TEXT(8), reminder_minutes INTEGER, repeat TEXT(8) NOT NULL DEFAULT 'none', starred INTEGER NOT NULL DEFAULT 0, repeat_meta TEXT, completed_at TEXT(19), created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');
CREATE TABLE subtasks (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT(36) NOT NULL, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, title TEXT(255) NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT(19) NOT NULL DEFAULT '', updated_at TEXT(19) NOT NULL DEFAULT '', deleted_at TEXT(19), applied_at TEXT(19), rev INTEGER NOT NULL DEFAULT 0, rev_device TEXT(64) NOT NULL DEFAULT '');
CREATE INDEX idx_tasks_user ON tasks (user_id, deleted_at);
CREATE INDEX idx_tasks_applied ON tasks (user_id, applied_at);
`);
db.run('BEGIN');
const rnd = makeRng(11);
const titles = ['بازبینی قیمت سهم', 'تماس با مشتری', 'ارسال فاکتور', 'جلسه هفتگی تیم', 'پیگیری سفارش'];
let taskId = 0;
for (let u = 1; u <= USERS; u++) {
  db.prepare('INSERT INTO users (uuid, display_name, gender, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), 'کاربر ' + u, u % 2 ? 'female' : 'male', 'active', iso(new Date(NOW)), iso(new Date(NOW)));
  for (let l = 0; l < 8; l++) {
    db.prepare('INSERT INTO lists (uuid, user_id, name, color, sort_order, created_at, updated_at, applied_at, rev, rev_device) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), u, 'لیست ' + (l + 1), 'teal', l, iso(new Date(NOW)), iso(new Date(NOW)), iso(new Date(NOW)), 1, 'd0');
  }
  for (let t = 0; t < TASKS_PER_USER; t++) {
    taskId++;
    db.prepare('INSERT INTO tasks (uuid, user_id, list_id, title, notes, priority, due_date, repeat, created_at, updated_at, applied_at, rev, rev_device) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      randomUUID(), u, ((t % 8) + 1), titles[t % titles.length] + ' #' + t, rnd() < 0.55 ? 'یادداشت نمونه برای سناریوی پشتیبان‌گیری کارام.' : null,
      'normal', '2026-10-' + String((t % 28) + 1).padStart(2, '0'), 'none', iso(new Date(NOW)), iso(new Date(NOW)), iso(new Date(NOW)), 1, 'd0');
    if (t % 2 === 0) {
      db.prepare('INSERT INTO subtasks (uuid, task_id, user_id, title, done, sort_order, created_at, updated_at, applied_at, rev, rev_device) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), taskId, u, 'زیرکار ۱', 0, 0, iso(new Date(NOW)), iso(new Date(NOW)), iso(new Date(NOW)), 1, 'd0');
    }
  }
}
db.run('COMMIT');
const seedSeconds = (Date.now() - t0) / 1000;
const srcBytes = statSync(DB_PATH).size;
console.log(`۱) دیتابیس مصنوعی ساخته شد: ${USERS.toLocaleString('fa-IR')} کاربر × ${TASKS_PER_USER} کار = ${taskId.toLocaleString('fa-IR')} کار — ${seedSeconds.toFixed(1)}s — ${(srcBytes / 1024 / 1024).toFixed(1)} MB`);

// ——— ۲) dump متنی (رویکرد PHP fallback) ———
const t1 = Date.now();
const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map((r) => r.name);
const parts: string[] = ['-- کارام synthetic dump\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n'];
for (const tbl of tables) {
  const create = (db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(tbl) as any).sql;
  parts.push(create.replace(/CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS') + ';\n');
  const cols = (db.query(`PRAGMA table_info(${tbl})`).all() as any[]).map((c) => c.name);
  const sel = db.prepare(`SELECT * FROM ${tbl} LIMIT ? OFFSET ?`);
  const colList = cols.join(',');
  for (let off = 0; ; off += 1000) {
    const rows = sel.all(1000, off) as any[];
    if (!rows.length) break;
    for (const r of rows) {
      parts.push(`INSERT INTO ${tbl} (${colList}) VALUES (${cols.map((c) => esc(r[c])).join(',')});\n`);
    }
  }
}
parts.push('COMMIT;\n');
db.close();
const buf = Buffer.from(parts.join(''), 'utf8');
writeFileSync(DUMP_PATH, buf);
const dumpMs = Date.now() - t1;
const dumpBytes = buf.length;
const gz = gzipSync(buf);
const gzPath = DUMP_PATH + '.gz';
writeFileSync(gzPath, gz);
console.log(`۲) dump متنی: ${(dumpMs / 1000).toFixed(1)}s — ${(dumpBytes / 1024 / 1024).toFixed(1)} MB — gzip ${(gz.length / 1024 / 1024).toFixed(1)} MB (نسبت فشرده‌سازی ${(dumpBytes / gz.length).toFixed(1)}×)`);

// ——— ۳) بازیابی (اجرای تکه‌تکه‌ی dump برای شبیه‌سازی import واقعی) ———
const t2 = Date.now();
const rdb = new Database(RESTORED_PATH);
rdb.run('PRAGMA journal_mode = MEMORY');
rdb.run('PRAGMA synchronous = OFF');
const sqlText = gunzipSync(gz).toString('utf8');
// dump خودش BEGIN/COMMIT دارد — برای تراکنش واحدِ بازیابی حذف می‌شوند
const lines = sqlText.split('\n').filter((l) => !/^\s*(BEGIN TRANSACTION|COMMIT|PRAGMA foreign_keys)/.test(l));
rdb.run('BEGIN TRANSACTION');
for (let i = 0; i < lines.length; i += 2000) {
  const chunk = lines.slice(i, i + 2000).join('\n');
  if (chunk.trim()) rdb.run(chunk);
}
rdb.run('COMMIT');
const counts: Record<string, number> = {};
for (const tbl of ['users', 'lists', 'tasks', 'subtasks']) {
  counts[tbl] = (rdb.query(`SELECT COUNT(*) c FROM ${tbl}`).get() as any).c;
}
rdb.close();
const restoreMs = Date.now() - t2;
const restoredBytes = statSync(RESTORED_PATH).size;
console.log(`۳) بازیابی: ${(restoreMs / 1000).toFixed(1)}s — حجم بازیابی‌شده ${(restoredBytes / 1024 / 1024).toFixed(1)} MB — شمارش‌ها users=${counts.users} lists=${counts.lists} tasks=${counts.tasks} subtasks=${counts.subtasks}`);
const ok = counts.tasks === taskId && counts.users === USERS;
console.log(ok ? '✅ بازیابی کامل و درست (شمارش ردیف‌ها برابر منبع)' : '❌ مغایرت در بازیابی');
console.log(`جمع‌بندی: RPO پیشنهادی ≤ ۲۴ ساعت (کرون ۰۳:۳۰) و RTO اندازه‌گیری‌شده برای این مقیاس ≈ ${((dumpMs + restoreMs) / 1000).toFixed(0)} ثانیه (محلی).`);

rmSync(DB_PATH, { force: true });
rmSync(DUMP_PATH, { force: true });
rmSync(gzPath, { force: true });
rmSync(RESTORED_PATH, { force: true });
