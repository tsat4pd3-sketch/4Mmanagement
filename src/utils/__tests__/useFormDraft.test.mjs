/**
 * useFormDraft — เทสส่วนที่เป็นกฎล้วน (2026-11-27)
 * ตัว hook ต้องมี React ⇒ เทสที่นี่คุม `draftPayload` (อะไรนับว่าเป็นร่าง) + `draftAgeText`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftPayload, draftAgeText } from '../useFormDraft.js';

test('ฟอร์มที่ยังไม่กรอกอะไร = ไม่มีร่าง (null)', () => {
  assert.equal(draftPayload({}), null);
  assert.equal(draftPayload({ a: '', b: null, c: undefined, d: false, e: [], f: {} }), null);
});

test('ช่องที่กรอกแล้วถูกเก็บ · ช่องว่างถูกตัดทิ้ง', () => {
  assert.deepEqual(
    draftPayload({ line_name: 'Laser LWR', machine_no: '', problem_detail: '2L nogo', is_sample: false }),
    { line_name: 'Laser LWR', problem_detail: '2L nogo' },
  );
});

test('🔴 ค่า false/0 — false ไม่นับ (checkbox ที่ไม่ติ๊ก) แต่ 0 นับ (เป็นเลขที่คนกรอก)', () => {
  assert.equal(draftPayload({ is_sample: false }), null);
  assert.deepEqual(draftPayload({ qty: 0 }), { qty: 0 });
  assert.deepEqual(draftPayload({ is_sample: true }), { is_sample: true });
});

test('🔴 ไฟล์/Blob/ฟังก์ชัน ห้ามเข้าร่าง (กู้กลับไม่ได้จริง + กิน quota)', () => {
  const f = { note: 'x', onSave: () => {}, img: new Blob(['abc']) };
  assert.deepEqual(draftPayload(f), { note: 'x' });
});

test('อาร์เรย์ที่มีของ = นับ · อาร์เรย์ว่าง = ไม่นับ', () => {
  assert.deepEqual(draftPayload({ techs: ['นพกร'], tags: [] }), { techs: ['นพกร'] });
});

test('ออบเจ็กต์ซ้อนที่มีค่า = นับ', () => {
  assert.deepEqual(draftPayload({ meta: { a: 1 } }), { meta: { a: 1 } });
  assert.equal(draftPayload({ meta: {} }), null);
});

test('ของที่ไม่ใช่ออบเจ็กต์ = ไม่มีร่าง', () => {
  for (const v of [null, undefined, 'x', 5, [], [1, 2]]) assert.equal(draftPayload(v), null, String(v));
});

test('draftAgeText บอกอายุร่างแบบอ่านรู้เรื่อง', () => {
  const now = 1_700_000_000_000;
  assert.equal(draftAgeText(now - 10_000, now), 'เมื่อสักครู่');
  assert.equal(draftAgeText(now - 5 * 60_000, now), 'เมื่อ 5 นาทีที่แล้ว');
  assert.equal(draftAgeText(now - 59 * 60_000, now), 'เมื่อ 59 นาทีที่แล้ว');
  assert.equal(draftAgeText(now - 60 * 60_000, now), 'เมื่อ 1 ชั่วโมงที่แล้ว');
  assert.equal(draftAgeText(now - 95 * 60_000, now), 'เมื่อ 1 ชั่วโมง 35 นาทีที่แล้ว');
});

test('draftAgeText กับค่าพัง = ข้อความว่าง ไม่ throw', () => {
  assert.equal(draftAgeText(null, 1000), '');
  assert.equal(draftAgeText(undefined, 1000), '');
  assert.equal(draftAgeText(9_999_999_999_999, 1000), '');   // อนาคต = ไม่บอกอายุ
});
