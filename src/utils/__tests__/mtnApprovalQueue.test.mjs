/* 🔒 ด่าน "ผู้จัดการอนุมัติก่อนเริ่มงาน" ต้องมีกองของตัวเอง — 2026-10-13 · คำสั่ง user
 *
 * ที่มา: *"อันนี้มีงานรอเราอนุมัติ MO แต่เราหาไม่เจอ — ผู้จัดการฝ่ายที่แจ้งต้องอนุมัติให้ MTN ดำเนินการ"*
 * ใบ improve/build ที่ยังไม่มีลายเซ็น ผจก. ช่างกดรับงานไม่ได้ แต่ `nextStepOf()` คืน 2 ("รับงาน/จ่ายงาน")
 * ⇒ ตัวกรอง "รอขั้นไหน" · คิวงานของฉัน · กระดิ่ง เหมาใบนี้ไปกองของช่าง = ไม่มีใครเห็นว่ารอตัวเอง
 * เทสนี้กันไม่ให้กองนี้กลับไปยุบรวมกับ "รอช่างรับงาน" อีก
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isApprovalBlocked, approvalKindPending } from '../mtnMoForm.js';
import {
  moWaitMeta, approvalWaitsOnMe, STAGE_APPROVE_FIRST, moStatusLabel, MO_LABEL_WAIT_APPROVAL,
} from '../mtnStepPerm.js';
import { buildQueue, moWaitingOn, TIER } from '../myQueue.js';

/** ใบ MTN งานปรับปรุงที่ยังไม่มีใครเซ็น (เคสจริง: ติดตั้งเครื่องดูดควัน · LINE APRON ASSY) */
const BLOCKED = {
  id: 'mo1', status: 'pending', purpose: 'improve', mtn_dept: 'maintenance',
  dept_section: 'LINE APRON ASSY', line_name: 'LINE APRON ASSY', work_date: '2026-10-13',
  dept_manager_at: null, plant_manager_at: null, dept_manager_name: null,
  reported_by_name: 'สุวิทย์ชัย ดีทั่ว',
};
const SIGNED = { ...BLOCKED, dept_manager_at: '2026-10-13T04:23:02Z', dept_manager_name: 'ผจก.' };

test('ใบที่ยังไม่มีลายเซ็น = ติดด่าน · เซ็นแล้ว = ไม่ติด', () => {
  assert.equal(isApprovalBlocked(BLOCKED), true);
  assert.equal(approvalKindPending(BLOCKED), 'dept');
  assert.equal(isApprovalBlocked(SIGNED), false);
  assert.equal(approvalKindPending(SIGNED), null);
});

test('งานซ่อม/บริการ ไม่ติดด่าน (เซ็นตามหลังได้ — ไลน์ห้ามหยุดรออนุมัติ)', () => {
  for (const purpose of ['repair', 'service']) {
    assert.equal(isApprovalBlocked({ ...BLOCKED, purpose }), false, purpose);
  }
});

test('🔴 ไม่ได้ select คอลัมน์ลายเซ็นมา = "ไม่รู้" ห้ามเดาว่าติดด่าน', () => {
  const noCols = { ...BLOCKED };
  delete noCols.dept_manager_at; delete noCols.plant_manager_at;   // = ไม่ได้ select มา
  assert.equal(isApprovalBlocked(noCols), false);
  // งานสร้างต้องเห็นช่อง ผจก.โรงงานด้วย — ขาดไป = ตัดสินไม่ได้
  assert.equal(isApprovalBlocked({ ...BLOCKED, purpose: 'build', plant_manager_at: undefined }), false);
  assert.equal(isApprovalBlocked({ ...BLOCKED, purpose: 'build' }), true);
});

test('🔴 ด่านอนุมัติชนะเลขขั้น — ห้ามถูกนับเป็น "รอช่างรับงาน"', () => {
  const w = moWaitMeta(BLOCKED);
  assert.equal(w.stage, STAGE_APPROVE_FIRST);
  assert.equal(w.step, null);                       // ไม่มีเลขขั้น ⇒ ห้ามส่งต่อ canDoStep
  assert.match(w.meta.title, /ผู้จัดการอนุมัติ/);
  assert.equal(w.meta.whoShort, 'ผจก.ฝ่ายที่แจ้ง');
  // พอเซ็นแล้วจึงตกไปเป็นงานของช่างตามเดิม
  assert.equal(moWaitMeta(SIGNED).stage, 'assign');
  assert.equal(moWaitMeta(SIGNED).step, 2);
});

test('ป้ายสถานะบนจอต้องบอกว่าติดด่าน (ไม่ใช่ "รอรับงาน")', () => {
  assert.equal(moStatusLabel(BLOCKED), MO_LABEL_WAIT_APPROVAL);
  assert.notEqual(moStatusLabel(SIGNED), MO_LABEL_WAIT_APPROVAL);
});

const MGR = { name: 'ผจก. สมชาย', actorSide: 'reporter', posRank: 60, can: (a) => a === 'approve' };

test('ผู้ถือสิทธิ์อนุมัติฝั่งผู้แจ้ง + ตำแหน่งถึงเกณฑ์ = ช่องนี้รอคนนี้', () => {
  assert.equal(approvalWaitsOnMe(BLOCKED, MGR), true);
});

test('🔴 ไม่รู้ฝั่ง/ฝั่งช่าง/ตำแหน่งไม่ถึง = ไม่นับ (ไม่รู้ ≠ ใช่)', () => {
  assert.equal(approvalWaitsOnMe(BLOCKED, { ...MGR, actorSide: 'mtn' }), false);
  assert.equal(approvalWaitsOnMe(BLOCKED, { ...MGR, actorSide: 'unknown' }), false);
  assert.equal(approvalWaitsOnMe(BLOCKED, { ...MGR, actorSide: null }), false);
  assert.equal(approvalWaitsOnMe(BLOCKED, { ...MGR, posRank: 40 }), false);
  assert.equal(approvalWaitsOnMe(BLOCKED, { ...MGR, posRank: null }), false);
});

test('🔴 manage_master ไม่นับ — ไม่งั้น admin ได้ใบรออนุมัติทั้งโรงงานเป็น "รอคุณ"', () => {
  const admin = { name: 'ADMIN', actorSide: 'reporter', posRank: 90, can: (a) => a === 'manage_master' };
  assert.equal(approvalWaitsOnMe(BLOCKED, admin), false);
});

test('ชื่ออยู่ในใบ = เซ็นได้เลย แม้ไม่ถือสิทธิ์/ไม่รู้ตำแหน่ง', () => {
  const named = { ...BLOCKED, dept_manager_name: 'ผจก. สมชาย' };
  assert.equal(approvalWaitsOnMe(named, { name: 'ผจก. สมชาย' }), true);
});

test('เซ็นแล้วต้องหายจากคิวทันที (ไม่มีช่องค้าง = ไม่รอใคร)', () => {
  assert.equal(approvalWaitsOnMe(SIGNED, MGR), false);
});

/* ── ชั้นคิว ────────────────────────────────────────────────────────────── */

test('ผจก.ฝ่ายที่แจ้ง: ใบเข้าชั้น "รอคุณ" + ติดธงเซ็น (= ขึ้น badge/กระดิ่ง)', () => {
  const me = { ...MGR, sections: ['LINE APRON ASSY'] };
  const q = buildQueue({ mo: [BLOCKED], sessions: [], fourM: [], actions: [] }, me);
  assert.equal(q.mine.length, 1);
  assert.equal(q.mine[0].sign, true);
  assert.match(q.mine[0].title, /ผู้จัดการอนุมัติ/);
  assert.equal(q.mine[0].to, '/mtn-repair?mo=mo1');
});

test('🔴 คนอื่น: สรุปชั้นโรงงานต้องแยกกองจาก "รอช่างรับงาน" + ลิงก์พาไปถึงกองนั้น', () => {
  const tech = { name: 'ช่าง', actorSide: 'mtn', posRank: 10, can: () => false, sections: [] };
  const q = buildQueue({ mo: [BLOCKED, SIGNED], sessions: [], fourM: [], actions: [] }, tech);
  const appr = q.floor.find(f => f.key === `mowait:${STAGE_APPROVE_FIRST}`);
  const assign = q.floor.find(f => f.key === 'mowait:assign');
  assert.ok(appr, 'ต้องมีบรรทัดสรุปของกองรออนุมัติ');
  assert.equal(appr.count, 1);
  assert.equal(assign.count, 1);                     // ใบที่เซ็นแล้วอยู่กองช่างตามเดิม
  assert.match(appr.to, new RegExp(`wait=${STAGE_APPROVE_FIRST}`));
  assert.match(appr.detail, /ผจก\.ฝ่ายที่แจ้ง/);
});

test('moWaitingOn คืน meta ของด่าน (ไม่ใช่ meta ขั้น 2) และไม่ชี้ชื่อคน', () => {
  const w = moWaitingOn(BLOCKED);
  assert.equal(w.byName, false);
  assert.equal(w.step, null);
  assert.equal(w.meta.stage, STAGE_APPROVE_FIRST);
  assert.equal(TIER.MINE, TIER.MINE);
});
