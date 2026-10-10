// End-to-end scenarios. `run` executes in the page (window.E2E has the helpers); `check` runs in Node.
// Scenarios marked `audio` need a running audio clock and are skipped where there isn't one.

export default [
  {
    name: 'editing: push across bars, shift preview, pause to replace, undo, cancel, print',
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
      // drag "a" onto "b": the words slide along as a preview, and dropping shifts them
      await drag(cell(bars()[n - 1], 0), cell(bars()[n - 1], 1), {
        during: async () => { await sleep(80); out.preview = { badge: document.querySelector('.drag-ghost .gb')?.textContent, sliding: document.querySelectorAll('.cell.fly').length }; },
      });
      out.noQuestion = !document.querySelector('.sheet-wrap');
      out.afterShift = [steps(bars()[n - 1]), steps(bars()[n])];
      // drag "yel-" onto "n" and pause there: replace
      const L = bars()[n - 1], ks = [...L.querySelectorAll('.ct')].map((c) => c.textContent);
      await drag(cell(L, ks.indexOf('yel-')), cell(L, ks.indexOf('n')), {
        during: async () => { await sleep(800); out.pausedBadge = document.querySelector('.drag-ghost .gb')?.textContent; },
      });
      out.afterReplace = steps(bars()[n - 1]);
      out.toast = document.querySelector('#toast').textContent;
      // the message's Undo puts it back; Ctrl+Shift+Z redoes it
      E2E.toastAct().click(); await sleep(250);
      out.undone = steps(bars()[n - 1]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); await sleep(250);
      out.redone = steps(bars()[n - 1]);
      // dropping off the grid cancels
      await drag(cell(bars()[n - 1], 1), document.querySelector('#stat'));
      out.afterCancel = steps(bars()[n - 1]);
      // print sheet
      window.print = () => { window.__printed = true; };
      document.querySelector('[data-a="fmenu"]').click(); await sleep(300);
      menu(/Share & export/).click(); await sleep(350);
      menu(/Print/).click(); await sleep(200);
      out.print = { called: !!window.__printed, title: document.querySelector('#print h1')?.textContent, bold: document.querySelector('#print p b')?.textContent };
      return out;
    },
    check(r, assert) {
      assert.equal(r.full, 'a b c d e f g h i j k l m n o p');
      assert.deepEqual(r.afterType, ['a b yel- low d e f g h i j k l m n o', 'p · · · · · · · · · · · · · · ·']);
      assert.deepEqual(r.preview, { badge: 'Shift', sliding: 15 });
      assert.ok(r.noQuestion, 'a drop no longer asks');
      assert.deepEqual(r.afterShift, ['· a b yel- low d e f g h i j k l m n', 'o p · · · · · · · · · · · · · ·']);
      assert.equal(r.pausedBadge, 'Replace');
      assert.equal(r.afterReplace, '· a b · low d e f g h i j k l m yel-');
      assert.match(r.toast, /^Replaced “n”Undo$/);
      assert.equal(r.undone, '· a b yel- low d e f g h i j k l m n');
      assert.equal(r.redone, r.afterReplace);
      assert.equal(r.afterCancel, r.afterReplace);
      assert.deepEqual(r.print, { called: true, title: 'Late Night', bold: 'LATE' });
    },
  },

  {
    name: 'record: count-in, words onto the steps, playback in time, write again, export with the beat',
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
      // export it with the beat: the mix must hold the drums, lined up with how they were heard
      let saved = null;
      window.download = (name, blob) => { saved = { name, blob }; };
      document.querySelector('.take [data-a="tmore"]').click(); await sleep(300);
      E2E.menu(/Export with the beat/).click(); await sleep(350);
      out.mixOpts = { vocal: document.querySelector('#mvoc .on').textContent, choices: [...document.querySelectorAll('#mvoc button')].map((b) => b.textContent), target: document.querySelector('#mtgt .on').textContent };
      document.querySelector('.sheet [data-a="mgo"]').click();
      for (let i = 0; i < 100 && !document.querySelector('.sheet [data-a="msave"]'); i++) await sleep(100);
      out.mixLevel = document.querySelector('.sheet .mlev')?.textContent;
      out.mixSaid = [...document.querySelectorAll('.sheet .mrep li')].map((li) => li.textContent);
      // mixed against original, at the same loudness
      document.querySelector('.sheet [data-a="abplay"]').click(); await sleep(300);
      document.querySelector('#absel [data-v="raw"]').click(); await sleep(150);
      out.ab = { playing: document.querySelector('.sheet [data-a="abplay"]').classList.contains('on'), picked: document.querySelector('#absel .on').textContent };
      document.querySelector('.sheet [data-a="abplay"]').click(); await sleep(100);
      out.ab.stopped = !document.querySelector('.sheet [data-a="abplay"]').classList.contains('on');
      document.querySelector('.sheet [data-a="msave"]').click(); await sleep(200);
      out.mixName = saved && saved.name;
      const ctxA = FP.audio.ensure();
      // read at the file's own rate (44.1 kHz): resampling to the device's rate would add its own overshoot
      const at44 = new OfflineAudioContext(2, 1, 44100);
      const mix = await new Promise((r, j) => saved.blob.arrayBuffer().then((d) => at44.decodeAudioData(d, r, j)));
      const take = await (await new Promise((r) => { const q = indexedDB.open('flowpad'); q.onsuccess = () => { const g = q.result.transaction('recordings').objectStore('recordings').getAll(); g.onsuccess = () => r(g.result[0]); }; })).blob.arrayBuffer().then((d) => new Promise((r, j) => ctxA.decodeAudioData(d, r, j)));
      const tl = (await new Promise((r) => { const q = indexedDB.open('flowpad'); q.onsuccess = () => { const g = q.result.transaction('recordings').objectStore('recordings').getAll(); g.onsuccess = () => r(g.result[0].timing); }; }));
      // Boom Bap kicks on steps 1, 8, 11 of each bar — step 8 (index 7) is odd, where the voice is silent
      const kick = tl.log.find((e) => e.bar === 0 && e.step === 7).t + (tl.lat || 0) + 0.02;
      const rms = (buf, a, b) => { const x = buf.getChannelData(0), r = buf.sampleRate; let s2 = 0, n = 0; for (let i = Math.floor(a * r); i < Math.floor(b * r); i++) { s2 += x[i] * x[i]; n++; } return Math.sqrt(s2 / Math.max(1, n)); };
      // where the voice is silent, the first sound in the mix is the kick: when does it start?
      let onset = null;
      for (let a = kick - 0.004; a < kick + 0.08; a += 0.005) if (rms(mix, a, a + 0.005) > 0.05) { onset = a; break; }
      out.mix = {
        seconds: +mix.duration.toFixed(1), takeSeconds: +take.duration.toFixed(1), channels: mix.numberOfChannels,
        kickOffMs: onset == null ? null : Math.round((onset - kick) * 1000),
        kickNotInTake: rms(take, kick, kick + 0.06) < 0.01,
        // mastered: at the loudness target, peaks under −1 dB
        lufs: +FP.mix.loudness([mix.getChannelData(0), mix.getChannelData(1)], mix.sampleRate).toFixed(1),
        peakDb: +FP.mix.toDb(Math.max(...[0, 1].map((c) => mix.getChannelData(c).reduce((m, x) => Math.max(m, Math.abs(x)), 0)))).toFixed(2),
      };
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
      assert.match(r.mixName, /\(with beat\)\.wav$/);
      assert.equal(r.mix.channels, 2);
      assert.ok(Math.abs(r.mix.seconds - r.mix.takeSeconds) <= 0.5, `mix ${r.mix.seconds}s vs take ${r.mix.takeSeconds}s`);
      assert.ok(r.mix.kickNotInTake, 'the voice-only take is silent where the kick lands');
      assert.ok(r.mix.kickOffMs != null && Math.abs(r.mix.kickOffMs) <= 20, `the kick should start where it was heard (off by ${r.mix.kickOffMs} ms)`);
      assert.deepEqual(r.mixOpts, { vocal: 'Clean', choices: ['Raw', 'Clean', 'Radio', 'Lo-fi'], target: 'Streaming' });
      assert.deepEqual(r.ab, { playing: true, picked: 'Original', stopped: true });
      // the test take is very spiky (tone bursts over a drum pattern): where reaching −14 would take
      // crushing it, the mix stops short — and must say so
      assert.match(r.mixLevel, /^-1[345]\.\d LUFS · peak -1\.\d dB$/);
      assert.ok(Math.abs(r.mix.lufs - -14) <= 0.6 || r.mixSaid.some((x) => /^Kept a little under the target/.test(x)), `mix at ${r.mix.lufs} LUFS, said ${JSON.stringify(r.mixSaid)}`);
      assert.ok(r.mix.peakDb <= -0.9, `mix peaks at ${r.mix.peakDb} dB`);
      assert.ok(r.mixSaid.some((x) => /^The beat dips 3 dB/.test(x)), JSON.stringify(r.mixSaid));
    },
  },

  {
    name: 'beat on iPhone: MP3s and videos in the picker, a silent video refused, sound past the silent switch',
    async run() {
      const { sleep } = E2E;
      // Safari's audio session, stood in for: the app asks to play like a music app
      Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
      document.querySelector('.row').click(); await sleep(500);
      E2E.dock(/Beat/).click(); await sleep(300);
      const out = { accept: document.querySelector('#tfile').accept.split(',') };
      FP.audio.ensure();
      out.session = navigator.audioSession.type;
      // a "movie" whose sound decodes to silence: a message, and no beat
      const silent = E2E.wav(new Float32Array(22050 * 3), 22050);
      E2E.choose(document.querySelector('#tfile'), new File([silent], 'clip.mp4', { type: 'video/mp4' })); await sleep(1200);
      out.toast = document.querySelector('#toast').textContent;
      out.noForm = !document.querySelector('.beatform');
      out.noBeat = !document.querySelector('.trackbox') && !!document.querySelector('[data-a="timport"]');
      return out;
    },
    check(r, assert) {
      for (const t of ['.mp3', 'audio/mpeg', '.m4a', '.wav', 'video/mp4', '.mov']) assert.ok(r.accept.includes(t), `the picker offers ${t}`);
      assert.equal(r.session, 'playback');
      assert.match(r.toast, /No sound found in that video/);
      assert.ok(r.noForm && r.noBeat);
    },
  },

  {
    name: 'beat: import, tempo guess, line up bar 1, drums layer, remove',
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
      // line it up: two nudges of +10 ms, and a listen
      [...form.querySelectorAll('[data-a="bn"]')].find((b) => b.dataset.d === '0.01').click();
      [...form.querySelectorAll('[data-a="bn"]')].find((b) => b.dataset.d === '0.01').click();
      form.querySelector('[data-a="bprev"]').click(); await sleep(300);
      out.nudged = form.elements.offset.value;
      form.querySelector('[data-a="bprev"]').click(); // stop
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
      assert.equal(r.nudged, '0.02');
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
      document.querySelector('.beatform').requestSubmit();
      // the sections are worked out in the background: wait for the offer to lay the song out
      for (let i = 0; i < 100 && !document.querySelector('.sheet [data-a="go"]'); i++) await sleep(100);
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
    name: 'rhymes: underlined across bars, selected word lights its rhymes, a tapped rhyme swaps in place',
    async run() {
      const { sleep, bars, steps, cell, type } = E2E;
      document.querySelector('.row').click(); await sleep(500);
      // a new section, so the sample song's words don't join in
      document.querySelector('[data-a="add-sec"]').click(); await sleep(300);
      const f = document.querySelector('.sheet input'); f.value = 'Verse 3'; f.form.requestSubmit(); await sleep(300);
      await type('I take the money then I run every day');
      document.querySelector('#cin').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await sleep(150);
      await type('watch it bake in the sun with the crew');
      await sleep(400);
      const n = bars().length, A = bars()[n - 2], B = bars()[n - 1];
      const marked = (bar) => [...bar.querySelectorAll('.bline .w[data-r]')].map((w) => w.textContent.toLowerCase());
      const out = { underA: marked(A), underB: marked(B) };
      // select "take": its rhymes light up, in the other bar too
      const k = [...A.querySelectorAll('.ct')].findIndex((c) => /^take$/i.test(c.textContent));
      cell(A, k).click(); await sleep(300);
      out.lit = [...document.querySelectorAll('.bline .w.rf')].map((w) => w.textContent.toLowerCase());
      // tapping a rhyme swaps it in for "take"; the next bar is left alone
      const beforeB = steps(B);
      document.querySelector('#cin').blur();
      // tap a rhyme the way the strip's chips do
      const chip = document.createElement('button'); chip.dataset.a = 'ins'; chip.dataset.w = 'make'; document.querySelector('#strip').appendChild(chip); chip.click(); await sleep(300);
      out.afterA = steps(bars()[n - 2]);
      out.bUntouched = steps(bars()[n - 1]) === beforeB;
      out.toast = document.querySelector('#toast').textContent;
      E2E.toastAct().click(); await sleep(250);
      out.undone = steps(bars()[n - 2]).startsWith('I take');
      return out;
    },
    check(r, assert) {
      assert.deepEqual(r.underA.filter((w) => ['take', 'run'].includes(w)).sort(), ['run', 'take']);
      assert.deepEqual(r.underB.filter((w) => ['bake', 'sun'].includes(w)).sort(), ['bake', 'sun']);
      assert.ok(r.lit.includes('take') && r.lit.includes('bake'), `lit: ${r.lit}`); // song-wide: the sample hook's take / make light up too
      assert.ok(!r.lit.includes('money') && !r.lit.includes('run'), 'only rhymes of take');
      assert.ok(r.afterA.startsWith('I make the'), r.afterA);
      assert.ok(r.bUntouched, 'the next bar is left alone');
      assert.equal(r.toast, 'Swapped “take” for “make”Undo');
      assert.ok(r.undone);
    },
  },

  {
    name: 'gestures: swipe a bar to delete / duplicate, swipe sheets and panels closed',
    async run() {
      const { sleep, bars, steps, swipe } = E2E;
      document.querySelector('.row').click(); await sleep(500);
      const out = { bars: bars().length };
      const second = steps(bars()[1]);
      // swipe bar 2 left: deleted, with Undo in the message
      await swipe(bars()[1].querySelector('.bline'), -260, 0, 8, () => { out.widthMidSwipe = document.documentElement.scrollWidth; });
      out.afterDelete = bars().length;
      out.deleteToast = document.querySelector('#toast').textContent;
      E2E.toastAct().click(); await sleep(300);
      out.restored = steps(bars()[1]) === second && bars().length === out.bars;
      // swipe it right: duplicated
      await swipe(bars()[1].querySelector('.bline'), 260, 0);
      out.afterDup = bars().length;
      out.dupSame = steps(bars()[2]) === second;
      // a short swipe springs back
      await swipe(bars()[1].querySelector('.bline'), -40, 0);
      out.afterShort = bars().length;
      // a sheet swiped down by its title closes
      document.querySelector('[data-a="fmenu"]').click(); await sleep(350);
      await swipe(document.querySelector('.sheet-h'), 0, 220);
      out.sheetClosed = !document.querySelector('.sheet-wrap.open');
      // a panel swiped down by its header closes
      E2E.dock(/Bank/).click(); await sleep(350);
      await swipe(document.querySelector('#panel .ph'), 0, 200);
      await sleep(250);
      out.panelClosed = document.querySelector('#panel').hidden;
      return out;
    },
    check(r, assert) {
      assert.equal(r.widthMidSwipe, 390, 'a bar mid-swipe must not widen the page');
      assert.equal(r.afterDelete, r.bars - 1);
      assert.equal(r.deleteToast, 'Bar deletedUndo');
      assert.ok(r.restored, 'Undo brings the bar back');
      assert.equal(r.afterDup, r.bars + 1);
      assert.ok(r.dupSame);
      assert.equal(r.afterShort, r.afterDup);
      assert.ok(r.sheetClosed);
      assert.ok(r.panelClosed);
    },
  },

  {
    name: 'headphone delay: tapping 150 ms after the clicks measures about 150 ms, and it\'s used',
    audio: true,
    async run() {
      const { sleep } = E2E;
      if (!(await E2E.audioRuns())) return { skipped: 'audio clock does not run here' };
      document.querySelector('[data-a="settings"]').click(); await sleep(300);
      document.querySelector('#cal').click(); await sleep(300);
      const tap = document.querySelector('#ctap');
      document.querySelector('#cgo').click();
      const t0 = FP.audio.now() + 0.8;
      // tap 150 ms after every click (the clicks are 0.6 s apart)
      for (let i = 0; i < 16; i++) {
        const due = t0 + i * 0.6 + 0.15;
        while (FP.audio.now() < due) await sleep(4);
        tap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      }
      await sleep(1200);
      return { result: document.querySelector('#cres').textContent, used: Math.round(FP.audio.latency() * 1000), shown: document.querySelector('#calv').textContent };
    },
    check(r, assert) {
      const ms = +(r.result.match(/Measured (\d+) ms/) || [])[1];
      assert.ok(Math.abs(ms - 150) <= 25, r.result);
      assert.equal(r.used, ms);
      assert.equal(r.shown, `${ms} ms · measured`);
    },
  },

  {
    name: 'writing help: syllable target marks bars, stats, flows applied and saved',
    async run() {
      const { sleep, bars, steps } = E2E;
      document.querySelector('.row').click(); await sleep(500);
      const out = {};
      // stats + a target of 10: the sample's 13- and 14-syllable bars are marked over, the 8s under
      document.querySelector('#stat').click(); await sleep(300);
      out.tiles = [...document.querySelectorAll('.tiles b')].map((b) => b.textContent);
      out.sections = [...document.querySelectorAll('.st-t td:first-child')].map((td) => td.textContent);
      const up = document.querySelector('[data-a="tup"]'), dn = document.querySelector('[data-a="tdn"]');
      dn.click(); await sleep(50); // from the average (12) down to 11
      dn.click(); await sleep(150);
      out.target = document.querySelector('#tgv').textContent;
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      out.marks = [...document.querySelectorAll('.bh .cnt')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
      // apply "On the beat" to bar 1: its 8 syllables go on steps 1, 5, 9, 13 (the rest share 13)
      bars()[0].querySelector('[data-a="bar-menu"]').click(); await sleep(300);
      out.barMenu = [...document.querySelectorAll('.menu-i span')].map((x) => x.textContent);
      E2E.menu(/Rhythm/).click(); await sleep(300);
      [...document.querySelectorAll('.flow-i .menu-i')].find((b) => /On the beat/.test(b.textContent)).click(); await sleep(300);
      out.applied = steps(bars()[0]);
      out.toast = document.querySelector('#toast').textContent;
      E2E.toastAct().click(); await sleep(250);
      out.undone = steps(bars()[0]);
      // save bar 2's rhythm and find it in the list
      bars()[1].querySelector('[data-a="bar-menu"]').click(); await sleep(300);
      E2E.menu(/Rhythm/).click(); await sleep(300);
      document.querySelector('.sheet [data-a="fsave"]').click(); await sleep(400);
      const f = document.querySelector('.sheet input'); f.value = 'My flow'; f.form.requestSubmit(); await sleep(300);
      bars()[0].querySelector('[data-a="bar-menu"]').click(); await sleep(300);
      E2E.menu(/Rhythm/).click(); await sleep(300);
      out.flows = [...document.querySelectorAll('.flow-i .menu-i > span:not(.fdots)')].map((s) => s.textContent);
      return out;
    },
    check(r, assert) {
      assert.equal(r.tiles[0], '6');
      assert.deepEqual(r.sections, ['Verse 1', 'Hook']);
      assert.equal(r.target, '10');
      assert.deepEqual(r.marks.slice(0, 3), ['8 syl −2', '13 syl +3', '10 syl']);
      assert.equal(r.applied, 'Late · · · night, · · · pen · · · tight, city lights glow · · ·');
      assert.match(r.toast, /“On the beat” appliedUndo/);
      assert.ok(r.undone.startsWith('Late'), r.undone);
      assert.deepEqual(r.barMenu, ['Rhythm…', 'Hear this bar', 'Insert bar above', 'Insert bar below', 'Clear bar', 'Delete bar']);
      assert.deepEqual(r.flows.slice(0, 3), ['Spread evenly', 'One syllable per step', 'My flow']);
      assert.ok(r.flows.includes('Straight 8ths'));
    },
  },

  {
    name: 'versions: saved on leaving and before big changes, named, restored, copied',
    async run() {
      const { sleep, bars, steps, cell, type, menu } = E2E;
      const out = {};
      const versions = () => new Promise((r) => { const q = indexedDB.open('flowpad'); q.onsuccess = () => { const g = q.result.transaction('versions').objectStore('versions').getAll(); g.onsuccess = () => r(g.result.sort((a, b) => b.created - a.created)); }; });
      const open = async () => { location.hash = '#/'; await sleep(500); document.querySelector('.row').click(); await sleep(600); };
      // an editing session leaves a version behind
      await open();
      const original = steps(bars()[0]);
      cell(bars()[0], 1).click(); await sleep(80); await type('yo'); await sleep(200);
      location.hash = '#/'; await sleep(600);
      out.afterSession = (await versions()).map((v) => v.reason);
      // name one
      await open();
      document.querySelector('[data-a="fmenu"]').click(); await sleep(300);
      menu(/Versions/).click(); await sleep(400);
      document.querySelector('.sheet [data-a="vsave"]').click(); await sleep(350);
      const f = document.querySelector('.sheet input'); f.value = 'Draft 1'; f.form.requestSubmit(); await sleep(400);
      const named = steps(bars()[0]);
      // change it again, then restore the named one
      cell(bars()[0], 3).click(); await sleep(80); await type('zz'); await sleep(200);
      out.changed = steps(bars()[0]) !== named;
      document.querySelector('[data-a="fmenu"]').click(); await sleep(300);
      menu(/Versions/).click(); await sleep(400);
      out.list = [...document.querySelectorAll('.vlist .row-t')].map((x) => x.textContent);
      [...document.querySelectorAll('.vlist .row')].find((x) => /Draft 1/.test(x.textContent)).click(); await sleep(400);
      out.preview = !!document.querySelector('.vtext p');
      document.querySelector('.sheet [data-a="vrestore"]').click(); await sleep(900);
      out.restored = steps(bars()[0]) === named;
      out.afterRestore = (await versions()).map((v) => v.name || v.reason);
      // copy a version as a new song
      document.querySelector('[data-a="fmenu"]').click(); await sleep(300);
      menu(/Versions/).click(); await sleep(400);
      [...document.querySelectorAll('.vlist .row')].find((x) => /Draft 1/.test(x.textContent)).click(); await sleep(400);
      document.querySelector('.sheet [data-a="vcopy"]').click(); await sleep(900);
      out.copyTitle = document.querySelector('.tb-t')?.textContent;
      // a flow over a whole section keeps a version first
      bars()[0].querySelector('[data-a="bar-menu"]').click(); await sleep(300);
      menu(/Rhythm/).click(); await sleep(300);
      document.querySelector('#fwhole').checked = true;
      [...document.querySelectorAll('.flow-i .menu-i')].find((b) => /Straight 8ths/.test(b.textContent)).click(); await sleep(500);
      out.beforeFlow = (await versions()).some((v) => v.reason === 'Before a flow over a section');
      out.original = original;
      return out;
    },
    check(r, assert) {
      assert.deepEqual(r.afterSession, ['Edited']);
      assert.ok(r.changed);
      assert.deepEqual(r.list, ['Draft 1', 'Edited'], 'newest first');
      assert.ok(r.preview);
      assert.ok(r.restored, 'restoring brings the named version back');
      assert.ok(r.afterRestore.includes('Before restoring') && r.afterRestore.includes('Draft 1'), `${r.afterRestore}`);
      assert.match(r.copyTitle, /^Late Night \(today /);
      assert.ok(r.beforeFlow);
    },
  },

  {
    name: 'simple UI: New song first, beat chip opens the Beat panel, takes first with options behind ⚙',
    async run() {
      const { sleep, menu } = E2E;
      const out = {};
      document.querySelector('[data-a="add"]').click(); await sleep(300);
      out.create = [...document.querySelectorAll('.sheet .menu-i span')].map((x) => x.textContent);
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      out.rowSub = [...document.querySelectorAll('.list .row-s')].map((x) => x.textContent).find((x) => /folder/.test(x));
      document.querySelector('.row').click(); await sleep(600);
      document.querySelector('[data-a="fdef"]').click(); await sleep(400);
      out.beatPanel = document.querySelector('.dk-p.on')?.textContent.trim();
      E2E.dock(/Takes/).click(); await sleep(400);
      out.takesEmpty = document.querySelector('.takes-empty b')?.textContent;
      out.noSwitchesInPanel = !document.querySelector('#panel .switch');
      document.querySelector('[data-a="ropts"]').click(); await sleep(350);
      out.options = [...document.querySelectorAll('.sheet .lbl')].map((x) => x.textContent);
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      document.querySelector('[data-a="fmenu"]').click(); await sleep(300);
      out.songMenu = [...document.querySelectorAll('.sheet .menu-i span')].map((x) => x.textContent);
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      location.hash = '#/'; await sleep(500);
      document.querySelector('[data-a="settings"]').click(); await sleep(300);
      out.sections = [...document.querySelectorAll('.sheet .set-sec')].map((x) => x.textContent);
      return out;
    },
    check(r, assert) {
      assert.deepEqual(r.create, ['New song', 'New project']);
      assert.match(r.rowSub || '', /1 song/);
      assert.equal(r.beatPanel, 'Beat');
      assert.equal(r.takesEmpty, 'No takes yet');
      assert.ok(r.noSwitchesInPanel);
      assert.deepEqual(r.options.slice(0, 2), ['Start the beat when I record', 'Count in']);
      assert.deepEqual(r.songMenu, ['Rename', 'Move to…', 'Duplicate', 'Versions…', 'Share & export…', 'Delete song']);
      assert.deepEqual(r.sections, ['General', 'Writing', 'Sound & timing', 'Your data', 'About']);
    },
  },

  {
    name: 'cadence: triplet grids, library cadences, pocket check, repeated cadences in stats',
    async run() {
      const { sleep, bars, steps, menu } = E2E;
      const out = {};
      document.querySelector('.row').click(); await sleep(600);
      const rhythm = async (i) => { bars()[i].querySelector('[data-a="bar-menu"]').click(); await sleep(300); menu(/Rhythm/).click(); await sleep(300); };
      const words = (b) => steps(b).split(' ').filter((x) => x !== '·').join(' ');
      // bar 1 to triplets: same words, same order, on a 12-step grid
      const before = words(bars()[0]);
      await rhythm(0);
      [...document.querySelectorAll('#fgrid button')].find((b) => b.textContent === 'Triplets').click(); await sleep(400);
      out.trip = { n: bars()[0].querySelector('.bgrid').dataset.n, cells: bars()[0].querySelectorAll('.cell').length, tag: bars()[0].querySelector('.gtag')?.textContent, same: words(bars()[0]) === before, first: steps(bars()[0]).split(' ')[0] };
      E2E.toastAct().click(); await sleep(300);
      out.undone = bars()[0].querySelectorAll('.cell').length;
      // a triplet cadence from the library puts bar 2 on triplets
      await rhythm(1);
      out.library = [...document.querySelectorAll('.flow-i .menu-i > span:not(.fdots)')].map((x) => x.textContent);
      document.querySelector('[data-fplay]').click(); await sleep(150); // ▶ preview
      [...document.querySelectorAll('.flow-i .menu-i')].find((b) => /^Triplet$/.test(b.querySelector('span:not(.fdots)').textContent)).click(); await sleep(400);
      out.bar2 = { cells: bars()[1].querySelectorAll('.cell').length, filled: [...bars()[1].querySelectorAll('.ct')].filter((c) => c.textContent).length };
      // pocket check
      document.querySelector('[data-a="pocket"]').click(); await sleep(300);
      out.pocket = [...document.querySelectorAll('.bh .pk')].map((x) => x.textContent);
      out.offp = document.querySelectorAll('.cell.offp').length;
      // the same cadence over the whole verse: repeat badges, and the stats say where to switch up
      await rhythm(0);
      document.querySelector('#fwhole').checked = true;
      [...document.querySelectorAll('.flow-i .menu-i')].find((b) => /Straight 8ths/.test(b.textContent)).click(); await sleep(400);
      out.repeats = [...document.querySelectorAll('.bh .rp')].map((x) => x.textContent);
      document.querySelector('#stat').click(); await sleep(300);
      out.variety = document.querySelector('.cadv')?.textContent;
      return out;
    },
    check(r, assert) {
      assert.deepEqual(r.trip, { n: '12', cells: 12, tag: 'triplets', same: true, first: 'Late' });
      assert.equal(r.undone, 16);
      assert.ok(r.library.includes('Triplet') && r.library.includes('Boom bap bounce'), `${r.library}`);
      assert.equal(r.bar2.cells, 12);
      assert.ok(r.bar2.filled >= 10, 'a 13-syllable bar on 12 triplets fills them');
      // only bars with stresses off the pocket say so, and those stresses are marked
      assert.ok(r.pocket.length >= 3 && r.pocket.every((x) => /^(\d+)\/(\d+)$/.test(x) && +x.split('/')[0] < +x.split('/')[1]), `${r.pocket}`);
      assert.ok(r.offp >= r.pocket.length);
      assert.deepEqual(r.repeats, ['≡3', '≡4']);
      assert.match(r.variety, /Bars 1–4 share one cadence/);
    },
  },

  {
    name: 'cadence: tap one in over the beat, write into it as a guide, hear a bar',
    audio: true,
    async run() {
      const { sleep, bars, steps, menu, type } = E2E;
      if (!(await E2E.audioRuns())) return { skipped: 'audio clock does not run here' };
      document.querySelector('.row').click(); await sleep(600);
      const out = {};
      // a fresh bar at the end, tapped on the four beats
      document.querySelector('[data-a="add-bar"]').click(); await sleep(200);
      document.querySelector('#cin').blur();
      const at = bars().length - 1, B = () => bars()[at];
      B().querySelector('[data-a="bar-menu"]').click(); await sleep(300);
      menu(/Rhythm/).click(); await sleep(300);
      document.querySelector('.sheet [data-a="ftap"]').click(); await sleep(400);
      document.querySelector('#tgo').click();
      // wait for bar 1 to be scheduled, then tap on its beats (as heard: plus the speaker delay)
      let bar0 = null;
      for (let i = 0; i < 100 && !bar0; i++) { await sleep(30); bar0 = FP.audio.timeline().log.find((e) => e.bar === 0 && e.step === 0); }
      const beat = 60 / 90, tap = document.querySelector('#ttap');
      for (let i = 0; i < 4; i++) {
        const due = bar0.t + i * beat + FP.audio.latency() + 0.01;
        while (FP.audio.now() < due) await sleep(3);
        tap.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
      }
      for (let i = 0; i < 80 && document.querySelector('#tuse').hidden; i++) await sleep(50);
      out.result = document.querySelector('#tres').textContent;
      out.dots = [...document.querySelectorAll('#tdots i')].map((d, k) => (d.classList.contains('on') ? k : -1)).filter((k) => k >= 0);
      document.querySelector('.sheet [data-a="tguide"]').click(); await sleep(400);
      out.slots = [...B().querySelectorAll('.cell.slot')].map((c) => +c.dataset.k);
      // typing fills the slots in order
      await type('one '); await type('two '); await type('three '); await type('four ');
      out.written = steps(B());
      out.movedOn = document.querySelector('.cell.act')?.dataset.r === String(+B().querySelector('.cell').dataset.r + 1);
      // hear the bar: its own playback, the playhead on it
      B().querySelector('[data-a="bar-menu"]').click(); await sleep(300);
      menu(/Hear this bar/).click();
      // the bar pulses on the beats (it may be redrawn in between, so watch for a while)
      out.pulse = false;
      for (let i = 0; i < 12; i++) { await sleep(100); out.pulse = out.pulse || B().classList.contains('pa') || B().classList.contains('pb'); }
      out.playing = FP.audio.state();
      out.playheadOnBar = !!B().querySelector('.cell.now');
      return out;
    },
    check(r, assert) {
      assert.deepEqual(r.dots, [0, 4, 8, 12], r.result);
      assert.deepEqual(r.slots, [0, 4, 8, 12]);
      assert.equal(r.written, 'one · · · two · · · three · · · four · · ·');
      assert.ok(r.movedOn, 'a filled guide moves on to the next bar');
      assert.deepEqual(r.playing, { playing: true, kind: 'bar' });
      assert.ok(r.playheadOnBar);
      assert.ok(r.pulse);
    },
  },

  {
    name: 'feel: a coach mark, the header chip explains itself, the typing bar, an empty song, themes and step size',
    async run() {
      const { sleep, bars, menu, type } = E2E;
      const out = {};
      document.querySelector('.row').click(); await sleep(1400);
      out.coach = document.querySelector('.coach')?.textContent;
      // pocket check on: bars with stresses off the pocket get one chip, and it explains itself
      document.querySelector('[data-a="pocket"]').click(); await sleep(300);
      const bx = document.querySelector('.bh .bx');
      out.chip = bx && { text: bx.textContent, warn: bx.classList.contains('warn') };
      bx.click(); await sleep(300);
      out.info = [...document.querySelectorAll('.sheet .bi-t')].map((x) => x.textContent);
      out.infoBtn = document.querySelector('.sheet .bi .btn')?.textContent;
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      // the typing bar: the line you're writing, the step you're on marked
      bars()[0].querySelectorAll('.cell')[2].click(); await sleep(200);
      out.docked = document.querySelector('#cin').classList.contains('docked') && !document.querySelector('#typebar').hidden;
      out.on = document.querySelector('#tbl .tp.on')?.textContent;
      await type('neon '); await sleep(100);
      out.line = document.querySelector('#tbl .tps').textContent;
      // a new song says how to start, until there's a word in it
      location.hash = '#/'; await sleep(400);
      document.querySelector('.fab').click(); await sleep(300);
      menu(/New song/).click(); await sleep(700);
      out.emptyCard = !document.querySelector('#wsempty').hidden;
      await type('hello '); await sleep(100);
      out.emptyGone = document.querySelector('#wsempty').hidden;
      // accent, high contrast and step size from Settings
      location.hash = '#/'; await sleep(400);
      document.querySelector('[data-a="settings"]').click(); await sleep(300);
      document.querySelector('#acc [data-c="teal"]').click();
      document.querySelector('#hc').click();
      [...document.querySelectorAll('#zm button')].find((b) => b.textContent === 'L').click();
      const d = document.documentElement;
      out.theme = { accent: d.dataset.accent, contrast: d.dataset.contrast, color: getComputedStyle(d).getPropertyValue('--accent').trim() };
      document.querySelector('.sheet [data-close]').click(); await sleep(300);
      document.querySelector('.row').click(); await sleep(600);
      out.cellH = Math.round(document.querySelector('#lines .cell').getBoundingClientRect().height);
      return out;
    },
    check(r, assert) {
      assert.match(r.coach || '', /Tap a step/);
      assert.ok(r.chip && /^\d+\/\d+$/.test(r.chip.text) && r.chip.warn, JSON.stringify(r.chip));
      assert.equal(r.info.length, 1);
      assert.match(r.info[0], /of \d+ in the pocket/);
      assert.equal(r.infoBtn, 'Hear this bar');
      assert.ok(r.docked);
      assert.ok(r.on);
      assert.match(r.line, /NEON|neon/);
      assert.ok(r.emptyCard);
      assert.ok(r.emptyGone);
      assert.deepEqual(r.theme, { accent: 'teal', contrast: 'high', color: '#2fd4c0' });
      assert.equal(r.cellH, Math.round(38 * 1.3));
    },
  },

  {
    name: 'speed: typing in a 70-bar song; the step box stays on its step while scrolling',
    async run() {
      const { sleep } = E2E;
      S.settings.typeBar = false; // the step box floating on its step (phones type in the typing bar)
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
      // bars above only take their real height once drawn: scroll up through them and back —
      // the step box must still sit on its step
      const bar = () => { const all = E2E.bars(); return all[all.length - 3]; }; // looked up fresh: typing redraws the bar
      const box = () => inp().getBoundingClientRect(), step = () => bar().querySelectorAll('.cell')[3].getBoundingClientRect();
      for (let y = 0; y < 3; y++) { window.scrollTo(0, (document.body.scrollHeight * y) / 3); await sleep(120); }
      window.scrollTo(0, 0); await sleep(200);
      bar().scrollIntoView({ block: 'center' }); await sleep(300);
      const drift = Math.round(Math.abs(box().top - step().top) + Math.abs(box().left - step().left));
      return { bars: b.length, keystrokeMs: Math.round(t.reduce((a, x) => a + x, 0) / t.length), drift };
    },
    check(r, assert) {
      assert.ok(r.bars >= 70);
      // generous for slow CI machines; a full repaint used to take 70–90 ms on a fast desktop
      assert.ok(r.keystrokeMs < 60, `a keystroke took ${r.keystrokeMs} ms`);
      assert.ok(r.drift <= 2, `the step box drifted ${r.drift}px off its step`);
    },
  },
];
