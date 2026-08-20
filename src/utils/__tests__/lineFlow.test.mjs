import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFlowGraph, downstreamOf, upstreamOf, traceChain,
  bufferCoverMin, lineAvgCtSec, downstreamRisk, missingLinksFromRouting,
} from '../lineFlow.js';

/* สายจริงที่ user เล่า: HDF1 → LASER-345 → Line 60 / Line 61 · SUB APRON → Line 60/61 */
const LINKS = [
  { from_line: 'HDF1', to_line: 'LASER-345', buffer_qty: 300, buffer_label: 'ชั้นพัก HDF' },
  { from_line: 'LASER-345', to_line: 'Line 60', buffer_qty: 120 },
  { from_line: 'LASER-345', to_line: 'Line 61', buffer_qty: null },
  { from_line: 'SUB APRON', to_line: 'Line 60' },
  { from_line: 'SUB APRON', to_line: 'Line 61', is_active: false },  // ปิดใช้งาน
];

test('buildFlowGraph ข้ามแถวปิดใช้งาน / ชื่อว่าง / ชี้ตัวเอง', () => {
  const g = buildFlowGraph([...LINKS, { from_line: 'X', to_line: 'X' }, { from_line: '', to_line: 'Y' }]);
  assert.equal(downstreamOf(g, 'SUB APRON').length, 1);           // is_active:false ไม่นับ
  assert.equal(downstreamOf(g, 'X').length, 0);
  assert.equal(upstreamOf(g, 'Y').length, 0);
});

test('downstream/upstream ตรงกับสายจริง', () => {
  const g = buildFlowGraph(LINKS);
  assert.deepEqual(downstreamOf(g, 'LASER-345').map(l => l.to_line), ['Line 60', 'Line 61']);
  assert.deepEqual(upstreamOf(g, 'Line 60').map(l => l.from_line), ['LASER-345', 'SUB APRON']);
  assert.equal(downstreamOf(g, 'ไลน์ที่ไม่มี').length, 0);
});

test('traceChain ไล่ทั้งสาย — HDF1 กระทบถึง 60/61', () => {
  const g = buildFlowGraph(LINKS);
  const chain = traceChain(g, 'HDF1', 'down');
  assert.deepEqual(chain.map(c => c.line).sort(), ['LASER-345', 'Line 60', 'Line 61']);
  assert.equal(chain.find(c => c.line === 'LASER-345').depth, 1);
  assert.equal(chain.find(c => c.line === 'Line 60').depth, 2);
});

test('traceChain ขาขึ้น — Line 60 รับของจากใครบ้าง', () => {
  const g = buildFlowGraph(LINKS);
  assert.deepEqual(traceChain(g, 'Line 60', 'up').map(c => c.line).sort(), ['HDF1', 'LASER-345', 'SUB APRON']);
});

test('traceChain ไม่วนไม่รู้จบเมื่อสายวนกลับ', () => {
  const g = buildFlowGraph([{ from_line: 'A', to_line: 'B' }, { from_line: 'B', to_line: 'A' }]);
  assert.deepEqual(traceChain(g, 'A', 'down').map(c => c.line), ['B']);
});

test('bufferCoverMin: 120 ชิ้น × CT 60 วิ = 120 นาที', () => {
  assert.equal(bufferCoverMin(120, 60), 120);
  assert.equal(bufferCoverMin(0, 60), 0);            // buffer 0 ชิ้นจริงๆ = 0 นาที (ต่างจาก "ไม่รู้")
});

test('⚠️ ไม่รู้ buffer/CT ต้องคืน null ห้ามเดาเป็น 0', () => {
  assert.equal(bufferCoverMin(null, 60), null);
  assert.equal(bufferCoverMin(undefined, 60), null);
  assert.equal(bufferCoverMin(120, null), null);
  assert.equal(bufferCoverMin(120, 0), null);        // CT 0 = ไม่รู้ ไม่ใช่เร็วอนันต์
  assert.equal(bufferCoverMin(-5, 60), null);
});

test('lineAvgCtSec เฉลี่ยเฉพาะสินค้าของไลน์นั้น และข้ามรายการขั้นตอน', () => {
  const prods = [
    { line_name: 'Line 60', cycle_time_sec: 60 },
    { line_name: 'Line 60', cycle_time_sec: 80 },
    { line_name: 'Line 60', cycle_time_sec: 999, is_operation: true },  // OP ต้องไม่ถูกนับ
    { line_name: 'Line 61', cycle_time_sec: 50 },
    { line_name: 'Line 60', cycle_time_sec: null },
  ];
  assert.equal(lineAvgCtSec(prods, 'Line 60'), 70);
  assert.equal(lineAvgCtSec(prods, 'line 60'), 70);       // เทียบแบบไม่สนตัวพิมพ์
  assert.equal(lineAvgCtSec(prods, 'SUB APRON'), null);   // ไม่มีสินค้า = ไม่รู้
});

test('downstreamRisk: buffer ยังเหลือ = safe · หมดแล้ว = at_risk', () => {
  const a = downstreamRisk({ stoppedMin: 30, bufferQty: 120, ctSec: 60 }); // cover 120 นาที
  assert.equal(a.status, 'safe');
  assert.equal(a.leftMin, 90);

  const b = downstreamRisk({ stoppedMin: 150, bufferQty: 120, ctSec: 60 });
  assert.equal(b.status, 'at_risk');
  assert.ok(b.leftMin < 0);
});

test('⚠️ ไม่รู้ buffer = unknown ห้ามตีเป็น safe หรือ at_risk', () => {
  const r = downstreamRisk({ stoppedMin: 300, bufferQty: null, ctSec: 60 });
  assert.equal(r.status, 'unknown');
  assert.equal(r.cover, null);
  assert.equal(downstreamRisk({ stoppedMin: null, bufferQty: 120, ctSec: 60 }).status, 'unknown');
});

test('missingLinksFromRouting เสนอเส้นที่ routing บอกแต่ยังไม่ได้ตั้ง', () => {
  const routings = [
    { mat_no: 'A', seq: 10, line_name: 'HDF1' },
    { mat_no: 'A', seq: 20, line_name: 'LASER-345' },
    { mat_no: 'A', seq: 30, line_name: 'Line 60' },
    { mat_no: 'B', seq: 10, line_name: 'HDF2' },
    { mat_no: 'B', seq: 20, line_name: 'LASER-789' },
  ];
  const miss = missingLinksFromRouting(routings, LINKS);
  const keys = miss.map(m => `${m.from}→${m.to}`).sort();
  // HDF1→LASER-345 กับ LASER-345→Line 60 ตั้งไว้แล้ว → เหลือเฉพาะของ mat B
  assert.deepEqual(keys, ['HDF2→LASER-789']);
  assert.deepEqual(miss[0].mats, ['B']);
});

test('missingLinksFromRouting ไม่เสนอเมื่อขั้นถัดไปอยู่ไลน์เดิม', () => {
  const routings = [
    { mat_no: 'C', seq: 10, line_name: 'Line 60' },
    { mat_no: 'C', seq: 20, line_name: 'Line 60' },
  ];
  assert.deepEqual(missingLinksFromRouting(routings, []), []);
});
