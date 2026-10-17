<?php
// Site Notes hub API, used by the browser extension (extension/background.js) and the agent CLI (bin/annot).
// Auth: X-SN-Key header (or ?key= / the sn_key cookie for links opened in a browser).
//   GET  ?a=sites[&format=txt]                                    sites with open/total counts
//   GET  ?a=list&site=HOST[&path=/p][&status=open|done|all]       notes as JSON
//   GET  ?a=export&site=HOST[&status=open|all][&format=md|json]   all pages of a site, for an AI agent
//   GET  ?a=shot&id=N                                             screenshot of note N
//   POST {a:"save", [id], site, path, url, title, action: change|remove, comment, selector, element, text, rect, viewport, source, shot, author}
//   POST {a:"fix"|"reopen", id, body, who}                        status change, kept in the note history
//   POST {a:"accept", id, who}                                     MJ keeps a fix: done -> accepted (no longer shown as changed)
//   POST {a:"revert", id, body, who}                               MJ wants the before state back: -> open, flagged for the agent
//   POST {a:"delete"|"restore", id, who}               delete is soft; restore undoes it
//   POST {a:"point", site, path, selector, text, viewport}   phone in Remote mode: the element just tapped
//   GET  ?a=pointer&site=HOST                                 desktop in Follow mode: last tapped element + seq
require __DIR__ . '/lib.php';
// notes.js on another origin (e.g. a local dev server) may call this hub; the key is still required, no cookies are used.
if (isset($_SERVER['HTTP_ORIGIN'])) {
    header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
    header('Access-Control-Allow-Headers: X-SN-Key, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');  // mobile browsers reject a preflight without this
    header('Access-Control-Max-Age: 86400');
    header('Vary: Origin');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
sn_auth();
$db = sn_db();

function out($v, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    exit(json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in)) out(['error' => 'bad json'], 400);
    $id = (int)($in['id'] ?? 0);
    $who = (string)($in['who'] ?? $in['author'] ?? '');
    if (($in['a'] ?? '') === 'point') {
        $site = sn_cut($in['site'] ?? '', 200);
        if ($site === '') out(['error' => 'no site'], 400);
        $db->prepare('INSERT INTO pointer(site, seq, path, selector, text, viewport, at) VALUES (?, 1, ?, ?, ?, ?, ?)
            ON CONFLICT(site) DO UPDATE SET seq = seq + 1, path = excluded.path, selector = excluded.selector, text = excluded.text, viewport = excluded.viewport, at = excluded.at')
           ->execute([$site, sn_cut($in['path'] ?? '', 1000), sn_cut($in['selector'] ?? '', 2000), sn_cut($in['text'] ?? '', 300), sn_cut($in['viewport'] ?? '', 20), sn_now()]);
        out(['ok' => true]);
    }
    if (($in['a'] ?? '') === 'restore') {  // undo of a delete
        $db->prepare('UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')->execute([sn_now(), $id]);
        sn_event($id, 'restored', $who);
        out(['ok' => true, 'id' => $id]);
    }
    $note = null;
    if ($id) {
        $q = $db->prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL');
        $q->execute([$id]);
        $note = $q->fetch() ?: out(['error' => "no note #$id"], 404);
    }
    switch ($in['a'] ?? '') {
        case 'save':
            $action = ($in['action'] ?? '') === 'remove' ? 'remove' : 'change';
            $comment = sn_cut($in['comment'] ?? '', 5000);
            if ($action === 'change' && $comment === '') out(['error' => 'empty note'], 400);
            if ($note) {
                $db->prepare('UPDATE notes SET action = ?, comment = ?, updated_at = ? WHERE id = ?')
                   ->execute([$action, $comment, sn_now(), $id]);
                $moved = sn_cut($in['selector'] ?? '', 2000);
                if ($moved !== '' && $moved !== $note['selector']) {  // walked to another element while editing
                    $db->prepare('UPDATE notes SET selector = ?, element = ?, text = ?, rect = ?, viewport = ?, source = ? WHERE id = ?')->execute([
                        $moved, sn_cut($in['element'] ?? '', 2000), sn_cut($in['text'] ?? '', 1000),
                        sn_cut($in['rect'] ?? '', 60), sn_cut($in['viewport'] ?? '', 20), sn_cut($in['source'] ?? '', 300), $id]);
                    $shot = is_string($in['shot'] ?? null) ? sn_save_shot($id, $in['shot']) : null;
                    if ($shot) $db->prepare('UPDATE notes SET shot = ? WHERE id = ?')->execute([$shot, $id]);
                }
                sn_event($id, 'edited', $who, $comment . ($moved !== '' && $moved !== $note['selector'] ? "\n[moved to $moved]" : ''));
                out(['ok' => true, 'id' => $id]);
            }
            $site = sn_cut($in['site'] ?? '', 200);
            if ($site === '') out(['error' => 'no site'], 400);
            $now = sn_now();
            $db->prepare('INSERT INTO notes(site, path, url, title, action, comment, selector, element, text, rect, viewport, source, ua, author, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
                $site, sn_cut($in['path'] ?? '/', 1000), sn_cut($in['url'] ?? '', 2000), sn_cut($in['title'] ?? '', 300),
                $action, $comment, sn_cut($in['selector'] ?? '', 2000), sn_cut($in['element'] ?? '', 2000),
                sn_cut($in['text'] ?? '', 1000), sn_cut($in['rect'] ?? '', 60), sn_cut($in['viewport'] ?? '', 20),
                sn_cut($in['source'] ?? '', 300), sn_cut($_SERVER['HTTP_USER_AGENT'] ?? '', 300), sn_cut($who, 60), $now, $now]);
            $id = (int)$db->lastInsertId();
            sn_event($id, 'created', $who, $comment);
            $shot = is_string($in['shot'] ?? null) ? sn_save_shot($id, $in['shot']) : null;
            if ($shot) $db->prepare('UPDATE notes SET shot = ? WHERE id = ?')->execute([$shot, $id]);
            out(['ok' => true, 'id' => $id, 'shot' => (bool)$shot]);
        case 'fix':
        case 'reopen':
            if (!$note) out(['error' => 'id needed'], 400);
            $db->prepare('UPDATE notes SET status = ?, updated_at = ? WHERE id = ?')
               ->execute([$in['a'] === 'fix' ? 'done' : 'open', sn_now(), $id]);
            sn_event($id, $in['a'] === 'fix' ? 'fixed' : 'reopened', $who ?: ($in['a'] === 'fix' ? 'claude' : 'MJ'), (string)($in['body'] ?? ''));
            out(['ok' => true, 'id' => $id]);
        case 'accept':
        case 'revert':
            if (!$note) out(['error' => 'id needed'], 400);
            if ($note['status'] !== 'done') out(['error' => "note #$id is not a done change"], 400);
            $db->prepare('UPDATE notes SET status = ?, updated_at = ? WHERE id = ?')
               ->execute([$in['a'] === 'accept' ? 'accepted' : 'open', sn_now(), $id]);
            sn_event($id, $in['a'] === 'accept' ? 'accepted' : 'revert', $who ?: 'MJ', (string)($in['body'] ?? ''));
            out(['ok' => true, 'id' => $id]);
        case 'delete':
            if (!$note) out(['error' => 'id needed'], 400);
            $db->prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?')->execute([sn_now(), sn_now(), $id]);
            sn_event($id, 'deleted', $who);
            out(['ok' => true, 'id' => $id]);
    }
    out(['error' => 'unknown action'], 400);
}

$a = $_GET['a'] ?? 'sites';
$site = (string)($_GET['site'] ?? '');
$status = in_array($_GET['status'] ?? '', ['open', 'done', 'accepted', 'all'], true) ? $_GET['status'] : 'open';
switch ($a) {
    case 'sites':
        $rows = sn_sites();
        if (($_GET['format'] ?? '') !== 'txt') out($rows);
        header('Content-Type: text/plain; charset=utf-8');
        if (!$rows) exit("no notes yet\n");
        foreach ($rows as $r) printf("%-40s %3d open / %3d  (last %s)\n", $r['site'], $r['open'], $r['total'], substr($r['last'], 0, 16));
        exit;
    case 'list':
        if ($site === '') out(['error' => 'site needed'], 400);
        out(sn_notes($site, isset($_GET['path']) ? (string)$_GET['path'] : null, $status));
    case 'export':
        if ($site === '') out(['error' => 'site needed'], 400);
        if (($_GET['format'] ?? 'md') === 'json') out(sn_notes($site, null, $status));
        header('Content-Type: text/markdown; charset=utf-8');
        if (isset($_GET['download'])) header('Content-Disposition: attachment; filename="site-notes_' . preg_replace('/[^\w.-]+/', '_', $site) . '_' . date('Y-m-d') . '.md"');
        exit(sn_export_md($site, $status));
    case 'pointer':
        if ($site === '') out(['error' => 'site needed'], 400);
        $q = $db->prepare('SELECT * FROM pointer WHERE site = ?');
        $q->execute([$site]);
        out($q->fetch() ?: ['seq' => 0]);
    case 'shot':
        $q = $db->prepare('SELECT shot FROM notes WHERE id = ?');
        $q->execute([(int)($_GET['id'] ?? 0)]);
        $f = $q->fetchColumn();
        if (!$f || !is_file(__DIR__ . '/data/shots/' . $f)) { http_response_code(404); exit; }
        header('Content-Type: ' . (str_ends_with($f, '.png') ? 'image/png' : 'image/jpeg'));
        header('Cache-Control: private, max-age=86400');
        readfile(__DIR__ . '/data/shots/' . $f);
        exit;
}
out(['error' => 'unknown action'], 400);
