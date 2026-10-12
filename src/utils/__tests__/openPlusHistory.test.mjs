import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPlusHistory } from '../fetchByIds.js';

/* ตัวจำลอง query builder ของ supabase-js — order/range/limit แล้ว await ได้ */
const fakeQ = (rows, err = null) => () => {
  let from = 0, to = rows.length - 1, lim = null, key = null;
  const q = {
    order(k) { key = key || k; return q; },
    range(a, b) { from = a; to = b; return q; },
    limit(n) { lim = n; return q; },
    then(res) {
      if (err) return res({ data: null, error: { message: err } });
      let out = rows.slice();
      if (key) out.sort((x, y) => String(y[key]).localeCompare(String(x[key])));
      out = lim != null ? out.slice(0, lim) : out.slice(from, to + 1);
      return res({ data: out, error: null });
    },
  };
  return q;
};

test('ใบค้างมาครบทุกใบ (เกินหน้าแรก) · ประวัติตัดล่าสุด N · เรียงด้วยคอลัมน์เวลาที่ส่งมา', async () => {
  const open = Array.from({ length: 1500 }, (_, i) => ({ id: `o${i}`, status: 'requested', requested_at: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}` }));
  const hist = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, status: 'received', requested_at: `2026-02-${String(1 + (i % 28)).padStart(2, '0')}` }));
  const { data, error } = await openPlusHistory(fakeQ(open), fakeQ(hist), 10, 'requested_at');
  assert.equal(error, null);
  assert.equal(data.filter(r => r.status === 'requested').length, 1500);   // ไม่มีใบค้างหลุด
  assert.equal(data.filter(r => r.status === 'received').length, 10);
  assert.ok(data[0].requested_at >= data[data.length - 1].requested_at);   // ใหม่ → เก่า
});

test('คิวรีใบค้างล้ม = คืน error (ห้ามกลืนเป็นลิสต์ว่าง)', async () => {
  const { error } = await openPlusHistory(fakeQ([], 'boom'), fakeQ([]), 10);
  assert.equal(error?.message, 'boom');
});

/* 🔑 ใบที่เปลี่ยนสถานะ "ระหว่าง" 2 คิวรี (2 คิวรีใน Promise.all ไม่ใช่ transaction)
   เข้าเงื่อนไขทั้งใบค้างและประวัติ ⇒ เคยมาถึงจอ 2 แถว id เดียวกัน = คีย์ซ้ำบนบอร์ด
   (วัดจริง 08/10: /rack-center 15 ใบใน harness) · ประวัติ (ชุดหลัง) ต้องชนะ */
test('ใบที่โผล่ทั้ง 2 คิวรี เหลือใบเดียว และเป็นสถานะที่ปิดแล้ว', async () => {
  const open = [{ id: 'r1', status: 'requested', requested_at: '2026-03-01' }];
  const hist = [{ id: 'r1', status: 'received', requested_at: '2026-03-01' }];
  const { data } = await openPlusHistory(fakeQ(open), fakeQ(hist), 10, 'requested_at');
  assert.equal(data.length, 1);
  assert.equal(data[0].status, 'received');
});
