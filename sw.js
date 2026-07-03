const CACHE_NAME = 'trade7smart-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {});
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title:'Trade7Smart', body:'Notification' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'trade',
    renotify: true,
    vibrate: [200, 100, 200],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
    if(cs.length > 0) return cs[0].focus();
    return clients.openWindow('/');
  }));
});
