<?php

declare(strict_types=1);

/**
 * کارام — سرویس سینک دوسویه (فاز ۲ + ترمیم جریان فاز ۱)
 *
 * قرارداد:
 *   ۱) push: تغییرات محلی کلاینت (آیتم کامل با updatedAt) به‌ترتیب lists → tasks → subtasks اعمال می‌شود.
 *   ۲) pull: رکوردهای تغییرکرده از «کرسر» قبلی (شامل حذف‌شده‌های نرم) با صفحه‌بندی (PULL_LIMIT)
 *      و پرچم incomplete برگردانده می‌شود؛ کلاینت با همان کرسر تا پایان incomplete=false ادامه می‌دهد.
 *   ۳) کرسر جدید = لحظه‌ی سرور (ثانیه‌ای)؛ خواندن با >= تا هیچ تغییری از دست نرود.
 *
 * تضارب LWW قطعی (یکسان در سرور و کلاینت — اصلاح واگرایی هم‌ثانیه):
 *   کلید مقایسه = (updatedAt, rev, revDevice)
 *   - updatedAt جدیدتر برنده است؛
 *   - در تساوی ثانیه، rev بزرگ‌تر برنده است (rev هر بار در سرور +۱ می‌شود)؛
 *   - در تساوی rev، revDevice بزرگ‌تر (مقایسه‌ی متنی) برنده است؛ تساوی کامل = اعمال مجدد بی‌ضرر (idempotent).
 *
 * ساعت کلاینت (اصلاح ردِ بی‌صدا):
 *   updatedAtِ بیش از ۵ دقیقه در آینده رد نمی‌شود؛ به زمان سرور بریده می‌شود و در پاسخ
 *   clockSkew اعلام می‌گردد تا کلاینت اختلاف ساعت را جبران کند و پیام بدهد.
 *
 * dedupe داده‌ی آزمایشی (APKهای قدیمی):
 *   درج لیست تازه با نام سیدِ شناخته‌شده، وقتی لیست زنده‌ی هم‌نام وجود دارد، ساخته نمی‌شود؛
 *   نسخه‌ی موجود سرور در pull برمی‌گردد تا کلاینت همگرا شود (مهاجرت: deploy/upgrade-v1.6.sql).
 */

final class SyncService
{
    private const ENTITIES = [
        Entities::ENTITY_LISTS,
        Entities::ENTITY_TASKS,
        Entities::ENTITY_SUBTASKS,
    ];

    /** حداکثر رکورد pull برای هر موجودیت در هر درخواست — ادامه با همان کرسر تا incomplete=false */
    private const PULL_LIMIT = 800;

    /** نام‌های دقیق لیست‌های آزمایشی نسخه‌های قدیمی (frontend/src/db/seed.ts حذف‌شده) — مرز dedupe سرور */
    public const SEED_LIST_NAMES = [
        'کارهای خانه',
        'خرید هفتگی',
        'کنکور و مطالعه',
        'ترید و بازارهای مالی',
        'مالی و قبوض',
        'کاری',
    ];

    /** @return array<string,mixed> پاسخ کامل سینک */
    public static function run(int $userId, array $payload): array
    {
        $pdo = Database::pdo();

        // کرسر ورودی (ISO) → SQL
        // امنیت مرزی: کرسر = ثانیه‌ی بریده‌شده‌ی لحظه‌ی پاسخ قبلی است؛ شرط >= یعنی سبد همان ثانیه
        // (حتی رکوردهایی که بعد از snapshot در همان ثانیه اعمال شده‌اند) دوباره خوانده می‌شود → هیچ تغییری از دست نمی‌رود.
        $cursorIso = isset($payload['cursor']) && is_string($payload['cursor']) && $payload['cursor'] !== ''
            ? $payload['cursor']
            : null;
        $cursorSql = null;
        if ($cursorIso !== null) {
            $ts = strtotime($cursorIso);
            if ($ts === false) {
                throw new ValidationError('کرسر سینک نامعتبر است');
            }
            $cursorSql = gmdate('Y-m-d H:i:s', $ts);
        }

        // شناسه‌ی دستگاه برای شکستن تساوی LWW (کلاینت‌های جدید می‌فرستند؛ قدیمی‌ها = '')
        $deviceUuid = '';
        if (isset($payload['deviceUuid']) && is_string($payload['deviceUuid'])) {
            $deviceUuid = substr(trim($payload['deviceUuid']), 0, 64);
        }
        // چانک‌های push-only (بدون pull) — پرچم pull=0 برای صرفه‌جویی انتقال
        $doPull = !isset($payload['pull']) || $payload['pull'] !== 0;

        $applied = [Entities::ENTITY_LISTS => 0, Entities::ENTITY_TASKS => 0, Entities::ENTITY_SUBTASKS => 0];
        $conflicts = [Entities::ENTITY_LISTS => [], Entities::ENTITY_TASKS => [], Entities::ENTITY_SUBTASKS => []];
        $rejected = [];
        $clockSkew = [];
        $incomplete = false;
        $changes = $payload['changes'] ?? [];
        if (!is_array($changes)) {
            throw new ValidationError('ساختار changes نامعتبر است');
        }

        $pdo->beginTransaction();
        try {
            // ---------- PUSH ----------
            foreach (self::ENTITIES as $entity) {
                $items = $changes[$entity] ?? [];
                if (!is_array($items)) {
                    throw new ValidationError("ساختار changes.{$entity} نامعتبر است");
                }
                // سقف نهایی حفاظتی برای هر موجودیت در هر درخواست (قابل تنظیم از پنل — فاز ۴.۵).
                // کلاینتِ جدید تکه‌تکه (chunk) زیر این سقف می‌فرستد؛ این سقف فقط گارد سرور است.
                $cap = Settings::int('api_max_sync_items', 2000, 100, 5000);
                if (count($items) > $cap) {
                    throw new ValidationError("تعداد آیتم‌های {$entity} بیش از حد مجاز است (حداکثر " . Otp::normalizeDigits((string) $cap) . ')');
                }
                foreach ($items as $i => $item) {
                    if (!is_array($item)) {
                        $rejected[] = ['entity' => $entity, 'index' => $i, 'reason' => 'invalid'];
                        continue;
                    }
                    try {
                        $conflict = self::applyOne($userId, $entity, $item, $deviceUuid, $clockSkew);
                        $applied[$entity]++;
                        if ($conflict !== null) {
                            // کلاینت در LWW باخت یا لیست سید تکراری بود → نسخه‌ی معتبر سرور قطعاً در pull همین پاسخ برمی‌گردد
                            $conflicts[$entity][$conflict['id']] = $conflict;
                        }
                    } catch (EntityReject $e) {
                        $rejected[] = ['entity' => $entity, 'id' => (string) ($item['id'] ?? ''), 'reason' => $e->getMessage()];
                    } catch (ValidationError $e) {
                        $rejected[] = ['entity' => $entity, 'id' => (string) ($item['id'] ?? ''), 'reason' => 'invalid', 'detail' => $e->getMessage()];
                    }
                }
            }

            // ---------- PULL (صفحه‌بندی‌شده) ----------
            $server = [];
            $pageCursorSql = null;
            if ($doPull) {
                foreach (self::ENTITIES as $entity) {
                    $rows = Entities::pullSince($entity, $userId, $cursorSql, self::PULL_LIMIT + 1);
                    if (count($rows) > self::PULL_LIMIT) {
                        $incomplete = true;
                        $rows = array_slice($rows, 0, self::PULL_LIMIT);
                    }
                    // ادامه‌ی صفحه‌بندی: کرسرِ ادامه = مینیممِ «آخرین applied_at» صفحات (بدون skip؛ همپوشانی بی‌ضرر است)
                    if (!empty($rows)) {
                        $lastApplied = (string) end($rows)['applied_at'];
                        if ($pageCursorSql === null || $lastApplied < $pageCursorSql) {
                            $pageCursorSql = $lastApplied;
                        }
                    }
                    $map = [];
                    foreach ($rows as $r) {
                        $c = Entities::toClient($entity, $r);
                        $map[$c['id']] = $c;
                    }
                    // تضارب‌های همین درخواست (نسخه‌ی معتبر سرور) بدون توجه به کرسر اضافه می‌شوند
                    foreach ($conflicts[$entity] ?? [] as $id => $c) {
                        $map[$id] = $c;
                    }
                    $server[$entity] = array_values($map);
                }
            } else {
                foreach (self::ENTITIES as $entity) {
                    $server[$entity] = [];
                    // چانک‌های میانی: تضارب‌ها باید به کلاینت برسند ولی pull کامل انجام نمی‌شود
                    foreach ($conflicts[$entity] ?? [] as $id => $c) {
                        $server[$entity][$id] = $c;
                    }
                    $server[$entity] = array_values($server[$entity]);
                }
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // کرسر جدید: لحظه‌ی سرور (ثانیه‌ای) — همپوشانی فقط در سمت خواندن اعمال می‌شود.
        // اگر incomplete=true باشد، کلاینت نباید کرسر را ذخیره کند (ادامه با همان کرسر قبلی).
        $newCursor = gmdate('Y-m-d\TH:i:s.000\Z');

        return [
            'applied' => $applied,
            'rejected' => $rejected,
            'server' => $server,
            'cursor' => $newCursor,
            'serverTime' => gmdate('Y-m-d\TH:i:s.000\Z'),
            'incomplete' => $incomplete,
            'clockSkew' => $clockSkew,
            // فقط وقتی incomplete=true معنا دارد: کرسرِ ادامه‌ی صفحه‌بندی (کلاینت آن را ذخیره نمی‌کند)
            'pageCursor' => $pageCursorSql !== null ? Entities::sqlToIso($pageCursorSql) : null,
        ];
    }

    /**
     * اعمال یک آیتم کلاینت با قانون LWW قطعی (updatedAt, rev, revDevice)
     * @param array<string,mixed> $item
     * @param list<array<string,mixed>> $clockSkew
     * @return array|null اگر کلاینت بازنده باشد یا لیست سید تکراری باشد، نسخه‌ی معتبر سرور برگردانده می‌شود
     */
    private static function applyOne(int $userId, string $entity, array $item, string $deviceUuid, array &$clockSkew): ?array
    {
        $uuid = Validator::uuid($item, 'id');
        $clientRev = isset($item['rev']) && is_numeric($item['rev']) ? max(0, (int) $item['rev']) : 0;
        $clientDevice = isset($item['revDevice']) && is_string($item['revDevice']) && $item['revDevice'] !== ''
            ? substr($item['revDevice'], 0, 64)
            : $deviceUuid;
        $existing = Entities::findByUuid($entity, $userId, $uuid);

        if ($existing === null) {
            $cols = Entities::normalize($entity, $item, partial: false);
            // ساعت جلوتر از ۵ دقیقه رد نمی‌شود — به زمان سرور بریده و اعلام می‌شود
            $clamped = self::clampFuture($cols['updated_at'] ?? null, $clockSkew, $entity, $uuid);
            if ($clamped !== null) {
                $cols['updated_at'] = $clamped;
                if (isset($cols['created_at']) && $cols['created_at'] > $clamped) {
                    $cols['created_at'] = $clamped;
                }
            }
            $cols = Entities::resolveParents($entity, $cols, $userId, $item);
            // dedupe سرور: لیست سیدِ تکراری ساخته نمی‌شود (APKهای قدیمی هنوز seed می‌فرستند)
            if ($entity === Entities::ENTITY_LISTS && isset($cols['name']) && in_array((string) $cols['name'], self::SEED_LIST_NAMES, true)) {
                $dupe = self::findAliveSeedDuplicate($userId, (string) $cols['name'], $uuid);
                if ($dupe !== null) {
                    return Entities::toClient($entity, $dupe);
                }
            }
            $cols['rev'] = $clientRev + 1;
            $cols['rev_device'] = $clientDevice;
            Entities::insertClient($entity, $userId, $uuid, $cols);
            return null;
        }

        $clientTsRaw = Entities::isoToSql(Validator::isoDateTime($item, 'updatedAt'));
        $clampedTs = self::clampFuture($clientTsRaw, $clockSkew, $entity, $uuid);
        $clientTs = $clampedTs ?? $clientTsRaw;
        $serverTs = (string) $existing['updated_at'];
        $serverRev = (int) ($existing['rev'] ?? 0);
        $serverDevice = (string) ($existing['rev_device'] ?? '');

        // LWW قطعی — تساوی کامل = اعمال مجدد بی‌ضرر (idempotent؛ همان دستگاه همان رکورد را دوباره می‌فرستد)
        if (self::tupleGreaterOrEqual($clientTs, $clientRev, $clientDevice, $serverTs, $serverRev, $serverDevice)) {
            $cols = Entities::normalize($entity, $item, partial: false);
            $cols['updated_at'] = $clientTs;
            if (isset($cols['created_at']) && $cols['created_at'] > $clientTs) {
                $cols['created_at'] = $clientTs;
            }
            $cols = Entities::resolveParents($entity, $cols, $userId, $item);
            $cols['rev'] = max($serverRev, $clientRev) + 1;
            $cols['rev_device'] = $clientDevice;
            Entities::updateClient($entity, $userId, (int) $existing['id'], $cols);
            return null;
        }
        // بازنده → نسخه‌ی معتبر سرور برای همگرایی کلاینت برمی‌گردد
        return Entities::toClient($entity, $existing);
    }

    /** مقایسه‌ی سه‌تایی قطعی — دقیقاً همان منطق revTupleNewerOrEqual در frontend/src/sync/lww.ts */
    private static function tupleGreaterOrEqual(string $aTs, int $aRev, string $aDev, string $bTs, int $bRev, string $bDev): bool
    {
        if ($aTs !== $bTs) {
            return $aTs > $bTs; // قالب «Y-m-d H:i:s» مقایسه‌ی متنی = مقایسه‌ی زمانی
        }
        if ($aRev !== $bRev) {
            return $aRev > $bRev;
        }
        return $aDev >= $bDev;
    }

    /**
     * به‌جای ردِ بی‌صدای ساعتِ جلو، زمان به «الانِ سرور» بریده و در clockSkew اعلام می‌شود.
     * @param list<array<string,mixed>> $clockSkew
     */
    private static function clampFuture(?string $sqlTs, array &$clockSkew, string $entity, string $id): ?string
    {
        if ($sqlTs === null) {
            return null;
        }
        $ts = strtotime($sqlTs);
        if ($ts !== false && $ts > time() + 300) {
            $clockSkew[] = ['entity' => $entity, 'id' => $id, 'offset' => $ts - time()];
            return gmdate('Y-m-d H:i:s', time());
        }
        return null;
    }

    /** لیست زنده‌ی هم‌نام (از سید) برای همان کاربر — به‌جز خود uuidِ درحال درج */
    private static function findAliveSeedDuplicate(int $userId, string $name, string $exceptUuid): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT * FROM lists WHERE user_id = :uid AND name = :name AND deleted_at IS NULL AND uuid <> :except LIMIT 1'
        );
        $stmt->execute([':uid' => $userId, ':name' => $name, ':except' => $exceptUuid]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }
}
