/* แกน "ทีมช่าง" ของผู้รับแจ้งเตือน — feedback หน้างาน 2026-09-21
   "กดแจ้งช่างจาก daily report ไม่แยกช่างให้ เรียกทุกช่างที่เกี่ยวข้อง"

   ล็อก 2 อย่างที่พังแล้วเงียบ:
     1. `teamForMachine()` ต้องคืนทีมเสมอ — คืนค่าว่างเมื่อไหร่ ปลายทางจะไม่กรองทีม
        แล้วกลับไปเด้งช่างทั้งโรงงานเหมือนบั๊กเดิม (ค่าว่างไม่ทำให้จอพัง = มองไม่เห็น)
     2. ตัวส่งต้องส่ง **key** ไม่ใช่ชื่อทีม — ส่งชื่อ = ไม่ match `profiles.mtn_teams`
        (เก็บเป็น key ตั้งแต่ migration 20260806_unify_team_encoding) = ทั้งทีมเงียบ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamForMachine } from '../mtnTeamGuess.js';

const MTN_TEAMS = ['jig_maintenance', 'die_maintenance', 'maintenance', 'production'];

const MACHINES = [
  { machine_no: 'JG-01', equipment_kind: 'jig' },
  { machine_no: 'DIE-77', equipment_kind: 'die' },
  { machine_no: 'PR-200', equipment_kind: 'machine' },
  { machine_no: 'AC-01', equipment_kind: 'facility' },
  { machine_no: 'NOKIND', equipment_kind: null },
];

test('teamForMachine: ทะเบียนเครื่องชนะการเดาจากชื่อเสมอ', () => {
  // ชื่อมีคำว่า DIE แต่ทะเบียนบอกว่าเป็นจิ๊ก → เชื่อทะเบียน
  assert.equal(teamForMachine('JG-01', MACHINES), 'jig_maintenance');
  assert.equal(teamForMachine('DIE-77', MACHINES), 'die_maintenance');
  assert.equal(teamForMachine('PR-200', MACHINES), 'maintenance');
  assert.equal(teamForMachine('AC-01', MACHINES), 'maintenance');
});

test('teamForMachine: ไม่รู้จักเครื่อง → เดาจากชื่อ · ไม่มีชื่อ → maintenance', () => {
  assert.equal(teamForMachine('JIG-999', MACHINES), 'jig_maintenance');   // ไม่อยู่ในทะเบียน เดาจากชื่อ
  assert.equal(teamForMachine('NOKIND', MACHINES), 'maintenance');        // อยู่ในทะเบียนแต่ไม่ระบุชนิด
  assert.equal(teamForMachine('', MACHINES), 'maintenance');
  assert.equal(teamForMachine(null, MACHINES), 'maintenance');
  assert.equal(teamForMachine('X-1', []), 'maintenance');
});

test('teamForMachine: ห้ามคืนค่าว่าง — ค่าว่าง = ปลายทางไม่กรองทีม = เด้งทั้งโรงงาน', () => {
  for (const arg of ['', null, undefined, '   ', 'ไม่มีจริง']) {
    const t = teamForMachine(arg, MACHINES);
    assert.ok(t && MTN_TEAMS.includes(t), `teamForMachine(${JSON.stringify(arg)}) = ${JSON.stringify(t)}`);
  }
});

test('ตัวส่งเรียกช่างต้องส่ง key ผ่าน teamKeyOf ไม่ใช่ชื่อทีม', () => {
  const src = readFileSync(new URL('../../pages/DailyReport.jsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const handleCallMtn'), src.indexOf('const openMoPicker'));
  assert.ok(body.includes('teamKeyOf(team)'), 'handleCallMtn ต้อง normalize เป็น key ก่อนใช้');
  assert.ok(/team:\s*teamKey/.test(body), 'notifyEvent ต้องส่งฟิลด์ team เป็น key');
  assert.ok(body.includes('call_mtn_team'), 'ต้องเก็บทีมที่เรียกลงแถว downtime ด้วย (สอบกลับได้)');
  assert.ok(!/notifyDowntime\([^)]*downtime_call_mtn/s.test(body),
    'ห้ามกลับไปยิง send-notification — branch นั้นไม่รู้จักทีม (ดูคอมเมนต์เหนือ handleCallMtn)');
});

test('edge ตัวส่งกลางต้องส่ง p_team ให้ RPC', () => {
  // ⚠️ `send-mtn-notification` (30 KB) ยังไม่ได้ส่ง p_team — ตระกูล mtn_* จึงยังกรองทีมผ่าน
  //    `usersInTeam()` ในไฟล์นั้นแทน · เพิ่ม p_team ที่นั่นได้เมื่อไฟล์ถูกแตกให้เล็กลง
  //    (กฎขนาดไฟล์ deploy: docs/modules/edge-functions.md)
  const src = readFileSync(new URL('../../../supabase/functions/send-event-notification/index.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('p_team'), 'send-event-notification ต้องส่ง p_team ให้ notify_recipients');
  assert.ok(src.includes("body.team"), 'ต้องรับ team จาก payload');
});
