/* 22/10 — ไฟล์ e-SMART ที่มี B1 + B5 ปนกัน (AAT 08–10 · Detailed SMART (19))
   เดิมใช้รอบรับของ B1 กับทั้งไฟล์ + รอบรับ 01:15 ถูกวางไว้ "ก่อน" ปลายช่วง ⇒ ใบไปอยู่ 01:00 ของเมื่อคืน
   ของ B5 ไม่ไปทับใบแผน B5 ⇒ หน้างานคีย์มือซ้ำ (add order) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTs, shipSlotOf, dockLegsOf, planDockLegs, roundGapMin, pullRoundOptions } from '../pullSignal.js';

const ROUNDS = [
  { ship_to: 'GRBNA', dock_code: 'B5', pattern: 'normal', period_start: '08:00', period_end: '10:00', pickup_time: '11:00', is_active: true },
  { ship_to: 'GRBNA', dock_code: 'B1', pattern: 'normal', period_start: '06:00', period_end: '10:00', pickup_time: '13:15', is_active: true },
];
const WS = parseTs('2026-10-22T08:00:00'), WE = parseTs('2026-10-22T10:00:00');
const row = (dock, part = 'RB3B-16E060-BA', qty = 10) => ({ ship_to: 'GRBNA', customer_part_no: part, qty, dock_code: dock, pulled_at: WS });

test('🔴 รอบรับที่เวลาน้อยกว่าปลายช่วง = วันถัดไป ไม่ใช่เมื่อคืน (01:15 หลังช่วง 08–10)', () => {
  const s = shipSlotOf(WE, 60, { pickup_time: '01:15', period_start: '06:00', period_end: '10:00' });
  assert.equal(s.ship_time, '01:15');
  assert.equal(s.work_date, '2026-10-22', 'วันงาน 22/10 (กะดึกของคืน 22→23) ไม่ใช่ 21/10');
  assert.equal(s.at.getDate(), 23);
});

test('รอบรับปกติหลังปลายช่วงไม่ขยับ · ตั้ง pickup_day_offset เอง = เชื่อทะเบียน', () => {
  assert.equal(shipSlotOf(WE, 60, { pickup_time: '11:00' }).at.getDate(), 22);
  assert.equal(shipSlotOf(WE, 60, { pickup_time: '09:00', pickup_day_offset: 1 }).at.getDate(), 23);
  assert.equal(shipSlotOf(parseTs('2026-10-23T00:00:00'), 60, { pickup_time: '01:00' }).at.getDate(), 23);
});

test('roundGapMin — จับทะเบียนพิมพ์ผิด (06–10 → 01:15 = 15 ชม.)', () => {
  assert.equal(roundGapMin({ period_end: '10:00', pickup_time: '01:15' }), 15 * 60 + 15);
  assert.equal(roundGapMin({ period_end: '22:00', pickup_time: '23:15' }), 75);
  assert.equal(roundGapMin({ period_end: '00:00', pickup_time: '01:00' }), 60);
  assert.equal(roundGapMin({ period_end: '', pickup_time: '01:00' }), null);
});

const mixed = () => ({
  rows: [row('B1'), row('B1'), row('B1'), row('B5'), row('B5'), row(null)],
  dock: 'B1', docks: ['B1', 'B5'], windowStart: WS, windowEnd: WE, leadMin: 60,
  dockSlots: { B5: { patternOptions: pullRoundOptions(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: WS, windowEnd: WE }) } },
});

test('⭐ ไฟล์ B1+B5 → 2 เที่ยว · B5 ใช้รอบรับของ B5 (11:00) ไม่ใช่รอบของ B1', () => {
  const legs = dockLegsOf(mixed(), { pattern: 'normal', shipTime: '13:15', workDate: '2026-10-22' });
  assert.deepEqual(legs.map(l => [l.dock, l.rows.length, l.shipTime, l.workDate, l.primary]),
    [['B1', 4, '13:15', '2026-10-22', true], ['B5', 2, '11:00', '2026-10-22', false]]);
});

test('dock อื่นที่ไม่มีตารางรอบรับ = สูตรปลายช่วง + lead (บอก fromLead ให้จอเตือน)', () => {
  const p = { ...mixed(), dockSlots: { B5: { patternOptions: [] } } };
  const b5 = dockLegsOf(p, { shipTime: '13:15', workDate: '2026-10-22' })[1];
  assert.equal(b5.shipTime, '11:00');
  assert.equal(b5.fromLead, true);
});

test('ไฟล์ dock เดียว = เที่ยวเดียวเหมือนเดิม', () => {
  const legs = dockLegsOf({ rows: [row('B5')], dock: 'B5', docks: ['B5'] }, { shipTime: '11:00', workDate: '2026-10-22' });
  assert.equal(legs.length, 1);
  assert.equal(legs[0].rows.length, 1);
});

const RES = () => ({ mat: '10100385', status: 'mapped', candidates: ['10100385'] });
const ord = (id, time, dock, extra = {}) => ({ id, customer_part_no: 'RB3B 16E060 BA', mat_no: '10100385', qty: 60,
  due_date: '2026-10-22', ship_time: time, status: 'pending', source: 'edi_862', dock_code: dock, ...extra });
const slotOf = (leg) => ({ windowStart: WS, windowEnd: WE, leadMin: 60, targetAt: null, dock: leg.dock, ownBatchIds: [] });

test('⭐ เที่ยว B5 ทับใบแผน B5 10:00 (ดึง 09:00 ในช่วง) · เที่ยว B1 ไม่แตะใบ B5', () => {
  const legs = [
    { dock: 'B1', groups: [{ customer_part_no: 'RB3B-16E060-BA', qty: 30, pulls: 3, dock_code: 'B1' }] },
    { dock: 'B5', groups: [{ customer_part_no: 'RB3B-16E060-BA', qty: 20, pulls: 2, dock_code: 'B5' }] },
  ];
  const plan = planDockLegs(legs, [ord('b5-10', '10:00', 'B5')], RES, slotOf);
  const b1 = plan.find(x => x.leg.dock === 'B1'), b5 = plan.find(x => x.leg.dock === 'B5');
  assert.equal(b1.action, 'create');
  assert.equal(b5.action, 'update');
  assert.equal(b5.order.id, 'b5-10');
});

test('ใบที่เที่ยวแรกใช้ไปแล้ว ห้ามเที่ยวถัดไปเคลมซ้ำ (ใบไม่ระบุ dock)', () => {
  const legs = [
    { dock: 'B5', groups: [{ customer_part_no: 'RB3B-16E060-BA', qty: 20, pulls: 2, dock_code: 'B5' }] },
    { dock: 'B1', groups: [{ customer_part_no: 'RB3B-16E060-BA', qty: 30, pulls: 3, dock_code: 'B1' }] },
  ];
  const plan = planDockLegs(legs, [ord('nodock', '10:00', null)], RES, slotOf);
  assert.equal(plan.filter(x => x.order?.id === 'nodock').length, 1);
});
