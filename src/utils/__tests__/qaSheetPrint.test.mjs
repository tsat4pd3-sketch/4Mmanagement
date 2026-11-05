/* 🖨️ ใบพิมพ์ QA — แถวของใบต้องครบทุกจุดในมาตรฐาน (จุดที่ยังไม่ตรวจห้ามหาย) · 05/11 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQaPrintRows, pieceCell } from '../qaPrintRows.js';

test('จุดที่ยังไม่ตรวจต้องอยู่บนใบ + นับ ตรวจแล้ว X/Y ตรง', () => {
  const items = [{ id: 'a', balloon_no: 2, characteristic: 'B', item_type: 'variable', sample_size: 3 },
                 { id: 'b', balloon_no: 1, characteristic: 'A', item_type: 'attribute' }];
  const results = [{ item_id: 'b', judgement: 'ng', values_json: ['ok', 'ng'], qty_checked: 2, qty_ng: 1 },
                   { item_id: 'gone', balloon_no: 9, characteristic: 'Z', item_type: 'attribute', judgement: 'ok', values_json: ['ok'] }];
  const r = buildQaPrintRows({ items, results });
  assert.deepEqual(r.rows.map(x => x.balloon), [1, 2, 9], 'เรียงตาม balloon · จุดที่ปิดใช้แล้วต่อท้าย');
  assert.equal(r.totalN, 3); assert.equal(r.checkedN, 2); assert.equal(r.ngN, 1);
  assert.equal(r.rows[1].checked, false, 'จุดที่ไม่มีผล = ยังไม่ตรวจ');
  assert.equal(r.rows[2].retired, true);
  assert.equal(r.pieceCols, 3, 'คอลัมน์ชิ้น = max(ค่าที่มี, sample_size)');
});

test('pieceCell — ว่างคือว่าง ไม่ใช่ 0', () => {
  assert.equal(pieceCell('variable', null), '');
  assert.equal(pieceCell('variable', 0), '0');
  assert.equal(pieceCell('attribute', 'ng'), 'NG');
  assert.equal(pieceCell('attribute', 'na'), '–');
});
