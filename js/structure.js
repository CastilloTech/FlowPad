/* LosSoulx FlowPad — an imported beat: its tempo and bar 1, its drums bar by bar, and laying a song
 * out over the sections you mark on it. Plain data in, data out, so it runs under the unit tests too.
 */
(() => {
  'use strict';
  const FP = (globalThis.FP = globalThis.FP || {});

  // ---------- listening to a beat: tempo and bar 1 ----------
  const monoOf = (chans) => { if (chans.length < 2) return chans[0]; const m = new Float32Array(chans[0].length); for (let i = 0; i < m.length; i++) m[i] = (chans[0][i] + chans[1][i]) / 2; return m; };

  /**
   * How much the sound jumps up, every 10 ms (an "onset" curve): the low end (kicks) and the whole
   * (snares, hats, chords), each as its rises only. Also where the music starts: the first moment
   * within 30 dB of the loud parts (a video's quiet first second is skipped).
   */
  function onsets(x, rate) {
    const hop = Math.round(rate / 100), n = Math.floor(x.length / hop);
    const low = new Float32Array(n), all = new Float32Array(n), hi = new Float32Array(n), lvl = new Float32Array(n);
    const k = 1 - Math.exp((-2 * Math.PI * 150) / rate), kh = 1 - Math.exp((-2 * Math.PI * 5000) / rate);
    let lp = 0, hp = 0, pl = -9, pa = -9, ph = -9;
    for (let f = 0; f < n; f++) {
      let sl = 0, sa = 0, sh = 0, sv = 0, prev = 0;
      for (let i = f * hop, e = i + hop; i < e; i++) {
        const v = x[i]; lp += k * (v - lp); sl += lp * lp; const d = v - prev; prev = v; sa += d * d; sv += v * v;
        hp += kh * (v - hp); const t = v - hp; sh += t * t; // above ~5 kHz: hats, not voices
      }
      const vl = Math.log10(sl / hop + 1e-10), va = Math.log10(sa / hop + 1e-10), vh = Math.log10(sh / hop + 1e-10);
      low[f] = Math.max(0, vl - pl); all[f] = Math.max(0, va - pa); hi[f] = Math.max(0, vh - ph); pl = vl; pa = va; ph = vh;
      lvl[f] = Math.log10(sv / hop + 1e-10); // the plain level: a soft pad intro is music too
    }
    const sorted = Float32Array.from(lvl).sort(), loud = sorted[Math.floor(n * 0.9)] ?? 0;
    let start = 0;
    while (start < n - 1 && lvl[start] < loud - 3) start++; // 3 in log10 units of energy = 30 dB
    return { hop, low, all, hi, start };
  }

  /**
   * The beat's tempo and where bar 1 starts, from the first 90 s of music.
   * Tempo: the one that lines the onsets up best — at the beat, and above all a whole bar later,
   * where a real tempo's kick pattern comes back exactly — between about 70 and 170 BPM, and whose
   * beat the fastest steady pulse (the hats) splits in 2 or 4. That last test is what tells trap at
   * 140 from 70 (which would need 32nd-note hats) and from 93 (hats a third of a beat apart).
   * Bar 1: the first beat where the music starts — songs start on a downbeat — on the beat grid.
   * Pass `bpm` when it's known (from the file name) to find just bar 1. Returns { bpm, offset }.
   */
  function tempo(chans, rate, { bpm: known = null } = {}) {
    const x = monoOf(chans), o = onsets(x, rate), fps = rate / o.hop;
    const a = o.start, z = Math.min(o.low.length, a + Math.round(90 * fps));
    // each onset spread over ±20 ms: a kick a frame early or late (10 ms frames, beats that aren't a
    // whole number of them) still lines up with the next
    const blur = (e) => { const y = new Float32Array(e.length); for (let f = 0; f < e.length; f++) y[f] = 0.5 * e[f] + 0.25 * ((e[f - 1] || 0) + (e[f + 1] || 0)) + 0.1 * ((e[f - 2] || 0) + (e[f + 2] || 0)); return y; };
    o.low = blur(o.low); o.all = blur(o.all); o.hi = blur(o.hi);
    const span = (e) => e.subarray(a, z);
    const low = span(o.low), all = span(o.all), hi = span(o.hi);
    // autocorrelation at a lag (in 10 ms frames, fractional), relative to the curve's own energy
    const energy = (e) => { let t = 0; for (let f = 0; f < e.length; f++) t += e[f] * e[f]; return Math.max(1e-12, t); };
    const en = new Map([[low, energy(low)], [all, energy(all)], [hi, energy(hi)]]);
    const ac = (e, lag) => {
      const l0 = Math.floor(lag), w = lag - l0;
      let s0 = 0, s1 = 0;
      for (let f = l0 + 1; f < e.length; f++) { s0 += e[f] * e[f - l0]; s1 += e[f] * e[f - l0 - 1]; }
      return ((1 - w) * s0 + w * s1) / en.get(e);
    };
    // the fastest steady pulse — the hats, from the top end (rapped 16ths would fool the whole
    // sound): the first strong peak in its autocorrelation, 70–300 ms
    const acs = [];
    for (let l = 5; l <= 30; l++) acs.push([l, ac(hi, l)]);
    const top = Math.max(...acs.map(([, v]) => v));
    const peaks = acs.filter(([l, v], i) => i > 0 && i < acs.length - 1 && v >= acs[i - 1][1] && v >= acs[i + 1][1] && v > 0.6 * top && l >= 7);
    const pulse = top > 0.25 && peaks.length ? peaks[0][0] : null; // no steady top end (no hats): no say
    let bpm = known;
    if (!bpm) {
      let best = -1;
      for (let t = 55; t <= 210; t += 0.5) {
        const beat = (60 * fps) / t;
        // the bar counts most: hats (and rapped 16ths) hit every beat of a tempo twice too fast as well
        const sc = 0.5 * (ac(all, beat) + ac(low, beat)) + 0.5 * (ac(all, 2 * beat) + ac(low, 2 * beat)) + ac(all, 4 * beat) + 4 * ac(low, 4 * beat);
        // rap lives between about 70 (boom bap) and 170: even odds in there, less outside — and a
        // little less above 160 and below 72, where a beat read twice too fast or slow would land (a
        // phonk or trap beat at 135 read at 67.5) — slow boom bap starts about 72
        const out = t < 68 ? Math.log2(68 / t) : t > 172 ? Math.log2(t / 172) : 0;
        let prior = Math.exp(-0.5 * (out / 0.15) ** 2) * (t > 160 || t < 72 ? 0.85 : 1);
        if (pulse) {
          // how many of the fastest pulse fit in a beat: 2 or 4 (8ths, 16ths) is how beats go
          const r = beat / pulse, k = Math.round(r);
          prior *= Math.abs(r - k) > 0.2 * k ? 0.5 : k === 2 || k === 4 ? 1 : k === 3 ? 0.6 : 0.45; // hats on every beat: likely twice too fast
        }
        if (sc * prior > best) { best = sc * prior; bpm = t; }
      }
      // fine-tune over the whole song: a bar 8 and 16 bars on lines up only at the exact tempo (a
      // tempo 1 BPM out drifts a third of a bar over a song); a whole number when it's that close
      const allLow = o.low.subarray(a), allAll = o.all.subarray(a);
      en.set(allLow, energy(allLow)).set(allAll, energy(allAll));
      let fine = bpm, fb = -1;
      for (let t = bpm - 1.5; t <= bpm + 1.5; t += 0.05) {
        const bar = (240 * fps) / t;
        let sc = 0;
        for (const m of [1, 2, 4, 8, 16]) if (m * bar < allLow.length / 2) sc += ac(allLow, m * bar) + 0.5 * ac(allAll, m * bar);
        if (sc > fb) { fb = sc; fine = t; }
      }
      bpm = Math.abs(fine - Math.round(fine)) < 0.2 ? Math.round(fine) : Math.round(fine * 10) / 10;
    }
    // the beat grid: the phase where the onsets line up best, beat after beat
    const beat = (60 * fps) / bpm;
    let ph = 0, bestS = -1;
    for (let q = 0; q < beat; q += 0.5) {
      let sc = 0;
      for (let f = q; f < low.length; f += beat) { const i = Math.round(f); sc += low[i] + all[i] + 0.5 * ((low[i + 1] || 0) + (low[i - 1] || 0)); }
      if (sc > bestS) { bestS = sc; ph = q; }
    }
    // bar 1: where the music starts — on the grid's nearest beat when that's close (a slow fade-in
    // or a breath before the first hit), otherwise the start itself (the grid can lock onto off-beats)
    let g0 = a + ph;
    while (g0 - beat >= a - beat / 2) g0 -= beat;
    const f0 = Math.abs(g0 - a) <= 0.15 * beat ? g0 : a;
    return { bpm, offset: Math.max(0, Math.round((f0 / fps) * 100) / 100) };
  }

  /**
   * Lay a song's rows out over a structure: a label at each section, the song's bars kept in
   * order (bar k of the sheet plays over bar k of the beat), empty bars added to cover the whole
   * beat. Old labels and blank lines are replaced; written bars past the end go under "Extra".
   */
  function layout(rows, sections) {
    const bars = rows.filter((r) => r.type === 'bar');
    const total = sections.reduce((a, s) => a + s.bars, 0);
    while (bars.length < total) bars.push(FP.sheet.newBarRow());
    const out = [];
    let i = 0;
    sections.forEach((s, si) => {
      if (si) out.push({ type: 'blank' });
      out.push({ type: 'label', text: s.name });
      for (let k = 0; k < s.bars; k++) out.push(bars[i++]);
    });
    const extra = bars.slice(i);
    while (extra.length && extra[extra.length - 1].cells.every((c) => !c.trim())) extra.pop();
    if (extra.length) out.push({ type: 'blank' }, { type: 'label', text: 'Extra' }, ...extra);
    return out;
  }

  /** Tempo and bar 1, then (given those and how many bars) the sections: the worker's two jobs. */
  /**
   * The drums in a beat, bar by bar, on 16ths: where the kick, the snare (or clap) and the hats hit —
   * each heard in its own band (the kick below ~120 Hz, the snare's crack around 2 kHz, hats above
   * 6.5 kHz) as a jump in that band's level right on the step. Plus the beat's outline for a
   * timeline: its level every quarter bar, 0–1. Returns { hits: [{ kick, snare, hat }] (16-character
   * strings of 0 / 1 per bar), wave: [numbers] }.
   */
  function drums({ chans, rate: rate0, bpm, offset, bars }) {
    let x = monoOf(chans), rate = rate0;
    if (rate0 > 32000) {
      const h = new Float32Array(x.length >> 1), last = x.length - 1;
      for (let i = 0; i < h.length; i++) { const j = 2 * i; h[i] = 0.25 * x[j > 0 ? j - 1 : 0] + 0.5 * x[j] + 0.25 * x[j < last ? j + 1 : last]; }
      x = h; rate = rate0 / 2;
    }
    const { rbj, biquad } = FP.mix;
    const twice = (type, hz, q) => { const c = rbj(type, hz, rate, q), y = biquad(x, c); return biquad(y, c, y); };
    const step = (60 / bpm / 4) * rate, w = Math.max(8, Math.round(step / 4)); // four level readings a step
    const envelope = (y) => {
      const n = Math.floor(y.length / w), e = new Float32Array(n);
      for (let j = 0; j < n; j++) { let s = 0; for (let i = j * w, z = i + w; i < z; i++) s += y[i] * y[i]; e[j] = 10 * Math.log10(s / w + 1e-10); }
      return e;
    };
    const bands = { kick: envelope(twice('low', 120, 0.707)), snare: envelope(twice('band', 2000, 0.8)), hat: envelope(twice('high', 6500, 0.707)) };
    const whole = envelope(x);
    // how far under the whole mix a band can be and still be a drum of its own, not another's spill
    // (a kick's click reaches the snare's and the hats' bands too); hats are quiet by nature
    const under = { kick: 99, snare: 20, hat: 35 };
    const start = Math.round((offset * rate) / w);
    // how much each band jumps on each step (its level just after the step against half a step
    // before), and how loud it is just after
    const rise = {}, level = {}, total = bars * 16;
    for (const [k, e] of Object.entries(bands)) {
      const top = e.reduce((m, v) => Math.max(m, v), -200), r = new Float32Array(total), l = new Float32Array(total).fill(-200);
      for (let s = 0; s < total; s++) {
        const j = start + Math.round((s * step) / w);
        if (j + 1 >= e.length) break;
        const before = Math.min(e[j - 2] ?? -100, e[j - 1] ?? -100), after = Math.max(e[j], e[j + 1]); // before the file: silence
        l[s] = after;
        const mix = Math.max(whole[j], whole[j + 1] ?? whole[j]);
        r[s] = after > top - 35 && after > mix - under[k] ? Math.max(0, after - before) : 0; // and loud enough to be part of the beat
      }
      rise[k] = r; level[k] = l;
    }
    // a hit: a jump well above this band's usual ones (hats tick constantly; a kick lands a few times a
    // bar). The kick is the loudest thing in the low end — a bass note starts there too, quieter — and
    // a snare is a burst of noise, so it jumps in the top end too, where a voice mostly doesn't.
    // (and as loud as this beat's own kicks and snares usually are: a bar without one has none)
    const thr = {}, usual = {};
    for (const [k, r] of Object.entries(rise)) {
      const sorted = Float32Array.from(r).sort();
      thr[k] = Math.max(k === 'hat' ? 3 : 4, 0.45 * (sorted[Math.floor(sorted.length * 0.9)] || 0));
      const lv = [...level[k]].filter((_, i) => r[i] >= thr[k]).sort((a, b) => a - b);
      usual[k] = lv.length ? lv[Math.floor(lv.length * 0.75)] : -200;
    }
    const hits = [];
    for (let b = 0; b < bars; b++) {
      const at = (k, s) => b * 16 + s;
      const loudest = (k) => { let m = -200; for (let s = 0; s < 16; s++) if (rise[k][at(k, s)] >= thr[k]) m = Math.max(m, level[k][at(k, s)]); return m; };
      const lk = loudest('kick'), ls = loudest('snare');
      let kick = '', snare = '', hat = '';
      for (let s = 0; s < 16; s++) {
        const i = at(0, s);
        kick += rise.kick[i] >= thr.kick && level.kick[i] >= lk - 6 && level.kick[i] >= usual.kick - 5 ? '1' : '0';
        snare += rise.snare[i] >= thr.snare && level.snare[i] >= ls - 6 && level.snare[i] >= usual.snare - 5 && rise.hat[i] >= 0.5 * thr.hat ? '1' : '0';
        hat += rise.hat[i] >= thr.hat ? '1' : '0';
      }
      hits.push({ kick, snare, hat });
    }
    // the outline: the level every quarter bar, the loudest at 1 and 40 dB under it at 0
    const all = envelope(x), q = Math.max(1, Math.round((4 * step) / w)), wave = [];
    for (let j = start; j < all.length && wave.length < bars * 4; j += q) { let m = -200; for (let i = j; i < Math.min(all.length, j + q); i++) m = Math.max(m, all[i]); wave.push(m); }
    const peak = wave.reduce((m, v) => Math.max(m, v), -200);
    return { hits, wave: wave.map((v) => Math.round(Math.max(0, Math.min(1, (v - peak + 40) / 40)) * 100) / 100) };
  }

  FP.structure = { tempo, drums, layout };
})();
