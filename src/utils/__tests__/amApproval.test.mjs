// ✍️ B2 สายอนุมัติ AM ตามลำดับชั้น (ประชุมหน้างาน 2026-11-02) — ห้ามข้ามไปผู้จัดการ
import test from 'node:test'
import assert from 'node:assert/strict'
import { amNextApprover, amApprovalVerdict, amApproveAllowed, amApprovalText, amApprovalAssumptionText } from '../amApproval.js'

const OP = 10, TECH = 20, LEAD = 40, SUP = 50, MGR = 60

test('amNextApprover — ชั้นแรกที่สูงกว่าคนตรวจ', () => {
  assert.equal(amNextApprover(OP).step.key, 'leader')
  assert.equal(amNextApprover(TECH).step.key, 'leader')
  assert.equal(amNextApprover(LEAD).step.key, 'supervisor')
  assert.equal(amNextApprover(SUP).step.key, 'manager')
  assert.equal(amNextApprover(MGR).top, true)
  assert.equal(amNextApprover(null).known, false)
})

test('บั๊กที่แจ้ง: หัวหน้ากลุ่มตรวจเอง ⇒ ต้องไปหัวหน้าแผนก ไม่ใช่ผู้จัดการ', () => {
  assert.equal(amApprovalVerdict({ inspectorRank: LEAD, approverRank: MGR }).code, 'skip_level')
  assert.equal(amApprovalVerdict({ inspectorRank: LEAD, approverRank: SUP }).ok, true)
})

test('พนักงานตรวจ ⇒ หัวหน้ากลุ่มเท่านั้น (หัวหน้าแผนก/ผู้จัดการ = ข้ามขั้น · ช่าง = ต่ำไป)', () => {
  assert.equal(amApprovalVerdict({ inspectorRank: OP, approverRank: LEAD }).ok, true)
  assert.equal(amApprovalVerdict({ inspectorRank: OP, approverRank: SUP }).code, 'skip_level')
  assert.equal(amApprovalVerdict({ inspectorRank: OP, approverRank: MGR }).code, 'skip_level')
  assert.equal(amApprovalVerdict({ inspectorRank: OP, approverRank: TECH }).code, 'rank_too_low')
})

test('รับทราบใบตัวเองไม่ได้ · ผู้จัดการตรวจเอง = ผู้จัดการรับทราบได้', () => {
  assert.equal(amApprovalVerdict({ inspectorRank: LEAD, approverRank: LEAD, isSelf: true }).code, 'self')
  assert.equal(amApprovalVerdict({ inspectorRank: MGR, approverRank: MGR }).ok, true)
  assert.equal(amApprovalVerdict({ inspectorRank: MGR, approverRank: SUP }).ok, false)
})

test('ไม่รู้ตำแหน่ง = ไม่บล็อก แต่ต้องมีข้อความเตือน', () => {
  const v = amApprovalVerdict({ inspectorRank: null, approverRank: MGR })
  assert.equal(v.ok, true); assert.deepEqual(v.assumed, ['inspector'])
  assert.ok(amApprovalAssumptionText(v.assumed))
  const w = amApprovalVerdict({ inspectorRank: OP, approverRank: null })
  assert.equal(w.ok, true); assert.deepEqual(w.assumed, ['approver'])
  assert.equal(amApprovalAssumptionText([]), null)
  assert.ok(amApprovalText(amApprovalVerdict({ inspectorRank: OP, approverRank: MGR })).includes('หัวหน้ากลุ่ม'))
})

test('amApproveAllowed — am:approve เมื่อ seed แล้ว · ยังไม่ seed ถอยไป pm:approve', () => {
  const can = (keys) => (r, a) => keys.includes(`${r}:${a}`)
  assert.equal(amApproveAllowed({ can: can(['am:approve']), isSeeded: () => true }), true)
  assert.equal(amApproveAllowed({ can: can(['pm:approve']), isSeeded: () => true }), false)
  assert.equal(amApproveAllowed({ can: can(['pm:approve']), isSeeded: () => false }), true)
})
