/* เทสกรอบเวลาของกะ + ด่านกันเวลาที่เป็นไปไม่ได้ — src/utils/shiftWindow.js
   ที่มา 2026-09-23 (user: "ดาวไทม์ที่ลงมา 04:19 น่าจะตั้งใจ 16:19 … ต้องทำ errorproof ดักไม่ให้เกิดอีก")
   ล็อก 2 บั๊กที่เกิดจริง:
     A) กฎเลื่อนวันของกะดึก hardcode `ชั่วโมง < 8` → 5ส./ส่งกะ "08:00" ของกะดึกถูกวางไว้ก่อนเปิดกะ 12 ชม.
     B) ไม่มีใครตรวจว่าเวลาอยู่ในกรอบกะ → AM/PM สลับไหลเข้าฐานเงียบๆ
   ⚠️ ห้ามแก้เทสกลุ่มนี้ให้ผ่านด้วยการกลับไป hardcode เลขชั่วโมง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftWindow, resolveShiftTime, checkShiftTime, hhmmToMin, fmtOffset, windowLabel, MAX_SHIFT_MIN,
} from '../shiftWindow.js';

const at = (iso) => new Date(iso).getTime();
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const DAY_OPEN   = { work_date: '2026-09-23', start_time: '08:00:00', shift: 'day' };            // ยังไม่ปิด
const DAY_CLOSED = { work_date: '2026-09-23', start_time: '08:00:00', shift: 'day', shift_min: 570, end_time: '17:30:00' };
const NIGHT_OPEN = { work_date: '2026-09-22', start_time: '20:00:00', shift: 'night' };

/* ── A) บั๊กกะดึก: "08:00" ต้องเป็นเช้าวันถัดไป ไม่ใช่เช้าวันเดียวกัน ── */
test('กะดึก 20:00 — เวลา 08:00 ต้องตกเช้าวันถัดไป (บั๊ก `ชั่วโมง < 8` เดิมวางผิดวัน ก่อนเปิดกะ 12 ชม.)', () => {
  const r = resolveShiftTime('08:00', NIGHT_OPEN, at('2026-09-23T07:45:00'));
  assert.equal(new Date(r.ms).getDate(), 23, 'ต้องเป็นวันที่ 23 ไม่ใช่ 22');
  assert.equal(r.dayOffset, 1);
  assert.equal(r.inWindow, true);
});

test('กะดึก — 08:30 (5ส.ท้ายกะ) ก็ต้องเข้ากรอบ ไม่ใช่หลุดไปก่อนเปิดกะ', () => {
  const r = resolveShiftTime('08:30', NIGHT_OPEN, at('2026-09-23T08:35:00'));
  assert.equal(r.inWindow, true);
  assert.equal(new Date(r.ms).getDate(), 23);
});

test('กะดึก — 22:30 (ต้นกะ) ยังอยู่วันเดียวกับ work_date เหมือนเดิม', () => {
  const r = resolveShiftTime('22:30', NIGHT_OPEN, at('2026-09-22T22:35:00'));
  assert.equal(new Date(r.ms).getDate(), 22);
  assert.equal(r.dayOffset, 0);
  assert.equal(r.inWindow, true);
});

test('กะดึก — 02:30 (พักดึก) ตกวันถัดไปเหมือนเดิม (พฤติกรรมเดิมต้องไม่เปลี่ยน)', () => {
  const r = resolveShiftTime('02:30', NIGHT_OPEN, at('2026-09-23T02:35:00'));
  assert.equal(new Date(r.ms).getDate(), 23);
  assert.equal(r.inWindow, true);
});

test('กะดึกที่เริ่ม 22:30 (ไม่ใช่ 20:00) ก็ถูกต้องโดยไม่ต้องแก้โค้ด — กรอบมาจาก start_time จริง', () => {
  const s = { work_date: '2026-09-22', start_time: '22:30:00', shift: 'night' };
  const r = resolveShiftTime('07:40', s, at('2026-09-23T07:45:00'));
  assert.equal(new Date(r.ms).getDate(), 23);
  assert.equal(r.inWindow, true);
});

/* ── B) เคสจริงที่จุดชนวน: กะเช้า ลง 04:19 ตอน 16:39 ── */
test('เคสจริง Laser GOR — กะเช้า 08:00 ลงเวลา 04:19 = ก่อนเปิดกะ 3 ชม. 41 นาที + เสนอ 16:19', () => {
  const now = at('2026-09-23T16:39:00');
  const r = resolveShiftTime('04:19', DAY_OPEN, now);
  assert.equal(hhmm(r.ms), '04:19', 'ห้ามดัดค่าให้เข้ากรอบเอง — ต้องคงค่าที่คนกรอกไว้แล้วไปเตือน');
  assert.equal(r.inWindow, false);
  const c = checkShiftTime(r.ms, DAY_OPEN, now);
  assert.equal(c.ok, false);
  assert.equal(c.kind, 'before');
  assert.equal(c.minutesOff, 221);
  assert.equal(fmtOffset(c.minutesOff), '3 ชม. 41 นาที');
  assert.equal(c.suggestHHmm, '16:19', 'ลายเซ็น AM/PM สลับ = ±12 ชม. แล้วเข้ากรอบพอดี');
});

test('เวลาในกรอบปกติ ต้องผ่านสะอาด ไม่มีข้อเสนอแนะกวน', () => {
  const now = at('2026-09-23T16:39:00');
  const c = checkShiftTime(resolveShiftTime('13:30', DAY_OPEN, now).ms, DAY_OPEN, now);
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'ok');
  assert.equal(c.suggestMs, null);
});

test('กะปิดแล้ว — เวลาเลยเวลาปิดกะ = kind "after" (ไม่ใช่ future)', () => {
  const c = checkShiftTime(at('2026-09-23T18:30:00'), DAY_CLOSED, at('2026-09-23T20:00:00'));
  assert.equal(c.kind, 'after');
  assert.equal(c.minutesOff, 60);
});

test('กะยังไม่ปิด — ลงเวลาล่วงหน้าเกินผ่อนผัน = kind "future"', () => {
  const now = at('2026-09-23T10:00:00');
  const c = checkShiftTime(at('2026-09-23T14:00:00'), DAY_OPEN, now);
  assert.equal(c.kind, 'future');
  // ผ่อนผัน 60 นาที — ลง 5ส./ประชุมท้ายกะก่อนถึงเวลาจริงนิดหน่อย ต้องไม่โดนดัก
  assert.equal(checkShiftTime(at('2026-09-23T10:45:00'), DAY_OPEN, now).ok, true);
});

test('ไม่รู้เวลาเริ่มกะ = ตรวจไม่ได้ → ok + kind "unknown" (ห้ามบล็อกคนทำงาน)', () => {
  const c = checkShiftTime(at('2026-09-23T04:19:00'), { work_date: '2026-09-23' }, at('2026-09-23T16:00:00'));
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'unknown');
});

test('เพดานความยาวกะ — กะที่ยังไม่ปิด ขอบบนไม่เกิน start + MAX_SHIFT_MIN แม้เวลาจริงผ่านไปไกล', () => {
  const w = shiftWindow(DAY_OPEN, at('2026-09-25T00:00:00'));   // 2 วันถัดมา
  assert.equal(w.endMs, w.startMs + MAX_SHIFT_MIN * 60000);
  assert.equal(w.openEnded, true);
});

test('hhmmToMin — อ่านไม่ได้ต้องเป็น null ห้ามเดาเป็น 0', () => {
  assert.equal(hhmmToMin('16:19'), 979);
  assert.equal(hhmmToMin('4:19'), 259);
  assert.equal(hhmmToMin(''), null);
  assert.equal(hhmmToMin('25:00'), null);
  assert.equal(hhmmToMin('12:60'), null);
});

test('windowLabel — กะปิดแล้วโชว์เวลาจบจริง · ยังไม่ปิดโชว์ "ตอนนี้"', () => {
  assert.equal(windowLabel(DAY_CLOSED, at('2026-09-23T20:00:00')), '08:00 → 17:30');
  assert.equal(windowLabel(DAY_OPEN, at('2026-09-23T16:39:00')), '08:00 → ตอนนี้');
});
