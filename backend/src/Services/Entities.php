<?php

declare(strict_types=1);

/**
 * کارام — لایه‌ی موجودیت‌های سینک‌پذیر (lists / tasks / subtasks)
 *
 * قرارداد سینک (دو سوی کلاینت و سرور یکسان است):
 *   id (UUID سمت کلاینت) + updatedAt + deletedAt (حذف نرم)
 * برنده‌ی تضارب: رکورد با updatedAt جدیدتر (Last-Write-Wins)؛ مساوی → نسخه‌ی کلاینت اعمال می‌شود.
 * همه‌ی تاریخ‌ها UTC.
 */

final class Entities
{
    public const ENTITY_LISTS = 'lists';
    public const ENTITY_TASKS = 'tasks';
    public const ENTITY_SUBTASKS = 'subtasks';

    public const LIST_COLORS = ['teal', 'amber', 'indigo', 'emerald', 'rose', 'purple'];
    public const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
    public const REPEATS = ['none', 'daily', 'weekly', 'monthly'];

    private static array $tables = [
        self::ENTITY_LISTS => 'lists',
        self::ENTITY_TASKS => 'tasks',
        self::ENTITY_SUBTASKS => 'subtasks',
    ];

    /** خطای ساختاری والد (مثلاً کار بدون لیست) — در سینک به rejected تبدیل می‌شود */
    public static function reject(string $reason): never
    {
        throw new EntityReject($reason);
    }

    /* -------------------------------------------------
     * تبدیل تاریخ
     * ------------------------------------------------- */

    /** ISO UTC (کلاینت) → «Y-m-d H:i:s» برای دیتابیس */
    public static function isoToSql(?string $iso): ?string
    {
        if ($iso === null || $iso === '') {
            return null;
        }
        $ts = strtotime($iso);
        if ($ts === false) {
            throw new ValidationError('فرمت تاریخ نامعتبر است');
        }
        return gmdate('Y-m-d H:i:s', $ts);
    }

    /** «Y-m-d H:i:s» دیتابیس → ISO UTC با میلی‌ثانیه‌ی صفر (سازگار با مقایسه‌ی کلاینت) */
    public static function sqlToIso(?string $sql): ?string
    {
        if ($sql === null || $sql === '') {
            return null;
        }
        $ts = strtotime($sql);
        if ($ts === false) {
            return null;
        }
        return gmdate('Y-m-d\TH:i:s.000\Z', $ts);
    }

    /* -------------------------------------------------
     * نرمال‌سازی ورودی کلاینت → ستون‌ها
     * ------------------------------------------------- */

    /**
     * @return array<string,mixed> نقشه‌ی ستون => مقدار
     */
    public static function normalize(string $entity, array $in, bool $partial): array
    {
        // زمان‌های سیستمی مشترک
        $cols = [];
        if (isset($in['createdAt']) && !$partial) {
            $cols['created_at'] = self::isoToSql(Validator::isoDateTime($in, 'createdAt'));
        }
        if ($partial && !array_key_exists('updatedAt', $in)) {
            throw new ValidationError('فیلد «updatedAt» برای به‌روزرسانی الزامی است');
        }
        $cols['updated_at'] = self::isoToSql(Validator::isoDateTime($in, 'updatedAt'));
        $cols['deleted_at'] = self::isoToSql(Validator::isoDateTime($in, 'deletedAt', false));

        switch ($entity) {
            case self::ENTITY_LISTS:
                $cols += self::normalizeList($in, $partial);
                break;
            case self::ENTITY_TASKS:
                $cols += self::normalizeTask($in, $partial);
                break;
            case self::ENTITY_SUBTASKS:
                $cols += self::normalizeSubtask($in, $partial);
                break;
            default:
                throw new ValidationError('موجودیت ناشناخته');
        }
        return $cols;
    }

    private static function normalizeList(array $in, bool $partial): array
    {
        $cols = [];
        if (!$partial || array_key_exists('name', $in)) {
            $cols['name'] = Validator::str($in, 'name', 1, 120);
        }
        if (!$partial || array_key_exists('emoji', $in)) {
            $cols['emoji'] = Validator::str($in, 'emoji', 1, 16);
        }
        if (!$partial || array_key_exists('color', $in)) {
            $cols['color'] = Validator::enum($in, 'color', self::LIST_COLORS, $partial ? null : 'teal', false)
                ?? ($partial ? null : 'teal');
            if ($cols['color'] === null) {
                unset($cols['color']);
            }
        }
        if (!$partial || array_key_exists('sortOrder', $in)) {
            $cols['sort_order'] = Validator::int($in, 'sortOrder', 0, 100000, $partial ? null : 0, false)
                ?? ($partial ? null : 0);
            if ($cols['sort_order'] === null) {
                unset($cols['sort_order']);
            }
        }
        return $cols;
    }

    private static function normalizeTask(array $in, bool $partial): array
    {
        $cols = [];
        if (!$partial || array_key_exists('title', $in)) {
            $cols['title'] = Validator::str($in, 'title', 1, 255);
        }
        if (!$partial || array_key_exists('notes', $in)) {
            $n = Validator::str($in, 'notes', 0, 10000, false);
            $cols['notes'] = $n ?? '';
        }
        if (!$partial || array_key_exists('priority', $in)) {
            $p = Validator::enum($in, 'priority', self::PRIORITIES, $partial ? null : 'normal', false);
            if ($p !== null) {
                $cols['priority'] = $p;
            }
        }
        if (!$partial || array_key_exists('dueDate', $in)) {
            $cols['due_date'] = Validator::dateOnly($in, 'dueDate');
        }
        if (!$partial || array_key_exists('dueTime', $in)) {
            $cols['due_time'] = Validator::timeOnly($in, 'dueTime');
        }
        if (!$partial || array_key_exists('reminderMinutes', $in)) {
            $rm = Validator::int($in, 'reminderMinutes', 0, 10080, null, false);
            $cols['reminder_minutes'] = $rm;
        }
        if (!$partial || array_key_exists('repeat', $in)) {
            $r = Validator::enum($in, 'repeat', self::REPEATS, $partial ? null : 'none', false);
            if ($r !== null) {
                $cols['repeat'] = $r;
            }
        }
        if (!$partial || array_key_exists('completedAt', $in)) {
            $cols['completed_at'] = Validator::isoDateTime($in, 'completedAt', false);
        }
        return $cols;
    }

    private static function normalizeSubtask(array $in, bool $partial): array
    {
        $cols = [];
        if (!$partial || array_key_exists('title', $in)) {
            $cols['title'] = Validator::str($in, 'title', 1, 255);
        }
        if (!$partial || array_key_exists('done', $in)) {
            $cols['done'] = (int) (Validator::bool($in, 'done', false) ?? false);
        }
        return $cols;
    }

    /* -------------------------------------------------
     * والد‌ها (task نیاز به list_id دارد، subtask نیاز به task_id)
     * ------------------------------------------------- */

    /**
     * شناسه‌ی عددی والد را با بررسی مالکیت اضافه می‌کند؛ والد نبود → EntityReject.
     * در حالت اختیاری (PATCH جزئی) اگر کلید والد در ورودی نباشد، رد می‌شود (تغییری نمی‌کند).
     * @param array<string,mixed> $cols
     * @return array<string,mixed>
     */
    public static function resolveParents(string $entity, array $cols, int $userId, array $in, bool $requireParent = true): array
    {
        $pdo = Database::pdo();
        if ($entity === self::ENTITY_TASKS) {
            if (!array_key_exists('listId', $in)) {
                if ($requireParent) {
                    self::reject('missing_parent');
                }
                return $cols;
            }
            $listUuid = Validator::uuid($in, 'listId');
            // والدِ حذف‌شده (تومب‌استون) والد نیست — جلوگیری از پنهان‌شدن کار زیر لیست مرده
            $stmt = $pdo->prepare('SELECT id FROM lists WHERE uuid = :uuid AND user_id = :uid AND deleted_at IS NULL LIMIT 1');
            $stmt->execute([':uuid' => $listUuid, ':uid' => $userId]);
            $row = $stmt->fetch();
            if ($row === false) {
                self::reject('missing_parent');
            }
            $cols['list_id'] = (int) $row['id'];
        }
        if ($entity === self::ENTITY_SUBTASKS) {
            if (!array_key_exists('taskId', $in)) {
                if ($requireParent) {
                    self::reject('missing_parent');
                }
                return $cols;
            }
            $taskUuid = Validator::uuid($in, 'taskId');
            $stmt = $pdo->prepare('SELECT id FROM tasks WHERE uuid = :uuid AND user_id = :uid AND deleted_at IS NULL LIMIT 1');
            $stmt->execute([':uuid' => $taskUuid, ':uid' => $userId]);
            $row = $stmt->fetch();
            if ($row === false) {
                self::reject('missing_parent');
            }
            $cols['task_id'] = (int) $row['id'];
        }
        return $cols;
    }

    /* -------------------------------------------------
     * مخزن (Prepared Statement در همه‌جا)
     * ------------------------------------------------- */

    public static function findByUuid(string $entity, int $userId, string $uuid): ?array
    {
        $table = self::$tables[$entity];
        $join = '';
        $selectExtra = '';
        if ($entity === self::ENTITY_TASKS) {
            $join = 'JOIN lists pl ON pl.id = t.list_id';
            $selectExtra = ', pl.uuid AS parent_uuid';
        } elseif ($entity === self::ENTITY_SUBTASKS) {
            $join = 'JOIN tasks pt ON pt.id = t.task_id';
            $selectExtra = ', pt.uuid AS parent_uuid';
        }
        $stmt = Database::pdo()->prepare(
            "SELECT t.*{$selectExtra} FROM {$table} t {$join} WHERE t.uuid = :uuid AND t.user_id = :uid LIMIT 1"
        );
        $stmt->execute([':uuid' => $uuid, ':uid' => $userId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * درج رکورد کلاینت (ایده‌مپوتنت بر اساس uuid)
     * @param array<string,mixed> $cols
     */
    public static function insertClient(string $entity, int $userId, string $uuid, array $cols): void
    {
        $table = self::$tables[$entity];
        $cols += ['created_at' => $cols['updated_at']]; // اگر created_at نیامده بود
        $cols['uuid'] = $uuid;
        $cols['user_id'] = $userId;
        $cols['applied_at'] = gmdate('Y-m-d H:i:s'); // کرسر قطعی سینک (ترتیب اعمال سرور)

        $columns = array_keys($cols);
        $placeholders = implode(', ', array_map(static fn (string $c): string => ':' . $c, $columns));
        $columnList = implode(', ', array_map(static fn (string $c): string => "`{$c}`", $columns));

        $stmt = Database::pdo()->prepare(
            "INSERT INTO {$table} ({$columnList}) VALUES ({$placeholders})"
        );
        foreach ($cols as $c => $v) {
            $stmt->bindValue(':' . $c, $v);
        }
        $stmt->execute();
    }

    /**
     * به‌روزرسانی با ستون‌های داده‌شده (updated_at همیشه صریح ست می‌شود)
     * @param array<string,mixed> $cols
     */
    public static function updateClient(string $entity, int $userId, int $id, array $cols): void
    {
        $table = self::$tables[$entity];
        $cols['applied_at'] = gmdate('Y-m-d H:i:s'); // کرسر قطعی سینک (ترتیب اعمال سرور)
        $sets = implode(', ', array_map(static fn (string $c): string => "`{$c}` = :{$c}", array_keys($cols)));
        $cols['id_where'] = $id;
        $cols['user_where'] = $userId;

        $stmt = Database::pdo()->prepare(
            "UPDATE {$table} SET {$sets} WHERE id = :id_where AND user_id = :user_where"
        );
        foreach ($cols as $c => $v) {
            $stmt->bindValue(':' . $c, $v);
        }
        $stmt->execute();
    }

    /**
     * رکوردهای اعمال‌شده روی سرور از یک نقطه (شامل حذف‌شده‌های نرم) — برای pull سینک.
     * کرسر بر اساس applied_at است (ترتیب اعمال سرور) تا هیچ تغییری حتی با تاریخِ عقب‌ترِ کلاینت از دست نرود.
     * $limit برای صفحه‌بندی (SyncService::PULL_LIMIT + 1 برای تشخیص incomplete).
     * @return array<int,array>
     */
    public static function pullSince(string $entity, int $userId, ?string $cursorSql, ?int $limit = null): array
    {
        $table = self::$tables[$entity];
        $join = '';
        $selectExtra = '';
        if ($entity === self::ENTITY_TASKS) {
            $join = 'JOIN lists pl ON pl.id = t.list_id';
            $selectExtra = ', pl.uuid AS parent_uuid';
        } elseif ($entity === self::ENTITY_SUBTASKS) {
            $join = 'JOIN tasks pt ON pt.id = t.task_id';
            $selectExtra = ', pt.uuid AS parent_uuid';
        }

        $sql = "SELECT t.*{$selectExtra} FROM {$table} t {$join} WHERE t.user_id = :uid";
        $params = [':uid' => $userId];
        if ($cursorSql !== null) {
            $sql .= ' AND t.applied_at >= :cursor';
            $params[':cursor'] = $cursorSql;
        }
        $sql .= ' ORDER BY t.applied_at ASC, t.id ASC';
        if ($limit !== null && $limit > 0) {
            $sql .= ' LIMIT ' . (int) $limit;
        }

        $stmt = Database::pdo()->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /* -------------------------------------------------
     * خروجی کلاینت (camelCase)
     * ------------------------------------------------- */

    /**
     * @param array<string,mixed> $row سطر دیتابیس
     * @return array<string,mixed> موجودیت به فرمت کلاینت
     */
    public static function toClient(string $entity, array $row): array
    {
        $base = [
            'id' => (string) $row['uuid'],
            'createdAt' => self::sqlToIso($row['created_at']),
            'updatedAt' => self::sqlToIso($row['updated_at']),
            'deletedAt' => self::sqlToIso($row['deleted_at'] ?? null),
            // شکستن تساوی LWW — نسخه‌ی سرور روی همه‌ی کلاینت‌ها یکسان مصرف می‌شود
            'rev' => (int) ($row['rev'] ?? 0),
            'revDevice' => (string) ($row['rev_device'] ?? ''),
        ];

        switch ($entity) {
            case self::ENTITY_LISTS:
                return $base + [
                    'name' => (string) $row['name'],
                    'emoji' => (string) ($row['emoji'] ?? ''),
                    'color' => (string) $row['color'],
                    'sortOrder' => (int) $row['sort_order'],
                ];
            case self::ENTITY_TASKS:
                return $base + [
                    'listId' => (string) ($row['parent_uuid'] ?? ''),
                    'title' => (string) $row['title'],
                    'notes' => (string) ($row['notes'] ?? ''),
                    'priority' => (string) $row['priority'],
                    'dueDate' => $row['due_date'] ?? null,
                    'dueTime' => $row['due_time'] !== null ? substr((string) $row['due_time'], 0, 5) : null,
                    'reminderMinutes' => $row['reminder_minutes'] !== null ? (int) $row['reminder_minutes'] : null,
                    'repeat' => (string) $row['repeat'],
                    'completedAt' => self::sqlToIso($row['completed_at'] ?? null),
                ];
            case self::ENTITY_SUBTASKS:
                return $base + [
                    'taskId' => (string) ($row['parent_uuid'] ?? ''),
                    'title' => (string) $row['title'],
                    'done' => (bool) $row['done'],
                ];
            default:
                throw new ValidationError('موجودیت ناشناخته');
        }
    }
}

/** رد شدن یک آیتم در سینک با دلیل مشخص */
final class EntityReject extends RuntimeException
{
}
