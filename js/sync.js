// Cloud sync through the user's own Google Drive (hidden app folder, scope drive.appdata):
// every device signs in once, changes are uploaded automatically and pulled on open / when the tab regains focus.
// Conflict rule: if only one side changed since the last sync, that side wins; if both did, the user chooses.
(function (A) {
  const { U } = A;
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE = 'smart-budget.json';
  const META_KEY = 'smart-budget.sync'; // per device: { enabled, fileId, syncedAt, remoteTime }
  const TOKEN_KEY = 'smart-budget.sync-token';
  const listeners = new Set();

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  let meta = read(META_KEY) || {};
  let tok = read(TOKEN_KEY); // { value, exp }
  let status = { state: 'off', last: null, error: null };
  let tokenClient = null;
  let pending = null; // resolver for the current token request
  let running = null;

  const clientId = () => (A.CONFIG && A.CONFIG.googleClientId) || '';
  const setStatus = (p) => { status = { ...status, ...p }; listeners.forEach((l) => l({ ...status })); };
  const saveMeta = () => write(META_KEY, meta);
  const hasData = (s) => !!(s && ((s.transactions && s.transactions.length) || (s.funds && s.funds.length) || s.mortgage));

  // ---------- Google sign-in (Google Identity Services, token model) ----------
  let gisPromise = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisPromise) gisPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { gisPromise = null; rej(new Error('לא ניתן לטעון את ההתחברות של Google (אין אינטרנט?)')); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  async function getToken(interactive) {
    if (!tok || tok.exp <= Date.now() + 60000) tok = read(TOKEN_KEY); // another tab may have signed in
    if (tok && tok.exp > Date.now() + 60000) return tok.value;
    if (!interactive) throw Object.assign(new Error('נדרשת התחברות'), { needsAuth: true });
    await loadGis();
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPE,
        callback: (r) => {
          const p = pending; pending = null;
          if (!p) return;
          if (r.error) p.rej(new Error(r.error_description || r.error));
          else { tok = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 }; write(TOKEN_KEY, tok); p.res(tok.value); }
        },
        error_callback: (e) => { const p = pending; pending = null; p && p.rej(new Error(e.type === 'popup_closed' ? 'החלון נסגר לפני סיום ההתחברות' : e.message || e.type)); },
      });
    }
    return new Promise((res, rej) => { pending = { res, rej }; tokenClient.requestAccessToken({ prompt: meta.enabled ? '' : 'consent' }); });
  }

  // ---------- Drive REST ----------
  async function api(url, opts = {}) {
    const t = await getToken(false);
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) { tok = null; write(TOKEN_KEY, null); throw Object.assign(new Error('פג תוקף ההתחברות'), { needsAuth: true }); }
    if (!r.ok) throw new Error(`Google Drive: ${r.status} ${(await r.text()).slice(0, 160)}`);
    return r;
  }
  async function findFile() {
    const q = encodeURIComponent(`name='${FILE}'`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    return (await r.json()).files[0] || null;
  }
  async function download(id) {
    return (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
  }
  async function upload(id) {
    const body = A.store.serialize();
    if (id) {
      const r = await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      return r.json();
    }
    const boundary = 'b' + U.uid();
    const metaPart = JSON.stringify({ name: FILE, parents: ['appDataFolder'] });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
    return r.json();
  }

  // ---------- sync ----------
  async function push(id) {
    const savedAt = A.store.get().savedAt;
    const r = await upload(id);
    meta = { ...meta, fileId: r.id, remoteTime: r.modifiedTime, syncedAt: savedAt };
    saveMeta();
  }
  async function pull(f, data) {
    data = data || (await download(f.id));
    if (!data || !Array.isArray(data.transactions)) throw new Error('הקובץ ב־Drive פגום');
    meta = { ...meta, fileId: f.id, remoteTime: f.modifiedTime, syncedAt: data.savedAt };
    saveMeta();
    A.store.replace(data);
  }

  async function doSync(interactive) {
    if (!clientId()) { setStatus({ state: 'unconfigured' }); return; }
    setStatus({ state: 'syncing', error: null });
    await getToken(interactive);
    const local = A.store.get();
    const f = await findFile();
    const localDirty = local.savedAt !== meta.syncedAt;
    if (!f) {
      if (hasData(local)) await push(null);
    } else {
      // A device that was never linked to this Drive file always goes through the "ask" branch below.
      const linked = meta.fileId === f.id;
      const remoteChanged = !linked || f.modifiedTime !== meta.remoteTime;
      if (linked && !remoteChanged && !localDirty) { /* in sync */ }
      else if (linked && remoteChanged && !localDirty) await pull(f);
      else if (linked && !remoteChanged && localDirty) await push(f.id);
      else {
        // First connection on this device, or both sides changed since the last sync.
        const remote = await download(f.id);
        if (!hasData(local)) await pull(f, remote);
        else if (remote.savedAt && remote.savedAt === local.savedAt) { meta = { ...meta, fileId: f.id, remoteTime: f.modifiedTime, syncedAt: local.savedAt }; saveMeta(); }
        else {
          const when = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'לא ידוע');
          const useRemote = confirm(
            'נמצאו שתי גרסאות שונות של הנתונים:\n\n' +
            `• ב־Google Drive: ${remote.transactions.length} עסקאות, עודכן ${when(remote.savedAt)}\n` +
            `• במכשיר הזה: ${local.transactions.length} עסקאות, עודכן ${when(local.savedAt)}\n\n` +
            'אישור = לטעון את הגרסה מ־Google Drive (הנתונים במכשיר הזה יוחלפו)\nביטול = להעלות את הגרסה מהמכשיר הזה ל־Drive');
          if (useRemote) await pull(f, remote); else await push(f.id);
        }
      }
    }
    meta.enabled = true; saveMeta();
    setStatus({ state: 'ok', last: new Date().toLocaleTimeString('he-IL', { timeStyle: 'short' }), error: null });
  }

  // Serialises sync runs; a needs-auth failure turns into a "tap to reconnect" state instead of an error.
  function syncNow(interactive = false) {
    if (running) return running;
    running = doSync(interactive)
      .catch((e) => { setStatus(e.needsAuth ? { state: 'needs-auth' } : { state: 'error', error: e.message }); if (interactive) throw e; })
      .finally(() => { running = null; });
    return running;
  }

  const onLocalChange = U.debounce(() => {
    if (!meta.enabled) return;
    if (A.store.get().savedAt === meta.syncedAt) return;
    syncNow(false);
  }, 2500);

  let lastFocusSync = 0;
  function onFocus() {
    if (!meta.enabled || document.visibilityState !== 'visible' || Date.now() - lastFocusSync < 30000) return;
    lastFocusSync = Date.now();
    syncNow(false);
  }

  const sync = {
    configured: () => !!clientId(),
    status: () => ({ ...status }),
    enabled: () => !!meta.enabled,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    init() {
      if (!clientId()) { setStatus({ state: 'unconfigured' }); return; }
      if (!meta.enabled) return;
      document.addEventListener('visibilitychange', onFocus);
      window.addEventListener('focus', onFocus);
      syncNow(false);
    },
    // Must be called from a click (opens Google's sign-in window).
    async connect() {
      await syncNow(true);
      document.addEventListener('visibilitychange', onFocus);
      window.addEventListener('focus', onFocus);
    },
    syncNow,
    onLocalChange,
    disconnect() {
      if (tok && window.google && google.accounts) { try { google.accounts.oauth2.revoke(tok.value); } catch (e) { /* ignore */ } }
      tok = null; write(TOKEN_KEY, null);
      meta = {}; saveMeta();
      setStatus({ state: 'off', last: null, error: null });
    },
  };

  A.sync = sync;
})(window.App);
