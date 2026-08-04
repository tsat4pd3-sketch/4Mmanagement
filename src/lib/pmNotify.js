import { supabase } from '../supabaseClient'

// ผู้รับแจ้งเตือนงาน PM = "role ที่มีสิทธิ์ทำงาน PM จริง" — อ่านจาก role_permissions (data-driven)
// ไม่ hardcode รายชื่อ role อีกต่อไป: เพิ่ม role ใหม่ / เพิ่มทีมช่างใน mtn_teams แล้วได้รับแจ้งเตือนเอง
// (เคย drift 2 รอบ: เพิ่ม role `mtn` 2026-07-13 แล้วลืม · role engineer/planner_store ไม่เคยอยู่ในแมพเลย
//  · ทีมใหม่ใน mtn_teams จะตกไป fallback แล้วเงียบ — QC audit 2026-08-03)
//   production → ผู้บันทึกผลตรวจ (pm:record) · qa → qa:record · ทีมช่าง (maintenance/jig/die) → pm:record เช่นกัน
const DEPARTMENT_PERMISSION = {
  production:      'pm:record',
  maintenance:     'pm:record',
  jig_maintenance: 'pm:record',
  die_maintenance: 'pm:record',
  qa:              'qa:record',
}
// fallback ใช้เมื่ออ่าน role_permissions ไม่ได้ (ตารางล่ม/สิทธิ์) — อย่างน้อยหัวหน้ายังได้รับ
const FALLBACK_ROLES = ['admin', 'manager']

// คืนรายชื่อ role ที่ได้สิทธิ์ตาม permission key (allowed = true) · admin ได้เสมอ
async function rolesWithPermission(permissionKey) {
  try {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role')
      .eq('permission_key', permissionKey)
      .eq('allowed', true)
    if (error) throw error
    const roles = [...new Set([...(data ?? []).map(r => r.role), 'admin'])]
    return roles.length > 1 ? roles : FALLBACK_ROLES
  } catch {
    return FALLBACK_ROLES
  }
}

export async function createNotification(userId, { title, body, type = 'info', refTable, refId }) {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    title,
    body,
    type,
    ref_table: refTable ?? null,
    ref_id: refId ?? null,
  })
  if (error) throw error
}

// Notify everyone whose role can act on a checklist department, except the
// actor who triggered it.
export async function notifyDepartment(department, { title, body, type = 'info', refTable, refId }, excludeUserId) {
  const roles = await rolesWithPermission(DEPARTMENT_PERMISSION[department] ?? 'pm:record')
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, role')
    .in('role', roles)
  if (error) throw error

  const recipients = (profiles ?? []).filter(p => p.id !== excludeUserId)
  if (recipients.length === 0) return

  const rows = recipients.map(p => ({
    user_id: p.id,
    title,
    body,
    type,
    ref_table: refTable ?? null,
    ref_id: refId ?? null,
  }))
  const { error: insertErr } = await supabase.from('notifications').insert(rows)
  if (insertErr) throw insertErr
}
