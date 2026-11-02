"""Notes inside a modal window (MJ 2026-11-02: "dialog windows do not allow adding new annotations").
A <dialog> opened with showModal() makes the rest of the page inert and sits in the top layer, so a notes UI
outside it can neither be clicked nor seen. The UI must move into the open modal and back when it closes.
Fixture page routed at http://localhost:18080/sn-fixture/dialog (same origin as the QA hub). Brave only.
Run: source ~/code/the-template/venv/bin/activate && python3 test/dialog.py"""
import json, os, sqlite3, sys, tempfile, urllib.parse, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/hub.env').read_text().splitlines() if '=' in l)
KEY, SITE = env['SN_KEY'], 'localhost:18080'
BASE = 'http://localhost:18080/sn-fixture/dialog'
PAGE = """<!doctype html><html><head><meta charset=utf-8><title>Dialog</title>
<script src="/annot/notes.js" data-site-notes defer></script>
<style>body{font:16px system-ui;margin:0} section{padding:40px 16px} dialog{width:min(560px,100vw);height:80vh;border:0}</style></head>
<body><section><h1>Page under the window</h1><button id="open">Open</button></section>
<dialog id="win"><h2 id="wintitle">Krok po kroku</h2><p id="inside">Stan: 3 zły</p><button id="shut">Close</button></dialog>
<script>document.getElementById('open').onclick = () => document.getElementById('win').showModal(); document.getElementById('shut').onclick = () => document.getElementById('win').close();</script>
</body></html>"""

def purge():
    db = sqlite3.connect(ROOT / 'hub/data/notes.sqlite')
    db.execute("DELETE FROM events WHERE note_id IN (SELECT id FROM notes WHERE site = ? AND path = '/sn-fixture/dialog')", (SITE,))
    db.execute("DELETE FROM notes WHERE site = ? AND path = '/sn-fixture/dialog'", (SITE,))
    db.commit()

def notes():
    req = urllib.request.Request(f"{env['SN_HUB']}/api.php?" + urllib.parse.urlencode({'a': 'list', 'site': SITE, 'status': 'all'}), headers={'X-SN-Key': KEY})
    return [n for n in json.loads(urllib.request.urlopen(req).read().decode()) if n['path'] == '/sn-fixture/dialog']

fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
    if not ok: fails.append(name)

purge()
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True, viewport={'width': 390, 'height': 844})
    ctx.route(BASE + '**', lambda r: r.fulfill(content_type='text/html', body=PAGE))
    page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    sn = page.locator('site-notes')
    page.goto(BASE + f'#notes={KEY}&who=Tester'); sn.locator('.pill').wait_for(timeout=5000)
    page.click('#open'); page.wait_for_timeout(400)
    where = page.evaluate("document.querySelector('site-notes').parentElement.id")
    check('notes UI moves into the open modal window', where == 'win', where)
    box = sn.locator('.pill').bounding_box()
    top = page.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.tagName.toLowerCase(); }", [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2])
    check('the pill is on top and reachable', top == 'site-notes', top)
    sn.locator('.pill .mode').click(timeout=3000)
    page.locator('#inside').click(); sn.locator('.card').wait_for(state='visible', timeout=3000)
    check('a note card opens on an element inside the window', sn.locator('.card').is_visible())
    sn.locator('.card textarea').fill('Tekst w oknie do zmiany'); sn.locator('.card textarea').press('Enter')
    sn.locator('.toast.show').wait_for(timeout=8000)
    n = notes()
    check('the note is saved on the element inside the window', len(n) == 1 and 'inside' in (n[0]['selector'] or ''), n and n[0]['selector'])
    check('the window stayed open while noting', page.evaluate("document.getElementById('win').open"))
    page.evaluate("document.getElementById('win').close()"); page.wait_for_timeout(300)
    where = page.evaluate("document.querySelector('site-notes').parentElement.tagName")
    check('closing the window brings the notes UI back to the page', where == 'HTML', where)
    check('pill still visible after the window closed', sn.locator('.pill').is_visible())
    check('no page errors', not errors, errors)
    ctx.close()
purge()
print('\nall passed' if not fails else f'\n{len(fails)} failed'); sys.exit(1 if fails else 0)
