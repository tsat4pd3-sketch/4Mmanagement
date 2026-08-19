import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVsmLive, LIVE_STATUS } from '../vsmLive.js';

/* เวลาอ้างอิง: กะเช้าวันนี้เปิดมาแล้ว 2 ชม. (เกิน LIVE_MIN_ELAPSED 10 นาที) */
const WD = '2026-08-19';
const NOW = new Date(`${WD}T10:00:00`).getTime();

const boxes = [
  { key: 'M1#1', matNo: 'M1', line: 'HDF1' },
  { key: 'F1#1', matNo: 'F1', line: 'LASER-345' },
  { key: 'F1#2', matNo: 'F1', line: 'Line 60' },     // ไลน์ไม่เปิดกะวันนี้
  { key: 'X#1', matNo: 'X', line: null },            // routing ไม่ระบุไลน์
];
const lines = [
  { name: 'HDF1', flow_mode: 'one_piece_flow', parallel_stations: null },
  { name: 'LASER-345', flow_mode: 'one_piece_flow', parallel_stations: 3 },
  { name: 'Line 60' },
];
const sessions = [
  { id: 's1', line_name: 'HDF1', work_date: WD, shift: 'day', shift_min: 570, start_time: '08:00', status: 'open', oee: null },
  { id: 's2', line_name: 'LASER-345', work_date: WD, shift: 'day', shift_min: 570, start_time: '08:00', status: 'open', oee: null },
  { id: 's3', line_name: 'LASER-345', work_date: WD, shift: 'night', shift_min: 570, start_time: '20:00', status: 'closed', oee: 80 },
];
const orders = [
  // HDF1: ใบเปิดกรอกสะสม 100 + ใบปิด 50 (qty_ok) → produced 150 · เป้า 200+50
  { session_id: 's1', mat_no: 'M1', status: 'open', qty: 200, qty_target: 200, qty_actual: 100, qty_ok: null },
  { session_id: 's1', mat_no: 'M1', status: 'confirmed', qty: 50, qty_target: null, qty_actual: null, qty_ok: 50 },
  // LASER-345: F1 วิ่งอยู่ (CT มีใน ctMap)
  { session_id: 's2', mat_no: 'F1', status: 'open', qty: 300, qty_target: 300, qty_actual: 120, qty_ok: null },
];
const downtimes = [
  // HDF1: เปิดค้าง "นอกแผน" 30 นาที → Andon down
  { session_id: 's1', machine_no: 'HDF-01', description: 'ปั๊มลมรั่ว', started_at: new Date(NOW - 30 * 60000).toISOString(), ended_at: null, duration_min: null, dr_downtime_types: { name_th: 'เครื่องเสีย', category: 'unplanned' } },
  // LASER-345: เปิดค้างแบบ "ตามแผน" → ห้ามเป็น down (แสดงสงบ)
  { session_id: 's2', machine_no: null, description: 'นับสต๊อก', started_at: new Date(NOW - 60 * 60000).toISOString(), ended_at: null, duration_min: null, dr_downtime_types: { name_th: 'ไม่มีแผนผลิต', category: 'planned' } },
];
const defects = [
  { session_id: 's2', qty_ng: 5, qty_suspect: 1, is_trial: false, dr_defect_types: { excl_from_q: false } },
  { session_id: 's2', qty_ng: 99, qty_suspect: 0, is_trial: true, dr_defect_types: { excl_from_q: false } },  // งานทดลอง — ไม่เข้า %Q
];
const ctMap = { M1: 60, F1: 30 };

const lv = buildVsmLive({ boxes, sessions, orders, downtimes, defects, ctMap, lines, nowMs: NOW });

test('สถานะต่อกล่อง: down / run / idle / unknown', () => {
  assert.equal(lv.byKey['M1#1'].status, 'down');          // DT นอกแผนค้าง
  assert.equal(lv.byKey['F1#1'].status, 'run');           // planned ค้างไม่ทำให้ down
  assert.equal(lv.byKey['F1#2'].status, 'idle');
  assert.equal(lv.byKey['X#1'].status, 'unknown');
  assert.ok(lv.byKey['X#1'].reason);
  assert.ok(LIVE_STATUS[lv.byKey['M1#1'].status]);
});

test('planned เปิดค้าง = แสดงแยกแบบสงบ ไม่เข้า alarms (ห้ามซ่อน)', () => {
  assert.equal(lv.byKey['F1#1'].alarms.length, 0);
  assert.equal(lv.byKey['F1#1'].plannedOpen.length, 1);
  assert.equal(lv.summary.plannedOpen, 1);
  assert.equal(lv.summary.down, 1);
  assert.equal(lv.summary.alarms[0].line, 'hdf1');
  assert.ok(lv.summary.alarms[0].openMin >= 29 && lv.summary.alarms[0].openMin <= 31);
});

test('ยอดผลิตวันนี้ต่อกล่อง = สูตรบังคับ confirmed?(qty_ok??qty):(qty_actual??0)', () => {
  assert.equal(lv.byKey['M1#1'].produced, 150);
  assert.equal(lv.byKey['M1#1'].target, 250);
  assert.equal(lv.byKey['M1#1'].orderCount, 2);
  assert.equal(lv.byKey['F1#1'].produced, 120);
});

test('OEE สดมาจาก computeLiveOee — NG ไม่รวมงานทดลอง (กฎ %Q)', () => {
  const live = lv.byKey['F1#1'].live;
  assert.ok(live && live.oee != null);
  // Q = 120/(120+6) — งานทดลอง 99 ชิ้นต้องไม่ถูกนับ
  assert.equal(live.Q, Math.round((120 / 126) * 1000) / 10);
});

test('OEE กะปิดแล้ววันนี้ = ค่า stamp (wavg) · ไลน์ที่ไม่มีกะปิด = null', () => {
  assert.equal(lv.byKey['F1#1'].closedOee, 80);
  assert.equal(lv.byKey['M1#1'].closedOee, null);
});

test('กะเพิ่งเปิด <10 นาที → live เป็น null (ประเมินไม่ได้ ห้ามเป็น 0)', () => {
  const early = buildVsmLive({
    boxes: [{ key: 'M1#1', matNo: 'M1', line: 'HDF1' }],
    sessions: [{ id: 's1', line_name: 'HDF1', work_date: WD, shift: 'day', shift_min: 570, start_time: '08:00', status: 'open' }],
    orders: [], downtimes: [], defects: [], ctMap, lines,
    nowMs: new Date(`${WD}T08:05:00`).getTime(),
  });
  assert.equal(early.byKey['M1#1'].status, 'run');
  assert.equal(early.byKey['M1#1'].live, null);
});

test('ไลน์เดียวโผล่หลายขั้น → สถานะไลน์ก้อนเดียวกัน + summary ไม่นับซ้ำ', () => {
  const two = buildVsmLive({
    boxes: [
      { key: 'A#1', matNo: 'A', line: 'HDF1' },
      { key: 'A#2', matNo: 'A', line: 'HDF1' },
    ],
    sessions, orders, downtimes, defects, ctMap, lines, nowMs: NOW,
  });
  assert.equal(two.byKey['A#1'].status, two.byKey['A#2'].status);
  assert.equal(two.summary.down, 1);
});
