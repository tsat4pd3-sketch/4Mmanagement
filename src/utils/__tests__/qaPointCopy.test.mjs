import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qaItemCopyRow, qaCopyPath, QA_PIN_FIELDS } from '../qaPointCopy.js'

const src = {
  id: 'it1', created_at: 't', part_id: 'P61', balloon_no: '12', item_type: 'variable',
  characteristic: 'ระยะรู', nominal: 10, lsl: 9.9, usl: 10.1, rank: 'SC', stage: 'inprocess',
  pos_x: 40, pos_y: 60, label_dx: 0.1, label_dy: -0.1, drawing_id: 'dA', image_path: 'parts/P61/cp-1.jpg',
}

test('ไม่คัดลอกแผ่นแบบ: ล้างหมุดทั้งชุด · part_id = ปลายทาง · ตัด id/created_at · คงสเปค', () => {
  const r = qaItemCopyRow(src, { targetPartId: 'P60' })
  for (const k of QA_PIN_FIELDS) assert.equal(r[k], null, k)
  assert.equal(r.part_id, 'P60')
  assert.equal('id' in r, false); assert.equal('created_at' in r, false)
  assert.equal(r.balloon_no, '12'); assert.equal(r.usl, 10.1); assert.equal(r.rank, 'SC')
})

test('คัดลอกแผ่นแบบไปด้วย: เก็บหมุด + drawing_id ชี้แผ่นใหม่', () => {
  const r = qaItemCopyRow(src, { targetPartId: 'P60', drawingMap: { dA: 'dA2' } })
  assert.equal(r.drawing_id, 'dA2'); assert.equal(r.pos_x, 40); assert.equal(r.label_dy, -0.1)
})

test('drawing_id ว่าง (= แผ่นแรก) + คัดลอกแผ่น: คงหมุด · drawing_id ยังว่าง', () => {
  const r = qaItemCopyRow({ ...src, drawing_id: null }, { targetPartId: 'P60', drawingMap: { dA: 'dA2' } })
  assert.equal(r.drawing_id, null); assert.equal(r.pos_x, 40)
})

test('แผ่นต้นทางไม่อยู่ในชุดที่คัดลอก: ล้างหมุด (ห้ามชี้แผ่นของพาร์ทอื่น)', () => {
  const r = qaItemCopyRow(src, { targetPartId: 'P60', drawingMap: { dB: 'x' } })
  for (const k of QA_PIN_FIELDS) assert.equal(r[k], null, k)
})

test('รูปโคลสอัพ: ห้ามแชร์ path ต้นทาง — ใช้ path ใหม่ที่ส่งมา หรือว่าง', () => {
  assert.equal(qaItemCopyRow(src, { targetPartId: 'P60' }).image_path, null)
  assert.equal(qaItemCopyRow(src, { targetPartId: 'P60', imagePath: 'parts/P60/cx-cp-1.jpg' }).image_path, 'parts/P60/cx-cp-1.jpg')
})

test('qaCopyPath: ไปโฟลเดอร์ปลายทาง คงชื่อไฟล์ · ไม่มีต้นทาง = null', () => {
  assert.equal(qaCopyPath('parts/P61/cp-1.jpg', 'P60', 'k1'), 'parts/P60/ck1-cp-1.jpg')
  assert.equal(qaCopyPath(null, 'P60', 'k1'), null)
})
