/* LosSoulx FlowPad — song versions: snapshots of a song you can look back at and restore.
 *
 * Saved by themselves when you finish an editing session and before big changes (laying a song
 * out to a beat, a flow over a section, words written from a take, restoring), and whenever you
 * save one with a name. Named versions are kept; the newest 40 automatic ones are.
 */
'use strict';

const KEEP_AUTO = 40;

/** What a version holds: the song's content, not where it lives in the library. */
const versionData = (f) => JSON.parse(JSON.stringify({
  title: f.title, text: f.text, sheet: f.sheet, beat: f.beat, bpm: f.bpm, swing: f.swing, target: f.target ?? null, track: f.track || null,
}));
const versionKey = (f) => JSON.stringify([f.sheet, f.beat, f.bpm, f.swing, f.track || null]);

async function versionsOf(fileId) {
  return (await db.byIndex('versions', 'fileId', fileId)).sort((a, b) => b.created - a.created);
}

/**
 * Save a version of song f. Skipped when nothing changed since the latest one. An automatic
 * "edited" snapshot within 10 minutes of the last one replaces it, so a session leaves one entry.
 * The song is copied right away, so call it *before* changing anything.
 */
async function snapshot(f, reason, name = '') {
  const data = versionData(f), key = versionKey(f), list = await versionsOf(f.id);
  const last = list[0];
  // an automatic snapshot of something already saved adds nothing (e.g. right after a restore)
  const same = !name && list.find((x) => x.key === key);
  if (same) return same;
  const v = { id: FP.uid(), fileId: f.id, created: Date.now(), reason, name, key, ...data };
  if (last && !name && !last.name && reason === 'Edited' && last.reason === 'Edited' && v.created - last.created < 10 * 60e3) v.id = last.id;
  await db.put('versions', v);
  // keep every named version, and the newest automatic ones
  const autos = list.filter((x) => !x.name && x.id !== v.id);
  for (const old of autos.slice(KEEP_AUTO - 1)) await db.del('versions', old.id);
  return v;
}

/** Put a version back: the song as it is now is saved as a version first, so this can be undone. */
async function restoreVersion(f, v) {
  await snapshot(f, 'Before restoring');
  Object.assign(f, JSON.parse(JSON.stringify({ text: v.text, sheet: v.sheet, beat: v.beat, bpm: v.bpm, swing: v.swing, target: v.target, track: v.track })));
  if (!f.track) delete f.track;
  await saveNow('files', f);
  toast(`Restored the version from ${when(v.created)}`);
  rerender();
}

/** A version as a song of its own, next to the original. */
async function copyVersion(f, v) {
  const copy = normFile(JSON.parse(JSON.stringify({ ...f, ...versionData(v), id: FP.uid(), title: `${f.title} (${when(v.created)})`, created: Date.now() })));
  S.files.push(copy);
  await saveNow('files', copy);
  toast('Copied as a new song');
  go(`#/e/${copy.id}`);
}

const when = (t) => {
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return today ? `today ${time}` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
};
const barsIn = (v) => (v.sheet || []).filter((r) => r.type === 'bar').length;
const firstWords = (v) => ((v.text || '').split('\n').find(isBar) || '').trim();

/** The list of a song's versions, newest first, with "Save this version" on top. */
async function versionsSheet(f) {
  const list = await versionsOf(f.id);
  const sh = sheet({
    title: 'Versions',
    html: `<button class="btn block" data-a="vsave">${icon('bank', 'sm')}Save this version…</button>
      ${list.length ? `<ul class="list vlist">${list.map((v, i) => `<li class="row" data-a="vopen" data-i="${i}"><span class="row-ic ${v.name ? 'accent' : ''}">${icon(v.name ? 'bank' : 'loop')}</span>
        <div class="row-main"><div class="row-t">${esc(v.name || v.reason)}</div><div class="row-s">${esc(when(v.created))} · ${plural(barsIn(v), 'bar')}${firstWords(v) ? ` · ${esc(firstWords(v))}` : ''}</div></div></li>`).join('')}</ul>`
        : '<p class="msg vnone">No versions yet. FlowPad saves one when you finish editing and before big changes — or save one yourself.</p>'}`,
    actions: {
      vsave: async () => {
        const name = await ask({ title: 'Name this version', placeholder: 'e.g. Before the second verse', ok: 'Save' });
        if (!name) return;
        sh.close();
        await snapshot(f, 'Saved', name);
        toast(`Saved “${name}”`);
      },
      vopen: (el) => versionPreview(f, list[+el.dataset.i], sh),
    },
  });
}

/** One version, read-only, with Restore and Copy as a new song. */
function versionPreview(f, v, parent) {
  const lines = (v.text || '').split('\n').map((l) => (!l.trim() ? '<div class="vgap"></div>' : isLabel(l) ? `<h3>${esc(l.trim().replace(/^\[|\]$/g, ''))}</h3>` : `<p>${esc(l)}</p>`)).join('');
  const sh = sheet({
    title: v.name || v.reason,
    html: `<p class="src vmeta">${esc(when(v.created))} · ${plural(barsIn(v), 'bar')} · ${v.bpm} BPM</p>
      <div class="vtext">${lines || '<p class="muted">Empty</p>'}</div>
      <div class="sheet-actions"><button class="btn" data-a="vcopy">Copy as new song</button><button class="btn primary" data-a="vrestore">Restore</button></div>
      <p class="src">Restoring saves the song as it is now as a version first, so you can always come back.</p>`,
    actions: {
      vrestore: async () => { sh.close(); if (parent) parent.close(); await restoreVersion(f, v); },
      vcopy: async () => { sh.close(); if (parent) parent.close(); await copyVersion(f, v); },
    },
  });
}
