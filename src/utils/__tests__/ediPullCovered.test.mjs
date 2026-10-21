/* 21/10 — 862 = แผนทั้งวัน · e-SMART = คอนเฟิร์มว่าช่วงนั้นส่งจริง (งาน 060/061/306 · AAT GRBNA)
   เคสจริง: 862 รอบเช้า (08:05) สร้างใบแผนตี 0–8 กลับมาใหม่ ทั้งที่ e-SMART ยืนยันช่วงนั้นไปแล้ว ⇒ ใบเบิ้ลรอบไม่ตรง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPullCovered, pullCoverBatches } from '../ediMerge.js';

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const batch = (id, d1, h1, d2, h2, dock = 'B5') =>
  ({ id, ship_to: 'GRBNA', dock_code: dock, window_start: at(d1, h1), window_end: at(d2, h2), format_code: 'ford_esmart' });
const sig = (batch_id, mat) => ({ batch_id, mat_no: mat, customer_part_no: 'RB3B 16E060 BA' });
const rec = (date, time, mat = '10100385', dock = 'B5', shipTo = 'GRBNA') =>
  ({ shipTo, part: 'RB3B-16E060-BA', mat_no: mat, date, time, dock });
const FM = [{ code: 'ford_esmart', lead_min: 60 }];

test('ช่วง 06–08 ยืนยันแล้ว → แผน 862 08:00 (ดึง 07:00) ไม่สร้างกลับ · 10:00 ยังสร้าง', () => {
  const B = pullCoverBatches([batch('b1', 21, 6, 21, 8)], [sig('b1', '10100385')], FM);
  const r = splitPullCovered([rec('2026-10-21', '08:00'), rec('2026-10-21', '10:00')], B);
  assert.deepEqual(r.covered.map(x => x.rec.time), ['08:00']);
  assert.deepEqual(r.insert.map(x => x.time), ['10:00']);
});

test('หลายแถวแผนในช่วงเดียวกัน (00:30 / 01:10 ในช่วง 22–02) ต้องข้ามทุกแถว ไม่ใช่แค่แถวใกล้สุด', () => {
  const B = pullCoverBatches([batch('b1', 20, 22, 21, 2)], [sig('b1', '10100385')], FM);
  const r = splitPullCovered([rec('2026-10-21', '00:30'), rec('2026-10-21', '01:10'), rec('2026-10-21', '02:30')], B);
  assert.equal(r.covered.length, 3);   // ดึง 23:30 / 00:10 / 01:30 อยู่ใน (22:00, 02:00] ทั้งหมด
});

test('ขอบช่วง: ดึง = window_start ไม่นับ · = window_end นับ', () => {
  const B = pullCoverBatches([batch('b1', 21, 6, 21, 8)], [sig('b1', '10100385')], FM);
  assert.equal(splitPullCovered([rec('2026-10-21', '07:00')], B).covered.length, 0);   // ดึง 06:00
  assert.equal(splitPullCovered([rec('2026-10-21', '09:00')], B).covered.length, 1);   // ดึง 08:00
});

test('พาร์ทไม่อยู่ในไฟล์ e-SMART = ตาม 862 เหมือนเดิม (กติกา 08/09)', () => {
  const B = pullCoverBatches([batch('b1', 21, 6, 21, 8)], [sig('b1', '10100401')], FM);
  assert.equal(splitPullCovered([rec('2026-10-21', '08:00', '10100385')], B).insert.length, 1);
});

test('dock ต่างกัน = คนละเที่ยว · ship-to อื่นไม่โดน', () => {
  const B = pullCoverBatches([batch('b1', 21, 6, 21, 8, 'B1')], [sig('b1', '10100385')], FM);
  assert.equal(splitPullCovered([rec('2026-10-21', '08:00', '10100385', 'B5')], B).insert.length, 1);
  assert.equal(splitPullCovered([rec('2026-10-21', '08:00', '10100385', 'B1', 'GBJ')], B).insert.length, 1);
  assert.equal(splitPullCovered([rec('2026-10-21', '08:00', '10100385', 'B1')], B).covered.length, 1);
});

test('lead ตาม format · format ไม่รู้จัก = 60 · batch ไม่มีรายการ = ทิ้ง', () => {
  const B = pullCoverBatches([batch('b1', 21, 6, 21, 8), { ...batch('b2', 21, 8, 21, 10), format_code: 'x' }, batch('b3', 21, 10, 21, 12)],
    [sig('b1', '10100385'), sig('b2', '10100385')], [{ code: 'ford_esmart', lead_min: 0 }]);
  assert.deepEqual(B.map(b => [b.id, b.lead_min]), [['b1', 0], ['b2', 60]]);
});

test('ไม่มี batch / เวลาเสีย = สร้างตามเดิม (ไม่กลืน)', () => {
  assert.equal(splitPullCovered([rec('2026-10-21', '08:00')], []).insert.length, 1);
  assert.equal(splitPullCovered([rec('2026-10-21', '')], pullCoverBatches([batch('b1', 21, 6, 21, 8)], [sig('b1', '10100385')], FM)).insert.length, 1);
});
