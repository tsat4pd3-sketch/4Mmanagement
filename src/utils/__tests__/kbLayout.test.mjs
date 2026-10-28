/**
 * แก้แป้นค้างภาษาไทยตอนยิงบาร์โค้ด — ล็อกเคสจริงจาก audit log (Assy GOR 20/10)
 * เครื่องสแกนส่งคีย์เหมือนคนพิมพ์ ⇒ แป้นค้างไทย = เปิดใบขยะได้จริง
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixThaiLayout, hasThai } from '../kbLayout.js';

test('เลขใบผลิตจริงที่เคยหลุดเข้าฐาน ต้องแปลงกลับได้ถูกตัว', () => {
  // ถอดจาก audit_log 20/10 — 6 ใบขยะที่ถูกสร้างแล้วลบทิ้งใน 10 วินาที
  const เคสจริง = [
    ['จๅ/ภจุๅภภจ', '0124061440'],
    ['จๅ/ภจุๅๅภจ', '0124061140'],
    ['จๅ/ภจุๅจุจ', '0124061060'],
    ['จๅ/ภจุๅจจจ', '0124061000'],
    ['จๅ/ภจุจคุจ', '0124060860'],
  ];
  for (const [ไทย, ควรได้] of เคสจริง) {
    const r = fixThaiLayout(ไทย);
    assert.equal(r.value, ควรได้, `${ไทย} ควรแปลงเป็น ${ควรได้}`);
    assert.equal(r.fixed, true);
  }
});

test('เลขที่มีขีด (จๅ/ภจุๅ-ภจ) ก็ต้องแปลงได้ — "-" คือปุ่มเลข 3', () => {
  assert.equal(fixThaiLayout('จๅ/ภจุๅ-ภจ').value, '0124061340');
});

test('ข้อความอังกฤษ/ตัวเลขปกติ ต้องไม่ถูกแตะ', () => {
  for (const s of ['0124060840', 'MANUAL-001', 'SW10', '']) {
    const r = fixThaiLayout(s);
    assert.equal(r.value, s.trim());
    assert.equal(r.fixed, false, `${s} ไม่ควรถูกแปลง`);
  }
});

test('🔴 ภาษาไทยที่เป็น "คำจริง" ต้องไม่ถูกแปลงมั่ว — คืนค่าเดิมให้ปลายทางปฏิเสธเอง', () => {
  // คำไทยทั่วไปมีตัวที่ไม่อยู่ในผังแป้น (ช่องว่าง/สระที่ไม่ได้ map) ⇒ ต้องคืนค่าเดิม
  for (const s of ['ชิ้นงาน', 'ใบผลิต 5 ใบ', 'ทดสอบ']) {
    assert.equal(fixThaiLayout(s).fixed, false, `${s} ไม่ควรถูกแปลง`);
    assert.equal(fixThaiLayout(s).value, s);
  }
});

test('แปลงแล้วได้ของที่ไม่ใช่รหัส = ไม่แปลง (ห้ามเดา)', () => {
  // 'า' → 'k' ตัวเดียวเป็นรหัสได้ แต่ขึ้นต้นด้วยขีดไม่ได้
  assert.equal(fixThaiLayout('-').fixed, false);
});

test('hasThai แยกไทย/ไม่ไทยได้', () => {
  assert.equal(hasThai('จๅ/ภ'), true);
  assert.equal(hasThai('0124'), false);
  assert.equal(hasThai(null), false);
});
