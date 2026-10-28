-- کارام — اسکیمای SQLite فقط برای توسعه/تست محلی (بدون سرور MySQL)
-- روی هاست cPanel از deploy/install.sql (MySQL) استفاده می‌شود — این فایل هرگز آپلود نمی‌شود.
-- اجرا: sqlite3 karam.sqlite3 < deploy/install.sqlite.sql
--       یا: DB_DRIVER=sqlite در .env محلی + اعمال این فایل با sqlite3/PDO.
-- کلیدهای خارجی: اپ هنگام اتصال PRAGMA foreign_keys=ON را خودش فعال می‌کند.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT(36) NOT NULL UNIQUE,
  display_name  TEXT(100),
  gender        TEXT(16) NOT NULL DEFAULT 'unset',
  status        TEXT(16) NOT NULL DEFAULT 'active',
  premium_until TEXT(19),
  last_login_at TEXT(19),
  created_at    TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at    TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at);

CREATE TABLE IF NOT EXISTS user_identities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        TEXT(16) NOT NULL,
  value       TEXT(190) NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT(19),
  created_at  TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  UNIQUE (type, value)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS otp_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_type  TEXT(16) NOT NULL,            -- email | telegram | mobile
  identity_value TEXT(190) NOT NULL,           -- ایمیل، بلیت ۶ حرفی یا chat_id تلگرام
  code_hash      TEXT(255) NOT NULL,
  purpose        TEXT(16) NOT NULL DEFAULT 'login',
  attempts       INTEGER NOT NULL DEFAULT 0,
  ip             TEXT(45),
  expires_at     TEXT(19) NOT NULL,
  consumed_at    TEXT(19),
  created_at     TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_identity ON otp_requests (identity_value, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_ip ON otp_requests (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_requests (expires_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id    TEXT(36) NOT NULL,
  device_name  TEXT(120),
  token_hash   TEXT(255) NOT NULL UNIQUE,
  user_agent   TEXT(255),
  ip           TEXT(45),
  issued_at    TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  expires_at   TEXT(19) NOT NULL,
  revoked_at   TEXT(19),
  last_used_at TEXT(19)
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT(36) NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT(120) NOT NULL,
  emoji      TEXT(16),
  color      TEXT(16) NOT NULL DEFAULT 'teal',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at TEXT(19),
  applied_at TEXT(19),
  rev          INTEGER NOT NULL DEFAULT 0,
  rev_device   TEXT(64) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_lists_applied ON lists (user_id, applied_at);

CREATE TABLE IF NOT EXISTS tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid             TEXT(36) NOT NULL UNIQUE,
  user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  list_id          INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  title            TEXT(255) NOT NULL,
  notes            TEXT,
  priority         TEXT(8) NOT NULL DEFAULT 'normal',
  due_date         TEXT(10),
  due_time         TEXT(8),
  reminder_minutes INTEGER,
  repeat           TEXT(8) NOT NULL DEFAULT 'none',
  starred          INTEGER NOT NULL DEFAULT 0,
  repeat_meta      TEXT,
  completed_at     TEXT(19),
  created_at       TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at       TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at       TEXT(19),
  applied_at       TEXT(19),
  rev          INTEGER NOT NULL DEFAULT 0,
  rev_device   TEXT(64) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks (list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_applied ON tasks (user_id, applied_at);

CREATE TABLE IF NOT EXISTS subtasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT(36) NOT NULL UNIQUE,
  task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      TEXT(255) NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at TEXT(19),
  applied_at TEXT(19),
  rev          INTEGER NOT NULL DEFAULT 0,
  rev_device   TEXT(64) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks (task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_user ON subtasks (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_subtasks_applied ON subtasks (user_id, applied_at);

-- ---------------------------------------------------------------
-- فاز ۴ — پنل مدیریت + پلن‌ها + اطلاعیه‌ها + تنظیمات + لاگ
-- (آینه‌ی MySQL برای توسعه/تست محلی)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid        TEXT(36) NOT NULL UNIQUE,
  code        TEXT(50) NOT NULL UNIQUE,
  title       TEXT(120) NOT NULL,
  months      INTEGER NOT NULL DEFAULT 1,
  price_tomans INTEGER NOT NULL DEFAULT 0,
  description TEXT(255),
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at  TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT(36) NOT NULL UNIQUE,
  code       TEXT(50) NOT NULL UNIQUE,
  type       TEXT(8) NOT NULL,
  value      INTEGER NOT NULL,
  expires_at TEXT(19),
  max_uses   INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT(36) NOT NULL UNIQUE,
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id        INTEGER NOT NULL REFERENCES plans (id),
  coupon_id      INTEGER REFERENCES coupons (id),
  amount_tomans   INTEGER NOT NULL,
  discount_tomans INTEGER NOT NULL DEFAULT 0,
  status         TEXT(16) NOT NULL DEFAULT 'created',
  description    TEXT(255),
  created_at     TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at     TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT(36) NOT NULL UNIQUE,
  order_id      INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  gateway       TEXT(16) NOT NULL,
  status        TEXT(16) NOT NULL DEFAULT 'created',
  amount_tomans  INTEGER NOT NULL,
  gateway_ref   TEXT(190),
  verified_at   TEXT(19),
  verify_payload TEXT,
  created_at    TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at    TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT(36) NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id    INTEGER REFERENCES plans (id),
  order_id   INTEGER REFERENCES orders (id),
  source     TEXT(16) NOT NULL,
  starts_at  TEXT(19) NOT NULL,
  expires_at TEXT(19),
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions (user_id, expires_at);

-- درخواست‌های واریز کارت‌به‌کارت (فاز ۸) — تأیید نهایی با ادمین
CREATE TABLE IF NOT EXISTS deposit_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT(36) NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id         INTEGER REFERENCES plans (id),
  plan_code       TEXT(50) NOT NULL,
  amount_tomans    INTEGER NOT NULL DEFAULT 0,
  reference       TEXT(64) NOT NULL,
  note            TEXT(500),
  status          TEXT(16) NOT NULL DEFAULT 'pending',
  review_note     TEXT(500),
  reviewed_by     INTEGER,
  reviewed_at     TEXT(19),
  subscription_id INTEGER,
  created_at      TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at      TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_deposit_user ON deposit_requests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_deposit_status ON deposit_requests (status, created_at);

CREATE TABLE IF NOT EXISTS admin_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT(30) NOT NULL UNIQUE,
  title       TEXT(80) NOT NULL,
  permissions TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT(36) NOT NULL UNIQUE,
  username        TEXT(64) NOT NULL UNIQUE,
  password_hash   TEXT(255) NOT NULL,
  role_id         INTEGER NOT NULL REFERENCES admin_roles (id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  totp_secret     TEXT(255),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT(19),
  last_login_at   TEXT(19),
  created_at      TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at      TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  token_hash TEXT(255) NOT NULL UNIQUE,
  csrf_token TEXT(64) NOT NULL,
  ip         TEXT(45),
  user_agent TEXT(255),
  expires_at TEXT(19) NOT NULL,
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions (admin_id);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT(36) NOT NULL UNIQUE,
  title      TEXT(150) NOT NULL,
  body       TEXT NOT NULL,
  type       TEXT(8) NOT NULL DEFAULT 'info',
  link_url   TEXT(500),
  image_url  TEXT(500),
  is_active  INTEGER NOT NULL DEFAULT 1,
  starts_at  TEXT(19),
  ends_at    TEXT(19),
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT(80) PRIMARY KEY,
  value      TEXT,
  updated_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT(8) NOT NULL DEFAULT 'admin',
  actor_id   INTEGER,
  action     TEXT(80) NOT NULL,
  entity     TEXT(60),
  entity_id  TEXT(64),
  details    TEXT,
  ip         TEXT(45),
  user_agent TEXT(255),
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (actor_type, actor_id);

-- گام ۱ — جدول provider_logs (لاگ رفت‌وبرگشت درگاه/ایمیل/پیامک) در سید SQLite جا مانده بود
-- (فاز ۵) — نبودنش باعث می‌شد لاگ‌ها بی‌صدا ثبت نشوند و تست فاز ۵ بشکند
CREATE TABLE IF NOT EXISTS provider_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  provider   TEXT(20) NOT NULL,
  direction  TEXT(8)  NOT NULL DEFAULT 'out',
  status     TEXT(12) NOT NULL,
  identity   TEXT(190),
  subject    TEXT(190),
  message    TEXT(500),
  context    TEXT,
  created_at TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE INDEX IF NOT EXISTS idx_provider_logs ON provider_logs (provider, created_at);

-- داده‌ی اولیه (فاز ۴)
INSERT OR IGNORE INTO admin_roles (code, title, permissions) VALUES
  ('superadmin', 'مدیر کل', '{}'),
  ('support', 'پشتیبان', '{"users.view":true,"orders.view":true,"orders.review":true}');

INSERT OR IGNORE INTO plans (uuid, code, title, months, price_tomans, description, is_active, sort_order) VALUES
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'monthly',  'اشتراک ماهانه',  1, 49000,   'یک ماه دسترسی کامل به کارام پرو', 1, 1),
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'annual',   'اشتراک سالانه', 12, 190000,  'دوازده ماه دسترسی کامل — ۶۰٪ تخفیف', 1, 2),
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'lifetime', 'دائمی',          0, 490000,  'یکبار پرداخت، همیشه پرو', 1, 3);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('app_name', 'کارام'),
  ('maintenance_mode', '0'),
  ('min_app_version', '1.0.0'),
  ('admin_otp_shortcuts', '[]'),
  ('paywall_title', 'کارام پرو (Karam Pro)'),
  ('api_allow_registration', '1'),
  ('api_max_sync_items', '2000'),
  ('voice_enabled', '0'),
  ('voice_provider', 'off'),
  ('voice_rate', '100'),
  ('voice_pitch', '100'),
  ('voice_lang', 'fa-IR'),
  ('gateway_zibal_enabled', '1'),
  ('zibal_merchant', 'zibal'),
  ('payments_master_enabled', '1'),
  ('payments_enabled_web', '1'),
  ('payments_enabled_android', '1'),
  ('payments_disabled_message', ''),
  ('deposit_card_enabled', '1'),
  ('deposit_card_number', '6104337812345678'),
  ('deposit_card_holder', 'ادمین کارام'),
  ('deposit_card_guide', 'مبلغ دقیق همان پلن انتخابی است. بعد از واریز، شماره پیگیری حواله را ثبت کنید؛ معمولاً کمتر از ۱۲ ساعت بررسی و اشتراک فعال می‌شود.'),
  ('app_latest_version', ''),
  ('app_update_url', ''),
  ('app_update_notes', ''),
  ('support_email', ''),
  ('support_telegram', ''),
  ('trial_enabled', '1'),
  ('trial_days', '7'),
  ('backup_telegram_chat', ''),
  ('referral_enabled', '1'),
  ('referral_days', '7'),
  ('gift_codes_enabled', '1'),
  ('reminder_enabled', '0'),
  ('reminder_lookback_days', '30'),
  ('provider_email_enabled', '0'),
  ('telegram_bot_token', ''),
  ('telegram_bot_username', ''),
  ('provider_sms_enabled', '0');
