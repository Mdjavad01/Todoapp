<?php

declare(strict_types=1);

/** روتر سبک REST — تطبیق مسیر دقیق و با پارامتر {param} */
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

    public function dispatch(string $method, string $path): void
    {
        $method = strtoupper($method);

        // CORS preflight
        if ($method === 'OPTIONS') {
            Response::headers();
            http_response_code(204);
            return;
        }

        if (isset($this->routes[$method][$path])) {
            ($this->routes[$method][$path])();
            return;
        }

        Response::error('یافت نشد', 404, ['path' => $path]);
    }
}
