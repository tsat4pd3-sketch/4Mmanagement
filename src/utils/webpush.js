/* Web Push (เฟส B) — สมัคร/ยกเลิกรับแจ้งเตือนเข้ามือถือ
   - service worker: /sw.js (push handler เท่านั้น ไม่ cache — ดู public/sw.js)
   - VAPID public key ดึงจาก RPC get_vapid_public_key()
   - subscription เก็บใน push_subscriptions (RLS: ของ user เอง) · ผูก/ผูกใหม่ผ่าน RPC upsert_push_subscription
     (migration 20260908_push_subscriptions_rebind.sql — Main)
   ⚠️ iOS: ต้องเพิ่มลงหน้าจอโฮม (standalone) + iOS 16.4+ ถึงจะรองรับ

   🔴 กฎ "ความจริงของสถานะ" (2026-09-08 · feedback หัวหน้ากะ Samsung "เปิดแล้วแต่ไม่เคยเด้ง"):
   subscription ในเบราว์เซอร์ ≠ ระบบส่งถึงเครื่องนี้ได้ — ตัวส่ง (edge send-push) อ่านจาก **แถวใน push_subscriptions
   ของ user นี้** เท่านั้น แถวหายได้หลายทาง (send-push ลบ 404/410 · คนอื่นบนมือถือเครื่องเดียวกันกด "ปิด" ·
   upsert เดิม ignoreDuplicates no-op เงียบ) แล้วเบราว์เซอร์ยังถือ subscription อยู่ → จอเดิมโชว์ "เปิดแล้ว" ตลอดกาล
   ⇒ getPushState ต้องเทียบกับแถวใน DB ของ user ปัจจุบันเสมอ · คิวรีล้ม = สถานะ 'check-failed' ห้ามตอบ "ยังไม่เปิด" */
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

// เทียบ applicationServerKey ที่ subscription ถืออยู่ กับ VAPID public key ปัจจุบัน
// (หมุน VAPID key แล้ว subscription เก่าจะยิงไม่ถึง + subscribe ซ้ำด้วย key ใหม่จะโยน InvalidStateError)
function sameServerKey(sub, pubKey) {
  try {
    const cur = sub?.options?.applicationServerKey;
    if (!cur) return true; // เบราว์เซอร์ที่ไม่เปิดเผย options — ถือว่าตรง (เช็คไม่ได้)
    const a = new Uint8Array(cur), b = urlB64ToUint8Array(pubKey);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  } catch { return true; }
}

let _swReg = null;
async function ensureSW() {
  if (_swReg) return _swReg;
  _swReg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return _swReg;
}

async function browserSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? await reg.pushManager.getSubscription() : null;
}

/** สถานะปัจจุบัน:
 *  'unsupported' | 'ios-need-install' | 'denied' | 'default' | 'unsubscribed'
 *  'subscribed'   = เบราว์เซอร์มี subscription **และ** มีแถวใน push_subscriptions ของ user นี้ (ส่งถึงจริง)
 *  'stale'        = เบราว์เซอร์มี subscription แต่ DB ไม่มีแถวของ user นี้ (แถวถูกลบ/เป็นของคนอื่น) → ต้องกด "เปิด" ใหม่
 *  'check-failed' = เช็ค DB ไม่ได้ (คิวรีล้ม/เครือข่าย) — ไม่รู้ว่าส่งถึงไหม ห้ามตีความเป็น "ยังไม่เปิด"
 *  userId ว่าง (ยังไม่ login) = ตรวจกับ DB ไม่ได้ → คืน 'stale' เพื่อไม่ให้ขึ้น "เปิดแล้ว" ทั้งที่พิสูจน์ไม่ได้ */
export async function getPushState(userId) {
  if (!pushSupported()) return isIosNonStandalone() ? 'ios-need-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  let sub = null;
  try { sub = await browserSubscription(); } catch { sub = null; }
  if (!sub) return Notification.permission === 'granted' ? 'unsubscribed' : 'default';
  if (!userId) return 'stale';

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', sub.endpoint)
    .eq('user_id', userId)   // RLS กรอง user_id = auth.uid() อยู่แล้ว — ใส่ซ้ำให้เจตนาชัด
    .limit(1);
  if (error) {
    console.error('[webpush] verify subscription failed', error.message);
    return 'check-failed';
  }
  return data?.length ? 'subscribed' : 'stale';
}

/** ขอสิทธิ์ + subscribe + ผูกแถวใน DB กับ user ปัจจุบัน · คืน true เมื่อสำเร็จ · false = ผู้ใช้ไม่อนุญาต · throw = ผิดพลาดจริง */
export async function subscribePush(userId) {
  if (!pushSupported() || !userId) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

  const { data: pubKey, error } = await supabase.rpc('get_vapid_public_key');
  if (error || !pubKey) throw new Error('ยังไม่ได้ตั้ง VAPID key ในระบบ');

  const reg = await ensureSW();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameServerKey(sub, pubKey)) {
    // VAPID key เปลี่ยน → subscription เก่าใช้ไม่ได้แล้ว ต้องสมัครใหม่ (ไม่งั้น subscribe() โยน InvalidStateError)
    try { await sub.unsubscribe(); } catch { /* ข้าม — สมัครใหม่ด้านล่างจะฟ้องเอง */ }
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(pubKey),
    });
  }
  const j = sub.toJSON();
  const row = {
    endpoint:   sub.endpoint,
    p256dh:     j.keys?.p256dh,
    auth:       j.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  };

  // ทางหลัก: RPC ผูกแถวกับ auth.uid() (ทับ user_id/keys ของแถวเดิมที่ endpoint เดียวกัน — มือถือใช้ร่วมกัน/key หมุน)
  const { error: rpcErr } = await supabase.rpc('upsert_push_subscription', {
    p_endpoint: row.endpoint, p_p256dh: row.p256dh, p_auth: row.auth, p_user_agent: row.user_agent,
  });
  if (!rpcErr) return true;

  const rpcMissing = rpcErr.code === 'PGRST202' || rpcErr.code === '42883' || /upsert_push_subscription/.test(rpcErr.message || '');
  if (!rpcMissing) throw new Error(`บันทึกการลงทะเบียนไม่สำเร็จ: ${rpcErr.message}`);

  // fallback (ยังไม่ apply migration 20260908): insert ตรงแบบเดิมได้เฉพาะ endpoint ที่ยังไม่มีแถว
  // แล้ว **ต้องตรวจกลับ** ว่าแถวเป็นของเราจริง — ห้ามขึ้น "เปิดแล้ว" ทั้งที่ no-op (ENGINEERING-PRINCIPLES §6 tolerant ≠ เงียบ)
  const { error: insErr } = await supabase.from('push_subscriptions')
    .upsert({ user_id: userId, ...row }, { onConflict: 'endpoint', ignoreDuplicates: true });
  if (insErr) throw new Error(`บันทึกการลงทะเบียนไม่สำเร็จ: ${insErr.message}`);
  const { data: mine, error: chkErr } = await supabase.from('push_subscriptions')
    .select('id').eq('endpoint', row.endpoint).eq('user_id', userId).limit(1);
  if (chkErr) throw new Error(`ตรวจสอบการลงทะเบียนไม่ได้: ${chkErr.message}`);
  if (!mine?.length) {
    throw new Error('ลงทะเบียนไม่ติด — endpoint นี้ผูกกับผู้ใช้อื่นอยู่ · ต้อง apply migration 20260908_push_subscriptions_rebind (RPC upsert_push_subscription) บน Main ก่อน');
  }
  return true;
}

/** ยกเลิกรับ push (ลบทั้งฝั่งเบราว์เซอร์ + DB)
 *  คืน { ok, dbRows, error } — dbRows = จำนวนแถวที่ลบได้ใน DB (RLS ปฏิเสธ = 0 แถวไม่มี error → นับเอง กฎเหล็กข้อ 2)
 *  dbRows 0 + ไม่ error = แถวเป็นของ user อื่น (มือถือใช้ร่วมกัน) หรือถูกลบไปก่อนแล้ว — ฝั่งเบราว์เซอร์ยกเลิกให้อยู่ดี */
export async function unsubscribePush() {
  try {
    const sub = await browserSubscription();
    if (!sub) return { ok: true, dbRows: 0, error: null };
    const { data, error } = await supabase.from('push_subscriptions')
      .delete().eq('endpoint', sub.endpoint).select('id');
    await sub.unsubscribe();
    return { ok: !error, dbRows: data?.length ?? 0, error: error?.message || null };
  } catch (e) {
    return { ok: false, dbRows: 0, error: e?.message || String(e) };
  }
}

/** ฟังข้อความจาก service worker เมื่อ push service หมุน subscription (pushsubscriptionchange ใน public/sw.js)
 *  SW ไม่มี session/Supabase client จึงเขียน DB เองไม่ได้ → ส่ง { type:'esm-push-resubscribe', oldEndpoint, newEndpoint }
 *  มาให้หน้าเว็บที่เปิดอยู่จัดการ · คืนฟังก์ชันถอด listener */
export function onPushResubscribeRequest(handler) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const fn = (e) => { if (e?.data?.type === 'esm-push-resubscribe') handler(e.data); };
  navigator.serviceWorker.addEventListener('message', fn);
  return () => navigator.serviceWorker.removeEventListener('message', fn);
}

/** จัดการหลัง SW หมุน subscription · คืน 'rebound' | 'needs-user' | 'error'
 *  - แถว endpoint เก่าเป็นของ user นี้ (RLS ให้เห็นเฉพาะของตัวเอง) → ผูก subscription ใหม่ให้อัตโนมัติ + ลบแถวเก่า
 *    (ผู้ใช้เคยเปิดเองแล้ว ไม่ใช่การตัดสินใจใหม่ · ไม่มี prompt เพราะ permission granted อยู่แล้ว)
 *  - ไม่ใช่ของ user นี้ / ไม่รู้ endpoint เก่า → ไม่เดาแทนคน (มือถือใช้ร่วมกัน = ผูกให้คนผิดได้) → ปล่อยให้จอโชว์ 'stale' ให้กด "เปิด" เอง */
export async function handlePushResubscribe(userId, msg) {
  if (!userId || !msg?.oldEndpoint) return 'needs-user';
  const { data, error } = await supabase.from('push_subscriptions')
    .select('id').eq('endpoint', msg.oldEndpoint).eq('user_id', userId).limit(1);
  if (error) { console.error('[webpush] resubscribe lookup failed', error.message); return 'error'; }
  if (!data?.length) return 'needs-user';
  try {
    const ok = await subscribePush(userId);
    if (!ok) return 'needs-user';
  } catch (e) { console.error('[webpush] resubscribe failed', e?.message); return 'error'; }
  const { error: delErr } = await supabase.from('push_subscriptions').delete().eq('id', data[0].id);
  if (delErr) console.error('[webpush] delete old subscription failed', delErr.message); // แถวเก่าตาย → send-push ลบเองตอน 410
  return 'rebound';
}
