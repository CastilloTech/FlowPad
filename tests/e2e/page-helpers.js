// Helpers installed into the page before each scenario (window.E2E). Plain browser JS.
window.E2E = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  bars: () => [...document.querySelectorAll('.blk.bar')],
  /** A bar's steps as text, "·" for a rest. */
  steps: (bar) => [...bar.querySelectorAll('.ct')].map((c) => c.textContent || '·').join(' '),
  cell: (bar, k) => bar.querySelectorAll('.cell')[k],
  async type(v) {
    const i = document.querySelector('#cin');
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    await E2E.sleep(120);
  },
  mid(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  pointer(type, el, p, pointerType = 'mouse') {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerType, button: 0, isPrimary: true }));
  },
  /** Mouse-drag one step onto another (or onto any element); `pause` ms over it before letting go. */
  async drag(from, to, { pause = 0, during } = {}) {
    from.scrollIntoView({ block: 'center' });
    await E2E.sleep(60);
    const a = E2E.mid(from), b = E2E.mid(to);
    E2E.pointer('pointerdown', from, a);
    E2E.pointer('pointermove', document, { x: a.x + 10, y: a.y });
    E2E.pointer('pointermove', document, b);
    if (during) await during();
    if (pause) await E2E.sleep(pause);
    E2E.pointer('pointerup', document, b);
    await E2E.sleep(300);
  },
  /** A one-finger touch gesture on el: from its middle by (dx, dy), in steps; `mid` runs before the finger lifts. */
  async swipe(el, dx, dy, steps = 8, mid) {
    const a = E2E.mid(el);
    const touch = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const fire = (type, t) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    fire('touchstart', touch(a.x, a.y));
    for (let i = 1; i <= steps; i++) { fire('touchmove', touch(a.x + (dx * i) / steps, a.y + (dy * i) / steps)); await E2E.sleep(16); }
    if (mid) mid();
    fire('touchend', touch(a.x + dx, a.y + dy));
    await E2E.sleep(400);
  },
  toastAct: () => document.querySelector('#toast.show .toast-act'),
  menu: (re) => [...document.querySelectorAll('.menu-i')].find((m) => re.test(m.textContent)),
  dock: (re) => [...document.querySelectorAll('.dk-p')].find((b) => re.test(b.textContent)),
  /** Mono 16-bit WAV from float samples. */
  wav(pcm, rate) {
    const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    pcm.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
    return new Blob([v], { type: 'audio/wav' });
  },
  /**
   * Does the audio clock run at real speed here? A new headless audio clock crawls for about a
   * second before it settles, and some CI machines have no audio output at all.
   */
  async audioRuns() {
    const ctx = FP.audio.ensure();
    try { await ctx.resume(); } catch (e) { /* ignore */ }
    for (let i = 0; i < 10; i++) {
      const t0 = ctx.currentTime;
      await E2E.sleep(400);
      if (ctx.currentTime - t0 > 0.32) return true;
    }
    return false;
  },
  /** Put a file into a hidden file input. */
  choose(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },
};
