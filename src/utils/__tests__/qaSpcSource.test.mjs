import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sheetResultsToRows, itemAsChar, itemLabel, matchCharToItem } from '../qaSpcSource.js'

const sh = (work_date, shift, round_no) => ({ work_date, shift, round_no, inspector_name: 'QA' })

test('sheetResultsToRows: 1 ค่า = 1 จุด · เรียง วัน→กะ(เช้าก่อนดึก)→รอบ→ชิ้น', () => {
  const rows = sheetResultsToRows([
    { id: 'c', values_json: [3], qa_inspection_sheets: sh('2026-11-02', 'day', 1) },
    { id: 'b', values_json: [2], qa_inspection_sheets: sh('2026-11-01', 'night', 1) },
    { id: 'a', values_json: [1, 1.5], qa_inspection_sheets: sh('2026-11-01', 'day', 2) },
    { id: 'z', values_json: [0.5], qa_inspection_sheets: sh('2026-11-01', 'day', 1) },
  ])
  assert.deepEqual(rows.map(r => r.readings[0]), [0.5, 1, 1.5, 2, 3])
  assert.equal(rows[1].piece_no, 1); assert.equal(rows[2].piece_no, 2)
})

test('sheetResultsToRows: ค่าว่าง/ข้อความ/จุดที่ข้าม ไม่ลงกราฟ · ห้ามเป็น 0', () => {
  const rows = sheetResultsToRows([
    { id: 'a', values_json: ['', null, 'x', '7.5'], qa_inspection_sheets: sh('2026-11-01', 'day', 1) },
    { id: 'b', values_json: [9], judgement: 'na', qa_inspection_sheets: sh('2026-11-01', 'day', 1) },
    { id: 'c', values_json: null, qa_inspection_sheets: sh('2026-11-01', 'day', 1) },
  ])
  assert.deepEqual(rows.map(r => r.readings), [[7.5]])
  assert.equal(rows[0].piece_no, 4)
})

test('itemAsChar: n=1 · spec ข้อความเป็นตัวเลข · ว่าง = null', () => {
  const c = itemAsChar({ id: 'i1', characteristic: 'ระยะรู', unit: 'mm', lsl: '9.9', usl: '10.1', nominal: '', qa_parts: { part_no: 'P1', line_name: 'L1' } })
  assert.equal(c.subgroup_size, 1); assert.equal(c.lsl, 9.9); assert.equal(c.usl, 10.1); assert.equal(c.nominal, null)
  assert.equal(c.part_no, 'P1'); assert.equal(c.line_name, 'L1')
  assert.equal(itemLabel({ balloon_no: '12', characteristic: 'ระยะรู', unit: 'mm' }), '#12 ระยะรู (mm)')
})

test('matchCharToItem: พาร์ท (ไม่สนช่องว่าง/ขีด) + บอลลูน · ชื่อซ้ำหลายตัว = null ไม่เดา', () => {
  const items = [
    { id: 'a', balloon_no: 'T13', characteristic: 'Thickness', qa_parts: { part_no: 'MB3B-8B222-BF' } },
    { id: 'b', balloon_no: 'T14', characteristic: 'Thickness', qa_parts: { part_no: 'MB3B-8B222-BF' } },
    { id: 'c', balloon_no: 'S3', characteristic: 'Surface', qa_parts: { part_no: 'OTHER' } },
  ]
  assert.equal(matchCharToItem({ part_no: 'MB3B 8B222 BF', control_method: 'Dwg balloon #T13', characteristic: 'Thickness' }, items).id, 'a')
  assert.equal(matchCharToItem({ part_no: 'MB3B 8B222 BF', control_method: '', characteristic: 'Thickness' }, items), null)
  assert.equal(matchCharToItem({ part_no: 'X', control_method: '#T13' }, items), null)
})
