/* Web Push (เฟส B) — สมัคร/ยกเลิกรับแจ้งเตือนเข้ามือถือ
   - service worker: /sw.js (push handler เท่านั้น ไม่ cache — ดู public/sw.js)
   - VAPID public key ดึงจาก RPC get_vapid_public_key()
   - subscription เก็บใน push_subscriptions (RLS: ของ user เอง)
   ⚠️ iOS: ต้องเพิ่มลงหน้าจอโฮม (standalone) + iOS 16.4+ ถึงจะรองรับ */
import { supabase } from '../supabaseClient';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

// iOS Safari รองรับ push เฉพาะเมื่อรันเป็น PWA ที่ติดตั้งแล้ว (standalone)
export const isIosNonStandalone = () => {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches;
  return ios && !standalone;
};

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let _swReg = null;
async function ensureSW() {
  if (_swReg) return _swReg;
  _swReg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return _swReg;
}

/** สถานะปัจจุบัน: 'unsupported' | 'ios-need-install' | 'denied' | 'default' | 'subscribed' | 'unsubscribed' */
export async function getPushState() {
  if (!pushSupported()) return isIosNonStandalone() ? 'ios-need-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) return 'subscribed';
  } catch { /* ข้าม */ }
  return Notification.permission === 'granted' ? 'unsubscribed' : 'default';
}

/** ขอสิทธิ์ + subscribe + บันทึกลง DB · คืน true เมื่อสำเร็จ */
export async function subscribePush(userId) {
  if (!pushSupported() || !userId) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

  const { data: pubKey, error } = await supabase.rpc('get_vapid_public_key');
  if (error || !pubKey) throw new Error('ยังไม่ได้ตั้ง VAPID key ในระบบ');

  const reg = await ensureSW();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(pubKey),
    });
  }
  const j = sub.toJSON();
  const { error: insErr } = await supabase.from('push_subscriptions').upsert({
    user_id:    userId,
    endpoint:   sub.endpoint,
    p256dh:     j.keys?.p256dh,
    auth:       j.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint', ignoreDuplicates: true });
  if (insErr) throw insErr;
  return true;
}

/** ยกเลิกรับ push (ลบทั้งฝั่งเบราว์เซอร์ + DB) */
export async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    return true;
  } catch { return false; }
}
