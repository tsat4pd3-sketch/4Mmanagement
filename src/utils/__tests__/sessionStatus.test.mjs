import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_VOID, SESSION_STATUSES_REAL, SESSION_STATUSES_LIVE, SESSION_STATUSES_DONE,
         isVoidSession, voidBadge, voidBlockReason, cleanVoidReason } from '../sessionStatus.js';

/* 🚫 สถานะ "โมฆะ" — ตรรกะต้องตรงกับ trigger trg_session_void_guard ฝั่ง DB */

test('ชุดสถานะ: void ไม่อยู่ในชุดใดเลย (จอที่ใช้ชุดเหล่านี้จะไม่เห็นใบโมฆะ)', () => {
  for (const set of [SESSION_STATUSES_REAL, SESSION_STATUSES_LIVE, SESSION_STATUSES_DONE])
    assert.ok(!set.includes(SESSION_VOID), `${set} ต้องไม่มี void`);
  assert.deepEqual(SESSION_STATUSES_REAL, ['open', 'pending_close', 'closed']);
});

test('isVoidSession / voidBadge', () => {
  assert.equal(isVoidSession({ status: 'void' }), true);
  assert.equal(isVoidSession({ status: 'closed' }), false);
  assert.equal(isVoidSession(null), false);
  assert.equal(voidBadge({ status: 'closed' }), null);
  assert.match(voidBadge({ status: 'void', void_reason: 'เปิดผิด' }).title, /เปิดผิด/);
  assert.match(voidBadge({ status: 'void' }).title, /โมฆะ/, 'ไม่มีเหตุผล = ยังต้องมีคำอธิบาย');
});

test('🔴 กะเปล่าเท่านั้นที่ทำโมฆะได้', () => {
  const empty = { status: 'closed', actual_qty: 0, qty_ok: 0 };
  assert.equal(voidBlockReason({ session: empty }), null);
  assert.match(voidBlockReason({ session: empty, orders: [{ id: 1 }] }), /ใบผลิต 1/);
  assert.match(voidBlockReason({ session: empty, downtimes: [{ id: 1 }, { id: 2 }] }), /Downtime 2/);
  assert.match(voidBlockReason({ session: empty, defects: [{ id: 1 }] }), /ของเสีย 1/);
  assert.match(voidBlockReason({ session: { ...empty, actual_qty: 5 } }), /ยอดผลิต 5/);
  assert.match(voidBlockReason({ session: { ...empty, qty_ok: 3 } }), /งานดี 3/);
});

test('🔴 อ่านลูกไม่สำเร็จ ≠ ไม่มีลูก — ห้ามให้ทำโมฆะ', () => {
  const r = voidBlockReason({ session: { status: 'closed' }, loadError: true });
  assert.match(r, /อ่านข้อมูล/);
});

test('ใบที่เป็นโมฆะอยู่แล้ว / ไม่ได้เลือกกะ = บอกเหตุผล ไม่ throw', () => {
  assert.match(voidBlockReason({ session: { status: 'void' } }), /อยู่แล้ว/);
  assert.match(voidBlockReason({}), /ไม่ได้เลือก/);
  assert.match(voidBlockReason(), /ไม่ได้เลือก/);
});

test('cleanVoidReason: ว่าง/ช่องว่างล้วน = null (DB มี CHECK คู่กัน)', () => {
  assert.equal(cleanVoidReason('   '), null);
  assert.equal(cleanVoidReason(''), null);
  assert.equal(cleanVoidReason(null), null);
  assert.equal(cleanVoidReason(undefined), null);
  assert.equal(cleanVoidReason('  เปิดผิด  '), 'เปิดผิด');
});
