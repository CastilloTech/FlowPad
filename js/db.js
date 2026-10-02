/* FlowPad — tiny IndexedDB wrapper */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});
  const NAME = 'flowpad';
  const VERSION = 2; // 2: beats (imported audio loops)
  const STORES = ['projects', 'folders', 'files', 'patterns', 'recordings', 'kv', 'beats'];
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) {
          if (!d.objectStoreNames.contains(s)) {
            const store = d.createObjectStore(s, { keyPath: 'id' });
            if (s === 'recordings') store.createIndex('fileId', 'fileId');
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }

  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      let result;
      const req = fn(tx.objectStore(store));
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  FP.db = {
    all: (store) => run(store, 'readonly', (s) => s.getAll()).then((r) => r || []),
    get: (store, id) => run(store, 'readonly', (s) => s.get(id)),
    put: (store, obj) => run(store, 'readwrite', (s) => s.put(obj)).then(() => obj),
    del: (store, id) => run(store, 'readwrite', (s) => s.delete(id)),
    byIndex: (store, index, value) =>
      run(store, 'readonly', (s) => s.index(index).getAll(value)).then((r) => r || []),
  };

  FP.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
})();
