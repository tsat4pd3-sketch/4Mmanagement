// ⚙️ B1 AM รายเครื่อง + 🔧 B3 ติดตามใบซ่อมของผลตรวจ AM (ประชุมหน้างาน 2026-11-02)
// ⏱️ ทุกเคสตรึง `now` — ห้ามพึ่งนาฬิกาเครื่อง (รอบเทส +400 วัน)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  amMachineKeys, runningMachinesByLine, amTargetsByRun, dailyAmLineStatus, computeDailyPmStatus,
  amNgFollowState, amCarryOverByJig, amModeNote, amWaiverReasonValid,
} from '../pmDailyStatus.js'

const NOW = new Date('2026-11-02T03:30:00Z')   // 10:30 ไทย กะเช้า
const lines = [
  { id: 1, name: 'LINE D', parent_line_name: null },
  { id: 2, name: 'D3', parent_line_name: 'LINE D' },
  { id: 3, name: 'D5', parent_line_name: 'LINE D' },
]
const jigs = [
  { id: 'a', name: 'ROBOT A', machine_no: 'JTSRA03-01' },
  { id: 'b', name: 'ROBOT B', machine_no: 'JTSRA03-02' },
  { id: 'c', name: 'SPOT C', machine_no: 'SP-10' },
]
const targets = [
  { line_name: 'D3', jig_id: 'a' }, { line_name: 'D3', jig_id: 'b' }, { line_name: 'D3', jig_id: 'c' },
]

test('amMachineKeys — ยุบรูปแบบเลขเครื่อง + แตกเลขที่ต่อด้วย /', () => {
  assert.deepEqual(amMachineKeys('SP-10'), ['SP10'])
  assert.ok(amMachineKeys('SP-10/NF86').includes('SP10'))
  assert.ok(amMachineKeys('SP-10/NF86').includes('NF86'))
  assert.deepEqual(amMachineKeys(''), [])
  assert.deepEqual(amMachineKeys(null), [])
})

test('runningMachinesByLine — ใบเปิดที่ไลน์แม่ นับให้ไลน์ลูก (ครอบครัว) · ไม่ลากพี่น้อง', () => {
  const run = runningMachinesByLine(lines, [
    { line_name: 'LINE D', machine_no: 'JTSRA03-01', at: '2026-11-02T01:10:00Z' },
    { line_name: 'D5', machine_no: 'SP-10', at: '2026-11-02T01:00:00Z' },
  ])
  assert.ok(amMachineKeys('JTSRA03-01')[0] in run.D3.keys)
  assert.ok(!('SP10' in run.D3.keys), 'D5 เป็นพี่น้อง ห้ามลากเข้ามา')
  assert.equal(run.D3.orders, 1)
  assert.ok('SP10' in run['LINE D'].keys, 'แม่เห็นลูกทุกตัว')
})

test('amTargetsByRun — ไม่มีใบผลิต = โหมดเดิม (ทั้งไลน์) · ไม่ลงเลขเครื่องเลย = ถอยทั้งไลน์ + ธง', () => {
  const tg = [{ jig_id: 'a', machine_no: 'JTSRA03-01' }, { jig_id: 'b', machine_no: 'JTSRA03-02' }]
  assert.equal(amTargetsByRun(tg, undefined).mode, 'line')
  assert.equal(amTargetsByRun(tg, undefined).required.length, 2)
  const noMno = amTargetsByRun(tg, { orders: 3, noMno: 3, keys: {} })
  assert.equal(noMno.mode, 'line_no_mno')
  assert.equal(noMno.required.length, 2)
  assert.ok(amModeNote({ amMode: 'line_no_mno' }))
})

test('amTargetsByRun — เครื่องที่ไม่มีใบสแกน = ไม่ต้องตรวจ · มีใบไม่ลงเลขปน (mixed) = ยังต้องตรวจ', () => {
  const tg = [{ jig_id: 'a', machine_no: 'JTSRA03-01' }, { jig_id: 'b', machine_no: 'JTSRA03-02' }, { jig_id: 'x', machine_no: null }]
  const m = amTargetsByRun(tg, { orders: 1, noMno: 0, keys: { [amMachineKeys('JTSRA03-01')[0]]: '2026-11-02T02:00:00Z' } })
  assert.equal(m.mode, 'machine')
  assert.deepEqual(m.required.map(t => t.jig_id).sort(), ['a', 'x'])   // x ไม่รู้เลขเครื่อง ⇒ ห้ามบีบเป็น "ไม่เดิน"
  assert.equal(m.required.find(t => t.jig_id === 'a').startAt, '2026-11-02T02:00:00Z')
  assert.deepEqual(m.notRunning.map(t => t.jig_id), ['b'])
  const mixed = amTargetsByRun(tg, { orders: 2, noMno: 1, keys: { [amMachineKeys('JTSRA03-01')[0]]: null } })
  assert.equal(mixed.mode, 'mixed')
  assert.equal(mixed.notRunning.length, 0)
  assert.ok(mixed.required.find(t => t.jig_id === 'b').byLine)
})

test('computeDailyPmStatus — startAt รายเครื่อง: เครื่องที่เพิ่งเปิดยังอยู่ในกรอบ ไม่ส้ม', () => {
  const tg = [{ jig_id: 'a', startAt: '2026-11-02T03:00:00Z' }]   // เปิด 30 นาทีก่อน
  const r = computeDailyPmStatus({ targets: tg, results: {}, firstOrderAt: '2026-11-02T01:00:00Z', now: NOW })
  assert.equal(r.status, 'pending')
  const r2 = computeDailyPmStatus({ targets: [{ jig_id: 'a' }], results: {}, firstOrderAt: '2026-11-02T01:00:00Z', now: NOW })
  assert.equal(r2.status, 'orange', 'ไม่มี startAt = ใช้เวลาของไลน์ (พฤติกรรมเดิม)')
})

test('dailyAmLineStatus — ไม่ส่ง runByLine = เหมือนเดิม · ส่งแล้วตัดเครื่องที่ไม่เดินออกจากตัวหาร', () => {
  const base = { targets, jigs, resultByJig: { a: { status: 'pass', id: 'i1' } }, firstOrderByLine: { D3: '2026-11-02T01:00:00Z' }, now: NOW }
  const old = dailyAmLineStatus(base).D3
  assert.equal(old.total, 3); assert.equal(old.status, 'orange'); assert.equal(old.amMode, 'line')
  const runByLine = runningMachinesByLine(lines, [{ line_name: 'D3', machine_no: 'JTSRA03-01', at: '2026-11-02T01:00:00Z' }])
  const nw = dailyAmLineStatus({ ...base, runByLine }).D3
  assert.equal(nw.total, 1); assert.equal(nw.checked, 1); assert.equal(nw.status, 'green')
  assert.equal(nw.notRunning.length, 2); assert.equal(nw.registeredN, 3)
})

test('dailyAmLineStatus — ทุกเครื่องไม่เดิน = idle (ไม่ใช่ none/ไม่ใช่ขาดตรวจ)', () => {
  const runByLine = runningMachinesByLine(lines, [{ line_name: 'D3', machine_no: 'OTHER-1', at: '2026-11-02T01:00:00Z' }])
  const r = dailyAmLineStatus({ targets, jigs, firstOrderByLine: { D3: '2026-11-02T01:00:00Z' }, now: NOW, runByLine }).D3
  assert.equal(r.status, 'idle'); assert.ok(r.allNotRunning); assert.equal(r.late, 0)
})

test('B3 amNgFollowState — MO เปิด/ปิด/ตีกลับ · เหตุผล · ไม่มี · อ่านไม่ได้', () => {
  const f = { ok: true, moByInsp: { i1: { id: 'm1', status: 'repairing' }, i2: { id: 'm2', status: 'closed' }, i3: { id: 'm3', status: 'cancelled' } }, waiverByInsp: { i4: { reason: 'แก้หน้างานแล้ว' } } }
  assert.equal(amNgFollowState('i1', f).state, 'mo_open')
  assert.equal(amNgFollowState('i2', f).state, 'mo_closed')
  assert.equal(amNgFollowState('i3', f).state, 'mo_void')
  assert.equal(amNgFollowState('i4', f).state, 'waived')
  assert.equal(amNgFollowState('i5', f).state, 'no_mo')
  assert.equal(amNgFollowState('i1', { ok: false }).state, 'unknown', 'อ่านไม่ได้ ≠ ยังไม่เปิดใบ')
})

test('B3 amCarryOverByJig — MO ค้างจากวันก่อน ติดป้ายจนกว่าจะปิด · ใบกะนี้ไม่นับซ้ำ', () => {
  const shiftStart = '2026-11-02T01:00:00Z'
  const mos = [
    { id: 'm1', status: 'repairing', source_inspection_id: 'old' },
    { id: 'm2', status: 'closed', source_inspection_id: 'old2' },
    { id: 'm3', status: 'pending', source_inspection_id: 'now' },
    { id: 'm4', status: 'pending', source_inspection_id: 'pm-team' },   // ไม่อยู่ใน inspById (ไม่ใช่ทีม AM)
  ]
  const inspById = {
    old: { jig_id: 'a', inspected_at: '2026-10-31T02:00:00Z' },
    old2: { jig_id: 'b', inspected_at: '2026-10-31T02:00:00Z' },
    now: { jig_id: 'c', inspected_at: '2026-11-02T02:00:00Z' },
  }
  const c = amCarryOverByJig(mos, inspById, shiftStart)
  assert.deepEqual(Object.keys(c), ['a'])
  const row = dailyAmLineStatus({ targets, jigs, now: NOW, moFollow: { ok: true, moByInsp: {}, carryByJig: c } }).D3
  assert.equal(row.carry.length, 1); assert.equal(row.carry[0].mo.id, 'm1')
})

test('B3 amWaiverReasonValid — ช่องว่าง/สั้นเกิน ไม่ใช่เหตุผล', () => {
  assert.equal(amWaiverReasonValid(''), false)
  assert.equal(amWaiverReasonValid('   ok '), false)
  assert.equal(amWaiverReasonValid('แจ้งหัวหน้าแล้ว'), true)
})
