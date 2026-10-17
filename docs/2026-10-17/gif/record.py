"""Record the two Site Notes GIFs on a FIXTURE page (fixture.html, an invented bakery) in installed Brave with the extension,
notes in the QA hub under the site bakery.test, deleted at the end. Never a client page: a GIF is a publication.
GIF 1 batch.gif: Add note -> four elements, four short notes, no chat. GIF 2 review.gif: the agent fixed two -> green ticks -> Keep one, Revert one.
Run: source ~/code/the-template/venv/bin/activate && python3 record.py"""
import io, json, re, sqlite3, subprocess, tempfile, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent; ROOT = HERE.parent.parent.parent
EXT = str(ROOT / 'extension'); SITE = 'bakery.test'; URL = f'http://{SITE}/'
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/hub.env').read_text().splitlines() if '=' in l)
BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
W, H = 1180, 720
PAGE = (HERE / 'fixture.html').read_text()

def purge():
    db = sqlite3.connect(ROOT / 'hub/data/notes.sqlite')
    for (f,) in db.execute("SELECT shot FROM notes WHERE site = ? AND shot IS NOT NULL", (SITE,)): (ROOT / 'hub/data/shots' / f).unlink(missing_ok=True)
    db.execute("DELETE FROM events WHERE note_id IN (SELECT id FROM notes WHERE site = ?)", (SITE,)); db.execute("DELETE FROM notes WHERE site = ?", (SITE,)); db.commit()
def hub(params):
    req = urllib.request.Request(f"{env['SN_HUB']}/api.php?{urllib.parse.urlencode(params)}", headers={'X-SN-Key': env['SN_KEY']})
    return json.loads(urllib.request.urlopen(req).read().decode())
purge()

frames = []
def shot(page, ms, cursor=None):
    im = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
    if cursor:
        d = ImageDraw.Draw(im, 'RGBA'); x, y = cursor
        d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=(47, 111, 237, 70), outline=(47, 111, 237, 220), width=2); d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(47, 111, 237, 255))
    frames.append((im, ms))
def save(name):
    ims = [f[0].resize((W * 2 // 3, H * 2 // 3), Image.LANCZOS).quantize(colors=128, method=Image.MEDIANCUT) for f in frames]
    ims[0].save(HERE / name, save_all=True, append_images=ims[1:], duration=[f[1] for f in frames], loop=0, optimize=True)
    print(name, len(frames), 'frames', round((HERE / name).stat().st_size / 1024), 'KB'); frames.clear()
def typed(page, sn, text):
    for ch in text:
        sn.locator('.card textarea').type(ch, delay=0)
        if ch == ' ' or len(text) < 14: shot(page, 90)
    shot(page, 500)
def mid(b, dx=None): return (b['x'] + (dx if dx is not None else b['width'] / 2), b['y'] + b['height'] / 2)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True, viewport={'width': W, 'height': H},
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    ctx.route(f'http://{SITE}/**', lambda r: r.fulfill(content_type='text/html', body=PAGE))
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    page = ctx.new_page(); page.goto(URL)
    sw.evaluate(f"chrome.tabs.query({{url: 'http://{SITE}/*'}}).then(([t]) => toggle(t))")
    sn = page.locator('site-notes'); sn.locator('.pill').wait_for(state='visible', timeout=5000); page.wait_for_timeout(600)
    sn.locator('.pill .mode').click(); page.wait_for_timeout(200)  # extension starts on: show the paused state first, like a reviewer sees it
    # ---- GIF 1: batch ----
    shot(page, 1200)
    c = mid(sn.locator('.pill .mode').bounding_box()); shot(page, 500, c); sn.locator('.pill .mode').click(); page.wait_for_timeout(200); shot(page, 1000, c)
    plan = [(page.locator('.cards .price').first, 'ciemniej'), (page.locator('.promo'), None), (page.locator('.hero h1'), 'większa czcionka'), (page.locator('.hero p'), 'krócej')]
    for loc, text in plan:
        c = mid(loc.bounding_box(), 60); page.mouse.move(*c); page.wait_for_timeout(150); shot(page, 700, c)
        page.mouse.click(*c); sn.locator('.card').wait_for(state='visible', timeout=5000); page.wait_for_timeout(150); shot(page, 600, c)
        if text: typed(page, sn, text); sn.locator('.card textarea').press('Enter')
        else: rc = mid(sn.locator('.rm').bounding_box()); shot(page, 500, rc); sn.locator('.rm').click()
        sn.locator('.toast.show').wait_for(timeout=8000); page.wait_for_timeout(200); shot(page, 900)
    page.wait_for_timeout(600); shot(page, 2200); save('batch.gif')
    made = hub({'a': 'list', 'site': SITE, 'status': 'open'}); print('notes made:', [(n['id'], n['comment'] or n['action']) for n in made])
    # ---- the agent fixes two of them ----
    fixes = {}
    for n in made:
        if n['comment'] == 'ciemniej': fixes[n['id']] = 'Price is two shades darker now (#9a3412) | pages/home.yaml cards.price.color; przed: fixes/028.patch'
        if n['comment'] == 'większa czcionka': fixes[n['id']] = 'Headline is 52px instead of 44px | pages/home.yaml hero.h1.size; przed: fixes/029.patch'
    for i, body in fixes.items(): subprocess.run([str(ROOT / 'bin/annot'), '-s', SITE, 'fix', str(i), body], check=True, capture_output=True)
    # ---- GIF 2: review ----
    page.reload(); sn = page.locator('site-notes'); sn.locator('.pill').wait_for(state='visible', timeout=5000); page.wait_for_timeout(900)
    if sn.locator('.pill .mode').inner_text() == 'Done': sn.locator('.pill .mode').click(); page.wait_for_timeout(200)
    shot(page, 1200)
    c = mid(sn.locator('.pill .chs').bounding_box()); shot(page, 600, c); sn.locator('.pill .chs').click(); page.wait_for_timeout(300); shot(page, 1400, c)
    for i, action in zip(list(fixes), ['accept', 'revert']):
        d = sn.locator(f'.dot.changed[title^="#{i} "]').first
        c = mid(d.bounding_box()); page.mouse.move(*c); shot(page, 600, c); d.click(); sn.locator('.chg').wait_for(state='visible'); page.wait_for_timeout(200); shot(page, 2000, c)
        btn = sn.locator('.chg .keep' if action == 'accept' else '.chg .back'); c = mid(btn.bounding_box()); shot(page, 700, c); btn.click(); page.wait_for_timeout(200)
        if action == 'revert':
            shot(page, 700, c)
            for ch in 'za duże': sn.locator('.chg .why').type(ch)
            shot(page, 600); sn.locator('.chg .why').press('Enter')
        sn.locator('.toast.show').wait_for(timeout=8000); page.wait_for_timeout(250); shot(page, 1500)
    page.wait_for_timeout(500); shot(page, 2200); save('review.gif')
    ctx.close()
purge(); print('cleanup done, site', SITE, 'notes:', len(hub({'a': 'list', 'site': SITE, 'status': 'all'})))
