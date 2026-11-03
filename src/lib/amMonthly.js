/* ── amMonthly — รายงาน AM รายเดือน (ไลน์ × เครื่อง × วัน) แบบเดียวกับตารางเดือนของ LPA (2026-11-03) ──
   ที่มา: ประชุมหน้างาน 02/11 ข้อ C2 — *"รายงาน AM ตอนนี้มีแค่รายวัน ต้องมีรายเดือนแบบ LPA"*

   🔴 ไฟล์นี้ pure (ไม่แตะ supabase) — เทส `src/lib/__tests__/amMonthly.test.mjs`
      ตัวโหลดวัตถุดิบอยู่ `lib/dailyAmBoard.js` (`loadMonthlyAm`) — **ห้ามคิวรี inspections เองในหน้า**

   นิยาม (ชุดเดียวกับบอร์ด AM รายวัน · ห้ามคิดใหม่ในจอ):
   · **ช่อง = เครื่อง × วันทำงาน × กะที่เลือก** — AM ตรวจ "ต้นกะ" ⇒ ตัดสินรายกะ (จอเลือกกะ เหมือน LPA)
   · **ตรวจแล้ว** = ใบตรวจของทีม AM ในกะนั้น · **ล่าสุดชนะ** · `pending` = ยังไม่ตรวจ
     (กติกาเดียวกับ `computeDailyPmStatus` — pending ไม่นับ)
   · **ต้องตรวจไหม (planned)** = เครื่องอยู่ในทะเบียน `pm_daily_line_targets` ของไลน์ (ตรงกะ หรือ shift ว่าง)
     และวันนั้น **ไม่ก่อนวันที่ลงทะเบียน** (`created_at`) — ก่อนลงทะเบียน = `not_planned` ไม่ใช่ "ขาด"
     ⚠️ ทะเบียนที่ถูกปิดใช้ (`is_active=false`) ไม่มีประวัติวันปิด ⇒ ไม่โผล่ในรายงาน (รู้ตัว · เขียนในเอกสาร)
   · **ผลิตไหม (ran)** = มีกะเปิดจริงของ "ครอบครัวไลน์" (แม่/ลูก) ในวัน+กะนั้น — `openFamilyLines()`
     ตัวเดียวกับบอร์ดรายวัน (ไลน์แม่หลายตัวไม่เคยเปิดกะในชื่อตัวเอง) · อ่านไม่ได้ = `null` = **ไม่รู้**
   · **วันหยุด** ส่งเป็น `isOff` เฉพาะวันที่ **ไม่ได้เดินเครื่อง** — AM = "ตรวจทุกกะที่เครื่องเดิน"
     มาทำ OT วันหยุดแล้วเดินเครื่อง = ต้องตรวจ (ต่างจาก LPA ที่ผูกกับแผนรายเดือน)
   · สถานะช่องตัดสินด้วย `checkDayState()` · สัญลักษณ์/สี `CHECK_DAY_META` · ตัวหาร % = ตรวจแล้ว + ขาด
     (`summarizeCheckDays`) — **ห้ามแต่ง mark/สีเอง** (UI §6.29)
   · ช่อง "ตรวจแล้ว" เขียน **ผลตรวจ** (`OK`/`NG`/`!`) — คนละชั้นกับสัญลักษณ์สถานะวัน (ขาด/NP/?/·)
     ⇒ ห้ามใช้ `ขาด`/`NP`/`?`/`·` เป็นผลตรวจ และกลับกัน
   · **กะที่กำลังเดินอยู่** ยังไม่ตัดสิน (ถือเป็น `future`) — สถานะสดอยู่แท็บ "สถานะวันนี้"
     (ไม่งั้นต้นกะทุกเครื่องขึ้น "ขาด" ทั้งที่ยังอยู่ในกรอบ 60 นาที)                                         */
import { checkDayState, summarizeCheckDays, CHECK_DAY, runKey } from '../utils/dailyCheckDay.js'
import { openFamilyLines, isDailyAmEquipment } from './pmDailyStatus.js'

const pad2 = (n) => String(n).padStart(2, '0')

/** วันทั้งเดือน 'YYYY-MM' → ['YYYY-MM-01', …] · เดือนอ่านไม่ออก = [] */
export function amMonthDays(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) return []
  const y = Number(m[1]), mo = Number(m[2])
  if (mo < 1 || mo > 12) return []
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${m[1]}-${m[2]}-${pad2(i + 1)}`)
}

/**
 * กะ AM ของเวลาหนึ่ง — **ตามเวลาไทยเสมอ** ไม่พึ่ง timezone เครื่อง (เลื่อน epoch +7 ชม. แล้วอ่านฝั่ง UTC)
 * กะเช้า 08:00–19:59 · กะดึก 20:00–07:59 (ก่อน 08:00 = วันทำงานก่อนหน้า) — ตรงกับ `getCurrentShift`/`getWorkDate`
 * @returns {{ workDate:string, shift:'day'|'night' }|null}
 */
export function amSlotOf(ts) {
  const ms = ts instanceof Date ? ts.getTime() : Date.parse(ts)
  if (!Number.isFinite(ms)) return null
  const t = new Date(ms + 7 * 3600_000)
  const h = t.getUTCHours()
  const shift = h >= 8 && h < 20 ? 'day' : 'night'
  if (h < 8) t.setUTCDate(t.getUTCDate() - 1)
  return { workDate: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`, shift }
}

/** ช่วงเวลา (ISO) ที่ต้องดึงใบตรวจของเดือน: 08:00 วันแรก → 08:00 วันแรกของเดือนถัดไป (เวลาไทย) */
export function amMonthRange(month) {
  const days = amMonthDays(month)
  if (!days.length) return null
  const [y, mo] = month.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${pad2(mo + 1)}`
  return { from: `${days[0]}T08:00:00+07:00`, to: `${next}-01T08:00:00+07:00`, first: days[0], last: days[days.length - 1] }
}

/** ผลตรวจที่เขียนในช่อง "ตรวจแล้ว" — คนละชุดกับ `CHECK_DAY_META.mark` (ห้ามชนกัน · มีเทส) */
export const AM_RESULT_META = {
  pass:    { mark: 'OK', label: 'ตรวจแล้ว ปกติ',     color: '#3dd65c' },
  fail:    { mark: 'NG', label: 'ตรวจแล้ว พบผิดปกติ', color: '#e05c4a' },
  warning: { mark: '!',  label: 'ตรวจแล้ว ใกล้เกณฑ์',  color: '#f59a3f' },
}

const SLOT_ORDER = { day: 0, night: 1 }
/** ช่อง (วัน, กะ) อยู่หลัง "กะปัจจุบัน" หรือ **เป็นกะปัจจุบัน** ⇒ ยังไม่ตัดสิน */
function notYetJudged(date, shift, cur) {
  if (!cur) return false
  if (date !== cur.workDate) return date > cur.workDate
  return SLOT_ORDER[shift] >= SLOT_ORDER[cur.shift]
}

/**
 * ประกอบตารางเดือน
 * @param {object} p
 * @param {string} p.month   'YYYY-MM'
 * @param {'day'|'night'} p.shift
 * @param {object[]} p.targets   แถว `pm_daily_line_targets` (active) — `{ line_name, jig_id, shift, created_at }`
 * @param {object[]} p.jigs      อุปกรณ์ (กรองขอบเขต AM แล้ว หรือส่ง `amEquipIds` มาให้กรอง)
 * @param {object[]} p.inspections  ใบตรวจทีม AM ในช่วงเดือน `{ jig_id, status, inspected_at }` (ลำดับใดก็ได้)
 * @param {Map<string,Set<string>>|null} p.runsByKey  `runKey(date, shift)` → ชื่อไลน์ที่เปิดกะจริง · **`null` = อ่านไม่ได้**
 * @param {object[]} p.lines     ทะเบียนไลน์ (ไล่แม่-ลูก)
 * @param {(date:string)=>boolean} [p.isWorkingDay]  ปฏิทินบริษัท · ไม่ส่ง = ทุกวันเป็นวันทำงาน
 * @param {Date|string} [p.now]  ตรึงเวลาได้ (เทส) — ตัดสินว่ากะไหนยังไม่ถึง/กำลังเดิน
 * @returns {{ days:string[], rows:object[], sum:object, ngN:number, unknownDays:number, runsUnknown:boolean }}
 */
export function buildAmMonthly({ month, shift = 'day', targets = [], jigs = [], amEquipIds = null,
  inspections = [], runsByKey = null, lines = [], isWorkingDay = null, now = new Date() } = {}) {
  const days = amMonthDays(month)
  const cur = amSlotOf(now)
  const jigById = new Map()
  for (const j of jigs) if (!amEquipIds || isDailyAmEquipment(j, amEquipIds)) jigById.set(j.id, j)

  // ผลตรวจล่าสุดต่อ เครื่อง × ช่อง (เฉพาะกะที่เลือก) — ล่าสุดชนะ ไม่ว่าลำดับที่ส่งมา
  const latest = new Map()   // `${jig}|${date}` → { status, at }
  for (const i of inspections) {
    const s = amSlotOf(i?.inspected_at)
    if (!s || s.shift !== shift) continue
    const k = `${i.jig_id}|${s.workDate}`
    const at = Date.parse(i.inspected_at)
    const prev = latest.get(k)
    if (!prev || at > prev.at) latest.set(k, { status: i.status, at })
  }

  // ไลน์ไหนเดินในแต่ละวัน (นับครอบครัวไลน์) — คำนวณครั้งเดียวต่อวัน
  const famByDay = new Map()
  const ranOnLine = (line, date) => {
    if (!runsByKey) return null
    if (!famByDay.has(date)) famByDay.set(date, openFamilyLines(lines, runsByKey.get(runKey(date, shift)) || new Set()))
    return famByDay.get(date).has(line)
  }

  // จัดทะเบียนต่อไลน์ — เครื่องซ้ำในไลน์เดียว (แถวทั้งกะ + แถวเฉพาะกะ) นับครั้งเดียว · ลงทะเบียนเร็วสุดชนะ
  const byLine = new Map()
  for (const t of targets) {
    if (t?.shift && t.shift !== shift) continue
    const j = jigById.get(t?.jig_id)
    if (!j) continue
    const line = t.line_name || '—'
    if (!byLine.has(line)) byLine.set(line, new Map())
    const m = byLine.get(line)
    const since = t.created_at ? amSlotOf(t.created_at)?.workDate ?? null : null
    const prev = m.get(j.id)
    if (!prev || (prev.since && (!since || since < prev.since))) m.set(j.id, { jig: j, since })
  }

  const rows = []
  const allStates = []
  let ngAll = 0
  for (const [line, mm] of byLine) {
    const machines = [...mm.values()]
      .sort((a, b) => String(a.jig.machine_no || a.jig.name).localeCompare(String(b.jig.machine_no || b.jig.name), 'th', { numeric: true }))
      .map(({ jig, since }) => {
        let ngN = 0
        const cells = days.map(date => {
          const r = latest.get(`${jig.id}|${date}`)
          const done = !!r && r.status != null && r.status !== 'pending'
          const ran = ranOnLine(line, date)
          const holiday = isWorkingDay ? !isWorkingDay(date) : false
          const state = checkDayState({
            hasResult: done,
            isFuture: notYetJudged(date, shift, cur),
            isOff: holiday && ran !== true,
            planned: since ? date >= since : true,
            ran,
          })
          if (done && r.status === 'fail') ngN++
          return { date, state, result: done ? r.status : null }
        })
        const sum = summarizeCheckDays(cells.map(c => c.state))
        return { jig_id: jig.id, name: jig.name, machine_no: jig.machine_no || null, since, cells, sum, ngN }
      })

    // ช่องของ "ไลน์" = ครบทุกเครื่องที่ต้องตรวจวันนั้นไหม (บางเครื่อง = ยังขาด) · ตัวนับ % ใช้ระดับเครื่อง-วัน
    const cells = days.map((date, di) => {
      const st = machines.map(m => m.cells[di])
      const due = st.filter(c => c.state === CHECK_DAY.done || c.state === CHECK_DAY.missed)
      const doneN = st.filter(c => c.state === CHECK_DAY.done).length
      const plannedAny = st.some(c => c.state !== CHECK_DAY.not_planned)
      const ran = ranOnLine(line, date)
      const holiday = isWorkingDay ? !isWorkingDay(date) : false
      const state = checkDayState({
        hasResult: due.length > 0 && due.every(c => c.state === CHECK_DAY.done),
        isFuture: notYetJudged(date, shift, cur),
        isOff: holiday && ran !== true,
        planned: plannedAny,
        ran,
      })
      return { date, state, checked: doneN, due: due.length, ng: st.filter(c => c.result === 'fail').length }
    })
    const mStates = machines.flatMap(m => m.cells.map(c => c.state))
    allStates.push(...mStates)
    const ngN = machines.reduce((a, m) => a + m.ngN, 0)
    ngAll += ngN
    rows.push({ line_name: line, machines, cells, sum: summarizeCheckDays(mStates), ngN })
  }
  rows.sort((a, b) => (a.line_name === '—') - (b.line_name === '—') || a.line_name.localeCompare(b.line_name, 'th', { numeric: true }))

  const sum = summarizeCheckDays(allStates)
  return {
    days, rows, sum, ngN: ngAll,
    runsUnknown: !runsByKey,
    unknownDays: rows.length ? new Set(rows.flatMap(r => r.cells.filter(c => c.state === CHECK_DAY.unknown).map(c => c.date))).size : 0,
  }
}

/** สรุปรวมของหลายไลน์ (เช่น หลังกรอง) — ระดับเครื่อง-วัน · ตัวหารจาก `summarizeCheckDays` ที่เดียว */
export function amRowsSummary(rows) {
  return summarizeCheckDays((rows || []).flatMap(r => r.machines.flatMap(m => m.cells.map(c => c.state))))
}

/** ตาราง → แถวไฟล์ Excel (aoa) — ใช้ mark/ผลตรวจชุดเดียวกับจอ */
export function amMonthlyAoa(rep, metaOf) {
  const head = ['ไลน์', 'เครื่อง', 'เลขเครื่อง', ...rep.days.map(d => Number(d.slice(8))),
    'ต้องตรวจ', 'ตรวจแล้ว', 'ขาด', 'ไม่ได้ผลิต', 'ไม่รู้', '% ครบ', 'NG']
  const tail = (s, ng) => [s.due, s.done, s.missed, s.no_run, s.unknown, s.pct == null ? '–' : `${s.pct}%`, ng]
  const cellText = (c) => (c.state === CHECK_DAY.done
    ? (c.result ? AM_RESULT_META[c.result]?.mark ?? 'OK' : `${c.checked}/${c.due}`)
    : (metaOf(c.state)?.mark || ''))
  const out = [head]
  for (const r of rep.rows) {
    out.push([r.line_name === '—' ? 'ยังไม่ระบุไลน์' : r.line_name, `รวม ${r.machines.length} เครื่อง`, '',
      ...r.cells.map(c => (c.state === CHECK_DAY.done ? (c.ng ? `NG ${c.ng}` : 'ครบ')
        : c.state === CHECK_DAY.missed && c.checked ? `${cellText(c)} ${c.checked}/${c.due}` : cellText(c))), ...tail(r.sum, r.ngN)])
    for (const m of r.machines) out.push(['', m.name, m.machine_no || '', ...m.cells.map(cellText), ...tail(m.sum, m.ngN)])
  }
  return out
}

/* ── ✍️ ลงนามทบทวนรายเดือน (ขั้น 3 ของสาย AM · 2026-11-03) — ส่วน pure ──────────────────────────
   ลงนามแล้ว = **บันทึก** ไม่ใช่ตัวเลขที่คิดใหม่ทุกครั้ง (หลักเดียวกับใบรายงานปัญหา `prodProblemDoc.js`)
   · ตอนลงนามเก็บ `snapshot` = สรุปของไลน์ ณ วินาทีนั้น (ยอดรวม + รายเครื่อง)
   · ตัวเลขสดเปลี่ยนทีหลัง (มีคนบันทึกใบตรวจย้อนหลัง/แก้ทะเบียน) ⇒ `amSignoffDrift()` บอกว่าต่างตรงไหน
     **จอต้องเขียนบอก** — ห้ามเอาตัวเลขสดไปแสดงเหมือนเป็นสิ่งที่ลงนามไว้ */

/** วันแรกของเดือนถัดไป 'YYYY-MM' → 'YYYY-MM-01' · อ่านไม่ออก = null */
export function amNextMonthFirst(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${pad2(mo + 1)}-01`
}

/**
 * เดือนนี้ "จบแล้ว" ไหม (ลงนามได้) — จบ = กะดึกของวันสุดท้ายจบแล้ว (08:00 วันแรกของเดือนถัดไป · เวลาไทย)
 * ใช้ `amSlotOf(now)` ตัวเดียวกับตารางเดือน ⇒ ช่องสุดท้ายถูกตัดสินแล้วจริงตอนปุ่มเปิด
 * @returns {{ complete:boolean, opensOn:string|null }}
 */
export function amMonthComplete(month, now = new Date()) {
  const days = amMonthDays(month)
  const cur = amSlotOf(now)
  if (!days.length || !cur) return { complete: false, opensOn: null }
  const next = amNextMonthFirst(month)
  return { complete: cur.workDate > days[days.length - 1], opensOn: next ? `${next} 08:00` : null }
}

const sumPick = (s) => ({ due: s?.due ?? 0, done: s?.done ?? 0, missed: s?.missed ?? 0,
  no_run: s?.no_run ?? 0, unknown: s?.unknown ?? 0, pct: s?.pct ?? null })

/** สรุปของไลน์ (แถวจาก `buildAmMonthly().rows`) → snapshot ที่เก็บลงทะเบียนลงนาม */
export function amSignoffSnapshot(row, { month, shift } = {}) {
  if (!row) return null
  return {
    v: 1, month, shift, line_name: row.line_name,
    sum: sumPick(row.sum), ngN: row.ngN ?? 0,
    machines: (row.machines || []).map(m => ({
      jig_id: m.jig_id, name: m.name, machine_no: m.machine_no || null, ...sumPick(m.sum), ngN: m.ngN ?? 0,
    })),
  }
}

const SUM_FIELDS = [['done', 'ตรวจแล้ว'], ['missed', 'ขาด'], ['due', 'ต้องตรวจ'], ['no_run', 'ไม่ได้ผลิต'], ['unknown', 'ไม่รู้'], ['pct', '% ครบ']]

/**
 * เทียบ snapshot ที่ลงนามไว้กับตัวเลขสด — คืนรายการความต่าง (ว่าง = ตรงกัน)
 * `row` = null (ไลน์หายจากรายงาน เช่น เอาทุกเครื่องออกจากทะเบียน) = ต่างทั้งก้อน
 * snapshot อ่านไม่ออก = `[{ field:'snapshot' }]` (ห้ามถือว่าตรงกัน)
 * @returns {{ field:string, label:string, was:any, now:any, machine?:string }[]}
 */
export function amSignoffDrift(snapshot, row) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.sum) return [{ field: 'snapshot', label: 'อ่านสรุปที่ลงนามไว้ไม่ได้', was: null, now: null }]
  if (!row) return [{ field: 'line', label: 'ไลน์นี้ไม่อยู่ในรายงานแล้ว', was: snapshot.line_name ?? null, now: null }]
  const out = []
  const live = sumPick(row.sum)
  for (const [f, label] of SUM_FIELDS) {
    if ((snapshot.sum[f] ?? null) !== (live[f] ?? null)) out.push({ field: f, label, was: snapshot.sum[f] ?? null, now: live[f] ?? null })
  }
  if ((snapshot.ngN ?? 0) !== (row.ngN ?? 0)) out.push({ field: 'ngN', label: 'NG', was: snapshot.ngN ?? 0, now: row.ngN ?? 0 })
  const was = new Map((snapshot.machines || []).map(m => [m.jig_id, m]))
  const nowM = new Map((row.machines || []).map(m => [m.jig_id, m]))
  for (const [id, m] of nowM) {
    const p = was.get(id)
    const name = m.machine_no || m.name
    if (!p) { out.push({ field: 'machine_added', label: 'เครื่องที่เพิ่มหลังลงนาม', was: null, now: name, machine: name }); continue }
    const s = sumPick(m.sum)
    if (p.done !== s.done || p.missed !== s.missed || (p.ngN ?? 0) !== (m.ngN ?? 0)) {
      out.push({ field: 'machine', label: 'ผลรายเครื่องเปลี่ยน', was: `${p.done}/${p.due} NG ${p.ngN ?? 0}`, now: `${s.done}/${s.due} NG ${m.ngN ?? 0}`, machine: name })
    }
  }
  for (const [id, p] of was) {
    if (!nowM.has(id)) out.push({ field: 'machine_removed', label: 'เครื่องที่หายไปหลังลงนาม', was: p.machine_no || p.name, now: null, machine: p.machine_no || p.name })
  }
  return out
}

/**
 * ชีต "ลงนามทบทวน" ของไฟล์ Excel รายเดือน — 1 แถวต่อไลน์ที่อยู่ในไฟล์ (ยังไม่ลงนาม = เขียนว่ายังไม่ลงนาม ห้ามตัดทิ้ง)
 * ลายเซ็นเป็นรูป ⇒ ในไฟล์เป็น URL (SheetJS ฝังรูปไม่ได้) · ตัวเลขในคอลัมน์ "ณ ตอนลงนาม" มาจาก snapshot ไม่ใช่ของสด
 * @param {object[]} lineRows  แถวไลน์ของรายงาน (ชุดเดียวกับที่ลงชีตแรก)
 * @param {Map<string,{active:object|null,revoked:object[]}>|null} byLine  ผลของ `signoffsByLine()` · `null` = อ่านทะเบียนไม่ได้
 * @param {{ positionLabel?:(v:any)=>string, fmt?:(iso:string)=>string, unreadable?:string }} [o]
 */
export function amSignoffAoa(lineRows, byLine, { positionLabel = (v) => v || '', fmt = (s) => s || '', unreadable = 'อ่านทะเบียนลงนามไม่ได้' } = {}) {
  const head = ['ไลน์', 'สถานะ', 'ผู้ลงนาม', 'ตำแหน่ง', 'วันที่ลงนาม', 'ลายเซ็น (URL)', 'หมายเหตุ',
    'ณ ตอนลงนาม: ตรวจ/ต้อง', 'ขาด', '% ครบ', 'NG', 'ตัวเลขปัจจุบันต่างจากที่ลงนาม', 'เคยเพิกถอน']
  const out = [head]
  for (const r of lineRows || []) {
    const name = r.line_name === '—' ? 'ยังไม่ระบุไลน์' : r.line_name
    if (!byLine) { out.push([name, unreadable]); continue }
    const e = byLine.get(r.line_name)
    const a = e?.active
    const revN = e?.revoked?.length || 0
    if (!a) { out.push([name, 'ยังไม่ลงนาม', '', '', '', '', '', '', '', '', '', '', revN || '']); continue }
    const s = a.snapshot?.sum || {}
    const drift = amSignoffDrift(a.snapshot, r)
    out.push([name, 'ลงนามแล้ว', a.signed_by_name || '', positionLabel(a.position) || '', fmt(a.signed_at), a.signature_url || '(ไม่มีลายเซ็นในโปรไฟล์)',
      a.note || '', `${s.done ?? '–'}/${s.due ?? '–'}`, s.missed ?? '–', s.pct == null ? '–' : `${s.pct}%`, a.snapshot?.ngN ?? '–',
      drift.length ? amSignoffDriftText(drift) : 'ตรงกัน', revN || ''])
  }
  return out
}

/** ข้อความสั้นของความต่าง (จอ + Excel) */
export function amSignoffDriftText(drift) {
  if (!drift?.length) return ''
  return drift.slice(0, 4).map(d => (d.machine
    ? `${d.label} ${d.machine}${d.was != null && d.now != null ? ` (${d.was} → ${d.now})` : ''}`
    : `${d.label}${d.was != null || d.now != null ? ` ${d.was ?? '–'} → ${d.now ?? '–'}` : ''}`)).join(' · ')
    + (drift.length > 4 ? ` · อีก ${drift.length - 4} รายการ` : '')
}
