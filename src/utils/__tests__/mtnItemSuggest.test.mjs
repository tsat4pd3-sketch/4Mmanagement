/* เติมชนิดอุปกรณ์จากประวัติเครื่อง (19/10) — ห้ามเดาตอนก้ำกึ่ง · ห้ามเติม "อื่นๆ" · ห้ามเติมชื่อที่ทีมเลือกไม่ได้ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestItemTypeFromHistory as sug } from '../mtnItemSuggest.js';

const R = (item_type, status = 'closed') => ({ item_type, status });

test('ชนะขาด = เติม · บอกว่านับจากกี่ใบ', () => {
  const s = sug([R('ROBOT HANDLING'), R('ROBOT HANDLING'), R('ROBOT HANDLING'), R('Robot Spot [ ABB ]')]);
  assert.deepEqual(s, { itemType: 'ROBOT HANDLING', votes: 3, counted: 4 });
});

test('ก้ำกึ่ง / ใบเดียว = null (ให้คนเลือกเอง)', () => {
  assert.equal(sug([R('A'), R('A'), R('B'), R('B')]), null);
  assert.equal(sug([R('A')]), null);
  assert.equal(sug([]), null);
});

test('ตัดอื่นๆ + ใบตีกลับ ก่อนนับ', () => {
  const s = sug([R('เครื่องจักรอื่นๆ'), R('เครื่องจักรอื่นๆ'), R('เครื่องจักรอื่นๆ'), R('Laser'), R('Laser'), R('X', 'rejected'), R('X', 'rejected'), R('X', 'rejected')]);
  assert.equal(s.itemType, 'Laser');
  assert.equal(s.counted, 2);
});

test('กรองด้วยลิสต์ที่ทีมเลือกได้ — ชื่อของทีมอื่นไม่ถูกเติม', () => {
  const rows = [R('ROBOT HANDLING'), R('ROBOT HANDLING'), R('ROBOT HANDLING'), R('Robot Handling [ ABB ]'), R('Robot Handling [ ABB ]')];
  assert.equal(sug(rows, { allowed: ['Robot Handling [ ABB ]', 'Robot Handling [ Yaskawa ]'] }).itemType, 'Robot Handling [ ABB ]');
  assert.equal(sug(rows, { allowed: new Set(['JIG']) }), null);
});

test('ชั้นทะเบียน — ประเภทเครื่องชี้ชื่อ · ทะเบียนชนะประวัติ · ทีมเลือกไม่ได้ = ถอยไปประวัติ', async () => {
  const { registryItemTypeOf, pickMoItemType } = await import('../mtnItemSuggest.js');
  const types = { t1: { label: 'Robot - Handling', mo_item_type: 'ROBOT HANDLING' }, t2: { label: 'Metal Forming', mo_item_type: null } };
  assert.deepEqual(registryItemTypeOf({ machine_type_id: 't1' }, types), { itemType: 'ROBOT HANDLING', typeLabel: 'Robot - Handling' });
  assert.equal(registryItemTypeOf({ machine_type_id: 't2' }, types), null);           // ยังไม่ตั้ง
  assert.equal(registryItemTypeOf({ machine_type_id: null }, types), null);
  assert.equal(registryItemTypeOf({ machine_type_id: 't1' }, types, { allowed: ['JIG'] }), null);
  const hist = { itemType: 'Robot Spot [ ABB ]', votes: 4, counted: 5 };
  assert.equal(pickMoItemType({ registry: registryItemTypeOf({ machine_type_id: 't1' }, types), history: hist }).source, 'registry');
  assert.equal(pickMoItemType({ registry: null, history: hist }).source, 'history');
  assert.equal(pickMoItemType({}), null);
});
