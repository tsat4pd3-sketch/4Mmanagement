/* ══ แก้ "เวลาเริ่ม–จบของ MAT.NO" หลังปิดกะ (utils/matTimeEdit.js + oee §6.2) ══
   เคสจริง Apron Assy 20/10: แก้เวลาจบแล้วจอตีกลับเป็นเวลาปิดกะทุกครั้ง เพราะตัวบันทึก
   เขียน `confirmed_at` ของใบ confirmed ใบสุดท้าย แต่จออ่าน max ของ **ทุกใบ** (ใบยกยอด = `stopped_at`) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderCloseMs, matRawWindow } from '../oee.js';
import { planMatTimeWrites, MAT_TIME_SKIP_OPEN } from '../matTimeEdit.js';

const T = (hhmm) => new Date(`2026-10-20T${hhmm}:00+07:00`).toISOString();
const ms = (hhmm) => new Date(`2026-10-20T${hhmm}:00+07:00`).getTime();

const confirmed = (id, open, conf) => ({ id, status: 'confirmed', opened_at: T(open), confirmed_at: T(conf) });
const imported  = (id, open, stop) => ({ id, status: 'imported',  opened_at: T(open), stopped_at: T(stop) });

test('orderCloseMs — confirmed ใช้ confirmed_at · ยกยอด/ส่งต่อ/ยกเลิก ใช้ stopped_at', () => {
  assert.equal(orderCloseMs(confirmed('a', '08:00', '13:50')), ms('13:50'));
  assert.equal(orderCloseMs(imported('b', '13:50', '20:00')), ms('20:00'));
  assert.equal(orderCloseMs({ id: 'c', status: 'carry_over', stopped_at: T('19:00') }), ms('19:00'));
  assert.equal(orderCloseMs({ id: 'd', status: 'cancelled', stopped_at: T('10:00') }), ms('10:00'));
});

test('orderCloseMs — ใบที่ยังเปิดคือ "ยังไม่ปิด" ห้ามเดาเป็นปลายกะ', () => {
  assert.equal(orderCloseMs({ id: 'e', status: 'open', opened_at: T('08:00') }), null);
  // ใบ open ที่เผลอมี confirmed_at ค้าง (ย้อนสถานะ) ก็ยังไม่นับ — สถานะเป็นตัวตัดสิน
  assert.equal(orderCloseMs({ id: 'f', status: 'open', confirmed_at: T('09:00') }), null);
  assert.equal(orderCloseMs(null), null);
  assert.equal(orderCloseMs({ id: 'g', status: 'confirmed' }), null);
  assert.equal(orderCloseMs({ id: 'h', status: 'confirmed', confirmed_at: 'ไม่ใช่เวลา' }), null);
});

test('orderCloseMs — ใบยกยอดที่ไม่ได้กรอก stopped_at ถอยไป confirmed_at', () => {
  assert.equal(orderCloseMs({ id: 'i', status: 'carry_over', confirmed_at: T('18:00') }), ms('18:00'));
});

test('matRawWindow — กรอบของ MAT = min(opened_at) → max(เวลาปิดของทุกใบ)', () => {
  const win = matRawWindow([confirmed('a', '08:00', '13:50'), imported('b', '13:50', '20:00')]);
  assert.equal(win.startMs, ms('08:00'));
  assert.equal(win.endMs, ms('20:00'));   // 🔴 เดิมจอแก้เวลาตัด imported ทิ้ง = ได้ 13:50 ไม่ตรงแท็บประวัติ
});

test('matRawWindow — ไม่มีใบปิด = endMs null (ให้คนเรียกเลือก fallback เอง ห้ามคืน 0)', () => {
  const win = matRawWindow([{ id: 'a', status: 'open', opened_at: T('08:00') }]);
  assert.equal(win.startMs, ms('08:00'));
  assert.equal(win.endMs, null);
  const empty = matRawWindow([]);
  assert.deepEqual(empty, { startMs: null, endMs: null });
});

test('ย่อเวลาจบ — ต้องรัด **ทุกใบ** ที่ปิดช้ากว่าเวลาใหม่ (เคส Apron Assy)', () => {
  const orders = [confirmed('a', '08:00', '13:50'), confirmed('b', '13:50', '19:28'), imported('c', '19:28', '20:00')];
  const { writes, skip } = planMatTimeWrites(orders, { endMs: ms('19:00') });
  assert.equal(skip, null);
  assert.deepEqual(writes.map(w => [w.id, w.field, w.ms]).sort(), [
    ['b', 'confirmed_at', ms('19:00')],
    ['c', 'stopped_at', ms('19:00')],
  ].sort());
  // ผลลัพธ์ที่จอจะอ่านได้ = เวลาใหม่พอดี (ไม่ใช่ 19:28 ของใบอันดับ 2)
  const after = orders.map(o => {
    const w = writes.find(x => x.id === o.id);
    return w ? { ...o, [w.field]: new Date(w.ms).toISOString() } : o;
  });
  assert.equal(matRawWindow(after).endMs, ms('19:00'));
});

test('ขยายเวลาจบ — ไม่มีใบไหนเลยเวลาใหม่ = เลื่อนใบที่ปิดช้าสุดใบเดียว', () => {
  const orders = [confirmed('a', '08:00', '13:50'), imported('c', '13:50', '19:00')];
  const { writes } = planMatTimeWrites(orders, { endMs: ms('20:00') });
  assert.deepEqual(writes, [{ id: 'c', field: 'stopped_at', ms: ms('20:00') }]);
});

test('ใบยกยอดเขียนลง stopped_at ไม่ใช่ confirmed_at (ไม่งั้นใบนั้นดูเหมือนปิดแล้ว)', () => {
  const { writes } = planMatTimeWrites([imported('c', '13:50', '20:00')], { endMs: ms('19:00') });
  assert.deepEqual(writes, [{ id: 'c', field: 'stopped_at', ms: ms('19:00') }]);
});

test('เวลาเริ่ม — เลื่อนไปข้างหน้าต้องรัดทุกใบที่เปิดก่อนเวลาใหม่', () => {
  const orders = [confirmed('a', '08:00', '10:00'), confirmed('b', '08:30', '13:50')];
  const { writes } = planMatTimeWrites(orders, { startMs: ms('09:00') });
  assert.deepEqual(writes.map(w => [w.id, w.field]).sort(), [['a', 'opened_at'], ['b', 'opened_at']].sort());
  const after = orders.map(o => ({ ...o, opened_at: new Date(ms('09:00')).toISOString() }));
  assert.equal(matRawWindow(after).startMs, ms('09:00'));
});

test('เวลาเริ่ม — ถอยไปข้างหลัง = ขยับใบที่เปิดก่อนสุดใบเดียว', () => {
  const orders = [confirmed('a', '08:00', '10:00'), confirmed('b', '08:30', '13:50')];
  const { writes } = planMatTimeWrites(orders, { startMs: ms('07:30') });
  assert.deepEqual(writes, [{ id: 'a', field: 'opened_at', ms: ms('07:30') }]);
});

test('แก้ทั้งเริ่มและจบในครั้งเดียว', () => {
  const orders = [confirmed('a', '08:00', '13:50'), imported('c', '13:50', '20:00')];
  const { writes } = planMatTimeWrites(orders, { startMs: ms('08:30'), endMs: ms('19:00') });
  assert.equal(writes.filter(w => w.field === 'opened_at').length, 1);
  assert.equal(writes.filter(w => w.field === 'stopped_at').length, 1);
});

test('🔴 ยังมีใบเปิดค้าง = ไม่เขียนอะไรเลย และต้องคืนเหตุผลให้จอบอก (ห้ามข้ามเงียบ)', () => {
  const orders = [confirmed('a', '08:00', '13:50'), { id: 'z', status: 'open', opened_at: T('13:50') }];
  const { writes, skip } = planMatTimeWrites(orders, { endMs: ms('19:00') });
  assert.deepEqual(writes, []);
  assert.equal(skip, MAT_TIME_SKIP_OPEN);
});

test('ไม่ส่งเวลามา / ไม่มีใบ = ไม่เขียน', () => {
  assert.deepEqual(planMatTimeWrites([confirmed('a', '08:00', '13:50')], {}), { writes: [], skip: null });
  assert.deepEqual(planMatTimeWrites([], { endMs: ms('19:00') }), { writes: [], skip: null });
  assert.deepEqual(planMatTimeWrites(null, { endMs: ms('19:00') }), { writes: [], skip: null });
});

test('MAT ที่มีแต่ใบ cancelled ก็แก้เวลาจบได้ (ไม่มีใบ confirmed — เดิมเงียบไม่เขียนเลย)', () => {
  const orders = [{ id: 'x', status: 'cancelled', opened_at: T('08:00'), stopped_at: T('20:00') }];
  const { writes } = planMatTimeWrites(orders, { endMs: ms('09:30') });
  assert.deepEqual(writes, [{ id: 'x', field: 'stopped_at', ms: ms('09:30') }]);
});
