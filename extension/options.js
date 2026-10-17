// Settings for Site Notes. Empty fields fall back to defaults.js (written by install.sh).
const ids = ['hub', 'key', 'author'];
chrome.storage.local.get(ids, s => ids.forEach(k => { document.getElementById(k).value = s[k] || ''; }));
document.getElementById('save').addEventListener('click', async () => {
  const v = {};
  ids.forEach(k => { v[k] = document.getElementById(k).value.trim(); });
  await chrome.storage.local.set(v);
  const out = document.getElementById('out'), list = document.getElementById('sites');
  out.textContent = 'Testing...';
  chrome.runtime.sendMessage({ type: 'api', query: { a: 'sites' } }, r => {
    if (!r || r.error) { out.textContent = 'Hub not reachable: ' + ((r && r.error) || chrome.runtime.lastError.message); list.textContent = ''; return; }
    out.textContent = 'Connected. Sites with notes:';
    list.textContent = r.length ? r.map(s => `${s.site}  ${s.open} open / ${s.total}`).join('\n') : '(none yet)';
  });
});

// Link to the hub overview; the key in the URL sets a cookie there, so later visits need no key.
chrome.storage.local.get(['hub', 'key'], s => {
  const d = self.SN_DEFAULTS || {};
  const hubUrl = (s.hub || d.hub || 'http://localhost:18080/annot').replace(/\/+$/, '');
  document.getElementById('open').href = hubUrl + '/?key=' + encodeURIComponent(s.key || d.key || '');
});
