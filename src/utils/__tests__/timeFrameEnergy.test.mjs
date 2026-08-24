// เทส timeFrame (T2-12) + energy (T2-13) — กับดัก "ข้อความ/null กลายเป็นตัวเลขเงียบ"
import test from 'node:test'
import assert from 'node:assert/strict'
import { frameMin, breaksToFrame } from '../timeFrame.js'
import { deltaPct, bahtPerUnit, energyCat } from '../energy.js'

/* ── timeFrame ── */
test('frameMin: ก่อน 08:00 = ช่วงดึกของวันงาน (+1440)', () => {
  assert.equal(frameMin('08:00'), 480)
  assert.equal(frameMin('07:59'), 479 + 1440)
  assert.equal(frameMin(''), null)
})

test('T2-12: duration_min เป็นข้อความ ต้องบวกเลข ไม่ใช่ต่อสตริง ("72045" = แถบพัก ~50 วัน)', () => {
  const [b] = breaksToFrame([{ start_time: '12:00:00', duration_min: '45', name_th: 'พักเที่ยง' }])
  assert.equal(b.s, 720)
  assert.equal(b.e, 765)          // เดิมได้ "72045"
  assert.equal(typeof b.e, 'number')
})

test('policy เวลาเริ่มเสีย = ถูกกรองทิ้ง ไม่พังทั้งลิสต์', () => {
  const rows = breaksToFrame([{ start_time: null, duration_min: 30 }, { start_time: '10:00', duration_min: 10 }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].s, 600)
})

/* ── energy ── */
test('T2-13: deltaPct(null, base) = null ไม่ใช่ −100 (Number(null)===0 finite!)', () => {
  assert.equal(deltaPct(null, 5000), null)
  assert.equal(deltaPct('', 5000), null)
  assert.equal(deltaPct(4000, null), null)
  assert.equal(deltaPct(5500, 5000), 10)
})

test('T2-13: bahtPerUnit(null, qty) = null ไม่ใช่ 0 (เคยขึ้น "0 ⚠" บนแถวที่แค่ยังกรอกไม่ครบ)', () => {
  assert.equal(bahtPerUnit(null, 1000), null)
  assert.equal(bahtPerUnit('', 1000), null)
  assert.equal(bahtPerUnit(4200, 0), null)
  assert.equal(bahtPerUnit(4200, 1000), 4.2)
})

test('energyCat: ไม่มีฐานเทียบ = idle (เทา) ไม่ใช่เขียว', () => {
  assert.equal(energyCat(null), 'idle')
  assert.equal(energyCat(-6), 'good')
  assert.equal(energyCat(11), 'bad')
})
