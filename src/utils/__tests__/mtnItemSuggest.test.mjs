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
