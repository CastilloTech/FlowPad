/* FlowPad — Web Audio drum synth + look-ahead transport (beats, flow playback, metronome). */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});
  let ctx = null, out = null, noise = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      out = ctx.createGain();
      out.gain.value = 0.85;
      out.connect(comp);
      comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }

  function env(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noiseSrc(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }

  function filter(type, freq, q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  const voices = {
    kick(t, v = 1) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      env(g.gain, t, 1.0 * v, 0.003, 0.42);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.5);
    },
    snare(t, v = 1) {
      const n = noiseSrc(t, 0.25), g = ctx.createGain();
      env(g.gain, t, 0.55 * v, 0.002, 0.17);
      n.connect(filter('highpass', 1400)).connect(g).connect(out);
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
      env(g2.gain, t, 0.45 * v, 0.002, 0.09);
      o.connect(g2).connect(out);
      o.start(t); o.stop(t + 0.15);
    },
    clap(t, v = 1) {
      const n = noiseSrc(t, 0.3), g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 3; k++) {
        const s = t + k * 0.011;
        g.gain.setValueAtTime(0.6 * v, s);
        g.gain.exponentialRampToValueAtTime(0.05, s + 0.009);
      }
      g.gain.setValueAtTime(0.5 * v, t + 0.035);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      n.connect(filter('bandpass', 1300, 1.2)).connect(g).connect(out);
    },
    hat(t, v = 1) {
      const n = noiseSrc(t, 0.08), g = ctx.createGain();
      env(g.gain, t, 0.28 * v, 0.001, 0.045);
      n.connect(filter('highpass', 7500)).connect(g).connect(out);
    },
    open(t, v = 1) {
      const n = noiseSrc(t, 0.4), g = ctx.createGain();
      env(g.gain, t, 0.24 * v, 0.002, 0.3);
      n.connect(filter('highpass', 6500)).connect(g).connect(out);
    },
    click(t, accent) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = accent ? 1760 : 1180;
      env(g.gain, t, accent ? 0.35 : 0.2, 0.001, 0.04);
      o.connect(filter('lowpass', 5000)).connect(g).connect(out);
      o.start(t); o.stop(t + 0.06);
    },
  };

  // ---------- transport ----------
  const tr = { cfg: null, bar: 0, step: 0, next: 0, timer: null, ending: false };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(state()));
  const state = () => ({ playing: !!tr.cfg, kind: tr.cfg ? tr.cfg.kind : null });

  function scheduleStep(c, bar, step, t) {
    const pat = c.getBar ? c.getBar(bar) : null;
    if (pat) {
      for (const k of ['kick', 'snare', 'clap', 'hat', 'open']) {
        const v = pat[k] && pat[k][step];
        if (v) voices[k](t, v > 1 ? 1.25 : 1);
      }
    }
    const spb = c.stepsPerBeat;
    if (c.click && step % spb === 0) voices.click(t, c.accent !== false && step === 0);
    if (c.onStep) {
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => { if (tr.cfg === c) c.onStep(bar, step); }, delay);
    }
  }

  function tick() {
    const c = tr.cfg;
    if (!c || tr.ending) return;
    while (tr.next < ctx.currentTime + 0.12) {
      scheduleStep(c, tr.bar, tr.step, tr.next);
      const base = 60 / c.bpm / c.stepsPerBeat;
      const sw = c.stepsPerBeat === 4 ? c.swing || 0 : 0;
      tr.next += sw ? (tr.step % 2 === 0 ? base * (1 + sw) : base * (1 - sw)) : base;
      tr.step++;
      if (tr.step >= c.stepsPerBar) {
        tr.step = 0;
        tr.bar++;
        if (c.bars != null && tr.bar >= c.bars) {
          if (c.loop) tr.bar = 0;
          else {
            tr.ending = true;
            const wait = (tr.next - ctx.currentTime) * 1000;
            setTimeout(() => { if (tr.cfg === c) stop(); }, wait);
            return;
          }
        }
      }
    }
  }

  /**
   * cfg: { kind, bpm, swing, stepsPerBeat, stepsPerBar, bars (null = endless), loop,
   *        click, accent, getBar(barIndex) -> steps|null, onStep(bar, step), onStop() }
   */
  function play(cfg) {
    ensure();
    stop();
    tr.cfg = Object.assign({ stepsPerBeat: 4, stepsPerBar: 16, bars: null, swing: 0 }, cfg);
    tr.bar = 0; tr.step = 0; tr.ending = false;
    tr.next = ctx.currentTime + 0.08;
    tr.timer = setInterval(tick, 25);
    tick();
    emit();
  }

  function stop() {
    if (!tr.cfg) return;
    const c = tr.cfg;
    clearInterval(tr.timer);
    tr.cfg = null;
    if (c.onStop) c.onStop();
    emit();
  }

  FP.audio = {
    ensure,
    play,
    stop,
    state,
    hit(track) { ensure(); voices[track](ctx.currentTime + 0.01); },
    update(patch) { if (tr.cfg) Object.assign(tr.cfg, patch); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

/* FlowPad — microphone recording */
(() => {
  'use strict';
  const FP = window.FP;
  let stream = null, mr = null, chunks = [], t0 = 0, raf = 0, src = null;

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  async function start(onLevel) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mime = types.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.start(250);
    t0 = performance.now();

    const ctx = FP.audio.ensure();
    src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      onLevel && onLevel(Math.sqrt(sum / buf.length), (performance.now() - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function stop() {
    return new Promise((resolve) => {
      if (!mr) return resolve(null);
      const rec = mr;
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const duration = (performance.now() - t0) / 1000;
        cleanup();
        resolve({ blob, duration, mime: blob.type });
      };
      rec.stop();
    });
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    if (src) { try { src.disconnect(); } catch (e) { /* ignore */ } }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; mr = null; src = null; chunks = [];
  }

  FP.rec = { supported, start, stop, isRecording: () => !!mr };
})();
