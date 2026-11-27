import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, cellGlyph, ppeToGridCell, validateGrid, emptyGrid, daysOfMonth, isBbsGridMonth, gridTally } from '../checkGrid.js';
import { ppeToMark } from '../bbsMarks.js';

const BBS = {
  type: 'checkgrid', rows: 'line_employees', recordPerm: 'bbs:record', autofill: 'ppe_daily',
  marks: [{ key: 'ok', glyph: '✓', label: 'เหมาะสม' }, { key: 'ng', glyph: '#', label: 'ไม่เหมาะสม', needsItem: true },
          { key: 'fixed', glyph: 'm', label: 'ปรับแก้' }, { key: 'na', glyph: '✗', label: 'ไม่ได้ตรวจ' }],
  items: [{ seq: 1, text: 'หมวก', auto: 'helmet' }, { seq: 2, text: 'รองเท้า', auto: 'boots' }, { seq: 3, text: 'ถุงมือ', auto: 'gloves' }, { seq: 4, text: 'ชุด' }],
};

test('ตัวเติม PPE ของตารางกลาง = กติกาเดียวกับ BBS เดิม (ppeToMark) ทุกกรณี', () => {
  const bySrc = { helmet: 1, boots: 2, gloves: 3 };
  const logs = [null, { is_present: false }, { is_present: true, has_helmet: true, has_boots: true, has_gloves: true },
    { is_present: true, has_helmet: false, has_boots: true, has_gloves: true },
    { is_present: true, has_helmet: false, has_boots: false, has_gloves: true }, { is_present: true }];
  for (const l of logs) {
    const a = ppeToMark(l, bySrc), b = ppeToGridCell(l, BBS);
    if (!a) { assert.equal(b, null); continue; }
    assert.equal(b.mark, a.mark); assert.equal(b.item_seq ?? null, a.agreement_seq ?? null); assert.equal(b.note ?? null, a.note ?? null);
  }
});

test('ไม่มีสัญลักษณ์ปลายทางในฟอร์ม = ไม่เติม (ห้ามเดา)', () => {
  const cfg = { ...BBS, marks: [{ key: 'ok', glyph: '✓', label: 'x' }] };
  assert.equal(ppeToGridCell({ is_present: false }, cfg), null);
  assert.equal(ppeToGridCell({ is_present: true, has_helmet: false }, cfg), null);
});

test('cellGlyph — ต้องระบุข้อ = เลขข้อ · ไม่รู้จัก = ?', () => {
  assert.equal(cellGlyph(BBS, { mark: 'ng', item_seq: 5 }), '5');
  assert.equal(cellGlyph(BBS, { mark: 'ok' }), '✓');
  assert.equal(cellGlyph(BBS, { mark: 'zzz' }), '?');
  assert.equal(cellGlyph(BBS, null), '');
});

test('validateGrid — ผ่านแม่แบบ BBS · ด่านคีย์สิทธิ์/หัวข้อ/ตัวเติม', () => {
  assert.deepEqual(validateGrid(BBS), []);
  assert.ok(validateGrid({ ...BBS, recordPerm: '' }).length);
  assert.ok(validateGrid({ ...BBS, items: [] }).length);
  assert.ok(validateGrid({ ...BBS, items: BBS.items.map(i => ({ ...i, auto: null })) }).length);
  const e = emptyGrid(); assert.ok(validateGrid(e).some(x => x.includes('คีย์สิทธิ์')));
});

test('ตัวช่วยอื่น', () => {
  assert.equal(gridOf({ fields: [{ type: 'text' }, BBS] }), BBS);
  assert.equal(gridOf(null), null);
  assert.equal(daysOfMonth('2026-02'), 28);
  assert.equal(daysOfMonth('x'), 0);
  assert.equal(isBbsGridMonth('2026-11'), false);
  assert.equal(isBbsGridMonth('2026-12'), true);
  assert.equal(isBbsGridMonth('2027-01'), true);
  const t = gridTally(BBS, { a: { mark: 'ok', source: 'ppe' }, b: { mark: 'ng', source: 'manual' } });
  assert.deepEqual([t.by.ok, t.by.ng, t.auto, t.manual], [1, 1, 1, 1]);
});
