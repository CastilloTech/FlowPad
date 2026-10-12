/* LosSoulx FlowPad — the structure of an imported beat (Intro · Verse · Hook · Outro) and laying a
 * song out to match it. Plain data in, data out, so it runs under the unit tests too.
 */
(() => {
  'use strict';
  const FP = (globalThis.FP = globalThis.FP || {});

  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

  // ---------- listening to a beat: tempo, bar 1, and what each bar sounds like ----------
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
   * What each bar sounds like, for telling sections apart: loudness, bass and brightness (dB), the
   * level in six bands from bass to air, and its chroma — how much of each of the 12 notes it holds
   * (the chords: a verse and a hook usually go round different ones). One { rms, low, high, bands,
   * chroma } per bar, from `offset` seconds, at `bpm`.
   */
  function features(chans, rate0, bpm, offset, bars) {
    // 44.1 / 48 kHz halved first: the sections are all below 11 kHz, and it's four times less work
    let x = monoOf(chans), rate = rate0;
    if (rate0 > 32000) {
      const h = new Float32Array(x.length >> 1);
      const last = x.length - 1;
      for (let i = 0; i < h.length; i++) { const j = 2 * i; h[i] = 0.25 * x[j > 0 ? j - 1 : 0] + 0.5 * x[j] + 0.25 * x[j < last ? j + 1 : last]; }
      x = h; rate = rate0 / 2;
    }
    // ~0.19 s windows: about 5 Hz apart — enough to tell low notes apart
    const len = (240 / bpm) * rate, N = 2 ** Math.round(Math.log2(rate * 0.186)), half = N / 2;
    const fft = FP.mix.makeFft(N), re = new Float64Array(N), im = new Float64Array(N);
    const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    const hz = (k) => (k * rate) / N, edges = [0, 150, 400, 1000, 2500, 6000, rate / 2];
    const pc = Int8Array.from({ length: half }, (_, k) => (k && hz(k) >= 60 && hz(k) <= 5000 ? ((Math.round(12 * Math.log2(hz(k) / 440)) % 12) + 12 + 9) % 12 : -1));
    const band = Int8Array.from({ length: half }, (_, k) => edges.findIndex((e, i) => hz(k) >= e && hz(k) < edges[i + 1]));
    const notes = Int32Array.from([...pc.keys()].filter((k) => pc[k] >= 0)); // the bins that count towards chroma
    const maxFrames = Math.ceil((2 * len) / N) + 2, held = new Float32Array(maxFrames * notes.length), col = new Float32Array(maxFrames);
    const db = (v) => 10 * Math.log10(v + 1e-10);
    const out = [];
    for (let b = 0; b < bars; b++) {
      const a = Math.floor(offset * rate + b * len), e = Math.min(x.length, Math.floor(a + len));
      if (a >= x.length) break;
      let s = 0, lo = 0, hi = 0, prev = 0;
      const k1 = 1 - Math.exp((-2 * Math.PI * 150) / rate);
      let lp = 0;
      for (let i = a; i < e; i++) { const v = x[i]; lp += k1 * (v - lp); s += v * v; lo += lp * lp; const d = v - prev; prev = v; hi += d * d; }
      const n = Math.max(1, e - a), chroma = new Float64Array(12), bands = new Float64Array(6);
      let frames = 0;
      for (let f = a; (f + N <= e || (frames === 0 && f < e)) && frames < maxFrames; f += N / 2) {
        const avail = Math.min(N, x.length - f); // reads stay inside the take (out of range is slow)
        for (let i = 0; i < avail; i++) { re[i] = x[f + i] * win[i]; im[i] = 0; }
        for (let i = avail; i < N; i++) { re[i] = 0; im[i] = 0; }
        fft(re, im);
        for (let k = 1; k < half; k++) if (band[k] >= 0) bands[band[k]] += re[k] * re[k] + im[k] * im[k];
        for (let j = 0; j < notes.length; j++) { const k = notes[j]; held[frames * notes.length + j] = re[k] * re[k] + im[k] * im[k]; }
        frames++;
      }
      // the notes held through the bar — chords, pads, the bass — not the passing ones (a rapped
      // syllable's pitch): each bin at its 30th percentile over the bar's frames
      const q = Math.floor(0.3 * (frames - 1));
      for (let j = 0; j < notes.length; j++) {
        for (let t = 0; t < frames; t++) col[t] = held[t * notes.length + j];
        const c = col.subarray(0, frames).sort();
        chroma[pc[notes[j]]] += c[q];
      }
      // centred (each note against the bar's average) and to unit length: the chord's notes stand out
      const cm = chroma.reduce((t, v) => t + v, 0) / 12;
      for (let i = 0; i < 12; i++) chroma[i] -= cm;
      const norm = Math.hypot(...chroma) || 1;
      out.push({ rms: db(s / n), low: db(lo / n), high: db(hi / n), bands: Array.from(bands, (v) => db(v / Math.max(1, frames))), chroma: Array.from(chroma, (v) => v / norm) });
    }
    return out;
  }

  // ---------- sections ----------
  /** How different two bars' notes are: 0 the same, 1 opposite (from their cosine similarity). */
  const chromaDist = (p, q) => { let d = 0; for (let i = 0; i < 12; i++) d += p[i] * q[i]; return (1 - d) / 2; };

  /**
   * Split a beat into sections from per-bar features (see features(); old-style { rms, low, high }
   * only works too). The beat is cut into 4-bar blocks; blocks are grouped by how alike they are —
   * bar for bar, in their chords and their tone — so the parts that come back (verses, hooks) are
   * recognised as the same part. A section is a run of one group. Names: a short distinct start is
   * the Intro, a short distinct end the Outro; of the parts that come back, the fuller one is the
   * Hook (or the shorter, when they're as full as each other) and the other the Verse; a part that
   * comes once in the middle is a Bridge. Returns [{ name, bars }].
   */
  function detect(feats, block = 4) {
    const n = feats.length;
    if (n < 2 * block) return [{ name: 'Verse', bars: n }];
    const hasChroma = !!feats[0].chroma;
    // levels relative to the whole beat (a 1.5 dB floor keeps tiny wobbles from counting)
    const keys = ['rms', 'low', 'high'];
    const lv = feats.map((f) => (hasChroma ? [...keys.map((k) => f[k]), ...f.bands] : keys.map((k) => f[k])));
    const dims = lv[0].length, z = lv.map(() => new Float64Array(dims));
    for (let d = 0; d < dims; d++) {
      const col = lv.map((v) => v[d]), m = mean(col), s = Math.max(1.5, sd(col));
      col.forEach((v, i) => { z[i][d] = (v - m) / s; });
    }
    const full = feats.map((_, i) => z[i][0] + z[i][2]); // loudness + brightness: how full it sounds
    // blocks, and how different two blocks are: bar for bar, chords and tone
    let blocks = [];
    for (let a = 0; a < n; a += block) blocks.push({ a, bars: Math.min(block, n - a) });
    const barDist = (i, j) => {
      let t = 0;
      for (let d = 0; d < dims; d++) t += Math.abs(z[i][d] - z[j][d]);
      t /= dims;
      return hasChroma ? 0.5 * t + 2 * chromaDist(feats[i].chroma, feats[j].chroma) : t;
    };
    // two blocks: their notes bar for bar (chords come in order), and their tone on average over the
    // block (single bars wobble — a drum fill, a chord change — while a part's sound holds steady)
    // (a whole 8-bar loop is heard by its first half: a drop or a fill sits at the end of a part)
    const toneOf = (b) => { const m = b.bars > block ? block : b.bars, t = new Float64Array(dims); for (let k = 0; k < m; k++) for (let d = 0; d < dims; d++) t[d] += z[b.a + k][d] / m; return t; };
    const tones = new Map();
    const tone = (b) => { const key = `${b.a}:${b.bars}`; if (!tones.has(key)) tones.set(key, toneOf(b)); return tones.get(key); };
    const blockDist = (p, q) => {
      const m = Math.min(p.bars, q.bars, block), tp = tone(p), tq = tone(q); // a loop's first half, as above
      let t = 0, c = 0;
      for (let d = 0; d < dims; d++) t += Math.abs(tp[d] - tq[d]);
      t /= dims;
      if (!hasChroma) return t;
      for (let k = 0; k < m; k++) c += chromaDist(feats[p.a + k].chroma, feats[q.a + k].chroma);
      return t + 2 * (c / m);
    };
    let D = blocks.map((p) => blocks.map((q) => blockDist(p, q)));
    const eps = hasChroma ? 0.02 : 0.2;
    // the beat's loop: when each block matches the one two back (8 bars) much better than the one
    // before (4 bars), the music goes round 8 bars at a time — two 4-bar halves with different chords
    // — and inside a section neighbouring blocks always differ. Then compare whole loops: pair the
    // blocks up, the pairs starting where the changes start (a 4-bar intro first, say).
    if (blocks.length >= 6) {
      // the lower quarter of each: with short parts, many comparisons cross a change
      const low = (a) => { const t = [...a].sort((x, y) => x - y); return t.length ? t[t.length >> 2] : 0; };
      const lag = (L) => low(blocks.slice(L).map((_, j) => D[j + L][j]));
      if (lag(2) + eps / 2 < 0.5 * lag(1)) {
        const nov = blocks.map((_, j) => (j >= 2 ? D[j][j - 2] : 0)), rise = [0, 0];
        for (let j = 3; j < blocks.length; j++) rise[j % 2] += Math.max(0, nov[j] - nov[j - 1]);
        const units = [];
        let j = 0;
        if (rise[1] > rise[0]) units.push(blocks[j++]);
        for (; j < blocks.length; j += 2) units.push(j + 1 < blocks.length ? { a: blocks[j].a, bars: blocks[j].bars + blocks[j + 1].bars } : blocks[j]);
        blocks = units;
        D = blocks.map((p) => blocks.map((q) => blockDist(p, q)));
      }
    }
    // a part-bar at the end (the last hit ringing out) takes no part in telling sections apart
    const tail = blocks.length > 2 && blocks[blocks.length - 1].bars < block ? 1 : 0;
    const B = blocks.length - tail;
    // "the same part": closer than the first big jump up from the smallest block-to-block steps
    // (within a section) — the jump to the steps across a change. The first, not the biggest: a beat
    // can change a little (verse to hook) and a lot (pad to drums), and both are changes. A small
    // floor keeps the near-zero steps between identical bars from looking like jumps. A beat whose
    // biggest step is no bigger than its usual wobble never changes: it's one part.
    const steps = D.slice(1, B).map((row, j) => row[j]).sort((a, b) => a - b);
    let tau = Infinity;
    if (steps.length) {
      // the first jump that's about as big as the biggest (never asking for more than 2.5×): a loop
      // whose halves are on different chords wobbles a lot inside a part, so its jumps are smaller
      const ratios = steps.slice(1).map((x, i) => (x + eps) / (steps[i] + eps)), need = Math.min(2.5, 0.8 * Math.max(1, ...ratios));
      const at = ratios.findIndex((r) => r >= need && r >= 1.4);
      if (at >= 0) tau = Math.sqrt((steps[at] + eps) * (steps[at + 1] + eps)) - eps;
      // the usual wobble from the smallest steps: with whole loops and short parts, most steps are changes
      const usual = steps[Math.floor(steps.length / 10)], biggest = steps[steps.length - 1];
      if (biggest < 2.5 * usual + (hasChroma ? 0.02 : 0.5)) tau = Infinity;
      else tau = Math.max(tau, 1.8 * usual);
    }
    // group the blocks: each joins the first group whose blocks it's (on average) close to
    const group = new Int32Array(blocks.length).fill(-1), members = [];
    for (let j = 0; j < B; j++) {
      let best = -1, bd = Infinity;
      members.forEach((ms, g) => { const d = mean(ms.map((m) => D[j][m])); if (d < tau && d < bd) { bd = d; best = g; } });
      if (best < 0) { best = members.length; members.push([]); }
      members[best].push(j);
      group[j] = best;
    }
    // a lone block that differs inside a run of one part is a variation of it (a drop, a fill)
    for (let j = 1; j + 1 < B; j++) if (group[j - 1] === group[j + 1] && group[j] !== group[j - 1] && members[group[j]].length === 1) group[j] = group[j - 1];
    if (tail) group[B] = group[B - 1];
    // sections: runs of one group
    const secs = [];
    blocks.forEach((b, j) => {
      if (!j || group[j] !== group[j - 1]) secs.push({ g: group[j], bars: 0, a: b.a });
      secs[secs.length - 1].bars += b.bars;
    });
    // a ragged end of a bar or two (the last hit ringing out) belongs to the section before it — and
    // doesn't count towards how long that section is
    let ragged = tail ? blocks[blocks.length - 1].bars : 0; // (a part-bar tail is already in the last section)
    if (secs.length > 1 && secs[secs.length - 1].bars < block) { const t = secs.pop(); secs[secs.length - 1].bars += t.bars; ragged = t.bars; }
    secs.forEach((s) => { s.e = mean(full.slice(s.a, s.a + s.bars)); });
    // naming
    const names = secs.map(() => '');
    const count = (g) => secs.filter((s) => s.g === g).length, last = secs.length - 1;
    const others = (i) => secs.filter((_, j) => j !== i);
    const thinner = (i) => secs[i].e < mean(others(i).map((s) => s.e)) - 0.5;
    // an outro is its own part (or the intro's, come back); a part heard before is that part again
    // the first part is the intro when it's short and its own (or thinner) — or when it only ever
    // comes back short, between longer parts: then each time it comes back in the middle it's a break
    const barsOf = (i) => secs[i].bars - (i === last ? ragged : 0), g0 = secs[0].g;
    const shortPart = secs.every((x, i) => x.g !== g0 || barsOf(i) <= 8) && secs.some((x, i) => x.g !== g0 && barsOf(i) > 8);
    if (secs.length > 2 && secs[0].bars <= 8 && (count(g0) === 1 || thinner(0) || shortPart)) names[0] = 'Intro';
    const endBars = barsOf(last);
    if (secs.length > 2 && endBars <= 8 && (count(secs[last].g) === 1 || (names[0] === 'Intro' && secs[last].g === g0))) names[last] = 'Outro';
    if (names[0] === 'Intro') secs.forEach((x, i) => { if (i && !names[i] && x.g === g0) names[i] = 'Break'; });
    const mid = secs.map((_, i) => i).filter((i) => !names[i]);
    const groups = [...new Set(mid.map((i) => secs[i].g))];
    // how alike a part's sections are each time it comes back (a hook repeats its words; verses don't)
    const unitsOf = (sec) => blocks.map((b, j) => (b.a >= sec.a && b.a < sec.a + sec.bars ? j : -1)).filter((j) => j >= 0);
    const alike = (ss) => {
      const ds = [];
      for (let x = 0; x < ss.length; x++) for (let y = x + 1; y < ss.length; y++) {
        const up = unitsOf(secs[ss[x]]), uq = unitsOf(secs[ss[y]]);
        for (let k = 0; k < Math.min(up.length, uq.length); k++) ds.push(D[up[k]][uq[k]]);
      }
      return ds.length ? mean(ds) : 0;
    };
    const stat = groups.map((g) => {
      const ss = mid.filter((i) => secs[i].g === g);
      return { g, n: ss.length, e: mean(ss.map((i) => secs[i].e)), bars: mean(ss.map((i) => secs[i].bars)), within: alike(ss) };
    });
    const repeated = stat.filter((t) => t.n > 1);
    let hook = null;
    if (repeated.length >= 2) {
      // of the two parts that come back most, the hook: it comes back more often, it's usually the
      // shorter (8 bars to a verse's 16), it's more alike each time, and usually the fuller
      const [p, q] = repeated.sort((a, b) => b.n - a.n).slice(0, 2);
      const score = (g, o) => (g.n - o.n) + (o.bars - g.bars) / 8 + 1.5 * (o.within - g.within) / Math.max(1e-3, o.within, g.within) + 0.5 * (g.e - o.e);
      hook = score(p, q) >= score(q, p) ? p : q;
    } else if (stat.length >= 2) {
      const spread = Math.max(...stat.map((t) => t.e)) - Math.min(...stat.map((t) => t.e));
      if (spread > 0.6) hook = stat.reduce((a, b) => (b.e > a.e ? b : a));
    }
    mid.forEach((i) => {
      const g = secs[i].g;
      names[i] = hook && g === hook.g ? 'Hook' : count(g) === 1 && repeated.length && mid.length > 2 ? 'Bridge' : 'Verse';
    });
    const verses = names.filter((x) => x === 'Verse').length;
    let v = 0;
    return secs.map((s, i) => ({ name: names[i] === 'Verse' && verses > 1 ? `Verse ${++v}` : names[i], bars: s.bars }));
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
  const sections = ({ chans, rate, bpm, offset, bars }) => detect(features(chans, rate, bpm, offset, bars));

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

  FP.structure = { tempo, features, detect, sections, drums, layout };
})();
