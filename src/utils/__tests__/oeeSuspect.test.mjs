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

for (const dec of ['good', 'repair', 'use_as_is']) {
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
  for (const col of ['id', 'bin', 'qa_decision', 'return_date', 'from_yellow_id']) {
    assert.ok(QBIN_EMBED.includes(col), `QBIN_EMBED ขาด ${col}`);
  }
});
