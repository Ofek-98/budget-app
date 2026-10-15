// Backup file: on desktop Chrome/Edge the app writes straight to a JSON file you pick (e.g. in OneDrive);
// elsewhere it falls back to manual export / import.
(function (A) {
  const { U } = A;
  const supported = typeof window.showSaveFilePicker === 'function';
  const listeners = new Set();
  const status = { state: supported ? 'none' : 'unsupported', lastSaved: null, fileName: null, error: null };
  let handle = null;

  const setStatus = (patch) => { Object.assign(status, patch); listeners.forEach((l) => l({ ...status })); };

  // Minimal IndexedDB key-value store for the file handle (handles can't go in localStorage).
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('smart-budget-handles', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  }

  async function write() {
    if (!handle) return;
    try {
      const w = await handle.createWritable();
      await w.write(A.store.serialize());
      await w.close();
      setStatus({ state: 'ok', lastSaved: new Date().toLocaleTimeString('he-IL'), error: null });
    } catch (e) {
      setStatus({ state: 'error', error: e.message });
    }
  }

  const backup = {
    status: () => ({ ...status }),
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    supported,

    async init() {
      if (!supported) return;
      try {
        handle = await idbGet('backup');
        if (!handle) return;
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        setStatus({ fileName: handle.name, state: perm === 'granted' ? 'ok' : 'needs-permission' });
      } catch (e) { console.warn(e); }
    },

    // Pick (or create) the backup file and write the current data into it.
    async connect() {
      handle = await window.showSaveFilePicker({ suggestedName: 'smart-budget-backup.json', types: [{ description: 'גיבוי תקציב', accept: { 'application/json': ['.json'] } }] });
      await idbSet('backup', handle);
      setStatus({ fileName: handle.name });
      await write();
    },

    // Open an existing backup file, load it, and keep saving to it.
    async openExisting() {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'גיבוי תקציב', accept: { 'application/json': ['.json'] } }] });
      const text = await (await h.getFile()).text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.transactions)) throw new Error('הקובץ אינו גיבוי תקין');
      if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('לא ניתנה הרשאת כתיבה');
      handle = h;
      await idbSet('backup', handle);
      A.store.replace(data);
      setStatus({ fileName: handle.name });
      await write();
    },

    async grant() {
      if (!handle) return;
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') await write();
    },

    async disconnect() {
      handle = null;
      await idbSet('backup', null);
      setStatus({ state: 'none', fileName: null, lastSaved: null });
    },

    autoSave: U.debounce(async () => {
      if (!handle) return;
      try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { setStatus({ state: 'needs-permission' }); return; }
        await write();
      } catch (e) { setStatus({ state: 'error', error: e.message }); }
    }, 1500),

    saveNow: () => write(),

    exportFile() {
      U.download(`smart-budget-${U.today()}.json`, A.store.serialize());
    },

    async importFile(file) {
      const data = JSON.parse(await U.readFileText(file));
      if (!data || !Array.isArray(data.transactions)) throw new Error('הקובץ אינו גיבוי תקין');
      A.store.replace(data);
    },
  };

  A.backup = backup;
})(window.App);
