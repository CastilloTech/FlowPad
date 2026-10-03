/* LosSoulx FlowPad — cadence: the rhythm of a bar, separate from its words.
 *
 * A bar's cadence is which of its steps carry syllables. Here: whether the stressed syllables sit
 * in the pocket, how alike two bars' cadences are, how often a verse switches its cadence up, and
 * turning taps into steps. Plain data in, data out — it runs under the unit tests too.
 */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});

  /** Where in the bar (0–1) each filled step of a bar falls. */
  const hitsOf = (cells) => cells.map((c, k) => (c.trim() ? k / cells.length : -1)).filter((x) => x >= 0);

  /**
   * Is step k of an n-step bar a pocket spot: an 8th note (16 steps), an 8th-note triplet (any of
   * 12 steps, or the even ones of 24) — or wherever the kick or snare hits (drums: steps of 16)?
   */
  function inPocket(k, n, drums) {
    const at16 = (k * 16) / n;
    if (drums && Number.isInteger(at16) && drums.has(at16)) return true;
    // 16 steps: the 8th notes · 12: every step is an 8th-note triplet · 24: its even steps are
    return n === 12 || k % 2 === 0;
  }

  /**
   * How a bar's stressed syllables sit: cls is the stress class of each step ('s1' = stressed),
   * drums the steps (of 16) where the kick or snare hits. Returns { stressed, inPocket, off: [steps] }.
   */
  function pocket(cls, drums) {
    const n = cls.length, off = [];
    let stressed = 0;
    cls.forEach((c, k) => {
      if (c !== 's1') return;
      stressed++;
      if (!inPocket(k, n, drums)) off.push(k);
    });
    return { stressed, inPocket: stressed - off.length, off };
  }

  /**
   * How alike two bars' cadences are, 0–1: their hits matched by timing (within a 32nd of a bar),
   * so a triplet bar and a 16th bar can still be compared.
   */
  function similarity(a, b) {
    const A = hitsOf(a), B = hitsOf(b);
    if (!A.length || !B.length) return 0;
    const used = new Set();
    let match = 0;
    for (const x of A) {
      let best = -1, bd = 1 / 32 + 1e-9;
      B.forEach((y, j) => { const d = Math.abs(x - y); if (!used.has(j) && d <= bd) { bd = d; best = j; } });
      if (best >= 0) { used.add(best); match++; }
    }
    return (2 * match) / (A.length + B.length);
  }

  /**
   * For each bar (cells arrays, empty bars allowed), how many bars in a row up to it share one
   * cadence (1 = it differs from the bar before).
   */
  function repeats(bars, same = 0.8) {
    const out = [];
    bars.forEach((cells, i) => {
      const prev = i && bars[i - 1];
      out.push(prev && hitsOf(cells).length && similarity(cells, prev) >= same ? out[i - 1] + 1 : 1);
    });
    return out;
  }

  /**
   * How varied a verse's cadences are, 0–1: the share of written bars that switch it up from
   * the bar before — plus the runs of 4 or more bars that never switch (first and last bar indexes).
   */
  function variety(bars) {
    const rep = repeats(bars);
    const written = bars.map((c, i) => (hitsOf(c).length ? i : -1)).filter((i) => i >= 0);
    const switched = written.filter((i) => i === written[0] || rep[i] === 1).length;
    const runs = [];
    rep.forEach((r, i) => { if (r >= 4 && (i === rep.length - 1 || rep[i + 1] <= r)) runs.push([i - r + 1, i]); });
    return { score: written.length ? switched / written.length : 1, runs };
  }

  /** Taps (seconds from the start of the bar) on a bar of `barDur` seconds → its steps on an n-step grid. */
  function fromTaps(taps, barDur, n) {
    return [...new Set(taps.filter((t) => t >= -barDur / (2 * n) && t < barDur - barDur / (2 * n)).map((t) => Math.max(0, Math.round((t / barDur) * n))))].sort((a, b) => a - b);
  }

  FP.cadence = { hitsOf, inPocket, pocket, similarity, repeats, variety, fromTaps };
})();
