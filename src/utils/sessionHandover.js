/* ═══════════════════════════════════════════════════════════════════════════════════════
   "กะนี้ถูกส่งต่อไปแล้วหรือยัง" — ด่านกันยอดลงกะเก่าที่ลืมปิด            (2026-11-17)

   ที่มา (หัวหน้าแจ้ง): *"ถ้ากะ01ลืมปิดกะ แล้วกะ02 ยิงปิดแท็ก ยอดจะไปขึ้นของกะ01ที่ลืมปิด"*
   ไล่ฐานจริง (prod_orders ตั้งแต่ 01/10) เจอ **164 ใบ · 21,647 ชิ้น · 18 กะ** ที่ถูก **เปิดใบ**
   ลงกะที่ "ไลน์เดียวกันมีกะใหม่เริ่มไปแล้ว" — ไม่ใช่แค่ตอนปิดแท็กอย่างที่แจ้งมา
   (ตัวอย่าง LINE A 10/11 กะเช้า: กะดึกเริ่ม 20:00 แต่ยังมีใบเปิดเข้ากะเช้า 20:04–20:10 รวม 4,000 ชิ้น)

   ต้นเหตุ: จอ DailyReport **คงกะที่เลือกไว้** ถ้ากะนั้นยังอยู่ในลิสต์ (ยังไม่ปิด)
     `setSelSession(s => s?.id ? (ss.find(x => x.id === s.id) || ss[0]) : ss[0])`
   ⇒ จอที่เปิดค้างจากกะก่อนยังผูกกับกะเดิมทั้งกะ · ทุกใบที่ยิงลงไปขึ้นกะเดิมเงียบๆ

   🔴 กติกา — **"กะที่เลือก" เป็นแค่ตัวกรอง ไม่ใช่ด่าน** (กฎ CLAUDE.md §ขอบเขต 3 ชั้น)
      ⇒ ด่านจริงต้องอยู่ใน **ฟังก์ชันที่เขียน DB** (เปิดใบผลิต) ไม่ใช่แค่ป้ายเตือนบนจอ
      ⇒ และ "ส่งต่อแล้ว" ตัดสินจาก **เวลาเริ่มกะจริง** (`shiftFrameOf`) ห้ามเดาจากเลขกะ/created_at

   ⚠️ ไฟล์นี้ต้อง **pure** (ไม่ import supabase / ไม่อ่าน state) — ผู้เรียกส่งลิสต์กะมาให้
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { shiftFrameOf } from './oee.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)
import { isVoidSession, SESSION_STATUSES_LIVE } from './sessionStatus.js';
import { tr } from './i18n.js';

/** ผ่อนผัน: ยิงใบปิดท้ายกะหลังกะใหม่เริ่มไปไม่เกินนี้ = เรื่องปกติ (ส่งกะ/เก็บของค้าง) ไม่ต้องขัด */
export const HANDOVER_GRACE_MIN = 20;

/** epoch ms ของ "เวลาเริ่มกะ" — เจ้าของสูตรคือ `shiftFrameOf` (oee.js) · อ่านไม่ได้ = null ห้ามเดา */
export function sessionStartMs(s) {
  const f = s ? shiftFrameOf(s) : null;
  return f && Number.isFinite(f.startMs) ? f.startMs : null;
}

/**
 * "กะที่เลือกถูกส่งต่อไปแล้วหรือยัง" — มีกะของ **ไลน์เดียวกัน** ที่เริ่มทีหลังและ**เริ่มไปแล้ว**ไหม
 *   คืน null = ยังไม่ส่งต่อ (ปกติ)
 *   คืน { next, nextStartMs, selStartMs, lateMin, nextIsLive, unsure }
 *     · `next`      = กะที่เริ่มล่าสุดในบรรดากะที่เริ่มทีหลัง (= กะที่ควรกรอกจริง)
 *     · `lateMin`   = ผ่านมากี่นาทีตั้งแต่กะใหม่เริ่ม (ผู้เรียกเทียบกับ HANDOVER_GRACE_MIN เอง)
 *     · `unsure:true` + `next:null` = **อ่านเวลาเริ่มกะไม่ได้ ⇒ เช็คไม่ได้** ผู้เรียกต้องเขียนบนจอ ห้ามเงียบ
 *   ⚠️ นับกะที่ปิดแล้วด้วย — กะใหม่เปิด-ปิดจบไปแล้ว ยิ่งแปลว่ากะเก่าค้างแน่
 */
export function handoverOf(sel, sessions, nowMs = Date.now()) {
  if (!sel?.line_name || isVoidSession(sel)) return null;
  const selStartMs = sessionStartMs(sel);
  if (selStartMs == null) return { next: null, nextStartMs: null, selStartMs: null, lateMin: 0, nextIsLive: false, unsure: true };

  let best = null, bestMs = null;
  (sessions || []).forEach(s => {
    if (!s || s.id === sel.id || s.line_name !== sel.line_name || isVoidSession(s)) return;
    const ms = sessionStartMs(s);
    if (ms == null || ms <= selStartMs || ms > nowMs) return;   // ยังไม่เริ่ม = ยังไม่ส่งต่อ
    if (bestMs == null || ms > bestMs) { best = s; bestMs = ms; }
  });
  if (!best) return null;
  return {
    next: best,
    nextStartMs: bestMs,
    selStartMs,
    lateMin: Math.max(0, Math.round((nowMs - bestMs) / 60000)),
    nextIsLive: SESSION_STATUSES_LIVE.includes(best.status),
    unsure: false,
  };
}

/** ป้ายกะสั้นๆ สำหรับข้อความเตือน — 'กะดึก 06/11 เริ่ม 20:00' */
export function sessionLabel(s) {
  if (!s) return '—';
  const sh = s.shift === 'night' ? 'กะดึก' : s.shift === 'day' ? tr("กะเช้า") : (s.shift || tr("กะ"));
  const d = String(s.work_date || '').slice(5).split('-').reverse().join('/');
  const st = String(s.start_time || '').slice(0, 5);
  return `${sh}${d ? ` ${d}` : ''}${st ? ` เริ่ม ${st}` : ''}`;
}

/**
 * ข้อความเตือนตอนจะ **เขียนลงกะที่ส่งต่อไปแล้ว** · คืน null เมื่อไม่ต้องขัด
 *   `what` = สิ่งที่กำลังจะทำ (เช่น 'เปิดใบผลิต PD-123') · `sel` = กะที่เลือกอยู่ (เอาไว้เรียกชื่อให้ชัด)
 *   เกิน grace = ขัดจริง (ผู้เรียกต้องให้ยืนยัน) · ภายใน grace = ปล่อยผ่าน (ส่งกะปกติ)
 */
export function handoverBlockText(h, what, sel, { graceMin = HANDOVER_GRACE_MIN } = {}) {
  if (!h || h.unsure || !h.next || h.lateMin <= graceMin) return null;
  const hr = Math.floor(h.lateMin / 60), mn = h.lateMin % 60;
  const late = hr ? `${hr} ชม.${mn ? ` ${mn} น.` : ''}` : `${h.lateMin} นาที`;
  return `⚠️ ไลน์นี้ขึ้นกะใหม่ไปแล้ว ${late} — ${sessionLabel(h.next)}\n`
    + `${what} จะไปขึ้นยอดของ ${sessionLabel(sel)} ซึ่งเป็นกะเก่าที่ยังไม่ปิด\n`
    + `⇒ ถ้าของนี้ผลิตในกะปัจจุบัน ให้สลับไปกะที่เดินอยู่ก่อนยิง`;
}
