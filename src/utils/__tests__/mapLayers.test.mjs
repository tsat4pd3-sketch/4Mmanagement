import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKindMap, layerOfPoint, splitPointLayers } from '../mapLayers.js';

const reg = [
  { machine_no: 'RB-114', equipment_kind: 'machine' },
  { machine_no: 'JHYD05-01', equipment_kind: 'jig' },
  { machine_no: 'AB-01', equipment_kind: 'facility' },
  { machine_no: 'X-1', equipment_kind: 'jig' },
  { machine_no: 'X1', equipment_kind: 'machine' },   // คีย์ชนกันคนละชนิด
  { machine_no: 'NOKIND', equipment_kind: null },
];

test('จับคู่ด้วย machineKey — RB114 = RB-114', () => {
  const k = buildKindMap(reg);
  assert.deepEqual(layerOfPoint('RB114', k), { layer: 'machine', kind: 'machine', known: true });
  assert.equal(layerOfPoint('jhyd05-01', k).layer, 'jig');
  assert.equal(layerOfPoint('AB-01', k).layer, 'machine');
});

test('ไม่อยู่ทะเบียน / กำกวม / ชนิดว่าง = unknown แต่ยังอยู่ชั้น machine (ไม่หายจากผัง)', () => {
  const k = buildKindMap(reg);
  for (const no of ['JIG SLIDE-1', 'X-1', 'NOKIND']) {
    const r = layerOfPoint(no, k);
    assert.equal(r.layer, 'machine', no);
    assert.equal(r.known, false, no);
  }
});

test('ห้ามเดาจากชื่อ — ชื่อขึ้นต้น JIG แต่ไม่อยู่ทะเบียน ≠ jig', () => {
  assert.equal(layerOfPoint('JIG SLIDE-1', buildKindMap([])).layer, 'machine');
});

test('splitPointLayers นับครบ · โหลดทะเบียนไม่ได้ = ทุกจุด unknown', () => {
  const pts = [{ machine_no: 'RB114' }, { machine_no: 'JHYD05-01' }, { machine_no: 'ZZZ' }];
  const s = splitPointLayers(pts, buildKindMap(reg));
  assert.equal(s.machine.length, 2);
  assert.equal(s.jig.length, 1);
  assert.equal(s.unknown.length, 1);
  assert.equal(s.layerOf(pts[1]), 'jig');
  const none = splitPointLayers(pts, null);
  assert.equal(none.unknown.length, 3);
  assert.equal(none.jig.length, 0);
});
