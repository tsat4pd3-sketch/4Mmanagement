/* เทส "นาทีที่หายไปของกะ" — liveTimeSplit (src/utils/oee.js)
   ที่มา (user 2026-09-16): "จะรู้ได้ยังไงว่าตอนนี้ดีเลย์ไปแล้วกี่ใบ และต้อง recover ยังไง"
   ⇒ คำตอบเป็น **นาที ไม่ใช่ใบ** และต้องมาจาก computeLiveOee ตัวเดิม ห้ามมีสูตรที่ 2

   เทสชุดนี้ล็อก 3 เรื่องที่พังแล้วจอโกหกทันที:
     1. ก้อนนาทีต้องบวกกลับได้เป็น elapsed (ไม่มีนาทีหายหรือถูกนับซ้ำ)
     2. ⬜ อธิบายไม่ได้ ต้องเป็นตัวเดียวกับที่ทำให้ %P ไม่ถึง 100 (ไม่ใช่เลขคนละชุด)
     3. เคส "ไม่รู้" ทุกแบบต้องมี state ห้ามกลืนเป็น 0 (no_output / no_ct / over)

   ⏱️ ทุกเคสตรึง nowMs เอง ไม่มี Date.now() — กันเทสระเบิดเวลา (รอบ +400 วันใน run-tests.mjs) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLiveOee, liveTimeSplit } from '../oee.js';

const WD = '2026-09-01';
const OPEN = new Date(`${WD}T08:00:00`).getTime();
const at = (min) => OPEN + min * 60000;

/* นโยบายพักกะเช้าชุดจริงในฐาน — รวม 100 นาทีในกะ 570 นาที */
const DAY_BREAKS = [
  { shift: 'day', process_type: 'common', start_time: '08:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '10:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '11:50:00', duration_min: 50 },
  { shift: 'day', process_type: 'common', start_time: '15:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '17:10:00', duration_min: 20 },
];
const SESSION = { start_time: '08:00:00', shift_min: 570, shift: 'day', work_date: WD };

const dt = (min, planned = false, startMin = 60) => ({
  machine_no: null, started_at: new Date(at(startMin)).toISOString(),
  ended_at: new Date(at(startMin + min)).toISOString(), duration_min: min,
  dr_downtime_types: { category: planned ? 'planned' : 'unplanned' },
});
/* ใบปิดแล้ว qty ชิ้น ของพาร์ท mat */
const ord = (qty, mat = 'M1', extra = {}) => ({
  status: 'confirmed', qty_ok: qty, mat_no: mat,
  opened_at: new Date(at(0)).toISOString(), confirmed_at: new Date(at(300)).toISOString(), ...extra,
});
const split = (extra = {}) => liveTimeSplit(computeLiveOee({
  session: SESSION, orders: [], downtimes: [], ctMap: { M1: 60 }, workDate: WD,
  nowMs: at(570), breakPolicies: DAY_BREAKS, ...extra,
}));

test('ก้อนนาทีบวกกลับได้เป็น elapsed — ไม่มีนาทีหาย ไม่มีนาทีถูกนับซ้ำ', () => {
  // 300 ชิ้น × CT 60 วิ = 300 นาทีมาตรฐาน
  const r = split({ orders: [ord(300)], downtimes: [dt(60, true), dt(30, false, 300)] });
  assert.equal(r.elapsedMin, 570);
  assert.equal(r.breakMin, 100);
  assert.equal(r.plannedMin, 60);
  assert.equal(r.dtMin, 30);
  assert.equal(r.runMin, 380);
  assert.equal(r.workMin, 300);
  assert.equal(r.unknownMin, 80, '380 เดินได้ − 300 ที่ทำได้ = 80 นาทีที่ไม่มีใครรู้ว่าไปไหน');
  assert.equal(
    r.breakMin + r.plannedMin + r.dtMin + r.workMin + r.unknownMin, r.elapsedMin,
    'ทุกนาทีของกะต้องอยู่ในก้อนใดก้อนหนึ่งพอดี',
  );
});

test('⬜ อธิบายไม่ได้ = ตัวเดียวกับที่ทำให้ %P ไม่ถึง 100 (ห้ามเป็นเลขคนละชุด)', () => {
  const live = computeLiveOee({
    session: SESSION, orders: [ord(300)], downtimes: [dt(30, false, 300)],
    ctMap: { M1: 60 }, workDate: WD, nowMs: at(570), breakPolicies: DAY_BREAKS,
  });
  const r = liveTimeSplit(live);
  assert.equal(r.workMin + r.unknownMin, r.capacityMin);
  assert.equal(Math.round((r.workMin / r.capacityMin) * 1000) / 10, live.P,
    'workMin ÷ capacityMin ต้องได้ %P เป๊ะ — ถ้าไม่ตรงแปลว่ามีสูตรที่ 2 เกิดขึ้นแล้ว');
});

test('หยุดนอกแผนที่บันทึกแล้ว ไม่ถูกนับเป็น "อธิบายไม่ได้" ซ้ำอีกรอบ', () => {
  const none = split({ orders: [ord(300)] });
  const withDt = split({ orders: [ord(300)], downtimes: [dt(60, false, 300)] });
  assert.equal(withDt.dtMin, 60);
  assert.equal(none.unknownMin - withDt.unknownMin, 60,
    'บันทึก DT 60 นาที = ⬜ ลด 60 นาที (ย้ายก้อน ไม่ใช่หักสองที)');
});

test('downtime ที่คร่อมเวลาพัก ห้ามหักซ้ำ (กฎเหล็ก 2026-09-15)', () => {
  // 11:30–13:00 คร่อมพักเที่ยง 11:50–12:40 (50 นาที) → นับ DT จริงได้ 40 นาที ไม่ใช่ 90
  const r = split({ orders: [ord(300)], downtimes: [dt(90, false, 210)] });
  assert.equal(r.dtMin, 40, 'นาทีที่ตกในช่วงพักถูกกันออกไปแล้ว ห้ามบวกเข้ามาอีก');
});

test('ยังไม่ผลิตชิ้นแรก = ⬜ เต็ม runMin + state no_output (ห้ามเงียบ)', () => {
  const r = split({ orders: [] });
  assert.equal(r.state, 'no_output');
  assert.equal(r.workMin, 0);
  assert.equal(r.unknownMin, r.runMin, 'เวลาที่เดินได้ทั้งหมดยังไม่มีคำอธิบาย');
});

test('พาร์ทไม่ได้ตั้ง CT = state no_ct — ⬜ สูงเกินจริง จอต้องบอก ห้ามโชว์เฉยๆ', () => {
  const r = split({ orders: [ord(300, 'NO_CT')], ctMap: {} });
  assert.equal(r.state, 'no_ct');
  assert.equal(r.workMin, 0);
  assert.ok(r.qtyNoCt > 0, 'ต้องบอกด้วยว่ากี่ชิ้นที่ไม่มี CT');
});

test('งานมาตรฐานเกินเวลาที่มี = state over — ห้ามอ่านว่า "ไม่มีหนี้"', () => {
  // 600 ชิ้น × 60 วิ = 600 นาที > runMin 470 ⇒ ข้อมูลผิด (CT/ยอด/เวลาเปิด-ปิดใบ)
  const r = split({ orders: [ord(600)] });
  assert.equal(r.state, 'over');
  assert.equal(r.over, true);
  assert.equal(r.unknownMin, 0, 'ตัวเลขไม่ติดลบ');
  assert.notEqual(r.state, 'ok', 'unknownMin = 0 ที่นี่แปลว่า "คำนวณไม่ได้" ไม่ใช่ "ทันเป้า"');
});

test('ไลน์เครื่องขนาน: ฐานเป็นเวลาเครื่อง ต้องติดธง unit=machine ให้จอเขียนกำกับ', () => {
  const orders = [
    ord(200, 'M1'), ord(200, 'M2', { opened_at: new Date(at(0)).toISOString() }),
  ];
  const r = split({ orders, ctMap: { M1: 60, M2: 60 }, parallelCap: 3, parallelN: 3 });
  assert.equal(r.unit, 'machine');
  assert.equal(r.parallelCap, 3);
  assert.ok(r.capacityMin > r.runMin, 'เวลาเครื่องมากกว่าเวลาไลน์เมื่อหลายพาร์ทวิ่งพร้อมกัน');
});

test('ไลน์ปกติ (cap=1) ฐานคือเวลาไลน์ — unit=line', () => {
  assert.equal(split({ orders: [ord(300)] }).unit, 'line');
});

test('ไม่ส่งนโยบายพัก ต้องติดธงบอกว่าเทียบกับค่าตอนปิดกะไม่ได้', () => {
  const r = liveTimeSplit(computeLiveOee({
    session: SESSION, orders: [ord(300)], downtimes: [], ctMap: { M1: 60 },
    workDate: WD, nowMs: at(570),
  }));
  assert.equal(r.noBreakPolicy, true);
});

test('ประเมินไม่ได้ (เพิ่งเปิดกะ) → computeLiveOee คืน null → split คืน null ห้ามคืนศูนย์', () => {
  assert.equal(liveTimeSplit(null), null);
  assert.equal(split({ nowMs: at(5) }), null, 'กะเพิ่งเปิด 5 นาที ยังตอบไม่ได้');
});

/* ── หมุดเริ่มกะ (t0) ต้องอยู่ในกรอบกะ — บั๊กที่เจอจากข้อมูลจริง 4 แถว (2026-09-16) ──────── */

test('กะดึกที่ start_time หลุดไปเป็นเวลากลางวัน → clamp เป็น 20:00 + ตั้งธงบอกว่าข้อมูลผิด', () => {
  // มีจริงในฐาน: Laser GOR 01/08 และ Line 61 06/07 — shift='night' แต่ start_time='08:00'
  const bad = { start_time: '08:00:00', shift_min: 570, shift: 'night', work_date: WD };
  const r = computeLiveOee({
    session: bad, orders: [ord(100)], downtimes: [], ctMap: { M1: 60 },
    workDate: WD, nowMs: new Date(`${WD}T21:00:00`).getTime(),
  });
  assert.equal(r.startTimeOutOfFrame, true, 'ต้องบอกจอว่าเวลาเริ่มกะผิด ห้ามกลืนเงียบ');
  assert.equal(r.elapsedMin, 60, 'นับจาก 20:00 → 21:00 = 60 นาที (ไม่ใช่ 570 ที่ถูก cap จากหมุด 08:00)');
});

test('กะเช้าที่ start_time เป็น 22:30 → clamp เป็น 08:00 + ตั้งธง', () => {
  // มีจริงในฐาน: LINE APRON ASSY 29/06 — shift='day' แต่ start_time='22:30'
  const bad = { start_time: '22:30:00', shift_min: 570, shift: 'day', work_date: WD };
  const r = computeLiveOee({
    session: bad, orders: [ord(100)], downtimes: [], ctMap: { M1: 60 },
    workDate: WD, nowMs: new Date(`${WD}T10:00:00`).getTime(),
  });
  assert.equal(r.startTimeOutOfFrame, true);
  assert.equal(r.elapsedMin, 120, 'นับจาก 08:00 → 10:00');
});

test('🔴 กะดึกเข้างานปกติ 22:30 อยู่ในกรอบ ห้ามถูก clamp (121 กะในฐานเป็นแบบนี้)', () => {
  const ok = { start_time: '22:30:00', shift_min: 570, shift: 'night', work_date: WD };
  const r = computeLiveOee({
    session: ok, orders: [ord(100)], downtimes: [], ctMap: { M1: 60 },
    workDate: WD, nowMs: new Date(`${WD}T23:30:00`).getTime(),
  });
  assert.equal(r.startTimeOutOfFrame, false);
  assert.equal(r.elapsedMin, 60, 'หมุดต้องอยู่ที่ 22:30 ตามที่บันทึกจริง');
});

test('กะดึกที่บันทึกเวลาเริ่มเป็น 00:30 = เช้าวันถัดไป (ข้ามคืน) ไม่ใช่ผิดกรอบ', () => {
  const ses = { start_time: '00:30:00', shift_min: 570, shift: 'night', work_date: WD };
  const r = computeLiveOee({
    session: ses, orders: [ord(100)], downtimes: [], ctMap: { M1: 60 },
    workDate: WD, nowMs: new Date(`${WD}T00:30:00`).getTime() + 90 * 60000 + 86400000,
  });
  assert.equal(r.startTimeOutOfFrame, false);
  assert.equal(r.elapsedMin, 90, 't0 = วันถัดไป 00:30 — ไม่ใช่ 00:30 ของ work_date (เร็วไป 24 ชม.)');
});

test('กะเช้า 08:00 ปกติ ต้องไม่ติดธงและหมุดไม่ขยับ (พฤติกรรมเดิมเป๊ะ)', () => {
  const r = computeLiveOee({
    session: SESSION, orders: [ord(300)], downtimes: [], ctMap: { M1: 60 },
    workDate: WD, nowMs: at(570), breakPolicies: DAY_BREAKS,
  });
  assert.equal(r.startTimeOutOfFrame, false);
  assert.equal(r.elapsedMin, 570);
});
