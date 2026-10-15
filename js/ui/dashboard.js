// Monthly dashboard.
(function (A) {
  const { html, useState, useMemo } = htmPreact;
  const { U, F, CAT } = A;
  const { Tile, Delta, MonthPicker, Modal, Empty, Chart } = A.ui;

  function defaultMonth(state) {
    const ms = F.months(state).filter((m) => m <= U.thisMonth());
    return ms.length ? ms[ms.length - 1] : U.thisMonth();
  }

  function Dashboard({ go, nav }) {
    const [state, v] = A.store.use();
    const [month, setMonth] = useState(() => nav.month || defaultMonth(state));
    const [drill, setDrill] = useState(null);
    const [showBlocks, setShowBlocks] = useState(false);
    const [noOneOff, setNoOneOff] = useState(false);

    const months = F.months(state);
    const s = F.monthSummary(state, month, noOneOff ? { excludeOneOff: true } : {});
    const prevM = F.prevMonths(state, month, 1)[0];
    const prev = prevM ? F.monthSummary(state, prevM) : null;
    const avg = F.averageOf(state, F.prevMonths(state, month, 3));
    const alerts = F.alerts(state, month);
    const recurring = F.recurring(state, month);

    const expCats = useMemo(() => {
      const list = F.expenseCats(state).concat(s.byCat[F.UNCAT] ? [F.UNCAT] : []);
      return list.map((c) => ({ cat: c, total: s.byCat[c] ? s.byCat[c].total : 0, count: s.byCat[c] ? s.byCat[c].count : 0, budget: state.budgets[c] || 0, avg: avg ? avg.byCat[c] || 0 : null }))
        .sort((a, b) => b.total - a.total);
    }, [v, month, noOneOff]);
    const maxBar = Math.max(1, ...expCats.map((c) => Math.max(c.total, c.budget)));

    const trendMonths = useMemo(() => { const out = []; for (let i = 5; i >= 0; i--) out.push(U.addMonths(month, -i)); return out; }, [month]);
    const trend = trendMonths.map((m) => F.monthSummary(state, m));

    if (!state.transactions.length) {
      return html`<div class="card"><${Empty} title="עדיין אין נתונים">
        <p>כדי להתחיל, ייבא את קובץ ה־Excel הקיים שלך או קבצים מחברות האשראי.</p>
        <button class="btn primary" onClick=${() => go('import')}>למסך הייבוא</button></${Empty}></div>`;
    }

    const kindRows = (kind) => {
      const out = [];
      for (const [cat, c] of Object.entries(s.byCat)) if (CAT.kindOf(cat) === kind) for (const [sub, val] of Object.entries(c.subs)) out.push({ cat, sub, val });
      return out.sort((a, b) => b.val - a.val);
    };
    const fixedTotal = U.sum(recurring, (r) => r.avg);
    // Salary lines like "משכורת - <name>" get that person's colour.
    const personIn = (text) => (state.settings.people || []).find((p) => text.includes(p));

    return html`
      <div class="page-head"><h1>דשבורד חודשי</h1><div class="grow"></div>
        <label class="row small"><input type="checkbox" class="chk" checked=${noOneOff} onChange=${(e) => setNoOneOff(e.target.checked)} /> ללא הוצאות חד־פעמיות</label>
        <${MonthPicker} months=${months} value=${month} onChange=${setMonth} /></div>

      <div class="tiles">
        <${Tile} label="הכנסות" value=${U.money(s.income)} onClick=${() => go('transactions', { month, kind: 'income' })} foot=${html`<${Delta} cur=${s.income} ref=${prev && prev.income} label="מהחודש הקודם" />`} />
        <${Tile} label="הוצאות" value=${U.money(s.expense)} onClick=${() => go('transactions', { month, kind: 'expense' })} foot=${html`<${Delta} cur=${s.expense} ref=${prev && prev.expense} goodWhenUp=${false} label="מהחודש הקודם" />
          ${avg && html`<span>ממוצע 3 ח׳: ${U.money(avg.expense)}</span>`}`} />
        <${Tile} label="חיסכון והשקעה" value=${U.money(s.saving)} onClick=${() => go('transactions', { month, kind: 'saving' })} foot=${avg && html`<span>ממוצע 3 ח׳: ${U.money(avg.saving)}</span>`} />
        <${Tile} hero label="נשאר בחשבון (אחרי חיסכון)" value=${U.money(s.leftover)} onClick=${() => go('transactions', { month })}
          foot=${html`<span>הכנסות פחות הוצאות: ${U.money(s.net)}</span>`} title="הכנסות פחות הוצאות פחות הפקדות לחיסכון · לחצו לכל עסקאות החודש" />
        <${Tile} label="שיעור חיסכון" value=${U.pct(s.savingRate, 0)} foot=${html`<span>החלק מההכנסה שלא הוצא</span>`} />
      </div>

      ${alerts.length > 0 && html`<div class="card" style="margin-bottom:14px"><div class="alerts">
        ${alerts.map((a) => html`<div class=${'alert ' + a.level}><span class="ic" aria-hidden="true">${a.icon}</span><span class="grow">${a.text}</span>
          ${a.go && html`<button class="btn sm" onClick=${() => go('transactions', { filter: a.go === 'review' ? 'review' : 'checks' })}>לטיפול</button>`}
          ${a.cat && html`<button class="btn sm" onClick=${() => setDrill({ cat: a.cat })}>פירוט</button>`}
        </div>`)}</div></div>`}

      <div class="grid g3">
        <div class="card span2">
          <div class="card-head"><h2>הוצאות לפי קטגוריה</h2><span class="sub">קו אנכי = תקציב · לחצו לפירוט</span><div class="grow"></div>
            <button class="btn sm" onClick=${() => go('settings', { section: 'budgets' })}>עריכת תקציבים</button></div>
          <div class="cbars">${expCats.filter((c) => c.total !== 0 || c.budget).map((c) => html`
            <button class="cbar" onClick=${() => setDrill({ cat: c.cat })} title=${c.budget ? `תקציב ${U.money(c.budget)}` : ''}>
              <span class="nm">${c.cat}</span>
              <span class="track">
                <span class=${'fill' + (c.budget && c.total > c.budget ? ' over' : '')} style=${'width:' + Math.max(0, (c.total / maxBar) * 100) + '%'}></span>
                ${c.budget > 0 && html`<span class="budget" style=${'inset-inline-start:' + (c.budget / maxBar) * 100 + '%'}></span>`}
              </span>
              <span class="amt">${U.money(c.total)}</span>
              <span class="meta">${c.count} עסקאות${c.avg != null && c.avg > 0 ? ` · ממוצע ${U.money(c.avg)}` : ''}${c.budget ? ` · ${U.pct(c.total / c.budget, 0)} מהתקציב` : ''}</span>
            </button>`)}</div>
        </div>

        <div class="stack">
          <div class="card"><h2>הכנסות</h2>
            ${kindRows('income').map((r) => html`<div class="block-r" style="border:0;padding:4px 0" onClick=${() => setDrill({ cat: r.cat, sub: r.sub })}><span>${personIn(r.sub) ? html`<span class="chip" style=${'--c:' + CAT.ownerColor(personIn(r.sub), state.settings.people)}>${r.sub}</span>` : r.sub}</span><span class="n">${U.money(r.val)}</span></div>`)}
            ${!kindRows('income').length && html`<div class="muted small">אין הכנסות בחודש זה</div>`}
          </div>
          <div class="card"><h2>חיסכון והשקעה</h2>
            ${kindRows('saving').map((r) => html`<div class="block-r" style="border:0;padding:4px 0" onClick=${() => setDrill({ cat: r.cat, sub: r.sub })}><span>${r.sub}</span><span class="n">${U.money(r.val)}</span></div>`)}
            ${!kindRows('saving').length && html`<div class="muted small">לא הופקד לחיסכון בחודש זה</div>`}
          </div>
          <div class="card"><h2>הוצאות קבועות שזוהו <span class="sub">${U.money(fixedTotal)} בחודש</span></h2>
            ${recurring.slice(0, 8).map((r) => html`<div class="block-r" style="border:0;padding:3px 0"><span class="ellipsis" title=${r.cat + ' / ' + r.sub}>${r.desc}${r.standing ? html` <span class="badge">הו״ק</span>` : ''}${!r.inMonth ? html` <span class="badge warn">לא חויב החודש</span>` : ''}</span><span class="n">${U.money(r.avg)}</span></div>`)}
            ${!recurring.length && html`<div class="muted small">צריך לפחות 3 חודשי נתונים</div>`}
            ${recurring.length > 8 && html`<div class="muted small">ועוד ${recurring.length - 8}…</div>`}
          </div>
        </div>
      </div>

      <div class="grid g2 mt">
        <div class="card"><h2>מגמה — 6 חודשים</h2>
          <${Chart} labels=${trendMonths.map(U.monthShort)} series=${[
            { label: 'הכנסות', data: trend.map((t) => (t.count ? U.round2(t.income) : null)), color: '--s3' },
            { label: 'הוצאות', data: trend.map((t) => (t.count ? U.round2(t.expense) : null)), color: '--s2' },
            { label: 'חיסכון', data: trend.map((t) => (t.count ? U.round2(t.saving) : null)), color: '--s1' },
          ]} height=${240} />
        </div>
        <div class="card"><h2>התפלגות ההוצאות</h2>
          <${Chart} kind="bar" labels=${expCats.filter((c) => c.total > 0).map((c) => c.cat)}
            series=${[{ label: 'הוצאה', data: expCats.filter((c) => c.total > 0).map((c) => U.round2(c.total)), color: '--s1' }]} height=${240}
            options=${{ scales: { x: { reverse: true, ticks: { autoSkip: false, maxRotation: 50, minRotation: 30 } } } }} />
        </div>
      </div>

      <${MonthCompare} key=${month} state=${state} month=${month} months=${months} onDrill=${setDrill} />

      <div class="card mt">
        <div class="card-head"><h2>פירוט לפי תתי־קטגוריות</h2><div class="grow"></div>
          <button class="btn sm" onClick=${() => setShowBlocks(!showBlocks)}>${showBlocks ? 'הסתר' : 'הצג'}</button></div>
        ${showBlocks && html`<div class="grid g-auto">${F.expenseCats(state).map((cat) => {
          const c = s.byCat[cat];
          const budget = state.budgets[cat] || 0;
          const total = c ? c.total : 0;
          const subs = [...state.categories[cat]];
          if (c && c.subs['לא קוטלג']) subs.push('לא קוטלג');
          const ratio = budget ? total / budget : 0;
          return html`<div class="block">
            <div class="block-h" onClick=${() => setDrill({ cat })}><span class="grow">${cat}</span><span class="n">${U.money(total)}</span></div>
            ${budget > 0 && html`<div style="padding:6px 12px 0" class="small muted">תקציב ${U.money(budget)} · ${U.pct(ratio, 0)}</div>
              <div class="progress" style="margin-top:4px"><div class=${ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : ''} style=${'width:' + Math.min(100, ratio * 100) + '%'}></div></div>`}
            ${subs.map((sub) => { const val = c ? c.subs[sub] || 0 : 0; return html`<div class=${'block-r' + (val ? '' : ' zero')} onClick=${() => val && setDrill({ cat, sub })}><span>${sub}</span><span class="n">${U.money(val)}</span></div>`; })}
          </div>`;
        })}</div>`}
      </div>

      ${drill && html`<${DrillModal} month=${month} drill=${drill} onClose=${() => setDrill(null)} />`}
    `;
  }

  // This month next to any other month, per category, biggest changes first.
  function MonthCompare({ state, month, months, onDrill }) {
    const others = months.filter((m) => m !== month);
    const [other, setOther] = useState(() => F.prevMonths(state, month, 1)[0] || others[others.length - 1] || '');
    if (!others.length) return null;
    const a = F.monthSummary(state, month), b = F.monthSummary(state, other);
    const cats = [...new Set([...Object.keys(a.byCat), ...Object.keys(b.byCat)])].filter((c) => CAT.kindOf(c) === 'expense');
    const rows = cats.map((c) => ({ cat: c, a: a.byCat[c] ? a.byCat[c].total : 0, b: b.byCat[c] ? b.byCat[c].total : 0 }))
      .map((r) => ({ ...r, d: r.a - r.b })).filter((r) => r.a || r.b).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const line = (label, x, y, goodUp, bold) => { const d = x - y; return html`<tr>
      <td>${bold ? html`<strong>${label}</strong>` : label}</td><td class="n">${U.money(x)}</td><td class="n">${U.money(y)}</td>
      <td class=${'n ' + (Math.abs(d) < 1 ? 'muted' : (d > 0) === goodUp ? 'cmp-down' : 'cmp-up')}>${d > 0 ? '+' : ''}${U.money(d)}</td>
      <td class="n small muted">${y ? U.pct(d / Math.abs(y), 0) : '—'}</td></tr>`; };
    return html`<div class="card mt">
      <div class="card-head"><h2>השוואה בין חודשים</h2><span class="sub">${U.monthLabel(month)} מול</span>
        <select class="select sm" value=${other} onChange=${(e) => setOther(e.target.value)}>${[...others].reverse().map((m) => html`<option value=${m}>${U.monthLabel(m)}</option>`)}</select></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="n">${U.monthShort(month)}</th><th class="n">${U.monthShort(other)}</th><th class="n">שינוי</th><th class="n">%</th></tr></thead>
        <tbody>
          ${line('הכנסות', a.income, b.income, true, true)}
          ${line('הוצאות', a.expense, b.expense, false, true)}
          ${line('חיסכון והשקעה', a.saving, b.saving, true, true)}
          ${rows.map((r) => html`<tr style="cursor:pointer" onClick=${() => onDrill({ cat: r.cat })}>
            <td><span class="chip" style=${'--c:' + (CAT.colorOf(r.cat) || '#888')}>${r.cat}</span></td><td class="n">${U.money(r.a)}</td><td class="n">${U.money(r.b)}</td>
            <td class=${'n ' + (Math.abs(r.d) < 1 ? 'muted' : r.d > 0 ? 'cmp-up' : 'cmp-down')}>${r.d > 0 ? '+' : ''}${U.money(r.d)}</td>
            <td class="n small muted">${r.b ? U.pct(r.d / Math.abs(r.b), 0) : 'חדש'}</td></tr>`)}
        </tbody></table></div>
      <div class="small muted" style="margin-top:6px">ירוק = טוב (פחות הוצאה / יותר הכנסה), אדום = הוצאה גבוהה יותר. לחצו על קטגוריה לפירוט.</div>
    </div>`;
  }

  function DrillModal({ month, drill, onClose }) {
    const [state] = A.store.use();
    const list = F.monthTx(state, month).filter((t) => (drill.cat === F.UNCAT ? !t.cat && t.flow === 'out' : t.cat === drill.cat) && (!drill.sub || (t.sub || 'לא קוטלג') === drill.sub));
    const total = U.sum(list, (t) => t.amount);
    return html`<${Modal} title=${`${drill.cat}${drill.sub ? ' / ' + drill.sub : ''} — ${U.monthLabel(month)}`} onClose=${onClose}>
      <div class="row" style="margin-bottom:10px"><span class="badge brand">${list.length} עסקאות</span><span class="badge">סה״כ ${U.money(total, true)}</span></div>
      <${A.ui.TxTable} list=${list} compact />
    </${Modal}>`;
  }

  A.ui.Dashboard = Dashboard;
})(window.App);
