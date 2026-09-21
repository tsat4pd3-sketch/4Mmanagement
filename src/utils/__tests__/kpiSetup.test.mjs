/* ล็อกเกณฑ์ KPI ด้วย "ตัวเลขจริงจากใบ/คู่มือของบริษัท" ไม่ใช่ค่าที่เราคิดเอง
   ที่มาทุกเคส → docs/OBEYA-KPI-SOURCES.md §8.3 (คู่มือ KPI Online) · §12.2 (สูตรในเซลล์) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreKpi, totalPoints, summarizeMonths, evalFormula, parseBar, fmtBar,
  providerReaches, scopeLabel, inferCompare, scoreDef, defBars, KPI_SCOPE_LEVELS, KPI_PROVIDERS, KPI_BASE_VARS, KPI_FORMULAS,
  KPI_STD_UNITS, KPI_REQUIREMENTS, KPI_TOTAL_WEIGHT, stdUnitOf, stdUnitLabel,
  isStdFixed, isStdParent, checkStdSelection,
} from '../kpiSetup.js';

/* ── เกณฑ์คะแนน: ตรวจกับ 6 แถวจริงในคู่มือ KPI Online (§8.3) ─────────────────────────── */
const REAL_ROWS = [
  // [ชื่อ, ผลจริง, commit, target, weight, point ที่ใบคิดได้]
  ['Total Sales',          35420.06, ['>=', 35198.44], ['>=', 35986.80], 6, 3.0],
  ['EBIT',                 4.02,     ['>=', 3.71],     ['>=', 3.91],     6, 6],
  ['Budgeting',            99.64,    ['<=', 100],      ['<=', 98.00],    7, 3.5],
  ['SLA ส่งรายงานตรวจ',     100,      ['>=', 80.00],    ['>=', 100],      6, 6],
  ['TS Academy',           100,      ['>=', 75.00],    ['>=', 85.00],    2, 2],
  ['Annual Sale Per Head', 1.29,     ['>=', 2.54],     ['>=', 2.59],     3, 0],
];

test('เกณฑ์ 1 / 0.5 / 0 × weight — ตรงกับ 6 แถวจริงในคู่มือ KPI Online', () => {
  for (const [name, val, [cc, cv], [tc, tv], weight, expect] of REAL_ROWS) {
    const s = scoreKpi(val, {
      commit_compare: cc, commit_value: cv, target_compare: tc, target_value: tv, weight,
    });
    assert.equal(s.point, expect, `${name}: ได้ ${s.point} ควรเป็น ${expect}`);
  }
});

test('🔴 ยังไม่มีผล / ยังไม่ตั้งเป้า = pending (level null) ห้ามกลายเป็น 0 หรือเขียว', () => {
  const def = { commit_compare: '>=', commit_value: 80, target_compare: '>=', target_value: 90, weight: 5 };
  const noVal = scoreKpi(null, def);
  assert.equal(noVal.level, null);
  assert.equal(noVal.point, null);

  const noTarget = scoreKpi(95, { weight: 5 });
  assert.equal(noTarget.level, null, '"ไม่มีเป้า" ต้องเป็นเทา ไม่ใช่เขียว');
});

test('🔴 เกณฑ์อ่านจาก "ป้ายของบาร์" — ถึง Target = 1 · ถึงแค่ Commitment = 0.5 (ประกาศ QSM-R2 001/2569)', () => {
  // แถวปกติ: ใบ PD3 HDF FY2026 ข้อ 3.5 OEE — commit ≥83% · target ≥85% · weight 6
  const oee = { commit_compare: '>=', commit_value: 83, target_compare: '>=', target_value: 85, weight: 6 };
  assert.equal(scoreKpi(86, oee).point, 6, '≥85 = ถึง Target ⇒ เต็ม');
  assert.equal(scoreKpi(84, oee).point, 3, 'ถึงแค่ Commitment ⇒ ครึ่ง');
  assert.equal(scoreKpi(80, oee).point, 0, 'ไม่ถึงทั้งคู่ ⇒ 0');

  // แถวที่ commit "เข้มกว่า" target (คนกรอกสลับ) — ใบ JIG MTN ข้อ 3.4 MTTR commit ≤0.2 · target ≤0.3
  // กติกาตามป้าย: ≤0.3 คือ Target ⇒ 0.25 ได้เต็ม · ห้ามกลับไปตัดสินจาก "บาร์ไหนเข้มกว่า" (เคยเขียนผิด)
  const mttr = { commit_compare: '<=', commit_value: 0.2, target_compare: '<=', target_value: 0.3, weight: 4 };
  assert.equal(scoreKpi(0.25, mttr).point, 4, 'ถึง Target = เต็ม ไม่ว่า commit จะเข้มกว่าหรือไม่');
  assert.equal(scoreKpi(0.35, mttr).point, 0);

  // มีแต่ Target ไม่มี Commitment (เช่น QCC ≥30%/plant) — ไม่ถึง = 0 ไม่ใช่ครึ่ง
  const qcc = { target_compare: '>=', target_value: 30, weight: 2 };
  assert.equal(scoreKpi(31, qcc).point, 2);
  assert.equal(scoreKpi(29, qcc).point, 0);
});

test('totalPoints บอก coverage เสมอ (ไฟรวมต้องรู้ว่าตัดสินจากกี่ช่อง)', () => {
  const rows = [
    { weight: 6, score: scoreKpi(4.02, { target_compare: '>=', target_value: 3.91, weight: 6 }) },
    { weight: 4, score: scoreKpi(null, { target_compare: '>=', target_value: 90, weight: 4 }) },
  ];
  const t = totalPoints(rows);
  assert.equal(t.weight, 10);
  assert.equal(t.point, 6);
  assert.equal(t.scored, 1);
  assert.equal(t.pending, 1, 'ช่องที่ยังไม่มีข้อมูลต้องถูกนับแยก ไม่ใช่กลืนเป็น 0');
});

/* ── สูตรจากตัวแปรฐาน (§12.2 — อ่านจากเซลล์จริง) ───────────────────────────────────── */
test('DL / OH / DL&OH = ตัวเลข ÷ ยอดขายจากสินค้า × 100', () => {
  const vars = { dl: 2002638.71, oh: 1262735.46, sale_product: 137267250.25 };
  const dl = evalFormula('dl_pct', vars).value;
  const oh = evalFormula('oh_pct', vars).value;
  const both = evalFormula('dloh_pct', vars).value;
  assert.ok(Math.abs(dl - 1.4589) < 0.001, `DL ได้ ${dl}`);      // ใบจริง 0.014589 (สัดส่วน)
  assert.ok(Math.abs(oh - 0.9199) < 0.001, `OH ได้ ${oh}`);
  assert.ok(Math.abs(both - (dl + oh)) < 1e-9, 'DL&OH ต้องเท่ากับ DL + OH เป๊ะ');
});

test('DSI = (มูลค่าสต็อกสิ้นเดือน ÷ COGS) × วัน — สูตรทางการ (ประกาศ + แม่แบบ Corporate + ใบ Monitoring)', () => {
  const v = evalFormula('inventory_day', { inventory_baht: 12_000_000, cogs: 1_000_000_000, days_in_month: 30 }).value;
  assert.ok(Math.abs(v - 0.36) < 1e-9, `ได้ ${v}`);
  // ตัวหารคือ COGS — ส่ง sale_product มาแทนไม่ได้ ต้องฟ้องว่าขาด
  assert.deepEqual(evalFormula('inventory_day', { inventory_baht: 1, sale_product: 2, days_in_month: 30 }).missing, ['cogs']);
});

test('🔴 DSI ของแต่ละแผนกบวกกัน = DSI ของทั้งโรงงาน (ตัวหาร COGS เป็นของโรงงานตัวเดียว)', () => {
  // เลขจากใบ APPRAISAL FORM 2026 ที่เซ็นแล้วทั้ง 7 ใบ (§14.3)
  const target = { pd1: 0.318, pd2: 0.196, pd3: 0.324, pd4: 0.049, logIn: 3.799, whOut: 7.301 };
  const commit = { pd1: 0.345, pd2: 0.212, pd3: 0.351, pd4: 0.053, logIn: 4.115, whOut: 7.910 };
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(target) - 12) < 0.05, `รวม target ได้ ${sum(target)} ใบ GM เขียน ≤12 Days`);
  assert.ok(Math.abs(sum(commit) - 13) < 0.05, `รวม commit ได้ ${sum(commit)} ใบ GM เขียน ≤13 Days`);
});

test('🔴 ขาดตัวแปร / ตัวหารเป็นศูนย์ = null + บอกว่าขาดอะไร ห้ามคืน 0', () => {
  const miss = evalFormula('dl_pct', { dl: 100 });
  assert.equal(miss.value, null);
  assert.deepEqual(miss.missing, ['sale_product']);

  const zero = evalFormula('dl_pct', { dl: 100, sale_product: 0 });
  assert.equal(zero.value, null, 'หารศูนย์ = ไม่รู้ ไม่ใช่ 0');
  assert.ok(zero.error);
});

/* ── วิธีรวม 12 เดือน (§12.2) ───────────────────────────────────────────────────────── */
test('summarizeMonths: average ข้ามเดือนที่ยังไม่กรอก (ไม่นับเป็น 0)', () => {
  assert.equal(summarizeMonths([80, null, 100], 'average'), 90);
  assert.equal(summarizeMonths([null, null], 'average'), null);
});

test('🔴 เดือนที่ยังไม่มีผล ใบทางการก็ไม่นับเป็น 0 — ล็อกด้วยเลขจากใบ KPI Online จริง (§13.2)', () => {
  // ใบ KPI_Monitoring.pdf (P4 Assembly) แถว Customer Satisfaction (Q&D):
  // กรอก ม.ค.-ก.ค. · ส.ค.-ธ.ค. ใบ "พิมพ์ 0.00" แต่ช่อง Average ของใบเอง = 94.35
  const filled = [100.00, 91.67, 87.50, 100.00, 93.75, 100.00, 87.50];
  const asPrinted = [...filled, 0, 0, 0, 0, 0];          // อย่างที่ตาเห็นบนใบ
  const asMeant   = [...filled, null, null, null, null, null]; // ความหมายจริง

  const avg = summarizeMonths(asMeant, 'average');
  assert.ok(Math.abs(avg - 94.35) < 0.01, `ได้ ${avg} ใบทางการเขียน 94.35`);

  const naive = summarizeMonths(asPrinted, 'average');
  assert.ok(Math.abs(naive - 55.03) < 0.01, 'นับ 0.00 ที่พิมพ์บนใบ = ได้ 55.03');
  assert.ok(avg - naive > 39, 'ต่างกันเกือบ 40 จุด — กับดักนี้ต้องไม่หลุดกลับมา');
});

test('summarizeMonths: sum / max / as_of', () => {
  assert.equal(summarizeMonths([0, 1, 0], 'sum'), 1);
  assert.equal(summarizeMonths([0.83, 1.92, 3.47], 'max'), 3.47);
  assert.equal(summarizeMonths([13, 12, null], 'as_of'), 12, 'เอาเดือนล่าสุดที่มีค่า');
});

test('🔴 PPM รวมทั้งปีคิดจากยอดรวม ไม่ใช่เฉลี่ยของ PPM รายเดือน', () => {
  // เลขจริงจากบอร์ด HYDROFORM ม.ค.+พ.ค. (§10.3)
  const num = [19, 28], den = [63886, 60254];
  const rate = summarizeMonths([], 'rate', { num, den, scale: 1e6 });
  const avgOfMonthly = summarizeMonths([297.4, 464.7], 'average');
  assert.ok(Math.abs(rate - 379.2) < 1, `ได้ ${rate}`);
  assert.ok(Math.abs(rate - avgOfMonthly) > 1, 'ต้องต่างจากค่าเฉลี่ยรายเดือนจริงๆ');
});

/* ── ทะเบียน/ขอบเขต ─────────────────────────────────────────────────────────────────── */
test('providerReaches: ลึกเกินที่ข้อมูลไปถึง = false (จอต้องเขียนว่าไปไม่ถึง)', () => {
  assert.equal(providerReaches('oee', 'line'), true);
  assert.equal(providerReaches('safety_case', 'line'), false, 'safety_events ผูกไลน์ไม่ครบ');
  assert.equal(providerReaches('training_pct', 'line_group'), false);
  assert.equal(providerReaches('manual', 'line'), true, 'กรอกมือลึกแค่ไหนก็ได้');
});

test('🔴 cost_center อยู่คนละสายกับไลน์ — ห้ามเทียบความลึกกัน', () => {
  const cc = KPI_SCOPE_LEVELS.find(l => l.key === 'cost_center');
  assert.equal(cc.depth, null);
  assert.equal(providerReaches('oee', 'cost_center'), false);
  assert.equal(providerReaches('formula', 'cost_center'), true);
});

test('scopeLabel อ่านรู้เรื่องทุกระดับ · plant ไม่ต้องมีค่า', () => {
  assert.equal(scopeLabel('plant', null), 'ทั้งโรงงาน');
  assert.equal(scopeLabel('line', 'HDF1'), 'ไลน์: HDF1');
  assert.equal(scopeLabel('cost_center', '2140662101'), 'CC: 2140662101');
});

test('parseBar / fmtBar ไป-กลับได้ (ใบเก่าเก็บเป็นข้อความ)', () => {
  assert.deepEqual(parseBar('≤ 2.5364%'), { compare: '<=', value: 2.5364 });
  assert.deepEqual(parseBar('≥ 9,000 min'), { compare: '>=', value: 9000 });
  assert.deepEqual(parseBar(null), { compare: null, value: null });
  assert.equal(fmtBar('<=', 300, 'PPM'), '≤ 300 PPM');
  assert.equal(fmtBar(null, null), '—');
});

test('🔴 เป้าที่เขียนไม่มีเครื่องหมาย ต้องเดาทิศได้ ไม่ใช่กลายเป็นเทาตลอดกาล (เลขจากใบจริงทั้ง 12 ใบ)', () => {
  // 2) ยืมทิศจาก Commitment
  assert.equal(inferCompare('100%', '>='), '>=', 'Customer Satisfaction: commit ≥95% ⇒ เป้า 100% คือ ≥');
  assert.equal(inferCompare('730 Hr.', '>='), '>=', 'MTN MTBF: commit ≥729.5 Hr.');
  assert.equal(inferCompare('0 Hr.', '<='), '<=', 'MTN MTTR: commit ≤2 Hr.');
  assert.equal(inferCompare('0%', '<='), '<=', 'Machine Break Down: commit ≤0.28%');
  // 3) ไม่มี Commitment ให้ยืม
  assert.equal(inferCompare('0 Case', null), '<=', 'Safety ไม่มี commit');
  assert.equal(inferCompare('0', null), '<=', 'Premium Freight ไม่มี commit');
  assert.equal(inferCompare('100%', null), '>=', 'WH TS Academy ไม่มี commit');
  // 1) มีเครื่องหมายชนะเสมอ
  assert.equal(inferCompare('≤ 300 PPM', '>='), '<=', 'เครื่องหมายในข้อความต้องชนะการยืมทิศ');
  // 4) เดาไม่ได้ = null (จอต้องบอกว่ายังไม่ระบุทิศทาง ห้ามเดามั่ว)
  assert.equal(inferCompare('3 Types', null), null);

  // ผลลัพธ์ปลายทาง: เป้า "100%" ต้องให้คะแนนได้จริง ไม่ใช่ pending
  const t = parseBar('100%', '>=');
  const sc = scoreKpi(100, { commit_compare: '>=', commit_value: 95, target_compare: t.compare, target_value: t.value, weight: 5 });
  assert.equal(sc.point, 5);
  assert.equal(scoreKpi(96, { commit_compare: '>=', commit_value: 95, target_compare: t.compare, target_value: t.value, weight: 5 }).point, 2.5);
});

test('🔴 scoreDef อ่านแถวยุคเก่าได้ — commitment ที่เป็น "ข้อความ" ต้องกลายเป็นบาร์ 0.5', () => {
  // แถวแบบที่ KpiMonthly เขียนมาแต่เดิม: direction + target_value ตัวเลข · commitment เป็นข้อความเฉยๆ
  const legacy = { direction: 'down', target_value: 1.3042, commitment: '≤ 1.3445%', weight: 6 };
  assert.equal(scoreDef(1.30, legacy).point, 6,   'ถึง Target');
  assert.equal(scoreDef(1.34, legacy).point, 3,   'ถึงแค่ Commitment ⇒ ครึ่ง (เดิมตกเป็น N ทันที)');
  assert.equal(scoreDef(1.40, legacy).point, 0,   'ไม่ถึงทั้งคู่');
  assert.equal(scoreDef(1.34, legacy).status, 'warn');
  assert.equal(scoreDef(null, legacy).status, 'unknown', 'ยังไม่กรอก = เทา ห้ามเป็นแดง');

  // คอลัมน์ยุคใหม่ต้องชนะของเก่าเสมอ
  const mixed = { direction: 'up', target_value: 10, target_compare: '<=', commit_compare: '<=', commit_value: 20 };
  const b = defBars(mixed);
  assert.equal(b.target_compare, '<=', 'target_compare ต้องชนะ direction');
  assert.equal(b.commit_value, 20);
});

test('🔴 แถวที่มีแต่ Target ไม่มี Commitment — ไม่ถึงต้องเป็น 0 ไม่ใช่ครึ่ง', () => {
  const d = { direction: 'up', target_value: 85, weight: 6 };   // OEE ที่เป้ามาจาก oee_targets
  assert.equal(scoreDef(86, d).point, 6);
  assert.equal(scoreDef(84, d).point, 0);
  assert.equal(defBars(d).commit_value, null);
});

test('ทะเบียนไม่มีคีย์ซ้ำ และสูตรอ้างตัวแปรที่มีจริงทุกตัว', () => {
  const dup = (arr) => arr.length !== new Set(arr).size;
  assert.ok(!dup(KPI_PROVIDERS.map(p => p.key)), 'provider key ซ้ำ');
  assert.ok(!dup(KPI_BASE_VARS.map(v => v.key)), 'var key ซ้ำ');
  assert.ok(!dup(KPI_FORMULAS.map(f => f.key)), 'formula key ซ้ำ');
  const varKeys = new Set(KPI_BASE_VARS.map(v => v.key));
  for (const f of KPI_FORMULAS) {
    for (const v of f.vars) assert.ok(varKeys.has(v), `สูตร ${f.key} อ้างตัวแปร ${v} ที่ไม่มีในทะเบียน`);
  }
});

/* ── KPI Standard 2026 — กติกาเลือก KPI ที่เป็นของกลุ่ม (ที่มา §15) ────────────────────── */

test('ทะเบียนหน่วยงานมาตรฐาน 24 หน่วย — ชื่อต้องตรงคอลัมน์ std_unit เป๊ะ (เป็นคีย์เชื่อมฐาน)', () => {
  assert.equal(KPI_STD_UNITS.length, 24, 'คู่มือ KPI Guideline 2026 หน้า 7-18 มี 24 หน่วยงาน');
  const units = KPI_STD_UNITS.map(u => u.unit);
  assert.equal(units.length, new Set(units).size, 'ชื่อหน่วยงานซ้ำ');
  // 20 หน่วยที่ seed แล้ว (migration 20260921) · 4 หน่วย TSA ตั้งใจยังไม่ใส่ ดีกว่าใส่ผิด
  assert.equal(KPI_STD_UNITS.filter(u => u.seeded).length, 20);
  assert.deepEqual(
    KPI_STD_UNITS.filter(u => !u.seeded).map(u => u.unit),
    ['Accounting-TSA', 'HRM-TSA', 'Internal Audit-TSA', 'AOBM-TSA'],
  );
  // หน่วยที่ ESM ผลิตตัวเลขให้จริงต้องอยู่ในทะเบียนและ seed แล้ว
  for (const u of ['Production', 'Maintenance', 'Die Maintenance', 'QA', 'Logistic & Sales']) {
    assert.equal(stdUnitOf(u)?.seeded, true, `${u} ต้องมีในทะเบียนและ seed แล้ว`);
  }
  assert.equal(stdUnitOf('ไม่มีหน่วยนี้'), null);
});

test('ป้ายหน่วยงาน — ไม่มีคำแปลไทยที่มั่นใจ ให้ใช้ชื่ออังกฤษตามเอกสาร ห้ามเดาคำแปล', () => {
  assert.equal(stdUnitLabel('Production'), 'Production — ฝ่ายผลิต');
  assert.equal(stdUnitLabel('QSM'), 'QSM', 'ตัวย่อที่เอกสารไม่ได้ขยายความ ห้ามแปลเอง');
  assert.equal(stdUnitLabel('CIC'), 'CIC');
  assert.equal(stdUnitLabel(null), '');
});

test('ป้ายบังคับ fixed/choice — แถวที่ไม่มี requirement คือ "หัวข้อแม่" ไม่ใช่ KPI', () => {
  assert.deepEqual(KPI_REQUIREMENTS.map(r => r.key), ['fixed', 'choice']);
  const parent = { topic: 'Activity', requirement: null };   // แถวแม่ที่มี QCC/Kaizen อยู่ใต้มัน
  assert.ok(isStdParent(parent));
  assert.ok(!isStdFixed(parent), 'แถวแม่ห้ามถูกนับเป็นข้อบังคับ ไม่งั้นเตือน "ขาดข้อบังคับ" ผิดทุกใบ');
  assert.ok(isStdFixed({ topic: 'OEE', requirement: 'fixed' }));
  assert.ok(!isStdFixed({ topic: 'Cost Reduction', requirement: 'choice' }));
});

test('🔴 ผลรวม weight ต้องเป็น 50 เสมอ (ประกาศ QSM-R2 001/2569) — และต้องมีข้อบังคับครบ', () => {
  assert.equal(KPI_TOTAL_WEIGHT, 50);
  // ใบจริงของ PD3: 9 ข้อ รวม 50 พอดี
  const ok = [6, 6, 7, 6, 5, 5, 5, 6, 4].map(w => ({ weight: w }));
  assert.equal(checkStdSelection(ok).weight, 50);
  assert.equal(checkStdSelection(ok).diff, 0);
  assert.equal(checkStdSelection(ok).ok, true);

  const over = [...ok, { weight: 3 }];
  assert.equal(checkStdSelection(over).diff, 3, 'เกิน 50 ต้องบอกว่าเกินเท่าไหร่');
  assert.equal(checkStdSelection(over).ok, false);
  assert.equal(checkStdSelection([{ weight: 20 }]).diff, -30, 'ขาดต้องเป็นค่าติดลบ');
  // แถวที่ยังไม่ใส่น้ำหนัก ต้องไม่ถูกนับเป็น 0 เงียบๆ แล้วหลอกว่าใบครบ
  assert.equal(checkStdSelection([{ weight: 50 }, { weight: null }]).diff, 0);
});

test('เตือน "ขาดข้อบังคับ" — จับคู่ได้ทั้งทาง std_item_id และชื่อหัวข้อ', () => {
  const std = [
    { id: 'a', topic: 'Safety',  requirement: 'fixed' },
    { id: 'b', topic: 'OEE',     requirement: 'fixed' },
    { id: 'c', topic: 'Cost Reduction', requirement: 'choice' },
    { id: 'd', topic: 'Activity', requirement: null },
  ];
  const rows = [{ weight: 25, std_item_id: 'a' }, { weight: 25, topic: ' oee ' }];
  const r = checkStdSelection(rows, std);
  assert.equal(r.weight, 50);
  assert.deepEqual(r.missingFixed, [], 'จับคู่ด้วยชื่อหัวข้อ (ตัดช่องว่าง/ตัวพิมพ์) ต้องได้');
  assert.equal(r.ok, true);

  const r2 = checkStdSelection([{ weight: 50, std_item_id: 'a' }], std);
  assert.deepEqual(r2.missingFixed.map(x => x.topic), ['OEE']);
  assert.equal(r2.ok, false, 'น้ำหนักครบ 50 แต่ขาดข้อบังคับ = ยังไม่ผ่าน');

  // ไม่ส่งทะเบียนมา = ตรวจแค่น้ำหนัก ห้ามเดาว่าขาดข้อบังคับ
  assert.deepEqual(checkStdSelection([{ weight: 50 }]).missingFixed, []);
});
