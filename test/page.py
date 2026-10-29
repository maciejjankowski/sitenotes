"""Site Notes as a plain script on a site (no extension), plus the hand-over when the extension is on.
Fixture pages are routed at http://localhost:18080/sn-fixture/ (same origin as the QA hub, like /notes/ on a real site). Brave already on this Mac, never a downloaded browser.
Run: source ~/code/the-template/venv/bin/activate && python3 test/page.py"""
import json, os, sqlite3, sys, tempfile, urllib.parse, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = str(ROOT / 'extension')
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/hub.env').read_text().splitlines() if '=' in l)
KEY, SITE = env['SN_KEY'], 'localhost:18080'
BASE = 'http://localhost:18080/sn-fixture/'  # only notes under this path are test notes
PAGE = """<!doctype html><html><head><meta charset=utf-8><title>%(t)s</title>
<script src="/annot/notes.js" data-site-notes defer></script>
<style>body{font:16px system-ui;margin:0} header{padding:16px;background:#eee} section{padding:40px 16px}</style></head>
<body><header><a id="next" href="/sn-fixture/page2">Page 2</a></header>
<section data-src="pages/home.yaml &rsaquo; hero"><h1>%(t)s headline</h1><p class="lead">Lead text</p></section>
<div style="height:900px"></div></body></html>"""

def hub(params):
    req = urllib.request.Request(f"{env['SN_HUB']}/api.php?{urllib.parse.urlencode(params)}", headers={'X-SN-Key': KEY})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    return [n for n in out if n['path'].startswith('/sn-fixture/')] if isinstance(out, list) else out

def purge():
    db = sqlite3.connect(ROOT / 'hub/data/notes.sqlite')
    for (f,) in db.execute("SELECT shot FROM notes WHERE site = ? AND path LIKE '/sn-fixture/%' AND shot IS NOT NULL", (SITE,)):
        (ROOT / 'hub/data/shots' / f).unlink(missing_ok=True)
    db.execute("DELETE FROM events WHERE note_id IN (SELECT id FROM notes WHERE site = ? AND path LIKE '/sn-fixture/%')", (SITE,))
    db.execute("DELETE FROM notes WHERE site = ? AND path LIKE '/sn-fixture/%'", (SITE,))
    db.commit()

fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
    if not ok: fails.append(name)

def context(p, with_ext):
    args = [f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'] if with_ext else []
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True,
        viewport={'width': 1280, 'height': 800}, accept_downloads=True, args=args)
    ctx.route(BASE + '**', lambda r: r.fulfill(content_type='text/html',
        body=PAGE % {'t': 'Page 2' if '/page2' in r.request.url else 'Home'}))
    return ctx

purge()
with sync_playwright() as p:
    ctx = context(p, False)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and print('  console:', m.text))
    calls = []
    page.on('request', lambda r: 'api.php' in r.url and calls.append(r.url))
    sn = page.locator('site-notes')

    page.goto(BASE)
    page.wait_for_timeout(800)
    check('no key: dormant, no UI', sn.count() == 0)
    check('no key: no calls to the hub', not calls, str(calls))

    page.goto(BASE + f'#notes={KEY}&who=Tester')
    sn.locator('.pill').wait_for(timeout=5000)
    check('#notes=KEY wakes it, hash is cleared', page.url == BASE, page.url)
    check('starts paused', sn.locator('.pill .mode').inner_text() == 'Comment')
    page.locator('#next').click()
    page.wait_for_url(BASE + 'page2')
    sn.locator('.pill').wait_for(timeout=5000)
    check('paused: links work, key remembered on the next page', sn.locator('.pill .mode').inner_text() == 'Comment')
    check('paused: double-tap zoom left alone', page.evaluate('document.documentElement.style.touchAction') == '', page.evaluate('document.documentElement.style.touchAction'))

    sn.locator('.pill .mode').click()
    check('commenting: double-tap zoom off (touch-action manipulation)', page.evaluate('document.documentElement.style.touchAction') == 'manipulation', page.evaluate('document.documentElement.style.touchAction'))
    h1 = page.locator('h1').bounding_box()
    page.mouse.click(h1['x'] + 20, h1['y'] + 10)
    sn.locator('.card').wait_for(state='visible')
    check('name field hidden when #notes had &who=', not sn.locator('input.who').is_visible())
    sn.locator('.card textarea').fill('Shorter headline')
    sn.locator('.card textarea').press('Enter')
    sn.locator('.toast.show').wait_for(timeout=8000)
    t = sn.locator('.toast').inner_text()
    check('saved without the extension', t.startswith('Saved #') and 'screenshot' not in t, t)
    n = [x for x in hub({'a': 'list', 'site': SITE, 'status': 'all'})]
    check('note in the hub with author, source, no screenshot',
          len(n) == 1 and n[0]['author'] == 'Tester' and n[0]['source'] == 'pages/home.yaml › hero' and not n[0]['shot'] and n[0]['path'] == '/sn-fixture/page2',
          json.dumps({k: n[0][k] for k in ('author', 'source', 'shot', 'path')}, ensure_ascii=False) if n else 'none')

    page.reload()
    sn.locator('.pill').wait_for(timeout=5000)
    page.wait_for_timeout(500)
    check('note mode survives a reload', sn.locator('.pill .mode').inner_text() == 'Done')
    check('dot on the noted element', sn.locator('.dot').count() == 1, str(sn.locator('.dot').count()))

    with page.expect_download(timeout=8000) as dl:
        sn.locator('.more').click(); sn.locator('.ex').click()
    md = Path(dl.value.path()).read_text()
    check('Export site downloads the Markdown', '## /sn-fixture/page2 (1)' in md and 'Shorter headline' in md and '- source: pages/home.yaml' in md)

    sn.locator('.more').click(); sn.locator('.menu .off').click(); page.wait_for_timeout(300)
    check('Turn off in the menu hides it', sn.count() == 0)
    check('off: double-tap zoom back', page.evaluate('document.documentElement.style.touchAction') == '', page.evaluate('document.documentElement.style.touchAction'))
    page.reload(); page.wait_for_timeout(800)
    check('stays hidden for this tab', sn.count() == 0)
    page.goto(BASE + f'#notes={KEY}')
    sn.locator('.pill').wait_for(timeout=5000)
    check('the #notes link brings it back', sn.count() == 1)
    ctx.close()

    # a browser that only has the old annotator key, and no name yet
    ctx = context(p, False)
    page = ctx.new_page()
    page.goto(BASE + 'page2')
    page.evaluate(f"localStorage.setItem('annot_key_localhost', '{KEY}')")
    page.reload()
    sn = page.locator('site-notes')
    sn.locator('.pill').wait_for(timeout=5000)
    check('old annotator key still works', sn.count() == 1)
    sn.locator('.pill .mode').click()
    lead = page.locator('.lead').bounding_box()
    page.mouse.click(lead['x'] + 5, lead['y'] + 5)
    sn.locator('.card').wait_for(state='visible')
    check('asks for a name once', sn.locator('input.who').is_visible())
    sn.locator('input.who').fill('Ola')
    sn.locator('.rm').click()
    page.wait_for_timeout(1200)
    n = {x['author']: x for x in hub({'a': 'list', 'site': SITE, 'status': 'all'})}
    check('name saved with the note', 'Ola' in n and n['Ola']['action'] == 'remove', str(list(n)))
    page.mouse.click(h1['x'] + 20, h1['y'] + 10)
    sn.locator('.card').wait_for(state='visible')
    check('name not asked again', not sn.locator('input.who').is_visible())
    ctx.close()

    # extension on a site that has notes.js: page UI steps aside, extension writes to the site's hub (wrong site key -> refused)
    ctx = context(p, True)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    page = ctx.new_page()
    page.goto(BASE + f'#notes={KEY}')
    sn = page.locator('site-notes')
    page.locator('site-notes[data-by=page] .pill').wait_for(timeout=5000)
    sw.evaluate("chrome.tabs.query({url: 'http://localhost:18080/sn-fixture/*'}).then(([t]) => toggle(t))")
    page.locator('site-notes[data-by=ext] .pill').wait_for(timeout=5000)
    page.wait_for_timeout(300)
    check('page UI steps aside for the extension', page.locator('site-notes[data-by=page]').count() == 0 and sn.count() == 1)
    page.evaluate("localStorage.setItem('sn_key', 'wrongkey0000')")
    lead = page.locator('.lead').bounding_box()
    page.mouse.click(lead['x'] + 5, lead['y'] + 5)
    sn.locator('.card textarea').fill('via extension')
    sn.locator('.card textarea').press('Enter')
    sn.locator('.toast.show').wait_for(timeout=8000)
    t = sn.locator('.toast').inner_text()
    check('extension uses the site hub and its key', 'forbidden' in t, t)
    page.evaluate(f"localStorage.setItem('sn_key', '{KEY}')")
    page.mouse.click(lead['x'] + 5, lead['y'] + 5)
    sn.locator('.card textarea').fill('via extension')
    sn.locator('.card textarea').press('Enter')
    page.wait_for_timeout(2500)
    t = sn.locator('.toast').inner_text()
    check('extension saves to the site hub, with screenshot', t.startswith('Saved #') and 'no screenshot' not in t, t)
    sw.evaluate("chrome.tabs.query({url: 'http://localhost:18080/sn-fixture/*'}).then(([t]) => toggle(t))")
    page.locator('site-notes[data-by=page] .pill').wait_for(timeout=5000)
    check('extension off: page UI comes back', page.locator('site-notes[data-by=ext]').count() == 0)
    ctx.close()

if '--keep' not in sys.argv:
    purge()
print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
