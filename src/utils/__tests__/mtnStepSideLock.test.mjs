/* 🔒 ล็อก "ตำแหน่ง + ฝั่ง" ของคนกดในลูป MO — 2026-10-02 (คำสั่ง user)
   เทสนี้ตรึง 4 รูรั่วที่วัดเจอจริง (ดูหัวข้อในหัว mtnStepPerm.js) ห้ามให้กลับมา */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDoStep, actorSideOf, stepAssumptions } from '../mtnStepPerm.js';

const ORDER = { id: 'x', mtn_dept: 'maintenance', reported_by_name: 'ผู้แจ้ง ก', line_name: 'HDF1', dept_section: 'PD3' };
/** ctx ตั้งต้น: มีคีย์ครบ ไม่ใช่ผู้เปิดใบ ไม่ใช่หัวหน้า */
const ctx = (over = {}) => ({
  order: ORDER, fullName: 'คนอื่น', mtnForm: true,
  can: (a) => ['approve', 'close_cost', 'mtn_head', 'handover'].includes(a),
  seeded: () => true, ...over,
});

test('actorSideOf — ตัดสินจากข้อมูลที่บันทึกไว้จริงเท่านั้น', () => {
  assert.equal(actorSideOf({ mtnTeams: ['maintenance'] }), 'mtn');
  assert.equal(actorSideOf({ role: 'mtn' }), 'mtn');
  assert.equal(actorSideOf({ sections: ['PD3'] }), 'reporter');
  assert.equal(actorSideOf({}), 'unknown', 'ไม่มีข้อมูล = unknown ห้ามเดาเป็นฝั่งใดฝั่งหนึ่ง');
  assert.equal(actorSideOf({ mtnTeams: ['maintenance'], sections: ['PD3'] }), 'mtn', 'มีทีมช่าง = ฝั่งช่าง แม้จะผูกส่วนงานไว้ด้วย');
});

test('🔒 รู 3 — ผจก.ช่าง กดขั้น "ผจก.ฝ่ายที่แจ้ง อนุมัติปิดใบ" (ขั้น 8) ไม่ได้อีกแล้ว', () => {
  const v = canDoStep(8, ctx({ actorSide: 'mtn', posRank: 60 }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'wrong_side');
  assert.equal(v.need, 'reporter');
});

test('🔒 ฝั่งผู้แจ้งก็กดขั้นของช่างไม่ได้เหมือนกัน (ขั้น 7 ผจก.ช่าง)', () => {
  const v = canDoStep(7, ctx({ actorSide: 'reporter', posRank: 60 }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'wrong_side');
});

test('🔒 รู 4 — หัวหน้าแผนก (rank 50) กดขั้นระดับ ผจก. (rank 60) ไม่ได้', () => {
  const v = canDoStep(8, ctx({ actorSide: 'reporter', posRank: 50 }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'rank_too_low');
  assert.equal(v.needRank, 60);
  // ผจก.ฝั่งเดียวกันกดได้ตามปกติ
  assert.equal(canDoStep(8, ctx({ actorSide: 'reporter', posRank: 60 })).ok, true);
});

test('🔒 รู 1 — ล็อกเต็ม: แม้แต่ manage_master ก็เซ็นข้ามฝั่งไม่ได้ (ข้อ "ก" · user 2026-10-04)', () => {
  const boss = ctx({ actorSide: 'mtn', posRank: 60, can: () => true });   // ถือคีย์ครบทุกใบรวม manage_master
  const v = canDoStep(8, boss);
  assert.equal(v.ok, false, 'ช่อง "ผจก.ฝ่ายที่แจ้ง" ฝั่งช่างกดไม่ได้ ต่อให้เป็นหัวหน้า');
  assert.equal(v.code, 'wrong_side');
  // ขั้นของฝั่งตัวเอง = ยังกดได้ตามปกติ (คีย์หัวหน้าปลดได้แค่เรื่องสิทธิ์/ลำดับขั้น ไม่ใช่เรื่องฝั่ง)
  assert.equal(canDoStep(7, ctx({ actorSide: 'mtn', posRank: 60, can: () => true })).ok, true);
});

test('🔒 ล็อกเต็ม — manage_master ตำแหน่งต่ำกว่าช่องนั้น ก็กดไม่ได้', () => {
  const v = canDoStep(8, ctx({ actorSide: 'reporter', posRank: 50, can: () => true }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'rank_too_low');
  assert.equal(v.needRank, 60);
});

test('🔴 รู 2 — ข้อมูลไม่ครบ = ไม่บล็อก แต่ต้องติดธงให้จอเขียนบอก (ห้ามเงียบ)', () => {
  // คนที่ยังไม่กรอก mtn_teams/sections และไม่มีตำแหน่ง — เดิมผ่านเงียบสนิท
  const v = canDoStep(8, ctx({ actorSide: 'unknown', posRank: null }));
  assert.equal(v.ok, true, 'บล็อกคนข้อมูลไม่ครบ = ใบค้างทั้งโรงงาน (31% ยังไม่มี sections)');
  assert.deepEqual(stepAssumptions(8, { mtnForm: true, actorSide: 'unknown', posRank: null }), ['side', 'rank'],
    'ต้องบอกได้ว่าปล่อยผ่านเพราะ "ไม่รู้" ทั้ง 2 เรื่อง');
});

test('ผู้เปิดใบทำขั้นของตัวเองได้เสมอ — ด่านใหม่ต้องไม่ล็อกเจ้าของใบออก', () => {
  // ขั้น 5 ของใบ MTN = รับมอบ (byReporter) · ผู้เปิดใบเป็นฝั่งช่างก็ยังรับมอบงานตัวเองได้
  const v = canDoStep(5, ctx({ fullName: 'ผู้แจ้ง ก', actorSide: 'mtn', posRank: 10 }));
  assert.equal(v.ok, true);
  assert.equal(v.code, 'reporter');
});

test('ขั้นที่ไม่ได้ผูกฝั่ง/ตำแหน่ง ต้องไม่ติดธงเดา (ห้ามขึ้นคำเตือนพร่ำเพรื่อ)', () => {
  const v = canDoStep(4, ctx({ actorSide: 'unknown', posRank: null, can: (a) => a === 'accept_work' }));
  assert.equal(v.ok, true);
  assert.deepEqual(stepAssumptions(4, { mtnForm: true, actorSide: 'unknown', posRank: null }), ['side'],
    'ขั้น 4 ผูกฝั่งไว้แต่ไม่ผูกตำแหน่ง ⇒ เดาเรื่องฝั่งอย่างเดียว');
  assert.deepEqual(stepAssumptions(3, { mtnForm: true, actorSide: 'mtn', posRank: 20 }), [], 'รู้ครบ = ไม่มีอะไรต้องเดา');
});
