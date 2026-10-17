"""End-to-end test of the Site Notes extension in Playwright Chromium.
Loads extension/ unpacked, serves two fixture pages via request routing (http://fixture.test/),
turns note mode on the way the toolbar icon does, then: hover, click -> blur card, type + Enter,
Remove, link click is swallowed, Esc pause -> link navigates -> mode is back on the next page,
dots for saved notes, Export site. Notes go to the real hub (site fixture.test) and are deleted at the end.
Run: source ~/code/the-template/venv/bin/activate && python3 test/e2e.py"""
import json, os, sqlite3, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = os.environ.get('SN_EXT', str(ROOT / 'extension'))
OUT = ROOT / 'test' / 'out'
OUT.mkdir(exist_ok=True)
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/hub.env').read_text().splitlines() if '=' in l)
SITE = 'fixture.test'
# Only browsers already on this Mac (MJ: never download browsers). Branded Chrome ignores --load-extension.
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')

PAGE = """<!doctype html><html><head><meta charset=utf-8><title>Fixture %(t)s</title>
<style>body{font:16px system-ui;margin:0} header{display:flex;gap:20px;padding:16px 24px;background:#eee}
.hero{padding:60px 24px;background:linear-gradient(#fdf6e3,#f4e3c1)} .hero h1{font-size:40px;margin:0 0 10px}
.price{font-size:28px;font-weight:700;padding:8px 24px} .promo{margin:16px 24px;padding:16px;background:#c00;color:#fff}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px} .card{border:1px solid #ccc;padding:16px;min-height:160px}</style></head>
<body><header><a href="/">Home</a><a id="next" href="/page2">Page 2</a><button onclick="document.title='CLICKED'">Buy</button></header>
<section class="hero"><h1>%(t)s headline</h1><p>Some intro text that is too long and boring.</p></section>
<div class="price">150 EUR / session</div><div class="promo" id="promo">PROMO BANNER - SALE ENDS SOON</div>
<div class="cards"><div class="card">One</div><div class="card">Two</div><div class="card">Three</div></div>
<div style="height:1200px"></div></body></html>"""

def hub(params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{env['SN_HUB']}/api.php?{q}", headers={'X-SN-Key': env['SN_KEY']})
    return urllib.request.urlopen(req).read().decode()

import urllib.parse
fails = []
def purge():  # test notes out of the real hub
    db = sqlite3.connect(ROOT / 'hub/data/notes.sqlite')
    for (f,) in db.execute("SELECT shot FROM notes WHERE site = ? AND shot IS NOT NULL", (SITE,)):
        (ROOT / 'hub/data/shots' / f).unlink(missing_ok=True)
    db.execute("DELETE FROM events WHERE note_id IN (SELECT id FROM notes WHERE site = ?)", (SITE,))
    db.execute("DELETE FROM notes WHERE site = ?", (SITE,))
    db.commit()
purge()
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
    if not ok: fails.append(name)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True,
        viewport={'width': 1280, 'height': 800}, accept_downloads=True,
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    ctx.route('http://fixture.test/**', lambda r: r.fulfill(content_type='text/html',
        body=PAGE % {'t': 'Page 2' if r.request.url.endswith('/page2') else 'Home'}))
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    page = ctx.new_page()
    page.on('console', lambda m: m.type in ('error', 'warning') and print('  console:', m.text))
    page.goto('http://fixture.test/')
    sw.evaluate("chrome.tabs.query({url: 'http://fixture.test/*'}).then(([t]) => toggle(t))")
    sn = page.locator('site-notes')
    sn.locator('.pill').wait_for(state='visible', timeout=5000)
    check('pill shows after toggle', sn.locator('.pill .mode').inner_text() == 'Done')

    # hover -> outline with label
    box = page.locator('.price').bounding_box()
    page.mouse.move(box['x'] + 40, box['y'] + 10)
    page.wait_for_timeout(150)
    check('hover outlines element', 'price · 150 EUR' in sn.locator('.hl i').inner_text(), sn.locator('.hl i').inner_text())

    # click -> blur card, type, Enter
    page.mouse.click(box['x'] + 40, box['y'] + 10)
    sn.locator('.card').wait_for(state='visible')
    check('card opens on click', sn.locator('.card textarea').is_visible())
    sn.locator('.card textarea').fill('Price should be 180 EUR')
    sn.locator('.card textarea').press('Enter')
    sn.locator('.toast.show').wait_for(timeout=8000)
    t1 = sn.locator('.toast').inner_text()
    check('saved with screenshot', t1.startswith('Saved #') and 'no screenshot' not in t1, t1)

    # Remove on the promo banner, no text
    pb = page.locator('#promo').bounding_box()
    page.mouse.click(pb['x'] + 30, pb['y'] + 10)
    sn.locator('.card').wait_for(state='visible')
    sn.locator('.rm').click()
    page.wait_for_timeout(1500)
    t2 = sn.locator('.toast').inner_text()
    check('remove saved', t2.startswith('Marked for removal #'), t2)

    # ArrowUp widens the hovered element before the click
    cb = page.locator('.card').first.bounding_box()
    page.mouse.move(cb['x'] + 20, cb['y'] + 20)
    page.wait_for_timeout(100)
    page.keyboard.press('ArrowUp')
    page.wait_for_timeout(100)
    check('ArrowUp widens to parent', 'cards · One' in sn.locator('.hl i').inner_text(), sn.locator('.hl i').inner_text())
    page.mouse.click(cb['x'] + 20, cb['y'] + 20)
    sn.locator('.card').wait_for(state='visible')
    sel_in = sn.locator('input.sel'); cur = sn.locator('.crumbs .cur')
    sn.locator('.seld summary').click()  # the selector is folded away for reviewers
    check('widened element is picked', sel_in.input_value() == 'div.cards' and cur.inner_text() == 'cards', sel_in.input_value())
    check('no walk buttons on the card (MJ 10-17)', not sn.locator('.up').is_visible() and not sn.locator('.crumbs').is_visible())
    sn.locator('.card textarea').press('Alt+ArrowDown')
    check('Alt+ArrowDown = back to the clicked element', cur.inner_text() == 'card' and sel_in.input_value() == 'div.card:nth-of-type(1)', sel_in.input_value())
    sn.locator('.card textarea').press('Alt+ArrowUp')
    check('Alt+ArrowUp in the card = parent', cur.inner_text() == 'cards', cur.inner_text())
    sel_in.fill('div.card')
    check('ambiguous selector warns', sn.locator('.cnt').inner_text() == '3 match', sn.locator('.cnt').inner_text())
    sel_in.fill('#promo')
    check('typed selector re-targets', cur.inner_text() == 'promo' and sn.locator('.cnt').inner_text() == '', cur.inner_text())
    sel_in.fill('h1')
    page.wait_for_timeout(150)
    page.screenshot(path=str(OUT / 'card-walk.png'))
    page.keyboard.press('Escape')
    check('Esc closes card', not sn.locator('.card').is_visible())

    # Cancel, Undo, and clicking an element that already has a note
    count = lambda: len(json.loads(hub({'a': 'list', 'site': SITE, 'path': '/', 'status': 'open'})))
    hp = page.locator('.hero p').bounding_box()
    hpx, hpy = hp['x'] + 10, hp['y'] + 5
    page.mouse.click(hpx, hpy)
    sn.locator('.card').wait_for(state='visible')
    check('card has a Cancel button', sn.locator('.cancel').inner_text() == 'Cancel')
    sn.locator('.cancel').click()
    check('Cancel closes the card, nothing saved', not sn.locator('.card').is_visible() and count() == 2, str(count()))
    page.mouse.click(hpx, hpy)
    sn.locator('.rm').click()
    sn.locator('.toast.act button').wait_for(timeout=8000)
    check('remove toast offers Undo', sn.locator('.toast button').inner_text() == 'Undo')
    sn.locator('.toast button').click()
    page.wait_for_timeout(800)
    check('Undo deletes the new remove note', count() == 2, str(count()))
    page.mouse.click(hpx, hpy)
    sn.locator('.rm').click()
    page.wait_for_timeout(1500)
    page.mouse.move(hpx + 80, hpy)  # off the note's dot at the element's corner (3-digit ids make it 30 px wide)
    page.wait_for_timeout(100)
    check('hover says the element has a note', 'remove' in sn.locator('.hl i').inner_text(), sn.locator('.hl i').inner_text())
    page.mouse.click(hpx, hpy)
    sn.locator('.card').wait_for(state='visible')
    check('clicking a noted element opens its note', sn.locator('.del').is_visible() and sn.locator('.rm').inner_text() == 'Undo remove', sn.locator('.rm').inner_text())
    sn.locator('.rm').click()
    page.wait_for_timeout(800)
    check('Undo remove drops the mark', count() == 2, str(count()))
    pr = page.locator('.price').bounding_box()
    page.mouse.click(pr['x'] + 40, pr['y'] + 10)
    sn.locator('.card').wait_for(state='visible')
    check('noted element opens with its text', sn.locator('.card textarea').input_value() == 'Price should be 180 EUR', sn.locator('.card textarea').input_value())
    sn.locator('.del').click()
    sn.locator('.toast.act button').wait_for(timeout=8000)
    sn.locator('.toast button').click()
    page.wait_for_timeout(800)
    check('Undo restores a deleted note', count() == 2, str(count()))

    # button and link clicks never reach the page while note mode is on
    page.locator('body header button').click(force=True)
    page.keyboard.press('Escape')
    check('page button blocked', page.title() != 'CLICKED', page.title())
    page.locator('#next').click(force=True)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    check('link blocked in note mode', page.url == 'http://fixture.test/', page.url)

    # dots for the 2 notes on this page
    page.wait_for_timeout(500)
    check('two dots on page', sn.locator('.dot').count() == 2, str(sn.locator('.dot').count()))
    check('pill count', sn.locator('.pill .n').inner_text() == '2 open', sn.locator('.pill .n').inner_text())
    page.screenshot(path=str(OUT / 'dots.png'))

    # edit a note from its dot: walk away and back (undo), change text; then move another note by typing a selector
    sn.locator('.dot:not(.remove)').click()
    sn.locator('.card').wait_for(state='visible')
    check('dot opens the note on its element', sel_in.input_value() == 'div.price' and sn.locator('.del').is_visible(), sel_in.input_value())
    sn.locator('.card textarea').press('Alt+ArrowUp'); sn.locator('.card textarea').press('Alt+ArrowDown')
    check('walk up + down returns to the note element', sel_in.input_value() == 'div.price', sel_in.input_value())
    sn.locator('.card textarea').fill('Price should be 180 EUR (edited)')
    sn.locator('.card textarea').press('Enter')
    page.wait_for_timeout(1500)
    sn.locator('.dot.remove').click()
    sn.locator('.card').wait_for(state='visible')
    sel_in.fill('div.cards')
    sn.locator('.ok').click()
    page.wait_for_timeout(1500)
    moved = {n['action']: n for n in json.loads(hub({'a': 'list', 'site': SITE, 'path': '/', 'status': 'open'}))}
    check('edit kept the selector', moved['change']['selector'] == 'div.price' and moved['change']['comment'].endswith('(edited)'), str(moved['change']['selector']))
    check('edit moved the remove note', moved['remove']['selector'] == 'div.cards' and 'One' in moved['remove']['text'], str(moved['remove']['selector']))

    # single-page app routes in the hash (#/a/, #/b/) are separate pages; plain #anchors are not
    page.evaluate("location.hash = '#/route-a/'")
    page.wait_for_timeout(1500)
    check('hash route: notes of / are not shown on #/route-a/', sn.locator('.dot').count() == 0, str(sn.locator('.dot').count()))
    ra = page.locator('.price').bounding_box()
    page.mouse.click(ra['x'] + 40, ra['y'] + 10)
    sn.locator('.card').wait_for(state='visible')
    check('hash route: same element there opens a new note', not sn.locator('.del').is_visible())
    sn.locator('.card textarea').fill('route A note')
    sn.locator('.card textarea').press('Enter')
    page.wait_for_timeout(1500)
    page.evaluate("location.hash = '#/route-b/'")
    page.wait_for_timeout(1500)
    check('hash route: route A note not on route B', sn.locator('.dot').count() == 0, str(sn.locator('.dot').count()))
    page.evaluate("location.hash = '#/route-a/'")
    page.wait_for_timeout(1500)
    check('hash route: route A note back on route A', sn.locator('.dot').count() == 1, str(sn.locator('.dot').count()))
    ids = [n['id'] for n in json.loads(hub({'a': 'list', 'site': SITE, 'path': '/#/route-a/', 'status': 'open'}))]
    check('hash route: saved under /#/route-a/', len(ids) == 1, str(ids))
    for i in ids:  # keep the counts of the rest of the test as they were
        urllib.request.urlopen(urllib.request.Request(f"{env['SN_HUB']}/api.php", data=json.dumps({'a': 'delete', 'id': i}).encode(),
                               headers={'X-SN-Key': env['SN_KEY'], 'Content-Type': 'application/json'}))
    page.evaluate("location.hash = '#price'")
    page.wait_for_timeout(1500)
    check('plain #anchor: same page as /', sn.locator('.dot').count() == 2, str(sn.locator('.dot').count()))
    page.evaluate("history.replaceState(null, '', '/')")
    page.wait_for_timeout(1200)

    # Esc pauses -> link works -> next page comes back in note mode
    page.mouse.move(5, 400)
    page.keyboard.press('Escape')
    check('Esc pauses', sn.locator('.pill .mode').inner_text() == 'Add note')
    page.locator('#next').click()
    page.wait_for_url('http://fixture.test/page2')
    page.locator('site-notes .pill').wait_for(state='visible', timeout=5000)
    check('mode survives navigation', page.locator('site-notes .pill .mode').inner_text() == 'Done')
    h1 = page.locator('h1').bounding_box()
    page.mouse.click(h1['x'] + 20, h1['y'] + 10)
    page.locator('site-notes .card textarea').fill('Shorter headline, max 5 words')
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'card.png'))
    page.locator('site-notes .ok').click()
    page.wait_for_timeout(1500)

    # export site: all pages, one file
    page.locator('site-notes .more').click(); page.locator('site-notes .ex').click()
    page.wait_for_timeout(2500)
    dl = sw.evaluate("chrome.downloads.search({orderBy: ['-startTime'], limit: 1}).then(([d]) => d && {file: d.filename, state: d.state, err: d.error || ''})")
    print('  download:', dl)
    check('export downloaded a file', bool(dl) and dl['state'] == 'complete', str(dl))  # Playwright renames downloads to GUIDs in its temp dir
    md = hub({'a': 'export', 'site': SITE, 'status': 'open', 'format': 'md'})
    (OUT / 'export.md').write_text(md)
    check('export has both pages', '## / (2)' in md and '## /page2 (1)' in md)
    check('export has REMOVE + CHANGE', '### #' in md and 'REMOVE' in md and 'Price should be 180 EUR' in md)
    check('export toast', 'open notes of fixture.test' in page.locator('site-notes .toast').inner_text(), page.locator('site-notes .toast').inner_text())

    # turn off from the pill
    page.locator('site-notes .x').click(); page.wait_for_timeout(200)
    check('x tucks the pill into an edge tab', page.locator('site-notes .pill').is_hidden() and page.locator('site-notes .tab').is_visible())
    page.locator('site-notes .tab').click(); page.wait_for_timeout(200)
    check('tab brings the pill back', page.locator('site-notes .pill').is_visible())
    page.locator('site-notes .more').click(); page.locator('site-notes .menu .off').click(); page.wait_for_timeout(300)
    check('Turn off in the menu removes UI', page.locator('site-notes').count() == 0)
    page.locator('#next').click() if page.locator('#next').count() else None
    ctx.close()

notes = json.loads(hub({'a': 'list', 'site': SITE, 'status': 'all'}))
shots = [n for n in notes if n['shot']]
check('hub has 3 notes', len(notes) == 3, str(len(notes)))
check('all 3 have screenshots', len(shots) == 3, str(len(shots)))
if shots:
    import shutil
    shutil.copy(ROOT / 'hub/data/shots' / shots[0]['shot'], OUT / 'shot-first.jpg')
print(json.dumps([{k: n[k] for k in ('id', 'path', 'action', 'comment', 'selector', 'text')} for n in notes], ensure_ascii=False, indent=1))

if '--keep' not in sys.argv:
    purge()
print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
