/* LosSoulx FlowPad — start-up: load the library, seed a first song, then route. */
'use strict';

// =====================================================================
// BOOT
// =====================================================================
async function seedWelcome() {
  const now = Date.now();
  const p = { id: FP.uid(), name: 'My First Project', created: now, updated: now };
  const verses = { id: FP.uid(), projectId: p.id, name: 'Verses', created: now, updated: now };
  const hooks = { id: FP.uid(), projectId: p.id, name: 'Hooks', created: now, updated: now };
  const f = normFile({
    id: FP.uid(), projectId: p.id, folderId: verses.id, title: 'Late Night', created: now, updated: now, bpm: 90,
    text: '[Verse 1]\nLate night, pen tight, city lights glow\nEvery single syllable is counted in the flow\nKick on the one and the snare on the two\nEvery word I write is a window into you\n\n[Hook]\nSay it how I feel it, let the rhythm take control\nPressure make a diamond, every bar a piece of soul',
    beat: { def: 'p-boombap', bars: { 7: 'p-lofi', 8: 'p-lofi' } },
    bank: ['midnight', 'city lights', 'pressure', 'diamond'],
  });
  for (const [s, o] of [['projects', p], ['folders', verses], ['folders', hooks], ['files', f]]) await db.put(s, o);
}

async function load() {
  const kv = await db.all('kv');
  if (!kv.find((x) => x.id === 'seeded')) {
    await seedWelcome();
    await db.put('kv', { id: 'seeded' });
  }
  const [projects, folders, files, patterns] = await Promise.all(['projects', 'folders', 'files', 'patterns'].map((s) => db.all(s)));
  const st = kv.find((x) => x.id === 'settings');
  const fl = kv.find((x) => x.id === 'flows');
  S.flows = fl ? fl.list : [];
  if (st) Object.assign(S.settings, st);
  S.projects = projects;
  S.folders = folders;
  S.files = files.map(normFile);
  S.patterns = patterns;
  if (!S.patterns.length) {
    const now = Date.now();
    S.patterns = PRESETS.map((p, i) => ({
      id: p.id, name: p.name, bpm: p.bpm, order: i, created: now + i, updated: now,
      steps: Object.fromEntries(TRACKS.map((t) => [t.id, [...(p.s[t.id] || '0'.repeat(16))].map(Number)])),
    }));
    await Promise.all(S.patterns.map((p) => db.put('patterns', p)));
  }
}

syl.setCorpus(() => (S.cur ? `${S.cur.text}\n${S.cur.bank.join(' ')}` : ''));
words.setCorpus(() => S.files.map((f) => f.text).join('\n'));

(async function init() {
  try {
    await load();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="page">${empty('x', 'Storage unavailable', 'FlowPad saves to your browser’s storage (IndexedDB), which seems to be blocked — private browsing can cause this.')}</div>`;
    return;
  }
  syl.online = S.settings.online;
  audio.setLatency(S.settings.latencyMs != null ? S.settings.latencyMs / 1000 : null); // the measured headphone delay
  S.settings.opens = (S.settings.opens || 0) + 1;
  saveSettings();
  applyTheme();
  route();
  protectStorage(); // in the background: some browsers ask first
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
