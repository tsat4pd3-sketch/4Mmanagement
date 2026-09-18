/* เทสการแบ่ง "เลน" ก่อนต่อคิวบนบอร์ด Heijunka — buildLanes / positionAllCards / delayedCountOf
   ที่มา (2026-09-16): โค้ดแบ่งเลนถูก copy ไว้ทั้ง Dashboard.jsx และ Management.jsx เหมือนกันทุกบรรทัด
   แต่ตัวนับดีเลย์บนหัวการ์ดยังเป็นคนละสูตร ⇒ **บอร์ดเดียวกัน 2 จอ ขึ้น "ดีเลย์ N ใบ" คนละเลข**
   ย้ายมาไว้ใน util ตัวเดียวแล้ว — เทสชุดนี้ล็อกกติกาแบ่งเลนไว้ ห้าม copy กลับไปไว้ในหน้า

   ⏱️ ตรึงเวลาเองทุกเคส ไม่มี Date.now() (กันเทสระเบิดเวลา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLanes, positionAllCards, delayedCountOf, orderKeyOf } from '../heijunkaQueue.js';

const T0 = Date.parse('2026-09-01T01:00:00Z');       // 08:00 ไทย
const H = 3600_000;
const card = (id, o = {}) => ({
  id, line_name: 'L1', mat_no: 'M1', machine_no: null, status: 'open',
  orderStartMs: T0, orderEndMs: T0 + H, qty: 60, qty_actual: 0, ...o,
});
const laneKeys = (cards, opt) => Object.keys(buildLanes(cards, opt)).sort();

test('ไลน์ธรรมดา: ทุกใบอยู่เลนเดียว (1 ไลน์ผลิตได้ทีละใบ)', () => {
  const lanes = buildLanes([card('a'), card('b', { mat_no: 'M2' })]);
  assert.deepEqual(Object.keys(lanes), ['L1']);
  assert.equal(lanes.L1.length, 2);
});

test('คนละ sub-line = คนละเลน (คนละเครื่องจริง วิ่งขนานได้)', () => {
  assert.deepEqual(laneKeys([card('a'), card('b', { line_name: 'L2' })]), ['L1', 'L2']);
});

test('งานคู่ RH/LH ที่อยู่ไลน์เดียวกัน = แยกเลน เริ่มพร้อมกัน', () => {
  const cards = [card('rh', { mat_no: 'RH' }), card('lh', { mat_no: 'LH' })];
  const opt = { pairMatByMat: { RH: 'LH', LH: 'RH' } };
  assert.deepEqual(laneKeys(cards, opt), ['L1||LH', 'L1||RH']);
  const pos = positionAllCards(cards, {
    breaks: [], ctByMat: { RH: 60, LH: 60 }, nowMs: T0,
    roundIndexOf: () => 0, roundStartOf: () => T0, ...opt,
  });
  assert.equal(pos.get('rh').startMs, pos.get('lh').startMs, 'แม่พิมพ์คู่ปั๊มพร้อมกัน แถบต้องตรงกัน');
});

test('คู่ที่มีแค่ข้างเดียวในไลน์ ไม่แยกเลน (ไม่ได้ปั๊มคู่จริง)', () => {
  assert.deepEqual(laneKeys([card('rh', { mat_no: 'RH' })], { pairMatByMat: { RH: 'LH' } }), ['L1']);
});

test('ไลน์เครื่องขนาน: ใบที่ผูกเครื่องแล้ว = เลนของเครื่องนั้น', () => {
  const opt = { flowByLine: { L1: { flow_mode: 'parallel_machine', parallel_stations: 3 } } };
  assert.deepEqual(
    laneKeys([card('a', { machine_no: 'SP-1' }), card('b', { machine_no: 'SP-2' })], opt),
    ['L1||M:SP-1', 'L1||M:SP-2'],
  );
});

test('ไลน์เครื่องขนาน: ใบที่ยังไม่ผูกเครื่อง กระจาย round-robin ตามจำนวนเครื่อง', () => {
  const opt = { flowByLine: { L1: { flow_mode: 'parallel_machine', parallel_stations: 2 } } };
  assert.deepEqual(laneKeys([card('a'), card('b'), card('c')], opt), ['L1||P:0', 'L1||P:1']);
});

test('ไม่ตั้ง parallel_stations → นับเครื่องจากทะเบียน machine_points แทน', () => {
  const opt = {
    flowByLine: { L1: { flow_mode: 'parallel_machine' } },
    machineCountByLine: { L1: new Set(['A', 'B', 'C']) },
  };
  assert.deepEqual(laneKeys([card('a'), card('b'), card('c'), card('d')], opt), ['L1||P:0', 'L1||P:1', 'L1||P:2']);
});

test('เลนเดียวกันห้ามซ้อนทับ — ใบที่ 2 ต้องเริ่มหลังใบแรกจบ', () => {
  const pos = positionAllCards([card('a'), card('b')], {
    breaks: [], ctByMat: { M1: 60 }, nowMs: T0,
    roundIndexOf: () => 0, roundStartOf: () => T0,
  });
  assert.ok(pos.get('b').startMs >= pos.get('a').endMs, '1 ไลน์ทีละใบ');
});

test('delayedCountOf นับจาก Map ที่ positionAllCards คืน — 2 หน้าจึงได้เลขเดียวกันเสมอ', () => {
  const late = { orderStartMs: T0, orderEndMs: T0 + H, status: 'open' };
  const pos = positionAllCards([card('a', late), card('b', late)], {
    breaks: [], ctByMat: { M1: 60 }, nowMs: T0 + 6 * H,   // ผ่านไป 6 ชม. ยังไม่ปิดทั้งคู่
    roundIndexOf: () => 0, roundStartOf: () => T0,
  });
  assert.equal(delayedCountOf(pos), 2);
});

test('ใบ backfill ไม่ถูกนับเป็นดีเลย์ (เวลาเปิดคนกรอกเอง ตัดสินไม่ได้)', () => {
  const pos = positionAllCards([card('a', { is_backfill: true })], {
    breaks: [], ctByMat: { M1: 60 }, nowMs: T0 + 6 * H,
    roundIndexOf: () => 0, roundStartOf: () => T0,
  });
  assert.equal(delayedCountOf(pos), 0);
});

test('orderKeyOf ใช้ id ก่อน แล้วค่อย prod_no (ใบ manual ไม่มี id ต้องยังค้นเจอ)', () => {
  assert.equal(orderKeyOf({ id: 'x', prod_no: 'P1' }), 'x');
  assert.equal(orderKeyOf({ prod_no: 'P1' }), 'P1');
});
