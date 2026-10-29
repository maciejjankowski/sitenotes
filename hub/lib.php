<?php
// Site Notes hub: one SQLite db for the notes made with the browser extension, on any site.
// Shared by api.php (extension + bin/annot) and index.php (overview in the browser).
// SN_KEY lives in secret.php, written by install.sh, never committed.
date_default_timezone_set('Europe/Warsaw');
require __DIR__ . '/errlog.php';  // first: it also records a hub that cannot start
if (is_file(__DIR__ . '/secret.php')) require __DIR__ . '/secret.php';

function sn_auth(): void {
    $k = (string)($_SERVER['HTTP_X_SN_KEY'] ?? $_GET['key'] ?? $_COOKIE['sn_key'] ?? '');
    if (!defined('SN_KEY') || SN_KEY === '') {  // secret.php missing on the server: say so instead of a PHP fatal
        $GLOBALS['sn_err'] = 'hub not configured: secret.php missing';
        http_response_code(500);
        header('Content-Type: application/json');
        exit('{"error":"hub not configured: secret.php missing"}');
    }
    if (!hash_equals(SN_KEY, $k)) {
        $GLOBALS['sn_err'] = 'forbidden: wrong or missing key';
        http_response_code(403);
        header('Content-Type: application/json');
        exit('{"error":"forbidden: wrong or missing key"}');
    }
}

function sn_db(): PDO {
    static $db = null;
    if ($db) return $db;
    if (!is_dir(__DIR__ . '/data/shots')) mkdir(__DIR__ . '/data/shots', 0775, true);
    if (!is_file(__DIR__ . '/data/.htaccess')) file_put_contents(__DIR__ . '/data/.htaccess', "Require all denied\n");
    $db = new PDO('sqlite:' . __DIR__ . '/data/notes.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA busy_timeout=3000');
    // action: change (the comment says what) | remove (the element should go).
    // status: open | done (fixed, shown on the page as a green "changed" marker until MJ decides) | accepted (MJ kept the fix).
    $db->exec("CREATE TABLE IF NOT EXISTS notes(
        id INTEGER PRIMARY KEY, site TEXT NOT NULL, path TEXT NOT NULL, url TEXT NOT NULL, title TEXT,
        action TEXT NOT NULL DEFAULT 'change', comment TEXT NOT NULL DEFAULT '',
        selector TEXT, element TEXT, text TEXT, rect TEXT, viewport TEXT, ua TEXT, shot TEXT, author TEXT,
        status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)");
    // kind: created | edited | fixed | reopened | accepted | revert | deleted | restored, so a reopened note shows which fix did not work
    // and a "revert" tells the agent to put the before state back instead of trying another fix.
    $db->exec('CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL, at TEXT NOT NULL,
        kind TEXT NOT NULL, who TEXT, body TEXT)');
    $db->exec('CREATE INDEX IF NOT EXISTS notes_site ON notes(site, path)');
    // Remote mode: the element last tapped on a phone, read by a desktop that follows it. One row per site.
    $db->exec('CREATE TABLE IF NOT EXISTS pointer(site TEXT PRIMARY KEY, seq INTEGER NOT NULL, path TEXT, selector TEXT, text TEXT, viewport TEXT, at TEXT NOT NULL)');
    // source = nearest data-src of the element (e.g. the YAML block it was rendered from); added 2026-10-07
    $cols = array_column($db->query('PRAGMA table_info(notes)')->fetchAll(), 'name');
    if (!in_array('source', $cols, true)) $db->exec('ALTER TABLE notes ADD COLUMN source TEXT');
    return $db;
}

function sn_now(): string { return date('Y-m-d H:i:s'); }
function sn_cut($s, int $n): string { return mb_substr(trim((string)$s), 0, $n); }

function sn_event(int $id, string $kind, string $who, string $body = ''): void {
    sn_db()->prepare('INSERT INTO events(note_id, at, kind, who, body) VALUES (?,?,?,?,?)')
        ->execute([$id, sn_now(), $kind, sn_cut($who, 60), sn_cut($body, 2000)]);
}

function sn_notes(string $site, ?string $path, string $status): array {
    $sql = 'SELECT * FROM notes WHERE deleted_at IS NULL AND site = ?';
    $args = [$site];
    if ($path !== null) { $sql .= ' AND path = ?'; $args[] = $path; }
    if ($status !== 'all') { $sql .= ' AND status = ?'; $args[] = $status; }
    $q = sn_db()->prepare($sql . ' ORDER BY path, id');
    $q->execute($args);
    $notes = $q->fetchAll();
    $ev = sn_db()->prepare("SELECT at, kind, who, body FROM events WHERE note_id = ? AND kind IN ('fixed','reopened','accepted','revert','answered') ORDER BY id");
    foreach ($notes as &$n) {
        $ev->execute([$n['id']]);
        $n['history'] = $ev->fetchAll();
        $last = end($n['history']);
        $last = null;
        foreach ($n['history'] as $e) if ($e['kind'] !== 'answered') $last = $e;
        $n['revert'] = $n['status'] === 'open' && $last && $last['kind'] === 'revert';  // MJ asked for the before state back
    }
    return $notes;
}

function sn_sites(): array {
    return sn_db()->query("SELECT site, SUM(status = 'open') AS open, COUNT(*) AS total, MAX(updated_at) AS last
        FROM notes WHERE deleted_at IS NULL GROUP BY site ORDER BY last DESC")->fetchAll();
}

function sn_save_shot(int $id, string $data): ?string {
    if (!preg_match('#^data:image/(jpeg|png);base64,#', $data, $m)) return null;
    $bin = base64_decode(substr($data, strlen($m[0])), true);
    if ($bin === false || strlen($bin) > 5000000 || !@getimagesizefromstring($bin)) return null;
    $name = $id . ($m[1] === 'png' ? '.png' : '.jpg');
    file_put_contents(__DIR__ . '/data/shots/' . $name, $bin);
    return $name;
}

function sn_base_url(): string {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/';
}

function sn_code(string $s): string {  // one line of inline code that survives backticks in the HTML
    $s = preg_replace('/\s+/', ' ', trim($s));
    return str_contains($s, '`') ? '`` ' . $s . ' ``' : '`' . $s . '`';
}

function sn_history(array $n): string {
    return implode('; ', array_map(fn($e) => substr($e['at'], 0, 16) . ' ' . $e['kind'] . ' by ' . ($e['who'] ?: '?')
        . ($e['body'] !== '' ? ': "' . preg_replace('/\s+/', ' ', $e['body']) . '"' : ''), $n['history']));
}

// The export an AI agent works from: every page of one site, grouped by page, oldest note first.
function sn_export_md(string $site, string $status): string {
    $notes = sn_notes($site, null, $status);
    $open = count(array_filter($notes, fn($n) => $n['status'] === 'open'));
    $o = "# Site notes: $site\n\n" . count($notes) . ($status === 'all' ? " notes ($open open)" : " $status notes")
        . ', exported ' . date('Y-m-d H:i') . ' from ' . sn_base_url() . "\n\n"
        . "Each note is about one element of the page. Find it by the CSS selector; if the selector no longer matches, use the element HTML and text.\n"
        . "\"source\" (when present) names the source block the element was rendered from.\n\n"
        . "- **CHANGE**: do what the note says.\n"
        . "- **QUESTION**: you (the agent) asked the site owner this about the element; their answer appears under it as \"answer\". Read the answer, act on it, then close it with `annot -s $site fix ID \"what you did\"`. No answer yet = still waiting.\n"
        . "- **REMOVE**: delete that element from the page (the note, if any, says why).\n"
        . "- **history**: the note was fixed before and reopened, so that earlier fix did not work. Read it before trying again.\n"
        . "- **REVERT**: MJ looked at the fix and wants the state from before it back. Undo that fix (the fix text names the patch), do not try another one, then `annot -s $site fix ID \"reverted\"`.\n"
        . "- Screenshots show the element outlined in red.\n"
        . "- When a note is done: `annot -s $site fix ID \"what you changed\"`.\n";
    if (!$notes) return $o . "\nNo notes.\n";
    $byPath = [];
    foreach ($notes as $n) $byPath[$n['path']][] = $n;
    foreach ($byPath as $path => $ns) {
        $o .= "\n## $path (" . count($ns) . ")\n\n" . $ns[0]['url'] . ($ns[0]['title'] ? ' - "' . $ns[0]['title'] . '"' : '') . "\n";
        foreach ($ns as $n) {
            $o .= "\n### #{$n['id']} " . ($n['revert'] ? 'REVERT' : strtoupper($n['action']))
                . ($n['status'] === 'done' ? ' (done, waiting for MJ)' : ($n['status'] === 'accepted' ? ' (accepted)' : '')) . "\n\n";
            if ($n['comment'] !== '') $o .= '> ' . str_replace("\n", "\n> ", $n['comment']) . "\n\n";
            if ((string)$n['selector'] !== '') $o .= '- selector: ' . sn_code($n['selector']) . "\n";
            if ($n['element']) $o .= '- element: ' . sn_code($n['element']) . "\n";
            if ($n['text']) $o .= '- text: "' . preg_replace('/\s+/', ' ', $n['text']) . "\"\n";
            if (!empty($n['source'])) $o .= '- source: ' . $n['source'] . "\n";
            if ($n['rect']) {
                [$x, $y, $w, $h] = array_map('intval', explode(',', $n['rect']) + [0, 0, 0, 0]);
                $o .= "- position: {$w}x{$h} px at x $x, y $y of the page, viewport {$n['viewport']}\n";
            }
            if ($n['shot']) $o .= '- screenshot: ' . __DIR__ . '/data/shots/' . $n['shot'] . "\n";
            $o .= '- noted: ' . substr($n['created_at'], 0, 16) . ' by ' . ($n['author'] ?: '?') . "\n";
            foreach ($n['history'] as $e) if ($e['kind'] === 'answered')
                $o .= '- answer (' . substr($e['at'], 0, 16) . ' by ' . ($e['who'] ?: '?') . '): "' . preg_replace('/\s+/', ' ', $e['body']) . "\"\n";
            if ($n['action'] === 'question' && !array_filter($n['history'], fn($e) => $e['kind'] === 'answered')) $o .= "- answer: (none yet)\n";
            $h = array_values(array_filter($n['history'], fn($e) => $e['kind'] !== 'answered'));
            if ($h) $o .= '- history: ' . sn_history(['history' => $h] + $n) . "\n";
        }
    }
    return $o;
}
