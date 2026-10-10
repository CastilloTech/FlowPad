/* LosSoulx FlowPad — mixing off the main thread: balance the stems and master them (js/mix.js). */
importScripts('mix.js');

self.onmessage = (e) => {
  try {
    const r = FP.mix.finish(e.data);
    self.postMessage(r, r.chans.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
