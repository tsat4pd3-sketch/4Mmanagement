/* ═══ 📋 ความต้องการล่วงหน้าจาก "ใบผลิตที่เปิดอยู่" — ให้สโตร์เห็นตั้งแต่ไลน์เปิดใบ (2026-11-04 · คำสั่ง user)

   user: *"ให้สโตร์เห็นตั้งแต่เปิดใบ ปิดคือผลิตจบแล้ว จะเอางานที่ไหนมาผลิต ถ้าไม่แจ้งล่วงหน้า"*
   เดิม: `fn_explode_child_demand` (DR trigger) ระเบิด BOM **ตอนปิดใบ (`confirmed`) เท่านั้น**
   ⇒ ไลน์เปิดใบ 20058490 แล้ว สโตร์ไม่เห็นว่าต้องเตรียม 50027085 จนกว่าจะผลิตเสร็จ

   กติกาของไฟล์นี้ (pure · เทส `__tests__/openOrderDemand.test.mjs`):
   · 🔴 **อ่านอย่างเดียว ไม่เขียน DB** — ตอนปิดใบ trigger ยังเป็นตัวตัดสต็อก/สะสม/ออกใบเหมือนเดิม
     ⇒ จอนี้เป็น "ตัวเลขล่วงหน้า" ห้ามเอาไปสร้างใบเบิก/ใบขอซื้อเอง (ไม่งั้นนับซ้ำตอนปิดใบ)
   · 🔴 **เลือกแถว BOM ชุดเดียวกับ trigger เป๊ะ** — `bom_items.product_id` = id ของ FG ที่ active ·
     แถว `is_active` · ข้ามลูกที่เป็นชั้น OP · FG เป็นชั้น OP = ไม่ระเบิด · จำนวน = `qty × qty_per_unit`
     (ตัดสินคนละแบบกับ trigger = สโตร์เตรียมตามจอนี้ แต่ตอนปิดใบระบบตัดอีกตัวเลข)
   · ยอดหน้าไลน์หักก่อน (trigger หักมินิสโตร์ของไลน์ที่เปิดกะก่อน) ⇒ `shortAtLine` = ส่วนที่สโตร์ต้องส่ง
   · 🔴 ไม่รู้ยอดหน้าไลน์ (ไม่มีแถวสรุป) = `null` ห้ามบีบเป็น 0 · FG ที่หาใน Product Master ไม่เจอ /
     ไม่มี BOM ต้องคืนรายการออกไปให้จอเขียนบอก ห้ามหายเงียบ
   · หน่วย (`uom`) ติดมาด้วย — BOM มีทั้ง PC และ KG ห้ามบวกต่างหน่วยเงียบ (ธง `uomConflict`)
   ═══════════════════════════════════════════════════════════════════════════════ */

const key = (s) => String(s ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * @param {object} a
 * @param {Array} a.orders    ใบผลิตสถานะ open: { id, mat_no, qty, prod_no, line_name }
 * @param {Array} a.products  `dr_products` (id, mat_no, name, is_active, is_operation)
 * @param {Array} a.bom       `bom_items` (product_id, mat_no, part_name, qty_per_unit, uom, is_active)
 * @param {(line:string, mat:string) => number|null} a.stockAt  ยอดคงเหลือ (null = ไม่มีแถว)
 * @returns {{ rows:Array, noProduct:string[], noBom:string[], opOrders:number, orders:number }}
 */
export function openOrderDemand({ orders = [], products = [], bom = [], stockAt = () => null } = {}) {
  const prodByMat = new Map();
  for (const p of products || []) {
    const m = key(p?.mat_no);
    if (!m || p?.is_active === false || prodByMat.has(m)) continue;   // trigger: `limit 1` ของ is_active
    prodByMat.set(m, p);
  }
  const bomByProduct = new Map();
  for (const b of bom || []) {
    if (!b || b.is_active === false || !b.product_id) continue;
    if (!bomByProduct.has(b.product_id)) bomByProduct.set(b.product_id, []);
    bomByProduct.get(b.product_id).push(b);
  }

  const noProduct = new Set();
  const noBom = new Set();
  let opOrders = 0;
  let counted = 0;
  const byLineMat = new Map();

  for (const o of orders || []) {
    const qty = num(o?.qty);
    const fgMat = key(o?.mat_no);
    const line = key(o?.line_name);
    if (!fgMat || !(qty > 0)) continue;
    const fg = prodByMat.get(fgMat);
    if (!fg) { noProduct.add(fgMat); continue; }
    if (fg.is_operation) { opOrders += 1; continue; }
    const kids = bomByProduct.get(fg.id) || [];
    if (!kids.length) { noBom.add(fgMat); continue; }
    counted += 1;
    for (const b of kids) {
      const child = key(b.mat_no);
      if (!child) continue;
      if (prodByMat.get(child)?.is_operation) continue;              // trigger ข้ามลูกชั้น OP
      const need = qty * num(b.qty_per_unit);
      if (!(need > 0)) continue;
      const k = `${line}\u0001${child}`;
      let e = byLineMat.get(k);
      if (!e) {
        e = { line_name: line, mat_no: child, part_name: key(b.part_name) || key(prodByMat.get(child)?.name), uom: key(b.uom), need: 0, orders: [] };
        byLineMat.set(k, e);
      }
      e.need += need;
      if (b.uom && e.uom && key(b.uom).toUpperCase() !== e.uom.toUpperCase()) e.uomConflict = true;
      e.orders.push({ id: o.id, prod_no: key(o.prod_no), fg_mat: fgMat, qty, need });
    }
  }

  const rows = [...byLineMat.values()].map(e => {
    const atLine = stockAt(e.line_name, e.mat_no);
    const shortAtLine = atLine == null ? null : Math.max(0, e.need - Math.max(0, num(atLine)));
    return { ...e, atLine: atLine == null ? null : num(atLine), shortAtLine };
  }).sort((a, b) => (b.shortAtLine ?? b.need) - (a.shortAtLine ?? a.need)
    || a.line_name.localeCompare(b.line_name, 'th') || a.mat_no.localeCompare(b.mat_no));

  return { rows, noProduct: [...noProduct].sort(), noBom: [...noBom].sort(), opOrders, orders: counted };
}

export default openOrderDemand;
