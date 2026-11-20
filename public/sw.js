// Snowline service worker: offline app + saved forecasts, and push notifications
const V = "snowline-v5";
const SHELL = ["/", "/index.html", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png", "/manifest.webmanifest"];
const WEATHER = /(^|\.)open-meteo\.com$/;
const STATIC_CDN = /(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.startsWith("snowline-")).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(V);
  try {
    const res = await (timeoutMs ? Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]) : fetch(req));
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(V); const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req); if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, 6000).catch(() => caches.match("/"))); return; }
    e.respondWith(networkFirst(req, u.pathname.startsWith("/api/") ? 12000 : 6000)); return;
  }
  if (WEATHER.test(u.hostname)) { e.respondWith(networkFirst(req, 15000)); return; }
  if (STATIC_CDN.test(u.hostname)) { e.respondWith(cacheFirst(req)); return; }
});

self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Snowline", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Snowline", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || "snowline", data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ("focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
