// เทส "ชั้น BOM ที่แก้ได้" — parent_mat ชนะ product_id · ย้ายชั้นแล้วห้ามวนลูป
// เคสจริงที่ใช้ตั้งเทส (ตรวจ DR 16/09): 10100817 มีลูก 5 ตัว แต่เป็น dr_products แค่ 20067039
// ⇒ เดิมวัตถุดิบ 50028183 ถูกตรึงไว้ชั้น 1 คู่กับพาร์ท 2xx ทั้งที่ของจริงอยู่ใต้ 20067039
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBomIndex, moveBomLine, explodeBom } from '../bomTree.js'

const FG = 'p-10100817'
const MAT_OF = { [FG]: '10100817' }
const ROWS = [
  { id: 1, product_id: FG, mat_no: '20067039', qty_per_unit: 1, uom: 'PC' },
  { id: 2, product_id: FG, mat_no: '30046428', qty_per_unit: 1, uom: 'PC' },
  { id: 3, product_id: FG, mat_no: '50028183', qty_per_unit: 1, uom: 'PC' },
]

test('parent_mat ว่าง = พฤติกรรมเดิมเป๊ะ (ตัวแม่คือ product ของ product_id)', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.equal(ix.bomOf('10100817').length, 3)
  assert.equal(ix.bomOf('20067039').length, 0)
  assert.deepEqual(ix.orphans, [])
})

test('🔑 ตั้ง parent_mat = ได้ชั้นที่ 2 โดยตัวแม่ไม่ต้องเป็น dr_products', () => {
  const rows = ROWS.map(r => r.id === 3 ? { ...r, parent_mat: '20067039' } : r)
  const ix = buildBomIndex(rows, MAT_OF)
  assert.equal(ix.bomOf('10100817').length, 2)          // 50028183 ไม่อยู่ชั้น 1 แล้ว
  assert.deepEqual(ix.bomOf('20067039').map(r => r.mat_no), ['50028183'])
  // กางแล้วต้องได้ 2 ชั้นจริง (ตรงกับ SAP CS12)
  const t = explodeBom('10100817', ix.bomOf)
  assert.equal(t.maxLevel, 2)
  assert.equal(t.rows.find(r => r.mat_no === '50028183').level, 2)
})

test('product_id ยังต้องอยู่ — บรรทัดที่ย้ายชั้นแล้วยังรู้ว่าอยู่ใบ BOM ของ FG ไหน', () => {
  const rows = ROWS.map(r => r.id === 3 ? { ...r, parent_mat: '20067039' } : r)
  assert.equal(rows.find(r => r.id === 3).product_id, FG)
})

test('แถวที่หาตัวแม่ไม่ได้ = orphans ต้องคืนออกมา ห้ามกลืนหาย', () => {
  const ix = buildBomIndex([{ id: 9, product_id: 'ไม่รู้จัก', mat_no: 'X' }], MAT_OF)
  assert.equal(ix.orphans.length, 1)
  assert.equal(ix.bomOf('10100817').length, 0)
})

test('moveBomLine: ย้ายไปใต้ตัวเองไม่ได้ · ว่าง = คืนกลับชั้น 1', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.equal(moveBomLine({ mat_no: '50028183' }, '50028183', ix.bomOf).ok, false)
  assert.deepEqual(moveBomLine({ mat_no: '50028183' }, '', ix.bomOf).patch, { parent_mat: null })
  assert.deepEqual(moveBomLine({ mat_no: '50028183' }, '20067039', ix.bomOf).patch, { parent_mat: '20067039' })
})

test('🔑 moveBomLine กันวนลูป — ย้ายตัวแม่ไปใต้ลูกของตัวเองไม่ได้', () => {
  const rows = ROWS.map(r => r.id === 3 ? { ...r, parent_mat: '20067039' } : r)
  const ix = buildBomIndex(rows, MAT_OF)
  const r = moveBomLine({ mat_no: '20067039' }, '50028183', ix.bomOf)
  assert.equal(r.ok, false)
  assert.match(r.reason, /วนลูป/)
})

test('เทียบตัวพิมพ์/ช่องว่างแบบหลวม — ข้อมูลจริงมี mat ที่มีช่องว่างท้าย', () => {
  const rows = ROWS.map(r => r.id === 3 ? { ...r, parent_mat: ' 20067039 ' } : r)
  const ix = buildBomIndex(rows, MAT_OF)
  assert.equal(ix.bomOf('20067039').length, 1)
  assert.equal(moveBomLine({ mat_no: '20067039' }, '20067039 ', ix.bomOf).ok, false)
})
