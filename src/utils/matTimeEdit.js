import { orderCloseMs } from './oee.js';

/* ═══ แก้ "เวลาเริ่ม–จบของ MAT.NO" หลังปิดกะ — เจ้าของกฎการเขียน (2026-10-20 · feedback หน้างาน) ═══
   เคสจริง (Apron Assy 20/10): *"แก้ไขเวลาจบรุ่นที่ผลิตจบไม่ได้ ถ้าแก้ไขระบบตีกลับเป็นเวลาหยุดผลิตหมดเลย
   ทำให้คำนวณยอดงานแล้ว % ตกคับ"* — ต้นเหตุคือ **เขียนไม่ตรงช่องที่จออ่าน**:
     · จออ่านเวลาจบของ MAT = `max(orderCloseMs)` ของ **ทุกใบ** (รวมใบยกยอดที่ใช้ `stopped_at`)
     · ตัวบันทึกเดิมเขียนแค่ `confirmed_at` ของใบ confirmed ใบสุดท้าย 1 ใบ
   ⇒ MAT ที่มีใบยกยอด (`stopped_at` = เวลาปิดกะ) จะกลับไปโชว์เวลาปิดกะทุกครั้งที่กดบันทึก

   🔴 กติกา: "เวลาจบของ MAT" = เวลาที่ **ไม่มีใบไหนของ MAT นี้ปิดช้ากว่า** ⇒ ต้องรัดทุกใบที่เลยเวลาใหม่
      ไม่ใช่ขยับใบเดียว (เลื่อนใบที่ช้าสุดใบเดียว = ใบอันดับ 2 กลายเป็นค่าที่จอโชว์ = แก้ไม่ขึ้นเหมือนเดิม)
   🔴 ย่อ/ขยายต่างกัน: ย่อ = รัดทุกใบที่เลย · ขยาย (ไม่มีใบไหนเลย) = เลื่อน **ใบที่ช้าสุด** ออกไป
      เวลาเริ่มก็กลับด้านเดียวกัน (เริ่ม = `min(opened_at)`)
   🔴 เขียนช่องตามสถานะใบ — confirmed ⇒ `confirmed_at` · ยกยอด/ส่งต่อ/ยกเลิก ⇒ `stopped_at`
      (เขียน `confirmed_at` ให้ใบยกยอด = ใบนั้นดูเหมือนปิดแล้ว) */

export const MAT_TIME_SKIP_OPEN = 'open_orders';

const openedMs = (o) => {
  if (!o?.opened_at) return null;
  const ms = new Date(o.opened_at).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** `{ writes: [{ id, field, ms }], skip }` — `skip` ไม่ใช่ null = ไม่เขียนอะไรเลย ต้องบอกบนจอ */
export function planMatTimeWrites(orders, { startMs = null, endMs = null } = {}) {
  const rows = (orders || []).filter(Boolean);
  if (!rows.length) return { writes: [], skip: null };
  // ใบที่ยังเปิดค้าง = ยังไม่รู้เวลาจบจริง ⇒ ห้ามแก้ทั้ง MAT (เดิมข้ามเงียบๆ แล้ว toast ยังขึ้น "สำเร็จ")
  if (rows.some(o => o.status === 'open')) return { writes: [], skip: MAT_TIME_SKIP_OPEN };

  const writes = [];

  if (startMs != null) {
    const withOpen = rows.filter(o => openedMs(o) != null);
    if (withOpen.length) {
      const early = withOpen.filter(o => openedMs(o) < startMs);
      const targets = early.length
        ? early
        : [withOpen.reduce((a, b) => (openedMs(b) < openedMs(a) ? b : a))];
      for (const o of targets) writes.push({ id: o.id, field: 'opened_at', ms: startMs });
    }
  }

  if (endMs != null) {
    const closed = rows.filter(o => orderCloseMs(o) != null);
    if (closed.length) {
      const over = closed.filter(o => orderCloseMs(o) > endMs);
      const targets = over.length
        ? over
        : [closed.reduce((a, b) => (orderCloseMs(b) > orderCloseMs(a) ? b : a))];
      for (const o of targets) {
        writes.push({ id: o.id, field: o.status === 'confirmed' ? 'confirmed_at' : 'stopped_at', ms: endMs });
      }
    }
  }

  return { writes, skip: null };
}
