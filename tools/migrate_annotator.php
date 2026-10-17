<?php
// One-off: copy the notes of the old annotator.js (annotations/annotations.db, next to notes/) into this hub.
// Run on the server from the hub folder, script on stdin:
//   ssh HOST 'cd domains/DOMAIN/public_html/notes && php -- DOMAIN' < tools/migrate_annotator.php
// Safe to re-run: stops if a note was already migrated. The old db is left as it is.
$site = $argv[1] ?? '';
if ($site === '') exit("usage: php -- DOMAIN < migrate_annotator.php\n");
require getcwd() . '/lib.php';
$old = dirname(getcwd()) . '/annotations/annotations.db';
if (!is_file($old)) exit("$site: no old annotations.db, nothing to copy\n");
$db = sn_db();
if ($db->query("SELECT COUNT(*) FROM events WHERE body LIKE 'migrated from annotator.js%'")->fetchColumn()) exit("$site: already migrated\n");
$o = new PDO('sqlite:' . $old);
$o->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$rows = $o->query('SELECT * FROM annotations ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$local = function (?string $utc): string {  // the old db stored UTC (CURRENT_TIMESTAMP)
    if (!$utc) return sn_now();
    return (new DateTime($utc, new DateTimeZone('UTC')))->setTimezone(new DateTimeZone('Europe/Warsaw'))->format('Y-m-d H:i:s');
};
$ins = $db->prepare('INSERT INTO notes(site, path, url, title, action, comment, selector, element, text, rect, viewport, source, ua, author, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
$n = 0;
foreach ($rows as $r) {
    $path = ($r['url'] ?? '') !== '' ? $r['url'] : '/';
    $text = trim((string)($r['selected'] ?? '')) !== '' ? $r['selected'] : (string)($r['context'] ?? '');
    $created = $local($r['ts'] ?? null);
    $done = ($r['status'] ?? 'open') === 'done';
    $ins->execute([$site, $path, 'https://' . $site . $path, '', 'change', (string)($r['comment'] ?? ''), $r['dom_path'] ?? '', '',
        mb_substr($text, 0, 1000), '', $r['viewport'] ?? '', '', $r['ua'] ?? '', $r['reviewer'] ?? '', $done ? 'done' : 'open',
        $created, $done && !empty($r['resolved_at']) ? $local($r['resolved_at']) : $created]);
    $id = (int)$db->lastInsertId();
    $db->prepare('INSERT INTO events(note_id, at, kind, who, body) VALUES (?,?,?,?,?)')
       ->execute([$id, $created, 'created', $r['reviewer'] ?? '', 'migrated from annotator.js #' . $r['id']]);
    if ($done) $db->prepare('INSERT INTO events(note_id, at, kind, who, body) VALUES (?,?,?,?,?)')
       ->execute([$id, $local($r['resolved_at'] ?? $r['ts'] ?? null), 'fixed', '', 'marked done in the old annotator']);
    $n++;
}
echo "$site: copied $n notes (" . count(array_filter($rows, fn($r) => ($r['status'] ?? 'open') !== 'done')) . " open)\n";
