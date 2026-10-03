/* LosSoulx FlowPad — the editor's audio side: the Beat panel (drum patterns, an imported beat and
 * its structure), the recorder and takes (words into steps, playback in time with the beat), and
 * the transport that plays it all. Editor() hands it the open song as `ed`.
 */
'use strict';

function editorAudio(ed) {
  const { f, rows, panel, stripEl, closeBtn, inp, commit, paintAll, blkEl, updateStrip, beatChanged } = ed;

  // ----- Beat panel: the song beat's step sequencer -----
  const songPat = () => pattern(f.beat.def) || patternsSorted()[0];
  function PBeat() {
    const pat = songPat();
    const tk = trackReady();
    const trackHTML = f.track
      ? `<div class="trackbox">${icon('rhyme')}<div class="grow"><b>${esc(tk ? tk.rec.name : 'Loading your beat…')}</b><span class="tsub">${tk ? `${tk.rec.bpm} BPM · ${tk.rec.bars}-bar loop${f.bpm !== tk.rec.bpm ? ` · playing at ${f.bpm}` : ''}` : ''}</span></div><label class="mini"><span>Drums</span><input type="checkbox" class="switch" id="tdrums" ${f.track.drums ? 'checked' : ''} aria-label="Play the drum patterns over the beat"></label><button class="icon-btn muted" data-a="tmenu" aria-label="Beat options">${icon('more')}</button></div>`
      : `<button class="btn block" data-a="timport">${icon('upload', 'sm')}Import your beat (MP3, WAV…)</button>`;
    const secs = tk && tk.rec.sections;
    const structHTML = !tk || tk.rec.bars < 8 ? ''
      : secs && secs.length
        ? `<div class="struct" id="struct" role="group" aria-label="Beat structure">${secs.map((s, i) => `<button class="sseg" data-a="sjump" data-i="${i}" data-kind="${secKind(s.name)}" style="flex:${s.bars}" title="${esc(s.name)} · ${plural(s.bars, 'bar')}"><b>${esc(s.name)}</b><span>${s.bars}</span></button>`).join('')}</div>
          <div class="struct-act"><button class="chip sm" data-a="sedit">${icon('edit', 'sm')}Edit structure</button><button class="chip sm" data-a="slayout">${icon('project', 'sm')}Lay out song to match</button></div>`
        : `<div class="struct-act"><button class="chip sm" data-a="sfind">${icon('sparkle', 'sm')}Find the beat’s structure</button></div>`;
    panel.innerHTML = `<div class="ph"><div class="chips scroll grow">${patternsSorted().map((p) => `<button class="chip sm ${p.id === pat.id ? 'on' : ''}" data-a="bpick" data-id="${p.id}">${esc(p.name)}</button>`).join('')}<button class="chip sm ghost" data-a="bnew">${icon('plus', 'sm')}New</button></div><button class="icon-btn muted" data-a="bmore" aria-label="Pattern options">${icon('more')}</button>${closeBtn}</div>
      ${trackHTML}${structHTML}<input type="file" id="tfile" accept="audio/*" hidden>
      <div class="seq" id="seq">${[0, 1].map((h) => `<div class="half">${TRACKS.map((t) => `<div class="trk"><span class="tl">${t.name}</span>${range(8).map((j) => { const k = h * 8 + j; const on = !!pat.steps[t.id][k]; return `<button class="st ${on ? 'on' : ''} ${k % 4 === 0 ? 'b' : ''}" data-a="step" data-t="${t.id}" data-k="${k}" aria-label="${t.name} step ${k + 1}" aria-pressed="${on}"></button>`; }).join('')}</div>`).join('')}</div>`).join('')}</div>
      <div class="beat-ctl">${bpmCtl(f.bpm)}
        <label class="mini"><span>Swing</span><input type="range" class="range" id="swing" min="0" max="40" value="${Math.round(f.swing * 100)}"></label>
        <label class="mini"><span>Click</span><input type="checkbox" class="switch" id="bclick" ${T.click ? 'checked' : ''}></label>
      </div>
      <p class="hint">The highlighted pattern is the song beat${pat.bpm ? ` (sits around ${pat.bpm} BPM)` : ''}. Tap a bar's beat label on the sheet to give it its own pattern.</p>`;
    $('#swing').addEventListener('input', (e) => { f.swing = e.target.value / 100; if (T.drums) audio.update({ swing: f.swing }); saveSoon('files', f); });
    $('#bclick').addEventListener('change', (e) => { T.click = e.target.checked; syncTransport(); });
    $('#tfile').addEventListener('change', (e) => { const fl = e.target.files[0]; e.target.value = ''; if (fl) importBeat(fl); });
    const td = $('#tdrums');
    if (td) td.addEventListener('change', () => { f.track.drums = td.checked; saveSoon('files', f); paintAll(); if (T.drums) syncTransport(true); });
  }

  VA.timport = () => $('#tfile').click();
  async function importBeat(fl) {
    toast('Loading your beat…');
    let buf;
    try { buf = await audio.decode(fl); } catch (e) { toast('Couldn’t read that audio file'); return; }
    const named = fl.name.match(/(\d{2,3})\s*bpm/i); // most beat files say their tempo
    const guess = named ? +named[1] : audio.guessBpm(buf);
    const b = { id: FP.uid(), name: fl.name.replace(/\.[^.]+$/, '') || 'My beat', blob: fl, mime: fl.type, bpm: clamp(Math.round(guess || f.bpm), 50, 220), offset: 0, bars: 4, duration: buf.duration, created: Date.now() };
    if (!(await beatSettings(b, true, buf))) return;
    if (b.bars >= 8) b.sections = findSections(b, buf);
    await db.put('beats', b);
    tracks.set(b.id, { rec: b, buf });
    if (f.track && f.track.id !== b.id) await dropBeat(f.track.id);
    f.track = { id: b.id, drums: false };
    setBpm(b.bpm);
    saveSoon('files', f);
    if (T.drums) syncTransport(true);
    paintAll();
    if (S.panel === 'beat') PBeat();
    if (b.sections && b.sections.length > 1) offerLayout(b.sections);
    else toast('Beat added — hit Play');
  }

  // ----- the imported beat's structure: Intro · Verse · Hook · Outro -----
  const secKind = (name) => (/^(intro|outro)/i.test(name) ? 'edge' : /^(hook|chorus)/i.test(name) ? 'hook' : /^bridge/i.test(name) ? 'bridge' : 'verse');
  const secSummary = (secs) => secs.map((s) => `${s.name} ${s.bars}`).join(' · ');
  function findSections(b, buf) {
    try { return FP.structure.detect(audio.barFeatures(buf, b.bpm, b.offset, b.bars)); } catch (e) { return null; }
  }
  /** Put a label at each of the beat's sections; bar k of the sheet then plays over bar k of the beat. */
  function layOut(secs) {
    snapshot(f, 'Before laying out to the beat');
    rows.splice(0, rows.length, ...FP.structure.layout(rows, secs));
    ed.cur = null;
    commit();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Song laid out to the beat — Undo puts it back');
  }
  function offerLayout(secs) {
    const sh = sheet({
      title: 'Beat structure found',
      html: `<p class="msg">${esc(secSummary(secs))}</p><p class="msg">Lay out your song to match? Each section gets a label at the bar where the beat changes, and empty bars are added to cover the whole beat. Your lyrics stay in order.</p>
        <div class="sheet-actions"><button class="btn" data-close>Not now</button><button class="btn primary" data-a="go">Lay out song</button></div>`,
      actions: { go: () => { sh.close(); layOut(secs); } },
    });
  }
  VA.sfind = () => {
    const tk = trackReady();
    if (!tk) return;
    tk.rec.sections = findSections(tk.rec, tk.buf);
    db.put('beats', tk.rec);
    PBeat();
    if (tk.rec.sections && tk.rec.sections.length > 1) offerLayout(tk.rec.sections);
    else toast('No clear changes found — the beat sounds the same throughout');
  };
  VA.slayout = () => {
    const tk = trackReady();
    if (tk && tk.rec.sections) offerLayout(tk.rec.sections);
  };
  /** Scroll the sheet to the first bar of section i. */
  VA.sjump = (el) => {
    const tk = trackReady();
    if (!tk) return;
    const start = tk.rec.sections.slice(0, +el.dataset.i).reduce((a, s) => a + s.bars, 0);
    const ri = barLines(f)[start];
    const b = ri != null && blkEl(ri);
    if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else toast('Lay out the song to match first');
  };
  VA.sedit = () => {
    const tk = trackReady();
    if (!tk) return;
    let secs = (tk.rec.sections || []).map((s) => ({ ...s }));
    const sh = sheet({ title: 'Beat structure', html: '<div id="sedl"></div>' });
    const box0 = $('#sedl', sh.el);
    const total = () => secs.reduce((a, s) => a + (+s.bars || 0), 0);
    const draw = () => {
      box0.innerHTML = `${secs.map((s, i) => `<div class="sed-row" data-i="${i}"><input class="field" data-f="name" value="${esc(s.name)}" aria-label="Section name"><input class="field num" data-f="bars" type="number" inputmode="numeric" min="1" max="256" value="${s.bars}" aria-label="Bars"><button type="button" class="icon-btn muted" data-x="${i}" aria-label="Remove section">${icon('x')}</button></div>`).join('')}
        <button type="button" class="btn block" id="sadd">${icon('plus', 'sm')}Add section</button>
        <p class="src" id="stot"></p>
        <div class="sheet-actions"><button type="button" class="btn" id="sredo">${icon('sparkle', 'sm')}Detect again</button><button type="button" class="btn primary" id="ssave">Save</button></div>
        <button type="button" class="btn block" id="ssavelay">Save and lay out song</button>`;
      tot();
    };
    const tot = () => {
      const t = total(), n = tk.rec.bars;
      $('#stot', sh.el).textContent = t === n ? `${plural(t, 'bar')} — the whole beat` : `${t} of the beat’s ${n} bars${t < n ? ' — the rest plays unlabelled' : ' — more than the beat; it loops'}`;
    };
    box0.addEventListener('input', (e) => {
      const r = e.target.closest('.sed-row');
      if (!r) return;
      const s = secs[+r.dataset.i];
      if (e.target.dataset.f === 'name') s.name = e.target.value;
      else s.bars = Math.max(1, Math.round(+e.target.value || 1));
      tot();
    });
    box0.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (x) { secs.splice(+x.dataset.x, 1); draw(); return; }
      if (e.target.closest('#sadd')) { secs.push({ name: secs.some((s) => /^hook/i.test(s.name)) ? 'Verse' : 'Hook', bars: 8 }); draw(); return; }
      if (e.target.closest('#sredo')) { secs = findSections(tk.rec, tk.buf) || secs; draw(); return; }
      const save = e.target.closest('#ssave, #ssavelay');
      if (!save) return;
      secs = secs.filter((s) => s.bars > 0).map((s) => ({ name: s.name.trim() || 'Section', bars: s.bars }));
      tk.rec.sections = secs;
      db.put('beats', tk.rec);
      sh.close();
      PBeat();
      if (save.id === 'ssavelay' && secs.length) layOut(secs);
    });
    draw();
  };
  /** Delete a beat file if no other song uses it. */
  async function dropBeat(id) {
    if (!S.files.some((x) => x !== f && x.track && x.track.id === id)) { await db.del('beats', id); tracks.delete(id); }
  }

  /**
   * Tempo, where bar 1 starts, and loop length — resolves true when saved. With the decoded
   * beat, "Line it up" plays it from bar 1 with a click on every beat to nudge the start by ear.
   */
  function beatSettings(b, isNew, buf) {
    return new Promise((resolve) => {
      let taps = [], barsTouched = !isNew;
      const autoBars = () => Math.max(1, Math.round(((b.duration - b.offset) * b.bpm) / 240));
      if (isNew) b.bars = autoBars();
      const sh = sheet({
        title: isNew ? 'Your beat' : b.name,
        html: `<form class="beatform">
          <label class="set-row"><div><div class="lbl">Tempo</div><div class="sub">${isNew ? 'Guessed — check it, or tap along' : 'The beat’s own BPM'}</div></div><span class="mrow"><input class="field num" name="bpm" type="number" inputmode="decimal" min="50" max="220" step="1" value="${b.bpm}"><button type="button" class="btn" data-a="btap">Tap</button></span></label>
          <label class="set-row"><div><div class="lbl">Bar 1 starts at</div><div class="sub">Seconds into the file — skip an intro or silence</div></div><input class="field num" name="offset" type="number" inputmode="decimal" min="0" step="0.01" value="${b.offset}"></label>
          ${buf ? `<div class="set-row lineup"><div><div class="lbl">Line it up</div><div class="sub">Plays bar 1 on with a click on each beat — nudge until the click sits on the kick</div></div>
            <span class="nudge"><button type="button" class="btn" data-a="bprev" aria-label="Play from bar 1 with clicks">${icon('play', 'sm')}</button><button type="button" class="btn" data-a="bn" data-d="-0.05">−50</button><button type="button" class="btn" data-a="bn" data-d="-0.01">−10</button><button type="button" class="btn" data-a="bn" data-d="0.01">+10</button><button type="button" class="btn" data-a="bn" data-d="0.05">+50</button></span></div>` : ''}
          <label class="set-row"><div><div class="lbl">Loop length</div><div class="sub">Bars before it starts over (whole file = ${autoBars()})</div></div><input class="field num" name="bars" type="number" inputmode="numeric" min="1" max="256" step="1" value="${b.bars}"></label>
          <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${isNew ? 'Use this beat' : 'Save'}</button></div></form>`,
        actions: {
          // play from bar 1 with clicks on top; nudging while it plays restarts it from the new spot
          bprev: () => { sync0(); if (stopPrev) { stopPrev(); stopPrev = null; return; } preview(); },
          bn: (el) => {
            const v = Math.max(0, Math.min(b.duration - 0.5, Math.round(((+form.elements.offset.value || 0) + +el.dataset.d) * 1000) / 1000));
            form.elements.offset.value = v;
            sync0();
            if (stopPrev) preview();
          },
          btap: () => {
            const now = performance.now();
            if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
            taps.push(now);
            taps = taps.slice(-8);
            if (taps.length >= 3) { form.elements.bpm.value = Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))); sync0(); }
          },
        },
      });
      const form = sh.el.querySelector('form');
      let done = false, stopPrev = null, prevT = 0;
      const preview = () => {
        if (stopPrev) stopPrev();
        clearTimeout(prevT);
        stopPrev = audio.previewBeat({ buffer: buf, offset: b.offset, bpm: b.bpm, bars: 2 });
        prevT = setTimeout(() => { stopPrev = null; }, ((2 * 240) / b.bpm) * 1000 + 200);
      };
      const sync0 = () => {
        b.bpm = clamp(+form.elements.bpm.value || b.bpm, 50, 220);
        b.offset = Math.max(0, Math.min(b.duration - 0.5, +form.elements.offset.value || 0));
        if (!barsTouched) form.elements.bars.value = autoBars();
      };
      form.elements.bpm.addEventListener('input', sync0);
      form.elements.offset.addEventListener('input', sync0);
      form.elements.bars.addEventListener('input', () => { barsTouched = true; });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        sync0();
        b.bars = clamp(Math.round(+form.elements.bars.value || autoBars()), 1, 256);
        done = true;
        sh.close();
        resolve(true);
      });
      sh.onclose = () => { if (stopPrev) stopPrev(); clearTimeout(prevT); if (!done) resolve(false); };
    });
  }
  VA.tmenu = () => {
    const tk = trackReady();
    if (!tk) return;
    sheet({
      title: tk.rec.name,
      items: [
        { label: 'Tempo, start and loop', icon: 'metro', onClick: async () => {
          const b = { ...tk.rec };
          if (!(await beatSettings(b, false, tk.buf))) return;
          const moved = b.bpm !== tk.rec.bpm || b.offset !== tk.rec.offset || b.bars !== tk.rec.bars;
          Object.assign(tk.rec, b);
          if (moved && tk.rec.sections) tk.rec.sections = tk.rec.bars >= 8 ? findSections(tk.rec, tk.buf) : null; // bar lines moved: find the sections again
          await db.put('beats', tk.rec);
          setBpm(b.bpm);
          if (T.drums) syncTransport(true);
          PBeat();
        } },
        { label: 'Structure', icon: 'project', hint: 'Intro, verses, hooks…', onClick: () => (tk.rec.bars >= 8 ? (tk.rec.sections ? VA.sedit() : VA.sfind()) : toast('Structure needs a beat of 8 bars or more')) },
        { label: 'Replace with another file', icon: 'upload', onClick: () => $('#tfile').click() },
        { label: 'Remove beat', icon: 'trash', danger: true, hint: 'Back to the drum patterns', onClick: async () => { const id = f.track.id; delete f.track; saveSoon('files', f); await dropBeat(id); if (T.drums) syncTransport(true); paintAll(); PBeat(); } },
      ],
    });
  };
  VA.step = (el) => {
    const pat = songPat();
    const t = el.dataset.t, k = +el.dataset.k;
    const on = pat.steps[t][k] ? 0 : 1;
    pat.steps[t][k] = on;
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-pressed', String(!!on));
    saveSoon('patterns', pat);
    if (on && !T.drums) audio.hit(t);
    paintAll();
  };
  VA.bpick = (el) => { f.beat.def = el.dataset.id; saveSoon('files', f); beatChanged(); };
  VA.bnew = async () => {
    const name = await ask({ title: 'New pattern', placeholder: 'Pattern name', ok: 'Create' });
    if (!name) return;
    const p = { id: FP.uid(), name, order: 50, created: Date.now(), steps: Object.fromEntries(TRACKS.map((t) => [t.id, new Array(16).fill(0)])) };
    S.patterns.push(p);
    await saveNow('patterns', p);
    f.beat.def = p.id;
    saveSoon('files', f);
    beatChanged();
  };
  VA.bmore = () => {
    const pat = songPat();
    sheet({
      title: pat.name,
      items: [
        { label: 'Rename', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename pattern', value: pat.name }); if (v) { pat.name = v; await saveNow('patterns', pat); beatChanged(); } } },
        { label: 'Duplicate', icon: 'copy', onClick: async () => { const p = JSON.parse(JSON.stringify({ ...pat, id: FP.uid(), name: `${pat.name} copy`, order: 50, created: Date.now() })); S.patterns.push(p); await saveNow('patterns', p); f.beat.def = p.id; saveSoon('files', f); beatChanged(); } },
        { label: 'Clear all steps', icon: 'x', onClick: () => { TRACKS.forEach((t) => pat.steps[t.id].fill(0)); saveSoon('patterns', pat); beatChanged(); } },
        {
          label: 'Delete pattern', icon: 'trash', danger: true,
          onClick: async () => {
            if (S.patterns.length <= 1) { toast('Keep at least one pattern'); return; }
            if (!(await confirmBox({ title: 'Delete pattern?', message: `“${pat.name}” will be removed from every song that uses it.`, ok: 'Delete', danger: true }))) return;
            S.patterns = S.patterns.filter((p) => p !== pat);
            await db.del('patterns', pat.id);
            const fallback = patternsSorted()[0].id;
            for (const x of S.files) {
              let changed = false;
              if (x.beat.def === pat.id) { x.beat.def = fallback; changed = true; }
              for (const k of Object.keys(x.beat.bars)) if (x.beat.bars[k] === pat.id) { delete x.beat.bars[k]; changed = true; }
              if (changed) saveSoon('files', x);
            }
            beatChanged();
          },
        },
      ],
    });
  };

  // ----- Takes panel + recorder -----
  let recOn = false, autoDrums = false, takes = [], playingId = null, hearing = false, counting = false;
  const wantWords = () => S.settings.recWords !== false && voice.supported();

  /** Takes first; how recording behaves lives behind the options button. */
  function PTakes() {
    panel.innerHTML = `<div class="ph"><span class="ph-t">Takes</span><span class="count" id="tc"></span><span class="grow"></span><button class="icon-btn muted" data-a="ropts" aria-label="Recording options">${icon('gear')}</button>${closeBtn}</div>
      <ul class="list" id="takes"></ul>
      ${rec.supported() ? '' : '<p class="hint">Recording needs microphone access, which browsers only allow over HTTPS or on localhost.</p>'}`;
    loadTakes();
  }
  /** Recording options: the beat, the count-in, words into steps, and the headphone delay. */
  VA.ropts = () => {
    const sh = sheet({
      title: 'Recording options',
      html: `<label class="set-row"><div><div class="lbl">Start the beat when I record</div><div class="sub">It follows the patterns or beat on your bars</div></div><input type="checkbox" class="switch" id="rbeat" ${S.settings.recBeat ? 'checked' : ''}></label>
        <label class="set-row"><div><div class="lbl">Count in</div><div class="sub">One bar of clicks before the beat starts</div></div><input type="checkbox" class="switch" id="rcount" ${S.settings.countIn !== false ? 'checked' : ''}></label>
        ${voice.supported() ? `<label class="set-row"><div><div class="lbl">Write my words into the steps</div><div class="sub">Your words land on the steps you rap them on. Uses the browser’s speech recognition, which may send audio to Google, Microsoft or Apple. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></div></div><input type="checkbox" class="switch" id="rwords" ${wantWords() ? 'checked' : ''}></label>`
          : '<p class="src">This browser can’t turn speech into words — Chrome, Edge or Safari can.</p>'}
        <button class="menu-i" data-a="rcal">${icon('metro')}<span>Headphone delay</span><small>${S.settings.latencyMs != null ? `${S.settings.latencyMs} ms · measured` : 'Measure it'}</small></button>
        <p class="src">Headphones keep the beat out of your vocal, and out of the word timing.</p>`,
      actions: { rcal: () => { sh.close(); calibrate(); } },
    });
    $('#rbeat', sh.el).addEventListener('change', (e) => { S.settings.recBeat = e.target.checked; saveSettings(); });
    $('#rcount', sh.el).addEventListener('change', (e) => { S.settings.countIn = e.target.checked; saveSettings(); });
    const rw = $('#rwords', sh.el);
    if (rw) rw.addEventListener('change', () => { S.settings.recWords = rw.checked; saveSettings(); });
  };
  async function loadTakes() {
    takes = (await db.byIndex('recordings', 'fileId', f.id)).sort((a, b) => b.created - a.created);
    const ul = $('#takes');
    if (!ul) return;
    $('#tc').textContent = takes.length || '';
    ul.innerHTML = takes.length
      ? takes.map((t) => `<li class="take" data-id="${t.id}"><button class="play" data-a="tplay" data-id="${t.id}" aria-label="Play ${esc(t.name)}">${icon(playingId === t.id ? 'pause' : 'play')}</button><div class="row-main"><div class="row-t">${esc(t.name)}</div><div class="take-bar"><div></div></div><div class="row-s">${fmtDur(t.duration)} · ${ago(t.created)}</div></div><button class="icon-btn muted" data-a="tmore" data-id="${t.id}" aria-label="Options for ${esc(t.name)}">${icon('more')}</button></li>`).join('')
      : `<li class="takes-empty">${icon('mic')}<div><b>No takes yet</b><span>Press <b>Rec</b> below — the beat starts with you, and your words can land on the steps.</span></div></li>`;
  }

  function setRecUI(on) {
    const b = $('#drec');
    if (!b) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
    $('#rlabel').textContent = on ? '0:00' : 'Rec';
    b.querySelector('i').style.transform = '';
  }
  async function finishRec() {
    if (!recOn) return;
    recOn = false;
    const heard = hearing ? voice.stop() : null;
    hearing = false;
    const clock = { ...audio.timeline(), drums: T.drums, lat: audio.latency() };
    counting = false;
    if (autoDrums) { autoDrums = false; T.drums = false; syncTransport(true); }
    const r = await rec.stop();
    setRecUI(false);
    if (!ed.gone) updateStrip(true); // drop the "Hearing" line
    if (!r || r.duration <= 0.5) return;
    // the take keeps when each step fell and what was heard, in seconds from its start —
    // enough to play it back in time with the beat, or write its words again later
    const timing = {
      log: clock.log.filter((e) => e.t >= r.t0 - 1 && e.t <= r.t0 + r.duration + 1).map((e) => ({ ...e, t: +(e.t - r.t0).toFixed(4) })),
      bpm: clock.bpm, drums: clock.drums, lat: clock.lat,
    };
    const all = await db.byIndex('recordings', 'fileId', f.id);
    const take = { id: FP.uid(), fileId: f.id, name: `Take ${all.length + 1}`, blob: r.blob, mime: r.mime, duration: r.duration, created: Date.now(), timing };
    if (heard) {
      const h = await heard;
      take.heard = h.phrases.map((p) => ({ text: p.text, tFirst: p.tFirst - r.t0, tLast: p.tLast - r.t0 }));
      take.heardError = h.error;
    }
    await db.put('recordings', take);
    if (S.panel === 'takes') loadTakes();
    if (!heard) { toast(S.panel === 'takes' ? 'Take saved' : 'Take saved — find it in Takes'); return; }
    toast('Writing your words into the steps…');
    await writeTake(take, 'Take saved · ');
    if (!ed.gone) updateStrip(true);
  }

  /** Write a take's words into the steps, and remember which bars they went to. */
  async function writeTake(take, prefix = '') {
    const bars = await wordsToSteps({ phrases: take.heard || [], error: take.heardError }, take.blob, take.timing, prefix);
    if (bars) { take.bars = bars; await db.put('recordings', take); }
  }

  /** While recording, the strip shows what speech recognition is hearing. */
  function showHeard(text) {
    if (!recOn) return;
    const t = text.length > 80 ? `…${text.slice(-80)}` : text;
    stripEl.innerHTML = `<span class="strip-mode">${icon('mic')}Hearing</span><span class="hint-t">${esc(t || 'Listening…')}</span>`;
    stripEl.scrollLeft = stripEl.scrollWidth;
  }

  /** Where the beat was at time t of a take (seconds from its start), in bars (bar 2, halfway = 2.5). */
  function barPos(clock, t) {
    const L = clock.log, bpm = clock.bpm || f.bpm;
    if (!L.length || L[L.length - 1].t < 0) return Math.max(0, t * bpm / 240); // no beat: bars from the take's start
    const at = (e) => e.bar + e.step / e.n;
    if (t <= L[0].t) return at(L[0]) - (L[0].t - t) * bpm / 240;
    let lo = 0, hi = L.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m].t <= t) lo = m; else hi = m - 1; }
    const a = L[lo], b = L[lo + 1];
    if (!b) return at(a) + (t - a.t) * bpm / 240;
    return at(a) + (at(b) - at(a)) * (t - a.t) / (b.t - a.t);
  }

  /**
   * Put the words heard during a take onto the steps they were said on. Bars that played
   * empty are filled; anything else goes into new bars at the end — nothing written is overwritten.
   * Times are seconds from the take's start. Returns { recorded bar: bar number on the sheet }.
   */
  async function wordsToSteps(heard, blob, clock, prefix = '') {
    if (ed.gone) return null;
    const list = heard.phrases
      .map((p) => { const pcs = sylPieces(p.text.trim()); return { pcs, n: pcs.length, tFirst: p.tFirst, tLast: p.tLast }; })
      .filter((p) => p.n);
    if (!list.length) {
      const why = { 'not-allowed': 'Speech recognition is blocked', 'service-not-allowed': 'Speech recognition is blocked', network: 'Speech recognition needs an internet connection', 'audio-capture': 'Speech recognition couldn’t use the mic' }[heard.error];
      toast(`${why || 'No words heard'}${prefix ? ' — take saved' : ''}`);
      return null;
    }
    let an = { onsets: [], segments: [] };
    if (blob) { try { an = await voice.analyze(blob); } catch (e) { /* timing falls back to when the words were heard */ } }
    if (ed.gone) return null;
    const times = voice.align(list, an);

    // each syllable → an absolute 16th step (bar * 16 + step), never earlier than the one before
    const lag = clock.lat + 0.02;
    const start = Math.max(0, Math.floor(barPos(clock, 0) * 16));
    const placed = [];
    let lastQ = -1;
    list.forEach((p, i) => p.pcs.forEach((pc, j) => {
      let q = Math.max(start, Math.round(barPos(clock, times[i][j] - lag) * 16));
      if (q < lastQ) q = lastQ;
      lastQ = q;
      placed.push({ q, pc });
    }));

    snapshot(f, 'Before words from a take');
    // recorded bars → sheet rows
    const seq = barLines(f);
    const isEmpty = (ri) => rows[ri].cells.every((c) => !c.trim());
    const trailing = [];
    if (!clock.drums) for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].type !== 'bar') continue; if (isEmpty(i)) trailing.unshift(i); else break; }
    const firstB = Math.floor(placed[0].q / 16), lastB = Math.floor(placed[placed.length - 1].q / 16);
    const rowOf = new Map();
    for (let b = firstB; b <= lastB; b++) {
      let ri;
      if (clock.drums && b < seq.length && isEmpty(seq[b])) ri = seq[b];
      else if (trailing.length) ri = trailing.shift();
      else { rows.push(newBarRow()); ri = rows.length - 1; }
      rowOf.set(b, ri);
    }
    const steps = new Map();
    placed.forEach(({ q, pc }) => {
      const key = `${rowOf.get(Math.floor(q / 16))}:${q % 16}`;
      if (!steps.has(key)) steps.set(key, []);
      steps.get(key).push(pc);
    });
    steps.forEach((L, key) => { const [ri, k] = key.split(':').map(Number); rows[ri].cells[k] = stepText(L); });
    commit();
    const nw = list.reduce((a, p) => a + p.pcs.filter((x) => x.end).length, 0), nb = lastB - firstB + 1;
    toast(`${prefix}${plural(nw, 'word')} written into ${plural(nb, 'bar')}`);
    const first = blkEl(rowOf.get(firstB));
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const ords = barLines(f), out = {};
    rowOf.forEach((ri, b) => { out[b] = ords.indexOf(ri); });
    return out;
  }
  VA.drec = async () => {
    if (recOn) return finishRec();
    if (!rec.supported()) { toast('Recording needs HTTPS or localhost'); return; }
    stopPlayer();
    try {
      await rec.start((lvl, t) => {
        const b = $('#drec');
        if (!b) return;
        if (!counting) $('#rlabel').textContent = fmtDur(t);
        b.querySelector('i').style.transform = `scale(${1 + Math.min(0.7, lvl * 5)})`;
      });
    } catch (e) {
      toast('Microphone blocked — allow access to record');
      return;
    }
    recOn = true;
    setRecUI(true);
    if (S.settings.recBeat && !T.drums) {
      // one bar of clicks first, so you come in on bar 1 instead of chasing it
      counting = S.settings.countIn !== false;
      T.drums = true; autoDrums = true;
      syncTransport(true, counting ? 1 : 0);
    }
    if (wantWords()) {
      hearing = voice.start(audio.now, showHeard);
      if (hearing) showHeard('');
    }
  };

  // ----- take playback: the beat you heard plays along, and the grid follows the words -----
  const bufs = new Map(); // take id → decoded audio
  let stopTake = null, takeRaf = 0;
  function stopPlayer() {
    if (stopTake) { stopTake(); stopTake = null; }
    cancelAnimationFrame(takeRaf);
    if (audio.state().kind === 'take') audio.stop();
    if (playingId) {
      const b = $(`[data-a="tplay"][data-id="${playingId}"]`);
      if (b) b.innerHTML = icon('play');
      const bar = $(`.take[data-id="${playingId}"] .take-bar div`);
      if (bar) bar.style.width = '0';
      clearNow();
    }
    playingId = null;
  }
  async function playTake(t, el) {
    stopPlayer();
    if (T.drums || T.click) { T.drums = T.click = false; syncTransport(); }
    let buf = bufs.get(t.id);
    if (!buf) {
      try { buf = await audio.decode(t.blob); bufs.set(t.id, buf); } catch (e) { toast('This take can’t play in this browser'); return; }
    }
    const T0 = audio.now() + 0.15;
    playingId = t.id;
    el.innerHTML = icon('pause');
    stopTake = audio.playBuffer(buf, T0, () => { if (playingId === t.id) stopPlayer(); });
    const tm = t.timing;
    // restart the beat from the first bar line inside the take, on the same clock
    const first = tm && tm.drums && tm.log.find((e) => e.t >= 0 && e.step === 0);
    if (first) audio.play({ ...transportCfg(true), kind: 'take', click: false, startAt: T0 + first.t, startBar: first.bar, onStep: null, onStop: null });
    const ords = barLines(f);
    const follow = () => {
      if (playingId !== t.id) return;
      const at = audio.now() - T0;
      const bar = $(`.take[data-id="${t.id}"] .take-bar div`);
      if (bar) bar.style.width = `${clamp((at / (t.duration || 1)) * 100, 0, 100)}%`;
      if (tm && at >= 0) {
        const q = Math.floor(barPos(tm, at - (tm.lat || 0)) * 16);
        const b = Math.floor(q / 16);
        const ord = t.bars && t.bars[b] != null ? t.bars[b] : (b >= 0 && ords.length ? b % ords.length : -1);
        if (b >= 0 && ord >= 0) showStep(ords[ord], q % 16);
      }
      takeRaf = requestAnimationFrame(follow);
    };
    follow();
  }
  VA.tplay = (el) => {
    const t = takes.find((x) => x.id === el.dataset.id);
    if (!t) return;
    if (playingId === t.id) { stopPlayer(); return; }
    playTake(t, el);
  };
  /**
   * The take mixed with the beat it was recorded over (the song's patterns, or its imported beat),
   * lined up the way it was heard, rendered offline and saved as a WAV to download or share.
   */
  async function exportMix(t) {
    toast('Mixing your take with the beat…');
    try {
      let voice = bufs.get(t.id);
      if (!voice) { voice = await audio.decode(t.blob); bufs.set(t.id, voice); }
      const seq = barLines(f), tk = trackReady(), tm = t.timing;
      const mix = await audio.renderMix({
        voice,
        steps: tm.log,
        getBar: tk && !f.track.drums ? null : (b) => barSteps(f, seq.length ? seq[b % seq.length] : -1),
        track: tk ? { buffer: tk.buf, offset: tk.rec.offset, bars: tk.rec.bars, rate: tm.bpm / tk.rec.bpm } : null,
        lag: (tm.lat || 0) + 0.02,
        songBpm: tm.bpm,
      });
      const blob = audio.encodeWav(mix);
      const name = `${f.title} - ${t.name} (with beat).wav`;
      const file = window.File && new File([blob], name, { type: 'audio/wav' });
      const canShare = navigator.canShare && file && navigator.canShare({ files: [file] });
      const mb = (blob.size / 1048576).toFixed(1);
      // a fresh tap to share or save — the mixing took long enough that the browser wants one
      const sh = sheet({
        title: 'Your mix is ready',
        html: `<p class="msg">${esc(name)} · ${fmtDur(mix.duration)} · ${mb} MB</p>
          <div class="sheet-actions">${canShare ? '<button class="btn" data-a="mshare">Share</button>' : ''}<button class="btn primary" data-a="msave">Download</button></div>`,
        actions: {
          mshare: () => { sh.close(); navigator.share({ files: [file], title: name }).catch(() => {}); },
          msave: () => { sh.close(); download(name, blob); },
        },
      });
    } catch (e) {
      console.error(e);
      toast('Couldn’t mix this take in this browser');
    }
  }

  VA.tmore = (el) => {
    const t = takes.find((x) => x.id === el.dataset.id);
    if (!t) return;
    const ext = /mp4|m4a|aac/.test(t.mime) ? 'm4a' : /ogg/.test(t.mime) ? 'ogg' : 'webm';
    const name = `${f.title} - ${t.name}.${ext}`;
    const items = [
      ...(t.heard && t.heard.length ? [{ label: 'Write its words into the steps', icon: 'pen', hint: 'Again, into empty or new bars', onClick: async () => { toast('Writing the words into the steps…'); await writeTake(t); } }] : []),
      { label: 'Rename', icon: 'edit', onClick: async () => { const v = await ask({ title: 'Rename take', value: t.name }); if (v) { t.name = v; await db.put('recordings', t); loadTakes(); } } },
      { label: 'Download', icon: 'download', onClick: () => download(name, t.blob) },
      ...(t.timing && t.timing.drums && t.timing.log.length ? [{ label: 'Export with the beat', icon: 'upload', hint: 'One audio file to send', onClick: () => exportMix(t) }] : []),
    ];
    const shareFile = window.File && new File([t.blob], name, { type: t.mime });
    if (navigator.canShare && shareFile && navigator.canShare({ files: [shareFile] })) {
      items.push({ label: 'Share', icon: 'share', onClick: () => navigator.share({ files: [shareFile], title: name }).catch(() => {}) });
    }
    items.push({
      label: 'Delete take', icon: 'trash', danger: true,
      onClick: async () => {
        if (!(await confirmBox({ title: 'Delete take?', message: `“${t.name}” will be permanently deleted.`, ok: 'Delete', danger: true }))) return;
        if (playingId === t.id) stopPlayer();
        await db.del('recordings', t.id);
        loadTakes();
      },
    });
    sheet({ title: t.name, items });
  };


  // ---------------- transport: beat + click layers ----------------
  function setNowLine(line) {
    const old = ed.nowLine >= 0 && blkEl(ed.nowLine);
    if (old) old.classList.remove('now');
    ed.nowLine = line;
    const el = line >= 0 && blkEl(line);
    if (!el) return;
    el.classList.add('now');
    if (document.activeElement !== inp) {
      const r = el.getBoundingClientRect(), dt = dock.getBoundingClientRect().top, tt = topbar.getBoundingClientRect().bottom;
      if (r.top < tt || r.bottom > dt) window.scrollBy({ top: r.top - (tt + (dt - tt) / 2) + r.height / 2, behavior: 'smooth' });
    }
  }
  function clearNow() {
    ed.nowStep = -1;
    setNowLine(-1);
    if (ed.nowCell) ed.nowCell.classList.remove('now');
    ed.nowCell = null;
    $$('#seq .st.ph').forEach((x) => x.classList.remove('ph'));
    $$('#struct .sseg.on').forEach((x) => x.classList.remove('on'));
    $$('#mb i').forEach((x) => x.classList.remove('on'));
  }
  /** Light up step k of sheet row `line` (the playhead). */
  function showStep(line, k) {
    if (line !== ed.nowLine) setNowLine(line);
    ed.nowStep = k;
    const blk = blkEl(line);
    const cell = blk && blk.querySelectorAll('.cell')[k];
    if (ed.nowCell && ed.nowCell !== cell) ed.nowCell.classList.remove('now');
    if (cell) cell.classList.add('now');
    ed.nowCell = cell;
  }
  function onTick(b, k) {
    if (b < 0) {
      // count-in: the Rec button counts the beats down
      if (counting && k % 4 === 0) { const l = $('#rlabel'); if (l) l.textContent = String(4 - k / 4); }
      return;
    }
    if (counting) counting = false;
    if (T.drums) {
      const seq = barLines(f);
      showStep(seq.length ? seq[b % seq.length] : -1, k);
      if (S.panel === 'beat') {
        $$('#seq .st.ph').forEach((x) => x.classList.remove('ph'));
        $$(`#seq .st[data-k="${k}"]`).forEach((x) => x.classList.add('ph'));
        const tk = trackReady();
        if (k === 0 && tk && tk.rec.sections) {
          // light up the beat section that's playing
          let p = b % tk.rec.bars, i = 0;
          for (const s of tk.rec.sections) { if (p < s.bars) break; p -= s.bars; i++; }
          $$('#struct .sseg').forEach((x, j) => x.classList.toggle('on', j === i));
        }
      }
    }
    if (k % E.spb === 0) {
      const dots = $$('#mb i');
      if (dots.length) { const beat = (k / E.spb) % dots.length; dots.forEach((x, i) => x.classList.toggle('on', i === beat)); }
      const pill = $('.metro-btn');
      if (pill) { pill.classList.add('tick'); setTimeout(() => pill.classList.remove('tick'), 100); }
    }
  }
  /** The song's transport: drum patterns per bar, plus the imported beat looping on bar lines. */
  function transportCfg(drums) {
    const { n, spb } = sig();
    const tk = drums && trackReady();
    return {
      kind: 'song', bpm: f.bpm, swing: drums ? f.swing : 0, click: T.click, accent: S.settings.accent,
      stepsPerBeat: drums ? 4 : spb, stepsPerBar: drums ? 16 : n * spb,
      getBar: drums && !(tk && !f.track.drums) ? (b) => { const seq = barLines(f); return barSteps(f, seq.length ? seq[b % seq.length] : -1); } : null,
      beat: tk ? (b, k, t) => {
        if (k === 0 && b % tk.rec.bars === 0) audio.loopAt(t, { buffer: tk.buf, offset: tk.rec.offset, bars: tk.rec.bars, bpm: f.bpm, rate: f.bpm / tk.rec.bpm });
      } : null,
      onStep: onTick,
      onStop: () => { clearNow(); },
    };
  }
  function startTransport(countIn = 0) {
    const cfg = transportCfg(T.drums);
    E.spb = cfg.stepsPerBeat;
    audio.play({ ...cfg, countIn });
  }
  /** Apply T to the audio engine. restart = the bar structure changed. */
  function syncTransport(restart, countIn) {
    if (audio.state().kind === 'take') stopPlayer();
    if (!T.drums && !T.click) audio.stop();
    else if (audio.state().playing && !restart) audio.update({ click: T.click, accent: S.settings.accent });
    else startTransport(countIn);
    updateTransportUI();
  }

  // ----- imported beat ("track"): an audio loop that replaces or layers over the drums -----
  const tracks = new Map(); // beat id → { rec, buf }
  const trackReady = () => (f.track && tracks.get(f.track.id)) || null;
  async function loadTrack() {
    if (!f.track || tracks.has(f.track.id)) return;
    const rec0 = await db.get('beats', f.track.id);
    if (!rec0) { delete f.track; saveSoon('files', f); return; }
    try { tracks.set(rec0.id, { rec: rec0, buf: await audio.decode(rec0.blob) }); } catch (e) { toast('Couldn’t load this song’s beat'); }
    if (!ed.gone) { paintAll(); if (S.panel === 'beat') PBeat(); }
  }
  function updateTransportUI() {
    const pb = $('#dplay');
    if (pb) {
      pb.classList.toggle('on', T.drums);
      pb.querySelector('.dk-ic').innerHTML = icon(T.drums ? 'stop' : 'play');
      pb.querySelector('.dk-l').textContent = T.drums ? 'Stop' : 'Play';
      pb.setAttribute('aria-label', T.drums ? 'Stop beat' : 'Play beat');
    }
    const mb = $('.metro-btn');
    if (mb) mb.classList.toggle('on', T.click);
    const bc = $('#bclick');
    if (bc) bc.checked = T.click;
    const mp = $('#mplay');
    if (mp) mp.textContent = T.click ? 'Stop click' : 'Start click';
  }
  VA.dplay = () => {
    stopPlayer();
    T.drums = !T.drums;
    autoDrums = false;
    syncTransport(true);
  };

  return { PBeat, PTakes, syncTransport, updateTransportUI, stopPlayer, finishRec, loadTrack };
}
