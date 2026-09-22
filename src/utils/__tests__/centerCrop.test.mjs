/* ครอบกลางภาพให้ได้สัดส่วนที่ขอ — ใช้บังคับรูปในใบ MO เป็น 16:9 (2026-09-22)
   ที่มา: ผจก.สุรเสน แจ้งผ่านกล่อง feedback "กำหนดอัตราส่วน 16:9 ... ขยายผลไปทุก Step MO"
   user ตัดสินให้ **ครอบให้อัตโนมัติ** ไม่ใช่ปฏิเสธรูป (หน้างานถ่ายจากมือถือ ปฏิเสธ = แนบไม่ได้เลย)

   🔴 ข้อที่ห้ามพลาด: ไม่ส่ง aspect ต้องได้กรอบเต็มรูปเดิมเป๊ะ — ตัวนี้เป็น single source
   ของ 6 หน้า ถ้าเผลอครอบ default ทุกหน้าที่อัปโหลดรูปจะโดนตัดขอบเงียบๆ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { centerCrop } from '../resizeImage.js';

test('🛡️ ไม่ส่ง aspect = ไม่ครอบ (กรอบเต็มรูปเดิม)', () => {
  assert.deepEqual(centerCrop(4032, 3024), { sx: 0, sy: 0, sw: 4032, sh: 3024 });
  assert.deepEqual(centerCrop(4032, 3024, 0), { sx: 0, sy: 0, sw: 4032, sh: 3024 });
});

test('รูปแนวนอน 4:3 (กล้องมือถือ) → 16:9 ตัดบน-ล่างเท่ากัน กว้างเต็ม', () => {
  // 4:3 = 1.33 ซึ่ง "สูงกว่า" 16:9 = 1.78 ⇒ ต้องตัดบน-ล่าง ไม่ใช่ซ้าย-ขวา
  const r = centerCrop(4032, 3024, 16 / 9);
  assert.equal(r.sw, 4032, 'ความกว้างต้องเต็ม ไม่ตัดซ้าย-ขวา');
  assert.equal(r.sh, Math.round(4032 / (16 / 9)));
  assert.equal(r.sx, 0);
  assert.equal(r.sy, Math.round((3024 - r.sh) / 2), 'ต้องตัดบน-ล่างเท่ากัน = อยู่กลางภาพ');
});

test('รูปที่กว้างกว่า 16:9 (พาโนรามา) → ตัดซ้าย-ขวาเท่ากัน สูงเต็ม', () => {
  const r = centerCrop(4000, 1000, 16 / 9);
  assert.equal(r.sh, 1000, 'ความสูงต้องเต็ม');
  assert.equal(r.sw, Math.round(1000 * 16 / 9));
  assert.equal(r.sy, 0);
  assert.equal(r.sx, Math.round((4000 - r.sw) / 2));
});

test('รูปแนวตั้งจากมือถือ → 16:9 ตัดบน-ล่างเท่ากัน กว้างเต็ม', () => {
  const r = centerCrop(1080, 1920, 16 / 9);
  assert.equal(r.sw, 1080, 'ความกว้างต้องเต็ม');
  assert.equal(r.sh, Math.round(1080 / (16 / 9)));
  assert.equal(r.sx, 0);
  assert.equal(r.sy, Math.round((1920 - r.sh) / 2));
});

test('รูปที่เป็น 16:9 อยู่แล้ว → ไม่ถูกตัด', () => {
  assert.deepEqual(centerCrop(1920, 1080, 16 / 9), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
});

test('ขนาดเพี้ยน (0/ติดลบ) ต้องไม่พัง — คืนกรอบเดิม', () => {
  assert.deepEqual(centerCrop(0, 0, 16 / 9), { sx: 0, sy: 0, sw: 0, sh: 0 });
  assert.deepEqual(centerCrop(-5, 10, 16 / 9), { sx: 0, sy: 0, sw: -5, sh: 10 });
});
