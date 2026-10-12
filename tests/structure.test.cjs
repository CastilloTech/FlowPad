const test = require('node:test');
const assert = require('node:assert/strict');
const { structure: ST, sheet: SH } = require('./setup.cjs');

test('layout: labels at each section, bars kept in order, padded to the beat', () => {
  const bar = (w) => ({ type: 'bar', pat: null, cells: [w, ...new Array(15).fill('')] });
  const rows = [{ type: 'label', text: 'Verse 1' }, bar('one'), bar('two'), { type: 'blank' }, bar('three')];
  const out = ST.layout(rows, [{ name: 'Intro', bars: 1 }, { name: 'Verse', bars: 3 }]);
  const view = out.map((r) => (r.type === 'label' ? `[${r.text}]` : r.type === 'blank' ? '' : r.cells[0] || '·')).join(' ');
  assert.equal(view, '[Intro] one  [Verse] two three ·');
});

test('layout keeps written bars past the end of the beat under "Extra"', () => {
  const rows = [SH.newBarRow(), SH.newBarRow(), SH.newBarRow()];
  rows[2].cells[0] = 'kept';
  const out = ST.layout(rows, [{ name: 'Hook', bars: 1 }]);
  assert.deepEqual(out.map((r) => r.type === 'label' ? r.text : r.type), ['Hook', 'bar', 'blank', 'Extra', 'bar', 'bar']);
  assert.equal(out[5].cells[0], 'kept');
});

// ---------- from the sound itself: tempo and bar 1 ----------
const { makeSong, makeLoopBeat } = require('./fixtures/song.cjs');
require('../js/mix.js'); // the filters
const SONG = [['intro', 4], ['verse', 16], ['hook', 8], ['verse', 16], ['hook', 8]];

test('tempo and bar 1 after a video’s quiet lead-in', () => {
  const s = makeSong({ bpm: 90, style: 'boombap', lead: 1.3, seed: 3, sections: SONG });
  const r = ST.tempo(s.chans, s.rate);
  assert.equal(r.bpm, 90);
  assert.ok(Math.abs(r.offset - 1.3) < 0.05, `bar 1 at ${r.offset}s`);
});

test('trap at 140 isn’t read at 70 or 93', () => {
  const s = makeSong({ bpm: 140, style: 'trap', lead: 0.8, seed: 5, sections: SONG });
  assert.equal(ST.tempo(s.chans, s.rate).bpm, 140);
});

test('tempo: a kick on every beat, at any sample rate, is that tempo', () => {
  for (const rate of [22050, 48000]) {
    const x = new Float32Array(Math.ceil(((4 * 240) / 90) * rate));
    for (let b = 0; b < 16; b++) {
      let ph = 0;
      for (let i = 0; i < 0.32 * rate; i++) { const u = i / rate; ph += (2 * Math.PI * (u < 0.15 ? 120 * (45 / 120) ** (u / 0.15) : 45)) / rate; x[Math.floor(((b * 60) / 90) * rate) + i] += 0.9 * (0.001 / 0.9) ** Math.min(1, u / 0.3) * Math.sin(ph); }
    }
    assert.deepEqual(ST.tempo([x], rate), { bpm: 90, offset: 0 }, `${rate} Hz`);
  }
});

test('a soft pad intro is part of the song: bar 1 is where it starts, not where the drums come in', () => {
  const s = makeSong({ bpm: 90, style: 'boombap', lead: 0, seed: 9, sections: SONG });
  const r = ST.tempo(s.chans, s.rate);
  assert.ok(r.offset < 0.05, `bar 1 at ${r.offset}s`);
});

test('a phonk-style beat on 8th-note hats isn’t read at half speed', () => {
  const s = makeLoopBeat({ bpm: 135, seed: 4, sections: [['bare', 8], ['full', 16], ['lift', 16], ['full', 16]] });
  assert.equal(ST.tempo(s.chans, s.rate).bpm, 135);
});

test('drums: the kick, snare and hats of a song, bar by bar — none in the intro, none where there are none', () => {
  const secs = [['intro', 4], ['verse', 8], ['hook', 4]];
  const s = makeSong({ bpm: 90, style: 'boombap', lead: 0.5, sections: secs, seed: 11 });
  const r = ST.drums({ chans: s.chans, rate: s.rate, bpm: 90, offset: s.start, bars: s.bars });
  assert.equal(r.hits.length, 16);
  assert.deepEqual(r.hits[1], { kick: '0'.repeat(16), snare: '0'.repeat(16), hat: '0'.repeat(16) }, 'the intro is only chords');
  for (const b of [5, 9, 13]) {
    assert.equal(r.hits[b].kick, '1000000100100000', `bar ${b + 1} kick`);
    assert.equal(r.hits[b].snare, '0000100000001000', `bar ${b + 1} snare`);
  }
  // hats on the 8ths, mostly heard (a voice on top can hide one)
  const hats = r.hits.slice(4).map((h) => h.hat), on8ths = hats.flatMap((h) => [...h].filter((_, i) => i % 2 === 0));
  assert.ok(on8ths.filter((c) => c === '1').length / on8ths.length >= 0.7);
  assert.ok(hats.every((h) => [...h].every((c, i) => i % 2 === 0 || c === '0')), 'none off the 8ths');
  assert.equal(r.wave.length, 64);
});

test('drums: a beat that is only kicks has no snare or hats (a kick’s click spills into their bands)', () => {
  for (const rate of [22050, 48000]) {
    const x = new Float32Array(Math.ceil(((4 * 240) / 90) * rate));
    for (let b = 0; b < 16; b++) {
      let ph = 0;
      for (let i = 0; i < 0.32 * rate; i++) { const u = i / rate; ph += (2 * Math.PI * (u < 0.15 ? 120 * (45 / 120) ** (u / 0.15) : 45)) / rate; x[Math.floor(((b * 60) / 90) * rate) + i] += 0.9 * (0.001 / 0.9) ** Math.min(1, u / 0.3) * Math.sin(ph); }
    }
    const r = ST.drums({ chans: [x], rate, bpm: 90, offset: 0, bars: 4 });
    assert.deepEqual(r.hits.map((h) => h.kick), new Array(4).fill('1000100010001000'), `${rate} Hz`);
    assert.ok(r.hits.every((h) => h.snare === '0'.repeat(16) && h.hat === '0'.repeat(16)));
  }
});
