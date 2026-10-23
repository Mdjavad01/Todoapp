<?php

declare(strict_types=1);

/**
 * کارام — سرویس سینک دوسویه (فاز ۲)
 *
 * جریان:
 *   ۱) push: تغییرات محلی کلاینت (آیتم کامل با updatedAt) به‌ترتیب lists → tasks → subtasks اعمال می‌شود.
 *   ۲) pull: همه‌ی رکوردهای تغییرکرده از «کرسر» قبلی (شامل حذف‌شده‌های نرم) برگردانده می‌شود.
 *   ۳) کرسر جدید = لحظه‌ی سرور (ثانیه‌ای)؛ همپوشانی یک‌ثانیه‌ای فقط هنگام خواندن سمت سرور اعمال می‌شود
 *      تا رکوردهای اعمال‌شده در نیمه‌ی دوم ثانیه‌ی کرسر از دست نروند.
 *
 * تضارب: Last-Write-Wins روی updatedAt؛ مساوی → کلاینت. بازنده، نسخه‌ی معتبر سرور را در پاسخ می‌گیرد.
 */

final class SyncService
{
    private const ENTITIES = [
        Entities::ENTITY_LISTS,
        Entities::ENTITY_TASKS,
        Entities::ENTITY_SUBTASKS,
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

        $applied = [Entities::ENTITY_LISTS => 0, Entities::ENTITY_TASKS => 0, Entities::ENTITY_SUBTASKS => 0];
        $conflicts = [Entities::ENTITY_LISTS => [], Entities::ENTITY_TASKS => [], Entities::ENTITY_SUBTASKS => []];
        $rejected = [];
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
                // سقف تعداد برای هر موجودیت در هر درخواست (قابل تنظیم از پنل — فاز ۴.۵)
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
                        $conflict = self::applyOne($userId, $entity, $item);
                        $applied[$entity]++;
                        if ($conflict !== null) {
                            // کلاینت در LWW باخت → نسخه‌ی معتبر سرور قطعاً در همین پاسخ برمی‌گردد
                            $conflicts[$entity][$conflict['id']] = $conflict;
                        }
                    } catch (EntityReject $e) {
                        $rejected[] = ['entity' => $entity, 'id' => (string) ($item['id'] ?? ''), 'reason' => $e->getMessage()];
                    } catch (ValidationError $e) {
                        $rejected[] = ['entity' => $entity, 'id' => (string) ($item['id'] ?? ''), 'reason' => 'invalid', 'detail' => $e->getMessage()];
                    }
                }
            }

            // ---------- PULL ----------
            $server = [];
            foreach (self::ENTITIES as $entity) {
                $rows = Entities::pullSince($entity, $userId, $cursorSql);
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

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // کرسر جدید: لحظه‌ی سرور (ثانیه‌ای) — همپوشانی فقط در سمت خواندن اعمال می‌شود
        $newCursor = gmdate('Y-m-d\TH:i:s.000\Z');

        return [
            'applied' => $applied,
            'rejected' => $rejected,
            'server' => $server,
            'cursor' => $newCursor,
            'serverTime' => gmdate('Y-m-d\TH:i:s.000\Z'),
        ];
    }

    /**
     * اعمال یک آیتم کلاینت با قانون LWW
     * @param array<string,mixed> $item
     * @return array|null اگر کلاینت بازنده باشد، نسخه‌ی معتبر سرور برگردانده می‌شود
     */
    private static function applyOne(int $userId, string $entity, array $item): ?array
    {
        $uuid = Validator::uuid($item, 'id');
        $existing = Entities::findByUuid($entity, $userId, $uuid);

        if ($existing === null) {
            $cols = Entities::normalize($entity, $item, partial: false);
            // گارد ساعت کلاینت: آینده‌ی بیش از ۵ دقیقه پذیرفته نمی‌شود
            self::guardClock($cols['updated_at']);
            $cols = Entities::resolveParents($entity, $cols, $userId, $item);
            Entities::insertClient($entity, $userId, $uuid, $cols);
            return null;
        }

        $clientTs = Entities::isoToSql(Validator::isoDateTime($item, 'updatedAt'));
        self::guardClock($clientTs);
        $serverTs = (string) $existing['updated_at'];

        // LWW — مساوی → کلاینت برنده است (اعمال دوباره بی‌ضرر است)
        if ($clientTs >= $serverTs) {
            $cols = Entities::normalize($entity, $item, partial: false);
            $cols = Entities::resolveParents($entity, $cols, $userId, $item);
            Entities::updateClient($entity, $userId, (int) $existing['id'], $cols);
            return null;
        }
        // بازنده → نسخه‌ی معتبر سرور برای همگرایی کلاینت برمی‌گردد
        return Entities::toClient($entity, $existing);
    }

    private static function guardClock(?string $sqlTs): void
    {
        if ($sqlTs === null) {
            return;
        }
        $ts = strtotime($sqlTs);
        if ($ts !== false && $ts > time() + 300) {
            throw new ValidationError('ساعت دستگاه جلوتر از سرور است؛ تاریخ آینده پذیرفته نمی‌شود');
        }
    }
}
