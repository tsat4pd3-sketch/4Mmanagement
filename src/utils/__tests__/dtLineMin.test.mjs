/* ═══ 🔀 ไลน์เครื่องขนาน — "นาทีของไลน์" ≠ "นาที-เครื่อง" ═══  2026-10-27 · คำสั่ง user
   *"มันไม่ควรนับรวมเป็น 306 นาที สำหรับไลน์ขนาน เพราะความจริงมันคือ 102 นาที"*
   เคสจริง LASER-345 22/10 (3 เลน): ราง Conveyor เสีย พนักงานลง downtime รายเครื่อง LS-03/04/05 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dtLineMin, laneBySessionId } from '../oee.js';

const row = (machine_no, duration_min) => ({ machine_no, duration_min, ended_at: '2026-10-22T12:00:00Z' });

test('🔀 เคสจริง LASER-345 22/10 — ดิบ 306 นาที = ไลน์หยุดจริง 102 นาที', () => {
  const rows = [
    row('LS-03', 50), row('LS-04', 50), row('LS-05', 50),   // 18:15–19:05 หยุดพร้อมกัน → 50
    row('LS-03', 42), row('LS-04', 42), row('LS-05', 42),   // 13:15–13:57 หยุดพร้อมกัน → 42
    row('LS-03', 30),                                        // เครื่องเดียว → เสียกำลังผลิต ⅓ = 10
  ];
  assert.equal(rows.reduce((a, r) => a + r.duration_min, 0), 306, 'นาที-เครื่องดิบ');
  assert.equal(rows.reduce((a, r) => a + dtLineMin(r, 3), 0), 102, 'นาทีของไลน์ = 50 + 42 + 10');
});

test('🔴 แถวที่ไม่ระบุเครื่อง = หยุดทั้งไลน์ ห้ามหาร (ไฟดับ/ไม่มีแผนผลิต/เปลี่ยนรุ่นทั้งไลน์)', () => {
  assert.equal(dtLineMin({ machine_no: null, duration_min: 60, ended_at: 'x' }, 3), 60);
  assert.equal(dtLineMin({ machine_no: '', duration_min: 60, ended_at: 'x' }, 6), 60);
});

test('🔴 ไลน์เลนเดียว / ไม่รู้จำนวนเลน = พฤติกรรมเดิมเป๊ะ', () => {
  const r = row('M1', 45);
  assert.equal(dtLineMin(r, 1), 45);
  assert.equal(dtLineMin(r), 45, 'ไม่ส่งจำนวนเลน = 1');
  assert.equal(dtLineMin(r, 0), 45, 'ค่าขยะ = ไม่หาร');
  assert.equal(dtLineMin(r, null), 45);
});

test('🔀 หารตามจำนวนเลนจริงของแต่ละไลน์', () => {
  assert.equal(dtLineMin(row('M1', 60), 6), 10, 'SUB APRON 6 สถานี');
  assert.equal(dtLineMin(row('M1', 60), 5), 12, 'LINE A 5 เครื่อง');
  assert.equal(dtLineMin(row('M1', 60), 4), 15, 'LINE B 4 เครื่อง');
});

test('🔴 แถวที่ยังเปิดค้าง (ไม่มี ended_at/duration) ไม่นับถ้าไม่ส่ง nowMs', () => {
  const open = { machine_no: 'M1', started_at: '2026-10-22T10:00:00Z' };
  assert.equal(dtLineMin(open, 3), 0);
  const now = new Date('2026-10-22T10:30:00Z').getTime();
  assert.equal(dtLineMin(open, 3, now), 10, '30 นาที ÷ 3 เลน');
});

test('🔀 laneBySessionId — แมปกะ→เลน · กะที่ไม่รู้ไลน์ = 1', () => {
  const lines = [{ name: 'LASER-345', parallel_stations: 3 }, { name: 'LINE 61', parallel_stations: null }];
  const by = laneBySessionId(
    [{ id: 's1', line_name: 'LASER-345' }, { id: 's2', line_name: 'LINE 61' }, { id: 's3', line_name: 'ไม่อยู่ในทะเบียน' }],
    lines);
  assert.equal(by.s1, 3);
  assert.equal(by.s2, 1);
  assert.equal(by.s3, 1, 'ไม่รู้จักไลน์ = 1 เลน ห้ามเดาว่าขนาน');
  assert.equal(by.s9, undefined);
});

test('🔀 laneBySessionId รับทะเบียนแบบแมปได้ด้วย · ของว่างไม่ระเบิด', () => {
  const by = laneBySessionId([{ id: 's1', line_name: 'SUB APRON' }], { 'SUB APRON': { name: 'SUB APRON', parallel_stations: 6 } });
  assert.equal(by.s1, 6);
  assert.deepEqual(laneBySessionId(), {});
  assert.deepEqual(laneBySessionId(null, null), {});
});
