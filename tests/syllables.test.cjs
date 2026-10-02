const test = require('node:test');
const assert = require('node:assert/strict');
const { syl } = require('./setup.cjs');

const split = (w) => syl.wordInfo(w).syls.map((s) => s.t).join('-');

test('words split where you would say them', () => {
  const cases = {
    syllable: 'syl-la-ble', single: 'sin-gle', little: 'lit-tle', table: 'ta-ble', tickle: 'tick-le',
    counted: 'count-ed', running: 'run-ning', missing: 'miss-ing', darkness: 'dark-ness',
    really: 'real-ly', lonely: 'lone-ly', supply: 'sup-ply', reply: 're-ply',
    something: 'some-thing', nothing: 'no-thing', myself: 'my-self', microphone: 'mi-cro-phone',
    city: 'ci-ty', money: 'mo-ney', every: 'ev-ery', children: 'chil-dren', exit: 'ex-it',
    pressure: 'pres-sure', people: 'peo-ple',
  };
  for (const [w, want] of Object.entries(cases)) assert.equal(split(w), want, w);
});

test('splitting keeps the original letters and punctuation', () => {
  assert.equal(split('Syllable'), 'Syl-la-ble');
  assert.equal(syl.wordInfo('lights,').syls.map((s) => s.t).join(''), 'lights,');
});

test('syllable counts', () => {
  assert.equal(syl.lineCount('Every single syllable is counted in the flow'), 13);
  assert.equal(syl.lineCount('Late night, pen tight, city lights glow'), 8);
  assert.equal(syl.count('16 bars'), 3); // six-teen bars
});

test('stress: one stressed syllable per content word, function words unstressed', () => {
  const st = (w) => syl.wordInfo(w).syls.map((s) => s.s);
  assert.deepEqual(st('control'), [0, 1]);
  assert.deepEqual(st('city'), [1, 0]);
  assert.deepEqual(st('the'), [0]);
  assert.deepEqual(st('night'), [1]);
});

test('rhyme chains: repeated multi-syllable vowel runs, different words', () => {
  const lines = ['Late night, pen tight, city lights glow', 'Ten bites, then the pity nights go', 'Kick on the one and the snare on the two'];
  const ch = syl.chains(lines);
  const marked = (li) => syl.analyzeLine(lines[li]).tokens.filter((t) => t.word).flatMap((t) => t.syls.map((s) => s.t)).filter((_, j) => ch[li][j] >= 0).join(' ');
  assert.equal(marked(0), 'pen tight ci ty lights');
  assert.equal(marked(1), 'Ten bites pi ty nights');
  assert.equal(marked(2), ''); // function words and lone syllables don't chain
  assert.equal(ch[0][4], ch[1][4]); // "city lights" and "pity nights" are one chain
  assert.notEqual(ch[0][2], ch[0][4]); // "pen tight" is another
});

test('vowel sounds for common irregular words', () => {
  const v = (w) => syl.wordInfo(w).syls.map((s) => s.v).join(' ');
  assert.equal(v('one'), 'AH');
  assert.equal(v('go'), 'OW');
  assert.equal(v('snare'), 'EH');
  assert.equal(v('bites'), 'AY');
  assert.equal(v('city'), 'IH IY');
});

test('rhyme keys match rhyming words', () => {
  assert.equal(syl.rhymeKey('glow'), syl.rhymeKey('flow'));
  assert.equal(syl.rhymeKey('night'), syl.rhymeKey('tight'));
  assert.notEqual(syl.rhymeKey('night'), syl.rhymeKey('flow'));
});
