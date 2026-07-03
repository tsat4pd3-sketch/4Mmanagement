import { supabase } from '../supabaseClient'

// 4M has no per-user "departments[]" — access is gated by `profiles.role`
// instead. Map each PM checklist department to the 4M roles that should be
// notified when something needs attention there.
const DEPARTMENT_ROLES = {
  production:       ['admin', 'manager', 'supervisor', 'leader'],
  maintenance:       ['admin', 'manager', 'supervisor'],
  jig_maintenance:   ['admin', 'manager', 'supervisor'],
  die_maintenance:   ['admin', 'manager', 'supervisor'],
  qa:                ['admin', 'manager', 'qa'],
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
  const roles = DEPARTMENT_ROLES[department] ?? ['admin', 'manager']
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
