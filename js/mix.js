/* LosSoulx FlowPad — mixing and mastering maths: loudness (ITU-R BS.1770 / EBU R128), true peak,
 * a look-ahead limiter, balancing a vocal over a beat, and bringing a mix to a loudness target.
 *
 * Channels are plain Float32Arrays of samples; nothing here touches Web Audio or the DOM, so it runs
 * in a worker (js/mix-worker.js) and under the unit tests.
 */
(() => {
  'use strict';
  const FP = (globalThis.FP = globalThis.FP || {});

  const toDb = (x) => 20 * Math.log10(Math.max(x, 1e-12));
  const fromDb = (d) => 10 ** (d / 20);

  /** BS.1770's K-weighting at any sample rate: a high shelf (the head), then a high-pass. Each is [b0, b1, b2, a1, a2]. */
  function kFilters(rate) {
    let K = Math.tan((Math.PI * 1681.974450955533) / rate);
    const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416, Q1 = 0.7071752369554196;
    let a0 = 1 + K / Q1 + K * K;
    const shelf = [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0];
    K = Math.tan((Math.PI * 38.13547087602444) / rate);
    const Q2 = 0.5003270373238773;
    a0 = 1 + K / Q2 + K * K;
    const hp = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0];
    return [shelf, hp];
  }
  function biquad(x, [b0, b1, b2, a1, a2]) {
    const y = new Float32Array(x.length);
    let z1 = 0, z2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i], o = b0 * v + z1;
      z1 = b1 * v - a1 * o + z2;
      z2 = b2 * v - a2 * o;
      y[i] = o;
    }
    return y;
  }

  /**
   * Integrated loudness in LUFS: K-weighted, in 400 ms blocks every 100 ms, ignoring silence
   * (below −70 LUFS) and the quiet parts (10 LU under the rest). −Infinity when there's nothing.
   */
  function loudness(chans, rate) {
    const [shelf, hp] = kFilters(rate);
    const hop = Math.round(0.1 * rate), hops = Math.floor(chans[0].length / hop);
    const e = new Float64Array(hops); // K-weighted energy per 100 ms, summed over the channels
    for (const c of chans) {
      const k = biquad(biquad(c, shelf), hp);
      for (let j = 0; j < hops; j++) {
        let a = 0;
        for (let i = j * hop, z = i + hop; i < z; i++) a += k[i] * k[i];
        e[j] += a;
      }
    }
    const blocks = [];
    for (let j = 0; j + 4 <= hops; j++) blocks.push((e[j] + e[j + 1] + e[j + 2] + e[j + 3]) / (4 * hop));
    const L = (z) => -0.691 + 10 * Math.log10(z);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const loud = blocks.filter((z) => z > 0 && L(z) > -70);
    if (!loud.length) return -Infinity;
    const gate = L(mean(loud)) - 10;
    return L(mean(loud.filter((z) => L(z) > gate)));
  }

  // 4× oversampling for true peak: three in-between phases of a Hann-windowed sinc, 24 taps each
  const TAPS = 12, K = 2 * TAPS;
  const kernel = (p) => Float64Array.from({ length: K }, (_, j) => {
    const x = j - TAPS + 1 - p; // distance from sample i + p to sample i + (j − TAPS + 1)
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS + 1));
    return (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
  });
  const H1 = kernel(0.25), H2 = kernel(0.5), H3 = kernel(0.75);

  /**
   * The highest peak a mix reaches once it's turned back into sound, between the samples too (as a
   * linear level). Only spots near the top are oversampled — a peak between two samples can't be
   * more than a few dB over both of them.
   */
  function truePeak(chans) {
    let top = 0;
    for (const c of chans) for (let i = 0; i < c.length; i++) top = Math.max(top, Math.abs(c[i]));
    const near = top * fromDb(-4);
    for (const c of chans) {
      for (let i = TAPS, z = c.length - TAPS; i < z; i++) {
        if (c[i] < near && c[i] > -near && c[i + 1] < near && c[i + 1] > -near) continue;
        let v1 = 0, v2 = 0, v3 = 0;
        for (let j = 0, o = i - TAPS + 1; j < K; j++, o++) { const x = c[o]; v1 += x * H1[j]; v2 += x * H2[j]; v3 += x * H3[j]; }
        if (v1 < 0) v1 = -v1;
        if (v2 < 0) v2 = -v2;
        if (v3 < 0) v3 = -v3;
        if (v1 > top) top = v1;
        if (v2 > top) top = v2;
        if (v3 > top) top = v3;
      }
    }
    return top;
  }

  /**
   * A look-ahead peak limiter: no sample goes over `ceiling` (linear). The gain starts coming down
   * `lookahead` seconds before a peak, so it never snaps, and comes back over `release` seconds.
   */
  function limit(chans, rate, { ceiling = fromDb(-1), lookahead = 0.005, release = 0.08 } = {}) {
    const n = chans[0].length, W = Math.max(1, Math.round(lookahead * rate));
    // the gain each sample needs to stay under the ceiling — counting the peaks between it and the
    // next sample too (a cubic guess at ¼, ½, ¾ of the way), which bright, loud mixes are full of
    const need = new Float32Array(n);
    let before = 0; // the highest peak between the previous sample and this one
    for (let i = 0; i < n; i++) {
      let p = before, after = 0;
      for (const c of chans) {
        const y0 = c[i > 0 ? i - 1 : 0], y1 = c[i], y2 = c[i + 1 < n ? i + 1 : i], y3 = c[i + 2 < n ? i + 2 : n - 1];
        p = Math.max(p, Math.abs(y1));
        if (y1 < ceiling * 0.7 && y1 > -ceiling * 0.7 && y2 < ceiling * 0.7 && y2 > -ceiling * 0.7) continue; // nowhere near: skip the guess
        const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3, b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, d = -0.5 * y0 + 0.5 * y2;
        const q1 = Math.abs(((a * 0.25 + b) * 0.25 + d) * 0.25 + y1), q2 = Math.abs(((a * 0.5 + b) * 0.5 + d) * 0.5 + y1), q3 = Math.abs(((a * 0.75 + b) * 0.75 + d) * 0.75 + y1);
        after = Math.max(after, q1, q2, q3);
      }
      p = Math.max(p, after); // a peak between two samples needs both of them turned down
      before = after;
      need[i] = p > ceiling ? ceiling / p : 1;
    }
    // the lowest of the next W samples' needs (a sliding minimum, scanning backwards)
    const ahead = new Float32Array(n), dq = new Int32Array(n);
    let h = 0, t = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (t > h && need[dq[t - 1]] >= need[i]) t--;
      dq[t++] = i;
      while (dq[h] > i + W - 1) h++;
      ahead[i] = need[dq[h]];
    }
    // averaged over the last W samples — every one of them covers the peak, so the average still
    // holds it under — then released slowly; coming down is never slower than the average
    const rc = 1 - Math.exp(-1 / (release * rate));
    const out = chans.map(() => new Float32Array(n));
    let acc = W, g = 1;
    for (let i = 0; i < n; i++) {
      acc += ahead[i] - (i >= W ? ahead[i - W] : 1);
      const avg = acc / W;
      g = avg < g ? avg : g + (avg - g) * rc;
      for (let c = 0; c < chans.length; c++) {
        const v = chans[c][i] * g;
        out[c][i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v; // rounding, never more
      }
    }
    return out;
  }

  const scaled = (c, g) => { const y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = c[i] * g; return y; };

  /**
   * Bring a mix to `target` LUFS with its true peak at most `ceilingDb`: turn it up (or down),
   * limit, measure, correct. The harder the limiter works, the less loudness each dB of gain buys
   * (a spiky mix), so each correction uses how much the last one actually bought.
   */
  function master(chans, rate, { target = -14, ceilingDb = -1, maxGainDb = 24 } = {}) {
    const before = loudness(chans, rate);
    if (!Number.isFinite(before)) return { chans, lufs: before, peakDb: toDb(truePeak(chans)), gainDb: 0 };
    let gainDb = Math.min(maxGainDb, target - before), prev = null, best = null;
    for (let round = 0; round < 6; round++) {
      // the limiter already allows for peaks between samples; the exact check is once, at the end
      const out = limit(chans.map((c) => scaled(c, fromDb(gainDb))), rate, { ceiling: fromDb(ceilingDb) });
      const lufs = loudness(out, rate);
      // a round wins if it's on target, or clearly closer for what it costs: gain that buys almost
      // no loudness (a spiky mix, already at the ceiling) would only flatten the hits harder
      const miss = Math.abs(lufs - target), better = best ? Math.abs(best.lufs - target) - miss : Infinity;
      if (!best || miss < 0.3 || (better >= 0.25 && better >= 0.15 * (gainDb - best.gainDb))) best = { chans: out, lufs, gainDb };
      if (miss < 0.2 || (gainDb >= maxGainDb && lufs < target)) break;
      // LU gained per dB last round: 1 while the limiter's idle, much less once it's squeezing
      const slope = prev && gainDb !== prev.gainDb ? Math.min(1, Math.max(0.15, (lufs - prev.lufs) / (gainDb - prev.gainDb))) : 1;
      prev = { gainDb, lufs };
      gainDb = Math.min(maxGainDb, gainDb + Math.max(-12, Math.min(12, (target - lufs) / slope)));
    }
    // peaks between samples the limiter's quick guess missed (a very bright mix): limit again that
    // much lower — only the peaks come down — and if any still get over, turn it all down by that
    // much, which brings every peak down exactly with it
    let { chans: out, lufs } = best, tp = toDb(truePeak(out));
    if (tp > ceilingDb) {
      out = limit(out, rate, { ceiling: fromDb(ceilingDb - (tp - ceilingDb) - 0.05) });
      tp = toDb(truePeak(out));
      if (tp > ceilingDb) { out = out.map((c) => scaled(c, fromDb(ceilingDb - 0.02 - tp))); tp = ceilingDb - 0.02; }
      lufs = loudness(out, rate);
    }
    return { chans: out, lufs, gainDb: best.gainDb, peakDb: tp };
  }

  // ---------- phase 2: decisions from measurements ----------
  /** RBJ biquads as [b0, b1, b2, a1, a2]: peaking EQ, band-pass (0 dB at its centre), high-pass. */
  function rbj(type, f, rate, Q = 0.707, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate, cw = Math.cos(w), al = Math.sin(w) / (2 * Q), A = 10 ** (gainDb / 40);
    const [b0, b1, b2, a0, a1, a2] = type === 'peak' ? [1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A]
      : type === 'band' ? [al, 0, -al, 1 + al, -2 * cw, 1 - al]
        : type === 'low' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al]
          : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al];
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  /** Both channels as one (for measuring). */
  const monoOf = (chans) => {
    if (chans.length === 1) return chans[0];
    const m = new Float32Array(chans[0].length);
    for (let i = 0; i < m.length; i++) { let a = 0; for (const c of chans) a += c[i]; m[i] = a / chans.length; }
    return m;
  };
  /** RMS level (dB) of x in windows of `win` samples, one every `hop` samples (window centred on the hop). */
  function levels(x, win, hop) {
    const sq = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];
    const n = Math.ceil(x.length / hop), out = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const mid = j * hop + (hop >> 1), a = Math.max(0, mid - (win >> 1)), b = Math.min(x.length, mid + (win >> 1));
      out[j] = 10 * Math.log10(Math.max((sq[b] - sq[a]) / Math.max(1, b - a), 1e-12));
    }
    return out;
  }
  /** Which frames are someone rapping: within 25 dB of the loud parts, and not near-silence. */
  function voicedOf(lv) {
    const sorted = Float32Array.from(lv).sort();
    const loud = sorted[Math.floor(sorted.length * 0.95)] ?? -120;
    return Array.from(lv, (l) => l > Math.max(-60, loud - 25));
  }
  /** Per-frame gains (dB) → per-sample linear gains, interpolated between frame centres. */
  function perSample(gDb, hop, n) {
    const lin = Float32Array.from(gDb, fromDb), last = lin.length - 1, g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = (i - hop / 2) / hop, j = f < 0 ? 0 : Math.min(last, Math.floor(f)), k = j < last ? j + 1 : last, t = f < j ? 0 : Math.min(1, f - j);
      g[i] = lin[j] + (lin[k] - lin[j]) * t;
    }
    return g;
  }
  /**
   * Smooth per-frame gains (dB): forwards, going down at the `down` rate and back up at the `up`
   * rate (time constants in frames) — then backwards at the `down` rate only, so a cut starts a
   * moment early instead of late, without its slow release also reaching back in time.
   */
  function smooth(v, down, up = down) {
    const a = (tc) => 1 - Math.exp(-1 / Math.max(1e-6, tc));
    const ad = a(down), au = a(up), out = Float32Array.from(v);
    let y = out[0];
    for (let i = 0; i < out.length; i++) { y += (out[i] - y) * (out[i] < y ? ad : au); out[i] = y; }
    y = out[out.length - 1];
    for (let i = out.length - 1; i >= 0; i--) { y += (out[i] - y) * ad; out[i] = y; }
    return out;
  }

  /**
   * Level riding: each phrase brought towards the take's typical level (up to ±range dB, `amount`
   * of the way) before anything else, so a line you turned away for sits with the rest. A phrase is
   * a run of rapping with no gap over ¼ s; it gets one gain, measured over all of it (so its quiet
   * edges don't count as a quiet phrase). Gaps keep the gain of the phrase before — silence is
   * never turned up past it.
   */
  function ride(chans, rate, { range = 6, amount = 0.7 } = {}) {
    const hop = Math.round(0.05 * rate), lv = levels(monoOf(chans), hop, hop), voiced = voicedOf(lv);
    // phrases: voiced runs, joined over gaps shorter than ¼ s
    const phrases = [];
    for (let j = 0; j < lv.length; j++) {
      if (!voiced[j]) continue;
      const p = phrases[phrases.length - 1];
      if (p && j - p.z <= 5) p.z = j; else phrases.push({ a: j, z: j });
    }
    const energy = (p) => { let e = 0, n = 0; for (let j = p.a; j <= p.z; j++) if (voiced[j]) { e += 10 ** (lv[j] / 10); n++; } return 10 * Math.log10(e / n); };
    phrases.forEach((p) => { p.level = energy(p); });
    if (phrases.length < 2) return { chans, range: [0, 0] };
    const sorted = phrases.map((p) => p.level).sort((a, b) => a - b), target = sorted[sorted.length >> 1];
    const gDb = new Float32Array(lv.length);
    let k = 0;
    for (let j = 0; j < lv.length; j++) {
      while (k + 1 < phrases.length && phrases[k + 1].a <= j) k++;
      const p = phrases[k];
      gDb[j] = Math.max(-range, Math.min(range, (target - p.level) * amount)); // before the first phrase: its gain
    }
    const sm = smooth(gDb, 0.15 * rate / hop);
    const g = perSample(sm, hop, chans[0].length);
    const gains = phrases.map((p) => gDb[p.a]);
    return {
      chans: chans.map((c) => { const y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = c[i] * g[i]; return y; }),
      range: [Math.min(0, ...gains), Math.max(0, ...gains)],
    };
  }

  /** A polished rap vocal's tone: each band's level (constant-Q) against the 700 Hz band. */
  const VOICE_CURVE = [[120, -10], [300, -3], [700, 0], [1500, -3], [3000, -6], [6000, -10], [11000, -16]];
  /**
   * EQ from measuring the vocal: its level in each band (only while rapping) against the curve,
   * and a peaking move `amount` of the way back for every band more than a dB off — at most ±4 dB,
   * and only cuts in the lows (the rumble is already gone). Returns [{ hz, db }].
   */
  function eqPlan(chans, rate, { amount = 0.6, max = 4, presence = 0 } = {}) {
    const all = monoOf(chans), hop = Math.round(0.05 * rate), voiced = voicedOf(levels(all, Math.round(0.4 * rate), hop));
    const frames = voiced.map((v, j) => (v ? j : -1)).filter((j) => j >= 0);
    if (frames.length < 4) return [];
    // a tone is a long-term thing: up to 40 s of rapping (in ½ s pieces, spread over the take) tells it
    const pieces = [];
    for (let j = 0; j < voiced.length; j += 10) if (voiced.slice(j, j + 10).every(Boolean)) pieces.push(j);
    const keep = pieces.length > 80 ? pieces.filter((_, i) => i % Math.ceil(pieces.length / 80) === 0) : pieces;
    const x = keep.length >= 4 ? new Float32Array(keep.length * 10 * hop) : all;
    if (x !== all) keep.forEach((j, i) => x.set(all.subarray(j * hop, (j + 10) * hop), i * 10 * hop));
    const skip = Math.round(0.02 * rate); // where the filters settle
    const meas = VOICE_CURVE.map(([hz]) => {
      const bp = rbj('band', hz, rate, 1.4), y = biquad(biquad(x, bp), bp); // 4th order: little leaks in from the neighbours
      let e = 0, n = 0;
      if (x !== all) for (let i = skip; i < y.length; i++) { e += y[i] * y[i]; n++; }
      else for (const j of frames) for (let i = j * hop, z = Math.min(y.length, i + hop); i < z; i++) { e += y[i] * y[i]; n++; }
      return 10 * Math.log10(Math.max(e / Math.max(1, n), 1e-12));
    });
    const ref = (meas[2] + meas[3]) / 2 - (VOICE_CURVE[2][1] + VOICE_CURVE[3][1]) / 2;
    return VOICE_CURVE.map(([hz, want], i) => {
      let db = Math.max(-max, Math.min(max, (want + (hz >= 2000 ? presence : 0) - (meas[i] - ref)) * amount));
      if (hz < 200) db = Math.min(0, db);
      return { hz, db: Math.round(db * 2) / 2 };
    }).filter((m) => Math.abs(m.db) >= 1 && m.hz < rate * 0.45);
  }
  const applyEq = (chans, rate, plan) => chans.map((c) => plan.reduce((y, m) => biquad(y, rbj('peak', m.hz, rate, 1, m.db)), c));

  /**
   * De-essing: where the top (over `freq`) is close to as loud as the whole voice — an "s", "sh",
   * "t" — that top is turned down, by up to `maxCut` dB, for just as long as it lasts. The voice is
   * split with a Linkwitz-Riley crossover, whose two halves add back up flat.
   */
  function deEss(chans, rate, { freq = 5500, threshold = -8, maxCut = 8 } = {}) {
    const hp = rbj('high', freq, rate, 0.707), lp = rbj('low', freq, rate, 0.707);
    const top = (x) => biquad(biquad(x, hp), hp), bottom = (x) => biquad(biquad(x, lp), lp);
    const x = monoOf(chans), hop = Math.round(0.002 * rate), win = Math.round(0.006 * rate);
    const lx = levels(x, win, hop), ls = levels(top(x), win, hop);
    const cut = new Float32Array(lx.length);
    for (let j = 0; j < cut.length; j++) cut[j] = lx[j] > -50 ? -Math.min(maxCut, Math.max(0, ls[j] - lx[j] - threshold)) : 0;
    const sm = smooth(cut, 0.001 * rate / hop, 0.04 * rate / hop);
    let most = 0;
    for (const v of sm) most = Math.min(most, v);
    if (most > -0.5) return { chans, most: 0 }; // nothing harsh: leave it exactly as it was
    const g = perSample(sm, hop, x.length);
    return {
      chans: chans.map((c) => { const t = top(c), b = bottom(c), y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = b[i] + t[i] * g[i]; return y; }),
      most,
    };
  }

  /** Ducking: while the vocal's going, the beat's 1–4 kHz (where words are understood) dips by up to `depth` dB. */
  function duck(beat, vocal, rate, { depth = 3 } = {}) {
    const hop = Math.round(0.01 * rate), voiced = voicedOf(levels(monoOf(vocal), Math.round(0.03 * rate), hop));
    const amt = smooth(Float32Array.from(voiced, (v) => (v ? -depth : 0)), 0.02 * rate / hop, 0.3 * rate / hop);
    const g = perSample(amt, hop, beat[0].length);
    const band = rbj('band', 2200, rate, 0.7);
    return beat.map((c) => { const m = biquad(c, band), y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = c[i] + m[i] * (g[i] - 1); return y; });
  }

  /**
   * How each vocal sound is set. `chain` is the Web Audio part (js/audio.js): compression, room,
   * band limits. The rest is here: how far the EQ goes and how bright it leans, the vocal over the
   * beat (LU), the duck under it (dB), and an optional darker mix.
   */
  const PRESETS = {
    clean: { name: 'Clean', eqAmount: 0.6, presence: 0, over: 1, duck: 3, chain: { ratio: 3, threshold: -24, room: 0.14 } },
    radio: { name: 'Radio', eqAmount: 0.7, presence: 1.5, over: 2, duck: 4, chain: { ratio: 4, threshold: -27, room: 0.07 } },
    lofi: { name: 'Lo-fi', eqAmount: 0.3, presence: -2, over: 0, duck: 2, mixLowpass: 9000, chain: { ratio: 3, threshold: -22, room: 0.24, low: 200, high: 6000 } },
  };

  // ---------- noise reduction ----------
  /** An in-place radix-2 FFT for size n (a power of 2), with its tables made once: fft(re, im, inverse). */
  function makeFft(n) {
    const rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      rev[i] = j;
    }
    for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos((2 * Math.PI * k) / n); sin[k] = -Math.sin((2 * Math.PI * k) / n); }
    return (re, im, inverse) => {
      for (let i = 1; i < n; i++) { const j = rev[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      const sg = inverse ? -1 : 1;
      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1, step = n / len;
        for (let i = 0; i < n; i += len) {
          for (let k = 0, t = 0; k < half; k++, t += step) {
            const cr = cos[t], ci = sg * sin[t], a = i + k, b = a + half;
            const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
            re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          }
        }
      }
      if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    };
  }

  /**
   * Noise reduction for a take (one channel). The noise is measured in its quietest moments — the
   * count-in, the gaps between lines — and taken out of every moment by how much of each frequency
   * it explains, by up to `maxCut` dB (more would leave a watery, "musical" sound). A take that's
   * already clean (noise over `skipBelow` dB under the voice) is left exactly as it was.
   * Returns { chan, cutDb } — how far the noise floor came down.
   */
  function denoise({ chan, rate, maxCut = 12, over = 2, skipBelow = 45 }) {
    // 46 ms frames, half overlapping; a √Hann window on the way in and out adds back up to exactly 1
    const N = 2048, H = N / 2, n = chan.length, frames = Math.floor((n - N) / H) + 1;
    if (frames < 16) return { chan, cutDb: 0 };
    const win = Float64Array.from({ length: N }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)));
    // each frame's energy; the quietest tenth (not digital silence) is the noise
    const energy = new Float64Array(frames);
    for (let f = 0; f < frames; f++) { let e = 0; for (let i = 0; i < N; i++) { const v = chan[f * H + i] * win[i]; e += v * v; } energy[f] = e / N; }
    const order = [...energy.keys()].filter((f) => energy[f] > 1e-12).sort((a, b) => energy[a] - energy[b]);
    if (order.length < 16) return { chan, cutDb: 0 };
    const quiet = order.slice(0, Math.max(8, Math.floor(order.length / 10)));
    const loud = order.slice(Math.floor(order.length / 2));
    const mean = (fs) => fs.reduce((a, f) => a + energy[f], 0) / fs.length;
    if (10 * Math.log10(mean(loud) / mean(quiet)) > skipBelow) return { chan, cutDb: 0 };
    // the noise's spectrum: averaged over the quiet frames
    const fft = makeFft(N), re = new Float64Array(N), im = new Float64Array(N), noise = new Float64Array(N / 2 + 1);
    for (const f of quiet) {
      for (let i = 0; i < N; i++) { re[i] = chan[f * H + i] * win[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k <= N / 2; k++) noise[k] += (re[k] * re[k] + im[k] * im[k]) / quiet.length;
    }
    // every frame: each frequency turned down by the share of it the noise explains, smoothed
    // across neighbouring frequencies and over time, then added back up. Two frames go through each
    // FFT together (one as the real part, one as the imaginary), and are pulled apart again.
    const floor = fromDb(-maxCut), out = new Float32Array(n), weight = new Float32Array(n), M2 = N / 2;
    const prev = new Float64Array(M2 + 1).fill(1), g = new Float64Array(M2 + 1), v1 = new Float64Array(M2 + 1), v2 = new Float64Array(M2 + 1);
    const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
    const gains = (pr, pi, v) => { // the gains for one frame's spectrum (pr, pi), after the frame before
      for (let k = 0; k <= M2; k++) { const pw = pr[k] * pr[k] + pi[k] * pi[k]; g[k] = Math.max(floor, Math.sqrt(Math.max(0, 1 - (over * noise[k]) / Math.max(pw, 1e-20)))); }
      for (let k = 0; k <= M2; k++) { v[k] = 0.7 * ((g[k > 0 ? k - 1 : 0] + g[k] + g[k < M2 ? k + 1 : M2]) / 3) + 0.3 * prev[k]; prev[k] = v[k]; }
    };
    for (let f = 0; f < frames; f += 2) {
      const two = f + 1 < frames;
      for (let i = 0; i < N; i++) { re[i] = chan[f * H + i] * win[i]; im[i] = two ? chan[(f + 1) * H + i] * win[i] : 0; }
      fft(re, im);
      // the two frames' spectra: X1 = (Z[k] + conj Z[N−k]) / 2, X2 = (Z[k] − conj Z[N−k]) / 2i
      for (let k = 0; k < N; k++) {
        const m = (N - k) & (N - 1);
        ar[k] = (re[k] + re[m]) / 2; ai[k] = (im[k] - im[m]) / 2;
        br[k] = (im[k] + im[m]) / 2; bi[k] = -(re[k] - re[m]) / 2;
      }
      gains(ar, ai, v1);
      if (two) gains(br, bi, v2);
      // back together: Y = v1·X1 + i·v2·X2, so the way back gives frame one real, frame two imaginary
      for (let k = 0; k < N; k++) {
        const q = k <= M2 ? k : N - k, g1 = v1[q], g2 = two ? v2[q] : 0;
        re[k] = g1 * ar[k] - g2 * bi[k];
        im[k] = g1 * ai[k] + g2 * br[k];
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) { out[f * H + i] += re[i] * win[i]; weight[f * H + i] += win[i] * win[i]; }
      if (two) for (let i = 0; i < N; i++) { out[(f + 1) * H + i] += im[i] * win[i]; weight[(f + 1) * H + i] += win[i] * win[i]; }
    }
    // the frames' windows add up to 1 except at the very start and end, where only one frame reaches:
    // divide by what they add up to there, and where it's next to nothing keep the take as it was
    for (let i = 0; i < n; i++) out[i] = weight[i] > 0.1 ? out[i] / weight[i] : chan[i];
    let e0 = 0, e1 = 0;
    for (const f of quiet) for (let i = f * H + N / 4; i < f * H + (3 * N) / 4; i++) { e0 += chan[i] * chan[i]; e1 += out[i] * out[i]; }
    return { chan: out, cutDb: 10 * Math.log10(Math.max(e1, 1e-20) / Math.max(e0, 1e-20)) };
  }

  /**
   * The finished mix from its stems. With a `preset` (clean / radio / lofi), the vocal is ridden,
   * EQ'd from its own measurements, and de-essed; then it's set over the beat, the beat ducks under
   * it, and the whole is mastered. `beat` may be null (a take with no beat). Stems are the vocal's
   * length. With `rawVoice` (the take as recorded), `rawLufs` says how loud the original — beat plus
   * take, untouched — is, so the two can be compared at the same loudness. `report` says what was done.
   */
  function finish({ beat, vocal, rate, target = -14, ceilingDb = -1, preset = null, rawVoice = null }) {
    const report = {}, P = PRESETS[preset];
    let rawLufs = null;
    if (rawVoice) {
      const n = vocal[0].length;
      const raw = [0, 1].map((c) => { const y = new Float32Array(n), b = beat && (beat[c] || beat[0]); for (let i = 0; i < n; i++) y[i] = (i < rawVoice.length ? rawVoice[i] : 0) + (b && i < b.length ? b[i] : 0); return y; });
      rawLufs = loudness(raw, rate);
    }
    if (P) {
      report.preset = P.name;
      const r = ride(vocal, rate);
      report.ride = r.range;
      const plan = eqPlan(r.chans, rate, { amount: P.eqAmount, presence: P.presence });
      report.eq = plan;
      const d = deEss(applyEq(r.chans, rate, plan), rate);
      report.deEss = d.most;
      vocal = d.chans;
    }
    const over = P ? P.over : 1;
    const lv = loudness(vocal, rate), lb = beat ? loudness(beat, rate) : -Infinity;
    const vocalGainDb = Number.isFinite(lv) && Number.isFinite(lb) ? Math.max(-18, Math.min(30, lb + over - lv)) : 0;
    if (beat && Number.isFinite(lv)) { const depth = P ? P.duck : 3; beat = duck(beat, vocal, rate, { depth }); report.duck = depth; }
    const gv = fromDb(vocalGainDb), n = vocal[0].length;
    let sum = vocal.map((v, c) => {
      const y = new Float32Array(n), b = beat && (beat[c] || beat[0]);
      for (let i = 0; i < n; i++) y[i] = v[i] * gv + (b && i < b.length ? b[i] : 0);
      return y;
    });
    if (P && P.mixLowpass) { const lp = rbj('low', P.mixLowpass, rate, 0.707); sum = sum.map((c) => biquad(c, lp)); }
    return { ...master(sum, rate, { target, ceilingDb }), vocalGainDb, report, rawLufs };
  }

  /**
   * A job in a worker, so the screen stays smooth: 'finish' (the mix), 'denoise' (a take), or an
   * imported beat's 'timing' (tempo, bar 1) or 'sections' (js/structure.js). It runs
   * here instead where workers can't start. Arrays passed in are handed over, not copied: don't use
   * them afterwards.
   */
  function offThread(op, args) {
    const run = () => (op === 'denoise' ? denoise(args) : op === 'finish' ? finish(args)
      : op === 'timing' ? FP.structure.tempo(args.chans, args.rate, { bpm: args.bpm }) : { sections: FP.structure.sections(args) });
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('js/mix-worker.js'); } catch (e) { try { resolve(run()); } catch (x) { reject(x); } return; }
      w.onmessage = (e) => { w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
      w.onerror = (e) => { w.terminate(); e.preventDefault(); reject(new Error(e.message || 'mix worker failed')); };
      const arrays = [...(args.vocal || []), ...(args.beat || []), ...(args.chans || []), args.rawVoice, args.chan].filter(Boolean);
      w.postMessage({ op, args }, arrays.map((c) => c.buffer).filter((b, i, a) => a.indexOf(b) === i));
    });
  }
  const finishOffThread = (args) => offThread('finish', args);

  FP.mix = { makeFft, PRESETS, toDb, fromDb, loudness, truePeak, limit, master, ride, eqPlan, applyEq, deEss, duck, denoise, finish, offThread, finishOffThread };
})();
