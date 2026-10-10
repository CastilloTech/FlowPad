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
    right: `<button class="metro-btn" data-a="metro" aria-label="Metronome and tempo"><span class="mdot"></span><span data-bpm>${f.bpm}</span></button><button class="icon-btn" data-a="fmenu" aria-label="Song options">${icon('more')}</button>`,
  });
  VA.fmenu = () => fileMenu(f, true);

  view.innerHTML = `<div class="page ws">
    <div class="write-meta">
      <button class="stat" id="stat" data-a="stats" aria-label="Song stats and syllable target"></button>
      <span class="ur"><button class="icon-btn" id="bundo" data-a="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="icon-btn" id="bredo" data-a="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>${icon('redo')}</button></span>
      <button class="chip sm" data-a="fdef" aria-label="Song beat">${icon('drum', 'sm')}<span id="songbeat">${esc(patName(f.beat.def))}</span></button>
    </div>
    <div class="gsheet" id="gsheet">
      <div class="lines" id="lines"></div>
      <input id="cin" class="cin" hidden autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" aria-label="Lyric for this step">
      <span class="cmeasure" id="cmeasure" aria-hidden="true"></span>
    </div>
    <div class="ws-empty" id="wsempty" hidden>${icon('pen')}<div><b>Write your first bar</b><span>Tap a step and type: <b>Space</b> moves on, and long words split into syllables by themselves. Or pick a cadence first and write into its slots.</span>
      <div class="empty-act"><button class="btn primary" data-a="ws-write">Start writing</button><button class="btn" data-a="ws-cadence">Pick a cadence</button></div></div></div>
    <div class="sheet-add"><button class="btn" data-a="add-bar">${icon('plus', 'sm')}Bar</button><button class="btn" data-a="add-sec">${icon('plus', 'sm')}Section</button></div>
    <details class="tips" id="tips"${S.settings.tipsClosed === false ? ' open' : ''}><summary>Legend</summary>
      <div class="legend"><span><b>CAPS</b> = stressed</span><span>Grey = unstressed</span><span>Underline = rhyme family</span><span><i class="lg mcl"></i>Shade = rhyme chain <button class="link" data-a="chains" id="chainsb">${S.settings.chains === false ? 'off' : 'on'}</button></span><span><i class="lg pkl"></i>Pocket check <button class="link" data-a="pocket" id="pocketb">${S.settings.pocket ? 'on' : 'off'}</button></span><span><i class="lg k"></i>kick <i class="lg s"></i>snare <i class="lg h"></i>hat</span></div>
    </details>
  </div>`;
  dock.hidden = false;
  // phones: type in a bar above the keyboard, the line you're writing right above it (Settings → Typing)
  const typeBar = S.settings.typeBar ?? (matchMedia('(pointer: coarse)').matches && innerWidth < 640);
  dock.innerHTML = `<div class="panel" id="panel" hidden></div>
    ${typeBar ? '<div class="typebar" id="typebar" hidden><div class="tbl" id="tbl"></div></div>' : ''}
    <div class="strip" id="strip"></div>
    <div class="dockbar">
      <button class="dk dk-play" id="dplay" data-a="dplay"><span class="dk-ic">${icon('play')}</span><span class="dk-l">Play</span></button>
      <button class="dk dk-rec" id="drec" data-a="drec" aria-label="Start recording"><span class="dk-ic"><i></i></span><span class="dk-l" id="rlabel">Rec</span></button>
      ${PANELS.map(([k, ic, l]) => `<button class="dk dk-p ${S.panel === k ? 'on' : ''}" data-a="panel" data-v="${k}" aria-pressed="${S.panel === k}"><span class="dk-ic">${icon(ic)}</span><span class="dk-l">${l}</span></button>`).join('')}
    </div>`;

  const box = $('#lines'), gs = $('#gsheet'), inp = $('#cin'), meas = $('#cmeasure'), panel = $('#panel'), stripEl = $('#strip');
  const tbar = $('#typebar'), tbl = $('#tbl');
  if (tbar) {
    tbar.appendChild(inp);
    inp.classList.add('docked');
    // tapping the line above the box keeps the keyboard up
    tbar.addEventListener('mousedown', (e) => { if (e.target !== inp) e.preventDefault(); });
  }
  const zoom = () => clamp(S.settings.zoom || 1, 0.8, 1.6);
  gs.style.setProperty('--cz', zoom());
  $('#tips').addEventListener('toggle', (e) => { S.settings.tipsClosed = !e.target.open; saveSettings(); });
  const rows = f.sheet;
  const openedAs = versionKey(f); // to tell, on leaving, whether this session changed the song
  // always a bar to write in (a new song's empty text reads as one blank line)
  if (!rows.some((x) => x.type === 'bar')) {
    while (rows.length && rows[rows.length - 1].type === 'blank') rows.pop();
    rows.push(newBarRow());
  }
  let cur = S.cell[f.id] && rows[S.cell[f.id].r] && rows[S.cell[f.id].r].type === 'bar' ? { ...S.cell[f.id] } : null;
  let nowLine = -1, nowCell = null, nowStep = -1;

  // ---------------- the flow sheet: write straight into the steps ----------------
  // a row's index lives only on its outer .blk: inserting a bar renumbers the rest, it doesn't redraw them
  const blkEl = (r) => box.children[r] && box.children[r].dataset.r === String(r) ? box.children[r] : box.querySelector(`.blk[data-r="${r}"]`);
  const cellEl = (r, k) => { const b = blkEl(r), g = b && b.querySelector('.bgrid'); return g ? g.children[k] || null : null; };
  const rowOf = (el) => +el.closest('.blk').dataset.r;
  const isBarRow = (r) => !!rows[r] && rows[r].type === 'bar';
  const lastFilled = (r) => { for (let k = rows[r].cells.length - 1; k >= 0; k--) if (rows[r].cells[k].trim()) return k; return -1; };
  const lastStep = (r) => rows[r].cells.length - 1;
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

  /** A word that can carry a rhyme: not a little unstressed word like "the", "in", "a". */
  const rhymeWord = (w) => { const i = syl.wordInfo(w); return i.n > 0 && !(i.n === 1 && i.syls[0].s === 0) && syl.clean(w).length > 1; };
  /**
   * Rhyme families per section (bars between labels and blank lines): two or more *different*
   * words that rhyme anywhere in the section — at the ends of bars or inside them (take / bake,
   * run / sun) — share an underline colour. The same word twice isn't a rhyme.
   * Returns row → { rhymeKey: colour }.
   */
  /** One of the six underline colours for a rhyme sound — always the same one for the same sound. */
  const hue = (k) => { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return Math.abs(h) % 6; };
  /** A bar line's rhyming words as [rhymeKey, word] — cached by the line, so a keystroke only redoes its own bar. */
  const rhymes0 = new Map();
  window.addEventListener('fp:lexicon', () => rhymes0.clear()); // new pronunciations, new keys
  function barRhymes(text) {
    let r = rhymes0.get(text);
    if (!r) {
      r = (text.match(/[A-Za-z'’]+/g) || []).filter(rhymeWord).map((w) => [syl.rhymeKey(w), syl.clean(w)]).filter(([k]) => k);
      if (rhymes0.size > 3000) rhymes0.clear();
      rhymes0.set(text, r);
    }
    return r;
  }
  function rhymeFamilies(views) {
    const out = new Map();
    let run = [];
    const flush = () => {
      const words = new Map(); // rhyme key → the different words that have it
      run.forEach((ri) => barRhymes(views[ri].text).forEach(([k, w]) => {
        if (!words.has(k)) words.set(k, new Set());
        words.get(k).add(w);
      }));
      // each rhyme sound keeps its own colour, so a new family never repaints the others
      const color = {};
      words.forEach((set, k) => { if (set.size > 1) color[k] = hue(k); });
      run.forEach((ri) => out.set(ri, color));
      run = [];
    };
    rows.forEach((r, i) => { if (r.type === 'bar') run.push(i); else flush(); });
    flush();
    return out;
  }
  /** A bar's lyric: stress per syllable, rhyme-family underlines, and rhyme-chain highlights (mk). */
  function lineHTML(l, color, mk) {
    let c = 0;
    return syl.analyzeLine(l).tokens.map((t) => {
      if (!t.word) return esc(t.text);
      if (t.syls[0] && t.syls[0].num) return `<span class="s1">${esc(t.text)}</span>`;
      const k = rhymeWord(t.text) ? syl.rhymeKey(t.text) : '';
      const r = k && color[k] != null ? ` data-r="${color[k]}"` : '';
      return `<span class="w"${r}${k ? ` data-k="${esc(k)}"` : ''}>${t.syls.map((s) => {
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
  VA.pocket = () => { S.settings.pocket = !S.settings.pocket; saveSettings(); paintAll(); $('#pocketb').textContent = S.settings.pocket ? 'on' : 'off'; };
  VA.chains = () => { S.settings.chains = S.settings.chains === false; saveSettings(); paintAll(); $('#chainsb').textContent = S.settings.chains === false ? 'off' : 'on'; };

  /** How bar i's stressed syllables sit: between the 8ths (or triplets) and off the kick and snare. */
  function pocketOf(i, v) {
    if (!v.text) return null;
    const steps = f.track && !f.track.drums ? null : barSteps(f, i);
    const kicks = steps && new Set(range(16).filter((x) => ['kick', 'snare', 'clap'].some((t) => steps[t] && steps[t][x])));
    return FP.cadence.pocket(v.cls, kicks);
  }
  // ---------- fitting a syllable into its step: measured as text, never as layout ----------
  // (reading the page's layout for every bar made typing and scrolling stutter on phones)
  const measureCtx = document.createElement('canvas').getContext('2d'), widths = new Map();
  let fontFamily = '', fontNow = '';
  /** How wide `text` is at 100 px in the step's font (bold for a stressed syllable, in capitals). */
  function textWidth(text, cls) {
    // each letter measured once per weight, then added up — measuring whole syllables (switching
    // the font between stressed and unstressed ones) was the slow part of opening a song
    const weight = cls === 's1' ? 750 : cls === 's2' ? 650 : 500, t = cls === 's1' ? text.toUpperCase() : text;
    let w = 0;
    for (const ch of t) {
      const key = weight + ch;
      let cw = widths.get(key);
      if (cw == null) {
        if (!fontFamily) fontFamily = getComputedStyle(box).fontFamily || 'sans-serif';
        const font = `${weight} 100px ${fontFamily}`;
        if (font !== fontNow) { measureCtx.font = font; fontNow = font; }
        cw = measureCtx.measureText(ch).width;
        widths.set(key, cw);
      }
      w += cw;
    }
    return cls === 's1' ? w - 2 * t.length : w; // capitals are set 0.02em tighter
  }
  /** The room inside a step of an N-step bar, from the sheet's width (the grid's columns, gaps and padding as in the CSS). */
  let rooms = new Map(); // per paint
  // the window's width, kept up to date (reading it mid-paint can make the browser lay the page out)
  let viewW = innerWidth;
  const onViewW = () => { viewW = innerWidth; };
  window.addEventListener('resize', onViewW);
  function stepRoom(N) {
    let r = rooms.get(N);
    if (r == null) {
      if (!rooms.size) rooms.wide = viewW >= 640;
      const cols = rooms.wide ? (N === 16 ? 16 : 12) : N === 12 ? 6 : 8;
      // before the first layout, the sheet's width from the window's (the page's 16 px sides, at most
      // 680 wide) — reading it would lay the page out mid-build; the resize observer corrects it after
      r = ((lastW || Math.min(viewW, 680) - 32) - 20 - 3 * (cols - 1)) / cols - 5;
      rooms.set(N, r);
    }
    return r;
  }
  /** The font size (px) a step's text needs to fit, or 0 when it fits at the normal size. */
  function fitSize(text, cls, room, base) {
    const w = (textWidth(text, cls) * base) / 100;
    return w <= room ? 0 : Math.max(8, Math.floor(((base * room) / w) * 10) / 10);
  }

  /**
   * One row, in parts — so a change redraws only what changed: a bar's header, its lyric line, or
   * its step grid. Content only (no row index inside, which lives on the outer element); the cursor
   * and playhead are applied on top (applyState). Other rows are one part.
   */
  function rowParts(row, i, n, v, color, mk) {
    if (row.type === 'blank') return { kind: 'blank', html: '' };
    if (row.type === 'label') return { kind: 'label', html: esc(row.text) };
    const beatOff = f.track && !f.track.drums; // an imported beat replaces the drum patterns
    const steps = beatOff ? null : barSteps(f, i);
    const N = row.cells.length; // 16, or 12 / 24 for triplets
    // drum hits under step k: any of the 16ths it covers (patterns are always 16 steps)
    const has = (k, ...ts) => {
      if (!steps) return false;
      const a = Math.round((k * 16) / N), z = Math.max(a + 1, Math.round(((k + 1) * 16) / N));
      for (let x = a; x < z; x++) if (ts.some((t) => steps[t] && steps[t][x])) return true;
      return false;
    };
    const pk = S.settings.pocket ? pocketOf(i, v) : null;
    const rep = repNow.get(i) || 1;
    // grid, guide, repeated cadence, pocket misses: one quiet chip that explains itself when tapped
    const flags = [];
    if (N !== 16) flags.push(`<span class="gtag">${N === 12 ? 'triplets' : 'fast triplets'}</span>`);
    if (row.guide) flags.push('<span class="gtag guide">guide</span>');
    if (rep >= 3) flags.push(`<span class="rp">≡${rep}</span>`);
    if (pk && pk.off.length) flags.push(`<span class="pk">${pk.inPocket}/${pk.stressed}</span>`);
    const bx = flags.length ? `<button class="bx${rep >= 3 || (pk && pk.off.length) ? ' warn' : ''}" data-a="bar-info" data-n="${n}" aria-label="About bar ${n}">${flags.join('')}</button>` : '';
    const cnt = syl.lineCount(v.text);
    // more than one syllable off the song's target: marked (+3 over, −2 under)
    const off = f.target && cnt ? cnt - f.target : 0, miss = Math.abs(off) > 1;
    // a bar shows its pattern only when it has its own; otherwise a quiet drum button opens the choice
    const pat = beatOff ? '' : row.pat
      ? `<button class="pat-btn set" data-a="bar-pat" data-n="${n}">${esc(patName(row.pat))}</button>`
      : `<button class="icon-btn pat-i" data-a="bar-pat" data-n="${n}" aria-label="Beat for bar ${n}: ${esc(patName(f.beat.def))}" title="Beat: ${esc(patName(f.beat.def))}">${icon('drum', 'sm')}</button>`;
    const room = stepRoom(N), base = 12 * zoom();
    return {
      kind: 'bar',
      N,
      head: `<span class="bar-n">${n}</span>${pat}<span class="grow"></span>${bx}<span class="cnt${miss ? (off > 0 ? ' hi' : ' lo') : ''}"${miss ? ` title="${off > 0 ? off + ' over' : -off + ' under'} the ${f.target}-syllable target"` : ''}>${cnt} syl${miss ? ` <b>${off > 0 ? '+' : '−'}${Math.abs(off)}</b>` : ''}</span><button class="icon-btn bm" data-a="bar-menu" data-n="${n}" aria-label="Bar ${n} options">${icon('more')}</button>`,
      line: v.text ? lineHTML(v.text, color, mk) : '<span class="ph-t2">Tap a step to write</span>',
      grid: range(N).map((k) => {
        const raw = (row.cells[k] || '').trim();
        const cont = /\S-$/.test(raw), shown0 = cont ? raw.slice(0, -1) : raw;
        const fs = raw ? fitSize(raw, v.cls[k], room, base) : 0;
        return `<div class="cell ${k % (N / 4) === 0 ? 'b' : ''}${pk && pk.off.includes(k) ? ' offp' : ''}${row.guide && row.guide.includes(k) ? ' slot' : ''}" data-a="cell" data-k="${k}"><span class="dr">${has(k, 'kick') ? '<i class="k"></i>' : ''}${has(k, 'snare', 'clap') ? '<i class="s"></i>' : ''}${has(k, 'hat', 'open') ? '<i class="h"></i>' : ''}</span><span class="ct ${v.cls[k]}"${fs ? ` style="font-size:${fs}px"` : ''}>${esc(shown0)}${cont ? '<i class="hy">-</i>' : ''}</span></div>`;
      }).join(''),
    };
  }
  /** A row's element, new, from its parts. */
  function rowEl(p, i) {
    const t = document.createElement('template');
    t.innerHTML = p.kind === 'blank' ? `<div class="blk blank" data-r="${i}"></div>`
      : p.kind === 'label' ? `<button class="blk label" data-a="label" data-r="${i}">${p.html}</button>`
        : `<div class="blk bar" data-r="${i}"><div class="bh">${p.head}</div><div class="bline" data-a="bar-go">${p.line}</div><div class="bgrid" data-n="${p.N}">${p.grid}</div></div>`;
    const el = t.content.firstElementChild;
    el._parts = p;
    if (p.kind === 'bar') onScreen.observe(el);
    return el;
  }
  /** Bring a row's element up to date with its new parts: just the parts that changed. */
  function patchEl(el, p) {
    const q = el._parts;
    if (p.kind !== 'bar') { if (p.html !== q.html) el.innerHTML = p.html; }
    else {
      if (p.head !== q.head) el.children[0].innerHTML = p.head;
      if (p.line !== q.line) el.children[1].innerHTML = p.line;
      if (p.grid !== q.grid) { el.children[2].innerHTML = p.grid; el.children[2].dataset.n = p.N; }
    }
    el._parts = p;
  }
  const sameKind = (a, b) => a.kind === b.kind;
  const contentKey = (p) => (p.kind === 'bar' ? `${p.N}\u0001${p.line}\u0001${p.grid}` : `${p.kind}\u0001${p.html}`);

  /** Which bars are on (or near) the screen — kept by an observer, so nothing has to measure for it. */
  const visible = new Set();
  const onScreen = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }), { rootMargin: '300px 0px' });

  /**
   * Paint the sheet. Every row is worked out as parts and compared with what's on screen: rows keep
   * their elements (matched by the row itself, then by identical content — after an undo, say), a
   * new bar is one new element, and of a changed bar only the changed part is redrawn. Typing in a
   * step of a long song touches that one bar; Enter adds one bar and renumbers the rest.
   */
  let repNow = new Map(), lastPaint = { n: new Map(), marks: new Map() };
  function paintAll() {
    rooms = new Map();
    const views = rows.map((r) => (r.type === 'bar' ? barView(r.cells) : null));
    repNow = cadenceRepeats();
    const families = rhymeFamilies(views);
    const marks = chainMarks(views);
    let n = 0, total = 0;
    lastPaint = { n: new Map(), marks };
    const parts = rows.map((row, i) => {
      if (row.type === 'bar') { n++; total += syl.lineCount(views[i].text); lastPaint.n.set(row, n); }
      return rowParts(row, i, n, views[i], families.get(i) || {}, marks.get(i));
    });
    // the elements on screen, by their row and by their content, to reuse
    const old = [...box.children], byRow = new Map(), byContent = new Map();
    old.forEach((el) => {
      if (!el._parts) return;
      if (el._row) byRow.set(el._row, el);
      const k = contentKey(el._parts);
      if (!byContent.has(k)) byContent.set(k, []);
      byContent.get(k).push(el);
    });
    const used = new Set();
    const els = parts.map((p, i) => {
      let el = byRow.get(rows[i]);
      if (!el || used.has(el) || !sameKind(el._parts, p)) {
        const c = (byContent.get(contentKey(p)) || []).find((x) => !used.has(x) && sameKind(x._parts, p));
        el = c || null;
      }
      if (el) { used.add(el); patchEl(el, p); if (el.dataset.r !== String(i)) el.dataset.r = i; }
      else el = rowEl(p, i);
      el._row = rows[i];
      return el;
    });
    old.forEach((el) => { if (!used.has(el)) { onScreen.unobserve(el); visible.delete(el); el.remove(); } });
    // into place, moving only what's out of order
    els.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
    applyState();
    $('#stat').textContent = n ? `${plural(n, 'bar')} · avg ${Math.round(total / n)} syl` : 'Add a bar to start';
    $('#wsempty').hidden = total > 0;
    placeInput();
  }
  /** The sheet got wider or narrower, or the steps bigger: every bar's steps are fitted again. */
  function refitAll() { paintAll(); }
  /** How many bars in a row (within a section) share each bar's cadence. */
  function cadenceRepeats() {
    const out = new Map();
    let run = [];
    const flush = () => { FP.cadence.repeats(run.map((ri) => rows[ri].cells)).forEach((c, j) => out.set(run[j], c)); run = []; };
    rows.forEach((r, i) => { if (r.type === 'bar') run.push(i); else flush(); });
    flush();
    return out;
  }
  /** Cursor, active step and playhead — kept out of the row HTML so moving them never repaints. */
  let stateMarked = []; // what applyState marked last, to unmark without searching the sheet
  function applyState() {
    stateMarked.forEach((e) => e.classList.remove('cur', 'now', 'act'));
    stateMarked = [];
    nowCell = null;
    const mark = (el, c) => { if (el) { el.classList.add(c); stateMarked.push(el); } };
    if (cur) {
      const b = blkEl(cur.r);
      if (b) { mark(b, 'cur'); mark(cellEl(cur.r, cur.k), 'act'); }
    }
    rhymeFocus();
    const pb = nowLine >= 0 && blkEl(nowLine);
    if (pb) {
      mark(pb, 'now');
      const c = nowStep >= 0 && cellEl(nowLine, nowStep);
      if (c) { mark(c, 'now'); nowCell = c; }
    }
  }

  /**
   * Every change to the sheet goes through here. kind 'type' = typing letters, which undoes in
   * bursts; anything else (drops, pushes, Space, undo) lets the words glide to where they land.
   */
  const commit = (kind) => {
    const before = kind === 'type' ? null : wordSpots();
    sync();
    record(kind);
    if (kind === 'type' && cur && paintRow(cur.r)) {
      // letters typed into a step: that bar now; the underlines, chains and badges of the bars it
      // affects (a new rhyme can light up dozens) once you pause — mid-word they'd only flicker
      clearTimeout(fullT);
      fullT = setTimeout(paintAll, 250);
    } else {
      clearTimeout(fullT);
      paintAll();
    }
    glide(before);
    queueStrip();
  };
  let fullT = 0;
  /** Redraw one bar straight away (its own rhymes and stresses); false if it needs the whole sheet. */
  function paintRow(r) {
    const el = blkEl(r);
    if (!el || !el._parts || el._parts.kind !== 'bar' || el._parts.N !== rows[r].cells.length || !lastPaint.n.has(rows[r])) return false;
    rooms = new Map();
    const views = rows.map((x) => (x.type === 'bar' ? barView(x.cells) : null));
    const p = rowParts(rows[r], r, lastPaint.n.get(rows[r]), views[r], rhymeFamilies(views).get(r) || {}, lastPaint.marks.get(r));
    patchEl(el, p);
    rhymeFocus();
    placeInput();
    return true;
  }

  // ---------------- words glide to their new steps instead of jumping ----------------
  /** Where each word on screen is now, keyed by its text and which occurrence it is. */
  function wordSpots() {
    if (calm()) return null;
    const spots = new Map(), seen = new Map();
    for (const b of visible) {
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
    for (const b of visible) {
      if (!b.isConnected) continue;
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
  /** A soft UI sound, if sounds are on in Settings: land (a word on a step), slot, bar, save, undo, remove. */
  const sound = (name = 'land') => { if (S.settings.sounds) audio.ui(name); };
  /** A word landed on step k of row r: a lighter tap off the beat, a firmer one on it. */
  const landed = (r, k) => { buzz(k % (rows[r].cells.length / 4) === 0 ? 9 : 4); sound(); };
  /** A bar's done (Enter, or its guide's slots all filled): a little rising figure. */
  const barDone = () => { buzz([8, 40, 16]); sound('bar'); };

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
    sound('undo');
    buzz(6);
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
    if (tbar) tbar.hidden = !cur || inp.hidden;
    if (!cur || inp.hidden) return;
    const c = cellEl(cur.r, cur.k);
    if (!c) { inp.hidden = true; if (tbar) tbar.hidden = true; return; }
    if (tbar) { typeLine(); return; }
    const gr = gs.getBoundingClientRect(), cr = c.getBoundingClientRect();
    meas.textContent = inp.value || 'M';
    const w = Math.min(gr.width, Math.max(cr.width, meas.offsetWidth + 20));
    const left = Math.min(cr.left - gr.left, gr.width - w);
    // within a bar the box glides to the next step; jumping to another bar it just appears there
    inp.classList.toggle('glide', !calm() && inp.dataset.r === String(cur.r));
    inp.dataset.r = cur.r;
    inp.style.cssText = `left:${left}px;top:${cr.top - gr.top}px;width:${w}px;height:${cr.height}px`;
  }

  /** The typing bar's line: this bar's syllables (stresses lit), the step you're on marked. */
  function typeLine() {
    const row = rows[cur.r], v = barView(row.cells), n = rows.slice(0, cur.r + 1).filter((x) => x.type === 'bar').length;
    let h = '';
    row.cells.forEach((c, k) => {
      const t = c.trim();
      if (!t && k !== cur.k) return;
      const cont = /\S-$/.test(t);
      h += `<span class="tp ${v.cls[k]}${k === cur.k ? ' on' : ''}">${t ? esc(cont ? t.slice(0, -1) : t) : '&nbsp;'}</span>${cont ? '' : ' '}`;
    });
    tbl.innerHTML = `<b class="tbn">${n}<small>.${cur.k + 1}</small></b><span class="tps">${h}</span>`;
    const tps = tbl.lastChild, on = tps.querySelector('.on');
    if (on) tps.scrollLeft = on.offsetLeft - tps.clientWidth / 2;
  }

  function activate(r, k, { focus = true, select = false } = {}) {
    if (!isBarRow(r)) return;
    cur = { r, k: clamp(k, 0, lastStep(r)) };
    S.cell[f.id] = cur;
    // the cursor moves: off the elements marked before (no search of the sheet), onto the new ones
    stateMarked = stateMarked.filter((e) => { if (e.classList.contains('act') || e.classList.contains('cur')) { e.classList.remove('act', 'cur'); return e.classList.contains('now'); } return true; });
    const c = cellEl(cur.r, cur.k), b = blkEl(cur.r);
    if (c) { c.classList.add('act'); stateMarked.push(c); }
    if (b) { b.classList.add('cur'); stateMarked.push(b); }
    rhymeFocus();
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
    if (k > lastStep(cur.r)) return nextBar();
    if (k < 0) { const p = prevBarRow(cur.r); if (p >= 0) activate(p, lastStep(p)); return; }
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
   * The steps holding the word on step k of row r — a word broken over steps ("mo-", "ney")
   * carries on into the next filled step. Returns { k0, k1, text }, or null on a rest.
   */
  function wordAt(r, k) {
    const cells = rows[r].cells;
    if (!cells[k].trim()) return null;
    const filled = cells.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
    let a = filled.indexOf(k), z = a;
    while (a > 0 && /-$/.test(cells[filled[a - 1]].trim())) a--;
    while (z < filled.length - 1 && /-$/.test(cells[filled[z]].trim())) z++;
    const text = filled.slice(a, z + 1).map((i) => cells[i].trim().replace(/-$/, '')).join('');
    return { k0: filled[a], k1: filled[z], text };
  }
  /** Light up every word in the song that rhymes with the word on the selected step. */
  let rhymeLit = [], rhymeLitKey = '';
  function rhymeFocus() {
    const wd = cur && isBarRow(cur.r) && wordAt(cur.r, cur.k);
    const last = wd && (wd.text.match(/[A-Za-z'’]+(?=[^A-Za-z'’]*$)/) || [])[0];
    const k = last && rhymeWord(last) ? syl.rhymeKey(last) || '' : '';
    // the same rhyme as before and those words still on screen: nothing to do
    if (k === rhymeLitKey && rhymeLit.every((w) => w.isConnected)) return;
    rhymeLit.forEach((w) => w.classList.remove('rf'));
    rhymeLitKey = k;
    rhymeLit = k ? $$(`.bline .w[data-k="${CSS.escape(k)}"]`, box) : [];
    rhymeLit.forEach((w) => w.classList.add('rf'));
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
      if (rows[p.r].guide) { followGuide(p.r, /\s$/.test(v)); coachNext(p.r); return; }
      commit();
      landed(p.r, p.k);
      cur = { r: p.r, k: p.k };
      if (/\s$/.test(v)) step(1); else activate(p.r, p.k);
      coachNext(p.r);
      return;
    }
    if (v === '-') { inp.value = ''; return; }
    row.cells[cur.k] = v;
    commit('type');
    if (v.length > 1 && v.endsWith('-')) step(1); // syllable continues on the next step
  });
  /**
   * A guided bar: lay its words onto the guide's slots in order, then go to the next empty slot
   * (or the next bar once they're all filled).
   */
  function followGuide(r, next) {
    const R = rows[r];
    R.cells = SH.applyFlow(barView(R.cells).text, R.guide, R.cells.length);
    commit();
    const lf = lastFilled(r), g = R.guide.find((k) => k > lf);
    if (g == null) barDone(); else { buzz([5, 35, 5]); sound('slot'); }
    cur = { r, k: lf < 0 ? 0 : lf };
    if (!next) activate(r, cur.k);
    else if (g == null) nextBar();
    else activate(r, g);
  }
  /** Enter ends the line: split the word in the current step across the steps after it first. */
  function endLine() {
    const row = rows[cur.r], v = (row.cells[cur.k] || '').trim();
    if (v && !/\s/.test(v) && wordSteps(v).length > 1) { const p = placeWords(cur.r, cur.k, [v]); cur = { r: p.r, k: p.k }; commit(); }
    const r = cur.r;
    if (lastFilled(r) >= 0) barDone();
    nextBar();
    coachNext(r);
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
  inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) { inp.hidden = true; if (tbar) tbar.hidden = true; } }, 0));

  VA.cell = (el) => activate(rowOf(el), +el.dataset.k, { select: true }); // typing replaces the step

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
    const row = rows[tr], from = drag.from, L = row.cells.length - 1;
    let j = tk;
    while (j <= L && row.cells[j].trim() && !(tr === from.r && j === from.k)) j++;
    const cells = blkEl(tr).querySelectorAll('.cell');
    const next = j > L && isBarRow(tr + 1) && blkEl(tr + 1);
    for (let k = tk; k < Math.min(j, L + 1); k++) {
      const dest = k < L ? cells[k + 1] : next && next.querySelectorAll('.cell')[0];
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
    const tr = rowOf(target), tk = +target.dataset.k;
    buzz(tk % (rows[tr].cells.length / 4) === 0 ? 8 : 3); // firmer over a beat
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
    moveStep(from.r, from.k, rowOf(over), +over.dataset.k, mode);
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
    drag.from = { r: rowOf(c), k: +c.dataset.k, el: c };
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
    const r = rowOf(el);
    const settle = () => { el.classList.remove('swiping'); el.style.transform = ''; delete el.dataset.swipe; };
    el.classList.add('spring');
    setTimeout(() => el.classList.remove('spring'), 380);
    if (!armed) { settle(); return; }
    if (dx < 0) {
      // slide away, then delete
      el.style.transform = `translateX(${-el.offsetWidth * 1.1}px)`;
      setTimeout(() => {
        const n = rows.filter((x) => x.type === 'bar').length;
        if (n <= 1) rows[r].cells = newBarRow().cells;
        else { rows.splice(r, 1); if (cur && cur.r === r) cur = null; else if (cur && cur.r > r) cur.r--; if (nowLine > r) nowLine--; }
        commit();
        sound('remove');
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

  // ----- pinch the grid: bigger steps to hit, or more of the song on screen -----
  const pinch = { on: false, d0: 1, z0: 1 };
  const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    Object.assign(pinch, { on: true, d0: spread(e.touches), z0: zoom() });
    dragEnd(false);
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!pinch.on || e.touches.length < 2) return;
    e.preventDefault();
    S.settings.zoom = clamp((pinch.z0 * spread(e.touches)) / pinch.d0, 0.8, 1.6);
    gs.style.setProperty('--cz', S.settings.zoom.toFixed(3));
    placeInput();
  }, { passive: false });
  const pinchEnd = (e) => {
    if (!pinch.on || e.touches.length) return;
    pinch.on = false;
    setZoom(Math.round(zoom() * 20) / 20);
  };
  box.addEventListener('touchend', pinchEnd);
  box.addEventListener('touchcancel', pinchEnd);
  function setZoom(z) {
    S.settings.zoom = clamp(z, 0.8, 1.6);
    saveSettings();
    gs.style.setProperty('--cz', S.settings.zoom);
    refitAll();
    placeInput();
    toast(`Steps at ${Math.round(S.settings.zoom * 100)}%`);
  }
  VA['bar-go'] = (el) => {
    const r = rowOf(el), g = rows[r].guide, lf = lastFilled(r);
    // a guided bar opens at its next empty slot
    activate(r, g ? (g.find((k) => k > lf) ?? g[g.length - 1]) : Math.min(lastStep(r), lf + 1));
  };
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
    const r = rowOf(el);
    sheet({
      title: rows[r].text,
      items: [
        { label: 'Rename section', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename section', value: rows[r].text }); if (v) { rows[r].text = v; commit(); } } },
        { label: 'Remove label', icon: 'trash', danger: true, onClick: () => { rows.splice(r, 1); if (cur && cur.r > r) cur.r--; commit(); } },
      ],
    });
  };
  VA['bar-menu'] = (el) => {
    const r = rowOf(el);
    const row = rows[r];
    sheet({
      title: `Bar ${el.dataset.n}`,
      items: [
        { label: 'Rhythm…', icon: 'flow', hint: 'Cadences, triplets, tap one in', onClick: () => rhythmSheet(r) },
        { label: 'Hear this bar', icon: 'play', hint: 'Its words as blips, over the beat', onClick: () => hearBar(r) },
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

  /** What a bar's header chip means — each with what to do about it. */
  VA['bar-info'] = (el) => {
    const r = rowOf(el), R = rows[r], N = R.cells.length, v = barView(R.cells);
    const rep = repNow.get(r) || 1, pk = S.settings.pocket ? pocketOf(r, v) : null;
    const items = [];
    if (N !== 16) items.push(['gtag', GRID_NAMES[N], N === 12 ? '12 steps: every beat split in three, the rolling triplet flow.' : '24 steps: every 8th split in three, for fast stuttering flows.', 'Change the grid', 'rhythm']);
    if (R.guide) items.push(['gtag guide', 'Guide', `${plural(R.guide.length, 'slot')} from a cadence you tapped in. Each word you type lands in the next one.`, 'Clear the guide', 'unguide']);
    if (rep >= 3) items.push(['rp', `Same cadence ×${rep}`, `This bar has the rhythm of the ${plural(rep - 1, 'bar')} before it. Switching it up keeps a verse moving.`, 'Pick another cadence', 'rhythm']);
    if (pk && pk.off.length) items.push(['pk', `${pk.inPocket} of ${pk.stressed} in the pocket`, `${plural(pk.off.length, 'stressed syllable')} ${pk.off.length === 1 ? 'lands' : 'land'} between the 8ths and off the kick and snare (wavy underline). On the beat hits harder; off it sounds lazier. Your call.`, 'Hear this bar', 'hear']);
    const sh = sheet({
      title: `Bar ${el.dataset.n}`,
      html: items.map(([c, t, d, b, a]) => `<div class="bi"><span class="bi-t ${c}">${esc(t)}</span><p>${esc(d)}</p><button class="btn" data-a="bi-${a}">${esc(b)}</button></div>`).join(''),
      actions: {
        'bi-rhythm': () => { sh.close(); rhythmSheet(r); },
        'bi-unguide': () => { sh.close(); delete rows[r].guide; commit(); toast('Guide cleared', { label: 'Undo', fn: undo }); },
        'bi-hear': () => { sh.close(); hearBar(r); },
      },
    });
  };
  VA['ws-write'] = () => { const r = rows.findIndex((x) => x.type === 'bar'); if (r >= 0) activate(r, 0); };
  VA['ws-cadence'] = () => { const r = rows.findIndex((x) => x.type === 'bar'); if (r >= 0) rhythmSheet(r); };

  // ---------------- coach marks: the next thing worth knowing, once ----------------
  function coachNext(r) {
    const c = S.settings.coached || {};
    if (!c.step || ed.gone) return;
    const written = rows.filter((x) => x.type === 'bar' && x.cells.some((y) => y.trim())).length;
    setTimeout(() => {
      const b = blkEl(r);
      if (!b || ed.gone) return;
      if (!c.hold && lastFilled(r) >= 3) coach('hold', cellEl(r, lastFilled(r) - 1), '<b>Hold a step</b> to pick it up, then drag it. Drop it on words to shift them along.');
      else if (!c.rhythm && written >= 2) coach('rhythm', b.querySelector('.bm'), 'Try <b>⋯ → Rhythm</b>: cadences to write into, triplets, or tap your own in.');
      else if (!c.play && written >= 3) coach('play', $('#dplay'), '<b>Play</b> loops the beat under your bars. Turn on <b>Words</b> in the Beat panel to hear your flow.');
      else if (!c.swipe && written >= 4) coach('swipe', b.querySelector('.bline'), '<b>Swipe a bar</b> left to delete it, right to duplicate it.');
    }, 400);
  }

  // ---------------- cadences: a bar's rhythm, from the library, tapped in, or saved ----------------
  const FLOWS = [
    { id: 'f-beat', name: 'On the beat', note: 'Four hits, square on the beat', steps: [0, 4, 8, 12] },
    { id: 'f-half', name: 'Half time', note: 'Two heavy hits — slow and big', steps: [0, 8] },
    { id: 'f-8ths', name: 'Straight 8ths', note: 'Steady, like talking', steps: [0, 2, 4, 6, 8, 10, 12, 14] },
    { id: 'f-lazy', name: 'Laid back', note: 'Behind the beat, relaxed', steps: [2, 6, 10, 14] },
    { id: 'f-push', name: 'Syncopated', note: 'Off-beat pushes, bouncy', steps: [0, 3, 6, 8, 11, 14] },
    { id: 'f-bap', name: 'Boom bap bounce', note: 'The 90s swing between hits', steps: [0, 3, 4, 7, 8, 11, 12, 14] },
    { id: 'f-16ths', name: 'Double time', note: 'Every 16th — fast', steps: range(16) },
    { id: 'f-trip', name: 'Triplet', note: 'Rolling threes — trap flow', n: 12, steps: range(12) },
    { id: 'f-trip2', name: 'Triplet bounce', note: 'Two of every three', n: 12, steps: [0, 1, 3, 4, 6, 7, 9, 10] },
    { id: 'f-trip3', name: 'Triplet stutter', note: 'Fast threes, spaced', n: 24, steps: [0, 2, 4, 8, 10, 12, 16, 18, 20] },
  ];
  const GRID_NAMES = { 16: '16ths', 12: 'Triplets', 24: 'Fast triplets' };
  const flowDots = (steps, n = 16) => `<span class="fdots" data-n="${n}" aria-hidden="true">${range(n).map((k) => `<i class="${steps.includes(k) ? 'on' : ''}${k % (n / 4) === 0 ? ' b' : ''}"></i>`).join('')}</span>`;
  const keepFlows = () => db.put('kv', { id: 'flows', list: S.flows });

  /**
   * Everything about a bar's cadence in one sheet: its grid (16ths or triplets), tapping a new one
   * in, the cadence library (with a ▶ to hear each), spreading or packing the words, a guide to
   * write into, and saving this bar's rhythm. For this bar, or its whole section.
   */
  function rhythmSheet(r) {
    const SPREAD = [
      { name: 'Spread evenly', mode: 'even', note: 'Across the whole bar' },
      { name: 'One syllable per step', mode: 'pack', note: 'Fast, from the first step' },
    ];
    const all = [...SPREAD, ...S.flows, ...FLOWS];
    const R = rows[r], N = R.cells.length, has = SH.flowOf(R.cells).length > 0;
    const sh = sheet({
      title: 'Rhythm',
      html: `<div class="set-row"><div class="lbl">Grid</div><div class="seg" id="fgrid">${SH.GRIDS.map((g) => `<button data-g="${g}" class="${g === N ? 'on' : ''}">${GRID_NAMES[g]}</button>`).join('')}</div></div>
        <label class="set-row"><div><div class="lbl">Whole section</div><div class="sub">Every bar until the next blank line or label</div></div><input type="checkbox" class="switch" id="fwhole"></label>
        <button class="btn block ftap" data-a="ftap">${icon('drum', 'sm')}Tap a cadence in</button>
        ${R.guide ? `<button class="btn block" data-a="fguide">${icon('x', 'sm')}Clear this bar’s guide</button>` : ''}
        ${all.map((fl, i) => `<div class="flow-i"><button class="menu-i" data-fi="${i}">${fl.mode ? `${icon(fl.mode === 'even' ? 'flow' : 'drum')}<span>${esc(fl.name)}</span>` : `${flowDots(fl.steps, fl.n)}<span>${esc(fl.name)}</span>`}${fl.note ? `<small>${esc(fl.note)}</small>` : ''}</button>${fl.steps ? `<button class="icon-btn muted" data-fplay="${i}" aria-label="Hear ${esc(fl.name)}">${icon('play', 'sm')}</button>` : ''}${fl.user ? `<button class="icon-btn muted" data-fdel="${i}" aria-label="Delete ${esc(fl.name)}">${icon('x')}</button>` : ''}</div>`).join('')}
        ${has ? `<button class="btn block fsave" data-a="fsave">${icon('bank', 'sm')}Save this bar’s rhythm</button>` : ''}`,
      actions: {
        fsave: () => { sh.close(); saveFlow(r); },
        ftap: () => { sh.close(); tapCadence(r); },
        fguide: () => { sh.close(); delete rows[r].guide; commit(); toast('Guide cleared', { label: 'Undo', fn: undo }); },
      },
    });
    const range0 = () => {
      let a = r, z = r;
      if ($('#fwhole', sh.el).checked) { while (isBarRow(a - 1)) a--; while (isBarRow(z + 1)) z++; }
      return [a, z];
    };
    sh.el.addEventListener('click', (e) => {
      const g = e.target.closest('[data-g]');
      if (g) {
        // switch the grid: every syllable keeps its moment in the bar
        const n = +g.dataset.g, [a, z] = range0();
        for (let i = a; i <= z; i++) { rows[i].cells = SH.regrid(rows[i].cells, n); if (rows[i].guide) delete rows[i].guide; }
        sh.close();
        commit();
        toast(`${z > a ? 'Section' : 'Bar'} on ${GRID_NAMES[n].toLowerCase()}`, { label: 'Undo', fn: undo });
        return;
      }
      const pl = e.target.closest('[data-fplay]');
      if (pl) { const fl = all[+pl.dataset.fplay]; audio.previewRhythm({ steps: fl.steps, n: fl.n || 16, bpm: f.bpm }); return; }
      const del = e.target.closest('[data-fdel]');
      if (del) {
        const fl = all[+del.dataset.fdel];
        S.flows = S.flows.filter((x) => x !== fl);
        keepFlows();
        sh.close();
        toast(`Deleted “${fl.name}”`);
        return;
      }
      const b = e.target.closest('[data-fi]');
      if (!b) return;
      const fl = all[+b.dataset.fi], [a, z] = range0();
      if (z > a) snapshot(f, 'Before a flow over a section');
      for (let i = a; i <= z; i++) {
        const text = barView(rows[i].cells).text;
        if (text) rows[i].cells = fl.mode ? spreadCells(text, fl.mode, rows[i].cells.length) : SH.applyFlow(text, fl.steps, fl.n || 16);
      }
      sh.close();
      commit();
      toast(`“${fl.name}” applied`, { label: 'Undo', fn: undo });
    });
  }
  async function saveFlow(r) {
    const steps = SH.flowOf(rows[r].cells), n = rows[r].cells.length;
    const name = await ask({ title: 'Name this flow', value: `Flow ${S.flows.length + 1}`, ok: 'Save' });
    if (!name) return;
    S.flows.unshift({ id: FP.uid(), name, steps, n, user: true });
    keepFlows();
    sound('save');
    toast('Saved — find it under Rhythm in any bar’s ⋯ menu');
  }

  // ---------------- stats and the syllable target ----------------
  /** How varied the song's cadences are, and where a run of the same one could switch up. */
  function cadenceLine() {
    const bars = rows.filter((r) => r.type === 'bar').map((r) => r.cells);
    if (bars.filter((c) => c.some((x) => x.trim())).length < 2) return '';
    const v = FP.cadence.variety(bars);
    const runs = v.runs.map(([a, z]) => `Bars ${a + 1}–${z + 1} share one cadence — switch it up around bar ${z + 1}?`);
    return `<p class="cadv"><b>Cadence variety ${Math.round(v.score * 100)}%</b>${runs.length ? runs.map((x) => `<span>${esc(x)}</span>`).join('') : '<span>Your bars switch their cadence up regularly.</span>'}</p>`;
  }
  VA.stats = () => {
    // sections by their labels (bars before the first label are the top of the song)
    const parts = [];
    rows.forEach((row) => {
      if (row.type === 'label') parts.push({ name: row.text, lines: [] });
      else if (row.type === 'bar') {
        if (!parts.length) parts.push({ name: 'Top', lines: [] });
        const t = barView(row.cells).text;
        if (t) parts[parts.length - 1].lines.push(t);
      }
    });
    const lines = parts.flatMap((p) => p.lines);
    const all = syl.stats(lines);
    const pct = (x) => `${Math.round(x * 100)}%`;
    const avg = (st) => (st.lines ? Math.round(st.syllables / st.lines) : 0);
    const sh = sheet({
      title: 'Song stats',
      html: `<div class="set-row"><div><div class="lbl">Syllables per bar</div><div class="sub">Bars more than 1 off the target get marked</div></div>
          <span class="nudge"><button type="button" class="btn" data-a="tdn" aria-label="Lower target">−</button><b id="tgv">${f.target || 'Off'}</b><button type="button" class="btn" data-a="tup" aria-label="Raise target">+</button><button type="button" class="btn" data-a="toff">Off</button></span></div>
        <div class="tiles">
          <div><b>${all.lines}</b><span>bars written</span></div>
          <div><b>${avg(all)}</b><span>syllables / bar</span></div>
          <div><b>${pct(all.density)}</b><span>words that rhyme</span></div>
          <div><b>${all.multis}</b><span>multi-syllable rhymes</span></div>
        </div>
        ${cadenceLine()}
        ${all.top.length ? `<div class="sec-h">Top rhyme sounds</div>${all.top.map((fam) => `<p class="fam">${fam.slice(0, 8).map(esc).join(' · ')}</p>`).join('')}` : ''}
        ${parts.length > 1 ? `<div class="sec-h">Sections</div><table class="st-t"><tr><th></th><th>bars</th><th>syl / bar</th><th>rhyme</th></tr>${parts.filter((p) => p.lines.length).map((p) => { const st = syl.stats(p.lines); return `<tr><td>${esc(p.name)}</td><td>${st.lines}</td><td>${avg(st)}</td><td>${pct(st.density)}</td></tr>`; }).join('')}</table>` : ''}
        <p class="src">Words that rhyme: share a rhyme sound with a different word nearby. Multis: runs of 2–3 syllables whose vowels repeat across lines.</p>`,
      actions: {
        tdn: () => setTarget((f.target || avg(all) || 12) - 1),
        tup: () => setTarget((f.target || avg(all) || 12) + 1),
        toff: () => setTarget(null),
      },
    });
    function setTarget(v) {
      f.target = v == null ? null : clamp(v, 4, 32);
      saveSoon('files', f);
      $('#tgv', sh.el).textContent = f.target || 'Off';
      paintAll();
    }
  };

  let lastW = 0;
  // the sheet changed size: wider / narrower refits the step text; and since bars off-screen only
  // take their real height once drawn, anything shifting moves the step box back over its step
  const ro = new ResizeObserver(() => {
    const w = box.clientWidth;
    if (w !== lastW) { lastW = w; refitAll(); }
    placeInput();
  });
  ro.observe(box);

  /**
   * A word from the strip, rhymes or bank goes onto the selected step: into a rest, finishing a
   * half-typed word, or — when the step already holds a word — in its place (the strip shows
   * rhymes for that word, so this swaps take → bake). Then the cursor moves on.
   */
  function insertWord(w) {
    if (!cur) { const r = rows.findIndex((x) => x.type === 'bar'); if (r < 0) return; cur = { r, k: Math.min(lastStep(r), lastFilled(r) + 1) }; }
    const row = rows[cur.r], k = cur.k;
    const ex = (row.cells[k] || '').trim().replace(/-$/, '');
    let p, swapped = null;
    if (!ex || w.toLowerCase().startsWith(ex.toLowerCase())) p = placeWords(cur.r, k, [w]);
    else {
      const old = wordAt(cur.r, k);
      for (let i = old.k0; i <= old.k1; i++) row.cells[i] = '';
      p = placeWords(cur.r, old.k0, [w]);
      swapped = old.text;
    }
    commit();
    sound();
    activate(p.r, Math.min(lastStep(p.r), p.k + 1), { focus: document.activeElement === inp });
    if (swapped) toast(`Swapped “${swapped}” for “${w}”`, { label: 'Undo', fn: undo });
  }

  // ---------------- beat placement ----------------
  function beatChanged() {
    paintAll();
    $('#songbeat').textContent = patName(f.beat.def);
    if (S.panel === 'beat') PBeat();
  }
  VA.fdef = () => { if (S.panel !== 'beat') togglePanel('beat'); }; // one place for the beat: its panel
  VA['bar-pat'] = (el) => {
    const i = rowOf(el);
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
    document.body.classList.toggle('pan', !!S.panel);
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
    undo: () => undo(), saveFlow: (r) => saveFlow(r), flowDots: (s0, n) => flowDots(s0, n), activate: (r, k) => activate(r, k),
  };
  const { PBeat, PTakes, syncTransport, updateTransportUI, stopPlayer, finishRec, loadTrack, hearBar, tapCadence } = editorAudio(ed);

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
    if (versionKey(f) !== openedAs) snapshot(f, 'Edited'); // the song as this session left it
    onScreen.disconnect();
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
    window.removeEventListener('resize', onViewW);
    clearTimeout(fullT);
    clearTimeout(stripT);
    E = null;
    S.cur = null;
    if (f.title === 'Untitled' && file(f.id)) {
      const l = firstLine(f);
      if (l) { f.title = l.length > 40 ? `${l.slice(0, 40).trim()}…` : l; saveSoon('files', f); }
    }
  });

  const start = () => {
    if (ed.gone) return;
    paintAll();
    if (cur) activate(cur.r, cur.k, { focus: false });
    renderPanel();
    updateStrip(true);
    updateTransportUI();
    // first time in the editor: where to start
    setTimeout(() => { if (!ed.gone) coach('step', box.querySelector('.cell.act') || box.querySelector('.cell'), '<b>Tap a step</b> and type. <b>Space</b> moves on, and long words split into syllables by themselves.'); }, 700);
  };
  // a long song: the screen comes up at once with placeholder bars, and fills in on the next frame
  if (rows.length > 60) {
    box.innerHTML = '<div class="skel-bar"></div>'.repeat(5);
    requestAnimationFrame(() => setTimeout(start, 0));
  } else start();
}
