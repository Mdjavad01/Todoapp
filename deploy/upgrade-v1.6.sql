-- کارام — v1.6: ترمیم جریان سینک (فاز ۱ بازسازی)
-- سه کار: (۱) ستون‌های نسخه‌ی LWW  (۲) دوتایی‌زدایی نرم از لیست‌های آزمایشی تکراری  (۳) پشتیبان و راه بازگشت
--
-- این مهاجرت «تکرارپذیر» است (چند بار اجرا بی‌ضرر) و «برگشت‌پذیر» (بخش ۵).
-- اجرا: phpMyAdmin ← انتخاب دیتابیس کارام ← SQL ← پیست ← Go
--
-- ⚠️ قبل از اجرا روی داده‌ی واقعی، طبق docs/INSTALL.md بخش «بک‌آپ دیتابیس» یک فول‌بک بگیرید
--    (mysqldump یا Export از phpMyAdmin). این اسکریپت خودش هم پشتیبان داخل خود دیتابیس می‌سازد (بخش ۲).
--
-- منطق (سمت سرور، backend/src/Services/SyncService.php + Entities.php):
--   - rev/rev_device: شکستن تساوی LWW هم‌ثانیه — قاعده‌ی قطعی (updatedAt, rev, revDevice) یکسان در سرور و کلاینت
--   - dedupe: APKهای قدیمی هنوز لیست‌های seed («کارهای خانه»، «خرید هفتگی»، …) را push می‌کنند؛
--     گارد سمت سرور از این به بعد اجازه‌ی ساخت ردیف تکراری هم‌نام را نمی‌دهد؛ این اسکریپت
--     دوتایی‌های «موجود» را نرم ادغام می‌کند: نگه‌داشتن قدیمی‌ترین لیست، انتقال کارها به آن،
--     و حذف نرم (تومب‌استون) بقیه — هیچ ردیفی به‌صورت قطعی حذف نمی‌شود.

-- ===============================================================
-- ۱) ستون‌های نسخه (تکرارپذیر — فقط اگر نبود اضافه می‌شود)
-- ===============================================================

SET @schema = DATABASE();

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `lists` ADD COLUMN `rev` INT NOT NULL DEFAULT 0 COMMENT ''شماره‌ی نسخه‌ی سرور — شکستن تساوی LWW''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'lists' AND COLUMN_NAME = 'rev');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `lists` ADD COLUMN `rev_device` VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''شناسه‌ی دستگاه آخرین نویسنده''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'lists' AND COLUMN_NAME = 'rev_device');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `tasks` ADD COLUMN `rev` INT NOT NULL DEFAULT 0 COMMENT ''شماره‌ی نسخه‌ی سرور — شکستن تساوی LWW''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'rev');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `tasks` ADD COLUMN `rev_device` VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''شناسه‌ی دستگاه آخرین نویسنده''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'rev_device');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `subtasks` ADD COLUMN `rev` INT NOT NULL DEFAULT 0 COMMENT ''شماره‌ی نسخه‌ی سرور — شکستن تساوی LWW''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'subtasks' AND COLUMN_NAME = 'rev');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @ddl = (SELECT IF(
  COUNT(*) = 0,
  'ALTER TABLE `subtasks` ADD COLUMN `rev_device` VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''شناسه‌ی دستگاه آخرین نویسنده''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'subtasks' AND COLUMN_NAME = 'rev_device');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

-- ===============================================================
-- ۲) پشتیبان درون‌دیتابیسی (فقط کاربرانی که لیست تکراری هم‌نام سید دارند)
--    برگشت در بخش ۵ از همین جدول‌ها انجام می‌شود.
-- ===============================================================

CREATE TABLE IF NOT EXISTS `_karam_v16_bak_lists` LIKE `lists`;
CREATE TABLE IF NOT EXISTS `_karam_v16_bak_tasks` LIKE `tasks`;
CREATE TABLE IF NOT EXISTS `_karam_v16_bak_subtasks` LIKE `subtasks`;

INSERT INTO `_karam_v16_bak_lists` (`id`)
SELECT l.id FROM `lists` l
WHERE NOT EXISTS (SELECT 1 FROM `_karam_v16_bak_lists` b WHERE b.id = l.id)
  AND l.name IN ('کارهای خانه','خرید هفتگی','کنکور و مطالعه','ترید و بازارهای مالی','مالی و قبوض','کاری')
  AND l.user_id IN (
    SELECT user_id FROM `lists`
    WHERE name IN ('کارهای خانه','خرید هفتگی','کنکور و مطالعه','ترید و بازارهای مالی','مالی و قبوض','کاری')
      AND deleted_at IS NULL
    GROUP BY user_id, name HAVING COUNT(*) > 1
  );

INSERT INTO `_karam_v16_bak_tasks` (`id`)
SELECT t.id FROM `tasks` t
JOIN `lists` l ON l.id = t.list_id
WHERE NOT EXISTS (SELECT 1 FROM `_karam_v16_bak_tasks` b WHERE b.id = t.id)
  AND l.id IN (SELECT id FROM `_karam_v16_bak_lists`);

INSERT INTO `_karam_v16_bak_subtasks` (`id`)
SELECT s.id FROM `subtasks` s
WHERE NOT EXISTS (SELECT 1 FROM `_karam_v16_bak_subtasks` b WHERE b.id = s.id)
  AND s.task_id IN (SELECT id FROM `_karam_v16_bak_tasks`);

-- ===============================================================
-- ۳) دوتایی‌زدایی نرم (تکرارپذیر):
--    برای هر (کاربر، نام‌سید) که بیش از یک لیست زنده دارد:
--    قدیمی‌ترین (MIN id = اولین درج در سرور) نگه داشته می‌شود؛
--    کارهای بقیه به همان منتقل و بقیه تومب‌استون می‌شوند.
--    rev +۱ تا همه‌ی دستگاه‌ها با pull بعدی همگرا شوند (applied_at=الانِ سرور).
-- ===============================================================

DROP TEMPORARY TABLE IF EXISTS `_tmp_v16_dup`;
CREATE TEMPORARY TABLE `_tmp_v16_dup` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name`    VARCHAR(120) NOT NULL,
  `keep_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`user_id`, `name`)
) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `_tmp_v16_dup` (`user_id`, `name`, `keep_id`)
SELECT user_id, name, MIN(id) AS keep_id
FROM `lists`
WHERE deleted_at IS NULL
  AND name IN ('کارهای خانه','خرید هفتگی','کنکور و مطالعه','ترید و بازارهای مالی','مالی و قبوض','کاری')
GROUP BY user_id, name
HAVING COUNT(*) > 1;

-- انتقال کارها از لیست‌های بازنده به نگه‌دارنده
UPDATE `tasks` t
JOIN `lists` l ON l.id = t.list_id
JOIN `_tmp_v16_dup` d ON d.user_id = l.user_id AND d.name = l.name
SET t.list_id     = d.keep_id,
    t.updated_at  = NOW(),
    t.applied_at  = NOW(),
    t.rev         = COALESCE(t.rev, 0) + 1,
    t.rev_device  = 'server-migration-v1.6'
WHERE l.id <> d.keep_id
  AND l.deleted_at IS NULL;

-- تومب‌استون نرم لیست‌های بازنده (هیچ حذف قطعی‌ای انجام نمی‌شود)
UPDATE `lists` l
JOIN `_tmp_v16_dup` d ON d.user_id = l.user_id AND d.name = l.name
SET l.deleted_at  = NOW(),
    l.updated_at  = NOW(),
    l.applied_at  = NOW(),
    l.rev         = COALESCE(l.rev, 0) + 1,
    l.rev_device  = 'server-migration-v1.6'
WHERE l.id <> d.keep_id
  AND l.deleted_at IS NULL;

DROP TEMPORARY TABLE IF EXISTS `_tmp_v16_dup`;

-- ===============================================================
-- ۴) راستی‌آزمایی — باید صفر ردیف برگرداند:
-- ===============================================================

SELECT user_id, name, COUNT(*) AS alive_copies
FROM `lists`
WHERE deleted_at IS NULL
  AND name IN ('کارهای خانه','خرید هفتگی','کنکور و مطالعه','ترید و بازارهای مالی','مالی و قبوض','کاری')
GROUP BY user_id, name
HAVING COUNT(*) > 1;

-- ===============================================================
-- ۵) راه بازگشت (فقط در صورت نیاز — دستورات زیر به‌صورت دستی اجرا شود)
--    داده به حالت «قبل از مهاجرت» برمی‌گردد؛ ستون‌های rev اضافه می‌مانند (بی‌ضرر).
-- ===============================================================
-- بازگرداندن کارها به لیست اصلی‌شان:
-- UPDATE `tasks` t JOIN `_karam_v16_bak_tasks` b ON b.id = t.id
--   SET t.list_id = b.list_id, t.updated_at = b.updated_at, t.applied_at = NOW(), t.rev = COALESCE(t.rev,0)+1, t.rev_device = 'server-rollback-v1.6';
-- بازگرداندن لیست‌ها (پاک‌کردن تومب‌استون‌ها و مقادیر تغییر یافته):
-- UPDATE `lists` l JOIN `_karam_v16_bak_lists` b ON b.id = l.id
--   SET l.name = b.name, l.emoji = b.emoji, l.color = b.color, l.sort_order = b.sort_order,
--       l.created_at = b.created_at, l.updated_at = b.updated_at, l.deleted_at = b.deleted_at,
--       l.applied_at = NOW(), l.rev = COALESCE(l.rev,0)+1, l.rev_device = 'server-rollback-v1.6';
-- UPDATE `subtasks` s JOIN `_karam_v16_bak_subtasks` b ON b.id = s.id
--   SET s.title = b.title, s.done = b.done, s.task_id = b.task_id, s.updated_at = b.updated_at, s.applied_at = NOW();
-- (اگر میزبان شما اجازه‌ی اجرای چند دستمه‌ای نداد، هر دستور را جداگانه اجرا کنید.)
