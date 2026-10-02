/* แบ่งคิวเป็นโซนตามสถานะ — ห้ามทิ้งแถวเงียบ (2026-10-02) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByZone, textOn, OTHER_ZONE } from '../statusZones.js';

const Z = [
  { key: 'prep', statuses: ['preparing'], label: 'กำลังเตรียม', color: '#0ea5e9' },
  { key: 'call', statuses: ['pending'], label: 'เรียกแล้ว', color: '#f59e0b' },
];

test('แถวลงโซนตามสถานะ · ลำดับโซนตามที่ส่งมา', () => {
  const g = groupByZone([{ id: 1, status: 'pending' }, { id: 2, status: 'preparing' }, { id: 3, status: 'pending' }], Z);
  assert.deepEqual(g.map(z => z.key), ['prep', 'call']);
  assert.deepEqual(g[0].rows.map(r => r.id), [2]);
  assert.deepEqual(g[1].rows.map(r => r.id), [1, 3]);
});

test('โซนว่างยังอยู่ (จอต้องเขียนว่าว่าง ไม่ใช่หายไป)', () => {
  const g = groupByZone([{ status: 'pending' }], Z);
  assert.equal(g.length, 2);
  assert.equal(g[0].rows.length, 0);
});

test('สถานะที่ไม่รู้จัก ตกโซนสถานะอื่น ไม่หายเงียบ', () => {
  const g = groupByZone([{ id: 9, status: 'weird' }, { id: 1, status: 'pending' }], Z);
  const other = g.find(z => z.key === OTHER_ZONE);
  assert.ok(other);
  assert.deepEqual(other.rows.map(r => r.id), [9]);
  assert.equal(g.reduce((a, z) => a + z.rows.length, 0), 2);
});

test('ไม่มีแถวตก = ไม่มีโซนสถานะอื่น · statusOf กำหนดเองได้ · input ว่างไม่โยน', () => {
  assert.equal(groupByZone([{ s: 'pending' }], Z, r => r.s).some(z => z.key === OTHER_ZONE), false);
  assert.deepEqual(groupByZone(undefined, Z).map(z => z.rows.length), [0, 0]);
});

test('textOn — สีอ่อนได้ตัวเข้ม · สีเข้มได้ตัวขาว · ค่าเพี้ยน = ขาว', () => {
  assert.equal(textOn('#f59e0b'), '#0b1220');
  assert.equal(textOn('#22c55e'), '#0b1220');
  assert.equal(textOn('#1e3a8a'), '#ffffff');
  assert.equal(textOn('nope'), '#ffffff');
});
