// เทสรวมยอดภาพใหญ่ — งานคู่ RH/LH = 1 stroke · OP ยุบเข้าพาร์ทจริง
// กันกับดักที่เคยพัง: pairAwareTotal คืน { target, produced } เท่านั้น (อ่าน .actual = undefined → NaN เงียบ)
import test from 'node:test'
import assert from 'node:assert/strict'
import { pairAwareTotal, collapseOps, orderTotal } from '../pairTotals.js'

const pairOf = (m) => ({ LH: 'RH', RH: 'LH' }[m] || null)

test('คู่ครบ 2 ข้าง = max ไม่ใช่บวก · เดี่ยวบวกปกติ', () => {
  const r = pairAwareTotal([
    { mat_no: 'LH', target: 100, produced: 90 },
    { mat_no: 'RH', target: 100, produced: 95 },
    { mat_no: 'X', target: 50, produced: 50 },
  ], pairOf)
  assert.deepEqual({ t: r.target, p: r.produced, h: r.hasPair }, { t: 150, p: 145, h: true })
})

test('ตั้ง pair ไว้แต่คู่ไม่อยู่ในชุด = บวกปกติ (ไม่หายครึ่ง)', () => {
  const r = pairAwareTotal([{ mat_no: 'LH', target: 100, produced: 90 }], pairOf)
  assert.equal(r.target, 100)
  assert.equal(r.hasPair, false)
})

test('pairAwareTotal ไม่มีฟิลด์ actual — จุดที่เคยอ่านผิดแล้วได้ NaN เงียบ', () => {
  const r = pairAwareTotal([{ mat_no: 'X', target: 10, produced: 8 }], () => null)
  assert.equal(r.actual, undefined)
})

test('collapseOps: พาร์ทจริงอยู่ในชุด → ขั้น OP ถูกตัดทิ้ง ไม่นับซ้ำ', () => {
  const opMap = { M6: { parent: 'P1' }, M8: { parent: 'P1' } }
  const rows = collapseOps([
    { mat_no: 'P1', target: 500, produced: 480 },
    { mat_no: 'M6', target: 500, produced: 500 },
    { mat_no: 'M8', target: 500, produced: 490 },
  ], opMap)
  assert.deepEqual(rows, [{ mat_no: 'P1', target: 500, produced: 480 }])
})

test('collapseOps: พาร์ทจริงไม่อยู่ → ยุบพี่น้อง OP เหลือแถวเดียวใช้ max', () => {
  const opMap = { M6: { parent: 'P1' }, M8: { parent: 'P1' } }
  const rows = collapseOps([
    { mat_no: 'M6', target: 500, produced: 500 },
    { mat_no: 'M8', target: 500, produced: 490 },
  ], opMap)
  // `_ops` = ร่องรอยชั้น OP ที่ยุบมา — จำเป็นให้คู่ RH/LH ที่ประกาศไว้ที่ชั้น OP รอดจากการยุบ
  assert.deepEqual(rows, [{ mat_no: 'P1', target: 500, produced: 500, _ops: ['M6', 'M8'] }])
})

test('collapseOps: OP ที่ parent = null คงนับเดิม (worklist ห้ามเดา) · opMap ว่าง = คืน input', () => {
  const rows = [{ mat_no: 'M10', target: 30, produced: 30 }]
  assert.deepEqual(collapseOps(rows, { M10: { parent: null } }), rows)
  assert.equal(collapseOps(rows, {}), rows)
})

test('orderTotal: pair + op + ใบ mat null รวมถูกในตัวเดียว', () => {
  const opMap = { M6: { parent: 'LH' } }
  const orders = [
    { mat_no: 'LH', qty: 100 }, { mat_no: 'RH', qty: 95 },
    { mat_no: 'M6', qty: 100 },              // OP ของ LH ซึ่งอยู่ในชุด → ตัดทิ้ง
    { mat_no: null, qty: 7 },
  ]
  assert.equal(orderTotal(orders, o => o.qty, pairOf, opMap), 100 + 7)
})
