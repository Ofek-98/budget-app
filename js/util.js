// Shared helpers: formatting, dates, text normalisation.
window.App = window.App || {};
(function (A) {
  const U = {};

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

  const moneyFmt = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
  const moneyFmt2 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numFmt = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });

  U.money = (v, decimals) => (decimals ? moneyFmt2 : moneyFmt).format(Math.round((v || 0) * 100) / 100);
  U.num = (v) => numFmt.format(v || 0);
  U.pct = (v, digits = 1) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(digits) + '%');
  U.round2 = (v) => Math.round((v || 0) * 100) / 100;
  U.sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

  U.HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  U.HEB_MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

  const pad = (n) => String(n).padStart(2, '0');
  U.pad = pad;
  U.isoFromParts = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  U.today = () => { const d = new Date(); return U.isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  U.thisMonth = () => U.today().slice(0, 7);

  // Excel serial date -> ISO string.
  U.serialToIso = (serial) => {
    const ms = Math.round((serial - 25569) * 86400000);
    const d = new Date(ms);
    return U.isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };

  // Accepts Excel serials, Date objects and the common Israeli string formats.
  U.parseDate = (v) => {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return U.isoFromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') return v > 20000 && v < 80000 ? U.serialToIso(v) : null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return U.isoFromParts(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return U.isoFromParts(y, +m[2], +m[1]);
    }
    if (/^\d+(\.\d+)?$/.test(s)) return U.parseDate(+s);
    return null;
  };

  U.parseAmount = (v) => {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).replace(/[₪$€\s,‎‏‪-‮]/g, '');
    if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
    if (/-$/.test(s)) s = '-' + s.slice(0, -1);
    return s === '' ? NaN : parseFloat(s);
  };

  U.monthKey = (iso) => (iso || '').slice(0, 7);
  U.monthLabel = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${U.HEB_MONTHS[+m - 1]} ${y}`; };
  U.monthShort = (ym) => { const [y, m] = ym.split('-'); return `${U.HEB_MONTHS_SHORT[+m - 1]} ${y.slice(2)}`; };
  U.addMonths = (ym, n) => {
    let [y, m] = ym.split('-').map(Number);
    m += n;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  };
  U.monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  U.addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return U.isoFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  U.daysBetween =(a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  U.fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };

  // Strips bidi marks, punctuation and long numbers so merchant names compare reliably.
  U.cleanText = (s) => String(s || '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  U.normDesc = (s) => U.cleanText(s).toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.groupBy = (arr, keyFn) => { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  U.clone = (o) => JSON.parse(JSON.stringify(o));

  U.download = (filename, text, type = 'application/json') => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  U.readFileBuffer = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });
  U.readFileText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });

  // Installment text like "תשלום 2 מתוך 3".
  U.parseInstallment = (s) => {
    const m = String(s || '').match(/תשלום\s*(\d+)\s*מתוך\s*(\d+)/);
    return m ? { n: +m[1], of: +m[2] } : null;
  };

  A.U = U;
})(window.App);
