const test = require('node:test');
const assert = require('node:assert/strict');
const { mix: M } = require('./setup.cjs');

/** `secs` of a sine (Hz, peak amplitude, phase) at `rate`. */
const sine = (secs, rate, hz, amp, phase = 0) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate + phase));
/** Repeatable noise in −amp…amp. */
const noise = (n, amp, seed = 7) => { let s = seed; return Float32Array.from({ length: n }, () => { s = (s * 16807) % 2147483647; return amp * (2 * (s / 2147483647) - 1); }); };
const peak = (chans) => Math.max(...chans.map((c) => c.reduce((m, x) => Math.max(m, Math.abs(x)), 0)));
const cat = (a, b) => { const y = new Float32Array(a.length + b.length); y.set(a); y.set(b, a.length); return y; };

test('loudness: a 1 kHz sine in both channels reads at its peak level in LUFS (the EBU R128 reference)', () => {
  for (const rate of [44100, 48000]) {
    const s = sine(5, rate, 1000, 0.1);
    assert.ok(Math.abs(M.loudness([s, s], rate) - -20) < 0.15, `${rate}: ${M.loudness([s, s], rate)}`);
    const q = sine(5, rate, 1000, 10 ** (-23 / 20));
    assert.ok(Math.abs(M.loudness([q, q], rate) - -23) < 0.15);
  }
});

test('loudness: silence is −Infinity, and quiet gaps don’t pull a song’s loudness down', () => {
  const rate = 44100;
  assert.equal(M.loudness([new Float32Array(rate * 2)], rate), -Infinity);
  const s = sine(4, rate, 1000, 0.1), gap = cat(s, new Float32Array(rate * 4));
  assert.ok(Math.abs(M.loudness([gap, gap], rate) - M.loudness([s, s], rate)) < 0.2);
});

test('true peak finds a peak that falls between samples', () => {
  // a quarter-rate sine 45° off: every sample is at 0.707 of a peak that’s never sampled
  const s = sine(0.5, 48000, 12000, 0.9, Math.PI / 4);
  assert.ok(peak([s]) < 0.65);
  assert.ok(Math.abs(M.toDb(M.truePeak([s])) - M.toDb(0.9)) < 0.3, `${M.toDb(M.truePeak([s]))}`);
});

test('limiter: nothing over the ceiling, and quiet parts away from the peaks untouched', () => {
  const rate = 44100, n = rate * 2;
  const l = noise(n, 0.2), r = noise(n, 0.2, 99);
  for (const at of [5000, 40000, 70000]) { l[at] = 1.8; r[at + 3] = -2.2; } // three sharp hits
  const [ol, or] = M.limit([l, r], rate, { ceiling: M.fromDb(-1) });
  assert.ok(peak([ol, or]) <= M.fromDb(-1) + 1e-6, `${peak([ol, or])}`);
  // a second after the last hit, the gain is back to (very nearly) 1
  assert.ok(Math.abs(ol[n - 10] - l[n - 10]) < 0.002);
});

test('master: a quiet mix comes up to the target, true peak under the ceiling', () => {
  const rate = 44100, l = noise(rate * 6, 0.05), r = noise(rate * 6, 0.05, 3);
  for (let i = 0; i < l.length; i += 11025) { l[i] = 0.3; r[i] = 0.3; } // transients to limit
  for (const target of [-14, -9]) {
    const m = M.master([l, r], rate, { target, ceilingDb: -1 });
    assert.ok(Math.abs(m.lufs - target) < 0.5, `target ${target}: ${m.lufs}`);
    assert.ok(m.peakDb <= -0.95, `true peak ${m.peakDb}`);
  }
});

test('master: a near-silent take is turned up at most 24 dB (not into a wall of noise)', () => {
  const rate = 44100, l = noise(rate * 4, 0.001);
  const m = M.master([l, l], rate, { target: -14 });
  assert.equal(m.gainDb, 24);
  assert.ok(m.lufs < -20);
});

test('finish: the vocal sits 1 LU over the beat, the mix at the target', () => {
  const rate = 44100;
  const beat = [noise(rate * 5, 0.3), noise(rate * 5, 0.3, 5)];
  const v = sine(5, rate, 220, 0.02);
  const r = M.finish({ beat, vocal: [v, v], rate, target: -14 });
  assert.ok(Math.abs(M.loudness([v.map((x) => x * M.fromDb(r.vocalGainDb)), v.map((x) => x * M.fromDb(r.vocalGainDb))], rate) - (M.loudness(beat, rate) + 1)) < 0.1);
  assert.ok(Math.abs(r.lufs - -14) < 0.5);
  assert.equal(r.chans[0].length, v.length);
  // no beat: just the vocal, mastered
  const solo = M.finish({ beat: null, vocal: [v, v], rate, target: -14 });
  assert.ok(Math.abs(solo.lufs - -14) < 0.5);
});

test('master: a dense, bright mix pushed loud keeps its true peak (between samples) under the ceiling', () => {
  const rate = 44100, l = noise(rate * 4, 0.4, 11), r = noise(rate * 4, 0.4, 12); // white noise: full of inter-sample peaks
  const m = M.master([l, r], rate, { target: -9, ceilingDb: -1 });
  assert.ok(Math.abs(m.lufs - -9) < 0.5, `${m.lufs}`);
  assert.ok(M.toDb(M.truePeak(m.chans)) <= -1, `true peak ${M.toDb(M.truePeak(m.chans))}`);
});
