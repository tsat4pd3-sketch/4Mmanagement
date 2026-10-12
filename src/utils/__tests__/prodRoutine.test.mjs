// เทส prodRoutine — งานประจำกะฝ่ายผลิตบนจอ TV (2026-10-12)
import test from 'node:test'
import assert from 'node:assert/strict'
import { pokayokeByLine, lpaByLine, routineRows, LPA_LAYERS } from '../prodRoutine.js'

const open = new Set(['Line 60', 'ASSEMBLY 1'])

test('Poka-Yoke — นับเฉพาะไลน์ที่เปิดกะ · อุปกรณ์ปิดใช้งานไม่นับ · fail = NG', () => {
  const devices = [
    { id: 1, line_name: 'Line 60', name: 'เซนเซอร์ A', code: 'PY-01' },
    { id: 2, line_name: 'Line 60', name: 'เซนเซอร์ B' },
    { id: 3, line_name: 'Line 60', name: 'ปิดแล้ว', is_active: false },
    { id: 4, line_name: 'LINE A', name: 'ไลน์ไม่เปิดกะ' },
  ]
  const r = pokayokeByLine(devices, [{ device_id: 2, result: 'fail' }], open)
  assert.deepEqual(Object.keys(r), ['Line 60'])
  assert.equal(r['Line 60'].total, 2)
  assert.deepEqual(r['Line 60'].missing, ['PY-01 เซนเซอร์ A'])
  assert.equal(r['Line 60'].ng, 1)
  assert.deepEqual(r['Line 60'].ngNames, ['เซนเซอร์ B'])
})

test('LPA — มีแผนวันนี้แต่ยังไม่มีใบตรวจของชั้นนั้น = ค้าง (กติกา ○/● เดียวกับหน้า /lpa)', () => {
  const plans = [
    { line_name: 'Line 60', lpa_plan_days: [{ day: 12, plan_leader: true, plan_supervisor: true }, { day: 13, plan_leader: true }] },
    { line_name: 'ASSEMBLY 1', lpa_plan_days: [{ day: 11, plan_leader: true }] },
    { line_name: 'LINE A', lpa_plan_days: [{ day: 12, plan_leader: true }] },
  ]
  const r = lpaByLine(plans, [{ line_name: 'Line 60', layer: 'leader' }], 12, open)
  assert.deepEqual(r, { 'Line 60': { planned: ['Leader', 'Supervisor'], missing: ['Supervisor'] } })
  assert.equal(LPA_LAYERS.length, 4)
})

test('routineRows — AM ใช้ late+wait (notStarted ไม่นับ) · ไลน์ไม่มีค้างไม่ขึ้น · NG ขึ้นก่อน', () => {
  const am = {
    'Line 60': { late: 2, wait: 0, notStarted: 0, total: 5, ngN: 0, missing: [{ name: 'SP-1' }, { name: 'SP-2' }], ng: [] },
    'ASSEMBLY 1': { late: 0, wait: 0, notStarted: 3, total: 3, ngN: 1, missing: [], ng: [{ name: 'WD-9' }] },
    'Line 61': { late: 0, wait: 0, notStarted: 4, total: 4, ngN: 0, missing: [], ng: [] },
  }
  const poka = { 'Line 60': { total: 2, done: 1, ng: 0, missing: ['PY-01'], ngNames: [] } }
  const lpa = { 'Line 60': { planned: ['Leader'], missing: ['Leader'] } }
  const { rows, counts } = routineRows({ am, poka, lpa })
  assert.deepEqual(rows.map(r => r.line), ['ASSEMBLY 1', 'Line 60'])
  assert.deepEqual(rows[0].ngNames, ['AM WD-9'])
  assert.deepEqual(rows[1].am, { n: 2, late: 2, total: 5, names: ['SP-1', 'SP-2'] })
  assert.equal(rows[1].poka.n, 1)
  assert.deepEqual(rows[1].lpa.layers, ['Leader'])
  assert.deepEqual(counts, { am: 2, amLate: 2, poka: 1, lpa: 1, ng: 1, lines: 2 })
})

test('routineRows — ไม่มีอะไรค้าง = ว่าง (จอต้องเขียน "ครบ" ไม่ใช่ซ่อนแผง)', () => {
  const { rows, counts } = routineRows({})
  assert.equal(rows.length, 0)
  assert.equal(counts.lines, 0)
})
