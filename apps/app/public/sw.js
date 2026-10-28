// Désinstalle l'ancien service worker de l'interface Traccar, servie sur autolocalize.net jusqu'au
// 2026-10-27 : sans ce fichier, les navigateurs qui l'avaient installé continuaient d'afficher
// l'ancienne interface Traccar au lieu de l'application. L'application, elle, n'a pas de service worker.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
