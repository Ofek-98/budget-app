// Settings: backup, budgets, categories, classification rules, cards, parameters.
(function (A) {
  const { html, useState, useEffect } = htmPreact;
  const { U, F, CAT } = A;
  const { NumInput, TextInput, CatSelect } = A.ui;

  function SyncCard() {
    const [st, setSt] = useState(A.sync.status());
    useEffect(() => { setSt(A.sync.status()); return A.sync.subscribe(setSt); }, []);
    const on = A.sync.enabled();
    const label = { ok: 'מסונכרן ✓', syncing: 'מסנכרן…', 'needs-auth': 'ממתין להתחברות', error: 'שגיאה', off: 'לא מחובר', unconfigured: 'עדיין לא הוגדר' }[st.state];
    return html`<div class="card"><h2>סנכרון בין מכשירים (Google Drive)</h2>
      <p class="small" style="margin-top:0">הנתונים נשמרים בתיקייה נסתרת ב־Google Drive שלך — רק האפליקציה הזו ניגשת אליה. מתחברים פעם אחת בכל מכשיר (מחשב, טלפון), ומשם כל שינוי מסתנכרן לבד.</p>
      <div class="kv" style="margin-bottom:10px"><span>מצב</span><span class="v">${label}${st.last ? ' · ' + st.last : ''}</span></div>
      ${st.state === 'unconfigured' ? html`<div class="muted small">הסנכרון עדיין לא הופעל באפליקציה.</div>` : html`<div class="row">
        ${(!on || st.state === 'needs-auth') && html`<button class="btn primary" onClick=${A.connectSync}>${on ? 'התחברות מחדש' : 'התחברות עם Google'}</button>`}
        ${on && st.state !== 'needs-auth' && html`<button class="btn" disabled=${st.state === 'syncing'} onClick=${() => A.sync.syncNow(true).then(() => A.toast('סונכרן')).catch((e) => A.toast(e.message, 'error'))}>סנכרון עכשיו</button>`}
        ${on && html`<button class="btn ghost" onClick=${() => confirm('לנתק את המכשיר הזה מהסנכרון? הנתונים יישארו גם כאן וגם ב־Drive.') && A.sync.disconnect()}>ניתוק המכשיר</button>`}
      </div>`}
      ${st.error && html`<div class="small" style="color:var(--critical);margin-top:6px">${st.error}</div>`}
      <div class="small muted mt">טיפ: חברו קודם את המכשיר שבו כבר יש נתונים (המחשב), ורק אחר כך את הטלפון — הטלפון ימשוך אותם.</div>
    </div>`;
  }

  function BackupCard() {
    const [st, setSt] = useState(A.backup.status());
    useEffect(() => A.backup.subscribe(setSt), []);
    const run = (fn) => async () => { try { await fn(); } catch (e) { if (e.name !== 'AbortError') A.toast(e.message, 'error'); } };
    return html`<div class="card"><h2>גיבוי וסנכרון</h2>
      ${A.backup.supported ? html`
        <p class="small" style="margin-top:0">בחרו מיקום לקובץ גיבוי (למשל בתיקיית האפליקציה, או בענן פרטי — לא של העבודה). האפליקציה תשמור אליו אוטומטית בכל שינוי.</p>
        <div class="kv" style="margin-bottom:10px"><span>קובץ</span><span class="v">${st.fileName || '—'}</span><span>מצב</span><span class="v">${{ ok: 'מחובר ✓', none: 'לא מחובר', 'needs-permission': 'דרוש אישור גישה', error: 'שגיאה', unsupported: 'לא נתמך' }[st.state]}${st.lastSaved ? ' · נשמר ' + st.lastSaved : ''}</span></div>
        <div class="row">
          ${st.state === 'needs-permission' && html`<button class="btn primary" onClick=${run(A.backup.grant)}>אישור גישה לקובץ</button>`}
          <button class="btn" onClick=${run(A.backup.connect)}>${st.fileName ? 'החלפת קובץ' : 'יצירת קובץ גיבוי'}</button>
          <button class="btn" onClick=${run(A.backup.openExisting)}>פתיחת גיבוי קיים</button>
          ${st.fileName && html`<button class="btn ghost" onClick=${run(A.backup.disconnect)}>ניתוק</button>`}
        </div>` : html`<p class="small" style="margin-top:0">בדפדפן הזה אין שמירה אוטומטית לקובץ. השתמשו בייצוא/ייבוא ידני.</p>`}
      <hr class="sep" />
      <div class="row">
        <button class="btn" onClick=${() => A.backup.exportFile()}>הורדת קובץ גיבוי</button>
        <label class="btn">טעינת קובץ גיבוי<input type="file" accept=".json" style="display:none" onChange=${async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f && confirm('הנתונים הנוכחיים יוחלפו בנתוני הגיבוי. להמשיך?')) run(() => A.backup.importFile(f))(); }} /></label>
      </div>
      ${st.error && html`<div class="small" style="color:var(--critical);margin-top:6px">${st.error}</div>`}
    </div>`;
  }

  function Budgets() {
    const [state] = A.store.use();
    const months = F.months(state).filter((m) => m < U.thisMonth()).slice(-3);
    const avg = F.averageOf(state, months);
    const cats = F.expenseCats(state);
    const suggest = () => A.store.update((s) => { for (const c of cats) { const a = avg && avg.byCat[c]; if (a > 0) s.budgets[c] = Math.ceil(a / 50) * 50; } });
    const total = U.sum(cats, (c) => state.budgets[c] || 0);
    return html`<div class="card" id="budgets">
      <div class="card-head"><h2>תקציב חודשי לפי קטגוריה</h2><span class="sub">סה״כ ${U.money(total)}</span><div class="grow"></div>
        <button class="btn sm" disabled=${!avg} onClick=${suggest}>הצעה לפי ממוצע ${months.length} החודשים האחרונים</button></div>
      <table class="tbl"><thead><tr><th>קטגוריה</th><th class="n">ממוצע</th><th class="n">תקציב</th></tr></thead>
      <tbody>${cats.map((c) => html`<tr><td>${c}</td><td class="n muted">${avg && avg.byCat[c] ? U.money(avg.byCat[c]) : '—'}</td>
        <td class="n"><${NumInput} small width="100px" value=${state.budgets[c] || ''} placeholder="ללא" onCommit=${(x) => A.store.update((s) => { if (x) s.budgets[c] = x; else delete s.budgets[c]; })} /></td></tr>`)}</tbody></table>
    </div>`;
  }

  function Categories() {
    const [state] = A.store.use();
    const [newCat, setNewCat] = useState('');
    const usage = (cat, sub) => state.transactions.filter((t) => t.cat === cat && (sub == null || t.sub === sub)).length;
    const addSub = (cat) => { const n = prompt('שם תת־קטגוריה חדשה ב' + cat); if (n && n.trim()) A.store.update((s) => { if (!s.categories[cat].includes(n.trim())) s.categories[cat].push(n.trim()); }); };
    const removeSub = (cat, sub) => {
      const n = usage(cat, sub);
      if (!confirm(n ? `${n} עסקאות מסווגות ל"${sub}". הן יישארו ב"${cat}" ללא תת־קטגוריה. להמשיך?` : `למחוק את "${sub}"?`)) return;
      A.store.update((s) => { s.categories[cat] = s.categories[cat].filter((x) => x !== sub); for (const t of s.transactions) if (t.cat === cat && t.sub === sub) t.sub = ''; });
    };
    const renameCat = (cat) => {
      const n = prompt('שם חדש לקטגוריה', cat);
      if (!n || !n.trim() || n === cat || CAT.kindOf(cat) !== 'expense') return;
      A.store.update((s) => {
        const entries = Object.entries(s.categories).map(([k, val]) => (k === cat ? [n.trim(), val] : [k, val]));
        s.categories = Object.fromEntries(entries);
        for (const t of s.transactions) if (t.cat === cat) t.cat = n.trim();
        for (const r of s.rules) if (r.cat === cat) r.cat = n.trim();
        if (s.budgets[cat] != null) { s.budgets[n.trim()] = s.budgets[cat]; delete s.budgets[cat]; }
      });
    };
    const removeCat = (cat) => {
      const n = usage(cat);
      if (n) { A.toast(`לא ניתן למחוק — ${n} עסקאות מסווגות ל"${cat}". סווגו אותן מחדש קודם.`, 'error'); return; }
      if (confirm(`למחוק את הקטגוריה "${cat}"?`)) A.store.update((s) => { delete s.categories[cat]; delete s.budgets[cat]; });
    };
    return html`<div class="card"><h2>קטגוריות</h2>
      <div class="stack" style="gap:8px">${Object.entries(state.categories).map(([cat, subs]) => html`<div class="row" style="align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:8px">
        <div style="width:200px;font-weight:600">${cat} ${CAT.kindOf(cat) !== 'expense' && html`<span class="badge">${{ income: 'הכנסה', saving: 'חיסכון', transfer: 'לא נספר' }[CAT.kindOf(cat)]}</span>`}</div>
        <div class="row grow" style="gap:4px">${subs.map((s) => html`<span class="badge" style="font-weight:500">${s} <button class="btn ghost sm" style="padding:0 3px" aria-label=${'מחק ' + s} onClick=${() => removeSub(cat, s)}>✕</button></span>`)}
          <button class="btn sm ghost" onClick=${() => addSub(cat)}>＋</button></div>
        ${CAT.kindOf(cat) === 'expense' && html`<button class="btn sm ghost" onClick=${() => renameCat(cat)}>שינוי שם</button><button class="btn sm ghost danger" onClick=${() => removeCat(cat)}>מחיקה</button>`}
      </div>`)}</div>
      <div class="row mt"><input class="input" placeholder="קטגוריית הוצאה חדשה" value=${newCat} onInput=${(e) => setNewCat(e.target.value)} />
        <button class="btn" disabled=${!newCat.trim()} onClick=${() => { A.store.update((s) => { if (!s.categories[newCat.trim()]) s.categories[newCat.trim()] = ['אחר']; }); setNewCat(''); }}>הוספה</button></div>
      <div class="small muted mt">"העברות פנימיות" (למשל חיוב חודשי של כרטיס אשראי בדף הבנק) לא נספרות כהוצאה — כדי לא לספור פעמיים את מה שכבר מופיע בפירוט האשראי.</div>
    </div>`;
  }

  function Rules() {
    const [state] = A.store.use();
    const [nr, setNr] = useState({ pattern: '', match: 'contains', cat: '', sub: '' });
    const [showLearned, setShowLearned] = useState(false);
    const user = state.rules.filter((r) => r.source === 'user');
    const learned = state.rules.filter((r) => r.source === 'learned');
    const rerun = () => {
      let changed = 0;
      A.store.update((s) => {
        const pending = s.transactions.filter((t) => t.needsReview || !t.cat);
        const before = pending.map((t) => t.cat + '|' + t.sub + '|' + t.needsReview);
        A.classifier.apply(pending, s);
        pending.forEach((t, i) => { if (before[i] !== t.cat + '|' + t.sub + '|' + t.needsReview) changed++; });
      });
      A.toast(`הסיווג הופעל מחדש — ${changed} עסקאות עודכנו`);
    };
    const row = (r) => html`<tr><td>${r.pattern}</td><td class="small">${r.match === 'exact' ? 'זהה' : 'מכיל'}</td><td class="small">${r.cat} / ${r.sub || '—'}</td>
      <td><button class="btn sm ghost danger" onClick=${() => A.store.update((s) => { s.rules = s.rules.filter((x) => x.id !== r.id); })}>✕</button></td></tr>`;
    return html`<div class="card"><div class="card-head"><h2>חוקי סיווג</h2><div class="grow"></div><button class="btn sm" onClick=${rerun}>הפעלת סיווג מחדש על עסקאות שממתינות</button></div>
      <p class="small muted" style="margin-top:0">המערכת לומדת לבד מכל תיקון שלכם. כאן אפשר להוסיף חוקים מפורשים שגוברים על הכל — למשל "כל מה שמכיל 'סונול' → דלק".</p>
      <div class="row" style="margin-bottom:10px">
        <input class="input" placeholder="טקסט בתיאור" value=${nr.pattern} onInput=${(e) => setNr({ ...nr, pattern: e.target.value })} />
        <select class="select" value=${nr.match} onChange=${(e) => setNr({ ...nr, match: e.target.value })}><option value="contains">מכיל</option><option value="exact">זהה בדיוק</option></select>
        <${CatSelect} categories=${state.categories} cat=${nr.cat} sub=${nr.sub} onChange=${(c, s) => setNr({ ...nr, cat: c, sub: s })} />
        <button class="btn primary" disabled=${!nr.pattern.trim() || !nr.cat} onClick=${() => { A.store.update((s) => s.rules.unshift({ id: U.uid(), ...nr, pattern: nr.pattern.trim(), source: 'user' })); setNr({ pattern: '', match: 'contains', cat: '', sub: '' }); }}>הוספה</button>
      </div>
      ${user.length ? html`<table class="tbl"><tbody>${user.map(row)}</tbody></table>` : html`<div class="muted small">אין חוקים ידניים</div>`}
      <div class="mt"><button class="btn sm ghost" onClick=${() => setShowLearned(!showLearned)}>${showLearned ? 'הסתר' : 'הצג'} ${learned.length} תיקונים שנלמדו</button></div>
      ${showLearned && html`<table class="tbl"><tbody>${learned.map(row)}</tbody></table>`}
    </div>`;
  }

  function Cards() {
    const [state] = A.store.use();
    const found = U.groupBy(state.transactions.filter((t) => t.card), (t) => t.card);
    const people = state.settings.people;
    if (!found.size) return null;
    return html`<div class="card"><h2>כרטיסים</h2><p class="small muted" style="margin-top:0">שיוך כרטיס לבעלים מוסיף תגית לכל עסקה מיובאת שלו.</p>
      <table class="tbl"><thead><tr><th>כרטיס</th><th>חברה</th><th class="n">עסקאות</th><th>בעלים</th><th>כינוי</th></tr></thead>
      <tbody>${[...found.entries()].map(([card, list]) => { const c = state.cards[card] || {}; const set = (k, v) => A.store.update((s) => { s.cards[card] = { ...(s.cards[card] || {}), [k]: v }; });
        return html`<tr><td class="n" style="text-align:right">•••• ${card}</td><td>${list[0].method}</td><td class="n">${list.length}</td>
          <td><select class="select sm" value=${c.owner || ''} onChange=${(e) => set('owner', e.target.value)}><option value="">—</option>${[...people, 'משותף'].map((p) => html`<option value=${p}>${p}</option>`)}</select></td>
          <td><${TextInput} small value=${c.label} onCommit=${(x) => set('label', x)} /></td></tr>`; })}</tbody></table></div>`;
  }

  function Params() {
    const [state] = A.store.use();
    const set = (fn) => A.store.update((s) => fn(s.settings));
    const fa = state.settings.feeAlerts;
    return html`<div class="card"><h2>פרמטרים</h2>
      <div class="grid g2">
        <label class="field">בני הבית (מופרד בפסיק)<${TextInput} value=${state.settings.people.join(', ')} onCommit=${(x) => set((s) => { s.people = x.split(',').map((p) => p.trim()).filter(Boolean); })} /></label>
        <label class="field">סף ביטחון לסיווג אוטומטי (%)<${NumInput} pct value=${state.settings.reviewThreshold} onCommit=${(x) => set((s) => { s.reviewThreshold = Math.min(1, Math.max(0, x || 0.7)); })} /></label>
      </div>
      <h3 class="mt">יעדי דמי ניהול (התראה מעליהם)</h3>
      <table class="tbl"><thead><tr><th>מוצר</th><th class="n">מצבירה %</th><th class="n">מהפקדה %</th></tr></thead>
      <tbody>${Object.entries(fa).map(([k, v]) => html`<tr><td>${k}</td>
        <td><${NumInput} small pct width="80px" value=${v.acc} onCommit=${(x) => set((s) => { s.feeAlerts[k].acc = x || 0; })} /></td>
        <td><${NumInput} small pct width="80px" value=${v.dep} onCommit=${(x) => set((s) => { s.feeAlerts[k].dep = x || 0; })} /></td></tr>`)}</tbody></table>
    </div>`;
  }

  function Settings({ nav }) {
    useEffect(() => { if (nav.section) { const el = document.getElementById(nav.section); el && el.scrollIntoView({ behavior: 'smooth' }); } }, [nav.section]);
    const reset = () => { if (confirm('למחוק את כל הנתונים מהדפדפן? מומלץ להוריד גיבוי קודם.') && confirm('בטוח? אין דרך חזרה.')) { A.store.reset(); A.toast('כל הנתונים נמחקו'); } };
    return html`
      <div class="page-head"><h1>הגדרות</h1></div>
      <div class="grid g2">
        <${SyncCard} />
        <${BackupCard} />
      </div>
      <div class="mt"><${Params} /></div>
      <div class="mt"><${Budgets} /></div>
      <div class="mt"><${Rules} /></div>
      <div class="mt"><${Categories} /></div>
      <div class="mt"><${Cards} /></div>
      <div class="card mt"><h2>אזור מסוכן</h2><button class="btn danger" onClick=${reset}>מחיקת כל הנתונים</button></div>
    `;
  }

  A.ui.Settings = Settings;
})(window.App);
