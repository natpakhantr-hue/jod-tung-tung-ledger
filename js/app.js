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

  // Native-only (Capacitor Android wrapper): on app open, check every new photo
  // in the user's chosen slip album(s) since last time — could be several if the
  // app's been closed a while — and auto-log any that look like a real slip.
  // Every photo checked is remembered by id so nothing is ever scanned twice
  // or silently skipped. No popup, ever. Only scans the configured album(s),
  // never the whole gallery.
  //
  // Each album gets its own one-time baseline: the moment an album is newly
  // selected (a fresh install counts too — every selected album starts
  // unbaselined), every photo already sitting in it is marked as seen WITHOUT
  // being logged. Only photos added after that point are ever auto-logged.
  function photoIdFromUri(uri) {
    return uri.split("/").pop();
  }

  async function checkNativeGallery() {
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!isNative) return;
    const GalleryScan = window.Capacitor.Plugins && window.Capacitor.Plugins.GalleryScan;
    if (!GalleryScan) return;

    const albums = DB.getSettings().slipAlbums || [];
    if (!albums.length) {
      if (!localStorage.getItem("slip_album_hint_shown")) {
        localStorage.setItem("slip_album_hint_shown", "1");
        toast("Set your Bank Slip Album(s) in Settings to enable auto-scan");
      }
      return;
    }

    try {
      let perm = await GalleryScan.checkPhotoPermission();
      if (!perm.granted) perm = await GalleryScan.requestPhotoPermission();
      if (!perm.granted) return;

      const baselined = DB.getSettings().baselinedAlbums || [];
      const newAlbums = albums.filter((a) => !baselined.includes(a));
      const knownAlbums = albums.filter((a) => baselined.includes(a));

      // Any album picked for the first time: baseline it on its own (a wide
      // "since 0" query so nothing already in it gets treated as new), without
      // logging anything from it yet.
      if (newAlbums.length) {
        for (const album of newAlbums) {
          const res = await GalleryScan.getRecentImages({ since: 0, limit: 300, album });
          (res.images || []).forEach((img) => DB.markPhotoScanned(photoIdFromUri(img.uri)));
        }
        DB.updateSettings({ baselinedAlbums: baselined.concat(newAlbums) });
      }

      if (!knownAlbums.length) {
        localStorage.setItem("gallery_last_scan_ts", String(Date.now()));
        return;
      }

      // "since" just bounds the query for performance; DB.isPhotoScanned is the
      // real source of truth for what's already been read, so nothing gets missed
      // or double-processed even if this timestamp drifts.
      const lastCheck = Number(localStorage.getItem("gallery_last_scan_ts") || 0) || (Date.now() - 7 * 24 * 60 * 60 * 1000);
      const now = Date.now();

      // The native plugin filters by one album per call, so query each already-
      // baselined album separately and merge.
      let images = [];
      for (const album of knownAlbums) {
        const res = await GalleryScan.getRecentImages({ since: lastCheck, limit: 50, album });
        images = images.concat(res.images || []);
      }
      const seenUris = new Set();
      images = images.filter((img) => (seenUris.has(img.uri) ? false : (seenUris.add(img.uri), true)));
      images.sort((a, b) => b.dateAdded - a.dateAdded);

      localStorage.setItem("gallery_last_scan_ts", String(now));
      if (!images.length) return;

      const unseen = images.filter((img) => !DB.isPhotoScanned(photoIdFromUri(img.uri))).reverse(); // oldest first
      if (!unseen.length) return;

      let logged = 0;
      let unreadable = 0;
      for (const img of unseen) {
        const id = photoIdFromUri(img.uri);
        try {
          const { base64 } = await GalleryScan.readImageBase64({ uri: img.uri });
          const blob = await (await fetch("data:image/jpeg;base64," + base64)).blob();
          const dataUrl = await window.Views.blobToResizedDataUrl(blob, 900);
          const result = await window.Views.autoLogSlip(dataUrl);
          if (result.logged) logged++;
          else unreadable++;
        } catch (e) {
          unreadable++;
        }
        DB.markPhotoScanned(id);
      }

      if (logged) render();
      if (logged || unreadable) {
        const parts = [];
        if (logged) parts.push(`${logged} slip${logged === 1 ? "" : "s"} logged automatically`);
        if (unreadable) parts.push(`${unreadable} photo${unreadable === 1 ? "" : "s"} skipped (no amount found)`);
        toast(parts.join(" · "));
      }
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

  let scanInFlight = false;
  async function runChecks() {
    if (scanInFlight) return;
    scanInFlight = true;
    try {
      await checkPendingSharedPhoto();
      await checkNativeGallery();
    } finally {
      scanInFlight = false;
    }
  }

  function hideBootSplash() {
    const splash = document.getElementById("boot-splash");
    if (splash) {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 300);
    }
  }

  function showUpdateBanner(text) {
    let b = document.getElementById("update-banner");
    if (!b) {
      b = Utils.el(`<div id="update-banner" class="update-banner"><div class="boot-spinner"></div><span id="update-banner-text"></span></div>`);
      document.body.appendChild(b);
    }
    b.querySelector("#update-banner-text").textContent = text;
    requestAnimationFrame(() => b.classList.add("show"));
  }

  // Fetches the tiny version.json (always network-fresh, bypassing cache) and
  // compares it to the version this page was actually loaded with. Only when
  // they differ do we show the "Updating…" banner and reload — so resuming the
  // app never flickers or reloads unless something genuinely changed.
  async function checkForUpdate() {
    try {
      const res = await fetch("version.json", { cache: "no-store" });
      const data = await res.json();
      if (data.version && data.version !== window.APP_VERSION) {
        showUpdateBanner("Updating to the latest version…");
        setTimeout(() => location.reload(), 700);
        return true;
      }
    } catch (e) {
      // offline or unreachable — just skip, nothing to show the user
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    buildShell();
    render();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    runChecks();
    hideBootSplash();
  });

  // Android doesn't reload the page when the app is resumed from the background —
  // it's the same live WebView coming back to the foreground, still running whatever
  // JS was already in memory — so DOMContentLoaded never fires again and code changes
  // never show up on their own. Check for a real update on resume, at most once a
  // minute, and only reload (with a visible banner) if one actually exists.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const last = Number(sessionStorage.getItem("last_update_check") || 0);
    if (Date.now() - last > 60000) {
      sessionStorage.setItem("last_update_check", String(Date.now()));
      const updating = await checkForUpdate();
      if (updating) return;
    }
    runChecks();
  });
})();
