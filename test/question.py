"""QUESTION notes (annot ask), answers in the export, fixed notes hidden until "Show fixed".
Fixture page routed at http://localhost:18080/sn-fixture/q (same origin as the QA hub). Brave already on this Mac.
Run: source ~/code/the-template/venv/bin/activate && python3 test/question.py"""
import json, os, re, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
import importlib.util
ROOT = Path(__file__).resolve().parent.parent
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
env = dict(l.strip().split('=', 1) for l in (ROOT / '.secrets/hub.env').read_text().splitlines() if '=' in l)
KEY, SITE = env['SN_KEY'], 'localhost:18080'
BASE = 'http://localhost:18080/sn-fixture/'
PAGE = """<!doctype html><html><head><meta charset=utf-8><title>Q</title>
<script src="/annot/notes.js" data-site-notes defer></script></head>
<body style="margin:0"><section id="rezerwacja" style="padding:40px"><h2>Reserve</h2><p>text</p></section></body></html>"""
annot = lambda *a: subprocess.run([str(ROOT / 'bin/annot'), '-s', SITE, *a], capture_output=True, text=True, check=True).stdout
spec = importlib.util.spec_from_file_location('pg', ROOT / 'test/page.py')  # reuse purge() without running the tests
src = (ROOT / 'test/page.py').read_text().split('purge()\nwith sync_playwright')[0]
ns = {'__file__': str(ROOT / 'test/page.py')}; exec(compile(src, 'page.py', 'exec'), ns); purge = ns['purge']
fails = []
def check(name, ok, extra=''):
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
    if not ok: fails.append(name)
purge()
try:
    out = json.loads(annot('ask', '/sn-fixture/q', '#rezerwacja > h2', 'TEST: which dates?'))
    qid = out['id']
    md = annot('export', SITE)
    check('export lists QUESTION with no answer yet', f'### #{qid} QUESTION' in md and 'answer: (none yet)' in md)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True, viewport={'width': 1280, 'height': 800})
        ctx.route(BASE + '**', lambda r: r.fulfill(content_type='text/html', body=PAGE))
        page = ctx.new_page()
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(BASE + 'q#notes=' + KEY + '&who=Owner')
        sn = page.locator('site-notes'); sn.locator('.pill').wait_for(timeout=5000); page.wait_for_timeout(600)
        dot = sn.locator('.dot.question')
        check('red question marker drawn while paused (empty element/rect fields)', dot.count() == 1)
        color = dot.evaluate('e => getComputedStyle(e).backgroundColor')
        check('marker is red', color == 'rgb(217, 4, 41)', color)
        dot.click()
        sn.locator('.card').wait_for(state='visible')
        check('card shows the question', 'which dates' in sn.locator('.qbox').inner_text() and sn.locator('.ok').inner_text() == 'Answer')
        sn.locator('.card textarea').fill('1-5 June')
        sn.locator('.card textarea').press('Enter')
        page.wait_for_timeout(1200)
        md = annot('export', SITE)
        check('answer appears in the export, note still open', 'answer (' in md and '"1-5 June"' in md and f'### #{qid} QUESTION' in md and 'done' not in md.split(f'#{qid}')[1].split('\n')[0])
        annot('fix', str(qid), 'test closed')
        page.reload(); sn.locator('.pill').wait_for(timeout=5000); page.wait_for_timeout(800)
        check('fixed note hidden by default', sn.locator('.dot.changed').count() == 0 and sn.locator('.dot.question').count() == 0)
        page.evaluate("document.querySelector('site-notes').shadowRoot.querySelector('.menu .hf').hidden = false")
        page.evaluate("document.querySelector('site-notes').shadowRoot.querySelector('.menu .hf').click()")
        page.wait_for_timeout(500)
        check('Show fixed draws the green marker', sn.locator('.dot.changed').count() == 1)
        check('label flips to Hide fixed', sn.locator('.menu .hf').inner_text() == 'Hide fixed')
        page.reload(); sn.locator('.pill').wait_for(timeout=5000); page.wait_for_timeout(800)
        check('choice remembered in localStorage', sn.locator('.dot.changed').count() == 1)
        check('no page errors', not errs, str(errs))
        ctx.close()
finally:
    purge()
print('\nall passed' if not fails else f'\n{len(fails)} FAILED')
raise SystemExit(1 if fails else 0)
