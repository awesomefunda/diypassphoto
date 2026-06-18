// DIYPassPhoto service worker — offline app shell.
// Navigations are network-first (so fresh HTML + asset versions load when online,
// cached copy is the offline fallback). Same-origin static assets are cache-first
// and keyed by their ?v= URL, so a deploy bumps the URL and the new file is fetched.
const CACHE = "dpp-shell-v1";
const CORE = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // let the MediaPipe CDN etc. hit the network

  if (req.mode === "navigate") {
    // network-first for pages
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then(m => m || caches.match("/")))
    );
    return;
  }
  // cache-first for static assets (URL is version-keyed, so this stays fresh across deploys)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => undefined))
  );
});
