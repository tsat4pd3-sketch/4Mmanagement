// ✍️ B2 สายอนุมัติ AM ตามลำดับชั้น (ประชุมหน้างาน 2026-11-02) — ห้ามข้ามไปผู้จัดการ
import test from 'node:test'
import assert from 'node:assert/strict'
import { amNextApprover, amApprovalVerdict, amApproveAllowed, amApprovalText, amApprovalAssumptionText, amBadgeGate, amOnSiteApproval, amInspectorIdentity } from '../amApproval.js'

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

// ── 🪪 B4 (10/11) — หัวหน้าถือ handheld ทวนสอบหน้าเครื่อง ──────────────────────────
test('B4 amBadgeGate — ใบ AM ต้องมีบัตรที่ชี้พนักงานได้ 1 คนพอดี', () => {
  assert.equal(amBadgeGate({ code: '' }).code, 'no_code')
  assert.equal(amBadgeGate({ code: '  ' }).ok, false)
  assert.equal(amBadgeGate({ code: '61234', loadError: true }).code, 'unreadable')
  assert.equal(amBadgeGate({ code: '61234', employee: null, hits: 0 }).code, 'not_found')
  assert.equal(amBadgeGate({ code: '61234', employee: null, hits: 2 }).code, 'ambiguous')
  assert.equal(amBadgeGate({ code: '61-234', employee: { id: 'e1' }, hits: 1 }).ok, true)
})

test('B4 amOnSiteApproval — หัวหน้ากลุ่มบันทึกใบของพนักงาน = รับทราบทันที', () => {
  const base = { approverRank: LEAD, isSelf: false, canApprove: true }
  assert.equal(amOnSiteApproval({ ...base, inspectorRank: OP }).approve, true)
  assert.equal(amOnSiteApproval({ ...base, inspectorRank: TECH }).approve, true)
  // ไม่รู้ตำแหน่งพนักงาน = ไม่บล็อก (กติกาเดิม) แต่ verdict บอก assumed
  const unk = amOnSiteApproval({ ...base, inspectorRank: null })
  assert.equal(unk.approve, true); assert.deepEqual(unk.verdict.assumed, ['inspector'])
})

test('B4 amOnSiteApproval — กรณีที่ต้องรออนุมัติตามขั้นปกติ', () => {
  // หัวหน้าแผนกถือเครื่อง = ข้ามขั้น
  assert.equal(amOnSiteApproval({ inspectorRank: OP, approverRank: SUP, isSelf: false, canApprove: true }).code, 'skip_level')
  // หัวหน้าตรวจเอง (สแกนบัตรตัวเอง) = ใบตัวเอง
  const self = amOnSiteApproval({ inspectorRank: LEAD, approverRank: LEAD, isSelf: true, canApprove: true })
  assert.equal(self.approve, false); assert.equal(self.code, 'self')
  // ไม่มีสิทธิ์ · บัญชีกลาง · อ่านไม่ได้ว่าใช่ตัวเองไหม
  assert.equal(amOnSiteApproval({ inspectorRank: OP, approverRank: LEAD, isSelf: false, canApprove: false }).code, 'no_perm')
  assert.equal(amOnSiteApproval({ inspectorRank: OP, approverRank: LEAD, isSelf: false, canApprove: true, isShared: true }).code, 'shared')
  assert.equal(amOnSiteApproval({ inspectorRank: OP, approverRank: LEAD, isSelf: null, canApprove: true }).code, 'self_unknown')
  // ทุกเคสที่ไม่อนุมัติต้องมีข้อความบอกบนจอ
  for (const c of [{ isShared: true }, { canApprove: false }, { isSelf: null }]) {
    const r = amOnSiteApproval({ inspectorRank: OP, approverRank: LEAD, isSelf: false, canApprove: true, ...c })
    assert.ok(r.text.includes('รออนุมัติ'))
  }
})

test('B4 amInspectorIdentity — มีรหัสบัตร = คนตามบัตร ไม่ใช่บัญชีที่ login', () => {
  const ctx = { empByCode: { '61234': { id: 'emp-op', position: 'operator' }, 'L001': { id: 'emp-lead', position: 'line_leader' } },
    posByUid: { 'u-lead': 'line_leader' }, myUid: 'u-lead', myEmployeeId: 'emp-lead' }
  // หัวหน้า (u-lead) บันทึกใบของพนักงาน 61234 ⇒ ผู้ตรวจ = operator · ไม่ใช่ใบตัวเอง
  const a = amInspectorIdentity({ inspector_id: 'u-lead', inspector_code: '61-234' }, ctx)
  assert.deepEqual(a, { position: 'operator', isSelf: false, byBadge: true })
  // หัวหน้าสแกนบัตรตัวเอง ⇒ ใบตัวเอง
  assert.equal(amInspectorIdentity({ inspector_id: 'u-lead', inspector_code: 'l001' }, ctx).isSelf, true)
  // ใบเก่าไม่มีรหัส = พฤติกรรมเดิม (บัญชีที่ login)
  assert.deepEqual(amInspectorIdentity({ inspector_id: 'u-lead' }, ctx), { position: 'line_leader', isSelf: true, byBadge: false })
  // รหัสที่หาไม่เจอ = ไม่รู้ตำแหน่ง · ไม่ถือเป็นใบตัวเอง
  assert.deepEqual(amInspectorIdentity({ inspector_id: 'u-lead', inspector_code: '99999' }, ctx), { position: null, isSelf: false, byBadge: true })
})

// ── 🪪 11/11 — ใบ PM ของช่างใช้ด่านบัตรตัวเดียวกัน (คำสั่ง user) ───────────────────────────
test('amBadgeGate kind=PM — ไม่มีบัตร = บล็อก ข้อความเป็นของใบ PM · ไม่ส่ง kind = ข้อความ AM เดิม', () => {
  const pm = amBadgeGate({ code: '', kind: 'PM' })
  assert.equal(pm.ok, false)
  assert.equal(pm.code, 'no_code')
  assert.match(pm.text, /ใบตรวจ PM/)
  assert.match(amBadgeGate({ code: '' }).text, /ใบตรวจ AM/)
  assert.equal(amBadgeGate({ code: 'E001', employee: { id: 'x' }, kind: 'PM' }).ok, true)
  assert.equal(amBadgeGate({ code: 'E001', hits: 2, kind: 'PM' }).code, 'ambiguous')
})
