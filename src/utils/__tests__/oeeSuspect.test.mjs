/* เทสกฎ "ของสงสัยยังไม่ใช่ของเสีย จนกว่า QA จะตัดสิน"  (2026-09-30 · คำสั่ง user)
   ⚠️ เคส/ตัวเลขถอดจากข้อมูลจริงที่วัดวันที่เขียน ไม่ใช่ตัวอย่างสมมติ
      - Line 60 กะ 21/07: สงสัย 12 ชิ้น เขียน "รอพิจารณา" ยังไม่มีใบถัง → ถึง 30/09 ยังรออยู่
      - ทั้งฐาน: ของสงสัย 71 ชิ้น 4 ใบ · 3 ใบไม่เคยลงถัง · ผลพิจารณา QA = 0 ใบตลอดประวัติ */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suspectState, isSuspectPending, defectQty, defectQtyAll, suspectPendingQty,
  sumDefectQty, splitDefectQty, sumSuspectPending, QBIN_EMBED,
} from '../oee.js';

const row = (o) => ({ qty_ng: 0, qty_suspect: 0, ...o });
/** แถวที่ "ถามทะเบียนถังมาแล้ว" แต่ยังไม่มีใบ = [] */
const asked = (o) => row({ quality_bin_records: [], ...o });

// ── แยก "ยังไม่ตัดสิน" ออกจาก "ไม่ได้ถามมา" ────────────────────────────────
test('🔴 ไม่มี key ทะเบียนถัง = คิวรีไม่ได้ถาม ⇒ unknown + คงพฤติกรรมเดิม (ห้ามเปลี่ยนเลขเงียบๆ)', () => {
  const d = row({ qty_ng: 3, qty_suspect: 12 });
  assert.equal(suspectState(d), 'unknown');
  assert.equal(defectQty(d), 15);            // เท่าเดิมก่อนแก้
  assert.equal(suspectPendingQty(d), 0);     // ตอบไม่ได้ ≠ รอพิจารณา
  assert.equal(splitDefectQty([d]).unknown, true);
});

test('🔴 ถามแล้วแต่ยังไม่มีใบถัง = รอพิจารณา ⇒ กันออกจาก %Q (เคสจริง Line 60 21/07)', () => {
  const d = asked({ qty_suspect: 12 });
  assert.equal(suspectState(d), 'pending');
  assert.equal(isSuspectPending(d), true);
  assert.equal(defectQty(d), 0);             // ← หัวใจของการแก้
  assert.equal(suspectPendingQty(d), 12);
});

test('🔴 NG นับเสมอ ไม่ว่าของสงสัยจะค้างอยู่หรือไม่', () => {
  assert.equal(defectQty(asked({ qty_ng: 5, qty_suspect: 12 })), 5);
});

test('มีใบถังแต่ QA ยังไม่ตัดสิน = ยังรอพิจารณา', () => {
  const d = row({ qty_suspect: 12, quality_bin_records: [{ id: 'y1', bin: 'yellow', qa_decision: null, return_date: null }] });
  assert.equal(suspectState(d), 'pending');
  assert.equal(defectQty(d), 0);
});

// ── ผลพิจารณา 4 ทาง (WI-PD3-069 §5.4) ─────────────────────────────────────
test('🔴 QA ตัดสิน "ทำลาย" = เสียจริง ⇒ นับเข้า %Q', () => {
  const d = row({ qty_suspect: 12, quality_bin_records: [{ id: 'y1', bin: 'yellow', qa_decision: 'scrap' }] });
  assert.equal(suspectState(d), 'scrap');
  assert.equal(defectQty(d), 12);
  assert.equal(suspectPendingQty(d), 0);
});

test('🔴 ส่งซ่อมแต่ QA ยังไม่ตรวจรับ = ยังรอ (ซ่อมอาจไม่ผ่าน) · ตรวจรับแล้ว = เคลียร์', () => {
  const d = row({ qty_suspect: 12, quality_bin_records: [{ id: 'y1', bin: 'yellow', qa_decision: 'repair' }] });
  assert.equal(suspectState(d), 'pending');
  d.quality_bin_records[0].return_date = '2026-11-10';
  assert.equal(suspectState(d), 'cleared');
  const n = row({ qty_ng: 1, quality_bin_records: [{ id: 'y1', bin: 'yellow', qty: 1, qa_decision: 'repair' }] });
  assert.equal(defectQty(n), 0);
  assert.equal(suspectPendingQty(n), 1);
});
for (const dec of ['good', 'use_as_is']) {
  test(`QA ตัดสิน "${dec}" = ไม่ใช่ของเสีย ⇒ ไม่นับเข้า %Q`, () => {
    const d = row({ qty_suspect: 12, quality_bin_records: [{ id: 'y1', bin: 'yellow', qa_decision: dec }] });
    assert.equal(suspectState(d), 'cleared');
    assert.equal(defectQty(d), 0);
  });
}

test('กลับเข้ากระบวนการแล้ว (return_date) = เคลียร์ แม้ไม่มีผล QA ในช่อง', () => {
  const d = row({ qty_suspect: 1, quality_bin_records: [{ id: 'y1', bin: 'yellow', return_date: '2026-09-23' }] });
  assert.equal(suspectState(d), 'cleared');
  assert.equal(defectQty(d), 0);
});

test('🔴 ย้ายลงถังแดงแล้ว = ยืนยันเสีย ⇒ นับเข้า %Q แม้ช่องผล QA ว่าง', () => {
  const d = row({ qty_suspect: 4, quality_bin_records: [
    { id: 'y1', bin: 'yellow', qa_decision: null },
    { id: 'r1', bin: 'red', from_yellow_id: 'y1' },
  ] });
  assert.equal(suspectState(d), 'scrap');
  assert.equal(defectQty(d), 4);
});

test('🔴 ลง 2 ถังพร้อมกัน (แดงจาก NG + เหลืองจากสงสัย) — ใบแดงตรงไม่ใช่คำตัดสินของสงสัย (QC 05/10)', () => {
  const d = row({ qty_ng: 3, qty_suspect: 5, quality_bin_records: [
    { id: 'r1', bin: 'red', from_yellow_id: null },
    { id: 'y1', bin: 'yellow', qa_decision: null },
  ] });
  assert.equal(suspectState(d), 'pending');
  assert.equal(defectQty(d), 3);
  d.quality_bin_records[1].qa_decision = 'good';
  assert.equal(suspectState(d), 'cleared');
  assert.equal(defectQty(d), 3);
});

test('ไม่มีใบเหลืองเลย แล้วลงแดงตรง = ของสงสัยถูกทิ้ง ⇒ ยังนับเสีย (พฤติกรรมเดิม)', () => {
  const d = row({ qty_suspect: 4, quality_bin_records: [{ id: 'r1', bin: 'red', from_yellow_id: null }] });
  assert.equal(suspectState(d), 'scrap');
});

test('ใบที่ถูกลบ (is_active=false) ห้ามมีสิทธิ์ตัดสิน', () => {
  const d = row({ qty_suspect: 4, quality_bin_records: [{ id: 'r1', bin: 'red', from_yellow_id: null, is_active: false }] });
  assert.equal(suspectState(d), 'pending');
  assert.equal(defectQty(d), 0);
});

test('ตัดสินขัดกันหลายใบ — "ทำลาย" ชนะ (ปลอดภัยฝั่งลูกค้า ห้ามปล่อยของเสียผ่าน)', () => {
  const d = row({ qty_suspect: 6, quality_bin_records: [
    { id: 'y1', bin: 'yellow', qa_decision: 'good' },
    { id: 'y2', bin: 'yellow', qa_decision: 'scrap' },
  ] });
  assert.equal(suspectState(d), 'scrap');
  assert.equal(defectQty(d), 6);
});

// ── ของกลาง 2 ตัวห้ามสลับ ─────────────────────────────────────────────────
test('🔴 defectQtyAll (พาเรโต/มูลค่า) เห็นของสงสัยเสมอ · defectQty (%Q) ไม่เห็นตอนยังไม่ตัดสิน', () => {
  const d = asked({ qty_ng: 2, qty_suspect: 12 });
  assert.equal(defectQtyAll(d), 14);
  assert.equal(defectQty(d), 2);
});

test('แถวไม่มีของสงสัยเลย = none · 2 ตัวให้ผลเท่ากัน', () => {
  const d = asked({ qty_ng: 7 });
  assert.equal(suspectState(d), 'none');
  assert.equal(defectQty(d), 7);
  assert.equal(defectQtyAll(d), 7);
});

// ── ระดับชุดข้อมูล ────────────────────────────────────────────────────────
test('sumDefectQty — งานทดลองยังถูกกันออกเหมือนเดิม และของสงสัยที่ค้างไม่ถูกนับ', () => {
  const rows = [
    asked({ qty_ng: 10 }),
    asked({ qty_suspect: 12 }),                                   // ค้าง → ไม่นับ
    asked({ qty_ng: 5, is_trial: true }),                         // งานทดลอง → ไม่เข้า line
    row({ qty_suspect: 6, quality_bin_records: [{ id: 'y', bin: 'yellow', qa_decision: 'scrap' }] }),
  ];
  assert.equal(sumDefectQty(rows, 'line'), 16);
  assert.equal(sumDefectQty(rows, 'all'), 21);
  assert.equal(sumSuspectPending(rows), 12);
});

test('🔴 splitDefectQty — pending แยกออกจาก all/line/trial (ยังไม่รู้ว่าเสียไหม)', () => {
  const r = splitDefectQty([asked({ qty_ng: 10 }), asked({ qty_suspect: 12 }), asked({ qty_ng: 5, is_trial: true })]);
  assert.deepEqual(r, { all: 15, line: 10, trial: 5, pending: 12, unknown: false });
});

test('splitDefectQty — ชุดว่าง/ไม่ใช่ array ต้องไม่ throw', () => {
  assert.deepEqual(splitDefectQty([]), { all: 0, line: 0, trial: 0, pending: 0, unknown: false });
  assert.deepEqual(splitDefectQty(undefined), { all: 0, line: 0, trial: 0, pending: 0, unknown: false });
});

test('รับ embed แบบ object เดี่ยว (ไม่ใช่ array) ได้ ไม่ throw', () => {
  const d = row({ qty_suspect: 3, quality_bin_records: { id: 'y', bin: 'yellow', qa_decision: 'scrap' } });
  assert.equal(defectQty(d), 3);
});

test('QBIN_EMBED ต้องมีทุกคอลัมน์ที่กฎใช้ตัดสิน (ขาดตัวใดตัวหนึ่ง = ตัดสินผิดเงียบ)', () => {
  for (const col of ['id', 'bin', 'qa_decision', 'return_date', 'from_yellow_id', 'is_active']) {
    assert.ok(QBIN_EMBED.includes(col), `QBIN_EMBED ขาด ${col}`);
  }
});

// ── §7.2 NG ที่อยู่ในถังเหลือง (2026-11-10 · คำสั่ง user) ───────────────────────
// ตัวอย่างของ user: ผลิต(ดี) 399 · ลงเสีย 1 → แท็กเหลืองอัตโนมัติครอบ 1 ชิ้น
const Y = (o) => ({ id: 'y1', bin: 'yellow', qty: 1, qa_decision: null, return_date: null, ...o });
test('🔴 §7.2 NG ในถังเหลืองรอพิจารณา = ยังไม่หัก %Q + นับเป็น "รอพิจารณา"', () => {
  const d = row({ qty_ng: 1, quality_bin_records: [Y()] });
  assert.equal(defectQty(d), 0);
  assert.equal(suspectPendingQty(d), 1);
  assert.equal(defectQtyAll(d), 1);                 // %P/พาเรโต ยังเห็นเหมือนเดิม
});
for (const dec of ['good', 'repair', 'use_as_is']) {
  test(`🔴 §7.2 NG ที่ QA ตัดสิน "${dec}" = ไม่หัก %Q`, () => {
    const d = row({ qty_ng: 1, quality_bin_records: [Y({ qa_decision: dec, ...(dec === 'repair' ? { return_date: '2026-11-10' } : {}) })] });
    assert.equal(defectQty(d), 0);
    assert.equal(suspectPendingQty(d), 0);
  });
}
test('🔴 §7.2 ทำลาย / ย้ายลงแดง = หัก', () => {
  assert.equal(defectQty(row({ qty_ng: 1, quality_bin_records: [Y({ qa_decision: 'scrap' })] })), 1);
  const d = row({ qty_ng: 3, quality_bin_records: [Y({ qty: 3 }), { id: 'r1', bin: 'red', from_yellow_id: 'y1', qty: 3 }] });
  assert.equal(defectQty(d), 3);
});
test('🔴 §7.2 ซ่อม 5 ชิ้น ดี 3 NG 2 → หักแค่ 2 (ทั้งก่อนและหลังย้าย NG ลงแดง)', () => {
  const y = Y({ qty: 5, qa_decision: 'repair', qty_ng: 2, return_date: '2026-11-10' });
  assert.equal(defectQty(row({ qty_ng: 5, quality_bin_records: [y] })), 2);
  assert.equal(defectQty(row({ qty_ng: 5, quality_bin_records: [y, { id: 'r1', bin: 'red', from_yellow_id: 'y1', qty: 2 }] })), 2);
});
test('🔴 §7.2 ใบเหลืองไม่ครอบ NG / NG ลงแดงตรง / ไม่ได้ถาม = พฤติกรรมเดิม (NG นับ)', () => {
  // ใบเหลืองครอบแค่ของสงสัย (โมดัลลงถังแบบเก่า)
  assert.equal(defectQty(row({ qty_ng: 3, qty_suspect: 2, quality_bin_records: [Y({ qty: 2, qa_decision: 'good' })] })), 3);
  // NG ลงแดงตรง
  assert.equal(defectQty(row({ qty_ng: 3, qty_suspect: 5, quality_bin_records: [
    { id: 'r1', bin: 'red', from_yellow_id: null, qty: 3 }, Y({ qty: 8 })] })), 3);
  // ยังไม่มีใบถัง (แถวก่อน 05/11)
  assert.equal(defectQty(asked({ qty_ng: 4 })), 4);
  assert.equal(defectQty(row({ qty_ng: 4 })), 4);
});
test('§7.2 ใบเหลืองซ้ำนับเกิน = ตัดส่วนเกินจาก "รอ" ก่อน ห้ามเกินชิ้นของแถว', () => {
  const d = row({ qty_ng: 2, quality_bin_records: [Y({ qty: 2, qa_decision: 'scrap' }), Y({ id: 'y2', qty: 2 })] });
  assert.equal(defectQty(d), 2);
  assert.equal(suspectPendingQty(d), 0);
});
test('§7.2 ตัวอย่าง user: ผลิต 399 + NG 1 → Q = 100% ระหว่างรอ/ซ่อมดี · 399/400 เมื่อทำลาย', () => {
  const q = (dec) => { const ng = sumDefectQty([row({ qty_ng: 1, quality_bin_records: [Y({ qa_decision: dec })] })]); return 399 / (399 + ng); };
  assert.equal(q(null), 1);
  assert.equal(q('repair'), 1);   // ส่งซ่อม = ยังรอ → ไม่หัก
  assert.equal(q('scrap'), 399 / 400);
});
