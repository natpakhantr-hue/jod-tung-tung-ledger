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

  window.Charts = { pieChart, barChart, PALETTE };
})();
