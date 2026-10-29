<?php
// Failure log of the hub: every refused or failed request (4xx/5xx), every PHP warning or crash, and the failures
// clients report later (a=client_error), one JSON line each in data/errors.jsonl. Loaded first by lib.php and needs
// nothing else, so it also records a hub that cannot start (e.g. secret.php missing). Read it with ?a=errors or
// bin/annot errors. Never stores the key, the request body or the visitor's IP.
const SN_ERRLOG = __DIR__ . '/data/errors.jsonl';
const SN_ERRLOG_MAX = 512 * 1024;  // then rotated to errors.1.jsonl, one old file kept

ini_set('display_errors', '0');  // a warning printed into the JSON is what made the demo hub unreadable
$GLOBALS['sn_err'] = '';           // the message the client got, set by out() and sn_auth()

function sn_log_error(array $e): void {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    if (!is_file("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "Require all denied\n");
    if (is_file(SN_ERRLOG) && filesize(SN_ERRLOG) > SN_ERRLOG_MAX) @rename(SN_ERRLOG, "$dir/errors.1.jsonl");
    foreach ($e as $k => $v) if (is_string($v)) $e[$k] = mb_substr($v, 0, $k === 'detail' ? 600 : 300);
    $line = json_encode(['at' => date('Y-m-d H:i:s')] + $e, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @file_put_contents(SN_ERRLOG, $line . "\n", FILE_APPEND | LOCK_EX);
}

function sn_req(): array {  // what was asked, without secrets
    return [
        'method' => $_SERVER['REQUEST_METHOD'] ?? '',
        'a' => (string)($_GET['a'] ?? ''),
        'site' => (string)($_GET['site'] ?? ''),
        'origin' => (string)($_SERVER['HTTP_ORIGIN'] ?? ''),
        'key_sent' => ($_SERVER['HTTP_X_SN_KEY'] ?? $_GET['key'] ?? $_COOKIE['sn_key'] ?? '') !== '',
        'ua' => (string)($_SERVER['HTTP_USER_AGENT'] ?? ''),
    ];
}

function sn_read_errors(int $n, string $side = ''): array {
    $rows = [];
    foreach ([__DIR__ . '/data/errors.1.jsonl', SN_ERRLOG] as $f) {
        if (!is_file($f)) continue;
        foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $l) {
            $r = json_decode($l, true);
            if (is_array($r) && ($side === '' || ($r['side'] ?? '') === $side)) $rows[] = $r;
        }
    }
    return array_slice($rows, -max(1, min($n, 1000)));
}

set_error_handler(function (int $no, string $msg, string $file, int $line): bool {
    sn_log_error(['side' => 'server', 'kind' => 'php', 'detail' => "$msg in " . basename($file) . ":$line"] + sn_req());
    return true;  // logged, not printed
});

register_shutdown_function(function (): void {
    $f = error_get_last();
    if ($f && in_array($f['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        $msg = 'hub error: ' . preg_replace('/\s+/', ' ', strtok($f['message'], "\n"));
        sn_log_error(['side' => 'server', 'kind' => 'fatal', 'status' => 500, 'detail' => $f['message'] . ' in ' . basename($f['file']) . ':' . $f['line']] + sn_req());
        if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json; charset=utf-8'); }
        echo json_encode(['error' => mb_substr($msg, 0, 200)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return;
    }
    $code = http_response_code();
    if (is_int($code) && $code >= 400) sn_log_error(['side' => 'server', 'kind' => 'http', 'status' => $code, 'detail' => $GLOBALS['sn_err']] + sn_req());
});
