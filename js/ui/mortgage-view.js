// Mortgage: live amortisation, what-if prepayment, prepay-vs-invest decision, actual vs schedule.
(function (A) {
  const { html, useState, useMemo } = htmPreact;
  const { U, M, F } = A;
  const { Tile, NumInput, TextInput, Chart, Empty, Seg } = A.ui;
  const TYPE_LABEL = { fixed: 'קבועה', variable: 'משתנה', prime: 'פריים' };
  const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5'];

  function MortgageView() {
    const [state, v] = A.store.use();
    const cfg = state.mortgage;
    const upd = (fn) => A.store.update((s) => fn(s.mortgage));

    if (!cfg || !cfg.tracks.length) {
      return html`<div class="page-head"><h1>משכנתה</h1></div><div class="card"><${Empty} title="לא הוגדרה משכנתה">
        <p>ייבאו את ה־Excel המקורי (הלשונית "משכנתה" תיטען אוטומטית) או הגדירו מסלולים ידנית.</p>
        <button class="btn primary" onClick=${() => A.store.update((s) => { s.mortgage = M.blank(); s.mortgage.tracks.push({ id: U.uid(), name: 'מסלול 1', principal: 500000, type: 'fixed', rate: 0.045, margin: 0, cpi: false, months: 360 }); })}>הגדרה ידנית</button>
      </${Empty}></div>`;
    }
    return html`<${MortgageMain} />`;
  }

  function MortgageMain() {
    const [state, v] = A.store.use();
    const cfg = state.mortgage;
    const upd = (fn) => A.store.update((s) => fn(s.mortgage));
    const sched = useMemo(() => M.compute(cfg), [v]);
    const sum = useMemo(() => M.summary(sched), [v]);
    const years = useMemo(() => {
      const g = U.groupBy(sched.rows, (r) => r.ym.slice(0, 4));
      return [...g.entries()].map(([y, rows]) => ({ y, rows, pay: U.sum(rows, (r) => r.pay), interest: U.sum(rows, (r) => r.interest), indexation: U.sum(rows, (r) => r.indexation), prepay: U.sum(rows, (r) => r.prepay), bal: rows[rows.length - 1].bal }));
    }, [v]);
    const yearPoints = years.filter((y, i) => i % 1 === 0);

    return html`
      <div class="page-head"><h1>משכנתה</h1><div class="grow"></div><span class="muted small">חישוב שפיצר חודשי לכל מסלול, כולל הצמדה ופריים משתנה</span></div>
      <div class="tiles">
        <${Tile} hero label="יתרה לסילוק היום" value=${U.money(sum.balanceNow)} foot=${'מתוך ' + U.money(U.sum(cfg.tracks, (t) => t.principal)) + ' שנלקחו'} />
        <${Tile} label=${'החזר ב' + U.monthLabel(U.thisMonth())} value=${U.money(sum.payNow)} />
        <${Tile} label="ריבית + הצמדה שנותרו" value=${U.money(sum.interestLeft + sum.indexLeft)} foot=${html`<span>ריבית ${U.money(sum.interestLeft)}</span><span>הצמדה ${U.money(sum.indexLeft)}</span>`} />
        <${Tile} label="סיום משוער" value=${sum.payoff ? U.monthLabel(sum.payoff) : '—'} foot=${'סה״כ תשלומים שנותרו ' + U.money(sum.paidLeft)} />
      </div>

      <div class="grid g2">
        <div class="card"><h2>יתרה לפי מסלול</h2>
          <${Chart} labels=${yearPoints.map((y) => y.y)} series=${cfg.tracks.map((t, k) => ({ label: t.name, color: SLOTS[k % 5], data: yearPoints.map((y) => U.round2(y.rows[y.rows.length - 1].tracks[k].bal)) }))} height=${240} />
        </div>
        <div class="card"><h2>מצב המסלולים היום</h2>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>מסלול</th><th class="n">יתרה</th><th class="n">ריבית כעת</th><th class="n">החזר</th><th class="n">ריבית+הצמדה שנותרו</th><th>סיום</th></tr></thead>
          <tbody>${sum.perTrack.map((p) => html`<tr><td>${p.track.name}</td><td class="n">${U.money(p.bal)}</td><td class="n">${U.pct(p.rate, 2)}${p.track.cpi ? ' + מדד' : ''}</td>
            <td class="n">${U.money(p.pay)}</td><td class="n">${U.money(p.interestLeft + p.indexLeft)}</td><td class="small">${p.payoff ? U.monthShort(p.payoff) : '—'}</td></tr>`)}</tbody></table></div>
        </div>
      </div>

      <div class="grid g2 mt">
        <${Simulator} cfg=${cfg} />
        <${Decision} cfg=${cfg} settings=${state.settings} />
      </div>

      <${ActualVsPlan} sched=${sched} state=${state} />

      <div class="card mt"><h2>הגדרות המשכנתה</h2>
        <div class="grid g3">
          <label class="field">תאריך תשלום ראשון<${TextInput} type="date" value=${cfg.startDate} onCommit=${(x) => upd((m) => { m.startDate = x; })} /></label>
          <label class="field">ריבית פריים נוכחית (%)<${NumInput} pct value=${latestPrime(cfg)} onCommit=${(x) => upd((m) => setPrime(m, x))} /></label>
          <label class="field">תחזית אינפלציה שנתית (%)<${NumInput} pct value=${cfg.inflation} onCommit=${(x) => upd((m) => { m.inflation = x || 0; })} /></label>
        </div>
        <h3 class="mt">מסלולים</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>שם</th><th class="n">קרן מקורית</th><th>סוג</th><th class="n">ריבית / מרווח %</th><th>צמוד מדד</th><th class="n">חודשים</th><th></th></tr></thead>
        <tbody>${cfg.tracks.map((t) => html`<tr key=${t.id}>
          <td><${TextInput} small value=${t.name} onCommit=${(x) => upd((m) => { m.tracks.find((q) => q.id === t.id).name = x; })} /></td>
          <td><${NumInput} small value=${t.principal} width="110px" onCommit=${(x) => upd((m) => { m.tracks.find((q) => q.id === t.id).principal = x || 0; })} /></td>
          <td><select class="select sm" value=${t.type} onChange=${(e) => upd((m) => { m.tracks.find((q) => q.id === t.id).type = e.target.value; })}>${Object.entries(TYPE_LABEL).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></td>
          <td>${t.type === 'prime'
            ? html`<span class="row" style="flex-wrap:nowrap;gap:4px"><span class="small muted">P</span><${NumInput} small pct value=${t.margin} width="70px" onCommit=${(x) => upd((m) => { m.tracks.find((q) => q.id === t.id).margin = x || 0; })} /></span>`
            : html`<${NumInput} small pct value=${t.rate} width="70px" onCommit=${(x) => upd((m) => { m.tracks.find((q) => q.id === t.id).rate = x || 0; })} />`}</td>
          <td><input type="checkbox" class="chk" checked=${t.cpi} onChange=${(e) => upd((m) => { m.tracks.find((q) => q.id === t.id).cpi = e.target.checked; })} /></td>
          <td><${NumInput} small value=${t.months} width="70px" onCommit=${(x) => upd((m) => { m.tracks.find((q) => q.id === t.id).months = x || 1; })} /></td>
          <td><button class="btn sm ghost danger" onClick=${() => confirm('למחוק את המסלול?') && upd((m) => { m.tracks = m.tracks.filter((q) => q.id !== t.id); })}>✕</button></td>
        </tr>`)}</tbody></table></div>
        <button class="btn sm mt" onClick=${() => upd((m) => m.tracks.push({ id: U.uid(), name: 'מסלול חדש', principal: 0, type: 'fixed', rate: 0.04, margin: 0, cpi: false, months: 360 }))}>＋ מסלול</button>

        <div class="grid g2 mt">
          <div><h3>היסטוריית פריים</h3>
            <table class="tbl"><tbody>${(cfg.primeHistory || []).map((p, i) => html`<tr><td>${U.monthLabel(p.month)}</td><td class="n">${U.pct(p.rate, 2)}</td>
              <td><button class="btn sm ghost" onClick=${() => upd((m) => { m.primeHistory.splice(i, 1); })}>✕</button></td></tr>`)}</tbody></table>
            <${AddRow} fields=${[['month', 'month', 'חודש'], ['rate', 'pct', 'ריבית %']]} onAdd=${(r) => upd((m) => { m.primeHistory = [...m.primeHistory.filter((x) => x.month !== r.month), r].sort((a, b) => a.month.localeCompare(b.month)); })} />
            <div class="small muted">פריים עתידי = הערך האחרון ברשימה. בכל שינוי של בנק ישראל מוסיפים שורה.</div>
          </div>
          <div><h3>פירעונות מוקדמים שבוצעו / מתוכננים</h3>
            <table class="tbl"><tbody>${(cfg.prepayments || []).map((p, i) => html`<tr><td>${U.monthLabel(p.month)}</td><td>${(cfg.tracks.find((t) => t.id === p.trackId) || {}).name || '?'}</td>
              <td class="n">${U.money(p.amount)}</td><td class="small">${p.mode === 'shorten' ? 'קיצור תקופה' : 'הקטנת החזר'}</td>
              <td><button class="btn sm ghost" onClick=${() => upd((m) => { m.prepayments.splice(i, 1); })}>✕</button></td></tr>`)}</tbody></table>
            <${AddRow} fields=${[['month', 'month', 'חודש'], ['trackId', 'track', 'מסלול'], ['amount', 'num', 'סכום'], ['mode', 'mode', 'אופן']]} tracks=${cfg.tracks}
              onAdd=${(r) => upd((m) => { m.prepayments.push({ id: U.uid(), ...r }); })} />
            <label class="field mt">עמלת פירעון מוקדם משוערת למסלולים קבועים (₪)<${NumInput} value=${cfg.prepayFee || 0} onCommit=${(x) => upd((m) => { m.prepayFee = x || 0; })} /></label>
          </div>
        </div>
      </div>

      <div class="card mt"><h2>לוח סילוקין</h2>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>שנה</th><th class="n">תשלומים</th><th class="n">מתוכם ריבית</th><th class="n">הצמדה</th><th class="n">פירעון מוקדם</th><th class="n">יתרה בסוף השנה</th></tr></thead>
          <tbody>${years.map((y) => html`<${YearRow} y=${y} tracks=${cfg.tracks} />`)}</tbody></table></div>
      </div>
    `;
  }

  const latestPrime = (cfg) => { const h = cfg.primeHistory || []; return h.length ? h[h.length - 1].rate : cfg.prime; };
  function setPrime(m, rate) {
    const ym = U.thisMonth();
    m.prime = rate;
    m.primeHistory = [...(m.primeHistory || []).filter((x) => x.month !== ym), { month: ym, rate }].sort((a, b) => a.month.localeCompare(b.month));
  }

  function YearRow({ y, tracks }) {
    const [open, setOpen] = useState(false);
    const now = U.thisMonth();
    return html`<tr style="cursor:pointer" onClick=${() => setOpen(!open)} class=${y.y === now.slice(0, 4) ? 'sel' : ''}>
        <td>${open ? '▾' : '▸'} ${y.y}</td><td class="n">${U.money(y.pay)}</td><td class="n">${U.money(y.interest)}</td><td class="n">${U.money(y.indexation)}</td><td class="n">${y.prepay ? U.money(y.prepay) : ''}</td><td class="n">${U.money(y.bal)}</td></tr>
      ${open && y.rows.map((r) => html`<tr class="small" style=${r.ym === now ? 'font-weight:700' : ''}><td style="padding-inline-start:26px">${U.monthLabel(r.ym)} <span class="muted">פריים ${U.pct(r.prime, 2)}</span></td>
        <td class="n">${U.money(r.pay)}</td><td class="n">${U.money(r.interest)}</td><td class="n">${U.money(r.indexation)}</td><td class="n">${r.prepay ? U.money(r.prepay) : ''}</td><td class="n">${U.money(r.bal)}</td></tr>`)}`;
  }

  function AddRow({ fields, onAdd, tracks }) {
    const init = () => Object.fromEntries(fields.map(([k, t]) => [k, t === 'month' ? U.thisMonth() : t === 'track' ? (tracks[0] || {}).id : t === 'mode' ? 'shorten' : '']));
    const [r, setR] = useState(init);
    const ok = fields.every(([k, t]) => r[k] !== '' && r[k] != null);
    return html`<div class="row" style="margin-top:6px">${fields.map(([k, t, label]) =>
      t === 'month' ? html`<input class="input sm" type="month" aria-label=${label} value=${r[k]} onInput=${(e) => setR({ ...r, [k]: e.target.value })} />` :
      t === 'track' ? html`<select class="select sm" value=${r[k]} onChange=${(e) => setR({ ...r, [k]: e.target.value })}>${tracks.map((tr) => html`<option value=${tr.id}>${tr.name}</option>`)}</select>` :
      t === 'mode' ? html`<select class="select sm" value=${r[k]} onChange=${(e) => setR({ ...r, [k]: e.target.value })}><option value="shorten">קיצור תקופה</option><option value="reduce">הקטנת החזר</option></select>` :
      html`<input class="input sm num" style="width:90px" placeholder=${label} value=${r[k]} onInput=${(e) => setR({ ...r, [k]: e.target.value })} />`)}
      <button class="btn sm" disabled=${!ok} onClick=${() => { const out = { ...r }; for (const [k, t] of fields) { if (t === 'num') out[k] = parseFloat(out[k]); if (t === 'pct') out[k] = parseFloat(out[k]) / 100; } onAdd(out); setR(init()); }}>הוספה</button></div>`;
  }

  function Simulator({ cfg }) {
    const [amount, setAmount] = useState(100000);
    const [trackId, setTrackId] = useState(cfg.tracks[0].id);
    const [month, setMonth] = useState(U.addMonths(U.thisMonth(), 1));
    const [mode, setMode] = useState('shorten');
    const r = useMemo(() => (amount > 0 ? M.simulate(cfg, { month, trackId, amount, mode }) : null), [A.store.version(), amount, trackId, month, mode]);
    return html`<div class="card"><h2>סימולטור פירעון מוקדם</h2>
      <div class="grid g2">
        <label class="field">סכום (₪)<${NumInput} value=${amount} onCommit=${(x) => setAmount(x || 0)} /></label>
        <label class="field">מסלול<select class="select" value=${trackId} onChange=${(e) => setTrackId(e.target.value)}>${cfg.tracks.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
        <label class="field">חודש<input class="input" type="month" value=${month} onInput=${(e) => setMonth(e.target.value)} /></label>
        <div class="field">אופן<${Seg} value=${mode} onChange=${setMode} options=${[['shorten', 'קיצור תקופה'], ['reduce', 'הקטנת החזר']]} /></div>
      </div>
      ${r && html`<div class="kv mt">
        <span>חיסכון נטו בתשלומים</span><span class="v">${U.money(r.saved)}</span>
        <span>ריבית + הצמדה שנחסכות</span><span class="v">${U.money(r.interestSaved)}</span>
        <span>החזר חודשי</span><span class="v">${U.money(r.payBefore)} ← ${U.money(r.payAfter)}</span>
        <span>סיום המסלול</span><span class="v">${U.monthShort(r.payoffBefore)} ← ${U.monthShort(r.payoffAfter)}${r.monthsSaved ? ` (${r.monthsSaved} ח׳ פחות)` : ''}</span>
      </div>`}
      <div class="small muted mt">לא כולל עמלת פירעון מוקדם — בדקו מול הבנק לפני ביצוע.</div>
    </div>`;
  }

  function Decision({ cfg, settings }) {
    const [amount, setAmount] = useState(100000);
    const res = useMemo(() => (amount > 0 ? M.decide(cfg, settings, amount) : []), [A.store.version(), amount]);
    const setS = (k, x) => A.store.update((s) => { s.settings[k] = x; });
    const best = res.length ? res.reduce((a, b) => (b.prepayReturn > a.prepayReturn ? b : a)) : null;
    const anyInvest = best && best.winner === 'invest';
    return html`<div class="card"><h2>לפרוע או להשקיע?</h2>
      <div class="grid g2">
        <label class="field">סכום פנוי (₪)<${NumInput} value=${amount} onCommit=${(x) => setAmount(x || 0)} /></label>
        <label class="field">תשואה שנתית צפויה (%)<${NumInput} pct value=${settings.investReturn} onCommit=${(x) => setS('investReturn', x || 0)} /></label>
        <label class="field">דמי ניהול בהשקעה (%)<${NumInput} pct value=${settings.investFee} onCommit=${(x) => setS('investFee', x || 0)} /></label>
        <label class="field">מס רווחי הון (%)<${NumInput} pct value=${settings.capGainsTax} onCommit=${(x) => setS('capGainsTax', x || 0)} /></label>
      </div>
      <label class="row small mt"><input type="checkbox" class="chk" checked=${settings.taxRealGainOnly} onChange=${(e) => setS('taxRealGainOnly', e.target.checked)} /> מס על הרווח הריאלי בלבד (מעל האינפלציה)</label>
      ${res.length > 0 && html`<div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>מסלול</th><th class="n">עלות אפקטיבית</th><th class="n">שנים</th><th class="n">שווי פירעון</th><th class="n">שווי השקעה נטו</th><th></th></tr></thead>
        <tbody>${res.map((r) => html`<tr><td>${r.track.name}</td><td class="n">${U.pct(r.effRate, 2)}</td><td class="n">${r.years.toFixed(1)}</td>
          <td class="n">${U.money(r.prepayValue)}</td><td class="n">${U.money(r.investValue)}</td>
          <td>${r.winner === 'invest' ? html`<span class="badge brand">השקעה</span>` : html`<span class="badge good">פירעון</span>`}</td></tr>`)}</tbody></table></div>
        <div class=${'callout mt ' + (anyInvest ? '' : 'good')}>
          המסלול היקר ביותר בפועל הוא <strong>${res[0].track.name}</strong> (${U.pct(res[0].effRate, 2)}${res[0].track.cpi ? ', כולל הצמדה צפויה' : ''}).
          ${best && html` פירעון בו "מחזיר" כ־<strong>${U.pct(best.prepayReturn, 1)}</strong> בשנה בלי סיכון ובלי מס, מול כ־<strong>${U.pct(best.investReturn, 1)}</strong> בשנה נטו מהשקעה (עם סיכון שוק).
            ${' '}פירעון ${U.money(best.amount)} בו חוסך ${U.money(best.saved)} בתשלומים ומקצר אותו ב־${best.monthsSaved} חודשים.`}
        </div>
        <div class="small muted mt">"שווי" = כמה הסכום שווה בסוף חיי המסלול. בפירעון: צומח בשיעור העלות האפקטיבית של המסלול. בהשקעה: אחרי דמי ניהול ומס. זו הערכה לצורך השוואה ולא ייעוץ השקעות.</div>`}
    </div>`;
  }

  function ActualVsPlan({ sched, state }) {
    const now = U.thisMonth();
    const months = sched.rows.filter((r) => r.ym <= now).slice(-6);
    if (!months.length) return null;
    const actual = (ym) => U.sum(F.monthTx(state, ym).filter((t) => t.sub === 'משכנתה'), (t) => t.amount);
    // Early repayments are usually a separate transfer, so compare only the regular monthly payment.
    const rows = months.map((r) => ({ ym: r.ym, plan: r.pay, act: actual(r.ym) }));
    if (!rows.some((r) => r.act)) return null;
    return html`<div class="card mt"><h2>תשלום בפועל מול לוח הסילוקין</h2><span class="sub small muted">לפי עסקאות בתת־קטגוריה "משכנתה"</span>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>חודש</th><th class="n">לפי הלוח</th><th class="n">בפועל</th><th class="n">פער</th></tr></thead>
      <tbody>${rows.map((r) => { const gap = r.act - r.plan; return html`<tr><td>${U.monthLabel(r.ym)}</td><td class="n">${U.money(r.plan)}</td><td class="n">${r.act ? U.money(r.act) : '—'}</td>
        <td class="n">${r.act ? html`<span class=${Math.abs(gap) < r.plan * 0.03 ? 'muted' : 'delta bad'}>${gap > 0 ? '+' : ''}${U.money(gap)}</span>` : ''}</td></tr>`; })}</tbody></table></div>
      <div class="small muted mt">פער קטן נובע לרוב מהמדד בפועל או משינוי בפריים. פער גדול שווה בדיקה מול הבנק או עדכון הפריים בהגדרות.</div>
    </div>`;
  }

  A.ui.MortgageView = MortgageView;
})(window.App);
