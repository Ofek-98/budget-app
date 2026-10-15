// Insights & forecast: where money could be saved, cash-flow projection, and installment commitments.
(function (A) {
  const { html, useMemo } = htmPreact;
  const { U, F, CAT } = A;
  const { Tile, Chart, Empty } = A.ui;

  // Months with real data (enough rows), newest last.
  const fullMonths = (state) => F.months(state).filter((m) => F.monthTx(state, m).length >= 15);

  // ---------- installments ----------
  // Each plan = same merchant + card + monthly amount; the latest "n of N" tells how many are left.
  function installments(state) {
    const groups = new Map();
    for (const t of state.transactions) {
      if (!t.inst || t.flow !== 'out') continue;
      const key = U.normDesc(t.desc) + '|' + (t.card || t.method) + '|' + Math.round(Math.abs(t.amount));
      const g = groups.get(key);
      if (!g || (t.inst.n || 0) > (g.inst.n || 0) || (!t.inst.n && t.date > g.date)) groups.set(key, t);
    }
    const plans = [], unknown = [];
    for (const t of groups.values()) {
      if (!t.inst.n || !t.inst.of) { unknown.push(t); continue; }
      const left = t.inst.of - t.inst.n;
      if (left <= 0) continue;
      const last = U.monthKey(t.date);
      plans.push({ t, desc: t.desc, card: t.card, method: t.method, cat: t.cat, amount: Math.abs(t.amount), n: t.inst.n, of: t.inst.of, left,
        remaining: left * Math.abs(t.amount), lastMonth: last, end: U.addMonths(last, left), months: Array.from({ length: left }, (_, j) => U.addMonths(last, j + 1)) });
    }
    plans.sort((a, b) => b.remaining - a.remaining);
    return { plans, unknown: unknown.filter((t) => U.monthDiff(U.monthKey(t.date), U.thisMonth()) <= 2) };
  }

  // ---------- savings insights ----------
  function insights(state) {
    const out = [];
    const months = fullMonths(state);
    const ref = months[months.length - 1];
    if (!ref) return out;

    // 1. Subscriptions / standing charges that went up.
    for (const r of F.recurring(state, ref)) {
      const window = [3, 2, 1, 0].map((i) => U.addMonths(ref, -i));
      const vals = window.map((m) => U.sum(F.monthTx(state, m).filter((t) => U.normDesc(t.desc) === U.normDesc(r.desc) && t.flow === 'out'), (t) => t.amount)).filter((v) => v > 0);
      if (vals.length < 3) continue;
      const last = vals[vals.length - 1], before = U.sum(vals.slice(0, -1)) / (vals.length - 1);
      if (last > before * 1.05 && last - before >= 3) {
        out.push({ kind: 'price', icon: '↑', title: `${r.desc} התייקר`, text: `מ־${U.money(before, true)} ל־${U.money(last, true)} בחודש (+${U.pct(last / before - 1, 0)}). כדאי לבדוק אם יש מבצע או חלופה.`, yearly: (last - before) * 12, q: r.desc });
      }
    }

    // 2. Several insurers for the same kind of insurance (possible double cover).
    const recent = [0, 1, 2].map((i) => U.addMonths(ref, -i));
    for (const sub of ['ביטוח חיים', 'ביטוח בריאות']) {
      const txs = recent.flatMap((m) => F.monthTx(state, m)).filter((t) => t.sub === sub && t.flow === 'out');
      const byMerchant = U.groupBy(txs, (t) => U.normDesc(t.desc).split(' ')[0] || '?');
      if (byMerchant.size >= 2) {
        const monthly = U.sum(txs, (t) => t.amount) / recent.length;
        out.push({ kind: 'ins', icon: '⚠', title: `${byMerchant.size} חברות שונות גובות ${sub}`, text: `${[...byMerchant.values()].map((l) => l[0].desc).join(', ')} — סה״כ כ־${U.money(monthly)} בחודש. ייתכן כיסוי כפול; שווה לעשות בדיקה מרוכזת (למשל ב"הר הביטוח").`, yearly: null, q: sub });
      }
    }

    // 3. Fund management fees above target.
    const th = state.settings.feeAlerts;
    for (const f of state.funds) {
      const t = th[f.type];
      if (!t || !t.acc || !(f.feeAcc > t.acc) || !f.balance) continue;
      out.push({ kind: 'fee', icon: '%', title: `דמי ניהול גבוהים — ${f.type} ${f.company} (${f.owner})`, text: `${U.pct(f.feeAcc, 2)} מצבירה מול יעד ${U.pct(t.acc, 2)}. מיקוח או מעבר יחסכו כ־${U.money(f.balance * (f.feeAcc - t.acc))} בשנה, ויותר ככל שהצבירה גדלה.`, yearly: f.balance * (f.feeAcc - t.acc), go: 'funds' });
    }

    // 4. Card fees and interest.
    const last12 = F.months(state).filter((m) => U.monthDiff(m, ref) < 12);
    const fees = last12.flatMap((m) => F.monthTx(state, m)).filter((t) => t.flow === 'out' && (t.sub === 'עמלות וריבית' || /עמלה|עמלת|ריבית|דמי כרטיס|חיוב חודשי ק/.test(t.desc + ' ' + t.note)));
    if (fees.length) {
      const total = U.sum(fees, (t) => t.amount);
      const yearly = (total / Math.max(1, last12.length)) * 12;
      out.push({ kind: 'fees', icon: '₪', title: 'עמלות, דמי כרטיס וריבית', text: `${fees.length} חיובים בסך ${U.money(total)} ב־${last12.length} חודשים (כ־${U.money(yearly)} בשנה). אפשר לבקש מחברת האשראי ביטול דמי כרטיס ולהימנע מפריסה בריבית.`, yearly, q: 'עמלות וריבית' });
    }

    // 5. Categories running well above their usual level.
    const avg = F.averageOf(state, months.slice(-4, -1));
    const cur = F.monthSummary(state, ref);
    if (avg) for (const [c, v] of Object.entries(cur.byCat)) {
      if (CAT.kindOf(c) !== 'expense') continue;
      const a = avg.byCat[c] || 0;
      if (a > 200 && v.total > a * 1.3 && v.total - a > 300) out.push({ kind: 'spike', icon: '↑', title: `${c} גבוה מהרגיל`, text: `${U.money(v.total)} ב${U.monthLabel(ref)} מול ממוצע ${U.money(a)} — ${U.money(v.total - a)} מעל.`, yearly: null, cat: c, month: ref });
    }
    return out;
  }

  // ---------- cash-flow forecast ----------
  function forecast(state, inst) {
    const months = fullMonths(state);
    const base = months.slice(-3);
    if (!base.length) return null;
    const avg = F.averageOf(state, base);
    const ref = months[months.length - 1];
    const rec = F.recurring(state, ref);
    const fixed = U.sum(rec, (r) => r.avg);
    // A recurring charge that is really an installment plan stops when the plan ends;
    // installment plans not detected as recurring are added on top.
    const planOf = (desc) => inst.plans.find((p) => U.normDesc(p.desc) === U.normDesc(desc));
    const notRecurring = inst.plans.filter((p) => !rec.some((r) => U.normDesc(r.desc) === U.normDesc(p.desc)));
    // Variable spending = month's expenses minus fixed charges and installments, without one-offs;
    // the median of recent months so that a single holiday or big purchase doesn't skew it.
    const varMonths = months.slice(-6).map((m) => Math.max(0, F.monthSummary(state, m, { excludeOneOff: true }).expense - fixed - U.sum(notRecurring, (p) => p.amount)));
    const sorted = [...varMonths].sort((a, b) => a - b);
    const variable = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const m = U.addMonths(ref, i);
      const fixedNow = U.sum(rec.filter((r) => { const p = planOf(r.desc); return !p || p.months.includes(m); }), (r) => r.avg);
      const instExtra = U.sum(notRecurring.filter((p) => p.months.includes(m)), (p) => p.amount);
      const expense = fixedNow + instExtra + variable;
      out.push({ m, income: avg.income, fixed: fixedNow, inst: instExtra, variable, expense, saving: avg.saving, net: avg.income - expense, leftover: avg.income - expense - avg.saving });
    }
    return { base, ref, avg, fixed, variable, months: out };
  }

  function Insights({ go }) {
    const [state, v] = A.store.use();
    const inst = useMemo(() => installments(state), [v]);
    const ins = useMemo(() => insights(state), [v]);
    const fc = useMemo(() => forecast(state, inst), [v]);
    if (!state.transactions.length) return html`<div class="page-head"><h1>תובנות ותחזית</h1></div><div class="card"><${Empty} title="אין עדיין נתונים" /></div>`;
    const yearly = U.sum(ins.filter((i) => i.yearly), (i) => i.yearly);
    const instTotal = U.sum(inst.plans, (p) => p.remaining);
    const next12 = Array.from({ length: 12 }, (_, i) => U.addMonths(U.thisMonth(), i));
    const open = (i) => {
      if (i.go) return go(i.go);
      if (i.cat) return go('transactions', { month: i.month, cat: i.cat });
      if (i.q) return go('transactions', { q: i.q });
    };

    return html`
      <div class="page-head"><h1>תובנות ותחזית</h1></div>
      <div class="tiles">
        <${Tile} hero label="חיסכון שנתי אפשרי (משוער)" value=${U.money(yearly)} foot=${ins.length + ' תובנות'} onClick=${() => document.getElementById('i-ins').scrollIntoView({ behavior: 'smooth' })} />
        ${fc && html`<${Tile} label=${'צפי לסוף ' + U.monthLabel(fc.months[0].m)} value=${U.money(fc.months[0].leftover)} foot="נשאר בחשבון אחרי חיסכון" onClick=${() => document.getElementById('i-fc').scrollIntoView({ behavior: 'smooth' })} />`}
        <${Tile} label="מחויבות בתשלומים פתוחים" value=${U.money(instTotal)} foot=${inst.plans.length + ' עסקאות בתשלומים'} onClick=${() => document.getElementById('i-inst').scrollIntoView({ behavior: 'smooth' })} />
      </div>

      <div class="card" id="i-ins"><h2>תובנות חיסכון</h2>
        ${ins.length ? html`<div class="alerts">${ins.map((i) => html`<div class=${'alert ' + (i.kind === 'ins' || i.kind === 'fee' ? 'serious' : 'info')}>
          <span class="ic" aria-hidden="true">${i.icon}</span>
          <span class="grow"><strong>${i.title}</strong><br /><span class="small">${i.text}</span></span>
          ${i.yearly ? html`<span class="badge good">${U.money(i.yearly)} בשנה</span>` : ''}
          <button class="btn sm" onClick=${() => open(i)}>פירוט</button></div>`)}</div>`
          : html`<div class="muted">לא נמצאו כרגע הזדמנויות בולטות לחיסכון 👍</div>`}
      </div>

      ${fc && html`<div class="card mt" id="i-fc"><h2>תחזית תזרים — 6 חודשים קדימה</h2>
        <p class="small muted" style="margin-top:0">הכנסה וחיסכון לפי ממוצע ${fc.base.map(U.monthShort).join(', ')}; הוצאות קבועות שזוהו ותשלומים פתוחים לפי מה שידוע; הוצאה משתנה לפי חודש "טיפוסי" (חציון, בלי הוצאות חד־פעמיות).</p>
        <${Chart} kind="bar" stacked labels=${fc.months.map((x) => U.monthShort(x.m))} height=${230} series=${[
          { label: 'הוצאות קבועות', data: fc.months.map((x) => U.round2(x.fixed)), color: '--s1' },
          { label: 'תשלומים', data: fc.months.map((x) => U.round2(x.inst)), color: '--s2' },
          { label: 'הוצאה משתנה', data: fc.months.map((x) => U.round2(x.variable)), color: '--s3' },
        ]} />
        <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>חודש</th><th class="n">הכנסה צפויה</th><th class="n">הוצאות צפויות</th><th class="n">חיסכון</th><th class="n">נשאר בחשבון</th></tr></thead>
          <tbody>${fc.months.map((x) => html`<tr><td>${U.monthLabel(x.m)}</td><td class="n">${U.money(x.income)}</td><td class="n">${U.money(x.expense)}</td><td class="n">${U.money(x.saving)}</td>
            <td class="n"><strong style=${x.leftover < 0 ? 'color:var(--critical)' : ''}>${U.money(x.leftover)}</strong></td></tr>`)}</tbody></table></div>
        <div class="small muted mt">זו הערכה. הוצאות חד־פעמיות (חופשה, רכישה גדולה) לא נכללות — אם מתוכננת כזו, צריך לנכות אותה מה"נשאר".</div>
      </div>`}

      <div class="card mt" id="i-inst"><h2>תשלומים עתידיים</h2>
        ${inst.plans.length ? html`
          <${Chart} kind="bar" labels=${next12.map(U.monthShort)} height=${180}
            series=${[{ label: 'תשלומים לחודש', data: next12.map((m) => U.round2(U.sum(inst.plans.filter((p) => p.months.includes(m)), (p) => p.amount))), color: '--s2' }]} />
          <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>בית עסק</th><th>כרטיס</th><th class="n">לחודש</th><th class="n">שולמו</th><th class="n">נשארו</th><th class="n">יתרה לתשלום</th><th>מסתיים</th></tr></thead>
            <tbody>${inst.plans.map((p) => html`<tr style="cursor:pointer" onClick=${() => go('transactions', { q: p.desc })}>
              <td>${p.desc}${p.cat ? html` <span class="chip" style=${'--c:' + CAT.colorOf(p.cat)}>${p.cat}</span>` : ''}</td><td class="small">${p.method} ${p.card}</td>
              <td class="n">${U.money(p.amount, true)}</td><td class="n">${p.n}/${p.of}</td><td class="n">${p.left}</td><td class="n"><strong>${U.money(p.remaining)}</strong></td><td>${U.monthShort(p.end)}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="5">סה״כ</td><td class="n">${U.money(instTotal)}</td><td></td></tr></tfoot></table></div>`
          : html`<div class="muted">לא נמצאו עסקאות בתשלומים עם פירוט "תשלום X מתוך Y".</div>`}
        ${inst.unknown.length > 0 && html`<div class="small muted mt">${inst.unknown.length} עסקאות בתשלומים בלי פירוט מספר התשלום (${inst.unknown.slice(0, 3).map((t) => t.desc).join(', ')}${inst.unknown.length > 3 ? '…' : ''}) לא נכללו.</div>`}
      </div>
    `;
  }

  A.ui.Insights = Insights;
  A.insights = { installments, insights, forecast };
})(window.App);
