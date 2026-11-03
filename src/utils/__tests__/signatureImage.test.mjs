/* บีบรูปลายเซ็นที่คนถ่าย/สแกนเข้ามา (2026-10-28) — เทสเฉพาะส่วนคำนวณ (ไม่ต้องมี canvas) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luma, pickPaperCutoff, clipPaperToWhite, inkRatioOk, INK_MIN, INK_MAX } from '../signatureImage.js';

const paperWithInk = (n, inkCount, paperLevel = 235, inkLevel = 60) =>
  Array.from({ length: n }, (_, i) => (i < inkCount ? inkLevel : paperLevel));

test('luma — ขาว/ดำ/แดง', () => {
  assert.equal(Math.round(luma(255, 255, 255)), 255);
  assert.equal(Math.round(luma(0, 0, 0)), 0);
  assert.equal(Math.round(luma(255, 0, 0)), 76);
});

test('หาค่าตัดจากรูปเอง — กระดาษสว่าง 235 หมึก 60', () => {
  const cut = pickPaperCutoff(paperWithInk(1000, 50));
  assert.ok(cut > 60 && cut < 235, `ค่าตัดควรอยู่ระหว่างหมึกกับกระดาษ ได้ ${cut}`);
});

test('🔴 กระดาษคนละความสว่าง ต้องได้ค่าตัดคนละค่า (ห้ามใช้ค่าคงที่)', () => {
  const สว่าง = pickPaperCutoff(paperWithInk(1000, 50, 250));
  const หม่น  = pickPaperCutoff(paperWithInk(1000, 50, 150));
  assert.ok(สว่าง > หม่น, 'รูปที่กระดาษสว่างกว่า ต้องได้ค่าตัดสูงกว่า');
});

test('🔴 รูปมืดทั้งใบ = คืน null (ไม่ตัด ใช้รูปเดิม)', () => {
  assert.equal(pickPaperCutoff(paperWithInk(1000, 50, 70, 30)), null);
  assert.equal(pickPaperCutoff([], {}), null);
  assert.equal(pickPaperCutoff(null), null);
});

test('ตัดพื้นเป็นขาว — หมึกยังอยู่ · คืนสัดส่วนหมึก', () => {
  // 100 พิกเซล: 10 หมึก (60) · 90 กระดาษ (235)
  const data = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) {
    const v = i < 10 ? 60 : 235;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const ratio = clipPaperToWhite(data, 200);
  assert.equal(ratio, 0.1, 'หมึก 10%');
  assert.equal(data[0], 60, 'พิกเซลหมึกต้องไม่ถูกแตะ');
  assert.equal(data[40], 255, 'พิกเซลกระดาษต้องกลายเป็นขาวสนิท');
});

test('อินพุตเพี้ยน', () => {
  assert.equal(clipPaperToWhite(null, 200), null);
  assert.equal(clipPaperToWhite(new Uint8ClampedArray(4), 0), null);
});

test('🔴 ด่านกันตัดจนลายเซ็นหาย / ตัดไม่เข้า', () => {
  assert.equal(inkRatioOk(0), false, 'ไม่เหลือหมึกเลย = ใช้รูปเดิม');
  assert.equal(inkRatioOk(INK_MIN / 2), false);
  assert.equal(inkRatioOk(0.02), true, 'ลายเซ็นปกติ ~2%');
  assert.equal(inkRatioOk(INK_MAX + 0.01), false, 'ดำเกือบทั้งใบ = แยกกระดาษไม่ออก');
  assert.equal(inkRatioOk(null), false);
  assert.equal(inkRatioOk(undefined), false);
});
