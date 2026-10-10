const test = require('node:test');
const assert = require('node:assert/strict');
const { structure: ST, sheet: SH } = require('./setup.cjs');

/** Per-bar features for a beat made of [bars, level] parts (level in dB; fuller = louder and brighter). */
const beat = (...parts) => parts.flatMap(([bars, lvl]) => Array.from({ length: bars }, (_, i) => ({ rms: lvl + (i % 2) * 0.3, low: lvl - 3, high: lvl - 10 })));
const show = (secs) => secs.map((s) => `${s.name} ${s.bars}`).join(' | ');

test('detects intro, verses, hooks and outro from how full each part sounds', () => {
  const f = beat([4, -30], [16, -18], [8, -12], [16, -18], [8, -12], [4, -30]);
  assert.equal(show(ST.detect(f)), 'Intro 4 | Verse 1 16 | Hook 8 | Verse 2 16 | Hook 8 | Outro 4');
});

test('hooks that differ only in their top end, every 8 bars, are still found', () => {
  // measured from a rendered beat: same kick and loudness, hook adds chords and hats (+9 dB brightness)
  const part = (bars, rms, low, high) => Array.from({ length: bars }, () => ({ rms, low, high }));
  const f = [...part(4, -36.7, -42.5, -59.7), ...part(8, -19.9, -21.8, -47.2), ...part(8, -19.4, -21.7, -38.3),
    ...part(8, -19.9, -21.8, -47.2), ...part(8, -19.4, -21.7, -38.3), ...part(4, -36.6, -42.5, -59.5)];
  assert.equal(show(ST.detect(f)), 'Intro 4 | Verse 1 8 | Hook 8 | Verse 2 8 | Hook 8 | Outro 4');
});

test('a beat that never changes is one section', () => {
  assert.equal(show(ST.detect(beat([32, -15]))), 'Verse 32');
});

test('a short loop is one section', () => {
  assert.equal(show(ST.detect(beat([4, -15]))), 'Verse 4');
});

test('a ragged last bar joins the section before it', () => {
  const secs = ST.detect(beat([8, -20], [8, -10], [1, -10]));
  assert.equal(secs.reduce((a, s) => a + s.bars, 0), 17);
  assert.ok(secs.every((s) => s.bars >= 4));
});

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

// ---------- from the sound itself: tempo, bar 1, sections ----------
const { makeSong } = require('./fixtures/song.cjs');
require('../js/mix.js'); // the FFT
const analyse = (song) => {
  const g = ST.tempo(song.chans, song.rate);
  const bars = Math.round(((song.chans[0].length / song.rate - g.offset) * g.bpm) / 240);
  return { ...g, secs: show(ST.detect(ST.features(song.chans, song.rate, g.bpm, g.offset, bars))) };
};

test('a song: tempo, bar 1 after a video’s quiet lead-in, and its sections — verses and hook as loud as each other', () => {
  const r = analyse(makeSong({ bpm: 90, style: 'boombap', lead: 1.3, seed: 3, sections: [['intro', 4], ['verse', 16], ['hook', 8], ['verse', 16], ['hook', 8], ['outro', 4]] }));
  assert.equal(r.bpm, 90);
  assert.ok(Math.abs(r.offset - 1.3) < 0.05, `bar 1 at ${r.offset}s`);
  assert.equal(r.secs, 'Intro 4 | Verse 1 16 | Hook 8 | Verse 2 16 | Hook 8 | Outro 4');
});

test('trap at 140 isn’t read at 70 or 93, and a song that opens on its hook is named right', () => {
  const r = analyse(makeSong({ bpm: 140, style: 'trap', lead: 0.8, seed: 5, sections: [['intro', 4], ['hook', 8], ['verse', 16], ['hook', 8], ['verse', 16], ['hook', 8]] }));
  assert.equal(r.bpm, 140);
  assert.equal(r.secs.replace(/ 9$/, ' 8'), 'Intro 4 | Hook 8 | Verse 1 16 | Hook 8 | Verse 2 16 | Hook 8'); // the last hit may ring a bar on
});

test('a part heard once in the middle is a bridge', () => {
  const r = analyse(makeSong({ bpm: 84, style: 'boombap', lead: 0.5, seed: 7, sections: [['intro', 4], ['verse', 16], ['hook', 8], ['verse', 16], ['hook', 8], ['bridge', 8], ['hook', 8]] }));
  assert.equal(r.secs, 'Intro 4 | Verse 1 16 | Hook 8 | Verse 2 16 | Hook 8 | Bridge 8 | Hook 8');
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
  const r = analyse(makeSong({ bpm: 90, style: 'boombap', lead: 0, seed: 9, sections: [['intro', 4], ['verse', 16], ['hook', 8], ['verse', 16], ['hook', 8]] }));
  assert.ok(r.offset < 0.05, `bar 1 at ${r.offset}s`);
  assert.match(r.secs, /^Intro 4 \| Verse 1 16 \| Hook 8/);
});
