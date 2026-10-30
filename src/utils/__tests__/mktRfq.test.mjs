import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RFQ_STATUS, RFQ_STATUS_PHASE1, nextRfqNo, nextProductionOrderNo, annualSales, awardSummary,
  npiProjectDraftFromRfq, buildProductionOrderSnapshot, snapshotDrift, isClosed,
} from '../mktRfq.js';
import { STATUS_COLOR } from '../statusTone.js';

/* 💼 Marketing Q-neX เฟส 1 — กฎที่พังแล้วเงียบ: เลขซ้ำ · ยอดขาย 0 ปลอม · ใบพิมพ์ซ้ำไม่ตรงใบเดิม */

test('ทุกสถานะอ้างโทนสีที่มีใน statusTone (ไม่มี hex ของตัวเอง)', () => {
  for (const [k, m] of Object.entries(RFQ_STATUS)) assert.ok(m.tone in STATUS_COLOR, `${k} tone=${m.tone}`);
  for (const k of RFQ_STATUS_PHASE1) assert.ok(RFQ_STATUS[k], `เฟส 1 ใช้สถานะที่ไม่มี: ${k}`);
  assert.equal(isClosed('awarded'), true); assert.equal(isClosed('assessing'), false);
});

test('nextRfqNo = เลขสูงสุดของปี + 1 (ไม่ใช่ count+1 · คนละปีไม่ปน)', () => {
  assert.equal(nextRfqNo([], '2026-10-30'), 'RFQ-2026-001');
  assert.equal(nextRfqNo(['RFQ-2026-001', 'RFQ-2026-007', 'RFQ-2025-050', 'ขยะ'], '2026-10-30'), 'RFQ-2026-008');
  // ลบใบกลางๆ ทิ้ง เลขยังไม่ย้อนมาชน
  assert.equal(nextRfqNo(['RFQ-2026-009'], '2026-01-01'), 'RFQ-2026-010');
});

test('nextProductionOrderNo = MKT/<running รายปี>/<MM>/<YYYY> · แกะวันที่ไม่ออก = null', () => {
  assert.equal(nextProductionOrderNo([], '2026-05-01'), 'MKT/001/05/2026');
  assert.equal(nextProductionOrderNo(['MKT/366/05/2026', 'MKT/120/11/2025'], '2026-06-01'), 'MKT/367/06/2026');
  assert.equal(nextProductionOrderNo(['MKT/366/05/2026'], ''), null);
});

test('🔴 annualSales ขาดตัวใดตัวหนึ่ง = null ห้าม 0', () => {
  assert.equal(annualSales(10000, 21.6), 216000);
  assert.equal(annualSales(null, 21.6), null);
  assert.equal(annualSales(10000, ''), null);
  assert.equal(annualSales('abc', 5), null);
  assert.equal(annualSales(0, 5), 0, 'volume 0 จริง = 0 จริง (คนละเรื่องกับไม่รู้)');
});

test('awardSummary แบบ Model Report — ใบที่คิดยอดไม่ได้ต้องนับเป็น unknownSales ไม่กลืนเป็น 0', () => {
  const s = awardSummary([
    { outcome: 'awarded', annual_volume: 10000, unit_price: 21.6, tooling_price: 158000 },
    { outcome: 'awarded', annual_sales: 415500, tooling_price: 100000 },
    { outcome: 'lost', annual_volume: 10000, unit_price: 32.23, tooling_price: 120000, loss_reason: 'ราคา' },
    { outcome: 'lost', annual_volume: null, unit_price: 30 },          // ไม่รู้ volume
    { outcome: 'cancelled' },
    { outcome: 'weird' }, null,
  ]);
  assert.equal(s.total, 5); assert.equal(s.awarded, 2); assert.equal(s.lost, 2); assert.equal(s.cancelled, 1);
  assert.equal(s.sales.awarded, 216000 + 415500);
  assert.equal(s.sales.lost, 322300);
  assert.equal(s.tooling.awarded, 258000); assert.equal(s.tooling.lost, 120000);
  assert.equal(s.unknownSales, 1);
});

test('npiProjectDraftFromRfq — เสนอชื่อ/ลูกค้า/SOP/พาร์ทแม่ (ชิ้นย่อยไม่ขึ้นเป็นพาร์ท NPI)', () => {
  const rfq = { rfq_no: 'RFQ-2026-001', customer: 'FORD', model: 'MY2020 T6', sop_date_customer: '2021-12-13', crd_no: 'MKT1/136/2020' };
  const parts = [
    { id: 'a', part_no: 'MB3C-2B614-AA', part_name: 'BRKT ASY P/BRK CA RR', parent_part_id: null },
    { id: 'a1', part_no: 'MB3C-2B614-A-PIA01', parent_part_id: 'a' },
  ];
  const d = npiProjectDraftFromRfq(rfq, parts);
  assert.equal(d.customer, 'FORD'); assert.equal(d.sop_date, '2021-12-13');
  assert.match(d.name, /FORD · MY2020 T6 · BRKT ASY/);
  assert.deepEqual(d.parts.map(p => p.part_no), ['MB3C-2B614-AA']);
  assert.match(d.description, /CRD MKT1\/136\/2020/);
  // RFQ เปล่า = ไม่พัง
  assert.equal(npiProjectDraftFromRfq(null, []).customer, '');
});

test('snapshot ใบแจ้งจัดทำ — พิมพ์ซ้ำต้องเป็นใบเดิม · ข้อมูลเปลี่ยนทีหลังต้องชี้ได้ว่าช่องไหน', () => {
  const rfq = { rfq_no: 'RFQ-2026-001', customer: 'FORD', model: 'MY2020', annual_volume: 67387, volume_source: 'rfq', process_type: 'steel' };
  const parts = [
    { id: 'a', part_no: 'MB3C-2B614-AA', part_name: 'BRKT', parent_part_id: null, sort: 0 },
    { id: 'a1', part_no: 'MB3C-2B614-A-PIA01', parent_part_id: 'a', qty_per: 1, sort: 1 },
    { id: 'a2', part_no: 'MB3C-2B614-A-PIA02', parent_part_id: 'a', qty_per: 2, sort: 2 },
  ];
  const award = { annual_volume: 10000, unit_price: 21.6, tooling_price: 158000, po_no: 'XQNXOK' };
  const snap = buildProductionOrderSnapshot({ rfq, parts, award, issuedBy: 'A', issuedAt: '2026-10-30T10:00:00Z' });
  assert.equal(snap.annual_volume, 10000, 'volume ของใบ = ที่ตัดสินตอน award ชนะของ RFQ');
  assert.equal(snap.parts.length, 1); assert.equal(snap.parts[0].subs.length, 2);
  assert.equal(snap.parts[0].subs[1].qty_per, 2);
  assert.deepEqual(snapshotDrift(snap, { rfq, parts, award }), []);
  const drift = snapshotDrift(snap, { rfq: { ...rfq, customer: 'FORD TH' }, parts: parts.slice(0, 1), award: { ...award, unit_price: 22 } });
  assert.deepEqual(drift, ['ลูกค้า', 'ราคาชิ้น']);   // รายการพาร์ทแม่ยังเท่าเดิม (ตัดแค่ชิ้นย่อย) ⇒ ไม่ขึ้น
  assert.deepEqual(snapshotDrift(null, { rfq, parts, award }), []);
});
