/* 🔍 ด่านจับข้อมูลที่ทำให้ OEE โกหก (13/11 · คำสั่ง user "A ตก P อาจจะ over ... ก็จะมีผล")
 * 🔴 เตือน ไม่บล็อก · ไม่รู้ = เงียบ ห้ามเดา · เวลาพักไม่นับเป็น "เวลาที่ต้องตอบ" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDtClosedAtShiftEnd, DT_ASK_MIN, SHIFT_END_TOL_MIN } from '../shiftDataSanity.js';

/* เคสจริง BD-08 28/10 กะดึก: เริ่มหยุด 02:00 · ซ่อมเสร็จ 02:25 · ปิดใบ 04:00 (= เลิกกะ)
   ค่อมเบรค 50 นาที (ประชุมแถว 03:00-03:30 + 5ส. 03:40-04:00) ⇒ ที่ต้องตอบจริง 44 นาที */
const T = (h, m) => Date.UTC(2026, 9, 29, h, m) ;   // ใช้ UTC คงที่ เทสไม่ขึ้นกับ timezone เครื่อง
const BD08 = {
  startedMs: T(2, 0), repairDoneMs: T(2, 25), endedMs: T(4, 0), shiftEndMs: T(4, 0),
  breakIntervals: [[T(3, 0), T(3, 30)], [T(3, 40), T(4, 0)]],
};

test('เคสจริง BD-08 — หักเวลาพักแล้วเหลือ 44 นาทีที่ต้องตอบ', () => {
  const r = checkDtClosedAtShiftEnd(BD08);
  assert.ok(r, 'ต้องเตือน');
  assert.equal(r.atShiftEnd, true);
  assert.equal(r.totalMin, 120);
  assert.equal(r.sinceRepairMin, 95, 'ซ่อมเสร็จ 02:25 → ปิดใบ 04:00');
  assert.equal(r.breakMin, 50);
  assert.equal(r.answerMin, 45, '95 − 50 (ปัดนาทีจากของจริง 94/44)');
  assert.match(r.text, /ปิดตรงเวลาเลิกกะ/);
  assert.match(r.text, /%A/, 'ต้องบอกผลที่ตามมา ไม่ใช่แค่ว่าผิด');
});

test('🔴 เวลาพักต้องถูกหัก — ไม่หัก = กล่าวหาเกินจริง', () => {
  const noBrk = checkDtClosedAtShiftEnd({ ...BD08, breakIntervals: null });
  assert.equal(noBrk.breakMin, 0);
  assert.equal(noBrk.answerMin, 95, 'ไม่ส่งช่วงพัก = ไม่หัก (แต่ต้องไม่พัง)');
  const withBrk = checkDtClosedAtShiftEnd(BD08);
  assert.ok(withBrk.answerMin < noBrk.answerMin, 'ส่งช่วงพักแล้วต้องน้อยลง');
});

test('🔴 ประเภทในแผน ห้ามเตือน — ลง "ไม่มีแผนผลิต" ถึงเลิกงานถูกแล้ว', () => {
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, planned: true }), null);
});

test('🔴 ไม่รู้กรอบกะ / ไม่รู้เวลา = เงียบ ห้ามเดา', () => {
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, shiftEndMs: null }), null);
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, endedMs: null }), null);
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, startedMs: null }), null);
  assert.equal(checkDtClosedAtShiftEnd({}), null);
});

test('ไม่ได้ปิดตรงเลิกกะ = ไม่เตือน · ใบสั้น = ไม่เตือน', () => {
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, endedMs: T(3, 30) }), null, 'ปิดก่อนเลิกกะ 30 นาที');
  /* ใบสั้นกว่าเกณฑ์ แม้ปิดตรงเลิกกะ ก็ไม่ต้องถาม (เศษท้ายกะเป็นเรื่องปกติ) */
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, startedMs: T(3, 50), repairDoneMs: null }), null);
  /* ขอบเกณฑ์: ยาวเท่า DT_ASK_MIN พอดี = เตือน */
  const edge = checkDtClosedAtShiftEnd({
    startedMs: T(4, 0) - DT_ASK_MIN * 60000, endedMs: T(4, 0), shiftEndMs: T(4, 0), repairDoneMs: null,
  });
  assert.ok(edge, `ใบยาว ${DT_ASK_MIN} นาทีพอดีต้องเตือน`);
});

test('คลาด ±2 นาทีจากเวลาเลิกกะ ยังนับว่า "ตรงเลิกกะ"', () => {
  assert.ok(checkDtClosedAtShiftEnd({ ...BD08, endedMs: T(4, 0) - SHIFT_END_TOL_MIN * 60000 }));
  assert.ok(checkDtClosedAtShiftEnd({ ...BD08, endedMs: T(4, 0) + SHIFT_END_TOL_MIN * 60000 }));
  assert.equal(checkDtClosedAtShiftEnd({ ...BD08, endedMs: T(4, 0) - 10 * 60000 }), null);
});

test('ไม่รู้เวลาซ่อมเสร็จ = ใช้ทั้งใบ และบอกว่าไม่รู้ (sinceRepairMin = null)', () => {
  const r = checkDtClosedAtShiftEnd({ ...BD08, repairDoneMs: null });
  assert.equal(r.sinceRepairMin, null);
  assert.ok(!/ซ่อมเสร็จ/.test(r.text), 'ไม่รู้แล้วห้ามเขียนเวลาซ่อมเสร็จลอยๆ');
});

/* ธงตอนปิดกะอยู่ใน closeChecks.test.mjs — ด่านปิดกะมีลิสต์เดียว (buildCloseChecks) */
