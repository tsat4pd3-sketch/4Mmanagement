/* เทส fourMDoc — "ย้ายคนข้ามไลน์ครั้งนี้ ต้องแนบเอกสาร OJT ใหม่ไหม"
   กฎจาก user (2026-10-12): เคยมีใบที่แนบไว้ = เงื่อนไขร่วม ·
     (ก) มีประวัติ + ทุกสกิลที่จุดต้องการ > 25 ⇒ ใช้ใบเดิม ไม่จำกัดอายุ
     (ข) นอกนั้น ⇒ ใบเดิมต้องไม่เกิน 6 เดือน
   🔴 ไม่รู้คะแนน/จุดไม่ได้ตั้งสกิล = พิสูจน์ฝีมือไม่ได้ ⇒ ตกไปทาง (ข) (fail-closed) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docRequirement, withinMonths, daysBetween, SKILL_MIN_SCORE, DOC_REUSE_MONTHS } from '../fourMDoc.js';

const T = '2026-10-12';                       // "วันนี้" ตรึงค่า — ห้ามให้ฟังก์ชันอ่านนาฬิกาเอง
const doc = (work_date, id = 'L1') => ({ id, work_date });

test('ไม่เคยมีใบที่แนบเอกสาร = ต้องแนบใหม่ (เงื่อนไขร่วม) แม้ฝีมือเต็ม', () => {
  const r = docRequirement({ hasHistory: true, reqScores: [100, 100], priorDoc: null, today: T });
  assert.equal(r.needDoc, true);
  assert.equal(r.waivedBy, null);
  assert.equal(r.refLogId, null);
  assert.match(r.reason, /ไม่เคยมีใบ/);
});

test('(ก) มีประวัติ + ทุกสกิล > 25 = ใช้ใบเดิมได้ แม้ใบเก่า 2 ปี', () => {
  const r = docRequirement({ hasHistory: true, reqScores: [30, 80], priorDoc: doc('2024-10-12'), today: T });
  assert.equal(r.needDoc, false);
  assert.equal(r.waivedBy, 'skill');
  assert.equal(r.refLogId, 'L1');
  assert.equal(r.ageDays, 730);
  assert.match(r.reason, /เคยทำจุดนี้/);
});

test('🔴 คะแนนเท่ากับ 25 พอดี = ยังไม่ผ่าน ("มากเกินกว่า 25")', () => {
  const r = docRequirement({ hasHistory: true, reqScores: [SKILL_MIN_SCORE], priorDoc: doc('2024-01-01'), today: T });
  assert.equal(r.needDoc, true, '25 ไม่ใช่ > 25 ⇒ ตกไปทาง (ข) และใบเกิน 6 เดือน');
});

test('🔴 สกิลใดสกิลหนึ่งไม่ถึง = ยังไม่ผ่าน (ต้องผ่าน "ทุกสกิล")', () => {
  const r = docRequirement({ hasHistory: true, reqScores: [90, 10], priorDoc: doc('2024-01-01'), today: T });
  assert.equal(r.needDoc, true);
});

test('(ข) สกิลไม่ถึง แต่ใบเดิมภายใน 6 เดือน = ใช้ใบเดิมได้', () => {
  const r = docRequirement({ hasHistory: true, reqScores: [10], priorDoc: doc('2026-05-20'), today: T });
  assert.equal(r.needDoc, false);
  assert.equal(r.waivedBy, 'recent');
  assert.match(r.reason, new RegExp(`ภายใน ${DOC_REUSE_MONTHS} เดือน`));
});

test('(ข) ใบเดิมเกิน 6 เดือน + สกิลไม่ถึง = ต้องแนบใหม่ พร้อมบอกเหตุผล', () => {
  const r = docRequirement({ hasHistory: true, reqScores: [10], priorDoc: doc('2026-03-01'), today: T });
  assert.equal(r.needDoc, true);
  assert.match(r.reason, /เกิน 6 เดือน/);
  assert.ok(r.ageDays > 180);
});

test('ไม่มีประวัติ แต่สกิลเต็ม = ตกไปทาง (ข) (ทาง ก ต้องมีทั้งประวัติและสกิล)', () => {
  const near = docRequirement({ hasHistory: false, reqScores: [100], priorDoc: doc('2026-09-01'), today: T });
  assert.equal(near.waivedBy, 'recent', 'ใบใหม่ ⇒ ยังยกเว้นได้ แต่ด้วยเหตุ "ใบสด" ไม่ใช่ "ฝีมือ"');
  const old = docRequirement({ hasHistory: false, reqScores: [100], priorDoc: doc('2025-01-01'), today: T });
  assert.equal(old.needDoc, true, 'ใบเก่า + ไม่มีประวัติ ⇒ ต้องแนบใหม่');
});

test('🔴 fail-closed — ยังไม่รู้คะแนน (null) หรือจุดไม่ได้ตั้งสกิล ([]) = พิสูจน์ฝีมือไม่ได้', () => {
  for (const scores of [null, undefined, []]) {
    const old = docRequirement({ hasHistory: true, reqScores: scores, priorDoc: doc('2024-01-01'), today: T });
    assert.equal(old.needDoc, true, String(scores));
    const near = docRequirement({ hasHistory: true, reqScores: scores, priorDoc: doc('2026-09-01'), today: T });
    assert.equal(near.waivedBy, 'recent', 'ยังยกเว้นด้วย "ใบสด" ได้ แต่ห้ามยกเว้นด้วย "ฝีมือ"');
  }
});

test('ขอบ 6 เดือน — วันเดียวกันของเดือนที่ 6 ยังนับว่าอยู่ในกรอบ · เลยไป 1 วัน = หลุด', () => {
  assert.equal(withinMonths('2026-04-12', '2026-10-12'), true,  'ครบ 6 เดือนพอดี = ยังใช้ได้');
  assert.equal(withinMonths('2026-04-12', '2026-10-13'), false, 'เลยมา 1 วัน = หลุด');
});

test('ขอบสิ้นเดือน — 31/08 + 6 เดือน ถูก clamp ลงเป็นวันสุดท้ายของ ก.พ.', () => {
  assert.equal(withinMonths('2025-08-31', '2026-02-28'), true);
  assert.equal(withinMonths('2025-08-31', '2026-03-01'), false);
  // ปีอธิกสุรทิน: 31/08/2027 + 6 = 29/02/2028
  assert.equal(withinMonths('2027-08-31', '2028-02-29'), true);
});

test('วันที่แกะไม่ออก = ไม่ยกเว้น (ห้ามเดา)', () => {
  assert.equal(withinMonths('', T), false);
  assert.equal(withinMonths('ไม่ใช่วันที่', T), false);
  assert.equal(daysBetween('x', T), null);
  const r = docRequirement({ hasHistory: true, reqScores: [10], priorDoc: doc('ไม่ใช่วันที่'), today: T });
  assert.equal(r.needDoc, true);
  assert.equal(r.ageDays, null, 'อายุคำนวณไม่ได้ = null ห้ามคืน 0');
});

test('เรียกแบบไม่ส่งอะไรเลย = ต้องแนบ (ไม่โยน error)', () => {
  assert.equal(docRequirement().needDoc, true);
  assert.equal(docRequirement({}).needDoc, true);
});

test('⏱️ ผลลัพธ์ขึ้นกับ `today` ที่ส่งเข้ามาเท่านั้น — ไม่อ่านนาฬิกาเครื่อง', () => {
  const p = { hasHistory: true, reqScores: [10], priorDoc: doc('2026-05-20') };
  assert.equal(docRequirement({ ...p, today: '2026-10-12' }).needDoc, false);
  assert.equal(docRequirement({ ...p, today: '2027-11-15' }).needDoc, true, 'นาฬิกา +400 วัน = ผลต้องเปลี่ยนตาม today');
});
