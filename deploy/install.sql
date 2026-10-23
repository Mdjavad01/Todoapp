# کارام — اسکریپت نصب دیتابیس (MySQL/MariaDB 5.7+ / utf8mb4)
# همه‌ی تاریخ‌ها UTC ذخیره می‌شوند.
# نحوه‌ی اجرا: phpMyAdmin → Import یا: mysql -u USER -p DBNAME < install.sql

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------
-- کاربران
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`          CHAR(36)     NOT NULL,
  `display_name`  VARCHAR(100) NULL,
  `status`        ENUM('active','blocked','deleted') NOT NULL DEFAULT 'active',
  `premium_until` DATETIME     NULL DEFAULT NULL COMMENT 'انقضای اشتراک (NULL=عادی)',
  `last_login_at` DATETIME     NULL DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_uuid` (`uuid`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- هویت‌های کاربر: ایمیل / موبایل / chat_id بله
CREATE TABLE IF NOT EXISTS `user_identities` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `type`        ENUM('email','mobile','bale_chat_id') NOT NULL,
  `value`       VARCHAR(190) NOT NULL,
  `is_primary`  TINYINT(1)   NOT NULL DEFAULT 0,
  `verified_at` DATETIME     NULL DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_identity` (`type`,`value`),
  KEY `idx_identities_user` (`user_id`),
  CONSTRAINT `fk_identities_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- درخواست‌های کد تأیید (OTP) — فقط هشِ کد ذخیره می‌شود
CREATE TABLE IF NOT EXISTS `otp_requests` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `identity_type`  ENUM('email','bale') NOT NULL,
  `identity_value` VARCHAR(190) NOT NULL,
  `code_hash`      VARCHAR(255) NOT NULL,
  `purpose`        ENUM('login','admin_2fa') NOT NULL DEFAULT 'login',
  `attempts`       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip`             VARCHAR(45)  NULL,
  `expires_at`     DATETIME     NOT NULL,
  `consumed_at`    DATETIME     NULL DEFAULT NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_otp_identity` (`identity_value`,`created_at`),
  KEY `idx_otp_ip` (`ip`,`created_at`),
  KEY `idx_otp_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- توکن‌های رفرش — مخصوص هر دستگاه (وب/اندروید)
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `device_id`    CHAR(36)      NOT NULL COMMENT 'شناسه‌ی دستگاه سمت کلاینت',
  `device_name`  VARCHAR(120)  NULL,
  `token_hash`   VARCHAR(255)  NOT NULL,
  `user_agent`   VARCHAR(255)  NULL,
  `ip`           VARCHAR(45)   NULL,
  `issued_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   DATETIME      NOT NULL,
  `revoked_at`   DATETIME      NULL DEFAULT NULL,
  `last_used_at` DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_hash` (`token_hash`),
  KEY `idx_refresh_user` (`user_id`,`revoked_at`),
  KEY `idx_refresh_expires` (`expires_at`),
  CONSTRAINT `fk_refresh_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- داده‌ی اپ: لیست‌ها / کارها / زیرکارها / یادآورها
-- (uuid سمت کلاینت + updated_at + حذف نرم برای سینک)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lists` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)     NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `emoji`      VARCHAR(16)  NULL,
  `color`      VARCHAR(16)  NOT NULL DEFAULT 'teal',
  `sort_order` INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     NULL DEFAULT NULL,
  `applied_at` DATETIME     NULL DEFAULT NULL COMMENT 'زمان اعمال سمت سرور — کرسر قطعی سینک',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lists_uuid` (`uuid`),
  KEY `idx_lists_user` (`user_id`,`deleted_at`),
  KEY `idx_lists_applied` (`user_id`,`applied_at`),
  CONSTRAINT `fk_lists_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tasks` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`             CHAR(36)     NOT NULL,
  `user_id`          BIGINT UNSIGNED NOT NULL,
  `list_id`          BIGINT UNSIGNED NOT NULL,
  `title`            VARCHAR(255) NOT NULL,
  `notes`            TEXT         NULL,
  `priority`         ENUM('urgent','high','normal','low') NOT NULL DEFAULT 'normal',
  `due_date`         DATE         NULL DEFAULT NULL,
  `due_time`         TIME         NULL DEFAULT NULL,
  `reminder_minutes` INT          NULL DEFAULT NULL,
  `repeat`           ENUM('none','daily','weekly','monthly') NOT NULL DEFAULT 'none',
  `completed_at`     DATETIME     NULL DEFAULT NULL,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME     NULL DEFAULT NULL,
  `applied_at`       DATETIME     NULL DEFAULT NULL COMMENT 'زمان اعمال سمت سرور — کرسر قطعی سینک',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tasks_uuid` (`uuid`),
  KEY `idx_tasks_user` (`user_id`,`deleted_at`),
  KEY `idx_tasks_applied` (`user_id`,`applied_at`),
  KEY `idx_tasks_list` (`list_id`),
  KEY `idx_tasks_due` (`due_date`),
  CONSTRAINT `fk_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tasks_list` FOREIGN KEY (`list_id`) REFERENCES `lists` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subtasks` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)     NOT NULL,
  `task_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `title`      VARCHAR(255) NOT NULL,
  `done`       TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     NULL DEFAULT NULL,
  `applied_at` DATETIME     NULL DEFAULT NULL COMMENT 'زمان اعمال سمت سرور — کرسر قطعی سینک',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subtasks_uuid` (`uuid`),
  KEY `idx_subtasks_task` (`task_id`),
  KEY `idx_subtasks_applied` (`user_id`,`applied_at`),
  CONSTRAINT `fk_subtasks_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_subtasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminders` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)  NOT NULL,
  `task_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `fire_at`    DATETIME  NOT NULL,
  `fired_at`   DATETIME  NULL DEFAULT NULL,
  `created_at` DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME  NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminders_uuid` (`uuid`),
  KEY `idx_reminders_fire` (`fire_at`,`fired_at`),
  KEY `idx_reminders_task` (`task_id`),
  CONSTRAINT `fk_reminders_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reminders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- اشتراک و پرداخت
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `plans` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`        CHAR(36)    NOT NULL,
  `code`        VARCHAR(50) NOT NULL COMMENT 'monthly / annual / lifetime',
  `title`       VARCHAR(120) NOT NULL,
  `months`      INT         NOT NULL DEFAULT 1 COMMENT 'مدت اشتراک؛ 0=دائمی',
  `price_rials` BIGINT      NOT NULL DEFAULT 0 COMMENT 'مبلغ به ریال — فقط از سرور',
  `description` VARCHAR(255) NULL,
  `is_active`   TINYINT(1)  NOT NULL DEFAULT 1,
  `sort_order`  INT         NOT NULL DEFAULT 0,
  `created_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plans_code` (`code`),
  UNIQUE KEY `uq_plans_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coupons` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)    NOT NULL,
  `code`       VARCHAR(50) NOT NULL,
  `type`       ENUM('percent','amount') NOT NULL,
  `value`      INT         NOT NULL COMMENT 'درصد یا مبلغ به ریال',
  `expires_at` DATETIME    NULL DEFAULT NULL,
  `max_uses`   INT         NULL DEFAULT NULL,
  `used_count` INT         NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupons_code` (`code`),
  UNIQUE KEY `uq_coupons_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`            CHAR(36)  NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `plan_id`         BIGINT UNSIGNED NOT NULL,
  `coupon_id`       BIGINT UNSIGNED NULL DEFAULT NULL,
  `amount_rials`    BIGINT    NOT NULL COMMENT 'مبلغ نهایی پس از تخفیف',
  `discount_rials`  BIGINT    NOT NULL DEFAULT 0,
  `status`          ENUM('created','redirected','paid','failed','pending_review','approved','rejected','refunded') NOT NULL DEFAULT 'created',
  `description`     VARCHAR(255) NULL,
  `created_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_uuid` (`uuid`),
  KEY `idx_orders_user` (`user_id`,`status`),
  KEY `idx_orders_status` (`status`,`created_at`),
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_orders_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`),
  CONSTRAINT `fk_orders_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`          CHAR(36)  NOT NULL,
  `order_id`      BIGINT UNSIGNED NOT NULL,
  `gateway`       ENUM('zibal','aqayepardakht','card_to_card') NOT NULL,
  `status`        ENUM('created','redirected','paid','failed','pending_review','approved','rejected','refunded') NOT NULL DEFAULT 'created',
  `amount_rials`  BIGINT    NOT NULL,
  `gateway_ref`   VARCHAR(190) NULL COMMENT 'ref/track درگاه',
  `verified_at`   DATETIME  NULL DEFAULT NULL,
  `verify_payload` TEXT    NULL,
  `created_at`    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_uuid` (`uuid`),
  KEY `idx_payments_order` (`order_id`),
  KEY `idx_payments_status` (`status`),
  CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- رسیدهای کارت‌به‌کارت (فایل بیرون از مسیر عمومی ذخیره می‌شود)
CREATE TABLE IF NOT EXISTS `receipts` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`    BIGINT UNSIGNED NOT NULL,
  `file_path`   VARCHAR(255) NOT NULL COMMENT 'مسیر امن بیرون از public_html',
  `mime`        VARCHAR(80)  NOT NULL,
  `size_bytes`  INT UNSIGNED NOT NULL,
  `uploaded_ip` VARCHAR(45)  NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_receipts_order` (`order_id`),
  CONSTRAINT `fk_receipts_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- اشتراک‌ها — جدا از روش پرداخت (منبع فعال‌سازی مشخص است)
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)  NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `plan_id`    BIGINT UNSIGNED NULL DEFAULT NULL,
  `order_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `source`     ENUM('web_gateway','card_to_card','admin_grant','store_bazaar') NOT NULL,
  `starts_at`  DATETIME  NOT NULL,
  `expires_at` DATETIME  NULL DEFAULT NULL COMMENT 'NULL=دائمی',
  `created_at` DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subs_uuid` (`uuid`),
  KEY `idx_subs_user` (`user_id`,`expires_at`),
  CONSTRAINT `fk_subs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_subs_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`),
  CONSTRAINT `fk_subs_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- قالب‌ها و بسته‌های شغلی
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `templates` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)     NOT NULL,
  `title`      VARCHAR(150) NOT NULL,
  `emoji`      VARCHAR(16)  NULL,
  `category`   VARCHAR(60)  NULL COMMENT 'kit=بسته‌ی شغلی / checklist=قالب',
  `description` VARCHAR(255) NULL,
  `is_premium` TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_templates_uuid` (`uuid`),
  KEY `idx_templates_active` (`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `template_items` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_id` BIGINT UNSIGNED NOT NULL,
  `title`       VARCHAR(255) NOT NULL,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_titems_template` (`template_id`,`sort_order`),
  CONSTRAINT `fk_titems_template` FOREIGN KEY (`template_id`) REFERENCES `templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- ادمین‌ها
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_roles` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(30)  NOT NULL COMMENT 'superadmin / support',
  `title`       VARCHAR(80)  NOT NULL,
  `permissions` TEXT         NULL COMMENT 'JSON',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admins` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`            CHAR(36)     NOT NULL,
  `username`        VARCHAR(64)  NOT NULL,
  `password_hash`   VARCHAR(255) NOT NULL COMMENT 'Argon2id یا bcrypt',
  `role_id`         BIGINT UNSIGNED NOT NULL,
  `is_active`       TINYINT(1)   NOT NULL DEFAULT 1,
  `totp_secret`     VARCHAR(255) NULL COMMENT 'OTP دومرحله‌ای اختیاری',
  `failed_attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`    DATETIME     NULL DEFAULT NULL,
  `last_login_at`   DATETIME     NULL DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admins_username` (`username`),
  UNIQUE KEY `uq_admins_uuid` (`uuid`),
  KEY `idx_admins_role` (`role_id`),
  CONSTRAINT `fk_admins_role` FOREIGN KEY (`role_id`) REFERENCES `admin_roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   BIGINT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `csrf_token` VARCHAR(64)  NOT NULL,
  `ip`         VARCHAR(45)  NULL,
  `user_agent` VARCHAR(255) NULL,
  `expires_at` DATETIME     NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_sessions_hash` (`token_hash`),
  KEY `idx_admin_sessions_admin` (`admin_id`),
  CONSTRAINT `fk_admin_sessions_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- اطلاع‌رسانی و تنظیمات و لاگ‌ها
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `announcements` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       CHAR(36)     NOT NULL,
  `title`      VARCHAR(150) NOT NULL,
  `body`       TEXT         NOT NULL,
  `type`       ENUM('info','warning','premium') NOT NULL DEFAULT 'info',
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `starts_at`  DATETIME     NULL DEFAULT NULL,
  `ends_at`    DATETIME     NULL DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_announcements_uuid` (`uuid`),
  KEY `idx_announcements_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `key`        VARCHAR(80)  NOT NULL,
  `value`      TEXT         NULL,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_type` ENUM('admin','user','system') NOT NULL DEFAULT 'admin',
  `actor_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `action`     VARCHAR(80)  NOT NULL,
  `entity`     VARCHAR(60)  NULL,
  `entity_id`  VARCHAR(64)  NULL,
  `details`    TEXT         NULL,
  `ip`         VARCHAR(45)  NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_actor` (`actor_type`,`actor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `provider_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider`   ENUM('smtp','bale','zibal','aqayepardakht') NOT NULL,
  `direction`  ENUM('out','in') NOT NULL DEFAULT 'out',
  `status`     ENUM('success','error') NOT NULL,
  `identity`   VARCHAR(190) NULL COMMENT 'گیرنده/فرستنده',
  `subject`    VARCHAR(190) NULL,
  `message`    TEXT         NULL,
  `context`    TEXT         NULL COMMENT 'جزئیات فنی خطا',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_provider_logs` (`provider`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- داده‌ی اولیه
-- ---------------------------------------------------------------
INSERT INTO `admin_roles` (`code`, `title`, `permissions`) VALUES
  ('superadmin', 'مدیر کل', '{}'),
  ('support', 'پشتیبان', '{"users.view":true,"orders.view":true,"orders.review":true}')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

INSERT INTO `plans` (`uuid`, `code`, `title`, `months`, `price_rials`, `description`, `is_active`, `sort_order`) VALUES
  (UUID(), 'monthly',  'اشتراک ماهانه',  1, 490000,  'یک ماه دسترسی کامل به کارام پرو', 1, 1),
  (UUID(), 'annual',   'اشتراک سالانه', 12, 1900000, 'دوازده ماه دسترسی کامل — ۶۰٪ تخفیف', 1, 2),
  (UUID(), 'lifetime', 'دائمی',          0, 4900000, 'یکبار پرداخت، همیشه پرو', 1, 3)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

INSERT INTO `settings` (`key`, `value`) VALUES
  ('app_name', 'کارام'),
  ('maintenance_mode', '0'),
  ('min_app_version', '1.0.0'),
  ('paywall_title', 'کارام پرو (Karam Pro)'),
  ('gateway_zibal_enabled', '0'),
  ('gateway_aqayepardakht_enabled', '0'),
  ('gateway_card_enabled', '0'),
  ('card_numbers', '[]'),
  ('provider_email_enabled', '0'),
  ('provider_bale_enabled', '0')
ON DUPLICATE KEY UPDATE `key` = `key`;

SET FOREIGN_KEY_CHECKS = 1;
