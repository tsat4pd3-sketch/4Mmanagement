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

/* ── ยุบงานคู่ให้เหลือ "1 shot" สำหรับสายเวลามาตรฐานของ OEE (2026-09-18 · user ยืนยัน) ──
   user: *"ถ้างานคู่ แบบ gang die / 1 shot ได้งาน 2 ชิ้น หรือ คู่ซ้าย-ขวา ต้องนับเป็น shot หรือ cycle"*

   🔴 กติกาที่ต้องแยกให้ขาด — **ชิ้น ≠ shot**:
     · %Q · ยอดผลิต · ของเสีย  → นับ **ชิ้น** (1 shot = 2 ชิ้น) ห้ามยุบ
     · %P (เวลามาตรฐาน Σ qty×CT) → นับ **shot** เพราะ CT ที่ตั้งไว้คือเวลาต่อ 1 จังหวะเครื่อง
   ไม่ยุบ = ตัวเศษของ %P เป็น 2 เท่า → ทะลุ 100 แล้วโดน cap เงียบ
   วัดจริง 45 วัน (ratio = เวลามาตรฐาน ÷ เวลาเครื่องเดิน · เกิน 1 = เป็นไปไม่ได้):
     LASER-345 1.80→1.04 · HDF2 1.15→0.72 · HDF1 1.14→0.66
     ไลน์ไม่มีคู่ไม่ขยับเลย (Line 61 0.71 · BENDING E50 0.59) = ยืนยันว่าแตะเฉพาะไลน์งานคู่

   แถวเข้า/ออก = { mat_no, qty, ct, winStart?, winEnd? } · คู่ที่เจอทั้ง 2 ข้างในชุด →
   เหลือแถวเดียว: qty = max (จำนวน shot) · ct = max · window = union (วิ่งพร้อมกันจังหวะเดียว)
   ⚠️ `pairOf` ไม่ส่ง/ไม่มีคู่ในชุด = **คืนแถวเดิมเป๊ะทุกกรณี** (backward compatible) */
export function collapsePairShots(rows, pairOf = () => null) {
  const byMat = new Map();
  rows.forEach(r => { if (r?.mat_no != null) byMat.set(r.mat_no, r) });
  const seen = new Set();
  const out = [];
  rows.forEach(r => {
    const mat = r?.mat_no;
    if (mat != null && seen.has(mat)) return;
    const pm = mat != null ? pairOf(mat) : null;
    const partner = pm != null && pm !== mat ? byMat.get(pm) : null;
    if (!partner) { if (mat != null) seen.add(mat); out.push(r); return }
    seen.add(mat); seen.add(partner.mat_no);
    // ตัวรอด = ข้างที่ยอดมากกว่า (ถือ mat_no ไว้ให้ matRunMinMap/ชื่อพาร์ทอ้างถึงได้เหมือนเดิม)
    const keep = (Number(r.qty) || 0) >= (Number(partner.qty) || 0) ? r : partner;
    const nums = [r, partner].map(x => [Number(x.winStart), Number(x.winEnd)]);
    const starts = nums.map(n => n[0]).filter(Number.isFinite);
    const ends   = nums.map(n => n[1]).filter(Number.isFinite);
    out.push({
      ...keep,
      qty: Math.max(Number(r.qty) || 0, Number(partner.qty) || 0),
      ct:  Math.max(Number(r.ct)  || 0, Number(partner.ct)  || 0),
      ...(starts.length ? { winStart: Math.min(...starts) } : {}),
      ...(ends.length   ? { winEnd:   Math.max(...ends)   } : {}),
      _pairedWith: keep.mat_no === mat ? partner.mat_no : mat,
    });
  });
  return out;
}

/* ═══ งานคู่ กับ "ภาระเวลา" (shift-load) ตอน **วางแผน** — 2026-09-22 ═══════════════
   ที่มา: audit แผนผลิต 22/09 — `ProductionPlan` บวก `qty ÷ กำลังต่อกะ` ของ RH และ LH
   แยกกัน ทั้งที่ปั๊มทีเดียวได้ทั้งคู่ ⇒ โหลดของคู่ถูกนับ **2 เท่า**
   วัดจริงในฐาน DR วันเดียวกัน (คู่ที่มี demand ครบทั้ง 2 ข้าง):
     20065635 ↔ 20065715  LASER-789         (85,320 / 86,091 ชิ้น)
     20059957 ↔ 20059959  LINE D 110&300T   (76,447 / 81,367)
     20059966 ↔ 20059967  LINE D 110&300T   (85,516 / 85,212)
   ⇒ LINE D (ซึ่ง `std_night_shift = 0` = ไม่มีกะดึกให้เปิด) ถูกดันไป tier "🚨 เกินกำลัง"
     ทั้งที่โหลดจริงประมาณครึ่งเดียว

   🔴 กติกา (ต่อจากกฎเหล็ก "ชิ้น ≠ shot" ใน CLAUDE.md):
     · **ยอดชิ้น** (ต้องส่งลูกค้า/ของเสีย/%Q) = **บวกตามปกติ** — RH กับ LH ส่งแยกใบ เป็นชิ้นจริงทั้งคู่
     · **ภาระเวลา / จำนวน shot** = **max ของสองข้าง** — ข้างที่กินเวลามากกว่าเป็นตัวกำหนด
   เลือก `max(load)` ไม่ใช่ `max(qty) ÷ min(cap)` เพราะข้างที่แทบไม่เคยผลิตเดี่ยวจะมี median
   กำลังต่ำผิดปกติ แล้วดึงโหลดทั้งคู่เฟ้อขึ้น (overstate โหลด = สั่งเปิด OT เกินจำเป็น)      */

/**
 * รวม shift-load ของหลายพาร์ทในหน่วยเดียวกัน โดยยุบคู่ RH/LH เป็นภาระเดียว
 * @param {Record<string, number>|Map<string, number>} loadByMat  mat_no → ภาระ (หน่วยอะไรก็ได้ แต่ต้องหน่วยเดียวกัน)
 * @param {(mat: string) => string|null|undefined} pairOf  คืน pair_mat_no ของ mat (จาก Product Master)
 * @returns {number} ผลรวมหลังยุบคู่ — คู่ที่มีข้างเดียวในชุดข้อมูล นับตามปกติ (ไม่ใช่คู่กันในรอบนี้)
 */
export function pairLoadTotal(loadByMat, pairOf = () => null) {
  const m = loadByMat instanceof Map
    ? new Map([...loadByMat].map(([k, v]) => [k, Number(v) || 0]))
    : new Map(Object.entries(loadByMat || {}).map(([k, v]) => [k, Number(v) || 0]));
  const seen = new Set();
  let total = 0;
  for (const [mat, load] of m) {
    if (seen.has(mat)) continue;
    seen.add(mat);
    const pm = pairOf(mat);
    // คู่ต้อง "อยู่ในชุดข้อมูลรอบนี้" ด้วย — ไม่มีอีกข้าง = ผลิตเดี่ยวรอบนี้ นับเต็ม
    if (pm != null && pm !== mat && m.has(pm)) {
      seen.add(pm);
      total += Math.max(load, m.get(pm));
    } else total += load;
  }
  return total;
}
