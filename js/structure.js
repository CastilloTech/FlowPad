/* LosSoulx FlowPad — the structure of an imported beat (Intro · Verse · Hook · Outro) and laying a
 * song out to match it. Plain data in, data out, so it runs under the unit tests too.
 */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});

  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

  /**
   * Split a beat into sections from per-bar features ({ rms, low, high } in dB, one per bar).
   * Changes are looked for between 4-bar blocks, where beats change; the sections are then named
   * by how full they sound: a quieter start is the Intro, a quieter end the Outro, and in between
   * the fuller sections are Hooks and the sparser ones Verses.
   * Returns [{ name, bars }].
   */
  function detect(feats, block = 4) {
    const n = feats.length;
    if (n < 2 * block) return [{ name: 'Verse', bars: n }];
    const keys = ['rms', 'low', 'high'];
    // each feature relative to the whole beat; a 1.5 dB floor keeps tiny wobbles from counting
    const z = feats.map(() => ({}));
    for (const k of keys) {
      const col = feats.map((f) => f[k]), m = mean(col), s = Math.max(1.5, sd(col));
      col.forEach((v, i) => { z[i][k] = (v - m) / s; });
    }
    const blocks = [];
    for (let a = 0; a < n; a += block) {
      const part = z.slice(a, a + block);
      blocks.push({ a, bars: part.length, v: keys.map((k) => mean(part.map((p) => p[k]))) });
    }
    const dist = blocks.map((b, j) => (j ? Math.hypot(...b.v.map((v, i) => v - blocks[j - 1].v[i])) : 0));
    // a change counts when it stands well above the beat's usual block-to-block wobble — taken from
    // the quietest quarter of the gaps, since in a beat with 8-bar sections half the gaps are changes
    const ds = dist.slice(1).sort((a, b) => a - b), thr = Math.max(0.8, 3 * ds[Math.floor(ds.length / 4)]);

    const secs = [];
    blocks.forEach((b, j) => {
      if (!j || dist[j] > thr) secs.push({ bars: 0, e: [] });
      const s = secs[secs.length - 1];
      s.bars += b.bars;
      s.e.push(b.v[0] + b.v[2]); // loudness + brightness = how full it sounds
    });
    // a ragged end of a bar or two belongs to the section before it
    if (secs.length > 1 && secs[secs.length - 1].bars < block) { const t = secs.pop(); secs[secs.length - 1].bars += t.bars; }
    secs.forEach((s) => { s.e = mean(s.e); });

    const names = secs.map(() => 'Verse');
    const last = secs.length - 1;
    // the first / last section is an intro / outro when it's short and clearly thinner than the rest
    const thinner = (i) => secs[i].bars <= 8 && secs[i].e < mean(secs.filter((_, j) => j !== i && j !== 0 && j !== last).map((s) => s.e)) - 0.5;
    if (secs.length > 2 && thinner(0)) names[0] = 'Intro';
    if (secs.length > 2 && thinner(last)) names[last] = 'Outro';
    const mid = secs.map((s, i) => i).filter((i) => names[i] === 'Verse');
    const em0 = mid.map((i) => secs[i].e), spread = mid.length ? Math.max(...em0) - Math.min(...em0) : 0;
    if (mid.length > 1 && spread > 0.6) {
      // two groups by fullness: the fuller one is the hook
      const em = mid.map((i) => secs[i].e), cut = (Math.max(...em) + Math.min(...em)) / 2;
      mid.forEach((i) => { if (secs[i].e > cut) names[i] = 'Hook'; });
    }
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

  FP.structure = { detect, layout };
})();
