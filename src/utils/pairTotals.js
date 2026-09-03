/* ═══ pairTotals — รวมยอด "ภาพใหญ่" โดยนับงานคู่ RH/LH เป็น 1 คู่/stroke (2026-07-21) ═══
   งานคู่ (แม่พิมพ์คู่ ปั๊มครั้งเดียวได้ทั้ง LH+RH = 1 stroke) ต้องไม่บวกชิ้น LH+RH ซ้ำในสรุปรวม
   คู่ (pair_mat_no) ที่มีทั้ง 2 พาร์ทในชุดข้อมูล → เป้า/ผลิต = max ของสองข้าง (= จำนวน stroke)
   พาร์ทเดี่ยว/ไม่มีคู่ในชุด → บวกตามปกติ · ต้องตั้ง pair_mat_no ครบทั้ง 2 ทางใน Product Master
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * @param {Array<{mat_no, target, produced}>} perMat  ยอดต่อ MAT.NO
 * @param {(mat:string)=>string|null} pairOf  คืน pair_mat_no ของ mat (จาก Product Master)
 * @returns {{ target:number, produced:number, hasPair:boolean }}
 */
/* ── collapseOps — ยุบ "รายการขั้นตอน (OP)" เข้าพาร์ทจริง ก่อนรวมยอดภาพใหญ่ (2026-08-17) ──
   งานขับนัท 1 ชิ้นผ่านหลาย OP (M6→M8→M10) แต่ละ OP มีใบงานของตัวเอง → ห้ามบวกซ้ำ
   opMap มาจาก opInfoSync() (src/utils/opItems.js — dr_products.is_operation/op_parent_mat)
   กติกา: - แถวที่ไม่ใช่ OP = ผ่านตามเดิม
          - OP ที่ "พาร์ทจริงอยู่ในชุดข้อมูล" = ตัดทิ้ง (ตัวจริงถือยอดอยู่แล้ว — เคสขาดาว+ขาต้นคู่กัน)
          - OP พาร์ทจริงไม่อยู่ในชุด = ยุบกลุ่มพี่น้อง OP เดียวกันเหลือแถวเดียว ใช้ max ของขั้น
            (ทุกขั้นทำชิ้นเดียวกัน — max = จำนวนชิ้นที่เข้าอย่างน้อย 1 ขั้น ใกล้ความจริงสุดเมื่อไม่มีตัวจริง)
          - OP ที่ยังไม่ผูกพาร์ทจริง (parent null) = นับแบบเดิม (worklist ใน /products ให้คนเติม ห้ามเดา)
   opMap ว่าง/ไม่ส่ง = คืน input เดิมเป๊ะ (backward-compatible) */
export function collapseOps(perMat, opMap) {
  if (!opMap || !Object.keys(opMap).length) return perMat;
  const present = new Set(perMat.map(r => r.mat_no).filter(m => m != null && !opMap[m]));
  const out = [], groups = {};
  perMat.forEach(r => {
    const op = r.mat_no != null ? opMap[r.mat_no] : null;
    if (!op) { out.push(r); return }
    const parent = op.parent;
    if (!parent) { out.push(r); return }               // ยังไม่ผูกพาร์ทจริง — คงนับเดิม
    if (present.has(parent)) return;                    // พาร์ทจริงถือยอดแล้ว — ขั้นไม่บวกซ้ำ
    /* `_ops` = ชั้น OP ที่ยุบมาเป็นแถวนี้ (client-only ขึ้นต้น _ ไม่ลง DB)
       จำเป็นเพราะ pair_mat_no ของงานคู่ถูกประกาศไว้ที่ "ชั้น OP" ไม่ใช่ที่พาร์ทจริง
       ยุบแล้วทิ้ง = คู่ที่คนละพาร์ทจริงจับกันไม่ติด แล้วบวกซ้ำ (ดู resolvePairAcrossOps) */
    const g = groups[parent] = groups[parent] || { mat_no: parent, target: 0, produced: 0, _ops: [] };
    if (r.mat_no != null) g._ops.push(r.mat_no);
    g.target   = Math.max(g.target,   Number(r.target)   || 0);
    g.produced = Math.max(g.produced, Number(r.produced) || 0);
  });
  return out.concat(Object.values(groups));
}

/* ── คู่ RH/LH ที่ประกาศไว้ที่ชั้น OP ต้องรอดจากการยุบเข้าพาร์ทจริง (2026-09-03) ──
   เคสจริง HDF1: 90031601 (RH) ↔ 90031602 (LH) เป็นคู่กัน แต่ op_parent_mat คนละตัว
   → ยุบแล้วได้ 2 แถวคนละพาร์ทจริงซึ่ง "ไม่ได้ผูก pair_mat_no ต่อกัน" (และห้ามไปผูก —
     กฎเหล็ก: FG ที่ผลิตแยกกันได้ ห้ามตั้ง pair_mat_no) ⇒ บวกซ้ำเป็น 2 เท่า
   ⚠️ คืน pairOf ตัวเดิมเป๊ะเมื่อไม่มีแถวที่ยุบมาจาก OP → พฤติกรรมเดิมทุกกรณี */
function resolvePairAcrossOps(rows, pairOf) {
  const owner = new Map();                       // opMat → mat_no ของแถวที่ยุบมันไว้
  rows.forEach(r => (r._ops || []).forEach(op => owner.set(op, r.mat_no)));
  if (!owner.size) return pairOf;
  const inRows = new Set(rows.map(r => r.mat_no).filter(m => m != null));
  const byMat  = new Map(rows.map(r => [r.mat_no, r]));
  return (mat) => {
    const direct = pairOf(mat);
    if (direct != null && inRows.has(direct)) return direct;   // คู่ตรงตัวมีในชุด = ใช้เลย
    for (const op of byMat.get(mat)?._ops || []) {
      const p = op != null ? pairOf(op) : null;
      const via = p != null ? owner.get(p) : null;
      if (via != null && via !== mat) return via;
    }
    return direct;                                             // หาไม่เจอ = ค่าเดิม
  };
}

/** รวมยอดแบบ "ยุบชั้น OP แล้วนับคู่ RH/LH ครั้งเดียว" — ลำดับนี้ห้ามสลับ
 *  @returns {{ target:number, produced:number, hasPair:boolean }} */
export function pairAwareOpTotal(perMat, pairOf, opMap = null) {
  const rows = opMap ? collapseOps(perMat, opMap) : perMat;
  return pairAwareTotal(rows, resolvePairAcrossOps(rows, pairOf));
}

/* ── orderTotal — รวมยอดจากลิสต์ใบงานแบบ pair-aware + op-aware ในตัวเดียว ──
   ใช้แทน os.reduce(...) ตรงๆ ในจอสรุป (ไม่มี pair/op = ผลเท่าบวกตรงทุกกรณี)
   pick(o) = ค่าที่จะรวมต่อใบ (เป้า/ผลิตจริง) · ใบ mat_no null รวมแยกไม่เข้า pair/op logic */
export function orderTotal(orders, pick, pairOf = () => null, opMap = null) {
  const perMat = {}; let nullSum = 0;
  (orders || []).forEach(o => {
    const v = Number(pick(o)) || 0;
    if (o.mat_no == null) { nullSum += v; return }
    (perMat[o.mat_no] = perMat[o.mat_no] || { mat_no: o.mat_no, target: 0, produced: 0 }).target += v;
  });
  return pairAwareOpTotal(Object.values(perMat), pairOf, opMap).target + nullSum;
}

export function pairAwareTotal(perMat, pairOf) {
  const byMat = {};
  perMat.forEach(r => { if (r.mat_no != null) byMat[r.mat_no] = r; });
  const seen = new Set();
  let target = 0, produced = 0, hasPair = false;
  perMat.forEach(r => {
    const mat = r.mat_no;
    if (mat != null && seen.has(mat)) return;
    const pm = mat != null ? pairOf(mat) : null;
    const partner = pm != null && byMat[pm] ? byMat[pm] : null;
    if (partner) {
      hasPair = true;
      seen.add(mat); seen.add(partner.mat_no);
      target   += Math.max(Number(r.target) || 0, Number(partner.target) || 0);
      produced += Math.max(Number(r.produced) || 0, Number(partner.produced) || 0);
    } else {
      if (mat != null) seen.add(mat);
      target += Number(r.target) || 0; produced += Number(r.produced) || 0;
    }
  });
  return { target, produced, hasPair };
}
