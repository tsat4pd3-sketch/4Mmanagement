// System 1 — Production Daily Preventive Maintenance status logic (pure).
// ⚠️ ไฟล์นี้ต้อง pure (ไม่ import supabase) — เทสใน src/lib/__tests__/dailyAmBoard.test.mjs · ตัวโหลดอยู่ dailyAmBoard.js
import { getWorkDate, getCurrentShift, shiftStartTime } from '../utils/workDate.js'
import { getLineFamilyNames } from '../utils/lineHierarchy.js'
import { machineKey } from '../utils/machineNo.js'
// One line × shift × work_date rolls up over the equipment registered in
// pm_daily_line_targets ("must be checked every shift"). Shared by the status
// dashboard and the orange-alarm scheduler so both agree on what each colour means.

// Grace window: a line may start production and still be within its allowed
// window to complete the daily check — no later than 1 hour after production starts.
//
// ⚠️ "production starts" = the first order is OPENED (prod_orders.opened_at),
//    NOT when it is confirmed/closed. Fixed 2026-08-24 after the floor reported
//    every line stuck on "ยังไม่เริ่มผลิต" while shifts were clearly running:
//    an order that takes hours to finish would keep the line idle all morning and
//    only then start a 60-min clock — the opposite of a start-of-shift AM check.
//    Both this dashboard and the pm-daily-scan edge function must use the same anchor.
export const DAILY_PM_WINDOW_MIN = 60

// Colours:
//   green   — every registered item checked, all pass
//   red     — at least one abnormal (NG) result (wins over incomplete)
//   orange  — window elapsed and still incomplete (checked < total)
//   pending — production started but still inside the grace window
//   idle    — line hasn't opened an order yet (nothing to check against)
//   none    — line has no registered daily-PM equipment
//
// @param targets  [{ jig_id, name, machine_no }]  registered equipment for the line/shift
// @param results  { [jig_id]: { status: 'pass'|'fail'|'pending', ngTopics: string[] } }
//                 latest inspection outcome for this shift/day, keyed by jig
// @param firstOrderAt  ISO string / Date of the first order OPENED this shift, or null
// @param now      reference time (defaults to current time)
export function computeDailyPmStatus({ targets = [], results = {}, firstOrderAt = null, windowMin = DAILY_PM_WINDOW_MIN, now } = {}) {
  const nowMs = (now ? new Date(now) : new Date()).getTime()
  const checked = []
  const missing = []
  const ng = []

  for (const t of targets) {
    const r = results[t.jig_id]
    if (!r || r.status === 'pending' || r.status == null) { missing.push(t); continue }
    checked.push(t)
    if (r.status === 'fail') ng.push({ ...t, topics: r.ngTopics ?? [], inspection_id: r.id ?? null })
  }

  const total = targets.length
  const windowPassed = firstOrderAt != null &&
    (nowMs - new Date(firstOrderAt).getTime()) > windowMin * 60000
  /* ⚙️ B1 (02/11) — target อาจมี `startAt` ของตัวเอง = เวลาเปิดใบผลิตใบแรก "ของเครื่องนั้น"
     (ตัดสินรายเครื่องจาก prod_orders.machine_no) · ไม่มี = ใช้เวลาของไลน์ (พฤติกรรมเดิมเป๊ะ) */
  const startOf = (t) => t?.startAt ?? firstOrderAt
  const isLate = (t) => { const s = startOf(t); return s != null && (nowMs - new Date(s).getTime()) > windowMin * 60000 }
  const startedMissing = missing.filter(t => startOf(t) != null)
  const lateMissing = missing.filter(isLate)

  let status
  if (total === 0)                     status = 'none'
  else if (ng.length > 0)              status = 'red'      // abnormal wins
  else if (checked.length === total)   status = 'green'    // complete & all pass
  else if (startedMissing.length === 0) status = 'idle'    // production not started (สำหรับเครื่องที่ยังไม่ตรวจ)
  else if (lateMissing.length > 0)     status = 'orange'   // late & incomplete
  else                                 status = 'pending'  // still within window

  return {
    status,
    total,
    checked: checked.length,
    missing,          // [{ jig_id, name, machine_no }] not yet checked
    ng,               // [{ jig_id, name, machine_no, topics: [] }] abnormal
    firstOrderAt,
    windowPassed,
    lateN: lateMissing.length,          // ยังไม่ตรวจ + เกินกรอบ (ต่อเครื่อง)
    startedMissingN: startedMissing.length,
  }
}

export const DAILY_PM_STATUS_META = {
  green:   { label: 'ตรวจครบ ปกติ',     color: '#3dd65c' },
  red:     { label: 'พบความผิดปกติ',    color: '#e05c4a' },
  orange:  { label: 'ตรวจไม่ครบ (เกินเวลา)', color: '#f59a3f' },
  pending: { label: 'อยู่ในช่วงเวลาตรวจ', color: '#9b8de8' },
  idle:    { label: 'ยังไม่เริ่มผลิต',   color: '#527855' },
  none:    { label: 'ไม่มีรายการลงทะเบียน', color: '#6b7280' },
}

/* ── ส่วนที่ใช้ร่วมกันระหว่าง /daily-checker?tab=pm กับผังรวมโรงงาน (2026-10-08) ── */
/** กะปัจจุบัน + เวลาเริ่มกะ (Date) + วันทำงาน — ใช้ตัดสิน "ตรวจแล้วในกะนี้" (รับ `now` เพื่อเทส) */
export function amShiftInfo(now = new Date()) {
  const shift = getCurrentShift(now)
  const workDateStr = getWorkDate(now)
  const [y, m, d] = workDateStr.split('-').map(Number)
  const [hh, mm] = shiftStartTime(shift).split(':').map(Number)
  const shiftStart = new Date(y, m - 1, d, hh, mm, 0, 0)   // เวลาเครื่อง (= Asia/Bangkok ตอน deploy) ไม่ใช่ UTC
  return { shift, workDateStr, shiftStart, label: shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก' }
}

/* AM = operator ฝ่ายผลิตเช็ค "เครื่องผลิต" รายวัน → ตัด jig/die tooling + facility/utility ออกจากลิสต์
   ⚠️ แต่ "ชนิดอุปกรณ์ ไม่ได้ล็อกว่าใครเป็นคนตรวจ" (คำสั่ง user 2026-08-11) — ตัวที่ **มี checklist ของ AM อยู่แล้ว**
      ต้องโผล่เสมอ ไม่งั้นตั้งจุดตรวจ AM ที่ PM Setup ได้ แต่เครื่องไม่มีวันโผล่ให้ operator ตรวจ = ทางตัน */
export function isDailyAmEquipment(j, amEquipIds) {
  if (!j) return false
  if (amEquipIds?.has(j.id)) return true
  if (j.equipment_category === 'facility' || j.equipment_category === 'utility') return false
  if (j.equipment_type === 'jig' || j.equipment_type === 'die') return false
  return true   // machine / ไม่ระบุ (legacy) / production
}

/**
 * จัดกลุ่มทะเบียนจุดตรวจของกะนี้ต่อไลน์ — เฉพาะ target ที่ชี้อุปกรณ์ที่ยังอยู่ในขอบเขต AM
 * (target ที่ชี้อุปกรณ์ซึ่งเปลี่ยนชนิด/ย้ายหมวดไปแล้ว = ข้าม — เคสจริงใน mock audit)
 * @returns { [line_name]: [{ jig_id, name, machine_no }] }
 */
export function dailyAmTargetsByLine({ targets = [], jigs = [], shift } = {}) {
  const jigById = Object.fromEntries(jigs.map(j => [j.id, j]))
  const byLine = {}
  for (const t of targets) {
    if (t.shift && shift && t.shift !== shift) continue   // target เฉพาะกะอื่น
    const j = jigById[t.jig_id]
    if (!j) continue
    ;(byLine[t.line_name] ||= []).push({ jig_id: j.id, name: j.name, machine_no: j.machine_no })
  }
  return byLine
}

/**
 * สถานะ AM รายวันต่อไลน์ (pure) — ผลลัพธ์ของ `computeDailyPmStatus` + ตัวนับที่จอรวมหลายไลน์เอาไปบวกได้
 *   · `late`  = ยังไม่ตรวจและเกินกรอบ 60 นาทีหลังเปิดใบแรก (ส้ม)
 *   · `wait`  = ยังไม่ตรวจแต่ยังอยู่ในกรอบ (ม่วง/รอ)
 *   · `notStarted` = ยังไม่ตรวจและไลน์ยังไม่เปิดใบผลิต (idle — ยังไม่ต้องตรวจ)
 *   · `ngN`   = จำนวนจุดที่ผลตรวจ = fail
 * 🔴 แดง (fail) ชนะทุกอย่าง · ส้มชนะรอ · "ยังไม่เริ่มผลิต" ≠ "ตรวจครบ" ห้ามให้สีเขียว
 * @returns { [line_name]: { status, total, checked, ngN, late, wait, notStarted, hasSession, missing, ng, firstOrderAt } }
 */
export function dailyAmLineStatus({ targets, jigs, resultByJig = {}, firstOrderByLine = {}, openSessionLines, shift, now,
  runByLine, moFollow } = {}) {
  const byLine = dailyAmTargetsByLine({ targets, jigs, shift })
  const out = {}
  for (const [line_name, tgAll] of Object.entries(byLine)) {
    /* ⚙️ B1 — เครื่องไหน "ต้องตรวจ" ตัดสินจากใบผลิตที่สแกนในกะนี้ (`runByLine` จาก loader)
       ไม่ส่ง `runByLine` = พฤติกรรมเดิมเป๊ะ (ทุกเครื่องในทะเบียนต้องตรวจ · ตัดสินทั้งไลน์) */
    const split = runByLine ? amTargetsByRun(tgAll, runByLine[line_name]) : null
    const tg = split ? split.required : tgAll
    const r = computeDailyPmStatus({ targets: tg, results: resultByJig, firstOrderAt: firstOrderByLine[line_name] ?? null, now })
    const missingN = r.missing.length
    const notStarted = missingN - r.startedMissingN
    const late = r.lateN
    const wait = missingN - notStarted - late
    // 🔴 ทุกเครื่องในทะเบียนไม่ได้เดินกะนี้ = "ไม่มีเครื่องที่ต้องตรวจ" ไม่ใช่ "ไม่มีรายการลงทะเบียน" (none) และไม่ใช่ขาดตรวจ
    const allNotRunning = !!split && tg.length === 0 && split.notRunning.length > 0
    const row = {
      ...r,
      status: allNotRunning ? 'idle' : r.status,
      ngN: r.ng.length, late, wait, notStarted,
      // idle มีได้ 2 แบบ ต้องแยกให้ผู้ใช้เห็น ไม่งั้น "ยังไม่เริ่มผลิต" ตอนกะเดินอยู่ = จอโกหก
      hasSession: openSessionLines ? openSessionLines.has(line_name) : null,
      amMode: split ? split.mode : 'line',      // machine | mixed | line_no_mno | line
      notRunning: split ? split.notRunning : [], // เครื่องในทะเบียนที่ไม่มีใบผลิตสแกนกะนี้ = ไม่ต้องตรวจ (ไม่ใช่ขาดตรวจ)
      noMnoOrders: split ? split.noMnoOrders : 0,
      allNotRunning,
      registeredN: tgAll.length,
    }
    // 🔧 B3 — ผลตรวจ NG ของกะนี้ผูกใบซ่อมหรือยัง + ใบซ่อมค้างจากวันก่อน (ไม่ส่ง moFollow = ไม่มีข้อมูลส่วนนี้)
    if (moFollow) {
      row.ng = row.ng.map(n => ({ ...n, follow: amNgFollowState(n.inspection_id, moFollow) }))
      row.ngNoMoN = row.ng.filter(n => n.follow.state === 'no_mo').length
      row.carry = tgAll.flatMap(t => (moFollow.carryByJig?.[t.jig_id] || [])
        .filter(c => !row.ng.some(n => n.jig_id === t.jig_id && n.follow.mo?.id === c.mo.id))
        .map(c => ({ ...t, ...c })))
    }
    out[line_name] = row
  }
  return out
}

/* ═══ ⚙️ B1 — AM รายเครื่อง: เครื่องไหน "ต้องตรวจ" = เครื่องที่มีใบผลิตสแกนในกะนี้ ═══  2026-11-02 (ประชุมหน้างาน)
   เดิมตัดสินทั้งไลน์: ไลน์เปิดใบแรก ⇒ ทุกเครื่องในทะเบียนต้องตรวจ — ไลน์ auto/ไลน์ "single" ที่ไม่ได้เดินทุกเครื่อง
   จึงขึ้นส้ม "ตรวจไม่ครบ" ให้เครื่องที่ไม่ได้เปิดเลย
   🔴 ตัดสินจาก `prod_orders.machine_no` ของ session ในครอบครัวไลน์ (แม่-ลูก · `getLineFamilyNames`)
   🔴 **ไลน์ที่ใบผลิตไม่ลงเลขเครื่องเลย = ถอยไปตัดสินทั้งไลน์ (พฤติกรรมเดิม) และจอต้องเขียนบอก** (`amMode='line_no_mno'`)
   🔴 มีใบที่ไม่ลงเลขเครื่องปนอยู่ (`mixed`) ⇒ เครื่องที่ไม่เจอในใบ "อาจเดินอยู่" = ยังต้องตรวจ (ถอยแบบไลน์ · ไม่บีบเป็น "ไม่เดิน")
   · เทียบเลขเครื่องด้วย `machineKey()` (utils/machineNo.js) — `SW10` = `SW-10` · เลขที่ต่อด้วย `/` (`SP-10/NF86`)
     แตกเป็นทีละเครื่องด้วย (ใบผลิตจริงลงแบบนี้) */
export function amMachineKeys(no) {
  const s = String(no ?? '').trim()
  if (!s) return []
  const parts = [s, ...s.split(/[/,]/)]
  return [...new Set(parts.map(machineKey).filter(Boolean))]
}

/**
 * ใบผลิตกะนี้ → "เครื่องที่เดิน" ต่อไลน์ (รวมครอบครัวแม่-ลูก)
 * @param {object[]} lines   ทะเบียนไลน์ (`id`/`name`/`parent_line_name`)
 * @param {{line_name:string, machine_no?:string, at?:string}[]} orders  ใบผลิตของ session กะนี้
 * @returns {{[line:string]: { orders:number, noMno:number, keys: Object<string,string|null> }}}
 *   `keys[machineKey] = เวลาเปิดใบแรกของเครื่องนั้น` (ISO · null = ไม่รู้เวลา)
 */
export function runningMachinesByLine(lines = [], orders = []) {
  const raw = {}
  for (const o of orders || []) {
    if (!o?.line_name) continue
    const e = (raw[o.line_name] ||= { orders: 0, noMno: 0, keys: {} })
    e.orders++
    const ks = amMachineKeys(o.machine_no)
    if (!ks.length) { e.noMno++; continue }
    for (const k of ks) {
      const at = o.at || null
      if (!(k in e.keys) || (at && (!e.keys[k] || at < e.keys[k]))) e.keys[k] = at
    }
  }
  const merge = (names) => {
    const m = { orders: 0, noMno: 0, keys: {} }
    for (const n of names) {
      const e = raw[n]; if (!e) continue
      m.orders += e.orders; m.noMno += e.noMno
      for (const [k, at] of Object.entries(e.keys)) {
        if (!(k in m.keys) || (at && (!m.keys[k] || at < m.keys[k]))) m.keys[k] = at
      }
    }
    return m
  }
  const out = {}
  for (const l of lines || []) {
    if (l?.name == null) continue
    const fam = getLineFamilyNames(lines, l.id)
    out[l.name] = merge(fam?.length ? fam : [l.name])
  }
  // ชื่อที่เปิดกะแต่ไม่อยู่ในทะเบียนไลน์ (เปิดด้วยชื่อเครื่อง) — ต้องไม่หาย
  for (const n of Object.keys(raw)) if (!out[n]) out[n] = merge([n])
  return out
}

/**
 * แยกทะเบียนจุดตรวจของไลน์เป็น "ต้องตรวจกะนี้" กับ "เครื่องไม่เดิน"
 * @returns {{ required: object[], notRunning: object[], mode: 'machine'|'mixed'|'line_no_mno'|'line', noMnoOrders:number }}
 *   required[i].startAt = เวลาเปิดใบแรกของเครื่องนั้น (ไม่มี = ใช้เวลาของไลน์)
 *   required[i].byLine = true เมื่อถอยไปตัดสินแบบทั้งไลน์ (ระบบไม่รู้ว่าเครื่องนี้เดินไหม)
 */
export function amTargetsByRun(tg = [], run) {
  if (!run || !run.orders) return { required: tg, notRunning: [], mode: 'line', noMnoOrders: 0 }
  const keyN = Object.keys(run.keys || {}).length
  if (!keyN) return { required: tg.map(t => ({ ...t, byLine: true })), notRunning: [], mode: 'line_no_mno', noMnoOrders: run.noMno }
  const required = [], notRunning = []
  for (const t of tg) {
    const ks = amMachineKeys(t.machine_no)
    const hit = ks.filter(k => k in run.keys)
    if (hit.length) {
      const ats = hit.map(k => run.keys[k]).filter(Boolean).sort()
      required.push(ats.length ? { ...t, startAt: ats[0] } : { ...t })
    } else if (!ks.length || run.noMno > 0) {
      required.push({ ...t, byLine: true })   // ไม่รู้ว่าเดินไหม ⇒ ต้องตรวจ (ห้ามบีบเป็น "ไม่เดิน")
    } else {
      notRunning.push(t)
    }
  }
  return { required, notRunning, mode: run.noMno > 0 ? 'mixed' : 'machine', noMnoOrders: run.noMno }
}

/** ป้ายโหมดการตัดสินของไลน์ — จอต้องเขียนบอกเสมอเมื่อไม่ได้ตัดสินรายเครื่อง (กฎความซื่อสัตย์ของจอ) */
export function amModeNote(row) {
  if (!row) return null
  if (row.amMode === 'line_no_mno') return `ใบผลิตกะนี้ไม่ลงเลขเครื่อง — ตัดสินทั้งไลน์ (ทุกเครื่องในทะเบียนต้องตรวจ)`
  if (row.amMode === 'mixed') return `มีใบผลิต ${row.noMnoOrders} ใบไม่ลงเลขเครื่อง — เครื่องที่ไม่เจอในใบถือว่าอาจเดิน (ยังต้องตรวจ)`
  return null
}

/* ═══ 🔧 B3 — AM เจอผิดปกติ → ต้องติดตามใบแจ้งซ่อม (MO) ═══  2026-11-02 (ประชุมหน้างาน)
   ผลตรวจ NG 1 ใบ ↔ MO 1 ใบ (`mtn_orders.source_inspection_id` · unique ฝั่ง DB) หรือ "เหตุผลที่ไม่เปิด"
   (`inspections.mo_waived_reason` · migration 20261102_am_ng_mo_waiver_dr.sql)
   state: `mo_open` · `mo_closed` · `mo_void` (ตีกลับ/ยกเลิก = ยังไม่ได้แก้) · `waived` · `no_mo` · `unknown` (อ่านไม่ได้)
   🔴 ป้ายสถานะ MO ต้องมาจาก `moStatusLabel()` (utils/mtnStepPerm.js) — ห้ามแต่งเองในหน้า */
const MO_DONE = ['closed', 'transferred']
const MO_VOID = ['rejected', 'cancelled']
export function amNgFollowState(inspectionId, moFollow = {}) {
  if (!inspectionId) return { state: 'unknown', mo: null }
  if (moFollow.ok === false) return { state: 'unknown', mo: null }
  const mo = moFollow.moByInsp?.[inspectionId] || null
  if (mo) {
    const st = String(mo.status || '').trim()
    return { state: MO_DONE.includes(st) ? 'mo_closed' : MO_VOID.includes(st) ? 'mo_void' : 'mo_open', mo }
  }
  const w = moFollow.waiverByInsp?.[inspectionId]
  if (w) return { state: 'waived', mo: null, reason: w.reason }
  return { state: 'no_mo', mo: null }
}

/**
 * ใบซ่อมที่เปิดจากผลตรวจ AM "ก่อนกะนี้" แล้วยังไม่ปิด ⇒ ป้าย "แจ้งซ่อมแล้ว ยังไม่แก้ไข" บนเครื่องนั้นทุกวันจนกว่าจะปิด
 * @param {object[]} mos   mtn_orders (ต้องมี source_inspection_id · status)
 * @param {object} inspById  { [inspection_id]: { jig_id, inspected_at } } — ใบตรวจ AM เท่านั้น
 * @param {Date|string} shiftStart  ใบที่ตรวจตั้งแต่เริ่มกะนี้ไม่นับเป็น "ค้างจากวันก่อน"
 * @returns {{[jig_id]: {mo, inspected_at}[]}}
 */
export function amCarryOverByJig(mos = [], inspById = {}, shiftStart) {
  const cut = shiftStart ? new Date(shiftStart).getTime() : null
  const out = {}
  for (const mo of mos || []) {
    const st = String(mo?.status || '').trim()
    if (MO_DONE.includes(st) || MO_VOID.includes(st)) continue
    const insp = inspById[mo?.source_inspection_id]
    if (!insp?.jig_id) continue
    if (cut != null && insp.inspected_at && new Date(insp.inspected_at).getTime() >= cut) continue
    ;(out[insp.jig_id] ||= []).push({ mo, inspected_at: insp.inspected_at || null })
  }
  return out
}


/**
 * "ไลน์ไหนเดินอยู่กะนี้" — **นับไลน์แม่-ลูกด้วย** ห้ามเทียบชื่อตรงตัว (2026-10-13)
 *
 * 🔴 ทำไมต้องมี: วัดจากของจริง 45 วัน — `GOR` · `LWR BAR` · `HYDROFORM` · `LINE APRON ASSY`
 *    เปิดกะ **0 ครั้ง** (ลูกเดินทุกวันแทน) แต่ 4 ตัวนี้ถือ **แผน LPA รวม 30 แผน**
 *    ⇒ เทียบชื่อตรงตัว = ชุด "ไลน์ที่เดินอยู่" ไม่มีชื่อไลน์แม่
 *    ⇒ ปลายทางที่ใช้ชุดนี้เป็น "ประตู" (`pokayokeByLine`/`lpaByLine` · `utils/prodRoutine.js`)
 *      **ข้ามงานตรวจของไลน์แม่ทั้งก้อนเงียบๆ** + จอ AM เขียน "ยังไม่เปิดกะ" ให้ไลน์ที่ลูกเดินอยู่
 *
 * family (`getLineFamilyNames`) = ตัวเอง + แม่/ปู่ + ลูก/หลานของตัวเอง — **ไม่รวมพี่น้อง**
 * ⇒ ไลน์พี่น้องที่ไม่ได้เดินไม่ถูกลากเข้ามา · ชื่อที่เปิดกะแต่ไม่อยู่ในทะเบียนไลน์ (เปิดด้วยชื่อเครื่อง)
 *   ยังอยู่ในชุดเหมือนเดิม ไม่หายไป
 *
 * @param {object[]} lines    ทะเบียนไลน์ (ต้องมี `id` · `name` · `parent_line_name`)
 * @param {Set<string>|string[]} openRaw  ชื่อไลน์ที่มีกะเปิดจริง (จาก `production_sessions`)
 * @returns {Set<string>} ชื่อไลน์ที่ถือว่า "เดินอยู่"
 */
export function openFamilyLines(lines, openRaw) {
  const raw = openRaw instanceof Set ? openRaw : new Set(openRaw || [])
  const out = new Set(raw)
  for (const l of lines || []) {
    if (l?.name == null) continue
    const fam = getLineFamilyNames(lines, l.id)
    const names = fam?.length ? fam : [l.name]
    if (names.some(n => raw.has(n))) out.add(l.name)
  }
  return out
}

/** 🔧 B3 — "ไม่เปิดใบซ่อม" ได้เฉพาะเมื่อเขียนเหตุผลจริง (ช่องว่าง/ตัวอักษรเดียว = ไม่ใช่เหตุผล)
 *  ⚠️ เกณฑ์ความยาวเป็นแค่ตาข่ายกันกดผ่าน ไม่ได้ตัดสินว่าเหตุผลดีไหม — หัวหน้าเห็นเหตุผลบนบอร์ด AM */
export const AM_WAIVER_MIN_LEN = 5
export const amWaiverReasonValid = (reason) => String(reason ?? '').trim().length >= AM_WAIVER_MIN_LEN
