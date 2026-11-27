/* ══ 🔴 "ยอดผลิต" = ทุกชิ้นที่เครื่องทำออกมา · %Q = งานดี ÷ ยอดผลิต (oee.js §7.2.2) ═══════════
   คำสั่ง user 25/11: *"ยอดผลิตไม่ใช่ `qty_ok` นะ ยอดผลิต = งานดี + งานต้องสงสัย"* + ตัวอย่างเต็ม:
     *"ผลิตได้งาน 100 มีต้องสงสัย 5 งานดีเหลือ 95 · หลังจากนั้นงานต้องสงสัยถูกซ่อมได้ 3 ไม่ได้ 2
       ต้องทิ้ง · งานดีที่จะได้จากกะนี้จริงๆ ก็จะเป็น 98 งานเสีย 2 **แต่ยอดผลิตที่ออกจากกะนี้
       ก็ยังควรนับว่าผลิตได้ 100 ชิ้น** แต่ดี 98 เสีย 2"*

   เทสนี้ตรึงตัวอย่างนั้นทั้งก้อน — ทุกบรรทัดคือเลขที่ user พูดเอง                             */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  producedTotalCount, qTotalCount, qRatio, sumDefectQty,
  computeSessionOee, computeLiveOee, suspectPendingQty,
} from '../oee.js';
import { restampQPatch } from '../restampQ.js';

const CT = 60;
const products = [{ mat_no: 'M1', cycle_time_sec: CT, name: 'พาร์ททดสอบ', p_no: 'P-1' }];
const session = { id: 'S1', work_date: '2026-11-24', shift: 'day', line_name: 'Assy GOR', start_time: '08:00:00' };
/** สแกนได้ 95 ชิ้น (การ์ด = ของดีล้วน) */
const orders = [{ id: 'O1', mat_no: 'M1', status: 'confirmed', qty: 95, qty_ok: 95, qty_actual: 95,
  opened_at: '2026-11-24T08:00:00+07:00', confirmed_at: '2026-11-24T17:30:00+07:00' }];

/** ใบของเสีย 1 ใบ: ของสงสัย 5 ชิ้น · `bins` = ใบถังที่ครอบมัน */
const susRow = (bins) => ({ id: 'D1', prod_order_id: 'O1', qty_ng: 0, qty_suspect: 5, qty_repair: 0,
  prod_orders: { mat_no: 'M1' }, quality_bin_records: bins });
const yellow = (over = {}) => ({ id: 'Y1', bin: 'yellow', qty: 5, qa_decision: null,
  return_date: null, from_yellow_id: null, is_active: true, ...over });
const red = (qty, over = {}) => ({ id: 'R1', bin: 'red', qty, from_yellow_id: 'Y1', is_active: true, ...over });

const runOee = (defects) => computeSessionOee({
  session, orders, defects, products, kanbanStds: [], breakPolicies: [], endTime: '17:30',
});

test('① ยอดผลิต = 100 (ไม่ใช่ 95) — ของสงสัยเป็นชิ้นที่เครื่องทำออกมาแล้ว', () => {
  const d = [susRow([yellow()])];
  assert.equal(producedTotalCount(95, d), 100, 'user: "ผลิตได้งาน 100"');
  assert.equal(qTotalCount(95, d), 100);
  /* รับได้ทั้งแถวดิบ และผลของ ngByMatFrom (จอสดไม่มีแถวดิบในมือ) */
  assert.equal(producedTotalCount(95, { byMat: { M1: 5 }, noMat: 0 }), 100);
  assert.equal(producedTotalCount(95, { byMat: {}, noMat: 5 }), 100, 'ของเสียที่ชี้ MAT ไม่ได้ ก็เป็นยอดผลิต');
  assert.equal(producedTotalCount(95, []), 95, 'ไม่มีของเสีย = เท่ายอดสแกน');
});

test('② ตอนปิดกะ (QA ยังไม่ตัดสิน) — ดี 95 · รอพิจารณา 5 · %Q ยัง 100 ห้ามหักล่วงหน้า', () => {
  const d = [susRow([yellow()])];
  const r = runOee(d);
  assert.equal(r.totalProduced, 95, 'ยอดสแกน (= `actual_qty` ที่ stamp ลงฐาน) ยังเป็น 95');
  assert.equal(sumDefectQty(d, 'line'), 0, 'ของสงสัยที่รอ QA ยังไม่ใช่ของเสีย');
  assert.equal(suspectPendingQty(d[0]), 5, 'จอต้องเขียนว่ารอพิจารณา 5 ชิ้น');
  assert.equal(r.Q, 1, '%Q = (100 − 0) / 100 — `computeSessionOee` คืนเป็นสัดส่วน 0..1');
});

test('③ QA ตัดสิน: ซ่อมได้ 3 ทิ้ง 2 ⇒ ดี 98 · เสีย 2 · ยอดผลิตยัง 100 · %Q = 98', () => {
  /* ใบเหลือง 5 ชิ้น QA ตรวจรับแล้ว (return_date) แต่มีใบแดงแยกออกไป 2 ชิ้น ⇒ ซ่อมผ่าน 3 เสีย 2 */
  const d = [susRow([yellow({ return_date: '2026-11-25' }), red(2)])];
  assert.equal(producedTotalCount(95, d), 100, 'user: "ยอดผลิตที่ออกจากกะนี้ก็ยังควรนับว่า 100"');
  assert.equal(sumDefectQty(d, 'line'), 2, 'user: "งานเสีย 2"');
  assert.equal(suspectPendingQty(d[0]), 0, 'ตัดสินครบแล้ว = ไม่ค้างบนจอ');

  const r = runOee(d);
  assert.equal(r.Q, 0.98, 'user: "งานดีที่จะได้จากกะนี้จริงๆ ก็จะเป็น 98" ⇒ 98/100');
  /* 🔴 สูตรเดิมให้ 95/(95+2) = 97.94 — ชิ้นที่ซ่อมได้ 3 ชิ้น **ไม่มีทาง** กลับมาเป็นของดี
     เพราะมันไม่เคยอยู่ในตัวหาร นี่คือเหตุผลเดียวที่ต้องเปลี่ยนตัวหาร */
  assert.equal(Math.round((95 / 97) * 1000) / 10, 97.9);
});

test('③.1 กะที่ปิดแล้ว — restampQPatch ต้องให้ 98 เท่ากับตอนปิดกะ (ห้ามมี 2 สูตร)', () => {
  const d = [susRow([yellow({ return_date: '2026-11-25' }), red(2)])];
  /* กะถูกปิดไว้ตอน Q = 100 (ยังไม่ตัดสิน) · A/P stamp ไว้แล้ว */
  const patch = restampQPatch({ actual_qty: 95, oee_q: 100, oee_a: 90, oee_p: 80 }, d);
  assert.equal(patch.oee_q, 98, 'ตัวเลขเดียวกับ computeSessionOee — ไม่ใช่ 97.94');
  assert.equal(patch.oee, parseFloat((0.9 * 0.8 * 0.98 * 100).toFixed(2)));
});

test('③.2 ทิ้งทั้ง 5 = ดี 95 เสีย 5 ⇒ %Q = 95 (ยอดผลิตยัง 100)', () => {
  const d = [susRow([yellow({ qa_decision: 'scrap' })])];
  assert.equal(sumDefectQty(d, 'line'), 5);
  assert.equal(runOee(d).Q, 0.95, '(100 − 5) / 100');
});

test('④ งานทดลองออกทั้งคู่ — ห้ามดัน %Q ขึ้นลอยๆ', () => {
  /* งานทดลอง 50 ชิ้น: `sumDefectQty(…,"line")` ไม่นับเป็นของเสีย ⇒ ฐาน %Q ก็ต้องไม่นับด้วย */
  const trial = { id: 'D2', prod_order_id: 'O1', qty_ng: 50, qty_suspect: 0, qty_repair: 0,
    is_trial: true, prod_orders: { mat_no: 'M1' }, quality_bin_records: [] };
  assert.equal(sumDefectQty([trial], 'line'), 0);
  assert.equal(qTotalCount(95, [trial]), 95, 'ฐาน %Q ต้องไม่โตเพราะงานทดลอง');
  assert.equal(producedTotalCount(95, [trial]), 145, 'แต่ "ยอดผลิต" ที่โชว์บนจอนับ (เครื่องทำออกมาจริง)');
  assert.equal(runOee([trial]).Q, 1, '%Q = 95/95 เหมือนก่อน 25/11 เป๊ะ');
});

test('⑤ back-compat — ผู้เรียกที่ไม่ส่งแถวของเสีย ต้องได้ค่าเท่าสูตรเดิมเป๊ะ', () => {
  const liveArgs = {
    session, orders, downtimes: [], ctMap: { M1: CT }, workDate: '2026-11-24',
    nowMs: new Date('2026-11-24T17:00:00+07:00').getTime(),
  };
  /* ไม่ส่ง qRows ⇒ ฐาน = 95 + 5 = 100 … แต่ `ng` = 5 ที่ส่งมาคือ "ของเสียที่ตัดสินแล้ว"
     ⇒ Q = 95/100 = สูตรเดิม `produced / (produced + ng)` เป๊ะ */
  assert.equal(computeLiveOee({ ...liveArgs, ngQty: 5 }).Q, 95);   // computeLiveOee คืนเป็น % (pct)
  /* ส่ง qRows ที่บอกว่า 5 ชิ้นนั้น "รอพิจารณา" (ยังไม่ใช่ของเสีย) ⇒ ของเสีย 0 · Q = 100 */
  assert.equal(computeLiveOee({ ...liveArgs, ngQty: 0, qRows: [susRow([yellow()])] }).Q, 100);
  /* ⚠️ ฐานห้ามต่ำกว่าสูตรเดิม ไม่ว่าอะไรจะส่งมา (ไม่งั้น %Q ติดลบ) */
  assert.equal(computeLiveOee({ ...liveArgs, ngQty: 95, qRows: [] }).Q, 50, '95/(95+95)');
});

test('⑥ qRatio — ยอดผลิต 0 = ตอบไม่ได้ (null) ห้ามคืน 0 หรือ 1', () => {
  assert.equal(qRatio(0, 0), null);
  assert.equal(qRatio(0, 5), null, 'ไม่มียอดผลิต = ไม่มีฐานให้หาร');
  assert.equal(qRatio(32, 32), 0, 'เสียล้วน = 0 ไม่ใช่ null');
  assert.equal(qRatio(100, 0), 1);
  assert.equal(qRatio(100, 150), 0, 'ของเสียเกินฐาน (ข้อมูลเพี้ยน) = clamp ที่ 0 ห้ามติดลบ');
});

/* ══ 🛡️ ตัวแบ่งตามสัดส่วน (`binCoveredSplit`) รับแถว "สงสัยล้วน" ด้วยแล้ว (25/11) ════════════
   เดิมแถวสงสัยล้วนถูกตัดสินโดย `suspectState()` ซึ่งตอบได้แค่ "ทั้งแถว" ⇒ เคส user เขียนไม่ได้
   ⇒ ต้องพิสูจน์ว่า **คำตัดสินแบบทั้งใบให้ผลเท่าเดิมทุกทาง** ไม่ใช่แค่เคสใหม่ที่ทำได้เพิ่ม
   (ตรวจฐานจริง 25/11: ใบเหลือง 80 ใบ · สงสัยล้วน 6 ใบ · ไม่มีใบไหนที่ใบแดงครอบไม่เต็ม)   */
import { defectQty, defectQtyAll } from '../oee.js';

test('🛡️ สงสัยล้วน + คำตัดสินทั้งใบ = ผลเท่ารางเดิมทุกทาง (ของเดิมในฐานห้ามขยับ)', () => {
  const cases = [
    ['ยังไม่ตัดสิน',        [yellow()],                               0],
    ['QA ว่าดี',            [yellow({ qa_decision: 'good' })],        0],
    ['ขอใช้ตามสภาพ',        [yellow({ qa_decision: 'use_as_is' })],   0],
    ['ส่งซ่อม (ยังไม่รับคืน)', [yellow({ qa_decision: 'repair' })],      0],
    ['ตรวจรับคืนแล้ว',       [yellow({ return_date: '2026-11-25' })],  0],
    ['QA ว่าทิ้ง',           [yellow({ qa_decision: 'scrap' })],       5],
    ['ย้ายลงแดงทั้งใบ',      [yellow(), red(5)],                       5],
  ];
  for (const [name, bins, expect] of cases) {
    assert.equal(defectQty(susRow(bins)), expect, `${name}: ของเสียที่เข้า %Q ต้องเป็น ${expect}`);
  }
  /* ใบเหลืองครอบไม่เต็มจำนวนชิ้น (ใบหาย/ลงไม่ครบ) = ถอยไปรางเดิม ห้ามเดาสัดส่วน */
  assert.equal(defectQty(susRow([yellow({ qty: 2, qa_decision: 'scrap' })])), 5,
    'ครอบไม่เต็ม ⇒ §7.1 ตอบ (scrap ทั้งแถว) เหมือนก่อน 25/11');
  /* เอาของสงสัยลงถังแดงตรงๆ (ไม่ผ่านเหลือง) = เสีย — พฤติกรรมเดิม */
  assert.equal(defectQty(susRow([{ id: 'R9', bin: 'red', qty: 5, from_yellow_id: null, is_active: true }])), 5);
  /* พาเรโต/มูลค่า ไม่สนผลพิจารณา — ต้องเห็นของสงสัยทุกชิ้นเสมอ */
  assert.equal(defectQtyAll(susRow([yellow({ qa_decision: 'good' })])), 5);
});

test('🆕 เคสที่เพิ่งทำได้ — สงสัย 5 แยกผล: ทิ้ง 2 เคลียร์ 3 (เดิมนับเสียทั้ง 5)', () => {
  const d = susRow([yellow({ return_date: '2026-11-25' }), red(2)]);
  assert.equal(defectQty(d), 2, 'เสียเฉพาะ 2 ชิ้นที่ลงถังแดง');
  assert.equal(suspectPendingQty(d), 0);
  assert.equal(producedTotalCount(95, [d]), 100, 'ยอดผลิตไม่ขยับตามผลพิจารณา');
});

/* ══ 🧾 ยอดผลิตจาก "คอลัมน์ rollup" — สำหรับรายงาน/export ที่ไม่มีแถว defect_logs (27/11) ═══ */
import { sessionTotalCount, defectQtyForQBase, defectQtyForP } from '../oee.js';

test('⑦ sessionTotalCount — ยอดผลิตจาก rollup ที่ stamp ไว้ (ไม่ต้องดึงแถวของเสีย)', () => {
  const sess = { actual_qty: 95, qty_ok: 95, qty_ng: 0, qty_suspect: 5, qty_repair: 0 };
  assert.equal(sessionTotalCount(sess), 100, 'user: "ผลิตได้งาน 100"');
  /* ใช้ได้เพราะ **ยอดผลิตไม่ขยับตอน QA ตัดสิน** ⇒ ค่าที่ stamp ตอนปิดกะยังจริงเสมอ
     (ต่างจาก %Q ที่ขยับ — ตัวนั้นห้ามใช้ rollup ต้องยึด defect_logs) */
  assert.equal(sessionTotalCount({ ...sess, qty_repair: 7 }), 107);
  assert.equal(sessionTotalCount({ actual_qty: 300 }), 300, 'ไม่มีของเสีย = เท่ายอดสแกน');
  assert.equal(sessionTotalCount(null), 0);
  assert.equal(sessionTotalCount({}), 0, 'แถวว่าง = 0 ไม่ใช่ NaN');
});

test('⑧ ฐาน FTT = ยอดผลิต — ของสงสัย/ซ่อม "ไม่ได้ผ่านรอบแรก" ต้องอยู่ในตัวหาร', () => {
  /* เคสจริง Line 61 กะเช้า 11/11: สแกน 445 · สงสัย 30 · NG 0 */
  const d = { id: 'D1', qty_ng: 0, qty_suspect: 30, qty_repair: 0, quality_bin_records: [] };
  const base = Math.max(445 + defectQtyForQBase(d), 445 + 0);
  assert.equal(base, 475);
  assert.equal(+(445 / base * 100).toFixed(2), 93.68, 'FTT 93.68% ไม่ใช่ 100%');
  /* งานทดลองออกจากฐาน FTT (เข้าคู่กับตัวหักที่ตัดงานทดลองอยู่แล้ว) */
  assert.equal(defectQtyForQBase({ qty_ng: 50, is_trial: true }), 0);
  /* แต่ "ยอดผลิตรวม" ที่โชว์บนจอยังนับงานทดลอง — คนละตัว */
  assert.equal(defectQtyForP({ qty_ng: 50, is_trial: true }), 50);
});
