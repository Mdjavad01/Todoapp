<?php

declare(strict_types=1);

/**
 * روتر سبک REST — تطبیق مسیر دقیق و با پارامتر {param}
 * کنترلرها امضای handler(array $params) دارند.
 */

final class Router
{
    /** @var array<string, array<string, callable>> */
    private array $routes = [];

    public function add(string $method, string $path, callable $handler): void
    {
        $method = strtoupper($method);
        $this->routes[$method][$path] = $handler;
    }

    public function get(string $path, callable $handler): void
    {
        $this->add('GET', $path, $handler);
    }

    public function post(string $path, callable $handler): void
    {
        $this->add('POST', $path, $handler);
    }

    public function patch(string $path, callable $handler): void
    {
        $this->add('PATCH', $path, $handler);
    }

    public function delete(string $path, callable $handler): void
    {
        $this->add('DELETE', $path, $handler);
    }

    public function dispatch(string $method, string $path): void
    {
        $method = strtoupper($method);
        $path = rtrim($path, '/') ?: '/';

        // CORS preflight
        if ($method === 'OPTIONS') {
            Response::headers();
            http_response_code(204);
            return;
        }

        // ۱) تطبیق دقیق
        if (isset($this->routes[$method][$path])) {
            ($this->routes[$method][$path])([]);
            return;
        }

        // ۲) تطبیق الگو با پارامتر {name}
        $candidates = $this->routes[$method] ?? [];
        foreach ($candidates as $pattern => $handler) {
            if (!str_contains($pattern, '{')) {
                continue;
            }
            $regex = '#^' . preg_replace('#\{([a-zA-Z_]+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';
            if (preg_match($regex, $path, $m)) {
                $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
                ($handler)($params);
                return;
            }
        }

        Response::error('یافت نشد', 404, ['path' => $path]);
    }
}
