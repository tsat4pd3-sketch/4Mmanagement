import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packPages, cellsUsed, clampPage, pageLabels } from '../boardPager.js';

const S = (title, span = 1) => ({ title, span });

test('packPages — พอดีหน้าเดียวก็ต้องได้หน้าเดียว (ห้ามแตกหน้าทิ้งๆ ขว้างๆ)', () => {
  const pages = packPages([S('a'), S('b'), S('c')], 10);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 3);
});

test('packPages — เกินช่องแล้วขึ้นหน้าใหม่ ไม่ใช่ปล่อยให้เลื่อน', () => {
  const items = Array.from({ length: 23 }, (_, i) => S(`s${i}`));
  const pages = packPages(items, 10);
  assert.deepEqual(pages.map(p => p.length), [10, 10, 3]);
});

test('packPages — 🔴 แผ่นกว้าง 2 ช่อง ห้ามถูกผ่าครึ่งคาหน้า', () => {
  // 9 ช่องแรกเต็ม แล้วเจอแผ่น span 2 → เหลือ 1 ช่อง ใส่ไม่ได้ ต้องยกไปหน้าใหม่ทั้งใบ
  const items = [...Array.from({ length: 9 }, (_, i) => S(`s${i}`)), S('OEE', 2), S('t')];
  const pages = packPages(items, 10);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 9);                 // หน้าแรกเหลือ 1 ช่องว่าง — ยอมได้
  assert.deepEqual(pages[1].map(x => x.title), ['OEE', 't']);
});

test('packPages — นับ "ช่อง" ไม่ใช่ "จำนวนแผ่น"', () => {
  // 4 แผ่น span 2 = 8 ช่อง + 2 แผ่นเดี่ยว = 10 ช่องพอดี
  const items = [S('a', 2), S('b', 2), S('c', 2), S('d', 2), S('e'), S('f')];
  const pages = packPages(items, 10);
  assert.equal(pages.length, 1);
  assert.equal(cellsUsed(pages[0]), 10);
});

test('packPages — span ใหญ่กว่าหน้า = อยู่หน้าของตัวเอง ไม่วนลูป', () => {
  const pages = packPages([S('a'), S('ยักษ์', 99), S('c')], 4);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map(p => p.map(x => x.title)), [['a'], ['ยักษ์'], ['c']]);
});

test('packPages — ไม่มีของ = ไม่มีหน้า (ห้ามคืนหน้าเปล่า 1 ใบ)', () => {
  assert.deepEqual(packPages([], 10), []);
  assert.deepEqual(packPages(null, 10), []);
  assert.deepEqual(packPages([S('a'), null, undefined], 10).length, 1);
});

test('packPages — perPage พัง (0/ลบ/NaN) ต้องไม่ระเบิด', () => {
  assert.equal(packPages([S('a'), S('b')], 0).length, 2);
  assert.equal(packPages([S('a'), S('b')], -5).length, 2);
  assert.equal(packPages([S('a'), S('b')], NaN).length, 2);
});

test('clampPage — ข้อมูลเปลี่ยนแล้วหน้าหาย ต้องเด้งกลับ ไม่ใช่จอว่าง', () => {
  assert.equal(clampPage(5, 3), 2);
  assert.equal(clampPage(-1, 3), 0);
  assert.equal(clampPage(1, 3), 1);
  assert.equal(clampPage(0, 0), 0);
});

test('pageLabels — ป้ายบอกว่าหน้านั้นมีอะไร ไม่ใช่แค่เลขหน้า', () => {
  const pages = packPages([S('S ความปลอดภัย'), S('Q คุณภาพ'), S('D ส่งมอบ')], 2);
  assert.deepEqual(pageLabels(pages), ['S ความปลอดภัย → Q คุณภาพ', 'D ส่งมอบ']);
  assert.deepEqual(pageLabels([[{}]]), ['หน้า 1']);   // ไม่มีชื่อ = ใช้เลขหน้า
});
