// Mortgage: live amortisation, what-if prepayment, prepay-vs-invest decision, actual vs schedule.
(function (A) {
  const { html, useState, useMemo, useEffect } = htmPreact;
  const { U, M, F } = A;
  const { Tile, NumInput, TextInput, Chart, Empty, Seg } = A.ui;
  const TYPE_LABEL = { fixed: 'קבועה', variable: 'משתנה', prime: 'פריים' };
  const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  const TRACK_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']; // same order as the balance chart

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
    const [trackFilter, setTrackFilter] = useState('');
    const [trackView, setTrackView] = useState('pay');
    const [busy, setBusy] = useState(false);
    const actuals = useMemo(() => M.actualPayments(state), [v]);
    const sched = useMemo(() => M.compute(cfg, [], actuals), [v]);
    const sum = useMemo(() => M.summary(sched), [v]);
    const years = useMemo(() => {
      const g = U.groupBy(sched.rows, (r) => r.ym.slice(0, 4));
      return [...g.entries()].map(([y, rows]) => ({ y, rows, bal: rows[rows.length - 1].bal }));
    }, [v]);
    const yearPoints = years;
    useEffect(() => { M.refreshLive(false); }, []);
    const refresh = async () => {
      setBusy(true);
      const r = await M.refreshLive(true);
      setBusy(false);
      A.toast(r && r.ok ? 'נתוני הריבית והמדד עודכנו' : 'לא הצלחתי למשוך נתונים עדכניים (צריך חיבור לאינטרנט)', r && r.ok ? 'info' : 'error');
    };
    const live = cfg.live || {};
    const scrollTo = (id) => { const el = document.getElementById(id); el && el.scrollIntoView({ behavior: 'smooth' }); };

    return html`
      <div class="page-head"><h1>משכנתה</h1><div class="grow"></div><span class="muted small">חישוב שפיצר חודשי לכל מסלול, כולל הצמדה ופריים משתנה</span></div>

      <div class="callout row" style="margin-bottom:14px">
        <span>🏦 ריבית בנק ישראל <strong>${live.boiRate != null ? live.boiRate + '%' : '—'}</strong> → פריים <strong>${U.pct(latestPrime(cfg), 2)}</strong></span>
        ${live.nextDecision && html`<span class="muted small">החלטת ריבית הבאה: ${U.fmtDate(live.nextDecision)}</span>`}
        ${live.cpiLast && html`<span>· מדד ${U.monthLabel(live.cpiLast.month)}: <strong>${live.cpiLast.pct > 0 ? '+' : ''}${live.cpiLast.pct}%</strong></span>`}
        <div class="grow"></div>
        <span class="muted small">${live.checked ? 'נבדק ' + U.fmtDate(live.checked) : 'עדיין לא נמשכו נתונים'}</span>
        <button class="btn sm" disabled=${busy} onClick=${refresh}>${busy ? 'מעדכן…' : 'רענון'}</button>
      </div>

      <div class="tiles">
        <${Tile} hero label="יתרה לסילוק היום" value=${U.money(sum.balanceNow)} foot=${'מתוך ' + U.money(U.sum(cfg.tracks, (t) => t.principal)) + ' שנלקחו'} onClick=${() => scrollTo('m-tracks')} />
        <${Tile} label=${'החזר ב' + U.monthLabel(U.thisMonth())} value=${U.money(sum.payNow)} onClick=${() => scrollTo('m-actual')} />
        <${Tile} label="ריבית + הצמדה שנותרו" value=${U.money(sum.interestLeft + sum.indexLeft)} foot=${html`<span>ריבית ${U.money(sum.interestLeft)}</span><span>הצמדה ${U.money(sum.indexLeft)}</span>`} onClick=${() => scrollTo('m-schedule')} />
        <${Tile} label="סיום משוער" value=${sum.payoff ? U.monthLabel(sum.payoff) : '—'} foot=${'סה״כ תשלומים שנותרו ' + U.money(sum.paidLeft)} onClick=${() => scrollTo('m-schedule')} />
      </div>

      <div class="grid g2">
        <div class="card"><h2>יתרה לפי מסלול</h2>
          <${Chart} labels=${yearPoints.map((y) => y.y)} series=${cfg.tracks.map((t, k) => ({ label: t.name, color: SLOTS[k % 5], data: yearPoints.map((y) => U.round2(y.rows[y.rows.length - 1].tracks[k].bal)) }))} height=${240} />
        </div>
        <div class="card" id="m-tracks"><h2>מצב המסלולים היום</h2>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>מסלול</th><th class="n">יתרה</th><th class="n">ריבית כעת</th><th class="n">החזר</th><th class="n">ריבית+הצמדה שנותרו</th><th>סיום</th></tr></thead>
          <tbody>${sum.perTrack.map((p) => html`<tr><td>${p.track.name}</td><td class="n">${U.money(p.bal)}</td><td class="n">${U.pct(p.rate, 2)}${p.track.cpi ? ' + מדד' : ''}</td>
            <td class="n">${U.money(p.pay)}</td><td class="n">${U.money(p.interestLeft + p.indexLeft)}</td><td class="small">${p.payoff ? U.monthShort(p.payoff) : '—'}</td></tr>`)}</tbody></table></div>
        </div>
      </div>

      <div class="mt"><${Simulator} cfg=${cfg} actuals=${actuals} sum=${sum} /></div>
      <div class="mt"><${Decision} cfg=${cfg} settings=${state.settings} actuals=${actuals} /></div>

      <${ActualVsPlan} sched=${sched} cfg=${cfg} />

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
              <td>${p.src === 'boi' ? html`<span class="badge good">בנק ישראל</span>` : html`<span class="badge">ידני</span>`}</td>
              <td><button class="btn sm ghost" onClick=${() => upd((m) => { m.primeHistory.splice(i, 1); })}>✕</button></td></tr>`)}</tbody></table>
            <${AddRow} fields=${[['month', 'month', 'חודש'], ['rate', 'pct', 'ריבית %']]} onAdd=${(r) => upd((m) => { m.primeHistory = [...m.primeHistory.filter((x) => x.month !== r.month), { ...r, src: 'manual' }].sort((a, b) => a.month.localeCompare(b.month)); })} />
            <div class="small muted">הפריים מתעדכן אוטומטית מבנק ישראל. שורה ידנית לחודש עתידי (למשל הורדת ריבית צפויה) משמשת לתרחיש — הפריים העתידי הוא הערך האחרון ברשימה.</div>
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

      <div class="card mt" id="m-schedule"><div class="card-head"><h2>לוח סילוקין</h2><div class="grow"></div>
          <label class="row small" style="gap:4px"><span class="muted">מסלול</span><select class="select sm" value=${trackFilter} onChange=${(e) => setTrackFilter(e.target.value)}>
            <option value="">כל המסלולים</option>${cfg.tracks.map((t, k) => html`<option value=${k}>${t.name}</option>`)}</select></label></div>
        ${trackFilter === '' && html`<div class="row small" style="margin-bottom:8px"><span class="muted">בעמודות המסלולים:</span>
          <${Seg} value=${trackView} onChange=${setTrackView} options=${[['pay', 'תשלום לכל מסלול'], ['bal', 'יתרה לכל מסלול']]} /></div>`}
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>שנה</th><th class="n">סה״כ תשלום</th>
            ${trackFilter === '' && cfg.tracks.map((t, i) => html`<th class="n"><span class="chip" style=${'--c:' + TRACK_COLORS[i % TRACK_COLORS.length]}>${t.name}</span></th>`)}
            <th class="n">מתוכם ריבית</th><th class="n">הצמדה</th><th class="n">פירעון מוקדם</th><th class="n">יתרה כוללת</th></tr></thead>
          <tbody>${years.map((y) => html`<${YearRow} key=${y.y + trackFilter} y=${y} k=${trackFilter === '' ? null : +trackFilter} nTracks=${trackFilter === '' ? cfg.tracks.length : 0} view=${trackView} />`)}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">בחודשים שעברו מוצג התשלום בפועל (✓). בחודשים הבאים: ההחזר לפי ריבית בנק ישראל והמדד${sum.extra ? `, ועוד תוספת קבועה של ${U.money(sum.extra, true)} שנלמדה מהתשלומים בפועל` : ''}.</div>
      </div>
    `;
  }

  const latestPrime = (cfg) => { const h = cfg.primeHistory || []; return h.length ? h[h.length - 1].rate : cfg.prime; };
  function setPrime(m, rate) {
    const ym = U.thisMonth();
    m.prime = rate;
    m.primeHistory = [...(m.primeHistory || []).filter((x) => x.month !== ym), { month: ym, rate, src: 'manual' }].sort((a, b) => a.month.localeCompare(b.month));
  }

  // One year of the schedule; k = track index to show a single track, null for all.
  // nTracks > 0 adds a column per track showing its payment (view 'pay') or its balance (view 'bal').
  function YearRow({ y, k, nTracks, view }) {
    const [open, setOpen] = useState(false);
    const now = U.thisMonth();
    // All tracks: past months show what was actually paid, future months include the recurring add-on.
    const pick = (r) => (k == null ? { ...r, pay: r.actual != null ? r.actual : r.pay + (r.extra || 0) } : { ...r.tracks[k], ym: r.ym, prime: r.prime, calibrated: r.calibrated });
    const rows = y.rows.map(pick);
    const t = { pay: U.sum(rows, (r) => r.pay), interest: U.sum(rows, (r) => r.interest), indexation: U.sum(rows, (r) => r.indexation), prepay: U.sum(rows, (r) => r.prepay), bal: rows[rows.length - 1].bal };
    if (k != null && !t.pay && !t.bal) return null;
    const idx = Array.from({ length: nTracks || 0 }, (_, i) => i);
    const yearTrack = (i) => (view === 'bal' ? y.rows[y.rows.length - 1].tracks[i].bal : U.sum(y.rows, (r) => r.tracks[i].pay));
    const cell = (v) => html`<td class="n">${v ? U.money(v) : '—'}</td>`;
    return html`<tr style="cursor:pointer" onClick=${() => setOpen(!open)} class=${y.y === now.slice(0, 4) ? 'sel' : ''}>
        <td>${open ? '▾' : '▸'} ${y.y}</td><td class="n"><strong>${U.money(t.pay)}</strong></td>${idx.map((i) => cell(yearTrack(i)))}
        <td class="n">${U.money(t.interest)}</td><td class="n">${U.money(t.indexation)}</td><td class="n">${t.prepay ? U.money(t.prepay) : ''}</td><td class="n">${U.money(t.bal)}</td></tr>
      ${open && y.rows.map((raw, j) => { const r = rows[j]; return html`<tr class="small" style=${r.ym === now ? 'font-weight:700' : ''}><td style="padding-inline-start:26px;white-space:nowrap">${U.monthLabel(r.ym)} <span class="muted">פריים ${U.pct(r.prime, 2)}</span>${r.calibrated ? html` <span class="badge good" title="תשלום בפועל">✓ בפועל</span>` : ''}</td>
        <td class="n">${U.money(r.pay)}</td>${idx.map((i) => cell(view === 'bal' ? raw.tracks[i].bal : raw.tracks[i].pay))}
        <td class="n">${U.money(r.interest)}</td><td class="n">${U.money(r.indexation)}</td><td class="n">${r.prepay ? U.money(r.prepay) : ''}</td><td class="n">${U.money(r.bal)}</td></tr>`; })}`;
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

  const duration = (n) => {
    const y = Math.floor(n / 12), m = n % 12;
    return [y ? (y === 1 ? 'שנה' : y === 2 ? 'שנתיים' : `${y} שנים`) : '', m ? (m === 1 ? 'חודש' : `${m} חודשים`) : ''].filter(Boolean).join(' ו־') || '—';
  };

  // Plain-language what-if: "if I repay X from track Y in month Z" → the two options side by side.
  function Simulator({ cfg, actuals, sum }) {
    const [amount, setAmount] = useState(100000);
    const [trackId, setTrackId] = useState(cfg.tracks[0].id);
    const [month, setMonth] = useState(U.addMonths(U.thisMonth(), 1));
    const [fee, setFee] = useState(0);
    const res = useMemo(() => (amount > 0 ? ['shorten', 'reduce'].map((mode) => M.simulate(cfg, { month, trackId, amount, mode }, actuals)) : null), [A.store.version(), amount, trackId, month]);
    const track = cfg.tracks.find((t) => t.id === trackId);
    const pt = sum.perTrack.find((p) => p.track.id === trackId) || {};
    const priciest = [...sum.perTrack].filter((p) => p.bal > 0).sort((a, b) => (b.rate + (b.track.cpi ? cfg.inflation : 0)) - (a.rate + (a.track.cpi ? cfg.inflation : 0)))[0];
    const [sh, rd] = res || [];
    return html`<div class="card"><h2>סימולטור פירעון מוקדם</h2>
      <div class="sim-q">
        <span>אם אפרע</span><${NumInput} value=${amount} width="120px" onCommit=${(x) => setAmount(x || 0)} /><span>₪ ממסלול</span>
        <select class="select" value=${trackId} onChange=${(e) => setTrackId(e.target.value)}>${cfg.tracks.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select>
        <span>ב־</span><input class="input" type="month" value=${month} onInput=${(e) => setMonth(e.target.value)} />
      </div>
      <div class="row small" style="margin:6px 0 4px">
        <span class="muted">סכום מהיר:</span>
        ${[50000, 100000, 200000].map((v) => html`<button class=${'btn sm' + (amount === v ? ' primary' : '')} onClick=${() => setAmount(v)}>${U.money(v)}</button>`)}
        ${pt.bal > 0 && html`<button class="btn sm" onClick=${() => setAmount(Math.round(pt.bal))}>כל המסלול (${U.money(pt.bal)})</button>`}
      </div>
      ${priciest && priciest.track.id !== trackId && html`<div class="small" style="margin-bottom:8px">💡 המסלול היקר ביותר כרגע הוא <a href="#" onClick=${(e) => { e.preventDefault(); setTrackId(priciest.track.id); }}>${priciest.track.name}</a> — בדרך כלל עדיף לפרוע אותו קודם.</div>`}
      ${res && html`<div class="grid g2 mt">
        <div class=${'sim-card' + (sh.saved - fee >= rd.saved - fee ? ' best' : '')}>
          <div class="sim-title">אפשרות א׳: לקצר את התקופה</div>
          <div class="muted small">ההחזר החודשי נשאר כמו שהוא, והמסלול נגמר מוקדם יותר</div>
          <div class="big">${U.money(sh.saved - fee)}</div><div class="small muted">חיסכון נטו בתשלומים</div>
          <ul>
            <li>המסלול ייגמר ב־<strong>${U.monthLabel(sh.payoffAfter)}</strong>, <strong>${duration(sh.monthsSaved)}</strong> לפני המועד המקורי (${U.monthShort(sh.payoffBefore)})</li>
            <li>ההחזר במסלול נשאר כ־${U.money(sh.trackPayAfter)} בחודש</li>
          </ul>
        </div>
        <div class=${'sim-card' + (rd.saved - fee > sh.saved - fee ? ' best' : '')}>
          <div class="sim-title">אפשרות ב׳: להקטין את ההחזר</div>
          <div class="muted small">המסלול נגמר במועד המקורי, וההחזר החודשי יורד</div>
          <div class="big">${U.money(rd.saved - fee)}</div><div class="small muted">חיסכון נטו בתשלומים</div>
          <ul>
            <li>ההחזר במסלול יירד מ־${U.money(rd.trackPayBefore)} ל־<strong>${U.money(rd.trackPayAfter)}</strong> — <strong>${U.money(rd.trackPayBefore - rd.trackPayAfter)} פחות בכל חודש</strong></li>
            <li>המסלול ייגמר כמתוכנן, ב־${U.monthLabel(rd.payoffAfter)}</li>
          </ul>
        </div>
      </div>
      <div class="callout small mt">
        ${track.name}: קיצור תקופה חוסך <strong>${U.money(sh.saved - rd.saved)}</strong> יותר, אבל הקטנת ההחזר משאירה <strong>${U.money(rd.trackPayBefore - rd.trackPayAfter)}</strong> פנויים כל חודש.
        אם הסכום הפנוי ייחסך או יושקע בכל חודש, ההפרש מצטמצם. אם הוא ייכנס להוצאות השוטפות — קיצור תקופה משתלם יותר.
      </div>`}
      <div class="row small mt"><label class="row" style="gap:6px">עמלת פירעון מוקדם (מהבנק, ₪)<${NumInput} small value=${fee} width="90px" onCommit=${(x) => setFee(x || 0)} /></label>
        <span class="muted">— נמצאת בדוח היתרות לסילוק. במסלול פריים לרוב אין עמלה.</span></div>
    </div>`;
  }

  function Decision({ cfg, settings, actuals }) {
    const [amount, setAmount] = useState(100000);
    const res = useMemo(() => (amount > 0 ? M.decide(cfg, settings, amount, actuals) : []), [A.store.version(), amount]);
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

  function ActualVsPlan({ sched, cfg }) {
    // "Expected" = computed payment from the real prime and CPI; "actual" = what the bank debited.
    const now = U.thisMonth();
    const rows = sched.rows.filter((r) => r.ym <= now && r.actual != null).slice(-8);
    const upd = (val) => A.store.update((s) => { s.mortgage.calibrate = val; });
    const extra = sched.extra || 0;
    return html`<div class="card mt" id="m-actual">
      <div class="card-head"><h2>תשלום בפועל מול הצפי</h2><span class="sub">לפי עסקאות בתת־קטגוריה "משכנתה"</span><div class="grow"></div>
        <label class="row small"><input type="checkbox" class="chk" checked=${cfg.calibrate !== false} onChange=${(e) => upd(e.target.checked)} /> לתקן את התחזית לפי התשלום בפועל</label></div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>חודש</th><th class="n">צפי (ריבית + מדד)</th><th class="n">בפועל</th><th class="n">פער</th><th></th></tr></thead>
        <tbody>${rows.map((r) => { const gap = r.actual - r.pay; return html`<tr><td>${U.monthLabel(r.ym)}</td><td class="n">${U.money(r.pay)}</td><td class="n">${U.money(r.actual)}</td>
          <td class="n"><span class=${Math.abs(gap) < 10 ? 'muted' : 'delta bad'}>${gap > 0 ? '+' : ''}${U.money(gap)}</span></td>
          <td>${Math.abs(gap) >= r.pay * 0.05 ? html`<span class="badge warn" title="פער גדול — אולי כולל פירעון או חיוב נוסף, לא נכלל בתיקון">חריג</span>` : ''}</td></tr>`; })}</tbody></table></div>`
        : html`<div class="muted small">אין עדיין עסקאות בתת־קטגוריה "משכנתה".</div>`}
      ${cfg.calibrate !== false && Math.abs(extra) >= 1 && html`<div class="callout small mt">
        בממוצע הבנק גובה ${U.money(Math.abs(extra), true)} ${extra > 0 ? 'יותר' : 'פחות'} מההחזר המחושב בכל חודש — כנראה ביטוח או עמלה שנגבים יחד עם ההחזר, או עיגול של הבנק.
        הפער הזה נוסף לתחזית התשלומים מהחודש הבא. יתרת ההלוואה עצמה מחושבת לפי ריבית בנק ישראל והמדד בפועל, ולא משתנה בגללו.</div>`}
      <div class="small muted mt">פער חריג (מעל 5%) לא נכלל בתיקון — לרוב זה פירעון מוקדם או חיוב שנרשם בטעות כמשכנתה.</div>
    </div>`;
  }

  A.ui.MortgageView = MortgageView;
})(window.App);
