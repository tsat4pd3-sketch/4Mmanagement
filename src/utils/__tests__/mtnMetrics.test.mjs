// เทสสูตร Downtime / MTTR / MTBF รายอุปกรณ์ — src/utils/mtnMetrics.js
// pure module (ไม่ import supabase) → import ตรงได้เลย
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normEquipKey, baseEquipKey, buildEquipIndex, resolveEquip,
  dtMinutes, isOpenDt, isPlannedDt, operatingMinutesByLine,
  machineReliability, summarizeByKind, fmtDur,
} from '../mtnMetrics.js';

const planned = { category: 'planned', name_th: 'PM ตามแผน' };
const brk = { category: 'unplanned', name_th: 'เครื่องเสีย' };
const dt = (machine_no, startIso, min, type = brk, extra = {}) => ({
  machine_no, started_at: startIso, duration_min: min,
  ended_at: min == null ? null : new Date(new Date(startIso).getTime() + min * 60000).toISOString(),
  dr_downtime_types: type, ...extra,
});

test('normEquipKey/baseEquipKey: คนกรอก "SP-78" กับ "SP78" ต้องเป็นคีย์เดียวกัน · ไทยไม่หาย', () => {
  assert.equal(normEquipKey(' sp-78 '), 'SP78');
  assert.equal(normEquipKey('SP 78'), 'SP78');
  assert.equal(normEquipKey('เลเซอร์ 08'), 'เลเซอร์08');
  assert.equal(baseEquipKey('SP-78/NF56'), 'SP78');
  assert.equal(normEquipKey(null), '');
});

test('buildEquipIndex: prefix ที่ชนกันต้องถูกทิ้ง — แม่พิมพ์ชื่อเดียวกันต่างแค่ OP ห้ามยุบรวม', () => {
  const ms = [
    { machine_no: 'SP-78/NF56', equipment_kind: 'machine' },
    { machine_no: 'DIE A/LH (OP10)', equipment_kind: 'die' },
    { machine_no: 'DIE A/LH (OP20)', equipment_kind: 'die' },
  ];
  const ix = buildEquipIndex(ms);
  assert.equal(ix.exact.get('SP78NF56').equipment_kind, 'machine');
  assert.equal(ix.prefix.get('SP78').machine_no, 'SP-78/NF56', 'prefix ที่ไม่ชน ใช้ได้');
  assert.equal(ix.prefix.has('DIEA'), false, 'ชนกัน = ต้องไม่มีในดัชนี (ห้ามเดา)');
  assert.equal(ix.collisions, 1);
});

test('resolveEquip: exact ชนะ prefix · ไม่เจอต้องคืน null ห้ามเดา', () => {
  const ix = buildEquipIndex([{ machine_no: 'SP-78/NF56' }, { machine_no: 'SP78' }]);
  assert.equal(resolveEquip('SP78', ix).via, 'exact');
  assert.equal(resolveEquip('sp-78/nf56', ix).via, 'exact');
  const miss = resolveEquip('เลเซอร์08', ix);
  assert.equal(miss.machine, null);
  assert.equal(miss.via, null);
  assert.equal(miss.key, 'เลเซอร์08', 'คีย์ยังต้องมี — เอาไปจัดกลุ่มตัวนอกทะเบียนได้');
});

test('dtMinutes / isOpenDt: ปิดแล้วใช้ duration · ยังเปิดค้าง = ไม่รู้ความยาว', () => {
  assert.equal(dtMinutes({ duration_min: 45 }), 45);
  assert.equal(dtMinutes({ started_at: '2026-09-01T01:00:00Z', ended_at: '2026-09-01T02:30:00Z' }), 90);
  assert.equal(dtMinutes({ started_at: '2026-09-01T01:00:00Z' }), 0);
  assert.equal(isOpenDt({ started_at: '2026-09-01T01:00:00Z' }), true);
  assert.equal(isOpenDt({ duration_min: 5 }), false);
  assert.equal(isPlannedDt({ dr_downtime_types: planned }), true);
  assert.equal(isPlannedDt({ dr_downtime_types: brk }), false);
});

test('operatingMinutesByLine: กะคู่ขนานในกะเดียวกันห้ามบวกซ้ำ (ไม่งั้น MTBF สวยเกินจริง)', () => {
  const { byLine, unknownShifts } = operatingMinutesByLine([
    { line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600 },
    { line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600 },  // คู่ขนาน
    { line_name: 'L60', work_date: '2026-09-02', shift: 'day', shift_min: 480 },
  ]);
  assert.equal(byLine.get('L60'), 1080, '600 + 480 ไม่ใช่ 1680');
  assert.equal(unknownShifts, 0);
});

test('operatingMinutesByLine: shift_min ว่าง → คิดจากเวลาเริ่ม-จบ (ข้ามวันได้) · ไม่ได้เลย = นับใส่ unknown', () => {
  const { byLine, unknownShifts } = operatingMinutesByLine([
    { line_name: 'L1', work_date: 'd1', shift: 'night', shift_min: 0, start_time: '20:00:00', end_time: '08:00:00' },
    { line_name: 'L1', work_date: 'd2', shift: 'day', shift_min: null },
  ]);
  assert.equal(byLine.get('L1'), 720, 'กะดึกข้ามวัน = 12 ชม.');
  assert.equal(unknownShifts, 1, 'กะที่หาชั่วโมงไม่ได้ ต้องนับไว้บอกบนจอ ห้ามเงียบ');
});

test('machineReliability: MTTR/MTBF จาก downtime จริง + แยกชนิดอุปกรณ์', () => {
  const machines = [
    { machine_no: 'SP-78/NF56', machine_name: 'PRESS 78', equipment_kind: 'machine', line_name: 'L60' },
    { machine_no: 'JHYD09-01', machine_name: 'JIG CENTERING', equipment_kind: 'jig', line_name: 'L60' },
  ];
  const sessions = [
    { line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600 },
    { line_name: 'L60', work_date: '2026-09-02', shift: 'day', shift_min: 600 },
  ];
  const downtimes = [
    dt('SP-78', '2026-09-01T02:00:00Z', 30),
    dt('SP78', '2026-09-02T02:00:00Z', 50),            // พิมพ์คนละแบบ = เครื่องเดียวกัน
    dt('SP-78/NF56', '2026-09-02T05:00:00Z', 60, planned),
    dt('JHYD09-01', '2026-09-01T03:00:00Z', 20),
  ];
  const { rows, summary } = machineReliability({ downtimes, machines, sessions });

  // 3 สะกด ("SP-78" · "SP78" · "SP-78/NF56") = เครื่องเดียวกัน ต้องยุบเป็นแถวเดียวตามทะเบียน
  assert.equal(rows.length, 2, 'ต้องได้ 2 แถว (เครื่อง + จิ๊ก) ไม่ใช่แยกตามที่พิมพ์');
  const press = rows.find(r => r.machineNo === 'SP-78/NF56');
  assert.equal(press.key, 'SP78NF56', 'คีย์แถว = เลขในทะเบียน ไม่ใช่ข้อความที่พิมพ์');
  assert.deepEqual(press.rawNos.sort(), ['SP-78', 'SP-78/NF56', 'SP78'], 'เก็บทุกสะกดที่เจอไว้ให้ไปตามแก้ต้นทางได้');
  assert.equal(press.stops, 2, 'หยุดตามแผนไม่นับเป็นเครื่องเสีย');
  assert.equal(press.dtMin, 80);
  assert.equal(press.mttrMin, 40, 'MTTR = 80/2');
  assert.equal(press.plannedStops, 1);
  assert.equal(press.plannedMin, 60);
  assert.equal(press.opMin, 1200);
  assert.equal(press.upMin, 1200 - 80 - 60, 'เวลาเดินจริง = กะ − เสีย − หยุดตามแผน');
  assert.equal(press.mtbfMin, Math.round(1060 / 2));
  assert.equal(press.kind, 'machine');

  const jig = rows.find(r => r.kind === 'jig');
  assert.equal(jig.kind, 'jig');
  assert.equal(jig.mttrMin, 20);
  assert.equal(summary.matched, 2);
  assert.equal(summary.unmatched, 0);
  assert.equal(summary.totalStops, 3);
});

test('machineReliability: เลขที่ไม่อยู่ในทะเบียนต้องไม่หาย — โชว์ต่อ + ติดธง', () => {
  const { rows, summary } = machineReliability({
    downtimes: [dt('เลเซอร์08', '2026-09-01T02:00:00Z', 15), dt('', '2026-09-01T04:00:00Z', 10)],
    machines: [{ machine_no: 'SP-78', equipment_kind: 'machine', line_name: 'L1' }],
    sessions: [],
  });
  const laser = rows.find(r => r.key === 'เลเซอร์08');
  assert.ok(laser, 'ตัวที่จับคู่ไม่ได้ต้องยังอยู่ในตาราง');
  assert.equal(laser.inMaster, false);
  assert.equal(laser.kindKnown, false);
  assert.equal(laser.machineNo, 'เลเซอร์08', 'โชว์ตามที่คนกรอก');
  assert.equal(laser.mttrMin, 15);
  assert.equal(laser.mtbfMin, null, 'ไม่รู้ไลน์ = ไม่รู้เวลาเดินเครื่อง → null ห้ามเป็น 0');
  assert.equal(summary.unmatched, 1);
  assert.equal(summary.noMachineNo, 1, 'downtime ที่ไม่ระบุเครื่อง ต้องนับไว้บอก');
});

test('machineReliability: downtime ที่ยังเปิดค้าง นับเป็นครั้งที่เสีย แต่ห้ามลาก MTTR ลง', () => {
  const { rows } = machineReliability({
    downtimes: [
      dt('M1', '2026-09-01T02:00:00Z', 60),
      { machine_no: 'M1', started_at: '2026-09-02T02:00:00Z', duration_min: null, ended_at: null, dr_downtime_types: brk },
    ],
    machines: [{ machine_no: 'M1', equipment_kind: 'machine', line_name: 'L1' }],
    sessions: [{ line_name: 'L1', work_date: '2026-09-01', shift: 'day', shift_min: 600 }],
  });
  const r = rows[0];
  assert.equal(r.stops, 2);
  assert.equal(r.openStops, 1);
  assert.equal(r.closedStops, 1);
  assert.equal(r.mttrMin, 60, 'เฉลี่ยจากครั้งที่ปิดแล้วเท่านั้น (ไม่ใช่ 30)');
  assert.equal(r.mtbfMin, Math.round((600 - 60) / 2), 'ครั้งที่ยังเปิดค้างก็คือเสียไปแล้ว — นับเป็น failure');
});

test('machineReliability: ไลน์ลูก — กะเปิดที่ไลน์ลูก แต่เครื่องลงทะเบียนไลน์แม่', () => {
  const { rows } = machineReliability({
    downtimes: [dt('M1', '2026-09-01T02:00:00Z', 30)],
    machines: [{ machine_no: 'M1', equipment_kind: 'machine', line_name: 'L60' }],
    sessions: [{ line_name: 'L60/1', work_date: '2026-09-01', shift: 'day', shift_min: 600 }],
    lineFamilyOf: (n) => (n === 'L60' ? ['L60', 'L60/1'] : [n]),
  });
  assert.equal(rows[0].opMin, 600, 'ต้องกางครอบครัวไลน์ ไม่งั้น MTBF หาย');
  assert.equal(rows[0].availPct, +(((600 - 30) / 600) * 100).toFixed(1));
});

test('summarizeByKind: รวมตามชนิด · ตัวนอกทะเบียนแยกกลุ่ม ไม่ปนกับเครื่องจักร', () => {
  const rows = [
    { kind: 'machine', kindKnown: true, stops: 2, closedStops: 2, dtMin: 100, upMin: 900 },
    { kind: 'jig', kindKnown: true, stops: 1, closedStops: 1, dtMin: 20, upMin: 500 },
    { kind: null, kindKnown: false, stops: 3, closedStops: 3, dtMin: 60, upMin: null },
  ];
  const out = summarizeByKind(rows);
  const mc = out.find(o => o.kind === 'machine');
  assert.equal(mc.mttrMin, 50);
  assert.equal(mc.mtbfMin, 450);
  const unk = out.find(o => o.kind === '_unknown');
  assert.equal(unk.equip, 1);
  assert.equal(unk.mtbfMin, null, 'ไม่รู้เวลาเดินเครื่อง = null');
});

test('fmtDur: null = "—" ไม่ใช่ 0', () => {
  assert.equal(fmtDur(null), '—');
  assert.equal(fmtDur(45), '45 น.');
  assert.equal(fmtDur(90), '1 ชม. 30 น.');
  assert.equal(fmtDur(120), '2 ชม.');
  assert.equal(fmtDur(1500), '1 วัน 1 ชม.');
});
