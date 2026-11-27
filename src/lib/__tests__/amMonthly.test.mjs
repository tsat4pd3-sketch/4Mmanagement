// 📅 รายงาน AM รายเดือน (ประชุม 02/11 ข้อ C2 · 2026-11-03)
// ⏱️ ทุกเคสตรึง `now` — ห้ามพึ่งนาฬิกาเครื่อง (รอบเทส +400 วัน)
import test from 'node:test'
import assert from 'node:assert/strict'
import { amMonthDays, amSlotOf, amMonthRange, buildAmMonthly, amMonthlyAoa, amRowsSummary, AM_RESULT_META } from '../amMonthly.js'
import { CHECK_DAY_META, runKey } from '../../utils/dailyCheckDay.js'

const NOW = new Date('2026-12-15T03:00:00Z')   // 10:00 ไทย 15 ธ.ค. ⇒ กะเช้า 2026-12-15 กำลังเดิน

test('amMonthDays / amMonthRange — วันทั้งเดือน + ช่วงดึงใบตรวจ 08:00→08:00 เวลาไทย', () => {
  assert.equal(amMonthDays('2026-02').length, 28)
  assert.equal(amMonthDays('2028-02').length, 29)
  assert.deepEqual(amMonthDays('bad'), [])
  const r = amMonthRange('2026-12')
  assert.equal(r.from, '2026-12-01T08:00:00+07:00')
  assert.equal(r.to, '2027-01-01T08:00:00+07:00')
  assert.equal(r.last, '2026-12-31')
})

test('amSlotOf — ตัด 08:00/20:00 ตามเวลาไทย ไม่พึ่ง timezone เครื่อง', () => {
  assert.deepEqual(amSlotOf('2026-12-03T01:00:00Z'), { workDate: '2026-12-03', shift: 'day' })    // 08:00
  assert.deepEqual(amSlotOf('2026-12-03T00:59:00Z'), { workDate: '2026-12-02', shift: 'night' })  // 07:59 = กะดึกของเมื่อวาน
  assert.deepEqual(amSlotOf('2026-12-03T13:00:00Z'), { workDate: '2026-12-03', shift: 'night' })  // 20:00
  assert.equal(amSlotOf('nope'), null)
})

test('ผลตรวจในช่องห้ามชนสัญลักษณ์สถานะวัน (ขาด/NP/?/·)', () => {
  const marks = new Set(Object.values(CHECK_DAY_META).map(m => m.mark).filter(Boolean))
  for (const m of Object.values(AM_RESULT_META)) assert.ok(!marks.has(m.mark), m.mark)
})

const lines = [
  { id: 1, name: 'HYDROFORM', parent_line_name: null },
  { id: 2, name: 'HDF1', parent_line_name: 'HYDROFORM' },
  { id: 3, name: 'LINE B', parent_line_name: null },
]
const jigs = [
  { id: 'j1', name: 'PRESS 1', machine_no: 'P-01', equipment_type: 'machine' },
  { id: 'j2', name: 'PRESS 2', machine_no: 'P-02', equipment_type: 'machine' },
  { id: 'j9', name: 'JIG', machine_no: null, equipment_type: 'jig' },   // นอกขอบเขต AM
]
const targets = [
  { line_name: 'HYDROFORM', jig_id: 'j1', shift: null, created_at: '2026-11-01T00:00:00Z' },
  { line_name: 'HYDROFORM', jig_id: 'j2', shift: null, created_at: '2026-12-05T03:00:00Z' },   // ลงทะเบียน 5 ธ.ค.
  { line_name: 'HYDROFORM', jig_id: 'j9', shift: null },
  { line_name: 'LINE B', jig_id: 'j1', shift: 'night' },   // เฉพาะกะดึก ⇒ ไม่อยู่ในรายงานกะเช้า
]
// ไลน์แม่ HYDROFORM ไม่เคยเปิดกะในชื่อตัวเอง — ลูก HDF1 เปิดวันที่ 1-14 ยกเว้น 3 (กะเช้า)
const runsByKey = new Map()
for (let d = 1; d <= 14; d++) {
  if (d === 3) continue
  runsByKey.set(runKey(`2026-12-${String(d).padStart(2, '0')}`, 'day'), new Set(['HDF1']))
}
const at = (day, hhmmTh) => new Date(`2026-12-${day}T${hhmmTh}:00+07:00`).toISOString()
const inspections = [
  { jig_id: 'j1', status: 'pass', inspected_at: at('01', '08:30') },
  { jig_id: 'j1', status: 'pending', inspected_at: at('02', '08:30') },     // pending = ยังไม่ตรวจ
  { jig_id: 'j1', status: 'fail', inspected_at: at('04', '09:00') },
  { jig_id: 'j1', status: 'pass', inspected_at: at('04', '08:10') },       // เก่ากว่า — ล่าสุดชนะ (fail)
  { jig_id: 'j1', status: 'pass', inspected_at: at('05', '21:00') },       // กะดึก — ไม่นับในกะเช้า
  { jig_id: 'j2', status: 'pass', inspected_at: at('06', '08:20') },
]
const isWorkingDay = (d) => d !== '2026-12-07' && d !== '2026-12-08'   // 7 = วันหยุด (มีการผลิต) · 8 = หยุด (มีผลิตด้วย)

const build = (over = {}) => buildAmMonthly({ month: '2026-12', shift: 'day', targets, jigs, amEquipIds: new Set(),
  inspections, runsByKey, lines, isWorkingDay, now: NOW, ...over })

test('buildAmMonthly — ครอบครัวไลน์ · pending ไม่นับ · ล่าสุดชนะ · ก่อนลงทะเบียน = ไม่มีแผน', () => {
  const rep = build()
  assert.deepEqual(rep.rows.map(r => r.line_name), ['HYDROFORM'])   // LINE B มีแต่แถวกะดึก · j9 นอกขอบเขต
  const hy = rep.rows[0]
  const [m1, m2] = hy.machines
  assert.equal(m1.jig_id, 'j1')
  const st = (m, d) => m.cells[d - 1].state
  assert.equal(st(m1, 1), 'done')
  assert.equal(m1.cells[0].result, 'pass')
  assert.equal(st(m1, 2), 'missed', 'pending ≠ ตรวจแล้ว')
  assert.equal(st(m1, 3), 'no_run', 'ไลน์ลูกไม่ได้เปิดกะ')
  assert.equal(m1.cells[3].result, 'fail', 'ล่าสุดชนะ')
  assert.equal(st(m1, 5), 'missed', 'ใบกะดึกไม่นับในกะเช้า')
  assert.equal(st(m1, 7), 'missed', 'วันหยุดแต่เดินเครื่อง = ต้องตรวจ')
  assert.equal(st(m2, 4), 'not_planned', 'ก่อนวันลงทะเบียน')
  assert.equal(st(m2, 6), 'done')
  assert.equal(st(m1, 15), 'future', 'กะที่กำลังเดิน = ยังไม่ตัดสิน')
  assert.equal(st(m1, 20), 'future')
  assert.equal(st(m1, 14), 'missed')
  assert.equal(m1.ngN, 1)
  assert.equal(hy.ngN, 1)
})

test('buildAmMonthly — ช่องไลน์: ครบทุกเครื่อง = done · บางเครื่อง = ขาด + นับ k/n', () => {
  const hy = build().rows[0]
  assert.equal(hy.cells[0].state, 'done')          // 1 ธ.ค. j2 ยังไม่ลงทะเบียน ⇒ ครบ 1/1
  assert.equal(hy.cells[5].state, 'missed')        // 6 ธ.ค. j2 ตรวจ j1 ไม่ตรวจ
  assert.equal(hy.cells[5].checked, 1)
  assert.equal(hy.cells[5].due, 2)
  assert.equal(hy.cells[3].ng, 1)
})

test('buildAmMonthly — ตัวหาร % = ตรวจแล้ว + ขาด เท่านั้น (ไม่นับ NP/ไม่มีแผน/อนาคต)', () => {
  const rep = build()
  const s = rep.rows[0].sum
  assert.equal(s.due, s.done + s.missed)
  assert.equal(s.pct, Math.round((s.done / s.due) * 100))
  assert.ok(s.no_run > 0 && s.future > 0 && s.not_planned > 0)
  assert.deepEqual(amRowsSummary(rep.rows), rep.sum)
})

test('buildAmMonthly — อ่านตารางกะไม่ได้ = ไม่รู้ ห้ามกลายเป็น "ไม่ได้ผลิต"', () => {
  const rep = build({ runsByKey: null })
  const m1 = rep.rows[0].machines[0]
  assert.equal(m1.cells[2].state, 'unknown')
  assert.equal(m1.cells[0].state, 'done', 'ตรวจแล้วยังชนะ')
  assert.equal(m1.cells[7].state, 'off', 'วันหยุด + ไม่รู้ว่าเดิน = วันหยุด')
  assert.equal(rep.runsUnknown, true)
  assert.ok(rep.unknownDays > 0)
  assert.equal(rep.rows[0].sum.no_run, 0)
})

test('buildAmMonthly — ไม่มีวันต้องตรวจ = pct null ห้าม 0%/100%', () => {
  const rep = buildAmMonthly({ month: '2027-03', shift: 'day', targets, jigs, amEquipIds: new Set(), inspections: [],
    runsByKey: new Map(), lines, now: NOW })
  assert.equal(rep.rows[0].sum.pct, null)
})

test('amMonthlyAoa — หัว + แถวไลน์ + แถวเครื่อง · ผลตรวจ/สถานะใช้ชุดเดียวกับจอ', () => {
  const rep = build()
  const aoa = amMonthlyAoa(rep, s => CHECK_DAY_META[s])
  assert.equal(aoa[0][0], 'ไลน์')
  assert.equal(aoa[0].length, 3 + 31 + 7)
  assert.equal(aoa.length, 1 + 1 + 2)
  const m1 = aoa[2]
  assert.equal(m1[3], 'OK')
  assert.equal(m1[4], 'ขาด')
  assert.equal(m1[5], 'NP')
  assert.equal(m1[6], 'NG')
})

// ⚙️ รายเครื่อง (23/11 · คำสั่ง user) — ใบผลิตลงเลขเครื่องครบ = ตัดสินรายเครื่อง · ไม่ลง/ลงไม่ครบ = ทั้งไลน์ · สถานี = robot ตามเพื่อน
test('รายเครื่อง: เครื่องที่ไม่อยู่บนใบผลิต = NP · ไม่ลงเลขเครื่อง = ทั้งไลน์ · ปน = ทั้งไลน์ · สถานีพา robot', () => {
  const L = [{ id: 1, name: 'D3', parent_line_name: null }]
  const J = [
    { id: 'jig1', name: 'JIG 1', machine_no: 'JT-01', equipment_type: 'jig' },
    { id: 'jig2', name: 'JIG 2', machine_no: 'JT-02', equipment_type: 'jig' },
    { id: 'rb', name: 'ROBOT', machine_no: 'RB-02', equipment_type: 'machine' },
  ]
  const T = J.map(j => ({ line_name: 'D3', jig_id: j.id, shift: null, created_at: '2026-11-01T00:00:00Z' }))
  const runs = new Map(['01', '02', '03', '04'].map(d => [runKey(`2026-12-${d}`, 'day'), new Set(['D3'])]))
  const orders = new Map([
    [runKey('2026-12-01', 'day'), [{ line_name: 'D3', machine_no: 'JT01' }]],                                    // รายเครื่อง
    [runKey('2026-12-02', 'day'), [{ line_name: 'D3', machine_no: null }]],                                      // ไม่ลงเลขเครื่อง
    [runKey('2026-12-03', 'day'), [{ line_name: 'D3', machine_no: 'JT-01' }, { line_name: 'D3', machine_no: '' }]], // ปน
    [runKey('2026-12-04', 'day'), [{ line_name: 'D3', machine_no: 'JT-02' }]],
  ])
  const st = { stations: [{ id: 's', is_active: true }], members: [{ station_id: 's', jig_id: 'jig2' }, { station_id: 's', jig_id: 'rb' }] }
  const base = { month: '2026-12', shift: 'day', targets: T, jigs: J, inspections: [], runsByKey: runs, lines: L, now: NOW }
  const cellOf = (rep, id, d) => rep.rows[0].machines.find(m => m.jig_id === id).cells[d - 1].state

  const rep = buildAmMonthly({ ...base, ordersByKey: orders, amStations: st })
  assert.equal(cellOf(rep, 'jig1', 1), 'missed'); assert.equal(cellOf(rep, 'jig2', 1), 'no_run'); assert.equal(cellOf(rep, 'rb', 1), 'no_run')
  for (const id of ['jig1', 'jig2', 'rb']) assert.equal(cellOf(rep, id, 2), 'missed', `ไม่ลงเลขเครื่อง ${id}`)
  for (const id of ['jig1', 'jig2', 'rb']) assert.equal(cellOf(rep, id, 3), 'missed', `ปน ${id}`)
  assert.equal(cellOf(rep, 'jig1', 4), 'no_run'); assert.equal(cellOf(rep, 'jig2', 4), 'missed')
  assert.equal(cellOf(rep, 'rb', 4), 'missed', 'robot ไม่อยู่บนใบ แต่เพื่อนในสถานีเดิน = ต้องตรวจ')
  assert.deepEqual(rep.rows[0].modeDays, { machine: 2, mixed: 1, line_no_mno: 1, line: 0 })
  assert.equal(rep.ordersUnknown, false)

  // ไม่มีสถานี = robot ไม่อยู่บนใบ = NP (กฎเดิมของบอร์ดวันนี้)
  assert.equal(cellOf(buildAmMonthly({ ...base, ordersByKey: orders }), 'rb', 4), 'no_run')
  // อ่านใบผลิตไม่ได้ = ทั้งไลน์ทุกวัน (พฤติกรรมเดิม) + บอกจอ
  const old = buildAmMonthly(base)
  assert.equal(cellOf(old, 'jig2', 1), 'missed'); assert.equal(old.ordersUnknown, true)
})

test('รายเครื่อง: ทุกเครื่องในทะเบียนไม่เดิน = ช่องไลน์ NP ไม่ใช่ "ขาด"', () => {
  const L = [{ id: 1, name: 'D4', parent_line_name: null }]
  const J = [{ id: 'a', name: 'A', machine_no: 'SP-41', equipment_type: 'machine' }]
  const rep = buildAmMonthly({
    month: '2026-12', shift: 'day', targets: [{ line_name: 'D4', jig_id: 'a', shift: null }], jigs: J, inspections: [], lines: L, now: NOW,
    runsByKey: new Map([[runKey('2026-12-01', 'day'), new Set(['D4'])]]),
    ordersByKey: new Map([[runKey('2026-12-01', 'day'), [{ line_name: 'D4', machine_no: 'SP-13' }]]]),
  })
  assert.equal(rep.rows[0].cells[0].state, 'no_run')
})

import { amModeDaysShort, amModeDaysNote } from '../amMonthly.js'
test('ป้ายโหมดใต้ชื่อไลน์: สั้นบนจอ · เต็มใน tooltip/Excel · ไม่มีวันเปิดกะ = null', () => {
  const md = { machine: 14, mixed: 2, line_no_mno: 3, line: 1 }
  assert.equal(amModeDaysShort(md), 'รายเครื่อง 14 · ไม่ครบ 2 · ทั้งไลน์ 4 วัน')
  assert.equal(amModeDaysShort({ line_no_mno: 5 }), 'ทั้งไลน์ 5 วัน')
  assert.equal(amModeDaysShort({}), null); assert.equal(amModeDaysShort(null), null)
  assert.match(amModeDaysNote(md), /ใบผลิตลงเลขเครื่องไม่ครบ 2 วัน/)
})
