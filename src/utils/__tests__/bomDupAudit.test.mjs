import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditBomDupes, applyDupReviews, dupProgress,
  dupFingerprint, dupKeyOf, dupRank, DUP_VERDICTS,
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
