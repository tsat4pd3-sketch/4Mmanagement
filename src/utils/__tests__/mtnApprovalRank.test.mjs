/* 🔒 ช่อง "ผู้จัดการ…" ในใบ MO ต้องเช็คระดับตำแหน่ง (2026-10-30 · หน้างานแจ้ง)
   "มีคนอนุมัติแทนพี่แล้ว" — วิศวกร (engineer=30) เซ็นช่อง "ผู้จัดการต้นสังกัด" ได้
   เพราะด่านเดิมเช็คแค่ can('approve') ไม่ดูตำแหน่ง
   🔴 เกณฑ์ 50 ไม่ใช่ 60 — พิสูจน์กับทะเบียนจริง (นับ `sections` ขอบเขตที่ดูแล ไม่ใช่ `section` บ้าน):
      ตั้ง 60 = JIG MTN + Planning&Store ไม่มีใครเซ็นได้เลย (มีแต่ dept_head) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSignMtnApproval, APPROVAL_MIN_RANK } from '../mtnStepPerm.js';

const order = { dept_manager_name: 'ภูเบษ', dept_manager_at: null };
const yes = () => true;

test('เกณฑ์คือ 50 (หัวหน้าแผนก) — ตั้ง 60 จะล็อกส่วนงานที่ไม่มี manager ตาย', () => {
  assert.equal(APPROVAL_MIN_RANK, 50);
});

test('🔴 วิศวกร (30) เซ็นช่องผู้จัดการไม่ได้ แม้ถือสิทธิ์ approve', () => {
  const v = canSignMtnApproval('dept', { order, fullName: 'ใครก็ได้', can: yes, posRank: 30 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'rank_too_low');
});

test('🔴 ตำแหน่งไม่ถึง = บล็อกแม้ถูกระบุชื่อไว้ในใบ (ผู้แจ้งพิมพ์ชื่อตัวเองได้)', () => {
  const v = canSignMtnApproval('dept', { order, fullName: 'ภูเบษ', can: () => false, posRank: 30 });
  assert.equal(v.ok, false, 'ชื่อตรงแต่ตำแหน่งไม่ถึง ต้องบล็อก');
  assert.equal(v.code, 'rank_too_low');
});

test('หัวหน้าแผนก (50) และผู้จัดการ (60) เซ็นได้', () => {
  for (const r of [50, 60]) {
    assert.equal(canSignMtnApproval('dept', { order, fullName: 'x', can: yes, posRank: r }).ok, true, `rank ${r}`);
  }
});

test('🔴 ไม่รู้ตำแหน่ง = ไม่บล็อก (ไม่รู้ ≠ ไม่ใช่) — จอต้องเขียนว่าไม่ได้ตรวจ', () => {
  assert.equal(canSignMtnApproval('dept', { order, fullName: 'x', can: yes, posRank: null }).ok, true);
});

test('เซ็นไปแล้ว = บล็อกก่อนเช็คตำแหน่งเสมอ', () => {
  const signed = { ...order, dept_manager_at: '2026-10-30T09:48:00Z' };
  assert.equal(canSignMtnApproval('dept', { order: signed, can: yes, posRank: 60 }).code, 'already_signed');
});

test('ไม่ส่ง posRank = พฤติกรรมเดิมเป๊ะ (ตัวเรียกเก่าไม่พัง)', () => {
  assert.equal(canSignMtnApproval('dept', { order, fullName: 'x', can: yes }).ok, true);
});

/* ── ชั้น ③ ขอบเขตหน่วยงาน (01/11) — audit รอบ 15/10 ไม่ได้ครอบด่านนี้ ──
   พิสูจน์กับประวัติจริง 64 ลายเซ็น: ไม่มีใครที่เซ็นถูกโดนบล็อกด้วยขอบเขตเลย
   ดุลยทรรศน์ (manager PD3 · sections [PD3,PD4]) เซ็นใบ PD4 ไป 6 ครั้ง = "ดูแลควบแผนก" ต้องผ่าน */

test('🔴 ใบนอกขอบเขต = เซ็นไม่ได้ แม้ตำแหน่งถึงและถือสิทธิ์ approve', () => {
  const v = canSignMtnApproval('dept', { order, fullName: 'x', can: yes, posRank: 60, inReporterScope: false });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'out_of_scope');
});

test('ดูแลควบแผนก: ใบอยู่ในขอบเขตที่รับผิดชอบ = เซ็นได้', () => {
  assert.equal(canSignMtnApproval('dept', { order, fullName: 'x', can: yes, posRank: 60, inReporterScope: true }).ok, true);
});

test('🔴 ตัดสินขอบเขตไม่ได้ (null) = ไม่บล็อก — กติกาเดียวกับ canDoStep', () => {
  assert.equal(canSignMtnApproval('dept', { order, fullName: 'x', can: yes, posRank: 60, inReporterScope: null }).ok, true);
});

test('ตำแหน่งถูกเช็คก่อนขอบเขต — ตำแหน่งไม่ถึงต้องบอกว่าเป็นเรื่องตำแหน่ง', () => {
  const v = canSignMtnApproval('dept', { order, fullName: 'x', can: yes, posRank: 30, inReporterScope: false });
  assert.equal(v.code, 'rank_too_low');
});
