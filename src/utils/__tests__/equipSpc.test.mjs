import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpcCp, readingsOf, subgroupSizeOf, equipSpc, shimRows, SPC_MIN_POINTS } from '../equipSpc.js';
import { computeSPC } from '../spcCalc.js';

test('ข้อที่ขึ้น SPC = ตัวเลข + ไม่ถูกปิด', () => {
  assert.equal(isSpcCp({ type: 'measure' }), true);
  assert.equal(isSpcCp({ type: 'variable', spc_enabled: false }), false);
  assert.equal(isSpcCp({ type: 'attribute' }), false);
});

test('ค่าที่วัด: variable = 1–3 ค่าที่กรอก · measure = ค่าเดียว · ว่าง = []', () => {
  assert.deepEqual(readingsOf({ type: 'variable' }, { value_1: 1.1, value_2: '1.2', value_3: null }), [1.1, 1.2]);
  assert.deepEqual(readingsOf({ type: 'measure' }, { value_numeric: 0.3 }), [0.3]);
  assert.deepEqual(readingsOf({ type: 'measure' }, { value_1: 5 }), [5]);
  assert.deepEqual(readingsOf({ type: 'measure' }, {}), []);
});

test('subgroup = ขนาดที่พบบ่อยสุด', () => {
  assert.equal(subgroupSizeOf([{ readings: [1, 2, 3] }, { readings: [1, 2, 3] }, { readings: [1] }]), 3);
  assert.equal(subgroupSizeOf([]), 1);
});

const cp = { type: 'measure', lsl: 0.25, usl: 0.35 };
const mk = (vals) => vals.map((v, i) => ({ readings: [v], work_date: `2026-11-${String(i + 1).padStart(2, '0')}` }));

test('ต่ำกว่า 20 จุด = ชั่วคราว ไม่นับหลุดการควบคุม · ครบ 20 = ตัดสิน', () => {
  const few = equipSpc(cp, mk([0.30, 0.31, 0.29, 0.5]));
  assert.equal(few.provisional, true); assert.equal(few.oocN, 0); assert.equal(few.nPoints, 4);
  const vals = Array.from({ length: SPC_MIN_POINTS }, (_, i) => 0.30 + ((i % 3) - 1) * 0.005);
  vals[19] = 0.6;   // หลุดเส้น
  const ok = equipSpc(cp, mk(vals));
  assert.equal(ok.provisional, false); assert.ok(ok.oocN >= 1); assert.equal(ok.subgroup, 1);
  assert.equal(equipSpc(cp, []), null);
});

test('สูตรเดียวกับ QA (computeSPC) — I-MR', () => {
  const rows = mk([0.30, 0.32, 0.28, 0.31]);
  const a = equipSpc(cp, rows), b = computeSPC(rows, { subgroup_size: 1, lsl: 0.25, usl: 0.35 });
  assert.equal(a.uclX, b.uclX); assert.equal(a.cpk, b.cpk);
});

test('ค่าชิม → แถว I-MR เรียงเวลา · ค่าว่างตัดทิ้ง', () => {
  const r = shimRows([{ shim_after_mm: 0.5, event_at: '2026-11-02T01:00:00Z' }, { shim_after_mm: null, event_at: 'x' }, { shim_after_mm: '0.4', event_at: '2026-11-01T01:00:00Z' }]);
  assert.deepEqual(r.map(x => x.readings[0]), [0.4, 0.5]);
});
