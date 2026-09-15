/* ═══ 🧩 ระเบิดของเสียของ "ขั้นตอน (OP)" ให้เป็นเลข SAP จริง ═══════════════════════════════
   ที่มา (user 2026-09-15 · ส่งจอ /products + ใบ scrap มาให้ดู):
     "พอระบบไม่มี BOM ว่า OP นี้คืออะไรประกอบกัน เวลาตัด scrap เลขนี้ไม่มีใน SAP มันจะไม่ตรง
      … มันต้องดึง BOM ที่มันประกอบมาตัด ไม่ใช่ตัดตัวมันเอง เพราะตัวมันเองยังไม่สมบูรณ์"

   ── ปัญหา ────────────────────────────────────────────────────────────────────────────
   ชั้น OP (`dr_products.is_operation`) คือ "ขั้นตอน" ที่ SAP ไม่มีตัวตนให้ (เลขตั้งเอง: `90031602`,
   `173 M8(ไม่มีเกลียว)`, `FENDER`…) พอของเสียหลุดที่ขั้นนั้น ใบ FM-PD2-002 พิมพ์เลขนี้ออกไป
   **สโตร์ตัดสต๊อก SAP ไม่ได้** — และจะตัด "ตัวมันเอง" ก็ไม่ได้ เพราะชิ้นนั้นยังไม่เคยเข้าคลัง
   (`fn_post_confirmed_output` return null เมื่อ is_operation ⇒ ขั้น OP ไม่เคยมียอดในคลังอยู่แล้ว)
   ของที่ **หายไปจริง** = วัตถุดิบ/พาร์ทที่ถูกใส่เข้าไปจนถึงขั้นนั้น ⇒ ต้องตัด "ขาเข้า" ไม่ใช่ "ขาออก"

   ── กติกาที่ตกผลึก (ห้ามพลาด) ──────────────────────────────────────────────────────────
   1. **สูตรของขั้น = ผูกเฉพาะของที่ "ขั้นนั้น" ใส่เข้าไป (delta) ห้ามใส่แบบสะสม**
      ขั้นก่อนหน้าในสายเดียวกันระบบไล่ให้เอง (parent เดียวกัน + `op_seq` น้อยกว่า)
      ⇒ ตัด HDF (seq 10) ได้คอยล์ · ตัด LASER (seq 20) ได้คอยล์เหมือนกันโดยไม่ต้องคีย์ซ้ำ
   2. **`op_seq` ว่าง = ขั้นเดี่ยว** (SUB APRON ส่วนใหญ่) — ใช้สูตรของตัวเองอย่างเดียว ไม่ไล่สาย
      (ห้ามเดาลำดับจากชื่อ/วันที่สร้าง — เดาผิดแล้วตัดของผิดตัว ย้อนยากกว่าปล่อยให้คนกรอก)
   3. **ไม่มีสูตรเลยทั้งสาย = `no_bom` ⇒ ต้องเตือนบนจอ ห้าม fallback ไปตัด `op_parent_mat` เอง**
      (พาร์ทแม่ก็ "ยังไม่สมบูรณ์" เหมือนกัน + BOM แม่เป็นของทั้งใบ ไม่ใช่ของขั้นนี้ — ตัดเกินทันที)
   4. **มาตเดียวโผล่หลายขั้น = คืนยอดรวม (sum) แต่ติดธง `dupMats` ให้จอเตือน** — ถูกตามกฎ delta
      แต่เป็นอาการคลาสสิกของการคีย์แบบสะสม ⇒ ให้คนเห็น ไม่ใช่ระบบเงียบแล้วตัดเบิ้ล

   pure ทั้งไฟล์ — ไม่แตะ supabase/react (เทส `src/utils/__tests__/scrapExplode.test.mjs`)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const norm = (s) => (s ?? '').toString().trim();
const key = (s) => norm(s).toUpperCase();

/** ปัดทศนิยม 3 ตำแหน่ง — coil เป็น KG (0.45/1.556) ปัดเป็นจำนวนเต็มไม่ได้ ของหายเป็นสิบเปอร์เซ็นต์ */
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * mat นี้เป็น "ขั้นตอน (OP)" ไหม — **ทนช่องว่าง/ตัวพิมพ์** โดยตั้งใจ
 * ⚠️ ถ้าเทียบแบบ exact แล้วพลาด อาการคือ "ไม่มีป้ายเตือน ไม่มีปุ่มระเบิด" = ใบที่ตัด SAP ไม่ได้
 *    หลุดออกไปเงียบๆ ซึ่งคือบั๊กที่ฟีเจอร์นี้เกิดมาเพื่อแก้ ⇒ ยอมเทียบหลวมดีกว่าพลาดเงียบ
 * @returns {{parent:string|null, seq:number|null}|null}
 */
export function opInfoOf(mat, opMap = {}) {
  const m = norm(mat);
  if (!m) return null;
  if (opMap[m]) return opMap[m];
  const k = key(m);
  const hit = Object.keys(opMap).find(x => key(x) === k);
  return hit ? opMap[hit] : null;
}

/**
 * ลำดับขั้นตั้งแต่ขั้นแรกจนถึงขั้นที่ของเสียหลุด (สายเดียวกัน = `op_parent_mat` เดียวกัน)
 *
 * @param {string} mat     mat_no ของขั้นที่ของเสียหลุด
 * @param {Array}  opRows  แถว OP ทั้งหมด [{ mat_no, name, op_parent_mat, op_seq, is_active }]
 * @returns {Array} ขั้นเรียงจาก seq น้อย→มาก (รวมตัวมันเอง) · [] = ไม่ใช่ OP
 */
export function opChain(mat, opRows = []) {
  const m = key(mat);
  const self = (opRows || []).find(o => key(o?.mat_no) === m);
  if (!self) return [];
  const parent = key(self.op_parent_mat);
  const seq = self.op_seq == null ? null : Number(self.op_seq);
  // ยังไม่ผูกพาร์ทจริง / ไม่รู้ลำดับขั้น → ถือเป็นขั้นเดี่ยว (ห้ามเดาสาย)
  if (!parent || !Number.isFinite(seq)) return [self];
  return (opRows || [])
    .filter(o => {
      if (o?.is_active === false) return false;              // ขั้นที่เลิกใช้แล้วไม่ใช่ขาเข้าของวันนี้
      if (key(o?.op_parent_mat) !== parent) return false;
      const s = o?.op_seq == null ? null : Number(o.op_seq);
      return Number.isFinite(s) && s <= seq;
    })
    .sort((a, b) => Number(a.op_seq) - Number(b.op_seq) || key(a.mat_no).localeCompare(key(b.mat_no)));
}

/**
 * ระเบิด 1 แถวของเสีย → รายการที่ตัดสต๊อก SAP ได้จริง
 *
 * @param {object}   row            แถวในใบ scrap (ใช้ mat_no, qty)
 * @param {object}   ctx
 * @param {object}   ctx.opMap      { [mat]: {parent, seq} } จาก opItems.opInfoSync() — ตัวชี้ขาดว่าเป็น OP
 * @param {Array}    ctx.opRows     แถว OP ทั้งหมด (ไล่ขั้นก่อนหน้า)
 * @param {Function} ctx.bomOf      (mat) => [{ mat_no, part_no, part_name, qty_per_unit, uom }]
 * @returns {{status:'not_op'|'ok'|'no_bom', lines:Array, steps:Array, dupMats:string[]}}
 *   lines[i] = { mat_no, part_no, part_name, uom, qty, from:[{mat,name,seq}] }
 */
export function explodeScrapRow(row, ctx = {}) {
  const { opMap = {}, opRows = [], bomOf = () => [] } = ctx;
  const mat = norm(row?.mat_no);
  const qty = Number(row?.qty) || 0;
  const empty = { lines: [], steps: [], dupMats: [] };
  const info = opInfoOf(mat, opMap);
  if (!mat || !info) return { status: 'not_op', ...empty };

  const chain = opChain(mat, opRows);
  const steps = chain.length ? chain : [{ mat_no: mat, name: row?.part_name || '', op_seq: info.seq ?? null }];

  const acc = new Map();
  steps.forEach(st => {
    (bomOf(st.mat_no) || []).forEach(b => {
      const cm = norm(b?.mat_no);
      if (!cm) return;
      const per = Number(b?.qty_per_unit) || 0;
      const k = key(cm);
      const cur = acc.get(k) || {
        mat_no: cm, part_no: norm(b.part_no), part_name: norm(b.part_name), uom: norm(b.uom), qty: 0, from: [],
      };
      cur.qty += qty * per;
      cur.from.push({ mat: norm(st.mat_no), name: norm(st.name), seq: st.op_seq ?? null });
      acc.set(k, cur);
    });
  });

  const lines = [...acc.values()].map(l => ({ ...l, qty: round3(l.qty) }));
  const dupMats = lines.filter(l => new Set(l.from.map(f => key(f.mat))).size > 1).map(l => l.mat_no);
  return { status: lines.length ? 'ok' : 'no_bom', lines, steps, dupMats };
}

/**
 * สรุปทั้งใบ — ใช้ตัดสินใจว่าจะขึ้นแถบเตือน/ปุ่มระเบิดไหม (จอเรียกตัวเดียวจบ ไม่ต้องวน explode เอง)
 * @returns {{opRowsCount:number, ready:Array, blocked:Array}}
 *   ready   = แถว OP ที่ระเบิดได้ [{ item, result }]
 *   blocked = แถว OP ที่ยังไม่มีสูตร [{ item, result }] — ต้องเตือน ห้ามปล่อยผ่าน
 */
export function scanScrapItems(items = [], ctx = {}) {
  const ready = [], blocked = [];
  (items || []).forEach(item => {
    const r = explodeScrapRow(item, ctx);
    if (r.status === 'ok') ready.push({ item, result: r });
    else if (r.status === 'no_bom') blocked.push({ item, result: r });
  });
  return { opRowsCount: ready.length + blocked.length, ready, blocked };
}
