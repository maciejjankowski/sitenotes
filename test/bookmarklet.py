"""Bookmarklet on a foreign site: the page is served from http://127.0.0.1:18080/sn-foreign/ (another origin than the hub at
localhost:18080), has no notes.js of its own; the bookmarklet code from the hub page injects it. Checks cross-origin hub calls,
activation via data-key, a saved note under that host, and that Lead still sends taps. Installed Brave only.
Run: source ~/code/the-template/venv/bin/activate && python3 test/bookmarklet.py"""
import json, os, re, sqlite3, sys, tempfile, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
# Chrome blocks a plain-http page from loading localhost resources (local network access), so the foreign page is served over
# https on a fake host and the hub is the REAL mj.com hub, exactly as a phone would use it. Test notes are deleted at the end.
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/sites/maciejjankowski.com.env').read_text().splitlines() if '=' in l)
KEY, SITE, BASE = env['SN_KEY'], 'foreign.test', 'https://foreign.test/'
PAGE = '<!doctype html><html><head><meta charset=utf-8><title>Foreign</title></head><body><h1>Foreign site</h1><p class="lead">No notes.js here</p></body></html>'

def purge():  # through the API: the hub is remote
    for n in json.loads(op.open(f"{env['SN_HUB']}/api.php?a=list&site={SITE}&status=all").read()):
        op.open(urllib.request.Request(f"{env['SN_HUB']}/api.php", data=json.dumps({'a': 'delete', 'id': n['id'], 'who': 'test'}).encode(), headers={'Content-Type': 'application/json'}))
fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
    if not ok: fails.append(name)

# the bookmarklet code as the hub page prints it (cookie login first)
import http.cookiejar
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj)); op.addheaders = [('X-SN-Key', KEY)]
op.open(f"{env['SN_HUB']}/?key={KEY}")
html = op.open(f"{env['SN_HUB']}/").read().decode()
m = re.search(r'<textarea[^>]*>(javascript:.*?)</textarea>', html, re.S)
bm = __import__('html').unescape(m.group(1)) if m else ''
check('hub page prints the bookmarklet', bm.startswith('javascript:') and 'data-key' in bm)

purge()
with sync_playwright() as p:
    c = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True, viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, ignore_https_errors=True)
    c.route(BASE + '**', lambda r: r.fulfill(content_type='text/html', body=PAGE))
    pg = c.new_page(); errs = []; pg.on('console', lambda m_: m_.type == 'error' and errs.append(m_.text))
    pg.goto(BASE); pg.wait_for_timeout(300)
    check('foreign page has no Site Notes', pg.locator('site-notes').count() == 0)
    pg.evaluate(bm[len('javascript:'):])
    pg.locator('site-notes .pill').wait_for(timeout=5000)
    check('bookmarklet injects the pill', True)
    sn = pg.locator('site-notes')
    sn.locator('.pill .mode').click() if sn.locator('.pill .mode').inner_text() == 'Add note' else None
    b = pg.locator('.lead').bounding_box(); pg.mouse.click(b['x'] + 10, b['y'] + 5)
    sn.locator('.card').wait_for(state='visible')
    sn.locator('.card textarea').fill('foreign note'); sn.locator('.card textarea').press('Enter')
    sn.locator('.toast.show').wait_for(timeout=8000)
    check('note saved cross-origin', sn.locator('.toast').inner_text().startswith('Saved #'), sn.locator('.toast').inner_text())
    sn.locator('.more').click(); sn.locator('.rm-mode').click()
    b = pg.locator('h1').bounding_box(); pg.mouse.click(b['x'] + 10, b['y'] + 5); pg.wait_for_timeout(800)
    ptr = json.loads(op.open(f"{env['SN_HUB']}/api.php?a=pointer&site={SITE}").read())
    check('Lead tap reaches the hub from the foreign site', ptr.get('selector') == 'h1', str(ptr))
    pg.reload(); pg.wait_for_timeout(800)
    check('after reload the foreign site is plain again (no persistent injection)', pg.locator('site-notes').count() == 0)
    check('no console errors', not errs, str(errs[:2]))
    c.close()
notes = json.loads(op.open(f"{env['SN_HUB']}/api.php?a=list&site={SITE}&status=open").read())
check('note stored under the foreign host', len(notes) == 1 and notes[0]['selector'] == 'p.lead', str([(n['site'], n['selector']) for n in notes]))
if '--keep' not in sys.argv: purge()
print('\n%d failed' % len(fails) if fails else '\nall passed'); sys.exit(1 if fails else 0)
