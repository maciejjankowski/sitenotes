"""Remote / Follow: a phone (390x844, Remote on) taps elements; a desktop (1280x800, Follow on) on the same site opens the
card on that element. Both run notes.js on the QA fixture (http://localhost:18080/sn-fixture/), installed Brave only.
Run: source ~/code/the-template/venv/bin/activate && python3 test/remote.py"""
import json, os, sqlite3, sys, tempfile, urllib.parse, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/hub.env').read_text().splitlines() if '=' in l)
KEY, SITE, BASE = env['SN_KEY'], 'localhost:18080', 'http://localhost:18080/sn-fixture/'
PAGE = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width"><title>%(t)s</title>
<script src="/annot/notes.js" data-site-notes defer></script>
<style>body{font:16px system-ui;margin:0} header{padding:16px;background:#eee} section{padding:40px 16px}
@media (max-width:600px){ .desk-only{display:none} }</style></head>
<body><header><a id="next" href="/sn-fixture/page2">Page 2</a><span class="desk-only">desktop nav</span></header>
<section><h1>%(t)s headline</h1><p class="lead">Lead text here</p><p class="price">150 EUR / session</p></section>
<div style="height:900px"></div></body></html>"""

def purge():
    db = sqlite3.connect(ROOT / 'hub/data/notes.sqlite')
    db.execute("DELETE FROM events WHERE note_id IN (SELECT id FROM notes WHERE site = ? AND path LIKE '/sn-fixture/%')", (SITE,))
    db.execute("DELETE FROM notes WHERE site = ? AND path LIKE '/sn-fixture/%'", (SITE,))
    db.execute("CREATE TABLE IF NOT EXISTS pointer(site TEXT PRIMARY KEY, seq INTEGER NOT NULL, path TEXT, selector TEXT, text TEXT, viewport TEXT, at TEXT NOT NULL)")
    db.execute("DELETE FROM pointer WHERE site = ?", (SITE,))
    db.commit()

fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
    if not ok: fails.append(name)

def ctx_of(p, w, h, mobile):
    c = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True,
        viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
    c.route(BASE + '**', lambda r: r.fulfill(content_type='text/html', body=PAGE % {'t': 'Page 2' if '/page2' in r.request.url else 'Home'}))
    return c

purge()
with sync_playwright() as p:
    phone, desk = ctx_of(p, 390, 844, True), ctx_of(p, 1280, 800, False)
    ph, dk = phone.new_page(), desk.new_page()
    for pg in (ph, dk):
        pg.goto(BASE + f'#notes={KEY}&who=Tester')
        pg.locator('site-notes .pill').wait_for(timeout=5000)
    psn, dsn = ph.locator('site-notes'), dk.locator('site-notes')
    psn.locator('.more').click()
    check('phone menu hides "Type for the phone"', not psn.locator('.fl').is_visible())
    psn.locator('.rm-mode').click()
    psn.locator('.more').click()
    check('Point on sets note mode', psn.locator('.rm-mode').inner_text().startswith('Pointing') and psn.locator('.pill .mode').inner_text() == 'Done', psn.locator('.rm-mode').inner_text())
    psn.locator('.more').click()
    dsn.locator('.pill .mode').click()  # desktop: notes on
    dsn.locator('.more').click(); dsn.locator('.fl').click()
    dk.wait_for_timeout(1000)
    dsn.locator('.more').click()
    check('desktop waits for the phone', 'waiting' in dsn.locator('.fl').inner_text(), dsn.locator('.fl').inner_text())
    dsn.locator('.more').click()

    b = ph.locator('.price').bounding_box()
    ph.mouse.click(b['x'] + 20, b['y'] + 8)
    ph.wait_for_timeout(400)
    check('phone tap opens no card', not psn.locator('.card').is_visible())
    check('phone shows sent outline', 'sent' in psn.locator('.hl i').inner_text(), psn.locator('.hl i').inner_text())
    dsn.locator('.card').wait_for(state='visible', timeout=5000)
    check('desktop opens the card on the tapped element', dsn.locator('input.sel').input_value() == 'p.price', dsn.locator('input.sel').input_value())
    check('card says which viewport tapped', '390x844' in dsn.locator('.card textarea').get_attribute('placeholder'))
    dsn.locator('.card textarea').fill('typed on the desktop')
    dsn.locator('.card textarea').press('Enter')
    dk.wait_for_timeout(1500)

    b = ph.locator('.lead').bounding_box()
    ph.mouse.click(b['x'] + 20, b['y'] + 8)
    dsn.locator('.card').wait_for(state='visible', timeout=5000)
    check('second tap moves the card', dsn.locator('input.sel').input_value() == 'p.lead', dsn.locator('input.sel').input_value())
    dk.keyboard.press('Escape')

    # phone goes to page 2 and taps there: desktop follows the page, then the element
    psn.locator('.pill .mode').click()  # pause so the link works
    ph.locator('#next').click(); ph.wait_for_url(BASE + 'page2')
    psn.locator('.pill').wait_for(timeout=5000)
    psn.locator('.more').click()
    check('Point survives navigation', psn.locator('.rm-mode').inner_text().startswith('Pointing'), psn.locator('.rm-mode').inner_text())
    psn.locator('.more').click()
    b = ph.locator('h1').bounding_box()
    ph.mouse.click(b['x'] + 20, b['y'] + 8)
    dk.wait_for_url(BASE + 'page2', timeout=8000)
    dk.locator('site-notes .card').wait_for(state='visible', timeout=8000)
    check('desktop followed to page 2 and opened h1', dk.locator('site-notes input.sel').input_value() == 'h1', dk.url)
    dk.locator('site-notes .more').click()
    check('Type-for-phone survives navigation', 'Typing for the phone' in dk.locator('site-notes .fl').inner_text(), dk.locator('site-notes .fl').inner_text())

    hub = urllib.request.urlopen(urllib.request.Request(f"{env['SN_HUB']}/api.php?a=list&site={SITE}&status=open", headers={'X-SN-Key': KEY})).read()
    notes = [n for n in json.loads(hub) if n['path'].startswith('/sn-fixture/')]
    check('note saved with desktop text on phone element', len(notes) == 1 and notes[0]['selector'] == 'p.price' and notes[0]['comment'] == 'typed on the desktop', str([(n['selector'], n['comment']) for n in notes]))
    phone.close(); desk.close()
if '--keep' not in sys.argv: purge()
print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
