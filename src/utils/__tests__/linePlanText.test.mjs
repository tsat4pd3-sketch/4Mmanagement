import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planActionText, planConfirmText } from '../linePlanText.js';
import { planLineRequest } from '../packRound.js';

test('popup บอกหน่วย (kg/ชิ้น) + ของหน้าไลน์ + สะสมอีกเท่าไหร่ถึงจะแจ้ง', () => {
  const coil = { mat_no: '50027079', part_name: 'WSS 1.4X187XC', uom: 'KG', ...planLineRequest({ need: 888, onHand: 100, coil: true }) };
  const wait = { mat_no: '30045438', uom: null, ...planLineRequest({ need: 300, onHand: 50, pkg: 900 }) };
  const { text, sendCount } = planConfirmText([wait, coil], { title: 'เปิดใบผลิต', focus: ['50027079'] });
  assert.equal(sendCount, 1);
  assert.match(text, /ต้องใช้ 888 kg · หน้าไลน์มี 100 kg · ขาด 788 kg/);
  assert.match(text, /แจ้งสโตร์ 788 kg/);
  assert.match(text, /สะสมอีก 650 ชิ้น ให้ครบ 1 กล่อง \(900 ชิ้น\)/);
  assert.ok(text.indexOf('50027079') < text.indexOf('30045438'), 'focus ขึ้นก่อน');
  assert.match(planActionText({ action: 'no_pkg' }), /packing std/);
  assert.match(planConfirmText([wait]).text, /ยังไม่มีรายการที่ต้องแจ้งสโตร์/);
});
