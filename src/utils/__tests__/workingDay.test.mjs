/* เวลาพัก "วันที่ไม่ใช่วันทำงาน" (2026-10-27 · คำสั่ง user: วันหยุดพักเที่ยง 50 → 60) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDayFrom, applyHolidayBreaks, setDayTypeMap, isWorkingDay } from '../workingDay.js';

const CAL = new Map([
  ['2026-10-26', 'working'],   // จันทร์ ทำงาน
  ['2026-10-24', 'ot15'],      // ศุกร์ แต่มาร์คเป็นวันหยุด OT×1.5
  ['2026-10-23', 'ot2'],
  ['2026-10-22', 'shutdown75'],
  ['2026-10-31', 'working'],   // เสาร์ แต่มาร์คว่าทำงาน
]);

test('วันที่มาร์คไว้ — working เท่านั้นที่เป็นวันทำงาน', () => {
  assert.equal(isWorkingDayFrom(CAL, '2026-10-26'), true);
  assert.equal(isWorkingDayFrom(CAL, '2026-10-24'), false, 'ot15 = ไม่ใช่วันทำงาน');
  assert.equal(isWorkingDayFrom(CAL, '2026-10-23'), false, 'ot2');
  assert.equal(isWorkingDayFrom(CAL, '2026-10-22'), false, 'ม.75');
  assert.equal(isWorkingDayFrom(CAL, '2026-10-31'), true, 'เสาร์ที่มาร์คว่าทำงาน');
});

test('วันที่ไม่ได้มาร์ค — จ-ศ ทำงาน · ส-อา หยุด', () => {
  assert.equal(isWorkingDayFrom(CAL, '2026-10-27'), true,  'อังคาร');
  assert.equal(isWorkingDayFrom(CAL, '2026-10-30'), true,  'ศุกร์');
  assert.equal(isWorkingDayFrom(CAL, '2026-11-01'), false, 'อาทิตย์');
  assert.equal(isWorkingDayFrom(CAL, '2026-11-07'), false, 'เสาร์');
});

test('🔴 ปฏิทินยังไม่โหลด = null (ไม่รู้) ห้ามเดาว่าเป็นวันทำงานหรือวันหยุด', () => {
  assert.equal(isWorkingDayFrom(null, '2026-10-27'), null);
  assert.equal(isWorkingDayFrom(CAL, ''), null);
  assert.equal(isWorkingDayFrom(CAL, 'ไม่ใช่วันที่'), null);
});

const POLS = [
  { id: 'lunch', duration_min: 50, duration_min_holiday: 60 },
  { id: 'brk10', duration_min: 10, duration_min_holiday: null },
  { id: 'nohol', duration_min: 20 },
];

test('🔴 เคสจริง — วันหยุด พักเที่ยง 50 → 60 · ตัวอื่นไม่ขยับ', () => {
  const out = applyHolidayBreaks(POLS, '2026-10-24', CAL);
  assert.equal(out.find(p => p.id === 'lunch').duration_min, 60);
  assert.equal(out.find(p => p.id === 'lunch').holiday_central_min, 50, 'เก็บค่าปกติไว้ให้จอเขียนเทียบ');
  assert.equal(out.find(p => p.id === 'brk10').duration_min, 10);
  assert.equal(out.find(p => p.id === 'nohol').duration_min, 20);
});

test('เสาร์-อาทิตย์ที่ไม่ได้มาร์ค ก็นับเป็นวันหยุดด้วย', () => {
  assert.equal(applyHolidayBreaks(POLS, '2026-11-01', CAL).find(p => p.id === 'lunch').duration_min, 60);
});

test('🔴 วันทำงาน = ชุดเดิมเป๊ะ (ตัวเดียวกันในหน่วยความจำ)', () => {
  assert.equal(applyHolidayBreaks(POLS, '2026-10-26', CAL), POLS);
  assert.equal(applyHolidayBreaks(POLS, '2026-10-31', CAL), POLS, 'เสาร์ที่มาร์คว่าทำงาน');
});

test('🔴 ปฏิทินไม่โหลด = ชุดเดิมเป๊ะ ห้ามหักพักเกิน', () => {
  assert.equal(applyHolidayBreaks(POLS, '2026-10-24', null), POLS);
});

test('วันหยุดไม่พักเลย (0) ตั้งได้ · ต่างจากเว้นว่าง', () => {
  const pols = [{ id: 'x', duration_min: 20, duration_min_holiday: 0 }];
  assert.equal(applyHolidayBreaks(pols, '2026-10-24', CAL)[0].duration_min, 0);
});

test('ค่าวันหยุดเท่าค่าปกติ = ไม่ต้องแตะ (ไม่สร้างอ็อบเจกต์ใหม่)', () => {
  const pols = [{ id: 'x', duration_min: 20, duration_min_holiday: 20 }];
  assert.equal(applyHolidayBreaks(pols, '2026-10-24', CAL), pols);
});

test('ทะเบียนกลาง (ambient) — companyCalendar เป็นคนป้อน', () => {
  setDayTypeMap(null);
  assert.equal(isWorkingDay('2026-10-24'), null, 'ยังไม่ป้อน = ไม่รู้');
  assert.equal(applyHolidayBreaks(POLS, '2026-10-24'), POLS, 'ไม่รู้ = เดิมเป๊ะ');
  setDayTypeMap(CAL);
  assert.equal(isWorkingDay('2026-10-24'), false);
  assert.equal(applyHolidayBreaks(POLS, '2026-10-24').find(p => p.id === 'lunch').duration_min, 60);
  setDayTypeMap(null);
});

test('อินพุตเพี้ยนไม่ระเบิด', () => {
  assert.deepEqual(applyHolidayBreaks(null, '2026-10-24', CAL), []);
  assert.deepEqual(applyHolidayBreaks([null], '2026-10-24', CAL), [null]);
});
