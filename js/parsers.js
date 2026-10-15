// File parsers: Isracard / Amex exports, MAX exports, a generic bank statement mapper,
// and a one-time migration from the original Google Sheets workbook.
(function (A) {
  const { U, CAT } = A;

  const sheetRows = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const cell = (v) => (typeof v === 'string' ? U.cleanText(v) : v);
  const rowText = (r) => r.map((c) => U.cleanText(c)).join(' | ');

  function readWorkbook(buffer) {
    return XLSX.read(buffer, { type: 'array', cellDates: false });
  }

  // ---------- format detection ----------
  function detect(wb) {
    if (wb.SheetNames.includes('תיעוד עסקאות')) return 'master';
    for (const name of wb.SheetNames) {
      const rows = sheetRows(wb.Sheets[name]).slice(0, 40);
      for (const r of rows) {
        const t = rowText(r);
        if (t.includes('תאריך רכישה') && t.includes('שם בית עסק')) return 'isracard';
        if (t.includes('תאריך עסקה') && t.includes('שם בית העסק') && t.includes('סכום חיוב')) return 'max';
      }
    }
    return 'generic';
  }

  // Ensures identical rows inside one file (two coffees on the same day) get distinct ids.
  function uniqueIds(list) {
    const seen = new Map();
    for (const c of list) {
      const n = (seen.get(c.extId) || 0) + 1;
      seen.set(c.extId, n);
      if (n > 1) c.extId += '#' + n;
    }
    return list;
  }

  // ---------- Isracard / American Express (Isracard group format) ----------
  function parseIsracard(wb) {
    const out = [];
    for (const name of wb.SheetNames) {
      const rows = sheetRows(wb.Sheets[name]);
      let card = '', method = 'ישראכרט', billing = null, chargeDate = null, cols = null, section = '';

      for (const r of rows.slice(0, 12)) {
        for (const c of r) {
          const s = U.cleanText(c);
          const mc = s.match(/-\s*(\d{4})$/);
          if (mc && !card) { card = mc[1]; if (/אמריקן|american/i.test(s)) method = 'אמריקן'; }
          const mb = s.match(new RegExp('(' + U.HEB_MONTHS.join('|') + ')\\s+(\\d{4})'));
          if (mb && !billing) billing = { m: U.HEB_MONTHS.indexOf(mb[1]) + 1, y: +mb[2] };
          const md = s.match(/לחיוב ב-?\s*(\d{1,2})\.(\d{1,2})/);
          if (md) chargeDate = { d: +md[1], m: +md[2] };
        }
      }
      let chargeIso = null;
      if (chargeDate) {
        let y = billing ? billing.y : new Date().getFullYear();
        if (billing && billing.m === 1 && chargeDate.m === 12) y -= 1;
        chargeIso = U.isoFromParts(y, chargeDate.m, chargeDate.d);
      } else if (billing) chargeIso = U.isoFromParts(billing.y, billing.m, 2);

      for (const r of rows) {
        const t = rowText(r);
        if (t.includes('תאריך רכישה') && t.includes('שם בית עסק')) {
          cols = {};
          r.forEach((h, i) => {
            const s = U.cleanText(h);
            if (s === 'תאריך רכישה') cols.date = i;
            else if (s === 'שם בית עסק') cols.desc = i;
            else if (s === 'סכום עסקה') cols.orig = i;
            else if (s === 'מטבע עסקה') cols.origCur = i;
            else if (s === 'סכום חיוב') cols.amount = i;
            else if (s === 'מטבע חיוב') cols.cur = i;
            else if (s.startsWith('מס\' שובר') || s.startsWith('מס׳ שובר')) cols.voucher = i;
            else if (s === 'פירוט נוסף') cols.details = i;
            else if (s === 'חיוב בחשבון הבנק') cols.bankDate = i;
          });
          continue;
        }
        if (r.length === 1 || (r.filter((x) => x !== '').length === 1 && /עסקאות/.test(t))) { section = t; continue; }
        if (!cols) continue;
        const desc = cell(r[cols.desc]);
        const amount = U.parseAmount(r[cols.amount]);
        if (!desc || isNaN(amount) || /סה"כ|סה״כ/.test(desc)) continue;

        const details = U.cleanText(r[cols.details]);
        const orig = U.parseAmount(r[cols.orig]);
        const cur = U.cleanText(r[cols.cur]) || '₪';
        const origCur = U.cleanText(r[cols.origCur]) || cur;
        let date = U.parseDate(r[cols.date]);
        const bankDate = cols.bankDate != null ? U.parseDate(r[cols.bankDate]) : null;
        let inst = U.parseInstallment(details);
        // Charged less than the purchase, same currency, no discount -> an installment plan without the text.
        if (!inst && !isNaN(orig) && origCur === cur && Math.abs(amount) < Math.abs(orig) - 0.01 && !/הנחה/.test(details)) inst = { n: null, of: null };
        const purchaseDate = date;
        if (inst || !date) date = bankDate || chargeIso || date;
        if (!date) continue;

        const tags = [];
        if (/הוראת קבע/.test(details)) tags.push('הוראת קבע');
        if (/חו"ל|חו״ל/.test(details) || origCur !== '₪') tags.push('חו"ל');
        const voucher = U.cleanText(r[cols.voucher]);
        const noteParts = [];
        if (inst && inst.n) noteParts.push(`תשלום ${inst.n} מתוך ${inst.of}`);
        else if (inst) noteParts.push(`עסקת תשלומים (סכום מקורי ${U.money(orig, true)})`);
        if (inst && purchaseDate) noteParts.push('נרכש ב־' + U.fmtDate(purchaseDate));
        if (cur !== '₪') noteParts.push(`חויב במטבע ${cur} — יש לבדוק סכום בש"ח`);

        out.push({
          date, abs: Math.abs(amount), flow: amount < 0 ? 'in' : 'out', desc, method, card,
          note: noteParts.join(' · '), tags, inst,
          origAmount: isNaN(orig) ? null : orig, origCurrency: origCur,
          extId: `isr:${card}:${voucher || U.normDesc(desc) + ':' + date + ':' + amount}${inst ? ':' + U.monthKey(date) : ''}`,
          source: method === 'אמריקן' ? 'amex' : 'isracard',
          forceReview: cur !== '₪',
        });
      }
    }
    return uniqueIds(out);
  }

  // ---------- MAX ----------
  function parseMax(wb) {
    const out = [];
    for (const name of wb.SheetNames) {
      const rows = sheetRows(wb.Sheets[name]);
      let cols = null;
      for (const r of rows) {
        const t = rowText(r);
        if (t.includes('תאריך עסקה') && t.includes('שם בית העסק')) {
          cols = {};
          r.forEach((h, i) => {
            const s = U.cleanText(h);
            if (s === 'תאריך עסקה') cols.date = i;
            else if (s === 'שם בית העסק') cols.desc = i;
            else if (s === 'קטגוריה') cols.hint = i;
            else if (s.includes('4 ספרות')) cols.card = i;
            else if (s === 'סוג עסקה') cols.type = i;
            else if (s === 'סכום חיוב') cols.amount = i;
            else if (s === 'מטבע חיוב') cols.cur = i;
            else if (s === 'סכום עסקה מקורי') cols.orig = i;
            else if (s === 'מטבע עסקה מקורי') cols.origCur = i;
            else if (s === 'תאריך חיוב') cols.chargeDate = i;
            else if (s === 'הערות') cols.notes = i;
            else if (s === 'תיוגים') cols.labels = i;
          });
          continue;
        }
        if (!cols) continue;
        const desc = cell(r[cols.desc]);
        const amount = U.parseAmount(r[cols.amount]);
        if (!desc || isNaN(amount) || /סך הכל/.test(t)) continue;

        const notes = U.cleanText(r[cols.notes]);
        const type = U.cleanText(r[cols.type]);
        const cur = U.cleanText(r[cols.cur]) || '₪';
        const origCur = U.cleanText(r[cols.origCur]) || cur;
        const purchaseDate = U.parseDate(r[cols.date]);
        const chargeDate = cols.chargeDate != null ? U.parseDate(r[cols.chargeDate]) : null;
        let inst = U.parseInstallment(notes) || (/תשלומים/.test(type) ? { n: null, of: null } : null);
        const date = inst ? (chargeDate || purchaseDate) : (purchaseDate || chargeDate);
        if (!date) continue;
        const card = U.cleanText(r[cols.card]);
        const tags = [];
        if (/הוראת קבע/.test(type)) tags.push('הוראת קבע');
        if (origCur !== '₪') tags.push('חו"ל');
        const noteParts = [];
        if (notes) noteParts.push(notes);
        if (inst && purchaseDate) noteParts.push('נרכש ב־' + U.fmtDate(purchaseDate));
        out.push({
          date, abs: Math.abs(amount), flow: amount < 0 || /זיכוי/.test(type) ? 'in' : 'out', desc, method: 'MAX', card,
          note: noteParts.join(' · '), tags, inst, hint: U.cleanText(r[cols.hint]),
          origAmount: U.parseAmount(r[cols.orig]), origCurrency: origCur,
          extId: `max:${card}:${purchaseDate}:${U.normDesc(desc)}:${amount}${inst ? ':' + U.monthKey(date) : ''}`,
          source: 'max', forceReview: cur !== '₪',
        });
      }
    }
    return uniqueIds(out);
  }

  // ---------- generic bank statement ----------
  function genericRows(wb) {
    // Use the sheet with the most rows.
    let best = null;
    for (const name of wb.SheetNames) { const rows = sheetRows(wb.Sheets[name]); if (!best || rows.length > best.length) best = rows; }
    return best || [];
  }

  function guessMapping(rows) {
    let headerRow = 0, bestScore = -1;
    rows.slice(0, 30).forEach((r, i) => {
      const t = rowText(r);
      const score = ['תאריך', 'תיאור', 'סכום', 'חובה', 'זכות', 'יתרה', 'אסמכתא', 'פרטים', 'פעולה'].filter((w) => t.includes(w)).length;
      if (score > bestScore) { bestScore = score; headerRow = i; }
    });
    const header = (rows[headerRow] || []).map((h) => U.cleanText(h));
    const find = (...pats) => { const i = header.findIndex((h) => pats.some((p) => p.test(h))); return i < 0 ? null : i; };
    const map = {
      headerRow,
      date: find(/^תאריך$/, /^תאריך (פעולה|עסקה|התנועה)/, /^תאריך/),
      desc: find(/תיאור/, /^פעולה$/, /סוג תנועה/, /^פרטים$/),
      desc2: null,
      amount: find(/^סכום/, /זכות\/חובה/, /חובה\/זכות/),
      debit: find(/חובה$/, /^בחובה/, /^חובה/),
      credit: find(/זכות$/, /^בזכות/, /^זכות/),
      balance: find(/יתרה/),
      ref: find(/אסמכתא/),
    };
    const det = find(/^פרטים$/, /הערה/);
    if (det != null && det !== map.desc) map.desc2 = det;
    if (map.amount != null && (map.amount === map.debit || map.amount === map.credit)) { map.debit = null; map.credit = null; }
    if (map.debit != null && map.credit != null) map.amount = null;
    return { map, header };
  }

  function signature(rows, headerRow) { return (rows[headerRow] || []).map((h) => U.cleanText(h)).join('|'); }

  function parseGeneric(rows, map, method = 'העברה בנקאית') {
    const out = [];
    let lastBalance = null, lastDate = null;
    for (let i = map.headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = U.parseDate(r[map.date]);
      if (!date) continue;
      let amount;
      if (map.amount != null) amount = U.parseAmount(r[map.amount]);
      else {
        const d = U.parseAmount(r[map.debit]), c = U.parseAmount(r[map.credit]);
        amount = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
      }
      if (isNaN(amount) || amount === 0) continue;
      const desc = [U.cleanText(r[map.desc]), map.desc2 != null ? U.cleanText(r[map.desc2]) : ''].filter(Boolean).join(' - ');
      const ref = map.ref != null ? U.cleanText(r[map.ref]) : '';
      if (map.balance != null) { const b = U.parseAmount(r[map.balance]); if (!isNaN(b) && (!lastDate || date >= lastDate)) { lastBalance = b; lastDate = date; } }
      out.push({
        date, abs: Math.abs(amount), flow: amount > 0 ? 'in' : 'out', desc, method, card: '',
        note: '', tags: [], inst: null,
        extId: `bank:${date}:${ref}:${amount}:${U.normDesc(desc)}`, source: 'bank',
      });
    }
    return { list: uniqueIds(out), balance: lastBalance, balanceDate: lastDate };
  }

  // ---------- migration from the original workbook ----------
  function parseMaster(wb) {
    const result = { transactions: [], funds: [], insurances: [], mortgage: null, warnings: [] };

    const log = wb.Sheets['תיעוד עסקאות'];
    if (log) {
      const rows = sheetRows(log);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const date = U.parseDate(r[0]);
        const amount = U.parseAmount(r[3]);
        if (!date || isNaN(amount)) continue;
        let cat = U.cleanText(r[1]);
        let sub = U.cleanText(r[2]);
        if (cat === 'אחר') { cat = 'כללי'; if (!sub || sub === 'אחר') sub = 'שונות'; }
        const kind = cat ? CAT.kindOf(cat) : 'expense';
        const flow = kind === 'income' ? (amount >= 0 ? 'in' : 'out') : (amount >= 0 ? 'out' : 'in');
        const note = U.cleanText(r[6]);
        const t = A.tx.make({
          date, abs: Math.abs(amount), flow, desc: U.cleanText(r[5]), method: U.cleanText(r[4]),
          note, inst: U.parseInstallment(note), source: 'sheet',
        });
        t.cat = cat; t.sub = sub; t.amount = U.round2(amount);
        if (!cat) t.needsReview = true;
        result.transactions.push(t);
      }
    }

    const terms = wb.Sheets['תנאים פיננסיים וקופות'];
    if (terms) {
      const rows = sheetRows(terms);
      let mode = null;
      for (const r of rows) {
        const a = U.cleanText(r[0]), b = U.cleanText(r[1]);
        if (a === 'שייכות' && b === 'סוג המוצר') { mode = 'funds'; continue; }
        if (a === 'שייכות' && b === 'סוג הביטוח') { mode = 'ins'; continue; }
        if (!a || !b) { if (mode === 'funds' && !a) mode = null; continue; }
        if (mode === 'funds') {
          result.funds.push({
            id: U.uid(), owner: a, type: b, company: U.cleanText(r[2]), policyNo: r[3] === '' ? '' : String(r[3]),
            track: U.cleanText(r[4]), feeAcc: +r[5] || 0, feeDep: +r[6] || 0, balance: +r[7] || 0,
            status: U.cleanText(r[8]), updated: U.parseDate(r[9]) || '', notes: U.cleanText(r[10]),
            history: r[7] !== '' ? [{ date: U.parseDate(r[9]) || U.today(), balance: +r[7] || 0 }] : [],
          });
        } else if (mode === 'ins') {
          result.insurances.push({
            id: U.uid(), owner: a, type: b, company: U.cleanText(r[2]), policyNo: r[3] === '' ? '' : String(r[3]),
            premium: +r[4] || 0, coverage: +r[5] || 0, renewal: U.parseDate(r[6]) || '', notes: U.cleanText(r[7]),
          });
        }
      }
    }

    const mort = wb.Sheets['משכנתה - לוח סילוקין'];
    if (mort) {
      const rows = sheetRows(mort);
      const paramRow = rows.find((r) => /פריים/.test(U.cleanText(r[0])) && typeof r[1] === 'number') || [];
      const prime = +paramRow[1] || 0.055;
      const inflation = +paramRow[3] || 0.025;
      const tracks = [];
      let i = rows.findIndex((r) => U.cleanText(r[0]) === 'מסלול');
      if (i >= 0) {
        for (i = i + 1; i < rows.length; i++) {
          const r = rows[i];
          const name = U.cleanText(r[0]);
          if (!name || /סה"כ|סה״כ/.test(name)) break;
          const rate = +r[3] || 0;
          const isPrime = /פריים/.test(name);
          tracks.push({
            id: U.uid(), name, principal: +r[1] || 0,
            type: isPrime ? 'prime' : /משתנה/.test(name) ? 'variable' : 'fixed',
            rate: isPrime ? 0 : rate, margin: isPrime ? U.round2((rate - prime) * 10000) / 10000 : 0,
            cpi: /מדד/.test(U.cleanText(r[4])), months: +r[5] || 360,
          });
        }
      }
      const h = rows.findIndex((r) => /^מס/.test(U.cleanText(r[0])) && U.cleanText(r[1]) === 'חודש');
      const primeHistory = [], prepayments = [];
      let startDate = null, lastPrime = null;
      if (h >= 0) {
        for (let j = h + 1; j < rows.length; j++) {
          const r = rows[j];
          const d = U.parseDate(r[1]);
          if (!d) continue;
          if (!startDate) startDate = d;
          const p = +r[2];
          if (p && p !== lastPrime) { primeHistory.push({ month: U.monthKey(d), rate: p }); lastPrime = p; }
          const pre = U.parseAmount(r[13]);
          if (pre > 0) {
            const tName = U.cleanText(r[14]);
            const tr = tracks.find((t) => t.name === tName) || tracks[0];
            prepayments.push({ id: U.uid(), month: U.monthKey(d), trackId: tr && tr.id, amount: pre, mode: 'shorten' });
          }
        }
      }
      if (tracks.length) {
        result.mortgage = { startDate: startDate || U.today(), prime, inflation, tracks, primeHistory, prepayments, rateChanges: [], cpiActual: [], prepayFee: 0 };
      }
    }

    // Categories / sub-categories used in the workbook (e.g. per-person salary lines) so they show up in the app.
    result.categories = {};
    for (const t of result.transactions) {
      if (!t.cat) continue;
      const subs = result.categories[t.cat] || (result.categories[t.cat] = []);
      if (t.sub && !subs.includes(t.sub)) subs.push(t.sub);
    }
    result.people = [...new Set([...result.funds, ...result.insurances].map((x) => x.owner).filter((o) => o && o !== 'משותף'))];
    return result;
  }

  // ---------- duplicate detection against existing data ----------
  function markDuplicates(candidates, existing) {
    const byExt = new Map();
    for (const t of existing) if (t.extId) byExt.set(t.extId, t);
    const used = new Set();
    const byAmount = U.groupBy(existing, (t) => Math.round(Math.abs(t.amount) * 100));
    for (const c of candidates) {
      c.dupOf = null;
      const ext = c.extId && byExt.get(c.extId);
      if (ext) { c.dupOf = ext.id; used.add(ext.id); continue; }
      const pool = byAmount.get(Math.round(c.abs * 100)) || [];
      const norm = U.normDesc(c.desc);
      const window = c.inst ? 25 : 4;
      let best = null, bestGap = Infinity;
      for (const t of pool) {
        if (used.has(t.id) || t.flow !== c.flow) continue;
        const gap = Math.abs(U.daysBetween(t.date, c.date));
        if (gap > window) continue;
        const tn = U.normDesc(t.desc);
        const descOk = tn ? (tn === norm || (norm && (tn.startsWith(norm.slice(0, 10)) || norm.startsWith(tn.slice(0, 10))))) : (t.method === c.method || !t.method);
        if (!descOk) continue;
        if (gap < bestGap) { best = t; bestGap = gap; }
      }
      if (best) { c.dupOf = best.id; used.add(best.id); }
    }

    // Second pass: rows entered by hand may carry a different date (e.g. the whole statement under one day).
    // Accept a same-merchant, same-amount match anywhere inside this file's purchase-date range.
    const dates = candidates.filter((c) => !c.inst).map((c) => c.date).sort();
    if (dates.length) {
      const from = U.addDays(dates[0], -3), to = U.addDays(dates[dates.length - 1], 3);
      for (const c of candidates) {
        if (c.dupOf) continue;
        const norm = U.normDesc(c.desc);
        if (!norm) continue;
        let best = null, bestGap = Infinity;
        for (const t of byAmount.get(Math.round(c.abs * 100)) || []) {
          if (used.has(t.id) || t.extId || t.flow !== c.flow || t.date < from || t.date > to) continue;
          if (t.method && c.method && t.method !== c.method) continue;
          if (U.normDesc(t.desc) !== norm) continue;
          const gap = Math.abs(U.daysBetween(t.date, c.date));
          if (gap < bestGap) { best = t; bestGap = gap; }
        }
        if (best) { c.dupOf = best.id; c.dupLoose = true; used.add(best.id); }
      }
    }
    return candidates;
  }

  A.parsers = { readWorkbook, detect, parseIsracard, parseMax, genericRows, guessMapping, signature, parseGeneric, parseMaster, markDuplicates, sheetRows };
})(window.App);
