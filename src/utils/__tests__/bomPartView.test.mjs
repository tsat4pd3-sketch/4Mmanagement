/* เทส "พาร์ทที่ลูกถูกกรอกไว้ในใบอื่น" — user แจ้ง 14/10 พร้อมภาพจอ 4 ใบ:
     *"พาร์ท 2xx ที่มีลูกตัวเองและไปเป็นลูกของเบอร์ 1xx ใน BOM หลัก (FG) กลับบอกว่าไม่มีลูกใน BOM
       และอย่าง 20058483 ที่จากใน BOM หลักถูกสร้างให้มีลูกไว้แล้ว ก็ยังกดดูไม่ได้ที่เป็นเลเวลตัวเองตั้งต้น"*

   รูปจริงที่ใช้ตั้งเทส (ใบ FG 10086024 · SUPT ASY RAD MB3B-8A297-CB):
     .1 20058495 (มีใบของตัวเอง แต่ **ใบนั้นว่าง**)  → .2 20058498 → .3 20058483 → ..4 50027080
   2 บั๊กที่ชุดนี้ล็อกไว้:
     ① เปิดใบ 20058495 แล้วขึ้น "ยังไม่มีพาร์ทย่อยใน BOM นี้" ทั้งที่ใบ FG กรอกลูกของมันไว้แล้ว
     ② 20058483 ไม่มีใบของตัวเองเลย ⇒ กางเป็นตัวตั้งต้นไม่ได้ ทั้งที่ลูกของมันอยู่ในใบ 20058498 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBomIndex, explodeBom } from '../bomTree.js'

const FG = 'p-10086024', SUB = 'p-20058498', EMPTY = 'p-20058495'
const MAT_OF = { [FG]: '10086024', [SUB]: '20058498', [EMPTY]: '20058495' }
const ROWS = [
  // ใบ FG: 20058495 ชั้น 1 แล้วจัดลูกของมันไว้เอง (20058498)
  { id: 1, product_id: FG, mat_no: '20058495', qty_per_unit: 1, uom: 'PC' },
  { id: 2, product_id: FG, mat_no: '20058498', parent_mat: '20058495', qty_per_unit: 1, uom: 'PC' },
  // ใบของ 20058498 เอง: มี 20058483 แล้วจัดลูกของ 20058483 ไว้ในใบเดียวกัน
  { id: 3, product_id: SUB, mat_no: '20058483', qty_per_unit: 1, uom: 'PC' },
  { id: 4, product_id: SUB, mat_no: '50027080', parent_mat: '20058483', qty_per_unit: 0.076, uom: 'KG' },
  // ใบของ 20058495 = เปิดไว้แต่ยังว่าง (ไม่มีแถวเลย) ← ต้นเหตุของจอ "ไม่มีพาร์ทย่อย"
]

test('① ใบของพาร์ทว่าง แต่ sheetsWithKidsOf ต้องชี้ได้ว่าลูกถูกกรอกไว้ในใบ FG', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.equal(ix.bomOf('20058495', EMPTY).length, 0, 'ใบของตัวเองว่างจริง (พฤติกรรม bomOf ห้ามเปลี่ยน)')
  const where = ix.sheetsWithKidsOf('20058495')
  assert.deepEqual(where.map(x => x.sheetId), [FG])
  assert.equal(where[0].count, 1)
  assert.equal(where[0].isOwn, false)
})

test('① กางจากใบที่กรอกไว้ (startSheet) แล้วต้องเห็นลูก — ไม่ส่ง startSheet = ว่างเหมือนเดิม', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  const opt = { sheetFor: ix.sheetFor, ownSheetOf: ix.ownSheetOf }
  assert.equal(explodeBom('20058495', ix.bomOf, opt).rows.length, 0, 'พฤติกรรมเดิมต้องไม่เปลี่ยน')
  const t = explodeBom('20058495', ix.bomOf, { ...opt, startSheet: FG })
  assert.deepEqual(t.rows.map(r => r.mat_no), ['20058498', '20058483', '50027080'])
  assert.equal(t.maxLevel, 3)
})

test('② พาร์ทที่ไม่มีใบของตัวเองเลย (20058483) ต้องกางเป็นตัวตั้งต้นได้จากใบที่กรอกลูกไว้', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.equal(ix.ownSheetOf('20058483'), null, 'ยืนยันว่าไม่มีใบของตัวเอง')
  const where = ix.sheetsWithKidsOf('20058483')
  assert.deepEqual(where, [{ sheetId: SUB, count: 1, isOwn: false }])
  const t = explodeBom('20058483', ix.bomOf, { sheetFor: ix.sheetFor, ownSheetOf: ix.ownSheetOf, startSheet: SUB })
  assert.deepEqual(t.rows.map(r => r.mat_no), ['50027080'])
  assert.equal(t.rows[0].qty, 0.076)
})

test('🔴 ห้ามรวมหลายใบเป็นชุดเดียว — ของชิ้นเดียวถูกกรอกไว้ 2 ใบ ต้องแยกเป็น 2 รายการ', () => {
  const FG2 = 'p-10100814'
  const rows = [...ROWS,
    { id: 5, product_id: FG2, mat_no: '20058495', qty_per_unit: 1, uom: 'PC' },
    { id: 6, product_id: FG2, mat_no: '30047587', parent_mat: '20058495', qty_per_unit: 2, uom: 'PC' }]
  const ix = buildBomIndex(rows, { ...MAT_OF, [FG2]: '10100814' })
  const where = ix.sheetsWithKidsOf('20058495')
  assert.equal(where.length, 2, 'ต้องบอกว่ามี 2 ใบ ไม่ใช่ยุบเป็นชุดเดียว (ยุบ = นับซ้ำ)')
  assert.equal(where.reduce((n, x) => n + x.count, 0), 2)
  // กางคนละใบต้องได้คนละชุด
  const opt = { sheetFor: ix.sheetFor, ownSheetOf: ix.ownSheetOf }
  assert.deepEqual(explodeBom('20058495', ix.bomOf, { ...opt, startSheet: FG }).rows.map(r => r.mat_no),
    ['20058498', '20058483', '50027080'])
  assert.deepEqual(explodeBom('20058495', ix.bomOf, { ...opt, startSheet: FG2 }).rows.map(r => r.mat_no), ['30047587'])
})

test('ใบของตัวเองมีของ = ต้องมาก่อน และ bomOf ยังชนะเหมือนเดิม', () => {
  const rows = [...ROWS, { id: 7, product_id: EMPTY, mat_no: '30099999', qty_per_unit: 1, uom: 'PC' }]
  const ix = buildBomIndex(rows, MAT_OF)
  const where = ix.sheetsWithKidsOf('20058495')
  assert.equal(where[0].sheetId, EMPTY)
  assert.equal(where[0].isOwn, true)
  assert.equal(where.length, 2)
})

test('mat ที่ไม่มีใครกรอกลูกไว้ = ลิสต์ว่าง (ห้ามคืนใบเปล่ามาให้กดแล้วเจอหน้าว่าง)', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.deepEqual(ix.sheetsWithKidsOf('50027080'), [])
  assert.deepEqual(ix.sheetsWithKidsOf(''), [])
  assert.deepEqual(ix.sheetsWithKidsOf(null), [])
})

/* ⬆️ แถบ "แม่" (user ขอ 14/10: *"ควรมีแถบโชว์ให้ดูแม่ได้ด้วยว่าแม่มีใครบ้าง กดเข้าไปที่แม่ได้เลย"*) */
test('parentsOfMat: ตัวแม่ = parent_mat ถ้ามี · ไม่มี = เจ้าของใบ (ตรงกับ parentOf)', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.deepEqual(ix.parentsOfMat('20058498'), [{ mat: '20058495', sheetId: FG, qty: 1 }])
  // 20058483 ไม่มี parent_mat → แม่คือเจ้าของใบ (20058498)
  assert.deepEqual(ix.parentsOfMat('20058483'), [{ mat: '20058498', sheetId: SUB, qty: 1 }])
  assert.deepEqual(ix.parentsOfMat('50027080'), [{ mat: '20058483', sheetId: SUB, qty: 0.076 }])
})

test('🔴 แม่ตัวเดียวกันแต่คนละใบ ต้องขึ้น 2 รายการ ห้ามยุบ (คนละการนิยาม)', () => {
  const FG2 = 'p-10100814'
  const rows = [...ROWS,
    { id: 8, product_id: FG2, mat_no: '20058495', qty_per_unit: 1, uom: 'PC' },
    { id: 9, product_id: FG2, mat_no: '20058498', parent_mat: '20058495', qty_per_unit: 2, uom: 'PC' }]
  const ix = buildBomIndex(rows, { ...MAT_OF, [FG2]: '10100814' })
  const ps = ix.parentsOfMat('20058498')
  assert.equal(ps.length, 2)
  assert.deepEqual(ps.map(x => x.sheetId).sort(), [FG, FG2].sort())
})

test('ตัวบนสุด / แถวกำพร้า = ลิสต์ว่าง (ห้ามเดาแม่)', () => {
  const ix = buildBomIndex(ROWS, MAT_OF)
  assert.deepEqual(ix.parentsOfMat('10086024'), [])
  assert.deepEqual(ix.parentsOfMat(''), [])
  const orphanIx = buildBomIndex([{ id: 99, product_id: 'ไม่รู้จัก', mat_no: '30099999', qty_per_unit: 1 }], MAT_OF)
  assert.deepEqual(orphanIx.parentsOfMat('30099999'), [])
  assert.equal(orphanIx.orphans.length, 1)
})
