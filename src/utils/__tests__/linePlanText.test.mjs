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

test('📍 popup บอกพื้นที่ SAP ที่คิดรวม + ใบผลิตที่ไม่มี BOM ต้องบอก (ไม่ใช่ "ของพอ")', () => {
  const r = { mat_no: '30043726', uom: null, ...planLineRequest({ need: 300, onHand: 100, pkg: 100 }) };
  const t = planConfirmText([r], { title: 'x', area: { code: 'P412', lines: ['LWR BAR', 'Assy  LWR', 'Laser LWR'] } }).text;
  assert.match(t, /รวมทั้งพื้นที่ P412: LWR BAR · Assy {2}LWR · Laser LWR/);
  assert.match(t, /พื้นที่ P412 มี 100 ชิ้น/);
  const nb = planConfirmText([], { title: 'x', noBom: [{ mat_no: 'BENDING LWR BAR 306', qty: 500 }] }).text;
  assert.match(nb, /ไม่มีลูกใน BOM .*BENDING LWR BAR 306 × 500/);
  assert.match(nb, /ยังไม่ผูกพื้นที่ SAP/);
});

test('🔩 popup บอกใบขั้น OP ที่ยังไม่ผูกว่ากินอะไร', () => {
  const t = planConfirmText([], { title: 'x', opUnset: [{ mat_no: 'BENDING LWR BAR 306', parent: '10105769', parentKids: 12, qty: 500 }] }).text;
  assert.match(t, /ใบขั้น OP 1 ตัวยังไม่ได้ผูกว่ากินอะไร/);
  assert.match(t, /BENDING LWR BAR 306 \(แม่ 10105769 ลูก 12 ตัว\) × 500/);
});
