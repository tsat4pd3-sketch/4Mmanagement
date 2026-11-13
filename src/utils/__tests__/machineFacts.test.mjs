/* 🏭 ข้อมูลจากเครื่อง — จัดถังกะ ESM · ไม่รู้ ≠ 0 · ช่วงคร่อมกะถูกตัด · เหตุผลแยก master · เสนอเฉพาะตัวตรงเป๊ะ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { factShiftOf, reasonKindOf, summarizeMachineFacts, stopTotals, reasonRows, suggestDowntimeType, tagRows } from '../machineFacts.js';

const bkk = (s) => new Date(`${s}+07:00`).toISOString();

test('กะ ESM จากเวลาไทย: 07:59 = ดึกของเมื่อวาน · 08:00 = เช้า · 20:00 = ดึกของวันนั้น', () => {
  assert.deepEqual([factShiftOf(bkk('2026-11-10T07:59:00')).workDate, factShiftOf(bkk('2026-11-10T07:59:00')).shift], ['2026-11-09', 'night']);
  assert.deepEqual([factShiftOf(bkk('2026-11-10T08:00:00')).workDate, factShiftOf(bkk('2026-11-10T08:00:00')).shift], ['2026-11-10', 'day']);
  assert.deepEqual([factShiftOf(bkk('2026-11-10T20:00:00')).workDate, factShiftOf(bkk('2026-11-10T20:00:00')).shift], ['2026-11-10', 'night']);
  assert.equal(factShiftOf(bkk('2026-11-10T20:00:00')).startMs, Date.parse(bkk('2026-11-10T20:00:00')));
  assert.equal(factShiftOf(null), null);
  assert.equal(factShiftOf('ไม่ใช่เวลา'), null);
});

test('master เหตุผล: ตามแผน/ไม่มีแผน = onplan · FAULT/IDLE = unplan · COMM_LOSS = ไม่รู้ (null)', () => {
  assert.equal(reasonKindOf('planned_stop'), 'onplan');
  assert.equal(reasonKindOf('no_plan'), 'onplan');
  assert.equal(reasonKindOf('fault'), 'unplan');
  assert.equal(reasonKindOf('idle'), 'unplan');
  assert.equal(reasonKindOf('comm_loss'), null);
});

test('สรุปรายเครื่อง×กะ: ชิ้นรวม · ไม่มีแถวนับชิ้น = null ไม่ใช่ 0 · ผูก tag แล้วได้ machineId', () => {
  const rows = summarizeMachineFacts({
    counters: [
      { machine_tag: 'JTSRA03-03', counted_at: bkk('2026-11-10T09:00:00'), delta: 2, ng_delta: 0 },
      { machine_tag: 'JTSRA03-03', counted_at: bkk('2026-11-10T09:01:00'), delta: 1, ng_delta: 1 },
    ],
    states: [{ machine_tag: 'JTSRA03-04', started_at: bkk('2026-11-10T10:00:00'), ended_at: bkk('2026-11-10T10:05:00'), state: 'fault' }],
    tagMap: [{ tag: 'JTSRA03-03', machine_id: 'm3' }],
  });
  const a = rows.find(r => r.tag === 'JTSRA03-03'), b = rows.find(r => r.tag === 'JTSRA03-04');
  assert.equal(a.pieces, 3); assert.equal(a.ng, 1); assert.equal(a.minutes, 2); assert.equal(a.machineId, 'm3');
  assert.equal(b.pieces, null); assert.equal(b.ng, null); assert.equal(b.machineId, null);
  assert.equal(b.stopSec.fault, 300); assert.equal(b.stops, 1);
});

test('ช่วงหยุดคร่อมกะ (19:50→20:10) ถูกตัด 10 นาทีเข้าแต่ละกะ · นับครั้งที่กะเริ่ม', () => {
  const rows = summarizeMachineFacts({ states: [
    { machine_tag: 'X', started_at: bkk('2026-11-10T19:50:00'), ended_at: bkk('2026-11-10T20:10:00'), state: 'no_plan', is_minor: 0 },
  ] });
  const day = rows.find(r => r.shift === 'day'), night = rows.find(r => r.shift === 'night');
  assert.equal(day.stopSec.no_plan, 600); assert.equal(night.stopSec.no_plan, 600);
  assert.equal(day.stops, 1); assert.equal(night.stops, 0);
  assert.equal(stopTotals(day.stopSec).planned, 600);
});

test('สถานะที่ไม่รู้จัก → other (ไม่ทิ้ง) · ไม่มีเวลาจบ+ไม่มี duration = นับครั้ง ไม่เดานาที', () => {
  const rows = summarizeMachineFacts({ states: [
    { machine_tag: 'X', started_at: bkk('2026-11-10T09:00:00'), state: 'weird' },
    { machine_tag: 'X', started_at: bkk('2026-11-10T09:10:00'), duration_sec: 30, state: 'idle', is_minor: 1 },
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stops, 2);
  assert.equal(rows[0].stopSec.other, 0);
  assert.equal(rows[0].stopSec.idle, 30);
  assert.equal(rows[0].minorSec, 30);
});

test('เหตุผล: แยกตาม master (รหัสเดียวกันคนละ master = คนละแถว) · IDLE เข้า unplan · COMM_LOSS นับเป็น unmappable · ที่จับคู่ไว้แต่ไม่เห็นยังโชว์', () => {
  const { rows, unmappable } = reasonRows([
    { state: 'planned_stop', reason_code: 3, reason_text: 'ประชุม', duration_sec: 60 },
    { state: 'fault', reason_code: 3, reason_text: 'Robot alarm', duration_sec: 120 },
    { state: 'fault', reason_code: 3, duration_sec: 30 },
    { state: 'idle', reason_code: 3, duration_sec: 10 },
    { state: 'comm_loss', reason_code: 0 },
  ], [{ reason_kind: 'unplan', reason_code: 9, reason_text: 'JIG', downtime_type_id: 't1' }]);
  assert.equal(unmappable, 1);
  assert.deepEqual(rows.map(r => `${r.kind}:${r.code}:${r.count}`), ['onplan:3:1', 'unplan:3:3', 'unplan:9:0']);
  assert.equal(rows[1].sec, 160);
  assert.equal(rows[1].text, 'Robot alarm');
  assert.equal(rows[2].map.downtime_type_id, 't1');
});

test('เสนอประเภท downtime: ชื่อตรงเป๊ะตัวเดียวเท่านั้น · คล้าย/ซ้ำ = ไม่เสนอ', () => {
  const types = [{ id: 'a', name_th: 'Robot (Alarm/Error)' }, { id: 'b', name_th: 'อบรม' }, { id: 'c', name_th: 'อบรม' }, { id: 'd', name_th: 'รอภาชนะ', is_active: false }];
  assert.equal(suggestDowntimeType('robot (alarm/error)', types)?.id, 'a');
  assert.equal(suggestDowntimeType('Robot Alarm', types), null);
  assert.equal(suggestDowntimeType('อบรม', types), null);
  assert.equal(suggestDowntimeType('รอภาชนะ', types), null);
  assert.equal(suggestDowntimeType('', types), null);
});

test('รหัสเครื่อง: เสนอจากทะเบียนเมื่อ machineKey ตรงตัวเดียว · ผูกแล้วไม่เสนอ', () => {
  const machines = [{ id: 'm3', machine_no: 'JTSRA03-03' }, { id: 'm4', machine_no: 'JTSRA03-04' }];
  const r = tagRows({
    counters: [{ machine_tag: 'jtsra0303', counted_at: bkk('2026-11-10T09:00:00') }],
    states: [{ machine_tag: 'JTSRA03-04', started_at: bkk('2026-11-10T09:00:00') }],
    tagMap: [{ tag: 'JTSRA03-04', machine_id: 'm4' }], machines,
  });
  assert.equal(r.find(x => x.tag === 'jtsra0303').suggest.id, 'm3');
  assert.equal(r.find(x => x.tag === 'JTSRA03-04').suggest, null);
  assert.equal(r.find(x => x.tag === 'JTSRA03-04').map.machine_id, 'm4');
});

test('แถวรายชั่วโมงจาก RPC (hour_at/qty/ng/minutes) รวมได้เหมือนรายนาที · 07:00 = กะดึกเมื่อวาน', () => {
  const rows = summarizeMachineFacts({ counters: [
    { machine_tag: 'X', hour_at: bkk('2026-11-10T07:00:00'), qty: 50, ng: 1, minutes: 58 },
    { machine_tag: 'X', hour_at: bkk('2026-11-10T08:00:00'), qty: 60, ng: 0, minutes: 60 },
  ] });
  const n = rows.find(r => r.shift === 'night'), d = rows.find(r => r.shift === 'day');
  assert.equal(n.workDate, '2026-11-09'); assert.equal(n.pieces, 50); assert.equal(n.minutes, 58); assert.equal(n.ng, 1);
  assert.equal(d.workDate, '2026-11-10'); assert.equal(d.pieces, 60);
});

test('เทียบ Daily Report: DT ของคนแยกรายเครื่อง (เลขเครื่องสะกดต่างได้) · ระดับไลน์แยก · ไม่มีใบผลิต = null ไม่ใช่ 0', async () => {
  const { compareWithSessions } = await import('../machineFacts.js');
  const facts = summarizeMachineFacts({
    counters: [
      { machine_tag: 'T3', hour_at: bkk('2026-11-10T09:00:00'), qty: 40, ng: 0, minutes: 60 },
      { machine_tag: 'T3', hour_at: bkk('2026-11-11T09:00:00'), qty: 10, ng: 0, minutes: 60 },
      { machine_tag: 'T9', hour_at: bkk('2026-11-10T09:00:00'), qty: 5, ng: 0, minutes: 60 },   // ยังไม่ผูก = ไม่เข้าตาราง
    ],
    tagMap: [{ tag: 'T3', machine_id: 'm3' }],
  });
  const rows = compareWithSessions(facts, {
    machines: [{ id: 'm3', machine_no: 'JTSRA03-03', line_name: 'Line D3' }],
    sessions: [
      { id: 's1', work_date: '2026-11-10', shift: 'day', line_name: 'Line D3', status: 'closed', actual_qty: 960 },
      { id: 's2', work_date: '2026-11-10', shift: 'night', line_name: 'Line D3', status: 'closed', actual_qty: 480 },
      { id: 'sx', work_date: '2026-11-10', shift: 'day', line_name: 'Line D9', status: 'closed', actual_qty: 1 },
    ],
    downtimes: [
      { session_id: 's1', duration_min: 15, machine_no: 'jtsra 03-03' },
      { session_id: 's1', duration_min: 5, machine_no: null },
      { session_id: 's1', duration_min: 7, machine_no: 'RB-02' },
    ],
  });
  assert.deepEqual(rows.map(r => `${r.workDate}:${r.shift}`), ['2026-11-11:day', '2026-11-10:night', '2026-11-10:day']);
  const d = rows.find(r => r.workDate === '2026-11-10' && r.shift === 'day');
  assert.equal(d.session.actual_qty, 960);
  assert.equal(d.humanDtMin, 27); assert.equal(d.humanLineDtMin, 5);
  assert.equal(d.machines[0].humanDtMin, 15); assert.equal(d.machines[0].pieces, 40);
  const n = rows.find(r => r.shift === 'night');
  assert.equal(n.machines.length, 0); assert.equal(n.humanDtMin, 0);       // มีใบ ไม่มีข้อมูลเครื่อง = ยังต้องโชว์
  const t = rows.find(r => r.workDate === '2026-11-11');
  assert.equal(t.session, null); assert.equal(t.humanDtMin, null);        // ไม่มีใบผลิต ≠ คนลง 0
  assert.ok(!rows.some(r => r.line === 'Line D9'));
});

test('รหัสเหตุผล 0 = ไม่ได้กด/รีเซ็ต — ไม่อยู่ในรายการจับคู่ แต่นับแยกให้จอบอก (ไม่หายเงียบ)', () => {
  const { rows, noReason } = reasonRows([
    { state: 'no_plan', reason_code: 0, reason_text: 'None', duration_sec: 600 },
    { state: 'idle', reason_code: 0, reason_text: 'None', duration_sec: 20 },
    { state: 'planned_stop', reason_code: 2, reason_text: 'พัก 10 นาที', duration_sec: 600 },
  ]);
  assert.deepEqual(rows.map(r => `${r.kind}:${r.code}`), ['onplan:2']);
  assert.deepEqual(noReason, { count: 2, sec: 620 });
});

test('เครื่องเสียแต่ยังไม่ลง DT: FAULT > 5 นาที · เฉพาะจิ๊กที่มีใบในกะ · ทับ DT แล้ว = ไม่เตือน · รหัส 0 ไม่เสนอประเภท', async () => {
  const { faultGaps } = await import('../machineFacts.js');
  const session = { work_date: '2026-11-13', shift: 'day' };
  const base = {
    tagMap: [{ tag: 'T3', machine_id: 'm3' }, { tag: 'T4', machine_id: 'm4' }, { tag: 'T9', machine_id: null }],
    machines: [{ id: 'm3', machine_no: 'JTSRA03-03' }, { id: 'm4', machine_no: 'JTSRA03-04' }],
    orders: [{ machine_no: 'jtsra 03-03' }],                       // มีใบเฉพาะ 03-03
    reasonMap: [{ reason_kind: 'unplan', reason_code: 7, downtime_type_id: 'dtRobot' }],
    session, nowMs: Date.parse(bkk('2026-11-13T15:00:00')),
  };
  const st = (tag, a, b, extra = {}) => ({ machine_tag: tag, started_at: bkk(`2026-11-13T${a}:00`), ended_at: bkk(`2026-11-13T${b}:00`), state: 'fault', reason_code: 7, ...extra });
  const r = faultGaps({ ...base, downtimes: [
    { machine_no: 'JTSRA03-03', started_at: bkk('2026-11-13T11:02:00'), ended_at: bkk('2026-11-13T11:05:00') },
  ], states: [
    st('T3', '09:00', '09:05'),                                   // = 5 นาที ไม่เกิน → ไม่เตือน
    st('T3', '09:10', '09:16'),                                   // 6 นาที → เตือน + เสนอประเภท
    st('T3', '10:00', '10:20', { reason_code: 0 }),               // รหัส 0 → เตือน แต่ไม่เสนอประเภท
    st('T3', '11:00', '11:10'),                                   // ทับ DT ที่ลงแล้ว → ไม่เตือน
    st('T3', '12:00', '12:30', { state: 'idle' }),                // ไม่ใช่ fault → ไม่เตือน
    st('T4', '09:00', '09:30'),                                   // 03-04 ไม่มีใบในกะ → ไม่เตือน
    st('T9', '09:00', '09:30'),                                   // tag ยังไม่ผูก → ไม่เตือน
    { machine_tag: 'T3', started_at: bkk('2026-11-13T21:00:00'), ended_at: bkk('2026-11-13T21:30:00'), state: 'fault' },   // คนละกะ
  ] });
  assert.deepEqual(r.map(x => `${x.machineNo}@${Math.round(x.min)}:${x.suggestTypeId}`), ['JTSRA03-03@6:dtRobot', 'JTSRA03-03@20:null']);
  // downtime ระดับไลน์ (ไม่ระบุเครื่อง) ครอบไว้ = นับว่าลงแล้ว
  const r2 = faultGaps({ ...base, downtimes: [{ machine_no: null, started_at: bkk('2026-11-13T09:00:00'), duration_min: 30 }], states: [st('T3', '09:10', '09:16')] });
  assert.equal(r2.length, 0);
  assert.deepEqual(faultGaps({ ...base, session: null, states: [st('T3', '09:10', '09:16')] }), []);
});
