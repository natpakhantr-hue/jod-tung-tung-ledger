const CACHE = "ledger-cache-v4";
const ASSETS = [
  "./",
  "index.html",
  "version.json",
  "manifest.webmanifest",
  "css/style.css",
  "js/db.js",
  "js/utils.js",
  "js/charts.js",
  "js/ocr.js",
  "js/views.js",
  "js/app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("photo");
    if (file) {
      const inbox = await caches.open("shared-photo-inbox");
      await inbox.put(
        "/__shared_photo__",
        new Response(file, { headers: { "Content-Type": file.type || "image/jpeg" } })
      );
    }
  } catch (e) {
    console.error("share-target handling failed", e);
  }
  return Response.redirect("./index.html?shared=1", 303);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  if (e.request.method !== "GET") return;

  // Network-first, bypassing the HTTP disk cache too (GitHub Pages sends
  // max-age=600, which would otherwise let a stale copy slip through for up to
  // 10 minutes after a deploy) — always fetch the latest app code when online.
  // Cache is only a fallback for when there's no connection at all.
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
