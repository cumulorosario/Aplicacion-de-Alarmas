// Service Worker for Notifications
self.addEventListener('push', function(event) {
  const data = event.data?.json() ?? {};
  const title = data.title ?? 'Nueva Alarma';
  const options = {
    body: data.body ?? 'Se ha detectado una nueva alerta.',
    icon: '/logo.png',
    badge: '/logo.png',
    vibrate: [100, 50, 100],
    data: data.url
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Necesario para que el navegador considere la app como PWA instalable
  event.respondWith(fetch(event.request));
});
