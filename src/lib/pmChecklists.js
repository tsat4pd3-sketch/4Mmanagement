import { supabaseDR } from '../supabaseClient'

// One physical jig/machine/die (`jigs` row, shared with the real `machines`
// master via machine_id) has a separate checklist per department, so the same
// equipment can be checked daily by production, periodically by jig/die
// maintenance, etc. `module` ('mtn'/'qa') selects the shared equipment pool;
// `department` selects which checklist within it.
export async function getOrCreateChecklist(equipmentId, module, department, userId) {
  const { data: existing, error: selectErr } = await supabaseDR
    .from('checklists')
    .select('id, frequency')
    .eq('equipment_id', equipmentId)
    .eq('module', module)
    .eq('department', department)
    .maybeSingle()
  if (selectErr) throw selectErr
  if (existing) return existing

  const { data: created, error: insertErr } = await supabaseDR
    .from('checklists')
    .insert({
      equipment_id: equipmentId,
      department,
      module,
      frequency: 'periodic',
      created_by: userId,
    })
    .select('id, frequency')
    .single()
  if (insertErr) throw insertErr
  return created
}

export async function setChecklistFrequency(checklistId, frequency) {
  const { error } = await supabaseDR.from('checklists').update({ frequency }).eq('id', checklistId)
  if (error) throw error
}
