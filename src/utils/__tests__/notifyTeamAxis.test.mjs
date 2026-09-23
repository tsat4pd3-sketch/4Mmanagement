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
  const src = readFileSync(new URL('../../../supabase/functions/send-event-notification/index.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('p_team'), 'send-event-notification ต้องส่ง p_team ให้ notify_recipients');
  assert.ok(src.includes("body.team"), 'ต้องรับ team จาก payload');
});

test('edge ใบแจ้งซ่อมต้องส่ง p_team ด้วย — ต้นทาง 61% ของแถว notifications ทั้งระบบ', () => {
  /* บั๊กจริง 22→23/09: แกนทีมถูกเพิ่มใน notify_recipients เมื่อ 21/09 พร้อมเจตนา
     "ทีม DIE MTN ไม่ควรโดนเด้งใบของ JIG MTN" แต่ `send-mtn-notification` เรียก RPC โดย
     **ไม่ส่ง p_team** ⇒ แกนไม่เคยมีผลกับใบซ่อมเลย (usersInTeam เพิ่มช่างทีมที่ใช่ แต่ไม่ตัดทีมอื่นออก)
     วัดจริง: 42,220 แถว/14 วัน · เฉลี่ย 30 คน/เหตุการณ์ · คนอ่าน 7.8% */
  const src = readFileSync(new URL('../../../supabase/functions/send-mtn-notification/index.ts', import.meta.url), 'utf8');
  assert.ok(/args\.p_team\s*=/.test(src), 'send-mtn-notification ต้องส่ง p_team ให้ notify_recipients');
  assert.ok(/usersByRule\([^)]*dept/s.test(src), 'usersByRule ต้องรับทีมของใบ (dept) เข้าไปกรอง');
  // 🔴 ห้ามเงียบ: กรองด้วยทีมแล้วเหลือ 0 คน ต้องถอยไปชุดไม่กรองทีม
  //    (mtn_closed ตั้ง role ไว้แค่ mtn และช่างทุกคนมีทีม ⇒ ใบทีม production กรองเหลือ 0)
  assert.ok(/if\s*\(ids\.length\s*\|\|\s*!team\)\s*return ids;/.test(src),
    'ต้องมีทางถอยเมื่อกรองด้วยทีมแล้วไม่เหลือใคร — ไม่งั้นใบเดินไปเงียบๆ');
  // ⚠️ ผู้เรียกฝั่งเว็บไม่ส่ง Authorization ⇒ ห้ามเปิด verify_jwt (เคยหลุดตอน deploy 23/09)
  assert.ok(src.includes('verify_jwt = false'), 'ต้องมีคำเตือนเรื่อง verify_jwt กำกับไว้ในไฟล์');
});

/* ── 🎯 แกน "ไลน์" + "คนในใบ" (2026-09-23 · คำสั่ง user "อย่าแจ้งมั่ว เพราะมันถี่") ─────
   วัดจริงก่อนแก้: ใบซ่อมเดินครบ 8 ขั้น = 24-38 คน/ขั้น (หัวหน้าไลน์ทั้งส่วนงาน PD3 ได้หมด
   ทั้งที่ใบอยู่ไลน์เดียว) · คนเปิดอ่าน 7.8% */
test('edge ใบแจ้งซ่อมต้องส่ง p_line ให้ RPC — ไม่งั้นกรองได้แค่ระดับส่วนงาน', () => {
  const src = readFileSync(new URL('../../../supabase/functions/send-mtn-notification/index.ts', import.meta.url), 'utf8');
  assert.ok(/args\.p_line\s*=/.test(src), 'ต้องส่ง p_line ให้ notify_recipients');
  // '-' = ค่าที่หน้าเว็บใช้แทน "ไม่ระบุไลน์" — ส่งไปตรงๆ จะกรองจนไม่เหลือใคร
  assert.ok(/lineName !== '-'/.test(src), "ต้องแปลง '-' เป็น null ก่อนส่ง p_line");
});

test('edge ตัวส่งกลางต้องส่ง p_line ด้วย (downtime_call_mtn เปิดแกนไลน์ไว้)', () => {
  const src = readFileSync(new URL('../../../supabase/functions/send-event-notification/index.ts', import.meta.url), 'utf8');
  assert.ok(/p_line:\s*line/.test(src), 'ต้องส่ง p_line ให้ notify_recipients');
  assert.ok(/!== '-'/.test(src), "ต้องแปลง '-' เป็น null ก่อนส่ง p_line");
});

test('ใบแจ้งซ่อมต้องส่งถึง "คนในใบ" ทุกขั้น + มีทางถอยกันเงียบ', () => {
  const src = readFileSync(new URL('../../../supabase/functions/send-mtn-notification/index.ts', import.meta.url), 'utf8');
  const blk = src.slice(src.indexOf('const MO_AUDIENCE'), src.indexOf('const UUID_RE'));
  assert.ok(blk, 'ต้องมีตาราง MO_AUDIENCE (ใครต้องลงมือในแต่ละขั้น)');

  // ทุกขั้นที่เขียนแจ้งเตือนในแอป (MO_INAPP) ต้องมีแถวใน MO_AUDIENCE — ตกหล่น = กลับไปยิงทั้ง role เงียบๆ
  const inapp = src.slice(src.indexOf('const MO_INAPP'), src.indexOf('async function notifyMoInApp'));
  const events = [...inapp.matchAll(/^\s{2}(mtn_\w+)\s*:/gm)].map(m => m[1]);
  assert.ok(events.length >= 10, `อ่าน MO_INAPP ไม่ออก (เจอ ${events.length} ขั้น)`);
  for (const ev of events) {
    assert.ok(new RegExp(`\\b${ev}\\s*:\\s*\\{`).test(blk), `MO_AUDIENCE ขาดขั้น ${ev}`);
  }

  // ผู้แจ้งต้องได้รับทุกขั้นเสมอ — ใบของตัวเองเดินไปถึงไหนต้องรู้
  const rows = [...blk.matchAll(/\b(mtn_\w+)\s*:\s*\{([^}]*)\}/g)];
  assert.equal(rows.length, events.length, 'จำนวนแถวใน MO_AUDIENCE ต้องเท่ากับขั้นที่แจ้งในแอป');
  for (const [, ev, cfg] of rows) {
    assert.ok(cfg.includes('reported_by_uid'), `${ev}: ผู้แจ้ง (reported_by_uid) ต้องได้รับเสมอ`);
  }

  // 🔴 ขั้นที่ไม่ยิงตามทะเบียน (cast:false) ต้องมีทางถอย ไม่งั้นใบเก่าที่ไม่มี uid จะเงียบสนิท
  assert.ok(/if \(!ids\.length && !aud\.cast\)/.test(src),
    'ต้องถอยไปยิงตามทะเบียนเมื่อไม่มี uid ในใบเลย — ห้ามล้มเหลวเงียบ');
});
