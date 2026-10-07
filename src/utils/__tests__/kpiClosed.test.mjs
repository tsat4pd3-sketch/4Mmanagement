/* เทส "เปิดคืน KPI ที่ปิดใช้งาน" (07/10/2026) — feedback: ปิดหัวข้อ KPI แล้ว add ใหม่ไม่ได้ (23505) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findClosedTwin, restoreQuestion } from '../kpiClosed.js';

const closed = [
  { id: 1, year: 2026, scope_kind: 'department', scope_value: 'MTN', catalog_id: 'kc-9', std_item_id: 'std-4', name: 'Mean Time To Repair (MTTR)', is_active: false },
  { id: 2, year: 2026, scope_kind: 'plant', scope_value: null, catalog_id: 'kc-1', name: 'Raw Material Control', is_active: false, kpi_catalog: { name: '%RM (Raw Material)' } },
  { id: 3, year: 2026, scope_kind: 'section', scope_value: 'PD3', source: 'auto:ppm', name: 'PPM', is_active: false },
  { id: 4, year: 2025, scope_kind: 'department', scope_value: 'MTN', catalog_id: 'kc-9', name: 'MTTR', is_active: false },
  { id: 5, year: 2026, scope_kind: 'department', scope_value: 'MTN', catalog_id: 'kc-8', name: 'ยังเปิดอยู่', is_active: true },
];

test('จับคู่ด้วย catalog_id ก่อน · ปี/ขอบเขตต้องตรงเป๊ะ · แถวที่ยังเปิดอยู่ไม่นับ', () => {
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'department', scope_value: 'MTN', catalog_id: 'kc-9', name: 'อะไรก็ได้' })?.id, 1);
  assert.equal(findClosedTwin(closed, { year: 2025, scope_kind: 'department', scope_value: 'MTN', catalog_id: 'kc-9' })?.id, 4, 'คนละปี = คนละแถว');
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'department', scope_value: 'JIG MTN', catalog_id: 'kc-9' }), null, 'คนละขอบเขต = ไม่ใช่ตัวเดียวกัน');
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'department', scope_value: 'MTN', catalog_id: 'kc-8' }), null, 'แถวที่ยังเปิดอยู่ไม่ใช่ของที่ต้องเปิดคืน');
});

test('ไม่มี catalog → source (auto:*) → std_item_id → ชื่อ normalize · "manual" ไม่ใช่คีย์', () => {
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'section', scope_value: 'PD3', source: 'auto:ppm' })?.id, 3);
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'department', scope_value: 'MTN', std_item_id: 'std-4', name: 'x' })?.id, 1);
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'department', scope_value: 'MTN', source: 'manual', name: 'mean time to repair mttr' })?.id, 1, 'ชื่อเทียบแบบไม่สนวงเล็บ/ตัวพิมพ์');
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'department', scope_value: 'MTN', source: 'manual', name: 'ไม่มีชื่อนี้' }), null);
});

test('ระดับโรงงาน: scope_kind plant/undefined เทียบกันได้ · ชื่อจากทะเบียน (kpi_catalog.name) ก็จับคู่ได้', () => {
  assert.equal(findClosedTwin(closed, { year: 2026, scope_kind: 'plant', scope_value: null, name: '%RM (Raw Material)' })?.id, 2);
  assert.equal(findClosedTwin(closed, { year: 2026, name: 'Raw Material Control' })?.id, 2, 'ไม่ส่ง scope_kind = plant');
  assert.equal(findClosedTwin([], { year: 2026, name: 'x' }), null);
  assert.equal(findClosedTwin(closed, null), null);
});

test('restoreQuestion บอกชื่อ+ปี และบอกว่าค่าเดิมกลับมา (คนต้องรู้ว่าไม่ได้สร้างใหม่)', () => {
  const q = restoreQuestion(closed[1], 2569);
  assert.match(q, /%RM \(Raw Material\)/);
  assert.match(q, /2569/);
  assert.match(q, /กลับมาด้วย/);
});
