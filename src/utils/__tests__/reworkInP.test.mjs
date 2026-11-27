/* ══ 🔧 งานซ่อม (`qty_repair`) กับ %P / %Q — audit ตามคำถาม user 25/11 ════════════════════
   user: *"ผลิตออกมา 210 ชิ้น มีต้องสงสัย 7 ชิ้นรอ rework … ปิดกะส่งยอดเพื่อเคลียร์งานกะนั้น
           ระบบจะมองเหลือ 203 แล้วไปคิด %P ทำให้ OEE ตก · ถ้ากะถัดไปซ่อมครบ %P ของกะถัดไป
           จะไปคิด 7 ตัวนี้ด้วยมั้ย หรือหายไปเลย"*

   เทสนี้ตรึงคำตอบทั้ง 2 ท่อน ไม่ให้ใครแก้กลับโดยไม่รู้ตัว:
     1. กะที่ผลิต — ชิ้นรอซ่อม **ต้องอยู่ในตัวเศษ %P** (เครื่องเดินทำออกมาจริง · oee.js §7.2.1)
     2. กะที่ซ่อม — ถ้าสแกนปิดใบ ชิ้นนั้นเป็นยอดผลิตของกะที่ซ่อม **ไม่ถูกนับซ้ำกับกะต้นทาง**
        (กะต้นทางนับเป็น "ชิ้นที่เครื่องทำออกมา" ไม่ใช่ "ของดี" — ของดีนับที่กะที่ซ่อมเสร็จ)
     3. %Q **ห้ามขยับ** เพราะงานซ่อม (ของกลาง `defectQty` ไม่นับซ่อม) — แต่จอต้องเขียนว่ารอกี่ชิ้น
     4. พาเรโต/มูลค่าของเสีย (`defectQtyAll`) **ห้าม** นับงานซ่อมเป็นของเสีย                     */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSessionOee, ngByMatFrom, defectQtyAll, defectQtyForP, defectQty,
  sumReworkPending, sumDefectQty,
} from '../oee.js';

const CT = 60;   // วินาที/ชิ้น — เลขกลมๆ ให้คิดในหัวได้
const products = [{ mat_no: 'M1', cycle_time_sec: CT, name: 'พาร์ททดสอบ', p_no: 'P-1' }];

/** กะเช้า 08:00 ยาว 570 นาที · ใบเดียว MAT M1 */
const sessionOf = (over = {}) => ({
  id: 'S1', work_date: '2026-11-24', shift: 'day', line_name: 'Assy GOR',
  start_time: '08:00:00', ...over,
});
const orderOf = (qty, over = {}) => ({
  id: 'O1', mat_no: 'M1', status: 'confirmed', qty, qty_ok: qty, qty_actual: qty,
  opened_at: '2026-11-24T08:00:00+07:00', confirmed_at: '2026-11-24T17:30:00+07:00', ...over,
});
const defectOf = (over) => ({
  id: 'D1', prod_order_id: 'O1', qty_ng: 0, qty_suspect: 0, qty_repair: 0,
  prod_orders: { mat_no: 'M1' }, quality_bin_records: [], ...over,
});

const runOee = (orders, defects) => computeSessionOee({
  session: sessionOf(), orders, defects, products, kanbanStds: [], breakPolicies: [],
  endTime: '17:30',
});

test('🔧 ตัวเศษ %P ต้องรวมชิ้นที่รอซ่อม — เครื่องเดินทำออกมาจริง', () => {
  const defects = [defectOf({ qty_repair: 7 })];
  const { byMat, noMat } = ngByMatFrom(defects, [orderOf(203)]);
  assert.equal(noMat, 0);
  assert.equal(byMat.M1, 7, 'ชิ้นรอซ่อมต้องถูกบวกเข้าตัวเศษ %P (ไม่งั้น %P ต่ำกว่าจริง)');

  /* %P ของกะที่สแกนได้ 203 + รอซ่อม 7 ต้องเท่ากับกะที่สแกนได้ 210 พอดี (เครื่องเดินเท่ากัน) */
  const withRepair = runOee([orderOf(203)], defects);
  const allGood    = runOee([orderOf(210)], []);
  assert.equal(withRepair.stdMin, allGood.stdMin, 'เวลามาตรฐานของ 2 กะต้องเท่ากัน (210 ชิ้นเท่ากัน)');
  assert.equal(withRepair.P, allGood.P, '%P ต้องไม่ถูกลงโทษเพราะของ 7 ชิ้นยังซ่อมไม่เสร็จ');
  assert.equal(withRepair.stdMin, 210 * CT / 60);

  /* ถ้าไม่นับซ่อม (พฤติกรรมเดิมก่อน 25/11) จะได้ตัวเศษ 203 = %P ต่ำกว่าจริง — ตรึงส่วนต่างไว้ให้เห็น */
  const oldNum = 203 + defectQtyAll(defects[0]);
  assert.equal(oldNum, 203, 'defectQtyAll ต้องไม่นับงานซ่อม (เป็นชุดของพาเรโต/มูลค่า)');
  assert.ok(withRepair.P > oldNum * CT / 60 / withRepair.runMin - 1e-9);
});

test('🔧 %Q ห้ามขยับเพราะงานซ่อม · แต่ต้องนับ "รอซ่อม" ให้จอเขียนได้', () => {
  const d = defectOf({ qty_repair: 7 });
  assert.equal(defectQty(d), 0, 'งานซ่อมไม่ใช่ของเสีย — ห้ามหัก %Q');
  assert.equal(defectQtyAll(d), 0, 'พาเรโต/มูลค่าของเสีย ห้ามนับงานซ่อม');
  assert.equal(defectQtyForP(d), 7, 'ขา %P ต้องนับ');
  assert.equal(sumReworkPending([d]), 7, 'จอต้องรู้ว่ารอซ่อมกี่ชิ้น');

  const r = runOee([orderOf(203)], [d]);
  assert.equal(sumDefectQty([d], 'line'), 0);
  assert.equal(r.Q, 1, '%Q = 203/203 (ชิ้นรอซ่อมอยู่นอกทั้งตัวเศษและตัวหาร = ท่า "รอพิจารณา")');
});

test('🔧 กะถัดไปที่ซ่อมเสร็จแล้วสแกนปิดใบ — นับเป็นของดีของกะนั้น ไม่นับซ้ำกับกะต้นทาง', () => {
  /* กะ A: สแกน 203 + รอซ่อม 7  ⇒ ของดี 203 · เครื่องทำออกมา 210 */
  const A = runOee([orderOf(203)], [defectOf({ qty_repair: 7 })]);
  /* กะ B: ซ่อมเสร็จแล้วสแกน 7 ชิ้นปิดใบ (ไม่มีใบของเสีย) ⇒ ของดี 7 · เครื่องทำออกมา 7 */
  const B = computeSessionOee({
    session: sessionOf({ id: 'S2', shift: 'night', work_date: '2026-11-24', start_time: '20:00:00' }),
    orders: [orderOf(7, { id: 'O2', opened_at: '2026-11-24T20:00:00+07:00', confirmed_at: '2026-11-25T05:00:00+07:00' })],
    defects: [], products, kanbanStds: [], breakPolicies: [], endTime: '05:30',
  });
  assert.equal(A.totalProduced, 203, 'ยอดผลิต (ของดี) ของกะต้นทาง = ยอดสแกนเท่านั้น');
  assert.equal(B.totalProduced, 7,   'ของดี 7 ชิ้นไปโผล่ที่กะที่ซ่อมเสร็จ');
  assert.equal(A.totalProduced + B.totalProduced, 210, 'รวมทั้ง 2 กะ = 210 ชิ้น ไม่นับซ้ำ');
  /* 🔴 ข้อที่ user ถาม: ถ้ากะ B **ไม่สแกน** ของ 7 ชิ้นนี้ จะไม่ถูกนับเป็นของดีของกะไหนเลย
     (ระบบไม่มีตัวย้ายยอดข้ามกะให้) ⇒ จอปิดกะต้องเขียนเตือนไว้ — ดู DailyReport §รอซ่อม */
  const noScan = computeSessionOee({
    session: sessionOf({ id: 'S3', shift: 'night', start_time: '20:00:00' }),
    orders: [], defects: [], products, kanbanStds: [], breakPolicies: [], endTime: '05:30',
  });
  assert.equal(noScan.totalProduced, 0, 'ไม่สแกน = ไม่มียอด — ของ 7 ชิ้นหายจากยอดงานดีทั้งระบบ');
});

/* ══ 🔧 รอบ 2 (25/11 · user เลือก "ให้ซ่อมเข้าถังเหลือง") ═══════════════════════════════
   คำถาม user: *"อยากให้ยอดดีของชิ้นที่ซ่อมเสร็จ กลับไปที่กะต้นทาง … ควรย้อนยอดผลิตกลับมั้ย"*
   คำตอบที่ลง: **ไม่ย้อนยอดผลิต** (ของไหลออกกะไหนนับกะนั้น ไม่งั้นนับซ้ำกับสต๊อก/แผน)
   แต่ **ผลซ่อมย้อนกลับไปแก้ %Q ของกะต้นทาง** ผ่านรางถังเหลืองเดิม (§7.2 + restampSessionQByDefects)
   ⇒ เทสนี้ตรึง 3 ทาง: รอตัดสิน / ซ่อมแล้วดี / ซ่อมแล้วเสีย                                  */
import { binPiecesOf, yellowRowFromDefect } from '../qualityBin.js';
import { defectQty as dq, suspectPendingQty, reworkPendingQty as rpq } from '../oee.js';

const repRow = (bins) => ({
  id: 'D9', prod_order_id: 'O1', qty_ng: 0, qty_suspect: 0, qty_repair: 7,
  prod_orders: { mat_no: 'M1' }, quality_bin_records: bins,
});
const yellow = (over = {}) => ({ id: 'Y1', bin: 'yellow', qty: 7, qa_decision: null,
  return_date: null, from_yellow_id: null, is_active: true, ...over });

test('🔧 ของที่ส่งซ่อมต้องเข้าถังเหลือง (ไม่งั้นไม่มีใครตัดสินผลซ่อม)', () => {
  const d = repRow([]);
  assert.equal(binPiecesOf(d), 7, 'binPiecesOf ต้องนับ qty_repair ด้วย');
  const row = yellowRowFromDefect(d, { line_name: 'Assy GOR', work_date: '2026-11-24' });
  assert.ok(row, 'แถวที่มีแต่ "ซ่อม" ก็ต้องได้ใบถังเหลือง');
  assert.equal(row.qty, 7);
  assert.equal(row.qa_decision, undefined, 'ห้ามเดาผลให้ — ต้องให้คนตัดสิน');
  assert.match(row.cause, /ส่งซ่อม 7 ชิ้น/, 'QA ต้องอ่านออกว่าก้อนนี้รอ "ผลซ่อม"');
});

test('🔧 รอตัดสิน = ไม่หัก %Q แต่ต้องขึ้นบนจอ', () => {
  const d = repRow([yellow()]);
  assert.equal(dq(d), 0, 'ยังไม่ตัดสิน = ห้ามหัก %Q');
  assert.equal(suspectPendingQty(d), 7, 'ต้องนับเป็น "รอพิจารณา" ให้จอเขียน');
  assert.equal(rpq(d), 0, 'มีใบถังแล้ว — ห้ามนับซ้ำกับ suspectPendingQty');
});

test('🔧 ซ่อมแล้วดี (QA ตรวจรับ) = %Q ของกะต้นทางคงเดิม', () => {
  const d = repRow([yellow({ return_date: '2026-11-25' })]);
  assert.equal(dq(d), 0);
  assert.equal(suspectPendingQty(d), 0, 'ตัดสินแล้ว = ไม่ค้างในจอแล้ว');
});

test('🔧 ซ่อมแล้วเสีย = ย้อนกลับไปหัก %Q ของกะที่ทำมันออกมา', () => {
  const scrapAll = repRow([yellow({ qa_decision: 'scrap' })]);
  assert.equal(dq(scrapAll), 7, 'ทำลายทั้งใบ = เสีย 7 ชิ้น');
  /* ย้ายลงถังแดงบางส่วน (3 จาก 7) — ที่เหลือซ่อมผ่าน */
  const part = repRow([yellow({ return_date: '2026-11-25' }),
    { id: 'R1', bin: 'red', qty: 3, from_yellow_id: 'Y1', is_active: true }]);
  assert.equal(dq(part), 3, 'เสียเฉพาะที่ลงถังแดงจริง');
  assert.equal(suspectPendingQty(part), 0);
});

test('🔧 แถวเก่าที่ไม่มีใบถัง — ยังต้องเขียน "รอซ่อม" บนจอ (ห้ามเงียบ)', () => {
  const noBin = { id: 'D8', qty_ng: 0, qty_suspect: 0, qty_repair: 4 };   // ไม่ได้ embed ทะเบียนถัง
  assert.equal(rpq(noBin), 4);
  assert.equal(dq(noBin), 0, 'ไม่รู้ผล = ห้ามหัก %Q');
});
