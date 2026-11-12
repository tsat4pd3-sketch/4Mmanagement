import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overdueDays, outsourceState, isOutsourcePending } from '../mtnOutsource.js';
const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'src/components/MtnOutsource.jsx'), 'utf8');

/* ของที่ถอดจากเครื่องแล้วส่งซ่อมนอก (09/11) — ใบ MO ปิดได้โดยไม่ต้องรอของ */

test('🔴 รับของเข้าสต็อก: จองสถานะก่อน → ขยับสต็อก → สต็อกล้มต้องคืนสถานะ', () => {
  /* กฎเหล็ก DB ข้อ 6 — ไม่จองก่อน = กด 2 ครั้งพร้อมกัน ของเข้าสต็อก 2 เท่า
     ไม่คืนสถานะ = แถว "รับแล้ว" ทั้งที่ของไม่เคยเข้าสต็อก (ของหายจากคลังเงียบๆ) */
  const claim = SRC.indexOf(".is('back_at', null)");
  const move  = SRC.indexOf("'mtn_stock_move'");
  const undo  = SRC.indexOf('back_at: null');
  assert.ok(claim > 0, '❌ ไม่ได้จองสถานะแบบ compare-and-swap (.is(\'back_at\', null)) ก่อนรับของ');
  assert.ok(move > claim, '❌ เรียก mtn_stock_move ก่อนจองสถานะ — กดซ้ำ = ของเข้าสต็อก 2 เท่า');
  assert.ok(undo > move, '❌ สต็อกล้มแล้วไม่คืน back_at เป็น null — แถวบอก "รับแล้ว" ทั้งที่ของไม่เข้าสต็อก');
  assert.ok(/checkWriteRows\(claim/.test(SRC),
    '❌ ไม่ได้นับแถวตอนจองสถานะ — RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error (กฎเหล็ก DB ข้อ 2)');
});

test('🔴 ยกเลิก = cancelled_at + เหตุผล ห้าม delete', () => {
  assert.ok(/cancelled_at:\s*new Date\(\)/.test(SRC) && /cancel_reason:/.test(SRC),
    '❌ ยกเลิกไม่ได้เขียน cancelled_at + cancel_reason');
  assert.ok(!/\.delete\(\)/.test(SRC),
    '❌ มี .delete() — ของที่ซ่อมไม่ได้ก็ยังเป็นประวัติของเครื่อง ห้ามลบทิ้ง');
});

test('🔴 แตะสต็อกผ่าน RPC เท่านั้น ห้าม update stock_qty ตรงๆ', () => {
  assert.ok(!/stock_qty\s*:/.test(SRC),
    '❌ เขียน stock_qty ตรงๆ — ต้องผ่าน RPC mtn_stock_move (atomic + กันติดลบ + ลง ledger)');
});

test('overdueDays — ไม่ได้นัด / ยังไม่เลย / จบแล้ว = null (ห้ามคืน 0)', () => {
  /* 🔑 สูตรอยู่ `src/utils/mtnOutsource.js` ไม่ใช่ในไฟล์ .jsx — node:test import .jsx ไม่ได้
     (ERR_UNKNOWN_FILE_EXTENSION) ⇒ เทสที่ import จากจอจะ "ผ่าน" โดยไม่เคยรันอะไรเลย = เทสหลอก */
  const DUE = '2026-11-01';
  const t = (s) => Date.parse(s);
  assert.equal(overdueDays({ expected_at: null }, t('2026-12-01T00:00:00Z')), null, 'ไม่ได้นัดต้องเป็น null');
  assert.equal(overdueDays({ expected_at: DUE }, t('2026-11-01T10:00:00Z')), null, 'วันนัดวันนี้ ยังไม่เลย');
  assert.equal(overdueDays({ expected_at: DUE }, t('2026-11-04T10:00:00Z')), 3, 'นัด 1 พ.ย. วันนี้ 4 พ.ย. = เลย 3 วัน (วันปฏิทิน ไม่ใช่ครบ 24 ชม.)');
  /* 🔴 ต้องเป็น "วันของไทย" — 1 พ.ย. 18:00Z = 2 พ.ย. 01:00 ไทย ⇒ เลยนัดแล้ว 1 วัน
     นับแบบ UTC จะยังบอกว่าตรงเวลา = ตามของช้ากว่าที่ควร */
  assert.equal(overdueDays({ expected_at: DUE }, t('2026-11-01T18:00:00Z')), 1, 'ข้ามวันตามเวลาไทย');
  assert.equal(overdueDays({ expected_at: DUE }, t('2026-11-01T16:30:00Z')), null, 'ยังไม่ข้ามวันไทย (23:30 ของ 1 พ.ย.)');
  assert.equal(overdueDays({ expected_at: DUE, back_at: '2026-11-03T00:00:00Z' }, t('2026-12-01T00:00:00Z')), null,
    'รับกลับแล้วห้ามนับว่าเลยนัด');
  assert.equal(overdueDays({ expected_at: DUE, cancelled_at: '2026-11-03T00:00:00Z' }, t('2026-12-01T00:00:00Z')), null,
    'ยกเลิกแล้วห้ามนับว่าเลยนัด');
});

test('🔴 overdueDays ต้องรับ now เป็นพารามิเตอร์ (เทสรอบ "+400 วัน" ต้องตรึงเวลาได้)', () => {
  const util = readFileSync(join(ROOT, 'src/utils/mtnOutsource.js'), 'utf8');
  assert.ok(/export function overdueDays\(row, now = Date\.now\(\)\)/.test(util),
    '❌ overdueDays อ่านนาฬิกาเอง — เทสรอบนาฬิกา +400 วันจะระเบิด (ด่าน build รัน 2 รอบ)');
  assert.ok(!/Date\.now\(\)/.test(SRC),
    '❌ ไฟล์จออ่านนาฬิกาเอง — สูตรต้องอยู่ utils/mtnOutsource.js ที่เดียว');
});

test('outsourceState — ป้าย/สีตามสถานะ · สีต้องเป็น token ไม่ใช่ hex ดิบ', () => {
  const t = (s) => Date.parse(s);
  assert.equal(outsourceState({ cancelled_at: 'x' }).key, 'cancelled');
  assert.equal(outsourceState({ back_at: 'x' }).key, 'back');
  assert.equal(outsourceState({ expected_at: '2026-11-01' }, t('2026-11-04T10:00:00Z')).key, 'overdue');
  assert.equal(outsourceState({ expected_at: '2026-11-01' }, t('2026-11-01T10:00:00Z')).key, 'out');
  assert.equal(outsourceState({}).key, 'out');
  for (const r of [{}, { back_at: 'x' }, { cancelled_at: 'x' }, { expected_at: '2026-11-01' }]) {
    assert.match(outsourceState(r, t('2026-12-01T00:00:00Z')).color, /^var\(--/, 'สีต้องมาจาก token');
  }
  assert.equal(isOutsourcePending({}), true);
  assert.equal(isOutsourcePending({ back_at: 'x' }), false);
  assert.equal(isOutsourcePending(null), false);
});
