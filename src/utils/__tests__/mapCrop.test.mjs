// เทส cropBox — ครอปผังเฉพาะโซนที่มีหมุด (2026-10-16)
import test from 'node:test'
import assert from 'node:assert/strict'
import { cropBox, CROP_PAD, CROP_MIN_SPAN } from '../mapCrop.js'

test('ไม่มีหมุด / พิกัดพัง = ทั้งรูป', () => {
  assert.deepEqual(cropBox([]), { x0: 0, y0: 0, x1: 100, y1: 100 })
  assert.deepEqual(cropBox([{ pos_top: null, pos_left: 'x' }]), { x0: 0, y0: 0, x1: 100, y1: 100 })
})

test('กรอบครอบหมุดทุกตัว + ขอบ · อ่านค่า "42.1%" ได้', () => {
  const b = cropBox([{ pos_top: '40%', pos_left: '30%' }, { pos_top: '60%', pos_left: '70%' }])
  assert.equal(b.x0, 30 - CROP_PAD); assert.equal(b.x1, 70 + CROP_PAD)
  assert.equal(b.y0, 40 - CROP_PAD); assert.equal(b.y1, 60 + CROP_PAD)
})

test('หมุดตัวเดียว = ไม่ซูมแคบกว่า MIN_SPAN · ชิดขอบ = เลื่อนกลับเข้ารูป ไม่หลุด 0..100', () => {
  const one = cropBox([{ pos_top: '50', pos_left: '50' }])
  assert.equal(one.x1 - one.x0, CROP_MIN_SPAN)
  const edge = cropBox([{ pos_top: '2', pos_left: '98' }])
  assert.ok(edge.x0 >= 0 && edge.x1 <= 100 && edge.y0 >= 0 && edge.y1 <= 100)
  assert.equal(edge.x1, 100)
  assert.ok(edge.x1 - edge.x0 >= CROP_MIN_SPAN - 1e-9)
})
