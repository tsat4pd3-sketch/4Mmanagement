/* คิวรับเข้าคลัง — ปิดกฎ ≠ ต้องยืนยัน (2026-10-02) · เวลาตรึงค่าเสมอ (ด่านนาฬิกา +400 วัน) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inflowModeOf, inflowPatchFor, receiptAgeMin, isStaleReceipt, ageText,
  validateReceive, receiptZoneStatus, sortReceipts, DEFAULT_STALE_MIN,
} from '../stockReceipts.js';

const NOW = Date.parse('2026-10-02T09:00:00Z');

test('โหมดกฎ 3 ทาง — ปิดคือปิด ไม่ใช่ยืนยัน', () => {
  assert.equal(inflowModeOf({ is_active: false, mode: 'confirm' }), 'off');
  assert.equal(inflowModeOf({ is_active: true, mode: 'confirm' }), 'confirm');
  assert.equal(inflowModeOf({ is_active: true, mode: 'auto' }), 'auto');
  assert.equal(inflowModeOf({ is_active: true }), 'auto');
  assert.equal(inflowModeOf(null), 'off');
});

test('เลือกโหมดแล้วเขียนค่าถูก · ปิดแล้วจำโหมดเดิมไว้', () => {
  assert.deepEqual(inflowPatchFor('confirm', {}), { is_active: true, mode: 'confirm' });
  assert.deepEqual(inflowPatchFor('auto', { mode: 'confirm' }), { is_active: true, mode: 'auto' });
  assert.deepEqual(inflowPatchFor('off', { mode: 'confirm' }), { is_active: false, mode: 'confirm' });
});

test('อายุใบ + เกณฑ์ค้าง', () => {
  const r = { status: 'pending', created_at: '2026-10-02T04:00:00Z' };   // 300 น.
  assert.equal(receiptAgeMin(r, NOW), 300);
  assert.equal(isStaleReceipt(r, 240, NOW), true);
  assert.equal(isStaleReceipt(r, 360, NOW), false);
  assert.equal(isStaleReceipt({ ...r, status: 'received' }, 240, NOW), false);
  assert.equal(isStaleReceipt(r, null, NOW), 300 > DEFAULT_STALE_MIN);
  assert.equal(receiptAgeMin({ created_at: 'x' }, NOW), null);
});

test('ข้อความอายุ', () => {
  assert.equal(ageText(null), '—');
  assert.equal(ageText(45), '45 น.');
  assert.equal(ageText(135), '2 ชม. 15 น.');
  assert.equal(ageText(120), '2 ชม.');
  assert.equal(ageText(60 * 26), '1 วัน 2 ชม.');
});

test('ยอดตรง = รับได้ · ไม่ตรง = ต้องมีเหตุผล · 0 ชิ้นรับได้ถ้าบอกเหตุผล', () => {
  assert.equal(validateReceive({ expected: 60, qty: 60 }).ok, true);
  const short = validateReceive({ expected: 60, qty: 55 });
  assert.equal(short.ok, false);
  assert.equal(short.diff, -5);
  assert.equal(validateReceive({ expected: 60, qty: 55, reason: 'ของเสีย 5' }).ok, true);
  assert.equal(validateReceive({ expected: 60, qty: 0, reason: 'ของยังไม่มาถึง' }).ok, true);
  assert.equal(validateReceive({ expected: 60, qty: -1, reason: 'x' }).ok, false);
  assert.equal(validateReceive({ expected: 60, qty: '' }).ok, false);
});

test('โซน: ใบรอรับที่ค้างเกินเกณฑ์แยกเป็น stale · เรียงค้างนานก่อน', () => {
  const a = { id: 'a', status: 'pending', created_at: '2026-10-02T08:30:00Z' };
  const b = { id: 'b', status: 'pending', created_at: '2026-10-02T03:00:00Z' };
  assert.equal(receiptZoneStatus(a, () => 240, NOW), 'pending');
  assert.equal(receiptZoneStatus(b, () => 240, NOW), 'stale');
  assert.deepEqual(sortReceipts([a, b]).map(r => r.id), ['b', 'a']);
});
