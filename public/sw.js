// Ledgerly service worker: an offline page, a read-only copy of pages already visited, and push.
//
// Privacy: saved pages can hold a business's figures, so they are cleared at sign-out (the app sends
// {type: "clear"}) and only the most recent MAX_PAGES are kept. Sign-in, portal, public and API
// pages are never saved. Nothing is ever sent from here: only GET page loads and static files are touched.
const VERSION = "v1";
const PAGES = "ledgerly-pages-" + VERSION;
const STATIC = "ledgerly-static-" + VERSION;
const OFFLINE = "/offline";
const MAX_PAGES = 60;
const PRIVATE_PREFIXES = ["/api/", "/login", "/auth", "/portal", "/p/", "/invite", "/book", "/styleguide", "/offline"];

function isPrivate(pathname) {
  return PRIVATE_PREFIXES.some((p) => pathname.startsWith(p));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.add(OFFLINE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== PAGES && n !== STATIC).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear") event.waitUntil(caches.delete(PAGES));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
}

async function page(request) {
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) {
      const cache = await caches.open(PAGES);
      const key = request.url;
      await cache.delete(key); // re-saving moves it to the "most recent" end
      await cache.put(key, res.clone());
      await trim(cache);
    }
    return res;
  } catch {
    const saved = await (await caches.open(PAGES)).match(request.url);
    if (saved) return saved;
    const offline = await (await caches.open(STATIC)).match(OFFLINE);
    return offline || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function file(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request.url, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa/")) {
    event.respondWith(file(request));
    return;
  }
  if (request.mode === "navigate" && !isPrivate(url.pathname)) event.respondWith(page(request));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Ledgerly";
  const href = typeof data.href === "string" && data.href.startsWith("/") ? data.href : "/";
  event.waitUntil(self.registration.showNotification(title, { icon: "/pwa/icon-192.png", badge: "/pwa/icon-192.png", data: { href } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(href);
          return c.focus();
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
