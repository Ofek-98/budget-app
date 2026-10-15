// Mortgage engine: monthly amortisation (Shpitzer) per track, with prime history, CPI linkage,
// rate resets, early repayments (shorten term or lower the payment) and calibration to actual payments.
(function (A) {
  const { U } = A;

  const latestAt = (list, ym, key = 'rate') => {
    let v = null;
    for (const x of list || []) if (x.month <= ym) v = x[key];
    return v;
  };

  // One month of one track, without mutating anything.
  function step(bal, rem, rate, infl) {
    const r = rate / 12;
    const indexation = bal * infl;
    const b = bal + indexation;
    const n = Math.max(1, rem);
    const pay = r > 0 ? (b * r) / (1 - Math.pow(1 + r, -n)) : b / n;
    const interest = b * r;
    const principal = Math.min(pay - interest, b);
    return { pay, interest, principal, indexation, bal: b - principal, rate };
  }

  // Monthly payments actually made (sub-category "משכנתה"), by month.
  function actualPayments(state) {
    const m = new Map();
    for (const t of state.transactions) if (t.sub === 'משכנתה' && t.amount > 0) m.set(U.monthKey(t.date), (m.get(U.monthKey(t.date)) || 0) + t.amount);
    return m;
  }

  // actuals: Map(month -> amount paid). The loan itself follows the real prime and CPI data; whatever
  // systematic gap remains between the bank's actual debit and the computed payment (insurance or fees
  // collected with the payment, rounding) is carried into future months as a fixed add-on ("extra").
  function compute(cfg, extraPrepay = [], actuals = null) {
    if (!cfg || !cfg.tracks || !cfg.tracks.length) return null;
    const start = U.monthKey(cfg.startDate);
    const primeHist = [...(cfg.primeHistory || [])].sort((a, b) => a.month.localeCompare(b.month));
    const pre = [...(cfg.prepayments || []), ...extraPrepay];
    const defaultInfl = Math.pow(1 + (cfg.inflation || 0), 1 / 12) - 1;
    const cpiMap = new Map((cfg.cpiActual || []).map((c) => [c.month, c.pct]));
    const useActuals = actuals && cfg.calibrate !== false ? actuals : null;
    const st = cfg.tracks.map((t) => ({ t, bal: t.principal, rem: t.months }));
    const rows = [];

    for (let m = 0; m < 720 && st.some((s) => s.bal > 0.01); m++) {
      const ym = U.addMonths(start, m);
      const prime = latestAt(primeHist, ym) ?? cfg.prime;
      const infl = cpiMap.has(ym) ? cpiMap.get(ym) : defaultInfl;
      const rateOf = (t) => (t.type === 'prime' ? prime + (t.margin || 0) : (latestAt((cfg.rateChanges || []).filter((c) => c.trackId === t.id), ym) ?? t.rate));

      const inflOf = st.map((s) => (s.t.cpi ? infl : 0));
      const actual = useActuals && useActuals.has(ym) ? useActuals.get(ym) : null;
      const row = { m, ym, prime, infl, tracks: [], pay: 0, interest: 0, indexation: 0, bal: 0, prepay: 0, actual, extra: 0, calibrated: false };
      st.forEach((s, k) => {
        if (s.bal <= 0.01) { row.tracks.push({ pay: 0, interest: 0, principal: 0, indexation: 0, bal: 0, rate: 0, prepay: 0 }); return; }
        const r = step(s.bal, s.rem, rateOf(s.t), inflOf[k]);
        s.bal = r.bal;
        s.rem = Math.max(1, s.rem) - 1;
        let prepaid = 0;
        for (const p of pre) {
          if (p.month !== ym || p.trackId !== s.t.id || !(p.amount > 0)) continue;
          const amt = Math.min(p.amount, s.bal);
          s.bal -= amt; prepaid += amt;
          if (p.mode === 'shorten' && s.bal > 0.01 && s.rem > 0) {
            // Keep the same payment and shorten the remaining term.
            const rr = r.rate / 12;
            const n = rr > 0 ? -Math.log(1 - (s.bal * rr) / r.pay) / Math.log(1 + rr) : s.bal / r.pay;
            if (isFinite(n)) s.rem = Math.max(1, Math.ceil(n));
          }
        }
        if (s.rem <= 0 || s.bal < 0.01) s.bal = 0;
        row.tracks.push({ ...r, bal: s.bal, prepay: prepaid });
        row.pay += r.pay; row.interest += r.interest; row.indexation += r.indexation; row.prepay += prepaid;
      });
      row.bal = U.sum(st, (s) => s.bal);
      rows.push(row);
    }

    // Average gap over the (up to) last 6 months with an actual payment within 5% of the plan.
    let extra = 0;
    if (useActuals) {
      const gaps = rows.filter((r) => r.actual != null && Math.abs(r.actual - r.pay) < r.pay * 0.05).slice(-6);
      gaps.forEach((r) => { r.calibrated = true; });
      if (gaps.length >= 2) extra = U.sum(gaps, (r) => r.actual - r.pay) / gaps.length;
      const lastActual = gaps.length ? gaps[gaps.length - 1].m : -1;
      if (Math.abs(extra) >= 1) for (const r of rows) if (r.m > lastActual && r.pay > 0) r.extra = extra;
    }
    return { rows, start, tracks: cfg.tracks, extra };
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
      balanceNow, payNow: cur ? (cur.actual != null ? cur.actual : cur.pay + cur.extra) : 0, payoff: lastPay ? lastPay.ym : null,
      interestLeft: U.sum(future, (r) => r.interest), indexLeft: U.sum(future, (r) => r.indexation),
      paidLeft: U.sum(future, (r) => r.pay + r.extra), interestTotal: U.sum(rows, (r) => r.interest), perTrack, monthIndex: i,
      extra: sched.extra || 0,
    };
  }

  // What-if: one extra repayment.
  function simulate(cfg, { month, trackId, amount, mode }, actuals = null) {
    const base = compute(cfg, [], actuals);
    const alt = compute(cfg, [{ month, trackId, amount, mode }], actuals);
    const from = Math.max(0, U.monthDiff(base.start, month));
    const paid = (s) => U.sum(s.rows.slice(from), (r) => r.pay);
    const k = cfg.tracks.findIndex((t) => t.id === trackId);
    const lastIdx = (s) => s.rows.reduce((acc, r, i) => (r.tracks[k] && r.tracks[k].pay > 0 ? i : acc), 0);
    const nextPay = (s) => (s.rows[from + 1] ? s.rows[from + 1].pay : 0);
    const nextTrackPay = (s) => (s.rows[from + 1] && s.rows[from + 1].tracks[k] ? s.rows[from + 1].tracks[k].pay : 0);
    return {
      trackPayBefore: nextTrackPay(base), trackPayAfter: nextTrackPay(alt),
      saved: paid(base) - paid(alt) - amount,
      interestSaved: U.sum(base.rows.slice(from), (r) => r.interest + r.indexation) - U.sum(alt.rows.slice(from), (r) => r.interest + r.indexation),
      monthsSaved: lastIdx(base) - lastIdx(alt),
      payBefore: nextPay(base), payAfter: nextPay(alt),
      payoffBefore: base.rows[lastIdx(base)].ym, payoffAfter: alt.rows[lastIdx(alt)].ym,
    };
  }

  // Prepay vs invest, per track, over that track's remaining life.
  function decide(cfg, settings, amount, actuals = null) {
    const sum = summary(compute(cfg, [], actuals));
    const ym = U.thisMonth();
    const R = settings.investReturn - settings.investFee;
    const out = [];
    for (const pt of sum.perTrack) {
      if (pt.bal <= 0.01) continue;
      const amt = Math.min(amount, pt.bal);
      const sim = simulate(cfg, { month: ym, trackId: pt.track.id, amount: amt, mode: 'shorten' }, actuals);
      const years = Math.max(pt.monthsLeft, 1) / 12;
      const fee = cfg.prepayFee && pt.track.type !== 'prime' ? cfg.prepayFee : 0;
      // Prepaying a loan "earns" exactly its rate (plus expected indexation on a CPI-linked track), risk- and tax-free.
      const effRate = (1 + pt.rate) * (1 + (pt.track.cpi ? cfg.inflation || 0 : 0)) - 1;
      const prepayValue = (amt - fee) * Math.pow(1 + effRate, years);
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

  function blank() {
    return { startDate: U.today(), prime: 0.055, inflation: 0.025, tracks: [], primeHistory: [], prepayments: [], rateChanges: [], cpiActual: [], prepayFee: 0, calibrate: true };
  }

  // ---------- live rates ----------
  // Bank of Israel rate (published daily into data/rates.json by a GitHub Action, since the BOI site blocks
  // browser requests) and the CPI straight from the Central Bureau of Statistics.
  const PRIME_SPREAD = 0.015;

  async function fetchLive() {
    const out = { boi: null, cpi: null };
    try {
      const r = await fetch('data/rates.json', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); out.boi = j.boi || null; out.cpi = j.cpi && j.cpi.length ? j.cpi : null; }
    } catch (e) { /* offline or opened from disk */ }
    if (!out.cpi) {
      try {
        const r = await fetch('https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&last=60');
        const j = await r.json();
        out.cpi = ((j.month && j.month[0] && j.month[0].date) || []).map((d) => ({ month: `${d.year}-${U.pad(d.month)}`, pct: d.percent }));
      } catch (e) { /* ignore */ }
    }
    return out;
  }

  // Rewrites the automatic prime / CPI entries of the mortgage from live data. Manual entries for months
  // after the latest published data are kept (e.g. a scenario of a future rate cut).
  function applyLive(cfg, live) {
    const payDay = +String(cfg.startDate).slice(8, 10) || 10;
    const start = U.monthKey(cfg.startDate);
    const changed = { prime: false, cpi: false };
    if (live.boi && live.boi.changes && live.boi.changes.length) {
      const entries = new Map();
      for (const c of live.boi.changes) {
        // A rate change applies to a payment if it took effect on or before the payment day.
        const ym = +c.date.slice(8, 10) <= payDay ? c.date.slice(0, 7) : U.addMonths(c.date.slice(0, 7), 1);
        entries.set(ym < start ? start : ym, Math.round((c.rate / 100 + PRIME_SPREAD) * 100000) / 100000);
      }
      const lastData = U.monthKey(live.boi.asOf || U.today());
      // (changes before the first payment all collapse onto the start month; the last one wins)
      const auto = [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, rate]) => ({ month, rate, src: 'boi' }));
      const manual = (cfg.primeHistory || []).filter((p) => p.src !== 'boi' && p.month > lastData);
      const next = [...auto, ...manual].sort((a, b) => a.month.localeCompare(b.month));
      if (JSON.stringify(next) !== JSON.stringify(cfg.primeHistory)) { cfg.primeHistory = next; changed.prime = true; }
      cfg.prime = auto.length ? auto[auto.length - 1].rate : cfg.prime;
      cfg.live = { ...(cfg.live || {}), boiRate: live.boi.current, nextDecision: live.boi.nextDecision || null, boiAsOf: live.boi.asOf };
    }
    if (live.cpi && live.cpi.length) {
      // Payment in month P is linked to the "known index" — the CPI of month P-2 (published mid P-1).
      const auto = live.cpi.map((c) => ({ month: U.addMonths(c.month, 2), pct: c.pct / 100, src: 'cbs' })).filter((c) => c.month >= start);
      const manual = (cfg.cpiActual || []).filter((c) => c.src !== 'cbs' && !auto.some((a) => a.month === c.month));
      const next = [...auto, ...manual].sort((a, b) => a.month.localeCompare(b.month));
      if (JSON.stringify(next) !== JSON.stringify(cfg.cpiActual)) { cfg.cpiActual = next; changed.cpi = true; }
      const last = live.cpi.reduce((a, b) => (a.month > b.month ? a : b));
      cfg.live = { ...(cfg.live || {}), cpiLast: last };
    }
    if (cfg.live) cfg.live.checked = U.today();
    return changed;
  }

  // Refresh at most once a day (or when forced from the mortgage screen).
  async function refreshLive(force) {
    const s = A.store.get();
    if (!s.mortgage || !s.mortgage.tracks.length) return null;
    if (!force && s.mortgage.live && s.mortgage.live.checked === U.today()) return null;
    const live = await fetchLive();
    if (!live.boi && !live.cpi) return { ok: false };
    let changed;
    A.store.update((st) => { changed = applyLive(st.mortgage, live); });
    return { ok: true, changed, boi: !!live.boi, cpi: !!live.cpi };
  }

  A.M = { compute, summary, simulate, decide, blank, actualPayments, fetchLive, applyLive, refreshLive, PRIME_SPREAD };
})(window.App);
