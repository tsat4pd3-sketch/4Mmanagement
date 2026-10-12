// System 1 — fire the Daily AM Telegram alarm (green/red) when a production
// daily-AM inspection is saved. Orange (didn't check in time) is handled by the
// scheduled scan (edge pm-daily-scan), not here. Routing/room selection lives in
// the send-notification edge function (event 'pm_daily').
//
// 🔗 08/10 (audit AM↔PM): ข้อมูล/กติกา "ตรวจแล้ว" ทั้งหมดมาจาก `lib/dailyAmBoard.js` ตัวเดียว
//    — เดิมไฟล์นี้คิดกะเอง · หา target ด้วย `.eq('line_name', jig.line_name)` (ไม่รวมครอบครัวไลน์ ⇒
//    จิ๊กที่ลงทะเบียนไว้ที่ไลน์แม่ HYDROFORM ไม่เคยยิงแดง/เขียว) · hardcode 'production' · ส่ง firstOrderAt:null
//    · แดงยิงซ้ำทุกครั้งที่บันทึก NG · ตอนนี้ dedupe ด้วย `pm_daily_alerts` (line, work_date, shift, color)
//    ตารางเดียวกับที่ scan ใช้กันส้มซ้ำ
import { supabase, supabaseDR } from '../supabaseClient'
import { isAmTeam } from '../utils/pmTeams'
import { loadDailyAm, dailyAmLineStatus } from './dailyAmBoard'

async function fire(pm) {
  try {
    const { error } = await supabase.functions.invoke('send-notification', { body: { event: 'pm_daily', pm } })
    return !error
  } catch { return false }
}

/** ยิง 1 ครั้งต่อ (ไลน์ · วันทำงาน · กะ · สี) — มีแถวกันซ้ำแล้ว = ไม่ยิง · ยิงไม่สำเร็จ = ไม่ mark (รอบหน้าลองใหม่) */
async function fireOnce(key, pm) {
  const { data: dup, error: dErr } = await supabaseDR.from('pm_daily_alerts').select('id')
    .eq('line_name', key.line_name).eq('work_date', key.work_date).eq('shift', key.shift).eq('color', key.color).limit(1)
  if (dErr || dup?.length) return false   // อ่านตัวกันซ้ำไม่ได้ = ห้ามเดาว่ายังไม่เคยส่ง
  const ok = await fire(pm)
  if (ok) {
    const { error: mErr } = await supabaseDR.from('pm_daily_alerts').insert({ ...key })
    if (mErr && mErr.code !== '23505') console.warn('pm_daily mark failed', mErr.message)   // 23505 = ชน unique (มีคนยิงพร้อมกัน) ไม่เป็นไร
  }
  return ok
}

/**
 * @param jig         the saved equipment { id, name, machine_no, line_name }
 * @param department  the checklist department of this inspection
 * @param overall     'pass' | 'fail' | 'pending' — computed status of this save
 * @param ngTopics    names of the NG checkpoints in this inspection
 */
export async function handleDailyPmSave({ jig, department, overall, ngTopics = [] }) {
  if (!isAmTeam(department) || !jig?.id) return
  const res = await loadDailyAm()
  if (!res.ok) return   // best-effort — บันทึกผลตรวจสำเร็จไปแล้ว แค่ไม่ยิงแจ้งเตือน (scan ส้มยังทำงาน)
  const si = res.shift
  // ไลน์ที่จิ๊กนี้ลงทะเบียนไว้ (เฉพาะกะนี้) — target ชี้ไลน์แม่ได้ ไม่ใช่ jig.line_name เสมอไป
  const lines = [...new Set(res.targets
    .filter(t => t.jig_id === jig.id && (!t.shift || t.shift === si.shift))
    .map(t => t.line_name))]
  if (!lines.length) return   // ไม่ได้ลงทะเบียน AM = ไม่มีเสียงเตือนรายไลน์
  const byLine = dailyAmLineStatus({ ...res, shift: si.shift, now: new Date() })

  for (const line_name of lines) {
    const key = { line_name, work_date: si.workDateStr, shift: si.shift }
    const base = { line_name, shift_label: si.label, work_date: si.workDateStr }
    if (overall === 'fail') {
      // แดงทันทีที่พบผิดปกติ (1 ครั้งต่อไลน์ต่อกะ — จุดที่ 2 ดูในจอ AM/ผังรวมโรงงาน)
      await fireOnce({ ...key, color: 'red' }, { ...base, color: 'red', ng: [{ machine: jig.machine_no, name: jig.name, topics: ngTopics }] })
      continue
    }
    const st = byLine[line_name]
    if (st?.status === 'green') await fireOnce({ ...key, color: 'green' }, { ...base, color: 'green', checked: st.checked, total: st.total })
  }
}
