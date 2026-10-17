// เทส lineLens — แท็บบนผังรวม = เลนส์มองไลน์ (2026-10-16)
import test from 'node:test'
import assert from 'node:assert/strict'
import { storySectionsFor, mapLensOf, markerFor, dtByMachine, dtWithoutMachine, STORY_SECTIONS, NO_DATA_COLOR, DT_COLOR, stationMarker } from '../lineLens.js'

const META = {
  overdue: { label: 'เกินกำหนด', color: '#e05c4a', order: 0 },
  due_soon: { label: 'ใกล้ครบกำหนด', color: '#f59a3f', order: 1 },
  ok: { label: 'ตามกำหนด', color: '#3dd65c', order: 3 },
}

test('health = ทุกหัวข้อ · PM ไม่มีเรื่องคน · ไม่รู้จัก = ทุกหัวข้อ', () => {
  assert.equal(storySectionsFor('health').size, STORY_SECTIONS.length)
  assert.equal(storySectionsFor('xxx').size, STORY_SECTIONS.length)
  const pm = storySectionsFor('pm')
  assert.ok(pm.has('pm') && pm.has('mo'))
  assert.ok(!pm.has('people') && !pm.has('parts'))
  assert.ok(storySectionsFor('breakdown').has('dt'))
})

test('ผังเครื่องคู่เฉพาะแท็บที่ผูกกับตัวเครื่อง', () => {
  assert.equal(mapLensOf('pm'), 'pm')
  assert.equal(mapLensOf('breakdown'), 'breakdown')
  assert.equal(mapLensOf('health'), 'health')
  assert.equal(mapLensOf('energy'), null)
  assert.equal(mapLensOf('people'), 'people')
  assert.equal(mapLensOf('productivity'), 'productivity')
  assert.equal(mapLensOf('oee'), null)
})

test('หมุด PM = สถานะ PM ไม่ใช่ breakdown · AM แยกจากช่าง · ไม่มีแผน = เทา', () => {
  const cls = [{ am: false, status: 'ok' }, { am: false, status: 'due_soon' }, { am: true, status: 'overdue' }]
  const pm = markerFor('pm', { checklists: cls, dt: { mins: 30, open: true }, statusMeta: META })
  assert.equal(pm.state, 'due_soon')          // เครื่องหยุดอยู่ไม่ทับสี PM · AM เกินไม่ทับช่าง
  assert.equal(pm.color, META.due_soon.color)
  assert.equal(markerFor('am', { checklists: cls, statusMeta: META }).state, 'overdue')
  const none = markerFor('pm', { checklists: [], statusMeta: META })
  assert.equal(none.color, NO_DATA_COLOR)
  assert.equal(none.state, 'no_plan')
})

test('หมุด Downtime + health เรียงความด่วน', () => {
  assert.equal(markerFor('breakdown', { dt: { mins: 26, open: true } }).color, DT_COLOR.open)
  assert.equal(markerFor('breakdown', { dt: { mins: 26, open: false } }).state, 'had')
  assert.equal(markerFor('breakdown', {}).state, 'none')
  const od = [{ am: false, status: 'overdue' }]
  assert.equal(markerFor('health', { checklists: od, dt: { mins: 5, open: true }, statusMeta: META }).state, 'open')
  assert.equal(markerFor('health', { checklists: od, dt: { mins: 5, open: false }, statusMeta: META }).state, 'overdue')
  assert.equal(markerFor('health', { checklists: [{ am: false, status: 'ok' }], statusMeta: META }).state, 'ok')
})

test('dtByMachine ยุบรูปแบบเลขเครื่อง · ไม่มีเลขเครื่อง = นับแยก', () => {
  const rows = [{ machine: 'HDF-01', mins: 26 }, { machine: 'hdf01', mins: 21, open: true }, { machine: null, mins: 9 }]
  const m = dtByMachine(rows)
  assert.equal(m.size, 1)
  const g = [...m.values()][0]
  assert.equal(g.mins, 47); assert.equal(g.open, true); assert.equal(g.count, 2)
  assert.equal(dtWithoutMachine(rows), 1)
})

test('จุดงาน: ไม่มีคนประจำ / ยังไม่เช็คชื่อ ≠ ขาด · ไม่ตั้งทักษะ ≠ ผ่าน · ตัดสินจากคนที่อ่อนสุด', () => {
  assert.equal(stationMarker([]).state, 'no_one')
  assert.equal(stationMarker([{ is_present: null }]).state, 'not_checked')
  assert.equal(stationMarker([{ is_present: false }, { is_present: null }]).state, 'empty')
  assert.equal(stationMarker([{ is_present: true, fit: null }]).state, 'no_req')
  assert.equal(stationMarker([{ is_present: true, fit: { score: 100 } }]).state, 'fit')
  assert.equal(stationMarker([{ is_present: true, fit: { score: 100 } }, { is_present: true, fit: { score: 40 } }]).state, 'low')
  assert.equal(stationMarker([{ is_present: true, fit: { score: 67 } }, { is_present: false, fit: { score: 0 } }]).state, 'partial')
})
