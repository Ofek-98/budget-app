// Pension funds, study funds, provident funds and insurance policies.
(function (A) {
  const { html, useState } = htmPreact;
  const { U, CAT } = A;
  const { Tile, Modal, NumInput, TextInput, Chart, Empty, OwnerChip, FilterBar } = A.ui;

  const FUND_TYPES = ['פנסיה', 'קרן השתלמות', 'קופת גמל להשקעה', 'קופת גמל', 'ביטוח מנהלים', 'פוליסת חיסכון', 'אחר'];
  const INS_TYPES = ['ביטוח חיים', 'ביטוח בריאות', 'ביטוח משכנתה', 'ביטוח מבנה', 'ביטוח תכולה', 'ביטוח רכב', 'ביטוח סיעודי', 'קופת חולים', 'אחר'];
  const isActive = (f) => /^פעיל/.test(f.status || '') || (/מופקד/.test(f.status || '') && !/לא/.test(f.status || ''));

  // Generic inline-editable table. Column type 'owner' renders a colour-coded owner dropdown.
  function EditTable({ rows, cols, onSet, onDelete, extra, people }) {
    return html`<div class="tbl-wrap"><table class="tbl">
      <thead><tr>${cols.map((c) => html`<th class=${c.type === 'num' || c.type === 'pct' ? 'n' : ''}>${c.label}</th>`)}${extra && html`<th></th>`}<th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.id}>
        ${cols.map((c) => html`<td>${
          c.render ? c.render(r) :
          c.type === 'owner' ? html`<select class="select sm cat-sel" style=${'--cat:' + (CAT.ownerColor(r[c.key], people) || 'transparent')} value=${r[c.key] || ''} onChange=${(e) => onSet(r.id, c.key, e.target.value)}>
              ${!c.options.includes(r[c.key]) && r[c.key] && html`<option value=${r[c.key]}>${r[c.key]}</option>`}${c.options.map((o) => html`<option value=${o}>${o}</option>`)}</select>` :
          c.type === 'select' ? html`<select class="select sm" value=${r[c.key] || ''} onChange=${(e) => onSet(r.id, c.key, e.target.value)}>
              ${!c.options.includes(r[c.key]) && r[c.key] && html`<option value=${r[c.key]}>${r[c.key]}</option>`}${c.options.map((o) => html`<option value=${o}>${o}</option>`)}</select>` :
          c.type === 'num' ? html`<${NumInput} small value=${r[c.key]} width=${c.width || '100px'} onCommit=${(x) => onSet(r.id, c.key, x || 0)} />` :
          c.type === 'pct' ? html`<${NumInput} small pct value=${r[c.key]} width="70px" onCommit=${(x) => onSet(r.id, c.key, x || 0)} />` :
          c.type === 'date' ? html`<${TextInput} small type="date" value=${r[c.key]} onCommit=${(x) => onSet(r.id, c.key, x)} />` :
          html`<${TextInput} small value=${r[c.key]} width=${c.width} onCommit=${(x) => onSet(r.id, c.key, x)} />`
        }</td>`)}
        ${extra && html`<td>${extra(r)}</td>`}
        <td><button class="btn sm ghost danger" aria-label="מחק" title="מחק" onClick=${() => confirm('למחוק את השורה?') && onDelete(r.id)}>✕</button></td>
      </tr>`)}</tbody></table></div>`;
  }

  function Funds() {
    const [state] = A.store.use();
    const [hist, setHist] = useState(null);
    const [ff, setFf] = useState({});
    const [fi, setFi] = useState({});
    const people = [...new Set([...state.settings.people, ...state.funds.map((f) => f.owner), ...state.insurances.map((i) => i.owner), 'משותף'].filter(Boolean))];
    const th = state.settings.feeAlerts;

    const funds = state.funds.filter((f) => (!ff.owner || f.owner === ff.owner) && (!ff.type || f.type === ff.type) && (!ff.status || (ff.status === 'active') === isActive(f)));
    const ins = state.insurances.filter((i) => (!fi.owner || i.owner === fi.owner) && (!fi.type || i.type === fi.type));
    const total = U.sum(funds, (f) => f.balance || 0);
    const byOwner = people.map((p) => ({ p, v: U.sum(funds.filter((f) => f.owner === p), (f) => f.balance || 0) })).filter((x) => x.v);
    const byType = FUND_TYPES.map((t) => ({ t, v: U.sum(funds.filter((f) => f.type === t), (f) => f.balance || 0) })).filter((x) => x.v);
    const annualFees = U.sum(funds, (f) => (f.balance || 0) * (f.feeAcc || 0));
    const insMonthly = U.sum(ins, (i) => i.premium || 0);

    const setFund = (id, key, val) => A.store.update((s) => {
      const f = s.funds.find((x) => x.id === id);
      if (key === 'balance' && val !== f.balance) {
        f.history = f.history || [];
        const today = U.today();
        const last = f.history[f.history.length - 1];
        if (last && last.date === today) last.balance = val; else f.history.push({ date: today, balance: val });
        f.updated = today;
      }
      f[key] = val;
    });
    const addFund = () => A.store.update((s) => s.funds.push({ id: U.uid(), owner: ff.owner || people[0], type: ff.type || 'קרן השתלמות', company: '', policyNo: '', track: '', feeAcc: 0, feeDep: 0, balance: 0, status: 'פעילה (מופקדים כספים)', updated: U.today(), notes: '', history: [] }));
    const setIns = (id, key, val) => A.store.update((s) => { s.insurances.find((x) => x.id === id)[key] = val; });
    const addIns = () => A.store.update((s) => s.insurances.push({ id: U.uid(), owner: fi.owner || people[0], type: fi.type || 'ביטוח חיים', company: '', policyNo: '', premium: 0, coverage: 0, renewal: '', notes: '' }));

    const feeFlag = (f) => {
      const t = th[f.type];
      if (!t) return null;
      const hiAcc = t.acc && f.feeAcc > t.acc, hiDep = t.dep && f.feeDep > t.dep;
      return hiAcc || hiDep ? html`<span class="badge warn" title=${`יעד: עד ${U.pct(t.acc, 2)} מצבירה${t.dep ? ', עד ' + U.pct(t.dep, 1) + ' מהפקדה' : ''}`}>⚠ דמי ניהול גבוהים</span>` : html`<span class="badge good">✓ תקין</span>`;
    };
    const toggle = (key, val) => setFf(ff[key] === val ? { ...ff, [key]: '' } : { ...ff, [key]: val });

    return html`
      <div class="page-head"><h1>קופות, חסכונות וביטוחים</h1></div>
      <div class="tiles">
        <${Tile} hero label=${ff.owner || ff.type || ff.status ? 'סך הכל (מסונן)' : 'סך הכל בקופות'} value=${U.money(total)} onClick=${() => setFf({})} title="הצג הכל"
          foot=${byOwner.map((x) => html`<span style="cursor:pointer" onClick=${(e) => { e.stopPropagation(); toggle('owner', x.p); }}>${x.p}: ${U.money(x.v)}</span>`)} />
        ${byType.slice(0, 3).map((x) => html`<${Tile} label=${x.t} value=${U.money(x.v)} foot=${U.pct(x.v / (total || 1), 0) + ' מהסך'} active=${ff.type === x.t} onClick=${() => toggle('type', x.t)} />`)}
        <${Tile} label="דמי ניהול שנתיים (מצבירה)" value=${U.money(annualFees)} foot="הערכה לפי היתרה הנוכחית" />
      </div>

      <div class="card">
        <div class="card-head"><h2>קופות וחסכונות</h2><span class="sub">עדכון יתרה נשמר בהיסטוריה</span><div class="grow"></div><button class="btn sm" onClick=${addFund}>＋ הוספה</button></div>
        <${FilterBar} value=${ff} onChange=${setFf} filters=${[
          { key: 'owner', label: 'שייכות', options: people.map((p) => [p, p]) },
          { key: 'type', label: 'סוג', options: [...new Set(state.funds.map((f) => f.type))].map((t) => [t, t]) },
          { key: 'status', label: 'סטטוס', options: [['active', 'פעילות'], ['inactive', 'לא פעילות']] },
        ]} />
        ${funds.length ? html`<${EditTable} rows=${funds} people=${people} onSet=${setFund} onDelete=${(id) => A.store.update((s) => { s.funds = s.funds.filter((f) => f.id !== id); })}
          cols=${[
            { key: 'owner', label: 'שייכות', type: 'owner', options: people },
            { key: 'type', label: 'סוג', type: 'select', options: FUND_TYPES },
            { key: 'company', label: 'חברה', width: '90px' },
            { key: 'track', label: 'מסלול', width: '150px' },
            { key: 'feeAcc', label: 'ד״נ צבירה %', type: 'pct' },
            { key: 'feeDep', label: 'ד״נ הפקדה %', type: 'pct' },
            { key: 'balance', label: 'יתרה (₪)', type: 'num' },
            { key: 'status', label: 'סטטוס', width: '150px' },
            { key: 'updated', label: 'עודכן', render: (r) => html`<span class="small muted">${U.fmtDate(r.updated)}</span>` },
            { key: 'fee', label: 'בדיקה', render: feeFlag },
            { key: 'notes', label: 'הערות', width: '160px' },
          ]}
          extra=${(r) => html`<button class="btn sm ghost" title="היסטוריית יתרות" onClick=${() => setHist(r.id)}>📈</button>`} />`
          : html`<${Empty} title=${state.funds.length ? 'אין קופות שמתאימות לסינון' : 'אין קופות'}>${!state.funds.length && 'ייבאו את ה־Excel המקורי או הוסיפו ידנית'}</${Empty}>`}
        <div class="small muted" style="margin-top:8px">יעדי דמי ניהול ניתנים לשינוי בהגדרות. ברירת מחדל: פנסיה עד ${U.pct(th['פנסיה'].acc, 2)} מצבירה ו־${U.pct(th['פנסיה'].dep, 1)} מהפקדה; קרן השתלמות וגמל עד ${U.pct(th['קרן השתלמות'].acc, 1)}.</div>
      </div>

      <${OwnerCompare} state=${state} people=${people} />

      <div class="card mt">
        <div class="card-head"><h2>ביטוחים</h2><span class="sub">${U.money(insMonthly)} בחודש · ${U.money(insMonthly * 12)} בשנה</span><div class="grow"></div><button class="btn sm" onClick=${addIns}>＋ הוספה</button></div>
        <${FilterBar} value=${fi} onChange=${setFi} filters=${[
          { key: 'owner', label: 'שייכות', options: people.map((p) => [p, p]) },
          { key: 'type', label: 'סוג', options: [...new Set(state.insurances.map((i) => i.type))].map((t) => [t, t]) },
        ]} />
        ${ins.length ? html`<${EditTable} rows=${ins} people=${people} onSet=${setIns} onDelete=${(id) => A.store.update((s) => { s.insurances = s.insurances.filter((f) => f.id !== id); })}
          cols=${[
            { key: 'owner', label: 'שייכות', type: 'owner', options: people },
            { key: 'type', label: 'סוג', type: 'select', options: INS_TYPES },
            { key: 'company', label: 'חברה', width: '90px' },
            { key: 'policyNo', label: 'מס׳ פוליסה', width: '110px' },
            { key: 'premium', label: 'פרמיה חודשית', type: 'num', width: '80px' },
            { key: 'coverage', label: 'סכום כיסוי', type: 'num', width: '110px' },
            { key: 'renewal', label: 'חידוש', type: 'date' },
            { key: 'due', label: '', render: (r) => { if (!r.renewal) return ''; const d = U.daysBetween(U.today(), r.renewal); return d < 0 ? html`<span class="badge crit">עבר</span>` : d <= 45 ? html`<span class="badge warn">בעוד ${d} ימים</span>` : ''; } },
            { key: 'notes', label: 'הערות', width: '160px' },
          ]} />` : html`<${Empty} title=${state.insurances.length ? 'אין ביטוחים שמתאימים לסינון' : 'אין ביטוחים'} />`}
      </div>
      ${hist && html`<${History} fund=${state.funds.find((f) => f.id === hist)} onClose=${() => setHist(null)} />`}
    `;
  }

  // Side-by-side comparison of each person's funds and insurance.
  function OwnerCompare({ state, people }) {
    const owners = people.filter((p) => state.funds.some((f) => f.owner === p) || state.insurances.some((i) => i.owner === p));
    if (owners.length < 2) return null;
    const fundsOf = (p) => state.funds.filter((f) => f.owner === p);
    const insOf = (p) => state.insurances.filter((i) => i.owner === p);
    const bal = (list) => U.sum(list, (f) => f.balance || 0);
    const types = [...new Set(state.funds.map((f) => f.type))];
    const wFee = (list) => { const b = bal(list); return b ? U.sum(list, (f) => (f.balance || 0) * (f.feeAcc || 0)) / b : null; };
    const rows = [
      ['סך הכל צבירה', (p) => U.money(bal(fundsOf(p))), true],
      ...types.map((t) => ['· ' + t, (p) => { const v = bal(fundsOf(p).filter((f) => f.type === t)); return v ? U.money(v) : '—'; }]),
      ['מוצרים פעילים / סה״כ', (p) => `${fundsOf(p).filter(isActive).length} / ${fundsOf(p).length}`],
      ['דמי ניהול ממוצעים מצבירה', (p) => U.pct(wFee(fundsOf(p)), 2)],
      ['עלות דמי ניהול בשנה', (p) => U.money(U.sum(fundsOf(p), (f) => (f.balance || 0) * (f.feeAcc || 0)))],
      ['פרמיות ביטוח בחודש', (p) => U.money(U.sum(insOf(p), (i) => i.premium || 0))],
      ['כיסוי ביטוח חיים', (p) => { const v = U.sum(insOf(p).filter((i) => /חיים/.test(i.type)), (i) => i.coverage || 0); return v ? U.money(v) : '—'; }],
    ];
    return html`<div class="card mt"><div class="card-head"><h2>השוואה בין בעלי החשבונות</h2></div>
      <div class="grid g2">
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${owners.map((p) => html`<th class="n"><${OwnerChip} owner=${p} people=${people} /></th>`)}</tr></thead>
          <tbody>${rows.map(([label, fn, strong]) => html`<tr><td class=${label.startsWith('·') ? 'small muted' : ''}>${strong ? html`<strong>${label}</strong>` : label}</td>${owners.map((p) => html`<td class="n">${strong ? html`<strong>${fn(p)}</strong>` : fn(p)}</td>`)}</tr>`)}</tbody></table></div>
        <div><${Chart} kind="bar" labels=${types} height=${220}
          series=${owners.map((p) => ({ label: p, color: CAT.ownerColor(p, people), data: types.map((t) => U.round2(bal(fundsOf(p).filter((f) => f.type === t)))) }))} /></div>
      </div></div>`;
  }

  function History({ fund, onClose }) {
    const [date, setDate] = useState(U.today());
    const [bal, setBal] = useState('');
    const h = [...(fund.history || [])].sort((a, b) => a.date.localeCompare(b.date));
    const add = () => {
      const v = parseFloat(bal);
      if (isNaN(v)) return;
      A.store.update((s) => { const f = s.funds.find((x) => x.id === fund.id); f.history = [...(f.history || []).filter((x) => x.date !== date), { date, balance: v }].sort((a, b) => a.date.localeCompare(b.date)); const last = f.history[f.history.length - 1]; f.balance = last.balance; f.updated = last.date; });
      setBal('');
    };
    const del = (d) => A.store.update((s) => { const f = s.funds.find((x) => x.id === fund.id); f.history = f.history.filter((x) => x.date !== d); });
    return html`<${Modal} title=${`היסטוריית יתרות — ${fund.type} ${fund.company} (${fund.owner})`} onClose=${onClose} narrow>
      ${h.length > 1 && html`<${Chart} labels=${h.map((x) => U.fmtDate(x.date))} series=${[{ label: 'יתרה', data: h.map((x) => x.balance), color: '--s1' }]} height=${180} />`}
      <table class="tbl mt"><tbody>${[...h].reverse().map((x, i, arr) => { const prev = arr[i + 1]; return html`<tr><td>${U.fmtDate(x.date)}</td><td class="n">${U.money(x.balance)}</td>
        <td class="n small">${prev ? html`<span class=${x.balance >= prev.balance ? 'delta good' : 'delta bad'}>${x.balance >= prev.balance ? '+' : ''}${U.money(x.balance - prev.balance)}</span>` : ''}</td>
        <td><button class="btn sm ghost" onClick=${() => del(x.date)}>✕</button></td></tr>`; })}</tbody></table>
      <div class="row mt"><input class="input" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} />
        <input class="input num" placeholder="יתרה" value=${bal} onInput=${(e) => setBal(e.target.value)} style="width:120px" />
        <button class="btn primary" onClick=${add}>הוספה</button></div>
    </${Modal}>`;
  }

  A.ui.Funds = Funds;
  A.ui.EditTable = EditTable;
  A.isFundActive = isActive;
})(window.App);
