/* LosSoulx FlowPad — the editor's audio side: the Beat panel (drum patterns, an imported beat and
 * its structure), the recorder and takes (words into steps, playback in time with the beat), and
 * the transport that plays it all. Editor() hands it the open song as `ed`.
 */
'use strict';

/**
 * Beat files the picker offers. iPhones grey out MP3s for a bare "audio/*", so the types are spelled
 * out — and videos are in, since a beat sometimes comes as one.
 */
const BEAT_TYPES = 'audio/*,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/aiff,audio/x-aiff,audio/flac,audio/ogg,video/mp4,video/quicktime,.mp3,.m4a,.aac,.wav,.aif,.aiff,.flac,.ogg,.oga,.opus,.mp4,.m4v,.mov';

function editorAudio(ed) {
  const { f, rows, panel, stripEl, closeBtn, inp, commit, paintAll, blkEl, updateStrip, beatChanged } = ed;
  const activate = (r, k) => ed.activate(r, k);

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
      ${trackHTML}${structHTML}<input type="file" id="tfile" accept="${BEAT_TYPES}" hidden>
      <div class="seq" id="seq">${[0, 1].map((h) => `<div class="half">${TRACKS.map((t) => `<div class="trk"><span class="tl">${t.name}</span>${range(8).map((j) => { const k = h * 8 + j; const on = !!pat.steps[t.id][k]; return `<button class="st ${on ? 'on' : ''} ${k % 4 === 0 ? 'b' : ''}" data-a="step" data-t="${t.id}" data-k="${k}" aria-label="${t.name} step ${k + 1}" aria-pressed="${on}"></button>`; }).join('')}</div>`).join('')}</div>`).join('')}</div>
      <div class="beat-ctl">${bpmCtl(f.bpm)}
        <label class="mini"><span>Swing</span><input type="range" class="range" id="swing" min="0" max="40" value="${Math.round(f.swing * 100)}"></label>
        <label class="mini"><span>Click</span><input type="checkbox" class="switch" id="bclick" ${T.click ? 'checked' : ''}></label>
        <label class="mini" title="Every syllable as a blip over the beat — hear your cadence"><span>Words</span><input type="checkbox" class="switch" id="bwords" ${S.settings.hearWords ? 'checked' : ''}></label>
      </div>
      <p class="hint">The highlighted pattern is the song beat${pat.bpm ? ` (sits around ${pat.bpm} BPM)` : ''}. Tap a bar's beat label on the sheet to give it its own pattern.</p>`;
    $('#swing').addEventListener('input', (e) => { f.swing = e.target.value / 100; if (T.drums) audio.update({ swing: f.swing }); saveSoon('files', f); });
    $('#bclick').addEventListener('change', (e) => { T.click = e.target.checked; syncTransport(); });
    $('#bwords').addEventListener('change', (e) => { S.settings.hearWords = e.target.checked; saveSettings(); });
    $('#tfile').addEventListener('change', (e) => { const fl = e.target.files[0]; e.target.value = ''; if (fl) importBeat(fl); });
    const td = $('#tdrums');
    if (td) td.addEventListener('change', () => { f.track.drums = td.checked; saveSoon('files', f); paintAll(); if (T.drums) syncTransport(true); });
  }

  VA.timport = () => $('#tfile').click();
  async function importBeat(fl) {
    toast('Loading your beat…');
    let buf;
    try { buf = await audio.decode(fl); } catch (e) { toast('Couldn’t read that file. MP3, M4A, WAV or AAC work best.'); return; }
    // a video whose sound this browser can't read decodes to silence: say so, rather than guess a
    // tempo and sections from nothing
    if (audio.peakOf(buf) < 0.001) {
      toast(/^video\//.test(fl.type) || /\.(mov|mp4|m4v)$/i.test(fl.name) ? 'No sound found in that video. Save its audio as an MP3 or M4A and import that.' : 'That file is silent: no beat to import.');
      return;
    }
    // the tempo (most beat files say it in their name) and where bar 1 starts — after a video's
    // quiet first second, say
    const named = fl.name.match(/(\d{2,3}(?:\.\d)?)\s*bpm/i);
    let timing = null;
    try { timing = await FP.mix.offThread('timing', { chans: monoOf(buf), rate: buf.sampleRate, bpm: named ? +named[1] : null }); } catch (e) { console.error(e); }
    const bpm = clamp((timing && timing.bpm) || (named && +named[1]) || f.bpm, 50, 220);
    const b = { id: FP.uid(), name: fl.name.replace(/\.[^.]+$/, '') || 'My beat', blob: fl, mime: fl.type, bpm, offset: (timing && timing.offset) || 0, bars: 4, duration: buf.duration, created: Date.now() };
    if (!(await beatSettings(b, true, buf))) return;
    if (b.bars >= 8) { toast('Finding the beat’s sections…'); b.sections = await findSections(b, buf); }
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
  /** A beat's sections (Intro, Verse, Hook…), worked out in the worker. Resolves null if it can't tell. */
  async function findSections(b, buf) {
    try { return (await FP.mix.offThread('sections', { chans: monoOf(buf), rate: buf.sampleRate, bpm: b.bpm, offset: b.offset, bars: b.bars })).sections; } catch (e) { console.error(e); return null; }
  }
  /** The beat as one channel, a copy (it's handed to the worker). */
  function monoOf(buf) {
    const a = buf.getChannelData(0), m = new Float32Array(a.length);
    if (buf.numberOfChannels > 1) { const c = buf.getChannelData(1); for (let i = 0; i < m.length; i++) m[i] = (a[i] + c[i]) / 2; } else m.set(a);
    return [m];
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
  VA.sfind = async () => {
    const tk = trackReady();
    if (!tk) return;
    toast('Finding the beat’s sections…');
    tk.rec.sections = await findSections(tk.rec, tk.buf);
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
      if (e.target.closest('#sredo')) { findSections(tk.rec, tk.buf).then((r) => { secs = r || secs; draw(); }); return; }
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
          <div class="set-row"><div><div class="lbl">Tempo</div><div class="sub">${isNew ? 'Guessed — check it, or tap along' : 'The beat’s own BPM'} · a bar is <span id="bbar"></span></div></div><span class="mrow"><input class="field num" name="bpm" type="number" inputmode="decimal" min="50" max="220" step="0.1" value="${b.bpm}" aria-label="Tempo in BPM"><button type="button" class="btn" data-a="btap">Tap</button></span></div>
          <div class="set-row tfix"><div class="sub">Sounds twice too fast or slow? Verses usually run 16 bars.</div><span class="mrow"><button type="button" class="btn" data-a="bhalf" aria-label="Half the tempo">÷2</button><button type="button" class="btn" data-a="bdouble" aria-label="Double the tempo">×2</button></span></div>
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
          bhalf: () => { form.elements.bpm.value = Math.round((b.bpm / 2) * 10) / 10; sync0(); },
          bdouble: () => { form.elements.bpm.value = Math.round(b.bpm * 2 * 10) / 10; sync0(); },
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
        $('#bbar', sh.el).textContent = `${(240 / b.bpm).toFixed(2)} s`;
        b.offset = Math.max(0, Math.min(b.duration - 0.5, +form.elements.offset.value || 0));
        if (!barsTouched) form.elements.bars.value = autoBars();
      };
      form.elements.bpm.addEventListener('input', sync0);
      sync0();
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
          if (moved && tk.rec.sections) tk.rec.sections = tk.rec.bars >= 8 ? await findSections(tk.rec, tk.buf) : null; // bar lines moved: find the sections again
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

    // each syllable → where it fell in the beat (in bars: bar 2, halfway = 2.5), never before the one before
    const lag = clock.lat + 0.02;
    const start = Math.max(0, barPos(clock, 0));
    const placed = [];
    let lastPos = -1;
    list.forEach((p, i) => p.pcs.forEach((pc, j) => {
      let pos = Math.max(start, barPos(clock, times[i][j] - lag));
      if (pos < lastPos) pos = lastPos;
      lastPos = pos;
      placed.push({ pos, pc });
    }));
    // its bar: the one it's closest to the start of within a 32nd (a syllable a hair early belongs to the next bar)
    const barOf = (pos) => Math.floor(pos + 1 / 32);

    snapshot(f, 'Before words from a take');
    // recorded bars → sheet rows
    const seq = barLines(f);
    const isEmpty = (ri) => rows[ri].cells.every((c) => !c.trim());
    const trailing = [];
    if (!clock.drums) for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].type !== 'bar') continue; if (isEmpty(i)) trailing.unshift(i); else break; }
    const firstB = barOf(placed[0].pos), lastB = barOf(placed[placed.length - 1].pos);
    const rowOf = new Map();
    for (let b = firstB; b <= lastB; b++) {
      let ri;
      if (clock.drums && b < seq.length && isEmpty(seq[b])) ri = seq[b];
      else if (trailing.length) ri = trailing.shift();
      else { rows.push(newBarRow()); ri = rows.length - 1; }
      rowOf.set(b, ri);
    }
    const steps = new Map();
    const lastK = new Map();
    placed.forEach(({ pos, pc }) => {
      const b = barOf(pos), ri = rowOf.get(b), N = rows[ri].cells.length;
      // on the bar's own grid (16ths, or triplets), never before the syllable before
      const k = Math.max(lastK.get(ri) ?? 0, Math.min(N - 1, Math.max(0, Math.round((pos - b) * N))));
      lastK.set(ri, k);
      const key = `${ri}:${k}`;
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
        const pos = barPos(tm, at - (tm.lat || 0)), b = Math.floor(pos);
        const ord = t.bars && t.bars[b] != null ? t.bars[b] : (b >= 0 && ords.length ? b % ords.length : -1);
        const ri = ord >= 0 ? ords[ord] : -1;
        if (b >= 0 && ri >= 0 && rows[ri]) showStep(ri, Math.min(rows[ri].cells.length - 1, Math.floor((pos - b) * rows[ri].cells.length)));
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
   * lined up the way it was heard, then mixed and mastered (js/mix.js) and saved as a WAV to
   * download or share. First: how it's finished.
   */
  const VOCALS = [['raw', 'Raw', 'Just balanced and mastered'], ['clean', 'Clean', 'Noise and rumble out, an even level, a little room'], ['radio', 'Radio', 'Brighter, compressed harder, right up front'], ['lofi', 'Lo-fi', 'Darker and narrower, more room']];
  function exportMix(t) {
    let target = S.settings.mixTarget || -14;
    let vocal = S.settings.mixVocal || (S.settings.mixPolish === false ? 'raw' : 'clean');
    const sub = () => VOCALS.find(([k]) => k === vocal)[2];
    const sh = sheet({
      title: 'Mix & master',
      html: `<p class="msg">Your take over the beat, balanced and brought up to a finished loudness.</p>
        <div class="set-row col"><div><div class="lbl">Vocal</div><div class="sub" id="mvsub">${esc(sub())}</div></div><div class="seg wide" id="mvoc">${VOCALS.map(([k, l]) => `<button data-v="${k}" class="${vocal === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="set-row"><div><div class="lbl">Loudness</div><div class="sub">Streaming services play everything at about −14</div></div><div class="seg" id="mtgt">${[[-14, 'Streaming'], [-9, 'Loud']].map(([v, l]) => `<button data-v="${v}" class="${target === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-a="mgo">Mix it</button></div>`,
      actions: {
        mgo: () => {
          S.settings.mixVocal = vocal;
          S.settings.mixTarget = target;
          saveSettings();
          sh.close();
          runMix(t, vocal, target);
        },
      },
    });
    const seg = (id, fn) => $(id, sh.el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      fn(b.dataset.v);
      $$(`${id} button`, sh.el).forEach((x) => x.classList.toggle('on', x === b));
    });
    seg('#mvoc', (v) => { vocal = v; $('#mvsub', sh.el).textContent = sub(); });
    seg('#mtgt', (v) => { target = +v; });
  }
  /** What the mix did, in a few short lines. */
  function mixSaid(r = {}) {
    const hz = (f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`), sgn = (d) => `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
    const out = [];
    if (r.noise != null && r.noise <= -1) out.push(`Background noise down ${Math.round(-r.noise)} dB`);
    if (r.eq && r.eq.length) out.push(`${r.preset ? `${r.preset} vocal` : 'Vocal'} tone: ${r.eq.map((m) => `${sgn(m.db)} dB at ${hz(m.hz)}`).join(', ')}`);
    if (r.ride && r.ride[1] - r.ride[0] >= 1) out.push(`Phrase levels evened out (${sgn(Math.round(r.ride[0]))} to ${sgn(Math.round(r.ride[1]))} dB)`);
    if (r.deEss != null && r.deEss <= -1) out.push(`Harsh “s” sounds down up to ${Math.round(-r.deEss)} dB`);
    if (r.duck) out.push(`The beat dips ${r.duck} dB in the middle while you rap`);
    if (r.short) out.push('Kept a little under the target: any louder would only flatten the hits');
    return out;
  }
  /** Float32Arrays → an AudioBuffer to play. */
  const toBuffer = (chans, rate) => {
    const b = audio.ensure().createBuffer(chans.length, chans[0].length, rate);
    chans.forEach((c, i) => b.copyToChannel(c, i));
    return b;
  };
  async function runMix(t, vocal, target) {
    const preset = vocal === 'raw' ? null : vocal, P = preset && FP.mix.PRESETS[preset];
    // a few seconds on a phone for a long take: say so until it's ready
    const busy = sheet({ title: 'Mixing & mastering…', html: `<p class="msg">${P ? 'Cleaning up and measuring your vocal, balancing it over the beat, then' : 'Balancing your take over the beat, then'} bringing it up to ${target} LUFS. A long take can take a little while.</p><div class="mbar"><i></i></div>` });
    try {
      let voice = bufs.get(t.id);
      if (!voice) { voice = await audio.decode(t.blob); bufs.set(t.id, voice); }
      // the room's hiss and hum out first (measured in the count-in and the gaps), in the worker
      let clean = voice, noise = null;
      if (P) {
        const dn = await FP.mix.offThread('denoise', { chan: voice.getChannelData(0).slice(), rate: voice.sampleRate });
        noise = dn.cutDb;
        if (noise < 0) clean = toBuffer([dn.chan], voice.sampleRate);
      }
      const seq = barLines(f), tk = trackReady(), tm = t.timing;
      const stems = await audio.renderStems({
        voice: clean,
        original: voice,
        chain: P ? P.chain : null,
        steps: tm.log,
        getBar: tk && !f.track.drums ? null : (b) => barSteps(f, seq.length ? seq[b % seq.length] : -1),
        track: tk ? { buffer: tk.buf, offset: tk.rec.offset, bars: tk.rec.bars, rate: tm.bpm / tk.rec.bpm } : null,
        lag: (tm.lat || 0) + 0.02,
        songBpm: tm.bpm,
      });
      // the A/B's beat, as something to play (one copy) — the worker gets the stems themselves
      const beatBuf = stems.beat && toBuffer(stems.beat, stems.rate);
      // the vocal balanced over the beat, then mastered: in a worker, the screen stays smooth
      const m = await FP.mix.finishOffThread({ beat: stems.beat, vocal: stems.vocal, rawVoice: stems.raw, rate: stems.rate, target, ceilingDb: -1, preset });
      m.report.noise = noise;
      // the mix as something to play, then the file from that — not kept twice
      const mixBuf = toBuffer(m.chans, stems.rate), len = mixBuf.length;
      m.chans = null;
      const blob = audio.encodeWav(mixBuf);
      const name = `${f.title} - ${t.name} (with beat).wav`;
      const file = window.File && new File([blob], name, { type: 'audio/wav' });
      const canShare = navigator.canShare && file && navigator.canShare({ files: [file] });
      const mb = (blob.size / 1048576).toFixed(1);
      const level = Number.isFinite(m.lufs) ? `${m.lufs.toFixed(1)} LUFS · peak ${m.peakDb.toFixed(1)} dB` : 'Silent';
      if (Number.isFinite(m.lufs) && m.lufs < target - 0.6) m.report.short = true; // stopped short: louder would only crush it
      busy.close();
      // a fresh tap to share or save — the mixing took long enough that the browser wants one
      const ab = abPlayer(mixBuf, beatBuf, voice, m.lufs, m.rawLufs);
      const sh = sheet({
        title: 'Your mix is ready',
        html: `<p class="msg">${esc(name)} · ${fmtDur(len / stems.rate)} · ${mb} MB<br><span class="mlev">${esc(level)}</span></p>
          ${mixSaid(m.report).length ? `<ul class="mrep">${mixSaid(m.report).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="ab"><button class="play" data-a="abplay" aria-label="Play">${icon('play')}</button><div class="seg wide" id="absel"><button data-v="mix" class="on">Mixed</button><button data-v="raw">Original</button></div></div>
          <p class="src ab-note">Both play at the same loudness, so you hear the mix — not just the volume.</p>
          <div class="sheet-actions">${canShare ? '<button class="btn" data-a="mshare">Share</button>' : ''}<button class="btn primary" data-a="msave">Download</button></div>`,
        actions: {
          abplay: (b) => { const on = ab.toggle(); b.classList.toggle('on', on); b.innerHTML = icon(on ? 'stop' : 'play'); },
          mshare: () => { sh.close(); navigator.share({ files: [file], title: name }).catch(() => {}); },
          msave: () => { sh.close(); download(name, blob); },
        },
      });
      $('#absel', sh.el).addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        ab.choose(b.dataset.v);
        $$('#absel button', sh.el).forEach((x) => x.classList.toggle('on', x === b));
      });
      ab.onend = () => { const b = $('[data-a="abplay"]', sh.el); if (b) { b.classList.remove('on'); b.innerHTML = icon('play'); } };
      sh.onclose = () => ab.stop();
    } catch (e) {
      console.error(e);
      busy.close();
      toast('Couldn’t mix this take in this browser');
    }
  }
  /**
   * Mixed against original: both start together and play through, and switching just crossfades
   * which one you hear. The louder of the two is turned down to the other's loudness, so the
   * difference you hear is the mix itself, not that one is louder.
   */
  function abPlayer(mixBuf, beatBuf, voice, mixLufs, rawLufs) {
    const ctx = audio.ensure();
    const match = Number.isFinite(mixLufs) && Number.isFinite(rawLufs) ? rawLufs - mixLufs : 0;
    const level = { mix: FP.mix.fromDb(Math.min(0, match)), raw: FP.mix.fromDb(Math.min(0, -match)) };
    let srcs = [], gains = null, pick = 'mix';
    const api = {
      playing: false,
      onend: null,
      toggle() { if (api.playing) api.stop(); else api.play(); return api.playing; },
      play() {
        audio.stop();
        stopPlayer();
        const t0 = ctx.currentTime + 0.05;
        gains = { mix: ctx.createGain(), raw: ctx.createGain() };
        for (const k of ['mix', 'raw']) { gains[k].gain.value = k === pick ? level[k] : 0; gains[k].connect(ctx.destination); }
        const add = (buf, g) => { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start(t0); srcs.push(s); return s; };
        add(mixBuf, gains.mix).onended = () => { if (api.playing) { api.stop(); if (api.onend) api.onend(); } };
        if (beatBuf) add(beatBuf, gains.raw);
        add(voice, gains.raw);
        api.playing = true;
      },
      choose(k) {
        pick = k;
        if (!gains) return;
        const now = ctx.currentTime;
        for (const x of ['mix', 'raw']) { const g = gains[x].gain; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(x === k ? level[x] : 0, now + 0.03); }
      },
      stop() {
        api.playing = false;
        srcs.forEach((s) => { s.onended = null; try { s.stop(); } catch (e) { /* not started */ } });
        srcs = [];
        if (gains) { gains.mix.disconnect(); gains.raw.disconnect(); gains = null; }
      },
    };
    return api;
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
    if (ed.nowCell) ed.nowCell.classList.remove('now', 'hit');
    ed.nowCell = null;
    $$('.blk.pa, .blk.pb').forEach((x) => x.classList.remove('pa', 'pb'));
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
    if (ed.nowCell && ed.nowCell !== cell) ed.nowCell.classList.remove('now', 'hit');
    if (cell && cell !== ed.nowCell) {
      cell.classList.add('now');
      // the sheet moves with the music: each syllable pops as it's heard, the bar pulses on the beats
      if (cell.lastChild.textContent) cell.classList.add('hit');
      if (rows[line] && k % (rows[line].cells.length / 4) === 0) { const a = blk.classList.contains('pa'); blk.classList.toggle('pa', !a); blk.classList.toggle('pb', a); }
    }
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
      const seq = barLines(f), line = seq.length ? seq[b % seq.length] : -1;
      showStep(line, line >= 0 && rows[line] ? Math.floor((k * rows[line].cells.length) / 16) : k);
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
      words: drums ? (b, t, barDur) => {
        if (!S.settings.hearWords) return;
        const seq = barLines(f);
        if (seq.length) blipsFor(seq[b % seq.length], t, barDur);
      } : null,
      onStep: onTick,
      onStop: () => { clearNow(); },
    };
  }
  /** A bar's syllables as blips over the beat, each at its moment in the bar (triplets too). */
  function blipsFor(ri, t, barDur) {
    const R = rows[ri];
    if (!R || R.type !== 'bar') return;
    const v = barView(R.cells), N = R.cells.length;
    R.cells.forEach((c, k) => { if (c.trim()) audio.blipAt(t + (k / N) * barDur, v.cls[k] === 's1'); });
  }

  /** Hear one bar: twice over its drums (or a click), its words as blips, the playhead on it. */
  function hearBar(r) {
    stopPlayer();
    if (T.drums || T.click) { T.drums = T.click = false; updateTransportUI(); }
    const cfg = transportCfg(true), N = rows[r].cells.length;
    audio.play({
      ...cfg, kind: 'bar', bars: 2, loop: false, beat: null,
      click: !cfg.getBar, // an imported beat with the drums off: a click keeps the time
      getBar: cfg.getBar ? () => barSteps(f, r) : null,
      words: (b, t, barDur) => blipsFor(r, t, barDur),
      onStep: (b, k) => { if (b >= 0) showStep(r, Math.floor((k * N) / 16)); },
      onStop: () => clearNow(),
    });
  }

  /**
   * Tap a cadence in: a bar of clicks counts you in, then you tap a bar of rhythm over the beat.
   * The taps (minus your headphone delay) snap to the bar's grid; lay its words on it, use it as
   * a guide to write into, or save it as a cadence.
   */
  function tapCadence(r) {
    stopPlayer();
    if (T.drums || T.click) { T.drums = T.click = false; updateTransportUI(); }
    const R = rows[r], N = R.cells.length, barDur = 240 / f.bpm, text = barView(R.cells).text;
    let taps = [], steps = [], running = false;
    const sh = sheet({
      title: 'Tap a cadence',
      html: `<p class="msg">A bar of clicks counts you in — then tap the rhythm for one bar, over the beat. Don’t think about words yet.</p>
        <button class="tapbig" id="ttap" disabled>Tap the rhythm</button>
        <div class="tdots" id="tdots">${ed.flowDots([], N)}</div>
        <p class="src" id="tres">${N === 16 ? '16ths' : N === 12 ? 'Triplets' : 'Fast triplets'} · ${f.bpm} BPM</p>
        <div class="sheet-actions"><button class="btn primary" id="tgo">Start</button></div>
        <div id="tuse" hidden>
          ${text ? '<button class="btn block" data-a="tlay">Lay this bar’s words on it</button>' : ''}
          <button class="btn block" data-a="tguide">Use it as a guide to write into</button>
          <button class="btn block" data-a="tsave">Save it as a cadence</button>
        </div>`,
      actions: {
        tlay: () => { sh.close(); R.cells = SH.applyFlow(text, steps, N); commit(); toast('Words laid on your cadence', { label: 'Undo', fn: ed.undo }); },
        tguide: () => { sh.close(); R.guide = steps; commit(); activate(r, steps[0]); toast('Guide set — type, and each word lands in the next slot', { label: 'Undo', fn: ed.undo }); },
        tsave: async () => {
          sh.close();
          const name = await ask({ title: 'Name this cadence', value: `Cadence ${S.flows.length + 1}`, ok: 'Save' });
          if (!name) return;
          S.flows.unshift({ id: FP.uid(), name, steps, n: N, user: true });
          db.put('kv', { id: 'flows', list: S.flows });
          toast('Saved — find it under Rhythm in any bar’s ⋯ menu');
        },
      },
    });
    const el = sh.el, tap = $('#ttap', el), go = $('#tgo', el), res = $('#tres', el);
    const finish = () => {
      if (!running) return;
      running = false;
      tap.disabled = true;
      go.disabled = false;
      go.textContent = 'Tap again';
      const bar0 = audio.timeline().log.find((e) => e.bar === 0 && e.step === 0);
      steps = bar0 ? FP.cadence.fromTaps(taps.map((t) => t - bar0.t), barDur, N) : [];
      $('#tdots', el).innerHTML = ed.flowDots(steps, N);
      if (!steps.length) { res.textContent = 'No taps landed in the bar — press Start and tap after the count-in.'; $('#tuse', el).hidden = true; return; }
      res.textContent = `${plural(steps.length, 'hit')} · ${N === 16 ? '16ths' : N === 12 ? 'triplets' : 'fast triplets'}`;
      $('#tuse', el).hidden = false;
      buzz(12);
    };
    go.addEventListener('click', () => {
      if (running) return;
      running = true;
      taps = [];
      go.disabled = true;
      tap.disabled = false;
      $('#tuse', el).hidden = true;
      res.textContent = 'Listen… four clicks, then tap your rhythm';
      const cfg = transportCfg(true);
      audio.play({
        ...cfg, kind: 'tap', bars: 1, loop: false, countIn: 1, click: true, beat: null, words: null,
        getBar: cfg.getBar ? () => barSteps(f, r) : null,
        onStep: (b) => { if (b === 0) res.textContent = 'Tap!'; },
        onStop: finish,
      });
    });
    tap.addEventListener('pointerdown', (e) => {
      if (!running) return;
      e.preventDefault();
      // when it was heard: the touch's own time, minus the speaker / headphone delay
      taps.push(audio.now() - Math.max(0, performance.now() - e.timeStamp) / 1000 - audio.latency());
      tap.classList.remove('hit'); void tap.offsetWidth; tap.classList.add('hit');
    });
    sh.onclose = () => { if (running) { running = false; audio.stop(); } };
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

  return { PBeat, PTakes, syncTransport, updateTransportUI, stopPlayer, finishRec, loadTrack, hearBar, tapCadence };
}
