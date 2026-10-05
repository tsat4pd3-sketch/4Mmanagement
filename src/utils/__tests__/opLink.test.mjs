/* เทส "ขั้นตอน (OP) แบบเดียว" — user 16/09: ทุกขั้นคือของชิ้นใหม่ ไม่อยากให้มีหลายแบบ
   ⇒ เหลือคำถามเดียว "ยอดของขั้นนี้ไปซ้ำกับใบผลิตของใคร" (op_parent_mat · ว่างได้)
   แถบเตือนดู **อาการจริง** ไม่ใช่ช่องว่าง */
import test from 'node:test'
import assert from 'node:assert/strict'
import { opDoubleCountRisk, opLinkIssues } from '../opLink.js'

const OP = (extra) => ({ is_operation: true, mat_no: 'X', op_parent_mat: null, ...extra })
const counted = (set) => (m) => set.includes((m || '').trim().toUpperCase())

test('🔑 ขั้นที่กินของซึ่งมีใบผลิตของตัวเอง แต่ยังไม่ผูก = เตือน + เสนอตัวที่ควรเลือก', () => {
  // เคสจริง E025 (M6 ไม่มีเกลียว): สูตร = 20058626 (สินค้า มีใบผลิต 6 ใบ) + นัท 30044771
  const r = opDoubleCountRisk(OP({ mat_no: 'E025 (M6 ไม่มีเกลียว)' }),
    ['20058626', '30044771'], counted(['20058626']))
  assert.deepEqual(r, { candidates: ['20058626'] })
})

test('🔑 ขั้นประกอบที่ของเข้าไม่มีใบผลิตของตัวเอง = เงียบ (นี่คือเคส 291+088 ที่ user ทัก)', () => {
  // FENDER: 30042571 + 30047596 + 30052451 — ทั้ง 3 เป็นพาร์ทซื้อนอก ไม่มีใบผลิต
  assert.equal(opDoubleCountRisk(OP({ mat_no: 'FENDER' }),
    ['30042571', '30047596', '30052451'], counted([])), null)
})

test('ผูก parent แล้ว = ไม่เตือน (ระบบยุบยอดให้อยู่แล้ว)', () => {
  assert.equal(opDoubleCountRisk(OP({ op_parent_mat: '20058626' }),
    ['20058626'], counted(['20058626'])), null)
})

test('ยังไม่ผูกสูตร = เงียบ ห้ามเตือนมั่ว (คนเพิ่งสร้างขั้น)', () => {
  assert.equal(opDoubleCountRisk(OP(), [], counted(['20058626'])), null)
})

test('พาร์ทจริง (ไม่ใช่ OP) ไม่ถูกตรวจเลย', () => {
  assert.equal(opDoubleCountRisk({ is_operation: false, op_parent_mat: null },
    ['20058626'], counted(['20058626'])), null)
})

test('ของเข้าซ้ำกันหลายบรรทัด = เสนอครั้งเดียว', () => {
  const r = opDoubleCountRisk(OP(), ['20058626', ' 20058626 ', '30044771'], counted(['20058626']))
  assert.equal(r.candidates.length, 1)
})

/* ── opLinkIssues — กฎใหม่ 2026-10-05: "ปลายสายต้องเป็นพาร์ทจริง 1xxx/2xxx" ─────────
   user: *"ปลายทางจะไปต้องไปจบที่พาร์ทจริงที่มี mat sap … ยกเว้นจะเป็น sub ของ sub
   อีกทีก่อนจะกลายเป็นพาร์ท 2xxx หรือ 1xxx"* */

test('ปลายทางเป็น FG (1xxx) = ไม่เตือน', () => {
  assert.deepEqual(opLinkIssues(OP({ op_parent_mat: '10100385' })), [])
})

test('ปลายทางเป็น Child ผลิตเอง (2xxx) = ไม่เตือน', () => {
  assert.deepEqual(opLinkIssues(OP({ op_parent_mat: '20066332' })), [])
})

test('ว่าง = ไม่เตือน (ไม่ใช่ "กรอกไม่เสร็จ")', () => {
  assert.deepEqual(opLinkIssues(OP({ op_parent_mat: null })), [])
  assert.deepEqual(opLinkIssues(OP({ op_parent_mat: '  ' })), [])
})

test('🔴 ปลายทางเป็นวัตถุดิบ (5xxx) = เตือน — ไม่มีใบผลิตให้ยุบยอดเข้า (เคสจริง 20067039(BENDING))', () => {
  const w = opLinkIssues(OP({ mat_no: '20067039(BENDING)', op_parent_mat: '50029126' }))
  assert.equal(w.length, 1)
  assert.match(w[0].text, /ไม่มีใบผลิตของตัวเอง/)
})

test('🔴 ปลายทางเป็นของซื้อนอก (3xxx) = เตือน (เคสจริง 290/291/173 M8/5049)', () => {
  const w = opLinkIssues(OP({ mat_no: '290 (M6 มีเกลียว)', op_parent_mat: '30047585' }))
  assert.equal(w.length, 1)
  assert.match(w[0].text, /ไม่มีใบผลิตของตัวเอง/)
})

test('ปลายทางไม่ใช่เลข MAT SAP 8 หลัก = เตือน (ห้ามเดาประเภทจากตัวแรก)', () => {
  const w = opLinkIssues(OP({ op_parent_mat: '127' }))
  assert.equal(w.length, 1)
  assert.match(w[0].text, /MAT SAP 8 หลัก/)
})

test('sub ของ sub — ขั้นชี้ไปขั้นอื่น แล้วไปจบที่พาร์ทจริง = ไม่เตือน', () => {
  const chain = { 'STEP A': 'STEP B', 'STEP B': '20066332' }
  assert.deepEqual(
    opLinkIssues(OP({ mat_no: 'OP0', op_parent_mat: 'STEP A' }), { parentOf: m => chain[m] }), [])
})

test('🔴 sub ของ sub ที่ปลายสายยังเป็นวัตถุดิบ = เตือน (ต้องไล่จนสุดสาย ไม่ใช่ดูแค่ตัวแรก)', () => {
  const chain = { 'STEP A': 'STEP B', 'STEP B': '50029126' }
  const w = opLinkIssues(OP({ mat_no: 'OP0', op_parent_mat: 'STEP A' }), { parentOf: m => chain[m] })
  assert.equal(w.length, 1)
  assert.match(w[0].text, /50029126/)
})

test('🔴 สายวนกลับมาที่ตัวเอง = เตือน ไม่ใช่ลูปค้าง', () => {
  const chain = { 'STEP A': 'STEP B', 'STEP B': 'STEP A' }
  const w = opLinkIssues(OP({ mat_no: 'OP0', op_parent_mat: 'STEP A' }), { parentOf: m => chain[m] })
  assert.equal(w.length, 1)
  assert.match(w[0].text, /วนกลับมา/)
})

test('🔴 ห้ามเตือนเรื่องทิศทาง — ข้อมูลจริงใช้ทั้ง 2 ทิศและถูกทั้งคู่ (วัด 05/10: 8 ตัวรับเข้า · 16 ตัวกลายเป็น)', () => {
  // ขั้นขับนัท: parent = ของที่รับเข้ามา (อยู่ในสูตรของตัวเอง)
  assert.deepEqual(opLinkIssues(OP({ mat_no: 'D04 (BOLT M6)', op_parent_mat: '20066332' })), [])
  // STEP 1: parent = ของที่ทำเสร็จแล้วกลายเป็น (ไม่อยู่ในสูตร)
  assert.deepEqual(opLinkIssues(OP({ mat_no: '824-STEP 1', op_parent_mat: '20066542' })), [])
})

test('ไม่ใช่ OP = ไม่เตือนอะไรเลย', () => {
  assert.deepEqual(opLinkIssues({ is_operation: false, op_parent_mat: '50029126' }), [])
})
