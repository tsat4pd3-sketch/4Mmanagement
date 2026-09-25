import test from 'node:test';
import assert from 'node:assert/strict';
import { partImageMap, partImageOf, imageCoverage } from '../partImages.js';

test('parts_master ชนะ dr_products เมื่อ mat เดียวกันมีรูปทั้งคู่', () => {
  const m = partImageMap([{ mat_no: '30042566', image_url: 'pm.jpg' }],
                         [{ mat_no: '30042566', image_url: 'dp.jpg' }]);
  assert.equal(m['30042566'], 'pm.jpg');
});

test('mat ที่มีเฉพาะฝั่ง dr_products ยังได้รูป', () => {
  const m = partImageMap([], [{ mat_no: '10088639', image_url: 'dp.jpg' }]);
  assert.equal(m['10088639'], 'dp.jpg');
});

test('รูปว่าง/null ไม่ทับค่าที่มีอยู่แล้ว', () => {
  const m = partImageMap([{ mat_no: 'A', image_url: null }, { mat_no: 'B', image_url: '   ' }],
                         [{ mat_no: 'A', image_url: 'dp.jpg' }, { mat_no: 'B', image_url: 'dp2.jpg' }]);
  assert.equal(m.A, 'dp.jpg');
  assert.equal(m.B, 'dp2.jpg');
});

test('แถวเสีย (ไม่มี mat_no / undefined / null) ไม่ทำให้พัง', () => {
  const m = partImageMap([null, undefined, {}, { image_url: 'x.jpg' }], null);
  assert.deepEqual(m, {});
});

test('mat_no มีช่องว่างหัวท้าย ถูก trim ทั้งตอนสร้างและตอนอ่าน', () => {
  const m = partImageMap([{ mat_no: ' 30042566 ', image_url: 'pm.jpg' }], []);
  assert.equal(partImageOf(m, '30042566'), 'pm.jpg');
  assert.equal(partImageOf(m, ' 30042566'), 'pm.jpg');
});

test('partImageOf คืน null (ไม่ใช่ "") เมื่อไม่มีรูป — กัน <img src=""> ยิงโหลดหน้าเปล่า', () => {
  assert.equal(partImageOf({}, 'X'), null);
  assert.equal(partImageOf(null, 'X'), null);
  assert.equal(partImageOf({ X: 'a.jpg' }, ''), null);
  assert.equal(partImageOf({ X: 'a.jpg' }, null), null);
});

test('imageCoverage นับ mat ซ้ำเป็นตัวเดียว', () => {
  const m = partImageMap([{ mat_no: 'A', image_url: 'a.jpg' }], []);
  assert.deepEqual(imageCoverage(m, ['A', 'A', 'B']), { total: 2, withImg: 1, pct: 50 });
});

test('ไม่มี mat เลย ⇒ pct = null ไม่ใช่ 0 (0% แปลว่า "ไม่มีรูปสักตัว" คนละเรื่องกับ "ไม่มีของให้นับ")', () => {
  assert.deepEqual(imageCoverage({}, []), { total: 0, withImg: 0, pct: null });
});
