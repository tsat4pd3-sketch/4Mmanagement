// 📏 กฎหน่วยนับ (utils/uom.js · 2026-11-05) — EA = pcs = PC ตามที่ user ตัดสิน
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUomIndex, normUom, isKnownUom, unknownUoms, uomOptions, DEFAULT_UOM, DEFAULT_UOMS } from '../uom.js';

test('normUom — EA / pcs / Pcs / each แม็ปเข้า PC (ทะเบียนตั้งต้น)', () => {
  for (const v of ['EA', 'ea', 'pcs', 'Pcs', ' PCS ', 'each', 'PC', 'pc']) assert.equal(normUom(v), 'PC', v);
  assert.equal(normUom('kg'), 'KG');
  assert.equal(DEFAULT_UOM, 'PC');
});

test('normUom — ว่าง = "" · ไม่รู้จัก = ตัวพิมพ์ใหญ่ของค่าเดิม (ห้ามเดา ห้ามทิ้ง)', () => {
  assert.equal(normUom(''), '');
  assert.equal(normUom(null), '');
  assert.equal(normUom('ลิตร'), 'ลิตร');
  assert.equal(normUom('drum'), 'DRUM');
  assert.equal(isKnownUom('drum'), false);
  assert.equal(isKnownUom(''), true);
});

test('buildUomIndex — ใช้ทะเบียนจริง · alias ใหม่แม็ปได้ · แถวปิดใช้ไม่นับ · alias ห้ามทับ code', () => {
  const idx = buildUomIndex([
    { code: 'PC', aliases: ['EA'] },
    { code: 'L', name: 'ลิตร', aliases: ['ลิตร', 'LTR'] },
    { code: 'DRUM', is_active: false },
    { code: 'EA', aliases: [] },          // code ชนกับ alias ของ PC — code ชนะ
  ]);
  assert.equal(normUom('ltr', idx), 'L');
  assert.equal(normUom('ลิตร', idx), 'L');
  assert.equal(isKnownUom('DRUM', idx), false);
  assert.equal(normUom('EA', idx), 'EA');
  assert.deepEqual(unknownUoms(['pc', 'drum', 'Drum', ''], idx), ['DRUM']);
});

test('buildUomIndex — ทะเบียนว่าง/โหลดไม่ได้ = ใช้ DEFAULT_UOMS (EA→PC ยังทำงาน)', () => {
  assert.equal(normUom('EA', buildUomIndex([])), 'PC');
  assert.equal(normUom('EA', buildUomIndex(undefined)), 'PC');
  assert.equal(buildUomIndex([]).codes.length, DEFAULT_UOMS.length);
});

test('uomOptions — ค่าเดิมนอกทะเบียนขึ้นเป็นตัวเลือก "ค่าเดิม" อันแรก (ห้ามให้ช่องขึ้นตัวแรกแทน)', () => {
  const idx = buildUomIndex([]);
  assert.equal(uomOptions(idx, 'PC').some(o => o.legacy), false);
  const o = uomOptions(idx, 'drum');
  assert.equal(o[0].value, 'drum');
  assert.equal(o[0].legacy, true);
  assert.equal(o.length, DEFAULT_UOMS.length + 1);
});
