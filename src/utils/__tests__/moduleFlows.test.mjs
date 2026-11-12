import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ncFlow } from '../qualityBin.js';
import { ncrFlow, capaFlow, claimFlow } from '../qaDocStatus.js';
import { matReqFlow } from '../materialRequest.js';
import { eciFlow, ppapFlow } from '../npi.js';
import { crFlow } from '../peLink.js';
import { discrepancyFlow } from '../stockDiscrepancy.js';
import { prFlow } from '../mtnPurchase.js';

/* 🪜 แถบ "ถึงขั้นไหน" ของแต่ละโมดูล (UI §6.30) — คีย์สถานะต้องตรงทะเบียนของโมดูล · ข้าม = skipped ไม่ใช่ done */
const st = (f) => f.steps.map(s => s.state + (s.tone ? '/' + s.tone : ''));

test('ncFlow ถังเหลือง/แดง — รอ QA · ซ่อม · ตรวจรับ · ทำลายข้ามซ่อม (skipped) · จบ', () => {
  assert.deepEqual(st(ncFlow({ bin: 'yellow' })), ['done', 'current', 'todo', 'todo', 'todo']);
  assert.match(ncFlow({ bin: 'yellow' }).waiting, /QA/);
  assert.deepEqual(st(ncFlow({ bin: 'yellow', qa_decision: 'repair' })), ['done', 'done', 'current', 'todo', 'todo']);
  assert.deepEqual(st(ncFlow({ bin: 'yellow', qa_decision: 'repair', repair_date: 'x' })), ['done', 'done', 'done', 'current', 'todo']);
  assert.deepEqual(st(ncFlow({ bin: 'yellow', qa_decision: 'scrap' })), ['done', 'done', 'skipped', 'skipped', 'current']);
  assert.deepEqual(st(ncFlow({ bin: 'red' })), ['done', 'done', 'skipped', 'skipped', 'current']);
  // งานดี = จบที่ขั้น 2 ที่เหลือไม่ต้องทำ (ห้ามเขียวยาว)
  const good = ncFlow({ bin: 'yellow', qa_decision: 'good' });
  assert.equal(good.closed, true); assert.deepEqual(st(good), ['done', 'done', 'skipped', 'skipped', 'skipped']);
  assert.equal(ncFlow(null).known, false);
});

test('QA docs — NCR · 8D · เคลม (ยกเลิก = เทาที่ขั้นแรก)', () => {
  assert.deepEqual(st(ncrFlow({ status: 'containment' })), ['done', 'current', 'todo', 'todo']);
  assert.deepEqual(st(ncrFlow({ status: 'cancelled' })), ['done/none', 'todo', 'todo', 'todo']);
  assert.deepEqual(st(capaFlow({ status: 'verify' })), ['done', 'done', 'current', 'todo']);
  assert.equal(capaFlow({ status: 'closed' }).closed, true);
  assert.deepEqual(st(claimFlow({ status: 'replied' })), ['done', 'done', 'current', 'todo']);
  assert.equal(claimFlow({ status: 'weird' }).known, false);
});

test('ใบขอเบิก FM-STO-003 · ใบขอซื้อ MTN · ผลต่างรับ-ส่ง · คำขอแก้เอกสาร PE', () => {
  assert.deepEqual(st(matReqFlow({ status: 'approved', kind: 'withdraw' })), ['done', 'done', 'current', 'todo']);
  assert.match(matReqFlow({ status: 'approved', kind: 'return' }).waiting, /คืน/);
  assert.deepEqual(st(matReqFlow({ status: 'cancelled', approved_by: 'x' })), ['done', 'done', 'done/none', 'todo']);
  assert.deepEqual(st(prFlow({ status: 'ordered' })), ['done', 'current', 'todo']);
  assert.match(prFlow({ status: 'requested' }).waiting, /เลข PR/);
  assert.deepEqual(st(prFlow({ status: 'cancelled', ordered_at: 'x' })), ['done', 'done/none', 'todo']);
  assert.deepEqual(st(discrepancyFlow({ status: 'proposed', proposed_side: 'store' })), ['done', 'current', 'todo']);
  assert.match(discrepancyFlow({ status: 'proposed', proposed_side: 'store' }).waiting, /ผลิต/);
  assert.equal(discrepancyFlow({ status: 'written_off' }).closed, true);
  assert.deepEqual(st(crFlow({ status: 'accepted' })), ['done', 'current', 'todo']);
  assert.deepEqual(st(crFlow({ status: 'rejected' })), ['done/none', 'todo', 'todo']);
});

test('NPI — ECI (ปฏิเสธ = แดงที่ขั้นอนุมัติ) · PPAP (interim = เหลือง · ตีกลับ = แดง)', () => {
  assert.deepEqual(st(eciFlow({ status: 'evaluating' })), ['done', 'current', 'todo', 'todo']);
  assert.deepEqual(st(eciFlow({ status: 'rejected' })), ['done', 'done', 'done/bad', 'todo']);
  assert.equal(eciFlow({ status: 'implemented' }).closed, true);
  assert.deepEqual(st(ppapFlow('submitted')), ['done', 'current', 'todo']);
  assert.deepEqual(st(ppapFlow('interim')), ['done', 'done', 'done/warn']);
  assert.deepEqual(st(ppapFlow('rejected')), ['done', 'done/bad', 'todo']);
  assert.deepEqual(st(ppapFlow('not_started')), ['current', 'todo', 'todo']);
});
