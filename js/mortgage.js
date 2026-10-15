// Mortgage engine: monthly amortisation (Shpitzer) per track, with prime history, CPI linkage,
// rate resets and early repayments (shorten term or lower the payment).
(function (A) {
  const { U } = A;

  const latestAt = (list, ym, key = 'rate') => {
    let v = null;
    for (const x of list || []) if (x.month <= ym) v = x[key];
    return v;
  };

  function compute(cfg, extraPrepay = []) {
    if (!cfg || !cfg.tracks || !cfg.tracks.length) return null;
    const start = U.monthKey(cfg.startDate);
    const primeHist = [...(cfg.primeHistory || [])].sort((a, b) => a.month.localeCompare(b.month));
    const pre = [...(cfg.prepayments || []), ...extraPrepay];
    const defaultInfl = Math.pow(1 + (cfg.inflation || 0), 1 / 12) - 1;
    const cpiMap = new Map((cfg.cpiActual || []).map((c) => [c.month, c.pct]));
    const st = cfg.tracks.map((t) => ({ t, bal: t.principal, rem: t.months, startRate: t.rate }));
    const rows = [];

    for (let m = 0; m < 720 && st.some((s) => s.bal > 0.01); m++) {
      const ym = U.addMonths(start, m);
      const prime = latestAt(primeHist, ym) ?? cfg.prime;
      const infl = cpiMap.has(ym) ? cpiMap.get(ym) : defaultInfl;
      const row = { m, ym, prime, tracks: [], pay: 0, interest: 0, indexation: 0, bal: 0, prepay: 0 };
      for (const s of st) {
        const t = s.t;
        if (s.bal <= 0.01) { row.tracks.push({ pay: 0, interest: 0, principal: 0, indexation: 0, bal: 0, rate: 0, prepay: 0 }); continue; }
        const reset = (cfg.rateChanges || []).filter((c) => c.trackId === t.id);
        const rate = t.type === 'prime' ? prime + (t.margin || 0) : (latestAt(reset, ym) ?? t.rate);
        const r = rate / 12;
        let indexation = 0;
        if (t.cpi) { indexation = s.bal * infl; s.bal += indexation; }
        const rem = Math.max(1, s.rem);
        const pay = r > 0 ? (s.bal * r) / (1 - Math.pow(1 + r, -rem)) : s.bal / rem;
        const interest = s.bal * r;
        const principal = Math.min(pay - interest, s.bal);
        s.bal -= principal;
        s.rem = rem - 1;
        let prepaid = 0;
        for (const p of pre) {
          if (p.month !== ym || p.trackId !== t.id || !(p.amount > 0)) continue;
          const amt = Math.min(p.amount, s.bal);
          s.bal -= amt; prepaid += amt;
          if (p.mode === 'shorten' && s.bal > 0.01 && s.rem > 0) {
            // Keep the same payment and shorten the remaining term.
            const n = r > 0 ? -Math.log(1 - (s.bal * r) / pay) / Math.log(1 + r) : s.bal / pay;
            if (isFinite(n)) s.rem = Math.max(1, Math.ceil(n));
          }
        }
        if (s.rem <= 0 || s.bal < 0.01) s.bal = 0;
        row.tracks.push({ pay, interest, principal, indexation, bal: s.bal, rate, prepay: prepaid });
        row.pay += pay; row.interest += interest; row.indexation += indexation; row.prepay += prepaid;
      }
      row.bal = U.sum(st, (s) => s.bal);
      rows.push(row);
    }
    return { rows, start, tracks: cfg.tracks };
  }

  // Figures relative to a given month (default: this month).
  function summary(sched, ym = U.thisMonth()) {
    if (!sched) return null;
    const { rows, tracks, start } = sched;
    const i = Math.max(0, U.monthDiff(start, ym));
    const prevRow = i > 0 ? rows[Math.min(i, rows.length) - 1] : null;
    const balanceNow = prevRow ? prevRow.bal : U.sum(tracks, (t) => t.principal);
    const future = rows.slice(i);
    const cur = rows[i] || null;
    const lastPay = [...rows].reverse().find((r) => r.pay > 0);
    const perTrack = tracks.map((t, k) => {
      const bal = prevRow ? prevRow.tracks[k].bal : t.principal;
      const last = [...rows].reverse().find((r) => r.tracks[k].pay > 0);
      return {
        track: t, bal, pay: cur ? cur.tracks[k].pay : 0, rate: cur ? cur.tracks[k].rate : t.rate,
        interestLeft: U.sum(future, (r) => r.tracks[k].interest), indexLeft: U.sum(future, (r) => r.tracks[k].indexation),
        payoff: last ? last.ym : null, monthsLeft: last ? U.monthDiff(ym, last.ym) + 1 : 0,
      };
    });
    return {
      balanceNow, payNow: cur ? cur.pay : 0, payoff: lastPay ? lastPay.ym : null,
      interestLeft: U.sum(future, (r) => r.interest), indexLeft: U.sum(future, (r) => r.indexation),
      paidLeft: U.sum(future, (r) => r.pay), interestTotal: U.sum(rows, (r) => r.interest), perTrack, monthIndex: i,
    };
  }

  // What-if: one extra repayment.
  function simulate(cfg, { month, trackId, amount, mode }) {
    const base = compute(cfg);
    const alt = compute(cfg, [{ month, trackId, amount, mode }]);
    const from = Math.max(0, U.monthDiff(base.start, month));
    const paid = (s) => U.sum(s.rows.slice(from), (r) => r.pay);
    const k = cfg.tracks.findIndex((t) => t.id === trackId);
    const lastIdx = (s) => s.rows.reduce((acc, r, i) => (r.tracks[k] && r.tracks[k].pay > 0 ? i : acc), 0);
    const nextPay = (s) => (s.rows[from + 1] ? s.rows[from + 1].pay : 0);
    return {
      saved: paid(base) - paid(alt) - amount,
      interestSaved: U.sum(base.rows.slice(from), (r) => r.interest + r.indexation) - U.sum(alt.rows.slice(from), (r) => r.interest + r.indexation),
      monthsSaved: lastIdx(base) - lastIdx(alt),
      payBefore: nextPay(base), payAfter: nextPay(alt),
      payoffBefore: base.rows[lastIdx(base)].ym, payoffAfter: alt.rows[lastIdx(alt)].ym,
    };
  }

  // Prepay vs invest, per track, over that track's remaining life.
  function decide(cfg, settings, amount) {
    const sched = compute(cfg);
    const sum = summary(sched);
    const ym = U.thisMonth();
    const R = settings.investReturn - settings.investFee;
    const out = [];
    for (const pt of sum.perTrack) {
      if (pt.bal <= 0.01) continue;
      const amt = Math.min(amount, pt.bal);
      const sim = simulate(cfg, { month: ym, trackId: pt.track.id, amount: amt, mode: 'shorten' });
      const years = Math.max(pt.monthsLeft, 1) / 12;
      const fee = cfg.prepayFee && pt.track.type !== 'prime' ? cfg.prepayFee : 0;
      // Prepaying a loan "earns" exactly its rate (plus expected indexation on a CPI-linked track), risk- and tax-free.
      const effRate = (1 + pt.rate) * (1 + (pt.track.cpi ? cfg.inflation || 0 : 0)) - 1;
      const growth = Math.pow(1 + effRate, years);
      const prepayValue = (amt - fee) * growth;
      const fv = amt * Math.pow(1 + R, years);
      const taxBase = settings.taxRealGainOnly ? fv - amt * Math.pow(1 + (cfg.inflation || 0), years) : fv - amt;
      const tax = Math.max(0, taxBase) * settings.capGainsTax;
      const investValue = fv - tax;
      out.push({
        track: pt.track, amount: amt, years, effRate, saved: sim.saved, monthsSaved: sim.monthsSaved,
        prepayValue, investValue, prepayReturn: Math.pow(prepayValue / amt, 1 / years) - 1,
        investReturn: Math.pow(investValue / amt, 1 / years) - 1, winner: investValue > prepayValue ? 'invest' : 'prepay',
      });
    }
    out.sort((a, b) => b.effRate - a.effRate);
    return out;
  }

  // Default configuration (from the spreadsheet as of March 2026) for when nothing was imported.
  function blank() {
    return { startDate: U.today(), prime: 0.055, inflation: 0.025, tracks: [], primeHistory: [], prepayments: [], rateChanges: [], cpiActual: [], prepayFee: 0 };
  }

  A.M = { compute, summary, simulate, decide, blank };
})(window.App);
