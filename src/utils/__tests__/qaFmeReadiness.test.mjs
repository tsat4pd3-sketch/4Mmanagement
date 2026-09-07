/**
 * เทส src/utils/qaFmeReadiness.js — preflight ก่อนเปิดสวิตช์เรียกตรวจ FME
 *
 * กติกาที่ห้าม regress:
 *   1. การจับคู่รุ่น → พาร์ท QA ต้องเหมือน edge qa-fme-scan §5 ทุกชั้น
 *      (mat_no ตรง → p_no ลูกค้า → part_no = เลข SAP · normalize ตัด "-"/ช่องว่าง/ตัวพิมพ์)
 *   2. ผูกได้ 0 รุ่น = เปิดไม่ได้ (hard) · ห้อง qa_fme_call ว่าง = เปิดไม่ได้ (hard)
 *      ห้อง qa_fme_overdue ว่าง = เตือนเฉยๆ (soft)
 *   3. ข้อมูลโหลดไม่มา = ok:null + เหตุผล และถือว่ายังไม่พร้อม — ห้ามแปลงเป็น "ผ่าน"
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normNo, makeQaPartResolver, countLinkedModels, assessFmeReadiness } from '../qaFmeReadiness.js';

const PRODUCTS = [
  { mat_no: '10100335', p_no: 'RB3B-16E061-BA', pair_mat_no: null },
  { mat_no: '10100401', p_no: 'RB3B-16E061-BA', pair_mat_no: null },
  { mat_no: '10200001', p_no: 'AB1C-1234-LH', pair_mat_no: '10200002' },
  { mat_no: '10200002', p_no: 'AB1C-1234-RH', pair_mat_no: '10200001' },
  { mat_no: '10300000', p_no: null, pair_mat_no: null },
];
const ROOMS_OK = [
  { event_key: 'qa_fme_call', channel_ids: ['c1'], is_enabled: true },
  { event_key: 'qa_fme_overdue', channel_ids: ['c1'], is_enabled: true },
];

test('normNo ตัด - ช่องว่าง และตัวพิมพ์ เหมือน edge', () => {
  assert.equal(normNo(' rb3b-16e061 ba '), 'RB3B16E061BA');
  assert.equal(normNo(null), '');
});

test('resolver: mat_no ตรงชนะก่อน แล้วค่อย p_no แล้วค่อย part_no=เลข SAP', () => {
  const r = makeQaPartResolver([
    { id: 'P-mat', part_no: 'X', mat_no: '10100335' },
    { id: 'P-pno', part_no: 'RB3B16E061BA' },            // เขียนไม่มีขีด — ต้องยังจับได้
    { id: 'P-sap', part_no: '10300000' },
  ], PRODUCTS);
  assert.equal(r(['10100335']), 'P-mat');
  assert.equal(r(['10100401']), 'P-pno');                // ไม่มี mat ตรง → ถอยไป p_no
  assert.equal(r(['10300000']), 'P-sap');                // ไม่มี p_no → part_no = เลข SAP
  assert.equal(r(['99999999']), null);
  assert.equal(r([]), null);
});

test('resolver: งานคู่ RH/LH — ผูกฝั่งเดียว ก็ครอบตัวแทน+คู่', () => {
  const r = makeQaPartResolver([{ id: 'P-rh', mat_no: '10200002' }], PRODUCTS);
  assert.equal(r(['10200001', '10200002']), 'P-rh');
});

test('countLinkedModels: นับรุ่นที่ผูกได้ (คู่ RH/LH ผูกฝั่งเดียวนับทั้งคู่)', () => {
  const c = countLinkedModels([{ id: 'a', part_no: 'RB3B-16E061-BA' }, { id: 'b', mat_no: '10200001' }], PRODUCTS);
  assert.deepEqual(c, { models: 5, linked: 4, parts: 2, partsWithMat: 1 });
  assert.deepEqual(countLinkedModels([], PRODUCTS), { models: 5, linked: 0, parts: 0, partsWithMat: 0 });
  // mat_no ว่าง/ช่องว่าง ไม่นับว่า "ตั้ง MAT แล้ว"
  assert.equal(countLinkedModels([{ id: 'x', mat_no: '  ' }], PRODUCTS).partsWithMat, 0);
});

test('สถานะจริง 2026-09-03: qa_parts 2 แถวไม่ตรงรุ่นไหน + ห้องว่าง → เปิดไม่ได้ 2 ข้อ hard', () => {
  const res = assessFmeReadiness({
    qaParts: [{ id: 'a', part_no: 'OLD-1' }, { id: 'b', part_no: 'OLD-2' }],
    products: PRODUCTS,
    rules: [{ event_key: 'qa_fme_call', channel_ids: [], is_enabled: true },
            { event_key: 'qa_fme_overdue', channel_ids: [], is_enabled: true }],
  });
  assert.equal(res.canEnable, false);
  const byKey = Object.fromEntries(res.checks.map(c => [c.key, c]));
  assert.equal(byKey.parts.ok, false);
  assert.match(byKey.parts.detail, /ไม่ตรงกับรุ่นที่ผลิต/);
  assert.equal(byKey.parts.fixAt, '/qa-setup');
  assert.equal(byKey.room_call.ok, false);
  assert.equal(byKey.room_call.hard, true);
  assert.equal(byKey.room_overdue.ok, false);
  assert.equal(byKey.room_overdue.hard, false);
});

test('พร้อมทุกข้อ → เปิดได้ · ห้องเกินเวลาว่างอย่างเดียว → ยังเปิดได้ (soft)', () => {
  const parts = [{ id: 'a', part_no: 'RB3B-16E061-BA' }];
  assert.equal(assessFmeReadiness({ qaParts: parts, products: PRODUCTS, rules: ROOMS_OK }).canEnable, true);
  const soft = assessFmeReadiness({ qaParts: parts, products: PRODUCTS,
    rules: [ROOMS_OK[0], { event_key: 'qa_fme_overdue', channel_ids: [], is_enabled: true }] });
  assert.equal(soft.canEnable, true);
  assert.equal(soft.checks.find(c => c.key === 'room_overdue').ok, false);
});

test('rule qa_fme_call ถูกปิด (is_enabled=false) หรือไม่มีแถว → เปิดไม่ได้ + บอกเหตุผลต่างกัน', () => {
  const parts = [{ id: 'a', part_no: 'RB3B-16E061-BA' }];
  const off = assessFmeReadiness({ qaParts: parts, products: PRODUCTS,
    rules: [{ event_key: 'qa_fme_call', channel_ids: ['c1'], is_enabled: false }] });
  assert.equal(off.canEnable, false);
  assert.match(off.checks.find(c => c.key === 'room_call').detail, /ถูกปิด/);
  const none = assessFmeReadiness({ qaParts: parts, products: PRODUCTS, rules: [] });
  assert.equal(none.canEnable, false);
  assert.match(none.checks.find(c => c.key === 'room_call').detail, /migration/);
});

test('โหลดข้อมูลไม่ได้ (null) = ok:null + เหตุผล และยังเปิดไม่ได้ — ห้ามเดาว่าผ่าน', () => {
  const r1 = assessFmeReadiness({ qaParts: null, products: PRODUCTS, rules: ROOMS_OK });
  assert.equal(r1.canEnable, false);
  assert.equal(r1.checks.find(c => c.key === 'parts').ok, null);
  assert.match(r1.checks.find(c => c.key === 'parts').detail, /qa_parts/);
  const r2 = assessFmeReadiness({ qaParts: [{ id: 'a', part_no: 'RB3B-16E061-BA' }], products: PRODUCTS, rules: null });
  assert.equal(r2.canEnable, false);
  assert.equal(r2.checks.find(c => c.key === 'room_call').ok, null);
  const r3 = assessFmeReadiness({});
  assert.equal(r3.canEnable, false);
  assert.ok(r3.checks.every(c => c.ok === null));
});
