import { test } from 'node:test'
import assert from 'node:assert/strict'
import { equipStatusOf, filterEquipRows, groupEquipRowsByLine, lineKnownSet } from '../pmEquipList.js'

const lines = [
  { name: 'LINE APRON ASSY', section: 'PD3', parent_line_name: null },
  { name: 'Line 60', section: 'PD3', parent_line_name: 'LINE APRON ASSY' },
  { name: 'Line 61', section: 'PD3', parent_line_name: 'LINE APRON ASSY' },
  { name: 'Assy GOR', section: 'PD4', parent_line_name: null },
]
const known = lineKnownSet(lines)
const mk = (id, line_name, extra = {}, cp = 3, pins = true) => {
  const jig = { id, name: `JIG ${id}`, jig_no: id, line_name, layout_type: 'image_pin', ...extra }
  return { jig, cpCount: cp, hasPins: pins, status: equipStatusOf({ cpCount: cp }), lineKnown: known.has(String(line_name ?? '').trim().toLowerCase()) }
}
const rows = [
  mk('JHYD05-04', 'Line 60'), mk('JHYD05-03', 'Line 60', {}, 0), mk('JHYD02-01', 'Assy GOR', {}, 2, false),
  mk('X1', 'Airbooster'), mk('X2', null), mk('JHYD06-10', 'line 61 '), mk('JHYD06-9', 'Line 61'),
]

test('สถานะ: ไม่มีจุดตรวจ > ยังไม่ลงทะเบียน AM · ไม่มีธง "ยังไม่ปักหมุด" (layout_type ไม่ได้เก็บลงฐาน)', () => {
  assert.equal(equipStatusOf({ cpCount: 0, amPending: true }), 'no_cp')
  assert.equal(equipStatusOf({ cpCount: 2, amPending: true }), 'am_pending')
  assert.equal(equipStatusOf({ cpCount: 2, hasPins: false }), null)
})

test('กรองไลน์ = รวมไลน์ลูก (ส่ง names จาก scope) · ตัวนอกทะเบียนหลุดแล้วต้องนับ', () => {
  const { rows: r, droppedNoLine } = filterEquipRows(rows, { scopeNames: ['LINE APRON ASSY', 'Line 60', 'Line 61'] })
  assert.deepEqual(r.map(x => x.jig.id).sort(), ['JHYD05-03', 'JHYD05-04', 'JHYD06-10', 'JHYD06-9'])
  assert.equal(droppedNoLine, 2)
})

test('ค้นหา: ชื่อ/No./ไลน์ ไม่สนตัวพิมพ์', () => {
  assert.deepEqual(filterEquipRows(rows, { q: 'gor' }).rows.map(x => x.jig.id), ['JHYD02-01'])
  assert.deepEqual(filterEquipRows(rows, { q: 'jhyd05' }).rows.length, 2)
})

test('สถานะ no_line / ready / no_cp', () => {
  assert.deepEqual(filterEquipRows(rows, { status: 'no_line' }).rows.map(x => x.jig.id), ['X1', 'X2'])
  assert.deepEqual(filterEquipRows(rows, { status: 'no_cp' }).rows.map(x => x.jig.id), ['JHYD05-03'])
  assert.equal(filterEquipRows(rows, { status: 'ready' }).rows.every(x => !x.status), true)
  // no_line ต้องไม่ถูกตัวกรองไลน์ทิ้ง (ไม่งั้นเลือกไลน์อยู่แล้วเปิดดูตัวหลุดไม่ได้เลย)
  assert.equal(filterEquipRows(rows, { status: 'no_line', scopeNames: ['Line 60'] }).rows.length, 2)
})

test('จัดกลุ่ม: ลำดับทะเบียน · นอกทะเบียนต่อท้าย · ไม่ระบุไลน์ท้ายสุด · ไม่มีตัวไหนหาย', () => {
  const g = groupEquipRowsByLine(rows, lines)
  assert.deepEqual(g.map(x => x.label), ['Line 60', 'Line 61', 'Assy GOR', 'Airbooster', '(ไม่ระบุไลน์)'])
  assert.equal(g.reduce((s, x) => s + x.rows.length, 0), rows.length)
  assert.equal(g.find(x => x.label === 'Line 61').rows.length, 2)   // 'line 61 ' ยุบเข้าชื่อทะเบียน
  assert.deepEqual(g.find(x => x.label === 'Line 61').rows.map(r => r.jig.id), ['JHYD06-9', 'JHYD06-10'])
  assert.equal(g.find(x => x.label === 'Airbooster').known, false)
})
