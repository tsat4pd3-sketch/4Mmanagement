import test from 'node:test';
import assert from 'node:assert/strict';
import { countDelta, toAdjustTxns, countSummary, lastCountAt, pendingShipCuts } from '../stockCount.js';

/* ─── countDelta — "นับได้เท่าไหร่" ไม่ใช่ "เพิ่ม/ลดเท่าไหร่" ─────────────── */
test('countDelta: ช่องว่าง = ยังไม่นับ ไม่ใช่ศูนย์', () => {
  assert.equal(countDelta(100, ''), null);
  assert.equal(countDelta(100, null), null);
  assert.equal(countDelta(100, undefined), null);
});

test('countDelta: นับได้ 0 จริง = ลดทั้งหมด (ต่างจากช่องว่าง)', () => {
  assert.deepEqual(countDelta(100, 0), { counted: 0, delta: -100, dir: 'down', qty: 100 });
  assert.deepEqual(countDelta(100, '0'), { counted: 0, delta: -100, dir: 'down', qty: 100 });
});

test('countDelta: ตรงกันอยู่แล้ว = ไม่ต้องเขียน ledger', () => {
  assert.equal(countDelta(250, 250), null);
  assert.equal(countDelta(0, 0), null);
});

test('countDelta: เพิ่ม/ลด คิดจากยอดระบบ', () => {
  assert.deepEqual(countDelta(100, 130), { counted: 130, delta: 30, dir: 'up', qty: 30 });
  assert.deepEqual(countDelta(100, 70),  { counted: 70, delta: -30, dir: 'down', qty: 30 });
});

test('countDelta: รับเลขที่มีลูกน้ำ (คนก๊อปจาก Excel)', () => {
  assert.deepEqual(countDelta(1000, '1,250'), { counted: 1250, delta: 250, dir: 'up', qty: 250 });
});

test('countDelta: ค่าที่ไม่ใช่ตัวเลข/ติดลบ = ไม่ทำอะไร ห้ามตีเป็น 0', () => {
  assert.equal(countDelta(100, 'abc'), null);
  assert.equal(countDelta(100, '-5'), null);
});

test('countDelta: ยอดระบบติดลบอยู่ (เคยส่งเกินที่รับเข้า) นับได้ 0 = ปรับขึ้นให้เป็น 0', () => {
  assert.deepEqual(countDelta(-80, 0), { counted: 0, delta: 80, dir: 'up', qty: 80 });
});

/* ─── toAdjustTxns ────────────────────────────────────────────────────────── */
const ROWS = [
  { mat_no: 'A1', part_name: 'ชิ้น A', qty_on_hand: 100 },
  { mat_no: 'B2', part_name: 'ชิ้น B', qty_on_hand: 50 },
  { mat_no: 'C3', part_name: 'ชิ้น C', qty_on_hand: 10 },
];

test('toAdjustTxns: เขียนเฉพาะแถวที่นับแล้วและต่างจากระบบ', () => {
  const tx = toAdjustTxns({ rows: ROWS, lineName: 'FG WAREHOUSE', workDate: '2026-09-23', by: 'ผู้นับ',
    counts: { A1: '120', B2: '50', C3: '' } });
  assert.equal(tx.length, 1);
  assert.equal(tx[0].mat_no, 'A1');
});

test('toAdjustTxns: ปรับลดต้องเก็บ qty ติดลบ (view บวก adjust ตรงๆ)', () => {
  const [tx] = toAdjustTxns({ rows: ROWS, lineName: 'L', workDate: '2026-09-23', counts: { B2: 20 } });
  assert.equal(tx.qty, -30);
  assert.equal(tx.type, 'adjust');
});

test('toAdjustTxns: note บอกที่มาของตัวเลขทั้งก่อน-หลัง (สอบกลับได้)', () => {
  const [tx] = toAdjustTxns({ rows: ROWS, lineName: 'L', workDate: '2026-09-23', counts: { A1: 120 }, note: 'รอบเดือน ก.ย.' });
  assert.match(tx.note, /ระบบ 100/);
  assert.match(tx.note, /นับได้ 120/);
  assert.match(tx.note, /รอบเดือน ก\.ย\./);
});

test('toAdjustTxns: ไม่กำหนด status เอง (ผู้เรียกตัดสินตามสิทธิ์ pending/approved)', () => {
  const [tx] = toAdjustTxns({ rows: ROWS, lineName: 'L', workDate: '2026-09-23', counts: { A1: 120 } });
  assert.equal('status' in tx, false);
});

/* ─── countSummary ────────────────────────────────────────────────────────── */
test('countSummary: แยก "นับแล้วตรง" ออกจาก "ยังไม่นับ" — จอต้องบอกได้ว่านับไปกี่ตัว', () => {
  const s = countSummary({ rows: ROWS, counts: { A1: 120, B2: 50, C3: '' } });
  assert.deepEqual(s, { counted: 2, same: 1, up: 1, down: 0, upQty: 20, downQty: 0, changed: 1 });
});

test('countSummary: รวมยอดเพิ่ม/ลดแยกกัน ห้ามหักกลบ', () => {
  const s = countSummary({ rows: ROWS, counts: { A1: 150, B2: 10 } });
  assert.equal(s.upQty, 50);
  assert.equal(s.downQty, 40);
  assert.equal(s.changed, 2);
});

/* ─── lastCountAt ─────────────────────────────────────────────────────────── */
test('lastCountAt: เอารอบล่าสุดต่อ คลัง+mat · นับเฉพาะ adjust ที่อนุมัติแล้ว', () => {
  const m = lastCountAt([
    { type: 'adjust', status: 'approved', line_name: 'FG', mat_no: 'A1', created_at: '2026-09-01T00:00:00Z' },
    { type: 'adjust', status: 'approved', line_name: 'FG', mat_no: 'A1', created_at: '2026-09-23T05:00:00Z' },
    { type: 'adjust', status: 'pending',  line_name: 'FG', mat_no: 'B2', created_at: '2026-09-23T05:00:00Z' },
    { type: 'consume', status: 'approved', line_name: 'FG', mat_no: 'C3', created_at: '2026-09-23T05:00:00Z' },
  ]);
  assert.equal(m['FG\u0000A1'], '2026-09-23T05:00:00Z');
  assert.equal(m['FG\u0000B2'], undefined, 'adjust ที่ยังไม่อนุมัติ ยังไม่มีผลต่อยอด = ปิดใบส่งไม่ได้');
  assert.equal(m['FG\u0000C3'], undefined, 'consume ไม่ใช่การตรวจนับ');
});

/* ─── pendingShipCuts — กฎเหล็ก: ห้ามหักย้อนข้ามรอบตรวจนับ ─────────────── */
const ORDERS = [
  { id: 'o1', mat_no: 'A1', qty: 100, shipped_at: '2026-08-20T03:00:00Z' },  // ก่อนรอบนับ
  { id: 'o2', mat_no: 'A1', qty: 200, shipped_at: '2026-09-23T09:00:00Z' },  // หลังรอบนับ
  { id: 'o3', mat_no: 'B2', qty: 50,  shipped_at: '2026-09-10T03:00:00Z' },  // ไม่เคยนับ
  { id: 'o4', mat_no: 'ZZ', qty: 10,  shipped_at: '2026-09-10T03:00:00Z' },  // จับคู่ SAP ไม่ได้
];
const COUNTED = { 'FG\u0000A1': '2026-09-23T05:00:00Z' };
const SAP_OF = (m) => (m === 'ZZ' ? null : m);

test('pendingShipCuts: ใบที่ส่งก่อนรอบตรวจนับ ถือว่าปิดแล้ว ห้ามหักซ้ำ', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF });
  assert.deepEqual(r.closedByCount.map(x => x.id), ['o1']);
});

test('pendingShipCuts: ใบที่ส่งหลังรอบตรวจนับ ยังต้องหัก', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF });
  assert.deepEqual(r.open.map(x => x.id).sort(), ['o2', 'o3']);
});

test('pendingShipCuts: จับคู่เลข SAP ไม่ได้ = แยกไว้ ห้ามเดาแล้วหักมั่ว', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF });
  assert.deepEqual(r.unresolved.map(x => x.id), ['o4']);
  assert.equal(r.unresolved[0].sap, null);
});

test('pendingShipCuts: ใบที่หักไปแล้ว หายจากทุกกอง (idempotent)', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(['o1', 'o2', 'o3', 'o4']), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF });
  assert.equal(r.open.length + r.closedByCount.length + r.unresolved.length, 0);
});

test('pendingShipCuts: ไม่มี shipped_at ให้ถอยไปใช้ due_date สิ้นวัน (ใบเก่าก่อนมีคอลัมน์)', () => {
  const r = pendingShipCuts({
    orders: [{ id: 'x', mat_no: 'A1', qty: 5, shipped_at: null, due_date: '2026-08-01' }],
    cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF,
  });
  assert.deepEqual(r.closedByCount.map(x => x.id), ['x']);
});

test('pendingShipCuts: คลังคนละตัวไม่ปิดให้กัน (นับ FG ไม่ปิดใบของ STORE)', () => {
  const r = pendingShipCuts({ orders: [ORDERS[0]], cutIds: new Set(), counted: COUNTED, fgLine: 'STORE', sapOf: SAP_OF });
  assert.deepEqual(r.open.map(x => x.id), ['o1']);
});
