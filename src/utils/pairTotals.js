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
