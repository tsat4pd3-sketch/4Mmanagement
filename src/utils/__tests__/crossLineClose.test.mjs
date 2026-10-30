/* ปิดใบผลิตข้ามไลน์ (src/utils/crossLineClose.js)
   แต่ละข้อผูกกับกติกาที่ถ้าถอดออกจะเกิดบั๊กจริง — ห้ามลบข้อไหนออก */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crossLineCloseState, crossLineNameOf, crossLineWhen, crossLineCloseText, CROSS_CLOSE_COLS,
} from '../crossLineClose.js';

const SESS = (id, { line = 'Line 60', status = 'open', work_date = '2026-10-30', shift = 'day' } = {}) =>
  ({ id, line_name: line, status, work_date, shift });

const R = (prod_no, sess, { status = 'open', qty = 35 } = {}) => ({
  id: `o-${prod_no}-${sess.id}`, prod_no, qty, status, session_id: sess.id, production_sessions: sess,
});

const CUR = SESS('cur', { line: 'Assy  LWR' });

test('ไม่เจอใบเปิดค้างที่ไลน์อื่น = none', () => {
  assert.equal(crossLineCloseState({ rows: [], currentSessionId: 'cur' }).state, 'none');
});

test('ใบของกะที่เปิดจออยู่ ไม่ใช่เคสข้ามไลน์ (ทางเดิมจัดการแล้ว)', () => {
  const rows = [R('A1', CUR)];
  assert.equal(crossLineCloseState({ rows, currentSessionId: 'cur' }).state, 'none');
});

test('เจอใบเดียวที่ไลน์อื่น + กะยังเปิด = ready', () => {
  const s = SESS('s60');
  const out = crossLineCloseState({ rows: [R('A1', s)], currentSessionId: 'cur' });
  assert.equal(out.state, 'ready');
  assert.equal(crossLineNameOf(out.row), 'Line 60');
});

test('① 🔴 เลข PROD.NO ซ้ำหลายไลน์ = ambiguous ห้ามเดา (ของจริง LINE A ใช้เลข 35/42/43/45)', () => {
  const a = SESS('sA', { line: 'LINE A ( 800 Ton )' });
  const b = SESS('sB', { line: 'LINE B ( 600 Ton )' });
  const out = crossLineCloseState({ rows: [R('35', a), R('35', b)], currentSessionId: 'cur' });
  assert.equal(out.state, 'ambiguous');
  assert.equal(out.row, null);              // ห้ามเลือกใบให้เอง
  assert.equal(out.rows.length, 2);
});

test('⓪ 🔴 ใบ manual ปิดข้ามไลน์ไม่ได้ — ต้องปิดด้วยยอดจริงที่จอไลน์เจ้าของ', () => {
  /* ใบสแกน qty = จำนวนการ์ดคัมบัง (ตายตัว) · ใบ manual ต้องปิดด้วยยอดผลิตจริง
     ปิดแบบใบสแกน = stamp "เป้า" แทนยอดจริง ⇒ OEE + ยอดเข้าคลังเพี้ยนเงียบ */
  const s = SESS('s60');
  const row = { ...R('MANUAL-261030-085706-92', s), is_manual: true, qty: 50, qty_actual: 12 };
  const out = crossLineCloseState({ rows: [row], currentSessionId: 'cur' });
  assert.equal(out.state, 'manual_only_owner');
  const txt = crossLineCloseText('manual_only_owner', out.row);
  assert.ok(txt.includes('ยอดผลิตจริง'));
  assert.ok(!txt.includes('**'));            // ข้อความขึ้นจอดิบๆ ห้ามมี markdown
});

test('② 🔴 กะเจ้าของใบ pending_close/closed = shift_locked (ยอด/OEE ถูก stamp แล้ว)', () => {
  for (const st of ['pending_close', 'closed', 'void']) {
    const s = SESS('s60', { status: st });
    const out = crossLineCloseState({ rows: [R('A1', s)], currentSessionId: 'cur' });
    assert.equal(out.state, 'shift_locked', st);
    assert.ok(crossLineCloseText('shift_locked', out.row).includes('ปิดกะ'));
  }
});

test('ใบที่ไม่ใช่ open (confirmed/cancelled/imported) ห้ามถูกหยิบมาปิดซ้ำ', () => {
  const s = SESS('s60');
  for (const st of ['confirmed', 'cancelled', 'imported', 'carry_over']) {
    const out = crossLineCloseState({ rows: [R('A1', s, { status: st })], currentSessionId: 'cur' });
    assert.equal(out.state, 'none', st);
  }
});

test('🔴 ไม่รู้ชื่อไลน์เจ้าของใบ = คืนค่าว่าง ห้ามถอยไปใช้ไลน์ที่เปิดจออยู่', () => {
  assert.equal(crossLineNameOf({ production_sessions: null }), '');
  assert.equal(crossLineNameOf(null), '');
  assert.equal(crossLineWhen(null), '');
});

test('ป้ายกะอ่านออก', () => {
  assert.equal(crossLineWhen(R('A1', SESS('s', { shift: 'night', work_date: '2026-10-30' }))), '🌙 กะดึก 30/10/26');
  assert.equal(crossLineWhen(R('A1', SESS('s', { shift: 'day', work_date: '2026-07-05' }))), '☀️ กะเช้า 05/07/26');
});

test('ทุกสถานะที่ปิดไม่ได้ ต้องมีข้อความบอกเหตุผล (ห้ามเงียบ)', () => {
  const s = SESS('s60', { status: 'closed' });
  const row = R('A1', s);
  assert.ok(crossLineCloseText('ambiguous', null).length > 10);
  assert.ok(crossLineCloseText('shift_locked', row).length > 10);
  for (const st of ['ambiguous', 'shift_locked', 'manual_only_owner', 'ready'])
    assert.ok(!crossLineCloseText(st, row).includes('**'), st);   // markdown ไม่ถูกเรนเดอร์ = หลุดเป็นตัวอักษรดิบ
  assert.equal(crossLineCloseText('none', null), '');
});

test('คอลัมน์ที่คิวรีต้องมีครบสำหรับตัวเขียน + การ์ดยืนยัน', () => {
  for (const c of ['id', 'prod_no', 'mat_no', 'qty', 'status', 'session_id', 'is_manual', 'qty_target']) {
    assert.ok(CROSS_CLOSE_COLS.split(',').map(s => s.trim()).includes(c), c);
  }
  assert.ok(!CROSS_CLOSE_COLS.includes('*'));
});
