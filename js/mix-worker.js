/* LosSoulx FlowPad — heavy listening off the main thread: a take's noise reduction and the mix
 * (js/mix.js), and an imported beat's tempo, bar 1 and sections (js/structure.js). */
importScripts('mix.js', 'structure.js');

const JOBS = {
  denoise: (a) => FP.mix.denoise(a),
  finish: (a) => FP.mix.finish(a),
  timing: (a) => FP.structure.tempo(a.chans, a.rate, { bpm: a.bpm }),
  sections: (a) => ({ sections: FP.structure.sections(a) }),
};

self.onmessage = (e) => {
  try {
    const { op, args } = e.data;
    const r = JOBS[op](args);
    self.postMessage(r, (r.chans || [r.chan]).filter(Boolean).map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
