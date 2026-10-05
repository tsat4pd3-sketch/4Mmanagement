/* เทสทะเบียนรูปแบบชุดแม่พิมพ์ + เติม "ชนิดอุปกรณ์" ในใบแจ้งซ่อมจากแม่พิมพ์ — src/utils/equipmentKinds.js (2026-10-05)
   ที่มา (user): ทีมแม่พิมพ์ต้องเพิ่ม HYDROFORM/BEND เอง + "เลือกแม่พิมพ์แล้ว ก็ควรดึงจากฐานข้อมูลได้ว่าแม่พิมพ์นี้คืออะไร"
   🔴 ล็อก: ค่าที่ไม่อยู่ในทะเบียนต้องไม่หายเงียบ · ชี้ไม่ได้ = null (ห้ามเดา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIE_SET_KINDS, normDieSetKind, dieSetKindLabel, dieSetKindOptions, dieSetKindKey,
  buildDieItemTypeMap, dieItemTypeOf,
} from '../equipmentKinds.js';

const kinds = [
  { key: 'tandem', label: 'Tandem (ชุดเรียง OP)', description: 'x', mo_item_type: 'DIE TANDEM', is_active: true },
  { key: 'hydroform', label: 'HYDROFORM DIE', mo_item_type: 'DIE HYDROFORM', is_active: true },
  { key: 'old', label: 'แบบเก่า', mo_item_type: null, is_active: false },
].map(normDieSetKind);

test('ป้าย: จากทะเบียน · key ไม่รู้จัก = key ดิบ · ว่าง = —', () => {
  assert.equal(dieSetKindLabel('hydroform', kinds), 'HYDROFORM DIE');
  assert.equal(dieSetKindLabel('weird', kinds), 'weird');
  assert.equal(dieSetKindLabel(null, kinds), '—');
  assert.equal(dieSetKindLabel('single'), 'Single (OP เดียว)');   // ไม่ส่ง kinds = ค่าสำรอง (ที่เรียกแบบเดิม)
});

test('ตัวเลือก: ซ่อนที่ปิดใช้ แต่ค่าปัจจุบันของชุดต้องอยู่เสมอ (กัน select บันทึกทับเงียบ)', () => {
  assert.deepEqual(dieSetKindOptions(kinds, 'tandem').map(k => k.key), ['tandem', 'hydroform']);
  const withOld = dieSetKindOptions(kinds, 'old');
  assert.ok(withOld.some(k => k.key === 'old' && k.stale));
  const unknown = dieSetKindOptions(kinds, 'ghost');
  assert.ok(unknown.some(k => k.key === 'ghost' && /ไม่มีในทะเบียน/.test(k.label)));
});

test('key อัตโนมัติจากชื่อ · ชื่อไทยล้วนได้ key จากเวลา', () => {
  assert.equal(dieSetKindKey({ label: 'BEND DIE' }), 'bend_die');
  assert.equal(dieSetKindKey({ label: ' Hydro-Form (2) ' }), 'hydro_form_2');
  assert.equal(dieSetKindKey({ label: 'แม่พิมพ์ดัด' }, 36), 'k_10');
});

test('แม่พิมพ์ → ชนิดอุปกรณ์ในใบ MO: เทียบเลขแบบ trim+uppercase · ชี้ไม่ได้ = null', () => {
  const map = buildDieItemTypeMap([
    { machine_no: 'd-101 ', kind: 'tandem' },
    { machine_no: 'D-200', kind: 'old' },          // รูปแบบยังไม่ตั้ง mo_item_type
    { machine_no: 'D-300', kind: 'ghost' },        // key ไม่อยู่ในทะเบียน
    { machine_no: '', kind: 'tandem' },
  ], kinds);
  assert.deepEqual(dieItemTypeOf(map, ' D-101'), { kindKey: 'tandem', kindLabel: 'Tandem (ชุดเรียง OP)', itemType: 'DIE TANDEM' });
  assert.equal(dieItemTypeOf(map, 'D-200').itemType, null);
  assert.equal(dieItemTypeOf(map, 'D-300').kindLabel, 'ghost');
  assert.equal(dieItemTypeOf(map, 'D-300').itemType, null);
  assert.equal(dieItemTypeOf(map, 'D-999'), null);   // ไม่ผูกชุด
  assert.equal(dieItemTypeOf(null, 'D-101'), null);  // ยังโหลดไม่เสร็จ
});

test('ค่าสำรองมี mo_item_type ตรงกับชื่อใน mtn_item_types เดิม', () => {
  assert.deepEqual(DIE_SET_KINDS.map(k => k.mo_item_type), ['DIE TANDEM', 'DIE PROGRESSIVE', 'DIE TRANSFER', 'DIE SINGLE']);
});
