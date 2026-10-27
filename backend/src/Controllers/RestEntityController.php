<?php

declare(strict_types=1);

/**
 * کارام — کنترلر REST عمومی برای موجودیت‌های سینک‌پذیر
 * یک پیاده‌سازی برای هر سه‌ی لیست/کار/زیرکار (با نام موجودیت در سازنده)
 * همه‌ی مسیرها Bearer Token و محدود به داده‌ی خود کاربر هستند.
 */

final class RestEntityController
{
    public function __construct(private readonly string $entity)
    {
        if (!in_array($entity, [Entities::ENTITY_LISTS, Entities::ENTITY_TASKS, Entities::ENTITY_SUBTASKS], true)) {
            throw new InvalidArgumentException('موجودیت نامعتبر');
        }
        // فاز ۳ — اسکیمای ستاره/تکرار سفارشی (فقط برای مسیرهای کارها؛ تکرارپذیر و ارزان)
        if ($entity === Entities::ENTITY_TASKS) {
            TaskSchema::ensure();
        }
    }

    /** GET /api/v1/{entity} */
    public function index(array $params): void
    {
        $user = Guard::requireUser();
        $since = Request::query('since'); // ISO UTC — فقط تغییرکرده‌ها
        $sinceSql = $since !== null ? Entities::isoToSql($since) : null;
        $includeDeleted = Request::query('includeDeleted') === '1';

        $rows = Entities::pullSince($this->entity, $user['id'], $sinceSql);
        $out = [];
        foreach ($rows as $row) {
            if (!$includeDeleted && ($row['deleted_at'] ?? null) !== null) {
                continue;
            }
            // فیلترهای والد (اختیاری)
            if ($this->entity === Entities::ENTITY_TASKS && Request::query('listId') !== null) {
                if ((string) $row['parent_uuid'] !== Request::query('listId')) {
                    continue;
                }
            }
            if ($this->entity === Entities::ENTITY_SUBTASKS && Request::query('taskId') !== null) {
                if ((string) $row['parent_uuid'] !== Request::query('taskId')) {
                    continue;
                }
            }
            $out[] = Entities::toClient($this->entity, $row);
        }

        Response::ok([$this->entity => $out, 'count' => count($out)]);
    }

    /** POST /api/v1/{entity} — ساخت با UUID سمت کلاینت (ایده‌مپوتنت نبودن: تکرار = 409) */
    public function create(array $params): void
    {
        $user = Guard::requireUser();
        $body = Request::json();
        $uuid = Validator::uuid($body, 'id');

        if (Entities::findByUuid($this->entity, $user['id'], $uuid) !== null) {
            Response::error('رکوردی با این شناسه از قبل وجود دارد', 409, ['code' => 'duplicate']);
            return;
        }

        $cols = Entities::normalize($this->entity, $body, partial: false);
        try {
            $cols = Entities::resolveParents($this->entity, $cols, $user['id'], $body);
        } catch (EntityReject $e) {
            Response::error('والد این رکورد یافت نشد (' . $e->getMessage() . ')', 422, ['code' => 'missing_parent']);
            return;
        }
        Entities::insertClient($this->entity, $user['id'], $uuid, $cols);

        $row = Entities::findByUuid($this->entity, $user['id'], $uuid);
        Response::json(array_merge(['ok' => true], [$this->entity => Entities::toClient($this->entity, $row)]), 201);
    }

    /** GET /api/v1/{entity}/{uuid} */
    public function show(array $params): void
    {
        $user = Guard::requireUser();
        $row = Entities::findByUuid($this->entity, $user['id'], (string) ($params['uuid'] ?? ''));
        if ($row === null || ($row['deleted_at'] ?? null) !== null) {
            Response::error('رکورد یافت نشد', 404, ['code' => 'not_found']);
            return;
        }
        Response::ok([$this->entity => Entities::toClient($this->entity, $row)]);
    }

    /** PATCH /api/v1/{entity}/{uuid} — به‌روزرسانی جزئی با قانون LWW */
    public function update(array $params): void
    {
        $user = Guard::requireUser();
        $uuid = (string) ($params['uuid'] ?? '');
        $row = Entities::findByUuid($this->entity, $user['id'], $uuid);
        if ($row === null) {
            Response::error('رکورد یافت نشد', 404, ['code' => 'not_found']);
            return;
        }

        $body = Request::json();
        $cols = Entities::normalize($this->entity, $body, partial: true);

        // LWW: اگر نسخه‌ی کلاینت قدیمی‌تر بود، اعمال نمی‌شود
        if ($cols['updated_at'] < (string) $row['updated_at']) {
            Response::json([
                'ok' => true,
                'superseded' => true,
                $this->entity => Entities::toClient($this->entity, $row),
            ]);
            return;
        }

        try {
            $cols = Entities::resolveParents($this->entity, $cols, $user['id'], $body, requireParent: false);
        } catch (EntityReject $e) {
            Response::error('والد این رکورد یافت نشد (' . $e->getMessage() . ')', 422, ['code' => 'missing_parent']);
            return;
        }
        Entities::updateClient($this->entity, $user['id'], (int) $row['id'], $cols);

        $fresh = Entities::findByUuid($this->entity, $user['id'], $uuid);
        Response::json(array_merge(['ok' => true, 'superseded' => false], [$this->entity => Entities::toClient($this->entity, $fresh)]));
    }

    /** DELETE /api/v1/{entity}/{uuid} — حذف نرم (ایده‌مپوتنت) */
    public function destroy(array $params): void
    {
        $user = Guard::requireUser();
        $uuid = (string) ($params['uuid'] ?? '');
        $row = Entities::findByUuid($this->entity, $user['id'], $uuid);
        if ($row === null) {
            Response::error('رکورد یافت نشد', 404, ['code' => 'not_found']);
            return;
        }
        if (($row['deleted_at'] ?? null) === null) {
            $now = gmdate('Y-m-d H:i:s');
            Entities::updateClient($this->entity, $user['id'], (int) $row['id'], [
                'deleted_at' => $now,
                'updated_at' => $now,
            ]);
        }
        Response::ok(['deleted' => true]);
    }
}
