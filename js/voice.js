/* LosSoulx FlowPad — words from a recording into the steps.
 *
 * While you record, the browser's speech recognition writes down what you say (phrase by
 * phrase, stamped on the audio clock). When the take ends, its audio is scanned for syllable
 * onsets, and each recognised syllable is matched to an onset — that time, laid over the
 * beat's step log, says which bar and step the syllable belongs on.
 */
(() => {
  'use strict';
  const FP = window.FP;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- live recognition ----------
  let sr = null, phrases = [], active = false, clock = null, failed = null, done = null, onText = null;

  function spawn() {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    const base = phrases.length; // a restarted session keeps adding after the last one
    r.onresult = (e) => {
      const t = clock();
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = phrases[base + i] || (phrases[base + i] = { text: '', tFirst: t, tLast: t });
        x.text = e.results[i][0].transcript;
        x.tLast = t;
      }
      if (onText) onText(phrases.map((p) => p.text.trim()).filter(Boolean).join(' '));
    };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') failed = e.error; };
    r.onend = () => {
      if (sr !== r) return;
      // Recognition stops by itself after a silence — keep it going for the whole take.
      if (active && !failed) { try { spawn(); return; } catch (err) { /* fall through */ } }
      sr = null;
      if (done) done();
    };
    sr = r;
    r.start();
  }

  /** Start listening. `now` is the audio clock; `text(t)` gets the running transcript. */
  function start(now, text) {
    if (!SR) return false;
    clock = now; onText = text; phrases = []; failed = null; active = true; done = null;
    try { spawn(); } catch (e) { active = false; return false; }
    return true;
  }

  /** Stop and collect the phrases heard: [{ text, tFirst, tLast }] on the audio clock. */
  function stop() {
    active = false;
    onText = null;
    return new Promise((resolve) => {
      const finish = () => { done = null; resolve({ phrases: phrases.filter((p) => p.text.trim()), error: failed }); };
      if (!sr) return finish();
      let settled = false;
      done = () => { if (!settled) { settled = true; finish(); } };
      setTimeout(done, 2500); // some browsers never send the final result
      try { sr.stop(); } catch (e) { done(); }
    });
  }

  // ---------- syllable onsets in the take ----------

  /**
   * Decode the take, band-limit it to the voice (cuts kick rumble and hats), and find syllable
   * onsets from its loudness envelope. Times are seconds from the start of the take.
   */
  async function analyze(blob) {
    const ctx = FP.audio.ensure();
    const data = await blob.arrayBuffer();
    const buf = await new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
    const rate = 22050;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
    const src = off.createBufferSource();
    src.buffer = buf;
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
    const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
    src.connect(hp).connect(lp).connect(off.destination);
    src.start();
    const x = (await off.startRendering()).getChannelData(0);

    // loudness envelope: 10 ms hops, 20 ms windows, in dB, lightly smoothed
    const hop = Math.round(rate * 0.01), win = hop * 2, F = Math.max(0, Math.floor((x.length - win) / hop));
    const raw = new Float32Array(F);
    for (let f = 0; f < F; f++) {
      let s = 0;
      for (let i = f * hop, e = i + win; i < e; i++) s += x[i] * x[i];
      raw[f] = 10 * Math.log10(s / win + 1e-10);
    }
    const env = new Float32Array(F);
    for (let f = 0; f < F; f++) env[f] = (raw[Math.max(0, f - 1)] + raw[f] + raw[Math.min(F - 1, f + 1)]) / 3;
    const sorted = Array.from(env).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)] || -100;
    const top = sorted[Math.floor(sorted.length * 0.98)] || floor;
    if (!F || top - floor < 12) return { onsets: [], segments: [], duration: buf.duration };
    const speech = floor + Math.min(10, (top - floor) * 0.35);
    const peakMin = floor + Math.min(14, (top - floor) * 0.5);

    const dt = hop / rate; // seconds per frame

    // voiced stretches, joined across gaps shorter than 250 ms, ignoring blips under 50 ms
    const runs = [];
    for (let f = 0, a = -1; f <= F; f++) {
      const on = f < F && env[f] > speech;
      if (on && a < 0) a = f;
      if (!on && a >= 0) {
        const last = runs[runs.length - 1];
        if (last && a - last[1] < 25) last[1] = f; else runs.push([a, f]);
        a = -1;
      }
    }
    const segments = runs.filter((r) => r[1] - r[0] >= 5).map((r) => [r[0] * dt, r[1] * dt]);

    // syllable nuclei: local loudness peaks that stand ≥3 dB above the dip before them;
    // the onset is where that rise began
    const onsets = [];
    let lastPeak = -1;
    for (let f = 2; f < F - 2; f++) {
      if (env[f] < peakMin) continue;
      let isMax = true;
      for (let d = -5; d <= 5 && isMax; d++) if (d && f + d >= 0 && f + d < F && env[f + d] > env[f]) isMax = false;
      if (!isMax) continue;
      let dip = env[f], m = f;
      for (let g = f - 1; g > Math.max(lastPeak, f - 30); g--) { if (env[g] < dip) { dip = env[g]; m = g; } }
      if (env[f] - dip < 3 && lastPeak >= 0) continue;
      let o = f;
      while (o > m && env[o - 1] > env[f] - 9) o--;
      if (onsets.length && o * dt - onsets[onsets.length - 1].t < 0.07) continue;
      onsets.push({ t: o * dt, s: env[f] - floor });
      lastPeak = f;
    }
    return { onsets, segments, duration: buf.duration };
  }

  // ---------- matching heard syllables to onsets ----------

  /** n times inside [a, b], evenly spaced. */
  const even = (n, a, b) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 0.5)) / n);

  /** Exactly n onset times from a phrase's onsets: keep the strongest, or fill the widest gaps. */
  function pick(ons, n, a, b) {
    if (!ons.length) return even(n, a, b);
    let t = ons;
    if (t.length > n) t = [...t].sort((p, q) => q.s - p.s).slice(0, n).sort((p, q) => p.t - q.t);
    const times = t.map((o) => o.t);
    while (times.length < n) {
      let gi = times.length - 1, gap = b - times[times.length - 1];
      for (let i = 0; i < times.length - 1; i++) if (times[i + 1] - times[i] > gap) { gap = times[i + 1] - times[i]; gi = i; }
      const end = gi === times.length - 1 ? b : times[gi + 1];
      times.splice(gi + 1, 0, (times[gi] + end) / 2);
    }
    return times;
  }

  /**
   * phrases: [{ n (syllables), tFirst, tLast }] with times in seconds from the start of the take.
   * Returns, per phrase, the time each of its syllables starts.
   */
  function align(list, an) {
    const segs = an.segments.slice();
    const out = [];
    let prevEnd = 0;
    list.forEach((p, i) => {
      const lastPhrase = i === list.length - 1;
      // the recogniser reports a phrase a little after it's spoken: claim the voiced stretches
      // that began before then, choosing how many by which best matches its syllable count
      const cand = [];
      for (const s of segs) { if (lastPhrase || s[0] < p.tLast - 0.25 || !cand.length) cand.push(s); else break; }
      let take = cand.length, best = Infinity;
      if (!lastPhrase) {
        for (let k = 1; k <= cand.length; k++) {
          const c = an.onsets.filter((o) => o.t >= cand[0][0] - 0.05 && o.t <= cand[k - 1][1]).length;
          const cost = Math.abs(c - p.n);
          if (cost < best || (cost === best && k < take)) { best = cost; take = k; }
        }
      }
      const mine = segs.splice(0, take);
      if (!mine.length) {
        // no audio to go on: spread over when the words came in
        const b = Math.max(prevEnd + 0.2, p.tLast - 0.5), a = Math.max(prevEnd, Math.min(p.tFirst - 0.6, b - 0.15 * p.n));
        out.push(even(p.n, a, b));
        prevEnd = b;
        return;
      }
      const a = mine[0][0], b = mine[mine.length - 1][1];
      const ons = an.onsets.filter((o) => o.t >= a - 0.05 && o.t <= b && mine.some((s) => o.t >= s[0] - 0.05 && o.t <= s[1]));
      out.push(pick(ons, p.n, a, b));
      prevEnd = b;
    });
    return out;
  }

  FP.voice = { supported: () => !!SR, start, stop, analyze, align, listening: () => active };
})();
