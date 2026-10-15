// Net worth: funds + manual assets − mortgage − other debts, with monthly snapshots.
(function (A) {
  const { html, useEffect } = htmPreact;
  const { U, M, CAT } = A;
  const { Tile, Chart, EditTable } = A.ui;
  const ASSET_TYPES = ['מזומן ועו״ש', 'פיקדון', 'תיק השקעות', 'נדל״ן', 'רכב', 'אחר'];
  const DEBT_TYPES = ['הלוואה', 'הלוואת רכב', 'מינוס', 'אחר'];

  function compute(state) {
    const funds = U.sum(state.funds, (f) => f.balance || 0);
    const manual = U.sum(state.assets, (a) => a.value || 0);
    const sched = state.mortgage && state.mortgage.tracks.length ? M.compute(state.mortgage) : null;
    const mortgage = sched ? M.summary(sched).balanceNow : 0;
    const debts = U.sum(state.liabilities, (l) => l.value || 0);
    const assets = funds + manual, liabilities = mortgage + debts;
    return { funds, manual, mortgage, debts, assets, liabilities, net: assets - liabilities };
  }

  // One snapshot per month, refreshed whenever the screen is opened during that month.
  function snapshot(s) {
    const c = compute(s);
    const ym = U.thisMonth();
    s.snapshots = (s.snapshots || []).filter((x) => x.month !== ym);
    s.snapshots.push({ month: ym, date: U.today(), assets: U.round2(c.assets), liabilities: U.round2(c.liabilities), net: U.round2(c.net) });
    s.snapshots.sort((a, b) => a.month.localeCompare(b.month));
  }

  function NetWorth() {
    const [state] = A.store.use();
    const c = compute(state);
    useEffect(() => {
      const ym = U.thisMonth();
      const cur = (state.snapshots || []).find((x) => x.month === ym);
      if (!cur || Math.abs(cur.net - c.net) > 1) A.store.update(snapshot);
    }, [c.net]);

    const savedTotal = U.sum(state.transactions.filter((t) => t.cat === CAT.SAVING), (t) => t.amount);
    const snaps = state.snapshots || [];
    const setRow = (key) => (id, k, val) => A.store.update((s) => { const r = s[key].find((x) => x.id === id); r[k] = val; if (k === 'value') r.updated = U.today(); });
    const del = (key) => (id) => A.store.update((s) => { s[key] = s[key].filter((x) => x.id !== id); });

    return html`
      <div class="page-head"><h1>שווי נקי</h1><div class="grow"></div><span class="small muted">תמונת מצב נשמרת אוטומטית פעם בחודש</span></div>
      <div class="tiles">
        <${Tile} hero label="שווי נקי" value=${U.money(c.net)} foot=${snaps.length > 1 ? html`<span>שינוי מ${U.monthLabel(snaps[snaps.length - 2].month)}: ${U.money(c.net - snaps[snaps.length - 2].net)}</span>` : 'נכסים פחות התחייבויות'} />
        <${Tile} label="נכסים" value=${U.money(c.assets)} foot=${html`<span>קופות ${U.money(c.funds)}</span><span>אחר ${U.money(c.manual)}</span>`} />
        <${Tile} label="התחייבויות" value=${U.money(c.liabilities)} foot=${html`<span>משכנתה ${U.money(c.mortgage)}</span>${c.debts ? html`<span>אחר ${U.money(c.debts)}</span>` : ''}`} />
      </div>

      ${c.mortgage > 0 && !state.assets.some((a) => a.type === 'נדל״ן') && html`<div class="callout warn" style="margin-bottom:14px">
        המשכנתה נספרת כהתחייבות, אבל הדירה עצמה עוד לא רשומה כנכס — ולכן השווי הנקי נראה שלילי.
        <button class="btn sm" style="margin-inline-start:8px" onClick=${() => A.store.update((s) => s.assets.push({ id: U.uid(), name: 'דירה', type: 'נדל״ן', value: 0, updated: U.today() }))}>הוספת הדירה כנכס</button></div>`}

      ${snaps.length > 1 && html`<div class="card" style="margin-bottom:14px"><h2>התפתחות לאורך זמן</h2>
        <${Chart} labels=${snaps.map((x) => U.monthShort(x.month))} series=${[
          { label: 'שווי נקי', data: snaps.map((x) => x.net), color: '--s1' },
          { label: 'נכסים', data: snaps.map((x) => x.assets), color: '--s3' },
          { label: 'התחייבויות', data: snaps.map((x) => x.liabilities), color: '--s2' },
        ]} height=${220} /></div>`}

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><h2>נכסים</h2><div class="grow"></div><button class="btn sm" onClick=${() => A.store.update((s) => s.assets.push({ id: U.uid(), name: '', type: 'פיקדון', value: 0, updated: U.today() }))}>＋ נכס</button></div>
          <div class="kv" style="margin-bottom:10px"><span>קופות וחסכונות (מלשונית הקופות)</span><span class="v">${U.money(c.funds)}</span></div>
          <${EditTable} rows=${state.assets} onSet=${setRow('assets')} onDelete=${del('assets')} cols=${[
            { key: 'name', label: 'שם', width: '140px' }, { key: 'type', label: 'סוג', type: 'select', options: ASSET_TYPES },
            { key: 'value', label: 'שווי (₪)', type: 'num', width: '110px' }, { key: 'updated', label: 'עודכן', render: (r) => html`<span class="small muted">${U.fmtDate(r.updated)}</span>` }]} />
          ${savedTotal > 0 && html`<div class="callout small mt">לפי העסקאות, הופקדו לחיסכון והשקעה ${U.money(savedTotal)}. כדאי להוסיף את שווי התיק העדכני כנכס (למשל "תיק השקעות IBI").</div>`}
        </div>
        <div class="card">
          <div class="card-head"><h2>התחייבויות</h2><div class="grow"></div><button class="btn sm" onClick=${() => A.store.update((s) => s.liabilities.push({ id: U.uid(), name: '', type: 'הלוואה', value: 0, updated: U.today() }))}>＋ התחייבות</button></div>
          <div class="kv" style="margin-bottom:10px"><span>משכנתה (מחושב מלוח הסילוקין)</span><span class="v">${U.money(c.mortgage)}</span></div>
          <${EditTable} rows=${state.liabilities} onSet=${setRow('liabilities')} onDelete=${del('liabilities')} cols=${[
            { key: 'name', label: 'שם', width: '140px' }, { key: 'type', label: 'סוג', type: 'select', options: DEBT_TYPES },
            { key: 'value', label: 'יתרה (₪)', type: 'num', width: '110px' }, { key: 'updated', label: 'עודכן', render: (r) => html`<span class="small muted">${U.fmtDate(r.updated)}</span>` }]} />
        </div>
      </div>
    `;
  }

  A.ui.NetWorth = NetWorth;
})(window.App);
