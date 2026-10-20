import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditBomDupes, applyDupReviews, dupProgress,
  dupFingerprint, dupKeyOf, dupRank, DUP_VERDICTS,
  auditBomSheetGroups, groupRank, isHotPair,
} from '../bomDupAudit.js';

/* ตัวช่วยสร้างแถว bom_items แบบย่อ */
const R = (product_id, mat_no, parent_mat = null) => ({ product_id, mat_no, parent_mat, qty_per_unit: 1 });

/* ── โครงที่ถอดจาก **ใบจริง** 10105772 → 20070036 (วัดจากฐาน DR 06/10) ──────────────
   ใบ FG จัดลูกของ 20070036 ไว้เอง 12 บรรทัด · ใบของ 20070036 เองมี 11 บรรทัด
   ต่างกัน 3: ใบ FG เกิน 30054973/30054974 (RB3B) · ใบ sub เกิน 20066630 (MB3B คนละรุ่น)  */
const REAL = {
  matOf: { pFG: '10105772', pSUB: '20070036', pMB: '20066630' },
  rows: [
    R('pFG', '20070035'), R('pFG', '20070036', '20070035'),
    ...['30044771', '30043726', '30042585', '30047567', '30047529',
      '30054973', '30054974', '50031625', '20058490', '20058491',
      '30047580', '30047582'].map(m => R('pFG', m, '20070036')),
    // ใบของ 20070036 เอง — ชุดลูกชั้น 1 (ไม่มี 30054973/74 · มี 20066630 เพิ่ม)
    ...['30044771', '30043726', '30042585', '30047567', '30047529',
      '50031625', '20058490', '20058491', '30047580', '30047582',
      '20066630'].map(m => R('pSUB', m)),
    // ใบของ 20066630 เอง
    ...['30052452', '30052453', '50029377'].map(m => R('pMB', m)),
  ],
};

test('เคสจริง 10105772 → 20070036 = ขัดกันจริง · ชี้ตัวที่ต่างได้ถูกทั้ง 2 ฝั่ง', () => {
  const { pairs } = auditBomDupes(REAL.rows, REAL.matOf);
  const p = pairs.find(x => x.sheetMat === '10105772' && x.mat === '20070036');
  assert.ok(p, 'ต้องเจอคู่นี้');
  assert.equal(p.verdict, 'conflict');
  assert.equal(p.same, 10);
  assert.deepEqual([...p.onlyHere].sort(), ['30054973', '30054974']);
  assert.deepEqual(p.onlyOwn, ['20066630']);
  // 🔴 ของที่หายจากการระเบิด = ตัวที่มีแต่ในใบของพาร์ทเอง
  assert.deepEqual(p.missingFromExplode, ['20066630']);
});

test('🔴 ใบแม่เป็นชุดย่อย = subset และต้องร้อนกว่า conflict (ของหายจากการระเบิดจริง)', () => {
  const rows = [
    R('pA', 'SUB'), R('pA', 'NUT', 'SUB'),                       // ใบ A ให้ SUB มีลูกแค่ NUT
    R('pS', 'NUT'), R('pS', 'BOLT'), R('pS', 'COIL'),            // ใบของ SUB มี 3 ตัว
  ];
  const { pairs, counts } = auditBomDupes(rows, { pA: 'FG', pS: 'SUB' });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].verdict, 'subset');
  assert.deepEqual([...pairs[0].missingFromExplode].sort(), ['BOLT', 'COIL']);
  assert.equal(counts.missingMats, 2);
  assert.ok(dupRank('subset') < dupRank('conflict'), 'subset ต้องมาก่อน conflict');
});

test('ตรงกันทุกตัว = identical (ยังต้องโชว์ — แก้ใบเดียวแล้วอีกใบค้างคือกับดักถัดไป)', () => {
  const rows = [R('pA', 'SUB'), R('pA', 'NUT', 'SUB'), R('pS', 'NUT')];
  const { pairs } = auditBomDupes(rows, { pA: 'FG', pS: 'SUB' });
  assert.equal(pairs[0].verdict, 'identical');
  assert.equal(pairs[0].same, 1);
  assert.deepEqual(pairs[0].missingFromExplode, []);
});

/* เคสจริง 10092454 → 20059852: ใบ FG เขียนขั้น "ก่อนชุบ" · ใบของพาร์ทเขียนชุดวัตถุดิบ
   ของที่ใบนั้นเกิน อยู่ใต้ตัวที่ใบนี้เกินอีกชั้น ⇒ ไม่ขัดกัน */
test('ลึกกว่า 1 ขั้น (โซ่ตรงกัน) = deeper ไม่ใช่ conflict', () => {
  const rows = [
    R('pF', 'PLT'), R('pF', 'PLT_PRE', 'PLT'),        // ใบ FG: PLT → PLT_PRE (ก่อนชุบ)
    R('pP', 'MOUNT'), R('pP', 'WELD'),                // ใบของ PLT: MOUNT + WELD
    R('pPre', 'MOUNT'), R('pPre', 'WELD'),            // ใบของ PLT_PRE: ตัวเดียวกัน (อยู่ลึกกว่า 1 ขั้น)
  ];
  const { pairs } = auditBomDupes(rows, { pF: 'FG', pP: 'PLT', pPre: 'PLT_PRE' });
  const p = pairs.find(x => x.mat === 'PLT');
  assert.equal(p.verdict, 'deeper');
});

test('ไล่โซ่ลึกกว่า 1 ชั้นก็ยังเป็น deeper (ของจริงลึกได้ถึง 4 ชั้น)', () => {
  const rows = [
    R('pF', 'A'), R('pF', 'B', 'A'),
    R('pA', 'D'),                                      // ใบของ A มี D
    R('pB', 'C'), R('pC', 'D'),                        // B → C → D
  ];
  const { pairs } = auditBomDupes(rows, { pF: 'FG', pA: 'A', pB: 'B', pC: 'C' });
  assert.equal(pairs.find(x => x.mat === 'A').verdict, 'deeper');
});

test('🔴 ใบขั้นงาน (OP) = op · ห้ามนับเป็นของหาย (คนละคำถามกับใบพาร์ท)', () => {
  const rows = [
    R('pOP', 'PART'), R('pOP', 'NUT_M6', 'PART'),      // ใบขั้นงาน: ขั้นนี้กินนัท M6
    R('pPart', 'COIL'),                                // ใบของพาร์ท: ทำจากคอยล์
  ];
  const { pairs, counts } = auditBomDupes(rows, { pOP: 'E025 (M6)', pPart: 'PART' },
    { isOpSheet: (id) => id === 'pOP' });
  assert.equal(pairs[0].verdict, 'op');
  assert.deepEqual(pairs[0].missingFromExplode, [], 'ใบ OP ห้ามถูกนับว่าทำของหาย');
  assert.equal(counts.missingMats, 0);
  // ไม่ส่ง isOpSheet = ถือว่าเป็นใบพาร์ททั้งหมด (พฤติกรรมเดิม) ⇒ กลายเป็น conflict
  const { pairs: p2 } = auditBomDupes(rows, { pOP: 'E025 (M6)', pPart: 'PART' });
  assert.equal(p2[0].verdict, 'conflict');
});

test('ใบนี้มีเกิน (ใบของพาร์ทขาด) = extra — ต้องไม่ถูกกลืนเป็น conflict', () => {
  const rows = [
    R('pA', 'SUB'), R('pA', 'NUT', 'SUB'), R('pA', 'EXTRA', 'SUB'),
    R('pS', 'NUT'),
  ];
  const { pairs } = auditBomDupes(rows, { pA: 'FG', pS: 'SUB' });
  assert.equal(pairs[0].verdict, 'extra');
  assert.deepEqual(pairs[0].onlyHere, ['EXTRA']);
  assert.deepEqual(pairs[0].missingFromExplode, []);
});

test('ไม่มีใบของตัวเอง / ใบของตัวเองว่าง = ไม่ใช่คู่ (ห้ามพ่นแถวลวงให้ PE ไล่)', () => {
  const rows = [R('pA', 'SUB'), R('pA', 'NUT', 'SUB')];
  assert.equal(auditBomDupes(rows, { pA: 'FG' }).pairs.length, 0, 'ไม่มีใบของ SUB');
  assert.equal(auditBomDupes(rows, { pA: 'FG', pS: 'SUB' }).pairs.length, 0, 'ใบของ SUB ว่าง');
});

test('เรียงให้ของร้อนขึ้นก่อน + ชนิดที่ไม่รู้จักไปท้ายสุด ห้ามหาย', () => {
  const rows = [
    R('p1', 'X'), R('p1', 'N1', 'X'),                  // identical
    R('pX', 'N1'),
    R('p2', 'Y'), R('p2', 'N2', 'Y'),                  // subset
    R('pY', 'N2'), R('pY', 'N3'),
  ];
  const { pairs } = auditBomDupes(rows, { p1: 'F1', pX: 'X', p2: 'F2', pY: 'Y' });
  assert.deepEqual(pairs.map(p => p.verdict), ['subset', 'identical']);
  assert.equal(dupRank('ชนิดที่ไม่เคยมี'), 99);
  assert.ok(DUP_VERDICTS.other, 'ต้องมีตะกร้ารับท้ายลิสต์');
});

/* ── ลายนิ้วมือ + ผลตรวจที่คนบันทึก ───────────────────────────────────────────────── */

test('ลายนิ้วมือไม่ขึ้นกับลำดับแถว (ลำดับจาก DB ไม่คงที่) แต่เปลี่ยนเมื่อชุดลูกเปลี่ยน', () => {
  assert.equal(dupFingerprint(['A', 'B'], ['C']), dupFingerprint(['B', 'A'], ['C']));
  assert.notEqual(dupFingerprint(['A', 'B'], ['C']), dupFingerprint(['A'], ['C']));
  assert.notEqual(dupFingerprint(['A'], ['C']), dupFingerprint(['A'], ['C', 'D']));
  // ห้ามสลับฝั่งแล้วได้ค่าเท่ากัน (ใบนี้เกิน ≠ ใบนั้นเกิน)
  assert.notEqual(dupFingerprint(['A'], ['B']), dupFingerprint(['B'], ['A']));
});

test('dupKeyOf ไม่สนตัวพิมพ์/ช่องว่าง (คีย์ upsert ฝั่ง DB ใช้ตัวนี้)', () => {
  assert.equal(dupKeyOf(' 10105772 ', 'abc'), '10105772|ABC');
});

test('🔴 ตรวจแล้วแต่ BOM เปลี่ยนทีหลัง = ยังไม่เคลียร์ (staleReview) ห้ามถือว่าจบ', () => {
  const { pairs } = auditBomDupes(REAL.rows, REAL.matOf);
  const p = pairs.find(x => x.mat === '20070036');

  const fresh = applyDupReviews(pairs, [{
    sheet_mat: '10105772', component_mat: '20070036', fingerprint: p.fingerprint, decision: 'ok_both',
  }]);
  const okRow = fresh.find(x => x.mat === '20070036');
  assert.equal(okRow.cleared, true);
  assert.equal(okRow.staleReview, false);

  const stale = applyDupReviews(pairs, [{
    sheet_mat: '10105772', component_mat: '20070036', fingerprint: 'deadbeef', decision: 'ok_both',
  }]);
  const staleRow = stale.find(x => x.mat === '20070036');
  assert.equal(staleRow.cleared, false, 'ข้อมูลเปลี่ยนหลังตรวจ = ต้องกลับมาเข้าคิว');
  assert.equal(staleRow.staleReview, true);
  assert.ok(staleRow.review, 'ยังต้องบอกว่าเคยตรวจไว้ว่าอะไร ห้ามทิ้งเงียบ');
});

test('applyDupReviews — ไม่มีผลตรวจ / ผลตรวจของคู่อื่น ต้องไม่ติดมาผิดคู่', () => {
  const { pairs } = auditBomDupes(REAL.rows, REAL.matOf);
  assert.ok(applyDupReviews(pairs, []).every(p => !p.cleared && !p.review));
  const other = applyDupReviews(pairs, [{ sheet_mat: 'ZZZ', component_mat: 'YYY', fingerprint: 'x' }]);
  assert.ok(other.every(p => !p.review));
  // แถวผลตรวจที่ไม่มีคีย์ ห้ามทำให้ระเบิด
  assert.doesNotThrow(() => applyDupReviews(pairs, [{}, null]));
});

test('dupProgress — นับเหลือ/เคลียร์แล้ว/ต้องตรวจซ้ำ/ของร้อนที่ยังไม่แตะ', () => {
  /* "ของร้อน" = rank ≤ 4 (subset · qty_diff · conflict · pair_shot) — ขยับจาก ≤3 ตอน qty เข้ากติกา 14/10
     ⚠️ ตัวเลข rank ที่นี่เป็นค่าสมมติ ไม่ใช่ verdict จริง — ตั้งใจให้คร่อมเส้นแบ่งพอดี */
  const pairs = [
    { rank: 1, cleared: false, staleReview: false },   // ร้อน · ยังไม่แตะ
    { rank: 2, cleared: true,  staleReview: false },   // ร้อน แต่ตรวจแล้ว = ไม่นับ
    { rank: 4, cleared: false, staleReview: true },    // ร้อน (เส้นแบ่งพอดี) · ต้องตรวจซ้ำ
    { rank: 5, cleared: false, staleReview: false },   // ไม่ร้อน
  ];
  assert.deepEqual(dupProgress(pairs), { total: 4, cleared: 1, stale: 1, open: 3, openHot: 2 });
  assert.deepEqual(dupProgress([]), { total: 0, cleared: 0, stale: 0, open: 0, openHot: 0 });
});

/* ── ⚖️ qty เข้าสู่กติกา (2026-10-14 · user ชี้เอง) ────────────────────────────────
   *"0.171 มันคือน้ำหนักของเหล็กม้วน/coil ... อย่างนี้คือระยะ pitch shot นึงในการปั๊ม
     ได้งานคู่แน่ๆ ถึงมีการหาร 2"*
   เคสจริง: คอยล์ 50027083 "WSS-M1A367-A33 1.7X 350XC" · ทะเบียนเขียน "1:2" ไว้เองในช่อง part_no
     ใบของ 20066663 เอง = 0.341 (ต่อ shot) · ใบ FG = 0.171 (ต่อชิ้น) · 0.341÷2 = 0.1705 → 0.171
   🔴 เดิม util เทียบแค่ "รายชื่อ MAT" ⇒ คู่นี้ถูกตีเป็น identical ("ตรงกัน") = จอโกหก        */
const QSHEET = { 'p-fg': '10100385', 'p-own': '20066663' };
const qRows = (hereQty, ownQty) => ([
  { product_id: 'p-fg', mat_no: '20066663', qty_per_unit: 1 },
  { product_id: 'p-fg', mat_no: '50027083', parent_mat: '20066663', qty_per_unit: hereQty },
  { product_id: 'p-own', mat_no: '50027083', qty_per_unit: ownQty },
]);

test('🔴 รายการตรงแต่ qty ต่าง ต้องไม่ใช่ "ตรงกัน" อีกต่อไป', () => {
  const r = auditBomDupes(qRows(0.171, 0.341), QSHEET);
  assert.equal(r.pairs.length, 1);
  assert.notEqual(r.pairs[0].verdict, 'identical');
});

test('⚖️ ต่างกันพอดี 2 เท่า = pair_shot (ชิ้น vs shot) · ของจริงปัดเศษแล้ว 1.994 ก็ต้องจับได้', () => {
  const p = auditBomDupes(qRows(0.171, 0.341), QSHEET).pairs[0];
  assert.equal(p.verdict, 'pair_shot');
  assert.deepEqual(p.qtyDiff, [{ mat: '50027083', here: 0.171, own: 0.341 }]);
  // เป๊ะ 2.000 ก็ต้องเข้าเหมือนกัน
  assert.equal(auditBomDupes(qRows(0.498, 0.996), QSHEET).pairs[0].verdict, 'pair_shot');
});

test('ต่างแบบอื่น (ไม่ใช่ 2 เท่า) = qty_diff — ตัวเลขผิดจริง ห้ามเหมารวมกับ ชิ้น/shot', () => {
  const p = auditBomDupes(qRows(1, 4), QSHEET).pairs[0];
  assert.equal(p.verdict, 'qty_diff');
  assert.equal(DUP_VERDICTS.qty_diff.tone, 'bad');
  assert.ok(DUP_VERDICTS.qty_diff.rank < DUP_VERDICTS.pair_shot.rank, 'ตัวเลขผิดต้องร้อนกว่าเรื่องหน่วย');
});

test('qty ตรงกัน = identical เหมือนเดิม (พฤติกรรมเดิมห้ามเปลี่ยน)', () => {
  assert.equal(auditBomDupes(qRows(0.341, 0.341), QSHEET).pairs[0].verdict, 'identical');
});

test('🔴 ลายนิ้วมือต้องขยับเมื่อแก้แค่ qty (ไม่งั้นคู่ที่ตรวจแล้วไม่กลับเข้าคิว)', () => {
  const a = auditBomDupes(qRows(0.341, 0.341), QSHEET).pairs[0].fingerprint;
  const b = auditBomDupes(qRows(0.171, 0.341), QSHEET).pairs[0].fingerprint;
  assert.notEqual(a, b);
});

test('แถวซ้ำของ mat เดียวกันในใบเดียวกัน = บวกกัน ไม่ใช่ทับกัน', () => {
  // 0.171 + 0.17 = 0.341 → รวมแล้วเท่าใบของพาร์ทเอง ⇒ ไม่ใช่ qty ต่าง
  const same = auditBomDupes([...qRows(0.171, 0.341),
    { product_id: 'p-fg', mat_no: '50027083', parent_mat: '20066663', qty_per_unit: 0.17 }], QSHEET).pairs[0];
  assert.deepEqual(same.qtyDiff, []);
  assert.equal(same.verdict, 'identical');
  // ถ้าไม่บวก (ทับกัน) จะได้ 0.1 แล้วตีเป็นตรงกัน — เทสนี้กันเคสนั้น
  const diff = auditBomDupes([...qRows(0.171, 0.341),
    { product_id: 'p-fg', mat_no: '50027083', parent_mat: '20066663', qty_per_unit: 0.1 }], QSHEET).pairs[0];
  assert.equal(diff.qtyDiff[0].here, 0.271);
  assert.equal(diff.verdict, 'qty_diff');
});

/* ═══ 📋 มุมมองกลุ่ม — "พาร์ทนี้ถูกนิยามลูกไว้ในใบไหนบ้าง" (ทุกใบ ไม่ใช่แค่ 2 ใบ) ════════════
   ตัวเลข/รูปทรงทุกเคสถอดจากฐาน DR จริง (วัด 19/10 ด้วย SQL) — ห้ามแก้ค่าให้เทสผ่าน
   ให้ไปแก้กติกา หรือยืนยันกับ PE ก่อนว่าข้อมูลจริงเปลี่ยน                                      */
const Q = (product_id, mat_no, parent_mat, qty_per_unit) => ({ product_id, mat_no, parent_mat, qty_per_unit });

test('🔴 พาร์ทที่ไม่มีใบของตัวเอง แต่ถูกนิยามไว้หลายใบ — ตารางคู่มองไม่เห็น มุมมองกลุ่มต้องเห็น', () => {
  /* เคสจริง 20058483: 3 ใบเขียน 50027080 ×0.038 · ใบ 20058498 เขียน ×0.076 (= 2 เท่าพอดี)
     และ 20058483 **ไม่มีใบ BOM ของตัวเอง** ⇒ auditBomDupes ข้ามทั้งหมด */
  const matOf = { s1: '10086024', s2: '10100814', s3: '10101158', s4: '20058498' };
  const rows = [
    Q('s1', '20058483', null, 1), Q('s1', '50027080', '20058483', 0.038),
    Q('s2', '20058483', null, 1), Q('s2', '50027080', '20058483', 0.038),
    Q('s3', '20058483', null, 1), Q('s3', '50027080', '20058483', 0.038),
    Q('s4', '20058483', null, 1), Q('s4', '50027080', '20058483', 0.076),
  ];
  // ① ตารางคู่เห็นเป็น 0 — นี่คือหลุมที่มุมมองกลุ่มมาปิด
  assert.equal(auditBomDupes(rows, matOf).pairs.filter(p => p.mat === '20058483').length, 0);
  // ② มุมมองกลุ่มต้องเห็น + ตีเป็น ชิ้น vs shot + บอกว่าไม่มีใบของตัวเอง
  const { groups, counts } = auditBomSheetGroups(rows, matOf);
  const g = groups.find(x => x.mat === '20058483');
  assert.ok(g, 'มุมมองกลุ่มต้องเจอพาร์ทที่ไม่มีใบของตัวเอง');
  assert.equal(g.nSheets, 4);
  assert.equal(g.hasOwn, false);
  assert.equal(g.ownSheet, null);
  assert.equal(g.verdict, 'pair_shot');
  assert.equal(g.diffs.length, 1);
  assert.equal(g.diffs[0].mat, '50027080');
  assert.equal(g.diffs[0].x2, true);
  assert.equal(g.diffs[0].missing, 0);
  assert.equal(counts.noOwn, 1);
  assert.equal(counts.threePlus, 1);
});

test('🔴 ใบที่ 3 — 2 ใบตรงกันเป๊ะ แต่ใบที่ 3 คนละค่า (เคสนัท 20059851 ที่ยอดเปลี่ยน 4→1)', () => {
  /* ใบ FG 10092454 และใบของ 20059851 เอง เขียน 30042571 ×4 ตรงกัน ⇒ ตารางคู่ว่า "ตรงกัน"
     แต่ใบของตัวกลาง 20059822 เขียน ×1 ⇒ ยุบแล้วเส้นทางไปอ่านใบนั้น = ยอดเปลี่ยนเงียบ */
  const matOf = { fg: '10092454', mid: '20059822', own: '20059851' };
  const rows = [
    Q('fg', '20059851', null, 1),
    Q('fg', '30042571', '20059851', 4), Q('fg', '30048127', '20059851', 1),
    Q('mid', '30042571', '20059851', 1), Q('mid', '30048127', '20059851', 1),
    Q('own', '30042571', null, 4), Q('own', '30048127', null, 1),
  ];
  // ① ตารางคู่: คู่ FG↔ใบของตัวเอง "ตรงกัน" — แต่ต้องติดธงว่ามีใบที่ 3
  const { pairs, counts } = auditBomDupes(rows, matOf);
  const pFg = pairs.find(p => p.sheetMat === '10092454' && p.mat === '20059851');
  assert.equal(pFg.verdict, 'identical', 'เทียบ 2 ใบนี้แล้วตรงกันจริง');
  assert.equal(pFg.hasThirdSheet, true, '🔴 ต้องเตือนว่ามีใบที่ 3 — ห้ามให้ PE ยุบจากการเทียบ 2 ใบ');
  assert.deepEqual(pFg.otherSheets.map(o => o.sheetMat), ['20059822']);
  assert.ok(counts.thirdSheet >= 1);
  // ② ลายนิ้วมือต้องต่างจากกรณีที่ไม่มีใบที่ 3 (ใบที่ 3 เปลี่ยน = ต้องกลับเข้าคิว)
  const noThird = auditBomDupes(rows.filter(r => r.product_id !== 'mid'), matOf)
    .pairs.find(p => p.sheetMat === '10092454');
  assert.notEqual(pFg.fingerprint, noThird.fingerprint);
  // ③ มุมมองกลุ่ม: เห็นทั้ง 3 ใบพร้อมกัน แล้วบอกว่าจำนวนไม่ตรง
  const g = auditBomSheetGroups(rows, matOf).groups.find(x => x.mat === '20059851');
  assert.equal(g.nSheets, 3);
  assert.equal(g.hasOwn, true);
  assert.equal(g.verdict, 'qty_diff');
  const d = g.diffs.find(x => x.mat === '30042571');
  assert.deepEqual(d.vals.map(v => v.qty).sort((a, b) => a - b), [1, 4, 4]);
  assert.equal(d.x2, false, '4 ↔ 1 ไม่ใช่ 2 เท่า ห้ามตีเป็นเรื่องหน่วย');
  assert.equal(g.diffs.length, 1, '30048127 ตรงกันทุกใบ ห้ามขึ้นเป็นของต่าง');
});

test('ต่างกัน 2 ค่าแต่ไม่ใช่ 2 เท่า = qty_diff (เคสจริง 20059362: 0.027 ↔ 1)', () => {
  const matOf = { a: '10100286', b: '20059357', c: '20059360' };
  const rows = [
    Q('a', '50026143', '20059362', 0.027),
    Q('b', '50026143', '20059362', 1),
    Q('c', '50026143', '20059362', 0.027),
  ];
  const g = auditBomSheetGroups(rows, matOf).groups.find(x => x.mat === '20059362');
  assert.equal(g.verdict, 'qty_diff');
  assert.equal(g.diffs[0].x2, false);
});

test('ใบหนึ่งเขียนของอีกตัวไปเลย = conflict (เคสจริง 20066332: 20065734 vs 30051209)', () => {
  const matOf = { a: '10100335', b: '10100401', e: 'D04' };
  const rows = [
    Q('a', '20065734', '20066332', 1),
    Q('b', '20065734', '20066332', 1),
    Q('e', '30051209', '20066332', 1),
  ];
  const g = auditBomSheetGroups(rows, matOf).groups.find(x => x.mat === '20066332');
  assert.equal(g.verdict, 'conflict');
  assert.equal(g.diffs.length, 2);
  assert.ok(g.diffs.every(d => d.missing > 0), 'ทั้ง 2 ตัวขาดจากบางใบ');
  // 🔴 qty = null คือ "ใบนั้นไม่มีของตัวนี้" ห้ามแปลงเป็น 0
  assert.ok(g.diffs[0].vals.some(v => v.qty === null));
});

test('ทุกใบตรงกัน = agree (ยังโชว์ — แก้ใบเดียวแล้วใบอื่นค้างคือกับดักถัดไป)', () => {
  const matOf = { fg: 'FG1', own: 'SUB1' };
  const rows = [Q('fg', 'NUT', 'SUB1', 2), Q('own', 'NUT', null, 2)];
  const { groups, counts } = auditBomSheetGroups(rows, matOf);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].verdict, 'agree');
  assert.equal(groups[0].diffs.length, 0);
  assert.equal(counts.open, 0, 'ตรงกันหมด = ไม่นับเป็นงานค้าง');
});

test('🔴 ใบขั้นงาน (OP) ไม่เอาเข้าเทียบ แต่ต้องลิสต์ไว้ให้เห็น ห้ามซ่อน', () => {
  const matOf = { fg: 'FG1', op: 'OP10', own: 'SUB1' };
  const rows = [
    Q('fg', 'NUT', 'SUB1', 2),
    Q('op', 'COIL', 'SUB1', 0.5),            // ใบขั้นงานตอบคนละคำถาม
    Q('own', 'NUT', null, 2),
  ];
  const { groups } = auditBomSheetGroups(rows, matOf, { isOpSheet: (id) => id === 'op' });
  const g = groups.find(x => x.mat === 'SUB1');
  assert.equal(g.nSheets, 2, 'ใบ OP ไม่นับเป็นใบที่เทียบ');
  assert.equal(g.verdict, 'agree', 'ถ้าเอาใบ OP มาเทียบจะกลายเป็น conflict ปลอม');
  assert.deepEqual(g.opSheets.map(s => s.sheetMat), ['OP10'], 'แต่ต้องยังเห็นว่ามีใบ OP');
});

test('นิยามไว้ใบเดียว = ไม่มีกลุ่ม (ห้ามพ่นแถวลวงให้ PE ไล่)', () => {
  const matOf = { own: 'SUB1' };
  const rows = [Q('own', 'NUT', null, 1)];
  assert.equal(auditBomSheetGroups(rows, matOf).groups.length, 0);
});

test('กลุ่มเรียงของร้อนขึ้นก่อน · ใบมากกว่ามาก่อนเมื่อร้อนเท่ากัน', () => {
  assert.ok(groupRank('conflict') < groupRank('qty_diff'));
  assert.ok(groupRank('qty_diff') < groupRank('pair_shot'));
  assert.ok(groupRank('pair_shot') < groupRank('agree'));
  assert.equal(groupRank('ชนิดที่ยังไม่รู้จัก'), 99, 'ชนิดไม่รู้จักไปท้ายสุด ห้ามหาย');
});

test('🔥 เส้นแบ่งของร้อนมีที่เดียว — isHotPair ต้องตรงกับตัวนับหัวจอ', () => {
  const mk = (verdict, cleared = false) => ({ verdict, rank: dupRank(verdict), cleared });
  const pairs = [mk('subset'), mk('qty_diff'), mk('conflict'), mk('pair_shot'),
    mk('extra'), mk('identical'), mk('deeper'), mk('op'), mk('subset', true)];
  assert.equal(dupProgress(pairs).openHot, pairs.filter(isHotPair).length);
  assert.equal(dupProgress(pairs).openHot, 4);
  assert.equal(isHotPair(mk('subset', true)), false, 'ตรวจแล้ว = ไม่ร้อนอีก');
});
