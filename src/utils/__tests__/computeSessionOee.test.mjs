/* ══ computeSessionOee (oee.js §8) — สูตรปิดกะที่ย้ายออกจาก DailyReport เมื่อ 2026-09-24 ══
   ล็อกพฤติกรรมที่ "ต้องไม่เปลี่ยน" ตอนย้าย + กฎที่เคยพังจริงและอยู่ในสายนี้
   (เคสละเอียดของแต่ละสูตรย่อยอยู่ในไฟล์เทสของมันเอง — ที่นี่ตรวจว่าประกอบร่างถูก) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionOee } from '../oee.js';

const WD = '2026-09-22';
const sess = (o = {}) => ({ work_date: WD, shift: 'day', line_name: 'L', start_time: '08:00:00', end_time: '17:30:00', ...o });
/* ⚠️ timestamp ในเทสนี้ **ห้ามมี `Z`** — สูตรสร้างกรอบกะด้วย `new Date('YYYY-MM-DDTHH:mm:00')`
   ซึ่งเป็น "เวลาเครื่อง" ⇒ ถ้าฝั่งใบผลิตใส่ UTC เทสจะผ่าน/ตกตาม timezone ของคนรัน */
const ord = (o = {}) => ({ id: o.id || 'o1', mat_no: 'M1', status: 'confirmed', qty: 100,
  opened_at: `${WD}T09:00:00`, confirmed_at: `${WD}T16:00:00`, ...o });
const P = [{ mat_no: 'M1', name: 'PART', p_no: 'PN1', cycle_time_sec: 60, pair_mat_no: null }];

test('กะปกติ — A/P/Q/OEE ออกครบ และ shiftMin = เวลาปิด − เวลาเปิด', () => {
  const r = computeSessionOee({ session: sess(), orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00' });
  assert.equal(r.shiftMin, 570);
  assert.ok(r.A > 0 && r.A <= 1);
  assert.ok(r.P > 0 && r.P <= 1);
  assert.equal(r.Q, 1);
  assert.ok(Math.abs(r.oee - r.A * r.P * r.Q) < 1e-9);
});

test('🔴 ผลิต 0 ชิ้น + ของเสีย > 0 → Q = 0 (ห้ามเป็น 1) · ไม่มีอะไรเลย → null', () => {
  const zero = { session: sess(), orders: [], products: P, endTime: '17:30:00' };
  assert.equal(computeSessionOee({ ...zero, ngQty: 5 }).Q, 0);
  assert.equal(computeSessionOee({ ...zero, ngQty: 0 }).Q, null);
});

test('🔴 netAvail ≤ 0 (พัก+หยุดตามแผนกินทั้งกะ) → A = null ห้ามเป็น 0', () => {
  const r = computeSessionOee({
    session: sess(), orders: [], products: P, ngQty: 0, endTime: '09:00:00',
    downtimes: [{ id: 'd', duration_min: 999, started_at: `${WD}T08:00:00`, ended_at: `${WD}T18:00:00`,
      dr_downtime_types: { category: 'planned' } }],
  });
  assert.equal(r.A, null);
  assert.equal(r.oee, null);
});

test('🔴 งานคู่ RH/LH ต้องยุบเป็น shot เดียว — ไม่งั้น %P สองเท่าแล้วโดน cap เงียบ', () => {
  const pair = [{ mat_no: 'A', cycle_time_sec: 60, pair_mat_no: 'B', name: 'X', p_no: 'PN' },
                { mat_no: 'B', cycle_time_sec: 60, pair_mat_no: 'A', name: 'X', p_no: 'PN' }];
  const orders = [ord({ id: '1', mat_no: 'A', qty: 100 }), ord({ id: '2', mat_no: 'B', qty: 100 })];
  const withPair = computeSessionOee({ session: sess(), orders, products: pair, ngQty: 0, endTime: '17:30:00' });
  const noPair = computeSessionOee({ session: sess(), orders, endTime: '17:30:00',
    products: pair.map(p => ({ ...p, pair_mat_no: null })), ngQty: 0 });
  assert.ok(withPair.P < noPair.P, 'ยุบคู่แล้วเวลามาตรฐานต้องลดลงครึ่ง ⇒ %P ต่ำกว่าแบบไม่ยุบ');
  assert.deepEqual(Object.keys(withPair.ctUsed).length, 1, 'คู่ต้องเหลือแถวเดียวใน ct_snapshot');
});

test('🔴 downtime ที่ทับเวลาพักตามนโยบาย ห้ามหักซ้ำ', () => {
  const breaks = [{ shift: 'day', process_type: 'common', start_time: '12:00:00', duration_min: 60, ot_scope: 'always' }];
  const dt = [{ id: 'd', duration_min: 60, started_at: `${WD}T12:00:00`, ended_at: `${WD}T13:00:00`,
    dr_downtime_types: { category: 'unplanned' } }];
  const r = computeSessionOee({ session: sess(), orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00',
    breakPolicies: breaks, downtimes: dt, processType: 'common' });
  assert.equal(Math.round(r.loggedUnplannedDT), 0, 'นาที DT ที่อยู่ในช่วงพักทั้งก้อน ต้องไม่ถูกหักอีก');
  assert.equal(Math.round(r.dtBreakOverlapMin), 60, 'ต้องรายงานนาทีที่ตัดออกให้จอเห็น ห้ามตัดเงียบ');
});

test('เวลาเริ่ม/จบที่ส่งเข้ามา (startTime/endTime) ต้องชนะค่าในแถวกะ — ใช้ตอนแก้เวลากะ', () => {
  const r = computeSessionOee({ session: sess(), orders: [ord()], products: P, ngQty: 0,
    startTime: '06:00:00', endTime: '18:00:00' });
  assert.equal(r.shiftMin, 720);
});

test('กะดึกข้ามเที่ยงคืน — เวลาปิดน้อยกว่าเวลาเปิด ต้องบวกวันให้เอง', () => {
  const r = computeSessionOee({ session: sess({ shift: 'night', start_time: '20:00:00' }),
    orders: [], products: P, ngQty: 0, endTime: '08:00:00' });
  assert.equal(r.shiftMin, 720);
});

test('🔴 `endTime` ไม่ส่ง = นับถึง "ตอนนี้" (ไม่ได้อ่าน session.end_time) — สัญญาเดิมของสูตรปิดกะ', () => {
  // ทุกจุดที่เรียกส่ง endTime มาเสมอ · คนเขียนสคริปต์ย้อนหลังลืมส่ง = ได้ shiftMin เป็นเวลาถึงตอนนี้
  const r = computeSessionOee({ session: sess({ end_time: '17:30:00' }), orders: [], products: P, ngQty: 0 });
  assert.notEqual(r.shiftMin, 570);
});
