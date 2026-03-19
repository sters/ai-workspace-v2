// Service Worker for Web Push Notifications
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "ai-workspace";
  const options = {
    body: data.body || "An operation needs your attention",
    icon: data.icon || undefined,
    tag: data.tag || "ask-notification",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
