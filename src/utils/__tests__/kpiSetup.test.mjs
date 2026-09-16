/* ล็อกเกณฑ์ KPI ด้วย "ตัวเลขจริงจากใบ/คู่มือของบริษัท" ไม่ใช่ค่าที่เราคิดเอง
   ที่มาทุกเคส → docs/OBEYA-KPI-SOURCES.md §8.3 (คู่มือ KPI Online) · §12.2 (สูตรในเซลล์) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreKpi, totalPoints, summarizeMonths, evalFormula, parseBar, fmtBar,
  providerReaches, scopeLabel, KPI_SCOPE_LEVELS, KPI_PROVIDERS, KPI_BASE_VARS, KPI_FORMULAS,
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

test('🔴 ห้ามสมมติว่า Target ยากกว่า Commitment เสมอ — Safety commit 0 / target 1 Case', () => {
  // ใบจริงหน้า 33 ของคู่มือ: Commitment 0 Case · Target 1 Case (กลับด้านกับแถวอื่น)
  const def = { commit_compare: '<=', commit_value: 0, target_compare: '<=', target_value: 1, weight: 4 };
  assert.equal(scoreKpi(0, def).point, 4,   '0 เคส = ผ่านบาร์ที่เข้มกว่า (0) ⇒ เต็ม');
  assert.equal(scoreKpi(1, def).point, 2,   '1 เคส = ผ่านแค่บาร์หลวม (1) ⇒ ครึ่ง');
  assert.equal(scoreKpi(2, def).point, 0,   '2 เคส = ไม่ถึงทั้งคู่');
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

test('Inventory (วัน) = มูลค่าสต็อก ÷ (ยอดขาย ÷ ตัวหารวัน) — ใบใช้ 30 คงที่', () => {
  const v = evalFormula('inventory_day',
    { inventory_baht: 2000000, sale_product: 157193320.06, days_in_month: 30 }).value;
  assert.ok(Math.abs(v - 0.3817) < 0.001, `ได้ ${v} ควรใกล้ 0.3817 (ตรงกับใบ PD3 ม.ค.)`);
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
