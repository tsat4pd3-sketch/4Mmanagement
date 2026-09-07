import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsForLine, checkDeliveryPoint, buildDeliverPayload, validateDeliverPayload, overrideReasonOk, OVERRIDE_REASONS, DELIVER_GATES } from '../replenishGate.js';
import { parseQrPayload, buildQrPayload, resolveDeliveryPoint } from '../qrCode.js';

/* ด่านขั้น 7 ของลูปสโตร์ — docs/STORE-PULL-LOOP-DESIGN.md §4.5/§4.6 (2026-09-03) */

const P60  = { id: 'p-60',  code: 'DP-60',  name: 'จุดรับของหน้า OP10', line_names: ['LINE 60'], is_active: true };
const P61  = { id: 'p-61',  code: 'DP-61',  name: 'จุดรับของหน้า OP20', line_names: ['LINE 61'], is_active: true };
const PRK  = { id: 'p-rk',  code: 'RK-6061', name: 'แร็คกลาง 60/61', line_names: ['LINE 60', 'LINE 61'], is_active: true };
const POFF = { id: 'p-off', code: 'DP-OLD', name: 'จุดเก่า (ปิดแล้ว)', line_names: ['LINE 60'], is_active: false };
const ALL = [P60, P61, PRK, POFF];
const req61 = { id: 'r1', line_name: 'LINE 61', mat_no: '30045438', request_qty: 60 };

test('pointsForLine — เฉพาะจุด active ที่ให้บริการไลน์นั้น · 1 จุดหลายไลน์ได้', () => {
  assert.deepEqual(pointsForLine(ALL, 'LINE 61').map(p => p.id), ['p-61', 'p-rk']);
  assert.deepEqual(pointsForLine(ALL, 'LINE 60').map(p => p.id), ['p-60', 'p-rk']);   // จุดปิดแล้วไม่นับ
  assert.deepEqual(pointsForLine(ALL, 'LINE 99'), []);
  assert.deepEqual(pointsForLine(ALL, ''), []);
  // แถวจาก mock/ฐานที่ line_names เป็น null ต้องไม่พัง
  assert.deepEqual(pointsForLine([{ id: 'x', line_names: null }], 'LINE 60'), []);
});

test('✓ สแกนถูกจุด → ok + gate scanned (จุดร่วมของ 2 ไลน์ก็ผ่านสำหรับทั้งคู่)', () => {
  const r1 = checkDeliveryPoint({ request: req61, point: P61, points: ALL });
  assert.equal(r1.status, 'ok'); assert.equal(r1.gate, 'scanned'); assert.equal(r1.block, false);
  const r2 = checkDeliveryPoint({ request: req61, point: PRK, points: ALL });
  assert.equal(r2.status, 'ok');
  const r3 = checkDeliveryPoint({ request: { line_name: 'LINE 60' }, point: PRK, points: ALL });
  assert.equal(r3.status, 'ok');
});

test('🔴 สแกนจุดของไลน์อื่น → mismatch + บล็อก + ข้อความบอก "ที่ถูกคืออะไร" (กฎ §4.6 ข้อ 7)', () => {
  const r = checkDeliveryPoint({ request: req61, point: P60, points: ALL });
  assert.equal(r.status, 'mismatch'); assert.equal(r.block, true);
  assert.match(r.message, /LINE 61/);          // ปลายทางบนใบ
  assert.match(r.message, /DP-60/);            // สิ่งที่ยิงมา
  assert.match(r.message, /ของ LINE 60/);      // ป้ายนั้นเป็นของใคร
  assert.match(r.message, /DP-61/);            // ที่ถูกต้องไปที่ไหน
  assert.equal(r.expected, 'DP-61 · จุดรับของหน้า OP20 / RK-6061 · แร็คกลาง 60/61');
});

test('🔴 จุดที่ปิดใช้งานแล้ว = ไม่ผ่าน ถึงจะเคยเป็นของไลน์นี้ (ป้ายเก่ายังติดอยู่หน้างาน)', () => {
  const r = checkDeliveryPoint({ request: { line_name: 'LINE 60' }, point: POFF, points: ALL });
  assert.equal(r.status, 'mismatch'); assert.equal(r.block, true);
});

test('🔴 ป้ายที่ไม่ใช่จุดส่ง (resolve ไม่ได้) → unknown + บล็อก + บอกจุดที่ถูก', () => {
  const r = checkDeliveryPoint({ request: req61, point: null, points: ALL, scannedRaw: 'ESM:M:abc' });
  assert.equal(r.status, 'unknown'); assert.equal(r.block, true);
  assert.match(r.message, /ESM:M:abc/); assert.match(r.message, /DP-61/);
});

test('⚪ ไม่รู้ = ห้ามบล็อก — ไลน์ยังไม่ตั้งจุดส่ง → no_point ผ่านได้ + ข้อความชี้ไปตั้ง (กฎ §4.6 ข้อ 3)', () => {
  const r = checkDeliveryPoint({ request: { line_name: 'LINE 99' }, point: null, points: ALL });
  assert.equal(r.status, 'no_point'); assert.equal(r.gate, 'no_point'); assert.equal(r.block, false);
  assert.match(r.message, /ยังไม่ตั้งจุดส่ง/);
  // ยิงป้ายของไลน์อื่นมาก็ยังไม่บล็อก — เพราะไม่มีอะไรให้เทียบ (ไม่ใช่ "ถูก" แต่ "ตรวจไม่ได้")
  const r2 = checkDeliveryPoint({ request: { line_name: 'LINE 99' }, point: P60, points: ALL });
  assert.equal(r2.status, 'no_point'); assert.equal(r2.block, false);
});

test('buildDeliverPayload — scanned เก็บ id+ชื่อจุด · override เก็บเหตุผล+คนปลด · no_point ว่าง', () => {
  const a = buildDeliverPayload({ gate: 'scanned', point: P61 });
  assert.equal(a.delivered_gate, 'scanned'); assert.equal(a.delivered_point_id, 'p-61');
  assert.equal(a.delivered_point_name, 'DP-61 · จุดรับของหน้า OP20'); assert.equal(a.delivered_override_reason, null);
  const b = buildDeliverPayload({ gate: 'override', point: P60, reasonKey: 'label_missing', overrideBy: 'สมชาย' });
  assert.equal(b.delivered_gate, 'override'); assert.equal(b.delivered_point_id, 'p-60');
  assert.equal(b.delivered_override_reason, OVERRIDE_REASONS[0].label); assert.equal(b.delivered_override_by_name, 'สมชาย');
  const c = buildDeliverPayload({ gate: 'override', reasonKey: 'other', reasonNote: 'ไฟดับ สแกนไม่ได้', overrideBy: 'สมชาย' });
  assert.equal(c.delivered_override_reason, 'อื่นๆ (ระบุ) — ไฟดับ สแกนไม่ได้');
  const d = buildDeliverPayload({ gate: 'no_point' });
  assert.equal(d.delivered_point_id, null); assert.equal(d.delivered_override_reason, null);
});

test('🔴 validateDeliverPayload = ตารางความจริงเดียวกับ trigger ฝั่ง DB — ห้าม drift', () => {
  assert.equal(validateDeliverPayload({ delivered_gate: 'no_point' }), null);
  assert.equal(validateDeliverPayload({ delivered_gate: 'scanned', delivered_point_id: 'p-61' }), null);
  assert.equal(validateDeliverPayload({ delivered_gate: 'override', delivered_override_reason: 'ป้ายหาย' }), null);
  assert.notEqual(validateDeliverPayload({ delivered_gate: 'scanned' }), null);                    // scanned แต่ไม่มีจุด
  assert.notEqual(validateDeliverPayload({ delivered_gate: 'override', delivered_override_reason: ' ' }), null);
  assert.notEqual(validateDeliverPayload({}), null);                                               // ไม่มี gate = ไม่ผ่าน
  assert.notEqual(validateDeliverPayload({ delivered_gate: 'whatever' }), null);
  assert.notEqual(validateDeliverPayload(null), null);
});

test('overrideReasonOk — other ต้องมีข้อความ · key นอกลิสต์ไม่ผ่าน', () => {
  assert.equal(overrideReasonOk('label_missing'), true);
  assert.equal(overrideReasonOk('other', ''), false);
  assert.equal(overrideReasonOk('other', 'ป้ายหลุด'), true);
  assert.equal(overrideReasonOk('nope'), false);
  assert.equal(overrideReasonOk(''), false);
});

test('DELIVER_GATES ครบ 3 ทาง และทุกตัวมี label/icon/color (จอพึ่ง 3 ค่านี้)', () => {
  assert.deepEqual(Object.keys(DELIVER_GATES).sort(), ['no_point', 'override', 'scanned']);
  Object.values(DELIVER_GATES).forEach(g => { assert.ok(g.label && g.icon && g.color); });
});

/* ── QR ชนิดใหม่ ESM:D — ตัวอ่านต้องทน 3 แบบเหมือนชนิดอื่น ── */
test('ESM:D:<uuid> — สร้าง/แกะ/resolve ครบ · เลขเปล่าเทียบ code · ป้ายเครื่องไม่ถูกเดาเป็นจุดส่ง', () => {
  const payload = buildQrPayload('delivery', 'p-61');
  assert.equal(payload, 'ESM:D:p-61');
  const s1 = parseQrPayload(payload + '\r\n');                 // ปืนยิงต่อท้าย CR/LF
  assert.equal(s1.kind, 'delivery'); assert.equal(s1.id, 'p-61');
  assert.equal(resolveDeliveryPoint(s1, ALL), P61);
  const s2 = parseQrPayload('https://esm.example/scan?c=ESM:D:p-rk');
  assert.equal(resolveDeliveryPoint(s2, ALL), PRK);
  const s3 = parseQrPayload(' dp-61 ');                        // พิมพ์รหัสสั้นบนป้ายเอง
  assert.equal(s3.kind, null);
  assert.equal(resolveDeliveryPoint(s3, ALL), P61);
  const s4 = parseQrPayload('ESM:M:machine-uuid');             // ยิงป้ายเครื่องแทน = null ห้ามเดา
  assert.equal(resolveDeliveryPoint(s4, ALL), null);
  assert.equal(resolveDeliveryPoint(parseQrPayload('ESM:D:not-exist'), ALL), null);
  assert.equal(resolveDeliveryPoint(null, ALL), null);
});
