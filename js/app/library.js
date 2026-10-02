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
      ${projects.length ? `<ul class="list">${projects.map(projRow).join('')}</ul>` : empty('project', 'No projects yet', 'Tap + to start your first project.')}
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

  VA.backup = () => { exportBackup(); rerender(); };
  VA.snooze = () => { S.settings.backupSnooze = Date.now() + 3 * 864e5; saveSettings(); rerender(); };
  VA.install = async () => { await installNow(); rerender(); };
  VA.noinstall = () => { S.settings.installDismissed = true; saveSettings(); rerender(); };
  VA.add = () => sheet({
    title: 'Create',
    items: [
      { label: 'New project', icon: 'project', hint: 'Album, mixtape, EP', onClick: newProject },
      { label: 'Quick file', icon: 'file', hint: 'Goes to Scratchpad', onClick: quickFile },
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
    ${fis.length ? `<div class="sec-h">Files <span class="count">${fis.length}</span></div><ul class="list">${fis.map((f) => fileRow(f)).join('')}</ul>` : ''}
    ${!fos.length && !fis.length ? empty('project', 'Empty project', 'Add folders for verses, hooks or tracks — or start writing a file.') : ''}
  </div>
  <button class="fab" data-a="add" aria-label="Add">${icon('plus')}</button>`;
  VA.add = () => sheet({
    title: `Add to ${p.name}`,
    items: [
      { label: 'New file', icon: 'file', onClick: () => newFile(p.id) },
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
    ${fis.length ? `<div class="sec-h">Files <span class="count">${fis.length}</span></div><ul class="list">${fis.map((f) => fileRow(f)).join('')}</ul>` : empty('folder', 'Empty folder', 'Tap + to start a new file.')}
  </div>
  <button class="fab" data-a="add" aria-label="New file">${icon('plus')}</button>`;
  VA.add = () => newFile(fo.projectId, fo.id);
}


// =====================================================================
// SETTINGS
// =====================================================================
function openSettings() {
  const sh = sheet({
    title: 'Settings',
    html: `<div class="set-row"><div class="lbl">Theme</div><div class="seg" id="thm">${['dark', 'light', 'system'].map((t) => `<button data-t="${t}" class="${S.settings.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <label class="set-row"><div><div class="lbl">Online dictionary</div><div class="sub">Exact syllables, stresses, rhymes and associations from Datamuse. Off keeps everything on-device.</div></div><input type="checkbox" class="switch" id="onl" ${S.settings.online ? 'checked' : ''}></label>
      <button class="menu-i" id="exp">${icon('download')}<span>Export backup</span><small>${S.settings.lastBackup ? `Last: ${ago(S.settings.lastBackup)}` : 'Never backed up'}</small></button>
      <button class="menu-i" id="imp">${icon('upload')}<span>Import backup</span></button>
      <input type="file" id="impf" accept="application/json,.json" hidden>
      <p class="src">Everything stays on this device${persisted ? ', protected from automatic clearing' : ' — the browser may clear it if space runs low, so back up regularly'}. Backups hold lyrics, folders and drum patterns; takes and imported beats stay on the device. · ${syl.lexiconSize()} words in the pronunciation cache</p>
      <a class="menu-i" href="privacy.html" target="_blank" rel="noopener">${icon('file')}<span>Privacy</span><small>What stays on your device</small></a>
      <a class="menu-i" href="https://github.com/CastilloTech/FlowPad/issues/new" target="_blank" rel="noopener">${icon('pen')}<span>Send feedback</span><small>GitHub</small></a>`,
  });
  const el = sh.el;
  $('#thm', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    S.settings.theme = b.dataset.t;
    saveSettings();
    applyTheme();
    $$('#thm button', el).forEach((x) => x.classList.toggle('on', x === b));
  });
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
      if (!(await confirmBox({ title: 'Import backup?', message: `${plural(n, 'file')} will be merged into your library. Items with the same ID are replaced.`, ok: 'Import' }))) return;
      for (const s of ['projects', 'folders', 'files', 'patterns']) for (const o of data[s] || []) await db.put(s, o);
      await load();
      toast('Backup imported');
      closeAllSheets();
      go('#/');
    } catch (err) {
      toast('That file isn’t a FlowPad backup');
    }
  });
}
