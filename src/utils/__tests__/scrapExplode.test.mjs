// เทสระเบิดของเสียชั้น OP → เลข SAP จริง (ใบ FM-PD2-002 ต้องพิมพ์เลขที่สโตร์ตัดได้)
// เคสจริงที่ใช้ตั้งเทส: สาย WSS-M1A367-A36 (HYDROFORM seq 10 → LASER-345 seq 20 · parent 10100385)
import test from 'node:test'
import assert from 'node:assert/strict'
import { opChain, explodeScrapRow, scanScrapItems, opInfoOf } from '../scrapExplode.js'

const OP_ROWS = [
  { mat_no: '90031601', name: 'WSS-M1A367-A36 RH', op_parent_mat: '10100385', op_seq: 10, is_active: true },
  { mat_no: '90031603', name: 'ตัดเลเซอร์ RH',     op_parent_mat: '10100385', op_seq: 20, is_active: true },
  { mat_no: '90031602', name: 'WSS-M1A367-A36 LH', op_parent_mat: '10100401', op_seq: 10, is_active: true },
  { mat_no: 'M8 เก่า',   name: 'ขั้นที่เลิกใช้',    op_parent_mat: '10100385', op_seq: 5,  is_active: false },
  { mat_no: 'FENDER',   name: '291+088',           op_parent_mat: '30052451', op_seq: null, is_active: true },
]
const OP_MAP = Object.fromEntries(OP_ROWS.map(o => [o.mat_no, { parent: o.op_parent_mat, seq: o.op_seq }]))
const COIL = { mat_no: '50031601', part_no: 'MB3B-16C274-CC', part_name: 'WSS-M1A367-A36 50G50G', qty_per_unit: 1, uom: 'pcs' }
const BOM = {
  '90031601': [COIL],
  'FENDER': [
    { mat_no: '30052451', part_name: 'FENDER SUPPORT UPR RH', qty_per_unit: 1, uom: 'EA' },
    { mat_no: '30042571', part_name: 'NUT WELD M6', qty_per_unit: 5, uom: 'PC' },
  ],
}
const CTX = { opMap: OP_MAP, opRows: OP_ROWS, bomOf: (m) => BOM[m] || [] }

test('พาร์ทจริง (ไม่ใช่ OP) = not_op ไม่แตะแถวนั้น', () => {
  const r = explodeScrapRow({ mat_no: '10100385', qty: 3 }, CTX)
  assert.equal(r.status, 'not_op')
  assert.deepEqual(r.lines, [])
})

test('OP ขั้นแรก → ได้วัตถุดิบตามสูตรของขั้น × จำนวนของเสีย', () => {
  const r = explodeScrapRow({ mat_no: '90031601', qty: 5 }, CTX)
  assert.equal(r.status, 'ok')
  assert.equal(r.lines.length, 1)
  assert.equal(r.lines[0].mat_no, '50031601')
  assert.equal(r.lines[0].qty, 5)
})

test('🔑 OP ขั้นหลังที่ไม่มีสูตรของตัวเอง → ไล่ขั้นก่อนหน้าในสายเดียวกันให้เอง (ไม่ต้องคีย์ซ้ำ)', () => {
  const r = explodeScrapRow({ mat_no: '90031603', qty: 2 }, CTX)
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.lines.map(l => [l.mat_no, l.qty]), [['50031601', 2]])
  assert.equal(r.lines[0].from[0].mat, '90031601')   // บอกได้ว่ามาจากขั้นไหน
})

test('ขั้นที่ปิดใช้งานแล้ว ไม่ถูกนับเข้าสาย', () => {
  assert.deepEqual(opChain('90031603', OP_ROWS).map(o => o.mat_no), ['90031601', '90031603'])
})

test('op_seq ว่าง = ขั้นเดี่ยว ใช้สูตรตัวเองอย่างเดียว (ห้ามเดาสาย)', () => {
  assert.deepEqual(opChain('FENDER', OP_ROWS).map(o => o.mat_no), ['FENDER'])
  const r = explodeScrapRow({ mat_no: 'FENDER', qty: 2 }, CTX)
  assert.deepEqual(r.lines.map(l => [l.mat_no, l.qty]), [['30052451', 2], ['30042571', 10]])
})

test('ไม่มีสูตรทั้งสาย = no_bom (ห้าม fallback ไปตัดพาร์ทแม่เอง)', () => {
  const r = explodeScrapRow({ mat_no: '90031602', qty: 1 }, CTX)
  assert.equal(r.status, 'no_bom')
  assert.deepEqual(r.lines, [])
})

test('ทศนิยม KG ต้องไม่ถูกปัดทิ้ง (coil 0.45 KG × 3 = 1.35)', () => {
  const ctx = { ...CTX, bomOf: () => [{ mat_no: '50029976', qty_per_unit: 0.45, uom: 'KG' }] }
  assert.equal(explodeScrapRow({ mat_no: '90031601', qty: 3 }, ctx).lines[0].qty, 1.35)
})

test('มาตเดียวโผล่หลายขั้น = รวมยอด แต่ติดธง dupMats ให้จอเตือน (อาการคีย์แบบสะสม)', () => {
  const ctx = { ...CTX, bomOf: (m) => (m === '90031601' || m === '90031603') ? [COIL] : [] }
  const r = explodeScrapRow({ mat_no: '90031603', qty: 4 }, ctx)
  assert.equal(r.lines[0].qty, 8)
  assert.deepEqual(r.dupMats, ['50031601'])
})

test('scanScrapItems แยกแถวที่ระเบิดได้ / ที่ยังไม่มีสูตร', () => {
  const s = scanScrapItems([
    { mat_no: '90031601', qty: 1 }, { mat_no: '90031602', qty: 1 }, { mat_no: '10100385', qty: 1 },
  ], CTX)
  assert.equal(s.opRowsCount, 2)
  assert.equal(s.ready.length, 1)
  assert.equal(s.blocked.length, 1)
})

test('mat ว่าง/qty 0 ไม่ระเบิด และไม่พัง', () => {
  assert.equal(explodeScrapRow({ mat_no: '', qty: 5 }, CTX).status, 'not_op')
  assert.equal(explodeScrapRow({ mat_no: '90031601', qty: 0 }, CTX).lines[0].qty, 0)
  assert.equal(explodeScrapRow(null, {}).status, 'not_op')
})

test('opInfoOf ทนช่องว่าง/ตัวพิมพ์ — พลาดตรงนี้ = ป้ายเตือนไม่ขึ้น ใบหลุดไปเงียบๆ', () => {
  assert.ok(opInfoOf(' 90031601 ', OP_MAP))
  assert.ok(opInfoOf('fender', OP_MAP))
  assert.equal(opInfoOf('10100385', OP_MAP), null)
  assert.equal(opInfoOf('', OP_MAP), null)
  assert.equal(explodeScrapRow({ mat_no: ' 90031601', qty: 2 }, CTX).lines[0].qty, 2)
})
