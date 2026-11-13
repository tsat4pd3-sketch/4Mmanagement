/* 🏃 แผงไล่ MO ค้าง — "ใบนี้รอใครลงมือ" (05/11) · ฝั่งมาจากทะเบียนขั้น ห้ามเดาจากเลขขั้น */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASE_SIDES, chaseSideOf, chaseTargetOf, buildMoChaseBoard,
  PR_CLOSE_STAGES, moCloseGate, moCloseGateText } from '../moChase.js';

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

test('ทะเบียนฝั่ง — ต้องมี 6 ถังและเรียง "ของเราก่อน" (จอวาดตามลำดับนี้)', () => {
  /* 🛒 ถัง `pr` เพิ่ม 10/11 — วางถัดจาก `mtn` เพราะยังเป็นงานที่ฝั่งช่าง/แอดมินช่างไล่ต่อได้
     (ลงเลข PR / ตามของ) ก่อนจะถึงคิวของฝ่ายที่แจ้ง */
  assert.deepEqual(CHASE_SIDES.map(s => s.key), ['mtn', 'pr', 'reporter', 'qa', 'outside', 'unknown']);
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

/* ══ 🛒 ใบที่มี PR ค้าง — ไล่จัดซื้อ ไม่ใช่ไล่ ผจก.ฝ่ายที่แจ้ง ═══════════  2026-11-10
   คำสั่ง user: *"ในเคสที่เป็นงานที่มีการออก PR จะต้องยังไม่รอ ผจก.ฝ่ายที่แจ้งอนุมัติ
   ผจก.ฝ่ายแจ้งจะอนุมัติได้ก็ต่อเมื่อ loop PR จบ"*
   🔴 ไม่ส่ง `prs` = พฤติกรรมเดิมเป๊ะ (ไม่รู้เรื่อง PR = ไม่เดา) */
const atClose = (over = {}) => mo({ status: 'handover', handover_at: ago(9), ...over });

test('🛒 มี PR ค้างที่ขั้นปิดใบ = รอลูปจัดซื้อ ไม่ใช่รอ ผจก.', () => {
  const o = atClose();
  assert.equal(chaseSideOf(o), 'reporter', 'ไม่ส่ง prs = เหมือนเดิม');
  assert.equal(chaseSideOf(o, { prs: [{ status: 'requested' }] }), 'pr');
  assert.equal(chaseSideOf(o, { prs: [{ status: 'ordered', pr_no: 'PR-1' }] }), 'pr');
});

test('🛒 ลูป PR จบแล้ว (รับของ/ยกเลิก) = กลับไปรอ ผจก.ตามเดิม', () => {
  const o = atClose();
  assert.equal(chaseSideOf(o, { prs: [{ status: 'received' }] }), 'reporter');
  assert.equal(chaseSideOf(o, { prs: [{ status: 'cancelled' }] }), 'reporter');
  assert.equal(chaseSideOf(o, { prs: [] }), 'reporter', 'ไม่มี PR เลย = เหมือนเดิม');
  /* ใบเดียวมีหลาย PR — เหลือค้างใบเดียวก็ยังไม่จบลูป */
  assert.equal(chaseSideOf(o, { prs: [{ status: 'received' }, { status: 'ordered' }] }), 'pr');
});

test('🔴 PR ค้างแต่ยังไม่ถึงขั้นปิดใบ = ไม่เปลี่ยนฝั่ง (ช่างยังต้องทำงานของตัวเอง)', () => {
  const prs = [{ status: 'requested' }];
  assert.equal(chaseSideOf(mo({ status: 'pending' }), { prs }), 'mtn', 'ยังไม่มีช่างรับ = ของช่าง');
  assert.equal(chaseSideOf(mo({ status: 'repaired', repair_done_at: ago(9) }), { prs }), 'reporter',
    'รอผู้แจ้งตรวจรับ = ยังเป็นของผู้แจ้ง ไม่ใช่ของจัดซื้อ');
});

test('🛒 เป้าที่ต้องไปตาม แยก "ยังไม่ลงเลข PR" ออกจาก "รอของ" (คนละคน)', () => {
  const o = atClose();
  const noNo = chaseTargetOf(o, { prs: [{ status: 'requested' }] });
  assert.equal(noNo.kind, 'pr');
  assert.match(noNo.label, /ยังไม่ได้ลงเลข PR/);
  const waiting = chaseTargetOf(o, { prs: [{ status: 'ordered', pr_no: 'PR-77' }] });
  assert.equal(waiting.kind, 'pr');
  assert.match(waiting.label, /PR-77/, 'มีเลขแล้วต้องบอกเลขให้ไปตามของได้');
  assert.notEqual(noNo.key, waiting.key, 'คนละกอง ห้ามยุบรวม');
});

test('🛒 ฝั่ง pr อยู่ในทะเบียนฝั่ง + เข้าแผงจริงผ่าน prOf', () => {
  assert.ok(CHASE_SIDES.some(s => s.key === 'pr'), 'ไม่มีในทะเบียน = จอวาดหัวข้อไม่ได้');
  const o = atClose({ id: 'p1' });
  const board = buildMoChaseBoard([o], { now: NOW, prOf: () => [{ status: 'requested' }] });
  assert.equal(board.sides.find(s => s.side === 'pr')?.n, 1);
  assert.equal(board.sides.find(s => s.side === 'reporter'), undefined, 'ต้องไม่ไปโผล่ฝั่งผู้แจ้งด้วย');
  /* ไม่ส่ง prOf = เหมือนเดิมเป๊ะ */
  const plain = buildMoChaseBoard([o], { now: NOW });
  assert.equal(plain.sides.find(s => s.side === 'reporter')?.n, 1);
  assert.equal(plain.sides.find(s => s.side === 'pr'), undefined);
});

/* ══ 🚦 ด่าน "ปิดใบได้ต่อเมื่อลูป PR จบ" (10/11 · คำสั่ง user "บล็อกเลย") ══════════ */

test('🚦 PR ค้าง + ขั้นปิดใบ = บล็อก · ลูปจบแล้ว = ผ่าน', () => {
  for (const stage of PR_CLOSE_STAGES) {
    assert.equal(moCloseGate(stage, [{ status: 'requested' }]).gate, 'block', stage);
    assert.equal(moCloseGate(stage, [{ status: 'ordered', pr_no: 'PR-9' }]).gate, 'block', stage);
    assert.equal(moCloseGate(stage, [{ status: 'received' }]).gate, 'ok', stage);
    assert.equal(moCloseGate(stage, [{ status: 'cancelled' }]).gate, 'ok', stage);
    assert.equal(moCloseGate(stage, []).gate, 'ok', `${stage}: ไม่มี PR เลย = ปิดได้`);
  }
  /* ใบเดียวหลาย PR — เหลือค้างใบเดียวก็ยังบล็อก */
  assert.equal(moCloseGate('close', [{ status: 'received' }, { status: 'ordered' }]).gate, 'block');
});

test('🔴 ขั้นที่ไม่ใช่ขั้นปิดใบ ห้ามถูกบล็อก (ช่างต้องเดินงานของตัวเองได้)', () => {
  for (const stage of ['assign', 'repair', 'check', 'qa', 'handover', 'mtn_head', 'mtn_approve', null]) {
    assert.equal(moCloseGate(stage, [{ status: 'requested' }]).gate, 'ok', `stage=${String(stage)}`);
  }
  assert.ok(!PR_CLOSE_STAGES.includes('mtn_head'), 'ขั้น ผจก.ช่าง ไม่ใช่ขั้นที่กฎนี้คุม');
});

test('🔴 อ่าน PR ไม่ได้ (null) = unknown ไม่บล็อก — คนละความหมายกับ [] ที่ว่างจริง', () => {
  const g = moCloseGate('close', null);
  assert.equal(g.gate, 'unknown');
  assert.equal(g.rows.length, 0);
  assert.notEqual(g.gate, 'block', 'บล็อกตอนคิวรีล่ม = ปิดใบไม่ได้ทั้งโรงงาน');
  assert.equal(moCloseGate('close', undefined).gate, 'unknown');
  assert.equal(moCloseGate('close', []).gate, 'ok', 'ว่างจริง = ปิดได้ ไม่ใช่ unknown');
});

test('ข้อความบอกเหตุ + ทางแก้ (ไม่ใช่บอกแค่ว่าทำไม่ได้)', () => {
  const t = moCloseGateText(moCloseGate('close', [{ status: 'ordered', pr_no: 'PR-77' }, { status: 'requested' }]));
  assert.match(t, /PR-77/, 'ต้องบอกเลขให้ไปตามของได้');
  assert.match(t, /ยังไม่ได้ลงเลข PR 1 ใบ/, 'ใบที่ยังไม่มีเลข = คนละงาน ต้องแยกบอก');
  assert.match(t, /รับของเข้าสต็อก|ยกเลิก/, 'ต้องมีทางออก');
  assert.equal(moCloseGateText(moCloseGate('close', [])), null, 'ผ่านแล้วห้ามมีข้อความ');
  assert.match(moCloseGateText(moCloseGate('close', null)), /ไม่ได้ตรวจ/, 'อ่านไม่ได้ต้องเขียนบนจอ');
  assert.equal(moCloseGateText(null), null);
});

test('🔗 ด่านบล็อก กับ แผงไล่งาน ใช้เกณฑ์ชุดเดียวกัน (ห้าม drift)', () => {
  const o = atClose();
  const prs = [{ status: 'requested' }];
  assert.equal(chaseSideOf(o, { prs }), 'pr');
  assert.equal(moCloseGate('close', prs).gate, 'block',
    'แผงบอกว่า "รอลูป PR" แต่ด่านปล่อยปิด = 2 จอคนละเรื่อง');
});
