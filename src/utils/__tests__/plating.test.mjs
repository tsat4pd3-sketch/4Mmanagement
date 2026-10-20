import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vendorLocOf, openQtyOf, platingRoutes, outstandingByVendor, toWhTargets,
  afterCandidates, directUsesOfBefore, sendBlockReason, sendStockWarn,
  platingProducts, beforeCandidatesOf, autoBeforeOf, receiveBlockReason, orderZone,
} from '../plating.js';

/* ข้อมูลจำลองตามโครงจริง (10092454 · 20059822 หลังชุบ · 20059851 ก่อนชุบ) — ชื่อร้านเป็นข้อมูล ไม่ใช่โค้ด */
const P = [
  { id: 'fgA', mat_no: '10092454', name: 'BUMPER REINF', line_name: 'Line D4', is_active: true },   // ประกอบ: หลังชุบ + น็อต
  { id: 'fgB', mat_no: '10099999', name: 'FG แปลงตรง', line_name: 'Line X', is_active: true },     // ลูกตัวเดียว = หลังชุบ
  { id: 'aft', mat_no: '20059822', name: 'REINF หลังชุบ', is_active: false, outsource_vendor: 'ร้าน-ก' },
  { id: 'bef', mat_no: '20059851', name: 'REINF ก่อนชุบ', is_active: true },
  { id: 'noB', mat_no: '20000001', name: 'ยังไม่มี BOM', is_active: true, outsource_vendor: 'ร้าน-ข' },
];
const B = [
  { id: 1, product_id: 'fgA', mat_no: '20059822', qty_per_unit: 1, parent_mat: null },
  { id: 2, product_id: 'fgA', mat_no: '30042573', qty_per_unit: 4, parent_mat: null },
  { id: 3, product_id: 'fgA', mat_no: '20059851', qty_per_unit: 1, parent_mat: '20059822' },
  { id: 4, product_id: 'aft', mat_no: '20059851', qty_per_unit: 1, parent_mat: null },
  { id: 5, product_id: 'fgB', mat_no: '20059822', qty_per_unit: 2, parent_mat: null },
  { id: 6, product_id: 'fgB', mat_no: '20059851', qty_per_unit: 1, parent_mat: null },   // ใช้ก่อนชุบตรงๆ (ควรแทรกชั้น)
];

test('vendorLocOf — ตรงกับ RPC plating_send', () => {
  assert.equal(vendorLocOf(' JRP '), 'ร้านชุบ · JRP');
});

test('openQtyOf — ส่ง − รับ − ตัดยอด · ไม่ติดลบ', () => {
  assert.equal(openQtyOf({ qty_sent: 100, qty_received: 60, qty_written_off: 10 }), 30);
  assert.equal(openQtyOf({ qty_sent: 10, qty_received: 20 }), 0);
});

const L = [{ name: 'Coating', line_type: 'outsource', is_active: true }, { name: 'Line D4', line_type: 'welding_assembly' }];

test('platingProducts — สินค้าบนไลน์ประเภทจ้างนอก หรือที่ตั้งร้าน · ไม่เดาจากชื่อ', () => {
  const prods = [
    ...P,
    { id: 'c1', mat_no: '20066547', name: 'BAR หลังชุบ', p_no: 'R1WB-17K825-BAW', line_name: 'Coating', is_active: true },
    { id: 'x1', mat_no: '20077777', name: 'ชื่อมีคำว่าหลังชุบ แต่อยู่ไลน์ผลิต', line_name: 'Line D4', is_active: true },
  ];
  const got = platingProducts(prods, L).map(p => p.mat_no);
  assert.deepEqual(got, ['20000001', '20059822', '20066547']);   // ร้านตั้งไว้ 2 ตัว + ไลน์ Coating 1 ตัว
  assert.ok(!got.includes('20077777'));
  assert.deepEqual(platingProducts(prods, []).map(p => p.mat_no), ['20000001', '20059822']);
});

test('beforeCandidatesOf — BOM ก่อน · BOM ไม่มี = เสนอจาก P/N ตรงกันเป๊ะ (ยังไม่ผูก)', () => {
  const prods = [
    ...P,
    { id: 'c1', mat_no: '20066547', name: 'BAR หลังชุบ', p_no: 'R1WB-17K825-BAW', line_name: 'Coating' },
    { id: 'c2', mat_no: '20066546', name: 'BAR ก่อนชุบ', p_no: 'R1WB 17K825 BAW', line_name: 'Line D5' },
    { id: 'c3', mat_no: '20062361', name: 'คนละรุ่น', p_no: 'P1WB-17K825-LAW', line_name: 'Coating' },
    { id: 'c4', mat_no: '30011111', name: 'ของซื้อ P/N ตรง', p_no: 'R1WB-17K825-BAW' },
  ];
  const c = beforeCandidatesOf('20066547', { products: prods, bomRows: B, platingSet: new Set(['20066547', '20062361']) });
  assert.deepEqual(c.map(x => [x.mat, x.linked, x.why]), [['20066546', false, 'pno']]);   // 3xx ไม่นับ · หลังชุบอีกตัวไม่นับ
  const b = beforeCandidatesOf('20059822', { products: P, bomRows: B });
  assert.deepEqual(b.map(x => [x.mat, x.linked]), [['20059851', true]]);
});

test('beforeCandidatesOf — ลูก BOM รวมทุกใบ · P/N ตรงชนะ · ใบของหลังชุบที่ข้ามชั้นไม่หลอก (เคสจริง 20059852/20059898)', () => {
  const prods = [
    { id: 'A', mat_no: '20059852', name: 'PLT หลังชุบ', p_no: 'N1WB-17B984-RA', line_name: 'Coating' },
    { id: 'B', mat_no: '20059853', name: 'PLT ก่อนชุบ', p_no: 'N1WB-17B984-RA' },
    { id: 'C', mat_no: '20059854', name: 'MOUNTING PLATE', p_no: 'N1WB-17B984-RB' },
    { id: 'F', mat_no: '10092454', name: 'FG' },
    { id: 'G', mat_no: '20059898', name: 'BAR หลังชุบ', p_no: 'N1WB-17G799-CA', line_name: 'Coating' },
    { id: 'H', mat_no: '20060001', name: 'BAR UPR', p_no: 'N1WB-17G799-CPIA01' },
    { id: 'I', mat_no: '20059899', name: 'BAR ก่อนชุบ', p_no: 'N1WB-17G799-CA' },
  ];
  const rows = [
    { product_id: 'A', mat_no: '20059854', parent_mat: null },            // ใบของหลังชุบ ใส่ลูกข้ามชั้น
    { product_id: 'F', mat_no: '20059852', parent_mat: null },
    { product_id: 'F', mat_no: '20059853', parent_mat: '20059852' },      // ใบ FG จัดชั้นถูก
    { product_id: 'G', mat_no: '20060001', parent_mat: null },
  ];
  const set = new Set(['20059852', '20059898']);
  const a = beforeCandidatesOf('20059852', { products: prods, bomRows: rows, platingSet: set });
  assert.deepEqual(a.map(x => x.mat), ['20059853']);
  assert.equal(autoBeforeOf(a).mat, '20059853');
  const g = beforeCandidatesOf('20059898', { products: prods, bomRows: rows, platingSet: set });
  assert.deepEqual(g.map(x => [x.mat, x.why]), [['20059899', 'pno'], ['20060001', 'bom']]);
  assert.equal(autoBeforeOf(g), null);                                  // กำกวม = ให้คนเลือก
});

test('platingRoutes — before รู้แล้ว / ยังไม่ผูก = problem ห้ามกลืน', () => {
  const r = platingRoutes(P, B, L);
  const ok = r.find(x => x.after === '20059822');
  assert.equal(ok.before, '20059851');
  assert.equal(ok.vendor, 'ร้าน-ก');
  assert.equal(ok.afterActive, false);
  const bad = r.find(x => x.after === '20000001');
  assert.equal(bad.before, null);
  assert.ok(bad.problem);
});

test('receiveBlockReason — ไม่ครบต้องมีรายละเอียด · 0 ต้องปิดใบ · ห้ามเกินค้าง', () => {
  assert.equal(receiveBlockReason({ open: 100, qty: 100 }), null);
  assert.match(receiveBlockReason({ open: 100, qty: 60, reason: '' }), /รายละเอียด/);
  assert.equal(receiveBlockReason({ open: 100, qty: 60, reason: 'ทยอยส่ง' }), null);
  assert.match(receiveBlockReason({ open: 100, qty: 101 }), /เกิน/);
  assert.match(receiveBlockReason({ open: 100, qty: 0, reason: 'หาย' }), /ปิดใบ/);
  assert.equal(receiveBlockReason({ open: 100, qty: 0, reason: 'ร้านทำหาย', close: true }), null);
  assert.match(receiveBlockReason({ open: 100, qty: '' }), /นับได้/);
});

test('orderZone — เกิน lead time = late · ไม่รู้ lead time = ไม่ตัดสิน · ปิดแล้ว = closed', () => {
  const now = new Date('2026-10-13T05:00:00Z');
  const o = { status: 'open', sent_at: '2026-10-01T03:00:00Z' };
  assert.equal(orderZone(o, { now, leadDays: 7 }), 'late');
  assert.equal(orderZone(o, { now, leadDays: 30 }), 'vendor');
  assert.equal(orderZone(o, { now, leadDays: null }), 'vendor');
  assert.equal(orderZone({ ...o, status: 'closed' }, { now, leadDays: 7 }), 'closed');
});

test('outstandingByVendor — รวมใบเปิดต่อร้าน/สินค้า · อายุจากใบเก่าสุด · lead time ไม่รู้ = null', () => {
  const now = new Date('2026-10-13T05:00:00Z');
  const orders = [
    { vendor: 'ร้าน-ก', after_mat: '20059822', before_mat: '20059851', qty_sent: 100, qty_received: 40, qty_written_off: 0, status: 'open', sent_at: '2026-10-01T03:00:00Z' },
    { vendor: 'ร้าน-ก', after_mat: '20059822', before_mat: '20059851', qty_sent: 50, qty_received: 0, qty_written_off: 0, status: 'open', sent_at: '2026-10-10T03:00:00Z' },
    { vendor: 'ร้าน-ก', after_mat: '20059822', qty_sent: 70, qty_received: 70, status: 'closed', sent_at: '2026-09-01T03:00:00Z' },
    { vendor: 'ร้าน-ข', after_mat: 'X', qty_sent: 5, qty_received: 0, status: 'open', sent_at: '2026-10-12T03:00:00Z' },
  ];
  const g = outstandingByVendor(orders, { now, leadDaysOf: v => (v === 'ร้าน-ก' ? 7 : null) });
  const a = g.find(x => x.vendor === 'ร้าน-ก');
  assert.equal(a.open, 110);
  assert.equal(a.orders, 2);
  assert.equal(a.items[0].ageDays, 12);
  assert.equal(a.items[0].overdue, true);
  const b = g.find(x => x.vendor === 'ร้าน-ข');
  assert.equal(b.items[0].overdue, null);           // ไม่รู้ lead time = ไม่ตัดสิน
});

test('toWhTargets — FG ลูกตัวเดียวแปลงตรงได้ · FG มีชิ้นอื่น = ต้องประกอบที่ไลน์', () => {
  const t = toWhTargets('20059822', { products: P, bomRows: B });
  const d = t.find(x => x.fg === '10099999');
  const asm = t.find(x => x.fg === '10092454');
  assert.equal(d.direct, false);                   // fgB มี 20059851 ตรงๆ ด้วย = ไม่ใช่ลูกตัวเดียว
  assert.equal(asm.direct, false);
  assert.deepEqual(asm.others, ['30042573']);
  assert.equal(asm.line, 'Line D4');
  const only = toWhTargets('20059822', { products: P, bomRows: B.filter(r => r.id !== 6) });
  const d2 = only.find(x => x.fg === '10099999');
  assert.equal(d2.direct, true);
  assert.equal(d2.qpu, 2);
  assert.equal(only[0].fg, '10099999');            // ตัวแปลงตรงขึ้นก่อน
});

test('afterCandidates — ตัวแม่ของก่อนชุบที่ไม่ใช่ FG', () => {
  const c = afterCandidates('20059851', { products: P, bomRows: B });
  assert.deepEqual(c.map(x => x.mat), ['20059822']);
  assert.equal(c[0].vendor, 'ร้าน-ก');
});

test('directUsesOfBefore — บรรทัดที่ยังใช้ก่อนชุบตรงๆ (ไม่นับขาเส้นทางชุบเอง)', () => {
  const u = directUsesOfBefore('20059851', '20059822', { products: P, bomRows: B });
  assert.deepEqual(u.map(x => x.row.id), [6]);
  assert.equal(u[0].parent, '10099999');
});

test('sendBlockReason / sendStockWarn — ไม่มีกฎคลัง = บล็อก · ยอดไม่พอ = เตือนเท่านั้น', () => {
  const route = { before: '20059851' };
  assert.equal(sendBlockReason({ route, qty: 10, fromLoc: 'STORE' }), null);
  assert.match(sendBlockReason({ route, qty: 10, fromLoc: '' }), /กฎรับเข้าคลัง/);
  assert.match(sendBlockReason({ route, qty: 0, fromLoc: 'STORE' }), /จำนวน/);
  assert.match(sendBlockReason({ route: { before: null }, qty: 1, fromLoc: 'STORE' }), /BOM/);
  assert.match(sendStockWarn({ qty: 10, have: 5, fromLoc: 'STORE' }), /ติดลบ/);
  assert.equal(sendStockWarn({ qty: 10, have: null, fromLoc: 'STORE' }), null);
});
