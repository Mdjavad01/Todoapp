<?php

declare(strict_types=1);

/**
 * کارام — کنترلر سینک
 * POST /api/v1/sync
 */

final class SyncController
{
    public function sync(array $params): void
    {
        $user = Guard::requireUser();
        $result = SyncService::run($user['id'], Request::json());
        Response::ok($result);
    }
}
