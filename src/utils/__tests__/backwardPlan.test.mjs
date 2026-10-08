/* ═══ เทส backward scheduling — "ย้อนจากวันส่งลูกค้า กลับมาว่าลูกต้องเสร็จวันไหน" (2026-09-22) ═══ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleBackward, makePrevWorkDay } from '../backwardPlan.js';
import { buildBomIndex } from '../bomTree.js';

const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d); t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
// ปฏิทินทดสอบ: จ-ศ ทำงาน · ส-อา หยุด (ไม่มีแถวในปฏิทิน = ใช้กฎ จ-ศ)
const prevWorkDay = makePrevWorkDay(() => null, addDays);

/*  FG 1000 ──(×1)── 2000 (พาร์ทลูก ปั๊ม) ──(×2)── 3000 (ของซื้อ)  */
const matOf = { pf: '1000', pm: '2000' };
const ROWS = [
  { id: 1, product_id: 'pf', mat_no: '2000', qty_per_unit: 1, uom: 'PC' },
  { id: 2, product_id: 'pm', mat_no: '3000', qty_per_unit: 2, uom: 'PC' },
];
const ix = () => buildBomIndex(ROWS, matOf);
// กำลังต่อวัน: FG 100/วัน · พาร์ทลูก 500/วัน · ของซื้อไม่มีไลน์ (0 = ไม่รู้กำลัง)
const capPerDayOf = (m) => ({ 1000: 100, 2000: 500 }[m] || 0);

const base = { ix: ix(), capPerDayOf, prevWorkDay, today: '2026-09-01' };

test('งานเล็ก (1 วันผลิต) — ลูกต้องมีของก่อน 1 วันทำงาน (transfer)', () => {
  // ศุกร์ 2026-09-25 ส่ง · FG 50 ตัว = 1 วันผลิต ⇒ เริ่มศุกร์ · ลูกต้องพร้อมพฤหัส 24
  const r = scheduleBackward({ ...base, demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }] });
  assert.equal(r.byDate['2026-09-25']['1000'], 50);
  assert.equal(r.byDate['2026-09-24']['2000'], 50, 'พาร์ทลูกต้องเสร็จก่อน 1 วัน');
  assert.equal(r.byDate['2026-09-23']['3000'], 100, 'ของซื้อถอยอีกชั้น (×2)');
});

test('🔴 lead time มาจากกำลังผลิตจริง — ของเยอะ = ถอยหลายวัน', () => {
  // FG 300 ตัว ÷ 100/วัน = 3 วันผลิต · ส่งศุกร์ 25 ⇒ เริ่มพุธ 23 ⇒ ลูกพร้อมอังคาร 22
  const r = scheduleBackward({ ...base, demandRows: [{ mat_no: '1000', qty: 300, due_date: '2026-09-25' }] });
  assert.equal(r.byDate['2026-09-25']['1000'], 300);
  assert.equal(r.byDate['2026-09-22']['2000'], 300);
  // ลูก 300 ÷ 500/วัน = 1 วัน ⇒ ของซื้อถอยอีก 1 วัน = จันทร์ 21
  assert.equal(r.byDate['2026-09-21']['3000'], 600);
});

test('🔴 ถอยวันต้องข้ามเสาร์-อาทิตย์', () => {
  // ส่งจันทร์ 2026-09-28 · FG 50 (1 วัน) ⇒ ลูกต้องพร้อม "ศุกร์ 25" ไม่ใช่ "อาทิตย์ 27"
  const r = scheduleBackward({ ...base, demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-28' }] });
  assert.ok(r.byDate['2026-09-25']?.['2000'], 'ต้องข้ามวันหยุดไปวันศุกร์');
  assert.equal(r.byDate['2026-09-26'], undefined);
  assert.equal(r.byDate['2026-09-27'], undefined);
});

test('ปฏิทินบริษัทมาร์ควันหยุด (รวม shutdown75) ต้องถูกข้ามด้วย', () => {
  const cal = { '2026-09-24': 'shutdown75', '2026-09-23': 'ot15' };
  const pw = makePrevWorkDay((d) => cal[d] || null, addDays);
  const r = scheduleBackward({
    ...base, prevWorkDay: pw,
    demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }],
  });
  assert.ok(r.byDate['2026-09-22']?.['2000'], 'ข้าม 24 (ม.75) และ 23 (วันหยุด) ไปที่ 22');
});

test('🔴 มีของใน STORE พอ = ตัดทั้งกิ่ง (ไม่ผลิตแม่ และไม่เบิกลูก)', () => {
  const r = scheduleBackward({
    ...base, stock: { 1000: 999 },
    demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }],
  });
  assert.deepEqual(r.byDate, {}, 'ของพอ = ไม่มีงานเลยทั้งต้น');
  assert.equal(r.absorbed, 50);
  assert.equal(r.leftover['1000'], 949);
});

test('มีของบางส่วน — ผลิตเฉพาะส่วนที่ขาด และลูกคิดตามส่วนที่ขาดเท่านั้น', () => {
  const r = scheduleBackward({
    ...base, stock: { 1000: 20 },
    demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }],
  });
  assert.equal(r.byDate['2026-09-25']['1000'], 30);
  assert.equal(r.byDate['2026-09-24']['2000'], 30, 'ลูกต้องคิดจากยอดสุทธิ ไม่ใช่ยอดดิบ');
});

test('🔴 ของกองเดียวใช้ได้ครั้งเดียว — ใบที่ถึงกำหนดก่อนได้ของก่อน', () => {
  const r = scheduleBackward({
    ...base, stock: { 1000: 60 },
    demandRows: [
      { mat_no: '1000', qty: 50, due_date: '2026-09-30' },   // ใส่สลับลำดับตั้งใจ
      { mat_no: '1000', qty: 50, due_date: '2026-09-25' },
    ],
  });
  assert.equal(r.byDate['2026-09-25'], undefined, 'ใบแรกสุดได้ของจาก STORE ครบ');
  assert.equal(r.byDate['2026-09-30']['1000'], 40, 'ใบหลังเหลือ buffer 10 → ผลิต 40');
});

test('🔴 ย้อนแล้วหลุดไปก่อนวันนี้ = ต้องรายงานว่าสายแล้ว ไม่ใช่ปัดเข้าวันนี้เงียบๆ', () => {
  // today = 2026-09-01 · ส่ง 2026-09-02 แต่ FG 1,000 ตัว = 10 วันผลิต ⇒ ต้องเริ่มตั้งแต่ ส.ค.
  const r = scheduleBackward({ ...base, demandRows: [{ mat_no: '1000', qty: 1000, due_date: '2026-09-02' }] });
  assert.ok(r.late.length > 0, 'ต้องมีรายการสาย');
  assert.equal(r.late[0].mat_no, '1000');
  assert.ok(r.late[0].needBy < '2026-09-01');
});

test('พาร์ทที่ไม่รู้กำลังผลิต — คิด 1 วัน แต่ต้องรายงานออกมา ห้ามเงียบ', () => {
  const r = scheduleBackward({ ...base, demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }] });
  assert.ok(r.noCapMats.includes('3000'), 'ของซื้อไม่มีกำลัง → ต้องติดรายชื่อไว้');
});

test('BOM วนลูปต้องไม่ค้าง และต้องนับ cycles', () => {
  const loop = [
    { id: 1, product_id: 'pa', mat_no: 'B', qty_per_unit: 1 },
    { id: 2, product_id: 'pb', mat_no: 'A', qty_per_unit: 1 },
  ];
  const r = scheduleBackward({
    ...base, ix: buildBomIndex(loop, { pa: 'A', pb: 'B' }),
    demandRows: [{ mat_no: 'A', qty: 10, due_date: '2026-09-25' }],
  });
  assert.ok(r.cycles > 0);
  assert.ok(Object.keys(r.byDate).length < 30, 'ต้องไม่ระเบิดไม่รู้จบ');
});

test('ข้อมูลไม่ครบ (ไม่มี ix / prevWorkDay / capPerDayOf) ต้องคืนค่าว่าง ไม่โยน error', () => {
  assert.deepEqual(scheduleBackward({ demandRows: [{ mat_no: 'A', qty: 1, due_date: '2026-09-25' }] }).byDate, {});
  assert.deepEqual(scheduleBackward({ ...base, ix: null, demandRows: [] }).byDate, {});
});

test('แถวที่ไม่มีวันส่ง/จำนวน ≤ 0 ต้องถูกข้าม', () => {
  const r = scheduleBackward({
    ...base,
    demandRows: [{ mat_no: '1000', qty: 50 }, { mat_no: '1000', qty: 0, due_date: '2026-09-25' }, {}],
  });
  assert.deepEqual(r.byDate, {});
});

test('transferDays = 0 — ลูกต้องเสร็จวันเดียวกับวันเริ่มผลิตของแม่', () => {
  const r = scheduleBackward({
    ...base, transferDays: 0,
    demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }],
  });
  assert.equal(r.byDate['2026-09-25']['2000'], 50);
});

test('makePrevWorkDay — n = 0 คืนวันเดิม · เพดานกันวนไม่รู้จบเมื่อปฏิทินหยุดยาวผิดปกติ', () => {
  assert.equal(prevWorkDay('2026-09-25', 0), '2026-09-25');
  const allHoliday = makePrevWorkDay(() => 'ot2', addDays, 10);
  assert.equal(allHoliday('2026-09-25', 5), '2026-09-15', 'ถอยได้ไม่เกิน guard แล้วหยุด');
});

test('🔴 BOM แบนซ้ำ — ต้องใช้ตัวตรวจเดียวกับระบบ (explodeBom) แล้วนับครั้งเดียว', async () => {
  const { explodeBom } = await import('../bomTree.js');
  // 3000 ถูกใส่ซ้ำไว้ที่ชั้น 1 ของ FG ด้วย (นอกจากอยู่ใต้ 2000)
  const flat = [...ROWS, { id: 9, product_id: 'pf', mat_no: '3000', qty_per_unit: 2, uom: 'PC' }];
  const ixFlat = buildBomIndex(flat, matOf);
  const r = scheduleBackward({
    ...base, ix: ixFlat, explode: explodeBom,
    demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }],
  });
  const total3000 = Object.values(r.byDate).reduce((n, bag) => n + (bag['3000'] || 0), 0);
  assert.equal(total3000, 100, 'ต้องได้ 50×2 ครั้งเดียว ไม่ใช่ 200');
  assert.equal(r.flatDupes.length, 1, 'และต้องรายงานเป็น worklist');

  // ไม่ส่ง explode = ไม่ตรวจ (นับ 2 รอบ) — พิสูจน์ว่าตัวตรวจทำงานจริง
  const noCheck = scheduleBackward({
    ...base, ix: ixFlat, demandRows: [{ mat_no: '1000', qty: 50, due_date: '2026-09-25' }],
  });
  assert.equal(Object.values(noCheck.byDate).reduce((n, b) => n + (b['3000'] || 0), 0), 200);
});

test('🔴 ไม่มี BOM (หรือคนปิดสวิตช์) — ต้องยังจัดตารางตัวแม่ได้ ไม่ใช่แผนว่างทั้งหน้า', () => {
  const r = scheduleBackward({
    ...base, ix: null,
    demandRows: [{ mat_no: '1000', qty: 300, due_date: '2026-09-25' }],
  });
  assert.equal(r.byDate['2026-09-25']['1000'], 300, 'งานของตัวแม่ต้องยังอยู่');
  assert.equal(Object.keys(r.byDate).length, 1, 'แต่ไม่มีงานลูก');
});

test('⚠️ กำลังผลิตต่ำผิดปกติ — ต้องมีเพดานวัน ไม่ให้วันย้อนหลุดไปเป็นปี', () => {
  // กำลัง 1 ชิ้น/วัน · ของ 10,000 ชิ้น = 10,000 วันถ้าไม่มีเพดาน
  const r = scheduleBackward({
    ...base, capPerDayOf: () => 1, maxLeadDays: 10,
    demandRows: [{ mat_no: '1000', qty: 10000, due_date: '2026-09-25' }],
  });
  const earliest = Object.keys(r.byDate).sort()[0];
  assert.ok(earliest > '2026-08-01', `วันย้อนต้องไม่หลุดไปไกล (ได้ ${earliest})`);
});

test('⚠️ ถูกตัดด้วยเพดาน = ต้องติดธง capped + เก็บจำนวนวันจริงไว้ ไม่ตัดเงียบ', () => {
  const r = scheduleBackward({
    ...base, today: '2026-09-20', capPerDayOf: () => 1, maxLeadDays: 10,
    demandRows: [{ mat_no: '1000', qty: 10000, due_date: '2026-09-25' }],
  });
  const l = r.late.find(x => x.mat_no === '1000');
  assert.ok(l, 'ย้อนแล้วต้องตกก่อนวันนี้ = สาย');
  assert.equal(l.capped, true, 'ต้องบอกว่าถูกตัดด้วยเพดาน');
  assert.equal(l.days, 10000, 'และต้องเก็บจำนวนวันจริงไว้ให้คนเห็น');
});
