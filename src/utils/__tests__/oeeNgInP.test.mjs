/* ══ %P ต้องนับ "ทุกชิ้นที่เครื่องทำออกมา" ไม่ใช่แค่งานดี ══════════════════════════════
   ที่มา (2026-10-04): หัวหน้าทักว่า *"P คิดที่งานผลิตได้ งานที่ผลิตเสียออกมาไม่คิด ทำให้ P ตก"*
   ⇒ ไล่โค้ดแล้วจริง — ตัวเศษของ %P เดิมเป็น "งานดี × CT" ล้วน ⇒ ของเสีย 1 ชิ้น**ถูกหัก 2 ครั้ง**
     (ครั้งแรกที่ %P เพราะเวลาที่ใช้ทำมันหายไปเฉยๆ · ครั้งที่สองที่ %Q) = OEE ต่ำกว่าจริง
   คำสั่ง user: *"ต้องเข้าหมดเพราะใช้เครื่องลองผลิต"* ⇒ NG + งานทดลอง + ของสงสัย เข้าตัวเศษทั้งหมด
   🔴 ห้ามแก้เทสนี้ให้ผ่านด้วยการกลับไปนับงานดีอย่างเดียว — นั่นคือบั๊กที่แก้ไปแล้ว */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ngByMatFrom, computeLiveOee, computeSessionOee } from '../oee.js';

/* ── ngByMatFrom ─────────────────────────────────────────────────────────────── */

test('ชี้ MAT ได้ 2 ทาง: embed prod_orders(mat_no) · หรือ prod_order_id เทียบกับใบในกะ', () => {
  const r = ngByMatFrom(
    [{ qty_ng: 5, prod_orders: { mat_no: 'M1' } }, { qty_ng: 3, prod_order_id: 'o9' }],
    [{ id: 'o9', mat_no: 'M2' }],
  );
  assert.deepEqual(r.byMat, { M1: 5, M2: 3 });
  assert.equal(r.noMat, 0);
});

test('🔴 นับทุกชิ้นที่เครื่องทำออกมา — งานทดลอง/excl_from_q/ของสงสัย ก็กินรอบเครื่องเหมือนกัน', () => {
  const r = ngByMatFrom([
    { qty_ng: 38, is_trial: true, dr_defect_types: { excl_from_q: true }, prod_orders: { mat_no: 'M1' } },
    { qty_ng: 1, prod_orders: { mat_no: 'M1' } },
    { qty_ng: 0, qty_suspect: 4, prod_orders: { mat_no: 'M1' } },
  ], []);
  assert.equal(r.byMat.M1, 43, 'เคสจริง Laser GOR 01/10: ทดลอง 38 + NG 1 + สงสัย 4');
});

test('🔴 ของเสียที่ชี้ MAT ไม่ได้ ต้องคืนเป็น noMat ห้ามเกลี่ยมั่วลง MAT อื่น (ไม่รู้ CT)', () => {
  const r = ngByMatFrom([{ qty_ng: 7 }, { qty_ng: 2, prod_order_id: 'ไม่มีในกะ' }], [{ id: 'o1', mat_no: 'M1' }]);
  assert.deepEqual(r.byMat, {});
  assert.equal(r.noMat, 9);
});

test('ข้อมูลเพี้ยนต้องไม่โยน error (แถว null · qty 0/ติดลบ · ไม่ส่งอะไรเลย)', () => {
  assert.deepEqual(ngByMatFrom([null, { qty_ng: 0 }, { qty_ng: -3, prod_orders: { mat_no: 'M1' } }], []),
    { byMat: {}, noMat: 0 });
  assert.deepEqual(ngByMatFrom(), { byMat: {}, noMat: 0 });
});

/* ── computeLiveOee (จอสด) ───────────────────────────────────────────────────── */

const WD = '2026-10-01';
const OPEN = new Date(`${WD}T08:00:00`).getTime();
const at = (m) => OPEN + m * 60000;
const SESSION = { start_time: '08:00:00', shift_min: 570, shift: 'day', work_date: WD };
const live = (extra = {}) => computeLiveOee({
  session: SESSION, orders: [], downtimes: [], workDate: WD, nowMs: at(570), breakPolicies: [], ...extra,
});
/* เคสจริง Laser GOR กะดึก 01/10/26: ทำได้ 261 ชิ้น · CT 45 วินาที · NG รวม 39 (ทดลอง 38 + จริง 1) */
const GOR = { orders: [{ id: 'o1', mat_no: 'M1', status: 'confirmed', qty: 261 }], ctMap: { M1: 45 }, ngQty: 1 };

test('🔴 เคสจริง Laser GOR — NG เข้าตัวเศษแล้ว %P ต้องสูงขึ้น (261 ชิ้น → 300 ชิ้นที่เครื่องทำจริง)', () => {
  const before = live(GOR);
  assert.equal(before.P, 34.3, 'งานดีล้วน: 261×45/60 = 195.75 นาที ÷ 570');
  const after = live({ ...GOR, ngForP: { byMat: { M1: 39 }, noMat: 0 } });
  assert.equal(after.P, 39.5, 'ทุกชิ้น: 300×45/60 = 225 นาที ÷ 570');
  assert.equal(after.stdMin, 225);
  assert.equal(after.ngInP, 39);
});

test('🔴 ไม่ส่ง ngForP = พฤติกรรมเดิมเป๊ะ (back-compatible — จอที่ยังไม่อัพเดทห้ามเลขเพี้ยน)', () => {
  const base = live(GOR);
  assert.deepEqual(live({ ...GOR, ngForP: null }), base);
  assert.deepEqual(live({ ...GOR, ngForP: { byMat: {}, noMat: 0 } }), { ...base, ngInP: 0, ngNoMatP: 0, ngNoCtP: 0 });
});

test('🔴 NG เข้า %P แต่ต้องไม่ไปแตะ %Q — คนละคำถาม (เครื่องเดินกี่รอบ ≠ ได้ของดีกี่ชิ้น)', () => {
  const after = live({ ...GOR, ngForP: { byMat: { M1: 39 }, noMat: 0 } });
  assert.equal(after.Q, live(GOR).Q, 'Q ต้องเท่าเดิม');
  assert.equal(after.Q, 99.6, '261/262 — ngQty ของ %Q ยังเป็นชุด line-mode เหมือนเดิม');
  assert.equal(after.produced, 261, '"ผลิตได้" บนจอยังเป็นงานดี ห้ามบวก NG เข้าไป');
});

test('🔴 NG ของ MAT ที่ไม่ได้ตั้ง CT = คิดไม่ได้ ต้องเข้า qtyNoCt ให้จอเตือน ห้ามหายเงียบ', () => {
  const r = live({
    orders: [{ id: 'o1', mat_no: 'M1', status: 'confirmed', qty: 100 }],
    ctMap: { M1: 60 }, ngQty: 0,
    ngForP: { byMat: { M1: 10, NOCT: 25 }, noMat: 0 },
  });
  assert.equal(r.ngInP, 10, 'ตัวที่มี CT เข้าได้');
  assert.equal(r.ngNoCtP, 25);
  assert.equal(r.qtyNoCt, 25);
  assert.ok(r.matsNoCt.includes('NOCT'));
});

test('🔴 ของเสียที่ชี้ MAT ไม่ได้ ต้องรายงานออกจอ (ngNoMatP) — "คิดไม่ได้" ห้ามเงียบ', () => {
  const r = live({ ...GOR, ngForP: { byMat: { M1: 39 }, noMat: 6 } });
  assert.equal(r.ngNoMatP, 6);
});

test('🔴 งานคู่ RH/LH — NG ทั้งสองข้างต้องยุบเป็น shot เดียว (ชิ้น ≠ shot)', () => {
  const orders = [
    { id: 'a', mat_no: 'RH', status: 'confirmed', qty: 100 },
    { id: 'b', mat_no: 'LH', status: 'confirmed', qty: 100 },
  ];
  const args = { orders, ctMap: { RH: 60, LH: 60 }, ngQty: 0, pairMap: { RH: 'LH', LH: 'RH' } };
  const base = live(args);
  const withNg = live({ ...args, ngForP: { byMat: { RH: 20, LH: 20 }, noMat: 0 } });
  assert.equal(base.stdMin, 100, 'ปั๊มทีเดียวได้ 2 ข้าง = 100 นาที ไม่ใช่ 200');
  assert.equal(withNg.stdMin, 120, 'NG 20 คู่ = 20 shot ไม่ใช่ 40');
});

/* ── computeSessionOee (ตอนปิดกะ — ต้องตรงกับจอสด) ───────────────────────────── */

const SD = '2026-09-22';
const sessArgs = (defects = []) => ({
  session: { work_date: SD, shift: 'day', line_name: 'L', start_time: '08:00:00', end_time: '17:30:00' },
  orders: [{ id: 'o1', mat_no: 'M1', status: 'confirmed', qty: 100,
    opened_at: `${SD}T09:00:00`, confirmed_at: `${SD}T16:00:00` }],
  products: [{ mat_no: 'M1', name: 'PART', p_no: 'PN1', cycle_time_sec: 60, pair_mat_no: null }],
  defects, ngQty: 0, endTime: '17:30:00',
});

test('🔴 สูตรปิดกะต้องนับ NG เข้าตัวเศษเหมือนจอสด (ไม่งั้น 2 จอตอบคนละเลข)', () => {
  const before = computeSessionOee(sessArgs());
  const after = computeSessionOee(sessArgs([{ qty_ng: 20, prod_order_id: 'o1' }]));
  assert.ok(after.P > before.P, 'NG 20 ชิ้นกินรอบเครื่องไปแล้ว ต้องดัน %P ขึ้น');
  assert.ok(Math.abs(after.P / before.P - 1.2) < 1e-6, '120/100 ชิ้น');
  assert.equal(after.ngInP, 20);
});

test('🔴 งานทดลองก็เข้า %P ตอนปิดกะ (user: "ใช้เครื่องลองผลิต") แต่ยังไม่เข้า %Q', () => {
  const r = computeSessionOee(sessArgs([
    { qty_ng: 38, is_trial: true, dr_defect_types: { excl_from_q: true }, prod_order_id: 'o1' },
  ]));
  assert.equal(r.ngInP, 38);
  assert.equal(r.ngQty, 0, '%Q ยังไม่นับงานทดลองเหมือนเดิม (sumDefectQty line-mode)');
  assert.equal(r.Q, 1);
});

test('🔴 ของเสียที่ไม่ผูกใบ ต้องไม่เข้า %P และต้องรายงานออกมา', () => {
  const r = computeSessionOee(sessArgs([{ qty_ng: 9 }]));
  assert.equal(r.ngInP, 0);
  assert.equal(r.ngNoMatP, 9);
});

test('ไม่มีของเสียเลย = ตัวเลขเท่าเดิมทุกตัว (ห้ามขยับโดยไม่มีเหตุ)', () => {
  const r = computeSessionOee(sessArgs([]));
  assert.equal(r.ngInP, 0);
  assert.equal(r.ngNoMatP, 0);
});
