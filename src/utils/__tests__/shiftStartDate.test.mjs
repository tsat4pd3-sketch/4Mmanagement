/* วันของ "เวลาเริ่มกะ" — กะดึกที่บันทึกเวลาเริ่ม 00:00–07:59 คือเช้าของวันถัดไป (QC 06/10)
   เคยมี 2 ชุดที่ตัดสินไม่เหมือนกัน: `computeLiveOee` บวก 1 วัน · `shiftFrameOf` ไม่บวก
   ⇒ กรอบกะเร็วไป 20 ชม. ⇒ clampWinToShift รัด downtime/ช่วงพาร์ททิ้งทั้งหมดแบบเงียบ
   วัดฐานจริง: 5 กะ (23/09–05/10) เข้าเงื่อนไขนี้ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftStartDate, shiftFrameOf } from '../oee.js';

const at = (ms) => new Date(ms).toLocaleString('sv');   // 'YYYY-MM-DD HH:MM:SS' ตามเวลาเครื่อง

test('shiftStartDate — กะดึกเริ่ม 00:00–07:59 = วันถัดไป · ที่เหลือคงวันเดิม', () => {
  assert.equal(shiftStartDate('2026-10-05', '02:00', 'night'), '2026-10-06');
  assert.equal(shiftStartDate('2026-10-05', '00:00', 'night'), '2026-10-06');
  assert.equal(shiftStartDate('2026-10-05', '07:59', 'night'), '2026-10-06');
  // กะดึกเข้างานปกติ 22:30 (ชั่วโมง ≥ 8) ห้ามเลื่อนวัน
  assert.equal(shiftStartDate('2026-10-05', '22:30', 'night'), '2026-10-05');
  assert.equal(shiftStartDate('2026-10-05', '20:00', 'night'), '2026-10-05');
  // กะเช้าไม่เกี่ยว แม้เวลาจะหลุดกรอบ (เคสข้อมูลเสียมีจริงในฐาน — ที่นี่ไม่ใช่ที่แก้)
  assert.equal(shiftStartDate('2026-10-05', '08:00', 'day'), '2026-10-05');
  assert.equal(shiftStartDate('2026-10-05', '02:00', 'day'), '2026-10-05');
  // ข้ามเดือน/ปี
  assert.equal(shiftStartDate('2026-10-31', '03:00', 'night'), '2026-11-01');
  assert.equal(shiftStartDate('2026-12-31', '03:00', 'night'), '2027-01-01');
});

test('shiftFrameOf — กรอบกะต้องตรงกับวันที่ shiftStartDate ตัดสิน', () => {
  const night = shiftFrameOf({ work_date: '2026-10-05', start_time: '02:00', end_time: '07:00', shift: 'night' });
  assert.equal(at(night.startMs), '2026-10-06 02:00:00');
  assert.equal(at(night.endMs),   '2026-10-06 07:00:00');

  const normal = shiftFrameOf({ work_date: '2026-10-05', start_time: '22:30', end_time: '07:00', shift: 'night' });
  assert.equal(at(normal.startMs), '2026-10-05 22:30:00');
  assert.equal(at(normal.endMs),   '2026-10-06 07:00:00');   // ข้ามเที่ยงคืน = +1 วันที่ปลาย

  const day = shiftFrameOf({ work_date: '2026-10-05', start_time: '08:00', end_time: '17:30', shift: 'day' });
  assert.equal(at(day.startMs), '2026-10-05 08:00:00');
  assert.equal(at(day.endMs),   '2026-10-05 17:30:00');

  // ข้อมูลไม่พอ = null ห้ามเดา
  assert.equal(shiftFrameOf({ start_time: '08:00' }), null);
  assert.equal(shiftFrameOf({ work_date: '2026-10-05' }), null);
  // ไม่มีเวลาเลิก = รู้แค่ต้นกะ (ปลายเป็น null ไม่ใช่ 0)
  assert.equal(shiftFrameOf({ work_date: '2026-10-05', start_time: '20:00', shift: 'night' }).endMs, null);
});
