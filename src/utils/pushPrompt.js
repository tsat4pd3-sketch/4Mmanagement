/* ══ pushPrompt — ข้อความ/กติกาของแถบ "เปิดแจ้งเตือนเข้ามือถือ" (2026-10-20) ═══════════════
   แยกออกจากคอมโพเนนต์เพราะเป็น **กฎ ไม่ใช่การวาด** (และ `.jsx` เทสด้วย node ไม่ได้)
   ใช้โดย `components/MobilePushPrompt.jsx` (แถบบนมือถือ) + `components/PushCoveragePanel.jsx` (จอแอดมิน)

   ที่มา: feedback 20/10 *"มือถือ ไม่มีการแจ้งเตือนใบแจ้งซ่อมมา 2-3 วัน เกิดจากเรื่องสิทธิ์รึป่าว"*
   → ไม่ใช่เรื่องสิทธิ์ · ปุ่มเปิด push ซ่อนในกระดิ่ง ⇒ วัด 20/10 ผู้รับแจ้งเตือน 7 วัน 102 คน
     **มีเครื่องผูกไว้ 28 · ไม่มี 74** (ในนั้นได้แจ้งเตือนใบซ่อม 55)

   🔴 สถานะทั้งหมดมาจาก `utils/webpush.js` (`getPushState`) — ที่นี่แค่แปลงเป็นข้อความ
      **ห้ามเขียนตรรกะตัดสินสถานะซ้ำ**
   🔴 `check-failed` = ตรวจไม่ได้ ⇒ ต้องบอกว่า "ยังไม่ทราบ" **ห้ามบอกว่า "ยังไม่เปิด"** (จอโกหก)
   🔴 `subscribed`/`unsupported` ⇒ คืน `null` = ไม่วาดแถบ (ห้ามรบกวนคนที่เปิดแล้ว) */

export const SNOOZE_KEY  = 'esm.pushPrompt.snoozeUntil';
export const SNOOZE_DAYS = 3;

/** อ่านเวลาพัก — storage ปิด/โหมดส่วนตัว = ถือว่าไม่พัก (แถบยังทำงาน ไม่พัง) */
export function readSnooze() {
  try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) || 0; } catch { return 0; }
}
/** พัก N วันนับจาก `now` — คืนเวลาสิ้นสุด (เขียนไม่ได้ก็ไม่เป็นไร)
 *  ⏱️ รับ `now` เข้ามาเพื่อให้เทสตรึงเวลาได้ (ด่าน "นาฬิกา +400 วัน" ของ npm test) */
export function snoozeUntil(now = Date.now(), days = SNOOZE_DAYS) {
  const until = now + days * 86400_000;
  try { localStorage.setItem(SNOOZE_KEY, String(until)); } catch { /* ไม่พัก ก็ยังใช้งานได้ */ }
  return until;
}
export const isSnoozed = (now = Date.now()) => readSnooze() > now;

/** ข้อความต่อสถานะ · `null` = ไม่ต้องวาดแถบ
 *  คืน { tone: 'info'|'warn', text, cta } — `cta: null` = แก้ที่เครื่อง/เบราว์เซอร์ ปุ่มกดไปก็ไม่ช่วย */
export function pushPromptCopy(state) {
  switch (state) {
    case 'stale':
      return { tone: 'warn', cta: 'เปิดใหม่',
        text: '⚠️ การลงทะเบียนแจ้งเตือนหลุด — มือถือเครื่องนี้จะไม่เด้งจนกดเปิดใหม่' };
    case 'default':
    case 'unsubscribed':
      return { tone: 'info', cta: 'เปิด',
        text: '📲 เครื่องนี้ยังไม่เปิดแจ้งเตือน — ใบแจ้งซ่อม/งานที่รอคุณจะไม่เด้งบนมือถือ' };
    case 'denied':
      return { tone: 'warn', cta: null,
        text: '🔕 เบราว์เซอร์บล็อกการแจ้งเตือนไว้ — เปิดสิทธิ์ในตั้งค่าเบราว์เซอร์ก่อน แล้วกลับมากดเปิด' };
    case 'ios-need-install':
      return { tone: 'info', cta: null,
        text: '📲 iPhone: กด "แชร์ → เพิ่มไปยังหน้าจอโฮม" แล้วเปิดจากไอคอนนั้น จึงเปิดแจ้งเตือนได้' };
    case 'check-failed':
      return { tone: 'warn', cta: null,
        text: '⚠️ ตรวจสถานะแจ้งเตือนเข้ามือถือไม่ได้ (เครือข่าย/ฐานข้อมูล) — ยังไม่ทราบว่าเด้งถึงเครื่องนี้ไหม' };
    default:
      return null;   // subscribed · unsupported · ค่าที่ยังไม่รู้จัก = ไม่เดา ไม่รบกวน
  }
}

/** error ของ RPC `push_coverage` → ข้อความ + ทางแก้ (ห้ามโชว์ 0 แล้วให้คนเข้าใจว่า "ครบแล้ว") */
export function pushCoverageFailText(err) {
  if (err?.code === '42501') return 'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลการลงทะเบียนของคนอื่น';
  if (err?.code === 'PGRST202' || err?.code === '42883') {
    return 'ยังไม่ได้ apply migration 20261020_push_coverage_rpc_main บน MAIN — แจ้งผู้ดูแลระบบ';
  }
  return `อ่านข้อมูลไม่สำเร็จ: ${err?.message || 'ไม่ทราบสาเหตุ'}`;
}
