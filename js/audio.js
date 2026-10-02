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
    /** A soft tick for a word landing on a step. */
    tick(t) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 2200;
      env(g.gain, t, 0.05, 0.001, 0.03);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.05);
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
  // log: when each step actually sounds ({ t, bar, step, n }), so a recording can be mapped back onto the grid
  // queue: scheduled steps waiting to be shown — handed to onStep on the display's own frames
  const tr = { cfg: null, bar: 0, step: 0, next: 0, timer: null, ending: false, log: [], bpm: 90, queue: [], raf: 0 };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(state()));
  const state = () => ({ playing: !!tr.cfg, kind: tr.cfg ? tr.cfg.kind : null });

  function scheduleStep(c, bar, step, t) {
    tr.log.push({ t, bar, step, n: c.stepsPerBar });
    if (tr.log.length > 40000) tr.log.splice(0, 10000);
    if (c.onStep) tr.queue.push({ t, bar, step });
    if (bar < 0) {
      // count-in bars (numbered -1, -2 …): clicks on the beats only
      if (step % c.stepsPerBeat === 0) voices.click(t, step === 0);
      return;
    }
    if (c.beat) c.beat(bar, step, t); // an imported beat starts its loops on bar lines
    const pat = c.getBar ? c.getBar(bar) : null;
    if (pat) {
      for (const k of ['kick', 'snare', 'clap', 'hat', 'open']) {
        const v = pat[k] && pat[k][step];
        if (v) voices[k](t, v > 1 ? 1.25 : 1);
      }
    }
    const spb = c.stepsPerBeat;
    if (c.click && step % spb === 0) voices.click(t, c.accent !== false && step === 0);
  }

  /**
   * Show each step when it's heard: on every display frame, hand onStep the steps whose time has
   * come (allowing for the speaker's delay). Smoother than a timer per step on a busy phone.
   */
  function frame() {
    const c = tr.cfg;
    if (!c) return;
    const now = ctx.currentTime - (ctx.outputLatency || 0);
    if (tr.queue.length > 64) tr.queue.splice(0, tr.queue.length - 16); // back from a background tab
    while (tr.queue.length && tr.queue[0].t <= now) {
      const s = tr.queue.shift();
      if (c.onStep) c.onStep(s.bar, s.step);
    }
    tr.raf = requestAnimationFrame(frame);
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
    tr.bar = cfg.startBar != null ? cfg.startBar : -(cfg.countIn || 0); tr.step = 0; tr.ending = false;
    tr.log = []; tr.bpm = tr.cfg.bpm;
    tr.next = cfg.startAt && cfg.startAt > ctx.currentTime ? cfg.startAt : ctx.currentTime + 0.08;
    tr.queue = [];
    tr.timer = setInterval(tick, 25);
    tick();
    tr.raf = requestAnimationFrame(frame);
    emit();
  }

  function stop() {
    if (!tr.cfg) return;
    const c = tr.cfg;
    clearInterval(tr.timer);
    cancelAnimationFrame(tr.raf);
    tr.queue = [];
    tr.cfg = null;
    stopLoops();
    if (c.onStop) c.onStop();
    emit();
  }

  // ---------- imported beats: an audio loop started on bar lines ----------
  const loops = new Set();
  /**
   * Play `bars` bars of a loop from time t. opts: { buffer, offset (s into the file where bar 1
   * starts), bars, bpm (song tempo), rate (song bpm / beat bpm), gain }.
   */
  function loopAt(t, o) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = o.buffer;
    src.playbackRate.value = o.rate || 1;
    g.gain.value = o.gain ?? 0.9;
    src.connect(g).connect(ctx.destination); // a finished mix: skip the drum bus compressor
    src.start(t, Math.max(0, o.offset || 0));
    src.stop(t + (o.bars * 240) / o.bpm + 0.01);
    loops.add(src);
    src.onended = () => loops.delete(src);
  }
  function stopLoops() { loops.forEach((s) => { try { s.stop(); } catch (e) { /* already done */ } }); loops.clear(); }

  /** Decode an audio file (Blob) on the shared context. */
  async function decode(blob) {
    ensure();
    const data = await blob.arrayBuffer();
    return new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
  }

  /**
   * How each bar of a beat sounds, for finding its sections: overall loudness, bass (kick/808)
   * and brightness (hats, top end), in dB. Bars are cut from `offset` at the beat's tempo.
   */
  function barFeatures(buffer, bpm, offset, bars) {
    const c0 = buffer.getChannelData(0), c1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : c0;
    const rate = buffer.sampleRate, len = (240 / bpm) * rate, out = [];
    const db = (s, n) => 10 * Math.log10(s / n + 1e-10);
    const k = 1 - Math.exp((-2 * Math.PI * 150) / (rate / 2)); // ~150 Hz low-pass, reading every other sample
    let lp = 0, prev = 0;
    for (let b = 0; b < bars; b++) {
      const a = Math.floor(offset * rate + b * len), e = Math.min(c0.length, Math.floor(a + len));
      if (a >= c0.length) break;
      let s = 0, lo = 0, hi = 0, n = 0;
      for (let i = a; i < e; i += 2, n++) {
        const v = (c0[i] + c1[i]) / 2;
        lp += k * (v - lp);
        const d = v - prev; prev = v; // first difference: the top end
        s += v * v; lo += lp * lp; hi += d * d;
      }
      out.push({ rms: db(s, n), low: db(lo, n), high: db(hi, n) });
    }
    return out;
  }

  /**
   * Rough tempo of a beat: autocorrelation of its low-end onset envelope, folded into 70–180 BPM.
   * Returns null when nothing clear stands out.
   */
  function guessBpm(buffer) {
    const x = buffer.getChannelData(0), rate = buffer.sampleRate, hop = Math.round(rate / 100);
    const n = Math.min(Math.floor(x.length / hop), 100 * 60); // first minute is plenty
    const env = new Float32Array(n);
    let prev = 0, lp = 0;
    for (let f = 0; f < n; f++) {
      let s = 0;
      for (let i = f * hop, e = i + hop; i < e; i++) { lp += 0.05 * (x[i] - lp); s += lp * lp; } // low-pass: kicks
      const v = Math.log10(s / hop + 1e-9);
      env[f] = Math.max(0, v - prev); // rises only
      prev = v;
    }
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(6000 / 180); lag <= Math.ceil(6000 / 70); lag++) {
      let s = 0;
      for (let f = lag; f < n; f++) s += env[f] * env[f - lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    return bestLag ? Math.round(6000 / bestLag) : null;
  }

  FP.audio = {
    ensure,
    play,
    stop,
    state,
    hit(track) { ensure(); voices[track](ctx.currentTime + 0.01); },
    tick() { ensure(); voices.tick(ctx.currentTime + 0.005); },
    update(patch) { if (tr.cfg) Object.assign(tr.cfg, patch); if (patch.bpm) tr.bpm = patch.bpm; },
    /** When each step of the last transport run sounded (kept after stop), plus its tempo. */
    timeline: () => ({ log: tr.log.slice(), bpm: tr.bpm }),
    loopAt: (t, o) => { ensure(); loopAt(t, o); },
    decode,
    guessBpm,
    barFeatures,
    /** Play a decoded take at audio-clock time t; returns a stop function. */
    playBuffer(buffer, t, onEnd) {
      ensure();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => onEnd && onEnd();
      src.start(t);
      return () => { src.onended = null; try { src.stop(); } catch (e) { /* done */ } };
    },
    now: () => (ctx ? ctx.currentTime : 0),
    /** Seconds between a sound being scheduled/captured and it being heard/recorded. */
    latency: () => (ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

/* FlowPad — microphone recording */
(() => {
  'use strict';
  const FP = window.FP;
  let stream = null, mr = null, chunks = [], t0 = 0, t0c = 0, raf = 0, src = null;

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
    const ctx = FP.audio.ensure();
    mr.start(250);
    t0 = performance.now();
    t0c = ctx.currentTime; // the take's 0:00 on the audio clock, to line it up with the beat

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
        resolve({ blob, duration, mime: blob.type, t0: t0c });
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
