/* Trade7Smart — minimal service worker
   Purpose: enable real system/lock-screen notifications on mobile browsers
   (Android Chrome and others require a Service Worker to call
   registration.showNotification() — the page-level `new Notification()`
   constructor is desktop-only on most mobile browsers). */

const CACHE_NAME = 't7s-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Allows the page to ask the SW to show a notification via postMessage,
// as an alternative path to calling reg.showNotification() directly.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || 'Trade7Smart', {
      body: data.body || '',
      tag: data.tag || 'trade',
      renotify: true,
      icon: data.icon || './icon-192.png',
      badge: data.badge || './icon-96.png',
      vibrate: [120, 60, 120],
      requireInteraction: false
    });
  }
});

// Clicking a notification focuses (or opens) the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

// If a real push server is ever added (VAPID + backend), this handler
// will surface true "app fully closed" notifications. Without a push
// server, notifications only fire while the browser process is running
// (tab open or backgrounded), which is what sendNotif() in index.html uses.
self.addEventListener('push', (event) => {
  let payload = { title: 'Trade7Smart', body: 'Update available' };
  try { payload = event.data ? event.data.json() : payload; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icon-192.png',
      badge: './icon-96.png',
      vibrate: [120, 60, 120]
    })
  );
});
