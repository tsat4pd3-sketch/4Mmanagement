/* ── กะของพนักงานตามตารางกะ — โดยเฉพาะ "ไลน์ลูกตกทอดจากไลน์แม่" (2026-10-13) ──
   เคสจริงที่ทำให้ต้องมีไฟล์นี้ (feedback หน้างาน 13/10 · PD2):
     `Line D2 - LWR BAR` + `Line D3 - STAMPED` ถูกสร้าง 09/10 **หลัง** ตารางกะถูกเติมล่วงหน้าถึง 03/01/2027
     ⇒ ไลน์ 2 ตัวนี้ไม่มีแถว `shift_schedules` เลยสักแถว (พี่น้องมี 126-217 แถว)
     จอตั้งค่า (`ShiftOrganize.effTeam`) โชว์ "Team A" เพราะ**ตกทอดจากไลน์แม่** ⇒ หัวหน้าเห็นว่า "เซ็ทหมดแล้ว"
     แต่ `scheduleTeamFor` อ่าน `byLine[line_id]` ตรงตัว ⇒ null ⇒ **พนักงาน 18 คนไม่มีกะ**
     (หายจากใบเช็คชื่อตอนกรอง "เฉพาะกะนี้" · กำลังคนไลน์นับเป็น 0 · ผังจัดกำลังคนไม่ขึ้น)
   ⇒ กฎ: **ของกลางต้องตกทอดไลน์แม่เหมือนจอตั้งค่า** — 2 ที่ห้าม drift กันอีก */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleMaps, scheduleTeamFor, lineScheduleTeam, shiftFromTeam, resolveAssignedShift } from '../shiftAssign.js';

const LINES = [
  { id: 9,  name: 'Assembly Line D - GWM&RA', parent_line_name: null },
  { id: 53, name: 'Line D1 - GWM',   parent_line_name: 'Assembly Line D - GWM&RA' },
  { id: 56, name: 'Line D2 - LWR BAR', parent_line_name: 'Assembly Line D - GWM&RA' },  // ไม่มีแถวของตัวเอง
  { id: 99, name: 'หลานไลน์',          parent_line_name: 'Line D2 - LWR BAR' },          // ลูกของลูก
];
const ROWS = [
  { work_date: '2026-10-13', line_id: 9,  day_team: 'A' },
  { work_date: '2026-10-13', line_id: 53, day_team: 'B' },   // ลูกที่ตั้งเอง (manual) ชนะแม่
];

test('ไลน์ลูกที่ไม่มีแถวของตัวเอง → ได้กะของไลน์แม่ (ตรงกับจอตั้งค่า)', () => {
  const maps = buildScheduleMaps(ROWS, LINES);
  assert.equal(lineScheduleTeam(56, maps), 'A', 'Line D2 ต้องตามแม่ = A');
  assert.equal(scheduleTeamFor({ line_id: 56, team: 'A' }, maps), 'A');
  assert.equal(shiftFromTeam(scheduleTeamFor({ line_id: 56, team: 'A' }, maps), 'A'), 'day');
  assert.equal(shiftFromTeam(scheduleTeamFor({ line_id: 56, team: 'B' }, maps), 'B'), 'night');
});

test('🔴 ไลน์ที่มีแถวของตัวเอง ต้องได้ค่าเดิมเป๊ะ — การตกทอดห้ามไปทับ', () => {
  const maps = buildScheduleMaps(ROWS, LINES);
  assert.equal(lineScheduleTeam(53, maps), 'B', 'Line D1 ตั้งเอง B ห้ามถูกแม่ (A) ทับ');
  assert.equal(lineScheduleTeam(9, maps), 'A');
});

test('ตกทอดได้หลายชั้น (ลูกของลูก) และหยุดเมื่อไม่มีแม่', () => {
  const maps = buildScheduleMaps(ROWS, LINES);
  assert.equal(lineScheduleTeam(99, maps), 'A', 'หลาน → D2 (ไม่มี) → แม่ A');
  assert.equal(lineScheduleTeam(1234, maps), null, 'ไลน์ที่ไม่รู้จัก = ไม่รู้ ห้ามเดา');
});

test('ผังวนลูป (แม่ชี้กลับมาหาลูก) ต้องไม่ค้าง และคืน null', () => {
  const loop = [
    { id: 1, name: 'ก', parent_line_name: 'ข' },
    { id: 2, name: 'ข', parent_line_name: 'ก' },
  ];
  const maps = buildScheduleMaps([], loop);
  assert.equal(lineScheduleTeam(1, maps), null);
});

test('ไม่ส่ง lines มา = พฤติกรรมเดิมเป๊ะ (ไม่ตกทอด ไม่พัง)', () => {
  const maps = buildScheduleMaps(ROWS);
  assert.equal(lineScheduleTeam(56, maps), null, 'ไม่มีสายแม่ให้ไล่');
  assert.equal(lineScheduleTeam(9, maps), 'A');
});

test('maps ว่าง/ยังไม่โหลด = คืน null ห้ามโยน TypeError', () => {
  assert.equal(lineScheduleTeam(9, {}), null);
  assert.equal(lineScheduleTeam(9, null), null);
  assert.equal(scheduleTeamFor({ line_id: 9 }, null), null);
});

test('ลำดับความสำคัญคงเดิม: override → merge → ตารางกะ · Team C = กะเช้าตลอด', () => {
  const maps = buildScheduleMaps(ROWS, LINES);
  assert.equal(resolveAssignedShift({ line_id: 56, team: 'B' }, { overrideShift: 'day', maps }), 'day');
  assert.equal(resolveAssignedShift({ line_id: 56, team: 'B' }, { mergeShift: 'day', maps }), 'day');
  assert.equal(resolveAssignedShift({ line_id: 56, team: 'C' }, { maps }), 'day', 'ทีม C เช้าตลอด');
  assert.equal(resolveAssignedShift({ line_id: 56, team: 'B' }, { maps }), 'night');
});

test('กะของหน่วยงาน (dept) ยังทำงาน และไม่ถูกสายไลน์แย่ง', () => {
  const maps = buildScheduleMaps([{ dept_name: 'MTN', day_team: 'B' }], LINES);
  assert.equal(scheduleTeamFor({ line_id: null, department: ' mtn ' }, maps), 'B', 'เทียบชื่อแบบ normalize');
  assert.equal(scheduleTeamFor({ line_id: 1234, department: 'MTN' }, maps), 'B', 'ไลน์ไม่มีในตาราง → ตกไปหน่วยงาน');
});
