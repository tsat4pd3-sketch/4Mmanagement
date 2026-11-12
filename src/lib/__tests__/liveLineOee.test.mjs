import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveOeeByLine, sortLiveOee } from '../liveLineOee.js';

// กะเปิด 08:00 วันที่ 2026-11-11 · "ตอนนี้" = 10:00 ไทย
// util สร้างเวลาเริ่มกะจาก work_date + start_time แบบ local ⇒ "ตอนนี้" ต้องสร้างแบบเดียวกัน (ไม่ผูก timezone เครื่อง)
const NOW = new Date('2026-11-11T10:00:00').getTime();
const S = (id, line, extra = {}) => ({ id, line_name: line, status: 'open', shift: 'day', start_time: '08:00:00', work_date: '2026-11-11', created_at: `2026-11-11T01:0${id}:00Z`, ...extra });

test('เฉพาะกะที่ยังเปิด — กะที่ขอปิด/ปิดแล้ว ไม่ใช่ "ตอนนี้"', () => {
  const rows = liveOeeByLine({
    sessions: [S(1, 'L1'), S(2, 'L2', { status: 'pending_close' }), S(3, 'L3', { status: 'closed' })],
    nowMs: NOW,
  });
  assert.deepEqual(rows.map(r => r.line), ['L1']);
});

test('ยังไม่ปิดใบแรก = ประเมินไม่ได้ + เหตุผล (ห้ามเป็น 0)', () => {
  const [r] = liveOeeByLine({ sessions: [S(1, 'L1')], nowMs: NOW });
  assert.equal(r.oee, null);
  assert.equal(r.reason, 'no_output');
});

test('มียอดและ CT = มีค่า OEE · ผลิตแล้วแต่ไม่มี CT = no_ct', () => {
  const orders = [{ session_id: 1, mat_no: 'M1', status: 'open', qty_actual: 100, opened_at: '2026-11-11T01:00:00Z' }];
  const [ok] = liveOeeByLine({ sessions: [S(1, 'L1')], orders, ctMap: { M1: 30 }, nowMs: NOW });
  assert.ok(ok.oee > 0 && ok.oee <= 100, `oee=${ok.oee}`);
  assert.equal(ok.reason, null);
  const [noCt] = liveOeeByLine({ sessions: [S(1, 'L1')], orders, ctMap: {}, nowMs: NOW });
  assert.equal(noCt.oee, null);
  assert.equal(noCt.reason, 'no_ct');
});

test('ไลน์เปิดค้าง 2 กะ = ใช้กะล่าสุด + บอกจำนวน', () => {
  const rows = liveOeeByLine({ sessions: [S(1, 'L1'), S(2, 'L1')], nowMs: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 2);
  assert.equal(rows[0].openCount, 2);
});

test('เรียง: ต่ำกว่าเป้ามากก่อน → ไม่มีเป้า → ประเมินไม่ได้ท้ายสุด (ไม่ตัดทิ้ง)', () => {
  const rows = [
    { line: 'A', oee: 80 }, { line: 'B', oee: 50 }, { line: 'C', oee: null }, { line: 'D', oee: 60 },
  ];
  const tg = { A: 85, B: 85, C: 85, D: null };
  assert.deepEqual(sortLiveOee(rows, l => tg[l]).map(r => r.line), ['B', 'A', 'D', 'C']);
});
