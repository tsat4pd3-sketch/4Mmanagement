import { supabaseDR } from '../supabaseClient'

// One physical jig/machine/die (`jigs` row, shared with the real `machines`
// master via machine_id) has a separate checklist per department, so the same
// equipment can be checked daily by production, periodically by jig/die
// maintenance, etc. `module` ('mtn'/'qa') selects the shared equipment pool;
// `department` selects which checklist within it.
// อ่านอย่างเดียว — ใช้ตอน "เปิดดู" เครื่อง (ตั้งค่า/หน้าตรวจ)
// ⚠️ ห้ามใช้ getOrCreateChecklist ตอนเปิดดู: แค่เปิดดูเครื่องในแท็บแผนกไหน จะเกิดแถว checklist
//    เปล่า (0 จุดตรวจ) ของแผนกนั้นทันที แล้วเครื่องค้างอยู่ในแท็บนั้นตลอดไป ทำให้ดูเหมือน
//    "เครื่องอยู่ผิดหมวด" (เคยเกิดจริง 24 แถว — ล้างด้วย migration 20260805_pm_dept_ownership_cleanup)
//    สร้าง checklist เมื่อ "บันทึกจริง" เท่านั้น
export async function findChecklist(equipmentId, module, department) {
  const { data, error } = await supabaseDR
    .from('checklists')
    .select('id, frequency')
    .eq('equipment_id', equipmentId)
    .eq('module', module)
    .eq('department', department)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

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

// สรุปว่าเครื่องนี้มีรายการตรวจของแผนกไหนบ้าง (กี่จุดตรวจ / เคยตรวจกี่ครั้ง)
// ใช้โชว์ใน PM Setup ให้เห็นว่า "1 เครื่องมีได้หลายแผนก" และของจริงอยู่แผนกไหน
export async function listChecklistsByDept(equipmentId, module = 'mtn') {
  const { data: cls, error } = await supabaseDR
    .from('checklists')
    .select('id, department, frequency')
    .eq('equipment_id', equipmentId)
    .eq('module', module)
  if (error) throw error
  const ids = (cls ?? []).map(c => c.id)
  if (!ids.length) return []
  const [{ data: cps }, { data: insp }] = await Promise.all([
    supabaseDR.from('jig_checkpoints').select('checklist_id').in('checklist_id', ids),
    supabaseDR.from('inspections').select('checklist_id').in('checklist_id', ids),
  ])
  const cpCount = {}, inspCount = {}
  ;(cps ?? []).forEach(r => { cpCount[r.checklist_id] = (cpCount[r.checklist_id] ?? 0) + 1 })
  ;(insp ?? []).forEach(r => { inspCount[r.checklist_id] = (inspCount[r.checklist_id] ?? 0) + 1 })
  return (cls ?? []).map(c => ({
    ...c,
    checkpointCount: cpCount[c.id] ?? 0,
    inspectionCount: inspCount[c.id] ?? 0,
  }))
}

// ── ย้าย/คัดลอก รายการตรวจข้ามแผนก ────────────────────────────────────────────
// ลงจุดตรวจไว้ผิดแผนกแล้วไม่ต้องพิมพ์ใหม่ทั้งชุด
//  • ย้าย   = เปลี่ยน department ของ checklist เดิม → ประวัติการตรวจ (inspections) + แผน PM
//             ติดไปด้วยทั้งก้อน (ทุกตารางอ้าง checklist_id เดียวกัน)
//  • คัดลอก = สร้าง checklist ของแผนกปลายทางแล้ว copy เฉพาะ "จุดตรวจ" (ประวัติไม่ตามไป —
//             ต้นทางกับปลายทางตรวจคนละรอบ ประวัติต้องแยกกัน)
// unique(equipment_id, module, department) บังคับว่า 1 เครื่อง = 1 checklist ต่อแผนก
// จึงต้องเคลียร์ปลายทางก่อนเสมอ (ดู needsConfirm ที่ฝั่ง UI ถามผู้ใช้)

export async function moveChecklistDept(checklistId, toDepartment, { replace = false } = {}) {
  const { data: src, error: e0 } = await supabaseDR
    .from('checklists').select('id, equipment_id, module, department').eq('id', checklistId).single()
  if (e0) throw e0
  if (src.department === toDepartment) return { moved: false, reason: 'same' }

  const target = await findChecklist(src.equipment_id, src.module, toDepartment)
  if (target) {
    // ⚠️ นับไม่สำเร็จ = "ไม่รู้" ห้ามเดาเป็น 0 — `?? 0` ทำให้ด่านทั้งสองผ่านแล้วลบทิ้งเลย
    //    (count query ล้ม → count = undefined → (undefined ?? 0) > 0 = false → ตกไปบรรทัด delete)
    const [rCps, rInsp, rPlans] = await Promise.all([
      supabaseDR.from('jig_checkpoints').select('id', { count: 'exact', head: true }).eq('checklist_id', target.id),
      supabaseDR.from('inspections').select('id', { count: 'exact', head: true }).eq('checklist_id', target.id),
      supabaseDR.from('pm_plans').select('id', { count: 'exact', head: true }).eq('checklist_id', target.id),
    ])
    const cErr = rCps.error || rInsp.error || rPlans.error
    if (cErr || rCps.count == null || rInsp.count == null || rPlans.count == null)
      throw new Error('ตรวจของที่แผนกปลายทางไม่สำเร็จ — ยังย้ายไม่ได้ (กันลบทับของที่มีอยู่) ' + (cErr?.message || ''))
    const { count: tCps } = rCps, { count: tInsp } = rInsp, { count: tPlans } = rPlans
    // ปลายทางมีประวัติการตรวจ = ห้ามทับเด็ดขาด (FK inspections เป็น NO ACTION ลบไม่ได้อยู่แล้ว)
    if (tInsp > 0) throw new Error('แผนกปลายทางมีประวัติการตรวจอยู่แล้ว — ย้ายทับไม่ได้ ใช้ "คัดลอก" แทน')
    // ⚠️ pm_plans FK เป็น **CASCADE** (ตรวจ schema จริง 2026-09-02) — ลบ checklist = แผน PM ของ
    //    ปลายทางหายไปด้วยทั้งรอบเวลา/last_done_at/next_due_date/เกณฑ์ยอดผลิต · เดิมนับแต่ jig_checkpoints
    //    แล้วถามผู้ใช้แค่เรื่องจุดตรวจ = ลบแผน PM ทิ้งโดยไม่มีใครรู้ตัว → ต้องนับ+บอกด้วย
    if ((tCps > 0 || tPlans > 0) && !replace)
      return { moved: false, reason: 'target_has_checkpoints', targetCheckpoints: tCps, targetPlans: tPlans }
    const { error: eDel } = await supabaseDR.from('checklists').delete().eq('id', target.id)
    if (eDel) throw eDel
  }
  const { error } = await supabaseDR.from('checklists').update({ department: toDepartment }).eq('id', checklistId)
  if (error) throw error
  return { moved: true }
}

export async function copyChecklistToDept(checklistId, toDepartment, userId, { replace = false } = {}) {
  const { data: src, error: e0 } = await supabaseDR
    .from('checklists').select('id, equipment_id, module, department, frequency').eq('id', checklistId).single()
  if (e0) throw e0
  if (src.department === toDepartment) return { copied: false, reason: 'same' }

  const { data: cps, error: e1 } = await supabaseDR
    .from('jig_checkpoints').select('*').eq('checklist_id', checklistId).order('sort_order')
  if (e1) throw e1
  if (!cps?.length) return { copied: false, reason: 'empty' }

  const target = await getOrCreateChecklist(src.equipment_id, src.module, toDepartment, userId)
  // ⚠️ นับไม่สำเร็จ = "ไม่รู้" ห้าม `?? 0` — จะข้ามด่านไปลง insert ทับของเดิม
  //    ⇒ จุดตรวจปลายทาง "ซ้ำสองชุด" เงียบๆ (ผู้ตรวจเห็นทุกจุดสองครั้ง) โดยไม่มีใครกดยืนยันอะไรเลย
  const rCps = await supabaseDR
    .from('jig_checkpoints').select('id', { count: 'exact', head: true }).eq('checklist_id', target.id)
  if (rCps.error || rCps.count == null)
    throw new Error('ตรวจจุดตรวจที่แผนกปลายทางไม่สำเร็จ — ยังคัดลอกไม่ได้ (กันจุดตรวจซ้ำ) ' + (rCps.error?.message || ''))
  const tCps = rCps.count
  if (tCps > 0) {
    if (!replace) return { copied: false, reason: 'target_has_checkpoints', targetCheckpoints: tCps }
    const { error: eDel } = await supabaseDR.from('jig_checkpoints').delete().eq('checklist_id', target.id)
    if (eDel) throw eDel
  }

  // copy เฉพาะนิยามจุดตรวจ — ตัด id/created_at/audit ทิ้ง, รูปใช้ path เดิมร่วมกัน (ไม่ก๊อปไฟล์ storage)
  const rows = cps.map(({ id, created_at, updated_at, updated_by_name, checklist_id, ...rest }) => ({
    ...rest, checklist_id: target.id,
  }))
  const { error: e2 } = await supabaseDR.from('jig_checkpoints').insert(rows)
  if (e2) throw e2
  return { copied: true, count: rows.length, targetId: target.id }
}
