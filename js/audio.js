/* FlowPad — Web Audio drum synth + look-ahead transport (beats, flow playback, metronome). */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});
  let ctx = null, out = null, noise = null;
  let userLat = null; // seconds, measured by the headphone delay test (null = trust the browser)

  /**
   * iPhone: a web page's sound is muted by the silent switch unless it says it's playing music
   * (like the Music app). While recording it says so too, with the mic on. Safari 16.4+; elsewhere
   * there's no switch to worry about.
   */
  function session(type) {
    try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch (e) { /* not allowed here */ }
  }
  function ensure() {
    if (!ctx) {
      session('playback');
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      out = ctx.createGain();
      out.gain.value = 0.85;
      out.connect(comp);
      comp.connect(ctx.destination);
      noise = makeNoise(ctx);
      voices = makeVoices(ctx, out, noise);
    }
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }

  function env(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** White noise for the snare, clap and hats, made once per audio context. */
  function makeNoise(c) {
    const n = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return n;
  }

  /** The drum kit, playing into `dest` on audio context `c` (live, or offline for an export). */
  /** The notes FlowPad's own sounds use: A minor pentatonic, so clicks, blips and UI sounds sit together. */
  const KEY = { E4: 329.63, A4: 440, A5: 880, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760 };
  /** UI sounds: the notes of each, as [note, delay s]. */
  const UI = {
    land: [['A6', 0]],
    slot: [['E6', 0], ['A6', 0.06]],
    bar: [['A5', 0], ['C6', 0.07], ['E6', 0.14]],
    save: [['D6', 0], ['G6', 0.08]],
    undo: [['E6', 0], ['C6', 0.06]],
    remove: [['A4', 0], ['E4', 0.07]],
  };
  function makeVoices(c, dest, noiseBuf) {
    function noiseSrc(t, dur) {
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur);
      return s;
    }
    function filter(type, freq, q = 0.7) {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    }
    return {
      kick(t, v = 1) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(160, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        env(g.gain, t, 1.0 * v, 0.003, 0.42);
        o.connect(g).connect(dest);
        o.start(t); o.stop(t + 0.5);
      },
      snare(t, v = 1) {
        const n = noiseSrc(t, 0.25), g = c.createGain();
        env(g.gain, t, 0.55 * v, 0.002, 0.17);
        n.connect(filter('highpass', 1400)).connect(g).connect(dest);
        const o = c.createOscillator(), g2 = c.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
        env(g2.gain, t, 0.45 * v, 0.002, 0.09);
        o.connect(g2).connect(dest);
        o.start(t); o.stop(t + 0.15);
      },
      clap(t, v = 1) {
        const n = noiseSrc(t, 0.3), g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        for (let k = 0; k < 3; k++) {
          const s = t + k * 0.011;
          g.gain.setValueAtTime(0.6 * v, s);
          g.gain.exponentialRampToValueAtTime(0.05, s + 0.009);
        }
        g.gain.setValueAtTime(0.5 * v, t + 0.035);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        n.connect(filter('bandpass', 1300, 1.2)).connect(g).connect(dest);
      },
      hat(t, v = 1) {
        const n = noiseSrc(t, 0.08), g = c.createGain();
        env(g.gain, t, 0.28 * v, 0.001, 0.045);
        n.connect(filter('highpass', 7500)).connect(g).connect(dest);
      },
      open(t, v = 1) {
        const n = noiseSrc(t, 0.4), g = c.createGain();
        env(g.gain, t, 0.24 * v, 0.002, 0.3);
        n.connect(filter('highpass', 6500)).connect(g).connect(dest);
      },
      /** A soft tick for a word landing on a step. */
      tick(t) { this.note(t, KEY.A6, 0.05, 0.035); },
      /** One soft sine note of the UI's sounds (all in one key, so they never clash with each other). */
      note(t, freq, peak = 0.06, decay = 0.09) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = freq;
        env(g.gain, t, peak, 0.002, decay);
        o.connect(g).connect(dest);
        o.start(t); o.stop(t + decay + 0.05);
      },
      /** A word's syllable, heard as a short blip: higher and louder when stressed. */
      blip(t, strong) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle';
        o.frequency.value = strong ? KEY.E6 : KEY.A5;
        env(g.gain, t, strong ? 0.32 : 0.16, 0.002, 0.06);
        o.connect(g).connect(dest);
        o.start(t); o.stop(t + 0.09);
      },
      click(t, accent) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'square';
        o.frequency.value = accent ? KEY.A6 : KEY.D6;
        env(g.gain, t, accent ? 0.35 : 0.2, 0.001, 0.04);
        o.connect(filter('lowpass', 5000)).connect(g).connect(dest);
        o.start(t); o.stop(t + 0.06);
      },
    };
  }
  let voices = null; // the live kit, made with the audio context

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
    if (c.words && step === 0) c.words(bar, t, (c.stepsPerBar * 60) / c.bpm / c.stepsPerBeat); // the bar's syllables, timed within it
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
    const now = ctx.currentTime - latency();
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

  function latency() {
    if (userLat != null) return userLat;
    return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0;
  }

  /**
   * Hear where bar 1 of an imported beat falls: `bars` bars of it from `offset`, with a click on
   * every beat on top. Returns a stop function.
   */
  function previewBeat({ buffer, offset, bpm, bars = 2 }) {
    ensure();
    stop();
    const t0 = ctx.currentTime + 0.1, beat = 60 / bpm, srcs = [];
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffer;
    g.gain.value = 0.9;
    src.connect(g).connect(ctx.destination);
    src.start(t0, Math.max(0, offset));
    src.stop(t0 + bars * 4 * beat);
    srcs.push(src);
    for (let i = 0; i < bars * 4; i++) voices.click(t0 + i * beat, i % 4 === 0);
    return () => srcs.forEach((x) => { try { x.stop(); } catch (e) { /* done */ } });
  }

  /**
   * Mix a take with the beat it was recorded over, offline (faster than real time).
   * steps: the transport log of the take ({ t, bar, step } in seconds from its start);
   * getBar(bar) → that bar's drum pattern or null; track: an imported beat
   * ({ buffer, offset, bars, bpm, rate }) or null; lag: how much later than the beat the voice
   * landed on the recording (speaker + mic delay). Returns a stereo AudioBuffer.
   */
  /**
   * A take's stems, rendered offline: the beat (drum patterns and / or the imported beat, as heard
   * while recording) and the vocal — through the vocal chain when given its settings (`chain`, from
   * a js/mix.js preset). With `original` (the take as recorded), also that, plain, as `raw` — to
   * compare with. Mixing and mastering them is js/mix.js.
   * Resolves { beat: [L, R] | null, vocal: [L, R], raw: Float32Array | null, rate }.
   */
  async function renderStems({ voice, original = null, steps, getBar, track, lag = 0, songBpm, chain = null }) {
    const rate = 44100, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const len = Math.ceil((voice.duration + 0.4) * rate);
    // the beat: drums through the same bus as live, the imported beat on its bar lines
    let beat = null;
    if (getBar || track) {
      const off = new OAC(2, len, rate);
      const bus = off.createGain(), comp = off.createDynamicsCompressor();
      bus.gain.value = 0.85; comp.threshold.value = -12; comp.ratio.value = 4;
      bus.connect(comp).connect(off.destination);
      const kit = makeVoices(off, bus, makeNoise(off));
      const end = voice.duration;
      for (const s of steps) {
        const t = s.t + lag;
        if (s.bar < 0 || t < 0 || t > end) continue; // no count-in clicks in the mix
        const pat = getBar ? getBar(s.bar) : null;
        if (pat) for (const k of ['kick', 'snare', 'clap', 'hat', 'open']) { const v = pat[k] && pat[k][s.step]; if (v) kit[k](t, v > 1 ? 1.25 : 1); }
        if (track && s.step === 0 && s.bar % track.bars === 0) {
          const src = off.createBufferSource(), g = off.createGain();
          src.buffer = track.buffer;
          src.playbackRate.value = track.rate || 1;
          g.gain.value = 0.9;
          src.connect(g).connect(off.destination);
          src.start(t, Math.max(0, track.offset || 0));
          src.stop(t + (track.bars * 240) / songBpm);
        }
      }
      const b = await off.startRendering();
      beat = [b.getChannelData(0), b.getChannelData(1)];
    }
    // the vocal, in the middle of both channels
    const off = new OAC(2, len, rate);
    const vs = off.createBufferSource();
    vs.buffer = voice;
    if (chain) vocalChain(off, vs, voice, chain).connect(off.destination);
    else vs.connect(off.destination);
    vs.start(0);
    const v = await off.startRendering();
    let raw = null;
    if (original) {
      const o = new OAC(1, len, rate), os = o.createBufferSource();
      os.buffer = original;
      os.connect(o.destination);
      os.start(0);
      raw = (await o.startRendering()).getChannelData(0);
    }
    return { beat, vocal: [v.getChannelData(0), v.getChannelData(1)], raw, rate };
  }

  /**
   * The vocal chain's fixed part, for a phone or laptop mic: brought to a steady level first (so the
   * compressor works the same on a quiet or a loud take), low rumble off, evened out, then a short
   * room around it. Its tone, phrase levels and "s" sounds are then set from measuring it
   * (js/mix.js). Returns its output node.
   */
  function vocalChain(c, src, voice, { ratio = 3, threshold = -24, room = 0.14, low = 90, high = 0 } = {}) {
    const lufs = FP.mix ? FP.mix.loudness([voice.getChannelData(0)], voice.sampleRate) : -20;
    const pre = c.createGain();
    pre.gain.value = Number.isFinite(lufs) ? Math.min(FP.mix.fromDb(30), FP.mix.fromDb(-18 - lufs)) : 1;
    const f = (type, freq, gain = 0, Q = 0.707) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.gain.value = gain; b.Q.value = Q; return b; };
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = threshold; comp.knee.value = 8; comp.ratio.value = ratio; comp.attack.value = 0.006; comp.release.value = 0.15;
    let node = src.connect(pre).connect(f('highpass', low));
    if (high) node = node.connect(f('lowpass', high)); // lo-fi: a narrower, older-sounding voice
    node = node.connect(comp);
    // the room: a short, dark, stereo tail, mixed in low (20 ms in, so the words stay up front)
    const out = c.createGain(), dry = c.createGain(), wet = c.createGain(), pd = c.createDelay(0.1), verb = c.createConvolver();
    dry.gain.value = 1; wet.gain.value = room; pd.delayTime.value = 0.02;
    verb.buffer = roomIR(c, 1.1);
    node.connect(dry).connect(out);
    node.connect(pd).connect(f('lowpass', 6500)).connect(verb).connect(wet).connect(out);
    return out;
  }
  /** A room's impulse response: decaying noise, different in each ear. */
  function roomIR(c, secs) {
    const n = Math.round(secs * c.sampleRate), ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-5 * i) / n) * 0.5;
    }
    return ir;
  }

  /** A 16-bit PCM WAV file from an AudioBuffer. */
  function encodeWav(buffer) {
    const ch = buffer.numberOfChannels, len = buffer.length, rate = buffer.sampleRate;
    const v = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len * ch * 2, true);
    const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
    return new Blob([v], { type: 'audio/wav' });
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
  /** The loudest sample in a buffer (0–1), checking every 4th sample — enough to tell sound from silence. */
  const peakOf = (buf) => {
    let p = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i += 4) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > p) p = v; } }
    return p;
  };
  async function decode(blob) {
    ensure();
    const data = await blob.arrayBuffer();
    return new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
  }

  /**
   * How each bar of a beat sounds, for finding its sections: overall loudness, bass (kick/808)
   * and brightness (hats, top end), in dB. Bars are cut from `offset` at the beat's tempo.
   */
  const chansOf = (buffer) => Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  /** Each bar's sound, for finding the beat's sections (js/structure.js). */
  const barFeatures = (buffer, bpm, offset, bars) => FP.structure.features(chansOf(buffer), buffer.sampleRate, bpm, offset, bars);
  /** The beat's tempo and where its bar 1 starts ({ bpm, offset }); with `bpm` known, just bar 1. */
  const guessTiming = (buffer, bpm = null) => FP.structure.tempo(chansOf(buffer), buffer.sampleRate, { bpm });
  const guessBpm = (buffer) => guessTiming(buffer).bpm;

  FP.audio = {
    ensure,
    play,
    stop,
    state,
    hit(track) { ensure(); voices[track](ctx.currentTime + 0.01); },
    tick() { ensure(); voices.tick(ctx.currentTime + 0.005); },
    /** A UI sound by name: land, slot, bar, save, undo, remove. */
    ui(name) {
      ensure();
      const t = ctx.currentTime + 0.005;
      (UI[name] || UI.land).forEach(([n, d], i, all) => voices.note(t + d, KEY[n], i === all.length - 1 ? 0.06 : 0.045, n.endsWith('4') ? 0.14 : 0.1));
    },
    update(patch) { if (tr.cfg) Object.assign(tr.cfg, patch); if (patch.bpm) tr.bpm = patch.bpm; },
    /** When each step of the last transport run sounded (kept after stop), plus its tempo. */
    timeline: () => ({ log: tr.log.slice(), bpm: tr.bpm }),
    loopAt: (t, o) => { ensure(); loopAt(t, o); },
    decode,
    peakOf,
    guessBpm,
    guessTiming,
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
    /** Seconds between a sound being scheduled and heard (and the voice reaching the recorder). */
    latency,
    /** The measured headphone delay in seconds, or null to go back to what the browser reports. */
    setLatency(s) { userLat = s == null ? null : Math.max(0, Math.min(0.6, s)); },
    clickAt(t, accent) { ensure(); voices.click(t, accent); },
    blipAt(t, strong) { ensure(); voices.blip(t, strong); },
    session,
    /** Hear a cadence: a bar of clicks, then the cadence's hits as blips over clicks. */
    previewRhythm({ steps, n = 16, bpm }) {
      ensure();
      stop();
      const beat = 60 / bpm, bar = 4 * beat, t0 = ctx.currentTime + 0.1;
      for (let i = 0; i < 8; i++) voices.click(t0 + i * beat, i % 4 === 0);
      steps.forEach((k) => voices.blip(t0 + bar + (k / n) * bar, k % (n / 4) === 0));
    },
    previewBeat,
    renderStems,
    encodeWav,
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
    FP.audio.session('play-and-record'); // the beat keeps playing while the mic is on
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
    FP.audio.session('playback');
    cancelAnimationFrame(raf);
    if (src) { try { src.disconnect(); } catch (e) { /* ignore */ } }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; mr = null; src = null; chunks = [];
  }

  FP.rec = { supported, start, stop, isRecording: () => !!mr };
})();
