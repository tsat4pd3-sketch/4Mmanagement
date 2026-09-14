/* ⚡ กฎไม่นับซ้ำแม่-ลูก ของยอดพลังงาน (src/utils/energy.js)
   ที่มา: หน้างานอ่านมิเตอร์แยก HDF1/HDF2 ได้ (Micrologic ในห้อง MDB) แต่ระบบเดิมให้กรอกได้แค่ไลน์แม่
   → เปิดให้กรอกทุกชั้น แล้วคุมการนับซ้ำที่ util นี้ที่เดียว (หน้า /energy + ผัง /factory-map ใช้ร่วมกัน)
   invariant ที่ห้ามพัง: **ผลรวมของ counted ต้องไม่นับค่าเดียวกันสองรอบ** */
import test from 'node:test';
import assert from 'node:assert/strict';
import { energyRollup, pctOf, outlierVsHistory } from '../energy.js';

/* ลำดับชั้นจริงของโรงงาน (production_lines): HYDROFORM → HDF1/HDF2/LASER-345/LASER-789 */
const PARENT = {
  'line::HDF1': 'line::HYDROFORM',
  'line::HDF2': 'line::HYDROFORM',
  'line::LASER-345': 'line::HYDROFORM',
  'line::LASER-789': 'line::HYDROFORM',
};
const parentOf = (k) => PARENT[k] || null;
const sumCounted = (rows) => rows.filter(r => r.counted).reduce((s, r) => s + r.qty, 0);

test('แม่กรอกค่ารวมไว้ → ลูกไม่ถูกนับซ้ำ (เคสที่ใช้อยู่ก่อนหน้านี้)', () => {
  const rows = energyRollup([
    { key: 'line::HYDROFORM', qty: 67100 },
    { key: 'line::HDF1', qty: 20000 },
    { key: 'line::HDF2', qty: 18000 },
  ], parentOf);
  assert.equal(sumCounted(rows), 67100);
  const hdf1 = rows.find(r => r.key === 'line::HDF1');
  assert.equal(hdf1.counted, false);
  assert.equal(hdf1.coveredBy, 'line::HYDROFORM');
  // แม่ต้องรู้ว่าลูกรวมได้เท่าไหร่ → เอาไปทวนว่า "ลูกครบหรือยัง"
  const par = rows.find(r => r.key === 'line::HYDROFORM');
  assert.equal(par.childQty, 38000);
  assert.equal(par.childCount, 2);
});

test('แม่ไม่กรอก → รวมลูกขึ้นมาเป็นยอดกลุ่ม (สิ่งที่หน้างานขอ: แยก HDF-01/HDF-02)', () => {
  const rows = energyRollup([
    { key: 'line::HYDROFORM', qty: null },
    { key: 'line::HDF1', qty: 20000 },
    { key: 'line::HDF2', qty: 18000 },
    { key: 'line::LASER-345', qty: 15000 },
    { key: 'line::LASER-789', qty: 14100 },
  ], parentOf);
  assert.equal(sumCounted(rows), 67100);
  assert.equal(rows.find(r => r.key === 'line::HDF1').counted, true);
  assert.equal(rows.find(r => r.key === 'line::HYDROFORM').childCount, 0);
});

test('ข้ามชั้นได้ — ปู่กรอกไว้ ชั้นกลางว่าง หลานต้องไม่ถูกนับซ้ำ', () => {
  const p = (k) => ({ 'line::c': 'line::b', 'line::b': 'line::a' }[k] || null);
  const rows = energyRollup([{ key: 'line::a', qty: 100 }, { key: 'line::c', qty: 40 }], p);
  assert.equal(sumCounted(rows), 100);
  assert.equal(rows.find(r => r.key === 'line::c').coveredBy, 'line::a');
});

test('แม่อยู่นอกลิสต์ (โดน scope ตัด) → ลูกนับตัวเอง ไม่มีใครนับแทน', () => {
  const rows = energyRollup([{ key: 'line::HDF1', qty: 20000 }, { key: 'line::HDF2', qty: 18000 }], parentOf);
  assert.equal(sumCounted(rows), 38000);
});

test('โซน facility ไม่มีแม่ → นับเสมอ · ค่าว่างไม่นับ (null ≠ 0)', () => {
  const rows = energyRollup([
    { key: 'zone::Airbooster', qty: 8590 },
    { key: 'zone::UTLITY  STEEL', qty: null },
    { key: 'zone::x', qty: '' },
  ], parentOf);
  assert.equal(sumCounted(rows), 8590);
  assert.equal(rows.filter(r => r.counted).length, 1);
  assert.equal(rows.find(r => r.key === 'zone::x').qty, null);
});

test('parent วนกันเอง ต้องไม่ค้าง (guard เดียวกับ stdGroupOf)', () => {
  const loop = (k) => ({ 'line::a': 'line::b', 'line::b': 'line::a' }[k] || null);
  const rows = energyRollup([{ key: 'line::a', qty: 10 }, { key: 'line::b', qty: 20 }], loop);
  assert.equal(rows.length, 2);   // ไม่แฮงค์ = ผ่าน
});

test('pctOf — เทียบไม่ได้ต้องคืน null ห้ามคืน 0', () => {
  assert.equal(pctOf(38000, 67100), 56.6);
  assert.equal(pctOf(null, 100), null);
  assert.equal(pctOf(10, 0), null);
  assert.equal(pctOf(0, 100), 0);       // กรอก 0 จริง = 0% ไม่ใช่ null
});

test('outlierVsHistory — จับค่าพิมพ์ผิดหลัก (เคสจริง Utility Hydroforming เม.ย. 69)', () => {
  const hist = [55460, 53610, 61130, 55820, 51800, 67100];
  const hit = outlierVsHistory(953940, hist);
  assert.ok(hit && hit.kind === 'high' && hit.ratio > 10);
  assert.equal(outlierVsHistory(58000, hist), null);          // ค่าปกติ = ไม่กวน
  assert.equal(outlierVsHistory(953940, [55460, 53610]), null); // ประวัติน้อยเกินไป = ไม่เดา
  assert.equal(outlierVsHistory(null, hist), null);
  assert.ok(outlierVsHistory(500, hist)?.kind === 'low');      // ลืมเติมหลักก็ต้องเห็น
});
