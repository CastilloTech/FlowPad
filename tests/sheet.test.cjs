const test = require('node:test');
const assert = require('node:assert/strict');
const { sheet: SH } = require('./setup.cjs');

/** A bar from a compact string: steps separated by spaces, "." = rest. */
const bar = (s) => ({ type: 'bar', pat: null, cells: s.split(' ').map((x) => (x === '.' ? '' : x)).concat(new Array(16).fill('')).slice(0, 16) });
const show = (row) => row.cells.map((c) => c || '.').join(' ').replace(/( \.)+$/, '');
const ALL = 'a b c d e f g h i j k l m n o p';

test('a typed word becomes one step per syllable', () => {
  assert.deepEqual(SH.wordSteps('syllable'), ['syl-', 'la-', 'ble']);
  assert.deepEqual(SH.wordSteps('ci-'), ['ci-']); // already broken by hand
  assert.deepEqual(SH.wordSteps('night'), ['night']);
});

test('spreading a line: pack puts one syllable per step', () => {
  assert.equal(SH.spreadCells('city lights glow', 'pack').slice(0, 5).join('|'), 'ci-|ty|lights|glow|');
});

test('pushAt moves words along to the next rest', () => {
  const rows = [bar('a b c . d')];
  SH.pushAt(rows, 0, 1);
  assert.equal(show(rows[0]), 'a . b c d');
});

test('pushAt on a full bar carries the last step into the next bar', () => {
  const rows = [bar(ALL), bar('x y')];
  SH.pushAt(rows, 0, 2);
  assert.equal(show(rows[0]), 'a b . c d e f g h i j k l m n o');
  assert.equal(show(rows[1]), 'p x y');
});

test('a full bar before a section label gets a new bar instead of spilling into the next section', () => {
  const rows = [bar(ALL), { type: 'label', text: 'Hook' }, bar('x')];
  const inserted = [];
  SH.pushAt(rows, 0, 0, (at) => inserted.push(at));
  assert.deepEqual(inserted, [1]);
  assert.equal(rows.length, 4);
  assert.equal(show(rows[1]), 'p');
  assert.equal(rows[2].type, 'label');
  assert.equal(show(rows[3]), 'x');
});

test('placeWords replaces the step being typed and pushes the rest', () => {
  const rows = [bar('a b c . d')];
  const end = SH.placeWords(rows, 0, 1, ['yellow']);
  assert.equal(show(rows[0]), 'a yel- low c d');
  assert.deepEqual(end, { r: 0, k: 2 });
});

test('placeWords carries over the bar line', () => {
  const rows = [bar('. . . . . . . . . . . . . . . x')];
  const end = SH.placeWords(rows, 0, 14, ['syllable'], false);
  assert.equal(rows.length, 2);
  assert.equal(show(rows[0]), '. . . . . . . . . . . . . . syl- la-');
  assert.equal(show(rows[1]), 'ble x');
  assert.deepEqual(end, { r: 1, k: 0 });
});

test('moveStep: replace or shift', () => {
  const a = [bar('a b c')];
  SH.moveStep(a, 0, 0, 0, 1, false);
  assert.equal(show(a[0]), '. a c');
  const b = [bar('a b c')];
  SH.moveStep(b, 0, 0, 0, 1, true);
  assert.equal(show(b[0]), '. a b c');
});

test('pullAt removes a step and pulls the rest back', () => {
  const rows = [bar('a . b c')];
  SH.pullAt(rows[0], 1);
  assert.equal(show(rows[0]), 'a b c');
});
