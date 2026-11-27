/* ═══ 🧩 สถานี AM — ตรวจอุปกรณ์ที่ติดตั้งคู่กันในใบเดียว (2026-11-23 · คำสั่ง user) ═══════════════
   ที่มา: robot + gripper (+ stationary + nut feeder) ติดตั้งเป็นชุดเดียวกัน — PM แยกทีมกัน
          (gripper = JIG MTN · robot = MTN) แต่ AM ที่ผลิตตรวจด้วยสายตาทุกวัน "ดูทั้งชุด"
          ⇒ เดิมต้องเปิดใบ AM ทีละอุปกรณ์
   user เลือก 23/11: จับกลุ่มเป็น "สถานี" · จุดตรวจ AM ตั้งรายอุปกรณ์เหมือนเดิม · บอร์ด AM นับเป็นสถานี

   ตาราง (DR): am_stations · am_station_members (1 อุปกรณ์อยู่ได้ 1 สถานี)
   🔴 ผลตรวจยังเก็บ "รายอุปกรณ์" (inspections เดิม) — สถานีเป็นแค่ "อะไรตรวจพร้อมกัน"
      ⇒ ประวัติ/รายงานรายเดือน/PM ของช่าง/ใบซ่อม ใช้ของเดิมทั้งหมด ห้ามสร้างตารางผลตรวจชุดที่ 2
   🔴 ไฟล์นี้ pure (ไม่แตะ DB) — loader อยู่ในจอที่เรียก (pattern เดียวกับ dailyAmBoard)
   📄 docs/modules/pm-hub-check-setup.md §🧩 สถานี AM */

/** ดัชนีสถานี: { byId, byJig (jig_id → station), membersOf(stationId) → jig_id[] เรียงตาม sort_order } */
export function buildStationIndex(stations = [], members = []) {
  const byId = new Map()
  for (const s of stations || []) if (s && s.is_active !== false) byId.set(s.id, s)
  const ms = {}
  const byJig = new Map()
  for (const m of [...(members || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const st = byId.get(m.station_id)
    if (!st) continue                    // สถานีปิดใช้/ไม่มี = สมาชิกไม่นับ
    ;(ms[st.id] ||= []).push(m.jig_id)
    byJig.set(m.jig_id, st)
  }
  return { byId, byJig, membersOf: (sid) => ms[sid] || [] }
}

/** สถานะ AM ของสถานี จากสถานะรายอุปกรณ์ (resultByJig: jig_id → { status: 'pass'|'fail'|'pending' })
 *  @param {string[]} jigIds สมาชิกที่ "ต้องตรวจกะนี้" (ตัวที่ไม่เดิน/ไม่ลงทะเบียนให้ผู้เรียกกรองออกก่อน)
 *  @returns {{ state: 'ng'|'done'|'partial'|'none'|'empty', done:number, total:number, ng:string[], missing:string[] }}
 *   ng = มีตัวไหน NG (ชนะทุกอย่าง) · done = ครบทุกตัวผ่าน · partial = ตรวจบางตัว · none = ยังไม่ตรวจเลย · empty = ไม่มีสมาชิก */
export function stationAmState(jigIds = [], resultByJig = {}) {
  const ids = [...new Set(jigIds || [])]
  if (!ids.length) return { state: 'empty', done: 0, total: 0, ng: [], missing: [] }
  const ng = [], missing = []
  let done = 0
  for (const id of ids) {
    const st = resultByJig?.[id]?.status
    if (st === 'fail') { ng.push(id); done++ }
    else if (st === 'pass') done++
    else missing.push(id)              // pending (ตรวจไม่ครบ — ใบเก่า) / ยังไม่ตรวจ = ยังไม่ครบ
  }
  const state = ng.length ? 'ng' : done === ids.length ? 'done' : done > 0 ? 'partial' : 'none'
  return { state, done, total: ids.length, ng, missing }
}

/** ตรวจก่อนบันทึกสถานี (ตั้งค่า) — คืนข้อความผิด หรือ '' = ผ่าน
 *  · ชื่อห้ามว่าง · ต้อง ≥ 2 อุปกรณ์ (ตัวเดียว = ใบเดิมพอ) · อุปกรณ์ต้องอยู่ไลน์เดียวกับสถานี
 *  · อุปกรณ์ที่อยู่สถานีอื่นแล้วห้ามซ้ำ (unique jig_id ฝั่ง DB ด้วย) */
export function validateStation({ name, line_name, jigIds = [], jigLineOf = () => null, takenBy = () => null, selfId = null } = {}) {
  if (!String(name || '').trim()) return 'ต้องตั้งชื่อสถานี'
  if (!String(line_name || '').trim()) return 'ต้องเลือกไลน์ของสถานี'
  const ids = [...new Set(jigIds || [])]
  if (ids.length < 2) return 'สถานีต้องมีอุปกรณ์อย่างน้อย 2 ตัว (ตัวเดียวใช้ใบตรวจปกติได้เลย)'
  for (const id of ids) {
    const ln = jigLineOf(id)
    if (ln && ln !== line_name) return `อุปกรณ์บางตัวอยู่ไลน์ ${ln} ไม่ใช่ ${line_name}`
    const other = takenBy(id)
    if (other && other.id !== selfId) return `อุปกรณ์บางตัวอยู่สถานี "${other.name}" แล้ว — เอาออกจากสถานีนั้นก่อน`
  }
  return ''
}

/** 🧮 บอร์ด AM นับเป็น "ชุด" (สถานี = 1 ชุด · เครื่องเดี่ยว = 1 ชุด) จากข้อมูลแถวไลน์เดิมของบอร์ด
 *  ⚠️ สีสถานะไลน์ยังมาจาก `dailyAmLineStatus` ตัวเดิม (บอร์ด/ผังรวม/edge ต้องตรงกัน) — ฟังก์ชันนี้แค่ "จัดกลุ่มเพื่อแสดง"
 *     (สถานีครบ ⇔ ทุกเครื่องในสถานีตรวจแล้ว ⇒ เขียว/แดง/ส้มของไลน์ไม่เปลี่ยน)
 *  @param {string[]} neededIds เครื่องที่ต้องตรวจกะนี้ (ไม่รวมตัวที่ไม่เดิน)
 *  @param {string[]} missingIds ยังไม่ตรวจ · @param {string[]} ngIds ตรวจแล้ว NG
 *  @returns {{ units: {station:object|null, jigIds:string[], missing:string[], ng:string[], done:boolean}[], doneN:number, total:number, stationN:number }} */
export function groupLineUnits({ neededIds = [], missingIds = [], ngIds = [], ix = null } = {}) {
  const miss = new Set(missingIds), ng = new Set(ngIds)
  const units = [], byStation = new Map()
  for (const id of [...new Set(neededIds)]) {
    const st = ix?.byJig?.get(id) || null
    let u = st ? byStation.get(st.id) : null
    if (!u) { u = { station: st, jigIds: [], missing: [], ng: [], done: false }; units.push(u); if (st) byStation.set(st.id, u) }
    u.jigIds.push(id)
    if (miss.has(id)) u.missing.push(id)
    if (ng.has(id)) u.ng.push(id)
  }
  units.forEach(u => { u.done = u.missing.length === 0 })
  return { units, doneN: units.filter(u => u.done).length, total: units.length, stationN: byStation.size }
}
