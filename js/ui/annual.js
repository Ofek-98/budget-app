// Annual summary: heatmap table + trends. Works for any year with data.
(function (A) {
  const { html, useState } = htmPreact;
  const { U, F } = A;
  const { Chart, Tile, Modal } = A.ui;
  const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];

  function Annual() {
    const [state] = A.store.use();
    const years = [...new Set(F.months(state).map((m) => m.slice(0, 4)))];
    if (!years.includes(U.thisMonth().slice(0, 4))) years.push(U.thisMonth().slice(0, 4));
    years.sort();
    const [year, setYear] = useState(years.filter((y) => F.months(state).some((m) => m.startsWith(y))).pop() || years[years.length - 1]);
    const [noOneOff, setNoOneOff] = useState(false);
    const [drill, setDrill] = useState(null);
    const opts = noOneOff ? { excludeOneOff: true } : {};
    const Y = F.yearMatrix(state, year, opts);
    const nActive = Y.active.filter(Boolean).length || 1;
    const tot = (f) => U.sum(Y.sums, f);
    const totals = { income: tot((s) => s.income), expense: tot((s) => s.expense), saving: tot((s) => s.saving) };
    totals.net = totals.income - totals.expense;
    totals.leftover = totals.net - totals.saving;

    const heatRow = (label, values, opts = {}) => {
      const act = values.filter((v, i) => Y.active[i]);
      const max = Math.max(...act.map(Math.abs), 1);
      const total = U.sum(act);
      return html`<tr class=${opts.sum ? 'sum' : ''}>
        <td class="rowhead" style=${opts.sum ? '' : 'cursor:pointer'} onClick=${() => opts.cat && setDrill(opts.cat)}>${label}</td>
        ${values.map((v, i) => {
          if (!Y.active[i]) return html`<td class="h empty">—</td>`;
          const lvl = opts.noHeat || v <= 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5));
          const fmt = opts.pct ? U.pct(v, 0) : U.money(v);
          return html`<td class=${'h ' + (opts.noHeat ? '' : 'l' + lvl)} style=${opts.signed && v < 0 ? 'color:var(--critical)' : ''}>${fmt}</td>`;
        })}
        <td class="n"><strong>${opts.pct ? U.pct(opts.totalPct, 0) : U.money(total)}</strong></td>
        <td class="n muted">${opts.pct ? '' : U.money(total / nActive)}</td>
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
        <${Tile} label=${'הכנסות ' + year} value=${U.money(totals.income)} foot=${'ממוצע חודשי ' + U.money(totals.income / nActive)} />
        <${Tile} label="הוצאות" value=${U.money(totals.expense)} foot=${'ממוצע חודשי ' + U.money(totals.expense / nActive)} />
        <${Tile} label="חיסכון והשקעה" value=${U.money(totals.saving)} foot=${'ממוצע חודשי ' + U.money(totals.saving / nActive)} />
        <${Tile} hero label="נשאר בחשבון" value=${U.money(totals.leftover)} foot=${'שיעור חיסכון ' + U.pct(totals.income ? totals.net / totals.income : null, 0)} />
      </div>

      <div class="card">
        <div class="card-head"><h2>טבלה שנתית</h2><span class="sub">${nActive} חודשים עם נתונים · צבע כהה = חודש יקר יותר בקטגוריה · לחצו על קטגוריה לפירוט</span></div>
        <div class="tbl-wrap"><table class="tbl heat">
          <thead><tr><th>קטגוריה</th>${Y.months.map((m) => html`<th style="text-align:center">${U.HEB_MONTHS_SHORT[+m.slice(5) - 1]}</th>`)}<th class="n">סה״כ</th><th class="n">ממוצע</th></tr></thead>
          <tbody>
            ${heatRow('הכנסות', Y.sums.map((s) => s.income), { noHeat: true, cat: 'הכנסות' })}
            ${heatRow('חיסכון והשקעה', Y.sums.map((s) => s.saving), { noHeat: true, cat: 'חיסכון והשקעה' })}
            ${Y.rows.map((r) => heatRow(r.cat, r.values, { cat: r.cat }))}
            ${heatRow('סה״כ הוצאות', Y.sums.map((s) => s.expense), { sum: true, noHeat: true })}
            ${heatRow('הכנסות פחות הוצאות', Y.sums.map((s) => s.net), { sum: true, noHeat: true, signed: true })}
            ${heatRow('נשאר אחרי חיסכון', Y.sums.map((s) => s.leftover), { sum: true, noHeat: true, signed: true })}
            ${heatRow('שיעור חיסכון', Y.sums.map((s) => s.savingRate || 0), { sum: true, noHeat: true, pct: true, totalPct: totals.income ? totals.net / totals.income : null })}
          </tbody></table></div>
        <div class="small muted" style="margin-top:8px">"הכנסות פחות הוצאות" לא כולל הפקדות לחיסכון; "נשאר אחרי חיסכון" מנכה גם אותן — בכל החודשים באותה צורה.</div>
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
      ${drill && html`<${CatYear} cat=${drill} Y=${Y} state=${state} onClose=${() => setDrill(null)} />`}
    `;
  }

  // Sub-category breakdown of one category across the year.
  function CatYear({ cat, Y, state, onClose }) {
    const subs = [...(state.categories[cat] || []), 'לא קוטלג'];
    const rows = subs.map((sub) => ({ sub, values: Y.sums.map((s) => (s.byCat[cat] && s.byCat[cat].subs[sub]) || 0) })).filter((r) => r.values.some((x) => x));
    return html`<${Modal} title=${cat + ' — לפי תתי־קטגוריות'} onClose=${onClose}>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${Y.months.map((m, i) => Y.active[i] && html`<th class="n">${U.monthShort(m)}</th>`)}<th class="n">סה״כ</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${r.sub}</td>${r.values.map((v, i) => Y.active[i] && html`<td class="n">${v ? U.money(v) : '—'}</td>`)}<td class="n"><strong>${U.money(U.sum(r.values))}</strong></td></tr>`)}</tbody></table></div>
    </${Modal}>`;
  }

  A.ui.Annual = Annual;
})(window.App);
