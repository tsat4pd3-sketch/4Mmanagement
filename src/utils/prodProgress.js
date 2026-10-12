/* ══════════════════════════════════════════════════════════════════════════
   🏭 prodProgress — กฎตัวเลขของแถบ "ยอดผลิตวันนี้ เทียบใบสั่งผลิต" (`<ProdProgressStrip>`) · pure (2026-10-12)

   ที่มา (user 12/10 ดูจอ TV): *"แถบสั่งผลิตไปไลน์ไหนก็ยัง งงๆ เห็นกันทุกแผนก"*
   ไล่ดูแล้วงงจริงจาก 2 อย่าง:
     ① **เป้า = ยอดทั้งกะ แต่ตัดสินสีเหมือนต้องได้ครบแล้ว** — 08:30 ทุกไลน์ขึ้น 0–6% แดง "ตามหลัง"
        ทั้งที่กะเพิ่งเริ่ม · และ**คิด "ควรได้เท่าไหร่ ณ ตอนนี้" ไม่ได้** เพราะกะที่ยังเปิดไม่มี
        `end_time`/`shift_min` (วัด 12/10: 16 กะ มีแค่ start_time) ⇒ **ห้ามเดาความยาวกะ**
        ⇒ กะยังไม่จบ = โชว์ความคืบหน้าแบบกลาง (ไม่แดง/ไม่เขียว) · ตัดสินสีเฉพาะกะที่ปิดแล้ว
     ② **ใบที่ยกยอด/ถูกรับไปกะอื่น นับเต็มจำนวน** — ยอดที่เหลือถูกนับ 2 ที่ (ใบนี้ + ใบใหม่)
        ⇒ ใช้ชุดสถานะเดียวกับ `shiftCapacity.SPENT_STATUSES` และกติกาเดียวกับบอร์ดสโตร์
           (`cancelled` ไม่นับ · `carry_over`/`imported` นับเฉพาะที่ทำจริง `qty_actual`)
   ══════════════════════════════════════════════════════════════════════════ */
import { SPENT_STATUSES } from './shiftCapacity.js';
import { statusColor } from './statusTone.js';

/** ใบที่ยอดที่เหลือถูกยกไปเป็นใบอื่นแล้ว — นับเฉพาะที่ทำจริงในกะนี้ */
export const isCarried = (st) => st === 'carry_over' || st === 'imported';

/** ใบนี้นับในแถบไหม — `cancelled` ไม่ใช่งาน (ตัวอื่นใน SPENT นับแบบบางส่วน) */
export const countsInProgress = (o) => !!o && !(SPENT_STATUSES.includes(o.status) && !isCarried(o.status));

/** เป้าของใบ — สูตรเดิม `qty_target ?? qty` · ใบยกยอด = ที่ทำจริง */
export function orderTargetQty(o) {
  if (isCarried(o.status)) return Number(o.qty_actual) || 0;
  return Number(o.qty_target ?? o.qty ?? 0) || 0;
}

/** ยอดที่ทำได้ — สูตรบังคับของระบบ `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` */
export function orderMadeQty(o) {
  if (o.status === 'confirmed') return Number(o.qty_ok ?? o.qty ?? 0) || 0;
  return Number(o.qty_actual ?? 0) || 0;
}

/** สีจากชุดกลาง `statusTone.js` (ด่าน status-palette-single-source) · กะยังไม่จบ = 'none' (ตัดสินไม่ได้ = เทา)
 *  ⚠️ ห้ามให้ "กะยังไม่จบ" เป็นเขียว/ฟ้าที่อ่านเป็น "ดี" — ยังไม่รู้ว่าดีหรือไม่ดี */
export const PROGRESS_COLOR = {
  good: statusColor('good'), warn: statusColor('warn'), bad: statusColor('bad'),
  live: statusColor('none'), none: statusColor('none'),
};

/**
 * ป้าย/สีของไลน์ 1 ไลน์
 * @param {{ target:number, made:number, open:boolean }} p  open = ยังมีกะของไลน์นี้เปิดอยู่
 * @returns {{ pct:number|null, color:string, note:string, final:boolean, behind:boolean }}
 *   final = ตัดสินได้แล้ว (กะปิดหมด) · behind = กะปิดแล้วและได้ < 85% ของเป้า
 */
export function lineVerdict({ target, made, open }) {
  if (!(target > 0)) return { pct: null, color: PROGRESS_COLOR.none, note: 'ยังไม่มีใบสั่งผลิต', final: false, behind: false };
  const pct = (made / target) * 100;
  if (made >= target) return { pct, color: PROGRESS_COLOR.good, note: 'ครบเป้าแล้ว', final: true, behind: false };
  if (open) {
    return { pct, color: PROGRESS_COLOR.live, note: made > 0 ? 'กะยังไม่จบ' : 'กะยังไม่จบ · ยังไม่ลงยอด', final: false, behind: false };
  }
  const behind = pct < 85;
  return { pct, color: behind ? PROGRESS_COLOR.bad : PROGRESS_COLOR.warn, note: 'ปิดกะแล้ว · ไม่ครบเป้า', final: true, behind };
}
