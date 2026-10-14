import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkpointCopyRow, PIN_FIELDS } from '../pmCheckpointCopy.js'

const src = {
  id: 'cp1', created_at: 't', updated_at: 't', updated_by_name: 'x', updated_by_uid: 'u', checklist_id: 'clA',
  jig_id: 'machineA', name: 'พัดลม', type: 'okng', sort_order: 3, image_path: 'jigs/A/cp1.jpg',
  x_pos: 0.4, y_pos: 0.6, label_dx: 0.1, label_dy: -0.1, image_id: 'frameOfA',
}

test('ข้ามเครื่อง: ล้างหมุดทั้งชุด · jig_id = เครื่องปลายทาง · ตัด id/audit', () => {
  const r = checkpointCopyRow(src, { targetChecklistId: 'clB', targetEquipmentId: 'machineB' })
  for (const k of PIN_FIELDS) assert.equal(r[k], null, k)
  assert.equal(r.jig_id, 'machineB')
  assert.equal(r.checklist_id, 'clB')
  for (const k of ['id', 'created_at', 'updated_at', 'updated_by_name', 'updated_by_uid']) assert.equal(k in r, false, k)
  assert.equal(r.name, 'พัดลม'); assert.equal(r.image_path, 'jigs/A/cp1.jpg'); assert.equal(r.sort_order, 3)
})

test('ข้ามแผนกบนเครื่องเดิม (รูปชุดเดียวกัน): เก็บหมุดไว้', () => {
  const r = checkpointCopyRow(src, { targetChecklistId: 'clA2', targetEquipmentId: 'machineA', samePhotos: true })
  assert.equal(r.x_pos, 0.4); assert.equal(r.image_id, 'frameOfA'); assert.equal(r.label_dx, 0.1)
})

test('ต้นทางไม่ส่ง = ไม่โยน error', () => {
  assert.deepEqual(checkpointCopyRow(null, { targetChecklistId: 'c' }), { checklist_id: 'c' })
})
