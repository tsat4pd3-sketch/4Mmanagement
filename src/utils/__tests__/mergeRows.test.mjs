import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeById, uniqueById } from '../mergeRows.js';

/* คลาสบั๊ก: 2 คิวรีของตารางเดียวกัน (เงื่อนไข "ไม่ทับกันอยู่แล้ว") แต่ไม่ใช่ transaction
   ⇒ แถวที่ถูกแก้ระหว่างอ่าน มาถึงจอ 2 ใบ id เดียวกัน = คีย์ซ้ำ React กลืนแถวแบบไม่การันตี
   วัดจริง 08/10 จาก harness: /morning-meeting 14 · /rack-center 15 · /customer-demand 4 */

test('mergeById — แถว id เดียวกันเหลือใบเดียว', () => {
  const open = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }];
  const done = [{ id: 'b', status: 'received' }, { id: 'c', status: 'received' }];
  const out = mergeById(open, done);
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map(r => r.id)).size, 3);
});

test('mergeById — ชุดที่ส่งทีหลังชนะ (ใบที่ปิดแล้วห้ามค้างในคอลัมน์รอทำ)', () => {
  const out = mergeById([{ id: 'b', status: 'pending' }], [{ id: 'b', status: 'received' }]);
  assert.deepEqual(out, [{ id: 'b', status: 'received' }]);
});

test('mergeById — ลำดับคงเดิม: ที่เหลือของชุดแรกมาก่อนชุดหลัง', () => {
  const out = mergeById(
    [{ id: 1 }, { id: 2 }, { id: 3 }],
    [{ id: 3 }, { id: 4 }],
  );
  assert.deepEqual(out.map(r => r.id), [1, 2, 3, 4]);
});

test('mergeById — id เป็นเลขกับสตริงที่เขียนต่างกัน ถือว่าแถวเดียวกัน', () => {
  assert.equal(mergeById([{ id: 7 }], [{ id: '7' }]).length, 1);
});

test('mergeById — แถวที่ไม่มี id ห้ามถูกตัด (ตัดสินไม่ได้ ห้ามทิ้งเงียบ)', () => {
  const out = mergeById([{ code: 'x' }, { id: null, code: 'y' }], [{ code: 'z' }]);
  assert.equal(out.length, 3);
});

test('mergeById — ชุดว่าง/null/undefined ไม่ทำให้ล้ม', () => {
  assert.deepEqual(mergeById(null, undefined, [], [{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(mergeById(), []);
});

test('mergeById — ไม่แก้ไขอาร์เรย์ต้นฉบับ', () => {
  const a = [{ id: 1 }], b = [{ id: 1 }, { id: 2 }];
  mergeById(a, b);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
});

test('uniqueById — ชุดเดียวที่อ่านแบบแบ่งหน้าแล้วแถวซ้ำ (ตัวแรกชนะ)', () => {
  const out = uniqueById([{ id: 1, n: 1 }, { id: 2, n: 2 }, { id: 1, n: 99 }]);
  assert.deepEqual(out, [{ id: 1, n: 1 }, { id: 2, n: 2 }]);
});
