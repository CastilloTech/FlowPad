/* FlowPad — app shell: library (projects / folders / files), editor tabs, sheets. */
(() => {
  'use strict';
  const { db, syl, words, audio, rec } = FP;

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
    settings: { id: 'settings', theme: 'dark', online: true, bpm: 90, timeSig: '4/4', accent: true, recBeat: true, recClick: false, beatClick: false },
    cur: null, caret: {}, cell: {}, panel: null, stripMode: 'rhymes', assoc: {}, lex: null,
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

  // ---------- flow sheet model ----------
  // A song is a list of rows: { type: 'bar', cells: [16 step strings], pat } |
  // { type: 'label', text } | { type: 'blank' }. A step holds what lands on it;
  // a trailing "-" means the word carries on into the next filled step ("ci-", "ty").
  const newBarRow = () => ({ type: 'bar', cells: new Array(16).fill(''), pat: null });

  /** Read a bar's steps back into a lyric line, plus the stress class of every step. */
  function barView(cells) {
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

  /** Lay a lyric line across 16 steps: 'even' spreads it over the bar, 'pack' puts one syllable per step. */
  function spreadCells(text, mode = 'even') {
    const flat = sylPieces(text);
    const cells = range(16).map(() => []);
    flat.forEach((s, j) => cells[mode === 'pack' ? Math.min(15, j) : Math.min(15, Math.floor((j * 16) / flat.length))].push(s));
    return cells.map((L) => {
      if (!L.length) return '';
      let out = '';
      L.forEach((s, i) => { out += s.t; if (i < L.length - 1 && s.end) out += ' '; });
      return L[L.length - 1].end ? out : `${out}-`;
    });
  }

  /** A line as its syllables in order: { t, end } where `end` marks the last syllable of a word. */
  function sylPieces(text) {
    const flat = [];
    let lead = '';
    const toks = syl.analyzeLine(text).tokens;
    toks.forEach((t) => {
      if (t.word) {
        const pieces = t.syls[0] && t.syls[0].num ? [t.text] : t.syls.map((s) => s.t);
        pieces.forEach((p, j) => flat.push({ t: (j === 0 ? lead : '') + p, end: j === pieces.length - 1 }));
        lead = '';
      } else {
        // punctuation hugs the word before it; an opening quote/bracket hugs the next word
        const m = t.text.match(/^(\S*)(\s*)(.*)$/s);
        if (flat.length && m[1]) flat[flat.length - 1].t += m[1];
        else if (!flat.length) lead += m[1];
        if (m[3]) lead += m[3].replace(/\s+/g, '');
      }
    });
    return flat;
  }

  /**
   * One typed word → its steps, one syllable each ("syllable" → "syl-", "la-", "ble").
   * A word the writer already broke with "-" stays as typed.
   */
  function wordSteps(word) {
    if (/-$/.test(word)) return [word];
    const flat = sylPieces(word);
    if (flat.length < 2) return [word];
    return flat.map((s) => (s.end ? s.t : `${s.t}-`));
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

  // ---------- toast ----------
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1900);
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
  }

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
    return `<li class="row" data-go="#/f/${fo.id}"><span class="row-ic">${icon('folder')}</span><div class="row-main"><div class="row-t">${esc(fo.name)}</div><div class="row-s">${plural(n, 'file')}</div></div><button class="icon-btn" data-a="more-folder" data-id="${fo.id}" aria-label="Options for ${esc(fo.name)}">${icon('more')}</button></li>`;
  }
  function projRow(p) {
    const nf = S.files.filter((f) => f.projectId === p.id).length;
    const nd = S.folders.filter((f) => f.projectId === p.id).length;
    return `<li class="row" data-go="#/p/${p.id}"><span class="row-ic">${icon('project')}</span><div class="row-main"><div class="row-t">${esc(p.name)}</div><div class="row-s">${nd ? plural(nd, 'folder') + ' · ' : ''}${plural(nf, 'file')} · ${ago(projTime(p))}</div></div><button class="icon-btn" data-a="more-project" data-id="${p.id}" aria-label="Options for ${esc(p.name)}">${icon('more')}</button></li>`;
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
        { label: 'New file', icon: 'file', onClick: () => newFile(p.id) },
        {
          label: 'Delete project', icon: 'trash', danger: true,
          onClick: async () => {
            const n = S.files.filter((f) => f.projectId === p.id).length;
            if (await confirmBox({ title: 'Delete project?', message: `“${p.name}” and ${plural(n, 'file')} inside it will be permanently deleted, including recordings.`, ok: 'Delete', danger: true })) {
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
        { label: 'New file here', icon: 'file', onClick: () => newFile(fo.projectId, fo.id) },
        {
          label: 'Delete folder', icon: 'trash', danger: true,
          onClick: async () => {
            const n = S.files.filter((f) => f.folderId === fo.id).length;
            if (await confirmBox({ title: 'Delete folder?', message: `“${fo.name}”${n ? ` and ${plural(n, 'file')} inside it` : ''} will be permanently deleted.`, ok: 'Delete', danger: true })) {
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
        { label: 'Copy lyrics', icon: 'copy', onClick: async () => { try { await navigator.clipboard.writeText(f.text); toast('Lyrics copied'); } catch (e) { toast('Clipboard unavailable'); } } },
        { label: 'Export as .txt', icon: 'download', onClick: () => download(`${f.title}.txt`, new Blob([`${f.title}\n\n${f.text}\n`], { type: 'text/plain' })) },
        {
          label: 'Delete file', icon: 'trash', danger: true,
          onClick: async () => {
            if (await confirmBox({ title: 'Delete file?', message: `“${f.title}” and its recordings will be permanently deleted.`, ok: 'Delete', danger: true })) {
              const back = f.folderId ? `#/f/${f.folderId}` : `#/p/${f.projectId}`;
              await deleteFile(f);
              toast('File deleted');
              if (inEditor) go(back, true); else rerender();
            }
          },
        },
      ],
    });
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
  // HOME
  // =====================================================================
  function Home() {
    setTop({ brand: true, right: `<button class="icon-btn" data-a="settings" aria-label="Settings">${icon('gear')}</button>` });
    const projects = [...S.projects].sort((a, b) => projTime(b) - projTime(a));
    const recent = [...S.files].sort(byUpd).slice(0, 4);
    view.innerHTML = `<div class="page no-tabs">
      <label class="search">${icon('search')}<input id="q" type="search" placeholder="Search lyrics" autocomplete="off" aria-label="Search lyrics"></label>
      <div id="results"></div>
      <div id="home-main">
        ${recent.length ? `<div class="sec-h">Recent</div><ul class="list">${recent.map((f) => fileRow(f, { path: true })).join('')}</ul>` : ''}
        <div class="sec-h">Projects <span class="count">${projects.length || ''}</span></div>
        ${projects.length ? `<ul class="list">${projects.map(projRow).join('')}</ul>` : empty('project', 'No projects yet', 'Tap + to start your first project.')}
      </div>
    </div>
    <button class="fab" data-a="add" aria-label="New">${icon('plus')}</button>`;

    const q = $('#q');
    q.addEventListener('input', () => {
      const s = q.value.trim().toLowerCase();
      $('#home-main').hidden = !!s;
      const res = $('#results');
      if (!s) { res.innerHTML = ''; return; }
      const hits = S.files.filter((f) => `${f.title}\n${f.text}`.toLowerCase().includes(s)).sort(byUpd).slice(0, 50);
      res.innerHTML = hits.length
        ? `<div class="sec-h">Results <span class="count">${hits.length}</span></div><ul class="list">${hits.map((f) => fileRow(f, { q: s })).join('')}</ul>`
        : empty('search', 'No matches', 'Try another word or phrase.');
    });

    VA.add = () => sheet({
      title: 'Create',
      items: [
        { label: 'New project', icon: 'project', hint: 'Album, mixtape, EP', onClick: newProject },
        { label: 'Quick file', icon: 'file', hint: 'Goes to Scratchpad', onClick: quickFile },
      ],
    });
  }

  // =====================================================================
  // PROJECT & FOLDER
  // =====================================================================
  function Project(id) {
    const p = proj(id);
    if (!p) return go('#/', true);
    setTop({
      back: '#/', title: p.name, sub: 'Project',
      onTitle: async () => { const v = await ask({ title: 'Rename project', value: p.name }); if (v) { p.name = v; await saveNow('projects', p); rerender(); } },
      right: `<button class="icon-btn" data-a="more-project" data-id="${p.id}" aria-label="Project options">${icon('more')}</button>`,
    });
    const fos = foldersIn(id), fis = filesIn(id, null);
    view.innerHTML = `<div class="page no-tabs">
      ${fos.length ? `<div class="sec-h">Folders <span class="count">${fos.length}</span></div><ul class="list">${fos.map(folderRow).join('')}</ul>` : ''}
      ${fis.length ? `<div class="sec-h">Files <span class="count">${fis.length}</span></div><ul class="list">${fis.map((f) => fileRow(f)).join('')}</ul>` : ''}
      ${!fos.length && !fis.length ? empty('project', 'Empty project', 'Add folders for verses, hooks or tracks — or start writing a file.') : ''}
    </div>
    <button class="fab" data-a="add" aria-label="Add">${icon('plus')}</button>`;
    VA.add = () => sheet({
      title: `Add to ${p.name}`,
      items: [
        { label: 'New file', icon: 'file', onClick: () => newFile(p.id) },
        { label: 'New folder', icon: 'folder', onClick: () => newFolder(p.id) },
      ],
    });
  }

  function Folder(id) {
    const fo = folder(id);
    if (!fo) return go('#/', true);
    const p = proj(fo.projectId);
    setTop({
      back: `#/p/${fo.projectId}`, title: fo.name, sub: p ? p.name : '',
      onTitle: async () => { const v = await ask({ title: 'Rename folder', value: fo.name }); if (v) { fo.name = v; await saveNow('folders', fo); rerender(); } },
      right: `<button class="icon-btn" data-a="more-folder" data-id="${fo.id}" aria-label="Folder options">${icon('more')}</button>`,
    });
    const fis = filesIn(fo.projectId, fo.id);
    view.innerHTML = `<div class="page no-tabs">
      ${fis.length ? `<div class="sec-h">Files <span class="count">${fis.length}</span></div><ul class="list">${fis.map((f) => fileRow(f)).join('')}</ul>` : empty('folder', 'Empty folder', 'Tap + to start a new file.')}
    </div>
    <button class="fab" data-a="add" aria-label="New file">${icon('plus')}</button>`;
    VA.add = () => newFile(fo.projectId, fo.id);
  }

  // =====================================================================
  // EDITOR — one workspace. Every line is a bar you write straight onto its
  // 16-step flow grid, with syllable counts, stresses and rhyme families
  // painted live. The dock underneath holds the beat transport, the recorder,
  // a rhyme/bank strip and slide-up panels — all usable at the same time.
  // =====================================================================
  const PANELS = [['rhymes', 'rhyme', 'Rhymes'], ['beat', 'drum', 'Beat'], ['takes', 'mic', 'Takes'], ['bank', 'bank', 'Bank']];
  const T = { drums: false, click: false }; // audio layers currently wanted
  const sig = () => { const [n, d] = S.settings.timeSig.split('/').map(Number); return { n, spb: d === 8 ? 2 : 4 }; };
  let E = null; // the open editor session

  // iOS keeps fixed elements behind the keyboard — lift the dock above it.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onVV = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
  }
  new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${dock.hidden ? 0 : dock.offsetHeight}px`)).observe(dock);

  const lastWordOf = (s) => { const m = s.match(/[A-Za-z'’]+(?=[^A-Za-z'’]*$)/); return m ? m[0] : ''; };

  /** The word to rhyme with: the word under the cursor mid-line, otherwise the last word of the previous bar. */
  function rhymeTarget(text, pos) {
    const ls = text.lastIndexOf('\n', pos - 1) + 1;
    let le = text.indexOf('\n', pos);
    if (le < 0) le = text.length;
    const line = text.slice(ls, le), col = pos - ls;
    if (line.slice(col).trim()) {
      const L = line.slice(0, col).match(/[A-Za-z'’]*$/)[0];
      const R = line.slice(col).match(/^[A-Za-z'’]*/)[0];
      const w = (L + R).replace(/^['’]+|['’]+$/g, '');
      if (w) return w;
    }
    const before = text.slice(0, ls).split('\n');
    for (let i = before.length - 1; i >= 0; i--) {
      if (isBar(before[i])) { const w = lastWordOf(before[i]); if (w) return w; }
    }
    return lastWordOf(line.slice(0, col).replace(/[A-Za-z'’]+$/, '')) || '';
  }

  const bankHas = (w) => !!S.cur && S.cur.bank.some((x) => x.toLowerCase() === w.toLowerCase());
  function toggleBank(w) {
    const f = S.cur;
    if (!f) return false;
    const i = f.bank.findIndex((x) => x.toLowerCase() === w.toLowerCase());
    if (i >= 0) f.bank.splice(i, 1); else f.bank.push(w);
    saveSoon('files', f);
    toast(i >= 0 ? `Removed “${w}” from bank` : `Saved “${w}” to bank`);
    return i < 0;
  }

  /** Tap / press-and-hold handling for chips carrying data-w. */
  function bindWordChips(root, { onTap, onHold }) {
    let t = 0, fired = false;
    root.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('[data-w]');
      if (!c || !onHold) return;
      fired = false;
      t = setTimeout(() => { fired = true; onHold(c); if (navigator.vibrate) navigator.vibrate(12); }, 450);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, () => clearTimeout(t)));
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-w]')) e.preventDefault(); });
    root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-w]');
      if (!c) return;
      if (fired) { fired = false; return; }
      onTap(c);
    });
  }

  function Editor(id) {
    const f = file(id);
    if (!f) return go('#/', true);
    S.cur = f;
    T.drums = T.click = false;
    if (!PANELS.some(([k]) => k === S.panel)) S.panel = null;
    const back = f.folderId && folder(f.folderId) ? `#/f/${f.folderId}` : `#/p/${f.projectId}`;
    setTop({
      back, title: f.title, sub: pathOf(f), onTitle: () => renameFile(f),
      right: `<button class="metro-btn" data-a="metro" aria-label="Metronome and tempo"><span class="mdot"></span><span data-bpm>${f.bpm}</span></button><button class="icon-btn" data-a="fmenu" aria-label="File options">${icon('more')}</button>`,
    });
    VA.fmenu = () => fileMenu(f, true);

    view.innerHTML = `<div class="page ws">
      <div class="write-meta">
        <span class="stat" id="stat"></span>
        <button class="chip sm" data-a="fdef" aria-label="Song beat">${icon('drum', 'sm')}<span id="songbeat">${esc(patName(f.beat.def))}</span></button>
      </div>
      <div class="gsheet" id="gsheet">
        <div class="lines" id="lines"></div>
        <input id="cin" class="cin" hidden autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" aria-label="Lyric for this step">
        <span class="cmeasure" id="cmeasure" aria-hidden="true"></span>
      </div>
      <div class="sheet-add"><button class="btn" data-a="add-bar">${icon('plus', 'sm')}Bar</button><button class="btn" data-a="add-sec">${icon('plus', 'sm')}Section</button></div>
      <p class="hint">Tap a step and type. <b>Space</b> moves to the next step, leave steps empty for rests, end a syllable with <b>-</b> to carry the word on (ci- ty), <b>Enter</b> starts the next bar.</p>
      <div class="legend"><span><b>CAPS</b> = stressed</span><span>Grey = unstressed</span><span>Underline = rhyme family</span><span><i class="lg k"></i>kick <i class="lg s"></i>snare <i class="lg h"></i>hat</span></div>
    </div>`;
    dock.hidden = false;
    dock.innerHTML = `<div class="panel" id="panel" hidden></div>
      <div class="strip" id="strip"></div>
      <div class="dockbar">
        <button class="dk dk-play" id="dplay" data-a="dplay"><span class="dk-ic">${icon('play')}</span><span class="dk-l">Play</span></button>
        <button class="dk dk-rec" id="drec" data-a="drec" aria-label="Start recording"><span class="dk-ic"><i></i></span><span class="dk-l" id="rlabel">Rec</span></button>
        ${PANELS.map(([k, ic, l]) => `<button class="dk dk-p ${S.panel === k ? 'on' : ''}" data-a="panel" data-v="${k}" aria-pressed="${S.panel === k}"><span class="dk-ic">${icon(ic)}</span><span class="dk-l">${l}</span></button>`).join('')}
      </div>`;

    const box = $('#lines'), gs = $('#gsheet'), inp = $('#cin'), meas = $('#cmeasure'), panel = $('#panel'), stripEl = $('#strip');
    const rows = f.sheet;
    if (!rows.length) rows.push(newBarRow());
    let cur = S.cell[f.id] && rows[S.cell[f.id].r] && rows[S.cell[f.id].r].type === 'bar' ? { ...S.cell[f.id] } : null;
    let nowLine = -1, nowCell = null, nowStep = -1;

    // ---------------- the flow sheet: write straight into the steps ----------------
    const blkEl = (r) => box.querySelector(`.blk[data-r="${r}"]`);
    const cellEl = (r, k) => box.querySelector(`.cell[data-r="${r}"][data-k="${k}"]`);
    const isBarRow = (r) => !!rows[r] && rows[r].type === 'bar';
    const lastFilled = (r) => { for (let k = 15; k >= 0; k--) if (rows[r].cells[k].trim()) return k; return -1; };
    const nextBarRow = (r) => { for (let i = r + 1; i < rows.length; i++) if (isBarRow(i)) return i; return -1; };
    const prevBarRow = (r) => { for (let i = r - 1; i >= 0; i--) if (isBarRow(i)) return i; return -1; };

    /** rows → f.text (for counts, rhymes, search, export) and per-bar beat placements. */
    function sync() {
      const bars = {};
      f.text = rows.map((row, i) => {
        if (row.type === 'bar') { if (row.pat) bars[i] = row.pat; return barView(row.cells).text; }
        return row.type === 'label' ? `[${row.text}]` : '';
      }).join('\n');
      f.beat.bars = bars;
      saveSoon('files', f);
    }

    function rhymeColors(lines) {
      const ends = lines.map((l) => { if (!isBar(l)) return null; const w = lastWordOf(l); return w ? syl.rhymeKey(w) : null; });
      const cnt = {};
      ends.forEach((k) => { if (k) cnt[k] = (cnt[k] || 0) + 1; });
      const color = {};
      let c = 0;
      ends.forEach((k) => { if (k && cnt[k] > 1 && color[k] == null) color[k] = c++ % 6; });
      return color;
    }
    function lineHTML(l, color) {
      return syl.analyzeLine(l).tokens.map((t) => {
        if (!t.word) return esc(t.text);
        if (t.syls[0] && t.syls[0].num) return `<span class="s1">${esc(t.text)}</span>`;
        const k = syl.rhymeKey(t.text);
        const r = k && color[k] != null ? ` data-r="${color[k]}"` : '';
        return `<span class="w"${r}>${t.syls.map((s) => `<span class="s${s.s}">${esc(s.t)}</span>`).join('')}</span>`;
      }).join('');
    }

    function paintAll() {
      const views = rows.map((r) => (r.type === 'bar' ? barView(r.cells) : null));
      const color = rhymeColors(f.text.split('\n'));
      let n = 0, total = 0;
      box.innerHTML = rows.map((row, i) => {
        if (row.type === 'blank') return `<div class="blk blank" data-r="${i}"></div>`;
        if (row.type === 'label') return `<button class="blk label" data-a="label" data-r="${i}">${esc(row.text)}</button>`;
        n++;
        const v = views[i], steps = barSteps(f, i);
        const has = (k, ...ts) => steps && ts.some((t) => steps[t] && steps[t][k]);
        const cnt = syl.lineCount(v.text);
        total += cnt;
        return `<div class="blk bar${i === nowLine ? ' now' : ''}${cur && cur.r === i ? ' cur' : ''}" data-r="${i}">
          <div class="bh"><span class="bar-n">${n}</span><button class="pat-btn ${row.pat ? 'set' : ''}" data-a="bar-pat" data-r="${i}" data-n="${n}">${esc(row.pat ? patName(row.pat) : patName(f.beat.def))}</button><span class="grow"></span><span class="cnt">${cnt} syl</span><button class="icon-btn bm" data-a="bar-menu" data-r="${i}" data-n="${n}" aria-label="Bar ${n} options">${icon('more')}</button></div>
          <div class="bline" data-a="bar-go" data-r="${i}">${v.text ? lineHTML(v.text, color) : '<span class="ph-t2">Tap a step to write</span>'}</div>
          <div class="bgrid">${range(16).map((k) => {
            const raw = (row.cells[k] || '').trim();
            const cont = /\S-$/.test(raw);
            return `<div class="cell ${k % 4 === 0 ? 'b' : ''}${cur && cur.r === i && cur.k === k ? ' act' : ''}${i === nowLine && k === nowStep ? ' now' : ''}" data-a="cell" data-r="${i}" data-k="${k}"><span class="dr">${has(k, 'kick') ? '<i class="k"></i>' : ''}${has(k, 'snare', 'clap') ? '<i class="s"></i>' : ''}${has(k, 'hat', 'open') ? '<i class="h"></i>' : ''}</span><span class="ct ${v.cls[k]}">${esc(cont ? raw.slice(0, -1) : raw)}${cont ? '<i class="hy">-</i>' : ''}</span></div>`;
          }).join('')}</div>
        </div>`;
      }).join('');
      $('#stat').textContent = n ? `${plural(n, 'bar')} · ${total} syl · avg ${Math.round(total / n)}` : 'Add a bar to start';
      nowCell = null;
      fitSteps();
      placeInput();
    }

    /** Shrink step text that doesn't fit its cell (CAPS syllables on narrow phones). Reads first, then writes. */
    function fitSteps() {
      const cts = $$('.ct', box).filter((c) => c.textContent);
      cts.forEach((c) => { c.style.fontSize = ''; });
      const base = cts.length ? parseFloat(getComputedStyle(cts[0]).fontSize) : 12;
      cts.map((c) => [c, c.clientWidth / c.scrollWidth])
        .filter(([, r]) => r < 1)
        .forEach(([c, r]) => { c.style.fontSize = `${Math.max(8, Math.floor(base * r * 10) / 10)}px`; });
    }
    const commit = () => { sync(); paintAll(); queueStrip(); };

    /** Float the single step input over the active cell (so the keyboard never drops between steps). */
    function placeInput() {
      if (!cur || inp.hidden) return;
      const c = cellEl(cur.r, cur.k);
      if (!c) { inp.hidden = true; return; }
      const gr = gs.getBoundingClientRect(), cr = c.getBoundingClientRect();
      meas.textContent = inp.value || 'M';
      const w = Math.min(gr.width, Math.max(cr.width, meas.offsetWidth + 20));
      const left = Math.min(cr.left - gr.left, gr.width - w);
      inp.style.cssText = `left:${left}px;top:${cr.top - gr.top}px;width:${w}px;height:${cr.height}px`;
    }

    function activate(r, k, { focus = true, select = false } = {}) {
      if (!isBarRow(r)) return;
      cur = { r, k: clamp(k, 0, 15) };
      S.cell[f.id] = cur;
      $$('.cell.act', box).forEach((c) => c.classList.remove('act'));
      $$('.blk.cur', box).forEach((b) => b.classList.remove('cur'));
      const c = cellEl(cur.r, cur.k);
      if (c) c.classList.add('act');
      const b = blkEl(cur.r);
      if (b) b.classList.add('cur');
      inp.value = rows[r].cells[cur.k] || '';
      inp.hidden = !focus;
      placeInput();
      if (focus) {
        inp.focus({ preventScroll: true });
        if (select) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
      }
      ensureVisible();
      queueStrip();
    }

    /** Keep the active bar between the top bar and the dock. */
    function ensureVisible() {
      const b = cur && blkEl(cur.r);
      if (!b) return;
      const br = b.getBoundingClientRect();
      const bottom = dock.getBoundingClientRect().top - 10;
      const top = topbar.getBoundingClientRect().bottom + 8;
      if (br.bottom > bottom) window.scrollBy(0, Math.min(br.bottom - bottom, br.top - top));
      else if (br.top < top) window.scrollBy(0, br.top - top);
    }

    function insertBar(at) {
      rows.splice(at, 0, newBarRow());
      if (nowLine >= at) nowLine++;
      commit();
      return at;
    }
    function nextBar() {
      const r = isBarRow(cur.r + 1) ? cur.r + 1 : insertBar(cur.r + 1);
      activate(r, 0);
    }
    function step(d) {
      const k = cur.k + d;
      if (k > 15) return nextBar();
      if (k < 0) { const p = prevBarRow(cur.r); if (p >= 0) activate(p, 15); return; }
      activate(cur.r, k);
    }
    function vert(d) {
      const r = d > 0 ? nextBarRow(cur.r) : prevBarRow(cur.r);
      if (r >= 0) activate(r, cur.k);
    }
    /** Backspace on an empty step: go back a step; on an empty bar's first step, remove the bar. */
    function stepBack() {
      if (cur.k > 0) return activate(cur.r, cur.k - 1);
      const p = prevBarRow(cur.r);
      if (p < 0) return;
      if (lastFilled(cur.r) < 0 && rows.filter((x) => x.type === 'bar').length > 1) {
        rows.splice(cur.r, 1);
        cur = null;
        commit();
      }
      const lf = lastFilled(p);
      activate(p, lf < 0 ? 0 : lf);
    }

    /**
     * Write words from step k on: each word starts a step and its syllables flow into the
     * following steps — only empty ones, so nothing already written is overwritten.
     * Returns the last step used.
     */
    function placeWords(row, k, words) {
      words.forEach((w, idx) => {
        if (idx > 0) k++;
        if (k > 15) { k = 15; row.cells[15] = `${row.cells[15]} ${w}`.trim(); return; }
        const segs = wordSteps(w);
        let j = 0;
        while (j < segs.length - 1 && k < 15 && !(row.cells[k + 1] || '').trim()) {
          row.cells[k] = segs[j++];
          k++;
        }
        row.cells[k] = segs.slice(j).join(' ').replace(/(\S)- /g, '$1'); // no room left: rest stays together
      });
      return k;
    }

    inp.addEventListener('input', () => {
      if (!cur) return;
      const row = rows[cur.r];
      const v = inp.value;
      if (/\s/.test(v)) {
        // Space (or pasted words): each word takes the next step, split into syllables.
        const parts = v.split(/\s+/).filter(Boolean);
        let k = cur.k;
        if (!parts.length) { row.cells[k] = ''; commit(); return step(1); }
        k = placeWords(row, k, parts);
        commit();
        cur.k = k;
        if (/\s$/.test(v)) step(1); else activate(cur.r, k);
        return;
      }
      if (v === '-') { inp.value = ''; return; }
      row.cells[cur.k] = v;
      commit();
      if (v.length > 1 && v.endsWith('-')) step(1); // syllable continues on the next step
    });
    /** Enter ends the line: split the word in the current step across the steps after it first. */
    function endLine() {
      const row = rows[cur.r], v = (row.cells[cur.k] || '').trim();
      if (v && !/\s/.test(v) && wordSteps(v).length > 1) { placeWords(row, cur.k, [v]); commit(); }
      nextBar();
    }

    inp.addEventListener('keydown', (e) => {
      if (!cur) return;
      const s = inp.selectionStart, en = inp.selectionEnd;
      if (e.key === 'Enter') { e.preventDefault(); endLine(); }
      else if (e.key === 'Backspace' && !inp.value) { e.preventDefault(); stepBack(); }
      else if (e.key === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'ArrowRight' && s === inp.value.length) { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' && s === 0 && en === 0) { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); vert(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); vert(-1); }
      else if (e.key === 'Escape') inp.blur();
    });
    // Mobile keyboards don't always send keydown — handle Backspace/Enter here too.
    inp.addEventListener('beforeinput', (e) => {
      if (!cur) return;
      if (e.inputType === 'deleteContentBackward' && !inp.value) { e.preventDefault(); stepBack(); }
      else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); endLine(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) inp.hidden = true; }, 0));

    VA.cell = (el) => activate(+el.dataset.r, +el.dataset.k, { select: true }); // typing replaces the step
    VA['bar-go'] = (el) => { const r = +el.dataset.r; activate(r, Math.min(15, lastFilled(r) + 1)); };
    VA['add-bar'] = () => activate(insertBar(rows.length), 0);
    VA['add-sec'] = async () => {
      const name = await ask({ title: 'New section', placeholder: 'Verse 2, Hook, Bridge…', ok: 'Add' });
      if (!name) return;
      if (rows.length && rows[rows.length - 1].type !== 'blank') rows.push({ type: 'blank' });
      rows.push({ type: 'label', text: name }, newBarRow());
      commit();
      activate(rows.length - 1, 0);
    };
    VA.label = (el) => {
      const r = +el.dataset.r;
      sheet({
        title: rows[r].text,
        items: [
          { label: 'Rename section', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename section', value: rows[r].text }); if (v) { rows[r].text = v; commit(); } } },
          { label: 'Remove label', icon: 'trash', danger: true, onClick: () => { rows.splice(r, 1); if (cur && cur.r > r) cur.r--; commit(); } },
        ],
      });
    };
    VA['bar-menu'] = (el) => {
      const r = +el.dataset.r;
      const row = rows[r];
      const text = barView(row.cells).text;
      const reflow = (mode) => { row.cells = spreadCells(text, mode); commit(); };
      sheet({
        title: `Bar ${el.dataset.n}`,
        items: [
          { label: 'Spread syllables evenly', icon: 'flow', onClick: () => reflow('even') },
          { label: 'One syllable per step', icon: 'drum', hint: 'Fast 16th-note flow', onClick: () => reflow('pack') },
          { label: 'Insert bar above', icon: 'plus', onClick: () => { if (cur && cur.r >= r) cur.r++; insertBar(r); activate(r, 0); } },
          { label: 'Insert bar below', icon: 'plus', onClick: () => { if (cur && cur.r > r) cur.r++; insertBar(r + 1); activate(r + 1, 0); } },
          { label: 'Clear bar', icon: 'x', onClick: () => { row.cells = newBarRow().cells; commit(); } },
          {
            label: 'Delete bar', icon: 'trash', danger: true,
            onClick: () => {
              if (rows.filter((x) => x.type === 'bar').length <= 1) { row.cells = newBarRow().cells; commit(); return; }
              rows.splice(r, 1);
              if (cur && cur.r === r) cur = null; else if (cur && cur.r > r) cur.r--;
              commit();
            },
          },
        ],
      });
    };

    let lastW = 0;
    const ro = new ResizeObserver(() => { const w = box.clientWidth; if (w !== lastW) { lastW = w; fitSteps(); placeInput(); } });
    ro.observe(box);

    /** Drop a word from the strip, rhymes or bank onto the active step, then move on. */
    function insertWord(w) {
      if (!cur) { const r = rows.findIndex((x) => x.type === 'bar'); if (r < 0) return; cur = { r, k: Math.min(15, lastFilled(r) + 1) }; }
      const row = rows[cur.r];
      let k = cur.k;
      const ex = (row.cells[k] || '').trim().replace(/-$/, '');
      const fits = !ex || w.toLowerCase().startsWith(ex.toLowerCase());
      if (!fits) { let j = k + 1; while (j < 16 && row.cells[j].trim()) j++; k = Math.min(j, 15); }
      if (fits || !row.cells[k].trim()) { row.cells[k] = ''; k = placeWords(row, k, [w]); }
      else row.cells[k] = `${row.cells[k].trim()} ${w}`;
      commit();
      activate(cur.r, Math.min(15, k + 1), { focus: document.activeElement === inp });
    }

    // ---------------- beat placement ----------------
    function beatChanged() {
      paintAll();
      $('#songbeat').textContent = patName(f.beat.def);
      if (S.panel === 'beat') PBeat();
    }
    VA.fdef = () => sheet({
      title: 'Song beat',
      items: patternsSorted().map((p) => ({ label: p.name, icon: 'drum', on: p.id === f.beat.def, onClick: () => { f.beat.def = p.id; sync(); beatChanged(); } })),
    });
    VA['bar-pat'] = (el) => {
      const i = +el.dataset.r;
      const cur0 = rows[i].pat || null;
      const opts = [{ id: null, label: `Song beat · ${patName(f.beat.def)}` }, ...patternsSorted().map((p) => ({ id: p.id, label: p.name })), { id: 'rest', label: 'Rest — no drums' }];
      const sh = sheet({
        title: `Bar ${el.dataset.n}`,
        html: `<label class="set-row"><div><div class="lbl">Whole section</div><div class="sub">Apply to every bar until the next blank line or label</div></div><input type="checkbox" class="switch" id="whole"></label>
          ${opts.map((o) => `<button class="menu-i ${o.id === cur0 ? 'on' : ''}" data-id="${o.id ?? ''}">${icon(o.id === 'rest' ? 'minus' : 'drum')}<span>${esc(o.label)}</span>${o.id === cur0 ? icon('check', 'chk') : ''}</button>`).join('')}`,
      });
      sh.el.addEventListener('click', (e) => {
        const b = e.target.closest('.menu-i');
        if (!b) return;
        const id = b.dataset.id || null;
        let a = i, z = i;
        if ($('#whole', sh.el).checked) { while (isBarRow(a - 1)) a--; while (isBarRow(z + 1)) z++; }
        for (let t = a; t <= z; t++) rows[t].pat = id;
        sh.close();
        commit();
      });
    };

    // ---------------- rhyme / bank strip ----------------
    let stripMode = S.stripMode || 'rhymes', stripWord = null, stripReq = 0, stripT = 0;
    const forcedMode = () => (S.panel === 'rhymes' ? 'bank' : S.panel === 'bank' ? 'rhymes' : null);
    const target = () => {
      if (!cur || !isBarRow(cur.r)) return '';
      const start = f.text.split('\n').slice(0, cur.r).reduce((n, l) => n + l.length + 1, 0);
      const upto = barView(rows[cur.r].cells.map((c, k) => (k <= cur.k ? c : ''))).text;
      return rhymeTarget(f.text, start + upto.length);
    };
    const queueStrip = () => { clearTimeout(stripT); stripT = setTimeout(updateStrip, 200); };

    async function updateStrip(force) {
      const mode = forcedMode() || stripMode;
      const w = target();
      followRhymes(w);
      const modeBtn = `<button class="strip-mode" data-a="strip-mode" ${forcedMode() ? 'disabled' : ''} aria-label="Switch between rhymes and word bank">${icon(mode === 'bank' ? 'bank' : 'rhyme')}${mode === 'bank' ? 'Bank' : 'Rhymes'}</button>`;
      if (mode === 'bank') {
        stripWord = null;
        stripEl.innerHTML = modeBtn + (f.bank.length
          ? f.bank.map((b) => `<button class="chip sm" data-a="ins" data-w="${esc(b)}">${esc(b)}<sup>${syl.count(b)}</sup></button>`).join('')
          : '<span class="hint-t">Save words to your bank to keep them here</span>');
        return;
      }
      if (!force && w.toLowerCase() === stripWord) return;
      stripWord = w.toLowerCase();
      if (!w) { stripEl.innerHTML = `${modeBtn}<span class="hint-t">Rhymes show up here as you write</span>`; return; }
      const head = `${modeBtn}<button class="strip-mode" data-a="rhymes-open" aria-label="More rhymes for ${esc(w)}"><small>for</small>${esc(w)}</button>`;
      const my = ++stripReq;
      stripEl.innerHTML = `${head}<span class="hint-t">…</span>`;
      const r = await words.rhymes(w, 'perfect');
      if (my !== stripReq || E === null) return;
      const list = r.list.filter((x) => !x.word.includes(' ')).slice(0, 40);
      stripEl.innerHTML = head + (list.length
        ? list.map((x) => `<button class="chip sm" data-a="ins" data-w="${esc(x.word)}">${esc(x.word)}<sup>${x.n}</sup></button>`).join('')
        : '<span class="hint-t">No perfect rhymes — tap the word for near rhymes</span>');
      stripEl.scrollLeft = 0;
    }
    VA['strip-mode'] = () => { stripMode = S.stripMode = stripMode === 'rhymes' ? 'bank' : 'rhymes'; updateStrip(true); };
    VA['rhymes-open'] = () => { rhy.q = stripWord || ''; rhy.follow = true; if (S.panel !== 'rhymes') togglePanel('rhymes'); else PRhymes(); };
    VA.ins = (el) => insertWord(el.dataset.w);
    // keep the line focused (keyboard up) when tapping dock buttons
    dock.addEventListener('mousedown', (e) => { if (e.target.closest('.strip button, .dockbar button') && document.activeElement === inp) e.preventDefault(); });

    // ---------------- panels ----------------
    const closeBtn = `<button class="icon-btn muted" data-a="pclose" aria-label="Close panel">${icon('x')}</button>`;
    function togglePanel(k) {
      S.panel = S.panel === k ? null : k;
      $$('.dk-p', dock).forEach((b) => { const on = b.dataset.v === S.panel; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      renderPanel();
      updateStrip(true);
      setTimeout(ensureVisible, 30);
    }
    function renderPanel() {
      panel.hidden = !S.panel;
      panel.scrollTop = 0;
      if (!S.panel) { panel.innerHTML = ''; return; }
      ({ rhymes: PRhymes, beat: PBeat, takes: PTakes, bank: PBank })[S.panel]();
    }
    VA.panel = (el) => togglePanel(el.dataset.v);
    VA.pclose = () => togglePanel(S.panel);

    // ----- Rhymes panel: follows the line you're writing unless you search -----
    const rhy = { q: '', kind: 'perfect', follow: true, req: 0 };
    function PRhymes() {
      if (rhy.follow && !rhy.q) rhy.q = target();
      panel.innerHTML = `<div class="ph"><form class="search sm grow" id="rf">${icon('search', 'sm')}<input id="rq" value="${esc(rhy.q)}" placeholder="Rhymes for…" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Word to rhyme"></form>${closeBtn}</div>
        <div class="seg wide" id="rk">${[['perfect', 'Perfect'], ['near', 'Near'], ['sound', 'Sounds like']].map(([k, l]) => `<button type="button" data-k="${k}" class="${rhy.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div id="rres"></div>`;
      const rq = $('#rq');
      let t = 0;
      rq.addEventListener('input', () => { rhy.q = rq.value.trim(); rhy.follow = !rhy.q; clearTimeout(t); t = setTimeout(runRhymes, 350); });
      $('#rf').addEventListener('submit', (e) => { e.preventDefault(); rq.blur(); runRhymes(); });
      $('#rk').addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        rhy.kind = b.dataset.k;
        $$('#rk button').forEach((x) => x.classList.toggle('on', x === b));
        runRhymes();
      });
      bindWordChips($('#rres'), {
        onTap: (c) => insertWord(c.dataset.w),
        onHold: (c) => { c.classList.toggle('pinned', toggleBank(c.dataset.w)); updateStrip(true); },
      });
      runRhymes();
    }
    function followRhymes(w) {
      if (S.panel !== 'rhymes' || !rhy.follow || !w || w.toLowerCase() === rhy.q.toLowerCase()) return;
      rhy.q = w;
      const rq = $('#rq');
      if (rq && document.activeElement !== rq) rq.value = w;
      runRhymes();
    }
    async function runRhymes() {
      if (!$('#rres')) return;
      const w = rhy.q;
      if (!w) { $('#rres').innerHTML = '<div class="loading">Write a line, or type a word above.</div>'; return; }
      const my = ++rhy.req;
      $('#rres').innerHTML = '<div class="loading">Finding rhymes…</div>';
      const r = await words.rhymes(w, rhy.kind);
      const res = $('#rres');
      if (my !== rhy.req || !res) return;
      if (!r.list.length) { res.innerHTML = `<div class="loading">Nothing found for “${esc(w)}”.${rhy.kind === 'perfect' ? ' Try Near.' : ''}</div>`; return; }
      const by = {};
      r.list.forEach((x) => { (by[x.n] = by[x.n] || []).push(x); });
      res.innerHTML = Object.keys(by).sort((a, b) => a - b).map((n) =>
        `<div class="grp"><div class="grp-h">${plural(+n, 'syllable')}</div><div class="chips">${by[n].map((x) => `<button class="chip sm ${bankHas(x.word) ? 'pinned' : ''}" data-w="${esc(x.word)}">${esc(x.word)}</button>`).join('')}</div></div>`).join('')
        + `<p class="src">Tap to insert · hold to save to your bank${r.source === 'offline' ? ' · offline suggestions' : ''}</p>`;
    }

    // ----- Beat panel: the song beat's step sequencer -----
    const songPat = () => pattern(f.beat.def) || patternsSorted()[0];
    function PBeat() {
      const pat = songPat();
      panel.innerHTML = `<div class="ph"><div class="chips scroll grow">${patternsSorted().map((p) => `<button class="chip sm ${p.id === pat.id ? 'on' : ''}" data-a="bpick" data-id="${p.id}">${esc(p.name)}</button>`).join('')}<button class="chip sm ghost" data-a="bnew">${icon('plus', 'sm')}New</button></div><button class="icon-btn muted" data-a="bmore" aria-label="Pattern options">${icon('more')}</button>${closeBtn}</div>
        <div class="seq" id="seq">${[0, 1].map((h) => `<div class="half">${TRACKS.map((t) => `<div class="trk"><span class="tl">${t.name}</span>${range(8).map((j) => { const k = h * 8 + j; const on = !!pat.steps[t.id][k]; return `<button class="st ${on ? 'on' : ''} ${k % 4 === 0 ? 'b' : ''}" data-a="step" data-t="${t.id}" data-k="${k}" aria-label="${t.name} step ${k + 1}" aria-pressed="${on}"></button>`; }).join('')}</div>`).join('')}</div>`).join('')}</div>
        <div class="beat-ctl">${bpmCtl(f.bpm)}
          <label class="mini"><span>Swing</span><input type="range" class="range" id="swing" min="0" max="40" value="${Math.round(f.swing * 100)}"></label>
          <label class="mini"><span>Click</span><input type="checkbox" class="switch" id="bclick" ${T.click ? 'checked' : ''}></label>
        </div>
        <p class="hint">The highlighted pattern is the song beat${pat.bpm ? ` (sits around ${pat.bpm} BPM)` : ''}. Tap a bar's beat label on the sheet to give it its own pattern.</p>`;
      $('#swing').addEventListener('input', (e) => { f.swing = e.target.value / 100; if (T.drums) audio.update({ swing: f.swing }); saveSoon('files', f); });
      $('#bclick').addEventListener('change', (e) => { T.click = e.target.checked; syncTransport(); });
    }
    VA.step = (el) => {
      const pat = songPat();
      const t = el.dataset.t, k = +el.dataset.k;
      const on = pat.steps[t][k] ? 0 : 1;
      pat.steps[t][k] = on;
      el.classList.toggle('on', !!on);
      el.setAttribute('aria-pressed', String(!!on));
      saveSoon('patterns', pat);
      if (on && !T.drums) audio.hit(t);
      paintAll();
    };
    VA.bpick = (el) => { f.beat.def = el.dataset.id; saveSoon('files', f); beatChanged(); };
    VA.bnew = async () => {
      const name = await ask({ title: 'New pattern', placeholder: 'Pattern name', ok: 'Create' });
      if (!name) return;
      const p = { id: FP.uid(), name, order: 50, created: Date.now(), steps: Object.fromEntries(TRACKS.map((t) => [t.id, new Array(16).fill(0)])) };
      S.patterns.push(p);
      await saveNow('patterns', p);
      f.beat.def = p.id;
      saveSoon('files', f);
      beatChanged();
    };
    VA.bmore = () => {
      const pat = songPat();
      sheet({
        title: pat.name,
        items: [
          { label: 'Rename', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename pattern', value: pat.name }); if (v) { pat.name = v; await saveNow('patterns', pat); beatChanged(); } } },
          { label: 'Duplicate', icon: 'copy', onClick: async () => { const p = JSON.parse(JSON.stringify({ ...pat, id: FP.uid(), name: `${pat.name} copy`, order: 50, created: Date.now() })); S.patterns.push(p); await saveNow('patterns', p); f.beat.def = p.id; saveSoon('files', f); beatChanged(); } },
          { label: 'Clear all steps', icon: 'x', onClick: () => { TRACKS.forEach((t) => pat.steps[t.id].fill(0)); saveSoon('patterns', pat); beatChanged(); } },
          {
            label: 'Delete pattern', icon: 'trash', danger: true,
            onClick: async () => {
              if (S.patterns.length <= 1) { toast('Keep at least one pattern'); return; }
              if (!(await confirmBox({ title: 'Delete pattern?', message: `“${pat.name}” will be removed from every song that uses it.`, ok: 'Delete', danger: true }))) return;
              S.patterns = S.patterns.filter((p) => p !== pat);
              await db.del('patterns', pat.id);
              const fallback = patternsSorted()[0].id;
              for (const x of S.files) {
                let changed = false;
                if (x.beat.def === pat.id) { x.beat.def = fallback; changed = true; }
                for (const k of Object.keys(x.beat.bars)) if (x.beat.bars[k] === pat.id) { delete x.beat.bars[k]; changed = true; }
                if (changed) saveSoon('files', x);
              }
              beatChanged();
            },
          },
        ],
      });
    };

    // ----- Takes panel + recorder -----
    let recOn = false, autoDrums = false, takes = [], playingId = null;
    const player = new Audio();
    const urls = new Map();
    const urlOf = (t) => { if (!urls.has(t.id)) urls.set(t.id, URL.createObjectURL(t.blob)); return urls.get(t.id); };

    function PTakes() {
      panel.innerHTML = `<div class="ph"><span class="ph-t">Takes</span><span class="count" id="tc"></span><span class="grow"></span><button class="chip sm ${S.settings.recBeat ? 'on' : ''}" data-a="ropt">${icon('drum', 'sm')}Beat on rec</button>${closeBtn}</div>
        <ul class="list" id="takes"></ul>
        <p class="hint">${rec.supported() ? 'Hit Rec in the dock — the beat starts with you and follows the patterns placed on your bars. Headphones keep it out of your vocal.' : 'Recording needs microphone access, which browsers only allow over HTTPS or on localhost.'}</p>`;
      loadTakes();
    }
    async function loadTakes() {
      takes = (await db.byIndex('recordings', 'fileId', f.id)).sort((a, b) => b.created - a.created);
      const ul = $('#takes');
      if (!ul) return;
      $('#tc').textContent = takes.length || '';
      ul.innerHTML = takes.length
        ? takes.map((t) => `<li class="take" data-id="${t.id}"><button class="play" data-a="tplay" data-id="${t.id}" aria-label="Play ${esc(t.name)}">${icon(playingId === t.id ? 'pause' : 'play')}</button><div class="row-main"><div class="row-t">${esc(t.name)}</div><div class="take-bar"><div></div></div><div class="row-s">${fmtDur(t.duration)} · ${ago(t.created)}</div></div><button class="icon-btn muted" data-a="tmore" data-id="${t.id}" aria-label="Options for ${esc(t.name)}">${icon('more')}</button></li>`).join('')
        : '<li class="muted sm" style="padding:10px 0">No takes yet.</li>';
    }
    VA.ropt = (el) => { S.settings.recBeat = !S.settings.recBeat; el.classList.toggle('on', S.settings.recBeat); saveSettings(); };

    function setRecUI(on) {
      const b = $('#drec');
      if (!b) return;
      b.classList.toggle('on', on);
      b.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
      $('#rlabel').textContent = on ? '0:00' : 'Rec';
      b.querySelector('i').style.transform = '';
    }
    async function finishRec() {
      if (!recOn) return;
      recOn = false;
      if (autoDrums) { autoDrums = false; T.drums = false; syncTransport(true); }
      const r = await rec.stop();
      setRecUI(false);
      if (r && r.duration > 0.5) {
        const all = await db.byIndex('recordings', 'fileId', f.id);
        await db.put('recordings', { id: FP.uid(), fileId: f.id, name: `Take ${all.length + 1}`, blob: r.blob, mime: r.mime, duration: r.duration, created: Date.now() });
        if (S.panel === 'takes') loadTakes();
        toast(S.panel === 'takes' ? 'Take saved' : 'Take saved — find it in Takes');
      }
    }
    VA.drec = async () => {
      if (recOn) return finishRec();
      if (!rec.supported()) { toast('Recording needs HTTPS or localhost'); return; }
      stopPlayer();
      try {
        await rec.start((lvl, t) => {
          const b = $('#drec');
          if (!b) return;
          $('#rlabel').textContent = fmtDur(t);
          b.querySelector('i').style.transform = `scale(${1 + Math.min(0.7, lvl * 5)})`;
        });
      } catch (e) {
        toast('Microphone blocked — allow access to record');
        return;
      }
      recOn = true;
      setRecUI(true);
      if (S.settings.recBeat && !T.drums) { T.drums = true; autoDrums = true; syncTransport(true); }
    };

    function stopPlayer() {
      player.pause();
      if (playingId) { const b = $(`[data-a="tplay"][data-id="${playingId}"]`); if (b) b.innerHTML = icon('play'); }
      playingId = null;
    }
    player.addEventListener('timeupdate', () => {
      const t = takes.find((x) => x.id === playingId);
      const bar = t && $(`.take[data-id="${t.id}"] .take-bar div`);
      if (bar) bar.style.width = `${Math.min(100, (player.currentTime / (t.duration || 1)) * 100)}%`;
    });
    player.addEventListener('ended', () => {
      const bar = playingId && $(`.take[data-id="${playingId}"] .take-bar div`);
      if (bar) bar.style.width = '0';
      stopPlayer();
    });
    VA.tplay = (el) => {
      const t = takes.find((x) => x.id === el.dataset.id);
      if (!t) return;
      if (playingId === t.id) { stopPlayer(); return; }
      stopPlayer();
      player.src = urlOf(t);
      player.play().then(() => { playingId = t.id; el.innerHTML = icon('pause'); }).catch(() => toast('This take can’t play in this browser'));
    };
    VA.tmore = (el) => {
      const t = takes.find((x) => x.id === el.dataset.id);
      if (!t) return;
      const ext = /mp4|m4a|aac/.test(t.mime) ? 'm4a' : /ogg/.test(t.mime) ? 'ogg' : 'webm';
      const name = `${f.title} - ${t.name}.${ext}`;
      const items = [
        { label: 'Rename', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename take', value: t.name }); if (v) { t.name = v; await db.put('recordings', t); loadTakes(); } } },
        { label: 'Download', icon: 'download', onClick: () => download(name, t.blob) },
      ];
      const shareFile = window.File && new File([t.blob], name, { type: t.mime });
      if (navigator.canShare && shareFile && navigator.canShare({ files: [shareFile] })) {
        items.push({ label: 'Share', icon: 'share', onClick: () => navigator.share({ files: [shareFile], title: name }).catch(() => {}) });
      }
      items.push({
        label: 'Delete take', icon: 'trash', danger: true,
        onClick: async () => {
          if (!(await confirmBox({ title: 'Delete take?', message: `“${t.name}” will be permanently deleted.`, ok: 'Delete', danger: true }))) return;
          if (playingId === t.id) stopPlayer();
          await db.del('recordings', t.id);
          loadTakes();
        },
      });
      sheet({ title: t.name, items });
    };

    // ----- Bank panel -----
    function PBank() {
      const saved = S.assoc[f.id] || { seed: '', res: null };
      panel.innerHTML = `<div class="ph"><span class="ph-t">Word bank</span><span class="count" id="bc"></span><span class="grow"></span>${closeBtn}</div>
        <div class="chips" id="bank"></div>
        <form class="form-row" id="addf"><input class="field" id="addw" placeholder="Add a word or phrase" autocomplete="off" autocapitalize="off" enterkeyhint="done" aria-label="Add a word"><button class="btn">Add</button></form>
        <div class="sec-h">Explore associations</div>
        <form class="form-row" id="assf"><input class="field" id="seed" placeholder="A theme or word — e.g. money" value="${esc(saved.seed)}" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Theme"><button class="btn primary">Explore</button></form>
        <div class="chips scroll">${words.themes.map((t) => `<button class="chip sm ghost" data-a="theme" data-w="${t}">${t}</button>`).join('')}</div>
        <div id="assoc"></div>`;
      $('#addf').addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('#addw');
        const w = inp.value.trim();
        if (!w) return;
        if (!bankHas(w)) { f.bank.push(w); saveSoon('files', f); }
        inp.value = '';
        renderBank();
      });
      $('#assf').addEventListener('submit', (e) => { e.preventDefault(); $('#seed').blur(); explore($('#seed').value); });
      renderBank();
      renderAssoc(saved.res);
    }
    function renderBank() {
      if (!$('#bank')) return;
      $('#bc').textContent = f.bank.length || '';
      $('#bank').innerHTML = f.bank.length
        ? f.bank.map((w) => `<span class="chip-x"><button class="chip" data-a="ins" data-w="${esc(w)}" aria-label="Insert ${esc(w)}">${esc(w)}<sup>${syl.count(w)}</sup></button><button class="x" data-a="bdel" data-w="${esc(w)}" aria-label="Remove ${esc(w)}">${icon('x')}</button></span>`).join('')
        : '<p class="muted sm" style="margin:2px 0 4px">Collect words for this song’s theme. Tap one to drop it into your lyrics.</p>';
      updateStrip(true);
    }
    function renderAssoc(r) {
      const bx = $('#assoc');
      if (!bx) return;
      if (!r) { bx.innerHTML = ''; return; }
      if (!r.groups.length) { bx.innerHTML = `<div class="loading">${r.source === 'offline' ? 'Offline — try one of the themes above.' : 'No associations found. Try another word.'}</div>`; return; }
      bx.innerHTML = r.groups.map((g) => `<div class="grp"><div class="grp-h">${esc(g.title)}</div><div class="chips">${g.list.map((x) => `<button class="chip sm ${bankHas(x.word) ? 'pinned' : ''}" data-a="apin" data-w="${esc(x.word)}">${esc(x.word)}<sup>${x.n}</sup></button>`).join('')}</div></div>`).join('')
        + `<p class="src">Tap to save to your bank${r.source === 'offline' ? ' · offline theme list' : ''}</p>`;
    }
    async function explore(seed) {
      seed = seed.trim();
      if (!seed || !$('#assoc')) return;
      $('#seed').value = seed;
      $('#assoc').innerHTML = '<div class="loading">Exploring…</div>';
      const r = await words.associate(seed);
      S.assoc[f.id] = { seed, res: r };
      if (S.panel === 'bank') renderAssoc(r);
    }
    VA.theme = (el) => explore(el.dataset.w);
    VA.bdel = (el) => {
      const i = f.bank.findIndex((x) => x === el.dataset.w);
      if (i >= 0) { f.bank.splice(i, 1); saveSoon('files', f); }
      renderBank();
      $$('#assoc [data-w]').forEach((c) => c.classList.toggle('pinned', bankHas(c.dataset.w)));
    };
    VA.apin = (el) => { el.classList.toggle('pinned', toggleBank(el.dataset.w)); renderBank(); };

    // ---------------- transport: beat + click layers ----------------
    function setNowLine(line) {
      const old = nowLine >= 0 && blkEl(nowLine);
      if (old) old.classList.remove('now');
      nowLine = line;
      const el = line >= 0 && blkEl(line);
      if (!el) return;
      el.classList.add('now');
      if (document.activeElement !== inp) {
        const r = el.getBoundingClientRect(), dt = dock.getBoundingClientRect().top, tt = topbar.getBoundingClientRect().bottom;
        if (r.top < tt || r.bottom > dt) window.scrollBy({ top: r.top - (tt + (dt - tt) / 2) + r.height / 2, behavior: 'smooth' });
      }
    }
    function clearNow() {
      nowStep = -1;
      setNowLine(-1);
      if (nowCell) nowCell.classList.remove('now');
      nowCell = null;
      $$('#seq .st.ph').forEach((x) => x.classList.remove('ph'));
      $$('#mb i').forEach((x) => x.classList.remove('on'));
    }
    function onTick(b, k) {
      if (T.drums) {
        const seq = barLines(f);
        const line = seq.length ? seq[b % seq.length] : -1;
        if (line !== nowLine) setNowLine(line);
        nowStep = k;
        const blk = blkEl(line);
        const cell = blk && blk.querySelectorAll('.cell')[k];
        if (nowCell && nowCell !== cell) nowCell.classList.remove('now');
        if (cell) cell.classList.add('now');
        nowCell = cell;
        if (S.panel === 'beat') {
          $$('#seq .st.ph').forEach((x) => x.classList.remove('ph'));
          $$(`#seq .st[data-k="${k}"]`).forEach((x) => x.classList.add('ph'));
        }
      }
      if (k % E.spb === 0) {
        const dots = $$('#mb i');
        if (dots.length) { const beat = (k / E.spb) % dots.length; dots.forEach((x, i) => x.classList.toggle('on', i === beat)); }
        const pill = $('.metro-btn');
        if (pill) { pill.classList.add('tick'); setTimeout(() => pill.classList.remove('tick'), 100); }
      }
    }
    function startTransport() {
      const { n, spb } = sig();
      const drums = T.drums;
      E.spb = drums ? 4 : spb;
      audio.play({
        kind: 'song', bpm: f.bpm, swing: drums ? f.swing : 0, click: T.click, accent: S.settings.accent,
        stepsPerBeat: E.spb, stepsPerBar: drums ? 16 : n * spb,
        getBar: drums ? (b) => { const seq = barLines(f); return barSteps(f, seq.length ? seq[b % seq.length] : -1); } : null,
        onStep: onTick,
        onStop: () => { clearNow(); },
      });
    }
    /** Apply T to the audio engine. restart = the bar structure changed. */
    function syncTransport(restart) {
      if (!T.drums && !T.click) audio.stop();
      else if (audio.state().playing && !restart) audio.update({ click: T.click, accent: S.settings.accent });
      else startTransport();
      updateTransportUI();
    }
    function updateTransportUI() {
      const pb = $('#dplay');
      if (pb) {
        pb.classList.toggle('on', T.drums);
        pb.querySelector('.dk-ic').innerHTML = icon(T.drums ? 'stop' : 'play');
        pb.querySelector('.dk-l').textContent = T.drums ? 'Stop' : 'Play';
        pb.setAttribute('aria-label', T.drums ? 'Stop beat' : 'Play beat');
      }
      const mb = $('.metro-btn');
      if (mb) mb.classList.toggle('on', T.click);
      const bc = $('#bclick');
      if (bc) bc.checked = T.click;
      const mp = $('#mplay');
      if (mp) mp.textContent = T.click ? 'Stop click' : 'Start click';
    }
    VA.dplay = () => {
      T.drums = !T.drums;
      autoDrums = false;
      syncTransport(true);
    };

    E = { f, spb: 4, syncTransport, updateTransportUI };
    S.lex = () => paintAll();
    const onResize = () => placeInput();
    window.addEventListener('resize', onResize);
    onLeave(() => {
      finishRec();
      T.drums = T.click = false;
      audio.stop();
      stopPlayer();
      urls.forEach((u) => URL.revokeObjectURL(u));
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      clearTimeout(stripT);
      E = null;
      S.cur = null;
      if (f.title === 'Untitled' && file(f.id)) {
        const l = firstLine(f);
        if (l) { f.title = l.length > 40 ? `${l.slice(0, 40).trim()}…` : l; saveSoon('files', f); }
      }
    });

    paintAll();
    if (cur) activate(cur.r, cur.k, { focus: false });
    renderPanel();
    updateStrip(true);
    updateTransportUI();
  }

  // =====================================================================
  // METRONOME — a click layer that runs alongside the beat and recording
  // =====================================================================
  function openMetronome() {
    if (!E) return;
    const sh = sheet({
      title: 'Metronome',
      html: `<div class="metro">
        <div class="mbeats" id="mb"></div>
        ${bpmCtl(curBpm())}
        <input type="range" class="range" id="mbr" min="40" max="220" value="${curBpm()}" aria-label="Tempo">
        <div class="seg wide" id="mts">${['2/4', '3/4', '4/4', '6/8'].map((x) => `<button data-ts="${x}" class="${x === S.settings.timeSig ? 'on' : ''}">${x}</button>`).join('')}</div>
        <div class="mrow"><button class="btn" id="mtap">Tap tempo</button><label class="btn" style="justify-content:space-between">Accent <input type="checkbox" class="switch" id="macc" ${S.settings.accent ? 'checked' : ''}></label></div>
        <button class="btn primary block" id="mplay">${T.click ? 'Stop click' : 'Start click'}</button>
        <p class="src" style="margin-top:0">The click layers over the beat — keep writing and recording while it runs.</p>
      </div>`,
    });
    const el = sh.el;
    const dots = () => { $('#mb', el).innerHTML = range(T.drums ? 4 : sig().n).map((i) => `<i class="${i === 0 && S.settings.accent ? 'a' : ''}"></i>`).join(''); };
    dots();
    $('#mplay', el).addEventListener('click', () => { T.click = !T.click; E.syncTransport(!audio.state().playing); if (!T.click) dots(); });
    $('#mbr', el).addEventListener('input', (e) => setBpm(+e.target.value));
    $('#mts', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-ts]');
      if (!b) return;
      S.settings.timeSig = b.dataset.ts;
      saveSettings();
      $$('#mts button', el).forEach((x) => x.classList.toggle('on', x === b));
      dots();
      if (T.click && !T.drums) E.syncTransport(true);
    });
    $('#macc', el).addEventListener('change', (e) => { S.settings.accent = e.target.checked; saveSettings(); audio.update({ accent: e.target.checked }); dots(); });
    let taps = [];
    $('#mtap', el).addEventListener('click', () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      taps = taps.slice(-5);
      if (taps.length >= 2) {
        const gaps = taps.slice(1).map((t, i) => t - taps[i]);
        setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      }
    });
  }

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function openSettings() {
    const sh = sheet({
      title: 'Settings',
      html: `<div class="set-row"><div class="lbl">Theme</div><div class="seg" id="thm">${['dark', 'light', 'system'].map((t) => `<button data-t="${t}" class="${S.settings.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <label class="set-row"><div><div class="lbl">Online dictionary</div><div class="sub">Exact syllables, stresses, rhymes and associations from Datamuse. Off keeps everything on-device.</div></div><input type="checkbox" class="switch" id="onl" ${S.settings.online ? 'checked' : ''}></label>
        <button class="menu-i" id="exp">${icon('download')}<span>Export backup</span><small>Lyrics, folders, beats</small></button>
        <button class="menu-i" id="imp">${icon('upload')}<span>Import backup</span></button>
        <input type="file" id="impf" accept="application/json,.json" hidden>
        <p class="src">Everything stays on this device · ${syl.lexiconSize()} words in the pronunciation cache</p>`,
    });
    const el = sh.el;
    $('#thm', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      S.settings.theme = b.dataset.t;
      saveSettings();
      applyTheme();
      $$('#thm button', el).forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#onl', el).addEventListener('change', (e) => { S.settings.online = e.target.checked; syl.online = e.target.checked; saveSettings(); });
    $('#exp', el).addEventListener('click', () => {
      const data = { app: 'FlowPad', version: 1, exported: new Date().toISOString(), projects: S.projects, folders: S.folders, files: S.files, patterns: S.patterns };
      download(`flowpad-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    });
    $('#imp', el).addEventListener('click', () => $('#impf', el).click());
    $('#impf', el).addEventListener('change', async (e) => {
      const fl = e.target.files[0];
      if (!fl) return;
      try {
        const data = JSON.parse(await fl.text());
        if (data.app !== 'FlowPad') throw new Error('not a FlowPad backup');
        const n = (data.files || []).length;
        if (!(await confirmBox({ title: 'Import backup?', message: `${plural(n, 'file')} will be merged into your library. Items with the same ID are replaced.`, ok: 'Import' }))) return;
        for (const s of ['projects', 'folders', 'files', 'patterns']) for (const o of data[s] || []) await db.put(s, o);
        await load();
        toast('Backup imported');
        closeAllSheets();
        go('#/');
      } catch (err) {
        toast('That file isn’t a FlowPad backup');
      }
    });
  }

  // =====================================================================
  // BOOT
  // =====================================================================
  async function seedWelcome() {
    const now = Date.now();
    const p = { id: FP.uid(), name: 'My First Project', created: now, updated: now };
    const verses = { id: FP.uid(), projectId: p.id, name: 'Verses', created: now, updated: now };
    const hooks = { id: FP.uid(), projectId: p.id, name: 'Hooks', created: now, updated: now };
    const f = normFile({
      id: FP.uid(), projectId: p.id, folderId: verses.id, title: 'Late Night', created: now, updated: now, bpm: 90,
      text: '[Verse 1]\nLate night, pen tight, city lights glow\nEvery single syllable is counted in the flow\nKick on the one and the snare on the two\nEvery word I write is a window into you\n\n[Hook]\nSay it how I feel it, let the rhythm take control\nPressure make a diamond, every bar a piece of soul',
      beat: { def: 'p-boombap', bars: { 7: 'p-lofi', 8: 'p-lofi' } },
      bank: ['midnight', 'city lights', 'pressure', 'diamond'],
    });
    for (const [s, o] of [['projects', p], ['folders', verses], ['folders', hooks], ['files', f]]) await db.put(s, o);
  }

  async function load() {
    const kv = await db.all('kv');
    if (!kv.find((x) => x.id === 'seeded')) {
      await seedWelcome();
      await db.put('kv', { id: 'seeded' });
    }
    const [projects, folders, files, patterns] = await Promise.all(['projects', 'folders', 'files', 'patterns'].map((s) => db.all(s)));
    const st = kv.find((x) => x.id === 'settings');
    if (st) Object.assign(S.settings, st);
    S.projects = projects;
    S.folders = folders;
    S.files = files.map(normFile);
    S.patterns = patterns;
    if (!S.patterns.length) {
      const now = Date.now();
      S.patterns = PRESETS.map((p, i) => ({
        id: p.id, name: p.name, bpm: p.bpm, order: i, created: now + i, updated: now,
        steps: Object.fromEntries(TRACKS.map((t) => [t.id, [...(p.s[t.id] || '0'.repeat(16))].map(Number)])),
      }));
      await Promise.all(S.patterns.map((p) => db.put('patterns', p)));
    }
  }

  syl.setCorpus(() => (S.cur ? `${S.cur.text}\n${S.cur.bank.join(' ')}` : ''));
  words.setCorpus(() => S.files.map((f) => f.text).join('\n'));

  (async function init() {
    try {
      await load();
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="page">${empty('x', 'Storage unavailable', 'FlowPad saves to your browser’s storage (IndexedDB), which seems to be blocked — private browsing can cause this.')}</div>`;
      return;
    }
    syl.online = S.settings.online;
    applyTheme();
    route();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
})();
