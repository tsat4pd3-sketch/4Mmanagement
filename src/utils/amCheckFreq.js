/* ═══ 🗓️ รอบตรวจ "รายหัวข้อ" ของใบ AM (2026-11-26 · คำสั่ง user) ═════════════════════════════════════════
   user: "AM ที่ผลิตใช้ บางหัวข้อไม่ได้ตรวจทุกกะทุกวัน แต่ตรวจรายสัปดาห์ หรือเดือนละครั้ง
          (ต่างกับช่างที่วางแผนเข้ามาตรวจเป็น shutdown maintenance ตามรอบทุกข้อ)"
   user เลือก 26/11: ทุกกะ / รายวัน / รายสัปดาห์ / รายเดือน · นับตามปฏิทิน + ค้างจนกว่าตรวจ ·
                     ข้อที่ยังไม่ถึงรอบ = ซ่อนไว้ บอกจำนวน (กดกางตรวจเพิ่มได้)

   คอลัมน์ `jig_checkpoints.am_check_freq` (DR · default 'shift') · migration 20261126c
   🔴 ใช้เฉพาะใบของทีม AM (`isAmTeam`) — ใบ PM ของช่างห้ามอ่านคอลัมน์นี้ (ตามรอบแผน PM ทั้งใบ)
   🔴 ไฟล์นี้ pure — ผู้เรียกโหลด "ตรวจข้อนี้ครั้งล่าสุดเมื่อไร" (`inspection_results` + `inspections.inspected_at`)
   🔴 อ่านประวัติไม่ได้ = ทุกข้อถึงรอบ (fail-safe: ตรวจเกินดีกว่าข้ามข้อที่ต้องตรวจ) + จอต้องเขียนบอก
   📄 docs/modules/pm-hub-check-setup.md §🗓️ รอบตรวจรายหัวข้อ AM */

export const AM_FREQS = ['shift', 'daily', 'weekly', 'monthly']
export const AM_FREQ_META = {
  shift:   { label: 'ทุกกะ',      short: 'ทุกกะ' },
  daily:   { label: 'รายวัน',     short: 'วันละครั้ง' },
  weekly:  { label: 'รายสัปดาห์', short: 'สัปดาห์ละครั้ง (จ–อา)' },
  monthly: { label: 'รายเดือน',   short: 'เดือนละครั้ง' },
}

/** ค่าในคอลัมน์ → รอบที่ใช้จริง (ว่าง/ไม่รู้จัก = ทุกกะ = พฤติกรรมเดิม) */
export const amFreqOf = (cp) => (AM_FREQS.includes(cp?.am_check_freq) ? cp.am_check_freq : 'shift')

const pad2 = (n) => String(n).padStart(2, '0')

/** วันจันทร์ของสัปดาห์ที่ workDate อยู่ ('YYYY-MM-DD' → 'YYYY-MM-DD' · จ–อา) · แกะไม่ออก = null */
export function weekStartOf(workDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(workDate || ''))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const dow = (d.getUTCDay() + 6) % 7          // จ=0 … อา=6
  d.setUTCDate(d.getUTCDate() - dow)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** คีย์ "รอบ" ของวันทำงาน+กะ ตามความถี่ — ตรวจในรอบเดียวกันแล้ว = ไม่ถึงรอบ */
export function periodKey(freq, workDate, shift) {
  if (!workDate) return null
  if (freq === 'daily') return workDate
  if (freq === 'weekly') return weekStartOf(workDate)
  if (freq === 'monthly') return String(workDate).slice(0, 7)
  return `${workDate}|${shift || ''}`
}

/** วันแรกของรอบที่ยาวสุดที่ต้องดูย้อน (ใช้ตั้ง gte ของคิวรีประวัติ) — min(ต้นเดือน, ต้นสัปดาห์) */
export function lookbackStart(workDate) {
  const w = weekStartOf(workDate)
  const mo = workDate ? `${String(workDate).slice(0, 7)}-01` : null
  if (!w || !mo) return null
  return w < mo ? w : mo
}

/**
 * แยกข้อเป็น "ถึงรอบ" / "ยังไม่ถึงรอบ"
 * @param {object[]} cps  จุดตรวจของใบ AM
 * @param {{workDate:string, shift:'day'|'night'}} slot  กะปัจจุบัน (amSlotOf)
 * @param {Map<string,{workDate:string,shift:string}[]>|null} doneByCp  ช่องที่ข้อนั้นเคยมีผลตรวจ (ในช่วง lookback)
 *        · `null` = อ่านประวัติไม่ได้ ⇒ ทุกข้อถึงรอบ
 * @returns {{ due: object[], notDue: {cp:object, freq:string, lastDate:string}[], unknown: boolean }}
 *  🔴 จุดคำนวณ (calc) ที่ถึงรอบ ⇒ จุด A/B ที่มันอ้างต้องถึงรอบด้วย (ไม่งั้นคิดค่าไม่ได้ = ค้างกรอกตลอด)
 */
export function splitDueCps(cps = [], slot = null, doneByCp = null) {
  const list = cps || []
  if (!doneByCp || !slot?.workDate) return { due: [...list], notDue: [], unknown: !doneByCp }
  const dueIds = new Set(), notDueInfo = new Map()
  for (const cp of list) {
    const f = amFreqOf(cp)
    if (f === 'shift') { dueIds.add(cp.id); continue }
    const cur = periodKey(f, slot.workDate, slot.shift)
    const hits = (doneByCp.get(cp.id) || []).filter(s => periodKey(f, s.workDate, s.shift) === cur)
    if (hits.length) notDueInfo.set(cp.id, { freq: f, lastDate: hits.map(h => h.workDate).sort().pop() })
    else dueIds.add(cp.id)
  }
  // จุดคำนวณที่ถึงรอบ ลากจุดต้นทางกลับมา
  for (const cp of list) {
    const c = cp?.calc
    if (!dueIds.has(cp.id) || !c || !c.a || !c.b) continue
    for (const ref of [String(c.a), String(c.b)]) if (notDueInfo.has(ref)) { notDueInfo.delete(ref); dueIds.add(ref) }
  }
  return {
    due: list.filter(cp => dueIds.has(cp.id)),
    notDue: list.filter(cp => notDueInfo.has(cp.id)).map(cp => ({ cp, ...notDueInfo.get(cp.id) })),
    unknown: false,
  }
}

/** ใบ AM ต้องมีอย่างน้อย 1 ข้อ "ทุกกะ" — ไม่งั้นบางกะไม่มีข้อถึงรอบ แต่บอร์ด/รายงานรายเดือน/ตัวเตือนยังนับเครื่องนั้นว่าขาดตรวจ
 *  คืนข้อความผิด หรือ '' = ผ่าน (ใบว่างไม่ตัดสินที่นี่) */
export function amFreqSetupIssue(cps = []) {
  const list = (cps || []).filter(Boolean)
  if (!list.length) return ''
  return list.some(c => amFreqOf(c) === 'shift')
    ? ''
    : 'ใบ AM ต้องมีอย่างน้อย 1 ข้อที่ตรวจ "ทุกกะ" — ไม่งั้นกะที่ไม่มีข้อถึงรอบ บอร์ด AM จะนับเครื่องนี้ว่าขาดตรวจ'
}
