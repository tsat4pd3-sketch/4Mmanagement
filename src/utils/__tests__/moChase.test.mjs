/* 🏃 แผงไล่ MO ค้าง — "ใบนี้รอใครลงมือ" (05/11) · ฝั่งมาจากทะเบียนขั้น ห้ามเดาจากเลขขั้น */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_SIDES, chaseSideOf, chaseTargetOf, buildMoChaseBoard } from '../moChase.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 5, 3, 0, 0);       // 05/11/2026 10:00 ไทย — ตรึงไว้ (เทสรอบ +400 วัน)
const ago = (d) => new Date(NOW - d * DAY).toISOString();

/** ใบฟอร์ม JIG/DIE/PD (ทีม production = ไม่ใช่ฟอร์ม MTN · ไม่ใช่ทีมเครื่องมือ) */
const mo = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2), mo_no: over.mo_no || 'O-TEST',
  mtn_dept: 'production', item_type: 'machine', status: 'pending',
  report_at: ago(20), line_name: 'Line 060', ...over,
});

test('ฝั่งที่ต้องลงมือ — รับงาน/ซ่อม = ช่าง · ตรวจรับ/ปิดใบ = ผู้แจ้ง · QA แยกถัง', () => {
  assert.equal(chaseSideOf(mo({ status: 'pending' })), 'mtn', 'ยังไม่มีช่างรับ = ของฝั่งช่าง');
  assert.equal(chaseSideOf(mo({ status: 'assigned', accept_at: ago(9) })), 'mtn');
  assert.equal(chaseSideOf(mo({ status: 'repaired', repair_done_at: ago(9) })), 'reporter',
    'ซ่อมเสร็จแล้ว รอผู้แจ้งตรวจรับ = ฝั่งผู้แจ้ง (ช่างเลื่อนขั้นเองไม่ได้)');
  assert.equal(chaseSideOf(mo({ status: 'checked', quality_related: 'เกี่ยวกับคุณภาพ', check_at: ago(9) })), 'qa');
  assert.equal(chaseSideOf(mo({ status: 'qa', qa_at: ago(9) })), 'reporter', 'ผ่าน QA แล้ว รอรับมอบ');
  assert.equal(chaseSideOf(mo({ status: 'closed' })), null, 'ใบปิดแล้วไม่อยู่ในแผงไล่งาน');
});

test('ใบตีกลับ/ส่งซ่อมนอก = นอกลูปขั้น ไม่ใช่ "ตัดสินไม่ได้"', () => {
  assert.equal(chaseSideOf(mo({ status: 'returned', returned_at: ago(9) })), 'outside');
  assert.equal(chaseSideOf(mo({ status: 'waiting_vendor', vendor_sent_at: ago(9) })), 'outside');
  assert.equal(chaseTargetOf(mo({ status: 'returned' })).kind, 'status');
});

test('🔴 ขั้นเดียวกันคนละฝั่งตามทีม — ขั้น 4 ของทีมเครื่องมือเป็นของช่าง', () => {
  // ทีม JIG = ทีมเครื่องมือ ⇒ ขั้น 4 (ตรวจรับงาน) เป็นหัวหน้าแผนกช่าง ไม่ใช่ผู้แจ้ง
  const jig = mo({ mtn_dept: 'jig_maintenance', item_type: 'jig', status: 'repaired', repair_done_at: ago(9) });
  assert.equal(chaseSideOf(jig), 'mtn', 'ใบ JIG ขั้น 4 = ฝั่งช่าง (ของยังอยู่ห้องช่าง ผู้แจ้งตรวจรับไม่ได้)');
  assert.equal(chaseSideOf(mo({ status: 'repaired', repair_done_at: ago(9) })), 'reporter',
    'ทีม production ขั้นเดียวกันยังเป็นฝั่งผู้แจ้ง — ห้ามยุบ 2 เคสนี้เป็นกฎเดียว');
});

test('เป้าที่ต้องไปตาม — ช่างที่รับงานไว้ · ไลน์ของผู้แจ้ง · ยังไม่มีคนรับ', () => {
  const t1 = chaseTargetOf(mo({ status: 'pending' }), { teamName: () => 'ซ่อมบำรุง (AM)' });
  assert.equal(t1.kind, 'unassigned');
  assert.match(t1.label, /ยังไม่มีช่างรับงาน/);

  const t2 = chaseTargetOf(mo({ status: 'assigned', accept_at: ago(9), assigned_techs: ['สมชาย', 'สมหญิง'] }));
  assert.equal(t2.kind, 'tech');
  assert.equal(t2.label, 'สมชาย, สมหญิง', '🔴 ช่าง 2 คน = เป้าเดียว (แตกรายคน = ใบเดียวนับ 2 แถว)');

  const t3 = chaseTargetOf(mo({ status: 'repaired', repair_done_at: ago(9), line_name: 'Line 061' }));
  assert.deepEqual([t3.kind, t3.label], ['unit', 'Line 061']);
  assert.ok(t3.whoShort, 'ต้องบอกด้วยว่าในหน่วยนั้นตำแหน่งไหนต้องเซ็น');
});

test('🔴 ชี้เป้าไม่ได้ ต้องเป็นถังที่เห็น ไม่ใช่หายไปจากแผง', () => {
  const noTech = chaseTargetOf(mo({ status: 'assigned', accept_at: ago(9) }));   // ไม่มี assigned_techs
  assert.equal(noTech.kind, 'no_target');
  assert.match(noTech.label, /ไม่มีชื่อช่าง/);

  const noUnit = chaseTargetOf(mo({ status: 'repaired', repair_done_at: ago(9), line_name: '', reporter_prod: '', reported_by_name: '' }));
  assert.equal(noUnit.kind, 'no_target');
});

test('board: นับเฉพาะใบเกินเกณฑ์ · เรียงฝั่งของเราก่อน · ใบในเกณฑ์ไม่เข้า', () => {
  const b = buildMoChaseBoard([
    mo({ id: 'a', status: 'pending', report_at: ago(30) }),                                   // ช่าง 30 วัน
    mo({ id: 'b', status: 'repaired', repair_done_at: ago(10), line_name: 'Line 060' }),      // ผู้แจ้ง 10 วัน
    mo({ id: 'c', status: 'repaired', repair_done_at: ago(2), line_name: 'Line 060' }),       // ยังไม่ถึงเกณฑ์
    mo({ id: 'd', status: 'closed' }),                                                        // ปิดแล้ว
  ], { now: NOW });
  assert.equal(b.open, 3, 'ใบปิดแล้วไม่นับเป็นใบที่ยังเปิด');
  assert.equal(b.stale, 2);
  assert.deepEqual(b.sides.map(s => s.side), ['mtn', 'reporter'], 'ของเราขึ้นก่อนเสมอ');
  assert.equal(b.sides[0].hard, 1, '30 วัน = เลยเถิด');
  assert.equal(b.sides[1].hard, 0);
  assert.deepEqual(b.sides.map(s => s.tone), ['bad', 'warn']);
});

test('🔴 ใบที่นับวันไม่ได้ ไม่ถูกนับเป็น "ไม่ค้าง" — ต้องแยกไว้ให้จอเขียนบอก', () => {
  const b = buildMoChaseBoard([mo({ id: 'x', status: 'pending', report_at: null })], { now: NOW });
  assert.equal(b.unknownAge, 1);
  assert.equal(b.stale, 0);
  assert.deepEqual(b.sides, [], 'ไม่เดาฝั่งให้ใบที่ยังไม่รู้ว่าค้างนานแค่ไหน');
});

test('ในแต่ละฝั่ง เรียง "ค้างนานสุดก่อน" ไม่ใช่ "ใบเยอะสุดก่อน"', () => {
  const b = buildMoChaseBoard([
    mo({ id: '1', status: 'repaired', repair_done_at: ago(8), line_name: 'Line A' }),
    mo({ id: '2', status: 'repaired', repair_done_at: ago(8), line_name: 'Line A' }),
    mo({ id: '3', status: 'repaired', repair_done_at: ago(40), line_name: 'Line B' }),
  ], { now: NOW });
  const t = b.sides[0].targets;
  assert.deepEqual(t.map(x => x.label), ['Line B', 'Line A'], 'Line B ใบเดียวแต่ดอง 40 วัน ต้องขึ้นก่อน');
  assert.equal(t[0].rows.length, 1);
  assert.equal(t[1].n, 2);
});

test('ทะเบียนฝั่ง — ต้องมี 5 ถังและเรียง "ของเราก่อน" (จอวาดตามลำดับนี้)', () => {
  assert.deepEqual(CHASE_SIDES.map(s => s.key), ['mtn', 'reporter', 'qa', 'outside', 'unknown']);
  assert.ok(CHASE_SIDES.every(s => s.label && s.hint && s.icon), 'ทุกถังต้องมีคำอธิบายว่าทำไมอยู่กองนี้');
});

test('🔴 ยอดของแถบไล่งานต้องเท่ากับยอดของแผงใบค้างเป๊ะ (แผงเดียวกัน ห้ามมี 2 เลข)', async () => {
  const { buildMoStaleBoard } = await import('../mtnStale.js');
  const rows = [
    mo({ id: '1', status: 'pending', report_at: ago(30) }),
    mo({ id: '2', status: 'repaired', repair_done_at: ago(9) }),
    mo({ id: '3', status: 'checked', quality_related: 'เกี่ยวกับคุณภาพ', check_at: ago(12) }),
    mo({ id: '4', status: 'returned', returned_at: ago(20) }),
    mo({ id: '5', status: 'assigned', accept_at: ago(1) }),          // ยังไม่ถึงเกณฑ์
    mo({ id: '6', status: 'pending', report_at: null }),              // นับวันไม่ได้
    mo({ id: '7', status: 'closed' }),
  ];
  const stale = buildMoStaleBoard(rows, { now: NOW });
  const chase = buildMoChaseBoard(rows, { now: NOW });
  assert.equal(chase.stale, stale.stale, 'ยอด "ค้างเกินเกณฑ์" ต้องเป็นเลขเดียวกัน');
  assert.equal(chase.unknownAge, stale.unknown, 'ยอด "นับวันไม่ได้" ต้องเป็นเลขเดียวกัน');
  assert.equal(chase.open, stale.open);
  const sum = chase.sides.reduce((n, s) => n + s.n, 0);
  assert.equal(sum, chase.stale, 'ผลรวมทุกกองต้องเท่ายอดค้าง (ไม่มีใบตกหล่น ไม่มีใบนับ 2 รอบ)');
  const sumTargets = chase.sides.reduce((n, s) => n + s.targets.reduce((m, t) => m + t.n, 0), 0);
  assert.equal(sumTargets, chase.stale, 'ผลรวมทุกเป้าก็ต้องเท่ากัน (ใบเดียว = เป้าเดียว)');
});
