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
  const TAPS = 12;
  const PHASES = [0.25, 0.5, 0.75].map((p) => Array.from({ length: 2 * TAPS }, (_, j) => {
    const x = j - TAPS + 1 - p; // distance from sample i + p to sample i + (j − TAPS + 1)
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS + 1));
    return (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
  }));

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
      for (let i = TAPS; i < c.length - TAPS; i++) {
        if (Math.abs(c[i]) < near && Math.abs(c[i + 1]) < near) continue;
        for (const h of PHASES) {
          let v = 0;
          for (let j = 0; j < h.length; j++) v += c[i - TAPS + 1 + j] * h[j];
          top = Math.max(top, Math.abs(v));
        }
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
        if (Math.abs(y1) + Math.abs(y2) < ceiling * 0.9) continue; // nowhere near: skip the guess
        const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3, b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, d = -0.5 * y0 + 0.5 * y2;
        for (const t of [0.25, 0.5, 0.75]) after = Math.max(after, Math.abs(((a * t + b) * t + d) * t + y1));
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
      let out = limit(chans.map((c) => scaled(c, fromDb(gainDb))), rate, { ceiling: fromDb(ceilingDb) });
      // whatever true peak is still over: turn it all down by that much — peaks go down exactly with it
      const over = toDb(truePeak(out)) - ceilingDb;
      if (over > 0) out = out.map((c) => scaled(c, fromDb(-over - 0.02)));
      const lufs = loudness(out, rate);
      // a louder round only wins if it's clearly closer: more gain that buys almost no loudness
      // (a very spiky mix) would just bring up the noise between the hits
      if (!best || Math.abs(lufs - target) < Math.abs(best.lufs - target) - 0.25) best = { chans: out, lufs, gainDb };
      if (Math.abs(lufs - target) < 0.2 || (gainDb >= maxGainDb && lufs < target)) break;
      // LU gained per dB last round: 1 while the limiter's idle, much less once it's squeezing
      const slope = prev && gainDb !== prev.gainDb ? Math.min(1, Math.max(0.15, (lufs - prev.lufs) / (gainDb - prev.gainDb))) : 1;
      prev = { gainDb, lufs };
      gainDb = Math.min(maxGainDb, gainDb + Math.max(-12, Math.min(12, (target - lufs) / slope)));
    }
    return { ...best, peakDb: toDb(truePeak(best.chans)) };
  }

  /**
   * The finished mix from its stems: the vocal set `vocalOverBeat` LU over the beat, added
   * together, then mastered. `beat` may be null (a take with no beat). Stems are the vocal's length.
   */
  function finish({ beat, vocal, rate, target = -14, ceilingDb = -1, vocalOverBeat = 1 }) {
    const lv = loudness(vocal, rate), lb = beat ? loudness(beat, rate) : -Infinity;
    const vocalGainDb = Number.isFinite(lv) && Number.isFinite(lb) ? Math.max(-18, Math.min(30, lb + vocalOverBeat - lv)) : 0;
    const gv = fromDb(vocalGainDb), n = vocal[0].length;
    const sum = vocal.map((v, c) => {
      const y = new Float32Array(n), b = beat && (beat[c] || beat[0]);
      for (let i = 0; i < n; i++) y[i] = v[i] * gv + (b && i < b.length ? b[i] : 0);
      return y;
    });
    return { ...master(sum, rate, { target, ceilingDb }), vocalGainDb };
  }

  /**
   * finish() in a worker, so the screen stays smooth (run here instead where workers can't start).
   * The stems are handed over, not copied: don't use them afterwards.
   */
  function finishOffThread(args) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('js/mix-worker.js'); } catch (e) { try { resolve(finish(args)); } catch (x) { reject(x); } return; }
      w.onmessage = (e) => { w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
      w.onerror = (e) => { w.terminate(); e.preventDefault(); reject(new Error(e.message || 'mix worker failed')); };
      w.postMessage(args, [...args.vocal, ...(args.beat || [])].map((c) => c.buffer).filter((b, i, a) => a.indexOf(b) === i));
    });
  }

  FP.mix = { toDb, fromDb, loudness, truePeak, limit, master, finish, finishOffThread };
})();
