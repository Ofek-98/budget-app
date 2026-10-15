// Shared UI pieces.
(function (A) {
  const { html, useState, useEffect, useRef } = htmPreact;
  const { U } = A;

  // ---- toasts ----
  const toastListeners = new Set();
  let toasts = [];
  A.toast = (text, type = 'info', action = null, ms = 4500) => {
    const t = { id: U.uid(), text, type, action };
    toasts = [...toasts, t];
    toastListeners.forEach((l) => l(toasts));
    setTimeout(() => { toasts = toasts.filter((x) => x !== t); toastListeners.forEach((l) => l(toasts)); }, ms);
  };
  function Toasts() {
    const [list, setList] = useState(toasts);
    useEffect(() => { toastListeners.add(setList); return () => toastListeners.delete(setList); }, []);
    return html`<div class="toasts" role="status">${list.map((t) => html`
      <div class=${'toast ' + t.type} key=${t.id}><span>${t.text}</span>
        ${t.action && html`<button onClick=${() => { t.action.fn(); toasts = toasts.filter((x) => x !== t); toastListeners.forEach((l) => l(toasts)); }}>${t.action.label}</button>`}
      </div>`)}</div>`;
  }

  function Modal({ title, onClose, children, narrow }) {
    useEffect(() => {
      const k = (e) => e.key === 'Escape' && onClose();
      window.addEventListener('keydown', k);
      return () => window.removeEventListener('keydown', k);
    }, [onClose]);
    return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${'modal' + (narrow ? ' narrow' : '')} role="dialog" aria-modal="true" aria-label=${title}>
        <div class="modal-h"><h2>${title}</h2><button class="btn ghost sm" onClick=${onClose} aria-label="סגור">✕</button></div>
        ${children}
      </div></div>`;
  }

  // Shows change vs a reference. goodWhenUp: income/saving true, expense false.
  function Delta({ cur, ref, goodWhenUp = true, label }) {
    if (ref == null || !isFinite(ref) || Math.abs(ref) < 1) return null;
    const diff = cur - ref;
    if (Math.abs(diff) < 1) return html`<span class="delta">ללא שינוי ${label || ''}</span>`;
    const up = diff > 0;
    const good = up === goodWhenUp;
    return html`<span class=${'delta ' + (good ? 'good' : 'bad')} title=${'לעומת ' + U.money(ref)}>${up ? '▲' : '▼'} ${U.pct(Math.abs(diff / ref), 0)} ${label || ''}</span>`;
  }

  // onClick makes the tile a link to the rows behind the number.
  function Tile({ label, value, foot, hero, title, onClick, active }) {
    const cls = 'tile' + (hero ? ' hero' : '') + (onClick ? ' clickable' : '') + (active ? ' active' : '');
    const keys = onClick ? { role: 'button', tabIndex: 0, onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) } : {};
    return html`<div class=${cls} title=${title || (onClick ? 'לחצו לפירוט' : '')} onClick=${onClick} ...${keys}>
      <div class="label">${label}${onClick && html`<span class="go" aria-hidden="true">‹</span>`}</div><div class="value">${value}</div>${foot && html`<div class="foot">${foot}</div>`}</div>`;
  }

  // Coloured name chip for a household member.
  function OwnerChip({ owner, people }) {
    const c = A.CAT.ownerColor(owner, people);
    return c ? html`<span class="chip" style=${'--c:' + c}>${owner}</span>` : null;
  }

  // Row of filter dropdowns. filters: [{ key, label, options: [[value, text]] }]
  function FilterBar({ filters, value, onChange, children }) {
    const active = filters.some((f) => value[f.key]);
    return html`<div class="filterbar">
      ${filters.map((f) => html`<label class="row small" style="gap:4px;flex-wrap:nowrap"><span class="muted">${f.label}</span>
        <select class="select sm" value=${value[f.key] || ''} onChange=${(e) => onChange({ ...value, [f.key]: e.target.value })}>
          <option value="">הכל</option>${f.options.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></label>`)}
      ${children}
      ${active && html`<button class="btn sm ghost" onClick=${() => onChange({})}>ניקוי סינון</button>`}
    </div>`;
  }

  function MonthPicker({ months, value, onChange }) {
    const list = months.includes(value) ? months : [...months, value].sort();
    const i = list.indexOf(value);
    return html`<div class="row">
      <button class="btn sm" disabled=${i <= 0} onClick=${() => onChange(list[i - 1])} aria-label="חודש קודם">→</button>
      <select class="select" value=${value} onChange=${(e) => onChange(e.target.value)}>
        ${[...list].reverse().map((m) => html`<option value=${m}>${U.monthLabel(m)}</option>`)}
      </select>
      <button class="btn sm" disabled=${i >= list.length - 1} onClick=${() => onChange(list[i + 1])} aria-label="חודש הבא">←</button>
    </div>`;
  }

  function CatSelect({ categories, cat, sub, onChange, small, allowEmpty = true }) {
    const cls = 'select' + (small ? ' sm' : '');
    const subs = categories[cat] || [];
    const color = A.CAT.colorOf(cat);
    return html`<span class="row" style="gap:4px;flex-wrap:nowrap">
      <select class=${cls + (color ? ' cat-sel' : '')} style=${color ? '--cat:' + color : ''} value=${cat || ''} onChange=${(e) => onChange(e.target.value, '')}>
        ${allowEmpty && html`<option value="">— בחר קטגוריה —</option>`}
        ${Object.keys(categories).map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
      ${cat && html`<select class=${cls} value=${sub || ''} onChange=${(e) => onChange(cat, e.target.value)}>
        <option value="">— תת־קטגוריה —</option>
        ${subs.map((s) => html`<option value=${s}>${s}</option>`)}
      </select>`}
    </span>`;
  }

  // Number input that commits on blur / Enter (avoids re-rendering the world on every keystroke).
  function NumInput({ value, onCommit, step = 'any', small, pct, placeholder, width }) {
    const shown = value == null || value === '' ? '' : pct ? U.round2(value * 100 * 100) / 100 : value;
    const [v, setV] = useState(shown);
    useEffect(() => setV(shown), [shown]);
    const commit = () => {
      if (String(v) === String(shown)) return;
      const n = v === '' ? null : parseFloat(String(v).replace(/,/g, ''));
      if (v !== '' && isNaN(n)) { setV(shown); return; }
      onCommit(n == null ? null : pct ? n / 100 : n);
    };
    return html`<input class=${'input num' + (small ? ' sm' : '')} style=${width ? 'width:' + width : ''} inputmode="decimal" value=${v} placeholder=${placeholder || ''}
      onInput=${(e) => setV(e.target.value)} onBlur=${commit} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} step=${step} />`;
  }

  function TextInput({ value, onCommit, small, placeholder, type = 'text', width }) {
    const [v, setV] = useState(value || '');
    useEffect(() => setV(value || ''), [value]);
    return html`<input class=${'input' + (small ? ' sm' : '')} type=${type} style=${width ? 'width:' + width : ''} value=${v} placeholder=${placeholder || ''}
      onInput=${(e) => setV(e.target.value)} onBlur=${() => v !== (value || '') && onCommit(v)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`;
  }

  function Seg({ options, value, onChange }) {
    return html`<div class="seg" role="group">${options.map(([v, label]) => html`<button class=${v === value ? 'on' : ''} aria-pressed=${v === value} onClick=${() => onChange(v)}>${label}</button>`)}</div>`;
  }

  function Empty({ title, children }) {
    return html`<div class="empty"><div class="big">${title}</div>${children}</div>`;
  }

  A.ui = { html, Toasts, Modal, Delta, Tile, OwnerChip, FilterBar, MonthPicker, CatSelect, NumInput, TextInput, Seg, Empty };
})(window.App);
