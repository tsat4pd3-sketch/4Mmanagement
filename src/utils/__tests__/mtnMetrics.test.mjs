// เทสสูตร Downtime / MTTR / MTBF รายอุปกรณ์ — src/utils/mtnMetrics.js
// pure module (ไม่ import supabase) → import ตรงได้เลย
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normEquipKey, baseEquipKey, buildEquipIndex, resolveEquip,
  dtMinutes, isOpenDt, isPlannedDt, operatingMinutesByLine,
  machineReliability, summarizeByKind, viewMetrics, fmtDur,
  repairPhases, poolPhases, poolRowPhases, phaseIssue,
} from '../mtnMetrics.js';

/* นโยบายพักกะเช้าชุดจริง (break_policies ฝั่ง DR — ทุกแถวเป็น process_type 'common') */
const DAY_BREAKS = [
  { shift: 'day', process_type: 'common', start_time: '08:00:00', duration_min: 10 },  // ประชุมแถว
  { shift: 'day', process_type: 'common', start_time: '10:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '11:50:00', duration_min: 50 },  // พักกลางวัน
  { shift: 'day', process_type: 'common', start_time: '15:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '17:10:00', duration_min: 20 },  // 5ส.
  { shift: 'day', process_type: 'common', start_time: '17:30:00', duration_min: 30 },  // เบรค OT (นอกกะ 08:00-17:30)
];

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

/* ── ให้ตรงนิยาม %A ของ Daily Report (audit 2026-09-14) ─────────────────── */

test('operatingMinutesByLine: ต้องหักเวลาพักตามนโยบาย ไม่งั้น uptime เกินจริง 100 นาที/กะ', () => {
  const ses = [{ line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 570, start_time: '08:00:00' }];
  const raw = operatingMinutesByLine(ses);
  assert.equal(raw.byLine.get('L60'), 570, 'ไม่ส่งนโยบายมา = ไม่หัก (พฤติกรรมเดิม)');
  assert.equal(raw.hasBreakPolicy, false, 'จอต้องรู้ว่ายังไม่ได้หักพัก');

  const net = operatingMinutesByLine(ses, { breakPolicies: DAY_BREAKS });
  // 10 + 10 + 50 + 10 + 20 = 100 · เบรค OT 17:30 เริ่มพอดีตอนกะจบ = ไม่ทับ
  assert.equal(net.breakMin, 100);
  assert.equal(net.byLine.get('L60'), 470, 'กะ 08:00-17:30 เดินจริง 470 นาที ไม่ใช่ 570');
  assert.equal(net.hasBreakPolicy, true);
});

test('machineReliability: ไลน์เครื่องขนาน — เก็บทั้งนาทีเต็ม (มุมเครื่อง) และถ่วง 1/N (มุมไลน์)', () => {
  const machines = [{ machine_no: 'LS-1', machine_name: 'เลเซอร์ 1', equipment_kind: 'machine', line_name: 'LASER-789' }];
  const sessions = [{ line_name: 'LASER-789', work_date: '2026-09-01', shift: 'day', shift_min: 600, start_time: '08:00:00' }];
  const downtimes = [
    dt('LS-1', '2026-09-01T02:00:00Z', 30),
    dt('LS-1', '2026-09-01T04:00:00Z', 30),
    dt('LS-1', '2026-09-01T06:00:00Z', 30),
  ];
  const { rows, summary } = machineReliability({
    downtimes, machines, sessions,
    parallelOf: (ln) => (ln === 'LASER-789' ? 3 : 1),   // เลเซอร์ 3 ตัววิ่งขนาน
  });
  const r = rows[0];
  assert.equal(r.parallelN, 3);
  assert.equal(r.dtMin, 90, 'มุมเครื่อง: เครื่องตัวนี้หยุดจริง 90 นาที');
  assert.equal(r.dtMinW, 30, 'มุมไลน์: อีก 2 ตัวยังวิ่ง → ไลน์เสียแค่ 1/3');
  assert.equal(r.mttrMin, 30);
  assert.equal(r.mttrMinW, 10);
  assert.equal(r.upMin, 510);
  assert.equal(r.upMinW, 570);
  assert.equal(r.mtbfMin, 170);
  assert.equal(r.mtbfMinW, 190);
  assert.equal(r.availPct, 85);
  assert.equal(r.availPctW, 95);
  assert.equal(summary.parallelLines, 1, 'จอต้องรู้ว่ามีกี่ตัวที่ตัวเลข 2 ชุดไม่เท่ากัน');
});

test('machineReliability: ไลน์ปกติ (N=1) ตัวเลข 2 ชุดต้องเท่ากันเป๊ะ', () => {
  const machines = [{ machine_no: 'M1', equipment_kind: 'machine', line_name: 'L60' }];
  const sessions = [{ line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600, start_time: '08:00:00' }];
  const { rows } = machineReliability({
    downtimes: [dt('M1', '2026-09-01T02:00:00Z', 60)], machines, sessions,
    parallelOf: () => 1,
  });
  const r = rows[0];
  assert.equal(r.dtMinW, r.dtMin);
  assert.equal(r.mtbfMinW, r.mtbfMin);
  assert.equal(r.availPctW, r.availPct);
});

test('viewMetrics / summarizeByKind: สลับโหมดแล้วต้องหยิบชุดตัวเลขให้ครบทุกช่อง', () => {
  const row = {
    kindKnown: true, kind: 'machine', stops: 3, closedStops: 3,
    dtMin: 90, mttrMin: 30, upMin: 510, mtbfMin: 170, availPct: 85, plannedMin: 60,
    dtMinW: 30, mttrMinW: 10, upMinW: 570, mtbfMinW: 190, availPctW: 95, plannedMinW: 20,
  };
  assert.deepEqual(viewMetrics(row), { dtMin: 90, mttrMin: 30, upMin: 510, mtbfMin: 170, availPct: 85, plannedMin: 60 });
  assert.deepEqual(viewMetrics(row, true), { dtMin: 30, mttrMin: 10, upMin: 570, mtbfMin: 190, availPct: 95, plannedMin: 20 });

  assert.equal(summarizeByKind([row])[0].dtMin, 90);
  assert.equal(summarizeByKind([row])[0].mtbfMin, 170);
  assert.equal(summarizeByKind([row], true)[0].dtMin, 30);
  assert.equal(summarizeByKind([row], true)[0].mtbfMin, 190, 'สรุปตามชนิดต้องเปลี่ยนตามโหมดด้วย');
});

/* ── เครื่องที่ไม่เคยเสีย ต้องนับเข้าตัวตั้งของ MTBF รวม (คำสั่ง user 2026-09-14 "นับด้วยสิ") ── */

const IDLE_SETUP = {
  machines: [
    { machine_no: 'M1', equipment_kind: 'machine', line_name: 'L60' },
    { machine_no: 'M2', equipment_kind: 'machine', line_name: 'L60' },   // ไม่เคยเสีย
    { machine_no: 'D1', equipment_kind: 'die',     line_name: 'L60' },   // แม่พิมพ์ — ห้ามนับ
    { machine_no: 'J1', equipment_kind: 'jig',     line_name: 'L60' },   // จิ๊ก — ห้ามนับ
    { machine_no: 'M9', equipment_kind: 'machine', line_name: 'ไลน์ไม่มีกะ' },
  ],
  sessions: [{ line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600, start_time: '08:00:00' }],
  downtimes: [dt('M1', '2026-09-01T02:00:00Z', 60)],
};

test('เครื่องที่ไม่เคยเสีย: โผล่ในตาราง · MTBF รายตัว = null · ชั่วโมงเดินเข้าตัวตั้งของกลุ่ม', () => {
  const { rows, summary } = machineReliability(IDLE_SETUP);
  const byNo = Object.fromEntries(rows.map(r => [r.machineNo, r]));

  assert.equal(summary.idleCount, 1, 'M2 ตัวเดียว (แม่พิมพ์/จิ๊กไม่นับ · M9 ไม่รู้ชั่วโมงเดิน)');
  assert.ok(byNo.M2, 'เครื่องที่ไม่เคยเสียต้องโผล่');
  assert.equal(byNo.M2.stops, 0);
  assert.equal(byNo.M2.mtbfMin, null, 'เสีย 0 ครั้ง หารไม่ได้ — ห้ามใส่ตัวเลข');
  assert.equal(byNo.M2.upMin, 600);
  assert.equal(byNo.M2.availPct, 100);
  assert.equal(byNo.M2.neverFailed, true);
  assert.equal(byNo.D1, undefined, 'แม่พิมพ์ห้ามนับ — ชั่วโมงเดิน ≠ ชั่วโมงกะของไลน์');
  assert.equal(byNo.J1, undefined, 'จิ๊กก็เหมือนกัน');
  assert.equal(byNo.M9, undefined, 'ไม่รู้ชั่วโมงเดิน = ไม่นับ ห้ามเดา 0');

  // MTBF ของกลุ่ม: M1 เดิน 540 + M2 เดิน 600 = 1,140 ÷ เสีย 1 ครั้ง
  const mach = summarizeByKind(rows).find(k => k.kind === 'machine');
  assert.equal(mach.mtbfMin, 1140);
});

test('เครื่องที่ไม่เคยเสีย: ปิดด้วย includeIdle=false แล้ว MTBF กลุ่มต้องต่ำลง (ยืนยันว่ามีผลจริง)', () => {
  const { rows, summary } = machineReliability({ ...IDLE_SETUP, includeIdle: false });
  assert.equal(summary.idleCount, 0);
  assert.equal(rows.length, 1);
  assert.equal(summarizeByKind(rows).find(k => k.kind === 'machine').mtbfMin, 540, 'นับแค่ตัวที่เสีย = ต่ำกว่าจริง');
});

/* ── ช่วงย่อย: รอช่าง / ซ่อมจริง / กลับมารัน (2026-09-14 · โจทย์ MTTA ของ user) ── */

const iso = (min) => new Date(Date.parse('2026-09-01T08:00:00Z') + min * 60000).toISOString();
const dtPh = (startMin, ackMin, fixMin, endMin, extra = {}) => ({
  machine_no: 'M1', started_at: iso(startMin),
  call_mtn_ack_at: ackMin == null ? null : iso(ackMin),
  fix_at: fixMin == null ? null : iso(fixMin),
  ended_at: endMin == null ? null : iso(endMin),
  duration_min: endMin == null ? null : endMin - startMin,
  dr_downtime_types: brk, ...extra,
});

test('repairPhases: แยก 3 ท่อนได้เมื่อเวลาครบและเรียงถูก', () => {
  const ph = repairPhases(dtPh(0, 20, 50, 60));
  assert.deepEqual(
    { w: ph.waitMin, r: ph.repairMin, s: ph.restartMin, t: ph.totalMin, one: ph.oneShot },
    { w: 20, r: 30, s: 10, t: 60, one: false });
});

test('repairPhases: ขาดเวลาใดเวลาหนึ่ง หรือเวลาไม่เรียง = null (ห้ามเดา)', () => {
  assert.equal(repairPhases(dtPh(0, null, 50, 60)), null, 'ไม่มีเวลารับงาน');
  assert.equal(repairPhases(dtPh(0, 20, null, 60)), null, 'ไม่มีเวลาซ่อมเสร็จ');
  assert.equal(repairPhases(dtPh(0, 20, 50, null)), null, 'ยังไม่ปิด downtime');
  assert.equal(repairPhases(dtPh(0, 50, 20, 60)), null, 'ซ่อมเสร็จก่อนรับงาน = ข้อมูลผิด');
});

test('repairPhases: ซ่อมจริง < 2 นาที = ใบที่กดรวดเดียวตอนปิดงาน (ติดธง oneShot)', () => {
  assert.equal(repairPhases(dtPh(0, 55, 56, 60)).oneShot, true);
  assert.equal(repairPhases(dtPh(0, 30, 45, 60)).oneShot, false);
});

test('poolPhases: ใบกดรวดเดียวต้องไม่ถูกเอามาเฉลี่ย แต่ต้องนับให้เห็น', () => {
  const p = poolPhases([
    repairPhases(dtPh(0, 20, 50, 60)),     // w20 r30 s10
    repairPhases(dtPh(0, 40, 80, 100)),    // w40 r40 s20
    repairPhases(dtPh(0, 58, 59, 60)),     // กดรวดเดียว — ตัดออก
  ]);
  assert.equal(p.n, 2);
  assert.equal(p.oneShot, 1);
  assert.equal(p.mttaMin, 30);
  assert.equal(p.mttrPureMin, 35);
  assert.equal(p.restartMin, 15);
});

test('machineReliability: สรุปช่วงย่อยติดมากับ summary.phases และรายแถว', () => {
  const machines = [{ machine_no: 'M1', equipment_kind: 'machine', line_name: 'L60' }];
  const sessions = [{ line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600, start_time: '08:00:00' }];
  const { rows, summary } = machineReliability({
    machines, sessions, includeIdle: false,
    downtimes: [dtPh(0, 20, 50, 60), dtPh(100, 140, 180, 200), dtPh(300, 358, 359, 360)],
  });
  assert.equal(summary.phases.n, 2);
  assert.equal(summary.phases.oneShot, 1);
  assert.equal(summary.phases.mttaMin, 30);
  assert.equal(rows[0].mttaMin, 30);
  assert.equal(rows[0].mttrPureMin, 35);
  assert.equal(rows[0].phaseOneShot, 1);
  // pool จากแถวต้องได้เท่ากับ pool จาก phases ดิบ
  assert.deepEqual(poolRowPhases(rows), summary.phases);
});

test('machineReliability: ไม่มีใบไหนกดครบจังหวะ = ช่วงย่อยเป็น null ทั้งหมด ห้ามเป็น 0', () => {
  const { rows, summary } = machineReliability({
    machines: [{ machine_no: 'M1', equipment_kind: 'machine', line_name: 'L60' }],
    sessions: [{ line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600, start_time: '08:00:00' }],
    downtimes: [dt('M1', '2026-09-01T02:00:00Z', 60)], includeIdle: false,
  });
  assert.equal(summary.phases.n, 0);
  assert.equal(summary.phases.mttaMin, null);
  assert.equal(rows[0].mttaMin, null);
  assert.equal(rows[0].mttrMin, 60, 'MTTR รวม (Restore) ยังตอบได้ตามปกติ');
});

test('phaseIssue: บอกเหตุผลที่วัดไม่ได้ ไม่ใช่เงียบแล้วขึ้น "—"', () => {
  assert.equal(phaseIssue(dtPh(0, 20, 50, 60)), null, 'ครบ = วัดได้');
  assert.equal(phaseIssue(dtPh(0, null, 50, 60)), 'no_ack');
  assert.equal(phaseIssue(dtPh(0, 20, null, 60)), 'no_fix');
  assert.equal(phaseIssue(dtPh(0, 20, 50, null)), 'open');
  assert.equal(phaseIssue(dtPh(0, 80, 90, 60)), 'after_end', 'รับงานหลังเครื่องกลับมารันแล้ว');
  assert.equal(phaseIssue(dtPh(0, 50, 20, 60)), 'out_of_order');
});

test('machineReliability: summary.phaseGaps นับเหตุผลครบทุกครั้งที่วัดไม่ได้', () => {
  const { summary } = machineReliability({
    machines: [{ machine_no: 'M1', equipment_kind: 'machine', line_name: 'L60' }],
    sessions: [{ line_name: 'L60', work_date: '2026-09-01', shift: 'day', shift_min: 600, start_time: '08:00:00' }],
    downtimes: [dtPh(0, 20, 50, 60), dtPh(100, null, null, 160), dtPh(200, 280, 290, 260)],
    includeIdle: false,
  });
  assert.equal(summary.phases.n, 1);
  assert.equal(summary.phaseGaps.no_ack, 1);
  assert.equal(summary.phaseGaps.after_end, 1, 'เคสที่หน้างานเจอเยอะสุด — ใบ MO ตามหลังเครื่อง');
});
