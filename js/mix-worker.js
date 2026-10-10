/* LosSoulx FlowPad — mixing off the main thread (js/mix.js): a take's noise reduction, or the mix. */
importScripts('mix.js');

self.onmessage = (e) => {
  try {
    const { op, args } = e.data;
    const r = op === 'denoise' ? FP.mix.denoise(args) : FP.mix.finish(args);
    self.postMessage(r, (r.chans || [r.chan]).filter(Boolean).map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
