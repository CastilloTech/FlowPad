/* FlowPad service worker — offline app shell. Bump VERSION when files change. */
const VERSION = 'flowpad-v21';
const SHELL = [
  './', 'index.html', 'privacy.html', 'css/styles.css', 'js/db.js', 'js/syllables.js', 'js/words.js', 'js/sheet.js', 'js/structure.js', 'js/cadence.js', 'js/mix.js', 'js/mix-worker.js', 'js/audio.js', 'js/voice.js',
  'js/app/core.js', 'js/app/library.js', 'js/app/versions.js', 'js/app/editor.js', 'js/app/editor-audio.js', 'js/app/metronome.js', 'js/app/boot.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin: network first (so edits show up), falling back to cache offline.
// Cross-origin (the Datamuse dictionary) goes straight to the network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
