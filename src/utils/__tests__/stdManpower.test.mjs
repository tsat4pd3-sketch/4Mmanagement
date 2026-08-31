// เทสกำลังคนมาตรฐาน — 3 convention จริงในตาราง (ก็อปทับ / แม่≠ผลรวมลูก / แม่อย่างเดียว)
// กันบั๊กเดิม: บวกแม่+ลูกซ้ำ (67 คน กลายเป็น 81) · ลูกคนเดียวลงผิดไลน์ = ตัวหารทั้งโรงงานเพี้ยน
import test from 'node:test'
import assert from 'node:assert/strict'
import { stdCapacityOf, stdGroupOf, stdInheritedOf, hasNightShift } from '../stdManpower.js'

// จำลอง 3 convention จริง (คอมเมนต์หัวไฟล์ stdManpower.js)
const LINES = [
  { name: 'HYDROFORM', parent_line_name: null, std_day_shift: 14, std_night_shift: 14 },
  { name: 'HDF1', parent_line_name: 'HYDROFORM', std_day_shift: 14, std_night_shift: 14 }, // ก็อปทับจากแม่
  { name: 'HDF2', parent_line_name: 'HYDROFORM', std_day_shift: 14, std_night_shift: 14 },
  { name: 'GOR', parent_line_name: null, std_day_shift: 11, std_night_shift: 11 },
  { name: 'Assy GOR', parent_line_name: 'GOR', std_day_shift: 0, std_night_shift: 0 },     // แม่อย่างเดียว
  { name: 'APRON', parent_line_name: null, std_day_shift: 0, std_night_shift: 0 },
  { name: 'Line 60', parent_line_name: 'APRON', std_day_shift: 6, std_night_shift: 0 },    // ลูกตั้งเอง
  { name: 'Line 61', parent_line_name: 'APRON', std_day_shift: 7, std_night_shift: 0 },
]

test('แม่ตั้งแล้ว → ลูกนับ 0 (กันบวกซ้ำ) · ผลรวมทั้งลิสต์ไม่นับซ้ำ', () => {
  assert.equal(stdCapacityOf(LINES, 'HYDROFORM', 'day'), 14)
  assert.equal(stdCapacityOf(LINES, 'HDF1', 'day'), 0)
  const total = LINES.reduce((s, l) => s + stdCapacityOf(LINES, l.name, 'day'), 0)
  assert.equal(total, 14 + 11 + (6 + 7))   // = 38 ไม่ใช่ 14×3 + 11 + 13
})

test('แม่ไม่ได้ตั้ง → แม่ rollup จากลูก · ลูกที่แม่อยู่ในลิสต์ = 0 เสมอ (กันนับซ้ำ)', () => {
  assert.equal(stdCapacityOf(LINES, 'APRON', 'day'), 13)
  assert.equal(stdCapacityOf(LINES, 'Line 60', 'day'), 0)   // แม่ถือยอดกลุ่มแทน
  // invariant: Σ ทั้งครอบครัว = stdGroupOf ของราก
  const fam = ['APRON', 'Line 60', 'Line 61']
  assert.equal(fam.reduce((s, n) => s + stdCapacityOf(LINES, n, 'day'), 0), stdGroupOf(LINES, 'APRON', 'day'))
})

test('แม่โดน scope ตัด (ไม่อยู่ในลิสต์) → ลูกนับตัวเอง ไม่หายเงียบ', () => {
  const cut = LINES.filter(l => l.name !== 'APRON')
  assert.equal(stdCapacityOf(cut, 'Line 60', 'day'), 6)
})

test('stdGroupOf ตอบ "กลุ่มนี้ทั้งกลุ่มกี่คน" เท่ากันไม่ว่าถามที่แม่หรือรูปแบบไหน', () => {
  assert.equal(stdGroupOf(LINES, 'HYDROFORM', 'day'), 14)
  assert.equal(stdGroupOf(LINES, 'GOR', 'day'), 11)
  assert.equal(stdGroupOf(LINES, 'APRON', 'day'), 13)
})

test('คุณสมบัติกะดึกตกทอดจากแม่ (ห้ามใช้รวมยอด)', () => {
  assert.equal(stdInheritedOf(LINES, 'Assy GOR', 'night'), 11)  // ลูก 0 → ตกทอดจากแม่
  assert.equal(hasNightShift(LINES, 'Assy GOR'), true)
  assert.equal(hasNightShift(LINES, 'Line 60'), false)          // ทั้งสายไม่มีกะดึก
})

test('ไลน์ไม่อยู่ในลิสต์/ลิสต์ว่าง → 0 ไม่ throw', () => {
  assert.equal(stdCapacityOf(LINES, 'ไม่มีจริง', 'day'), 0)
  assert.equal(stdCapacityOf([], 'HDF1', 'day'), 0)
})
