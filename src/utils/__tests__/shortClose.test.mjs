import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canShortClose, shortCloseError, shortClosePatch, isShortClosed, NO_SHORT_CLOSE } from '../shortClose.js';

test('🔴 FG 1xx ปิดด้วยยอดเศษไม่ได้ — ของส่งลูกค้าต้องครบ (คำสั่ง user 02/10)', () => {
  const r = canShortClose('10088639');
  assert.equal(r.ok, false);
  assert.match(r.reason, /ส่งลูกค้า/);
  assert.match(r.reason, /ยกยอดต่อ/, 'ต้องบอกทางออกด้วย ไม่ใช่แค่ห้าม');
  assert.deepEqual(NO_SHORT_CLOSE, ['fg']);
});

test('งานปั๊มเบอร์ 2xx (child part ผลิตเอง) ปิดด้วยยอดเศษได้ — ส่งเข้ากระบวนการถัดไปในโรงงาน', () => {
  assert.equal(canShortClose('20066101').ok, true);
});

test('เลขที่ระบบตีคลาสไม่ออก (ไม่ใช่ SAP 8 หลัก) ต้องไม่ถูกบล็อก — ไม่ใช่ของส่งลูกค้าแน่', () => {
  assert.equal(canShortClose('127').ok, true);
  assert.equal(canShortClose('').ok, true);
  assert.equal(canShortClose(null).ok, true);
});

test('🔴 ยอดเท่าเป้าพอดี = ผลิตครบ ต้องไล่ไปใช้ปุ่ม "ผลิตครบแล้ว" (กันปุ่มซ้ำความหมาย)', () => {
  assert.match(shortCloseError(60, 60), /ผลิตครบ/);
});

test('ยอดเกินเป้า ไม่ใช่ "เศษ" · ยอด 0 หรือติดลบ = ปิดไม่ได้', () => {
  assert.match(shortCloseError(61, 60), /เกินเป้า/);
  assert.match(shortCloseError(0, 60), /มากกว่า 0/);
  assert.match(shortCloseError(-5, 60), /มากกว่า 0/);
  assert.match(shortCloseError('abc', 60), /มากกว่า 0/);
});

test('ยอดเศษปกติผ่าน', () => {
  assert.equal(shortCloseError(47, 60), null);
  assert.equal(shortCloseError('47', 60), null);
});

test('🔴 patch ต้องเขียนทั้ง qty และ qty_ok — trigger 2 ตัวอ่านคนละคอลัมน์', () => {
  const p = shortClosePatch({ qty: 60, mat_no: '20066101' }, 47, { by: 'ช่างเอ' });
  assert.equal(p.qty, 47, 'fn_explode_child_demand อ่าน qty — BOM ต้องหักตามของจริง');
  assert.equal(p.qty_ok, 47, 'fn_post_confirmed_output อ่าน coalesce(qty_ok, qty)');
  assert.equal(p.qty_actual, 47);
  assert.equal(p.status, 'confirmed');
  assert.equal(p.confirmed_by, 'ช่างเอ');
});

test('🔴 เป้าเดิมต้องถูกเก็บไว้ที่ qty_target — ไม่งั้นสืบไม่ได้ว่าใบนี้เคยสั่งเท่าไหร่', () => {
  const p = shortClosePatch({ qty: 60 }, 47);
  assert.equal(p.qty_target, 60);
});

test('ใบที่เคยถูกปิดเศษมาก่อน ต้องไม่เสียเป้าตั้งต้น (qty_target ชนะ qty)', () => {
  const p = shortClosePatch({ qty: 47, qty_target: 60 }, 30);
  assert.equal(p.qty_target, 60, 'ห้ามกลายเป็น 47');
});

test('หมายเหตุต้องบอกครบ: ทำได้เท่าไหร่ · เหลือเท่าไหร่ที่ไม่ต้องทำ · ให้ไปแก้ SAP เป็นเลขอะไร', () => {
  const p = shortClosePatch({ qty: 60 }, 47);
  assert.match(p.carry_over_note, /47\/60/);
  assert.match(p.carry_over_note, /13 ชิ้นไม่ต้องทำต่อ/);
  assert.match(p.carry_over_note, /SAP ให้เป็น 47/);
});

test('เวลาหยุดผลิต: ส่งมา = เขียน stopped_at + confirmed_at · ไม่ส่ง = ไม่ใส่คีย์ (ห้ามเขียน null ทับ)', () => {
  const iso = '2026-10-02T10:00:00.000Z';
  const a = shortClosePatch({ qty: 60 }, 47, { stoppedAt: iso });
  assert.equal(a.stopped_at, iso);
  assert.equal(a.confirmed_at, iso);
  const b = shortClosePatch({ qty: 60 }, 47);
  assert.ok(!('stopped_at' in b) && !('confirmed_at' in b));
});

test('isShortClosed: ชี้เฉพาะใบที่ปิดแล้วและยอดต่ำกว่าเป้าเดิม (ไว้ทำ worklist แก้ SAP)', () => {
  assert.equal(isShortClosed({ status: 'confirmed', qty: 47, qty_target: 60 }), true);
  assert.equal(isShortClosed({ status: 'confirmed', qty: 60, qty_target: 60 }), false, 'ปิดเต็มใบ ไม่ใช่เศษ');
  assert.equal(isShortClosed({ status: 'open', qty: 47, qty_target: 60 }), false, 'ยังไม่ปิด');
  assert.equal(isShortClosed({ status: 'confirmed', qty: 47 }), false, 'ไม่มีเป้าเดิม = ตัดสินไม่ได้ ห้ามเดา');
  assert.equal(isShortClosed(null), false);
});
