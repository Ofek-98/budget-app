// Annual summary: colour-coded table, trends and period comparison. Works for any year with data.
(function (A) {
  const { html, useState } = htmPreact;
  const { U, F, CAT } = A;
  const { Chart, Tile, Modal } = A.ui;
  const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];

  // Colour class for a cell: how far this month is from the row's own monthly average.
  function devClass(v, avg) {
    if (!v) return 'zero';
    if (!avg) return '';
    const r = v / avg - 1;
    return r <= -0.4 ? 'dv-2' : r <= -0.1 ? 'dv-1' : r < 0.1 ? 'dv0' : r < 0.5 ? 'dv1' : 'dv2';
  }

  function Annual({ go }) {
    const [state] = A.store.use();
    const years = [...new Set(F.months(state).map((m) => m.slice(0, 4)))];
    if (!years.includes(U.thisMonth().slice(0, 4))) years.push(U.thisMonth().slice(0, 4));
    years.sort();
    const [year, setYear] = useState(years.filter((y) => F.months(state).some((m) => m.startsWith(y))).pop() || years[years.length - 1]);
    const [noOneOff, setNoOneOff] = useState(false);
    const [mode, setMode] = useState('dev');
    const [focus, setFocus] = useState('');
    const opts = noOneOff ? { excludeOneOff: true } : {};
    const Y = F.yearMatrix(state, year, opts);
    const nActive = Y.active.filter(Boolean).length || 1;
    const tot = (f) => U.sum(Y.sums, f);
    const totals = { income: tot((s) => s.income), expense: tot((s) => s.expense), saving: tot((s) => s.saving) };
    totals.net = totals.income - totals.expense;
    totals.leftover = totals.net - totals.saving;

    // Rows: all expense categories, or the sub-categories of one category when focused.
    const rows = focus
      ? [...(state.categories[focus] || []), 'לא קוטלג'].map((sub) => ({ label: sub, cat: focus, sub, values: Y.sums.map((s) => (s.byCat[focus] && s.byCat[focus].subs[sub]) || 0) })).filter((r) => r.values.some((x) => x))
      : Y.rows.map((r) => ({ label: r.cat, cat: r.cat, values: r.values }));

    const cellNav = (i, r) => go('transactions', { month: Y.months[i], cat: r.cat, sub: r.sub || '' });
    const heatRow = (label, values, o = {}) => {
      const act = values.filter((v, i) => Y.active[i]);
      const total = U.sum(values.filter((v, i) => Y.active[i] || Y.partial[i]));
      const avg = U.sum(act) / nActive;
      const max = Math.max(...act.map(Math.abs), 1);
      return html`<tr class=${o.sum ? 'sum' : ''}>
        <td class="rowhead" style=${o.row && !focus ? 'cursor:pointer' : ''} title=${o.row && !focus ? 'פירוט לפי תתי־קטגוריות' : ''} onClick=${() => o.row && !focus && setFocus(o.row.cat)}>
          ${o.row ? html`<span class="chip" style=${'--c:' + (CAT.colorOf(o.row.cat) || '#888')}>${label}</span>` : label}</td>
        ${values.map((v, i) => {
          if (Y.partial[i]) return html`<td class=${'h empty' + (o.nav ? ' click' : '')} title="חודש חלקי — לא נכלל בממוצע ובצביעה" onClick=${() => o.nav && o.nav(i)}>${o.pct ? '' : v ? U.money(v) : '—'}</td>`;
          if (!Y.active[i]) return html`<td class="h empty">—</td>`;
          let cls = 'h';
          let title = '';
          if (!o.noHeat) {
            if (mode === 'dev') { cls += ' ' + devClass(v, avg); if (v && avg) title = `${v >= avg ? '+' : ''}${U.pct(v / avg - 1, 0)} לעומת הממוצע (${U.money(avg)})`; }
            else cls += ' ' + (v <= 0 ? 'zero' : 'l' + Math.min(5, Math.ceil((v / max) * 5)));
          }
          if (o.nav) cls += ' click';
          const fmt = o.pct ? U.pct(v, 0) : U.money(v);
          return html`<td class=${cls} title=${title} style=${o.signed && v < 0 ? 'color:var(--critical)' : ''} onClick=${() => o.nav && o.nav(i)}>${fmt}</td>`;
        })}
        <td class="n"><strong>${o.pct ? U.pct(o.totalPct, 0) : U.money(total)}</strong></td>
        <td class="n muted">${o.pct ? '' : U.money(avg)}</td>
      </tr>`;
    };

    const ranked = Y.rows.map((r) => ({ ...r, total: U.sum(r.values) })).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    const top = ranked.slice(0, 6);
    const rest = ranked.slice(6);
    const stackSeries = top.map((r, i) => ({ label: r.cat, data: r.values.map((x, k) => (Y.active[k] ? U.round2(x) : null)), color: SLOTS[i] }));
    if (rest.length) stackSeries.push({ label: 'אחר', data: Y.months.map((m, k) => (Y.active[k] ? U.round2(U.sum(rest, (r) => r.values[k])) : null)), color: '--muted' });

    return html`
      <div class="page-head"><h1>סיכום שנתי</h1><div class="grow"></div>
        <label class="row small"><input type="checkbox" class="chk" checked=${noOneOff} onChange=${(e) => setNoOneOff(e.target.checked)} /> ללא הוצאות חד־פעמיות</label>
        <select class="select" value=${year} onChange=${(e) => setYear(e.target.value)}>${years.map((y) => html`<option value=${y}>${y}</option>`)}</select></div>

      <div class="tiles">
        <${Tile} label=${'הכנסות ' + year} value=${U.money(totals.income)} foot=${'ממוצע חודשי ' + U.money(totals.income / nActive)} onClick=${() => go('transactions', { year, kind: 'income' })} />
        <${Tile} label="הוצאות" value=${U.money(totals.expense)} foot=${'ממוצע חודשי ' + U.money(totals.expense / nActive)} onClick=${() => go('transactions', { year, kind: 'expense' })} />
        <${Tile} label="חיסכון והשקעה" value=${U.money(totals.saving)} foot=${'ממוצע חודשי ' + U.money(totals.saving / nActive)} onClick=${() => go('transactions', { year, kind: 'saving' })} />
        <${Tile} hero label="נשאר בחשבון" value=${U.money(totals.leftover)} foot=${'שיעור חיסכון ' + U.pct(totals.income ? totals.net / totals.income : null, 0)} onClick=${() => go('transactions', { year })} />
      </div>

      <div class="card">
        <div class="card-head"><h2>${focus ? html`טבלה שנתית — <span class="chip" style=${'--c:' + CAT.colorOf(focus)}>${focus}</span>` : 'טבלה שנתית'}</h2>
          ${focus && html`<button class="btn sm" onClick=${() => setFocus('')}>→ חזרה לכל הקטגוריות</button>`}
          <div class="grow"></div>
          <select class="select sm" aria-label="פירוט קטגוריה" value=${focus} onChange=${(e) => setFocus(e.target.value)}><option value="">כל הקטגוריות</option>
            ${F.expenseCats(state).map((c) => html`<option value=${c}>${c}</option>`)}</select>
          <div class="seg" role="group" aria-label="צביעה">
            <button class=${mode === 'dev' ? 'on' : ''} onClick=${() => setMode('dev')}>צבע לפי חריגה</button>
            <button class=${mode === 'size' ? 'on' : ''} onClick=${() => setMode('size')}>צבע לפי סכום</button>
          </div>
        </div>
        ${mode === 'dev' ? html`<div class="heat-legend" style="margin-bottom:10px"><span>כל שורה נצבעת מול הממוצע החודשי שלה:</span>
            <span><i style="background:#9ec5f4"></i>הרבה מתחת לממוצע</span><span><i style="background:#cde2fb"></i>מתחת</span>
            <span><i style="background:var(--surface-3)"></i>בערך כרגיל</span><span><i style="background:#f9c4bf"></i>מעל</span><span><i style="background:#e34948"></i>הרבה מעל (50%+)</span></div>`
          : html`<div class="heat-legend" style="margin-bottom:10px"><span>כחול כהה יותר = החודש היקר ביותר באותה שורה</span></div>`}
        <div class="tbl-wrap"><table class="tbl heat">
          <thead><tr><th>${focus ? 'תת־קטגוריה' : 'קטגוריה'}</th>${Y.months.map((m) => html`<th style="text-align:center">${U.HEB_MONTHS_SHORT[+m.slice(5) - 1]}</th>`)}<th class="n">סה״כ</th><th class="n">ממוצע</th></tr></thead>
          <tbody>
            ${!focus && heatRow('הכנסות', Y.sums.map((s) => s.income), { noHeat: true, nav: (i) => go('transactions', { month: Y.months[i], kind: 'income' }) })}
            ${!focus && heatRow('חיסכון והשקעה', Y.sums.map((s) => s.saving), { noHeat: true, nav: (i) => go('transactions', { month: Y.months[i], kind: 'saving' }) })}
            ${rows.map((r) => heatRow(r.label, r.values, { row: focus ? null : r, nav: (i) => cellNav(i, r) }))}
            ${!focus && heatRow('סה״כ הוצאות', Y.sums.map((s) => s.expense), { sum: true, noHeat: true, nav: (i) => go('transactions', { month: Y.months[i], kind: 'expense' }) })}
            ${!focus && heatRow('הכנסות פחות הוצאות', Y.sums.map((s) => s.net), { sum: true, noHeat: true, signed: true })}
            ${!focus && heatRow('נשאר אחרי חיסכון', Y.sums.map((s) => s.leftover), { sum: true, noHeat: true, signed: true })}
            ${!focus && heatRow('שיעור חיסכון', Y.sums.map((s) => s.savingRate || 0), { sum: true, noHeat: true, pct: true, totalPct: totals.income ? totals.net / totals.income : null })}
          </tbody></table></div>
        <div class="small muted" style="margin-top:8px">לחצו על תא כדי לראות את העסקאות שמרכיבות אותו. לחצו על שם קטגוריה לפירוט לפי תתי־קטגוריות.
          ${Y.partial.some(Boolean) && ` חודשים באפור (${Y.months.filter((m, i) => Y.partial[i]).map(U.monthShort).join(', ')}) חלקיים — לא נכללים בממוצע.`}</div>
      </div>

      <div class="grid g2 mt">
        <div class="card"><h2>הכנסות, הוצאות וחיסכון</h2>
          <${Chart} labels=${Y.months.map(U.monthShort)} series=${[
            { label: 'הכנסות', data: Y.sums.map((s, i) => (Y.active[i] ? U.round2(s.income) : null)), color: '--s3' },
            { label: 'הוצאות', data: Y.sums.map((s, i) => (Y.active[i] ? U.round2(s.expense) : null)), color: '--s2' },
            { label: 'חיסכון', data: Y.sums.map((s, i) => (Y.active[i] ? U.round2(s.saving) : null)), color: '--s1' },
          ]} /></div>
        <div class="card"><h2>הוצאות לפי קטגוריה</h2>
          <${Chart} kind="bar" stacked labels=${Y.months.map(U.monthShort)} series=${stackSeries} /></div>
      </div>

      <${PeriodCompare} state=${state} go=${go} />
    `;
  }

  // Average per month in period A vs period B, per category.
  function PeriodCompare({ state, go }) {
    const months = F.months(state).filter((m) => F.monthTx(state, m).length >= 15);
    const n = months.length;
    const [a, setA] = useState(() => ({ from: months[Math.max(0, n - 3)] || '', to: months[n - 1] || '' }));
    const [b, setB] = useState(() => ({ from: months[Math.max(0, n - 6)] || '', to: months[Math.max(0, n - 4)] || '' }));
    if (n < 2) return null;
    const preset = (k) => {
      if (k === 'q') { setA({ from: months[Math.max(0, n - 3)], to: months[n - 1] }); setB({ from: months[Math.max(0, n - 6)], to: months[Math.max(0, n - 4)] }); }
      if (k === 'm') { setA({ from: months[n - 1], to: months[n - 1] }); setB({ from: months[n - 2], to: months[n - 2] }); }
      if (k === 'y') { const y = months[n - 1].slice(0, 4); setA({ from: `${y}-01`, to: `${y}-12` }); setB({ from: `${+y - 1}-01`, to: `${+y - 1}-12` }); }
    };
    const avgOf = (p) => {
      const ms = months.filter((m) => m >= p.from && m <= p.to);
      const sums = ms.map((m) => F.monthSummary(state, m));
      const k = ms.length || 1;
      const byCat = {};
      for (const s of sums) for (const [c, v] of Object.entries(s.byCat)) byCat[c] = (byCat[c] || 0) + v.total / k;
      return { n: ms.length, income: U.sum(sums, (s) => s.income) / k, expense: U.sum(sums, (s) => s.expense) / k, saving: U.sum(sums, (s) => s.saving) / k, byCat };
    };
    const PA = avgOf(a), PB = avgOf(b);
    const cats = [...new Set([...Object.keys(PA.byCat), ...Object.keys(PB.byCat)])].filter((c) => CAT.kindOf(c) === 'expense');
    const rows = cats.map((c) => ({ c, x: PA.byCat[c] || 0, y: PB.byCat[c] || 0 })).filter((r) => r.x || r.y).sort((p, q) => Math.abs(q.x - q.y) - Math.abs(p.x - p.y));
    const sel = (p, set) => html`<span class="row" style="gap:4px;flex-wrap:nowrap">
      <select class="select sm" value=${p.from} onChange=${(e) => set({ ...p, from: e.target.value })}>${months.map((m) => html`<option value=${m}>${U.monthShort(m)}</option>`)}</select>
      <span class="muted">עד</span>
      <select class="select sm" value=${p.to} onChange=${(e) => set({ ...p, to: e.target.value })}>${months.map((m) => html`<option value=${m}>${U.monthShort(m)}</option>`)}</select></span>`;
    const line = (label, x, y, goodUp) => { const d = x - y; return html`<tr><td><strong>${label}</strong></td><td class="n">${U.money(x)}</td><td class="n">${U.money(y)}</td>
      <td class=${'n ' + (Math.abs(d) < 1 ? 'muted' : (d > 0) === goodUp ? 'cmp-down' : 'cmp-up')}>${d > 0 ? '+' : ''}${U.money(d)}</td><td class="n small muted">${y ? U.pct(d / Math.abs(y), 0) : '—'}</td></tr>`; };
    return html`<div class="card mt">
      <div class="card-head"><h2>השוואת תקופות</h2><span class="sub">ממוצע לחודש בכל תקופה</span><div class="grow"></div>
        <button class="btn sm" onClick=${() => preset('m')}>חודש מול קודם</button>
        <button class="btn sm" onClick=${() => preset('q')}>3 חודשים מול 3 קודמים</button>
        ${months.some((m) => m.startsWith(String(+months[n - 1].slice(0, 4) - 1))) && html`<button class="btn sm" onClick=${() => preset('y')}>שנה מול שנה</button>`}</div>
      <div class="row" style="margin-bottom:10px"><strong>תקופה א׳:</strong>${sel(a, setA)}<span class="muted small">(${PA.n} ח׳)</span>
        <span style="width:16px"></span><strong>תקופה ב׳:</strong>${sel(b, setB)}<span class="muted small">(${PB.n} ח׳)</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="n">א׳ (לחודש)</th><th class="n">ב׳ (לחודש)</th><th class="n">הפרש</th><th class="n">%</th></tr></thead>
        <tbody>${line('הכנסות', PA.income, PB.income, true)}${line('הוצאות', PA.expense, PB.expense, false)}${line('חיסכון והשקעה', PA.saving, PB.saving, true)}
          ${rows.map((r) => { const d = r.x - r.y; return html`<tr><td><span class="chip" style=${'--c:' + (CAT.colorOf(r.c) || '#888')}>${r.c}</span></td><td class="n">${U.money(r.x)}</td><td class="n">${U.money(r.y)}</td>
            <td class=${'n ' + (Math.abs(d) < 1 ? 'muted' : d > 0 ? 'cmp-up' : 'cmp-down')}>${d > 0 ? '+' : ''}${U.money(d)}</td><td class="n small muted">${r.y ? U.pct(d / r.y, 0) : 'חדש'}</td></tr>`; })}</tbody></table></div>
    </div>`;
  }

  A.ui.Annual = Annual;
})(window.App);
