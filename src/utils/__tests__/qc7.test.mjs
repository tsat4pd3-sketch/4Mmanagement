/* เทสสูตร QC 7 Tools (src/utils/qc7.js) — 2026-09-22
   โฟกัสที่ "ข้อมูลไม่พอต้องบอก ไม่ใช่โชว์ 0" ซึ่งเป็นกฎความซื่อสัตย์ของจอใน CLAUDE.md
   และที่แกนชนิดสินทรัพย์ ซึ่งถ้าแยกผิดจะทำให้ dashboard แม่พิมพ์/JIG ว่างเปล่าทั้งที่มีงานจริง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  histogram, niceStep, controlChartXmR, XMR_E2, RUN_LEN, pearson, corrLabel, scatter,
  fishbone, guessBone, boneOf, BONE_KEYS, checkSheet, runChart, stratify,
  assetClassOf, assetClassOfKind, guessAssetClass, ASSET_KEYS,
} from '../qc7.js';

/* ── ④ ฮิสโตแกรม ─────────────────────────────────────────────────────── */

test('histogram: ข้อมูลน้อยเกินไป ต้องบอกเหตุผล ไม่ใช่คืนกราฟเปล่า', () => {
  const r = histogram([1, 2, 3]);
  assert.equal(r.ok, false);
  assert.equal(r.n, 3);
  assert.match(r.reason, /อย่างน้อย/);
});

test('histogram: ทุกค่าเท่ากัน = ไม่มีการกระจาย ต้องบอก ไม่ใช่วาดแท่งเดียวหลอกว่าปกติ', () => {
  const r = histogram([5, 5, 5, 5, 5, 5]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /เท่ากันหมด/);
});

test('histogram: นับครบทุกจุด · ค่าสูงสุดต้องไม่ตกขอบหาย', () => {
  const xs = [1, 2, 2, 3, 4, 5, 5, 5, 9, 12, 30];
  const r = histogram(xs);
  assert.equal(r.ok, true);
  assert.equal(r.n, xs.length);
  assert.equal(r.bins.reduce((s, b) => s + b.count, 0), xs.length, 'ผลรวมในถังต้องเท่าจำนวนจุด');
  assert.equal(r.min, 1);
  assert.equal(r.max, 30);
  assert.ok(r.bins[r.bins.length - 1].values.includes(30), 'ค่าสูงสุดต้องอยู่ในถังสุดท้าย');
});

test('histogram: หางยาวสุดโต่ง (รอ supplier 300 ชม.) ต้องไม่ทำให้ถังกว้างจนใบปกติกองถังเดียว', () => {
  const normal = Array.from({ length: 40 }, (_, i) => 10 + (i % 8));   // 10-17 นาที
  const r = histogram([...normal, 18000]);
  assert.equal(r.ok, true);
  const used = r.bins.filter(b => b.count > 0 && !b.overflow).length;
  assert.ok(used >= 3, `ใบปกติต้องกระจายอย่างน้อย 3 ถัง (ได้ ${used})`);
  assert.ok(r.bins.length <= 32, 'ต้องไม่แตกเป็นหวีหลายร้อยถัง');
  const of = r.bins.find(b => b.overflow);
  assert.ok(of, 'ค่าสุดโต่งต้องไปอยู่ "ถังล้น" ที่มองเห็น ห้ามทิ้งเงียบ');
  assert.equal(of.count, 1);
  assert.equal(r.outliers, 1);
  assert.equal(r.bins.reduce((s2, b) => s2 + b.count, 0), 41, 'ยังต้องนับครบทุกจุด');
});

test('niceStep: ขอบถังต้องเป็นเลขที่คนอ่านออก (1/2/5 × 10^k)', () => {
  assert.equal(niceStep(7.3194), 10);
  assert.equal(niceStep(1.4), 2);
  assert.equal(niceStep(0.31), 0.5);
  assert.equal(niceStep(0), 1, 'ค่าพัง = ถอยเป็น 1 ไม่ใช่ 0 (หารศูนย์ = ลูปไม่รู้จบ)');
});

/* ── ⑥ กราฟควบคุม XmR ────────────────────────────────────────────────── */

const pts = (vals) => vals.map((v, i) => ({ label: `W${i + 1}`, value: v }));

test('controlChartXmR: จุดน้อยกว่าเกณฑ์ = ตั้งขีดจำกัดไม่ได้ ต้องบอก', () => {
  const r = controlChartXmR(pts([1, 2, 3, 4]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /อย่างน้อย 8/);
});

test('controlChartXmR: ค่าคงที่ทุกช่วง = ไม่มีความผันแปรให้คุม (mR̄ = 0 ⇒ ห้ามได้ UCL = CL)', () => {
  const r = controlChartXmR(pts([4, 4, 4, 4, 4, 4, 4, 4, 4]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /ผันแปร/);
});

test('controlChartXmR: สูตร CL/UCL/LCL ตรงมาตรฐาน XmR (E2 = 2.66)', () => {
  const vals = [10, 12, 11, 13, 10, 12, 11, 12];
  const r = controlChartXmR(pts(vals), { nonNegative: false });
  assert.equal(r.ok, true);
  const cl = vals.reduce((a, b) => a + b, 0) / vals.length;
  const mrs = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
  const mrBar = mrs.reduce((a, b) => a + b, 0) / mrs.length;
  assert.ok(Math.abs(r.cl - cl) < 1e-9);
  assert.ok(Math.abs(r.mrBar - mrBar) < 1e-9);
  assert.ok(Math.abs(r.ucl - (cl + XMR_E2 * mrBar)) < 1e-9);
  assert.ok(Math.abs(r.lcl - (cl - XMR_E2 * mrBar)) < 1e-9);
});

test('🔴 controlChartXmR: LCL ติดลบกับ "นาที" ต้อง clamp เป็น 0 + บอกว่า clamp', () => {
  const r = controlChartXmR(pts([5, 60, 5, 80, 5, 70, 5, 90]));
  assert.equal(r.ok, true);
  assert.equal(r.lcl, 0);
  assert.equal(r.lclClamped, true, 'ไม่บอกว่า clamp = คนอ่านว่ายังลดได้อีกติดลบ ซึ่งไม่มีความหมาย');
  // จุดที่ต่ำกว่า LCL ที่ถูก clamp ต้องไม่ถูกนับเป็นสัญญาณ "ต่ำผิดปกติ"
  assert.equal(r.signals.some(s => s.kind === 'below'), false);
});

test('controlChartXmR: จับจุดหลุด UCL', () => {
  const r = controlChartXmR(pts([10, 11, 10, 12, 11, 10, 11, 10, 95]));
  assert.equal(r.ok, true);
  assert.equal(r.inControl, false);
  assert.ok(r.signals.some(s => s.kind === 'above' && s.i === 8));
});

test(`controlChartXmR: จับ ${RUN_LEN} จุดติดกันข้างเดียว + ไต่ทางเดียว`, () => {
  // ไต่ขึ้นเรื่อยๆ = ทั้ง shift และ trend
  const r = controlChartXmR(pts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  assert.equal(r.ok, true);
  assert.ok(r.signals.some(s => s.kind === 'trend'), 'ต้องจับแนวโน้มไต่ทางเดียว');
  const flatThenHigh = controlChartXmR(pts([5, 4, 6, 5, 9, 9, 9, 9, 9, 9, 9, 9]));
  assert.ok(flatThenHigh.signals.some(s => s.kind === 'shift'), 'ต้องจับการเปลี่ยนระดับ');
});

test('controlChartXmR: ค่าที่อ่านไม่ได้ (null/ว่าง) ถูกตัดทิ้ง ไม่กลายเป็น 0', () => {
  const r = controlChartXmR([
    ...pts([10, 12, 11, 13, 10, 12, 11, 12]),
    { label: 'W9', value: null }, { label: 'W10', value: '' },
  ], { nonNegative: false });
  assert.equal(r.n, 8, 'ค่าว่างต้องไม่ถูกนับเป็น 0 แล้วลาก CL ลง');
});

/* ── ⑤ ผังกระจาย ─────────────────────────────────────────────────────── */

test('pearson: สัมพันธ์สมบูรณ์ = ±1 · แกนไม่มีความผันแปร = null (ห้ามคืน 0)', () => {
  assert.ok(Math.abs(pearson([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]) - 1) < 1e-9);
  assert.ok(Math.abs(pearson([{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 2 }]) + 1) < 1e-9);
  assert.equal(pearson([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }]), null, 'y คงที่ = ประเมินไม่ได้ ไม่ใช่ "ไม่สัมพันธ์"');
  assert.equal(pearson([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null, 'น้อยกว่า 3 จุด = ไม่ประเมิน');
});

test('corrLabel: r = null ต้องพูดว่า "ประเมินไม่ได้" ไม่ใช่ "ไม่สัมพันธ์"', () => {
  assert.equal(corrLabel(null), 'ประเมินไม่ได้');
  assert.match(corrLabel(0.1), /แทบไม่/);
  assert.match(corrLabel(0.9), /สูง/);
  assert.match(corrLabel(-0.8), /ตรงข้าม/);
});

test('scatter: จุดน้อย = บอกเหตุผล · จุดที่อ่านค่าไม่ได้ถูกตัด', () => {
  const recs = [{ a: 1, b: 2 }, { a: 2, b: null }, { a: 3, b: 6 }];
  const r = scatter(recs, { xOf: r2 => r2.a, yOf: r2 => r2.b });
  assert.equal(r.ok, false);
  assert.equal(r.n, 2);
  const ok = scatter(
    [1, 2, 3, 4, 5, 6].map(i => ({ a: i, b: i * 2 })),
    { xOf: r2 => r2.a, yOf: r2 => r2.b },
  );
  assert.equal(ok.ok, true);
  assert.ok(Math.abs(ok.r - 1) < 1e-9);
});

/* ── ③ ก้างปลา ───────────────────────────────────────────────────────── */

test('guessBone: เดาแกนจากศัพท์หน้างานได้ · ข้อความว่าง = unknown (ห้ามยัดเข้า Machine)', () => {
  assert.equal(guessBone('ลูกปืนแตก'), 'material');
  assert.equal(guessBone('พนักงานลืมใส่สลัก'), 'man');
  assert.equal(guessBone('ไม่ได้ทำ PM ตามแผน'), 'method');
  assert.equal(guessBone('ฝุ่นเข้าเซอร์โว'), 'env');
  assert.equal(guessBone('มอเตอร์ไหม้'), 'machine');
  assert.equal(guessBone('เกจวัดเพี้ยน'), 'measure');
  assert.equal(guessBone(''), 'unknown');
  assert.equal(guessBone('xyz'), 'unknown');
});

test('🔴 boneOf: ค่าที่คนเลือกไว้จริงต้องชนะการเดาเสมอ', () => {
  assert.deepEqual(boneOf('man', 'มอเตอร์ไหม้'), { bone: 'man', guessed: false });
  assert.deepEqual(boneOf('part_life', 'พนักงานลืม'), { bone: 'material', guessed: false });
  assert.deepEqual(boneOf('method', ''), { bone: 'method', guessed: false });
  // 'other' = เลือกแล้วว่า "อื่นๆ" แต่ยังไม่บอกว่าอะไร → เดาจากข้อความต่อได้
  assert.deepEqual(boneOf('other', 'ลูกปืนแตก'), { bone: 'material', guessed: true });
  assert.deepEqual(boneOf(null, 'ลูกปืนแตก'), { bone: 'material', guessed: true });
});

test('🔴 fishbone: ฐานจริงมี cause_category แค่ 1% — ผังต้องไม่ว่าง และต้องบอกว่าเดามากี่ %', () => {
  const recs = [
    { cause_category: 'man', text: 'อะไรก็ได้', label: 'MO-1' },
    { cause_category: null, text: 'ลูกปืนแตก', label: 'MO-2' },
    { cause_category: null, text: 'มอเตอร์ไหม้', label: 'MO-3' },
    { cause_category: null, text: '', label: 'MO-4' },
  ];
  const fb = fishbone(recs);
  assert.equal(fb.n, 4);
  assert.equal(fb.guessed, 3);
  assert.ok(Math.abs(fb.guessRate - 0.75) < 1e-9, 'จอต้องบอกได้ว่าผังนี้เดามา 75%');
  const by = Object.fromEntries(fb.bones.map(b => [b.key, b.count]));
  assert.equal(by.man, 1);
  assert.equal(by.material, 1);
  assert.equal(by.machine, 1);
  assert.equal(by.unknown, 1, 'ใบที่เดาไม่ออกต้องอยู่บนผัง ห้ามหาย');
  assert.equal(fb.bones.reduce((s, b) => s + b.count, 0), 4, 'ทุกใบต้องลงกระดูกสักอัน');
  assert.deepEqual(fb.bones.map(b => b.key), BONE_KEYS, 'ลำดับแกนต้องคงที่ทุกจอ');
});

test('fishbone: ไม่มีข้อมูลเลย = guessRate null (ไม่ใช่ 0 ซึ่งแปลว่า "ไม่ได้เดาเลย")', () => {
  const fb = fishbone([]);
  assert.equal(fb.n, 0);
  assert.equal(fb.guessRate, null);
  assert.equal(fb.bones.length, BONE_KEYS.length, 'ผังเปล่าก็ยังต้องมีครบทุกแกน');
});

/* ── ① ใบตรวจสอบ ─────────────────────────────────────────────────────── */

test('checkSheet: นับไขว้ + ผลรวมขอบถูก · ค่าว่างไปตะกร้า (ไม่ระบุ) ไม่หาย', () => {
  const recs = [
    { a: 'PRESS', b: 'ไฟฟ้า' }, { a: 'PRESS', b: 'ไฟฟ้า' }, { a: 'PRESS', b: 'ลม' },
    { a: 'ROBOT', b: 'ไฟฟ้า' }, { a: '', b: 'ลม' },
  ];
  const cs = checkSheet(recs, { rowOf: r => r.a, colOf: r => r.b });
  assert.equal(cs.total, 5);
  assert.equal(cs.cell.PRESS['ไฟฟ้า'], 2);
  assert.equal(cs.rowTot.PRESS, 3);
  assert.equal(cs.colTot['ไฟฟ้า'], 3);
  assert.equal(cs.rowTot['(ไม่ระบุ)'], 1);
  assert.equal(cs.rows[0], 'PRESS', 'แถวต้องเรียงมาก→น้อย');
  assert.equal(cs.cols[0], 'ไฟฟ้า');
});

test('🔴 checkSheet: ตัดหางต้องบอกจำนวนที่ซ่อน (ตัดเงียบ = ตารางโกหกยอดรวม)', () => {
  const recs = Array.from({ length: 30 }, (_, i) => ({ a: `M${i}`, b: 'x' }));
  const cs = checkSheet(recs, { rowOf: r => r.a, colOf: r => r.b, maxRows: 5 });
  assert.equal(cs.rows.length, 5);
  assert.equal(cs.hiddenRows, 25);
  assert.equal(cs.total, 30, 'ยอดรวมต้องเป็นของจริงทั้งหมด ไม่ใช่เฉพาะแถวที่โชว์');
});

/* ── ⑦ กราฟแนวโน้ม + แบ่งชั้น ───────────────────────────────────────── */

test('🔴 runChart: ช่วงเวลาที่ไม่มีเหตุการณ์ต้องเป็น 0 บนกราฟ ไม่ใช่ข้ามไป', () => {
  const recs = [{ w: '2026-W01' }, { w: '2026-W01' }, { w: '2026-W03' }];
  const rc = runChart(recs, { keyOf: r => r.w, keys: ['2026-W01', '2026-W02', '2026-W03'] });
  assert.deepEqual(rc.points.map(p => p.value), [2, 0, 1]);
  assert.equal(rc.total, 3);
  // ไม่ส่ง keys = ใช้เฉพาะช่วงที่มีข้อมูล (สัปดาห์เงียบจะหาย — จึงต้องส่ง keys เสมอในหน้าจริง)
  assert.equal(runChart(recs, { keyOf: r => r.w }).points.length, 2);
});

test('stratify: เรียงมาก→น้อย + % ของยอดรวม · ตัด top ต้องบอกจำนวนที่ซ่อน', () => {
  const recs = [{ k: 'a', v: 5 }, { k: 'b', v: 3 }, { k: 'c', v: 2 }, { k: 'a', v: 5 }];
  const s = stratify(recs, { keyOf: r => r.k, valOf: r => r.v });
  assert.equal(s.total, 15);
  assert.equal(s.list[0].name, 'a');
  assert.equal(s.list[0].value, 10);
  assert.ok(Math.abs(s.list[0].pct - (10 / 15) * 100) < 1e-9);
  const t = stratify(recs, { keyOf: r => r.k, valOf: r => r.v, top: 1 });
  assert.equal(t.hidden, 2);
  assert.equal(t.total, 15, 'ยอดรวมยังเป็นของทั้งหมด');
});

/* ── แกนชนิดสินทรัพย์ ────────────────────────────────────────────────── */

test('🔴 assetClassOf: ยึด machines.equipment_kind ก่อน — ห้ามแยกด้วยทีมช่าง', () => {
  const kinds = { 'PR-01': 'machine', 'DIE-9': 'die', 'JG-3': 'jig', 'AC-1': 'facility' };
  assert.deepEqual(assetClassOf({ machine_no: 'pr-01' }, kinds), { cls: 'machine', known: true });
  assert.deepEqual(assetClassOf({ machine_no: 'DIE-9' }, kinds), { cls: 'die', known: true });
  assert.deepEqual(assetClassOf({ machine_no: ' JG-3 ' }, kinds), { cls: 'jig', known: true });
  assert.deepEqual(assetClassOf({ machine_no: 'AC-1' }, kinds), { cls: 'machine', known: true }, 'facility รวมกับเครื่องจักร');
});

test('assetClassOf: ไม่พบในทะเบียน = เดาจากชนิด/ชื่อ และต้องบอกว่าเดา (known=false)', () => {
  const kinds = { 'PR-01': 'machine' };
  assert.deepEqual(assetClassOf({ machine_no: 'X-99', item_type: 'JIG' }, kinds), { cls: 'jig', known: false });
  assert.deepEqual(assetClassOf({ machine_no: 'DIE-SINGLE-2' }, kinds), { cls: 'die', known: false });
  assert.deepEqual(assetClassOf({ item_type: 'เครื่องเชื่อม (WELDING)' }, kinds), { cls: 'machine', known: false });
});

test('🔴 assetClassOf: เดาไม่ออก ต้องลง "other" ไม่ใช่หายจากจอ (บทเรียน line_type ว่าง)', () => {
  assert.deepEqual(assetClassOf({}, {}), { cls: 'other', known: false });
  assert.deepEqual(assetClassOf({ machine_no: 'ZZZ', item_type: 'อะไรไม่รู้' }, {}), { cls: 'other', known: false });
  assert.equal(assetClassOfKind('ไม่รู้จัก'), 'other', 'kind แปลกปลอมห้ามตกเป็นเครื่องจักร');
  assert.equal(assetClassOfKind(null), 'other');
  // ทุกผลลัพธ์ต้องอยู่ในลิสต์แท็บ ไม่งั้นใบตกจากทุกแท็บ
  for (const t of ['JIG A', 'DIE B', 'PRESS C', '']) assert.ok(ASSET_KEYS.includes(guessAssetClass(t)));
});
