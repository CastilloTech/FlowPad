/* LosSoulx FlowPad — the flow sheet's step model: laying words onto steps and editing them.
 *
 * A song is a list of rows: { type: 'bar', cells: [16 step strings], pat } |
 * { type: 'label', text } | { type: 'blank' }. A step holds what lands on it; a trailing "-"
 * means the word carries on into the next filled step ("ci-", "ty").
 *
 * Everything here is plain data in, data out (no DOM), so it runs under the unit tests too.
 * Editing functions that may insert a bar take `onInsert(at)` so the caller can shift any row
 * indexes it holds (cursor, playing bar).
 */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});
  const syl = () => FP.syl;

  const newBarRow = () => ({ type: 'bar', cells: new Array(16).fill(''), pat: null });
  const isBarRow = (rows, r) => !!rows[r] && rows[r].type === 'bar';

  /** A line as its syllables in order: { t, end } where `end` marks the last syllable of a word. */
  function sylPieces(text) {
    const flat = [];
    let lead = '';
    syl().analyzeLine(text).tokens.forEach((t) => {
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

  /** Syllables sharing one step → its text ("syl la-" joins to "sylla-", words keep their spaces). */
  function stepText(L) {
    if (!L.length) return '';
    let out = '';
    L.forEach((s, i) => { out += s.t; if (i < L.length - 1 && s.end) out += ' '; });
    return L[L.length - 1].end ? out : `${out}-`;
  }

  /** Lay a lyric line across 16 steps: 'even' spreads it over the bar, 'pack' puts one syllable per step. */
  function spreadCells(text, mode = 'even') {
    const flat = sylPieces(text);
    const cells = Array.from({ length: 16 }, () => []);
    flat.forEach((s, j) => cells[mode === 'pack' ? Math.min(15, j) : Math.min(15, Math.floor((j * 16) / flat.length))].push(s));
    return cells.map(stepText);
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

  /** The bar row after row r — a new one is inserted there if the next row isn't a bar. */
  function barAfter(rows, r, onInsert) {
    if (isBarRow(rows, r + 1)) return r + 1;
    rows.splice(r + 1, 0, newBarRow());
    if (onInsert) onInsert(r + 1);
    return r + 1;
  }

  /** The step after (r, k), carrying over into the next bar. */
  const nextPos = (rows, r, k, onInsert) => (k < 15 ? { r, k: k + 1 } : { r: barAfter(rows, r, onInsert), k: 0 });

  /**
   * Make room at step k of row r: it and the words right after it move one step later, up to
   * the next rest. With no rest left in the bar, the last step carries over into the next bar.
   */
  function pushAt(rows, r, k, onInsert) {
    const row = rows[r];
    let j = k;
    while (j <= 15 && row.cells[j].trim()) j++;
    if (j > 15) {
      const nr = barAfter(rows, r, onInsert);
      pushAt(rows, nr, 0, onInsert);
      rows[nr].cells[0] = row.cells[15];
      j = 15;
    }
    for (let i = j; i > k; i--) row.cells[i] = row.cells[i - 1];
    row.cells[k] = '';
  }

  /** Remove step k: everything after it moves one step earlier. */
  function pullAt(row, k) { row.cells.splice(k, 1); row.cells.push(''); }

  /**
   * Write words from step k of row r on: each word starts a step and its syllables flow into
   * the following steps, over the bar line if needed. Words already there are pushed later,
   * never overwritten — except the starting step when `replace` (the step being typed in).
   * Returns the last step used, { r, k }.
   */
  function placeWords(rows, r, k, words, replace = true, onInsert) {
    let pos = { r, k }, first = true;
    words.forEach((w, idx) => {
      wordSteps(w).forEach((s, j) => {
        if (idx > 0 || j > 0) pos = nextPos(rows, pos.r, pos.k, onInsert);
        if (!(first && replace) && rows[pos.r].cells[pos.k].trim()) pushAt(rows, pos.r, pos.k, onInsert);
        rows[pos.r].cells[pos.k] = s;
        first = false;
      });
    });
    return pos;
  }

  /** Move a step's words onto another step: replacing what's there, or shifting it along. */
  function moveStep(rows, fr, fk, tr, tk, shift, onInsert) {
    const text = rows[fr].cells[fk];
    rows[fr].cells[fk] = '';
    if (shift && rows[tr].cells[tk].trim()) pushAt(rows, tr, tk, onInsert);
    rows[tr].cells[tk] = text;
  }

  FP.sheet = { newBarRow, isBarRow, sylPieces, stepText, spreadCells, wordSteps, barAfter, nextPos, pushAt, pullAt, placeWords, moveStep };
})();
