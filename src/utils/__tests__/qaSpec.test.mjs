/**
 * เทส src/utils/qaSpec.js — สเปคจุดตรวจจุดเดียว (label + ตัดสิน อ่านค่าชุดเดียวกัน)
 *
 * เคสจริง 2026-09-07: spec_text "5" แต่ limit 4–6 → จอต้องโชว์ช่วงที่ใช้ตัดสิน ไม่ใช่ข้อความอย่างเดียว
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { specLabel, limitRange, judgeVariable } from '../qaSpec.js';

const TEST_ITEM = { item_type: 'variable', spec_text: '5', nominal: 5, lsl: 4, usl: 6, unit: 'mm' };

test('variable ที่ตั้ง limit → label โชว์ช่วงที่ใช้ตัดสิน ไม่ถูก spec_text บัง', () => {
  assert.equal(specLabel(TEST_ITEM), '5 (4 – 6) mm');
  assert.equal(specLabel({ item_type: 'variable', lsl: 4, usl: 6 }), '4 – 6');
  assert.equal(specLabel({ item_type: 'variable', nominal: 12.5, unit: 'mm' }), '12.5 mm');
  assert.equal(specLabel({ item_type: 'variable', usl: 0.3, unit: 'mm', spec_text: '0 ≤ 0.3' }), '≤ 0.3 mm');
});

test('รับค่า string จาก input ในฟอร์ม setup ได้ (พรีวิวก่อนบันทึก)', () => {
  assert.equal(specLabel({ item_type: 'variable', nominal: '5', lsl: '4', usl: '6', unit: 'mm' }), '5 (4 – 6) mm');
  assert.equal(specLabel({ item_type: 'variable', nominal: '', lsl: '', usl: '', spec_text: '5 ± 1.5', unit: 'mm' }), '5 ± 1.5 mm');
});

test('ไม่มี limit → ใช้ spec_text · ไม่มีอีก → attribute GO/NOGO · variable —', () => {
  assert.equal(specLabel({ item_type: 'attribute', spec_text: 'ไม่มีครีบ' }), 'ไม่มีครีบ');
  assert.equal(specLabel({ item_type: 'attribute' }), 'GO / NOGO');
  assert.equal(specLabel({ item_type: 'variable' }), '—');
  assert.equal(specLabel(null), '—');
});

test('limitRange: สองข้าง / ข้างเดียว / ไม่มี', () => {
  assert.equal(limitRange({ lsl: 4, usl: 6 }), '4 – 6');
  assert.equal(limitRange({ lsl: 4 }), '≥ 4');
  assert.equal(limitRange({ usl: 6 }), '≤ 6');
  assert.equal(limitRange({}), null);
});

test('judgeVariable อ่าน limit ชุดเดียวกับ label — 6.1 ตกที่ USL 6 · ขอบ 4/6 ผ่าน', () => {
  assert.equal(judgeVariable(TEST_ITEM, ['5', '4', '4', '5.5', '6.1']), 'ng');
  assert.equal(judgeVariable(TEST_ITEM, ['4', '6', '5']), 'ok');
  assert.equal(judgeVariable(TEST_ITEM, ['', '']), null);          // ยังไม่กรอก
  assert.equal(judgeVariable(TEST_ITEM, ['abc']), null);           // ไม่ใช่ตัวเลข
  assert.equal(judgeVariable({ item_type: 'variable' }, ['5']), null); // ไม่มี limit = ตัดสินเองไม่ได้
  assert.equal(judgeVariable({ usl: 6 }, ['7']), 'ng');
});
