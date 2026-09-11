(function () {
  "use strict";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function monthKey(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function monthLabelShort(key) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatNumber(amount) {
    const n = Math.abs(Number(amount) || 0);
    const hasCents = Math.round(n * 100) % 100 !== 0;
    return n.toLocaleString(undefined, { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
  }

  function formatMoney(amount, currency) {
    const c = currency != null ? currency : (window.DB ? window.DB.getSettings().currency : "$");
    const n = Number(amount) || 0;
    const sign = n < 0 ? "-" : "";
    return `${sign}${c}${formatNumber(n)}`;
  }

  function formatDateShort(iso) {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Fixed "D MMM YYYY" order regardless of locale, to match the design mockup.
  function formatDateLong(iso) {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function daysInMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  function dateForDay(monthKey, day) {
    const max = daysInMonth(monthKey);
    const d = Math.min(Math.max(1, day || 1), max);
    return `${monthKey}-${pad2(d)}`;
  }

  window.Utils = {
    pad2,
    monthKey,
    monthLabel,
    monthLabelShort,
    shiftMonth,
    todayISO,
    formatMoney,
    formatNumber,
    formatDateShort,
    formatDateLong,
    escapeHtml,
    el,
    daysInMonth,
    dateForDay,
  };
})();
