import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vendorLocOf, openQtyOf, platingRoutes, outstandingByVendor, toWhTargets,
  afterCandidates, directUsesOfBefore, sendBlockReason, sendStockWarn,
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

test('platingRoutes — เส้นทางจาก Product Master + BOM · ไม่มีลูก = โชว์ปัญหา ไม่กลืน', () => {
  const r = platingRoutes(P, B);
  const ok = r.find(x => x.after === '20059822');
  assert.equal(ok.before, '20059851');
  assert.equal(ok.vendor, 'ร้าน-ก');
  assert.equal(ok.afterActive, false);            // ปิดไว้ในจอผลิตได้ ยังเป็นเส้นทางชุบ
  const bad = r.find(x => x.after === '20000001');
  assert.equal(bad.before, null);
  assert.ok(bad.problem);
  assert.equal(r.filter(x => x.vendor === '').length, 0);
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
