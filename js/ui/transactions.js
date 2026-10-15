// Transactions: list, filters, review queue, bulk edit, manual entry and data checks.
(function (A) {
  const { html, useState, useMemo } = htmPreact;
  const { U, F, CAT } = A;
  const { Modal, CatSelect, Seg, Empty } = A.ui;

  // Change a transaction's category, learn from it, and offer to apply it to similar ones.
  function categorize(id, cat, sub) {
    let target = null;
    A.store.update((s) => {
      target = s.transactions.find((t) => t.id === id);
      if (!target) return;
      A.tx.setCategory(target, cat, sub);
      target.needsReview = false;
      target.conf = 1;
      if (cat && target.desc) A.classifier.learn(s, target.desc, cat, sub);
    });
    if (!target || !cat || !target.desc) return;
    const norm = U.normDesc(target.desc);
    const similar = A.store.get().transactions.filter((t) => t.id !== id && U.normDesc(t.desc) === norm && (t.cat !== cat || t.sub !== sub) && (t.needsReview || !t.cat || !t.sub));
    if (similar.length) {
      A.toast(`ל־${similar.length} עסקאות נוספות מ"${target.desc}" יש סיווג אחר`, 'info', {
        label: 'החל על כולן',
        fn: () => A.store.update((s) => { for (const t of s.transactions) if (similar.some((x) => x.id === t.id)) { A.tx.setCategory(t, cat, sub); t.needsReview = false; } }),
      }, 9000);
    }
  }

  function TxTable({ list, compact, selected, onToggle, onToggleAll, limit = 300 }) {
    const [state] = A.store.use();
    const [edit, setEdit] = useState(null);
    const [shown, setShown] = useState(limit);
    if (!list.length) return html`<${Empty} title="אין עסקאות להצגה" />`;
    const rows = list.slice(0, shown);
    return html`<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        ${selected && html`<th><input type="checkbox" class="chk" aria-label="בחר הכל" checked=${list.length > 0 && list.every((t) => selected.has(t.id))} onChange=${(e) => onToggleAll(e.target.checked)} /></th>`}
        <th>תאריך</th><th>תיאור</th>${!compact && html`<th>אמצעי תשלום</th>`}<th>סיווג</th><th class="n">סכום</th>
      </tr></thead>
      <tbody>${rows.map((t) => html`<tr key=${t.id} class=${(t.needsReview ? 'review ' : '') + (selected && selected.has(t.id) ? 'sel' : '')}>
        ${selected && html`<td><input type="checkbox" class="chk" aria-label="בחר" checked=${selected.has(t.id)} onChange=${() => onToggle(t.id)} /></td>`}
        <td class="n" style="text-align:right">${U.fmtDate(t.date)}</td>
        <td class="desc" title=${[t.desc, t.note].filter(Boolean).join(' — ')}>
          <a href="#" onClick=${(e) => { e.preventDefault(); setEdit(t); }} style="color:inherit;text-decoration:none">${t.desc || t.note || html`<span class="muted">(ללא תיאור)</span>`}</a>
          ${t.inst && html` <span class="badge">${t.inst.n ? `${t.inst.n}/${t.inst.of}` : 'תשלומים'}</span>`}
          ${(t.tags || []).map((g) => html` <span class="badge">${g}</span>`)}
          ${t.desc && t.note && html`<div class="small muted ellipsis">${t.note}</div>`}
          ${t.needsReview && t.reason && html`<div class="small" style="color:var(--warning)">הצעה: ${t.reason}${t.conf ? ` (${Math.round(t.conf * 100)}%)` : ''}</div>`}
        </td>
        ${!compact && html`<td class="small">${t.method}${t.card ? html` <span class="muted">${t.card}</span>` : ''}
          ${state.cards[t.card] && state.cards[t.card].owner && html` <${A.ui.OwnerChip} owner=${state.cards[t.card].owner} people=${state.settings.people} />`}</td>`}
        <td><${CatSelect} small categories=${state.categories} cat=${t.cat} sub=${t.sub} onChange=${(c, s) => categorize(t.id, c, s)} />
          ${t.needsReview && t.cat && html` <button class="btn sm" title="אשר הצעה" onClick=${() => categorize(t.id, t.cat, t.sub)}>✓</button>`}</td>
        <td class=${'n' + (t.amount < 0 ? ' neg' : '')}>${U.money(t.amount, true)}</td>
      </tr>`)}</tbody></table>
      ${list.length > shown && html`<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" onClick=${() => setShown(shown + 300)}>הצג עוד (${list.length - shown})</button></div>`}
      ${edit && html`<${TxEditor} tx=${edit} onClose=${() => setEdit(null)} />`}
    </div>`;
  }

  function TxEditor({ tx, onClose }) {
    const [state] = A.store.use();
    const isNew = !tx;
    const [f, setF] = useState(() => tx ? { ...tx, abs: Math.abs(tx.amount), tagsText: (tx.tags || []).join(', ') } :
      { date: U.today(), desc: '', abs: '', flow: 'out', cat: '', sub: '', method: 'העברה בנקאית', card: '', note: '', tagsText: '' });
    const set = (k, val) => setF({ ...f, [k]: val });
    const save = () => {
      const abs = parseFloat(f.abs);
      if (!f.date || isNaN(abs)) { A.toast('יש למלא תאריך וסכום', 'error'); return; }
      A.store.update((s) => {
        let t = isNew ? A.tx.make({ date: f.date, abs, flow: f.flow, desc: f.desc, method: f.method, card: f.card, source: 'manual' }) : s.transactions.find((x) => x.id === tx.id);
        Object.assign(t, { date: f.date, desc: U.cleanText(f.desc), flow: f.flow, method: f.method, card: f.card, note: f.note, tags: f.tagsText.split(',').map((x) => x.trim()).filter(Boolean) });
        t.amount = abs;
        A.tx.setCategory(t, f.cat, f.sub);
        t.needsReview = !f.cat;
        if (isNew) s.transactions.push(t);
        if (f.cat && t.desc && (!tx || tx.cat !== f.cat || tx.sub !== f.sub)) A.classifier.learn(s, t.desc, f.cat, f.sub);
      });
      onClose();
    };
    const del = () => {
      const copy = U.clone(tx);
      A.store.update((s) => { s.transactions = s.transactions.filter((x) => x.id !== tx.id); });
      A.toast('העסקה נמחקה', 'info', { label: 'בטל', fn: () => A.store.update((s) => s.transactions.push(copy)) });
      onClose();
    };
    const methods = [...new Set(state.transactions.map((t) => t.method).filter(Boolean))];
    return html`<${Modal} title=${isNew ? 'עסקה חדשה' : 'עריכת עסקה'} onClose=${onClose} narrow>
      <div class="stack">
        <div class="row"><label class="field grow">תאריך<input class="input" type="date" value=${f.date} onInput=${(e) => set('date', e.target.value)} /></label>
          <label class="field grow">סכום (₪)<input class="input num" inputmode="decimal" value=${f.abs} onInput=${(e) => set('abs', e.target.value)} /></label></div>
        <div class="field">סוג<${Seg} value=${f.flow} onChange=${(x) => set('flow', x)} options=${[['out', 'חיוב / הוצאה'], ['in', 'זיכוי / כסף נכנס']]} /></div>
        <label class="field">תיאור / בית עסק<input class="input" value=${f.desc} onInput=${(e) => set('desc', e.target.value)} /></label>
        <div class="field">סיווג<${CatSelect} categories=${state.categories} cat=${f.cat} sub=${f.sub} onChange=${(c, s) => setF({ ...f, cat: c, sub: s })} /></div>
        ${f.flow === 'in' && f.cat && CAT.kindOf(f.cat) === 'expense' && html`<div class="callout small">זיכוי בקטגוריית הוצאה ייספר כהחזר ויקטין את ההוצאה בקטגוריה (לא ייספר כהכנסה).</div>`}
        <div class="row"><label class="field grow">אמצעי תשלום<input class="input" list="methods" value=${f.method} onInput=${(e) => set('method', e.target.value)} />
          <datalist id="methods">${methods.map((m) => html`<option value=${m} />`)}</datalist></label>
          <label class="field" style="width:90px">כרטיס<input class="input" value=${f.card} onInput=${(e) => set('card', e.target.value)} /></label></div>
        <label class="field">הערות<input class="input" value=${f.note} onInput=${(e) => set('note', e.target.value)} /></label>
        <label class="field">תגיות (מופרדות בפסיק)<input class="input" value=${f.tagsText} placeholder="למשל: תאילנד, חד-פעמי" onInput=${(e) => set('tagsText', e.target.value)} /></label>
        <div class="row">${!isNew && html`<button class="btn danger" onClick=${del}>מחיקה</button>`}<div class="grow"></div>
          <button class="btn" onClick=${onClose}>ביטול</button><button class="btn primary" onClick=${save}>שמירה</button></div>
      </div></${Modal}>`;
  }

  function Checks() {
    const [state] = A.store.use();
    const issues = F.dataChecks(state);
    const dismiss = (id) => A.store.update((s) => { s.dismissedChecks = [...(s.dismissedChecks || []), id]; });
    const remove = (t) => {
      const copy = U.clone(t);
      A.store.update((s) => { s.transactions = s.transactions.filter((x) => x.id !== t.id); });
      A.toast('העסקה נמחקה', 'info', { label: 'בטל', fn: () => A.store.update((s) => s.transactions.push(copy)) });
    };
    if (!issues.length) return html`<${Empty} title="לא נמצאו בעיות">לא זוהו כפילויות או סכומים מלאים שנרשמו לצד תשלומים.</${Empty}>`;
    return html`<div class="stack">${issues.map((i) => html`<div class="card" key=${i.id}>
      <div class="card-head"><h3>${i.title}</h3><div class="grow"></div><button class="btn sm" onClick=${() => dismiss(i.id)}>זה תקין, התעלם</button></div>
      <table class="tbl"><tbody>${i.txs.map((t) => html`<tr><td class="n" style="text-align:right">${U.fmtDate(t.date)}</td><td>${t.desc}</td><td class="small muted">${t.cat} / ${t.sub}</td>
        <td class="n">${U.money(t.amount, true)}</td><td><button class="btn sm danger" onClick=${() => remove(t)}>מחק עסקה זו</button></td></tr>`)}</tbody></table>
    </div>`)}</div>`;
  }

  function Transactions({ nav }) {
    const [state, v] = A.store.use();
    // Filters can arrive from other screens (clicking a summary number) via nav.
    const [q, setQ] = useState(nav.q || '');
    const [f, setF] = useState(() => ({ period: nav.month || nav.year || '', cat: nav.cat || '', sub: nav.sub || '', kind: nav.kind || '', method: nav.method || '', owner: nav.owner || '' }));
    const { period, cat, sub, kind, method, owner } = f;
    const [status, setStatus] = useState(nav.filter || 'all');
    const [selected, setSelected] = useState(new Set());
    const [bulk, setBulk] = useState({ cat: '', sub: '' });
    const [adding, setAdding] = useState(false);

    const months = F.months(state);
    const methods = useMemo(() => [...new Set(state.transactions.map((t) => t.method).filter(Boolean))], [v]);
    const reviewCount = state.transactions.filter((t) => t.needsReview).length;
    const checkCount = F.dataChecks(state).length;

    const people = state.settings.people || [];
    const ownerOf = (t) => (state.cards[t.card] && state.cards[t.card].owner) || (t.tags || []).find((g) => people.includes(g)) || '';
    const kindOf = (t) => (t.cat ? CAT.kindOf(t.cat) : t.flow === 'in' ? '' : 'expense');
    const years = [...new Set(months.map((m) => m.slice(0, 4)))].reverse();

    const list = useMemo(() => {
      const nq = q.trim().toLowerCase();
      return state.transactions.filter((t) => {
        if (status === 'review' && !t.needsReview) return false;
        if (status === 'uncat' && t.cat && t.sub) return false;
        if (period && !t.date.startsWith(period)) return false;
        if (cat && (cat === F.UNCAT ? t.cat : t.cat !== cat)) return false;
        if (sub && (t.sub || 'לא קוטלג') !== sub) return false;
        if (kind && kindOf(t) !== kind) return false;
        if (method && t.method !== method) return false;
        if (owner && ownerOf(t) !== owner) return false;
        if (nq && !(`${t.desc} ${t.note} ${t.sub} ${(t.tags || []).join(' ')} ${Math.abs(t.amount)}`.toLowerCase().includes(nq))) return false;
        return true;
      }).sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
    }, [v, q, f, status]);
    const filtered = q || Object.values(f).some(Boolean);

    const total = U.sum(list, (t) => t.amount);
    const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
    const toggleAll = (on) => setSelected(on ? new Set(list.map((t) => t.id)) : new Set());
    const applyBulk = () => {
      if (!bulk.cat) return;
      A.store.update((s) => { for (const t of s.transactions) if (selected.has(t.id)) { A.tx.setCategory(t, bulk.cat, bulk.sub); t.needsReview = false; if (t.desc) A.classifier.learn(s, t.desc, bulk.cat, bulk.sub); } });
      A.toast(`${selected.size} עסקאות סווגו`);
      setSelected(new Set());
    };
    const approveSuggestions = () => {
      let n = 0;
      A.store.update((s) => { for (const t of s.transactions) if (t.needsReview && t.cat && list.some((x) => x.id === t.id)) { t.needsReview = false; n++; } });
      A.toast(`${n} הצעות אושרו`);
    };
    const deleteSelected = () => {
      if (!confirm(`למחוק ${selected.size} עסקאות?`)) return;
      const removed = state.transactions.filter((t) => selected.has(t.id)).map(U.clone);
      A.store.update((s) => { s.transactions = s.transactions.filter((t) => !selected.has(t.id)); });
      A.toast(`${removed.length} עסקאות נמחקו`, 'info', { label: 'בטל', fn: () => A.store.update((s) => s.transactions.push(...removed)) });
      setSelected(new Set());
    };

    return html`
      <div class="page-head"><h1>עסקאות</h1><div class="grow"></div>
        <button class="btn" onClick=${() => setAdding(true)}>＋ עסקה ידנית</button></div>

      <div class="row" style="margin-bottom:12px">
        <${Seg} value=${status} onChange=${(x) => { setStatus(x); setSelected(new Set()); }} options=${[
          ['all', 'הכל'], ['review', html`לבדיקה ${reviewCount ? html`<span class="badge count">${reviewCount}</span>` : ''}`],
          ['uncat', 'חסר סיווג'], ['checks', html`בדיקות נתונים ${checkCount ? html`<span class="badge warn">${checkCount}</span>` : ''}`]]} />
      </div>

      ${status === 'checks' ? html`<${Checks} />` : html`
      <div class="card">
        <div class="row" style="margin-bottom:8px">
          <input class="input grow" style="min-width:180px" placeholder="חיפוש בית עסק, הערה או סכום…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        </div>
        <div class="filterbar">
          <select class="select sm" aria-label="תקופה" value=${period} onChange=${(e) => setF({ ...f, period: e.target.value })}><option value="">כל התקופות</option>
            ${years.map((y) => html`<option value=${y}>שנת ${y}</option>`)}${[...months].reverse().map((m) => html`<option value=${m}>${U.monthLabel(m)}</option>`)}</select>
          <select class="select sm" aria-label="סוג" value=${kind} onChange=${(e) => setF({ ...f, kind: e.target.value })}><option value="">הכנסות והוצאות</option>
            <option value="income">הכנסות בלבד</option><option value="expense">הוצאות בלבד</option><option value="saving">חיסכון והשקעה</option><option value="transfer">העברות פנימיות</option></select>
          <select class=${'select sm' + (cat ? ' cat-sel' : '')} style=${cat ? '--cat:' + CAT.colorOf(cat) : ''} aria-label="קטגוריה" value=${cat} onChange=${(e) => setF({ ...f, cat: e.target.value, sub: '' })}><option value="">כל הקטגוריות</option>${Object.keys(state.categories).map((c) => html`<option value=${c}>${c}</option>`)}<option value=${F.UNCAT}>${F.UNCAT}</option></select>
          ${cat && state.categories[cat] && html`<select class="select sm" aria-label="תת־קטגוריה" value=${sub} onChange=${(e) => setF({ ...f, sub: e.target.value })}><option value="">כל התתי־קטגוריות</option>${[...state.categories[cat], 'לא קוטלג'].map((s) => html`<option value=${s}>${s}</option>`)}</select>`}
          <select class="select sm" aria-label="אמצעי תשלום" value=${method} onChange=${(e) => setF({ ...f, method: e.target.value })}><option value="">כל אמצעי התשלום</option>${methods.map((m) => html`<option value=${m}>${m}</option>`)}</select>
          ${people.length > 0 && Object.keys(state.cards).length > 0 && html`<select class="select sm" aria-label="בעלים" value=${owner} onChange=${(e) => setF({ ...f, owner: e.target.value })}><option value="">כל בני הבית</option>${people.map((p) => html`<option value=${p}>${p}</option>`)}</select>`}
          ${filtered && html`<button class="btn sm ghost" onClick=${() => { setF({ period: '', cat: '', sub: '', kind: '', method: '', owner: '' }); setQ(''); }}>ניקוי סינון</button>`}
        </div>
        <div class="row" style="margin-bottom:10px">
          <span class="badge brand">${list.length} עסקאות</span>${filtered && html`<span class="badge">סה״כ ${U.money(total)}</span>`}
          <div class="grow"></div>
          ${status === 'review' && list.some((t) => t.cat) && html`<button class="btn sm primary" onClick=${approveSuggestions}>אשר את כל ההצעות המוצגות</button>`}
        </div>
        ${selected.size > 0 && html`<div class="callout row" style="margin-bottom:10px">
          <strong>${selected.size} נבחרו</strong>
          <${CatSelect} small categories=${state.categories} cat=${bulk.cat} sub=${bulk.sub} onChange=${(c, s) => setBulk({ cat: c, sub: s })} />
          <button class="btn sm primary" disabled=${!bulk.cat} onClick=${applyBulk}>סווג</button>
          <div class="grow"></div>
          <button class="btn sm danger" onClick=${deleteSelected}>מחיקה</button>
          <button class="btn sm ghost" onClick=${() => setSelected(new Set())}>ביטול בחירה</button>
        </div>`}
        <${TxTable} list=${list} selected=${selected} onToggle=${toggle} onToggleAll=${toggleAll} />
      </div>`}
      ${adding && html`<${TxEditor} tx=${null} onClose=${() => setAdding(false)} />`}
    `;
  }

  A.ui.TxTable = TxTable;
  A.ui.TxEditor = TxEditor;
  A.ui.Transactions = Transactions;
  A.categorize = categorize;
})(window.App);
