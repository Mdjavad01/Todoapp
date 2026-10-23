-- کارام — اسکیمای SQLite فقط برای توسعه/تست محلی (بدون سرور MySQL)
-- روی هاست cPanel از deploy/install.sql (MySQL) استفاده می‌شود — این فایل هرگز آپلود نمی‌شود.
-- اجرا: sqlite3 karam.sqlite3 < deploy/install.sqlite.sql
--       یا: DB_DRIVER=sqlite در .env محلی + اعمال این فایل با sqlite3/PDO.
-- کلیدهای خارجی: اپ هنگام اتصال PRAGMA foreign_keys=ON را خودش فعال می‌کند.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT(36) NOT NULL UNIQUE,
  display_name  TEXT(100),
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
  applied_at TEXT(19)
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
  completed_at     TEXT(19),
  created_at       TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  updated_at       TEXT(19) NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
  deleted_at       TEXT(19),
  applied_at       TEXT(19)
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
  applied_at TEXT(19)
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks (task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_user ON subtasks (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_subtasks_applied ON subtasks (user_id, applied_at);
