// Aggregations used by the dashboards. All results are memoised per store version.
(function (A) {
  const { U, CAT } = A;
  const UNCAT = 'לא מסווג';
  let memo = { v: -1 };

  function idx(state) {
    const v = A.store.version();
    if (memo.v === v && memo.state === state) return memo;
    const byMonth = U.groupBy(state.transactions, (t) => U.monthKey(t.date));
    const months = [...byMonth.keys()].filter(Boolean).sort();
    memo = { v, state, byMonth, months, cache: new Map() };
    return memo;
  }
  const cached = (state, key, fn) => { const m = idx(state); if (!m.cache.has(key)) m.cache.set(key, fn()); return m.cache.get(key); };

  const expenseCats = (state) => Object.keys(state.categories).filter((c) => CAT.kindOf(c) === 'expense');

  // excludeOneOff: drop the "הוצאה חד-פעמית" sub-category and anything tagged one-off.
  function summarize(txs, opts = {}) {
    const s = { income: 0, expense: 0, saving: 0, transfer: 0, uncatIn: 0, uncatInCount: 0, count: txs.length, byCat: {} };
    for (const t of txs) {
      if (opts.excludeOneOff && (t.sub === 'הוצאה חד-פעמית' || (t.tags || []).includes('חד-פעמי'))) continue;
      let cat = t.cat, kind;
      if (!cat) {
        if (t.flow === 'in') { s.uncatIn += Math.abs(t.amount); s.uncatInCount++; continue; }
        cat = UNCAT; kind = 'expense';
      } else kind = CAT.kindOf(cat);
      const a = t.amount;
      if (kind === 'income') s.income += a;
      else if (kind === 'saving') s.saving += a;
      else if (kind === 'transfer') s.transfer += a;
      else s.expense += a;
      const c = s.byCat[cat] || (s.byCat[cat] = { total: 0, count: 0, subs: {} });
      c.total += a; c.count++;
      const sub = t.sub || 'לא קוטלג';
      c.subs[sub] = (c.subs[sub] || 0) + a;
    }
    s.net = s.income - s.expense;                 // what was not spent
    s.leftover = s.income - s.expense - s.saving; // what stayed in the account after saving
    s.savingRate = s.income > 0 ? (s.net) / s.income : null;
    return s;
  }

  const monthTx = (state, ym) => idx(state).byMonth.get(ym) || [];
  const months = (state) => idx(state).months;
  const monthSummary = (state, ym, opts = {}) => cached(state, 'm:' + ym + JSON.stringify(opts), () => summarize(monthTx(state, ym), opts));

  // Previous "full" months before ym, newest first. Months with only a handful of rows
  // (before tracking really started) would drag averages down, so they're skipped.
  function prevMonths(state, ym, n) {
    return months(state).filter((m) => m < ym && monthTx(state, m).length >= 15).slice(-n).reverse();
  }

  function averageOf(state, list) {
    if (!list.length) return null;
    const sums = list.map((m) => monthSummary(state, m));
    const avg = { income: 0, expense: 0, saving: 0, net: 0, byCat: {} };
    for (const s of sums) {
      avg.income += s.income / list.length; avg.expense += s.expense / list.length;
      avg.saving += s.saving / list.length; avg.net += s.net / list.length;
      for (const [c, v] of Object.entries(s.byCat)) avg.byCat[c] = (avg.byCat[c] || 0) + v.total / list.length;
    }
    return avg;
  }

  // Merchants that charged in at least 3 of the last 4 months at a stable amount.
  function recurring(state, ym) {
    return cached(state, 'rec:' + ym, () => {
      const window = [ym, U.addMonths(ym, -1), U.addMonths(ym, -2), U.addMonths(ym, -3)];
      const groups = new Map();
      for (const m of window) for (const t of monthTx(state, m)) {
        if (!t.desc || t.flow !== 'out' || !t.cat || CAT.kindOf(t.cat) !== 'expense') continue;
        const k = U.normDesc(t.desc);
        if (!groups.has(k)) groups.set(k, { desc: t.desc, cat: t.cat, sub: t.sub, months: new Map(), standing: false });
        const g = groups.get(k);
        g.months.set(m, (g.months.get(m) || 0) + t.amount);
        if ((t.tags || []).includes('הוראת קבע') || /הוראת קבע/.test(t.note)) g.standing = true;
      }
      const out = [];
      for (const g of groups.values()) {
        if (g.months.size < 3) continue;
        const vals = [...g.months.values()];
        const min = Math.min(...vals), max = Math.max(...vals);
        if (min <= 0 || max / min > 1.6) continue;
        out.push({ desc: g.desc, cat: g.cat, sub: g.sub, avg: U.sum(vals) / vals.length, months: g.months.size, standing: g.standing, inMonth: g.months.has(ym) });
      }
      return out.sort((a, b) => b.avg - a.avg);
    });
  }

  // Data-quality checks: likely duplicates and "full amount + installments" double counting.
  function dataChecks(state) {
    return cached(state, 'checks', () => {
      const issues = [];
      const dismissed = new Set(state.dismissedChecks || []);
      const same = U.groupBy(state.transactions.filter((t) => !t.inst), (t) => t.date + '|' + U.normDesc(t.desc) + '|' + Math.abs(t.amount));
      for (const [k, list] of same) {
        if (list.length < 2 || !list[0].desc) continue;
        const id = 'dup:' + k;
        if (!dismissed.has(id)) issues.push({ id, type: 'dup', title: 'עסקה כפולה אפשרית', txs: list });
      }
      const byDesc = U.groupBy(state.transactions.filter((t) => t.desc && t.flow === 'out'), (t) => U.normDesc(t.desc));
      for (const list of byDesc.values()) {
        if (list.length < 2) continue;
        for (const big of list) for (const small of list) {
          if (big === small || Math.abs(big.amount) <= Math.abs(small.amount)) continue;
          const ratio = Math.abs(big.amount) / Math.abs(small.amount);
          const k = Math.round(ratio);
          if (k < 2 || k > 36 || Math.abs(ratio - k) > 0.002) continue;
          if (Math.abs(U.daysBetween(big.date, small.date)) > 45) continue;
          if (big.inst) continue;
          if (!(small.inst || /תשלום/.test(small.note || '') || Math.abs(big.amount) >= 1500)) continue;
          const id = 'inst:' + big.id;
          if (dismissed.has(id) || issues.some((i) => i.id === id)) continue;
          issues.push({ id, type: 'inst', title: `סכום מלא שנרשם בנוסף לתשלומים (פי ${k})`, txs: [big, small] });
        }
      }
      return issues;
    });
  }

  function yearMatrix(state, year, opts = {}) {
    return cached(state, 'y:' + year + JSON.stringify(opts), () => {
      const months = Array.from({ length: 12 }, (_, i) => `${year}-${U.pad(i + 1)}`);
      const sums = months.map((m) => summarize(monthTx(state, m), opts));
      const cats = expenseCats(state);
      if (sums.some((s) => s.byCat[UNCAT])) cats.push(UNCAT);
      const rows = cats.map((c) => ({ cat: c, values: sums.map((s) => (s.byCat[c] ? s.byCat[c].total : 0)) }));
      // "active" = a full month of data (used for averages and colours); "partial" = only a few rows
      // (tracking hadn't started yet, or the current month isn't fully imported).
      const active = sums.map((s) => s.count >= 15);
      const partial = sums.map((s) => s.count > 0 && s.count < 15);
      return { months, sums, rows, active, partial };
    });
  }

  function alerts(state, ym) {
    const out = [];
    const s = monthSummary(state, ym);
    const prev = prevMonths(state, ym, 3);
    const avg = averageOf(state, prev);
    const review = state.transactions.filter((t) => t.needsReview).length;
    if (review) out.push({ level: 'warning', icon: '⚠', text: `${review} עסקאות ממתינות לבדיקת סיווג`, go: 'review' });
    if (s.uncatInCount) out.push({ level: 'warning', icon: '⚠', text: `${s.uncatInCount} זיכויים לא מסווגים בסך ${U.money(s.uncatIn)} לא נספרו`, go: 'review' });
    for (const [cat, budget] of Object.entries(state.budgets || {})) {
      if (!budget) continue;
      const spent = s.byCat[cat] ? s.byCat[cat].total : 0;
      if (spent >= budget) out.push({ level: 'critical', icon: '✖', text: `חריגה מהתקציב ב${cat}: ${U.money(spent)} מתוך ${U.money(budget)}` });
      else if (spent >= budget * 0.85) out.push({ level: 'serious', icon: '!', text: `${cat} קרוב לתקרת התקציב (${U.pct(spent / budget, 0)})` });
    }
    if (avg) {
      for (const [cat, v] of Object.entries(s.byCat)) {
        if (CAT.kindOf(cat) !== 'expense' || cat === UNCAT) continue;
        const a = avg.byCat[cat] || 0;
        if (a > 0 && v.total > a * 1.4 && v.total - a > 400) out.push({ level: 'info', icon: '↑', text: `${cat}: ${U.money(v.total)} — גבוה ב־${U.pct(v.total / a - 1, 0)} מהממוצע (${U.money(a)})`, cat });
      }
    }
    const checks = dataChecks(state).filter((i) => i.txs.some((t) => U.monthKey(t.date) === ym));
    if (checks.length) out.push({ level: 'serious', icon: '!', text: `${checks.length} בעיות נתונים אפשריות החודש (כפילויות)`, go: 'checks' });
    const soon = (state.insurances || []).filter((i) => i.renewal && U.daysBetween(U.today(), i.renewal) >= 0 && U.daysBetween(U.today(), i.renewal) <= 45);
    for (const i of soon) out.push({ level: 'info', icon: '⏰', text: `חידוש ${i.type} (${i.company}) בעוד ${U.daysBetween(U.today(), i.renewal)} ימים` });
    return out;
  }

  A.F = { UNCAT, summarize, monthTx, months, monthSummary, prevMonths, averageOf, recurring, dataChecks, yearMatrix, alerts, expenseCats };
})(window.App);
