import test from 'node:test';
import assert from 'node:assert/strict';
import { normText, masterKey, compareToMaster, improvementProposals, newItemProposals, pullRows, applyProposal, suggestMaster, buildSetFromMaster, setMasterSummary } from '../peMaster.js';

test('normText/masterKey — ตรงกับ pe_master_norm ฝั่ง SQL', () => {
  assert.equal(normText('  PROJECTION-WELD  NUT (M6) '), 'projection weld nut m6');
  assert.equal(masterKey('Projection Weld Nut', 'process'), 'projection_weld_nut__process');
  assert.equal(masterKey('เชื่อมนัท', undefined), 'เชื่อมนัท__process');
});

const M = { id: 'm1', master_process_id: 'mp1', failure_mode: 'Missing nut', severity: 8, occurrence: 3, detection: 7, prevention: 'poka-yoke', detection_ctrl: 'visual', version: 2 };
const base = { id: 'i1', master_item_id: 'm1', master_version: 2, failure_mode: 'Missing nut', severity: 8, occurrence: 3, detection: 7, prevention: 'poka-yoke', detection_ctrl: 'visual' };

test('compareToMaster — unlinked / same / behind / better / diverged', () => {
  assert.equal(compareToMaster({ ...base, master_item_id: null }, M).state, 'unlinked');
  assert.equal(compareToMaster(base, M).state, 'same');
  assert.equal(compareToMaster({ ...base, master_version: 1 }, M).state, 'behind');
  const better = { ...base, action_taken: 'เพิ่ม sensor', new_severity: 8, new_occurrence: 2, new_detection: 3 };
  const r = compareToMaster(better, M);
  assert.equal(r.state, 'better'); assert.equal(r.rpnItem, 48); assert.equal(r.rpnMaster, 168);
  // RPN ต่ำกว่าแต่ไม่มี action_taken = แค่ต่าง ไม่ใช่ดีกว่า (ประเมินหลวมได้)
  assert.equal(compareToMaster({ ...base, occurrence: 1 }, M).state, 'diverged');
  assert.equal(compareToMaster({ ...base, prevention: 'อื่น' }, M).state, 'diverged');
});

test('improvementProposals — เฉพาะแถวที่มี action + new S/O/D และ RPN ต่ำกว่า master · ข้ามที่ค้างอยู่', () => {
  const items = [
    { ...base, id: 'a', action_taken: 'เพิ่ม sensor', new_severity: 8, new_occurrence: 2, new_detection: 3 },
    { ...base, id: 'b', action_taken: 'ทำแล้ว', new_severity: 8, new_occurrence: 3, new_detection: 7 },   // เท่าเดิม
    { ...base, id: 'c', new_severity: 8, new_occurrence: 1, new_detection: 1 },                         // ไม่มี action_taken
    { ...base, id: 'd', action_taken: 'x', new_severity: 8, new_occurrence: 1, new_detection: 1 },
  ];
  const out = improvementProposals(items, { m1: M }, { setId: 's1', by: 'PE', pendingSourceIds: new Set(['d']) });
  assert.equal(out.length, 1);
  assert.equal(out[0].source_item_id, 'a'); assert.equal(out[0].rpn_before, 168); assert.equal(out[0].rpn_after, 48);
  assert.equal(out[0].after.occurrence, 2); assert.equal(out[0].after.best_practice, 'เพิ่ม sensor'); assert.equal(out[0].kind, 'improve');
});

test('newItemProposals — failure mode ที่ master ของ OP นั้นยังไม่มี', () => {
  const procs = [{ id: 'p1', master_process_id: 'mp1' }, { id: 'p2', master_process_id: null }];
  const items = [
    { id: 'x', process_id: 'p1', failure_mode: 'Missing NUT' },      // มีแล้ว (normalize เท่ากัน)
    { id: 'y', process_id: 'p1', failure_mode: 'Nut tilted', severity: 5, occurrence: 2, detection: 4 },
    { id: 'z', process_id: 'p2', failure_mode: 'อะไรก็ได้' },         // OP ไม่ผูก master
  ];
  const out = newItemProposals(items, procs, [M], { by: 'PE' });
  assert.equal(out.length, 1); assert.equal(out[0].source_item_id, 'y'); assert.equal(out[0].kind, 'new_item'); assert.equal(out[0].rpn_after, 40);
});

test('pullRows — ข้าม failure mode ที่มีแล้ว · seq ต่อจากเดิม · ถือ master_item_id/version', () => {
  const masters = [{ id: 'm1', seq: 1, failure_mode: 'Missing nut', severity: 8, occurrence: 3, detection: 7, version: 2, best_practice: 'poka-yoke' }, { id: 'm2', seq: 2, failure_mode: 'Nut tilted', version: 1 }, { id: 'm3', seq: 3, failure_mode: 'Old', is_active: false }];
  const { rows, skipped } = pullRows(masters, 'p1', [{ seq: 5, failure_mode: 'missing NUT' }]);
  assert.equal(rows.length, 1); assert.equal(skipped, 2);
  assert.equal(rows[0].seq, 6); assert.equal(rows[0].master_item_id, 'm2'); assert.equal(rows[0].master_version, 1); assert.equal(rows[0].process_id, 'p1');
});

test('applyProposal — version +1 · ไม่ทับด้วยค่าว่าง', () => {
  const next = applyProposal(M, { after: { occurrence: 2, detection: 3, prevention: '', best_practice: 'เพิ่ม sensor' } });
  assert.equal(next.version, 3); assert.equal(next.occurrence, 2); assert.equal(next.detection, 3); assert.equal(next.prevention, 'poka-yoke'); assert.equal(next.best_practice, 'เพิ่ม sensor');
});

test('suggestMaster — ตรง key ก่อน · ไม่ตรงใช้คำร่วม ≥ 0.5', () => {
  const masters = [{ id: 'a', key: 'projection_weld_nut__process', name: 'PROJECTION WELD NUT' }, { id: 'b', key: 'spot_weld__process', name: 'SPOT WELD' }];
  assert.equal(suggestMaster('projection weld nut', 'process', masters).exact, true);
  const s = suggestMaster('PROJECTION WELD NUT M6 (2 PCS)', 'process', masters);
  assert.equal(s.master?.id, 'a'); assert.equal(s.exact, false);
  assert.equal(suggestMaster('LASER CUT', 'process', masters).master, null);
});

test('buildSetFromMaster — op_no 10,20 · แถว FMEA ผูก _procKey', () => {
  const sel = [{ id: 'a', name: 'DRAW', kind: 'process' }, { id: 'b', name: 'TRIM', kind: 'process', op_no: '25' }];
  const { procs, items } = buildSetFromMaster(sel, { a: [{ id: 'm1', failure_mode: 'Wrinkle' }], b: [] }, { setId: 's' });
  assert.deepEqual(procs.map(p => p.op_no), ['10', '25']);
  assert.equal(items.length, 1); assert.equal(items[0]._procKey, 'a'); assert.equal(items[0].master_item_id, 'm1');
});

test('setMasterSummary', () => {
  const s = setMasterSummary([base, { ...base, master_item_id: null }], { m1: M });
  assert.equal(s.same, 1); assert.equal(s.unlinked, 1);
});
