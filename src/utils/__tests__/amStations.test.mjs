import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStationIndex, stationAmState, validateStation } from '../amStations.js';

const ST = [{ id: 's1', name: 'Robot cell 1', line_name: 'L1' }, { id: 's2', name: 'ปิดแล้ว', line_name: 'L1', is_active: false }];
const MB = [
  { station_id: 's1', jig_id: 'grip', sort_order: 2 }, { station_id: 's1', jig_id: 'robot', sort_order: 1 },
  { station_id: 's2', jig_id: 'x', sort_order: 1 },
];

test('ดัชนี: เรียงตาม sort_order · สถานีปิดใช้ไม่นับสมาชิก', () => {
  const ix = buildStationIndex(ST, MB);
  assert.deepEqual(ix.membersOf('s1'), ['robot', 'grip']);
  assert.equal(ix.byJig.get('grip').id, 's1');
  assert.equal(ix.byJig.has('x'), false);
  assert.deepEqual(ix.membersOf('s2'), []);
});

test('สถานะสถานี: ครบผ่าน = done · มี NG = ng (ชนะ) · บางตัว = partial · ยังไม่ตรวจ = none', () => {
  assert.equal(stationAmState(['a', 'b'], { a: { status: 'pass' }, b: { status: 'pass' } }).state, 'done');
  const ng = stationAmState(['a', 'b'], { a: { status: 'fail' } });
  assert.equal(ng.state, 'ng'); assert.deepEqual(ng.ng, ['a']); assert.deepEqual(ng.missing, ['b']);
  const p = stationAmState(['a', 'b'], { a: { status: 'pass' } });
  assert.equal(p.state, 'partial'); assert.equal(p.done, 1); assert.equal(p.total, 2);
  assert.equal(stationAmState(['a'], {}).state, 'none');
  assert.equal(stationAmState([], {}).state, 'empty');
  assert.equal(stationAmState(['a'], { a: { status: 'pending' } }).state, 'none');   // ตรวจไม่ครบ = ยังไม่นับ
});

test('ตรวจก่อนบันทึก: ชื่อ · ไลน์ · ≥2 ตัว · ไลน์ตรง · ห้ามซ้ำสถานีอื่น', () => {
  const lineOf = (id) => ({ a: 'L1', b: 'L1', c: 'L2' })[id];
  assert.match(validateStation({ name: '', line_name: 'L1', jigIds: ['a', 'b'] }), /ชื่อ/);
  assert.match(validateStation({ name: 'S', line_name: '', jigIds: ['a', 'b'] }), /ไลน์/);
  assert.match(validateStation({ name: 'S', line_name: 'L1', jigIds: ['a'] }), /2 ตัว/);
  assert.match(validateStation({ name: 'S', line_name: 'L1', jigIds: ['a', 'c'], jigLineOf: lineOf }), /L2/);
  const taken = (id) => (id === 'b' ? { id: 'other', name: 'สถานี X' } : null);
  assert.match(validateStation({ name: 'S', line_name: 'L1', jigIds: ['a', 'b'], jigLineOf: lineOf, takenBy: taken }), /สถานี X/);
  assert.equal(validateStation({ name: 'S', line_name: 'L1', jigIds: ['a', 'b'], jigLineOf: lineOf, takenBy: taken, selfId: 'other' }), '');
});

import { groupLineUnits } from '../amStations.js';
test('บอร์ดนับเป็นชุด: สถานีขาดตัวเดียว = ชุดนั้นยังไม่ครบ · เครื่องเดี่ยวนับ 1 ชุด', () => {
  const ix = buildStationIndex([{ id: 's1', name: 'cell', line_name: 'L1' }], [{ station_id: 's1', jig_id: 'robot' }, { station_id: 's1', jig_id: 'grip' }]);
  const r = groupLineUnits({ neededIds: ['robot', 'grip', 'press'], missingIds: ['grip'], ngIds: [], ix });
  assert.equal(r.total, 2); assert.equal(r.doneN, 1); assert.equal(r.stationN, 1);
  const cell = r.units.find(u => u.station?.id === 's1');
  assert.deepEqual(cell.missing, ['grip']); assert.equal(cell.done, false);
  assert.equal(r.units.find(u => !u.station).done, true);
  const all = groupLineUnits({ neededIds: ['robot', 'grip'], missingIds: [], ngIds: ['robot'], ix });
  assert.equal(all.doneN, 1); assert.deepEqual(all.units[0].ng, ['robot']);   // NG = ตรวจแล้ว (แดง) ไม่ใช่ยังไม่ครบ
  assert.equal(groupLineUnits({ neededIds: [] }).total, 0);
});
