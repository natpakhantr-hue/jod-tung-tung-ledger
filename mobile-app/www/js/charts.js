(function () {
  "use strict";

  const PALETTE = [
    "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
  ];

  // data: [{label, value, color?}]
  function pieChart(data, opts) {
    opts = opts || {};
    const size = opts.size || 160;
    const r = size / 2;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total <= 0) {
      return `<div class="chart-empty">No data yet</div>`;
    }
    let angle = -90;
    const paths = data
      .map((d, i) => {
        const frac = d.value / total;
        const start = angle;
        const sweep = frac * 360;
        angle += sweep;
        const color = d.color || PALETTE[i % PALETTE.length];
        if (frac >= 0.9999) {
          return `<circle cx="${r}" cy="${r}" r="${r}" fill="${color}"></circle>`;
        }
        const large = sweep > 180 ? 1 : 0;
        const x1 = r + r * Math.cos((Math.PI * start) / 180);
        const y1 = r + r * Math.sin((Math.PI * start) / 180);
        const x2 = r + r * Math.cos((Math.PI * (start + sweep)) / 180);
        const y2 = r + r * Math.sin((Math.PI * (start + sweep)) / 180);
        return `<path d="M${r},${r} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"></path>`;
      })
      .join("");

    const legend = data
      .map((d, i) => {
        const color = d.color || PALETTE[i % PALETTE.length];
        const pct = ((d.value / total) * 100).toFixed(0);
        const sub = d.sub ? `<div class="legend-sub">${d.sub}</div>` : "";
        return `<div class="legend-row"><div class="legend-top"><span class="legend-dot" style="background:${color}"></span><span class="legend-label">${d.label}</span><span class="legend-value">${pct}%</span></div>${sub}</div>`;
      })
      .join("");

    return `
      <div class="chart-row">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
        <div class="legend">${legend}</div>
      </div>`;
  }

  // data: [{label, value, color?}]
  function barChart(data, opts) {
    opts = opts || {};
    const max = Math.max(1, ...data.map((d) => d.value));
    return `<div class="bar-chart">${data
      .map((d, i) => {
        const color = d.color || PALETTE[i % PALETTE.length];
        const pct = Math.max(2, (d.value / max) * 100);
        return `
        <div class="bar-row">
          <div class="bar-label">${d.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="bar-value">${d.valueLabel != null ? d.valueLabel : d.value}</div>
        </div>`;
      })
      .join("")}</div>`;
  }

  // Rounds up to a "nice" axis max (1/2/5/10 × a power of ten) so tick
  // labels read as round numbers instead of whatever the raw max happens
  // to be.
  function niceCeil(n) {
    if (n <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(n)));
    const norm = n / mag;
    const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return niceNorm * mag;
  }

  // Compares several series against a shared axis, one grouped set of bars
  // per row — e.g. Income/Outcome/Net side by side for each month, instead
  // of three separate single-series charts.
  // rows: [{label, values: [n, n, ...]}]; series: [{label, color}, ...]
  // (values[i] is drawn with series[i]'s color; both arrays line up by index).
  function groupedBarChart(rows, series) {
    if (!rows.length) return `<div class="chart-empty">No data yet</div>`;
    const fmt = window.Utils && window.Utils.formatNumber ? window.Utils.formatNumber : (n) => Math.round(n);
    const max = niceCeil(Math.max(1, ...rows.flatMap((r) => r.values.map((v) => Math.abs(v)))));

    const legend = series
      .map((s) => `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>`)
      .join("");
    // Label and its bar-group are one flex row (not two parallel columns) so
    // they can never drift out of alignment with each other.
    const dataRows = rows
      .map(
        (r) => `
        <div class="grouped-chart-row">
          <div class="grouped-chart-label">${r.label}</div>
          <div class="grouped-chart-group">
            ${r.values
              .map((v, i) => {
                const pct = Math.max(2, (Math.abs(v) / max) * 100);
                const color = (series[i] && series[i].color) || PALETTE[i % PALETTE.length];
                return `<div class="grouped-chart-track"><div class="grouped-chart-fill" style="width:${pct}%;background:${color}"></div></div>`;
              })
              .join("")}
          </div>
        </div>`
      )
      .join("");
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${fmt(Math.round(max * f))}</span>`).join("");

    return `
      <div class="grouped-chart">
        <div class="grouped-chart-legend">${legend}</div>
        <div class="grouped-chart-plot">
          <div class="grouped-chart-grid"></div>
          <div class="grouped-chart-rows">${dataRows}</div>
        </div>
        <div class="grouped-chart-axis-row">
          <div class="grouped-chart-axis-spacer"></div>
          <div class="grouped-chart-axis-ticks">${ticks}</div>
        </div>
      </div>`;
  }

  window.Charts = { pieChart, barChart, groupedBarChart, PALETTE };
})();
