/* ═══ ส่งซ่อมภายนอก (supplier) — เวลาและสถานะ ═══════════════════════════════
   2026-09-21 · คำถามจากทีมหน้างาน: "ถ้าซ่อมไม่ได้ ต้องเรียก supplier ข้างนอกมาแก้
   จะทำยังไง นับเวลายังไง นับต่อยาวไปเลยหรือไง"

   🔴 กฎเหล็กของเรื่องนี้ — **นาฬิกาเครื่อง ≠ นาฬิกาช่าง** (user เคาะ 21/09):
     · **Downtime ของไลน์นับเต็ม ห้ามหยุด** — ไลน์หยุดจริง ผลิตเสียหายจริง
       หยุดนับ = OEE โกหก (กฎเดียวกับ downtime คร่อมเวลาพัก · `oee.js`)
     · **MTTR ของช่างต้องหักช่วงที่ของอยู่กับ supplier ออก** — ไม่งั้นเอาเวลาของ
       ผู้รับจ้างไปตัดสินฝีมือช่าง · `mttr` เป็น KPI auto ใน Obeya ⇒ ทุกครั้งที่ส่งออกนอก
       คะแนนทีมช่างโดนลงโทษทั้งที่ไม่ใช่ความผิดเขา
   ⇒ ตัวเลข 2 ชุดนี้ **ห้ามสลับกัน** (บทเรียนเดียวกับ `duration_min` vs `dtMinOutsideBreaks`)

   วัดฐานก่อนแก้ (424 ใบที่ปิดครบ): เกิน 1 วัน 12 ใบ · เกิน 7 วัน 6 ใบ · ใบนานสุด 313.6 ชม.
   = 13 วัน — หางพวกนี้ดันค่าเฉลี่ย accept→done ขึ้นเป็น 6.1 ชม. ทั้งที่มัธยฐาน 1 นาที

   ⚠️ ทุกฟังก์ชันที่กินเวลาปัจจุบันรับ `now` เป็นพารามิเตอร์ได้ (กฎเทสระเบิดเวลา —
      เทสตรึงค่าได้ ไม่ตกเองวันหลัง) · ไฟล์นี้ pure ไม่ import supabase ⇒ เทสเรียกตรงได้
   ═══════════════════════════════════════════════════════════════════════════ */

import { MO_DONE_STATUSES } from './mtnStepPerm.js';

/** สถานะใบที่ของอยู่กับ supplier — ใบยัง **เปิดอยู่** (ไม่ใช่สถานะจบ) */
export const VENDOR_STATUS = 'waiting_vendor';

const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };

/** ใบนี้อยู่ช่วงไหนของการส่งออกนอก — 'none' ไม่เคยส่ง · 'out' ส่งแล้วยังไม่กลับ · 'back' กลับแล้ว */
export function vendorState(o) {
  if (!ms(o?.vendor_sent_at)) return 'none';
  return ms(o?.vendor_back_at) ? 'back' : 'out';
}

/**
 * นาทีที่ของอยู่กับ supplier
 *   · ส่งแล้วกลับแล้ว → back − sent
 *   · ส่งแล้วยังไม่กลับ → now − sent (**เดินอยู่** — จอต้องโชว์ว่ายังนับอยู่ ไม่ใช่ขีด)
 *   · ไม่เคยส่ง → 0
 * เวลาสลับกัน (กลับก่อนส่ง) = ข้อมูลผิด → คืน 0 ห้ามคืนค่าติดลบไปลบ MTTR จนเฟ้อ
 */
export function vendorHoldMin(o, now = Date.now()) {
  const sent = ms(o?.vendor_sent_at);
  if (sent == null) return 0;
  const back = ms(o?.vendor_back_at) ?? now;
  return Math.max(0, Math.round((back - sent) / 60000));
}

/* ═══ ช่วงหยุดนับ MTTR ของช่าง (2026-10-20 · คำสั่ง user) ═══════════════════════════════
   *"MTN ต้อง judge ว่าซ่อมได้เองหรือต้องส่งภายนอก เพื่อหยุด MTTR — ซ่อมได้แต่ต้องเปิด PR สั่งอะไหล่ก็หยุด ·
     ส่งภายนอก/เรียก supplier เข้ามาก็มี PR และหยุด — หลังจากที่ MTN ตัดสินใจแล้ว"*
   ⇒ `mttr_hold_from` = ตอน MTN เลือกเส้นทาง `inhouse_pr`/`outsource` (ตัดสินใจ) ·
     `mttr_hold_to` = อะไหล่รับครบ / ของกลับจาก supplier / ช่างกดซ่อมต่อ · null = ยังหยุดอยู่
   · ช่วงหยุดทั้งหมด = ช่วงนี้ ∪ ช่วงอยู่กับ supplier (vendor_sent→back) — **รวมแบบ union ไม่หักซ้ำ**
     และตัดให้อยู่ในกรอบ รับงาน→ซ่อมเสร็จ (ช่วงนอกกรอบไม่ใช่เวลาของช่างอยู่แล้ว)
   · ช่วงข้อมูลสลับ (จบก่อนเริ่ม) = ทิ้ง ห้ามติดลบ
   🔴 downtime ของเครื่องไม่เกี่ยว — นับเต็มเหมือนเดิม (กฎเหล็กหัวไฟล์) */
export function holdIntervals(o, now = Date.now()) {
  const out = [];
  const vs = ms(o?.vendor_sent_at);
  if (vs != null) out.push([vs, ms(o?.vendor_back_at) ?? now]);
  const hf = ms(o?.mttr_hold_from);
  if (hf != null) out.push([hf, ms(o?.mttr_hold_to) ?? now]);
  return out.filter(([a, b]) => b > a);
}

/** นาทีที่หยุดนับ MTTR ภายในกรอบ [from, to] — union ของทุกช่วง */
export function mttrHoldMin(o, now = Date.now(), from = null, to = null) {
  const lo = from ?? ms(o?.accept_at), hi = to ?? ms(o?.repair_done_at) ?? now;
  if (lo == null || hi == null || hi <= lo) return 0;
  const iv = holdIntervals(o, now).map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0, cs = null, ce = null;
  for (const [a, b] of iv) {
    if (cs == null || a > ce) { if (cs != null) total += ce - cs; cs = a; ce = b; }
    else ce = Math.max(ce, b);
  }
  if (cs != null) total += ce - cs;
  return Math.round(total / 60000);
}

/** ใบนี้กำลังหยุดนับ MTTR อยู่ไหม (ตัดสินแล้ว ยังไม่จบช่วง) */
export const isMttrHeld = (o) => ms(o?.mttr_hold_from) != null && ms(o?.mttr_hold_to) == null;

/**
 * เวลาซ่อมที่เป็นของ "ช่าง" จริง = (รับงาน → ซ่อมเสร็จ) − ช่วงหยุดนับ MTTR (รออะไหล่ PR ∪ อยู่กับ supplier)
 * คืน `null` เมื่อวัดไม่ได้ (ยังไม่รับงาน / ยังไม่ซ่อมเสร็จ) — **ห้ามเดาเป็น 0**
 * ⚠️ ค่านี้ใช้ตอบ "ช่างใช้เวลาเท่าไหร่" เท่านั้น — ตอบ "ไลน์หยุดไปเท่าไหร่" ต้องใช้
 *    `downtime_logs` เหมือนเดิม (ดูกฎเหล็กหัวไฟล์)
 */
export function techRepairMin(o, now = Date.now()) {
  const a = ms(o?.accept_at), d = ms(o?.repair_done_at);
  if (a == null || d == null) return null;
  const gross = Math.max(0, Math.round((d - a) / 60000));
  return Math.max(0, gross - mttrHoldMin(o, now, a, d));
}

/** เวลารวมตั้งแต่รับงานถึงซ่อมเสร็จ (ไม่หักอะไร) — ใช้คู่กันเสมอเพื่อให้จอเทียบให้เห็น */
export function grossRepairMin(o) {
  const a = ms(o?.accept_at), d = ms(o?.repair_done_at);
  if (a == null || d == null) return null;
  return Math.max(0, Math.round((d - a) / 60000));
}

/** ส่งออกนอกได้ไหม — ช่างต้องรับงานแล้ว (ขั้น 2-3) และใบยังไม่จบ · ส่งซ้ำระหว่างที่ยังไม่กลับไม่ได้ */
export function canSendVendor(o) {
  const st = String(o?.status || '').trim();
  /* 🔴 "ใบจบแล้ว" อ่านจาก MO_DONE_STATUSES (mtnStepPerm) — ลิสต์มือที่นี่เคยตกรุ่น
     ทุกครั้งที่เพิ่มสถานะจบใหม่ · `returned` (ของกลับจาก supplier) ไม่ใช่สถานะจบ
     แต่ส่งออกซ้ำไม่ได้จนช่างปิดงาน ⇒ ยังต้องเช็คแยก */
  if (MO_DONE_STATUSES.includes(st) || st === 'returned') return false;
  if (st === VENDOR_STATUS) return false;                 // อยู่ข้างนอกอยู่แล้ว
  const step = Number(o?.current_step || 1);
  return step >= 2 && step <= 3;
}

/** ของกลับแล้ว — เฉพาะใบที่กำลังอยู่ข้างนอกจริงๆ */
export const canReceiveVendor = (o) =>
  String(o?.status || '').trim() === VENDOR_STATUS && vendorState(o) === 'out';

/** ข้อความสั้นสำหรับชิป/แจ้งเตือน — "อยู่กับ ACME มาแล้ว 3 วัน 4 ชม." */
export function vendorHoldLabel(o, now = Date.now()) {
  const min = vendorHoldMin(o, now);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d > 0) return `${d} วัน${h ? ` ${h} ชม.` : ''}`;
  if (h > 0) return `${h} ชม.${m ? ` ${m} น.` : ''}`;
  return `${m} นาที`;
}
