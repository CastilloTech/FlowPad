/* LosSoulx FlowPad — the editor's writing side: the flow sheet (typing, steps, drag, undo), the
 * rhyme / bank strip and the Rhymes and Bank panels. The audio side lives in editor-audio.js.
 */
'use strict';

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
      <span class="ur"><button class="icon-btn" id="bundo" data-a="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="icon-btn" id="bredo" data-a="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>${icon('redo')}</button></span>
      <button class="chip sm" data-a="fdef" aria-label="Song beat">${icon('drum', 'sm')}<span id="songbeat">${esc(patName(f.beat.def))}</span></button>
    </div>
    <div class="gsheet" id="gsheet">
      <div class="lines" id="lines"></div>
      <input id="cin" class="cin" hidden autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" aria-label="Lyric for this step">
      <span class="cmeasure" id="cmeasure" aria-hidden="true"></span>
    </div>
    <div class="sheet-add"><button class="btn" data-a="add-bar">${icon('plus', 'sm')}Bar</button><button class="btn" data-a="add-sec">${icon('plus', 'sm')}Section</button></div>
    <details class="tips" id="tips"${S.settings.tipsClosed ? '' : ' open'}><summary>Tips &amp; legend</summary>
      <ul class="tip-list">
        <li><b>Tap a step</b> and type. <b>Space</b> moves on — longer words split into syllables by themselves.</li>
        <li>Leave steps empty for rests. End a syllable with <b>-</b> to carry a word on (ci- ty).</li>
        <li><b>Enter</b> starts the next bar. <b>Hold a step</b> to drag it: drop on words to shift them along, or pause on them to replace.</li>
        <li><b>Swipe a bar</b> left to delete it, right to duplicate it.</li>
      </ul>
      <div class="legend"><span><b>CAPS</b> = stressed</span><span>Grey = unstressed</span><span>Underline = rhyme family</span><span><i class="lg mcl"></i>Shade = rhyme chain <button class="link" data-a="chains" id="chainsb">${S.settings.chains === false ? 'off' : 'on'}</button></span><span><i class="lg k"></i>kick <i class="lg s"></i>snare <i class="lg h"></i>hat</span></div>
    </details>
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
  $('#tips').addEventListener('toggle', (e) => { S.settings.tipsClosed = !e.target.open; saveSettings(); });
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
  /** A bar's lyric: stress per syllable, end-rhyme underlines, and rhyme-chain highlights (mk). */
  function lineHTML(l, color, mk) {
    let c = 0;
    return syl.analyzeLine(l).tokens.map((t) => {
      if (!t.word) return esc(t.text);
      if (t.syls[0] && t.syls[0].num) return `<span class="s1">${esc(t.text)}</span>`;
      const k = syl.rhymeKey(t.text);
      const r = k && color[k] != null ? ` data-r="${color[k]}"` : '';
      return `<span class="w"${r}>${t.syls.map((s) => {
        const m = mk ? mk[c++] : -1;
        return `<span class="s${s.s}${m >= 0 ? ' mc' : ''}"${m >= 0 ? ` data-c="${m % 6}"` : ''}>${esc(s.t)}</span>`;
      }).join('')}</span>`;
    }).join('');
  }

  /** Rhyme chains per section (bars between labels and blank lines): row → chain per syllable. */
  function chainMarks(views) {
    const marks = new Map();
    if (S.settings.chains === false) return marks;
    let run = [];
    const flush = () => {
      if (run.length > 1) syl.chains(run.map((ri) => views[ri].text)).forEach((m, j) => marks.set(run[j], m));
      run = [];
    };
    rows.forEach((r, i) => { if (r.type === 'bar') run.push(i); else flush(); });
    flush();
    return marks;
  }
  VA.chains = () => { S.settings.chains = S.settings.chains === false; saveSettings(); paintAll(); $('#chainsb').textContent = S.settings.chains === false ? 'off' : 'on'; };

  /** One row's HTML — content only; the cursor and playhead are applied on top (applyState). */
  function rowHTML(row, i, n, v, color, mk) {
    if (row.type === 'blank') return `<div class="blk blank" data-r="${i}"></div>`;
    if (row.type === 'label') return `<button class="blk label" data-a="label" data-r="${i}">${esc(row.text)}</button>`;
    const beatOff = f.track && !f.track.drums; // an imported beat replaces the drum patterns
    const steps = beatOff ? null : barSteps(f, i);
    const has = (k, ...ts) => steps && ts.some((t) => steps[t] && steps[t][k]);
    const cnt = syl.lineCount(v.text);
    // a bar shows its pattern only when it has its own; otherwise a quiet drum button opens the choice
    const pat = beatOff ? '' : row.pat
      ? `<button class="pat-btn set" data-a="bar-pat" data-r="${i}" data-n="${n}">${esc(patName(row.pat))}</button>`
      : `<button class="icon-btn pat-i" data-a="bar-pat" data-r="${i}" data-n="${n}" aria-label="Beat for bar ${n}: ${esc(patName(f.beat.def))}" title="Beat: ${esc(patName(f.beat.def))}">${icon('drum', 'sm')}</button>`;
    return `<div class="blk bar" data-r="${i}">
        <div class="bh"><span class="bar-n">${n}</span>${pat}<span class="grow"></span><span class="cnt">${cnt} syl</span><button class="icon-btn bm" data-a="bar-menu" data-r="${i}" data-n="${n}" aria-label="Bar ${n} options">${icon('more')}</button></div>
        <div class="bline" data-a="bar-go" data-r="${i}">${v.text ? lineHTML(v.text, color, mk) : '<span class="ph-t2">Tap a step to write</span>'}</div>
        <div class="bgrid">${range(16).map((k) => {
          const raw = (row.cells[k] || '').trim();
          const cont = /\S-$/.test(raw);
          return `<div class="cell ${k % 4 === 0 ? 'b' : ''}" data-a="cell" data-r="${i}" data-k="${k}"><span class="dr">${has(k, 'kick') ? '<i class="k"></i>' : ''}${has(k, 'snare', 'clap') ? '<i class="s"></i>' : ''}${has(k, 'hat', 'open') ? '<i class="h"></i>' : ''}</span><span class="ct ${v.cls[k]}">${esc(cont ? raw.slice(0, -1) : raw)}${cont ? '<i class="hy">-</i>' : ''}</span></div>`;
        }).join('')}</div>
      </div>`;
  }

  /**
   * Paint the sheet. Each row's HTML is compared with what's on screen and only changed rows
   * are replaced, so typing in one step of a long song touches one bar, not all of them.
   */
  let shown = [];
  function paintAll() {
    const views = rows.map((r) => (r.type === 'bar' ? barView(r.cells) : null));
    const color = rhymeColors(f.text.split('\n'));
    const marks = chainMarks(views);
    let n = 0, total = 0;
    const html = rows.map((row, i) => {
      if (row.type === 'bar') { n++; total += syl.lineCount(views[i].text); }
      return rowHTML(row, i, n, views[i], color, marks.get(i));
    });
    const kids = box.children, changed = [];
    if (kids.length !== html.length) {
      box.innerHTML = html.join('');
      changed.push(...kids);
    } else {
      const t = document.createElement('template');
      html.forEach((h, i) => {
        if (h === shown[i]) return;
        t.innerHTML = h;
        const el = t.content.firstElementChild;
        box.replaceChild(el, kids[i]);
        changed.push(el);
      });
    }
    shown = html;
    changed.forEach((el) => { if (el.classList.contains('bar')) fitIO.observe(el); });
    fitSteps(changed.filter((el) => el.classList.contains('bar') && near(el)));
    applyState();
    $('#stat').textContent = n ? `${plural(n, 'bar')} · avg ${Math.round(total / n)} syl` : 'Add a bar to start';
    placeInput();
  }
  /** Cursor, active step and playhead — kept out of the row HTML so moving them never repaints. */
  function applyState() {
    $$('.blk.cur, .blk.now, .cell.act, .cell.now', box).forEach((e) => e.classList.remove('cur', 'now', 'act'));
    nowCell = null;
    if (cur) {
      const b = blkEl(cur.r);
      if (b) { b.classList.add('cur'); const c = b.querySelectorAll('.cell')[cur.k]; if (c) c.classList.add('act'); }
    }
    const pb = nowLine >= 0 && blkEl(nowLine);
    if (pb) {
      pb.classList.add('now');
      const c = nowStep >= 0 && pb.querySelectorAll('.cell')[nowStep];
      if (c) { c.classList.add('now'); nowCell = c; }
    }
  }

  /**
   * Shrink step text that doesn't fit its cell (CAPS syllables on narrow phones). Bars are fitted
   * when they change or scroll into view, not all at once. Reads first, then writes.
   */
  const near = (el) => { const r = el.getBoundingClientRect(); return r.bottom > -400 && r.top < innerHeight + 400; };
  function fitSteps(bars) {
    const cts = bars.flatMap((b) => { b.dataset.fit = '1'; return $$('.ct', b).filter((c) => c.textContent); });
    if (!cts.length) return;
    cts.forEach((c) => { c.style.fontSize = ''; });
    const base = parseFloat(getComputedStyle(cts[0]).fontSize) || 12;
    cts.map((c) => [c, c.clientWidth / c.scrollWidth])
      .filter(([, r]) => r < 1)
      .forEach(([c, r]) => { c.style.fontSize = `${Math.max(8, Math.floor(base * r * 10) / 10)}px`; });
  }
  const fitIO = new IntersectionObserver((es) => {
    fitSteps(es.filter((e) => e.isIntersecting && e.target.dataset.fit !== '1' && e.target.isConnected).map((e) => e.target));
  }, { rootMargin: '400px 0px' });
  /** The sheet got wider or narrower: every bar fits again as it comes into view. */
  function refitAll() {
    $$('.blk.bar', box).forEach((b) => { b.dataset.fit = ''; fitIO.unobserve(b); fitIO.observe(b); });
  }
  /**
   * Every change to the sheet goes through here. kind 'type' = typing letters, which undoes in
   * bursts; anything else (drops, pushes, Space, undo) lets the words glide to where they land.
   */
  const commit = (kind) => {
    const before = kind === 'type' ? null : wordSpots();
    sync();
    record(kind);
    paintAll();
    glide(before);
    queueStrip();
  };

  // ---------------- words glide to their new steps instead of jumping ----------------
  /** Where each word on screen is now, keyed by its text and which occurrence it is. */
  function wordSpots() {
    if (calm()) return null;
    const spots = new Map(), seen = new Map();
    for (const b of $$('.blk.bar', box)) {
      if (!near(b)) continue;
      for (const ct of b.querySelectorAll('.ct')) {
        const t = ct.textContent;
        if (!t) continue;
        const n = (seen.get(t) || 0) + 1;
        seen.set(t, n);
        spots.set(`${t}#${n}`, ct.getBoundingClientRect());
      }
    }
    return spots;
  }
  /** Start each moved word at its old spot and let it slide to the new one. */
  function glide(before) {
    if (!before || !before.size) return;
    const seen = new Map(), moves = [];
    for (const b of $$('.blk.bar', box)) {
      if (!near(b)) continue;
      for (const ct of b.querySelectorAll('.ct')) {
        const t = ct.textContent;
        if (!t) continue;
        const n = (seen.get(t) || 0) + 1;
        seen.set(t, n);
        const a = before.get(`${t}#${n}`);
        if (!a) continue;
        const c = ct.getBoundingClientRect(), dx = a.left - c.left, dy = a.top - c.top;
        if (Math.abs(dx) + Math.abs(dy) < 2 || Math.abs(dy) > 700) continue;
        moves.push([ct, dx, dy]);
      }
    }
    if (!moves.length) return;
    moves.forEach(([ct, dx, dy]) => { ct.parentNode.classList.add('gliding'); ct.style.transition = 'none'; ct.style.transform = `translate(${dx}px, ${dy}px)`; });
    void box.offsetWidth;
    moves.forEach(([ct]) => { ct.style.transition = ''; ct.style.transform = ''; });
    setTimeout(() => moves.forEach(([ct]) => { if (ct.parentNode) ct.parentNode.classList.remove('gliding'); }), 260);
  }
  /** A soft tick when a word lands, if sounds are on in Settings. */
  const sound = () => { if (S.settings.sounds) audio.tick(); };

  // ---------------- undo / redo: snapshots of the sheet ----------------
  const hist = { undo: [], redo: [], snap: JSON.stringify(rows), typing: 0 };
  function record(kind) {
    const now = JSON.stringify(rows);
    if (now === hist.snap) return;
    // keep typing in one undo step until there's a pause
    const burst = kind === 'type' && hist.typing && Date.now() - hist.typing < 1500;
    if (!burst) { hist.undo.push(hist.snap); if (hist.undo.length > 200) hist.undo.shift(); }
    hist.redo = [];
    hist.snap = now;
    hist.typing = kind === 'type' ? Date.now() : 0;
    undoUI();
  }
  function restore(json) {
    const before = wordSpots();
    rows.splice(0, rows.length, ...JSON.parse(json));
    hist.snap = json;
    hist.typing = 0;
    if (cur && !isBarRow(cur.r)) cur = null;
    sync();
    paintAll();
    glide(before);
    queueStrip();
    undoUI();
    if (cur && document.activeElement === inp) activate(cur.r, cur.k);
  }
  function undo() {
    if (!hist.undo.length) return toast('Nothing to undo');
    hist.redo.push(hist.snap);
    restore(hist.undo.pop());
  }
  function redo() {
    if (!hist.redo.length) return toast('Nothing to redo');
    hist.undo.push(hist.snap);
    restore(hist.redo.pop());
  }
  function undoUI() {
    const u = $('#bundo'), r = $('#bredo');
    if (u) u.disabled = !hist.undo.length;
    if (r) r.disabled = !hist.redo.length;
  }
  VA.undo = undo;
  VA.redo = redo;
  const onUndoKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const t = e.target;
    if (t !== inp && t.matches && t.matches('input, textarea, [contenteditable="true"]')) return; // other fields keep their own undo
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(); else undo();
  };
  document.addEventListener('keydown', onUndoKey);

  /** Float the single step input over the active cell (so the keyboard never drops between steps). */
  function placeInput() {
    if (!cur || inp.hidden) return;
    const c = cellEl(cur.r, cur.k);
    if (!c) { inp.hidden = true; return; }
    const gr = gs.getBoundingClientRect(), cr = c.getBoundingClientRect();
    meas.textContent = inp.value || 'M';
    const w = Math.min(gr.width, Math.max(cr.width, meas.offsetWidth + 20));
    const left = Math.min(cr.left - gr.left, gr.width - w);
    // within a bar the box glides to the next step; jumping to another bar it just appears there
    inp.classList.toggle('glide', !calm() && inp.dataset.r === String(cur.r));
    inp.dataset.r = cur.r;
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

  // step editing (js/sheet.js) on this song's rows; a bar inserted above shifts the cursor and playhead
  const onInsert = (at) => { if (nowLine >= at) nowLine++; if (cur && cur.r >= at) cur.r++; };
  const nextPos = (r, k) => SH.nextPos(rows, r, k, onInsert);
  const pushAt = (r, k) => SH.pushAt(rows, r, k, onInsert);
  const pullAt = SH.pullAt;
  const placeWords = (r, k, words, replace) => SH.placeWords(rows, r, k, words, replace, onInsert);

  inp.addEventListener('input', () => {
    if (!cur) return;
    const row = rows[cur.r];
    const v = inp.value;
    if (/\s/.test(v)) {
      // Space (or pasted words): each word takes the next step, split into syllables.
      const parts = v.split(/\s+/).filter(Boolean);
      if (!parts.length) { row.cells[cur.k] = ''; commit(); return step(1); }
      const p = placeWords(cur.r, cur.k, parts);
      commit();
      sound();
      cur = { r: p.r, k: p.k };
      if (/\s$/.test(v)) step(1); else activate(p.r, p.k);
      return;
    }
    if (v === '-') { inp.value = ''; return; }
    row.cells[cur.k] = v;
    commit('type');
    if (v.length > 1 && v.endsWith('-')) step(1); // syllable continues on the next step
  });
  /** Enter ends the line: split the word in the current step across the steps after it first. */
  function endLine() {
    const row = rows[cur.r], v = (row.cells[cur.k] || '').trim();
    if (v && !/\s/.test(v) && wordSteps(v).length > 1) { const p = placeWords(cur.r, cur.k, [v]); cur = { r: p.r, k: p.k }; commit(); }
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

  // ----- hold a step to drag it onto another -----
  // A ring fills while you hold; the step lifts into a label that follows your finger and snaps
  // onto steps. Over words, they slide along to show the shift you'll get; pause there and it
  // switches to replace. Let go where you started for the step menu; off the grid cancels.
  const drag = { t: 0, ringT: 0, from: null, on: false, ghost: null, over: null, raf: 0, x: 0, y: 0, sx: 0, sy: 0, mouse: false, suppress: false, mode: 'move', hold: 0, left: false, moved: [] };
  const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('#lines .cell'); };
  const HOLD_MS = { mouse: 450, touch: 320 };
  const word = (s) => s.trim().replace(/-$/, '');

  function dragStart() {
    const { r, k, el } = drag.from;
    el.classList.remove('holding');
    drag.on = true;
    drag.left = false;
    inp.blur();
    inp.hidden = true;
    el.classList.add('lift');
    buzz(10);
    const txt = rows[r].cells[k].trim();
    if (txt) {
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost';
      drag.ghost.innerHTML = '<b></b><span class="gb"></span>';
      drag.ghost.firstChild.textContent = word(txt);
      document.body.appendChild(drag.ghost);
    }
    dragMove(drag.x, drag.y);
    autoScroll();
  }

  /** Slide the words from step tk of row tr to where a shift would put them (one step later, up to the next rest). */
  function shiftPreview(tr, tk) {
    const row = rows[tr], from = drag.from;
    let j = tk;
    while (j <= 15 && row.cells[j].trim() && !(tr === from.r && j === from.k)) j++;
    const cells = blkEl(tr).querySelectorAll('.cell');
    const next = j > 15 && isBarRow(tr + 1) && blkEl(tr + 1);
    for (let k = tk; k < Math.min(j, 16); k++) {
      const dest = k < 15 ? cells[k + 1] : next && next.querySelectorAll('.cell')[0];
      const ct = cells[k].querySelector('.ct');
      if (!dest || !ct) continue;
      const a = cells[k].getBoundingClientRect(), d = dest.getBoundingClientRect();
      cells[k].classList.add('fly');
      ct.style.transform = `translate(${d.left - a.left}px, ${d.top - a.top}px)`;
      drag.moved.push(cells[k]);
    }
  }
  function clearPreview() {
    drag.moved.forEach((c) => { c.classList.remove('fly'); const ct = c.querySelector('.ct'); if (ct) ct.style.transform = ''; });
    drag.moved = [];
    $$('.cell.replace', box).forEach((c) => c.classList.remove('replace'));
  }
  function setMode(m) {
    drag.mode = m;
    if (drag.ghost) { drag.ghost.dataset.mode = m; drag.ghost.querySelector('.gb').textContent = { shift: 'Shift', replace: 'Replace', move: '' }[m]; }
  }

  function dragMove(x, y) {
    drag.x = x; drag.y = y;
    if (!drag.ghost) return;
    const c = cellAt(x, y);
    const target = c && c !== drag.from.el ? c : null;
    if (target) drag.left = true;
    // the label snaps above the step it's over, and follows the finger elsewhere
    if (target) {
      const r = target.getBoundingClientRect();
      drag.ghost.classList.add('snap');
      drag.ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top}px) translate(-50%, -112%)`;
    } else {
      drag.ghost.classList.remove('snap');
      drag.ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
    }
    if (c === drag.over) return;
    clearTimeout(drag.hold);
    clearPreview();
    if (drag.over) drag.over.classList.remove('drop');
    drag.over = c;
    if (!target) { setMode('move'); return; }
    target.classList.add('drop');
    buzz(4);
    const tr = +target.dataset.r, tk = +target.dataset.k;
    if (!rows[tr].cells[tk].trim()) { setMode('move'); return; }
    setMode('shift');
    shiftPreview(tr, tk);
    // pause on the words to replace them instead
    drag.hold = setTimeout(() => {
      if (drag.over !== target) return;
      clearPreview();
      target.classList.add('replace');
      setMode('replace');
      buzz(12);
    }, 650);
  }

  /** Scroll while a step is held near the top bar or the dock — faster the closer to the edge. */
  function autoScroll() {
    if (!drag.on) return;
    const top = topbar.getBoundingClientRect().bottom, bot = dock.getBoundingClientRect().top, zone = 90;
    const pull = drag.y < top + zone ? -(top + zone - drag.y) : drag.y > bot - zone ? drag.y - (bot - zone) : 0;
    if (pull) {
      window.scrollBy(0, Math.sign(pull) * Math.ceil(26 * Math.min(1, Math.abs(pull) / zone) ** 2));
      dragMove(drag.x, drag.y);
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  /** The label floats back to where it came from. */
  function flyHome(ghost, el) {
    if (calm() || !el || !el.isConnected) { ghost.remove(); return; }
    const r = el.getBoundingClientRect();
    ghost.classList.remove('snap');
    ghost.classList.add('home');
    ghost.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) translate(-50%, -50%) scale(0.6)`;
    ghost.style.opacity = '0';
    setTimeout(() => ghost.remove(), 220);
  }

  function dragEnd(drop) {
    clearTimeout(drag.t);
    clearTimeout(drag.ringT);
    clearTimeout(drag.hold);
    cancelAnimationFrame(drag.raf);
    const { from, over, on, ghost, mode, left } = drag;
    if (from) from.el.classList.remove('holding', 'lift');
    if (over) over.classList.remove('drop');
    Object.assign(drag, { t: 0, from: null, on: false, ghost: null, over: null, mode: 'move' });
    if (drag.lexLater) { drag.lexLater = false; setTimeout(paintAll, 0); }
    if (!on) return;
    drag.suppress = true; // swallow the click that follows the drop
    setTimeout(() => { drag.suppress = false; }, 400);
    const back = !over || (over === from.el && left);
    if (!drop || back) { clearPreview(); if (ghost) flyHome(ghost, from.el); return; } // cancelled
    if (ghost) ghost.remove();
    if (over === from.el) { clearPreview(); stepMenu(from.r, from.k); return; }
    moveStep(from.r, from.k, +over.dataset.r, +over.dataset.k, mode);
  }

  /** Drop a step's words onto another: onto a rest it moves; onto words it shifts them along or replaces them. */
  function moveStep(fr, fk, tr, tk, mode) {
    const text = rows[fr].cells[fk];
    if (!text.trim()) { clearPreview(); return; }
    const there = rows[tr].cells[tk].trim();
    SH.moveStep(rows, fr, fk, tr, tk, mode === 'shift', onInsert);
    commit(); // the previewed words glide from where they are to where they land
    clearPreview();
    activate(tr, tk, { focus: false });
    buzz(12);
    sound();
    if (mode === 'replace' && there) toast(`Replaced “${word(there)}”`, { label: 'Undo', fn: undo });
  }

  function stepMenu(r, k) {
    const row = rows[r];
    const n = rows.slice(0, r + 1).filter((x) => x.type === 'bar').length;
    sheet({
      title: `Bar ${n} · step ${k + 1}`,
      items: [
        { label: 'Insert a rest here', icon: 'plus', hint: 'Pushes the words from here one step later', onClick: () => { pushAt(r, k); commit(); } },
        { label: 'Delete this step', icon: 'minus', hint: 'Pulls the words after it one step earlier', onClick: () => { pullAt(row, k); commit(); } },
        ...(row.cells[k].trim() ? [{ label: 'Clear step', icon: 'x', onClick: () => { const w = row.cells[k]; row.cells[k] = ''; commit(); toast(`Cleared “${word(w)}”`, { label: 'Undo', fn: undo }); } }] : []),
      ],
    });
  }

  box.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.cell');
    if (!c || e.button > 0) return;
    dragEnd(false);
    drag.from = { r: +c.dataset.r, k: +c.dataset.k, el: c };
    drag.x = drag.sx = e.clientX;
    drag.y = drag.sy = e.clientY;
    drag.mouse = e.pointerType === 'mouse';
    const ms = drag.mouse ? HOLD_MS.mouse : HOLD_MS.touch;
    // a ring fills while you hold (it starts just past a tap's length, so taps don't flash it)
    c.style.setProperty('--hold', `${ms - 120}ms`);
    drag.ringT = setTimeout(() => { if (drag.from && drag.from.el === c && !drag.on) c.classList.add('holding'); }, 120);
    drag.t = setTimeout(dragStart, ms);
  });
  const onDragMove = (e) => {
    if (!drag.from) return;
    if (drag.on) { e.preventDefault(); dragMove(e.clientX, e.clientY); return; }
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (drag.mouse && moved > 6 && rows[drag.from.r].cells[drag.from.k].trim()) { clearTimeout(drag.t); clearTimeout(drag.ringT); drag.x = e.clientX; drag.y = e.clientY; dragStart(); }
    else if (!drag.mouse && moved > 10) dragEnd(false); // a scroll or a swipe, not a hold
  };
  const onDragUp = (e) => dragEnd(e.type === 'pointerup');
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragUp);
  document.addEventListener('pointercancel', onDragUp);
  box.addEventListener('touchmove', (e) => { if (drag.on) e.preventDefault(); }, { passive: false }); // hold the page still while dragging
  box.addEventListener('contextmenu', (e) => { if (e.target.closest('.cell')) e.preventDefault(); });
  box.addEventListener('click', (e) => { if (drag.suppress) { drag.suppress = false; e.stopPropagation(); e.preventDefault(); } }, true);

  // ----- swipe a bar: left to delete, right to duplicate (Undo in the message) -----
  const sw = { el: null, x0: 0, y0: 0, dx: 0, on: false, dead: false, armed: false };
  box.addEventListener('touchstart', (e) => {
    const b = e.target.closest('.blk.bar');
    if (!b || e.touches.length > 1) { sw.el = null; return; }
    Object.assign(sw, { el: b, x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, on: false, dead: false, armed: false });
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!sw.el || sw.dead || drag.on) return;
    const dx = e.touches[0].clientX - sw.x0, dy = e.touches[0].clientY - sw.y0;
    if (!sw.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw.dead = true; return; } // a scroll
      if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      sw.on = true;
      dragEnd(false);
      sw.el.classList.add('swiping');
    }
    e.preventDefault();
    sw.dx = dx;
    const p = Math.min(1, Math.abs(dx) / (sw.el.offsetWidth * 0.35));
    sw.el.dataset.swipe = dx < 0 ? 'del' : 'dup';
    sw.el.style.setProperty('--sw', p.toFixed(2));
    sw.el.style.transform = `translateX(${dx}px)`;
    if (p >= 1 && !sw.armed) { sw.armed = true; buzz(10); } else if (p < 1) sw.armed = false;
  }, { passive: false });
  const swipeEnd = () => {
    const { el, on, armed, dx } = sw;
    sw.el = null;
    if (!el || !on) return;
    drag.suppress = true;
    setTimeout(() => { drag.suppress = false; }, 300);
    const r = +el.dataset.r;
    const settle = () => { el.classList.remove('swiping'); el.style.transform = ''; delete el.dataset.swipe; };
    el.classList.add('spring');
    setTimeout(() => el.classList.remove('spring'), 240);
    if (!armed) { settle(); return; }
    if (dx < 0) {
      // slide away, then delete
      el.style.transform = `translateX(${-el.offsetWidth * 1.1}px)`;
      setTimeout(() => {
        const n = rows.filter((x) => x.type === 'bar').length;
        if (n <= 1) rows[r].cells = newBarRow().cells;
        else { rows.splice(r, 1); if (cur && cur.r === r) cur = null; else if (cur && cur.r > r) cur.r--; if (nowLine > r) nowLine--; }
        commit();
        toast(n <= 1 ? 'Bar cleared' : 'Bar deleted', { label: 'Undo', fn: undo });
      }, calm() ? 0 : 180);
    } else {
      settle();
      rows.splice(r + 1, 0, JSON.parse(JSON.stringify(rows[r])));
      if (cur && cur.r > r) cur.r++;
      if (nowLine > r) nowLine++;
      commit();
      toast('Bar duplicated', { label: 'Undo', fn: undo });
    }
  };
  box.addEventListener('touchend', swipeEnd);
  box.addEventListener('touchcancel', swipeEnd);
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
  const ro = new ResizeObserver(() => { const w = box.clientWidth; if (w !== lastW) { lastW = w; refitAll(); placeInput(); } });
  ro.observe(box);

  /** Drop a word from the strip, rhymes or bank onto the active step, then move on. */
  function insertWord(w) {
    if (!cur) { const r = rows.findIndex((x) => x.type === 'bar'); if (r < 0) return; cur = { r, k: Math.min(15, lastFilled(r) + 1) }; }
    const row = rows[cur.r], k = cur.k;
    const ex = (row.cells[k] || '').trim().replace(/-$/, '');
    const fits = !ex || w.toLowerCase().startsWith(ex.toLowerCase());
    let p;
    if (fits) p = placeWords(cur.r, k, [w]); // finishes the half-typed word
    else {
      // goes after the words already here — into the next rest, or over the bar line
      let j = k + 1;
      while (j < 16 && row.cells[j].trim()) j++;
      const at = j < 16 ? { r: cur.r, k: j } : nextPos(cur.r, 15);
      p = placeWords(at.r, at.k, [w], false);
    }
    commit();
    sound();
    activate(p.r, Math.min(15, p.k + 1), { focus: document.activeElement === inp });
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
    if (!S.panel) {
      // closing: let it drop away first (opening slides up by itself, in the CSS)
      if (panel.hidden || calm()) { panel.hidden = true; panel.innerHTML = ''; return; }
      panel.classList.add('out');
      setTimeout(() => { panel.classList.remove('out'); if (!S.panel) { panel.hidden = true; panel.innerHTML = ''; } }, 150);
      return;
    }
    panel.classList.remove('out');
    panel.hidden = false;
    panel.scrollTop = 0;
    ({ rhymes: PRhymes, beat: PBeat, takes: PTakes, bank: PBank })[S.panel]();
  }
  VA.panel = (el) => togglePanel(el.dataset.v);
  VA.pclose = () => togglePanel(S.panel);
  // swipe a panel down by its header (or anywhere once it's scrolled to the top) to close it
  swipeDown(panel, {
    canStart: (e) => !!e.target.closest('.ph') || panel.scrollTop <= 0,
    onClose: () => { panel.style.transform = ''; if (S.panel) togglePanel(S.panel); },
  });

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


  // ---------------- the audio side (js/app/editor-audio.js) ----------------
  // It shares this song and the cursor / playhead through `ed`: plain values, functions,
  // and getters/setters onto this function's own state.
  const ed = {
    f, rows, box, inp, panel, stripEl, closeBtn, gone: false,
    commit, paintAll, blkEl, updateStrip, beatChanged,
    get cur() { return cur; }, set cur(v) { cur = v; },
    get nowLine() { return nowLine; }, set nowLine(v) { nowLine = v; },
    get nowStep() { return nowStep; }, set nowStep(v) { nowStep = v; },
    get nowCell() { return nowCell; }, set nowCell(v) { nowCell = v; },
  };
  const { PBeat, PTakes, syncTransport, updateTransportUI, stopPlayer, finishRec, loadTrack } = editorAudio(ed);

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


  E = { f, spb: 4, syncTransport, updateTransportUI };
  // new pronunciations repaint the sheet — but not mid-drag, which would pull the steps out from under it
  S.lex = () => { if (drag.on) drag.lexLater = true; else paintAll(); };
  loadTrack();
  const onResize = () => placeInput();
  window.addEventListener('resize', onResize);
  onLeave(() => {
    ed.gone = true;
    fitIO.disconnect();
    dragEnd(false);
    document.removeEventListener('keydown', onUndoKey);
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    document.removeEventListener('pointercancel', onDragUp);
    finishRec();
    T.drums = T.click = false;
    audio.stop();
    stopPlayer();
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
