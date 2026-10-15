// Import screen: drop card/bank exports (or the original workbook), preview, de-duplicate, classify, commit.
(function (A) {
  const { html, useState, useRef } = htmPreact;
  const { U } = A;
  const P = A.parsers;
  const { CatSelect, Empty } = A.ui;

  const FORMAT_LABEL = { isracard: 'ישראכרט / אמריקן', max: 'MAX', generic: 'דף בנק / קובץ כללי', master: 'קובץ ה־Excel המקורי' };

  // Turns parsed rows into transactions, marks duplicates and classifies the new ones.
  function prepare(raw, state) {
    const cands = raw.map((r) => {
      const t = A.tx.make(r);
      t.dupOf = null;
      t.include = true;
      t.forceReview = r.forceReview;
      return t;
    });
    P.markDuplicates(cands.map((c) => Object.assign(c, { abs: Math.abs(c.amount) })), state.transactions);
    const fresh = cands.filter((c) => !c.dupOf);
    A.classifier.apply(fresh, state);
    for (const c of cands) {
      c.include = !c.dupOf;
      if (c.forceReview) c.needsReview = true;
      const owner = state.cards[c.card] && state.cards[c.card].owner;
      if (owner && !c.tags.includes(owner)) c.tags.push(owner);
    }
    return cands;
  }

  function Importer({ go }) {
    const [state] = A.store.use();
    const [batches, setBatches] = useState([]); // { file, format, items, mapping?, rows?, balance? }
    const [master, setMaster] = useState(null);
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);

    async function handleFiles(files) {
      setBusy(true);
      const next = [];
      for (const file of files) {
        try {
          if (/\.json$/i.test(file.name)) {
            if (confirm('לטעון קובץ גיבוי? הנתונים הנוכחיים יוחלפו.')) { await A.backup.importFile(file); A.toast('הגיבוי נטען'); }
            continue;
          }
          const buf = await U.readFileBuffer(file);
          const wb = P.readWorkbook(buf);
          const format = P.detect(wb);
          if (format === 'master') { setMaster({ file: file.name, data: P.parseMaster(wb) }); continue; }
          if (format === 'generic') {
            const rows = P.genericRows(wb);
            const guess = P.guessMapping(rows);
            const sig = P.signature(rows, guess.map.headerRow);
            const saved = A.store.get().importProfiles[sig];
            next.push({ id: U.uid(), file: file.name, format, rows, mapping: saved ? { ...saved } : guess.map, mappingConfirmed: !!saved, items: null });
            continue;
          }
          const raw = format === 'isracard' ? P.parseIsracard(wb) : P.parseMax(wb);
          next.push({ id: U.uid(), file: file.name, format, items: prepare(raw, A.store.get()) });
        } catch (e) {
          console.error(e);
          A.toast(`שגיאה בקריאת ${file.name}: ${e.message}`, 'error', null, 8000);
        }
      }
      setBatches((b) => [...b, ...next]);
      setBusy(false);
    }
    A.importFiles = handleFiles; // used by tests / drag-drop on other screens

    const updateBatch = (id, patch) => setBatches((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));

    function confirmMapping(b) {
      const sig = P.signature(b.rows, b.mapping.headerRow);
      const res = P.parseGeneric(b.rows, b.mapping);
      A.store.update((s) => { s.importProfiles[sig] = { ...b.mapping }; });
      updateBatch(b.id, { mappingConfirmed: true, items: prepare(res.list, A.store.get()), balance: res.balance, balanceDate: res.balanceDate });
    }

    function commit() {
      const items = batches.flatMap((b) => (b.items || []).filter((t) => t.include));
      const balances = batches.filter((b) => b.balance != null);
      A.store.update((s) => {
        for (const t of items) {
          const clean = { ...t };
          if (clean.learnIt && clean.cat && clean.desc) A.classifier.learn(s, clean.desc, clean.cat, clean.sub);
          delete clean.include; delete clean.dupOf; delete clean.forceReview; delete clean.abs; delete clean.learnIt;
          s.transactions.push(clean);
        }
        for (const b of balances) {
          let acc = s.assets.find((a) => a.source === 'bank');
          if (!acc) { acc = { id: U.uid(), name: 'חשבון עו״ש', type: 'מזומן ועו״ש', value: 0, source: 'bank' }; s.assets.push(acc); }
          acc.value = b.balance; acc.updated = b.balanceDate;
        }
        s.importLog.unshift({ date: U.today(), files: batches.map((b) => b.file), count: items.length });
        s.importLog = s.importLog.slice(0, 50);
      });
      const review = items.filter((t) => t.needsReview).length;
      A.toast(`יובאו ${items.length} עסקאות${review ? ` · ${review} ממתינות לבדיקה` : ''}`, 'info', review ? { label: 'לבדיקה', fn: () => go('transactions', { filter: 'review' }) } : null, 8000);
      setBatches([]);
    }

    function commitMaster(replace) {
      const d = master.data;
      A.store.update((s) => {
        if (replace) s.transactions = [];
        const existing = new Set(s.transactions.map((t) => t.date + '|' + t.amount + '|' + U.normDesc(t.desc)));
        for (const t of d.transactions) if (!existing.has(t.date + '|' + t.amount + '|' + U.normDesc(t.desc))) s.transactions.push(t);
        if (d.funds.length && (replace || !s.funds.length)) s.funds = d.funds;
        if (d.insurances.length && (replace || !s.insurances.length)) s.insurances = d.insurances;
        if (d.mortgage && (replace || !s.mortgage)) s.mortgage = d.mortgage;
        for (const [cat, subs] of Object.entries(d.categories || {})) {
          if (!s.categories[cat]) s.categories[cat] = [];
          const list = s.categories[cat];
          for (const sub of subs) {
            if (list.includes(sub)) continue;
            const other = list.indexOf('אחר'); // keep "אחר" last
            list.splice(other >= 0 ? other : list.length, 0, sub);
          }
        }
        for (const p of d.people || []) if (!s.settings.people.includes(p)) s.settings.people.push(p);
      });
      A.toast(`נטענו ${d.transactions.length} עסקאות, ${d.funds.length} קופות, ${d.insurances.length} ביטוחים${d.mortgage ? ' ומשכנתה' : ''}`, 'info', null, 7000);
      setMaster(null);
      go('dashboard');
    }

    const all = batches.flatMap((b) => b.items || []);
    const nInclude = all.filter((t) => t.include).length;
    const nDup = all.filter((t) => t.dupOf).length;
    const nReview = all.filter((t) => t.include && t.needsReview).length;

    return html`
      <div class="page-head"><h1>ייבוא נתונים</h1></div>

      <div class=${'drop' + (over ? ' over' : '')} onClick=${() => inputRef.current.click()}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); handleFiles([...e.dataTransfer.files]); }}>
        <div class="big">${busy ? 'קורא קבצים…' : 'גררו לכאן קבצי Excel או לחצו לבחירה'}</div>
        <div class="muted">ישראכרט, אמריקן אקספרס, MAX, דף חשבון בנק, קובץ ה־Excel המקורי או קובץ גיבוי (JSON)</div>
        <input ref=${inputRef} type="file" multiple accept=".xlsx,.xls,.csv,.json" style="display:none" onChange=${(e) => { handleFiles([...e.target.files]); e.target.value = ''; }} />
      </div>

      ${master && html`<div class="card mt">
        <h2>קובץ ה־Excel המקורי: ${master.file}</h2>
        <div class="kv" style="max-width:420px">
          <span>עסקאות</span><span class="v">${master.data.transactions.length}</span>
          <span>קופות וחסכונות</span><span class="v">${master.data.funds.length}</span>
          <span>ביטוחים</span><span class="v">${master.data.insurances.length}</span>
          <span>מסלולי משכנתה</span><span class="v">${master.data.mortgage ? master.data.mortgage.tracks.length : 0}</span>
        </div>
        <div class="row mt">
          <button class="btn primary" onClick=${() => commitMaster(!state.transactions.length)}>${state.transactions.length ? 'מיזוג עם הנתונים הקיימים' : 'טעינה'}</button>
          ${state.transactions.length > 0 && html`<button class="btn danger" onClick=${() => confirm('כל העסקאות הקיימות יימחקו ויוחלפו. להמשיך?') && commitMaster(true)}>החלפת כל הנתונים</button>`}
          <button class="btn ghost" onClick=${() => setMaster(null)}>ביטול</button>
        </div></div>`}

      ${batches.map((b) => html`<div class="card mt" key=${b.id}>
        <div class="card-head"><h2>${b.file}</h2><span class="badge brand">${FORMAT_LABEL[b.format]}</span>
          ${b.items && html`<span class="badge">${b.items.length} שורות</span>`}
          ${b.items && b.items.some((t) => t.dupOf) && html`<span class="badge">${b.items.filter((t) => t.dupOf).length} כבר קיימות</span>`}
          <div class="grow"></div><button class="btn sm ghost" onClick=${() => setBatches(batches.filter((x) => x.id !== b.id))}>הסר</button></div>
        ${b.format === 'generic' && !b.mappingConfirmed && html`<${MappingEditor} batch=${b} onChange=${(m) => updateBatch(b.id, { mapping: m })} onConfirm=${() => confirmMapping(b)} />`}
        ${b.items && html`<${PreviewTable} batch=${b} onChange=${(items) => updateBatch(b.id, { items })} />`}
      </div>`)}

      ${all.length > 0 && html`<div class="card mt row" style="position:sticky;bottom:12px;z-index:5">
        <strong>${nInclude} עסקאות חדשות לייבוא</strong>
        ${nDup > 0 && html`<span class="muted">${nDup} כפילויות סוננו</span>`}
        ${nReview > 0 && html`<span class="badge warn">${nReview} יסומנו לבדיקה</span>`}
        <div class="grow"></div>
        <button class="btn ghost" onClick=${() => setBatches([])}>ביטול</button>
        <button class="btn primary" disabled=${!nInclude} onClick=${commit}>ייבוא</button>
      </div>`}

      ${!batches.length && !master && html`<div class="grid g2 mt">
        <div class="card"><h2>איך זה עובד</h2>
          <ol style="margin:0;padding-inline-start:20px;line-height:1.9">
            <li>מורידים את פירוט החיובים מאתר חברת האשראי או הבנק (Excel).</li>
            <li>גוררים את כל הקבצים לכאן בבת אחת.</li>
            <li>המערכת מזהה את הפורמט, מסננת עסקאות שכבר קיימות ומסווגת לפי ההיסטוריה שלכם.</li>
            <li>עסקאות שהמערכת לא בטוחה בהן מסומנות לבדיקה. כל תיקון שלכם משפר את הסיווג הבא.</li>
          </ol></div>
        <div class="card"><h2>ייבואים אחרונים</h2>
          ${state.importLog.length ? html`<table class="tbl"><tbody>${state.importLog.slice(0, 8).map((l) => html`<tr><td class="small">${U.fmtDate(l.date)}</td><td class="small ellipsis" style="max-width:260px">${l.files.join(', ')}</td><td class="n">${l.count}</td></tr>`)}</tbody></table>`
            : html`<div class="muted">עדיין לא בוצע ייבוא</div>`}
        </div></div>`}
    `;
  }

  function PreviewTable({ batch, onChange }) {
    const [state] = A.store.use();
    const [showDup, setShowDup] = useState(false);
    const items = batch.items;
    const set = (id, patch) => onChange(items.map((t) => (t.id === id ? Object.assign(t, patch) : t)));
    const visible = items.filter((t) => showDup || !t.dupOf);
    if (!items.length) return html`<div class="muted">לא נמצאו עסקאות בקובץ</div>`;
    if (!visible.length) return html`<div class="row"><span class="badge good">✓ כל העסקאות בקובץ כבר קיימות</span>
      <button class="btn sm ghost" onClick=${() => setShowDup(true)}>הצג אותן</button></div>`;
    return html`<div>
      ${items.some((t) => t.dupOf) && html`<label class="row small" style="margin-bottom:8px"><input type="checkbox" class="chk" checked=${showDup} onChange=${(e) => setShowDup(e.target.checked)} /> הצג גם עסקאות שכבר קיימות</label>`}
      <div class="tbl-wrap" style="max-height:460px;overflow:auto"><table class="tbl">
      <thead><tr><th></th><th>תאריך</th><th>בית עסק</th><th>כרטיס</th><th>סיווג מוצע</th><th>ביטחון</th><th class="n">סכום</th></tr></thead>
      <tbody>${visible.map((t) => html`<tr key=${t.id} class=${t.dupOf ? 'dup' : t.needsReview ? 'review' : ''}>
        <td><input type="checkbox" class="chk" aria-label="כלול בייבוא" checked=${t.include} onChange=${(e) => set(t.id, { include: e.target.checked })} /></td>
        <td class="small">${U.fmtDate(t.date)}</td>
        <td class="desc" title=${t.note}>${t.desc}${t.inst && html` <span class="badge">${t.inst.n ? `${t.inst.n}/${t.inst.of}` : 'תשלומים'}</span>`}${t.dupOf && html` <span class="badge" title=${t.dupLoose ? 'נמצאה עסקה זהה שנרשמה בתאריך אחר' : ''}>${t.dupLoose ? 'קיימת (בתאריך אחר)' : 'קיימת'}</span>`}
          ${t.note && html`<div class="small muted ellipsis">${t.note}</div>`}</td>
        <td class="small">${t.method} ${t.card}</td>
        <td><${CatSelect} small categories=${state.categories} cat=${t.cat} sub=${t.sub}
          onChange=${(c, s) => { A.tx.setCategory(t, c, s); set(t.id, { needsReview: !c, conf: 1, reason: 'נבחר ידנית', learnIt: true }); }} /></td>
        <td>${t.dupOf ? '' : html`<span class=${'badge ' + (t.conf >= 0.85 ? 'good' : t.conf >= 0.7 ? 'brand' : 'warn')} title=${t.reason || ''}>${Math.round((t.conf || 0) * 100)}%</span>`}</td>
        <td class=${'n' + (t.amount < 0 ? ' neg' : '')}>${U.money(t.amount, true)}</td>
      </tr>`)}</tbody></table></div></div>`;
  }

  function MappingEditor({ batch, onChange, onConfirm }) {
    const m = batch.mapping;
    const header = (batch.rows[m.headerRow] || []).map((h, i) => [i, U.cleanText(h) || `עמודה ${i + 1}`]);
    const sel = (key, label, optional) => html`<label class="field">${label}
      <select class="select" value=${m[key] == null ? '' : m[key]} onChange=${(e) => onChange({ ...m, [key]: e.target.value === '' ? null : +e.target.value })}>
        ${optional && html`<option value="">— אין —</option>`}${header.map(([i, h]) => html`<option value=${i}>${h}</option>`)}</select></label>`;
    const sample = P.parseGeneric(batch.rows, m).list.slice(0, 5);
    return html`<div class="stack">
      <div class="callout">זה פורמט חדש. סמנו פעם אחת איזו עמודה היא מה — המערכת תזכור את זה לקבצים הבאים מאותו מקור.</div>
      <div class="grid g3">
        <label class="field">שורת הכותרות
          <select class="select" value=${m.headerRow} onChange=${(e) => onChange({ ...m, headerRow: +e.target.value })}>
            ${batch.rows.slice(0, 30).map((r, i) => html`<option value=${i}>${i + 1}: ${r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}</option>`)}</select></label>
        ${sel('date', 'תאריך')}${sel('desc', 'תיאור')}${sel('desc2', 'פרטים נוספים', true)}
        ${sel('amount', 'סכום (עמודה אחת עם +/−)', true)}${sel('debit', 'חובה (יוצא)', true)}${sel('credit', 'זכות (נכנס)', true)}
        ${sel('balance', 'יתרה', true)}${sel('ref', 'אסמכתא', true)}
      </div>
      <div><strong class="small">תצוגה מקדימה:</strong>
        <table class="tbl"><tbody>${sample.map((t) => html`<tr><td>${U.fmtDate(t.date)}</td><td>${t.desc}</td><td class="n">${t.flow === 'in' ? '+' : '−'}${U.money(t.abs, true)}</td></tr>`)}</tbody></table>
        ${!sample.length && html`<div class="muted small">לא זוהו שורות — בדקו את המיפוי</div>`}</div>
      <div class="row end"><button class="btn primary" disabled=${!sample.length} onClick=${onConfirm}>המשך</button></div>
    </div>`;
  }

  A.ui.Importer = Importer;
})(window.App);
