import test from 'node:test';
import assert from 'node:assert/strict';
import { INTAKE_KINDS, mergeIntakeLog, intakeSummary, filterIntake } from '../orderIntakeLog.js';

const PULL = [{
  id: 'p1', uploaded_at: '2026-09-08T15:10:00', ship_to: 'GRBNA', uploaded_by: 'สมชาย',
  file_name: 'Detailed_SMART.csv', window_start: '2026-09-08T12:00:00', window_end: '2026-09-08T14:00:00',
  work_date: '2026-09-08', ship_time: '15:00',
  row_count: 7, new_signals: 7, orders_updated: 2, orders_created: 1, orders_skipped: 1,
}];
const EDI = [{ id: 'e1', kind: 'orders', uploaded_at: '2026-09-08T08:30:00', uploaded_by: 'Sales', file_name: 'EDI 862 × 2 ไฟล์', row_count: 922 }];
const MANUAL = [{
  id: 'o1', created_at: '2026-09-08T17:00:00', customer: 'GRBNA', created_by_name: 'สมหญิง',
  mat_no: '10100385', customer_part_no: 'RB3B 16E060 BA', part_name: 'REINF ASY', qty: 40,
  due_date: '2026-09-09', ship_time: '10:00', status: 'pending',
}];

test('⭐ รวม 3 ทางเข้าเป็นไทม์ไลน์เดียว เรียงใหม่→เก่า', () => {
  const rows = mergeIntakeLog({ pullBatches: PULL, ediBatches: EDI, manualOrders: MANUAL });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.kind), ['manual', 'esmart', 'edi']);   // 17:00 → 15:10 → 08:30
});

test('e-SMART — ต้องเห็นช่วงเวลา รอบส่ง และผลที่เขียนใบจริง', () => {
  const [r] = mergeIntakeLog({ pullBatches: PULL });
  assert.equal(r.kind, 'esmart');
  assert.equal(r.title, 'Detailed_SMART.csv');
  assert.ok(r.detail.includes('12:00–14:00'));
  assert.ok(r.detail.includes('รอบส่ง 15:00'));
  assert.deepEqual(r.stats, { rows: 7, fresh: 7, updated: 2, created: 1, skipped: 1 });
  assert.equal(r.by, 'สมชาย');
  assert.equal(r.ref.batch_id, 'p1');
});

test('คีย์มือ — 1 ใบ = 1 รายการ พร้อมคนคีย์', () => {
  const [r] = mergeIntakeLog({ manualOrders: MANUAL });
  assert.equal(r.kind, 'manual');
  assert.ok(r.title.includes('10100385'));
  assert.ok(r.detail.includes('ส่ง 2026-09-09 10:00'));
  assert.equal(r.stats.qty, 40);
  assert.equal(r.by, 'สมหญิง');
});

test('🔴 คนคีย์/ผู้อัพที่ยังไม่มีข้อมูล = null ห้ามเดาชื่อ', () => {
  const [r] = mergeIntakeLog({ manualOrders: [{ ...MANUAL[0], created_by_name: null }] });
  assert.equal(r.by, null);   // ใบเก่าก่อนมีคอลัมน์ — จอต้องเขียน "ไม่ระบุ" ไม่ใช่แต่งชื่อ
});

test('ค่าตัวเลขที่หายไป = 0 ไม่ใช่ NaN (การ์ดต้องไม่ขึ้น NaN)', () => {
  const [r] = mergeIntakeLog({ pullBatches: [{ id: 'p', uploaded_at: '2026-09-08T10:00:00' }] });
  assert.deepEqual(r.stats, { rows: 0, fresh: 0, updated: 0, created: 0, skipped: 0 });
  assert.equal(r.detail, '');
  assert.equal(r.title, 'ไฟล์ e-SMART');
});

test('เวลาเท่ากันต้องเรียงนิ่ง (ลำดับห้ามสลับไปมาทุกครั้งที่โหลด)', () => {
  const at = '2026-09-08T09:00:00';
  const a = mergeIntakeLog({ ediBatches: [{ id: 'b', uploaded_at: at }, { id: 'a', uploaded_at: at }] });
  const b = mergeIntakeLog({ ediBatches: [{ id: 'a', uploaded_at: at }, { id: 'b', uploaded_at: at }] });
  assert.deepEqual(a.map(x => x.key), b.map(x => x.key));
});

test('ไม่มีข้อมูล/ส่ง null = ไม่ throw', () => {
  assert.deepEqual(mergeIntakeLog(), []);
  assert.deepEqual(mergeIntakeLog({ pullBatches: null, ediBatches: null, manualOrders: null }), []);
  assert.deepEqual(intakeSummary(null), { total: 0, esmart: 0, manual: 0, edi: 0, ordersUpdated: 0, ordersCreated: 0, ordersSkipped: 0 });
});

test('intakeSummary — นับรายการต่อทางเข้า + รวมผลที่ e-SMART เขียนใบ', () => {
  const s = intakeSummary(mergeIntakeLog({ pullBatches: [...PULL, PULL[0]], ediBatches: EDI, manualOrders: MANUAL }));
  assert.equal(s.total, 4);
  assert.equal(s.esmart, 2);
  assert.equal(s.manual, 1);
  assert.equal(s.edi, 1);
  assert.equal(s.ordersUpdated, 4);   // 2 × 2 ก้อน
  assert.equal(s.ordersCreated, 2);
  assert.equal(s.ordersSkipped, 2);
});

test('filterIntake — กรองตามทางเข้า', () => {
  const rows = mergeIntakeLog({ pullBatches: PULL, ediBatches: EDI, manualOrders: MANUAL });
  assert.equal(filterIntake(rows, { kind: 'esmart' }).length, 1);
  assert.equal(filterIntake(rows, { kind: 'all' }).length, 3);
});

test('🔴 filterIntake ลูกค้า — EDI (1 ไฟล์หลายเจ้า ไม่มี ship_to) ต้องไม่ถูกตัดทิ้ง', () => {
  const rows = mergeIntakeLog({ pullBatches: PULL, ediBatches: EDI, manualOrders: MANUAL });
  const only = filterIntake(rows, { shipTo: 'GRBNA' });
  assert.equal(only.length, 3);
  const other = filterIntake(rows, { shipTo: 'GBL9A' });
  assert.deepEqual(other.map(r => r.kind), ['edi']);   // e-SMART/คีย์มือของ GRBNA ถูกกรองออก · EDI ยังอยู่
});

test('filterIntake — ค้นได้ทั้งชื่อไฟล์ MAT คนทำ และลูกค้า', () => {
  const rows = mergeIntakeLog({ pullBatches: PULL, ediBatches: EDI, manualOrders: MANUAL });
  assert.equal(filterIntake(rows, { q: 'detailed_smart' }).length, 1);   // ไม่สนตัวพิมพ์
  assert.equal(filterIntake(rows, { q: '10100385' }).length, 1);
  assert.equal(filterIntake(rows, { q: 'สมชาย' }).length, 1);
  assert.equal(filterIntake(rows, { q: 'ไม่มีคำนี้' }).length, 0);
  assert.equal(filterIntake(rows, { q: '  ' }).length, 3);               // ช่องว่างล้วน = ไม่กรอง
});

test('INTAKE_KINDS — ทุก kind ที่ merge คืนต้องมีป้าย/สี (ไม่งั้นการ์ดว่าง)', () => {
  const rows = mergeIntakeLog({ pullBatches: PULL, ediBatches: EDI, manualOrders: MANUAL });
  rows.forEach(r => {
    assert.ok(INTAKE_KINDS[r.kind], r.kind);
    assert.ok(INTAKE_KINDS[r.kind].label && INTAKE_KINDS[r.kind].color);
  });
});
