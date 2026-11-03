// 🖼️ imageFit — วางรูปลงกรอบแบบคงสัดส่วน + หมุดต่อเฟรม (A7 · ประชุม 02/11 · 2026-11-03)
import test from 'node:test'
import assert from 'node:assert/strict'
import { fitContain, imageSizeFromBytes, pinsOnFrame } from '../imageFit.js'

test('fitContain — รูปแนวตั้งในกรอบแนวนอน: สูงเต็ม กว้างตามสัดส่วน จัดกึ่งกลาง (ไม่ยืด = บั๊ก A7)', () => {
  const f = fitContain(300, 400, 36, 13.4)
  assert.ok(Math.abs(f.h - 13.4) < 1e-9)
  assert.ok(Math.abs(f.w / f.h - 0.75) < 1e-9, 'สัดส่วนต้องคง 3:4')
  assert.ok(Math.abs(f.dx - (36 - f.w) / 2) < 1e-9)
  assert.equal(f.dy, 0)
})

test('fitContain — รูปกว้างในกรอบ: กว้างเต็ม สูงลดตามสัดส่วน', () => {
  const f = fitContain(1600, 400, 130, 52)
  assert.equal(f.w, 130)
  assert.equal(f.h, 32.5)
  assert.equal(f.dx, 0)
  assert.equal(f.dy, 9.75)
})

test('fitContain — upscale:false ไม่ขยายรูปเล็กเกินขนาดจริง', () => {
  assert.deepEqual(fitContain(20, 10, 100, 100, { upscale: false }), { w: 20, h: 10, dx: 40, dy: 45 })
  assert.equal(fitContain(20, 10, 100, 100).w, 100)
})

test('fitContain — ขนาดอ่านไม่ออก = null (ห้ามเดาเป็นเต็มกรอบ)', () => {
  assert.equal(fitContain(0, 10, 10, 10), null)
  assert.equal(fitContain(undefined, undefined, 10, 10), null)
  assert.equal(fitContain(10, 10, 0, 10), null)
})

test('imageSizeFromBytes — PNG อ่านจาก IHDR', () => {
  const b = new Uint8Array(32)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  b.set([0, 0, 0x01, 0xe0], 16)   // 480
  b.set([0, 0, 0x02, 0x80], 20)   // 640
  assert.deepEqual(imageSizeFromBytes(b), { width: 480, height: 640, kind: 'png' })
})

test('imageSizeFromBytes — JPEG ข้าม APP0 แล้วอ่าน SOF0', () => {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]          // length 16 รวม 2 ไบต์ของตัวเอง
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, ...Array(9).fill(0)]  // h=480 w=640
  const b = new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9])
  assert.deepEqual(imageSizeFromBytes(b), { width: 640, height: 480, kind: 'jpeg' })
})

test('imageSizeFromBytes — ไม่ใช่รูป/สั้นเกิน = null', () => {
  assert.equal(imageSizeFromBytes(null), null)
  assert.equal(imageSizeFromBytes(new Uint8Array(10)), null)
  assert.equal(imageSizeFromBytes(new Uint8Array(40).fill(7)), null)
})

test('pinsOnFrame — image_id ว่าง = เฟรมแรก · หมุดรูปมุมอื่นนับแยก (ใบพิมพ์ต้องเขียนบอก)', () => {
  const cps = [
    { id: 'a', x_pos: 0.1, y_pos: 0.2, image_id: null },
    { id: 'b', x_pos: 0.5, y_pos: 0.5, image_id: 'f1' },
    { id: 'c', x_pos: 0.5, y_pos: 0.5, image_id: 'f2' },
    { id: 'd', x_pos: null, y_pos: null },
  ]
  const r = pinsOnFrame(cps, 'f1', 'f1')
  assert.deepEqual(r.on.map(c => c.id), ['a', 'b'])
  assert.equal(r.offFrame, 1)
  // ไม่มีเฟรม (legacy) — หมุดที่ผูก image_id ของเฟรมที่ไม่มีแล้ว = นอกรูปนี้
  const l = pinsOnFrame(cps, 'legacy', 'legacy')
  assert.deepEqual(l.on.map(c => c.id), ['a'])
  assert.equal(l.offFrame, 2)
})
