const test = require('node:test');
const assert = require('node:assert/strict');
const { cadence: C, sheet: SH } = require('./setup.cjs');

/** A bar from a compact string: steps separated by spaces, "." = rest. */
const bar = (s, n = 16) => s.split(' ').map((x) => (x === '.' ? '' : x)).concat(new Array(n).fill('')).slice(0, n);
const show = (cells) => cells.map((c) => c || '.').join(' ').replace(/( \.)+$/, '');

test('pocket: stresses on 8ths are in the pocket, between them they are off (unless a drum hits there)', () => {
  const cls = new Array(16).fill('');
  [0, 2, 3, 6, 7].forEach((k) => { cls[k] = 's1'; });
  assert.deepEqual(C.pocket(cls), { stressed: 5, inPocket: 3, off: [3, 7] });
  assert.deepEqual(C.pocket(cls, new Set([7])).off, [3], 'a kick on step 8 makes that stress land');
});

test('pocket on triplet grids: every 8th-note triplet counts, 16th triplets on the 8th triplets', () => {
  const t12 = new Array(12).fill('s1');
  assert.equal(C.pocket(t12).off.length, 0);
  const t24 = new Array(24).fill(''); t24[1] = 's1'; t24[2] = 's1';
  assert.deepEqual(C.pocket(t24).off, [1]);
});

test('similarity compares cadences by timing, across grids', () => {
  assert.equal(C.similarity(bar('a . b . c'), bar('x . y . z')), 1);
  assert.equal(C.similarity(bar('a b c d'), bar('. . . . a b c d')), 0);
  // a 12-step bar hitting every 3rd step is the same cadence as a 16-step bar on the beats
  assert.equal(C.similarity(bar('a . . b . . c . . d', 12), bar('a . . . b . . . c . . . d')), 1);
});

test('repeats and variety find runs of the same cadence', () => {
  const same = bar('a . b . c . d');
  const other = bar('a b c d');
  const bars = [same, same, same, same, other, bar('')];
  assert.deepEqual(C.repeats(bars), [1, 2, 3, 4, 1, 1]);
  const v = C.variety(bars);
  assert.deepEqual(v.runs, [[0, 3]]);
  assert.equal(v.score, 2 / 5); // bar 1 and bar 5 switch it up, of 5 written bars
});

test('fromTaps snaps taps to the grid', () => {
  assert.deepEqual(C.fromTaps([0.01, 0.49, 0.52, 1.33, 2.55, 2.66], 2.667, 16), [0, 3, 8, 15]); // two taps near step 4 count once; one right at the bar line belongs to the next bar
  assert.deepEqual(C.fromTaps([0, 0.66, 1.33, 2.0], 2.667, 12), [0, 3, 6, 9]);
});

test('regrid keeps every syllable at its moment in the bar', () => {
  assert.equal(show(SH.regrid(bar('a . . . b . . . c'), 12)), 'a . . b . . c');
  assert.equal(show(SH.regrid(bar('a . . b . . c', 12), 16)), 'a . . . b . . . c');
  assert.equal(show(SH.regrid(bar('ci- ty . . lights'), 4)), 'city lights');
});

test('pushing words along a triplet bar carries over at its own last step', () => {
  const rows = [{ type: 'bar', pat: null, cells: bar('a b c d e f g h i j k l', 12) }, SH.newBarRow()];
  SH.pushAt(rows, 0, 0);
  assert.equal(show(rows[0].cells), '. a b c d e f g h i j k');
  assert.equal(show(rows[1].cells), 'l');
  assert.equal(SH.applyFlow('one two three', [0, 3, 6], 12).length, 12);
});
