/* 🔗 ตัวเตือน AM (edge `pm-daily-scan`) ต้องตัดสิน "เครื่องไหนต้องตรวจ" ตรงกับจอ /daily-checker?tab=pm
   ที่มา (05/11): จอเปลี่ยนเป็นรายเครื่องแล้ว (B1 · 02/11) แต่ตัวเตือน Telegram/ในแอปยังตัดสินทั้งไลน์
   ⇒ จอบอก "เครื่องนี้ไม่เดิน ไม่ต้องตรวจ" แต่ข้อความเตือนยังยิงส้มให้เครื่องเดียวกัน
   ไฟล์ `supabase/functions/pm-daily-scan/amRun.js` เป็นสำเนา JS ล้วน (Deno import src/ ไม่ได้) — เทสนี้เทียบผลกับต้นฉบับ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as edge from '../../../supabase/functions/pm-daily-scan/amRun.js';
import { amMachineKeys, amTargetsByRun, runningMachinesByLine } from '../../lib/pmDailyStatus.js';
import { machineKey } from '../machineNo.js';

const NOS = ['SW10', 'SW-10', 'sw 010', 'SP-10/NF86', 'LASER 7', 'ปั๊ม-3', '', null, 'A1,B2'];

test('machineKey / amMachineKeys ของตัวเตือน = ของจอ', () => {
  for (const n of NOS) {
    assert.equal(edge.machineKey(n), machineKey(n), `machineKey(${n})`);
    assert.deepEqual(edge.amMachineKeys(n), amMachineKeys(n), `amMachineKeys(${n})`);
  }
});

const TG = [
  { jig_id: 'j1', machine_no: 'SW-10' }, { jig_id: 'j2', machine_no: 'SW11' },
  { jig_id: 'j3', machine_no: null }, { jig_id: 'j4', machine_no: 'NF86' },
];
const CASES = {
  'ไม่มีใบ': [],
  'รายเครื่องล้วน': [{ machine_no: 'SW10', at: '2026-11-05T01:10:00Z' }, { machine_no: 'SP-10/NF86', at: '2026-11-05T01:05:00Z' }],
  'ไม่ลงเลขเครื่องเลย': [{ machine_no: null, at: '2026-11-05T01:00:00Z' }],
  'ปน': [{ machine_no: 'SW10', at: '2026-11-05T01:10:00Z' }, { machine_no: '', at: '2026-11-05T01:20:00Z' }],
};

test('amTargetsByRun ของตัวเตือน = ของจอ (ทุกโหมด machine/mixed/line_no_mno/line)', () => {
  const lines = [{ id: 'L', name: 'L1', parent_line_name: null }];
  for (const [name, orders] of Object.entries(CASES)) {
    const screenRun = runningMachinesByLine(lines, orders.map(o => ({ ...o, line_name: 'L1' })))['L1'];
    const edgeRun = edge.runOfOrders(orders);
    assert.deepEqual(edgeRun, screenRun ?? { orders: 0, noMno: 0, keys: {} }, `run: ${name}`);
    assert.deepEqual(edge.amTargetsByRun(TG, edgeRun), amTargetsByRun(TG, screenRun), `split: ${name}`);
  }
});

test('🛡️ pm-daily-scan ต้องตัดสินรายเครื่อง (อ่าน machine_no + amTargetsByRun)', () => {
  const src = readFileSync(new URL('../../../supabase/functions/pm-daily-scan/index.ts', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/amRun\.js'/, '\n❌ ตัวเตือน AM เลิกใช้กติการายเครื่องแล้ว — จอกับข้อความเตือนจะนับไม่ตรงกัน\n');
  assert.match(src, /select\('session_id, opened_at, confirmed_at, machine_no'\)/, '\n❌ ไม่ได้ดึง machine_no ของใบผลิต — ตัดสินรายเครื่องไม่ได้\n');
  assert.match(src, /amTargetsByRun\(/);
});
