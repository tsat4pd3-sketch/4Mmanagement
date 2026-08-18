/* ═══ wipChain — คำนวณ WIP ระหว่างขั้น (ชั้น OP) จากใบผลิตที่มีอยู่แล้ว (2026-08-18) ═══
   หลัก: ทุกขั้น OP เปิด/ปิดใบมียอดผลิตสะสมอยู่แล้ว + FG ปลายทางก็มี →
     "ค้างระหว่างทาง (in-flight)" = Σสะสมของขั้น − Σสะสมของปลายทาง  (ทุกชิ้นเป็น 1:1 กับ FG)
   โดยหน้างานไม่ต้องคีย์รับ-จ่ายสักครั้ง — เป็นบัญชี "ภายในแผนก" ล้วน ไม่เกี่ยว SAP

   ข้อจำกัดที่รู้ (แสดงบนจอเสมอ ห้ามเงียบ):
   - ของเสียระหว่างทาง/ยอดก่อนเริ่มระบบ ทำตัวเลข drift → มี baseline "นับจริง" (wip_adjustments)
   - mat เดียวใช้หลายสถานี (เช่น 90031601 = HDF1+LS345): แยกยอดต่อสถานีด้วย line ของ session
     แล้ว "เรียงตามยอดสะสมมาก→น้อย = ลำดับการไหล" (ต้นทางย่อมสะสม ≥ ปลายทางเสมอ ยกเว้นของเสียเยอะ)
   - ตัวเลขติดลบ = baseline/ของเสียยังไม่ถูกปรับ → โชว์พร้อม ⚠ ห้ามซ่อนเป็น 0 เงียบๆ

   pure ทั้งไฟล์ — ไม่แตะ supabase/react (เทสตรงๆ ได้)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** ยอดผลิตของใบ 1 ใบ ตามกติกากลาง (สอดคล้อง DailyReport):
 *  confirmed = qty_ok ?? qty · สถานะอื่น (open/carry_over/imported/cancelled) = qty_actual ?? 0 */
export const orderQty = (o) =>
  o.status === 'confirmed' ? Number(o.qty_ok ?? o.qty ?? 0) : Number(o.qty_actual ?? 0)

/** รวมใบผลิตเป็นยอดสะสมต่อ (mat, line) และต่อ mat
 *  orders: [{mat_no, status, qty, qty_ok, qty_actual, opened_at, line_name}]
 *  afterTs (optional, ms): นับเฉพาะใบที่เปิดหลังเวลานี้ (ใช้คู่ baseline นับจริง)
 *  คืน { byMat: {mat: total}, byMatLine: {mat: {line: total}} } */
export function sumOrders(orders, afterTs = null) {
  const byMat = {}
  const byMatLine = {}
  for (const o of orders || []) {
    if (!o.mat_no) continue
    if (afterTs != null) {
      const t = o.opened_at ? Date.parse(o.opened_at) : null
      if (t == null || t <= afterTs) continue
    }
    const q = orderQty(o)
    if (!q) continue
    byMat[o.mat_no] = (byMat[o.mat_no] || 0) + q
    const line = o.line_name || '?'
    ;(byMatLine[o.mat_no] = byMatLine[o.mat_no] || {})[line] =
      (byMatLine[o.mat_no][line] || 0) + q
  }
  return { byMat, byMatLine }
}

/** จัดกลุ่มรายการ OP เป็น "สาย" ต่อพาร์ทจริง (parent)
 *  products: dr_products rows (ต้องมี mat_no, name, line_name, is_active, is_operation, op_parent_mat, op_seq)
 *  registryNames (optional): { mat_no: ชื่อ } จาก parts_master — เผื่อ parent เป็นพาร์ทซื้อนอกที่ไม่มีใน dr_products
 *  คืน [{ parentMat, parentName, parentLine, parentIsProduced, steps: [{mat, name, seq, line}] }]
 *  เรียง step ตาม seq (null ท้าย) แล้วตามเลข · OP ที่ยังไม่ผูก parent ไม่อยู่ในผล (มี worklist ของมันเองแล้ว) */
export function buildWipChains(products, registryNames = {}) {
  const act = (products || []).filter(p => p.mat_no && p.is_active !== false)
  const prodByMat = {}
  act.forEach(p => { if (!prodByMat[p.mat_no]) prodByMat[p.mat_no] = p })
  const chains = {}
  for (const p of act) {
    if (!p.is_operation || !p.op_parent_mat) continue
    const key = p.op_parent_mat
    if (!chains[key]) {
      const par = prodByMat[key]
      chains[key] = {
        parentMat: key,
        parentName: par?.name || registryNames[key] || null,
        parentLine: par?.line_name || null,
        parentIsProduced: !!par && !par.is_operation,
        steps: [],
      }
    }
    chains[key].steps.push({ mat: p.mat_no, name: p.name || '', seq: p.op_seq ?? null, line: p.line_name || null })
  }
  const out = Object.values(chains)
  out.forEach(c => c.steps.sort((a, b) =>
    (a.seq == null) - (b.seq == null) || (a.seq ?? 0) - (b.seq ?? 0)
    || String(a.mat).localeCompare(String(b.mat), undefined, { numeric: true })))
  out.sort((a, b) => String(a.parentMat).localeCompare(String(b.parentMat), undefined, { numeric: true }))
  return out
}

/** สถานีของ mat ที่ใช้หลายไลน์ — เรียงยอดสะสมมาก→น้อย = ลำดับการไหล (ต้นทางก่อน) */
export function stationsOfMat(byMatLine, mat) {
  const m = byMatLine[mat] || {}
  return Object.entries(m).map(([line, cum]) => ({ line, cum }))
    .sort((a, b) => b.cum - a.cum)
}

/** ยอด "ผ่านขั้นสุดท้ายของ mat นี้แล้ว" = สถานีปลายน้ำสุด (ยอดสะสมน้อยสุด) · สถานีเดียว = ยอดตรงๆ */
export function throughOfMat(byMatLine, byMat, mat) {
  const st = stationsOfMat(byMatLine, mat)
  if (st.length <= 1) return byMat[mat] || 0
  return st[st.length - 1].cum
}

/** คำนวณ WIP ของสายหนึ่ง — คืนรายการแถวพร้อมตัวเลขให้จอ render ตรงๆ
 *  baselines: { bufferKey: { qty, ts } } — bufferKey = mat ของขั้น (ยอดนับจริงล่าสุด)
 *  sums / sumsAfter(ts): ผลจาก sumOrders (sumsAfter เรียกซ้ำด้วย afterTs ของ baseline รายแถว)
 *  หมายเหตุ in-flight = ผ่านขั้นนี้แล้วแต่ยังไม่กลายเป็นปลายทาง (สะสมรวมขั้นถัดๆ ไปด้วย — 1:1 ต่อชิ้น FG) */
export function computeChainWip(chain, orders, baselines = {}) {
  const { byMat, byMatLine } = sumOrders(orders)
  const parentCum = byMat[chain.parentMat] || 0
  const rows = chain.steps.map(step => {
    const base = baselines[step.mat] || null
    let stepThrough, parentSince, stations
    if (base) {
      const { byMat: bm, byMatLine: bml } = sumOrders(orders, base.ts)
      stations = stationsOfMat(bml, step.mat)
      stepThrough = throughOfMat(bml, bm, step.mat)
      parentSince = bm[chain.parentMat] || 0
    } else {
      stations = stationsOfMat(byMatLine, step.mat)
      stepThrough = throughOfMat(byMatLine, byMat, step.mat)
      parentSince = parentCum
    }
    const inFlight = (base ? base.qty : 0) + stepThrough - (chain.parentIsProduced ? parentSince : 0)
    // WIP ระหว่างสถานีใน mat เดียวกัน (เช่น ท่อค้างระหว่าง HDF1 → LS345)
    const between = stations.length > 1
      ? stations.slice(0, -1).map((s, i) => ({
          from: s.line, to: stations[i + 1].line, qty: s.cum - stations[i + 1].cum }))
      : []
    return { ...step, stations, stepThrough, inFlight, between, baseline: base }
  })
  return { parentCum, rows }
}
