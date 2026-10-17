<?php
// Site Notes overview: sites, then every note of one site grouped by page, with screenshots.
// "Not fixed" reopens a note the agent marked done; "Export .md" is the same file the extension downloads.
// First visit: index.php?key=SN_KEY sets a cookie, after that the plain URL works in this browser.
require __DIR__ . '/lib.php';
if (isset($_GET['key']) && defined('SN_KEY') && hash_equals(SN_KEY, (string)$_GET['key'])) {
    setcookie('sn_key', $_GET['key'], ['expires' => time() + 365 * 86400, 'path' => dirname($_SERVER['SCRIPT_NAME']), 'httponly' => true, 'samesite' => 'Strict']);
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?') . (isset($_GET['site']) ? '?site=' . rawurlencode($_GET['site']) : ''));
    exit;
}
if (!defined('SN_KEY') || !hash_equals(SN_KEY, (string)($_COOKIE['sn_key'] ?? ''))) {
    http_response_code(403);
    exit('Open this page once as index.php?key=... (the key is in ~/code/annotator/.secrets/hub.env).');
}
$db = sn_db();
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $id = (int)($_POST['id'] ?? 0);
    $a = $_POST['a'] ?? '';
    if ($id && in_array($a, ['fix', 'reopen'], true)) {
        $db->prepare('UPDATE notes SET status = ?, updated_at = ? WHERE id = ?')->execute([$a === 'fix' ? 'done' : 'open', sn_now(), $id]);
        sn_event($id, $a === 'fix' ? 'fixed' : 'reopened', 'MJ', (string)($_POST['body'] ?? ''));
    } elseif ($id && $a === 'delete') {
        $db->prepare('UPDATE notes SET deleted_at = ? WHERE id = ?')->execute([sn_now(), $id]);
        sn_event($id, 'deleted', 'MJ');
    }
    header('Location: ' . $_SERVER['REQUEST_URI']);
    exit;
}
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
$site = (string)($_GET['site'] ?? '');
$status = in_array($_GET['status'] ?? '', ['open', 'done', 'all'], true) ? $_GET['status'] : 'all';
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $site ? $e($site) . ' - ' : '' ?>Site Notes</title>
<style>
  :root { color-scheme: light dark; --ink:#1d1d1f; --mut:#6e6e73; --line:#d2d2d7; --bg:#fbfbfd; --card:#fff; --acc:#2f6fed; --rm:#d93636; }
  @media (prefers-color-scheme: dark) { :root { --ink:#f5f5f7; --mut:#a1a1a6; --line:#3a3a3c; --bg:#111113; --card:#1c1c1e; --acc:#5b8cff; --rm:#ff6b6b; } }
  body { margin:0; padding:24px 16px 60px; font:15px/1.45 -apple-system, system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; overflow-wrap:anywhere; }
  a { color: var(--acc); text-decoration: none; } a:hover { text-decoration: underline; }
  .meta, .when { color: var(--mut); font-size: 13px; }
  nav { display:flex; gap:14px; flex-wrap:wrap; margin: 6px 0 18px; font-size: 14px; }
  nav .on { font-weight: 700; color: var(--ink); }
  ul.sites { list-style:none; padding:0; border-top:1px solid var(--line); }
  ul.sites li { display:flex; gap:12px; padding:10px 2px; border-bottom:1px solid var(--line); align-items:baseline; }
  .note { display:grid; grid-template-columns: 220px 1fr; gap:14px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; margin:10px 0; }
  .note.done { opacity:.55; }
  .note img { width:100%; border-radius:6px; border:1px solid var(--line); display:block; }
  .tag { display:inline-block; font-size:11px; font-weight:700; padding:1px 7px; border-radius:9px; color:#fff; background:var(--acc); margin-right:6px; }
  .tag.remove { background:var(--rm); } .tag.done { background:var(--mut); }
  .c { white-space:pre-wrap; margin:6px 0; font-size:16px; }
  code { font-size:12px; color:var(--mut); overflow-wrap:anywhere; }
  .hist { font-size:13px; color:var(--mut); margin-top:6px; }
  form { display:inline; } button { font:inherit; font-size:13px; cursor:pointer; padding:3px 9px; border-radius:6px; border:1px solid var(--line); background:transparent; color:var(--ink); }
  .acts { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
  @media (max-width: 640px) { .note { grid-template-columns: 1fr; } }
</style></head><body><main>
<?php if ($site === ''):
  $sites = sn_sites(); ?>
  <h1>Site Notes</h1>
  <?php $bm = "javascript:(function(){var d=document,s=d.createElement('script');s.src='" . sn_base_url() . "notes.js?'+Date.now();s.setAttribute('data-site-notes','');s.setAttribute('data-hub','" . rtrim(sn_base_url(), '/') . "');s.setAttribute('data-key','" . SN_KEY . "');s.setAttribute('data-who','MJ');d.documentElement.appendChild(s)})();"; ?>
  <p class="meta"><b>Any site, phone or desktop:</b> bookmarklet <a href="<?= $e($bm) ?>">Site Notes here</a> (drag to the bookmarks bar; on the phone: bookmark this page, edit the bookmark, replace its address with the code below, then open the site and pick the bookmark from the address bar). Notes land in this hub under that site's host.</p>
  <textarea readonly rows="3" style="width:100%;font:11px ui-monospace,monospace" onclick="this.select()"><?= $e($bm) ?></textarea>
  <p class="meta">Notes from the browser extension. Agent side: <code>~/code/annotator/bin/annot export SITE</code></p>
  <?php if (!$sites): ?><p class="meta">No notes yet. Click the extension icon on any page, then click an element.</p><?php endif; ?>
  <ul class="sites">
  <?php foreach ($sites as $s): ?>
    <li><a href="?site=<?= $e(rawurlencode($s['site'])) ?>"><b><?= $e($s['site']) ?></b></a>
      <span><?= (int)$s['open'] ?> open / <?= (int)$s['total'] ?></span>
      <span class="when" style="margin-left:auto"><?= $e(substr($s['last'], 0, 16)) ?></span></li>
  <?php endforeach; ?>
  </ul>
<?php else:
  $notes = sn_notes($site, null, $status);
  $byPath = [];
  foreach ($notes as $n) $byPath[$n['path']][] = $n;
  $q = fn($o) => $e('?' . http_build_query(array_merge(['site' => $site, 'status' => $status], $o))); ?>
  <h1><?= $e($site) ?></h1>
  <nav>
    <a href="./">all sites</a>
    <?php foreach (['open', 'done', 'all'] as $s): ?><a class="<?= $s === $status ? 'on' : '' ?>" href="<?= $q(['status' => $s]) ?>"><?= $s ?></a><?php endforeach; ?>
    <a href="api.php?a=export&amp;format=md&amp;download=1&amp;status=open&amp;site=<?= $e(rawurlencode($site)) ?>">Export .md (open)</a>
    <a href="api.php?a=export&amp;format=md&amp;site=<?= $e(rawurlencode($site)) ?>&amp;status=<?= $e($status) ?>">view as agent sees it</a>
  </nav>
  <?php if (!$notes): ?><p class="meta">No <?= $e($status) ?> notes.</p><?php endif; ?>
  <?php foreach ($byPath as $path => $ns): ?>
    <h2><a href="<?= $e($ns[0]['url']) ?>" target="_blank"><?= $e($path) ?></a> <span class="meta">(<?= count($ns) ?>)</span></h2>
    <?php foreach ($ns as $n): ?>
      <div class="note <?= $n['status'] === 'done' ? 'done' : '' ?>">
        <div><?php if ($n['shot']): ?><a href="api.php?a=shot&amp;id=<?= (int)$n['id'] ?>" target="_blank"><img loading="lazy" src="api.php?a=shot&amp;id=<?= (int)$n['id'] ?>" alt="note <?= (int)$n['id'] ?>"></a><?php else: ?><span class="meta">no screenshot</span><?php endif; ?></div>
        <div>
          <span class="tag <?= $e($n['action']) ?>"><?= $n['action'] === 'remove' ? 'REMOVE' : 'CHANGE' ?></span><?php if ($n['status'] === 'done'): ?><span class="tag done">done</span><?php endif; ?>
          <span class="meta">#<?= (int)$n['id'] ?> &middot; <?= $e(substr($n['created_at'], 0, 16)) ?> &middot; <?= $e($n['author']) ?></span>
          <?php if ($n['comment'] !== ''): ?><div class="c"><?= $e($n['comment']) ?></div><?php endif; ?>
          <code><?= $e($n['selector']) ?></code>
          <?php if ($n['text']): ?><div class="meta">"<?= $e(mb_substr($n['text'], 0, 160)) ?>"</div><?php endif; ?>
          <?php if ($n['history']): ?><div class="hist"><?= $e(sn_history($n)) ?></div><?php endif; ?>
          <div class="acts">
            <?php if ($n['status'] === 'done'): ?>
              <form method="post"><input type="hidden" name="id" value="<?= (int)$n['id'] ?>"><input type="hidden" name="a" value="reopen"><input name="body" placeholder="what is still wrong" style="font:inherit;font-size:13px;padding:3px 6px;width:220px"> <button>Not fixed</button></form>
            <?php else: ?>
              <form method="post"><input type="hidden" name="id" value="<?= (int)$n['id'] ?>"><input type="hidden" name="a" value="fix"><button>Done</button></form>
            <?php endif; ?>
            <form method="post"><input type="hidden" name="id" value="<?= (int)$n['id'] ?>"><input type="hidden" name="a" value="delete"><button>Delete</button></form>
          </div>
        </div>
      </div>
    <?php endforeach; ?>
  <?php endforeach; ?>
<?php endif; ?>
</main></body></html>
