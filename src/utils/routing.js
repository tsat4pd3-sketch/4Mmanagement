/**
 * routing.js — ลำดับกระบวนการของพาร์ท (part_routings)
 *
 * ตาราง `part_routings` คือชั้นที่ระบบไม่เคยมี: `bom_items` บอกแค่ "FG ประกอบจากลูกอะไร"
 * แต่ไม่บอกว่าพาร์ทหนึ่งต้องผ่านกี่ขั้น เรียงยังไง (ปั๊ม 300T → ปั๊ม 600T → ประกอบ)
 *
 * กติกา:
 *  · ค่า null ในแถว routing = "ให้ไปหาจากข้อมูลจริง" — ห้ามเดาแทนผู้ใช้ ให้ resolver เป็นคนเติม
 *  · พาร์ทที่ยังไม่ได้ลง routing → `fallbackSteps()` สร้างขั้นเดียวจาก dr_products.line_name
 *    (ดีกว่าโชว์ว่างเปล่า และบอกที่มาไว้ด้วย `is_fallback` เพื่อให้ UI เตือนได้)
 *
 * ⚠️ ไฟล์นี้ pure ไม่ import supabase — เพื่อให้ `lib/vsmModel.js` ที่ใช้ต่อยังทดสอบได้
 *    การโหลดจาก DB อยู่ที่หน้าที่เรียกใช้ (VSM.jsx)
 */

/** จัดกลุ่มแถว part_routings ที่โหลดมาแล้ว → { [mat_no]: step[] } เรียงตาม seq */
export function groupRoutings(rows = []) {
  const by = {};
  [...rows].sort((a, b) => (a.seq || 0) - (b.seq || 0))
    .forEach(r => { (by[r.mat_no] ||= []).push(r); });
  return by;
}

/**
 * ขั้นตั้งต้นเมื่อพาร์ทยังไม่ได้ลง routing — 1 ขั้นจากไลน์ที่ผลิตพาร์ทนั้น
 * ไม่ใช่การเดา: `dr_products.line_name` คือข้อมูลจริงที่ระบบมี แค่ยังไม่ละเอียดพอ
 */
export function fallbackSteps(matNo, product) {
  if (!product?.line_name) return [];
  return [{
    mat_no: matNo, seq: 1,
    step_name: product.line_name,
    line_name: product.line_name,
    process_type: product.process_type || null,
    ct_sec: null, setup_sec: null, lot_size: null, operators: null,
    is_outsourced: false, vendor_name: null, wip_label: null, wip_qty: null,
    is_fallback: true,
  }];
}

/** routing ที่ลงไว้ ถ้าไม่มีก็ใช้ fallback — จุดเดียวที่ตัดสินใจเรื่องนี้ */
export function stepsFor(matNo, routings, products) {
  const r = routings?.[matNo];
  if (r?.length) return r;
  const p = (products || []).find(x => x.mat_no === matNo);
  return fallbackSteps(matNo, p);
}

/** ลำดับถัดไปที่ว่าง (ใช้ตอนเพิ่มขั้นใหม่ในหน้าแก้ไข) */
export const nextSeq = (steps = []) => (steps.reduce((m, s) => Math.max(m, s.seq || 0), 0) + 1);

/** เรียงลำดับใหม่ให้เป็น 1..n ต่อเนื่อง (หลังลบ/สลับขั้น) */
export const renumber = (steps = []) =>
  [...steps].sort((a, b) => (a.seq || 0) - (b.seq || 0)).map((s, i) => ({ ...s, seq: i + 1 }));
