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

/* ── 🧹 ลบ "แถวนับซ้ำ" จากจอต้นไม้ได้ (user 2026-09-16) ──────────────────────────────
   เคสจริง 10100381: คอยล์ 50027085 ถูกเขียน 3 ที่ — 0.642 ที่ชั้น 1 (แถวแบนจาก SAP)
   + 0.3205 ใต้ 20058490 (RH) + 0.3205 ใต้ 20058491 (LH)
   เพราะแผ่นเดียวปั๊มได้ทั้งซ้าย-ขวา ⇒ ครึ่งแผ่นต่อชิ้น (0.642 ÷ 2 = 0.3205) = ความจริง
   กางแล้วได้ 1.283 KG ทั้งที่ของจริงกิน 0.642 ⇒ แถวชั้น 1 ต้องถูกชี้ว่าลบได้ พร้อม id */
const CO = '10100381'
const CO_MAT = { 'p-381': CO, 'p-490': '20058490', 'p-491': '20058491' }
const CO_ROWS = [
  { id: 'r490', product_id: 'p-381', mat_no: '20058490', qty_per_unit: 1, uom: 'PC' },
  { id: 'r491', product_id: 'p-381', mat_no: '20058491', qty_per_unit: 1, uom: 'PC' },
  { id: 'rFlat', product_id: 'p-381', mat_no: '50027085', qty_per_unit: 0.642, uom: 'KG' },
  { id: 'rRH', product_id: 'p-490', mat_no: '50027085', qty_per_unit: 0.3205, uom: 'KG' },
  { id: 'rLH', product_id: 'p-491', mat_no: '50027085', qty_per_unit: 0.3205, uom: 'KG' },
]

test('🔑 งานปั๊มคู่ RH/LH — แถวคอยล์ชั้น 1 ต้องติดธงนับซ้ำ และ "มี id" ให้กดลบได้', () => {
  const ix = buildBomIndex(CO_ROWS, CO_MAT)
  const t = explodeBom(CO, ix.bomOf)
  const dup = t.rows.filter(r => r.isDupeRow)
  assert.equal(dup.length, 1)
  assert.equal(dup[0].mat_no, '50027085')
  // ไม่มี id = ปุ่มลบหายเงียบ แล้ว user กลับไปติดปัญหาเดิม "ไม่รู้จะลบยังไง"
  assert.equal(dup[0].id, 'rFlat')
  // แถวชั้นลึกต้องไม่ถูกชี้ให้ลบ (ของจริงอยู่ตรงนั้น)
  assert.deepEqual(t.rows.filter(r => r.flatDupe && !r.isDupeRow).map(r => r.id).sort(), ['rLH', 'rRH'])
})

/* ⚠️ ข้อมูลจริงตัวนี้ครึ่งแผ่นถูกคีย์ 0.3205 ⇒ ซ้าย+ขวา = 0.641 **ไม่ใช่ 0.642**
   (0.642 ÷ 2 = 0.321 พอดี — ฝั่ง PE คีย์ 0.321 ใน 10105769/70 แล้ว ต่างกัน 0.5 กรัม/ชิ้น = 0.16%)
   เทสตรึงเลขจริงไว้ ไม่ปัดให้สวย — ถ้าวันหนึ่งมีคนแก้ครึ่งแผ่นเป็น 0.321 เทสนี้จะตกและต้องแก้ตาม
   ⇒ นั่นคือจุดที่ควรรู้ตัว ไม่ใช่ปล่อยให้ยอดขยับเงียบๆ */
test('ลบแถวชั้น 1 แล้วยอดคอยล์ต่อ 1 FG = ครึ่งแผ่น × ซ้าย+ขวา (ไม่ใช่ 1.283)', () => {
  const ix = buildBomIndex(CO_ROWS, CO_MAT)
  const before = explodeBom(CO, ix.bomOf).rows
    .filter(r => r.mat_no === '50027085').reduce((s, r) => s + r.qtyPerRoot, 0)
  assert.equal(Math.round(before * 10000) / 10000, 1.283)
  const ix2 = buildBomIndex(CO_ROWS.filter(r => r.id !== 'rFlat'), CO_MAT)
  const after = explodeBom(CO, ix2.bomOf).rows
    .filter(r => r.mat_no === '50027085').reduce((s, r) => s + r.qtyPerRoot, 0)
  assert.equal(Math.round(after * 10000) / 10000, 0.641)
})

/* ── 🔴 บั๊กจริง 2026-09-21 — `parent_mat` ข้ามใบ ทำให้ต้นไม้ระเบิด ─────────────────────
   user ส่งจอมาให้ดู: `10101158` (22 พาร์ท) กางออกมา **1,276 แถว ลึก 5 ชั้น**
   + แถบ "นับซ้ำ" พ่นชื่อตัวแม่ซ้ำ 60 รอบต่อบรรทัด ⇒ จอใช้งานไม่ได้ และปุ่มลบแถวนับซ้ำ
   กลายเป็นของอันตราย (ตัดสินจากต้นไม้ที่ผิด)
   เหตุ: `parent_mat` เก็บเป็น **mat** ⇒ ค่าเดียวกันโผล่ในใบของ FG หลายตัวได้
   (วัดจริง `20058693` ถูกตั้งเป็นตัวแม่ใน 6 ใบ) พอดึงลูกด้วย mat เฉยๆ = กางลูกของทุกใบมารวมกัน */
const SH = { 'p-FG1': 'FG1', 'p-FG2': 'FG2', 'p-SUB': 'SUB' }
const SHARED = [
  // ใบของ FG1: SUB 1 ตัว
  { id: 'a1', product_id: 'p-FG1', mat_no: 'SUB', qty_per_unit: 1 },
  // ใบของ FG2: SUB 1 ตัว (พาร์ทเดียวกัน คนละใบ)
  { id: 'b1', product_id: 'p-FG2', mat_no: 'SUB', qty_per_unit: 1 },
  // ใบของ SUB เอง
  { id: 's1', product_id: 'p-SUB', mat_no: 'NUT', qty_per_unit: 2 },
  // คนจัดชั้นในใบ FG1: ย้าย BOLT ไปใต้ SUB (อยู่ในใบ FG1 เท่านั้น)
  { id: 'a2', product_id: 'p-FG1', mat_no: 'BOLT', qty_per_unit: 3, parent_mat: 'SUB' },
  // คนจัดชั้นในใบ FG2: ย้าย WASHER ไปใต้ SUB เหมือนกัน (คนละใบ)
  { id: 'b2', product_id: 'p-FG2', mat_no: 'WASHER', qty_per_unit: 4, parent_mat: 'SUB' },
]

test('🔴 ใบ FG1 ต้องไม่ลากลูกที่คนจัดชั้นไว้ในใบ FG2 มาด้วย', () => {
  const ix = buildBomIndex(SHARED, SH)
  const t1 = explodeBom('FG1', ix.bomOf, { sheetFor: ix.sheetFor })
  assert.deepEqual(t1.rows.map(r => r.mat_no), ['SUB', 'BOLT'])   // ไม่มี WASHER ของใบ FG2
  const t2 = explodeBom('FG2', ix.bomOf, { sheetFor: ix.sheetFor })
  assert.deepEqual(t2.rows.map(r => r.mat_no), ['SUB', 'WASHER']) // ไม่มี BOLT ของใบ FG1
})

test('🔴 ไม่มีใครจัดชั้นในใบนี้ → ใช้ใบ BOM ของพาร์ทนั้นเอง (ไม่ใช่ว่างเปล่า)', () => {
  const rows = SHARED.filter(r => r.id !== 'a2')                  // ใบ FG1 ไม่ได้จัดชั้นอะไร
  const ix = buildBomIndex(rows, SH)
  const t = explodeBom('FG1', ix.bomOf, { sheetFor: ix.sheetFor })
  assert.deepEqual(t.rows.map(r => r.mat_no), ['SUB', 'NUT'])     // ลงไปในใบของ SUB เอง
  assert.equal(t.rows.find(r => r.mat_no === 'NUT').qtyPerRoot, 2)
})

test('🔴 เลือกชุดเดียวเสมอ ห้ามรวม 2 ชุด (รวม = นับซ้ำ)', () => {
  const ix = buildBomIndex(SHARED, SH)
  // ใบ FG1 จัดชั้น BOLT ไว้ใต้ SUB แล้ว ⇒ ใช้ชุดนั้น **ไม่เอา NUT จากใบของ SUB มาปนด้วย**
  assert.deepEqual(ix.bomOf('SUB', 'p-FG1').map(r => r.mat_no), ['BOLT'])
  assert.deepEqual(ix.bomOf('SUB', 'p-SUB').map(r => r.mat_no), ['NUT'])
})

test('via ในแถบ "นับซ้ำ" ต้องไม่ซ้ำชื่อตัวแม่ (จอเคยพ่นซ้ำ 60 รอบ)', () => {
  const rows = [
    { id: 1, product_id: 'p-FG1', mat_no: 'SUB', qty_per_unit: 1 },
    { id: 2, product_id: 'p-FG1', mat_no: 'NUT', qty_per_unit: 1 },     // ชั้น 1
    { id: 3, product_id: 'p-SUB', mat_no: 'NUT', qty_per_unit: 2 },     // ใต้ SUB ด้วย
    { id: 4, product_id: 'p-SUB', mat_no: 'NUT2', qty_per_unit: 1 },
  ]
  const ix = buildBomIndex(rows, SH)
  const t = explodeBom('FG1', ix.bomOf, { sheetFor: ix.sheetFor })
  const d = t.flatDupes.find(x => x.mat_no === 'NUT')
  assert.deepEqual(d.via, ['SUB'])
})
