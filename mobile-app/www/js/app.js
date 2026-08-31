(function () {
  "use strict";

  const state = {
    month: Utils.monthKey(),
  };

  const routes = {
    dashboard: () => window.Views.dashboard(state),
    pockets: () => window.Views.pocketsList(state),
    pocket: (id) => window.Views.pocketDetail(state, id),
    stats: () => window.Views.stats(state),
    settings: () => window.Views.settings(state),
  };

  const NAV = [
    { route: "dashboard", icon: "🏠", label: "Home" },
    { route: "pockets", icon: "💼", label: "Pockets" },
    { route: "stats", icon: "📊", label: "Stats" },
    { route: "settings", icon: "⚙️", label: "Settings" },
  ];

  function parseHash() {
    const hash = location.hash.replace(/^#\/?/, "");
    const parts = hash.split("/").filter(Boolean);
    return { name: parts[0] || "dashboard", arg: parts[1] };
  }

  function render() {
    const { name, arg } = parseHash();
    const main = document.getElementById("main-content");
    const fn = routes[name] || routes.dashboard;
    main.innerHTML = "";
    const content = fn(arg);
    if (content) main.appendChild(content);

    document.querySelectorAll("nav.bottom-nav a").forEach((a) => {
      a.classList.toggle("active", a.dataset.route === name || (name === "pocket" && a.dataset.route === "pockets"));
    });

    const fab = document.getElementById("fab");
    fab.style.display = name === "dashboard" ? "block" : "none";

    window.scrollTo(0, 0);
  }

  function setMonth(key) {
    state.month = key;
    render();
  }

  let toastTimer;
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = Utils.el(`<div id="toast" class="toast"></div>`);
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function closeSheet() {
    const b = document.querySelector(".sheet-backdrop");
    if (b) b.remove();
  }

  function openSheet(titleHtml, bodyHtml, onMount) {
    closeSheet();
    const backdrop = Utils.el(`
      <div class="sheet-backdrop">
        <div class="sheet">
          <h3>${titleHtml}</h3>
          <div class="sheet-body">${bodyHtml}</div>
        </div>
      </div>
    `);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeSheet();
    });
    document.body.appendChild(backdrop);
    if (onMount) onMount(backdrop.querySelector(".sheet-body"), backdrop);
    return backdrop;
  }

  window.App = {
    state,
    render,
    setMonth,
    toast,
    openSheet,
    closeSheet,
    navigate: (hash) => { location.hash = hash; },
  };

  function buildShell() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <header class="topbar">
        <h1 id="page-title">Ledger</h1>
        <div class="actions"></div>
      </header>
      <main id="main-content"></main>
      <button id="fab" class="fab" title="Add transaction">+</button>
      <nav class="bottom-nav">
        ${NAV.map((n) => `<a href="#/${n.route}" data-route="${n.route}"><span class="ic">${n.icon}</span>${n.label}</a>`).join("")}
      </nav>
    `;
    document.getElementById("fab").addEventListener("click", () => {
      window.Views.openTransactionForm(state);
    });
  }

  window.addEventListener("hashchange", render);
  // Native-only (Capacitor Android wrapper): on app open, silently check for a new
  // photo since last time and auto-scan it. Only surfaces a draft if it actually
  // looks like a slip (an amount was detected) — otherwise it's invisible to the user.
  async function checkNativeGallery() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return;
    const GalleryScan = window.Capacitor.Plugins && window.Capacitor.Plugins.GalleryScan;
    if (!GalleryScan) return;

    try {
      let perm = await GalleryScan.checkPhotoPermission();
      if (!perm.granted) perm = await GalleryScan.requestPhotoPermission();
      if (!perm.granted) return;

      const lastCheck = Number(localStorage.getItem("gallery_last_scan_ts") || 0);
      const now = Date.now();
      const { images } = await GalleryScan.getRecentImages({ since: lastCheck, limit: 5 });
      localStorage.setItem("gallery_last_scan_ts", String(now));
      if (!images || !images.length) return;

      const target = images[0];
      const { base64 } = await GalleryScan.readImageBase64({ uri: target.uri });
      const blob = await (await fetch("data:image/jpeg;base64," + base64)).blob();
      await window.Views.handleSharedPhoto(blob, { silentIfNoAmount: true });
    } catch (e) {
      console.error("Native gallery scan failed", e);
    }
  }

  async function checkPendingSharedPhoto() {
    if (!("caches" in window)) return;
    try {
      const cache = await caches.open("shared-photo-inbox");
      const res = await cache.match("/__shared_photo__");
      if (!res) return;
      const blob = await res.blob();
      await cache.delete("/__shared_photo__");
      history.replaceState(null, "", location.pathname + location.hash);
      window.Views.handleSharedPhoto(blob);
    } catch (e) {
      console.error("Failed to read shared photo", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    buildShell();
    render();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    checkPendingSharedPhoto();
    checkNativeGallery();
  });
})();
