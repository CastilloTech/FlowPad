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

// ---------- phase 2: decisions from measurements ----------
/** RMS level in dB of x[a…b) (seconds). */
const lvl = (x, rate, a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * rate); i < Math.floor(b * rate); i++) { s += x[i] * x[i]; n++; } return 10 * Math.log10(s / n); };
/** A one-pole low-pass (dull) or high-pass-ish tilt, to make a vocal stand-in sound dull or muddy. */
const lowpass = (x, k) => { const y = new Float32Array(x.length); let v = 0; for (let i = 0; i < x.length; i++) { v += (x[i] - v) * k; y[i] = v; } return y; };

test('ride: a quiet phrase comes up towards a loud one, and the gaps aren’t turned up', () => {
  const rate = 44100, x = new Float32Array(rate * 8);
  const quiet = sine(2, rate, 300, 0.03), loud = sine(2, rate, 300, 0.12), hiss = noise(rate * 8, 0.0005, 4);
  x.set(quiet, 0); x.set(loud, rate * 4);
  for (let i = 0; i < x.length; i++) x[i] += hiss[i];
  const before = lvl(x, rate, 4.5, 5.5) - lvl(x, rate, 0.5, 1.5);
  const r = M.ride([x], rate), y = r.chans[0];
  const after = lvl(y, rate, 4.5, 5.5) - lvl(y, rate, 0.5, 1.5);
  assert.ok(before > 11 && after < before - 5, `gap between phrases ${before.toFixed(1)} → ${after.toFixed(1)} dB`);
  // the silence after the quiet phrase keeps that phrase's gain, no more
  assert.ok(lvl(y, rate, 2.8, 3.2) - lvl(x, rate, 2.8, 3.2) <= lvl(y, rate, 1, 1.5) - lvl(x, rate, 1, 1.5) + 0.5);
});

test('EQ plan: a dull vocal gets presence and air, a muddy one a cut in the low mids', () => {
  const rate = 44100, n = rate * 4, raw = noise(n, 0.3, 21);
  const dull = M.eqPlan([lowpass(lowpass(raw, 0.15), 0.15)], rate); // −12 dB/octave above ~1 kHz
  assert.ok(dull.some((m) => m.hz >= 3000 && m.db > 0), JSON.stringify(dull));
  assert.ok(dull.every((m) => Math.abs(m.db) <= 4));
  const mud = M.applyEq([raw], rate, [{ hz: 300, db: 10 }])[0];
  const plan = M.eqPlan([mud], rate);
  assert.ok(plan.some((m) => m.hz === 300 && m.db < 0), JSON.stringify(plan));
  // applying it never makes the mud worse, and a few rounds clear it
  assert.ok(M.eqPlan(M.applyEq([mud], rate, plan), rate).every((m) => m.hz !== 300 || m.db >= plan.find((p) => p.hz === 300).db));
  let x = [mud];
  for (let k = 0; k < 4; k++) x = M.applyEq(x, rate, M.eqPlan(x, rate));
  assert.ok(!M.eqPlan(x, rate).some((m) => m.hz === 300));
});

test('de-ess: an "s" is turned down, the vowel next to it isn’t', () => {
  const rate = 44100, x = sine(2, rate, 400, 0.2);
  const s = M.applyEq([noise(rate * 2, 0.25, 8)], rate, [{ hz: 7500, db: 12 }])[0];
  for (let i = rate; i < rate * 1.25; i++) x[i] = s[i] * 0.5; // a quarter-second "s"
  const r = M.deEss([x], rate), y = r.chans[0];
  assert.ok(lvl(x, rate, 1.05, 1.2) - lvl(y, rate, 1.05, 1.2) >= 3, 'the s');
  assert.ok(Math.abs(lvl(x, rate, 0.2, 0.8) - lvl(y, rate, 0.2, 0.8)) < 0.3, 'the vowel');
  assert.ok(r.most <= -3);
});

test('duck: the beat’s middle dips while the vocal’s going, and only then', () => {
  const rate = 44100, n = rate * 4, tone = sine(4, rate, 2200, 0.3), low = sine(4, rate, 100, 0.3);
  const v = new Float32Array(n); v.set(sine(1.5, rate, 300, 0.2), rate * 2);
  const [mid, bass] = M.duck([tone, low], [v, v], rate);
  const during = lvl(tone, rate, 2.5, 3.2) - lvl(mid, rate, 2.5, 3.2);
  const before = lvl(tone, rate, 0.5, 1.5) - lvl(mid, rate, 0.5, 1.5);
  assert.ok(Math.abs(during - 3) < 0.3, `dip at 2.2 kHz while rapping ${during.toFixed(2)} dB`);
  assert.ok(lvl(low, rate, 2.5, 3.2) - lvl(bass, rate, 2.5, 3.2) < 0.3, 'the bass isn’t ducked');
  assert.ok(Math.abs(before) < 0.1, `before the vocal ${before.toFixed(2)} dB`);
});

test('finish with a preset: rides, EQs, de-esses, ducks, and still lands on the target', () => {
  const rate = 44100, n = rate * 6, beat = [noise(n, 0.2, 41), noise(n, 0.2, 42)];
  const v = lowpass(noise(n, 0.2, 43), 0.1);
  for (let i = 0; i < n; i++) v[i] *= (i / rate) % 1.5 < 1 ? (i < n / 2 ? 0.3 : 1) : 0; // phrases, the first half quieter
  const r = M.finish({ beat, vocal: [v, Float32Array.from(v)], rate, target: -14, preset: 'clean' });
  assert.ok(Math.abs(r.lufs - -14) < 0.5, `${r.lufs}`);
  assert.ok(r.peakDb <= -1);
  assert.ok(r.report.ride[1] > 2, JSON.stringify(r.report.ride));
  assert.ok(r.report.eq.length > 0);
  assert.equal(r.report.duck, 3);
});

// ---------- phase 3: noise reduction, presets, the original for comparing ----------
test('denoise: the hiss between lines comes down, the voice stays', () => {
  const rate = 44100, n = rate * 6, x = new Float32Array(n), hiss = noise(n, 0.01, 51);
  for (let i = 0; i < n; i++) {
    const t = i / rate, on = t % 2 < 1.2 && t > 0.6; // lines with gaps, a quiet start like a count-in
    x[i] = hiss[i] + (on ? 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.12 * Math.sin(2 * Math.PI * 660 * t) : 0);
  }
  const r = M.denoise({ chan: x, rate });
  assert.ok(r.cutDb <= -6, `noise floor down ${r.cutDb.toFixed(1)} dB`);
  assert.ok(lvl(x, rate, 1.65, 1.95) - lvl(r.chan, rate, 1.65, 1.95) >= 6, 'a gap');
  assert.ok(Math.abs(lvl(x, rate, 2.8, 3.1) - lvl(r.chan, rate, 2.8, 3.1)) < 1, 'a line');
});

test('denoise: with nothing to take out, it gives back exactly what went in (the FFT round trip)', () => {
  const rate = 44100, x = noise(rate * 3, 0.2, 53);
  const y = M.denoise({ chan: x, rate, maxCut: 0, over: 0, skipBelow: 999 }).chan;
  let err = 0;
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i]));
  assert.ok(err < 1e-5, `${err}`);
});

test('denoise: a take that’s already clean is left exactly as it was', () => {
  const rate = 44100, x = sine(4, rate, 220, 0.3), hiss = noise(x.length, 0.00001, 52);
  for (let i = 0; i < x.length; i++) x[i] = (i / rate) % 2 < 1 ? x[i] + hiss[i] : hiss[i];
  const r = M.denoise({ chan: x, rate });
  assert.equal(r.cutDb, 0);
  assert.equal(r.chan, x);
});

test('presets: Radio sets the vocal further over the beat than Clean; Lo-fi less', () => {
  const rate = 44100, n = rate * 4, beat = [noise(n, 0.2, 61), noise(n, 0.2, 62)], v = lowpass(noise(n, 0.2, 63), 0.3);
  const gain = (preset) => M.finish({ beat: beat.map((c) => c.slice()), vocal: [v.slice(), v.slice()], rate, preset }).vocalGainDb;
  const clean = gain('clean'), radio = gain('radio'), lofi = gain('lofi');
  assert.ok(radio > clean && clean > lofi, `${radio} > ${clean} > ${lofi}`);
  assert.equal(M.finish({ beat, vocal: [v, v], rate, preset: 'radio' }).report.preset, 'Radio');
});

test('rawLufs: how loud the untouched original is, to compare the mix at the same loudness', () => {
  const rate = 44100, n = rate * 4, beat = [noise(n, 0.1, 71), noise(n, 0.1, 72)], v = sine(4, rate, 300, 0.1);
  const r = M.finish({ beat: beat.map((c) => c.slice()), vocal: [v, v], rate, rawVoice: v.slice() });
  const sum = beat.map((c) => c.map((x, i) => x + v[i]));
  assert.ok(Math.abs(r.rawLufs - M.loudness(sum, rate)) < 0.05);
});
