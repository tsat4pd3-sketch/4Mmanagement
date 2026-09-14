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

/* ── pushsubscriptionchange: push service หมุน subscription (token rotation) ──
   ไม่มี handler = subscription ใหม่ไม่เคยถึง DB → เครื่องนั้นเงียบถาวรทั้งที่จอบอก "เปิดแล้ว"
   (ต้นตอหนึ่งของ feedback 2026-09-08 "เปิดแจ้งเตือน MO แล้วไม่เคยเด้ง")
   ทางเลือก: SW ไม่มี session/Supabase client จึง **เขียน DB เองไม่ได้** (RPC get_vapid_public_key เรียกได้แต่
   push_subscriptions ต้องมี JWT) → ทำ 2 ชั้น:
   1) สมัครใหม่ทันทีด้วย applicationServerKey เดิม (จาก oldSubscription — ไม่ต้องขอ key จากใคร)
   2) postMessage ให้หน้าเว็บที่เปิดอยู่ผูก subscription ใหม่กับ user (webpush.js handlePushResubscribe:
      ถ้า endpoint เก่าเป็นของ user นั้นจริง → rebind อัตโนมัติ, ไม่ใช่ → จอโชว์ "ลงทะเบียนหลุด กดเปิดใหม่")
   ⚠️ ไม่มีหน้าเว็บเปิดอยู่ตอนหมุน = DB ยังไม่รู้ endpoint ใหม่จนกว่าจะเปิดแอปครั้งถัดไป — ตอนนั้น
      getPushState(userId) เทียบกับ DB แล้วเจอว่าไม่มีแถว → ขึ้นปุ่ม "เปิด" ให้กดใหม่ (ไม่เงียบ) · trade-off ที่ยอมรับ
      เพราะทางเลือกอื่น (ฝัง service key/anon insert ใน SW) เปิดช่องให้ใครก็เขียน subscription แทนคนอื่นได้ */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const oldSub = event.oldSubscription || null;
    const oldEndpoint = oldSub ? oldSub.endpoint : null;
    let newSub = event.newSubscription || null;
    if (!newSub) {
      const key = oldSub && oldSub.options && oldSub.options.applicationServerKey;
      if (key) {
        try { newSub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
        catch (e) { console.error('[sw] resubscribe failed', e && e.message); }
      }
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      c.postMessage({ type: 'esm-push-resubscribe', oldEndpoint, newEndpoint: newSub ? newSub.endpoint : null });
    }
  })());
});
