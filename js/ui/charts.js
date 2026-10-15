// Thin Chart.js wrapper. Colours come from CSS tokens so light/dark both work.
(function (A) {
  const { html, useEffect, useRef, useState } = htmPreact;
  const { U } = A;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Series colours are CSS tokens ('--s1') or literal hex (owner / category colours).
  const colorOf = (c) => (c.startsWith('--') ? css(c) : c);
  const swatch = (c) => (c.startsWith('--') ? `var(${c})` : c);
  const compact = new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 });
  const tickMoney = (v) => '₪' + compact.format(v);

  // Re-render charts when the OS theme flips.
  const themeListeners = new Set();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => themeListeners.forEach((l) => l()));

  function base(kind) {
    const ink2 = css('--ink-2'), grid = css('--grid'), muted = css('--muted');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: kind === 'line' ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true, textDirection: 'rtl', padding: 10, boxPadding: 4,
          backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: css('--ink-2'),
          borderColor: css('--line-strong'), borderWidth: 1,
          callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${U.money(c.parsed.y ?? c.parsed)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, font: { size: 11 } }, border: { color: css('--line-strong') }, reverse: true },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, callback: tickMoney, maxTicksLimit: 6 }, position: 'right' },
      },
      font: { family: css('--font') },
      color: ink2,
    };
  }

  // series: [{ label, data, color: '--s1', kind: 'line'|'bar', dashed }]
  function Chart({ labels, series, kind = 'line', height = 260, stacked = false, options = {} }) {
    const ref = useRef(null);
    const chart = useRef(null);
    const [themeTick, setThemeTick] = useState(0);
    useEffect(() => { const l = () => setThemeTick((x) => x + 1); themeListeners.add(l); return () => themeListeners.delete(l); }, []);

    useEffect(() => {
      if (!ref.current || typeof window.Chart === 'undefined') return;
      const surface = css('--surface');
      const datasets = series.map((s) => {
        const color = colorOf(s.color);
        const type = s.kind || kind;
        return type === 'line'
          ? { type, label: s.label, data: s.data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: color, pointBorderColor: surface, pointBorderWidth: 2, tension: 0.25, borderDash: s.dashed ? [5, 4] : [], spanGaps: true, fill: false }
          : { type, label: s.label, data: s.data, backgroundColor: color, borderColor: surface, borderWidth: stacked ? { top: 2 } : 0, borderRadius: stacked ? 0 : 4, borderSkipped: 'start', maxBarThickness: 34 };
      });
      const opts = base(kind);
      if (stacked) { opts.scales.x.stacked = true; opts.scales.y.stacked = true; }
      Object.assign(opts.plugins, options.plugins || {});
      if (options.scales) for (const k of Object.keys(options.scales)) opts.scales[k] = Object.assign(opts.scales[k] || {}, options.scales[k]);
      if (options.onClick) opts.onClick = options.onClick;
      if (chart.current) chart.current.destroy();
      chart.current = new window.Chart(ref.current, { type: kind, data: { labels, datasets }, options: opts });
      return () => { chart.current && chart.current.destroy(); chart.current = null; };
    }, [JSON.stringify(labels), JSON.stringify(series), kind, stacked, themeTick]);

    const table = html`<table class="tbl small"><thead><tr><th></th>${series.map((s) => html`<th>${s.label}</th>`)}</tr></thead>
      <tbody>${labels.map((l, i) => html`<tr><td>${l}</td>${series.map((s) => html`<td class="n">${s.data[i] == null ? '—' : U.money(s.data[i])}</td>`)}</tr>`)}</tbody></table>`;

    return html`<div>
      ${series.length > 1 && html`<div class="legend">${series.map((s) => html`<span><i style=${'background:' + swatch(s.color)}></i>${s.label}</span>`)}</div>`}
      <div class="chart-box" style=${'height:' + height + 'px'}><canvas ref=${ref} role="img" aria-label=${series.map((s) => s.label).join(', ')}></canvas></div>
      <details class="small muted" style="margin-top:6px"><summary>הצג כטבלה</summary><div class="tbl-wrap">${table}</div></details>
    </div>`;
  }

  A.ui.Chart = Chart;
  A.ui.tickMoney = tickMoney;
})(window.App);
