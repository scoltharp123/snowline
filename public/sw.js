// Snowline service worker: offline app + saved forecasts, and push notifications
const V = "snowline-v40";
const TRAILMAPS = "sl-trailmaps";   // official trail maps the user chose to download; kept across app updates
const SHELL = ["/", "/index.html", "/app.js?v=__APPV__", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png", "/manifest.webmanifest"];
const WEATHER = /(^|\.)open-meteo\.com$/;
const STATIC_CDN = /(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.startsWith("snowline-")).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

// Fresh from the network when it answers in time; otherwise the saved copy right away while the network
// answer keeps going in the background and refreshes the saved copy for next time.
async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(V);
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
  const saved = () => cache.match(req, { ignoreVary: true });
  try {
    return await (timeoutMs ? Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]) : net);
  } catch (err) {
    const hit = await saved();
    if (hit) return hit;
    return net;   // nothing saved: keep waiting for the network
  }
}
// The app itself opens instantly from the saved copy; the network copy is fetched alongside and saved for
// next time. If the app changed, open pages are told so they can offer a one-tap refresh.
async function appShell(e) {
  const cache = await caches.open(V);
  const saved = await cache.match("/", { ignoreSearch: true });
  const net = fetch(e.request.url.split("#")[0], { cache: "no-cache" }).then(async res => {
    if (res && res.ok && res.type === "basic") {
      const old = saved && saved.headers.get("etag"), neu = res.headers.get("etag");
      await cache.put("/", res.clone());
      if (saved && old && neu && old !== neu) (await self.clients.matchAll({ type: "window" })).forEach(c => c.postMessage({ type: "app-updated" }));
    }
    return res;
  });
  if (saved) { e.waitUntil(net.catch(() => {})); return saved; }
  return net.catch(() => caches.match("/index.html"));
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
    // Trail maps: the downloaded copy if there is one, otherwise straight from the network (not auto-cached; they're large).
    if (u.pathname.startsWith("/tm/")) { e.respondWith(caches.open(TRAILMAPS).then(c => c.match(req)).then(hit => hit || fetch(req))); return; }
    if (req.mode === "navigate" && (u.pathname === "/" || u.pathname === "/index.html")) { e.respondWith(appShell(e)); return; }
    if (u.pathname === "/app.js") { e.respondWith(cacheFirst(req)); return; }   // fingerprinted: a new version has a new address
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, 2500).catch(() => caches.match("/"))); return; }
    e.respondWith(networkFirst(req, u.pathname.startsWith("/api/pistes") ? 20000 : u.pathname.startsWith("/api/") ? 12000 : 6000)); return;
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
