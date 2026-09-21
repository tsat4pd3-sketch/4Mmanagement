/* การ "เดาทีมช่าง" จากตัวอุปกรณ์ — ส่วนที่ pure ล้วน แยกไฟล์ไว้ให้เทสเรียกได้ (2026-09-21)
 *
 * ทำไมต้องแยกออกจาก `mtnTeams.js`: ไฟล์นั้น import `pmTeams` → `supabaseClient`
 * ⇒ `npm test` (node:test รันไฟล์ตรงๆ ไม่ผ่าน Vite) import เข้าไปไม่ได้เลย
 * ⇒ ตรรกะนี้ไม่เคยถูกเทสได้ · ของที่ "เดาผิดแล้วเงียบ" ต้องมีเทสเสมอ
 *
 * ⚠️ ทุกฟังก์ชันที่นี่เป็นการ **เดา** ไม่ใช่การตัดสิน — ตัวตัดสินจริงว่าใครรับผิดชอบคือ
 *    `mtn_orders.mtn_dept` (ใบซ่อม) · `downtime_logs.call_mtn_team` (เรียกช่าง) ที่คนเลือกเอง
 */

/** ชนิดอุปกรณ์ (machines.equipment_kind) → ทีมที่ "ปกติ" ดูแล */
export const teamForEquipmentKind = (kind) => {
  const k = String(kind || '').trim()
  if (k === 'die') return 'die_maintenance'
  if (k === 'jig') return 'jig_maintenance'
  return 'maintenance'   // machine / facility / ไม่ระบุ
}

/** เดาทีมจาก "ชื่อ" อุปกรณ์ (ใช้เมื่อไม่มีตัวตนในทะเบียน) */
export const guessTeamFromName = (name) => {
  const s = String(name || '').toUpperCase()
  if (s.includes('JIG')) return 'jig_maintenance'
  if (s.includes('DIE')) return 'die_maintenance'
  return 'maintenance'
}

/** ทีมตั้งต้นของ picker "📞 เรียกช่าง" / "📝 เปิดใบซ่อม" ของเครื่องนี้
 *  ลำดับ: `machines.equipment_kind` ในทะเบียน (ข้อเท็จจริง) → เดาจากชื่อ
 *  🔴 **ห้ามคืนค่าว่างเด็ดขาด** — ปลายทางถือว่า "ไม่ระบุทีม = ไม่กรอง"
 *     ⇒ ค่าว่างหลุดไป = กลับไปเด้งช่างทั้งโรงงานเหมือนบั๊กเดิม โดยที่จอไม่พัง = ไม่มีใครเห็น
 */
export function teamForMachine(machineNo, machines = []) {
  const no = String(machineNo || '').trim().toUpperCase()
  if (!no) return 'maintenance'
  const hit = (machines || []).find(m => String(m?.machine_no || '').trim().toUpperCase() === no)
  if (hit?.equipment_kind) return teamForEquipmentKind(hit.equipment_kind)
  return guessTeamFromName(no)
}
