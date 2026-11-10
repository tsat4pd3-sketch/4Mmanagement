/* 🔍 หน้ารายตู้ (meterDetailSeries / loadShare) — ไม่รู้ = null ไม่ใช่ 0 · ช่วงที่มิเตอร์หลุดต้องตัดเส้น */
import test from 'node:test';
import assert from 'node:assert/strict';
import { meterDetailSeries, loadShare, DETAIL_GAP_MIN } from '../energy.js';

test('จุดกราฟ: เรียงเวลา · ค่าว่าง = null · ช่วงขาดเกินเกณฑ์แทรกจุด null', () => {
  const R = (t, kw, a, v) => ({ bucket_at: t, kw, a, v });
  const s = meterDetailSeries([
    R('2026-11-10T10:02:00Z', 12, 30, 398),
    R('2026-11-10T10:00:00Z', 10, 25, '397'),
    R('2026-11-10T10:01:00Z', null, '', 399),
    R(`2026-11-10T10:${String(2 + DETAIL_GAP_MIN + 1).padStart(2, '0')}:00Z`, 20, 40, 396),
    R('ไม่ใช่เวลา', 1, 1, 1),
  ]);
  assert.deepEqual(s.map(p => p.kw), [10, null, 12, null, 20]);
  assert.equal(s[1].a, null);                 // '' = ไม่รู้ ไม่ใช่ 0
  assert.equal(s[0].v, 397);
  assert.equal(s[3].a, null);                 // จุดตัดเส้น
  assert.ok(s[3].t > s[2].t && s[3].t < s[4].t);
});

test('ขาดไม่เกินเกณฑ์ = ลากต่อ ไม่แทรกจุด', () => {
  const s = meterDetailSeries([{ bucket_at: '2026-11-10T10:00:00Z', kw: 1 }, { bucket_at: '2026-11-10T10:03:00Z', kw: 2 }]);
  assert.equal(s.length, 2);
});

test('สัดส่วนโหลด: นับเฉพาะที่ออนไลน์ · ที่ไม่รู้ = null ไม่ใช่ 0%', () => {
  const r = loadShare([
    { key: 'a', name: 'A', status: 'online', kw: 30 },
    { key: 'b', name: 'B', status: 'online', kw: 10 },
    { key: 'c', name: 'C', status: 'offline', kw: 50 },
  ]);
  assert.equal(r.total, 40);
  assert.deepEqual(r.rows.map(x => x.pct), [75, 25, null]);
  assert.equal(r.rows[2].kw, null);
  const none = loadShare([{ key: 'c', name: 'C', status: 'never', kw: null }]);
  assert.equal(none.total, null);
  assert.equal(none.rows[0].pct, null);
});
