/* ด่าน "แม่พิมพ์/จิ๊กห้ามโหวตว่าไลน์นี้เป็นกระบวนการอะไร" (2026-10-27 · บั๊กจริง)
   วัดจากทะเบียนจริง: machines 226 · die 268 · jig 190 · facility 44 — และ 674/728 แถว
   process_type = 'welding_assembly' (ค่า default ที่ไม่มีใครแก้)
   ⇒ 4 ไลน์ (HDF1 · HDF2 · LASER-345 · LASER-789) เคยถูกตีเป็น welding_assembly
   ทั้งที่เครื่องจักรทั้งหมดเป็น metal_forming ⇒ นโยบายเวลาพักผิดชุด ⇒ %A/%P ผิดทั้งกะ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machineAssetsOnly, machineLaneCount, processUnionRows, ASSET_KIND_MACHINE } from '../machineAssets.js';

const row = (kind, pt) => ({ equipment_kind: kind, process_type: pt });

test('เหลือเฉพาะ equipment_kind = machine', () => {
  const rows = [row('machine', 'metal_forming'), row('die', 'welding_assembly'), row('jig', 'welding_assembly'), row('facility', 'welding_assembly')];
  const out = machineAssetsOnly(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].process_type, 'metal_forming');
});

test('🔴 เคสจริง HDF1 — แม่พิมพ์+จิ๊กโหวตชนะเครื่องจักร ต้องไม่เกิดอีก', () => {
  // HDF1: เครื่องจักร 12 ตัว metal_forming · ที่เหลือเป็นแม่พิมพ์/จิ๊ก welding_assembly 6 ตัว (รวมโหวตเดิม 18)
  const rows = [
    ...Array.from({ length: 12 }, () => row('machine', 'metal_forming')),
    ...Array.from({ length: 6 }, () => row('die', 'welding_assembly')),
  ];
  const vote = (list) => {
    const c = {};
    list.forEach(m => { c[m.process_type] = (c[m.process_type] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  assert.equal(vote(rows), 'metal_forming', 'เคสนี้เครื่องจักรมากกว่าอยู่แล้ว');
  // เคสที่พลิกจริง (LASER-345: เครื่องจักร 7 · แม่พิมพ์/จิ๊ก 15)
  const laser = [
    ...Array.from({ length: 7 }, () => row('machine', 'metal_forming')),
    ...Array.from({ length: 15 }, () => row('die', 'welding_assembly')),
  ];
  assert.equal(vote(laser), 'welding_assembly', 'ยืนยันว่าถ้าไม่กรอง จะได้ค่าผิด');
  assert.equal(vote(machineAssetsOnly(laser)), 'metal_forming', 'กรองแล้วต้องได้ของเครื่องจักร');
});

test('ไลน์ที่ไม่มีเครื่องจักรเลย = คืนว่าง (ให้ผู้เรียกถอยไปดูสินค้าที่ผลิต · ห้ามนับจิ๊ก)', () => {
  // Airbooster / Utility Hydrofroming / UTLITY STEEL — มีแต่จิ๊ก/facility
  const rows = [row('jig', 'welding_assembly'), row('facility', 'welding_assembly')];
  assert.deepEqual(machineAssetsOnly(rows), []);
});

test('ทะเบียนที่ยังไม่รู้ชนิดสินทรัพย์ (equipment_kind null ทุกแถว) = พฤติกรรมเดิมเป๊ะ', () => {
  const rows = [row(null, 'metal_forming'), row(undefined, 'welding_assembly')];
  assert.equal(machineAssetsOnly(rows).length, 2, 'ไม่รู้ชนิด = ห้ามกรองทิ้ง (ไม่เปลี่ยนพฤติกรรมเงียบ)');
});

test('อินพุตเพี้ยนไม่ระเบิด', () => {
  assert.deepEqual(machineAssetsOnly(null), []);
  assert.deepEqual(machineAssetsOnly(undefined), []);
  assert.deepEqual(machineAssetsOnly([null, undefined]), []);
  assert.equal(ASSET_KIND_MACHINE, 'machine');
});

/* ── machineLaneCount — ตัวหารของเวลา downtime (เลนของไลน์เครื่องขนาน) ── */
const mc = (no, kind = 'machine') => ({ machine_no: no, equipment_kind: kind });

test('🔴 เคสจริง Line D1 — จิ๊กถูกนับเป็นเลน 9 ต้องเหลือ 4', () => {
  const rows = [
    mc('M1'), mc('M2'), mc('M3'), mc('M4'),
    mc('J1', 'jig'), mc('J2', 'jig'), mc('J3', 'jig'), mc('J4', 'jig'), mc('J5', 'jig'),
  ];
  assert.equal(new Set(rows.map(r => r.machine_no)).size, 9, 'ยืนยันว่าสูตรเดิมได้ 9');
  assert.equal(machineLaneCount(rows), 4);
});

test('นับเลขเครื่องไม่ซ้ำ (ทะเบียนมีแถวซ้ำได้)', () => {
  assert.equal(machineLaneCount([mc('M1'), mc('M1'), mc('M2')]), 2);
});

test('เลขเครื่องว่างไม่นับเป็นเลน', () => {
  assert.equal(machineLaneCount([mc('M1'), mc(''), mc(null), mc(undefined)]), 1);
});

test('ไม่มีเครื่องจักรเลย = 0 (ให้ parallelUnitsOf ถอยไปใช้ 1 ตามกติกาเดิม)', () => {
  assert.equal(machineLaneCount([mc('J1', 'jig'), mc('F1', 'facility')]), 0);
});

test('ทะเบียนที่ยังไม่รู้ชนิด = นับเหมือนเดิม (ไม่เปลี่ยนพฤติกรรมเงียบ)', () => {
  assert.equal(machineLaneCount([mc('M1', null), mc('M2', null)]), 2);
});

test('อินพุตเพี้ยน', () => {
  assert.equal(machineLaneCount(null), 0);
  assert.equal(machineLaneCount([null, undefined]), 0);
});

/* ── processUnionRows — "dropdown มีตัวเลือกอะไร" ต้องใจกว้าง (คนละคำถามกับการโหวต) ── */
test('🔴 เคสจริง Line 60 — metal_forming มาจากแม่พิมพ์/จิ๊ก ต้องไม่หายจากตัวเลือก', () => {
  const rows = [
    { equipment_kind: 'machine', process_type: 'welding_assembly' },
    { equipment_kind: 'die', process_type: 'metal_forming' },
  ];
  const union = new Set(processUnionRows(rows).map(r => r.process_type));
  assert.ok(union.has('metal_forming'), 'Line 60 ลง DT ประเภทนี้ไปแล้ว 10 ใบจริง — ห้ามซ่อน');
  assert.ok(union.has('welding_assembly'));
  // เทียบให้เห็นว่าอีกฟังก์ชันตั้งใจให้ผลต่างกัน
  const vote = new Set(machineAssetsOnly(rows).map(r => r.process_type));
  assert.deepEqual([...vote], ['welding_assembly'], 'การโหวตยังต้องกรอง (คนละคำถาม)');
});

test('ไลน์ที่ไม่มีเครื่องจักรเลย — ตัวเลือกยังต้องมี (ไม่ปล่อย dropdown ว่าง)', () => {
  // Airbooster / Utility Hydrofroming / UTLITY STEEL
  const rows = [{ equipment_kind: 'jig', process_type: 'welding_assembly' }];
  assert.equal(processUnionRows(rows).length, 1);
  assert.equal(machineAssetsOnly(rows).length, 0);
});

test('processUnionRows ทนอินพุตเพี้ยน', () => {
  assert.deepEqual(processUnionRows(null), []);
  assert.deepEqual(processUnionRows([null, undefined]), []);
});
