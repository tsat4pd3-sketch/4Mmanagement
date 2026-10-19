// เทส tvPager — จอ TV ห้าม scroll: ตัดหน้าตามขอบชิ้นงาน (2026-10-19)
import test from 'node:test'
import assert from 'node:assert/strict'
import { tvPages } from '../tvPager.js'

test('พอดีจอ = หน้าเดียว · หน้าแรกเริ่ม 0 เสมอ (หัวบอร์ดก่อนชิ้นแรกต้องเห็น)', () => {
  const p = tvPages([{ top: 80, bottom: 300 }, { top: 310, bottom: 500 }], 600)
  assert.equal(p.length, 1)
  assert.equal(p[0].start, 0)
  assert.deepEqual(p[0].items, [0, 1])
})

test('ยาวเกินจอ = ตัดที่ขอบชิ้น ไม่ตัดกลางบอร์ด · หน้าถัดไปเริ่มที่หัวชิ้นแรกที่ยังไม่โชว์', () => {
  const items = [{ top: 50, bottom: 350 }, { top: 360, bottom: 700 }, { top: 710, bottom: 900 }]
  const p = tvPages(items, 600)
  assert.deepEqual(p.map(x => x.items), [[0], [1, 2]])
  assert.equal(p[1].start, 360)
  assert.ok(p.every(x => !x.parts))
})

test('การ์ดในกริดแถวเดียวกัน (top เท่ากัน) ไปหน้าเดียวกัน', () => {
  const items = [0, 1, 2].map(() => ({ top: 0, bottom: 200 })).concat([3, 4].map(() => ({ top: 210, bottom: 410 })))
  const p = tvPages(items, 300)
  assert.deepEqual(p.map(x => x.items.sort()), [[0, 1, 2], [3, 4]])
})

test('ชิ้นเดียวสูงเกินจอ = เลื่อนต่อในชิ้นเดิมจนเห็นครบ (ห้ามซ่อนท้ายถาวร) · ไม่วนไม่จบ', () => {
  const p = tvPages([{ top: 0, bottom: 100 }, { top: 120, bottom: 1300 }, { top: 1310, bottom: 1400 }], 500)
  assert.deepEqual(p.map(x => x.items), [[0], [1], [1], [1], [2]])
  const tall = p.filter(x => x.parts)
  assert.deepEqual(tall.map(x => `${x.part}/${x.parts}`), ['1/3', '2/3', '3/3'])
  assert.equal(tall[0].start, 120)
  assert.equal(tall[2].start + 500, 1300)              // หน้าสุดท้ายจบพอดีท้ายชิ้น
  for (let k = 1; k < tall.length; k++) assert.ok(tall[k].start - tall[k - 1].start <= 500 - 48)  // ซ้อนกันอ่านต่อได้
})

test('ไม่มีชิ้น / ไม่รู้ความสูงจอ = หน้าเดียว', () => {
  assert.equal(tvPages([], 500).length, 1)
  assert.equal(tvPages([{ top: 0, bottom: 9999 }], 0).length, 1)
})
