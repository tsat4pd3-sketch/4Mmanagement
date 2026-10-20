/**
 * เวลาพักที่ "ผูกปลายกะ" (break_policies.anchor = 'shift_end')  — 2026-10-20
 *
 * ที่มา: feedback หน้างาน *"วันที่เรามาทำโอ 8.00-17.00 เราสร้าง 16.40-17.00 5ส. อีก
 * มันจะทับซ้อนกันมั้ยครับ"* + *"เวลา 5ส. ตรงนี้ไม่มี P เลยตก"*
 *
 * 🔴 สิ่งที่เทสชุดนี้ล็อกไว้:
 *   ① กะมาตรฐาน (เลิก 17:30 / 20:00 / 08:00) ต้องได้ช่วงพัก **เท่าเดิมทุกนาที**
 *      — ตัวเลข %A/%P ย้อนหลังทั้งโรงงานห้ามขยับจากงานนี้
 *   ② กะวันหยุดมาโอ 8 ชม. (08:00–17:00) ต้องได้ 5ส. 16:40–17:00 ที่เมื่อก่อนหายไป
 *   ③ พักท้ายกะต้องไม่ล้นออกนอกเวลาเลิกกะ
 *   ④ กรอบที่ไม่ใช่ "ทั้งกะ" ต้องยึด `shiftEndMs` ไม่ใช่ปลายกรอบ (ไม่งั้นหักพักซ้ำทุกพาร์ท)
 *   ⑤ ตั้งไม่ครบ (ไม่มี offset_min) = ไม่คืนช่วงพัก — ห้ามเดาเป็น 0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakIntervalsIn } from '../oee.js';

const WD = '2026-10-17';
const at = (hhmm, dayOffset = 0) =>
  new Date(`${WD}T${hhmm}:00`).getTime() + dayOffset * 86400000;
const span = (iv) => iv.map(([a, b]) =>
  `${new Date(a).toTimeString().slice(0, 5)}-${new Date(b).toTimeString().slice(0, 5)}`).join(' ');
const total = (iv) => iv.reduce((s, [a, b]) => s + (b - a) / 60000, 0);

const COMMON_DAY = [
  { shift: 'day', start_time: '08:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '10:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '11:50:00', duration_min: 50, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '15:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '17:30:00', duration_min: 30, process_type: 'common', ot_scope: 'ot' },
];
/** ทะเบียนแบบเดิม — 5ส. แตกเป็น 3 แถวตามรูปแบบวัน */
const OLD = [
  ...COMMON_DAY,
  { shift: 'day',   start_time: '17:10:00', duration_min: 20, process_type: 'common', ot_scope: 'no_ot' },
  { shift: 'day',   start_time: '19:40:00', duration_min: 20, process_type: 'common', ot_scope: 'ot' },
  { shift: 'night', start_time: '07:40:00', duration_min: 20, process_type: 'common', ot_scope: 'always' },
];
/** ทะเบียนแบบใหม่ — 5ส. แถวเดียว ผูกปลายกะ */
const NEW = [
  ...COMMON_DAY,
  { shift: 'both', start_time: null, duration_min: 20, process_type: 'common', ot_scope: 'always',
    anchor: 'shift_end', offset_min: 20 },
];
const NIGHT = [
  { shift: 'night', start_time: '20:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'night', start_time: '02:30:00', duration_min: 50, process_type: 'common', ot_scope: 'always' },
];

const call = (policies, startMs, endMs, shift, shiftEndMs = null) =>
  breakIntervalsIn({ policies, startMs, endMs, workDate: WD, shift, processType: 'common', shiftEndMs });

/* ── ① กะมาตรฐาน: ของใหม่ต้องให้ผลเท่าของเดิมเป๊ะ ───────────────────────────── */
test('กะเช้าไม่ทำโอ 08:00–17:30 — ของใหม่ต้องได้ช่วงพักเท่าของเดิมทุกนาที', () => {
  const a = call(OLD, at('08:00'), at('17:30'), 'day');
  const b = call(NEW, at('08:00'), at('17:30'), 'day');
  assert.equal(span(b), span(a), 'ช่วงพักต้องเหมือนเดิม — %A/%P ย้อนหลังห้ามขยับ');
  assert.equal(total(b), 100);
  assert.ok(span(b).includes('17:10-17:30'), '5ส. ต้องยังอยู่ที่ 17:10–17:30');
});

test('กะเช้าทำโอ 08:00–20:00 — ของใหม่ต้องได้ช่วงพักเท่าของเดิมทุกนาที', () => {
  const a = call(OLD, at('08:00'), at('20:00'), 'day');
  const b = call(NEW, at('08:00'), at('20:00'), 'day');
  assert.equal(span(b), span(a));
  assert.equal(total(b), 130);
  assert.ok(span(b).includes('19:40-20:00'), '5ส. ต้องเลื่อนไปท้ายกะโอเอง');
});

test('กะดึก 20:00–08:00 — 5ส. ต้องไปอยู่ 07:40–08:00 ของวันถัดไป', () => {
  const old = call([...NIGHT, OLD[7]], at('20:00'), at('08:00', 1), 'night');
  const neo = call([...NIGHT, NEW[5]], at('20:00'), at('08:00', 1), 'night', at('08:00', 1));
  assert.equal(span(neo), span(old));
  assert.equal(total(neo), 80);
});

/* ── ② เคสที่เป็นเหตุของงานนี้ ───────────────────────────────────────────────── */
test('🔴 วันหยุดมาโอ 8 ชม. 08:00–17:00 — ของเดิมไม่มี 5ส. เลย · ของใหม่ต้องได้ 16:40–17:00', () => {
  const a = call(OLD, at('08:00'), at('17:00'), 'day');
  const b = call(NEW, at('08:00'), at('17:00'), 'day');
  assert.equal(total(a), 80, 'ของเดิม: 5ส. 17:10/19:40 อยู่นอกกรอบ ⇒ หายไปทั้งคู่');
  assert.equal(total(b), 100, 'ของใหม่: ได้ 20 นาทีที่หน้างานทำจริงคืนมา');
  assert.ok(span(b).includes('16:40-17:00'));
});

/* ── ③ ห้ามล้นออกนอกเวลาเลิกกะ ──────────────────────────────────────────────── */
test('พักท้ายกะต้องจบไม่เกินเวลาเลิกกะ', () => {
  const iv = call(NEW, at('08:00'), at('17:00'), 'day');
  const last = iv[iv.length - 1];
  assert.ok(last[1] <= at('17:00'), 'ปลายช่วงพักต้องไม่เลยเวลาเลิกกะ');
});

/* ── ④ กรอบที่ไม่ใช่ทั้งกะ ─────────────────────────────────────────────────── */
test('🔴 กรอบ "ช่วงที่พาร์ทวิ่ง" ต้องยึด shiftEndMs — ไม่งั้นพักท้ายกะเกาะปลายช่วงของทุกพาร์ท', () => {
  // พาร์ทวิ่ง 09:00–12:00 ของกะที่เลิก 17:30 → ในช่วงนี้มีแต่พักเที่ยงที่เพิ่งเริ่ม ไม่มี 5ส.
  const ok = call(NEW, at('09:00'), at('12:00'), 'day', at('17:30'));
  assert.equal(span(ok), '10:00-10:10 11:50-12:00', 'ได้แค่เบรคเช้า + พักเที่ยงส่วนที่ทับ — 5ส. ของกะอยู่ 17:10 ไม่เกี่ยวกับช่วงนี้');
  // ไม่ส่ง shiftEndMs = ถอยไปใช้ปลายกรอบ ⇒ 5ส. ไหลมาเกาะ 11:40–12:00 (นี่คือเหตุผลที่ต้องส่งเสมอ)
  const slid = call(NEW, at('09:00'), at('12:00'), 'day');
  assert.equal(span(slid), '10:00-10:10 11:40-12:00', 'ไม่ส่งปลายกะ = พักท้ายกะไหลมาเกาะปลายช่วงของพาร์ท (11:40–12:00)');
});

/* ── ⑤ ตั้งไม่ครบ = ไม่เดา ─────────────────────────────────────────────────── */
test('แถว shift_end ที่ไม่มี offset_min ต้องถูกข้าม ห้ามเดาเป็น 0', () => {
  const bad = [{ shift: 'day', start_time: null, duration_min: 20, process_type: 'common',
                 ot_scope: 'always', anchor: 'shift_end', offset_min: null }];
  assert.deepEqual(call(bad, at('08:00'), at('17:00'), 'day'), []);
});

test('แถวเดิมที่ไม่มีคอลัมน์ anchor เลย ต้องทำงานเหมือนเดิม (back-compatible)', () => {
  const iv = call(COMMON_DAY, at('08:00'), at('17:30'), 'day');
  assert.equal(total(iv), 80);
});
