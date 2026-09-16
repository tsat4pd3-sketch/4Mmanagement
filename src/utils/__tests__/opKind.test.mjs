/* เทสชนิดของขั้นตอน (OP) — ที่มา: รูปวาดมือของ user 16/09
     🔁 Part A + nut ×3 → Part A ที่มีนัท (no mat SAP) = sequence — ตอบได้ว่าเป็นขั้นของใคร
     🧩 Part B + Part C → ของใหม่        (no mat SAP) = assembly — ตอบไม่ได้ ห้ามบังคับให้ตอบ */
import test from 'node:test'
import assert from 'node:assert/strict'
import { OP_KIND, kindNeedsParent, opNeedsParentPick, opKindIssues } from '../opKind.js'

const SEQ = { is_operation: true, mat_no: '291 (M6 มีเกลียว)', op_kind: OP_KIND.SEQ, op_parent_mat: '30047596' }
const ASM = { is_operation: true, mat_no: 'FENDER', op_kind: OP_KIND.ASM, op_parent_mat: null }

test('ขั้นต่อเนื่องต้องมีพาร์ทแม่ · ขั้นประกอบไม่ต้อง', () => {
  assert.equal(kindNeedsParent(OP_KIND.SEQ), true)
  assert.equal(kindNeedsParent(OP_KIND.ASM), false)
  assert.equal(kindNeedsParent(null), true)          // ยังไม่เลือก = ยังถือว่าต้องมี (เตือนต่อ)
})

test('🔑 worklist ต้องเลิกตาม "ขั้นประกอบ" — ไม่งั้นแถบเตือนไม่มีวันหาย คนเลิกเชื่อแถบเตือน', () => {
  assert.equal(opNeedsParentPick(ASM), false)
  assert.equal(opNeedsParentPick(SEQ), false)
  assert.equal(opNeedsParentPick({ is_operation: true, op_kind: null, op_parent_mat: null }), true)
  assert.equal(opNeedsParentPick({ is_operation: false, op_parent_mat: null }), false)   // พาร์ทจริง ไม่เกี่ยว
})

test('🔴 ขั้นประกอบที่ยังมีพาร์ทแม่ค้าง = ยอดเสี่ยงถูกยุบหาย ต้องเตือนระดับ crit', () => {
  const w = opKindIssues({ ...ASM, op_parent_mat: '30052451' })
  assert.equal(w.length, 1)
  assert.equal(w[0].level, 'crit')
  assert.match(w[0].text, /30052451/)
})

test('🔴 ขั้นต่อเนื่องที่ไม่มีพาร์ทแม่ = นับซ้ำทุกขั้น', () => {
  const w = opKindIssues({ ...SEQ, op_parent_mat: '' })
  assert.equal(w.length, 1)
  assert.equal(w[0].level, 'crit')
})

test('ขั้นต่อเนื่องที่ถูกต้อง (parent อยู่ในสูตรของตัวเอง) ต้องไม่เตือน — เป็นเรื่องปกติของแบบ 🔁', () => {
  // 8/18 ขั้นในฐานจริงเป็นแบบนี้: ขั้นกิน Part A เข้าไปแล้วคาย Part A ที่มีนัท
  assert.deepEqual(opKindIssues(SEQ, ['30047596', '30042571']), [])
})

test('⚠️ ขั้นต่อเนื่องที่พาร์ทแม่ไม่อยู่ในสูตรของตัวเอง = เตือน (warn) ไม่ฟันธง', () => {
  const w = opKindIssues(SEQ, ['30042571'])
  assert.equal(w.length, 1)
  assert.equal(w[0].level, 'warn')
})

test('สูตรยังว่าง = ข้ามการเทียบ ห้ามเตือนมั่ว (คนเพิ่งสร้างขั้น ยังไม่ผูก component)', () => {
  assert.deepEqual(opKindIssues(SEQ, []), [])
})

test('พาร์ทจริง (ไม่ใช่ OP) ไม่ถูกตรวจเลย', () => {
  assert.deepEqual(opKindIssues({ is_operation: false, op_parent_mat: 'X', op_kind: OP_KIND.ASM }), [])
})

test('เทียบ mat แบบทนช่องว่าง/ตัวพิมพ์ — ข้อมูลจริงมี mat ที่มีช่องว่างท้าย', () => {
  assert.deepEqual(opKindIssues({ ...SEQ, op_parent_mat: ' 30047596 ' }, ['30047596']), [])
})
