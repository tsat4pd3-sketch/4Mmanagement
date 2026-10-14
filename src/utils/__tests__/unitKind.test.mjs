/* 🏭 "หน่วยนี้เป็นไลน์ผลิตหรือเปล่า" — src/utils/unitKind.js (2026-10-13 · คำสั่ง user)
   ที่มา: *"office pd4 … สร้างเป็นผังออฟฟิส ซึ่งไม่ใช่ไลน์ผลิต มันจะทำให้ระบบงง"*
   เทสนี้ล็อกทิศของความผิดพลาด: **ค่าว่าง/ไม่รู้จัก = ไลน์ผลิต** (fail-open)
   — พลาดแล้ว "โผล่เกิน" เห็นแล้วรู้ · พลาดอีกทาง = ไลน์ผลิตหายจากจอ ไม่มีใครรู้ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT_PRODUCTION, UNIT_SUPPORT, UNIT_KINDS, unitKindLabel,
  isProductionUnit, isSupportUnit, productionUnits, supportUnits, splitUnitKinds,
} from '../unitKind.js';

const L = (name, unit_kind) => ({ name, unit_kind });

test('ค่าว่าง / ไม่มีคอลัมน์ / ค่าแปลก = ไลน์ผลิต (fail-open ตาม default ของคอลัมน์)', () => {
  for (const v of [undefined, null, '', 'PRODUCTION', 'office', 'ไลน์ผลิต']) {
    assert.equal(isProductionUnit(L('X', v)), true, `unit_kind=${JSON.stringify(v)} ต้องถือเป็นไลน์ผลิต`);
    assert.equal(isSupportUnit(L('X', v)), false);
  }
  assert.equal(isProductionUnit({}), true, 'แถวที่ยังไม่มีคอลัมน์เลย');
  assert.equal(isProductionUnit(null), true, 'ไม่มีแถว = ห้ามตัดสินว่าไม่ผลิต');
});

test('เฉพาะค่า support เป๊ะๆ เท่านั้นที่เป็นหน่วยสนับสนุน', () => {
  assert.equal(isSupportUnit(L('Office PD4', UNIT_SUPPORT)), true);
  assert.equal(isProductionUnit(L('Office PD4', UNIT_SUPPORT)), false);
  assert.equal(isSupportUnit(L('X', 'Support')), false, 'ตัวพิมพ์ต่าง = ไม่ใช่ (ฝั่ง DB มี check constraint คุมอยู่)');
});

test('productionUnits / supportUnits / splitUnitKinds แบ่งครบ ไม่มีตัวหาย', () => {
  const rows = [
    L('LINE A', UNIT_PRODUCTION), L('Office PD4', UNIT_SUPPORT),
    L('HDF1', null), L('Coating', UNIT_SUPPORT), L('Rework - PD1', UNIT_SUPPORT),
  ];
  assert.deepEqual(productionUnits(rows).map(r => r.name), ['LINE A', 'HDF1']);
  assert.deepEqual(supportUnits(rows).map(r => r.name), ['Office PD4', 'Coating', 'Rework - PD1']);
  const { production, support } = splitUnitKinds(rows);
  assert.equal(production.length + support.length, rows.length, 'รวมแล้วต้องเท่าเดิม ห้ามมีตัวหาย');
  assert.deepEqual(production.map(r => r.name), ['LINE A', 'HDF1']);
});

test('ลิสต์ว่าง / ไม่ส่งอะไรเลย = ไม่พัง และไม่คืนของมั่ว', () => {
  assert.deepEqual(productionUnits(), []);
  assert.deepEqual(supportUnits(null), []);
  assert.deepEqual(splitUnitKinds(), { production: [], support: [] });
});

test('ทะเบียนป้าย: มี 2 ชนิด · ทุกชนิดมี label + desc · ป้ายของค่าไม่รู้จัก = ไลน์ผลิต', () => {
  assert.equal(UNIT_KINDS.length, 2);
  for (const k of UNIT_KINDS) {
    assert.ok(k.label && k.desc, `${k.key} ต้องมีทั้ง label และ desc (จอเอาไปขึ้น title)`);
  }
  assert.equal(unitKindLabel(UNIT_SUPPORT), UNIT_KINDS[1].label);
  assert.equal(unitKindLabel(undefined), UNIT_KINDS[0].label, 'ไม่รู้ = ไลน์ผลิต');
});
