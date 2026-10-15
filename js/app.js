// App shell: navigation, backup status, routing.
(function (A) {
  const { html, render, useState, useEffect } = htmPreact;
  const { ui } = A;
  A.VERSION = 5;
  A.connectSync = () => connect(); // bump together with the ?v= query in index.html

  const TABS = [
    ['dashboard', 'דשבורד', '📊', ui.Dashboard],
    ['transactions', 'עסקאות', '🧾', ui.Transactions],
    ['import', 'ייבוא', '⬆️', ui.Importer],
    ['annual', 'סיכום שנתי', '📅', ui.Annual],
    ['insights', 'תובנות ותחזית', '💡', ui.Insights],
    ['funds', 'קופות וביטוחים', '🏦', ui.Funds],
    ['mortgage', 'משכנתה', '🏠', ui.MortgageView],
    ['networth', 'שווי נקי', '💎', ui.NetWorth],
    ['settings', 'הגדרות', '⚙️', ui.Settings],
  ];

  function BackupPill({ go }) {
    const [st, setSt] = useState(A.backup.status());
    useEffect(() => A.backup.subscribe(setSt), []);
    if (st.state === 'ok') return html`<div class="backup-pill">💾 נשמר לקובץ ${st.fileName}${st.lastSaved ? html`<br />${st.lastSaved}` : ''}</div>`;
    if (st.state === 'needs-permission') return html`<div class="backup-pill">💾 הגיבוי ממתין לאישור<br /><button class="btn sm primary" onClick=${() => A.backup.grant()}>אישור</button></div>`;
    if (st.state === 'error') return html`<div class="backup-pill" style="color:var(--critical)">💾 שגיאת גיבוי<br /><button class="btn sm" onClick=${() => go('settings')}>לפרטים</button></div>`;
    return html`<div class="backup-pill">💾 הנתונים שמורים בדפדפן בלבד<br /><button class="btn sm" onClick=${() => go('settings')}>הגדרת גיבוי</button></div>`;
  }

  function useSync() {
    const [st, setSt] = useState(A.sync.status());
    useEffect(() => { setSt(A.sync.status()); return A.sync.subscribe(setSt); }, []);
    return st;
  }
  const connect = () => A.sync.connect().then(() => A.toast('מסונכרן עם Google Drive ✓')).catch((e) => A.toast(e.message, 'error', null, 8000));

  function SyncPill({ go }) {
    const st = useSync();
    if (st.state === 'unconfigured' || (st.state === 'off' && !A.sync.enabled())) return null;
    const label = { ok: '☁ מסונכרן' + (st.last ? ' · ' + st.last : ''), syncing: '☁ מסנכרן…', 'needs-auth': '☁ הסנכרון ממתין להתחברות', error: '☁ שגיאת סנכרון', off: '☁ סנכרון כבוי' }[st.state];
    return html`<div class="backup-pill" style=${st.state === 'error' ? 'color:var(--critical)' : ''}>${label}
      ${st.state === 'needs-auth' && html`<br /><button class="btn sm primary" onClick=${connect}>התחברות</button>`}
      ${st.state === 'error' && html`<br /><button class="btn sm" onClick=${() => go('settings')}>לפרטים</button>`}</div>`;
  }

  // Shown on every screen (also on phones, where there's no sidebar) when the sign-in expired.
  function SyncBanner() {
    const st = useSync();
    if (st.state !== 'needs-auth') return null;
    return html`<div class="callout row" style="margin-bottom:14px"><span>☁ כדי לסנכרן את הנתונים עם Google Drive צריך להתחבר שוב.</span><div class="grow"></div>
      <button class="btn sm primary" onClick=${connect}>התחברות</button></div>`;
  }

  function App() {
    const [state] = A.store.use();
    const initial = (location.hash || '').slice(1);
    const [tab, setTab] = useState(TABS.some((t) => t[0] === initial) ? initial : 'dashboard');
    const [nav, setNav] = useState({});
    const go = (t, params = {}) => { setTab(t); setNav({ ...params, _k: Date.now() }); location.hash = t; window.scrollTo(0, 0); };
    useEffect(() => {
      const h = () => { const t = location.hash.slice(1); if (TABS.some((x) => x[0] === t) && t !== tab) { setTab(t); setNav({}); } };
      window.addEventListener('hashchange', h);
      return () => window.removeEventListener('hashchange', h);
    }, [tab]);

    const review = state.transactions.filter((t) => t.needsReview).length;
    const Page = TABS.find((t) => t[0] === tab)[3];
    const navBtn = ([id, label, ico]) => html`<button class=${'nav-btn' + (tab === id ? ' active' : '')} aria-current=${tab === id ? 'page' : null} onClick=${() => go(id)}>
      <span class="ico" aria-hidden="true">${ico}</span><span>${label}</span>${id === 'transactions' && review > 0 && html`<span class="badge count">${review}</span>`}</button>`;

    return html`<div class="shell">
      <aside class="side">
        <div class="brand"><span class="logo">₪</span>ניהול תקציב חכם</div>
        ${TABS.map(navBtn)}
        <div class="spacer"></div>
        <${SyncPill} go=${go} />
        <${BackupPill} go=${go} />
        <div class="small muted" style="padding:6px 10px 0">גרסה ${A.VERSION}</div>
      </aside>
      <main class="main"><${SyncBanner} /><${Page} key=${tab + (nav._k || '')} go=${go} nav=${nav} /></main>
      <nav class="bottom-nav">${TABS.map(navBtn)}</nav>
      <${ui.Toasts} />
    </div>`;
  }

  function boot() {
    if (typeof htmPreact === 'undefined' || typeof XLSX === 'undefined') {
      document.getElementById('app').innerHTML = '<div class="boot">לא ניתן לטעון את הספריות. האפליקציה צריכה חיבור לאינטרנט כדי להיפתח (הנתונים עצמם נשארים אצלך).</div>';
      return;
    }
    A.backup.init();
    render(html`<${App} />`, document.getElementById('app'));
    A.sync.init();
    A.M.refreshLive(false); // Bank of Israel rate + CPI, at most once a day
  }
  boot();
})(window.App);
