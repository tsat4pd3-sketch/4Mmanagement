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
  checkCloseTime, CLOSE_AHEAD_WARN_MIN, dtCoverMin,
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

/* ── ด่าน "ปิดกะล้ำหน้าเวลาจริง" (2026-10-02) ─────────────────────────────────────────────
   เคสจริง 01/10: LINE ASSY TSRA ปิดตอน 13:37 แต่กรอกเวลาจบ 17:30 (ล้ำ 3 ชม. 52 นาที)
   ⇒ shift_min = 570 (เต็มกะ) ทั้งที่เดินจริง ~5.6 ชม. ⇒ %A/%P ต่ำกว่าจริงทั้งกะ
   ต้นเหตุ: ค่าเริ่มต้นของช่องเวลาจบเดา "17:30" ให้ทุกครั้งที่เปิดกล่องปิดกะก่อน 18:30
   ⚠️ เทสกลุ่มนี้ตรึงนาฬิกาเอง (กฎ: ฟังก์ชันที่กินเวลาปัจจุบันต้องรับ `now` ได้) */
const DAY_SESSION   = { work_date: '2026-10-01', shift: 'day',   start_time: '08:00', status: 'open' };
const NIGHT_SESSION = { work_date: '2026-09-24', shift: 'night', start_time: '20:00', status: 'open' };
const closeAtMs = (workDate, hhmm) => new Date(`${workDate}T${hhmm}:00`).getTime();

test('checkCloseTime: ปิดก่อนเลิกงาน 30-60 นาที = ปกติ ไม่เตือน', () => {
  for (const [closeAt, expect] of [['17:00', 30], ['16:30', 60]]) {
    const r = checkCloseTime('17:30', DAY_SESSION, closeAtMs('2026-10-01', closeAt));
    assert.equal(r.aheadMin, expect);
    assert.equal(r.ok, true, `ปิดตอน ${closeAt} กรอกจบ 17:30 = ปกติ ต้องไม่เตือน`);
  }
});

test('checkCloseTime: เคสจริง 01/10 — ปิด 13:37 กรอกจบ 17:30 ต้องเตือน + เสนอเวลาตอนนี้', () => {
  const r = checkCloseTime('17:30', DAY_SESSION, closeAtMs('2026-10-01', '13:37'));
  assert.equal(r.aheadMin, 233);          // 3 ชม. 53 นาที
  assert.equal(r.ok, false);
  assert.equal(r.nowHHmm, '13:37', 'ต้องเสนอ "เวลาตอนนี้" ให้กดแก้ในคลิกเดียว');
});

test('checkCloseTime: กะดึก — ปิด 22:33 กรอกจบ 08:00 = ล้ำข้ามวัน ต้องจับได้', () => {
  const r = checkCloseTime('08:00', NIGHT_SESSION, closeAtMs('2026-09-24', '22:33'));
  assert.equal(r.aheadMin, 567, 'ต้องตีความ 08:00 เป็นเช้าวันถัดไป (ปลายกะ) ไม่ใช่วันเดียวกัน');
  assert.equal(r.ok, false);
});

test('checkCloseTime: รอยต่อที่ข้อมูลบอก = 90 นาที (เท่ากับ = ยังผ่าน · เกิน 1 นาที = เตือน)', () => {
  const base = closeAtMs('2026-10-01', '17:30');
  assert.equal(checkCloseTime('17:30', DAY_SESSION, base - CLOSE_AHEAD_WARN_MIN * 60000).ok, true);
  assert.equal(checkCloseTime('17:30', DAY_SESSION, base - (CLOSE_AHEAD_WARN_MIN + 1) * 60000).ok, false);
});

test('checkCloseTime: ปิดช้ากว่าเวลาที่กรอก (ย้อนหลัง) = ไม่ล้ำ ไม่เตือน', () => {
  const r = checkCloseTime('17:30', DAY_SESSION, closeAtMs('2026-10-01', '19:00'));
  assert.ok(r.aheadMin < 0);
  assert.equal(r.ok, true, 'กรอกย้อนหลังเป็นเรื่องปกติ ห้ามเตือน');
});

/* ── ปลายกะที่ลง downtime คลุมไว้แล้ว ไม่ใช่ความผิด (05/10 · วัดจาก 1,445 กะที่ปิดแล้ว) ──────
   เคสจริงที่เกณฑ์เดิม (ดูแต่ `aheadMin`) ติดป้ายผิด: SP-72/74/88 23/07 ปิด 13:49 กรอกจบ 17:30
   แต่ลง downtime "นับสต๊อก / ไม่มีแผนผลิต" 11:21→17:30 ⇒ กะเดินถึง 17:30 จริง ส่วนที่เหลือเป็น planned stop */
const dtRow = (workDate, from, to) => ({
  started_at: new Date(`${workDate}T${from}:00`).toISOString(),
  ended_at: new Date(`${workDate}T${to}:00`).toISOString(),
});

test('checkCloseTime: เคสจริง SP-72 23/07 — ปลายกะลง DT คลุมถึงเลิกงาน = ไม่เตือน', () => {
  const dt = [dtRow('2026-07-23', '11:21', '17:30')];
  const ses = { ...DAY_SESSION, work_date: '2026-07-23' };
  const r = checkCloseTime('17:30', ses, closeAtMs('2026-07-23', '13:49'), { downtimes: dt });
  assert.equal(r.aheadMin, 221, 'ล้ำหน้าจริง ~220 นาที');
  assert.equal(r.coveredMin, 221, 'แต่ถูก DT คลุมไว้หมด');
  assert.equal(r.unaccountedMin, 0);
  assert.equal(r.ok, true, 'ลง DT ครบ = หน้างานทำถูก ห้ามเตือน');
});

test('checkCloseTime: ใบเดิมแต่ไม่ได้ลง DT = เตือนเหมือนเดิม', () => {
  const ses = { ...DAY_SESSION, work_date: '2026-07-23' };
  const r = checkCloseTime('17:30', ses, closeAtMs('2026-07-23', '13:49'), { downtimes: [] });
  assert.equal(r.unaccountedMin, 221);
  assert.equal(r.ok, false);
});

test('checkCloseTime: DT คลุมแค่ครึ่ง = เตือนด้วยนาทีที่เหลือ ไม่ใช่นาทีที่ล้ำทั้งหมด', () => {
  const ses = { ...DAY_SESSION, work_date: '2026-07-23' };
  const dt = [dtRow('2026-07-23', '14:00', '15:00')];
  const r = checkCloseTime('17:30', ses, closeAtMs('2026-07-23', '13:49'), { downtimes: dt });
  assert.equal(r.coveredMin, 60);
  assert.equal(r.unaccountedMin, 161);
  assert.equal(r.ok, false);
});

test('checkCloseTime: ไม่ส่ง downtimes = ถือว่าไม่มีอะไรรองรับ (ปลอดภัยฝั่งเตือน)', () => {
  const ses = { ...DAY_SESSION, work_date: '2026-07-23' };
  const r = checkCloseTime('17:30', ses, closeAtMs('2026-07-23', '13:49'));
  assert.equal(r.coveredMin, 0);
  assert.equal(r.unaccountedMin, r.aheadMin);
});

test('dtCoverMin: ใบที่ทับกันต้องยุบก่อนบวก (ไลน์เครื่องขนานลงหลายใบพร้อมกัน)', () => {
  const iv = [dtRow('2026-07-23', '10:00', '11:00'), dtRow('2026-07-23', '10:30', '11:30'),
              dtRow('2026-07-23', '10:10', '10:20')];
  const from = closeAtMs('2026-07-23', '10:00'), to = closeAtMs('2026-07-23', '12:00');
  assert.equal(dtCoverMin(iv, from, to), 90, 'บวกดิบจะได้ 130 = คลุมเกินจริง');
});

test('dtCoverMin: ใบที่ยังไม่ปิดยาวเท่า duration_min ที่กรอก ไม่ลากถึงตอนนี้', () => {
  const from = closeAtMs('2026-06-25', '15:53'), to = closeAtMs('2026-06-25', '17:30');
  const open = [{ started_at: new Date('2026-06-25T10:20:00').toISOString(), ended_at: null, duration_min: null }];
  assert.equal(dtCoverMin(open, from, to), 0,
    'เคสจริง HYDROFORM 25/06 — ใบ DT เปิดค้างไม่มีนาที ⇒ คลุมไม่ได้ ปลายกะยังไม่มีอะไรรองรับ');
});

test('dtCoverMin: ช่วงว่าง/ข้อมูลพัง = 0 ไม่ throw', () => {
  const from = closeAtMs('2026-07-23', '13:49'), to = closeAtMs('2026-07-23', '17:30');
  assert.equal(dtCoverMin(null, from, to), 0);
  assert.equal(dtCoverMin([{ started_at: null }, { started_at: 'ไม่ใช่เวลา' }], from, to), 0);
  assert.equal(dtCoverMin([dtRow('2026-07-23', '11:00', '12:00')], to, from), 0, 'to <= from = 0');
});

test('checkCloseTime: อ่านไม่ได้ = null (ผู้เรียกต้องปล่อยผ่าน ห้ามบล็อก)', () => {
  assert.equal(checkCloseTime('', DAY_SESSION), null);
  assert.equal(checkCloseTime('17:30', { shift: 'day', start_time: '08:00' }), null, 'ไม่มี work_date = ตรวจไม่ได้');
  assert.equal(checkCloseTime('17:30', null), null);
});
