/* ESM Service Worker — Web Push เท่านั้น (เฟส B)
   ⚠️ ตั้งใจ "ไม่มี fetch handler" — ไม่ cache HTML/chunk/asset อะไรเลย
   เพื่อไม่ให้ชนระบบกันจอดำ (version-guard ใน main.jsx + no-cache ใน render.yaml)
   SW ตัวนี้ทำแค่รับ push แล้วเด้ง notification + เปิดแอปตอนกด — ไม่แตะการโหลดหน้า */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'ESM แจ้งเตือน', body: (event.data && event.data.text && event.data.text()) || '' }; }

  const title = data.title || 'ESM แจ้งเตือน';
  const options = {
    body:  data.body || '',
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    tag:   data.tag || undefined,          // tag เดิม = แทนที่ notification เก่า (กันซ้ำ)
    renotify: !!data.tag,
    vibrate: [80, 40, 80],
    data:  { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate(target); } catch { /* ข้ามถ้าคนละ origin */ } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
