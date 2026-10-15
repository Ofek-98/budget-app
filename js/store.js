// Application state: lives in localStorage, mirrored to an optional backup file (see backup.js).
(function (A) {
  const { U, CAT } = A;
  const KEY = 'smart-budget.v1';
  const listeners = new Set();
  let state = null;
  let version = 0;

  function defaults() {
    return {
      schema: 1,
      categories: U.clone(CAT.DEFAULT_CATEGORIES),
      transactions: [],
      // Merchant rules. source: 'user' (typed in settings) | 'learned' (from a manual correction).
      rules: [],
      budgets: {},
      // last 4 digits -> { owner, label }
      cards: {},
      funds: [],
      insurances: [],
      mortgage: null,
      assets: [],
      liabilities: [],
      snapshots: [],
      importProfiles: {},
      importLog: [],
      dismissedChecks: [],
      settings: {
        people: [],
        investReturn: 0.07,
        investFee: 0.005,
        capGainsTax: 0.25,
        taxRealGainOnly: true,
        reviewThreshold: 0.7,
        feeAlerts: { 'פנסיה': { acc: 0.0025, dep: 0.015 }, 'קרן השתלמות': { acc: 0.007, dep: 0 }, 'קופת גמל להשקעה': { acc: 0.007, dep: 0 } },
      },
    };
  }

  function migrate(s) {
    const d = defaults();
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    s.settings = Object.assign({}, d.settings, s.settings);
    for (const c of Object.keys(d.categories)) if (!s.categories[c]) s.categories[c] = d.categories[c];
    if (!s.savedAt) s.savedAt = new Date().toISOString(); // data from before cloud sync existed
    // Sub-categories introduced in later versions (added once; deleting them afterwards sticks).
    s.addedSubs = s.addedSubs || [];
    for (const [c, sub] of [['כללי', 'עמלות וריבית'], ['כללי', 'משיכת מזומן'], ['רכב ותחבורה', 'תחבורה ציבורית'], ['רכב ותחבורה', 'אגרות ורישוי']]) {
      const key = c + '/' + sub;
      if (s.categories[c] && !s.addedSubs.includes(key)) { if (!s.categories[c].includes(sub)) s.categories[c].splice(Math.max(0, s.categories[c].length - 1), 0, sub); s.addedSubs.push(key); }
    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaults();
    } catch (e) {
      console.error(e);
      state = defaults();
    }
  }

  const persistLocal = U.debounce(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { A.toast && A.toast('שמירה מקומית נכשלה: ' + e.message, 'error'); }
    A.backup && A.backup.autoSave();
    A.sync && A.sync.onLocalChange();
  }, 300);

  function notify() { version++; listeners.forEach((l) => l(version)); }

  // savedAt marks every local change; cloud sync compares it with the copy in Google Drive.
  const store = {
    get: () => state,
    version: () => version,
    update(fn) { fn(state); state.savedAt = new Date().toISOString(); notify(); persistLocal(); },
    replace(next) { state = migrate(next); notify(); persistLocal(); },
    reset() { state = defaults(); notify(); persistLocal(); },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    serialize: () => JSON.stringify(state, null, 1),
    defaults,
  };

  // Hook: re-renders the component on every state change; returns [state, version].
  store.use = function () {
    const { useState, useEffect } = htmPreact;
    const [v, setV] = useState(version);
    useEffect(() => store.subscribe(setV), []);
    return [state, v];
  };

  // ---- transaction helpers ----
  // Sign convention (same as the spreadsheet): within an expense/saving category a positive amount is money out
  // and a negative amount is a refund; within income a positive amount is money in.
  const signed = (abs, flow, cat) => {
    const kind = cat ? CAT.kindOf(cat) : 'expense';
    if (kind === 'income') return flow === 'in' ? abs : -abs;
    return flow === 'out' ? abs : -abs;
  };

  const tx = {
    signed,
    setCategory(t, cat, sub) {
      t.cat = cat || '';
      t.sub = sub || '';
      t.amount = U.round2(signed(Math.abs(t.amount), t.flow, t.cat));
    },
    make(p) {
      const t = {
        id: U.uid(), date: p.date, amount: 0, flow: p.flow || 'out', cat: '', sub: '',
        method: p.method || '', card: p.card || '', desc: U.cleanText(p.desc), note: p.note || '',
        tags: p.tags || [], extId: p.extId || null, source: p.source || 'manual', inst: p.inst || null,
        origAmount: p.origAmount ?? null, origCurrency: p.origCurrency || '', hint: p.hint || '',
        needsReview: false, conf: null, created: U.today(),
      };
      t.amount = U.round2(signed(Math.abs(p.abs), t.flow, ''));
      if (p.cat) tx.setCategory(t, p.cat, p.sub);
      return t;
    },
  };

  load();
  A.store = store;
  A.tx = tx;
})(window.App);
