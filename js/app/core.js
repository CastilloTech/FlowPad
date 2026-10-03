/* LosSoulx FlowPad — app core: helpers, state, saving, the sheet model glue, sheets and dialogs,
 * routing, file and project menus, tempo, and keeping lyrics safe. Shared by the other app files
 * (classic scripts sharing one global scope, loaded in order by index.html).
 */
'use strict';

const { db, syl, words, audio, rec, voice } = FP;

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const byUpd = (a, b) => (b.updated || 0) - (a.updated || 0);
const fmtDur = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const isLabel = (l) => /^\s*\[.*\]\s*$/.test(l) || /^\s*(intro|outro|hook|chorus|verse|bridge|pre-?hook|refrain)\b[\s\d]*:?\s*$/i.test(l);
const isBar = (l) => !!l.trim() && !isLabel(l);

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const empty = (ic, title, text) =>
  `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

// ---------- constants ----------
const TRACKS = [
  { id: 'kick', name: 'Kick' },
  { id: 'snare', name: 'Snare' },
  { id: 'clap', name: 'Clap' },
  { id: 'hat', name: 'Hat' },
  { id: 'open', name: 'Open' },
];
const PRESETS = [
  { id: 'p-boombap', name: 'Boom Bap', bpm: 90, s: { kick: '1000000100100000', snare: '0000100000001000', hat: '1010101010101010' } },
  { id: 'p-trap', name: 'Trap', bpm: 140, s: { kick: '1000001000100000', clap: '0000000010000000', snare: '0000000010000000', hat: '1010101010111010', open: '0000000000000100' } },
  { id: 'p-drill', name: 'Drill', bpm: 142, s: { kick: '1000001000000100', snare: '0000000010000010', hat: '1010101110101010' } },
  { id: 'p-lofi', name: 'Lo-Fi', bpm: 78, s: { kick: '1000000010100000', snare: '0000100000001000', hat: '1010101010101000', open: '0000000000000010' } },
  { id: 'p-four', name: 'Four Floor', bpm: 120, s: { kick: '1000100010001000', clap: '0000100000001000', hat: '0010001000100010' } },
  { id: 'p-blank', name: 'Blank', bpm: null, s: {} },
];

// ---------- state ----------
const S = {
  projects: [], folders: [], files: [], patterns: [],
  settings: { id: 'settings', theme: 'dark', online: true, bpm: 90, timeSig: '4/4', accent: true, recBeat: true, recWords: true, recClick: false, beatClick: false },
  cur: null, caret: {}, cell: {}, panel: null, stripMode: 'rhymes', assoc: {}, lex: null,
  flows: [], // saved bar rhythms (kv 'flows')
};

const view = $('#view'), topbar = $('#topbar'), dock = $('#dock');

// ---------- persistence ----------
const dirty = new Map();
let flushT = null;
function saveSoon(store, obj) {
  obj.updated = Date.now();
  dirty.set(`${store}:${obj.id}`, [store, obj]);
  clearTimeout(flushT);
  flushT = setTimeout(flushSaves, 400);
}
function flushSaves() {
  clearTimeout(flushT);
  for (const [store, obj] of dirty.values()) db.put(store, obj);
  dirty.clear();
}
async function saveNow(store, obj) { obj.updated = Date.now(); await db.put(store, obj); }
const saveSettings = () => db.put('kv', S.settings);
window.addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });

// ---------- data access ----------
const proj = (id) => S.projects.find((p) => p.id === id);
const folder = (id) => S.folders.find((f) => f.id === id);
const file = (id) => S.files.find((f) => f.id === id);
const pattern = (id) => S.patterns.find((p) => p.id === id);
const patternsSorted = () => [...S.patterns].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.created - b.created);
const patName = (id) => (id === 'rest' ? 'Rest' : (pattern(id) || patternsSorted()[0] || { name: '—' }).name);
const filesIn = (pid, fid = null) => S.files.filter((f) => f.projectId === pid && (f.folderId || null) === fid).sort(byUpd);
const foldersIn = (pid) => S.folders.filter((f) => f.projectId === pid).sort((a, b) => a.name.localeCompare(b.name));
const projTime = (p) => Math.max(p.updated || 0, ...S.files.filter((f) => f.projectId === p.id).map((f) => f.updated || 0));
function pathOf(f) {
  const p = proj(f.projectId), fo = f.folderId && folder(f.folderId);
  return [p && p.name, fo && fo.name].filter(Boolean).join(' › ');
}
function firstLine(f) {
  const l = (f.text || '').split('\n').find(isBar);
  return l ? l.trim() : '';
}
function normFile(f) {
  f.beat = f.beat || { def: 'p-boombap', bars: {} };
  f.beat.bars = f.beat.bars || {};
  f.bank = f.bank || [];
  f.bpm = f.bpm || 90;
  f.swing = f.swing || 0;
  f.text = f.text || '';
  f.title = f.title || 'Untitled';
  if (!Array.isArray(f.sheet)) f.sheet = textToSheet(f.text, f.beat.bars);
  return f;
}
function barSteps(f, line) {
  const id = f.beat.bars[line] ?? f.beat.def;
  if (id === 'rest') return null;
  const p = pattern(id) || pattern(f.beat.def) || patternsSorted()[0];
  return p ? p.steps : null;
}
const barLines = (f) => (f.sheet ? f.sheet.map((r, i) => (r.type === 'bar' ? i : -1)) : f.text.split('\n').map((l, i) => (isBar(l) ? i : -1))).filter((i) => i >= 0);

// ---------- flow sheet model (js/sheet.js) ----------
const SH = FP.sheet;
const { newBarRow, sylPieces, stepText, spreadCells, wordSteps } = SH;

/** Read a bar's steps back into a lyric line, plus the stress class of every step (cached per bar content). */
const views0 = new Map();
window.addEventListener('fp:lexicon', () => views0.clear()); // new pronunciations change stresses
function barView(cells) {
  const key = cells.join('\u0001');
  let v = views0.get(key);
  if (!v) {
    if (views0.size > 3000) views0.clear();
    views0.set(key, (v = barView0(cells)));
  }
  return v;
}
function barView0(cells) {
  const wordsIn = [];
  let cur = null;
  cells.forEach((raw, k) => {
    const t = (raw || '').trim();
    if (!t) return;
    t.split(/\s+/).forEach((p, idx, parts) => {
      const cont = idx === parts.length - 1 && p.length > 1 && p.endsWith('-');
      const clean = cont ? p.slice(0, -1) : p;
      if (idx === 0 && cur && cur.open) cur.frags.push({ k, t: clean });
      else { cur = { frags: [{ k, t: clean }] }; wordsIn.push(cur); }
      cur.open = cont;
    });
  });
  const cls = new Array(16).fill('');
  const marks = range(16).map(() => new Set());
  const text = wordsIn.map((w) => {
    const wt = w.frags.map((x) => x.t).join('');
    const st = syl.analyzeLine(wt).tokens.filter((t) => t.word).flatMap((t) => t.syls.map((s) => s.s));
    if (st.length) {
      let idx = 0;
      w.frags.forEach((fr, fi) => {
        const c = fi === w.frags.length - 1 ? Math.max(1, st.length - idx) : Math.max(1, syl.count(fr.t));
        const seg = st.slice(idx, idx + c);
        (seg.length ? seg : [st[Math.min(idx, st.length - 1)]]).forEach((s) => marks[fr.k].add(s));
        idx += c;
      });
    }
    return wt;
  }).join(' ');
  marks.forEach((m, k) => { cls[k] = m.has(1) ? 's1' : m.has(2) ? 's2' : m.size ? 's0' : ''; });
  return { text, cls };
}

function textToSheet(text, bars = {}) {
  return String(text || '').split('\n').map((l, i) => {
    if (!l.trim()) return { type: 'blank' };
    if (isLabel(l)) return { type: 'label', text: l.trim().replace(/^\[|\]$/g, '').replace(/:$/, '').trim() };
    return { type: 'bar', cells: spreadCells(l, 'even'), pat: bars[i] || null };
  });
}

// ---------- theme ----------
const mq = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const t = S.settings.theme === 'system' ? (mq.matches ? 'light' : 'dark') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === 'light' ? '#f5f8fd' : '#05070b';
}
if (mq.addEventListener) mq.addEventListener('change', applyTheme);

// ---------- feel: motion, haptics ----------
/** The phone asks for less motion: skip the glides and slides. */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** A tiny tap on phones that can vibrate (Android — iPhones don't let websites vibrate). */
const buzz = (ms = 8) => { try { if (navigator.vibrate && S.settings.haptics !== false) navigator.vibrate(ms); } catch (e) { /* not allowed */ } };

// ---------- toast (optionally with one action, e.g. Undo) ----------
let toastT = 0;
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = '';
  t.append(msg);
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.classList.remove('show'); action.fn(); });
    t.append(b);
  }
  t.classList.toggle('has-act', !!action);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), action ? 4500 : 1900);
}

/**
 * Swipe down to close a sheet or panel. Touch only (a mouse has the close button). Starts when
 * the finger pulls down and `canStart` agrees (e.g. the content is scrolled to the top); the
 * element follows the finger, and a long or quick pull closes it, otherwise it springs back.
 */
function swipeDown(el, { onClose, canStart = () => true, base = '' }) {
  let y0 = 0, x0 = 0, dy = 0, t0 = 0, on = false, dead = false;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1 || e.target.closest('input, textarea, select, .range, .seq')) { dead = true; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = performance.now(); dy = 0; on = false; dead = false;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (dead) return;
    const d = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!on) {
      if (d < -6 || Math.abs(dx) > Math.abs(d)) { dead = true; return; }
      if (d < 10 || !canStart(e)) return;
      on = true;
      el.style.transition = 'none';
    }
    e.preventDefault();
    dy = Math.max(0, d - 10);
    el.style.transform = `${base} translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (!on) return;
    on = false;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.5;
    el.style.transition = '';
    if (dy > 110 || (fast && dy > 30)) { buzz(6); onClose(); } else el.style.transform = '';
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// ---------- sheets ----------
const openSheets = [];
function sheet({ title, html = '', items, cls = '', actions = {} }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const body = items
    ? items.map((it, i) => `<button class="menu-i ${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''} ${it.indent ? 'indent' : ''}" data-i="${i}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}${it.on ? icon('check', 'chk') : ''}</button>`).join('')
    : html;
  wrap.innerHTML = `<div class="scrim"></div><div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}"><div class="grab"></div>${title ? `<div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>` : ''}<div class="sheet-b">${body}</div></div>`;
  $('#sheets').appendChild(wrap);
  wrap.offsetHeight; // commit initial state so the slide-in animates
  wrap.classList.add('open');
  const api = {
    el: wrap.querySelector('.sheet'),
    closed: false,
    onclose: null,
    close() {
      if (api.closed) return;
      api.closed = true;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 260);
      const i = openSheets.indexOf(api);
      if (i >= 0) openSheets.splice(i, 1);
      if (api.onclose) api.onclose();
    },
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.classList.contains('scrim') || e.target.closest('[data-close]')) return api.close();
    if (items) {
      const b = e.target.closest('.menu-i');
      if (b) { const it = items[+b.dataset.i]; api.close(); if (it.onClick) it.onClick(); }
      return;
    }
    const a = e.target.closest('[data-a]');
    if (a) { const fn = actions[a.dataset.a] || GA[a.dataset.a]; if (fn) fn(a, e); }
  });
  // swipe down from the handle or the title, or anywhere once the content is scrolled to the top
  swipeDown(api.el, {
    base: 'translateX(-50%)',
    canStart: (e) => !!e.target.closest('.grab, .sheet-h') || api.el.scrollTop <= 0,
    onClose: () => { api.el.style.transform = ''; api.close(); },
  });
  openSheets.push(api);
  return api;
}
const closeAllSheets = () => [...openSheets].forEach((s) => s.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1].close(); });

function ask({ title, value = '', placeholder = '', ok = 'Save', inputmode = 'text' }) {
  return new Promise((resolve) => {
    const sh = sheet({ title, html: `<form><input class="field" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${inputmode}" autocomplete="off" enterkeyhint="done"><div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${esc(ok)}</button></div></form>` });
    const form = sh.el.querySelector('form');
    const input = form.elements.v;
    let done = false;
    input.focus();
    input.select();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      done = true;
      sh.close();
      resolve(v);
    });
    sh.onclose = () => { if (!done) resolve(null); };
  });
}

function confirmBox({ title, message, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const sh = sheet({ title, html: `<p class="msg">${esc(message)}</p><div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button></div>`, actions: { yes: () => { done = true; sh.close(); resolve(true); } } });
    let done = false;
    sh.onclose = () => { if (!done) resolve(false); };
  });
}

// ---------- if something breaks ----------
// An uncaught error in the app's own code gets a calm card — lyrics are saved first — with a reload
// and a ready-made bug report. Browser noise and expected failures (a dropped connection, a
// blocked mic) don't count.
const ISSUES = 'https://github.com/CastilloTech/FlowPad/issues/new';
let crashed = false;
function onCrash(err) {
  const e = err instanceof Error ? err : null;
  const msg = e ? `${e.name}: ${e.message}` : String(err || '');
  if (crashed || !msg || /ResizeObserver loop|^Script error\.?$|AbortError|NotAllowedError|NetworkError|Failed to fetch|Load failed/i.test(msg)) return;
  crashed = true;
  try { flushSaves(); } catch (x) { /* best effort */ }
  const where = (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '').replace(location.origin, '');
  const report = `${ISSUES}?${new URLSearchParams({ title: `Crash: ${msg.slice(0, 80)}`, body: `What were you doing when it happened?\n\n\n---\n${msg}\n${where}\n\nScreen: ${location.hash || '#/'} · ${navigator.userAgent}` })}`;
  const el = document.createElement('div');
  el.className = 'crash';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="crash-card"><b>Something went wrong</b><span>Your lyrics are saved. Reload to carry on.</span>
    <div class="crash-act"><a class="btn" href="${esc(report)}" target="_blank" rel="noopener">Report it</a><button class="btn primary" data-reload>Reload</button></div>
    <button class="icon-btn muted crash-x" data-dismiss aria-label="Dismiss">${icon('x')}</button></div>`;
  el.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  el.querySelector('[data-dismiss]').addEventListener('click', () => { el.remove(); crashed = false; });
  document.body.appendChild(el);
}
window.addEventListener('error', (e) => { if (e.error || e.message) onCrash(e.error || e.message); });
// a promise that fails with a programming error (not a refused permission or a dropped request)
window.addEventListener('unhandledrejection', (e) => { if (e.reason instanceof TypeError || e.reason instanceof ReferenceError) onCrash(e.reason); });

// ---------- actions & routing ----------
let VA = {};
const GA = {};
document.addEventListener('click', (e) => {
  if (e.target.closest('.sheet-wrap')) return;
  const a = e.target.closest('[data-a]');
  if (a) {
    const fn = VA[a.dataset.a] || GA[a.dataset.a];
    if (fn) { fn(a, e); return; }
  }
  const g = e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
});

let leaving = [];
const onLeave = (fn) => leaving.push(fn);

function go(hash, replace) {
  if (location.hash === hash) return route();
  if (replace) { history.replaceState(null, '', hash); route(); } else location.hash = hash;
}
const rerender = () => route(true);
window.addEventListener('hashchange', () => route());

function route(keepScroll) {
  const y = window.scrollY;
  leaving.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  leaving = [];
  VA = {};
  S.lex = null;
  closeAllSheets();
  flushSaves();
  audio.stop();
  dock.hidden = true;
  dock.innerHTML = '';
  const [k, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (k === 'p') Project(id);
  else if (k === 'f') Folder(id);
  else if (k === 'e') Editor(id);
  else Home();
  window.scrollTo(0, keepScroll ? y : 0);
  // slide in from the side you're heading: deeper (home → project → song) from the right
  const depth = { p: 1, f: 2, e: 3 }[k] || 0;
  if (!keepScroll && !calm() && depth !== lastDepth) {
    view.classList.remove('in-fwd', 'in-back');
    void view.offsetWidth;
    view.classList.add(depth > lastDepth ? 'in-fwd' : 'in-back');
  }
  lastDepth = depth;
}
let lastDepth = 0;

window.addEventListener('fp:lexicon', () => { if (S.lex) S.lex(); });

function setTop({ back, title, sub, right = '', brand, onTitle }) {
  const t = brand
    ? `<div class="tb-title"><span class="brand"><small>LosSoulx</small><span>Flow<b>Pad</b></span></span></div>`
    : `<div class="tb-title ${onTitle ? 'tappable' : ''}" ${onTitle ? 'data-a="title" role="button" aria-label="Rename"' : ''}><div class="tb-t">${esc(title)}</div>${sub ? `<div class="tb-s">${esc(sub)}</div>` : ''}</div>`;
  topbar.innerHTML = `${back ? `<button class="icon-btn" data-go="${back}" aria-label="Back">${icon('back')}</button>` : ''}${t}<div class="tb-r">${right}</div>`;
  if (onTitle) VA.title = onTitle;
}

// ---------- rows ----------
function snippet(f, q) {
  const line = f.text.split('\n').find((l) => l.toLowerCase().includes(q));
  if (!line) return esc(pathOf(f));
  const i = line.toLowerCase().indexOf(q);
  const start = Math.max(0, i - 24);
  return (start ? '…' : '') + esc(line.slice(start, i)) + `<mark>${esc(line.slice(i, i + q.length))}</mark>` + esc(line.slice(i + q.length, i + q.length + 40));
}
function fileRow(f, { path = false, q = '' } = {}) {
  const sub = q ? snippet(f, q) : esc(path ? `${pathOf(f)} · ${ago(f.updated)}` : `${firstLine(f) || 'Empty'} · ${ago(f.updated)}`);
  return `<li class="row" data-go="#/e/${f.id}"><span class="row-ic accent">${icon('file')}</span><div class="row-main"><div class="row-t">${esc(f.title)}</div><div class="row-s">${sub}</div></div><button class="icon-btn" data-a="more-file" data-id="${f.id}" aria-label="Options for ${esc(f.title)}">${icon('more')}</button></li>`;
}
function folderRow(fo) {
  const n = S.files.filter((f) => f.folderId === fo.id).length;
  return `<li class="row" data-go="#/f/${fo.id}"><span class="row-ic">${icon('folder')}</span><div class="row-main"><div class="row-t">${esc(fo.name)}</div><div class="row-s">${plural(n, 'song')}</div></div><button class="icon-btn" data-a="more-folder" data-id="${fo.id}" aria-label="Options for ${esc(fo.name)}">${icon('more')}</button></li>`;
}
function projRow(p) {
  const nf = S.files.filter((f) => f.projectId === p.id).length;
  const nd = S.folders.filter((f) => f.projectId === p.id).length;
  return `<li class="row" data-go="#/p/${p.id}"><span class="row-ic">${icon('project')}</span><div class="row-main"><div class="row-t">${esc(p.name)}</div><div class="row-s">${nd ? plural(nd, 'folder') + ' · ' : ''}${plural(nf, 'song')} · ${ago(projTime(p))}</div></div><button class="icon-btn" data-a="more-project" data-id="${p.id}" aria-label="Options for ${esc(p.name)}">${icon('more')}</button></li>`;
}

// ---------- create / delete ----------
async function newProject() {
  const name = await ask({ title: 'New project', placeholder: 'Album, mixtape, EP…', ok: 'Create' });
  if (!name) return;
  const p = { id: FP.uid(), name, created: Date.now(), updated: Date.now() };
  S.projects.push(p);
  await db.put('projects', p);
  go(`#/p/${p.id}`);
}
async function newFolder(pid) {
  const name = await ask({ title: 'New folder', placeholder: 'Verses, hooks, track 1…', ok: 'Create' });
  if (!name) return;
  const fo = { id: FP.uid(), projectId: pid, name, created: Date.now(), updated: Date.now() };
  S.folders.push(fo);
  await db.put('folders', fo);
  go(`#/f/${fo.id}`);
}
async function newFile(pid, fid = null) {
  const f = normFile({ id: FP.uid(), projectId: pid, folderId: fid, title: 'Untitled', created: Date.now(), updated: Date.now(), bpm: S.settings.bpm, beat: { def: patternsSorted()[0]?.id || 'p-boombap', bars: {} } });
  S.files.push(f);
  await db.put('files', f);
  go(`#/e/${f.id}`);
  setTimeout(() => { const c = $('#lines .cell'); if (c) c.click(); }, 50);
}
async function quickFile() {
  let p = S.projects.find((x) => x.name === 'Scratchpad');
  if (!p) {
    p = { id: FP.uid(), name: 'Scratchpad', created: Date.now(), updated: Date.now() };
    S.projects.push(p);
    await db.put('projects', p);
  }
  newFile(p.id);
}
async function deleteFile(f) {
  S.files = S.files.filter((x) => x !== f);
  await db.del('files', f.id);
  const recs = await db.byIndex('recordings', 'fileId', f.id);
  await Promise.all(recs.map((r) => db.del('recordings', r.id)));
  const vers = await db.byIndex('versions', 'fileId', f.id);
  await Promise.all(vers.map((v) => db.del('versions', v.id)));
}
async function deleteFolder(fo) {
  for (const f of S.files.filter((x) => x.folderId === fo.id)) await deleteFile(f);
  S.folders = S.folders.filter((x) => x !== fo);
  await db.del('folders', fo.id);
}
async function deleteProject(p) {
  for (const f of S.files.filter((x) => x.projectId === p.id)) await deleteFile(f);
  for (const fo of S.folders.filter((x) => x.projectId === p.id)) await deleteFolder(fo);
  S.projects = S.projects.filter((x) => x !== p);
  await db.del('projects', p.id);
}

// ---------- menus ----------
function projectMenu(p) {
  sheet({
    title: p.name,
    items: [
      { label: 'Rename', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename project', value: p.name }); if (v) { p.name = v; await saveNow('projects', p); rerender(); } } },
      { label: 'New folder', icon: 'folder', onClick: () => newFolder(p.id) },
      { label: 'New song', icon: 'file', onClick: () => newFile(p.id) },
      {
        label: 'Delete project', icon: 'trash', danger: true,
        onClick: async () => {
          const n = S.files.filter((f) => f.projectId === p.id).length;
          if (await confirmBox({ title: 'Delete project?', message: `“${p.name}” and ${plural(n, 'song')} inside it will be permanently deleted, including recordings.`, ok: 'Delete', danger: true })) {
            await deleteProject(p);
            toast('Project deleted');
            go('#/');
          }
        },
      },
    ],
  });
}
function folderMenu(fo) {
  sheet({
    title: fo.name,
    items: [
      { label: 'Rename', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename folder', value: fo.name }); if (v) { fo.name = v; await saveNow('folders', fo); rerender(); } } },
      { label: 'New song here', icon: 'file', onClick: () => newFile(fo.projectId, fo.id) },
      {
        label: 'Delete folder', icon: 'trash', danger: true,
        onClick: async () => {
          const n = S.files.filter((f) => f.folderId === fo.id).length;
          if (await confirmBox({ title: 'Delete folder?', message: `“${fo.name}”${n ? ` and ${plural(n, 'song')} inside it` : ''} will be permanently deleted.`, ok: 'Delete', danger: true })) {
            const pid = fo.projectId;
            await deleteFolder(fo);
            toast('Folder deleted');
            if (location.hash.startsWith('#/f/')) go(`#/p/${pid}`, true); else rerender();
          }
        },
      },
    ],
  });
}
function fileMenu(f, inEditor) {
  sheet({
    title: f.title,
    items: [
      { label: 'Rename', icon: 'edit', onClick: () => renameFile(f) },
      { label: 'Move to…', icon: 'move', onClick: () => moveFile(f) },
      { label: 'Duplicate', icon: 'copy', onClick: async () => {
        const copy = normFile(JSON.parse(JSON.stringify({ ...f, id: FP.uid(), title: `${f.title} copy`, created: Date.now() })));
        S.files.push(copy);
        await saveNow('files', copy);
        toast('Duplicated');
        if (!inEditor) rerender();
      } },
      { label: 'Versions…', icon: 'loop', hint: 'Look back, restore', onClick: () => versionsSheet(f) },
      { label: 'Share & export…', icon: 'share', hint: 'Copy, PDF, .txt', onClick: () => shareMenu(f) },
      {
        label: 'Delete song', icon: 'trash', danger: true,
        onClick: async () => {
          if (await confirmBox({ title: 'Delete song?', message: `“${f.title}” and its recordings will be permanently deleted.`, ok: 'Delete', danger: true })) {
            const back = f.folderId ? `#/f/${f.folderId}` : `#/p/${f.projectId}`;
            await deleteFile(f);
            toast('Song deleted');
            if (inEditor) go(back, true); else rerender();
          }
        },
      },
    ],
  });
}
/** Every way out for a song's lyrics, in one place. */
function shareMenu(f) {
  sheet({
    title: 'Share & export',
    items: [
      ...(navigator.share ? [{ label: 'Share lyrics', icon: 'share', onClick: () => navigator.share({ title: f.title, text: `${f.title}\n\n${f.text}` }).catch(() => {}) }] : []),
      { label: 'Copy lyrics', icon: 'file', onClick: async () => { try { await navigator.clipboard.writeText(f.text); toast('Lyrics copied'); } catch (e) { toast('Clipboard unavailable'); } } },
      { label: 'Print or save as PDF', icon: 'download', hint: 'A clean lyric sheet', onClick: () => printLyrics(f) },
      { label: 'Download as text', icon: 'download', hint: '.txt', onClick: () => download(`${f.title}.txt`, new Blob([`${f.title}\n\n${f.text}\n`], { type: 'text/plain' })) },
    ],
  });
}
/** A print-only lyric sheet (sections as headings, stressed syllables in bold caps); the browser's print dialog saves it as PDF. */
function printLyrics(f) {
  const old = $('#print');
  if (old) old.remove();
  const sheetEl = document.createElement('div');
  sheetEl.id = 'print';
  const line = (l) => syl.analyzeLine(l).tokens.map((t) => (!t.word || (t.syls[0] && t.syls[0].num) ? esc(t.text)
    : t.syls.map((s) => (s.s === 1 ? `<b>${esc(s.t.toUpperCase())}</b>` : esc(s.t))).join(''))).join('');
  sheetEl.innerHTML = `<h1>${esc(f.title)}</h1><p class="pmeta">${esc([pathOf(f), `${f.bpm} BPM`].filter(Boolean).join(' · '))}</p>`
    + f.text.split('\n').map((l) => (!l.trim() ? '<div class="pgap"></div>' : isLabel(l) ? `<h2>${esc(l.trim().replace(/^\[|\]$/g, ''))}</h2>` : `<p>${line(l)}</p>`)).join('')
    + '<p class="pfoot">LosSoulx FlowPad</p>';
  document.body.appendChild(sheetEl);
  const done = () => { sheetEl.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50); // if afterprint never fires (some iOS versions), the next print replaces it
}

async function renameFile(f) {
  const v = await ask({ title: 'Rename', value: f.title === 'Untitled' ? '' : f.title, placeholder: 'Song title' });
  if (!v) return;
  f.title = v;
  await saveNow('files', f);
  const t = $('.tb-t');
  if (t && S.cur === f) t.textContent = v; else rerender();
}
function moveFile(f) {
  const items = [];
  for (const p of [...S.projects].sort((a, b) => a.name.localeCompare(b.name))) {
    items.push({ label: p.name, icon: 'project', on: f.projectId === p.id && !f.folderId, onClick: () => doMove(f, p.id, null) });
    for (const fo of foldersIn(p.id)) items.push({ label: fo.name, icon: 'folder', indent: true, on: f.folderId === fo.id, onClick: () => doMove(f, p.id, fo.id) });
  }
  sheet({ title: 'Move to', items });
}
async function doMove(f, pid, fid) {
  f.projectId = pid;
  f.folderId = fid;
  await saveNow('files', f);
  toast(`Moved to ${fid ? folder(fid).name : proj(pid).name}`);
  rerender();
}
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

GA['more-file'] = (el) => { const f = file(el.dataset.id); if (f) fileMenu(f); };
GA['more-folder'] = (el) => { const fo = folder(el.dataset.id); if (fo) folderMenu(fo); };
GA['more-project'] = (el) => { const p = proj(el.dataset.id); if (p) projectMenu(p); };
GA.settings = () => openSettings();
GA.metro = () => openMetronome();

// ---------- BPM (shared by beat, flow, metronome) ----------
const curBpm = () => (S.cur ? S.cur.bpm : S.settings.bpm);
function setBpm(v) {
  v = clamp(Math.round(v), 40, 220);
  if (S.cur) { S.cur.bpm = v; saveSoon('files', S.cur); } else { S.settings.bpm = v; saveSettings(); }
  audio.update({ bpm: v });
  $$('[data-bpm]').forEach((e) => { e.textContent = v; });
  const r = $('#mbr');
  if (r && +r.value !== v) r.value = v;
}
const bpmCtl = (v) => `<div class="bpm"><button class="icon-btn" data-a="bpm-dn" aria-label="Slower">${icon('minus')}</button><button class="bpm-v" data-a="bpm-set" aria-label="Set tempo"><b data-bpm>${v}</b><span>BPM</span></button><button class="icon-btn" data-a="bpm-up" aria-label="Faster">${icon('plus')}</button></div>`;
GA['bpm-dn'] = (el) => { if (el._held) { el._held = false; return; } setBpm(curBpm() - 1); };
GA['bpm-up'] = (el) => { if (el._held) { el._held = false; return; } setBpm(curBpm() + 1); };
GA['bpm-set'] = async () => {
  const v = await ask({ title: 'Tempo (BPM)', value: String(curBpm()), ok: 'Set', inputmode: 'numeric' });
  if (v && !isNaN(+v)) setBpm(+v);
};
// press-and-hold on − / + to scrub the tempo
let holdT = 0, holdI = 0;
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-a="bpm-up"],[data-a="bpm-dn"]');
  if (!b) return;
  const d = b.dataset.a === 'bpm-up' ? 1 : -1;
  holdT = setTimeout(() => { holdI = setInterval(() => { b._held = true; setBpm(curBpm() + d); }, 70); }, 420);
});
const endHold = () => { clearTimeout(holdT); clearInterval(holdI); };
document.addEventListener('pointerup', endHold, true);
document.addEventListener('pointercancel', endHold, true);


// =====================================================================
// KEEPING LYRICS SAFE — everything lives in this browser's storage
// =====================================================================
let persisted = null; // true once the browser agrees not to clear our storage by itself
async function protectStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch (e) { /* not supported */ }
}
function exportBackup() {
  const data = { app: 'FlowPad', version: 1, exported: new Date().toISOString(), projects: S.projects, folders: S.folders, files: S.files, patterns: S.patterns };
  download(`flowpad-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  S.settings.lastBackup = Date.now();
  S.settings.backupSnooze = 0;
  saveSettings();
  toast('Backup saved — keep it somewhere safe (Drive, email, cloud)');
}
// ---------- installing the app (home screen, full-screen, offline, storage kept more reliably) ----------
let installEvt = null; // Chrome / Edge / Android hand us their install prompt to show at a good moment
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  // show the offer if we're on the home screen and not in the middle of a search
  const q = document.querySelector('#q');
  if ((location.hash === '' || location.hash === '#/') && !document.querySelector('.notice') && !(q && q.value)) rerender();
});
window.addEventListener('appinstalled', () => { installEvt = null; S.settings.installed = true; saveSettings(); toast('FlowPad is on your home screen'); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Offer installing from the second visit on, once there's a song — unless installed or dismissed. */
function installOffer() {
  if (standalone() || S.settings.installed || S.settings.installDismissed || (S.settings.opens || 0) < 2 || !S.files.length) return null;
  if (installEvt) return 'prompt';
  if (isIOS()) return 'ios';
  return null;
}
async function installNow() {
  if (!installEvt) return;
  installEvt.prompt();
  const { outcome } = await installEvt.userChoice;
  installEvt = null;
  if (outcome !== 'accepted') { S.settings.installDismissed = true; saveSettings(); }
}

/** Time for a reminder: lyrics changed since the last backup, and it's been a week (or never, after 3 days). */
function backupDue() {
  if (!S.files.length || Date.now() < (S.settings.backupSnooze || 0)) return false;
  const last = S.settings.lastBackup || 0;
  if (!S.files.some((f) => (f.updated || 0) > last)) return false;
  if (last) return Date.now() - last > 7 * 864e5;
  return Date.now() - Math.min(...S.files.map((f) => f.created || Date.now())) > 3 * 864e5;
}
