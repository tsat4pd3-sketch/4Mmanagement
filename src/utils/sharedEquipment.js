/* 🔗 อุปกรณ์ตัวเดียว หลายแผนก — กติกา "ตัวตนใช้ร่วม · มุมมองแยก" (26/11 · คำสั่ง user)
 *
 * "เครื่องจักร/อุปกรณ์ตัวเดียวกัน — id, ชื่อ, ชนิด, ไลน์ … ทุกส่วนงานต้องเห็นเป็นตัวเดียวกัน
 *  ที่ต่างกันคือมุมมองของแต่ละส่วนงาน (ผลิต = ใช้งาน + AM · ช่าง = PM)"
 *
 * - ตัวตน (แถว `jigs`): ใช้ร่วม ⇒ แผนกหนึ่งแก้ = ทุกแผนกเห็นค่าใหม่ — ต้อง **ตั้งใจ** เท่านั้น
 *   🔴 ห้ามเขียนทับทั้งแถวจากฟอร์มของแผนกตัวเอง (เหตุการณ์ 19–25/11: AM "เพิ่มอุปกรณ์" ที่เลือกเครื่องเดิม
 *      ⇒ upsert ทั้งแถว ⇒ jig_no/part_no ของ JIG MTN 37 เครื่องกลายเป็นค่าว่าง/ค่าของ AM)
 * - มุมมองแผนก (checklists · jig_checkpoints · pm_plans · jig_images.department): แยกกัน
 * - ลบจากจอของแผนกหนึ่ง = ถอดแค่ "มุมมองของแผนกนั้น" ถ้าแผนกอื่นยังใช้เครื่องนี้อยู่ (`deleteMode`)
 */

/** ฟิลด์ตัวตนที่ฟอร์ม PM Setup แก้ได้ */
export const IDENTITY_FIELDS = [
  'name', 'description', 'jig_no', 'process', 'model', 'part_name', 'part_no',
  'line_name', 'machine_no', 'machine_id', 'equipment_type', 'equipment_category',
]

const norm = (v) => (v == null || (typeof v === 'string' && v.trim() === '') ? null : (typeof v === 'string' ? v.trim() : v))

/**
 * คำนวณว่าจะเขียนฟิลด์ตัวตนอะไรลงแถวที่มีอยู่แล้ว
 * @param cur   แถวปัจจุบันใน DB (ค่าล่าสุด)
 * @param orig  ค่าที่ฟอร์มโหลดมาตอนเปิด (null = เปิดแบบ "เพิ่มใหม่" แต่ไปเจอเครื่องเดิม)
 * @param form  ค่าในฟอร์มตอนกดบันทึก
 * @param shared แผนกอื่นใช้เครื่องนี้อยู่ (หรือนับไม่ได้)
 * @returns {{ patch: object, changes: Array<{field, from, to}> }}
 *   ไม่ใช้ร่วม = เขียนตามฟอร์มทั้งหมด (พฤติกรรมเดิม)
 *   ใช้ร่วม + เพิ่มใหม่ = เติมเฉพาะช่องที่ยังว่าง (ห้ามทับของแผนกอื่น)
 *   ใช้ร่วม + แก้ไข = เฉพาะช่องที่คนแก้จริง (ต่างจากตอนเปิด) — `changes` ให้จอถามยืนยัน
 *   ใช้ร่วม + ไม่ใช่ทีมเจ้าของ (`canEdit=false`) = ไม่เขียนเลย · `blocked` = ช่องที่คนพิมพ์ต่างไว้ (ให้จอบอก)
 */
export function identityPatch({ cur, orig, form, shared, canEdit = true }) {
  const patch = {}, changes = [], blocked = []
  for (const f of IDENTITY_FIELDS) {
    if (!(f in form)) continue
    const to = norm(form[f]), now = norm(cur?.[f])
    if (!shared) { patch[f] = to; continue }
    // 🔒 แบบ ก. (user 26/11): หัวเครื่องแก้ได้เฉพาะทีมเจ้าของ — ทีมอื่นไม่เขียนอะไรเลย (รวมช่องว่าง) แค่บอกว่าช่องไหนไม่ถูกบันทึก
    if (!canEdit) { if (to !== now && (!orig || to !== norm(orig[f]))) blocked.push(f); continue }
    if (!orig) {
      if (now == null && to != null) patch[f] = to          // เติมช่องว่างเท่านั้น
      continue
    }
    if (to === norm(orig[f])) continue                      // คนไม่ได้แก้ช่องนี้
    if (to === now) continue
    patch[f] = to
    changes.push({ field: f, from: now, to })
  }
  return { patch, changes, blocked }
}

/** ลบจากจอแผนก: 'equipment' = ลบเครื่องทั้งแถว (ไม่มีแผนกอื่น) · 'view' = ถอดแค่ใบตรวจของแผนกนี้ · 'unknown' = นับไม่ได้ = ห้ามลบ */
export function deleteMode(otherDeptCount, error) {
  if (error || otherDeptCount == null) return 'unknown'
  return otherDeptCount > 0 ? 'view' : 'equipment'
}

export const IDENTITY_LABEL = {
  name: 'ชื่อ', description: 'รายละเอียด', jig_no: 'No.', process: 'Process', model: 'Model',
  part_name: 'Part name', part_no: 'Part no.', line_name: 'ไลน์', machine_no: 'เลขเครื่อง',
  machine_id: 'เครื่องใน Machine Master', equipment_type: 'ชนิด', equipment_category: 'หมวด',
}

/** ทีมเจ้าของหัวเครื่อง = ทีมที่ตั้งใบตรวจเครื่องนี้เป็นทีมแรก (แบบ ก. · user 26/11)
 *  rows = checklists ของเครื่องนี้ `{ department, created_at, id }` · ไม่มีใบตรวจ = null (เครื่องใหม่ ใครตั้งก่อนเป็นเจ้าของ) */
export function ownerTeamOf(rows) {
  const list = (rows ?? []).filter(r => r && r.department)
  if (!list.length) return null
  const key = r => `${r.created_at ?? '9999'}|${r.id ?? ''}`
  return list.reduce((a, b) => (key(b) < key(a) ? b : a)).department
}

/** ทีมนี้แก้หัวเครื่องได้ไหม — อ่านทะเบียนไม่ได้ = ไม่ได้ (fail-closed) · ไม่มีเจ้าของ (เครื่องใหม่) = ได้ */
export function canEditIdentity({ owner, department, error }) {
  if (error) return false
  return owner == null || owner === department
}
