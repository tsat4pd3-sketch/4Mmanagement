/* ══ ⏳ "ใบนี้เปิดจากการเรียกช่าง แต่ยังไม่มีใครใส่รายละเอียด" ══════  2026-11-13
   คำสั่ง user: *"บังคับเลยถ้าเรียกช่าง เพราะข้ามแผนก · อาจจะไม่บังคับใส่รายละเอียดตอนนั้น
   ทันทีก็ได้ มาใส่ย้อนหลังได้ เป็น tab breakdown รอเพิ่มรายละเอียด MO ·
   ส่วนที่ไม่เปิด อาจจะแก้ไขได้เอง"*

   ── ทางเดินใหม่ ──────────────────────────────────────────────────────────────
   กด "📞 เรียกช่าง" บนแถว Downtime
     → **ฐานเปิดใบ MO ให้เองทันที** (trigger `trg_dt_call_mtn_opens_mo` ฝั่ง DR)
       สถานะ `pending` ขั้น 1 = "รอรับงาน" เหมือนใบปกติ · ยังไม่มีเลข MO
       (เลขออกตอนช่างรับงานขั้น 2 เหมือนเดิม) · ติดธง `details_pending = true`
     → ใครก็ได้มากรอกรายละเอียดย้อนหลังผ่าน**ฟอร์มเต็มตัวเดิม** แล้วธงหลุด

   🔴 **ทำไมต้องบังคับฝั่งฐาน ไม่ใช่ฝั่งจอ** — เรียกช่าง = งานข้ามแผนก ต้องมีใบทุกครั้ง
      ⇒ ต้องกันทุกทางเข้า (จอ · AI intake ทาง Telegram · สคริปต์) · แถมมีด่านห้าม
      `DailyReport.jsx` insert `mtn_orders` เองอยู่แล้ว (คำสั่ง user 08/11)

   🔴 **ธงนี้ไม่ใช่สถานะของงานซ่อม** — ใบที่รอรายละเอียดยัง "รอรับงาน" ปกติ
      ช่างรับงาน/ซ่อม/ปิดได้ตามเดิม **ห้ามเอาธงนี้ไปบล็อกขั้น** (ไลน์หยุดรอเอกสาร = ผิดกฎโมดูล
      "งานซ่อมกับบริการ แค่แจ้งให้ทราบ ไม่งั้นไลน์จะหยุดรอการอนุมัติ")
      มันคือ "เอกสารยังไม่ครบ" ⇒ เป็นคิวให้ไล่เก็บ ไม่ใช่ด่าน

   🔴 **ใบที่ระบบเปิดเองต้องแยกให้เห็นในคิว** (กฎเดียวกับ 4M ที่ระบบสร้างเอง — ห้ามเข้าคิวเงียบๆ)
      ⇒ จอรายการต้องมีป้าย + มีตัวกรองของตัวเอง · `MO_LIST_COLS` ต้องมี `details_pending`
      ไม่มี = ป้ายหายทั้งจอโดยไม่มีใครรู้ (คอลัมน์ที่ไม่ได้ select = undefined เงียบๆ)

   🔴 **`undefined` (คิวรีไม่ได้ select) ≠ `false`** — ต้องตอบ "ไม่รู้" ไม่ใช่ "ครบแล้ว"
      เดาเป็น false = ใบที่รอเอกสารหายจากคิว ไม่มีใครตามเก็บ                            */

/** รายละเอียดที่ต้องมีจึงเรียกว่า "ใบครบ" — ชุดเดียวกับที่ฟอร์มแจ้งซ่อมบังคับตอนเปิดใบปกติ */
export const MO_DETAIL_FIELDS = Object.freeze([
  { key: 'item_type',              label: 'ชนิดอุปกรณ์' },
  { key: 'problem_characteristic', label: 'ลักษณะปัญหา' },
  { key: 'before_img',             label: 'รูปก่อนซ่อม' },
]);

/* 3 ช่องนี้เป็นข้อความ/URL ทั้งหมด ⇒ ค่า falsy ทุกแบบ (null · '' · false · 0) = ยังไม่กรอก */
const filled = (v) => typeof v === 'string' ? v.trim() !== '' : !!v;

/**
 * ใบนี้ติดธง "รอเพิ่มรายละเอียด" อยู่ไหม
 * @returns {boolean|null} `null` = ไม่รู้ (คิวรีไม่ได้ select `details_pending` มา)
 * 🔴 ห้ามแปลง null เป็น false ในหน้า — ให้จอเขียนว่า "ไม่รู้" หรือไม่โชว์ป้าย **แต่ห้ามบอกว่าครบ**
 */
export function isDetailsPending(order) {
  const v = order?.details_pending;
  if (v === true) return true;
  if (v === false || v === null) return false;
  return null;                      // undefined = ไม่ได้ select มา
}

/**
 * ยังขาดอะไรบ้าง — ใช้เขียนบนแถว/ในคิวว่าต้องไปเติมอะไร
 * @returns {{ known:boolean, missing:string[] }}
 * 🔴 `known:false` เมื่อ**ไม่ได้ select คอลัมน์ที่ใช้ตัดสินมาเลย** ⇒ จอต้องไม่เขียน "ครบแล้ว"
 */
export function moDetailsMissing(order) {
  const known = MO_DETAIL_FIELDS.some(f => order && f.key in order);
  if (!known) return { known: false, missing: [] };
  return { known: true, missing: MO_DETAIL_FIELDS.filter(f => !filled(order?.[f.key])).map(f => f.label) };
}

/**
 * ข้อความสั้นสำหรับป้ายบนแถว · `null` = ไม่ต้องขึ้นป้าย
 * (ใบปกติ หรือ ยังไม่รู้เพราะไม่ได้ select ธงมา)
 */
export function detailsPendingText(order) {
  if (isDetailsPending(order) !== true) return null;
  const { known, missing } = moDetailsMissing(order);
  if (!known) return 'รอเพิ่มรายละเอียด';
  if (!missing.length) return 'รอกดยืนยันรายละเอียด';   // เติมครบแล้วแต่ธงยังไม่หลุด
  return `รอเพิ่มรายละเอียด: ${missing.join(' · ')}`;
}

/**
 * กรอกครบพอจะปลดธงหรือยัง — ใช้ตอนบันทึกฟอร์มย้อนหลัง
 * @param {object} patch ค่าที่กำลังจะเขียน (ฟอร์ม) — ทับค่าในใบเดิม
 * 🔴 ปลดธงได้ก็ต่อเมื่อครบทุกช่อง · ขาดช่องใดช่องหนึ่ง = คงธงไว้ (ยังต้องตามเก็บ)
 */
export function canClearDetailsFlag(order, patch = {}) {
  const merged = { ...(order || {}), ...(patch || {}) };
  return MO_DETAIL_FIELDS.every(f => filled(merged[f.key]));
}

export default { MO_DETAIL_FIELDS, isDetailsPending, moDetailsMissing, detailsPendingText, canClearDetailsFlag };
