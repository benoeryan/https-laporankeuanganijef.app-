// NOTE: Push notifications are handled by firebase-messaging-sw.js (separate service worker).
// This SW handles caching only and should not interfere with the FCM messaging SW.
const CACHE_NAME = "keuangan-ijef-v5";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          if (
            clientList[i].url.includes(self.location.origin) &&
            "focus" in clientList[i]
          ) {
            return clientList[i].focus();
          }
        }
        return self.clients.openWindow("/");
      })
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Network-first: always try to get fresh content
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        // Only cache non-JS/non-HTML assets (images, fonts, etc)
        if (
          !e.request.url.includes(".js") &&
          !e.request.url.includes(".html")
        ) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
