/* ⏩ Downtime ตัดยอดข้ามกะ — ส่วนที่เป็น pure (เลือกแถว + payload)
   ที่มา: ฟีเจอร์นี้เคยมีแต่ทาง "ดึงตอนเปิดกะ" ⇒ ใช้ได้เฉพาะเมื่อปิดกะเก่าก่อนเปิดกะใหม่
   วัดจากฐานจริง 09/11: ใช้จริง 1 เคส (HDF1 24/08) — กะดึกเปิด 21:02 แต่กะเช้าปิด 21:55
   ⇒ ไม่มีแถวต่อเนื่องเกิดขึ้นเลย (0/1) ⇒ เพิ่มทาง "ดันตอนปิดกะ" + กันซ้ำด้วย carried_from_id */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingCarryRows, carryPayload } from '../downtimeCarryRules.js';

test('pendingCarryRows — ข้ามแถวที่มีตัวต่อเนื่องแล้ว (เรียก 2 ทางต้องไม่เกิดแถวซ้ำ)', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(pendingCarryRows(rows, []).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(pendingCarryRows(rows, [{ carried_from_id: 'b' }]).map(r => r.id), ['a', 'c']);
  assert.deepEqual(pendingCarryRows(rows, rows.map(r => ({ carried_from_id: r.id }))), []);
  // อ่านตัวต่อเนื่องไม่ได้ (undefined) ต้องไม่ระเบิด — ตัวเรียกเช็ค error ก่อนอยู่แล้ว
  assert.equal(pendingCarryRows(rows, undefined).length, 3);
  assert.deepEqual(pendingCarryRows(undefined, undefined), []);
});

test('carryPayload — ก๊อปเฉพาะเนื้ออาการ · เวลาเริ่ม = เวลาเริ่มกะใหม่ · ไม่ก๊อป call_mtn', () => {
  const [p] = carryPayload({
    rows: [{ id: 'a', downtime_type_id: 't1', machine_no: 'SW10', mat_no: 'M1', description: 'ยังซ่อม', call_mtn: true, duration_min: 72 }],
    toSessionId: 's2', startISO: '2026-11-09T13:00:00.000Z', by: 'สมชาย', byUid: 'u1',
  });
  assert.equal(p.session_id, 's2');
  assert.equal(p.carried_from_id, 'a');
  assert.equal(p.started_at, '2026-11-09T13:00:00.000Z');
  assert.equal(p.machine_no, 'SW10');
  assert.equal(p.reported_by_name, 'สมชาย');
  // แถวใหม่ต้องเป็น "เปิดค้าง" จริง — ห้ามติด duration/ended มาจากแถวเดิม
  assert.equal(p.duration_min, undefined);
  assert.equal(p.ended_at, undefined);
  // เรียกช่างต้องเรียกใหม่ ไม่ลากธงเก่ามา (ใบเก่าปิดไปแล้ว ช่างเคลียร์ไปแล้ว)
  assert.equal(p.call_mtn, undefined);
  assert.equal(p.carry_over, undefined);
});
