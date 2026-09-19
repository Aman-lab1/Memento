const CACHE_NAME = "memento-v1.7.2";

const APP_SHELL_PATHS = [
  "./",
  "./index.html",
  "./pages/person.html",
  "./pages/history.html",
  "./pages/add-person.html",
  "./src/app.js",
  "./src/style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const shellUrls = APP_SHELL_PATHS.map(
        (path) => new URL(path, self.registration.scope).toString()
      );
      return cache.addAll(shellUrls);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
