/* LosSoulx FlowPad — the library: home, projects, folders, and settings. */
'use strict';

// =====================================================================
// HOME
// =====================================================================
function Home() {
  setTop({ brand: true, right: `<button class="icon-btn" data-a="settings" aria-label="Settings">${icon('gear')}</button>` });
  const projects = [...S.projects].sort((a, b) => projTime(b) - projTime(a));
  const recent = [...S.files].sort(byUpd).slice(0, 4);
  const last = S.settings.lastBackup;
  // one card at a time: backing up comes first, then installing
  const install = backupDue() ? null : installOffer();
  const notice = backupDue()
    ? `<div class="notice">${icon('download')}<div class="grow"><b>Back up your lyrics</b><span>${last ? `Last backup ${ago(last)}.${persisted ? '' : ' This browser can clear your lyrics.'}` : `They’re only saved in this browser${persisted ? '' : ', which can clear them'}.`}</span></div><button class="btn primary" data-a="backup">Back up</button><button class="icon-btn muted" data-a="snooze" aria-label="Remind me later">${icon('x')}</button></div>`
    : install === 'prompt'
      ? `<div class="notice">${icon('download')}<div class="grow"><b>Install FlowPad</b><span>Opens full-screen from your home screen and works offline.</span></div><button class="btn primary" data-a="install">Install</button><button class="icon-btn muted" data-a="noinstall" aria-label="Not now">${icon('x')}</button></div>`
      : install === 'ios'
        ? `<div class="notice">${icon('share')}<div class="grow"><b>Add FlowPad to your home screen</b><span>Tap <b class="ios-share">Share ${icon('share', 'sm')}</b> below, then <b>Add to Home Screen</b>. It opens full-screen and keeps your lyrics more safely.</span></div><button class="icon-btn muted" data-a="noinstall" aria-label="Not now">${icon('x')}</button></div>`
        : '';
  view.innerHTML = `<div class="page no-tabs">
    ${notice}
    <label class="search">${icon('search')}<input id="q" type="search" placeholder="Search lyrics" autocomplete="off" aria-label="Search lyrics"></label>
    <div id="results"></div>
    <div id="home-main">
      ${recent.length ? `<div class="sec-h">Recent</div><ul class="list">${recent.map((f) => fileRow(f, { path: true })).join('')}</ul>` : ''}
      <div class="sec-h">Projects <span class="count">${projects.length || ''}</span></div>
      ${projects.length ? `<ul class="list">${projects.map(projRow).join('')}</ul>` : empty('project', 'Nothing here yet', 'Start a song right away, or a project to keep an album together.', [['New song', 'qsong', true], ['New project', 'qproj']])}
    </div>
  </div>
  <button class="fab" data-a="add" aria-label="New">${icon('plus')}</button>`;

  const q = $('#q');
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    $('#home-main').hidden = !!s;
    const res = $('#results');
    if (!s) { res.innerHTML = ''; return; }
    const hits = S.files.filter((f) => `${f.title}\n${f.text}`.toLowerCase().includes(s)).sort(byUpd).slice(0, 50);
    res.innerHTML = hits.length
      ? `<div class="sec-h">Results <span class="count">${hits.length}</span></div><ul class="list">${hits.map((f) => fileRow(f, { q: s })).join('')}</ul>`
      : empty('search', 'No matches', 'Try another word or phrase.');
  });

  VA.qsong = quickFile;
  VA.qproj = newProject;
  VA.backup = () => { exportBackup(); rerender(); };
  VA.snooze = () => { S.settings.backupSnooze = Date.now() + 3 * 864e5; saveSettings(); rerender(); };
  VA.install = async () => { await installNow(); rerender(); };
  VA.noinstall = () => { S.settings.installDismissed = true; saveSettings(); rerender(); };
  VA.add = () => sheet({
    title: 'Create',
    items: [
      { label: 'New song', icon: 'file', hint: 'Start writing now', onClick: quickFile },
      { label: 'New project', icon: 'project', hint: 'Album, mixtape, EP', onClick: newProject },
    ],
  });
}

// =====================================================================
// PROJECT & FOLDER
// =====================================================================
function Project(id) {
  const p = proj(id);
  if (!p) return go('#/', true);
  setTop({
    back: '#/', title: p.name, sub: 'Project',
    onTitle: async () => { const v = await ask({ title: 'Rename project', value: p.name }); if (v) { p.name = v; await saveNow('projects', p); rerender(); } },
    right: `<button class="icon-btn" data-a="more-project" data-id="${p.id}" aria-label="Project options">${icon('more')}</button>`,
  });
  const fos = foldersIn(id), fis = filesIn(id, null);
  view.innerHTML = `<div class="page no-tabs">
    ${fos.length ? `<div class="sec-h">Folders <span class="count">${fos.length}</span></div><ul class="list">${fos.map(folderRow).join('')}</ul>` : ''}
    ${fis.length ? `<div class="sec-h">Songs <span class="count">${fis.length}</span></div><ul class="list">${fis.map((f) => fileRow(f)).join('')}</ul>` : ''}
    ${!fos.length && !fis.length ? empty('project', 'Empty project', 'Start a song, or add folders for verses, hooks or tracks.', [['New song', 'pnew', true], ['New folder', 'pfold']]) : ''}
  </div>
  <button class="fab" data-a="add" aria-label="Add">${icon('plus')}</button>`;
  VA.pnew = () => newFile(p.id);
  VA.pfold = () => newFolder(p.id);
  VA.add = () => sheet({
    title: `Add to ${p.name}`,
    items: [
      { label: 'New song', icon: 'file', onClick: () => newFile(p.id) },
      { label: 'New folder', icon: 'folder', onClick: () => newFolder(p.id) },
    ],
  });
}

function Folder(id) {
  const fo = folder(id);
  if (!fo) return go('#/', true);
  const p = proj(fo.projectId);
  setTop({
    back: `#/p/${fo.projectId}`, title: fo.name, sub: p ? p.name : '',
    onTitle: async () => { const v = await ask({ title: 'Rename folder', value: fo.name }); if (v) { fo.name = v; await saveNow('folders', fo); rerender(); } },
    right: `<button class="icon-btn" data-a="more-folder" data-id="${fo.id}" aria-label="Folder options">${icon('more')}</button>`,
  });
  const fis = filesIn(fo.projectId, fo.id);
  view.innerHTML = `<div class="page no-tabs">
    ${fis.length ? `<div class="sec-h">Songs <span class="count">${fis.length}</span></div><ul class="list">${fis.map((f) => fileRow(f)).join('')}</ul>` : empty('folder', 'Empty folder', 'Songs you start here stay together.', [['New song', 'fnew', true]])}
  </div>
  <button class="fab" data-a="add" aria-label="New song">${icon('plus')}</button>`;
  VA.add = () => newFile(fo.projectId, fo.id);
  VA.fnew = VA.add;
}


// =====================================================================
// HEADPHONE DELAY — tap along to clicks; the gap between a click and your tap is how late you
// hear the beat (plus your screen's touch delay). Recording words into steps, take playback and
// the playhead all use it. Wireless headphones add 150–300 ms; the browser often doesn't know.
// =====================================================================
function calibrate(done) {
  const BEAT = 0.6, CLICKS = 16, WARMUP = 3;
  let clicks = [], taps = [], timer = 0, running = false;
  const sh = sheet({
    title: 'Headphone delay',
    html: `<p class="msg">Put on the headphones (or speakers) you rap with. Press <b>Start</b>, then tap the big button right <b>on</b> each click — don't watch the screen, just listen.</p>
      <button class="tapbig" id="ctap" disabled>Tap on the click</button>
      <div class="cal-dots" id="cdots">${Array.from({ length: CLICKS - WARMUP }, () => '<i></i>').join('')}</div>
      <p class="src" id="cres">${S.settings.latencyMs != null ? `Now: ${S.settings.latencyMs} ms (measured)` : 'Now: automatic — what the browser reports'}</p>
      <div class="sheet-actions"><button class="btn" id="cauto">Use automatic</button><button class="btn primary" id="cgo">Start</button></div>`,
  });
  const el = sh.el, tap = $('#ctap', el), res = $('#cres', el), go = $('#cgo', el);
  const finish = () => {
    running = false;
    tap.disabled = true;
    go.disabled = false;
    // each tap against its nearest click; the first few are warm-up
    const offs = taps.map((t) => {
      const near = clicks.reduce((a, c) => (Math.abs(c - t) < Math.abs(a - t) ? c : a), Infinity);
      return { d: t - near, i: clicks.indexOf(near) };
    }).filter((o) => o.i >= WARMUP && Math.abs(o.d) < BEAT / 2).map((o) => o.d * 1000).sort((a, b) => a - b);
    if (offs.length < 6) { res.textContent = `Only ${offs.length} taps counted — try again and tap on every click.`; go.textContent = 'Try again'; return; }
    const med = Math.round(offs[Math.floor(offs.length / 2)]);
    const spread = Math.round(offs[Math.floor(offs.length * 0.75)] - offs[Math.floor(offs.length * 0.25)]);
    if (spread > 70) { res.textContent = `Your taps were spread over ${spread} ms — try again, as steady as you can.`; go.textContent = 'Try again'; return; }
    const ms = Math.max(0, Math.min(600, med));
    S.settings.latencyMs = ms;
    saveSettings();
    audio.setLatency(ms / 1000);
    res.innerHTML = `Measured <b>${ms} ms</b> (from ${offs.length} taps, ±${Math.round(spread / 2)} ms). Saved — recording, playback and the playhead use it now.`;
    go.textContent = 'Measure again';
    buzz(12);
    if (done) done();
  };
  go.addEventListener('click', () => {
    if (running) return;
    const ctx = audio.ensure();
    running = true;
    go.disabled = true;
    tap.disabled = false;
    taps = [];
    $$('#cdots i', el).forEach((d) => d.classList.remove('on'));
    res.textContent = 'Listen… tap on every click.';
    const t0 = ctx.currentTime + 0.8;
    clicks = Array.from({ length: CLICKS }, (_, i) => t0 + i * BEAT);
    clicks.forEach((t, i) => audio.clickAt(t, i % 4 === 0));
    clearTimeout(timer);
    timer = setTimeout(finish, (0.8 + CLICKS * BEAT + 0.5) * 1000);
  });
  tap.addEventListener('pointerdown', (e) => {
    if (!running) return;
    e.preventDefault();
    // the tap on the audio clock (taking out the time since the touch actually happened)
    const t = audio.now() - Math.max(0, performance.now() - e.timeStamp) / 1000;
    taps.push(t);
    tap.classList.remove('hit'); void tap.offsetWidth; tap.classList.add('hit');
    const counted = taps.filter((x) => x > clicks[WARMUP] - BEAT / 2).length;
    $$('#cdots i', el).forEach((d, i) => d.classList.toggle('on', i < counted));
  });
  $('#cauto', el).addEventListener('click', () => {
    delete S.settings.latencyMs;
    saveSettings();
    audio.setLatency(null);
    res.textContent = 'Now: automatic — what the browser reports';
    if (done) done();
  });
  sh.onclose = () => { clearTimeout(timer); running = false; };
}

// =====================================================================
// SETTINGS
// =====================================================================
function openSettings() {
  const sh = sheet({
    title: 'Settings',
    html: `<div class="set-sec">General</div>
      <div class="set-row"><div class="lbl">Theme</div><div class="seg" id="thm">${['dark', 'light', 'system'].map((t) => `<button data-t="${t}" class="${S.settings.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="set-row"><div class="lbl">Accent</div><div class="swatches" id="acc">${ACCENTS.map(([k, l]) => `<button data-c="${k}" class="sw ${(S.settings.accentColor || 'blue') === k ? 'on' : ''}" aria-label="${l}" title="${l}"></button>`).join('')}</div></div>
      <label class="set-row"><div><div class="lbl">High contrast</div><div class="sub">Brighter text and clearer edges, for writing in sunlight</div></div><input type="checkbox" class="switch" id="hc" ${S.settings.contrast ? 'checked' : ''}></label>
      <label class="set-row"><div><div class="lbl">Online dictionary</div><div class="sub">Exact syllables, stresses and rhymes. Off keeps everything on this device.</div></div><input type="checkbox" class="switch" id="onl" ${S.settings.online ? 'checked' : ''}></label>
      <div class="set-sec">Writing</div>
      <div class="set-row"><div><div class="lbl">Typing</div><div class="sub">On the step, or in a bar above the keyboard</div></div><div class="seg" id="tbar">${[['auto', 'Auto'], ['step', 'Step'], ['bar', 'Bar']].map(([k, l]) => `<button data-v="${k}" class="${(S.settings.typeBar == null ? 'auto' : S.settings.typeBar ? 'bar' : 'step') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div><div class="lbl">Step size</div><div class="sub">Or pinch the grid</div></div><div class="seg" id="zm">${[[0.85, 'S'], [1, 'M'], [1.3, 'L']].map(([z, l]) => `<button data-z="${z}" class="${Math.abs((S.settings.zoom || 1) - z) < 0.01 ? 'on' : ''}" aria-label="Step size ${l}">${l}</button>`).join('')}</div></div>
      <button class="menu-i" id="retips">${icon('sparkle')}<span>Show tips again</span><small>Each shows once, when it’s useful</small></button>
      <div class="set-sec">Sound &amp; timing</div>
      <button class="menu-i" id="cal">${icon('metro')}<span>Headphone delay</span><small id="calv">${S.settings.latencyMs != null ? `${S.settings.latencyMs} ms · measured` : 'Automatic · measure it'}</small></button>
      <label class="set-row"><div><div class="lbl">Soft sounds</div><div class="sub">Quiet notes as words land, bars finish, and you save or undo</div></div><input type="checkbox" class="switch" id="snd" ${S.settings.sounds ? 'checked' : ''}></label>
      ${navigator.vibrate ? `<label class="set-row"><div><div class="lbl">Vibration</div><div class="sub">Tiny taps as words land (firmer on the beat) and steps move</div></div><input type="checkbox" class="switch" id="hap" ${S.settings.haptics !== false ? 'checked' : ''}></label>` : ''}
      <div class="set-sec">Your data</div>
      <button class="menu-i" id="exp">${icon('download')}<span>Back up everything</span><small>${S.settings.lastBackup ? `Last: ${ago(S.settings.lastBackup)}` : 'Never backed up'}</small></button>
      <button class="menu-i" id="imp">${icon('upload')}<span>Restore a backup</span></button>
      <input type="file" id="impf" accept="application/json,.json" hidden>
      <p class="src">Your songs live on this device${persisted ? ' and are protected from automatic clearing' : ' — the browser can clear them if space runs low, so back up now and then'}. A backup holds your songs, folders and drum patterns.</p>
      <div class="set-sec">About</div>
      <a class="menu-i" href="privacy.html" target="_blank" rel="noopener">${icon('file')}<span>Privacy</span><small>What stays on your device</small></a>
      <a class="menu-i" href="https://github.com/CastilloTech/FlowPad/issues/new" target="_blank" rel="noopener">${icon('pen')}<span>Send feedback</span><small>GitHub</small></a>`,
  });
  const el = sh.el;
  $('#cal', el).addEventListener('click', () => calibrate(() => { $('#calv', el).textContent = S.settings.latencyMs != null ? `${S.settings.latencyMs} ms · measured` : 'Automatic · measure it'; }));
  $('#thm', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    S.settings.theme = b.dataset.t;
    saveSettings();
    applyTheme();
    $$('#thm button', el).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#snd', el).addEventListener('change', (e) => { S.settings.sounds = e.target.checked; saveSettings(); if (e.target.checked) audio.ui('bar'); });
  $('#acc', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    S.settings.accentColor = b.dataset.c;
    saveSettings();
    applyTheme();
    $$('#acc .sw', el).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#hc', el).addEventListener('change', (e) => { S.settings.contrast = e.target.checked; saveSettings(); applyTheme(); });
  const seg = (id, fn) => $(id, el).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    fn(b);
    saveSettings();
    $$(`${id} button`, el).forEach((x) => x.classList.toggle('on', x === b));
  });
  seg('#tbar', (b) => { S.settings.typeBar = { auto: undefined, step: false, bar: true }[b.dataset.v]; if (S.cur) toast('Takes effect when you next open a song'); });
  seg('#zm', (b) => { S.settings.zoom = +b.dataset.z; const g = $('#gsheet'); if (g) g.style.setProperty('--cz', S.settings.zoom); });
  $('#retips', el).addEventListener('click', () => { S.settings.coached = {}; saveSettings(); toast('Tips will show again as you write'); });
  const hap = $('#hap', el);
  if (hap) hap.addEventListener('change', (e) => { S.settings.haptics = e.target.checked; saveSettings(); buzz(10); });
  $('#onl', el).addEventListener('change', (e) => { S.settings.online = e.target.checked; syl.online = e.target.checked; saveSettings(); });
  $('#exp', el).addEventListener('click', () => { exportBackup(); $('#exp small', el).textContent = 'Last: just now'; });
  $('#imp', el).addEventListener('click', () => $('#impf', el).click());
  $('#impf', el).addEventListener('change', async (e) => {
    const fl = e.target.files[0];
    if (!fl) return;
    try {
      const data = JSON.parse(await fl.text());
      if (data.app !== 'FlowPad') throw new Error('not a FlowPad backup');
      const n = (data.files || []).length;
      if (!(await confirmBox({ title: 'Restore this backup?', message: `${plural(n, 'song')} will be added to your library. Songs that are already here are updated to the backup.`, ok: 'Restore' }))) return;
      for (const s of ['projects', 'folders', 'files', 'patterns']) for (const o of data[s] || []) await db.put(s, o);
      await load();
      toast('Backup restored');
      closeAllSheets();
      go('#/');
    } catch (err) {
      toast('That file isn’t a FlowPad backup');
    }
  });
}
