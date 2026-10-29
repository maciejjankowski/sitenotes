"""Failure log: a hub that cannot start answers clean JSON and logs it (server side), notes.js keeps the failed call
in the browser and sends it to the hub as soon as the hub works again (client side), bin/annot-style reading via ?a=errors.
Uses a throw-away hub copy in the QA docroot (~/code/qa-www/sn-errtest), removed at the end.
Run: source ~/code/the-template/venv/bin/activate && python3 test/errors.py"""
import json, os, shutil, sys, tempfile, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BROWSER = os.environ.get('SN_BROWSER', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
T = Path.home() / 'code/qa-www/sn-errtest'
BASE = 'http://localhost:18080/sn-errtest'
KEY = 'testkey123456'
results = []
def check(name, ok, extra=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def log():
    f = T / 'hub/data/errors.jsonl'
    return [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []

shutil.rmtree(T, ignore_errors=True); (T / 'hub').mkdir(parents=True); (T / 'site').mkdir()
for f in ['api.php', 'lib.php', 'errlog.php', 'index.php', '.htaccess', 'notes.js']: shutil.copy(ROOT / 'hub' / f, T / 'hub' / f)
(T / 'site/index.html').write_text(f'<!doctype html><html><head><meta charset="utf-8"><title>errtest</title></head><body><h1>Test</h1>'
    f'<script src="/sn-errtest/hub/notes.js" data-site-notes data-hub="/sn-errtest/hub" data-key="{KEY}" data-who="test" defer></script></body></html>')
try:
    try: urllib.request.urlopen(urllib.request.Request(BASE + '/hub/api.php?a=sites', headers={'X-SN-Key': KEY})); code, body = 200, ''
    except urllib.error.HTTPError as e: code, body = e.code, e.read().decode()
    check('hub without secret.php answers 500 with a JSON reason', code == 500 and json.loads(body).get('error') == 'hub not configured: secret.php missing', body)
    check('server logged it, without the key', log() and log()[-1]['side'] == 'server' and log()[-1]['status'] == 500 and KEY not in json.dumps(log()))
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), executable_path=BROWSER, headless=True)
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/site/'); page.wait_for_timeout(2500)
        q = page.evaluate("JSON.parse(localStorage.getItem('sn_failq') || '[]')")
        check('notes.js kept the failed call in the browser', len(q) == 1 and q[0]['status'] == 500 and q[0]['where'] == 'notes.js', q and q[0]['error'])
        (T / 'hub/secret.php').write_text(f"<?php\nconst SN_KEY = '{KEY}';\n")
        page.reload(); page.wait_for_timeout(3000)
        q = page.evaluate("JSON.parse(localStorage.getItem('sn_failq') || '[]')")
        cl = [r for r in log() if r['side'] == 'client']
        check('next working call sent it to the hub and emptied the queue', not q and len(cl) == 1 and cl[0]['page'].endswith('/sn-errtest/site/'), cl and cl[0].get('error'))
        r = json.loads(urllib.request.urlopen(urllib.request.Request(BASE + '/hub/api.php?a=errors&side=client', headers={'X-SN-Key': KEY})).read())
        check('?a=errors returns the client failure', len(r) == 1 and r[0]['kind'] == 'http')
        for path in ['hub/data/errors.jsonl', 'hub/errlog.php']:
            try: urllib.request.urlopen(BASE + '/' + path); c = 200
            except urllib.error.HTTPError as e: c = e.code
            check(f'{path} is not readable directly', c == 403, c)
        check('no page errors', not errors, errors)
        ctx.close()
finally:
    shutil.rmtree(T, ignore_errors=True)
print('\nall passed' if all(results) else f'\n{results.count(False)} failed'); sys.exit(0 if all(results) else 1)
