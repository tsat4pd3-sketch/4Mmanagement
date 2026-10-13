import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STALE_DAYS, STALE_HARD_DAYS, STALE_SINCE_COLS,
  stageSinceOf, stageAgeOf, staleTone, buildMoStaleBoard,
} from '../mtnStale.js';

/* 🕐 ตรึงเวลาไว้เสมอ — `npm test` รัน 2 รอบ (ปกติ + นาฬิกา +400 วัน)
   เทสที่อ่าน Date.now() เองจะผ่านวันนี้แล้วตกเองวันหลังโดยไม่มี commit ไหนทำ */
const NOW = new Date('2026-10-13T10:00:00+07:00').getTime();
/** วันที่ย้อนหลัง d วันจาก NOW (เวลาเดียวกัน ⇒ จำนวนวันที่ปัดลงได้ d พอดี) */
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

/* ── แถวตัวอย่าง: ครบทั้ง 2 ฟอร์ม + ทุกชั้นของกฎ ───────────────────────────────
   `mtn_dept:'maintenance'` = ฟอร์ม MTN (8 ขั้น ไม่มี QA) · ทีมอื่น = ฟอร์ม JIG/DIE/PD (7 ขั้น) */
const ROW = (o) => ({ mtn_head_at: null, approve_at: null, qa_skipped_at: null, ...o });

test('stageSinceOf — นับจาก "เวลาเข้าขั้น" ไม่ใช่วันแจ้ง (กฎข้อ 1)', () => {
  // ใบรอ QA: แจ้งมา 40 วัน แต่ผู้แจ้งเพิ่งเซ็นตรวจรับเมื่อ 2 วันก่อน ⇒ ค้างขั้นนี้ 2 วัน ไม่ใช่ 40
  const o = ROW({ status: 'checked', mtn_dept: 'production', quality_related: 'เกี่ยวกับคุณภาพ',
    report_at: ago(40), accept_at: ago(38), repair_done_at: ago(5), check_at: ago(2) });
  const s = stageSinceOf(o);
  assert.equal(s.field, 'check_at');
  assert.equal(s.exact, true);
  assert.equal(stageAgeOf(o, NOW).days, 2, 'ต้องได้ 2 วัน — ถ้าได้ 40 แปลว่าเผลอไปนับ report_at');
  assert.equal(stageAgeOf(o, NOW).stage, 'qa');
});

test('ขั้นเดียวกันคนละฟอร์ม → คนละ stage คนละเวลาเข้าขั้น (กฎข้อ 2 · ด่าน mo-step-branch-via-stage)', () => {
  const base = { status: 'checked', report_at: ago(30), accept_at: ago(29), repair_done_at: ago(12), check_at: ago(9) };
  // ฟอร์ม JIG/DIE + "เกี่ยวกับคุณภาพ" ⇒ ขั้น 5 = รอ QA
  const jig = stageAgeOf(ROW({ ...base, mtn_dept: 'jig_maintenance', quality_related: 'เกี่ยวกับคุณภาพ' }), NOW);
  // ฟอร์ม MTN ⇒ ลูปไม่มี QA ⇒ ขั้น 5 = รับมอบ (เวลาเข้าขั้นคือ check_at เหมือนกัน แต่คนละ stage)
  const mtn = stageAgeOf(ROW({ ...base, mtn_dept: 'maintenance', purpose: 'repair', quality_related: 'เกี่ยวกับคุณภาพ' }), NOW);
  assert.equal(jig.stage, 'qa');
  assert.equal(mtn.stage, 'handover', 'ใบทีม MTN ไม่มี QA ในลูป — ขั้น 5 คือรับมอบ');
  assert.equal(jig.days, 9);
  assert.equal(mtn.days, 9);
});

test('ใบ MTN ที่ค้างใน status `handover` 3 ขั้น — แยกด้วยเวลาเซ็นจริง', () => {
  const base = { status: 'handover', mtn_dept: 'maintenance', purpose: 'repair',
    report_at: ago(50), accept_at: ago(49), repair_done_at: ago(40), check_at: ago(35), ho_at: ago(20) };
  const head = stageAgeOf(ROW({ ...base }), NOW);
  const appr = stageAgeOf(ROW({ ...base, mtn_head_at: ago(8) }), NOW);
  const cost = stageAgeOf(ROW({ ...base, mtn_head_at: ago(8), approve_at: ago(3) }), NOW);
  assert.deepEqual([head.stage, appr.stage, cost.stage], ['mtn_head', 'mtn_approve', 'cost_mgr_close']);
  assert.deepEqual([head.days, appr.days, cost.days], [20, 8, 3],
    'แต่ละขั้นต้องเริ่มนับใหม่จากลายเซ็นขั้นก่อนหน้า');
});

test('ไม่รู้เวลาเข้าขั้น = ถอยไปวันแจ้ง + ธง exact:false (กฎข้อ 5 — ห้ามเนียนเป็นของจริง)', () => {
  // แถวที่ไม่ได้ select check_at มา (undefined) — ไม่ใช่ "ว่างจริง"
  const o = { status: 'checked', mtn_dept: 'production', quality_related: 'เกี่ยวกับคุณภาพ', report_at: ago(18) };
  const a = stageAgeOf(o, NOW);
  assert.equal(a.exact, false);
  assert.equal(a.field, 'report_at');
  assert.equal(a.days, 18, 'ยังต้องได้เลข (ใบเก่าแน่ๆ) แค่ต้องติดธงว่าเป็นค่าประมาณ');
});

test('ไม่มีแม้วันแจ้ง = days null ห้ามเป็น 0 (0 = "เพิ่งเข้าขั้น" ซึ่งทำให้ใบหลุดจากจอเตือน)', () => {
  const a = stageAgeOf({ status: 'pending' }, NOW);
  assert.equal(a.days, null);
  assert.notEqual(a.days, 0);
  assert.equal(staleTone(null), 'none', 'ตัดสินไม่ได้ = เทา ไม่ใช่เขียว');
});

test('ใบนอกลูปขั้น (returned / waiting_vendor) ต้องไม่หาย และไม่ยุบรวมกับขั้นอื่น (กฎข้อ 6)', () => {
  const rows = [
    ROW({ id: 1, status: 'returned', mtn_dept: 'production', report_at: ago(30), returned_at: ago(11) }),
    ROW({ id: 2, status: 'waiting_vendor', mtn_dept: 'maintenance', purpose: 'repair', report_at: ago(40), vendor_sent_at: ago(25) }),
  ];
  const b = buildMoStaleBoard(rows, { now: NOW });
  assert.equal(b.open, 2);
  assert.equal(b.stale, 2);
  const keys = b.byStage.map(s => s.key).sort();
  assert.deepEqual(keys, ['status:returned', 'status:waiting_vendor'], 'ต้องแยกถังของตัวเอง');
  assert.equal(b.byStage.find(s => s.key === 'status:returned').oldest, 11, 'นับจาก returned_at ไม่ใช่วันแจ้ง');
  assert.equal(b.byStage.find(s => s.key === 'status:waiting_vendor').oldest, 25);
});

test('สถานะที่จบแล้วต้องไม่เข้ายอดค้าง — ใช้ isMoOpen ไม่ใช่ลิสต์ที่เขียนเอง (กฎข้อ 3)', () => {
  const rows = ['closed', 'rejected', 'transferred'].map((status, i) =>
    ROW({ id: i, status, mtn_dept: 'production', report_at: ago(90), check_at: ago(80) }));
  const b = buildMoStaleBoard(rows, { now: NOW });
  assert.equal(b.open, 0);
  assert.equal(b.stale, 0);
  assert.equal(b.oldest, null, 'ไม่มีใบเปิด = ไม่มีเลข "เก่าสุด" ห้ามคืน 0');
});

test('เกณฑ์ 7/30 วัน — ชั้นสีและตัวนับ', () => {
  assert.equal(STALE_DAYS, 7);
  assert.equal(STALE_HARD_DAYS, 30);
  assert.equal(staleTone(6), 'none');
  assert.equal(staleTone(7), 'warn', 'ครบ 7 วันพอดีต้องนับว่าค้างแล้ว');
  assert.equal(staleTone(29), 'warn');
  assert.equal(staleTone(30), 'bad');
  assert.equal(staleTone(12, { days: 14 }), 'none', 'เกณฑ์ปรับได้ผ่าน opts');
});

test('buildMoStaleBoard — สรุป/จัดอันดับ/เรียงใบ', () => {
  const rows = [
    ROW({ id: 1, mo_no: 'A', status: 'pending', mtn_dept: 'jig_maintenance', report_at: ago(41) }),
    ROW({ id: 2, mo_no: 'B', status: 'pending', mtn_dept: 'jig_maintenance', report_at: ago(9) }),
    ROW({ id: 3, mo_no: 'C', status: 'pending', mtn_dept: 'production', report_at: ago(2) }),
    ROW({ id: 4, mo_no: 'D', status: 'checked', mtn_dept: 'production', quality_related: 'เกี่ยวกับคุณภาพ',
      report_at: ago(20), check_at: ago(15) }),
    ROW({ id: 5, mo_no: 'E', status: 'closed', mtn_dept: 'production', report_at: ago(99) }),
  ];
  const b = buildMoStaleBoard(rows, { now: NOW });
  assert.equal(b.open, 4, 'ใบปิดไม่นับ');
  assert.equal(b.stale, 3, 'A(41) B(9) D(15) เกิน 7 วัน · C(2) ยังไม่ถึง');
  assert.equal(b.hard, 1, 'มีแต่ A ที่เกิน 30 วัน');
  assert.equal(b.oldest, 41);
  assert.equal(b.unknown, 0);
  assert.equal(b.approx, 0);
  assert.deepEqual(b.rows.map(r => r.mo_no), ['A', 'D', 'B'], 'ใบค้างนานสุดขึ้นก่อน');
  assert.deepEqual(b.rows.map(r => r._tone), ['bad', 'warn', 'warn']);
  // ถังขั้น: assign (A,B,C) ค้าง 2 ใบ ต้องมาก่อน qa (D) ค้าง 1 ใบ
  assert.deepEqual(b.byStage.map(s => [s.stage, s.n, s.stale]), [['assign', 3, 2], ['qa', 1, 1]]);
  assert.equal(b.byStage[0].oldest, 41);
});

test('byTeam — จัดอันดับทีมด้วยจำนวนใบค้าง · teamOf ส่งเข้ามาได้ (ไฟล์นี้ไม่รู้จักทะเบียนทีม)', () => {
  const rows = [
    ROW({ id: 1, status: 'pending', mtn_dept: 'jig_maintenance', report_at: ago(20) }),
    ROW({ id: 2, status: 'pending', mtn_dept: 'jig_maintenance', report_at: ago(10) }),
    ROW({ id: 3, status: 'pending', mtn_dept: 'production', report_at: ago(10) }),
    ROW({ id: 4, status: 'pending', mtn_dept: '', item_type: 'จิ๊ก', report_at: ago(10) }),
  ];
  const plain = buildMoStaleBoard(rows, { now: NOW });
  assert.deepEqual(plain.byTeam.map(t => [t.dept, t.stale]), [['jig_maintenance', 2], ['production', 1], ['', 1]],
    'ทีมว่างต้องมีตะกร้ารับท้ายลิสต์ ห้ามหายไป');
  // ผู้เรียกเดาทีมจากชนิดอุปกรณ์ได้เอง (หน้า MtnRepair ใช้ teamForItem)
  const mapped = buildMoStaleBoard(rows, { now: NOW, teamOf: (o) => o.mtn_dept || (o.item_type === 'จิ๊ก' ? 'jig_maintenance' : '') });
  assert.equal(mapped.byTeam.find(t => t.dept === 'jig_maintenance').stale, 3);
});

test('ใบที่นับวันไม่ได้ — ยังอยู่ใน n ของถัง + ถูกนับใน unknown (ห้ามตัดออกเงียบ)', () => {
  const rows = [
    ROW({ id: 1, status: 'pending', mtn_dept: 'production', report_at: null }),
    ROW({ id: 2, status: 'pending', mtn_dept: 'production', report_at: ago(10) }),
  ];
  const b = buildMoStaleBoard(rows, { now: NOW });
  assert.equal(b.open, 2);
  assert.equal(b.unknown, 1);
  assert.equal(b.stale, 1, 'ใบที่ไม่รู้วันไม่ถูกนับว่าเกินเกณฑ์ (ไม่รู้ ≠ เกิน)');
  assert.equal(b.byStage[0].n, 2, 'แต่ยังต้องอยู่ในยอดรวมของถัง');
  assert.equal(b.byStage[0].unknown, 1);
  assert.equal(b.rows.length, 1);
});

test('approx — นับยอดใบที่ไม่รู้เวลาเข้าขั้นไว้ให้จอเขียนบอก', () => {
  const rows = [
    { id: 1, status: 'checked', mtn_dept: 'production', quality_related: 'เกี่ยวกับคุณภาพ', report_at: ago(20) }, // ไม่มี check_at
    ROW({ id: 2, status: 'checked', mtn_dept: 'production', quality_related: 'เกี่ยวกับคุณภาพ', report_at: ago(20), check_at: ago(9) }),
  ];
  const b = buildMoStaleBoard(rows, { now: NOW });
  assert.equal(b.approx, 1);
  assert.equal(b.stale, 2);
});

test('ชุดคอลัมน์เวลาที่ไฟล์นี้อ่าน ต้องประกาศไว้ให้ด่านเทียบได้', () => {
  for (const c of ['report_at', 'accept_at', 'repair_done_at', 'check_at', 'qa_at', 'ho_at', 'mtn_head_at', 'approve_at']) {
    assert.ok(STALE_SINCE_COLS.includes(c), `${c} ต้องอยู่ใน STALE_SINCE_COLS`);
  }
  assert.ok(!STALE_SINCE_COLS.includes('report_at2'));
});

test('ชุดว่าง / ค่าขยะ — ไม่พัง และไม่โชว์ 0 แบบโกหก', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    const b = buildMoStaleBoard(bad, { now: NOW });
    assert.equal(b.open, 0);
    assert.equal(b.oldest, null);
    assert.deepEqual(b.byStage, []);
  }
});
