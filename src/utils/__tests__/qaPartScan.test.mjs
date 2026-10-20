import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQrPayload, findQaPartByScan } from '../qrCode.js';

const parts = [
  { id: 'a', mat_no: '10100401', part_no: '52119-0K010', line_name: 'E50' },
  { id: 'b', mat_no: '10200500', part_no: 'XYZ-1', line_name: 'GOR' },
];

test('บาร์โค้ด MAT เปล่า / ป้าย ESM:P / เลขพาร์ทพิมพ์มือ → เจอพาร์ทเดียวกัน', () => {
  for (const raw of ['10100401', 'ESM:P:10100401', '52119 0k010', 'https://x.example/scan?c=ESM:P:10100401']) {
    assert.equal(findQaPartByScan(parseQrPayload(raw), parts).part?.id, 'a', raw);
  }
});

test('🔴 ป้ายเครื่อง/จิ๊ก ห้ามเดาเป็นพาร์ท — ต้องบอกเหตุ', () => {
  const r = findQaPartByScan(parseQrPayload('ESM:M:11111111-2222'), parts);
  assert.ok(!r.part && /ป้ายนี้เป็นป้าย/.test(r.error));
});

test('ไม่มีมาตรฐาน ≠ นอกขอบเขต — ข้อความต้องต่างกัน', () => {
  assert.match(findQaPartByScan(parseQrPayload('999'), parts).error, /ยังไม่มีมาตรฐาน/);
  const out = findQaPartByScan(parseQrPayload('10200500'), parts, [parts[0]]);
  assert.match(out.error, /นอกขอบเขต/);
  assert.equal(findQaPartByScan(parseQrPayload('10200500'), parts, null).part.id, 'b');
});

test('ว่าง/อ่านไม่ได้ ต้องไม่โยน', () => {
  assert.ok(findQaPartByScan(null, parts).error);
});

test('📦 ป้ายลิงก์ชิ้นงาน (/qr-labels แท็บ ชิ้นงาน) ผ่านด่านหยิบของสโตร์เหมือนบาร์โค้ด MAT เดิม', async () => {
  const { buildQrUrl } = await import('../qrCode.js');
  const { checkPickPart } = await import('../replenishGate.js');
  const url = buildQrUrl('product', '10100401', 'https://esm.example.com');
  assert.equal(url, 'https://esm.example.com/scan?c=ESM%3AP%3A10100401');
  const scan = parseQrPayload(url);
  assert.deepEqual([scan.kind, scan.id], ['product', '10100401']);
  assert.equal(checkPickPart({ request: { mat_no: '10100401' }, scan }).status, 'ok');
  assert.equal(checkPickPart({ request: { mat_no: '10200500' }, scan }).block, true);
  assert.equal(findQaPartByScan(scan, parts).part.id, 'a');
});
