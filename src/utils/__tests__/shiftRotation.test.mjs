/**
 * เทสโค้ดจริงของ src/utils/shiftRotation.js — กติกาที่ห้าม regress:
 *   1. ตรวจรอบ 2 สัปดาห์ได้จากข้อมูลจริงของโรงงาน (Line 60 / GOR ที่ตรงข้ามกัน)
 *   2. **ทนช่องว่าง** — GOR ขาดสัปดาห์ 10-16/08 จริง ต้องยังตรวจได้ว่าเป็นรอบ 2 สัปดาห์
 *   3. pattern ไม่ชัด (ยังไม่เคยสลับ / สลับมั่ว / ประวัติน้อย) = ok:false + เหตุผล **ห้ามเดา**
 *   4. ห้ามทับสัปดาห์ที่มีข้อมูลอยู่แล้ว
 *   5. วันที่เป็น local ล้วน — ข้ามเดือน/ข้ามปีต้องไม่เพี้ยน
 * ไฟล์นี้ pure ไม่ import supabase → เทสตรงได้เลย ไม่ต้อง bundle
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mondayOf, addDays, weeksBetween, detectRotation, teamForWeek, projectWeeks } from '../shiftRotation.js';

/* ── ข้อมูลจริงจากฐาน (2026-07-20 เป็นต้นมา) ── */
const LINE60 = [
  ['2026-07-20','A'],['2026-07-27','A'],['2026-08-03','B'],['2026-08-10','B'],
  ['2026-08-17','A'],['2026-08-24','A'],['2026-08-31','B'],
].map(([monday, team]) => ({ monday, team }));

// GOR สลับตรงข้าม Line 60 และ **ขาดสัปดาห์ 10-16/08 จริงในฐาน**
const GOR = [
  ['2026-07-20','B'],['2026-07-27','B'],['2026-08-03','A'],['2026-08-17','B'],
].map(([monday, team]) => ({ monday, team }));

test('mondayOf — ทุกวันในสัปดาห์ชี้วันจันทร์เดียวกัน (อาทิตย์ = จันทร์ของสัปดาห์นั้น ไม่ใช่ถัดไป)', () => {
  for (const d of ['2026-08-24','2026-08-27','2026-08-30']) assert.equal(mondayOf(d), '2026-08-24');
  assert.equal(mondayOf('2026-08-31'), '2026-08-31');
});

test('addDays / weeksBetween ข้ามเดือนและข้ามปีไม่เพี้ยน', () => {
  assert.equal(addDays('2026-08-31', 7), '2026-09-07');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
  assert.equal(weeksBetween('2026-07-20', '2026-08-31'), 6);
  assert.equal(weeksBetween('2026-08-31', '2026-07-20'), -6);
});

test('ตรวจรอบ 2 สัปดาห์จากข้อมูลจริง Line 60', () => {
  const r = detectRotation(LINE60);
  assert.equal(r.ok, true);
  assert.equal(r.periodWeeks, 2);
  assert.equal(r.anchorTeam, 'A');
  assert.equal(r.lastMonday, '2026-08-31');
});

test('ทนช่องว่าง — GOR ขาดสัปดาห์กลาง ยังตรวจได้ว่ารอบ 2 สัปดาห์', () => {
  const r = detectRotation(GOR);
  assert.equal(r.ok, true);
  assert.equal(r.periodWeeks, 2);
  assert.equal(r.anchorTeam, 'B');
  // สัปดาห์ที่หายไปต้องเติมได้ถูกจังหวะ (03-16/08 = A ทั้งบล็อก)
  assert.equal(teamForWeek(r, '2026-08-10'), 'A');
});

test('ต่อไปข้างหน้าถูกจังหวะ และ GOR ตรงข้าม Line 60 เสมอ', () => {
  const a = detectRotation(LINE60), b = detectRotation(GOR);
  for (const m of ['2026-08-31','2026-09-07','2026-09-14','2026-09-21','2026-09-28']) {
    assert.notEqual(teamForWeek(a, m), teamForWeek(b, m), `สัปดาห์ ${m} ต้องตรงข้ามกัน`);
  }
  assert.equal(teamForWeek(a, '2026-09-14'), 'A');
  assert.equal(teamForWeek(a, '2026-09-28'), 'B');
});

test('teamForWeek ย้อนหลังก่อน anchor ไม่เพี้ยน (index ติดลบ)', () => {
  const r = detectRotation(LINE60);
  assert.equal(teamForWeek(r, '2026-07-13'), 'B');   // บล็อกก่อนหน้า
  assert.equal(teamForWeek(r, '2026-07-06'), 'B');
  assert.equal(teamForWeek(r, '2026-06-29'), 'A');
});

test('pattern ไม่ชัด = ok:false พร้อมเหตุผล ห้ามเดา', () => {
  const only1 = detectRotation([{ monday: '2026-08-24', team: 'A' }]);
  assert.equal(only1.ok, false);
  const noFlip = detectRotation([
    { monday: '2026-08-10', team: 'A' }, { monday: '2026-08-17', team: 'A' }, { monday: '2026-08-24', team: 'A' },
  ]);
  assert.equal(noFlip.ok, false);
  assert.match(noFlip.reason, /สลับ/);
  const messy = detectRotation([
    { monday: '2026-07-20', team: 'A' }, { monday: '2026-07-27', team: 'B' },
    { monday: '2026-08-03', team: 'B' }, { monday: '2026-08-10', team: 'B' },
    { monday: '2026-08-17', team: 'A' },
  ]);
  assert.equal(messy.ok, false);
});

test('ทีม C / ค่าที่ไม่ใช่ A-B ไม่เข้ารอบสลับ', () => {
  const r = detectRotation([
    { monday: '2026-08-10', team: 'C' }, { monday: '2026-08-17', team: 'C' },
  ]);
  assert.equal(r.ok, false);
});

test('projectWeeks ห้ามทับสัปดาห์ที่มีอยู่แล้ว และต้องรายงานว่าข้ามไปกี่สัปดาห์', () => {
  const rot = detectRotation(LINE60);
  const { weeks, skipped } = projectWeeks({
    rotation: rot, fromMonday: '2026-08-24', count: 4,
    existingMondays: ['2026-08-24', '2026-08-31'],
  });
  assert.equal(skipped, 2);
  assert.deepEqual(weeks, [
    { monday: '2026-09-07', team: 'B' },
    { monday: '2026-09-14', team: 'A' },
  ]);
});

test('projectWeeks กับ rotation ที่ ok:false = ไม่ได้อะไรเลย (ไม่ระเบิด ไม่เดา)', () => {
  const { weeks } = projectWeeks({
    rotation: { ok: false }, fromMonday: '2026-08-24', count: 4,
  });
  assert.deepEqual(weeks, []);
});
