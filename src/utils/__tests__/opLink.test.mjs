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

test('⚠️ ผูก parent ที่ไม่อยู่ในสูตรของตัวเอง = เตือน (warn) ไม่ฟันธง', () => {
  const w = opLinkIssues(OP({ op_parent_mat: '20066332' }), ['20065734', '50029610'])
  assert.equal(w.length, 1)
  assert.equal(w[0].level, 'warn')
})

test('🔴 ห้ามเตือนว่า "parent เป็น component ของตัวเอง" — เป็นเรื่องปกติ 8/18 ขั้นเป็นแบบนี้', () => {
  // 291 (M6 มีเกลียว): กิน 30047596 เข้าไปแล้วคายตัวเดิมที่มีนัท — ถูกต้องแล้ว ห้ามขึ้นแดง
  assert.deepEqual(opLinkIssues(OP({ op_parent_mat: '30047596' }), ['30042571', '30047596']), [])
})

test('สูตรว่าง = ข้ามการเทียบ', () => {
  assert.deepEqual(opLinkIssues(OP({ op_parent_mat: '10100385' }), []), [])
})
