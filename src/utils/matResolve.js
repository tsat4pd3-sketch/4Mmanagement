/**
 * แปลง "เลขพาร์ทลูกค้า" (RB3B 8C306 BB) → "MAT SAP ภายใน" (10100379)
 *
 * ทำไมต้องมี: FG เข้าคลังด้วย **เลข SAP** (trigger ปิดออเดอร์ผลิตใช้ dr_products.mat_no)
 * แต่ order ลูกค้าจาก EDI 862 อ้าง **เลขลูกค้า** → ถ้าเทียบตรงๆ คนละกุญแจ ไม่มีวันเจอกัน
 * (เจอจริง 2026-08-11: RB3B 8C306 BB ตั้ง p_no ไว้ครบแล้วทั้ง dr_products+kanban_standards
 *  แต่โค้ดตัดสต็อกหา fgStock['RB3B 8C306 BB'] ตรงๆ เลยไม่หักอะไรเลยแบบเงียบๆ)
 *
 * ⚠️ กฎเหล็ก — resolve เฉพาะที่ "ชัดเจนตัวเดียว" เท่านั้น ที่เหลือคืนสถานะให้ผู้เรียกไปบอกผู้ใช้
 * master p_no ปัจจุบันยังไม่ unique จริง (ตรวจ 2026-08-11):
 *   RB3B 16E060 BA → 10100384 | 10100385 | 10106790   ← FG สะอาดทั้ง 3 เลือกไม่ได้
 *   RB3B 16E024 AA → 'E024 (M6 ไม่มีเกลียว)'           ← เลขชั่วคราว ไม่ใช่ SAP
 *   MB3B 8B222 BE  → 50029377                          ← เบอร์ 5 = วัตถุดิบ ไม่ใช่ FG
 *   SP72/SP74/SP83/SP88                                ← หมายเลข "เครื่อง" ที่ถูกกรอกลงช่อง p_no
 * เดาแล้วหักผิดตัว = สร้างข้อมูลเท็จเงียบๆ ซึ่งแย่กว่าไม่หัก — ให้คนตัดสินแทน
 */

/** ตัดขีด/ช่องว่าง/สัญลักษณ์ แล้วเป็นตัวพิมพ์ใหญ่ (กฎ normalize เดียวกับที่ Planner&Sales ใช้ตอน import 862) */
export const normMat = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** เลข SAP ที่ใช้ตัดสต็อกได้ = ตัวเลขล้วน (กัน 'E024 (M6 ไม่มีเกลียว)' / '30047596 & 30052451') */
export const isSapMat = (m) => /^\d+$/.test(String(m ?? '').trim())

/**
 * index จากแถว master ที่มี p_no (dr_products / kanban_standards)
 * @param {Array<{p_no?: string, mat_no?: string}>} rows
 * @returns {Map<string, Set<string>>} normalized p_no → เซ็ตของ mat_no ที่อ้างเลขนั้น
 */
export function buildPnIndex(rows) {
  const idx = new Map()
  ;(rows || []).forEach(r => {
    const k = normMat(r?.p_no)
    const mat = String(r?.mat_no ?? '').trim()
    if (!k || !mat) return
    if (!idx.has(k)) idx.set(k, new Set())
    idx.get(k).add(mat)
  })
  return idx
}

/**
 * @returns {{mat: string|null, status: 'sap'|'mapped'|'ambiguous'|'placeholder'|'none', candidates: string[]}}
 *   sap         = เป็นเลข SAP อยู่แล้ว ใช้ได้เลย
 *   mapped      = เลขลูกค้า จับคู่ได้ชัดเจนตัวเดียว → mat = เลข SAP
 *   ambiguous   = จับคู่ได้หลายตัว ต้องให้คนเลือก (mat = null)
 *   placeholder = จับคู่ได้ตัวเดียวแต่ปลายทางไม่ใช่เลข SAP (mat = null)
 *   none        = ไม่มีใน master เลย ต้องไปตั้ง p_no ก่อน (mat = null)
 */
export function resolveMatNo(matNo, pnIndex) {
  const raw = String(matNo ?? '').trim()
  if (!raw) return { mat: null, status: 'none', candidates: [] }
  if (isSapMat(raw)) return { mat: raw, status: 'sap', candidates: [raw] }

  const hits = [...(pnIndex?.get(normMat(raw)) || [])]
  if (!hits.length) return { mat: null, status: 'none', candidates: [] }
  if (hits.length > 1) return { mat: null, status: 'ambiguous', candidates: hits }
  if (!isSapMat(hits[0])) return { mat: null, status: 'placeholder', candidates: hits }
  return { mat: hits[0], status: 'mapped', candidates: hits }
}

/** ข้อความอธิบายให้ผู้ใช้รู้ว่าต้องไปแก้อะไร (null = ไม่มีปัญหา) */
export function matIssueText(matNo, res) {
  switch (res?.status) {
    case 'ambiguous':
      return `เลข ${matNo} จับคู่ MAT SAP ได้หลายตัว (${res.candidates.join(', ')}) — ระบบไม่เดาให้ ต้องแก้ p_no ให้เหลือตัวเดียวที่ Product Master`
    case 'placeholder':
      return `เลข ${matNo} จับคู่ไปที่ "${res.candidates[0]}" ซึ่งไม่ใช่เลข SAP — ต้องแก้ p_no ที่ Product Master ก่อน`
    case 'none':
      return `เลข ${matNo} ยังไม่จับคู่ MAT SAP — ตั้ง p_no ที่ Product Master หรือปุ่ม 🔗 จับคู่เลข SAP ใน Planner & Sales`
    default:
      return null
  }
}
