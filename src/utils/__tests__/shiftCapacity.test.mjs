import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadByLane, committedMin, checkShiftCapacity, SPENT_STATUSES } from '../shiftCapacity.js';

/* CT 60 วินาที = 1 นาที/ชิ้น → อ่านเลขในเทสง่าย */
const ct60 = () => 60;
const ord = (qty, machine_no, mat_no = 'M1', status = 'open') => ({ qty, machine_no, mat_no, status });

test('🔴 เคสจริง 02/10 ASSEMBLY 1 — 55 ใบ 6 เครื่องขนาน ต้องไม่เตือน (เดิมแจ้งเกิน 1,605 นาที)', () => {
  // 2,120 นาทีกระจาย 6 เครื่องเท่าๆ กัน ≈ 353 นาที/เครื่อง · ความจุกะ 590 นาที
  const orders = [];
  for (let i = 0; i < 60; i++) orders.push(ord(353 / 10, `MC${i % 6}`, `M${i % 6}`));
  const hit = checkShiftCapacity({
    netAvailMin: 590, newQty: 20, newCtSec: 225,           // ใบใหม่ 75 นาที
    orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 6, machineNo: 'MC0',
  });
  assert.equal(hit, null, 'เลนละ ~353 + ใบใหม่ 75 = 428 < 590 ⇒ ห้ามเตือน');

  // ถ้าบวกเรียงกันแบบเดิม (สายเดียว) จะเตือน — ล็อกไว้ว่านี่คือพฤติกรรม "เก่า" ที่ผิดสำหรับไลน์ขนาน
  const serial = checkShiftCapacity({
    netAvailMin: 590, newQty: 20, newCtSec: 225,
    orders, ctOf: ct60, flowMode: 'one_piece_flow',
  });
  assert.ok(serial && serial.overMin > 1500, 'สายเดียวยังต้องเตือนเหมือนเดิม');
});

test('one_piece_flow = บวกทั้งกะ (พฤติกรรมเดิมเป๊ะ ห้ามเปลี่ยน)', () => {
  const orders = [ord(100, 'A'), ord(100, 'B'), ord(100, null)];
  const c = committedMin({ orders, ctOf: ct60, flowMode: 'one_piece_flow' });
  assert.equal(c.committedMin, 300);
  assert.equal(c.basis, 'line');
  assert.equal(c.lanes, 1);
});

test('parallel_machine = ภาระของเลนที่ใบใหม่จะไปลง ไม่ใช่ผลรวม', () => {
  const orders = [ord(300, 'A'), ord(60, 'B'), ord(60, 'C')];
  const a = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 3, machineNo: 'A' });
  assert.equal(a.committedMin, 300, 'เปิดที่เครื่อง A = เห็นภาระของ A');
  const b = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 3, machineNo: 'B' });
  assert.equal(b.committedMin, 60, 'เปิดที่เครื่อง B = 60 ไม่ใช่ 420');
  const fresh = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 3, machineNo: 'D' });
  assert.equal(fresh.committedMin, 0, 'เครื่องที่ยังไม่มีงาน = ว่าง');
});

test('ใบที่ยังไม่ผูกเครื่อง ต้องเกลี่ยลงทุกเลน ไม่ใช่โยนลงเลนเดียว', () => {
  const orders = [ord(60, 'A'), ord(300, null)];
  const c = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 3, machineNo: 'A' });
  assert.equal(c.committedMin, 60 + 100, '300 เกลี่ย 3 เลน = 100 ต่อเลน');
});

test('ไม่รู้ว่าจะเปิดเครื่องไหน = ใช้เลนที่หนักสุด (ระวังไว้ก่อน ไม่ใช่มองโลกสวย)', () => {
  const orders = [ord(300, 'A'), ord(60, 'B')];
  const c = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 2, machineNo: null });
  assert.equal(c.committedMin, 300);
});

test('🔴 ไม่รู้ความจุกะ (netAvailMin = null) = ไม่เตือน — "ไม่รู้" ไม่ใช่ "เกิน"', () => {
  assert.equal(checkShiftCapacity({ netAvailMin: null, newQty: 999, newCtSec: 600, orders: [], ctOf: ct60 }), null);
});

test('🔴 ใบใหม่ไม่มี CT = คิดไม่ได้ ห้ามเดา ห้ามเตือน', () => {
  assert.equal(checkShiftCapacity({ netAvailMin: 10, newQty: 999, newCtSec: 0, orders: [], ctOf: ct60 }), null);
  assert.equal(checkShiftCapacity({ netAvailMin: 10, newQty: 999, newCtSec: null, orders: [], ctOf: ct60 }), null);
});

test('🔴 ใบเดิมที่ไม่มี CT ไม่ถูกนับเข้าภาระ แต่ต้องรายงาน unknownCt ให้จอเขียนบอก', () => {
  const ctOf = (m) => (m === 'NOCT' ? 0 : 60);
  const orders = [ord(60, 'A', 'M1'), ord(999, 'A', 'NOCT')];
  const c = committedMin({ orders, ctOf, flowMode: 'parallel_machine', parallelUnits: 2, machineNo: 'A' });
  assert.equal(c.committedMin, 60);
  assert.equal(c.unknownCt, 1, 'ต้องบอกว่ามี 1 ใบที่คำนวณไม่ได้ ห้ามเงียบ');
});

test('🔴 งานคู่ RH/LH ในเลนเดียวกัน = 1 shot ไม่ใช่บวก 2 ข้าง (ชิ้น ≠ shot)', () => {
  const pairOf = (m) => ({ RH: 'LH', LH: 'RH' }[m] || null);
  const orders = [ord(100, 'A', 'RH'), ord(100, 'A', 'LH')];
  const withPair = committedMin({ orders, ctOf: ct60, pairOf, flowMode: 'parallel_machine', parallelUnits: 2, machineNo: 'A' });
  assert.equal(withPair.committedMin, 100, 'ปั๊มทีเดียวได้ 2 ข้าง = 100 นาที');
  const noPair = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 2, machineNo: 'A' });
  assert.equal(noPair.committedMin, 200, 'ไม่ประกาศคู่ = นับเต็มทั้งสองข้าง');
});

test('ใบคู่ที่มีข้างเดียวในกะ ต้องนับเต็ม (ผลิตเดี่ยวรอบนี้)', () => {
  const pairOf = (m) => ({ RH: 'LH', LH: 'RH' }[m] || null);
  const c = committedMin({ orders: [ord(100, 'A', 'RH')], ctOf: ct60, pairOf, flowMode: 'parallel_machine', parallelUnits: 2, machineNo: 'A' });
  assert.equal(c.committedMin, 100);
});

test('สถานะที่ไม่กินความจุแล้ว (cancelled/imported/carry_over) ต้องไม่ถูกนับ · confirmed ต้องนับ', () => {
  SPENT_STATUSES.forEach(st => {
    const c = committedMin({ orders: [ord(100, 'A', 'M1', st)], ctOf: ct60, flowMode: 'one_piece_flow' });
    assert.equal(c.committedMin, 0, `${st} ต้องไม่กินความจุ`);
  });
  const done = committedMin({ orders: [ord(100, 'A', 'M1', 'confirmed')], ctOf: ct60, flowMode: 'one_piece_flow' });
  assert.equal(done.committedMin, 100, 'ใบที่ปิดแล้วกินเวลากะไปจริง ต้องนับ');
});

test('จำนวนเลนต้องไม่น้อยกว่าเครื่องที่มีงานจริง (ทะเบียนตั้ง parallel_stations ต่ำกว่าความจริงได้)', () => {
  const orders = [ord(60, 'A'), ord(60, 'B'), ord(60, 'C'), ord(300, null)];
  const c = committedMin({ orders, ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 1, machineNo: 'A' });
  assert.equal(c.lanes, 3);
  assert.equal(c.committedMin, 60 + 100);
});

test('ผลลัพธ์ที่เกินจริง ต้องคืนตัวเลขครบให้จอเขียนได้ (เหลือเท่าไหร่ · เกินเท่าไหร่ · ใบใหม่กี่นาที)', () => {
  const hit = checkShiftCapacity({
    netAvailMin: 100, newQty: 60, newCtSec: 60,
    orders: [ord(60, 'A')], ctOf: ct60, flowMode: 'parallel_machine', parallelUnits: 2, machineNo: 'A',
  });
  assert.deepEqual(
    { o: hit.overMin, r: hit.remainMin, n: hit.newOrderMin, b: hit.basis, l: hit.lane },
    { o: 20, r: 40, n: 60, b: 'machine', l: 'A' },
  );
});

test('loadByLane: totalMin = ผลรวมทุกเลน + ส่วนลอย (ไว้ให้จอโชว์ภาพรวมทั้งไลน์ได้ด้วย)', () => {
  const { byLane, floating, totalMin } = loadByLane([ord(60, 'A'), ord(120, 'B'), ord(30, null)], ct60);
  assert.equal(byLane.get('A'), 60);
  assert.equal(byLane.get('B'), 120);
  assert.equal(floating, 30);
  assert.equal(totalMin, 210);
});

test('ข้อมูลเพี้ยนต้องไม่โยน error (qty/CT เป็นข้อความ · แถว null)', () => {
  const c = committedMin({ orders: [null, { qty: 'x', mat_no: 'M1', machine_no: 'A' }], ctOf: ct60, flowMode: 'one_piece_flow' });
  assert.equal(c.committedMin, 0);
});
