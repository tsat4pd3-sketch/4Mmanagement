// System 1 — fire the Daily PM Telegram alarm (green/red) when a production
// daily-PM inspection is saved. Orange (didn't check in time) is handled by the
// scheduled scan, not here. Routing/room selection lives in the send-notification
// edge function (event 'pm_daily').
import { supabase, supabaseDR } from '../supabaseClient'
import { computeDailyPmStatus } from './pmDailyStatus'

function getShiftInfo(now = new Date()) {
  const h = now.getHours()
  const totalMin = h * 60 + now.getMinutes()
  const isDay = totalMin >= 8 * 60 && totalMin < 20 * 60
  const workDate = new Date(now)
  if (h < 8) workDate.setDate(workDate.getDate() - 1)
  const shiftStart = new Date(workDate)
  shiftStart.setHours(isDay ? 8 : 20, 0, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return {
    shift: isDay ? 'day' : 'night',
    workDateStr: `${workDate.getFullYear()}-${pad(workDate.getMonth() + 1)}-${pad(workDate.getDate())}`,
    label: isDay ? '☀️ กะเช้า' : '🌙 กะดึก',
    shiftStart,
  }
}

async function fire(pm) {
  try { await supabase.functions.invoke('send-notification', { body: { event: 'pm_daily', pm } }) } catch { /* best-effort */ }
}

/**
 * @param jig         the saved equipment { id, name, machine_no, line_name }
 * @param department  the checklist department of this inspection
 * @param overall     'pass' | 'fail' | 'pending' — computed status of this save
 * @param ngTopics    names of the NG checkpoints in this inspection
 */
export async function handleDailyPmSave({ jig, department, overall, ngTopics = [] }) {
  if (department !== 'production' || !jig?.line_name) return
  const si = getShiftInfo()

  // Only registered daily-PM equipment triggers the line alarm.
  const { data: targets } = await supabaseDR.from('pm_daily_line_targets')
    .select('jig_id, shift').eq('line_name', jig.line_name).eq('is_active', true)
  const active = (targets ?? []).filter(t => !t.shift || t.shift === si.shift)
  if (!active.some(t => t.jig_id === jig.id)) return

  const base = { line_name: jig.line_name, shift_label: si.label, work_date: si.workDateStr }

  // Red the moment a check comes back NG.
  if (overall === 'fail') {
    await fire({ ...base, color: 'red', ng: [{ machine: jig.machine_no, name: jig.name, topics: ngTopics }] })
    return
  }

  // Otherwise green only once the whole line is complete and all pass.
  const jigIds = active.map(t => t.jig_id)
  const [{ data: jigRows }, { data: prodCls }] = await Promise.all([
    supabaseDR.from('jigs').select('id, name, machine_no').in('id', jigIds),
    supabaseDR.from('checklists').select('id').eq('module', 'mtn').eq('department', 'production'),
  ])
  const jigById = Object.fromEntries((jigRows ?? []).map(j => [j.id, j]))
  const prodIds = new Set((prodCls ?? []).map(c => c.id))
  const { data: insp } = await supabaseDR.from('inspections')
    .select('jig_id, status, checklist_id, inspected_at')
    .in('jig_id', jigIds).gte('inspected_at', si.shiftStart.toISOString())
    .order('inspected_at', { ascending: false })
  const results = {}
  for (const i of insp ?? []) {
    if (!prodIds.has(i.checklist_id)) continue
    if (!results[i.jig_id]) results[i.jig_id] = { status: i.status }
  }
  const tg = jigIds.map(id => ({ jig_id: id, name: jigById[id]?.name, machine_no: jigById[id]?.machine_no }))
  const st = computeDailyPmStatus({ targets: tg, results, firstOrderAt: null, now: new Date() })
  if (st.status === 'green') {
    await fire({ ...base, color: 'green', checked: st.checked, total: st.total })
  }
}
