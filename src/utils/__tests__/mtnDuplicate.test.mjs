import test from 'node:test';
import assert from 'node:assert/strict';
import { findOpenOnMachine, dupLevel, daysOpen } from '../mtnDuplicate.js';

/* 🕐 ตรึงเวลาไว้เสมอ — `npm test` รัน 2 รอบ (ปกติ + นาฬิกา +400 วัน)
   เทสที่อ่าน Date.now() เองจะผ่านวันนี้แล้วตกเองวันหลังโดยไม่มี commit ไหนทำ */
const NOW = new Date('2026-09-30T10:00:00+07:00').getTime();
const at = (d) => `${d}T08:00:00+07:00`;

const ROWS = [
  { id: 1, mo_no: 'MTN.2026/09-8',      machine_no: 'SP-80/NF93', status: 'checked',  mtn_dept: 'maintenance', report_at: at('2026-09-17') },
  { id: 2, mo_no: 'PRO-BM-170926-0400', machine_no: 'SP-80/NF93', status: 'checked',  mtn_dept: 'production',  report_at: at('2026-09-17') },
  { id: 3, mo_no: 'PRO-BM-010926-0001', machine_no: 'SW10',       status: 'assigned', mtn_dept: 'production',  report_at: at('2026-09-01') },
  { id: 4, mo_no: 'PRO-BM-020926-0002', machine_no: 'sw-010',     status: 'pending',  mtn_dept: 'production',  report_at: at('2026-09-02') },
  { id: 5, mo_no: 'PRO-BM-030926-0003', machine_no: 'SW-10',      status: 'closed',   mtn_dept: 'production',  report_at: at('2026-09-03') },
  { id: 6, mo_no: 'PRO-BM-040926-0004', machine_no: 'SW-10',      status: 'transferred', mtn_dept: 'production', report_at: at('2026-09-04') },
  { id: 7, mo_no: null,                 machine_no: 'RB-115',     status: 'pending',  mtn_dept: 'jig_maintenance', report_at: at('2026-09-15') },
];

test('เทียบเครื่องด้วยคีย์ ไม่ใช่ string ตรงๆ — SW10 / sw-010 / SW-10 คือตัวเดียวกัน', () => {
  const d = findOpenOnMachine(ROWS, 'SW-10', { now: NOW });
  assert.deepEqual(d.map(o => o.id), [3, 4], 'ต้องได้เฉพาะใบที่ยังเปิด และต้องจับ SW10/sw-010 ได้');
});

test('สถานะที่จบแล้วต้องไม่ถูกนับเป็นใบซ้ำ (closed + transferred)', () => {
  const ids = findOpenOnMachine(ROWS, 'SW10', { now: NOW }).map(o => o.id);
  assert.ok(!ids.includes(5), 'closed ต้องไม่ติดมา');
  assert.ok(!ids.includes(6), 'transferred ต้องไม่ติดมา — เคยตกหล่นเพราะเขียนลิสต์สถานะจบเอง');
});

test('เรียงเก่าสุดก่อน + ใส่จำนวนวันค้างตาม now ที่ส่งเข้ามา', () => {
  const d = findOpenOnMachine(ROWS, 'SW 10', { now: NOW });
  assert.equal(d[0].id, 3);
  assert.equal(d[0]._days, 29);
  assert.equal(d[1]._days, 28);
});

test('ไม่เลือกเครื่อง / เครื่องว่าง = ไม่เตือน (ห้ามเตือนทั้งไลน์)', () => {
  for (const v of ['', null, undefined, '   ', '-']) {
    assert.deepEqual(findOpenOnMachine(ROWS, v, { now: NOW }), [], `ค่า ${JSON.stringify(v)} ต้องคืน []`);
  }
});

test('excludeId — ตอนแก้ใบเดิม ต้องไม่เตือนว่าซ้ำกับตัวเอง', () => {
  const d = findOpenOnMachine(ROWS, 'SP-80/NF93', { now: NOW, excludeId: 1 });
  assert.deepEqual(d.map(o => o.id), [2]);
});

test('dupLevel: มีใบของทีมอื่นบนเครื่องเดียวกัน = cross (แดง)', () => {
  const d = findOpenOnMachine(ROWS, 'SP-80/NF93', { now: NOW });
  assert.equal(dupLevel(d, 'production'), 'cross', 'ใบ maintenance ค้างอยู่ ⇒ เสี่ยงทำงานซ้ำ');
});

test('dupLevel: มีแต่ทีมเดียวกัน = same (เหลือง) · ไม่มีใบ = none', () => {
  assert.equal(dupLevel(findOpenOnMachine(ROWS, 'SW-10', { now: NOW }), 'production'), 'same');
  assert.equal(dupLevel([], 'production'), 'none');
});

test('🔴 ไม่รู้ทีมตัวเอง ห้ามเดาเป็น cross — ต้องถอยเป็น same', () => {
  const d = findOpenOnMachine(ROWS, 'SP-80/NF93', { now: NOW });
  assert.equal(dupLevel(d, ''), 'same');
  assert.equal(dupLevel(d, null), 'same');
});

test('daysOpen: ค่าที่อ่านไม่ได้คืน null ห้ามคืน 0', () => {
  assert.equal(daysOpen(null, NOW), null);
  assert.equal(daysOpen('', NOW), null);
  assert.equal(daysOpen('ไม่ใช่วันที่', NOW), null);
  assert.notEqual(daysOpen(undefined, NOW), 0, '0 = "เพิ่งแจ้ง" ซึ่งโกหก');
});
