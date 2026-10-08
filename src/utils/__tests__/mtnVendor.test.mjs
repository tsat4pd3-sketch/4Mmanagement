/* ส่งซ่อมภายนอก — นาฬิกาเครื่อง ≠ นาฬิกาช่าง (2026-09-21)
   ล็อกกฎที่ "ผิดแล้วเงียบ": MTTR ต้องหักช่วงอยู่กับ supplier · downtime ไม่หัก
   ⏱️ ทุกเคสตรึง `now` เอง — ห้ามพึ่งนาฬิกาจริง (กฎเทสระเบิดเวลา) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VENDOR_STATUS, vendorState, vendorHoldMin, techRepairMin, grossRepairMin,
  canSendVendor, canReceiveVendor, vendorHoldLabel,
} from '../mtnVendor.js';

const T = (h) => new Date(Date.UTC(2026, 8, 21, h, 0, 0)).toISOString();
const NOW = Date.UTC(2026, 8, 21, 20, 0, 0);            // 20:00 ของวันเดียวกัน

test('ไม่เคยส่งออกนอก → ไม่หักอะไรเลย (พฤติกรรมเดิมทุกใบ)', () => {
  const o = { accept_at: T(8), repair_done_at: T(11) };
  assert.equal(vendorState(o), 'none');
  assert.equal(vendorHoldMin(o, NOW), 0);
  assert.equal(techRepairMin(o, NOW), 180);
  assert.equal(grossRepairMin(o), 180);
});

test('ส่งแล้วกลับแล้ว → MTTR หักช่วงที่อยู่กับ supplier', () => {
  const o = { accept_at: T(8), repair_done_at: T(18), vendor_sent_at: T(9), vendor_back_at: T(17) };
  assert.equal(vendorState(o), 'back');
  assert.equal(vendorHoldMin(o, NOW), 480);              // 8 ชม. อยู่ข้างนอก
  assert.equal(grossRepairMin(o), 600);                  // รวม 10 ชม.
  assert.equal(techRepairMin(o, NOW), 120);              // ช่างทำจริง 2 ชม.
});

test('ยังไม่กลับ → นาฬิกาเดินถึงตอนนี้ (จอต้องโชว์ว่ายังนับอยู่)', () => {
  const o = { status: VENDOR_STATUS, accept_at: T(8), vendor_sent_at: T(9) };
  assert.equal(vendorState(o), 'out');
  assert.equal(vendorHoldMin(o, NOW), 660);              // 09:00 → 20:00
  assert.equal(techRepairMin(o, NOW), null);             // ยังไม่ซ่อมเสร็จ = วัดไม่ได้ ห้ามเดา 0
});

test('เวลาสลับกัน (กลับก่อนส่ง) ต้องไม่ทำให้ MTTR เฟ้อ', () => {
  const o = { accept_at: T(8), repair_done_at: T(12), vendor_sent_at: T(11), vendor_back_at: T(9) };
  assert.equal(vendorHoldMin(o, NOW), 0);                // ข้อมูลผิด → 0 ไม่ใช่ค่าติดลบ
  assert.equal(techRepairMin(o, NOW), 240);
});

test('หักแล้วห้ามติดลบ — ช่วงข้างนอกยาวกว่าเวลารับงานถึงซ่อมเสร็จ', () => {
  const o = { accept_at: T(10), repair_done_at: T(11), vendor_sent_at: T(8), vendor_back_at: T(18) };
  assert.equal(techRepairMin(o, NOW), 0);
});

test('วัดไม่ได้ = null ห้ามเดาเป็น 0', () => {
  assert.equal(techRepairMin({ accept_at: T(8) }, NOW), null);
  assert.equal(techRepairMin({ repair_done_at: T(8) }, NOW), null);
  assert.equal(grossRepairMin({}), null);
});

test('ส่งออกนอกได้เฉพาะใบที่ช่างรับงานแล้วและยังไม่จบ', () => {
  assert.equal(canSendVendor({ status: 'assigned', current_step: 2 }), true);
  assert.equal(canSendVendor({ status: 'repairing', current_step: 3 }), true);
  assert.equal(canSendVendor({ status: 'pending', current_step: 1 }), false);   // ยังไม่มีช่างรับ
  assert.equal(canSendVendor({ status: 'checked', current_step: 4 }), false);   // ผู้แจ้งตรวจรับแล้ว
  for (const st of ['closed', 'rejected', 'transferred', 'returned'])
    assert.equal(canSendVendor({ status: st, current_step: 3 }), false, st);
  assert.equal(canSendVendor({ status: VENDOR_STATUS, current_step: 3 }), false); // ส่งซ้ำไม่ได้
});

test('กด "ของกลับ" ได้เฉพาะใบที่อยู่ข้างนอกจริง', () => {
  assert.equal(canReceiveVendor({ status: VENDOR_STATUS, vendor_sent_at: T(9) }), true);
  assert.equal(canReceiveVendor({ status: VENDOR_STATUS, vendor_sent_at: T(9), vendor_back_at: T(10) }), false);
  assert.equal(canReceiveVendor({ status: 'repairing', vendor_sent_at: T(9) }), false);
});

test('ป้ายเวลาอ่านรู้เรื่องทุกช่วง', () => {
  assert.equal(vendorHoldLabel({ vendor_sent_at: T(9), vendor_back_at: T(9, 30) }, NOW), '0 นาที');
  assert.equal(vendorHoldLabel({ vendor_sent_at: T(9) }, Date.UTC(2026, 8, 21, 11, 30)), '2 ชม. 30 น.');
  assert.equal(vendorHoldLabel({ vendor_sent_at: T(9) }, Date.UTC(2026, 8, 24, 13, 0)), '3 วัน 4 ชม.');
});

test('สถานะรอ supplier ต้องเป็น "ใบเปิดอยู่" ไม่ใช่สถานะจบ', async () => {
  const { MO_DONE_STATUSES, MO_STATUS_LABEL, MO_STATUS_META, isMoOpen } = await import('../mtnStepPerm.js');
  assert.ok(!MO_DONE_STATUSES.includes(VENDOR_STATUS), 'ห้ามเข้า MO_DONE_STATUSES');
  assert.equal(isMoOpen({ status: VENDOR_STATUS }), true);
  assert.ok(MO_STATUS_LABEL[VENDOR_STATUS], 'ต้องมีป้าย');
  // บทเรียน `transferred` 2026-09-14: เข้า LABEL แต่ลืมตารางสี → dropdown ฟิลเตอร์ไม่มีตัวเลือก
  assert.notEqual(MO_STATUS_META[VENDOR_STATUS].color, '#8b8b96', 'ต้องตั้งสีเอง ไม่ใช่ค่าถอย');
  assert.equal(MO_STATUS_META[VENDOR_STATUS].step, 3);
});
