// Ledgerly service worker. Push first; the offline shell is added in Phase 6.5.
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
