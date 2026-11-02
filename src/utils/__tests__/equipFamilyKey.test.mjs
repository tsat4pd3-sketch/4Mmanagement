/* ตัวตนของเครื่อง = เลขเครื่อง + "สายไลน์" (2026-10-30 · คำสั่ง user)
   user: "conveyor ที่ 306 มันก็คนละตัวกับ conveyor 297 มันแยกส่วนงาน แยกไลน์ แยกแผนก
          ต้องดูผังองค์กรด้วย มันต้องลิ้งกันมั้ย"
   วัดจริง 180 วัน: ชื่อซ้ำข้ามไลน์ 21 คีย์ → ผูก "สาย" แล้วเหลือชนจริง 4 คีย์ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineFamilyKey, scopeKeyByFamily, machineKey } from '../machineNo.js';
import { machineReliability } from '../mtnMetrics.js';

const FAM = {
  'LWR BAR': ['LWR BAR', 'Laser LWR', 'Assy  LWR'],
  'Laser LWR': ['LWR BAR', 'Laser LWR', 'Assy  LWR'],
  'Assy  LWR': ['LWR BAR', 'Laser LWR', 'Assy  LWR'],
  'HYDROFORM': ['HYDROFORM', 'LASER-345'],
  'LASER-345': ['HYDROFORM', 'LASER-345'],
};

test('สายเดียวกันได้คีย์สายเดียวกัน ไม่ว่าลำดับชื่อจะสลับ', () => {
  assert.equal(lineFamilyKey(['LWR BAR', 'Laser LWR']), lineFamilyKey(['Laser LWR', 'LWR BAR']));
  assert.notEqual(lineFamilyKey(FAM['LWR BAR']), lineFamilyKey(FAM.HYDROFORM));
  assert.equal(lineFamilyKey([]), '');
  assert.equal(lineFamilyKey(null), '');
});

test('🔴 ไม่รู้สาย = คีย์เดิม ห้ามเดา', () => {
  assert.equal(scopeKeyByFamily('CONVEYOR', ''), 'CONVEYOR');
  assert.equal(scopeKeyByFamily('CONVEYOR', null), 'CONVEYOR');
  assert.equal(scopeKeyByFamily('', 'X'), '');
});

test('🔴 ห้าม normalize ซ้ำ — คีย์ที่ส่งเข้ามาต้องผ่านออกไปเหมือนเดิม', () => {
  // mtnMetrics เก็บศูนย์นำหน้า (LS04) · machineKey ตัดทิ้ง (LS4) — ไฟล์นี้ต้องไม่ไปยุ่ง
  assert.ok(scopeKeyByFamily('LS04', 'F').endsWith('LS04'));
  assert.notEqual(machineKey('LS-04'), 'LS04');   // ยืนยันว่า 2 ตัวนี้ต่างกันจริง
});

/* ── ของจริง: CONVEYOR ข้ามสาย ต้องแยกแถว · ข้ามไลน์ในสายเดียวกัน ต้องรวมแถว ── */
const sess = (id, line) => ({ id, line_name: line, work_date: '2026-10-01', shift: 'day',
  start_time: '08:00:00', shift_min: 570, status: 'closed' });
const dt = (id, sid, no, min) => ({ id, session_id: sid, machine_no: no, duration_min: min,
  started_at: '2026-10-01T01:00:00Z', ended_at: '2026-10-01T01:30:00Z' });

const run = (rows, sessions) => machineReliability({
  downtimes: rows, machines: [], sessions,
  lineFamilyOf: (ln) => FAM[ln] || [ln],
  sessionLineOf: (sid) => sessions.find(s => s.id === sid)?.line_name || '',
});

test('CONVEYOR คนละสาย (HYDROFORM vs LWR BAR) = คนละเครื่อง ต้องแยกแถว', () => {
  const sessions = [sess('s1', 'LASER-345'), sess('s2', 'Assy  LWR')];
  const r = run([dt('d1', 's1', 'CONVEYOR', 30), dt('d2', 's2', 'CONVEYOR', 30)], sessions);
  const conv = r.rows.filter(x => String(x.machineNo).toUpperCase() === 'CONVEYOR');
  assert.equal(conv.length, 2, 'CONVEYOR 2 สาย ต้องเป็น 2 แถว');
  assert.deepEqual(conv.map(x => x.stops).sort(), [1, 1]);
});

test('LWR306 ข้ามไลน์แต่สายเดียวกัน = เครื่องเดียวกัน ต้องรวมแถว', () => {
  const sessions = [sess('s1', 'Assy  LWR'), sess('s2', 'Laser LWR'), sess('s3', 'LWR BAR')];
  const r = run([dt('d1', 's1', 'LWR306', 10), dt('d2', 's2', 'LWR306', 10), dt('d3', 's3', 'LWR306', 10)], sessions);
  const hit = r.rows.filter(x => String(x.machineNo).toUpperCase() === 'LWR306');
  assert.equal(hit.length, 1, 'สายเดียวกันต้องรวมเป็นแถวเดียว');
  assert.equal(hit[0].stops, 3);
});

test('ไม่ส่ง lineFamilyOf = พฤติกรรมเดิมเป๊ะ (รวมเป็นแถวเดียว)', () => {
  const sessions = [sess('s1', 'LASER-345'), sess('s2', 'Assy  LWR')];
  const r = machineReliability({ downtimes: [dt('d1', 's1', 'CONVEYOR', 30), dt('d2', 's2', 'CONVEYOR', 30)],
    machines: [], sessions });
  assert.equal(r.rows.filter(x => String(x.machineNo).toUpperCase() === 'CONVEYOR').length, 1);
});
