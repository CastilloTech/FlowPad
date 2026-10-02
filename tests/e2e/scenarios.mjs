// End-to-end scenarios. `run` executes in the page (window.E2E has the helpers); `check` runs in Node.
// Scenarios marked `audio` need a running audio clock and are skipped where there isn't one.

export default [
  {
    name: 'editing: push across bars, replace / shift drops, undo, print',
    async run() {
      const { sleep, bars, steps, cell, type, drag, menu } = E2E;
      const out = {};
      document.querySelector('.row').click(); await sleep(500);
      // a full bar at the end of the song
      document.querySelector('[data-a="add-bar"]').click(); await sleep(150);
      await type('a b c d e f g h i j k l m n o p');
      const n = bars().length;
      out.full = steps(bars()[n - 1]);
      // a 2-syllable word over "c" pushes everything along; "p" carries into a new bar
      cell(bars()[n - 1], 2).click(); await sleep(100);
      await type('yellow ');
      out.afterType = [steps(bars()[n - 1]), steps(bars()[n])];
      // drag "a" onto "b" → Shift
      await drag(cell(bars()[n - 1], 0), cell(bars()[n - 1], 1));
      out.dropOptions = [...document.querySelectorAll('.menu-i span')].map((s) => s.textContent);
      menu(/Shift/).click(); await sleep(300);
      out.afterShift = [steps(bars()[n - 1]), steps(bars()[n])];
      // drag "yel-" onto "n" → Replace
      const L = bars()[n - 1], ks = [...L.querySelectorAll('.ct')].map((c) => c.textContent);
      await drag(cell(L, ks.indexOf('yel-')), cell(L, ks.indexOf('n')));
      menu(/Replace/).click(); await sleep(300);
      out.afterReplace = steps(bars()[n - 1]);
      // closing the choice cancels the move
      await drag(cell(bars()[n - 1], 1), cell(bars()[n - 1], 2));
      document.querySelector('.scrim').click(); await sleep(300);
      out.afterCancel = steps(bars()[n - 1]);
      // undo the replace, then redo it
      document.querySelector('#bundo').click(); await sleep(200);
      out.undone = steps(bars()[n - 1]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); await sleep(200);
      out.redone = steps(bars()[n - 1]);
      // print sheet
      window.print = () => { window.__printed = true; };
      document.querySelector('[data-a="fmenu"]').click(); await sleep(300);
      menu(/Print/).click(); await sleep(200);
      out.print = { called: !!window.__printed, title: document.querySelector('#print h1')?.textContent, bold: document.querySelector('#print p b')?.textContent };
      return out;
    },
    check(r, assert) {
      assert.equal(r.full, 'a b c d e f g h i j k l m n o p');
      assert.deepEqual(r.afterType, ['a b yel- low d e f g h i j k l m n o', 'p · · · · · · · · · · · · · · ·']);
      assert.deepEqual(r.dropOptions, ['Replace', 'Shift words along']);
      assert.deepEqual(r.afterShift, ['· a b yel- low d e f g h i j k l m n', 'o p · · · · · · · · · · · · · ·']);
      assert.equal(r.afterReplace, '· a b · low d e f g h i j k l m yel-');
      assert.equal(r.afterCancel, r.afterReplace);
      assert.equal(r.undone, '· a b yel- low d e f g h i j k l m n');
      assert.equal(r.redone, r.afterReplace);
      assert.deepEqual(r.print, { called: true, title: 'Late Night', bold: 'LATE' });
    },
  },

  {
    name: 'record: count-in, words onto the steps, playback in time, write again',
    audio: true,
    async run() {
      const { sleep, bars, steps } = E2E;
      if (!(await E2E.audioRuns())) return { skipped: 'audio clock does not run here' };
      document.querySelector('.row').click(); await sleep(500);
      const ctx = FP.audio.ensure();
      const PHRASE = 'late night pen tight city lights glow', STEPS = [0, 2, 4, 6, 8, 10, 12, 14];
      let t0 = 0;
      // the mic: a take with a voice-like burst on bar 1 steps 1, 3, 5 … of the real beat clock
      FP.rec.supported = () => true;
      FP.rec.start = async () => { t0 = ctx.currentTime; };
      FP.rec.stop = async () => {
        const log = FP.audio.timeline().log.filter((e) => e.bar === 0);
        const rate = 22050, dur = ctx.currentTime - t0;
        const off = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
        for (const k of STEPS) {
          const at = log.find((e) => e.step === k).t - t0 + FP.audio.latency() + 0.02;
          const o = off.createOscillator(), g = off.createGain();
          o.type = 'sawtooth'; o.frequency.value = 180;
          g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.5, at + 0.02); g.gain.setValueAtTime(0.5, at + 0.12); g.gain.linearRampToValueAtTime(0, at + 0.16);
          o.connect(g).connect(off.destination); o.start(at); o.stop(at + 0.2);
        }
        return { blob: E2E.wav((await off.startRendering()).getChannelData(0), rate), duration: dur, mime: 'audio/wav', t0 };
      };
      // speech recognition hears the phrase
      FP.voice.supported = () => true;
      FP.voice.start = () => true;
      FP.voice.stop = async () => ({ phrases: [{ text: PHRASE, tFirst: t0 + 3.5, tLast: t0 + 5.6 }], error: null });

      const out = { barsBefore: bars().length };
      document.querySelector('#drec').click(); await sleep(250);
      out.countLabel = document.querySelector('#rlabel').textContent;
      await sleep(6300); // the count-in bar, then bar 1
      document.querySelector('#drec').click(); await sleep(2500);
      out.barsAfter = bars().length;
      out.written = steps(bars()[bars().length - 1]);
      out.toast = document.querySelector('#toast').textContent;
      // play the take back: the beat comes back and the grid follows the words
      E2E.dock(/Takes/).click(); await sleep(400);
      document.querySelector('.take [data-a="tplay"]').click(); await sleep(4000);
      out.playing = FP.audio.state();
      const now = document.querySelector('.cell.now');
      out.followed = now ? steps(now.closest('.blk')) : null;
      document.querySelector('.take [data-a="tplay"]').click(); await sleep(200);
      out.stopped = !FP.audio.state().playing && !document.querySelector('.cell.now');
      // write its words again
      document.querySelector('.take [data-a="tmore"]').click(); await sleep(300);
      E2E.menu(/Write its words/).click(); await sleep(2500);
      out.again = steps(bars()[bars().length - 1]);
      out.barsFinal = bars().length;
      return out;
    },
    check(r, assert) {
      const WORDS = 'late · night · pen · tight · ci- · ty · lights · glow ·';
      assert.equal(r.countLabel, '4');
      assert.equal(r.barsAfter, r.barsBefore + 1);
      assert.equal(r.written, WORDS);
      assert.match(r.toast, /7 words written into 1 bar/);
      assert.deepEqual(r.playing, { playing: true, kind: 'take' });
      assert.equal(r.followed, WORDS);
      assert.ok(r.stopped);
      assert.equal(r.again, WORDS);
      assert.equal(r.barsFinal, r.barsAfter + 1);
    },
  },

  {
    name: 'beat: import, tempo guess, drums layer, remove',
    audio: true,
    async run() {
      const { sleep } = E2E;
      if (!(await E2E.audioRuns())) return { skipped: 'audio clock does not run here' };
      document.querySelector('.row').click(); await sleep(500);
      // 4 bars at 90 BPM, a kick on every beat
      const rate = 22050, dur = (4 * 240) / 90, off = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
      for (let b = 0; b < 16; b++) {
        const t = (b * 60) / 90, o = off.createOscillator(), g = off.createGain();
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g).connect(off.destination); o.start(t); o.stop(t + 0.32);
      }
      const wav = E2E.wav((await off.startRendering()).getChannelData(0), rate);
      E2E.dock(/Beat/).click(); await sleep(300);
      const out = { dotsBefore: document.querySelectorAll('.cell .dr i').length };
      E2E.choose(document.querySelector('#tfile'), new File([wav], 'loop.wav', { type: 'audio/wav' })); await sleep(1500);
      out.guessed = document.querySelector('.beatform [name=bpm]')?.value;
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      E2E.choose(document.querySelector('#tfile'), new File([wav], 'Night Drive 90bpm.wav', { type: 'audio/wav' })); await sleep(1500);
      const form = document.querySelector('.beatform');
      out.form = { bpm: form.elements.bpm.value, bars: form.elements.bars.value };
      form.requestSubmit(); await sleep(600);
      out.trackbox = document.querySelector('.trackbox .tsub')?.textContent;
      out.dotsUnderBeat = document.querySelectorAll('.cell .dr i').length;
      document.querySelector('#dplay').click(); await sleep(1200);
      out.playing = FP.audio.state().playing;
      document.querySelector('#dplay').click(); await sleep(200);
      document.querySelector('#tdrums').click(); await sleep(200);
      out.dotsWithDrums = document.querySelectorAll('.cell .dr i').length;
      document.querySelector('[data-a="tmenu"]').click(); await sleep(300);
      E2E.menu(/Remove beat/).click(); await sleep(400);
      out.removed = !document.querySelector('.trackbox') && !!document.querySelector('[data-a="timport"]');
      return out;
    },
    check(r, assert) {
      assert.ok(r.dotsBefore > 0);
      assert.equal(r.guessed, '90');
      assert.deepEqual(r.form, { bpm: '90', bars: '4' });
      assert.equal(r.trackbox, '90 BPM · 4-bar loop');
      assert.equal(r.dotsUnderBeat, 0);
      assert.equal(r.playing, true);
      assert.equal(r.dotsWithDrums, r.dotsBefore);
      assert.ok(r.removed);
    },
  },

  {
    name: 'structure: detect Intro / Verse / Hook / Outro, lay the song out, undo',
    audio: true,
    async run() {
      const { sleep } = E2E;
      if (!(await E2E.audioRuns())) return { skipped: 'audio clock does not run here' };
      document.querySelector('.row').click(); await sleep(500);
      const parts = [['pad', 4], ['verse', 8], ['hook', 8], ['verse', 8], ['hook', 8], ['pad', 4]];
      const bar = 240 / 90, beat = 60 / 90, rate = 22050;
      const off = new OfflineAudioContext(1, Math.ceil(40 * bar * rate), rate);
      const note = (type, freq, t, len, gain, f2) => {
        const o = off.createOscillator(), g = off.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + 0.15);
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
        o.connect(g).connect(off.destination); o.start(t); o.stop(t + len + 0.02);
      };
      let b0 = 0;
      for (const [kind, n] of parts) {
        for (let b = b0; b < b0 + n; b++) {
          const t = b * bar;
          if (kind === 'pad') { note('sine', 220, t, bar * 0.95, 0.05); continue; }
          for (let q = 0; q < 4; q++) note('sine', 110, t + q * beat, 0.3, 0.8, 45);
          for (const q of [1, 3]) note('triangle', 200, t + q * beat, 0.15, 0.4);
          if (kind === 'hook') {
            for (const fq of [261, 329, 392]) note('sawtooth', fq, t, bar * 0.9, 0.12);
            for (let e = 0; e < 8; e++) note('square', 6000, t + (e * beat) / 2, 0.04, 0.06);
          }
        }
        b0 += n;
      }
      const wav = E2E.wav((await off.startRendering()).getChannelData(0), rate);
      E2E.dock(/Beat/).click(); await sleep(300);
      const out = { barsBefore: E2E.bars().length };
      E2E.choose(document.querySelector('#tfile'), new File([wav], 'Test Beat 90bpm.wav', { type: 'audio/wav' })); await sleep(2500);
      document.querySelector('.beatform').requestSubmit(); await sleep(1500);
      out.offer = document.querySelector('.sheet .msg')?.textContent;
      document.querySelector('.sheet [data-a="go"]').click(); await sleep(600);
      out.labels = [...document.querySelectorAll('.blk.label')].map((l) => l.textContent).join(' | ');
      out.bars = E2E.bars().length;
      out.firstLyric = E2E.bars()[0].querySelector('.bline').textContent.slice(0, 15);
      document.querySelector('#bundo').click(); await sleep(300);
      out.undoBars = E2E.bars().length;
      return out;
    },
    check(r, assert) {
      assert.equal(r.offer, 'Intro 4 · Verse 1 8 · Hook 8 · Verse 2 8 · Hook 8 · Outro 4');
      assert.equal(r.labels, 'Intro | Verse 1 | Hook | Verse 2 | Hook | Outro');
      assert.equal(r.bars, 40);
      assert.equal(r.firstLyric, 'Late night, pen');
      assert.equal(r.undoBars, r.barsBefore);
    },
  },

  {
    name: 'crash: an error shows the card, lyrics are saved, noise is ignored',
    allowErrors: true,
    async run() {
      const { sleep, bars, cell, type } = E2E;
      document.querySelector('.row').click(); await sleep(500);
      cell(bars()[0], 1).click(); await sleep(80);
      await type('saved');
      // browser noise and a refused permission don't count
      window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      await sleep(200);
      const quietBefore = !document.querySelector('.crash');
      setTimeout(() => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); });
      await sleep(400);
      const card = document.querySelector('.crash');
      const out = { quietBefore, card: card && card.querySelector('b').textContent, report: card && card.querySelector('a').href };
      // the lyric was written to storage before the card appeared
      out.stored = await new Promise((r) => { const q = indexedDB.open('flowpad'); q.onsuccess = () => { const g = q.result.transaction('files').objectStore('files').getAll(); g.onsuccess = () => r(g.result.some((f) => /saved/.test(f.text))); }; });
      card.querySelector('[data-dismiss]').click(); await sleep(100);
      out.dismissed = !document.querySelector('.crash');
      return out;
    },
    check(r, assert) {
      assert.ok(r.quietBefore, 'noise should not show the crash card');
      assert.equal(r.card, 'Something went wrong');
      assert.match(r.report, /github\.com\/CastilloTech\/FlowPad\/issues\/new\?title=Crash/);
      assert.ok(r.stored, 'lyrics should be saved');
      assert.ok(r.dismissed);
    },
  },

  {
    name: 'home: install offer from the second visit, privacy and feedback links',
    async run() {
      const { sleep } = E2E;
      const out = { firstVisit: !document.querySelector('.notice') };
      // a second visit, then the browser offers installing
      await new Promise((r) => { const q = indexedDB.open('flowpad'); q.onsuccess = () => { const s = q.result.transaction('kv', 'readwrite').objectStore('kv'); const g = s.get('settings'); g.onsuccess = () => { s.put({ ...g.result, opens: 2 }); r(); }; }; });
      location.reload();
      return out;
    },
    async after() {
      const { sleep } = E2E;
      let prompted = false;
      const ev = new Event('beforeinstallprompt', { cancelable: true });
      ev.prompt = () => { prompted = true; };
      ev.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(ev);
      await sleep(300);
      const card = document.querySelector('.notice');
      const out = { card: card && card.querySelector('b').textContent };
      document.querySelector('[data-a="install"]').click(); await sleep(300);
      out.prompted = prompted;
      window.dispatchEvent(new Event('appinstalled')); await sleep(300);
      out.goneAfterInstall = !document.querySelector('.notice');
      document.querySelector('[data-a="settings"]').click(); await sleep(300);
      out.links = [...document.querySelectorAll('.sheet a.menu-i')].map((a) => `${a.querySelector('span').textContent} → ${a.getAttribute('href')}`);
      out.privacy = await (await fetch('privacy.html')).text().then((t) => /<h1>Privacy<\/h1>/.test(t));
      return out;
    },
    check(r, assert) {
      assert.ok(r.firstVisit, 'no offer on the first visit');
      assert.equal(r.card, 'Install FlowPad');
      assert.ok(r.prompted, 'Install shows the browser prompt');
      assert.ok(r.goneAfterInstall);
      assert.deepEqual(r.links, ['Privacy → privacy.html', 'Send feedback → https://github.com/CastilloTech/FlowPad/issues/new']);
      assert.ok(r.privacy);
    },
  },

  {
    name: 'speed: typing in a 70-bar song',
    async run() {
      const { sleep } = E2E;
      document.querySelector('.row').click(); await sleep(500);
      const inp = () => document.querySelector('#cin');
      const type = (v) => { const t0 = performance.now(); inp().value = v; inp().dispatchEvent(new Event('input', { bubbles: true })); return performance.now() - t0; };
      const lines = ['Late night pen tight city lights glow', 'Every single syllable is counted in the flow', 'Kick on the one and the snare on the two', 'Every word I write is a window into you'];
      document.querySelector('[data-a="add-bar"]').click(); await sleep(100);
      for (let i = 0; i < 64; i++) { type(`${lines[i % 4]} `); inp().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
      await sleep(300);
      const b = E2E.bars();
      b[b.length - 3].querySelectorAll('.cell')[3].click(); await sleep(50);
      const t = [];
      for (const v of ['m', 'mo', 'mon', 'mone', 'money']) { t.push(type(v)); await sleep(30); }
      return { bars: b.length, keystrokeMs: Math.round(t.reduce((a, x) => a + x, 0) / t.length) };
    },
    check(r, assert) {
      assert.ok(r.bars >= 70);
      // generous for slow CI machines; a full repaint used to take 70–90 ms on a fast desktop
      assert.ok(r.keystrokeMs < 60, `a keystroke took ${r.keystrokeMs} ms`);
    },
  },
];
