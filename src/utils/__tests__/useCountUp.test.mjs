/* 🛡️ useCountUp — ค่าที่คืนห้ามตามหลัง target "ข้ามชนิด" (25/11 · production: เปลี่ยน cost center บน /obeya →
   แผ่นที่เป็น "—" กลายเป็นตัวเลข เฟรมแรก state ยัง null → `.toLocaleString()` บน null ล้มทั้งหน้า) */
import assert from 'node:assert/strict';
import { countUpShown } from '../useCountUp.js';

// state ค้างจากเฟรมก่อน (null = เมื่อกี้แผ่นว่าง) แต่ target เป็นตัวเลขแล้ว ⇒ ต้องได้ตัวเลข ไม่ใช่ null
assert.equal(countUpShown(98.4, null, true), 0);
assert.equal(countUpShown(98.4, null, false), 98.4);
assert.equal(countUpShown(98.4, undefined, false), 98.4);
assert.equal(countUpShown(98.4, '—', true), 0);
// ระหว่างวิ่ง = ค่าของเฟรมนั้น
assert.equal(countUpShown(100, 42.5, true), 42.5);
// target ไม่ใช่ตัวเลข = คืน target ทันที (กฎความซื่อสัตย์ "—" ยังเป็น "—") แม้ state ค้างเป็นตัวเลข
assert.equal(countUpShown(null, 77, true), null);
assert.equal(countUpShown('12 ชม.', 77, false), '12 ชม.');
assert.equal(countUpShown(NaN, 5, true), NaN === NaN ? 1 : NaN); // NaN ไม่ใช่ตัวเลขจำกัด → คืนตามเดิม
console.log('useCountUp.test ok');
