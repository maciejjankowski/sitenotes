// Site Notes - one file, two ways to run:
//  - extension: content script injected by background.js while note mode is on in the tab (screenshots, any site);
//  Lead / Follow: on the phone, "Lead" sends every tapped element to the hub instead of opening a card; a desktop
//  on the same site with "Follow" on picks that element and opens the card there, so the note is typed on a keyboard.
//  Elements are matched by CSS selector (not scroll position), which survives the different phone/desktop layouts.
//  - on a site: <script src="/notes/notes.js" data-site-notes defer></script> next to the hub in /notes/.
//    Dormant (no UI, no network) until this browser opens the site once with #notes=KEY[&who=Name];
//    old #annot=KEY links and keys work too. Starts paused so links work; the pill turns note mode on.
//    No screenshots: a page cannot capture itself. If the extension is on, the script steps aside, and the
//    extension writes to this site's hub so all notes of the site stay in one place.
// Mode on: hover outlines an element, a click picks it, everything else blurs and a small card asks
// what should change. Text + Enter (or Save) = the element needs a change. "Remove element" = the element should go.
// Cancel / Esc / a click outside the card = no note. Clicking an element that already has a note opens that note
// ("Undo remove" drops a removal mark). Every save and delete offers Undo in the message that follows.
// Then you are back in note mode for the next element.
// The card shows the path body > ... > element and its CSS selector: arrow buttons or crumbs walk to the parent and
// back down to the clicked element; typing a selector picks whatever it matches.
// Keys: ArrowUp/ArrowDown while hovering, Alt+ArrowUp/Down in the card = parent / back down.
// Esc closes the card; with no card open it pauses note mode so links work again (pill button resumes).
// Fixed notes stay visible as green "changed" markers (a dashed ghost where the element was removed or hidden),
// also while paused, so they can be checked with links working.
// Click one: your note, the text from before, what changed; Keep (accept) or Revert (asks the agent for the before state).
// "Changes (n)" on the pill (Alt+Shift+C) dims the page and lights only the changed elements; arrows step through them.
(() => {
  if (window.__siteNotes) return;
  window.__siteNotes = true;

  const EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  const keep = (area, k, v) => { try { const s = window[area]; if (v === undefined) return s.getItem(k) || ''; if (v === null) s.removeItem(k); else s.setItem(k, v); } catch (e) {} return ''; };
  const LEGACY = 'annot_key_' + location.hostname.replace(/[^a-z0-9]/gi, '_');  // key of the old annotator.js
  const hubOf = s => new URL(s.dataset.hub || s.src.replace(/\/[^/]*$/, ''), location.href).href.replace(/\/+$/, '');
  let HUB = '', KEY = '', WHO = '', DEMO = false;
  if (!EXT) {
    const me = document.currentScript || document.querySelector('script[data-site-notes]');
    if (!me) return;
    DEMO = me.hasAttribute('data-demo');  // test drive: everything is saved in this browser only, nothing is sent anywhere
    HUB = DEMO ? '' : hubOf(me);
    if (me.dataset.key) { keep('localStorage', 'sn_key', me.dataset.key); keep('sessionStorage', 'sn_hidden', null); if (me.dataset.who) keep('localStorage', 'sn_who', me.dataset.who); }  // bookmarklet on a foreign site
    const h = location.hash.match(/^#(?:notes|annot)=([A-Za-z0-9]{8,64})(?:&who=([^&]{1,60}))?$/);
    if (h) {
      keep('localStorage', 'sn_key', h[1]);
      if (h[2]) keep('localStorage', 'sn_who', decodeURIComponent(h[2]));
      keep('sessionStorage', 'sn_hidden', null);
      history.replaceState(null, '', location.pathname + location.search);
    }
    KEY = DEMO ? 'demo' : keep('localStorage', 'sn_key') || keep('localStorage', LEGACY);
    WHO = DEMO ? 'you' : keep('localStorage', 'sn_who') || keep('localStorage', LEGACY + '_who');
    if (!KEY) {  // dormant; the #notes= link pasted onto an open page only changes the hash, so reload once to wake up
      addEventListener('hashchange', () => { if (/^#(notes|annot)=/.test(location.hash)) location.reload(); });
      return;
    }
  }

  // the page a note belongs to; hash routes of single-page apps (#/pl/oferta/, #!/x) are pages too, #anchors are not
  const page = () => location.pathname + location.search + (/^#!?\//.test(location.hash) ? location.hash : '');
  const STYLE = `
    * { box-sizing: border-box; font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; letter-spacing: 0; }
    [hidden] { display: none !important; }
    .hl { position: fixed; pointer-events: none; border: 2px solid #2f6fed; background: rgba(47,111,237,.08); border-radius: 3px; display: none; }
    .hl i { position: absolute; left: -2px; top: -21px; background: #2f6fed; color: #fff; font-style: normal; font-size: 11px; padding: 2px 6px;
            border-radius: 3px; white-space: nowrap; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; }
    .hl.low i { top: 2px; left: 2px; }
    .pane { position: fixed; pointer-events: auto; background: rgba(12,14,20,.48); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
    .ring { position: fixed; pointer-events: none; border: 3px solid #2f6fed; border-radius: 4px;
            box-shadow: 0 0 0 1px #fff, inset 0 0 0 1px #fff, 0 0 22px rgba(47,111,237,.6); }
    .card { position: fixed; pointer-events: auto; width: 360px; background: #fff; color: #15171c; border-radius: 10px; padding: 8px;
            box-shadow: 0 12px 32px rgba(0,0,0,.30), 0 0 0 1px rgba(0,0,0,.06); }
    .nav, .selrow { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
    .nav .w { height: 24px; flex: none; padding: 0 7px; border-radius: 6px; box-shadow: inset 0 0 0 1px #d3d6de; font-size: 12px; line-height: 24px; font-weight: 500; color: #4b5060; }
    .nav .w:disabled { opacity: .3; cursor: default; }
    .crumbs { position: relative; display: flex; align-items: center; gap: 1px; flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
    .crumbs::-webkit-scrollbar { display: none; }
    .crumbs button, input.sel, .cnt { font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .crumbs button { flex: none; padding: 3px 5px; border-radius: 5px; font-weight: 500; color: #4b5060; }
    .crumbs button:hover { background: rgba(47,111,237,.12); }
    .crumbs button.cur { background: #2f6fed; color: #fff; }
    .crumbs button.below { opacity: .45; }
    .crumbs .gt { flex: none; color: #a4a8b4; font-size: 10px; }
    input.sel { flex: 1; min-width: 0; padding: 4px 6px; border: 1px solid #d3d6de; border-radius: 6px; color: inherit; background: rgba(127,127,127,.08); outline: none; }
    input.sel:focus { border-color: #2f6fed; }
    input.sel.bad { border-color: #e5484d; }
    input.who { display: block; width: 100%; margin-bottom: 6px; padding: 6px 8px; border: 1px solid #d3d6de; border-radius: 7px; color: inherit; background: transparent; outline: none; }
    .cnt { flex: none; color: #c2410c; }
    textarea { display: block; width: 100%; min-height: 54px; max-height: 40vh; resize: none; border: 1px solid #d3d6de; border-radius: 7px;
               padding: 6px 8px; outline: none; color: inherit; background: transparent; }
    textarea:focus { border-color: #2f6fed; }
    .need textarea { border-color: #e5484d; }
    .row { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
    .sp { flex: 1; }
    button { cursor: pointer; border: 0; border-radius: 7px; padding: 5px 10px; font-weight: 600; background: none; color: inherit; }
    .ok { background: #2f6fed; color: #fff; }
    .rm { color: #e5484d; box-shadow: inset 0 0 0 1px #e5484d; }
    .rm.active { background: #e5484d; color: #fff; }
    .del, .cancel { color: #6b7080; font-weight: 500; padding: 5px 6px; }
    .cancel:hover, .del:hover { background: rgba(127,127,127,.14); }
    .dot { position: fixed; pointer-events: auto; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #2f6fed; color: #fff;
           font-size: 10px; font-weight: 700; line-height: 18px; text-align: center; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
    .dot.remove { background: #e5484d; }
    @media (max-width: 520px) { .pill { right: 8px; bottom: 8px; } .menu { right: 8px; } }
    .pill { position: fixed; right: 14px; bottom: 14px; pointer-events: auto; display: flex; align-items: center; gap: 2px; padding: 4px;
            background: #15171c; color: #fff; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.30); }
    .pill button { padding: 5px 10px; border-radius: 999px; }
    .pill button:hover { background: rgba(255,255,255,.14); }
    .pill .mode { background: #2f6fed; }
    .pill.paused .mode { background: #2f6fed; }
    .pill:not(.paused) .mode { background: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
    .pill .more { padding: 5px 8px; font-size: 16px; line-height: 1; }
    /* the "..." menu: everything a reviewer does not need every minute */
    .menu { position: fixed; right: 14px; bottom: 54px; min-width: 200px; pointer-events: auto; display: flex; flex-direction: column; padding: 6px;
            background: #15171c; color: #fff; border-radius: 12px; box-shadow: 0 10px 28px rgba(0,0,0,.35); }
    .menu button { text-align: left; padding: 8px 10px; border-radius: 8px; font-weight: 500; }
    .menu button:hover { background: rgba(255,255,255,.14); }
    .menu button.on { background: #2f6fed; }
    .menu button.on.wait { background: #3a3d46; color: #a9adb9; }
    .menu hr { border: 0; border-top: 1px solid rgba(255,255,255,.14); margin: 4px 0; }
    .menu .off { color: #ff8a8a; }
    /* tucked: like a macOS PiP window slid off the edge, a tab stays on the right; tap it to bring the pill back */
    .pill.tucked { display: none; }
    .tab { position: fixed; right: 0; top: 50%; transform: translateY(-50%); pointer-events: auto; width: 22px; height: 64px; display: none;
           align-items: center; justify-content: center; background: #15171c; color: #fff; border-radius: 10px 0 0 10px; cursor: pointer;
           box-shadow: 0 4px 14px rgba(0,0,0,.30); opacity: .55; transition: opacity .15s, width .15s; font-size: 14px; user-select: none; }
    .tab:hover { opacity: 1; width: 28px; }
    .tab.show { display: flex; }
    .tab .tcnt { position: absolute; top: -7px; left: -7px; min-width: 16px; height: 16px; border-radius: 8px; background: #2f6fed; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; padding: 0 4px; }
    .tab .tcnt:empty { display: none; }
    .pill:not(.paused) .mode::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34c759; margin-right: 6px; }
    .pill .n { color: #a9adb9; font-size: 12px; padding: 5px 8px; font-weight: 500; }
    .pill .n:empty { display: none; }
    .pill .n:hover { color: #fff; }
    .hl.remote { border-color: #34c759; background: rgba(52,199,89,.10); }
    .hl.remote i { background: #34c759; }
    .hl.remote.lost { border-style: dashed; }
    .toast { position: fixed; right: 14px; bottom: 58px; max-width: 360px; padding: 7px 12px; border-radius: 8px; background: #15171c; color: #fff;
             pointer-events: none; opacity: 0; transition: opacity .2s; }
    .toast.show { opacity: 1; }
    .toast.bad { background: #b42318; }
    .toast.act { pointer-events: auto; }
    .toast button { margin-left: 12px; padding: 0; color: #8fb3ff; font-weight: 700; text-decoration: underline; }
    .dot.changed { background: #16a34a; font-size: 12px; }
    .dot.changed.gone { background: #fff; color: #16a34a; box-shadow: inset 0 0 0 2px #16a34a; }
    .dot.revert { background: #c2410c; }
    .ghost { position: fixed; pointer-events: none; border: 2px dashed #16a34a; border-radius: 4px; background: rgba(22,163,74,.06); }
    .spot { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .spot path { fill: rgba(10,12,16,.62); fill-rule: evenodd; }
    .spot rect { fill: none; stroke: #16a34a; stroke-width: 3; rx: 4; }
    .chg { position: fixed; pointer-events: auto; width: 380px; max-height: 70vh; overflow: auto; background: #fff; color: #15171c; border-radius: 10px;
           padding: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.30), 0 0 0 1px rgba(22,163,74,.5); }
    .chg h4 { margin: 0 0 6px; font-weight: 700; color: #16a34a; }
    .chg .k { margin-top: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #6b7080; }
    .chg .v { margin-top: 2px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .chg .v.before { background: rgba(229,72,77,.07); border-left: 3px solid #e5484d; padding: 4px 6px; border-radius: 4px; }
    .chg .v.after { background: rgba(22,163,74,.07); border-left: 3px solid #16a34a; padding: 4px 6px; border-radius: 4px; }
    .chg textarea { margin-top: 6px; min-height: 36px; }
    .chg .keep { background: #16a34a; color: #fff; }
    .chg .back { color: #c2410c; box-shadow: inset 0 0 0 1px #c2410c; }
    .chg .back.arm { background: #c2410c; color: #fff; }
    .chg details, .card details { margin-top: 6px; }
    .chg summary, .card summary { cursor: pointer; font-size: 11px; color: #6b7080; user-select: none; }
    .chg details .v { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #6b7080; }
    .pill .chs { color: #7ee2a0; box-shadow: inset 0 0 0 1px rgba(126,226,160,.6); }
    .pill .chs.on { background: #16a34a; color: #fff; }
    .pill .spotnav button { padding: 5px 8px; }
    .pill .pos { color: #a9adb9; font-size: 12px; padding: 0 2px; }
    .lk { position: fixed; pointer-events: auto; cursor: pointer; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #2f6fed; color: #fff;
          font-size: 9.5px; font-weight: 700; line-height: 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.35); white-space: nowrap; }
    .lk.ch { background: #16a34a; }
    .side { position: fixed; top: 10px; right: 10px; bottom: 62px; width: 340px; pointer-events: auto; display: flex; flex-direction: column;
            background: #fff; color: #15171c; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.30), 0 0 0 1px rgba(0,0,0,.06); }
    .side header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #e3e5ea; font-weight: 700; }
    .side header span { flex: 1; font-weight: 700; }
    .side .list { overflow: auto; padding: 4px 0 8px; }
    .side .pg { display: block; width: 100%; text-align: left; padding: 8px 10px 4px; border-radius: 0; font-weight: 700; color: #4b5060; font-size: 12px; overflow-wrap: anywhere; }
    .side .pg.cur { color: #2f6fed; }
    .side .pg:hover, .side .it:hover { background: rgba(47,111,237,.08); }
    .side .it { display: flex; gap: 6px; width: 100%; text-align: left; padding: 4px 10px 4px 16px; border-radius: 0; font-weight: 400; }
    .side .it b { flex: none; min-width: 38px; font-size: 11px; font-weight: 700; color: #2f6fed; }
    .side .it.ch b { color: #16a34a; } .side .it.rv b { color: #c2410c; } .side .it.rm b { color: #e5484d; }
    .side .it span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .side .empty { padding: 12px; color: #6b7080; }
    @media (prefers-color-scheme: dark) { .side { background: #202227; color: #eceef2; } .side header { border-color: #3b3e47; } .side .pg { color: #b9bdc8; } }
    @media (prefers-color-scheme: dark) { .chg { background: #202227; color: #eceef2; } }
    @media (max-width: 520px) { .chg { left: 0 !important; right: 0; top: auto !important; bottom: 56px; width: auto; max-height: 60vh; border-radius: 12px 12px 0 0; } }  /* above the pill */
    @media (prefers-color-scheme: dark) { .card { background: #202227; color: #eceef2; } textarea, input.sel { border-color: #3b3e47; } .crumbs button { color: #b9bdc8; } .nav .w { box-shadow: inset 0 0 0 1px #3b3e47; } }
  `;

  const host = document.createElement('site-notes');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="hl"><i></i></div>
    <svg class="spot" hidden><path></path><g class="rings"></g></svg>
    <div class="ghosts"></div>
    <div class="links"></div>
    <div class="dots"></div>
    <div class="side" hidden><header><span>Notes on this site</span><button class="sclose" title="Close (Alt+Shift+L)">&#x2715;</button></header><div class="list"></div></div>
    <div class="chg" hidden>
      <h4></h4>
      <div class="k">Your note</div><div class="v note"></div>
      <div class="k">Before</div><div class="v before"></div>
      <div class="k">What changed</div><div class="v after"></div>
      <details class="agent" hidden><summary>Details for the agent</summary><div class="v rest"></div></details>
      <textarea class="why" rows="1" placeholder="Why? (optional, Enter sends)" hidden></textarea>
      <div class="row"><button class="close">Close</button><span class="sp"></span><button class="back" title="Put it back the way it was">Revert</button><button class="keep" title="Keep this change; the marker goes away">Keep</button></div>
    </div>
    <div class="ov" hidden>
      <div class="pane"></div><div class="pane"></div><div class="pane"></div><div class="pane"></div>
      <div class="ring"></div>
      <div class="card">
        <input class="who" placeholder="Your name (asked once)" hidden>
        <textarea rows="2" placeholder="What should change?"></textarea>
        <div class="nav" hidden><button class="w up">&#x2191;</button><button class="w down">&#x2193;</button><div class="crumbs"></div></div>
        <details class="seld"><summary>Selector (Alt+&#x2191; picks the bigger piece around it)</summary><div class="selrow"><input class="sel" spellcheck="false" autocomplete="off" aria-label="CSS selector"><span class="cnt"></span></div></details>
        <div class="row"><button class="cancel" title="Esc">Cancel</button><button class="del" hidden title="Delete this note">Delete note</button><span class="sp"></span><button class="rm">Remove element</button><button class="ok">Save</button></div>
      </div>
    </div>
    <div class="menu" hidden>
      <button class="ls" title="All notes and changes of this site, page by page (Alt+Shift+L)">List of all notes</button>
      <button class="hf" hidden title="Hide the green markers of what was already fixed">Hide fixed</button>
      <hr>
      <button class="rm-mode" title="Each element you tap here opens on the computer that types for the phone">Point from this phone</button>
      <button class="fl" title="Open the card on whatever the phone points at">Type for the phone</button>
      <hr>
      <button class="ex" title="Copy + download all open notes of this site">Export site for the agent</button>
      <button class="off" title="Remove Site Notes from this tab">Turn off</button>
    </div>
    <div class="pill"><button class="mode">Add note</button><button class="n" title="Open notes on this page: click to step through them"></button><button class="chs" hidden title="Dim the page and show only what was changed (Alt+Shift+C)"></button><span class="spotnav" hidden><button class="pv" title="Previous change">&#x2039;</button><span class="pos"></span><button class="nx" title="Next change">&#x203A;</button></span><button class="more" title="More">&#x22EF;</button><button class="x" title="Hide to the edge">&#x2715;</button></div>
    <div class="tab" title="Site Notes: tap to bring back">&#x270E;<span class="tcnt"></span></div>
    <div class="toast"></div>`;
  const $ = s => root.querySelector(s);
  const hl = $('.hl'), hlText = $('.hl i'), dots = $('.dots'), ov = $('.ov'), ring = $('.ring'), card = $('.card');
  const ours = t => t === host;
  const crumbsEl = $('.crumbs'), selIn = $('input.sel'), cnt = $('.cnt'), upBtn = $('.up'), downBtn = $('.down');
  const whoIn = $('input.who');
  const ta = $('.card textarea'), pill = $('.pill'), modeBtn = $('.pill .mode'), rmBtn = $('.rm'), delBtn = $('.del');
  const panes = [...root.querySelectorAll('.pane')];
  const spotSvg = $('.spot'), spotPath = $('.spot path'), rings = $('.spot .rings'), ghosts = $('.ghosts');
  const chg = $('.chg'), whyIn = $('.chg .why'), chsBtn = $('.pill .chs'), spotNav = $('.pill .spotnav'), posEl = $('.pill .pos');
  const linksEl = $('.links'), side = $('.side'), sideList = $('.side .list');
  const remoteBtn = $('.menu .rm-mode'), followBtn = $('.menu .fl'), tab = $('.tab'), menu = $('.menu');

  let mode = 'off';          // off | on | paused
  let siteNotes = [];        // open + done notes of every page of this site (for link badges and the List)
  // Fixed notes (status done) stay on the page as green "changed" markers until MJ keeps or reverts them.
  let changed = [];          // done notes of this page
  let elsewhere = 0;         // done notes on other pages of this site
  let spot = false, spotI = 0, chgNote = null;  // "Changes" view: page dimmed, only changed elements lit
  let base = null, up = 0;   // element under the mouse, and how many levels wider the user asked for
  let sel = null;            // {chain: [body ... clicked element], i: index of the picked one, el, note} while the card is open
  let notes = [];            // open notes of this page
  let href = '', poll = 0, raf = 0, toastT = 0;
  let remote = false;        // phone side: taps go to the hub, no card
  let follow = 0, seen = 0, lastPtr = null;  // desktop side: poll timer, last pointer seq handled, last pointer

  // ---- talking to the hub ------------------------------------------------------------
  function siteHub() {  // extension on a site that embeds notes.js, in a browser holding that site's key: use the site's hub
    const s = document.querySelector('script[data-site-notes]');
    const key = keep('localStorage', 'sn_key') || keep('localStorage', LEGACY);
    return s && key ? { hub: hubOf(s), key } : null;
  }
  const extSend = msg => new Promise((res, rej) => {
    if (msg.type === 'api' || msg.type === 'export') msg = Object.assign({ over: siteHub() }, msg);
    try {
      chrome.runtime.sendMessage(msg, r => {
        if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
        if (r && r.error) return rej(new Error(r.error));
        res(r);
      });
    } catch (e) { rej(new Error('extension was reloaded, reload this page')); }
  });
  async function hubCall(query, body, asText) {
    const u = new URL(HUB + '/api.php');
    for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
    const r = await fetch(u, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'X-SN-Key': KEY }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(Object.assign({ author: WHO }, body)) : undefined,
    });
    const t = await r.text();
    if (asText && r.ok) return t;
    let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error('hub ' + r.status); }
    if (!r.ok || j.error) throw new Error(j.error || 'hub ' + r.status);
    return j;
  }
  async function pageSend(m) {
    if (m.type === 'api') return hubCall(m.query, m.body);
    if (m.type === 'export') {
      const md = await hubCall({ a: 'export', site: m.site, status: 'open', format: 'md' }, null, true);
      const file = `site-notes_${m.site.replace(/[^\w.-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: file });
      root.append(a);  // inside our shadow root, so the click blocker lets it through
      a.click();
      a.remove();
      return { md, count: (md.match(/^### #/gm) || []).length, file };
    }
    throw new Error('screenshots need the extension');
  }
  // ---- demo: a hub in localStorage, same actions, seeded with two changes to Keep or Revert ----
  const DEMO_KEY = 'sn_demo_' + location.host;
  function demoStore() {
    let st = null;
    try { st = JSON.parse(keep('localStorage', DEMO_KEY) || 'null'); } catch (e) {}
    if (!st) {
      const seeds = JSON.parse(document.querySelector('script[data-site-notes]').dataset.seed || '[]');
      st = { seq: 100, notes: [] };
      for (const sd of seeds) {  // {selector, comment, before, fix}: a note the agent already fixed, waiting for Keep / Revert
        st.notes.push({ id: ++st.seq, site: location.host, path: page(), url: location.href, title: document.title, selector: sd.selector, element: '', text: sd.before || '',
          rect: '', viewport: '', source: '', comment: sd.comment, action: 'change', status: 'done', author: 'you', revert: 0, shot: null,
          created_at: '2026-10-17 09:12', updated_at: '2026-10-17 09:40', history: [{ kind: 'fixed', at: '2026-10-17 09:40', who: 'agent', body: sd.fix }] });
      }
    }
    return st;
  }
  const demoSave = st => keep('localStorage', DEMO_KEY, JSON.stringify(st));
  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  async function demoSend(m) {
    const st = demoStore();
    if (m.type === 'export') return { md: st.notes.filter(n => n.status === 'open').map(n => `### #${n.id} ${n.action.toUpperCase()}\n> ${n.comment}\n- selector: \`${n.selector}\``).join('\n\n'), count: st.notes.filter(n => n.status === 'open').length, file: 'demo.md' };
    if (m.type !== 'api') throw new Error('demo');
    const q = m.query || {}, b = m.body || {};
    if (q.a === 'list') return st.notes.filter(n => n.status !== 'deleted' && (q.status === 'all' || n.status === q.status));
    if (q.a === 'pointer') return { seq: 0 };
    let n = st.notes.find(x => x.id === Number(b.id));
    if (b.a === 'save') {
      if (!n) { n = { id: ++st.seq, status: 'open', history: [], revert: 0, shot: null, created_at: now() }; st.notes.push(n); }
      Object.assign(n, { site: b.site, path: b.path, url: b.url, title: b.title, selector: b.selector, element: b.element, text: b.text, rect: b.rect, viewport: b.viewport, source: b.source, comment: b.comment, action: b.action, author: 'you', updated_at: now() });
    } else if (b.a === 'delete' && n) n.status = 'deleted';
    else if (b.a === 'restore' && n) n.status = 'open';
    else if (b.a === 'accept' && n) n.status = 'accepted';
    else if (b.a === 'revert' && n) { n.status = 'open'; n.revert = 1; n.history.push({ kind: 'revert', at: now(), who: 'you', body: b.body || '' }); }
    else if (b.a === 'point') return { ok: true };
    demoSave(st);
    return { ok: true, id: n ? n.id : 0 };
  }
  const send = EXT ? extSend : DEMO ? demoSend : pageSend;
  const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const frames = n => new Promise(r => { const f = k => (k ? requestAnimationFrame(() => f(k - 1)) : setTimeout(r, 30)); f(n); });
  const lift = (el, n) => { for (let i = 0; i < n && el.parentElement && el.parentElement !== document.documentElement; i++) el = el.parentElement; return el; };
  const depth = el => { let d = 0; while (el.parentElement && el.parentElement !== document.documentElement) { el = el.parentElement; d++; } return d; };

  // ---- describing the element so an agent can find it in the source -----------
  const okId = id => id && !/\d{3,}|:/.test(id);
  const okClass = c => /^[a-zA-Z_][\w-]{0,40}$/.test(c) && !/\d{3,}/.test(c) && !/^(css|sc|jsx|svelte|astro|emotion|chakra)-/.test(c);
  const unique = s => { try { return document.querySelectorAll(s).length === 1; } catch (e) { return false; } };
  function cssPath(el) {
    const steps = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (okId(n.id) && unique('#' + CSS.escape(n.id))) { steps.unshift('#' + CSS.escape(n.id)); break; }
      let step = tag;
      const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(okClass).slice(0, 2);
      if (cls.length) step += '.' + cls.map(c => CSS.escape(c)).join('.');
      const p = n.parentElement;
      if (p && tag !== 'body' && [...p.children].filter(c => c.matches(step)).length > 1) {
        step += `:nth-of-type(${[...p.children].filter(c => c.tagName === n.tagName).indexOf(n) + 1})`;
      }
      steps.unshift(step);
      if (tag === 'body' || unique(steps.join(' > '))) break;
    }
    return steps.join(' > ');
  }
  function label(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (!el.id && cls.length) s += '.' + cls.join('.');
    return s;
  }
  const KIND = { a: 'link', button: 'button', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', p: 'paragraph',
    img: 'image', svg: 'icon', picture: 'image', video: 'video', input: 'field', textarea: 'field', select: 'field', label: 'label', li: 'item',
    ul: 'list', ol: 'list', nav: 'menu', header: 'header', footer: 'footer', section: 'section', article: 'section', main: 'content', aside: 'side panel',
    form: 'form', table: 'table', tr: 'row', td: 'cell', th: 'cell', body: 'page', span: 'text', em: 'text', strong: 'text', b: 'text', i: 'text', small: 'text' };
  function kind(el) {  // "price", "link", "heading": a word a reviewer would use, never a selector
    const tag = el.tagName.toLowerCase();
    if (tag === 'body') return 'page';
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(okClass).find(c => !/^(is|has|js|col|row|mt|mb|p|m|w|h|flex|grid|text|bg)-/.test(c));
    if (okId(el.id)) return el.id.replace(/[-_]+/g, ' ');
    if (cls) return cls.replace(/[-_]+/g, ' ');
    return KIND[tag] || (el.children.length ? 'group' : 'text');
  }
  const human = el => { const k = kind(el), t = textOf(el).slice(0, 48); return t ? `${k} · ${t}` : k; };
  const textOf = el => (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('src') || '')
    .replace(/\s+/g, ' ').trim();
  function describe(el) {
    const r = el.getBoundingClientRect(), html = el.outerHTML;
    return {
      site: location.host, path: page(), url: location.href, title: document.title,
      selector: cssPath(el),
      element: html.length <= 700 ? html : html.slice(0, Math.min(600, html.indexOf('>') + 1)) + ' ... </' + el.tagName.toLowerCase() + '>',
      text: textOf(el).slice(0, 400),
      rect: [r.left + scrollX, r.top + scrollY, r.width, r.height].map(Math.round).join(','),
      viewport: innerWidth + 'x' + innerHeight,
      source: ((el.closest('[data-src]') || {}).dataset || {}).src || '',
    };
  }

  // ---- drawing -------------------------------------------------------------------
  function put(node, x, y, w, h) {
    node.style.left = x + 'px'; node.style.top = y + 'px';
    node.style.width = Math.max(0, w) + 'px'; node.style.height = Math.max(0, h) + 'px';
  }
  function drawHl() {
    const el = mode === 'on' && !sel && base ? lift(base, up) : null;
    hl.style.display = el ? 'block' : 'none';
    if (!el) return;
    const r = el.getBoundingClientRect();
    put(hl, r.left, r.top, r.width, r.height);
    hl.classList.toggle('low', r.top < 22);
    const n = noteFor(el);
    hlText.textContent = (n ? (n.action === 'remove' ? 'marked to remove · ' : 'has a note · ') : '') + human(el) + (up ? `  (↑${up})` : '');
    hl.title = cssPath(el);
  }
  // Where a changed note's element is now: by selector, then by its source block (data-src), else the stored position
  // (the element was removed or hidden by the fix) - drawn as a dashed ghost.
  function locate(n) {
    const seen = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? { el, r } : null; };
    let hit = null;
    try { hit = seen(n.selector ? document.querySelector(n.selector) : null); } catch (e) {}
    if (!hit && n.source) hit = seen([...document.querySelectorAll('[data-src]')].find(e => e.dataset.src === n.source));
    if (hit) return Object.assign(hit, { gone: false });
    const [x, y, w, h] = String(n.rect || '').split(',').map(Number);
    if (!(w || h)) return null;
    return { el: null, r: { left: x - scrollX, top: y - scrollY, width: w, height: h, right: x - scrollX + w, bottom: y - scrollY + h }, gone: true };
  }
  const lastFix = n => [...(n.history || [])].reverse().find(e => e.kind === 'fixed');
  function drawSpot(spots) {
    spotSvg.toggleAttribute('hidden', !spot);  // SVG elements have no .hidden property
    if (!spot) return;
    const W = innerWidth, H = innerHeight, p = 6;
    let d = `M0 0H${W}V${H}H0Z`;
    rings.textContent = '';
    for (const { r } of spots) {
      const x = Math.round(r.left - p), y = Math.round(r.top - p), w = Math.round(r.width + 2 * p), h = Math.round(r.height + 2 * p);
      d += `M${x} ${y}h${w}v${h}h${-w}Z`;
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      ['x', 'y', 'width', 'height'].forEach((k, i) => ring.setAttribute(k, [x, y, w, h][i]));
      rings.append(ring);
    }
    spotPath.setAttribute('d', d);
  }
  let hideFixed = !!keep('sessionStorage', 'sn_hidefixed');
  function drawChanged() {
    ghosts.textContent = '';
    const spots = [];
    const hf = $('.menu .hf'); hf.hidden = !changed.length; hf.classList.toggle('on', hideFixed); hf.textContent = hideFixed ? 'Show fixed again' : 'Hide fixed';
    if (mode !== 'off' && !hideFixed) for (const n of changed) {  // also while paused: links work, the green markers still click
      const at = locate(n);
      if (!at) continue;
      spots.push(at);
      const r = at.r;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const d = document.createElement('div');
      d.className = 'dot changed' + (at.gone ? ' gone' : '');
      d.textContent = '✓';
      d.title = `#${n.id} changed` + (at.gone ? ' (the element was removed or moved; this is where it was)' : '') + ': ' + n.comment;
      d.style.left = Math.max(2, r.left - 9) + 'px';
      d.style.top = Math.max(2, r.top - 9) + 'px';
      d.addEventListener('click', () => openChange(n));
      dots.append(d);
    }
    drawSpot(spots);
    const all = changed.length + elsewhere;
    chsBtn.hidden = !all;
    // "Changes" = fixes the agent marked done. With none on this page the button is a shortcut to the List, where the other pages are.
    chsBtn.textContent = innerWidth < 520 ? `✓ ${changed.length || elsewhere}`  // phone: short label
      : changed.length ? `✓ ${changed.length} to check${elsewhere ? ' · ' + elsewhere + ' elsewhere' : ''}`
      : `✓ ${elsewhere} to check elsewhere`;
    chsBtn.title = changed.length ? 'Show only what the agent changed on this page, then Keep or Revert each (Alt+Shift+C)' : 'Changes waiting on other pages of this site: open the list';
    chsBtn.classList.toggle('on', spot);
    spotNav.hidden = !spot || !changed.length;
    posEl.textContent = changed.length ? `${spotI + 1}/${changed.length}` : '';
  }
  function drawDots() {
    dots.textContent = '';
    if (mode === 'on' && !spot) for (const n of notes) {
      let el = null;
      try { el = n.selector ? document.querySelector(n.selector) : null; } catch (e) {}
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height)) continue;
      const d = document.createElement('div');
      d.className = 'dot' + (n.action === 'remove' ? ' remove' : '');
      d.textContent = n.id;
      d.title = (n.action === 'remove' ? 'REMOVE' + (n.comment ? ': ' : '') : '') + n.comment;
      d.style.left = Math.max(2, r.left - 9) + 'px';
      d.style.top = Math.max(2, r.top - 9) + 'px';
      if (n.revert) { d.className = 'dot revert'; d.title = 'REVERT requested: ' + n.comment; }
      d.addEventListener('click', () => openCard(el, n, el));
      dots.append(d);
    }
    $('.n').textContent = notes.length ? notes.length + ' open' : mode === 'on' && !spot ? 'click anything on the page' : '';  // the hint lives where the eye is
    tabCount();
    drawChanged();
    drawLinks();
  }

  // ---- other pages: badges on links, and the List sidebar ---------------------------
  const keyOf = u => u.pathname + u.search + (/^#!?\//.test(u.hash) ? u.hash : '');  // same page key as page()
  function byPage() {
    const m = new Map();
    for (const n of siteNotes) {
      const e = m.get(n.path) || { open: 0, ch: 0, notes: [], title: '' };
      if (n.status === 'done') e.ch++; else e.open++;
      e.notes.push(n);
      e.title = e.title || n.title || '';
      m.set(n.path, e);
    }
    return m;
  }
  // Every visible link to another page of this site that has notes gets a badge: blue = open notes, green = changes.
  // Drawn while notes are on or paused (paused is when links navigate), not in the Changes view.
  function drawLinks() {
    linksEl.textContent = '';
    if (mode === 'off' || spot || !siteNotes.length) return;
    const pages = byPage(), here = page();
    let n = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      if (n > 400) break;
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
      if (u.host !== location.host) continue;
      const key = keyOf(u), e = pages.get(key);
      if (!e || key === here) continue;
      const r = a.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      const b = document.createElement('span');
      b.className = 'lk' + (e.open ? '' : ' ch');
      b.textContent = (e.open ? e.open : '') + (e.open && e.ch ? ' · ' : '') + (e.ch ? '✓' + e.ch : '');
      b.title = `${e.open} open, ${e.ch} to check on ${key}: click to go there`;
      b.addEventListener('click', ev => { ev.stopPropagation(); goTo(key); });
      b.style.left = Math.min(innerWidth - 30, r.right - 8) + 'px';
      b.style.top = Math.max(2, r.top - 9) + 'px';
      linksEl.append(b);
      n++;
    }
  }
  function renderSide() {
    if (side.hidden) return;
    const pages = byPage(), here = page();
    const keys = [...pages.keys()].sort((a, b) => (a === here ? -1 : b === here ? 1 : a.localeCompare(b)));
    sideList.textContent = '';
    if (!keys.length) { sideList.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No open notes or changes on this site.' })); return; }
    for (const k of keys) {
      const e = pages.get(k);
      const pg = Object.assign(document.createElement('button'), { className: 'pg' + (k === here ? ' cur' : ''),
        textContent: `${k}  (${e.open} open${e.ch ? ', ' + e.ch + ' changed' : ''})`, title: e.title || k });
      pg.addEventListener('click', () => goTo(k));
      sideList.append(pg);
      for (const n of e.notes) {
        const kind = n.status === 'done' ? 'ch' : n.revert ? 'rv' : n.action === 'remove' ? 'rm' : '';
        const it = Object.assign(document.createElement('button'), { className: 'it ' + kind, title: n.comment });
        it.append(Object.assign(document.createElement('b'), { textContent: (n.status === 'done' ? '✓' : n.revert ? '↺' : '#') + n.id }),
                  Object.assign(document.createElement('span'), { textContent: n.comment || (n.action === 'remove' ? 'remove' : '') }));
        it.addEventListener('click', () => goTo(k, n.id));
        sideList.append(it);
      }
    }
  }
  function toggleSide(on) {
    side.hidden = !(on === undefined ? side.hidden : on);
    keep('sessionStorage', 'sn_side', side.hidden ? null : '1');  // stays open while walking through pages
    renderSide();
  }
  // Go to a page of this site and, if given, open one note there (after the page loads or the route changes).
  function goTo(key, id) {
    if (id) keep('sessionStorage', 'sn_open', String(id));
    if (key === page()) { if (id) openPending(); return; }
    const u = new URL(key, location.origin);
    if (u.pathname === location.pathname && u.search === location.search) location.hash = u.hash;  // single-page app route
    else location.href = u.href;
  }
  function openPending() {
    const id = Number(keep('sessionStorage', 'sn_open'));
    if (!id) return;
    keep('sessionStorage', 'sn_open', null);
    const c = changed.find(n => n.id === id), o = notes.find(n => n.id === id);
    if (c) { if (mode !== 'on') setMode('on'); openChange(c); return; }
    if (o) {
      let el = null;
      try { el = o.selector ? document.querySelector(o.selector) : null; } catch (e) {}
      if (!el) { toast(`#${id}: its element is not on this page any more`, true); return; }
      if (mode !== 'on') setMode('on');
      openCard(el, o, el);
    }
  }
  let stepI = -1;
  $('.pill .n').addEventListener('click', () => {
    if (!notes.length) { if (mode !== 'on') setMode('on'); return; }
    stepI = (stepI + 1) % notes.length;
    const n = notes[stepI];
    let el = null;
    try { el = n.selector ? document.querySelector(n.selector) : null; } catch (e) {}
    const r = el && el.getBoundingClientRect();
    if (!el || !(r.width || r.height)) { toast(`#${n.id} "${(n.comment || 'remove').slice(0, 60)}": its element is not visible on this layout`, true); return; }
    if (mode !== 'on') setMode('on');
    openCard(el, n, el);
  });
  $('.menu .ls').addEventListener('click', () => { showMenu(false); toggleSide(); });
  $('.side .sclose').addEventListener('click', () => toggleSide(false));

  // ---- changed notes: before / after, keep or revert ------------------------------
  function openChange(n) {
    chgNote = n;
    const fix = lastFix(n);
    const [what, ...rest] = String(fix ? fix.body : '').split(' | ');
    $('.chg h4').textContent = 'Changed, check it' + (fix ? ` · ${fix.who || 'agent'} · ${fix.at.slice(5, 16).replace('T', ' ')}` : '') + ` · #${n.id}`;
    $('.chg .note').textContent = (n.action === 'remove' ? 'REMOVE' + (n.comment ? ': ' : '') : '') + n.comment;
    $('.chg .before').textContent = n.text || '(no text captured; see the screenshot in the hub)';
    $('.chg .after').textContent = what || '(no description)';
    const ag = $('.chg .agent'); ag.hidden = !rest.length; ag.open = false; $('.chg .rest').textContent = rest.join('\n');
    whyIn.value = ''; whyIn.hidden = true; $('.chg .back').classList.remove('arm'); $('.chg .back').textContent = 'Revert';
    chg.hidden = false;
    const at = locate(n);
    if (at && (at.r.bottom < 0 || at.r.top > innerHeight)) {
      if (at.el) at.el.scrollIntoView({ block: 'center' }); else scrollTo({ top: at.r.top + scrollY - innerHeight / 3 });
    }
    placeChange();
  }
  function placeChange() {
    if (chg.hidden || !chgNote) return;
    const at = locate(chgNote), m = 8, W = innerWidth, H = innerHeight, cw = chg.offsetWidth, ch = chg.offsetHeight;
    let left = W - cw - m, top = m;
    if (at) {
      left = Math.min(Math.max(m, at.r.left), W - cw - m);
      top = at.r.bottom + m + ch <= H ? at.r.bottom + m : at.r.top - m - ch >= 0 ? at.r.top - m - ch : H - ch - 60;
    }
    chg.style.left = left + 'px';
    chg.style.top = Math.max(m, top) + 'px';
  }
  function closeChange() { chg.hidden = true; chgNote = null; }
  async function decide(a) {
    const n = chgNote;
    if (!n) return;
    closeChange();
    try {
      await api({ a, id: n.id, body: a === 'revert' ? whyIn.value.trim() : '' });
      toast(a === 'accept' ? `Kept #${n.id}` : `Revert asked for #${n.id}: it is back on the list for the agent`);
    } catch (e) { toast(e.message, true); }
    loadNotes();
  }
  $('.chg .close').addEventListener('click', closeChange);
  $('.chg .keep').addEventListener('click', () => decide('accept'));
  $('.chg .back').addEventListener('click', () => {  // first press asks why (optional), second press sends
    const b = $('.chg .back');
    if (whyIn.hidden) { whyIn.hidden = false; b.classList.add('arm'); b.textContent = 'Revert now'; whyIn.focus(); placeChange(); return; }
    decide('revert');
  });
  whyIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); decide('revert'); } });
  function setSpot(on) {
    spot = on && (changed.length > 0 || elsewhere > 0);
    if (spot && mode !== 'on') setMode('on');
    if (spot && changed.length) { spotI = Math.min(spotI, changed.length - 1); closeChange(); toast('Only what the agent changed stays lit: click a ✓ marker, or step with ‹ ›'); }
    if (!spot) closeChange();
    redraw();
  }
  function spotGo(k) {
    if (!changed.length) return;
    spotI = (spotI + k + changed.length) % changed.length;
    openChange(changed[spotI]);
    redraw();
  }
  $('.menu .hf').addEventListener('click', () => { hideFixed = !hideFixed; keep('sessionStorage', 'sn_hidefixed', hideFixed ? '1' : null); if (hideFixed) closeChange(); redraw(); });
  chsBtn.addEventListener('click', () => { if (changed.length) setSpot(!spot); else { toggleSide(true); toast('Changes on other pages are listed under their page; tap one to go there'); } });
  $('.pill .pv').addEventListener('click', () => spotGo(-1));
  $('.pill .nx').addEventListener('click', () => spotGo(1));
  function place() {
    if (!sel) return;
    const r = sel.el.getBoundingClientRect(), W = innerWidth, H = innerHeight, p = 4, m = 8;
    const L = Math.max(0, r.left - p), T = Math.max(0, r.top - p), R = Math.min(W, r.right + p), B = Math.min(H, r.bottom + p);
    put(panes[0], 0, 0, W, T);              // above
    put(panes[1], 0, B, W, H - B);          // below
    put(panes[2], 0, T, L, B - T);          // left
    put(panes[3], R, T, W - R, B - T);      // right
    put(ring, L, T, R - L, B - T);
    const ch = card.offsetHeight || 120;
    const top = B + m + ch <= H ? B + m : T - m - ch >= 0 ? T - m - ch : H - m - ch;
    card.style.left = Math.min(Math.max(m, L), W - card.offsetWidth - m) + 'px';
    card.style.top = Math.max(m, top) + 'px';
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawHl(); drawDots(); place(); placeChange(); }); };
  function toast(msg, bad, undo) {
    const t = $('.toast');
    t.textContent = msg;
    if (undo) {
      const b = Object.assign(document.createElement('button'), { textContent: 'Undo' });
      b.addEventListener('click', () => { t.classList.remove('show', 'act'); undo(); });
      t.append(b);
    }
    t.classList.toggle('act', !!undo);
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show', 'act'), bad ? 7000 : undo ? 8000 : 3500);
  }
  const api = body => send({ type: 'api', body });
  const undone = () => { toast('Undone'); loadNotes(); };
  function noteFor(el) {  // the open note that points at exactly this element, if any
    return notes.find(n => { try { return !!n.selector && document.querySelector(n.selector) === el; } catch (e) { return false; } });
  }

  // ---- the card --------------------------------------------------------------------
  // chain = body ... the clicked element; i = which one is picked. Up/down only moves i, so walking is always undoable.
  const chainOf = el => { const c = []; for (let n = el; n && n !== document.documentElement; n = n.parentElement) c.unshift(n); return c; };
  const short = el => kind(el);
  function openCard(el, note, clicked) {
    const chain = chainOf(clicked && clicked !== el && el.contains(clicked) ? clicked : el);
    sel = { chain, i: chain.indexOf(el), el, note };
    base = null;
    drawHl();
    ta.value = note ? note.comment : '';
    ta.placeholder = follow && lastPtr && lastPtr.viewport ? 'What should change? (tapped on ' + lastPtr.viewport + ')' : 'What should change?';
    delBtn.hidden = !note;
    whoIn.hidden = EXT || !!WHO;
    const marked = !!note && note.action === 'remove';
    rmBtn.classList.toggle('active', marked);
    rmBtn.textContent = marked ? 'Undo remove' : 'Remove element';
    rmBtn.title = marked ? 'Keep the element: drop this removal note' : 'Note that this element should be removed from the page';
    card.classList.remove('need');
    ov.hidden = false;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center' });
    pick(sel.i);
    setTimeout(() => ta.focus(), 0);
  }
  function pick(i, typed) {
    sel.i = Math.min(Math.max(0, i), sel.chain.length - 1);
    sel.el = sel.chain[sel.i];
    if (!typed) { selIn.value = cssPath(sel.el); selIn.classList.remove('bad'); }
    countMatches();
    upBtn.disabled = sel.i === 0;
    downBtn.disabled = sel.i === sel.chain.length - 1;
    crumbsEl.textContent = '';
    sel.chain.forEach((el, k) => {
      if (k) crumbsEl.append(Object.assign(document.createElement('span'), { className: 'gt', textContent: '›' }));
      const b = Object.assign(document.createElement('button'), { textContent: short(el), title: cssPath(el) });
      if (k === sel.i) b.className = 'cur'; else if (k > sel.i) b.className = 'below';
      b.addEventListener('click', () => pick(k));
      crumbsEl.append(b);
    });
    const cur = crumbsEl.querySelector('.cur');
    crumbsEl.scrollLeft = Math.max(0, cur.offsetLeft + cur.offsetWidth - crumbsEl.clientWidth + 40);
    place();
  }
  function countMatches() {
    let n = 0;
    try { n = document.querySelectorAll(selIn.value).length; } catch (e) {}
    cnt.textContent = n === 1 ? '' : n ? n + ' match' : 'no match';
  }
  selIn.addEventListener('input', () => {  // typed selector: pick what it matches, the path follows
    let m = null;
    try { m = document.querySelector(selIn.value); } catch (e) {}
    const ok = m && m !== host && m !== document.documentElement && m !== document.head && !document.head.contains(m);
    selIn.classList.toggle('bad', !ok);
    if (!ok) { countMatches(); return; }
    sel.chain = chainOf(m);
    pick(sel.chain.length - 1, true);
  });
  upBtn.addEventListener('click', () => pick(sel.i - 1));
  downBtn.addEventListener('click', () => pick(sel.i + 1));
  function closeCard() { sel = null; ov.hidden = true; }
  async function save(action) {
    if (!sel) return;
    const { el, note } = sel, comment = ta.value.trim(), typed = selIn.value.trim();
    if (action === 'change' && !comment) { card.classList.add('need'); ta.focus(); return; }
    if (!EXT && !WHO && whoIn.value.trim()) { WHO = whoIn.value.trim().slice(0, 60); keep('localStorage', 'sn_who', WHO); }
    closeCard();
    try {
      const data = describe(el);
      try { if (typed && document.querySelector(typed) === el) data.selector = typed; } catch (e) {}  // keep a hand-written selector
      let shot = null;
      if (EXT && (!note || note.selector !== data.selector)) {  // new note or moved to another element; hide our UI so the screenshot shows only the page
        host.style.visibility = 'hidden';
        await frames(2);
        const r = el.getBoundingClientRect();
        shot = await send({ type: 'capture', rect: [r.left, r.top, r.width, r.height], vw: innerWidth, vh: innerHeight }).then(x => x.data, () => null);
        host.style.visibility = '';
      }
      const res = await api(Object.assign({ a: 'save', id: note ? note.id : 0, action, comment, shot }, data));
      const undo = note
        ? () => api({ a: 'save', id: note.id, action: note.action, comment: note.comment, selector: note.selector, element: note.element,
                      text: note.text, rect: note.rect, viewport: note.viewport }).then(undone, e => toast(e.message, true))
        : () => api({ a: 'delete', id: res.id }).then(undone, e => toast(e.message, true));
      toast((action === 'remove' ? 'Marked for removal' : 'Saved') + ' #' + res.id + (DEMO ? ', in this browser only' : note || shot || !EXT ? '' : ' (no screenshot)'), false, undo);
    } catch (e) {
      host.style.visibility = '';
      toast('Not saved: ' + e.message, true);
    }
    loadNotes();
  }
  async function del() {
    const n = sel && sel.note;
    closeCard();
    if (!n) return;
    try {
      await api({ a: 'delete', id: n.id });
      toast('Deleted note #' + n.id, false, () => api({ a: 'restore', id: n.id }).then(undone, e => toast(e.message, true)));
    } catch (e) { toast(e.message, true); }
    loadNotes();
  }
  const saveAction = () => (sel && sel.note && sel.note.action === 'remove' ? 'remove' : 'change');  // Save keeps a removal note a removal note
  $('.ok').addEventListener('click', () => save(saveAction()));
  rmBtn.addEventListener('click', () => (sel && sel.note && sel.note.action === 'remove' ? del() : save('remove')));
  delBtn.addEventListener('click', del);
  $('.cancel').addEventListener('click', closeCard);
  panes.forEach(p => p.addEventListener('click', closeCard));
  ta.addEventListener('input', () => { card.classList.remove('need'); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; place(); });

  // ---- pill ----------------------------------------------------------------------
  modeBtn.addEventListener('click', () => setMode(mode === 'on' ? 'paused' : 'on'));
  let tucked = false, wasOn = false;
  function tuck(on) {  // the pill slides off, a tab stays at the right edge; note mode pauses so the page works
    tucked = on;
    pill.classList.toggle('tucked', on);
    tab.classList.toggle('show', on);
    if (on) { wasOn = mode === 'on' || keep('sessionStorage', 'sn_tucked') === 'on'; closeCard(); if (mode === 'on') setMode('paused'); }
    else if (wasOn) setMode('on');
    keep('sessionStorage', 'sn_tucked', on ? (wasOn ? 'on' : '1') : null);  // remembers whether to resume note mode
  }
  function tabCount() { tab.querySelector('.tcnt').textContent = notes.length ? String(notes.length) : ''; }
  tab.addEventListener('click', () => tuck(false));
  const off = () => { teardown(); if (EXT) send({ type: 'off' }).catch(() => {}); else keep('sessionStorage', 'sn_hidden', '1'); };
  $('.x').addEventListener('click', () => tuck(true));
  function showMenu(on) {
    menu.hidden = on === undefined ? !menu.hidden : !on;
    if (!menu.hidden) {  // phone: pointing; desktop: typing for the phone. Both stay reachable on a desktop (a laptop can point too)
      followBtn.hidden = innerWidth < 520 || DEMO;
      remoteBtn.hidden = DEMO;
      $('.menu .ex').hidden = DEMO;
    }
  }
  $('.pill .more').addEventListener('click', () => showMenu());
  $('.menu .off').addEventListener('click', () => { showMenu(false); off(); });
  $('.ex').addEventListener('click', async () => {
    showMenu(false);
    try {
      const r = await send({ type: 'export', site: location.host });
      const copied = await copy(r.md);
      toast(`${r.count} open notes of ${location.host}: ` + (copied ? 'copied, and ' : '') + `saved to Downloads/${r.file.replace(/^.*\//, '')}`);
    } catch (e) { toast('Export failed: ' + e.message, true); }
  });
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    t.remove();
    return ok;
  }

  // ---- events ----------------------------------------------------------------------
  function onMove(e) {
    if (mode !== 'on' || sel) return;
    const t = e.target;
    if (ours(t) || t === document.documentElement || !(t instanceof Element)) { if (base) { base = null; drawHl(); } return; }
    if (t !== base) { base = t; up = 0; drawHl(); }
  }
  let touchDown = null;  // {x, y, t} of the last touch pointerdown: a short still touch is a tap
  function onPress(e) {  // while note mode is on, the page never gets the click: no links, no buttons
    if (!menu.hidden && e.type === 'pointerdown' && !ours(e.target)) showMenu(false);  // a click anywhere else closes the menu
    if (mode !== 'on' || ours(e.target)) return;
    stop(e);
    if (sel || !(e.target instanceof Element)) return;
    const touch = e.pointerType === 'touch';
    if (touch && e.type === 'pointerdown') { touchDown = { x: e.clientX, y: e.clientY, t: Date.now() }; return; }
    if (touch && e.type === 'pointerup') {  // touch: the synthetic click never comes (touchstart is cancelled), so decide here
      const d = touchDown; touchDown = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || Date.now() - d.t > 600) return;  // a scroll, not a tap
      base = e.target; up = 0;
    } else if (e.type !== 'click' || e.pointerType === 'touch') return;
    const chosen = base ? lift(base, up) : null;
    const el = chosen && chosen.contains(e.target) ? chosen : e.target;
    if (remote) { point(el); return; }
    openCard(el, noteFor(el) || null, e.target);
  }
  // ---- Remote (phone) / Follow (desktop) -------------------------------------------
  async function point(el) {
    const d = describe(el);
    hl.style.display = 'block';
    const r = el.getBoundingClientRect();
    put(hl, r.left, r.top, r.width, r.height);
    hl.classList.add('remote');
    hlText.textContent = 'sent: ' + short(el);
    try { await send({ type: 'api', body: { a: 'point', site: d.site, path: d.path, selector: d.selector, text: d.text.slice(0, 300), viewport: d.viewport } }); }
    catch (e) { toast('Not sent: ' + e.message, true); }
    setTimeout(() => { if (remote) { hl.classList.remove('remote'); hl.style.display = 'none'; } }, 1200);
  }
  function setRemote(on) {
    remote = on;
    remoteBtn.classList.toggle('on', on);
    remoteBtn.textContent = on ? 'Pointing from this phone (stop)' : 'Point from this phone';
    if (on) { setFollow(false); if (mode !== 'on') setMode('on'); closeCard(); toast('Pointing: each tap here opens on the computer that types for the phone'); }
    keep('sessionStorage', 'sn_remote', on ? '1' : null);
  }
  function setFollow(on) {
    clearInterval(follow); follow = 0;
    followBtn.classList.toggle('on', on);
    followBtn.classList.toggle('wait', on);
    followBtn.textContent = on ? 'Typing for the phone, waiting…' : 'Type for the phone';
    keep('sessionStorage', 'sn_follow', on ? '1' : null);
    if (!on) return;
    if (remote) setRemote(false);
    seen = -1;  // first poll only learns the current seq; older taps are not replayed
    const tick = async () => {
      let p;
      try { p = await send({ type: 'api', query: { a: 'pointer', site: location.host } }); } catch (e) { return; }
      if (!p) return;
      if (seen === -1) { seen = p.seq || 0; return; }  // first poll: learn where the phone is, replay nothing
      if (!p.seq || p.seq === seen) return;
      seen = p.seq; lastPtr = p;
      followBtn.classList.remove('wait');
      followBtn.textContent = 'Typing for the phone (' + (p.viewport || 'phone') + ')';
      if (p.path && p.path !== page()) {  // the phone is on another page of the site: go there, the pointer is picked up after load
        keep('sessionStorage', 'sn_follow_seq', String(p.seq - 1));
        location.href = new URL(p.path, location.href).href;
        return;
      }
      let el = null;
      try { el = p.selector ? document.querySelector(p.selector) : null; } catch (e) {}
      if (!el && p.text) {  // selector did not match this layout: find the same text
        const t = p.text.trim().slice(0, 80);
        el = [...document.querySelectorAll('body *')].find(x => x.children.length === 0 && (x.textContent || '').trim().startsWith(t)) || null;
      }
      if (!el) { toast('Phone tapped ' + (p.selector || 'an element') + ', not found on this layout', true); return; }
      if (sel && sel.el === el) return;
      closeCard();
      openCard(el, noteFor(el) || null, el);
    };
    follow = setInterval(tick, 700);
    tick();
  }
  remoteBtn.addEventListener('click', () => { showMenu(false); setRemote(!remote); });
  followBtn.addEventListener('click', () => { showMenu(false); setFollow(!follow); });
  function onKey(e) {
    if (mode === 'off') return;
    if (e.type === 'keydown' && e.altKey && e.shiftKey && e.code === 'KeyC' && !sel) { stop(e); setSpot(!spot); return; }
    if (e.type === 'keydown' && e.altKey && e.shiftKey && e.code === 'KeyL' && !sel) { stop(e); toggleSide(); return; }
    if (spot && e.type === 'keydown' && !sel && e.composedPath()[0] !== whyIn) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { stop(e); spotGo(e.key === 'ArrowRight' ? 1 : -1); return; }
      if (e.key === 'Escape') { stop(e); setSpot(false); return; }
    }
    if (sel) {
      e.stopImmediatePropagation();  // keep page shortcuts away from the card
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape') { e.preventDefault(); closeCard(); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (e.composedPath()[0] === selIn) ta.focus(); else save(saveAction());
      }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); pick(sel.i + (e.key === 'ArrowUp' ? -1 : 1)); }
      return;
    }
    if (!menu.hidden && e.type === 'keydown' && e.key === 'Escape') { stop(e); showMenu(false); return; }
    if (!chg.hidden && e.type === 'keydown' && e.key === 'Escape') { stop(e); closeChange(); return; }  // on or paused
    if (mode !== 'on' || e.type !== 'keydown') return;
    if (e.key === 'Escape') { stop(e); setMode('paused'); }
    else if (base && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      stop(e);
      up = Math.min(Math.max(0, up + (e.key === 'ArrowUp' ? 1 : -1)), depth(base));
      drawHl();
    }
  }
  const PRESS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend', 'submit'];
  const KEYS = ['keydown', 'keypress', 'keyup'];

  async function loadNotes() {
    href = location.href;
    try {  // one call: every page of the site; this page's notes are filtered here
      const all = await send({ type: 'api', query: { a: 'list', site: location.host, status: 'all' } });
      siteNotes = all.filter(n => n.status === 'open' || n.status === 'done');
      const here = page();
      notes = siteNotes.filter(n => n.path === here && n.status === 'open');
      changed = siteNotes.filter(n => n.path === here && n.status === 'done');
      elsewhere = siteNotes.filter(n => n.path !== here && n.status === 'done').length;
    }
    catch (e) { siteNotes = []; notes = []; changed = []; elsewhere = 0; toast('Hub not reachable: ' + e.message, true); }
    if (spot && !changed.length) closeChange();
    drawDots();
    drawHl();  // a hovered element may have gained or lost a note
    renderSide();
    openPending();
  }
  function setMode(m) {
    mode = m;
    if (m !== 'on') { spot = false; closeChange(); }
    if (!EXT && m !== 'off') keep('sessionStorage', 'sn_mode', m);  // stays on while moving between pages
    pill.classList.toggle('paused', m === 'paused');
    modeBtn.textContent = m === 'paused' ? 'Add note' : 'Done';
    modeBtn.title = m === 'paused' ? 'Click anything on the page and say what should change' : 'Stop adding notes; links and buttons work again';
    if (m !== 'on') showMenu(false);
    if (m !== 'on') { base = null; closeCard(); }
    drawHl();
    drawDots();
  }
  function start() {
    if (mode !== 'off') return;
    host.dataset.by = EXT ? 'ext' : 'page';
    if (EXT) document.documentElement.setAttribute('data-site-notes', 'ext');  // tells a site's own notes.js to step aside
    document.documentElement.append(host);
    addEventListener('mousemove', onMove, true);
    PRESS.forEach(t => addEventListener(t, onPress, { capture: true, passive: false }));
    KEYS.forEach(t => addEventListener(t, onKey, true));
    addEventListener('scroll', redraw, true);
    addEventListener('resize', redraw);
    poll = setInterval(() => { if (location.href !== href) { closeCard(); closeChange(); spotI = 0; loadNotes(); } }, 1000);  // single-page apps
    setMode(EXT || keep('sessionStorage', 'sn_mode') === 'on' ? 'on' : 'paused');
    side.hidden = !keep('sessionStorage', 'sn_side');  // the List stays open while walking through pages
    if (keep('sessionStorage', 'sn_tucked')) tuck(true);
    if (keep('sessionStorage', 'sn_remote')) setRemote(true);
    if (keep('sessionStorage', 'sn_follow')) {
      const s = keep('sessionStorage', 'sn_follow_seq'); keep('sessionStorage', 'sn_follow_seq', null);
      setFollow(true);
      if (s) seen = Number(s);  // a pointer that sent us to this page is replayed once
    }
    loadNotes();
  }
  function teardown() {
    if (mode === 'off') return;
    setMode('off');
    removeEventListener('mousemove', onMove, true);
    PRESS.forEach(t => removeEventListener(t, onPress, { capture: true }));
    KEYS.forEach(t => removeEventListener(t, onKey, true));
    removeEventListener('scroll', redraw, true);
    removeEventListener('resize', redraw);
    clearInterval(poll);
    clearInterval(follow); follow = 0;
    host.remove();
    if (EXT && document.documentElement.getAttribute('data-site-notes') === 'ext') document.documentElement.removeAttribute('data-site-notes');
  }
  if (EXT) {
    chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'sn-mode') (m.on ? start : teardown)(); });
  } else {
    const extOn = () => document.documentElement.getAttribute('data-site-notes') === 'ext';
    const sync = () => { if (extOn()) teardown(); else if (!keep('sessionStorage', 'sn_hidden')) start(); };
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-site-notes'] });
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', sync); else sync();
  }
})();
