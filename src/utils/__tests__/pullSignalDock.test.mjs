/* dock = ส่วนหนึ่งของ "เที่ยวรถ" — กันเคสจริง 2026-09-15
   logistic แยกไฟล์ e-SMART ต่อ dock แล้วอัพติดกัน 2 ไฟล์ ⇒ ไฟล์ที่ 2 (dock B5, 10 แถว 125 ชิ้น)
   สร้าง 0 ใบ อัพเดท 0 ใบ เพราะกลุ่มของมันไปชนใบของ dock B1 ที่เพิ่งสร้าง ⇒ "บาง part no หายไป" */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateSignals, planOrderUpdates, pickPullRound, findDuplicateUploads, signalKey, dockKey,
} from '../pullSignal.js';

const at = (h, m = 0) => new Date(2026, 8, 15, h, m);
const sig = (part, dock, h, m, qty) => ({
  ship_to: 'GRBNA', customer_part_no: part, supplier_ref: `${part}-${dock}`,
  part_name: part, dock_code: dock, pulled_at: at(h, m), qty, containers: 1,
});

test('aggregateSignals: พาร์ทเดียวกันคนละ dock = คนละกลุ่ม (ห้ามยุบเป็นใบเดียว)', () => {
  const g = aggregateSignals([
    sig('RB3B-16E060-BA', 'B1', 6, 2, 10),
    sig('RB3B-16E060-BA', 'B1', 6, 3, 10),
    sig('RB3B-16E060-BA', 'B5', 6, 4, 10),
  ]);
  assert.equal(g.length, 2);
  const b1 = g.find(x => x.dock_code === 'B1');
  const b5 = g.find(x => x.dock_code === 'B5');
  assert.equal(b1.qty, 20);
  assert.equal(b5.qty, 10);
});

test('signalKey: dock อยู่ในคีย์ — พาร์ทเดียวกัน วินาทีเดียวกัน คนละ dock = คนละแถว', () => {
  assert.notEqual(signalKey(sig('P1', 'B1', 6, 0, 10)), signalKey(sig('P1', 'B5', 6, 0, 10)));
  assert.equal(signalKey(sig('P1', 'B1', 6, 0, 10)), signalKey(sig('P1', 'B1', 6, 0, 99)));
});

test('dockKey: ว่าง/null = "ไม่ระบุ" ไม่ใช่ dock จริง', () => {
  assert.equal(dockKey(null), '');
  assert.equal(dockKey('  b5 '), 'B5');
});

/* ── ใบของ dock อื่นห้ามถูกแตะ ─────────────────────────────────────────────── */
const ord = (o) => ({ id: o.id, customer_part_no: o.part, mat_no: o.mat || 'M1', qty: o.qty,
  due_date: '2026-09-15', ship_time: o.t, status: o.status || 'pending',
  dock_code: o.dock ?? null, pull_batch_id: o.batch ?? null });
const resolve = () => ({ mat: 'M1', status: 'ok', candidates: [] });

test('ใบที่ dock B1 เคลมไว้ ต้องไม่ถูกไฟล์ dock B5 เอาไปอัพเดท (ต้องขึ้น create)', () => {
  const groups = aggregateSignals([sig('P1', 'B5', 6, 4, 40)]);
  const orders = [ord({ id: 'o1', part: 'P1', qty: 20, t: '09:00', dock: 'B1', batch: 'bA', status: 'confirmed' })];
  const plan = planOrderUpdates(groups, orders, resolve,
    { windowStart: at(6), targetAt: at(9), dock: 'B5', ownBatchIds: [] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'create');
});

test('ใบ 862 เก่าที่ยังไม่มี dock ยังถูกเคลมได้ (ไม่งั้นสร้างใบซ้ำกับแผน)', () => {
  const groups = aggregateSignals([sig('P1', 'B5', 6, 4, 40)]);
  const orders = [ord({ id: 'o1', part: 'P1', qty: 20, t: '09:00', dock: null })];
  const plan = planOrderUpdates(groups, orders, resolve,
    { windowStart: at(6), targetAt: at(9), dock: 'B5', ownBatchIds: [] });
  assert.equal(plan[0].action, 'update');
  assert.equal(plan[0].order.id, 'o1');
});

test('ห่างเท่ากัน — ใบ dock ตรงชนะใบที่ไม่ระบุ dock', () => {
  const groups = aggregateSignals([sig('P1', 'B5', 6, 4, 40)]);
  const orders = [
    ord({ id: 'blank', part: 'P1', qty: 20, t: '09:00', dock: null }),
    ord({ id: 'b5', part: 'P1', qty: 20, t: '09:00', dock: 'B5' }),
  ];
  const plan = planOrderUpdates(groups, orders, resolve,
    { windowStart: at(6), targetAt: at(9), dock: 'B5', ownBatchIds: [] });
  assert.equal(plan[0].order.id, 'b5');
});

test('อัพไฟล์เดิมซ้ำ (batch ของตัวเอง) ต้องแก้ใบเดิมได้ ไม่ใช่ไปสร้างใหม่แล้วชน 23505', () => {
  const groups = aggregateSignals([sig('P1', 'B5', 6, 4, 40)]);
  const orders = [ord({ id: 'o1', part: 'P1', qty: 20, t: '09:00', dock: 'B5', batch: 'bOld', status: 'confirmed' })];
  const plan = planOrderUpdates(groups, orders, resolve,
    { windowStart: at(6), targetAt: at(9), dock: 'B5', ownBatchIds: ['bOld'] });
  assert.equal(plan[0].action, 'update');
  assert.equal(plan[0].diff, 20);
});

/* ── ตารางรอบรับ: ช่วงของ dock หยาบกว่าไฟล์ ───────────────────────────────── */
const ROUNDS = [
  { ship_to: 'GRBNA', dock_code: 'B1', pattern: 'normal', period_start: '06:00', period_end: '10:00', pickup_time: '13:15' },
  { ship_to: 'GRBNA', dock_code: 'B5', pattern: 'normal', period_start: '06:00', period_end: '08:00', pickup_time: '09:00' },
  { ship_to: 'GRBNA', dock_code: 'B5', pattern: 'normal', period_start: '14:00', period_end: '16:00', pickup_time: '22:00' },
  { ship_to: 'GRBNA', dock_code: 'B5', pattern: 'ot_day', period_start: '14:00', period_end: '16:00', pickup_time: '17:00' },
  { ship_to: 'GRBNA', dock_code: 'B5', pattern: 'normal', period_start: '22:00', period_end: '00:00', pickup_time: '01:00' },
];
const pick = (dock, ws, we, pattern = 'normal') =>
  pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock, pattern, windowStart: ws, windowEnd: we });

test('ช่วงตรงเป๊ะชนะเสมอ', () => {
  assert.equal(pick('B5', '06:00', '08:00').pickup_time, '09:00');
  assert.equal(pick('B5', '14:00', '16:00').pickup_time, '22:00');
  assert.equal(pick('B5', '14:00', '16:00', 'ot_day').pickup_time, '17:00');
});

test('ตารางของ dock คร่อมช่วงในไฟล์ → ใช้แถวนั้น (B1 06:00-10:00 คลุมไฟล์ 06:00-08:00)', () => {
  assert.equal(pick('B1', '06:00', '08:00').pickup_time, '13:15');
  assert.equal(pick('B1', '08:00', '10:00').pickup_time, '13:15');
});

test('ห้ามหยิบเวลาของ dock อื่นมาใช้', () => {
  // dock B9 ไม่มีในทะเบียนเลย และไม่มีแถว dock ว่าง ⇒ ต้องได้ null (จอจะเตือนว่าเดาเอา)
  assert.equal(pick('B9', '06:00', '08:00'), null);
});

test('ช่วงข้ามเที่ยงคืนยังจับได้', () => {
  assert.equal(pick('B5', '22:00', '00:00').pickup_time, '01:00');
  assert.equal(pick('B5', '22:00', '23:00').pickup_time, '01:00');   // คร่อม
});

/* ── alarm อัพซ้ำ ────────────────────────────────────────────────────────────── */
test('ช่วงเวลาเดียวกันแต่คนละ dock = ไม่ใช่ไฟล์ซ้ำ', () => {
  const batches = [{ id: 'b1', file_name: 'a.xlsx', dock_code: 'B1',
    window_start: at(6).toISOString(), window_end: at(8).toISOString(), uploaded_at: at(8, 15).toISOString() }];
  assert.equal(findDuplicateUploads(batches, { fileName: 'b.xlsx', windowStart: at(6), windowEnd: at(8), dock: 'B5' }).length, 0);
  assert.equal(findDuplicateUploads(batches, { fileName: 'b.xlsx', windowStart: at(6), windowEnd: at(8), dock: 'B1' })[0].reason, 'same_window');
});

test('batch เก่าที่ยังไม่มี dock_code ยังเตือนเหมือนเดิม (ไม่รู้ ≠ ไม่ซ้ำ)', () => {
  const batches = [{ id: 'b1', file_name: 'a.xlsx', dock_code: null,
    window_start: at(6).toISOString(), window_end: at(8).toISOString(), uploaded_at: at(8).toISOString() }];
  assert.equal(findDuplicateUploads(batches, { fileName: 'b.xlsx', windowStart: at(6), windowEnd: at(8), dock: 'B5' })[0].reason, 'same_window');
});

test('ชื่อไฟล์เดียวกัน = ซ้ำเสมอ แม้ dock ต่าง', () => {
  const batches = [{ id: 'b1', file_name: 'same.xlsx', dock_code: 'B1',
    window_start: at(6).toISOString(), window_end: at(8).toISOString(), uploaded_at: at(8).toISOString() }];
  assert.equal(findDuplicateUploads(batches, { fileName: 'same.xlsx', windowStart: at(1), windowEnd: at(3), dock: 'B5' })[0].reason, 'same_file');
});

/* ── MAT ต้องตรง — เลขพาร์ทลูกค้าตัวเดียวมีหลาย MAT (2026-09-15) ─────────────── */
test('🔴 ห้ามทับใบของ MAT อื่น ที่บังเอิญ normalize เลขพาร์ทลูกค้าแล้วเหมือนกัน', () => {
  const groups = aggregateSignals([sig('RB3B-16E060-BA', 'B5', 6, 4, 40)]);
  const orders = [
    // ใบของอีก MAT (10100384) เวลาใกล้กว่า — เดิมจะถูกเลือกแล้วทับ
    { id: 'wrong', customer_part_no: 'RB3B 16E060 BA', mat_no: '10100384', qty: 50,
      due_date: '2026-09-15', ship_time: '09:00', status: 'pending', dock_code: null, pull_batch_id: null },
    { id: 'right', customer_part_no: 'RB3B 16E060 BA', mat_no: '10100385', qty: 50,
      due_date: '2026-09-15', ship_time: '09:30', status: 'pending', dock_code: null, pull_batch_id: null },
  ];
  const plan = planOrderUpdates(groups, orders, () => ({ mat: '10100385', status: 'ok', candidates: [] }),
    { windowStart: at(6), targetAt: at(9), dock: 'B5', ownBatchIds: [] });
  assert.equal(plan[0].action, 'update');
  assert.equal(plan[0].order.id, 'right', 'ต้องเลือกใบที่ MAT ตรง ไม่ใช่ใบที่เวลาใกล้กว่า');
});

test('ใบที่ยังไม่มี MAT ยังจับด้วยเลขพาร์ทลูกค้าได้ตามเดิม', () => {
  const groups = aggregateSignals([sig('RB3B-16E060-BA', 'B5', 6, 4, 40)]);
  const orders = [{ id: 'nomat', customer_part_no: 'RB3B 16E060 BA', mat_no: null, qty: 50,
    due_date: '2026-09-15', ship_time: '09:00', status: 'pending', dock_code: null, pull_batch_id: null }];
  const plan = planOrderUpdates(groups, orders, () => ({ mat: '10100385', status: 'ok', candidates: [] }),
    { windowStart: at(6), targetAt: at(9), dock: 'B5', ownBatchIds: [] });
  assert.equal(plan[0].action, 'update');
});
