// Auto-classification. Order of evidence, strongest first:
//   1. your explicit rules (settings) and corrections you made (learned rules)
//   2. how the same merchant was classified in your history (majority vote)
//   3. a close match to a known merchant (same leading words)
//   4. built-in keyword seeds
//   5. the card company's own category (MAX)
(function (A) {
  const { U, CAT } = A;

  function buildIndex(state) {
    const hist = new Map(); // norm desc -> Map("cat|sub" -> weight)
    const today = Date.now();
    for (const t of state.transactions) {
      if (!t.cat || !t.desc || t.needsReview) continue;
      const k = U.normDesc(t.desc);
      if (!k) continue;
      // Recent transactions weigh more, so a re-classification overtakes old habits.
      const ageDays = Math.max(0, (today - Date.parse(t.date)) / 86400000);
      const w = 1 + 1 / (1 + ageDays / 60);
      if (!hist.has(k)) hist.set(k, new Map());
      const m = hist.get(k);
      const key = t.cat + '|' + (t.sub || '');
      m.set(key, (m.get(key) || 0) + w);
    }
    const merchants = [];
    for (const [k, m] of hist) {
      let best = null, bestW = 0, total = 0;
      for (const [ck, w] of m) { total += w; if (w > bestW) { bestW = w; best = ck; } }
      const [cat, sub] = best.split('|');
      merchants.push({ k, tokens: k.split(' '), cat, sub, consistency: bestW / total, count: m.size });
    }
    const exact = new Map(merchants.map((x) => [x.k, x]));
    const rules = (state.rules || []).map((r) => ({ ...r, norm: U.normDesc(r.pattern) }));
    return { exact, merchants, rules, categories: state.categories };
  }

  function valid(index, cat, sub) {
    const subs = index.categories[cat];
    if (!subs) return null;
    return { cat, sub: subs.includes(sub) ? sub : '' };
  }

  function classify(t, index) {
    const norm = U.normDesc(t.desc);
    const clean = U.cleanText(t.desc);
    const out = (cat, sub, conf, reason) => { const v = valid(index, cat, sub); return v ? { ...v, conf, reason } : null; };

    // 1. explicit + learned rules
    for (const r of index.rules) {
      if (!r.norm) continue;
      const hit = r.match === 'exact' ? norm === r.norm : norm.includes(r.norm);
      if (hit) { const res = out(r.cat, r.sub, 0.97, r.source === 'learned' ? 'תיקון קודם שלך' : 'חוק שהגדרת'); if (res) return res; }
    }

    // 2. history
    const h = norm && index.exact.get(norm);
    if (h) {
      const conf = h.consistency >= 0.8 ? 0.92 : 0.6;
      const res = out(h.cat, h.sub, conf, h.consistency >= 0.8 ? 'בית עסק מוכר' : 'בית עסק מוכר (סיווג לא עקבי)');
      if (res) return res;
    }

    // 3. similar merchant: same first two words, or same distinctive first word
    if (norm) {
      const toks = norm.split(' ');
      let best = null, bestScore = 0;
      for (const m of index.merchants) {
        if (m.tokens[0] !== toks[0] || toks[0].length < 3) continue;
        const two = toks.length > 1 && m.tokens.length > 1 && m.tokens[1] === toks[1];
        const setA = new Set(toks), inter = m.tokens.filter((x) => setA.has(x)).length;
        const jac = inter / (new Set([...toks, ...m.tokens]).size);
        const score = (two ? 0.5 : 0) + jac + (m.consistency > 0.8 ? 0.1 : 0);
        if (score > bestScore) { bestScore = score; best = { m, two }; }
      }
      if (best && (best.two || bestScore >= 0.6)) {
        const res = out(best.m.cat, best.m.sub, best.two ? 0.8 : 0.62, 'דומה ל־' + best.m.k);
        if (res) return res;
      }
    }

    // 4. seeds
    for (const [re, cat, sub] of CAT.SEED_RULES) {
      if (re.test(clean)) {
        let res = out(cat, sub, 0.75, 'מילת מפתח');
        if (res && cat === CAT.INCOME && t.flow !== 'in') continue;
        if (res) return res;
      }
    }

    // 5. card-company category
    if (t.hint) {
      for (const [re, cat, sub] of CAT.MAX_HINTS) if (re.test(t.hint)) { const res = out(cat, sub, 0.55, 'קטגוריית חברת האשראי'); if (res) return res; }
    }

    if (t.flow === 'in') return out(CAT.INCOME, 'אחר', 0.4, 'זיכוי לא מזוהה');
    return null;
  }

  // Classify a batch of fresh transactions in place.
  function apply(list, state) {
    const index = buildIndex(state);
    const threshold = state.settings.reviewThreshold;
    for (const t of list) {
      const r = classify(t, index);
      if (r) {
        A.tx.setCategory(t, r.cat, r.sub);
        t.conf = r.conf;
        t.reason = r.reason;
        t.needsReview = r.conf < threshold;
      } else {
        t.conf = 0;
        t.reason = 'לא נמצאה התאמה';
        t.needsReview = true;
      }
    }
    return list;
  }

  // Remember a manual correction so the next import gets it right.
  function learn(state, desc, cat, sub) {
    const norm = U.normDesc(desc);
    if (!norm) return;
    const existing = state.rules.find((r) => r.source === 'learned' && U.normDesc(r.pattern) === norm);
    if (existing) { existing.cat = cat; existing.sub = sub; existing.updated = U.today(); }
    else state.rules.push({ id: U.uid(), pattern: U.cleanText(desc), match: 'exact', cat, sub, source: 'learned', updated: U.today() });
  }

  A.classifier = { buildIndex, classify, apply, learn };
})(window.App);
