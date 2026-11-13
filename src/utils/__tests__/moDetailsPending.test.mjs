/* ⏳ ใบ MO ที่ระบบเปิดให้ตอนกดเรียกช่าง แล้วยังรอคนใส่รายละเอียด (13/11 · คำสั่ง user)
 * 🔴 `undefined` (ไม่ได้ select คอลัมน์มา) ต้องตอบ "ไม่รู้" ห้ามตอบ "ครบแล้ว" */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MO_DETAIL_FIELDS, isDetailsPending, moDetailsMissing, detailsPendingText, canClearDetailsFlag,
} from '../moDetailsPending.js';

test('ธง 3 ค่า — true / false / null(ไม่รู้)', () => {
  assert.equal(isDetailsPending({ details_pending: true }), true);
  assert.equal(isDetailsPending({ details_pending: false }), false);
  assert.equal(isDetailsPending({ details_pending: null }), false, 'null ในฐาน = ใบปกติ');
});

test('🔴 ไม่ได้ select ธงมา = null ห้ามเดาว่าใบครบ', () => {
  assert.equal(isDetailsPending({}), null);
  assert.equal(isDetailsPending(null), null);
  assert.equal(isDetailsPending(undefined), null);
  /* เดาเป็น false = ใบที่รอเอกสารหายจากคิว ไม่มีใครตามเก็บ */
  assert.equal(detailsPendingText({}), null, 'ไม่รู้ = ไม่ขึ้นป้าย (แต่ก็ไม่บอกว่าครบ)');
});

test('บอกได้ว่าขาดอะไร — ชื่อช่องตรงกับที่ฟอร์มบังคับ', () => {
  const r = moDetailsMissing({ item_type: 'DIE', problem_characteristic: '', before_img: null });
  assert.equal(r.known, true);
  assert.deepEqual(r.missing, ['ลักษณะปัญหา', 'รูปก่อนซ่อม']);
  assert.deepEqual(MO_DETAIL_FIELDS.map(f => f.key), ['item_type', 'problem_characteristic', 'before_img']);
});

test('🔴 ไม่ได้ select ช่องรายละเอียดมาเลย = known:false (ห้ามรายงานว่าขาดครบทุกช่อง)', () => {
  const r = moDetailsMissing({ id: 'x', mo_no: 'PRO-BM-131126-0001' });
  assert.equal(r.known, false);
  assert.deepEqual(r.missing, [], 'ไม่รู้ ≠ ขาดทุกช่อง — ขึ้นว่าขาดทั้ง 3 ช่องทั้งที่ใบอาจครบ = จอโกหก');
  assert.equal(detailsPendingText({ details_pending: true, id: 'x' }), 'รอเพิ่มรายละเอียด',
    'รู้แค่ว่าติดธง = บอกกลางๆ ไม่ไล่ชื่อช่อง');
});

test('ป้ายบนแถว — ใบปกติไม่ขึ้นป้าย · ใบติดธงบอกว่าขาดอะไร', () => {
  assert.equal(detailsPendingText({ details_pending: false, item_type: 'DIE' }), null);
  assert.equal(
    detailsPendingText({ details_pending: true, item_type: '', problem_characteristic: '', before_img: null }),
    'รอเพิ่มรายละเอียด: ชนิดอุปกรณ์ · ลักษณะปัญหา · รูปก่อนซ่อม');
  /* เติมครบแล้วแต่ธงยังไม่หลุด (เช่นเขียนปลดธงไม่ติด) — ต้องบอกต่างออกไป ไม่ใช่เงียบ */
  assert.equal(
    detailsPendingText({ details_pending: true, item_type: 'DIE', problem_characteristic: 'แตก', before_img: 'u' }),
    'รอกดยืนยันรายละเอียด');
});

test('🔴 ปลดธงได้เมื่อครบทุกช่องเท่านั้น', () => {
  const stub = { details_pending: true, item_type: null, problem_characteristic: null, before_img: null };
  assert.equal(canClearDetailsFlag(stub), false);
  assert.equal(canClearDetailsFlag(stub, { item_type: 'DIE', problem_characteristic: 'แตก' }), false,
    'ขาดรูปก่อนซ่อม = ยังปลดไม่ได้');
  assert.equal(canClearDetailsFlag(stub, { item_type: 'DIE', problem_characteristic: 'แตก', before_img: 'url' }), true);
  /* ช่องว่าง/ช่องเว้นวรรค ไม่นับว่ากรอก */
  assert.equal(canClearDetailsFlag(stub, { item_type: '  ', problem_characteristic: 'แตก', before_img: 'url' }), false);
});

test('ค่าที่ไม่ใช่สตริงก็ตัดสินได้ (รูปเป็น object/false)', () => {
  assert.equal(canClearDetailsFlag({ item_type: 'DIE', problem_characteristic: 'แตก', before_img: false }), false);
  assert.equal(canClearDetailsFlag({ item_type: 'DIE', problem_characteristic: 'แตก', before_img: 0 }), false);
});
