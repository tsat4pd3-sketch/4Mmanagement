import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCoilUom, qtyUnit, ceilKg } from '../coilUom.js';

test('coil = parts_master.uom KG เท่านั้น · ว่าง/อื่น = ชิ้น', () => {
  assert.equal(isCoilUom('KG'), true); assert.equal(isCoilUom(' kg '), true);
  for (const u of [null, undefined, '', 'PC', 'EA', 'pcs']) assert.equal(isCoilUom(u), false);
  assert.equal(qtyUnit('KG'), 'kg'); assert.equal(qtyUnit(null), 'ชิ้น');
  assert.equal(ceilKg(0.1231), 0.124); assert.equal(ceilKg(171), 171); assert.equal(ceilKg(-1), 0);
});
