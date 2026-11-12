// "המשפחה שלנו" — Service Worker: עבודה ללא חיבור + התראות דחיפה
const VERSION = "1.0.0";
const CACHE = "our-family-" + VERSION;
const PRECACHE = [
  "./", "./index.html", "./styles.css?v=1.0.0", "./app.js?v=1.0.0", "./config.js", "./manifest.webmanifest", "./version.json",
  "./icons/icon-192.png", "./icons/icon-maskable-512.png", "./icons/badge-96.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
  "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  // מוחק רק מטמון של גרסאות קודמות של קבצי האפליקציה — נתוני המשתמשים נשמרים בשרת ולא נפגעים
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("our-family-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // נתונים חיים — תמיד מהשרת
  if (url.pathname.endsWith("/version.json")) { e.respondWith(fetch(req).catch(() => caches.match("./version.json"))); return; }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", cp)); return r; }).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && (url.origin === location.origin || url.hostname.includes("jsdelivr") || url.hostname.includes("gstatic") || url.hostname.includes("googleapis"))) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return r;
  })));
});

self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: "❤️ המשפחה שלנו", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "❤️ המשפחה שלנו", {
    body: d.body || "", icon: "./icons/icon-192.png", badge: "./icons/badge-96.png", dir: "rtl", lang: "he",
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || "./" }, vibrate: [120, 60, 120],
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); c.postMessage({ type: "navigate", route: new URL(target).hash.slice(1) || "home" }); return; } }
    return self.clients.openWindow(target);
  }));
});
