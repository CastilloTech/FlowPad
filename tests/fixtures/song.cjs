// A made-up song to test beat analysis on: drums, bass, chords, a rapped verse and a sung hook —
// about as loud as each other, as in a real song — laid out in sections, after an optional lead-in
// (like a video's first second). Deterministic: the same arguments always give the same samples.
'use strict';

/** Repeatable random numbers in 0…1. */
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// chords as MIDI notes; verses and hooks go round different progressions, a bar per chord
const PROG = {
  intro: [[57, 60, 64], [53, 57, 60]], // Am F
  verse: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
  hook: [[53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64]], // F G Em Am
  bridge: [[50, 53, 57], [52, 55, 59]], // Dm Em
  outro: [[57, 60, 64], [53, 57, 60]],
};
// 16 steps per bar
const DRUMS = {
  boombap: { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  trap: { kick: [0, 3, 10], snare: [8], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
};

/**
 * sections: [[kind, bars]] with kind intro / verse / hook / bridge / outro.
 * Returns { chans: [L, R], rate, bpm, start (seconds where bar 1 begins), bars }.
 */
function makeSong({ bpm = 90, sections, style = 'boombap', rate = 22050, lead = 0, seed = 1 }) {
  const rnd = rng(seed), bar = 240 / bpm, step = bar / 16;
  const bars = sections.reduce((a, [, n]) => a + n, 0);
  const n = Math.ceil((lead + bars * bar + 1) * rate), x = new Float32Array(n);
  const add = (t0, dur, f) => { const a = Math.max(0, Math.floor(t0 * rate)), z = Math.min(n, Math.floor((t0 + dur) * rate)); for (let i = a; i < z; i++) x[i] += f((i - a) / rate); };
  const noise = () => rnd() * 2 - 1;
  const saw = (ph, h) => { let v = 0; for (let k = 1; k <= h; k++) v += Math.sin(ph * k) / k; return v; };
  const kick = (t) => add(t, 0.3, (u) => 0.8 * Math.exp(-u / 0.08) * Math.sin(2 * Math.PI * (45 * u + 75 * 0.04 * (1 - Math.exp(-u / 0.04)))));
  // a snare's rattle: noise mostly under ~8 kHz, as a real one is (not white up to the file's top)
  let sl = 0;
  const ks = 1 - Math.exp((-2 * Math.PI * 8000) / rate);
  const snare = (t) => add(t, 0.2, (u) => { sl += ks * (noise() - sl); return Math.exp(-u / 0.05) * (0.6 * sl + 0.2 * Math.sin(2 * Math.PI * 190 * u)); });
  let hp = 0;
  const hat = (t, a = 0.12) => add(t, 0.05, (u) => { const v = noise(), d = v - hp; hp = v; return a * Math.exp(-u / 0.015) * d; });
  // a voice: a buzz through two formants (a crude "ah" / "ee")
  // `vowel` (0…1, 0…1) fixes the vowel; a rapped syllable gets a random one
  const voice = (t, dur, f0, amp, vib = 0, vowel = [rnd(), rnd()]) => {
    let b1 = 0, b2 = 0, c1 = 0, c2 = 0, ph = 0;
    const res = (fc, q) => { const w = (2 * Math.PI * fc) / rate, r = Math.exp(-w / (2 * q)); return [2 * r * Math.cos(w), -r * r, 1 - r]; };
    const [a1, a2, g1] = res(700 + vowel[0] * 300, 6), [d1, d2, g2] = res(1800 + vowel[1] * 600, 8);
    add(t, dur, (u) => {
      ph += (2 * Math.PI * f0 * (1 + vib * Math.sin(2 * Math.PI * 5.5 * u))) / rate;
      const src = saw(ph, 12) + 0.15 * noise(), env = Math.min(1, u / 0.015) * Math.min(1, (dur - u) / 0.03);
      const y1 = g1 * src + a1 * b1 + a2 * b2; b2 = b1; b1 = y1;
      const y2 = g2 * src + d1 * c1 + d2 * c2; c2 = c1; c1 = y2;
      return amp * env * (y1 + 0.7 * y2);
    });
  };
  let b0 = 0;
  for (const [kind, nb] of sections) {
    const drums = kind === 'verse' || kind === 'hook' || kind === 'bridge' ? DRUMS[style] : kind === 'outro' ? { kick: [], snare: [], hat: DRUMS[style].hat } : null;
    for (let k = 0; k < nb; k++) {
      const t = lead + (b0 + k) * bar, prog = PROG[kind], chord = prog[k % prog.length];
      // chords: brighter and an octave up in the hook
      const bright = kind === 'hook' ? 6 : 3, oct = kind === 'hook' ? 12 : 0;
      for (const note of chord) { const f = midi(note + oct); let ph = 0; add(t, bar, (u) => { ph += (2 * Math.PI * f) / rate; return 0.035 * Math.min(1, u / 0.05) * saw(ph, bright); }); }
      if (kind !== 'intro') { const f = midi(chord[0] - 24); for (let s = 0; s < 16; s += 2) { let ph = 0; add(t + s * step, step * 1.8, (u) => { ph += (2 * Math.PI * f) / rate; return 0.22 * Math.exp(-u / 0.25) * (Math.sin(ph) + 0.3 * Math.sin(2 * ph)); }); } }
      if (drums) {
        drums.kick.forEach((s) => kick(t + s * step));
        drums.snare.forEach((s) => snare(t + s * step));
        drums.hat.forEach((s) => hat(t + s * step, kind === 'hook' ? 0.16 : 0.12));
      }
      // vocals: rapped 16ths in a verse, two sung notes a bar in the hook
      if (kind === 'verse' || kind === 'bridge') for (let s = 0; s < 16; s++) if (rnd() < 0.7) voice(t + s * step, step * 0.85, 140 + rnd() * 50, 0.09);
      // the hook sings the same words every time it comes back: the same vowel at each spot
      if (kind === 'hook') for (const s of [0, 8]) voice(t + s * step, step * 7.5, midi(chord[s ? 1 : 2] + 12), 0.08, 0.01, [((k * 2 + s) * 0.37) % 1, ((k * 3 + s) * 0.61) % 1]);
    }
    b0 += nb;
  }
  // a quiet lead-in: room tone, like the start of a video
  for (let i = 0; i < Math.floor(lead * rate); i++) x[i] += 0.001 * noise();
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) x[i] *= 0.8 / peak;
  return { chans: [x, x], rate, bpm, start: lead, bars };
}

/**
 * An instrumental type beat built on one 8-bar loop (two 4-bar halves on different chords) that
 * never changes its chords — the parts differ only in what plays: `bare` (the loop alone), `full`
 * (drums, bass, the loop) and `lift` (that plus a counter-melody, the hats doubled). A `drop` (the
 * last 4 bars of a part, without drums) can end a part; one bar of silence ends the beat.
 * sections: [[part, bars, drop?]]. Returns like makeSong.
 */
function makeLoopBeat({ bpm = 135, sections, rate = 22050, seed = 1 }) {
  const rnd = rng(seed), bar = 240 / bpm, step = bar / 16;
  const bars = sections.reduce((a, [, nb]) => a + nb, 0);
  const n = Math.ceil((bars + 1) * bar * rate), x = new Float32Array(n);
  const add = (t0, dur, f) => { const a = Math.max(0, Math.floor(t0 * rate)), z = Math.min(n, Math.floor((t0 + dur) * rate)); for (let i = a; i < z; i++) x[i] += f((i - a) / rate); };
  const noise = () => rnd() * 2 - 1;
  const saw = (ph, h) => { let v = 0; for (let k = 1; k <= h; k++) v += Math.sin(ph * k) / k; return v; };
  // the loop: bars 1–4 on one pair of chords, bars 5–8 on another
  const LOOP = [[61, 64, 68], [61, 64, 68], [57, 61, 64], [57, 61, 64], [60, 64, 67], [60, 64, 67], [57, 60, 64], [57, 60, 64]];
  let hp = 0, b0 = 0;
  const hat = (t, a) => add(t, 0.05, (u) => { const v = noise(), d = v - hp; hp = v; return a * Math.exp(-u / 0.015) * d; });
  for (const [part, nb, drop] of sections) {
    for (let k = 0; k < nb; k++) {
      const t = (b0 + k) * bar, chord = LOOP[(b0 + k) % 8], dropped = drop && k >= nb - 4;
      // the loop's melody: a bell-ish arpeggio through the bar
      for (let s = 0; s < 16; s += 2) { const f = midi(chord[(s / 2) % 3] + 12); let ph = 0; add(t + s * step, step * 1.9, (u) => { ph += (2 * Math.PI * f) / rate; return 0.06 * Math.exp(-u / 0.2) * saw(ph, 4); }); }
      if (part === 'bare' || dropped) continue;
      // drums and an 808-ish bass
      for (const s of [0, 3, 10]) add(t + s * step, 0.35, (u) => 0.7 * Math.exp(-u / 0.12) * Math.sin(2 * Math.PI * (midi(chord[0] - 36) * u + 30 * 0.03 * (1 - Math.exp(-u / 0.03)))));
      add(t + 8 * step, 0.2, (u) => Math.exp(-u / 0.05) * (0.35 * noise() + 0.2 * Math.sin(2 * Math.PI * 190 * u)));
      for (let s = 0; s < 16; s += part === 'lift' ? 1 : 2) hat(t + s * step, 0.1);
      // the lift: a counter-melody in the middle register
      if (part === 'lift') for (const s of [0, 4, 8, 12]) { const f = midi(chord[1] + 24); let ph = 0; add(t + s * step, step * 3.5, (u) => { ph += (2 * Math.PI * f) / rate; return 0.05 * Math.min(1, u / 0.02) * saw(ph, 6); }); }
    }
    b0 += nb;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) x[i] *= 0.8 / peak;
  return { chans: [x, x], rate, bpm, start: 0, bars };
}

module.exports = { makeSong, makeLoopBeat };
