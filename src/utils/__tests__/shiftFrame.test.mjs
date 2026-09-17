/* ช่วงเวลาของพาร์ทต้องอยู่ในกะเสมอ — utils/oee §7
   บั๊กจริง 2026-09-17 (user จับได้): ใบผลิตถูกยืนยันย้อนหลังข้ามวันได้
   ⇒ window ของ MAT ยาว 24.5 ชม. ⇒ "ควรได้" 1,278 ชิ้นในกะเดียว ⇒ %P รายชิ้นเหลือ 6%
   (วัดจริงในฐาน DR วันเดียวกัน: 251 ใบ ใน 64 กะ ปิดหลังกะจบ เฉลี่ยเกิน 715 นาที สูงสุด 13,314) */
import test from 'node:test';
import assert from 'node:assert';
import { shiftFrameOf, clampWinToShift } from '../oee.js';

const ms = (s) => new Date(s).getTime();
const DAY   = { work_date: '2026-09-15', start_time: '08:00:00', end_time: '20:00:00' };
const NIGHT = { work_date: '2026-09-15', start_time: '20:00:00', end_time: '08:00:00' };

test('กะเช้า — กรอบ 08:00→20:00 ของวันเดียวกัน', () => {
  const f = shiftFrameOf(DAY);
  assert.equal(f.startMs, ms('2026-09-15T08:00:00'));
  assert.equal(f.endMs, ms('2026-09-15T20:00:00'));
  assert.equal((f.endMs - f.startMs) / 60000, 720);
});

test('กะดึก — end < start ⇒ ต้องบวก 1 วัน ไม่ใช่ติดลบ', () => {
  const f = shiftFrameOf(NIGHT);
  assert.equal(f.endMs, ms('2026-09-16T08:00:00'));
  assert.equal((f.endMs - f.startMs) / 60000, 720);
});

test('🔴 ใบที่ยืนยันข้ามวัน ต้องถูกรัดกลับมาจบที่เวลาปิดกะ', () => {
  // เคสจริง Assy LWR 15/09 กะเช้า MAT 10105769: confirmed_at = 08:30 ของวันที่ 16
  const w = clampWinToShift(ms('2026-09-15T08:00:00'), ms('2026-09-16T08:30:00'), shiftFrameOf(DAY));
  assert.equal((w.endMs - w.startMs) / 60000, 720, 'ต้องได้ 720 นาที ไม่ใช่ 1,470');
  assert.equal(w.endMs, ms('2026-09-15T20:00:00'));
});

test('ช่วงที่อยู่ในกะอยู่แล้ว ต้องไม่ถูกแตะ', () => {
  const a = ms('2026-09-15T09:10:00'), b = ms('2026-09-15T17:45:00');
  const w = clampWinToShift(a, b, shiftFrameOf(DAY));
  assert.equal(w.startMs, a);
  assert.equal(w.endMs, b);
});

test('ช่วงที่ตกนอกกะทั้งก้อน ⇒ คืน null ทั้งคู่ (ไม่ใช่ช่วงความยาว 0 หรือติดลบ)', () => {
  const w = clampWinToShift(ms('2026-09-16T09:00:00'), ms('2026-09-16T10:00:00'), shiftFrameOf(DAY));
  assert.equal(w.startMs, null);
  assert.equal(w.endMs, null);
});

test('เวลาเริ่มก่อนกะ (สแกนเปิดใบก่อนเข้ากะ) ⇒ ดันขึ้นมาที่เวลาเปิดกะ', () => {
  const w = clampWinToShift(ms('2026-09-15T07:20:00'), ms('2026-09-15T12:00:00'), shiftFrameOf(DAY));
  assert.equal(w.startMs, ms('2026-09-15T08:00:00'));
});

test('กะดึก — ใบที่ปิด 06:00 ของวันถัดไป ยังอยู่ในกะ ห้ามถูกรัดทิ้ง', () => {
  const w = clampWinToShift(ms('2026-09-15T20:30:00'), ms('2026-09-16T06:00:00'), shiftFrameOf(NIGHT));
  assert.equal(w.endMs, ms('2026-09-16T06:00:00'));
  assert.equal((w.endMs - w.startMs) / 60000, 570);
});

test('เวลาที่หัวหน้าแก้ในฟอร์มปิดกะ ชนะค่าใน session', () => {
  const f = shiftFrameOf(DAY, { startTime: '08:30', endTime: '17:30' });
  assert.equal(f.startMs, ms('2026-09-15T08:30:00'));
  assert.equal(f.endMs, ms('2026-09-15T17:30:00'));
});

test('ไม่รู้เวลากะ ⇒ frame null ⇒ ไม่รัด (ของเดิมต้องไม่พัง)', () => {
  assert.equal(shiftFrameOf({ work_date: '2026-09-15' }), null);
  assert.equal(shiftFrameOf(null), null);
  const w = clampWinToShift(5, 9, null);
  assert.equal(w.startMs, 5);
  assert.equal(w.endMs, 9);
});

test('ไม่มี end_time ⇒ รัดแค่ขอบล่าง', () => {
  const f = shiftFrameOf({ work_date: '2026-09-15', start_time: '08:00:00' });
  assert.equal(f.endMs, null);
  const w = clampWinToShift(ms('2026-09-15T06:00:00'), ms('2026-09-17T06:00:00'), f);
  assert.equal(w.startMs, ms('2026-09-15T08:00:00'));
  assert.equal(w.endMs, ms('2026-09-17T06:00:00'));
});
