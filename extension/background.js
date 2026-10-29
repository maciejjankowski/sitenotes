// Site Notes - service worker.
// Toolbar icon (or Alt+Shift+N) turns note mode on/off for the tab; while on, content.js is re-injected
// after every page load in that tab, so you can keep adding notes while moving around the site.
// It also proxies every hub call (pages cannot reach http://localhost because of CORS/mixed content)
// and takes the screenshot crop for each new note.
try { importScripts('defaults.js'); } catch (e) {}  // written by install.sh: self.SN_DEFAULTS = {hub, key}
const DEF = Object.assign({ hub: 'http://localhost:18080/annot', key: '', author: 'MJ' }, self.SN_DEFAULTS || {});

async function cfg() {
  const s = await chrome.storage.local.get(['hub', 'key', 'author']);
  return { hub: (s.hub || DEF.hub).replace(/\/+$/, ''), key: s.key || DEF.key, author: s.author || DEF.author };
}

// ---- note mode per tab --------------------------------------------------------
const slot = id => 'on:' + id;
async function isOn(id) { return !!(await chrome.storage.session.get(slot(id)))[slot(id)]; }
async function setOn(id, on) {
  if (on) await chrome.storage.session.set({ [slot(id)]: true });
  else await chrome.storage.session.remove(slot(id));
  chrome.action.setBadgeBackgroundColor({ tabId: id, color: '#2f6fed' }).catch(() => {});
  chrome.action.setBadgeText({ tabId: id, text: on ? 'ON' : '' }).catch(() => {});
}
async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'sn-mode', on: true });
}
async function toggle(tab) {
  if (await isOn(tab.id)) {
    await setOn(tab.id, false);
    chrome.tabs.sendMessage(tab.id, { type: 'sn-mode', on: false }).catch(() => {});
    return;
  }
  try {
    await inject(tab.id);
    await setOn(tab.id, true);
  } catch (e) {  // chrome:// pages, the Web Store, PDFs
    chrome.action.setBadgeText({ tabId: tab.id, text: 'x' });
    console.warn('Site Notes cannot run on this page:', e.message);
  }
}
chrome.action.onClicked.addListener(toggle);
chrome.tabs.onUpdated.addListener(async (id, info) => {
  if (info.status !== 'complete' || !(await isOn(id))) return;
  inject(id).then(() => setOn(id, true), () => {});
});
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove(slot(id)));

// ---- hub ----------------------------------------------------------------------
async function hub(query, body, as = 'json', over = null) {  // over = {hub, key} of a site that runs its own hub
  const c = Object.assign(await cfg(), over || {});
  c.hub = c.hub.replace(/\/+$/, '');
  const u = new URL(c.hub + '/api.php');
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
  const what = { hub: c.hub, a: (query && query.a) || (body && body.a) || '', site: (query && query.site) || (body && body.site) || '' };
  const quiet = body && body.a === 'client_error';   // never log the log
  const fail = async (msg, extra) => { if (!quiet) await failNote(Object.assign({}, what, extra, { error: msg })); return new Error(msg); };
  let r;
  try {
    r = await fetch(u, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'X-SN-Key': c.key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(Object.assign({ author: c.author }, body)) : undefined,
    });
  } catch (e) { throw await fail(`network: ${e.message} (${c.hub})`, { kind: 'network' }); }
  const t = await r.text();
  if (as === 'text' && r.ok) { if (!quiet) failFlush(c); return t; }
  let j;
  try { j = JSON.parse(t); } catch (e) { throw await fail(`hub ${r.status} at ${c.hub}: ${t.slice(0, 120)}`, { kind: 'parse', status: r.status, detail: t.slice(0, 300) }); }
  if (!r.ok || j.error) throw await fail(j.error || `hub ${r.status}`, { kind: 'http', status: r.status });
  if (!quiet) failFlush(c);
  return j;
}

// ---- failures: every failed hub call is kept here (last 100, shown on the options page) and sent to a hub
// (a=client_error, stored in its data/errors.jsonl) as soon as any hub call works again ------------------------
const FAILS = 'fails';
async function failNote(f) {
  const s = await chrome.storage.local.get(FAILS);
  const list = (s[FAILS] || []).concat([Object.assign({ at: new Date().toISOString(), where: 'extension', ver: chrome.runtime.getManifest().version, sent: false }, f)]);
  await chrome.storage.local.set({ [FAILS]: list.slice(-100) });
}
let flushing = false;
async function failFlush(c) {
  if (flushing) return; flushing = true;
  try {
    const list = (await chrome.storage.local.get(FAILS))[FAILS] || [];
    const todo = list.filter(f => !f.sent);
    if (!todo.length) return;
    await hub(null, { a: 'client_error', errors: todo.map(({ sent, ...f }) => f) }, 'json', { hub: c.hub, key: c.key });
    const now = (await chrome.storage.local.get(FAILS))[FAILS] || [];
    const sentAt = new Set(todo.map(f => f.at + f.error));
    await chrome.storage.local.set({ [FAILS]: now.map(f => sentAt.has(f.at + f.error) ? Object.assign(f, { sent: true, sent_to: c.hub }) : f) });
  } catch (e) { /* hub gone again; kept for the next call that works */ }
  finally { flushing = false; }
}

async function exportSite(site, over) {
  const md = await hub({ a: 'export', site, status: 'open', format: 'md' }, null, 'text', over);
  const count = (md.match(/^### #/gm) || []).length;
  const file = `site-notes/${site.replace(/[^\w.-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`;
  await chrome.downloads.download({ url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md), filename: file, conflictAction: 'overwrite', saveAs: false });
  return { md, count, file };
}

// ---- screenshot: the element with some context around it, outlined in red -----
function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function capture(tab, { rect, vw, vh }) {
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const s = bmp.width / vw;                                // device px per CSS px
  const [x, y, w, h] = rect, m = 160;                      // m = CSS px of context on each side
  const cl = (v, hi) => Math.min(Math.max(v, 0), hi);
  const L = cl(x - m, vw), T = cl(y - m, vh), R = cl(x + w + m, vw), B = cl(y + h + m, vh);
  const k = Math.min(1, 1600 / Math.max(1, (R - L) * s));  // output at most 1600 px wide
  const cw = Math.max(1, Math.round((R - L) * s * k)), ch = Math.max(1, Math.round((B - T) * s * k));
  const c = new OffscreenCanvas(cw, ch), g = c.getContext('2d');
  g.drawImage(bmp, L * s, T * s, (R - L) * s, (B - T) * s, 0, 0, cw, ch);
  g.strokeStyle = '#ff3b30';
  g.lineWidth = Math.max(2, 3 * s * k);
  g.strokeRect((x - L) * s * k, (y - T) * s * k, w * s * k, h * s * k);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return 'data:image/jpeg;base64,' + b64(await blob.arrayBuffer());
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const run = {
    api: () => hub(m.query, m.body, 'json', m.over),
    capture: () => capture(sender.tab, m).then(data => ({ data })),
    export: () => exportSite(m.site, m.over),
    off: () => setOn(sender.tab.id, false).then(() => ({ ok: true })),
  }[m.type];
  if (!run) return false;
  run().then(reply, e => reply({ error: String((e && e.message) || e) }));
  return true;
});
