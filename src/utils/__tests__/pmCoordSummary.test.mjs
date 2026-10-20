import test from 'node:test'
import assert from 'node:assert/strict'
import { planTaskSummary } from '../pmCoordSummary.js'

const T = '2026-10-20'
test('ช่วงวัน · งานถัดไปที่ยังไม่ติ๊ก · ค้างเลยวัน', () => {
  const s = planTaskSummary([
    { task_date: '2026-10-18', done: false },
    { task_date: '2026-10-19', done: true },
    { task_date: '2026-10-22', done: false, is_support: true },
    { task_date: '2026-10-21', done: false },
  ], T)
  assert.equal(s.from, '2026-10-18'); assert.equal(s.to, '2026-10-22')
  assert.equal(s.next.task_date, '2026-10-21')
  assert.equal(s.overdue, 1); assert.equal(s.doneN, 1); assert.equal(s.total, 4)
})
test('งานวันนี้ยังไม่ติ๊ก = งานถัดไป ไม่ใช่ค้าง', () => {
  const s = planTaskSummary([{ task_date: T, done: false }], T)
  assert.equal(s.overdue, 0); assert.equal(s.next.task_date, T)
})
test('ไม่มีงาน / งานไม่มีวันที่ = ไม่พัง', () => {
  assert.deepEqual(planTaskSummary([], T), { from: null, to: null, next: null, overdue: 0, doneN: 0, total: 0 })
  const s = planTaskSummary([{ task_date: null, done: false }], T)
  assert.equal(s.next, null); assert.equal(s.total, 1)
})
