import test from 'node:test'
import assert from 'node:assert/strict'
import { filterPlanRows } from '../pmPlanFilter.js'

const rows = [
  { id: 1, line: 'L297', name: 'ROBOT A', st: 'overdue' },
  { id: 2, line: 'l297 ', name: 'Jig B', st: 'ok' },
  { id: 3, line: 'L300', name: 'Press C', st: 'ok' },
  { id: 4, line: '', name: 'Loose D', st: 'never' },
  { id: 5, line: 'OLD-LINE', name: 'Old E', st: 'ok' },
]
const opt = { getLine: r => r.line, getText: r => [r.name, r.line], known: new Set(['l297', 'l300']) }
const ids = (res) => res.rows.map(r => r.id)

test('ไม่กรองอะไร = ครบทุกแถว รวมไลน์ว่าง', () => {
  assert.deepEqual(ids(filterPlanRows(rows, opt)), [1, 2, 3, 4, 5])
})
test('กรองไลน์ — ไม่สนตัวพิมพ์/ช่องว่าง · นับแถวที่ไลน์ว่าง/นอกทะเบียนที่หลุด', () => {
  const res = filterPlanRows(rows, { ...opt, scopeNames: ['L297'] })
  assert.deepEqual(ids(res), [1, 2])
  assert.equal(res.droppedNoLine, 2) // ไลน์ว่าง + OLD-LINE · L300 อยู่ทะเบียน ไม่นับ
})
test('ค้นหา + สถานะ', () => {
  assert.deepEqual(ids(filterPlanRows(rows, { ...opt, q: 'jig' })), [2])
  assert.deepEqual(ids(filterPlanRows(rows, { ...opt, keep: r => r.st === 'ok' })), [2, 3, 5])
})
test('ขอบเขตว่าง = ไม่กรองไลน์', () => {
  assert.equal(filterPlanRows(rows, { ...opt, scopeNames: [] }).rows.length, 5)
})
