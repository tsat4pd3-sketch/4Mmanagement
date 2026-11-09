/* 🔩 มุม SAP ของยอดในพื้นที่ (2026-11-09 · คำสั่ง user "ทำจอ Stock มุม SAP")
   ระบบเราเก็บ "ชิ้นผ่านขั้น OP" (mat = ชื่อขั้น) เป็นกองแยก แต่ SAP ไม่รู้จักขั้น OP ⇒ ใน SAP ของยังเป็น "ของที่ขั้นกิน"
   (เช่น เหล็ก 50031625) จนกว่าแม่จะคอนเฟิร์ม ⇒ มุม SAP = ของดิบในระบบ + แปลงชิ้นผ่านขั้นกลับเป็นของที่ขั้นกิน
   · สูตรของขั้น = `fn_op_inputs` ฝั่ง DR (ชุดเดียวกับตัวตัดสต็อก) · ชิ้นจากขั้นก่อนหน้าในโซ่ = แปลงต่อลงไป (≤5 ชั้น)
   · ขั้นที่ยังไม่ผูก = แปลงไม่ได้ → `unmapped` (จอต้องบอก ห้ามแอบรวม/ทิ้ง)
   pure — เทส `__tests__/sapView.test.mjs` */

const k = (s) => String(s ?? '').trim();

/**
 * @param {Array<{mat_no, qty}>} parts  ยอดในพื้นที่ (รวมไลน์แล้ว)
 * @param {Map<string, Array<{mat_no, qty_per_unit, is_op_output}>>} inputsOf  ขั้น OP → ของที่ขั้นกิน
 * @returns {{ ops: Array<{mat_no, qty, unmapped:boolean}>, rows: Array<{mat_no, own, fromOps, sap}> }}
 */
export function sapEquivalent(parts = [], inputsOf = new Map()) {
  const own = new Map();
  const add = new Map();
  const ops = [];
  (parts || []).forEach(p => {
    const m = k(p?.mat_no); const q = Number(p?.qty) || 0;
    if (!m) return;
    if (inputsOf.has(m)) { ops.push({ mat_no: m, qty: q, unmapped: !(inputsOf.get(m) || []).length }); return; }
    own.set(m, (own.get(m) || 0) + q);
  });
  const expand = (op, qty, depth) => {
    const ins = inputsOf.get(op) || [];
    ins.forEach(i => {
      const m = k(i.mat_no); const q = qty * (Number(i.qty_per_unit) || 0);
      if (!m || !q) return;
      if (i.is_op_output && depth < 5 && inputsOf.has(m)) expand(m, q, depth + 1);
      else if (!i.is_op_output) add.set(m, (add.get(m) || 0) + q);
    });
  };
  ops.filter(o => !o.unmapped && o.qty > 0).forEach(o => expand(o.mat_no, o.qty, 0));
  const mats = [...new Set([...add.keys()])];
  const rows = mats.sort().map(m => {
    const a = Math.round((add.get(m) || 0) * 1e6) / 1e6; const o = own.get(m) || 0;
    return { mat_no: m, own: o, fromOps: a, sap: Math.round((o + a) * 1e6) / 1e6 };
  });
  return { ops, rows };
}
