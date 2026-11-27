/* 🔎 insight ของแผ่น KPI (16/11) — เรียบเรียงจากตัวเลขที่ตัดสินแล้ว ไม่คิดเกณฑ์เอง · ไม่มีข้อมูล = ไม่เขียนข้อนั้น */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsight, formulaDrivers, INSIGHT_PRIO } from '../kpiInsight.js';
import { yearForecast, neededRunRate } from '../kpiSetup.js';

const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fmt = (v) => `${Number(v).toFixed(2)} %`;
const series = [0.953, 0.98, 1.1503, 1.2, 0.9301, 1.1, 0.9469, 0.8, 0.7159, 1.1794, null, null].map((v, i) => ({ k: `2026-${String(i + 1).padStart(2, '0')}`, v, notes: i === 9 ? [{ kind: 'remark', text: 'ยอดขายตก' }] : [] }));
const statusOf = (p) => (p.v <= 1.017 ? 'good' : p.v <= 1.0485 ? 'warn' : 'bad');

test('buildInsight: DL+OH ต.ค. เกินเป้า — บอกส่วนต่าง · นับเดือนหลุด · แนวโน้ม · ตัวแปรสูตร+เหตุหลัก · หมายเหตุ · ปลายปี + อัตราที่ต้องทำ', () => {
  const info = { key: 'dloh_pct', inputs: { 9: { dl: 900000, oh: 480000, sale_product: 147816190 }, 10: { dl: 856655, oh: 478507, sale_product: 113207777 } } };
  const actual = series.map(p => p.v);
  const def = { kpi_catalog: { summary_mode: 'average' } };
  const forecast = { ...yearForecast({ actual, plan: [], def, fallback: true }), status: 'good' };
  const needed = neededRunRate({ actual, target: 1.017, def });
  const lines = buildInsight({ series, valueIdx: 9, value: 1.1794, target: 1.017, commit: 1.0485, dir: 'down', targetCompare: '≤',
    monthStatus: statusOf, fmt, monthOf: (i) => M[i], info, forecast, needed });
  const txt = lines.map(l => l.text).join('\n');
  assert.match(txt, /ต\.ค\. 1\.18 % เทียบ Target ≤ 1\.02 % → เกินเป้า 0\.16 %/);
  assert.match(txt, /หลุด Commitment/);
  assert.match(txt, /หลุด 4 \(มี\.ค\. เม\.ย\. มิ\.ย\. ต\.ค\.\)/);
  assert.match(txt, /เทียบ ก\.ย\. 0\.72 % → 1\.18 %.*แย่ลง/);
  assert.match(txt, /ตัวหาร \(ยอดขายจากสินค้า\) ลด 23\.4% แรงกว่าตัวตั้ง/);   // ยอดขายหด = เหตุหลัก ไม่ใช่ DL/OH
  assert.match(txt, /Remark: ยอดขายตก/);
  assert.match(txt, /คาดปลายปี .* \(จริง 10 ด\. · ถ้าเดือนที่เหลือ 2 ด\. ทำได้เท่าค่าเฉลี่ย/);
  assert.match(txt, /เดือนที่เหลือ 2 ด\. ต้องไม่เกินเฉลี่ยเดือนละ/);
});

test('buildInsight: ไม่มีเป้า/ไม่มีค่า = ไม่เขียนข้อเทียบเป้า · ไม่มีสูตร = ไม่มีบรรทัด 🧮 · ว่างได้', () => {
  assert.deepEqual(buildInsight({ series: [], value: null }), []);
  const lines = buildInsight({ series, valueIdx: 9, value: 1.1794, target: null, commit: null, dir: 'down', fmt, monthOf: (i) => M[i] });
  assert.ok(!lines.some(l => /Target/.test(l.text)));
  assert.ok(lines.some(l => l.icon === '📉' || l.icon === '📈'));   // แนวโน้มยังบอกได้โดยไม่ต้องมีเป้า
});

test('formulaDrivers: ตัวตั้งขยับแรงกว่า ⇒ เหตุหลัก = ตัวตั้ง · ตัวแปรขาด = driver null', () => {
  const info = { key: 'rm_pct', inputs: { 1: { raw_material: 100, sale_product: 1000 }, 2: { raw_material: 150, sale_product: 1010 } } };
  const d = formulaDrivers(info, 2, 1);
  assert.equal(d.driver.main, 'num'); assert.match(d.driver.text, /ตัวตั้ง \(ต้นทุนวัตถุดิบ\) เพิ่ม 50\.0%/);
  assert.equal(formulaDrivers({ key: 'rm_pct', inputs: { 1: { raw_material: 100 }, 2: { raw_material: 150, sale_product: 1 } } }, 2, 1).driver, null);
  assert.equal(formulaDrivers(null, 2, 1), null);
});

test('buildInsight: ตัวสะสม (max) — ถึงเป้าแล้ว/ยังต้องเพิ่มอีก · ตัวยิ่งสูงยิ่งดีที่ผ่านแล้ว = "ได้ 0 ก็ยังผ่าน"', () => {
  const cum = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null].map((v, i) => ({ k: `2026-${String(i + 1).padStart(2, '0')}`, v }));
  const defMax = { kpi_catalog: { summary_mode: 'max' } };
  const n1 = neededRunRate({ actual: cum.map(p => p.v), target: 12, def: defMax });
  const l1 = buildInsight({ series: cum, valueIdx: 8, value: 9, target: 12, dir: 'up', fmt: (v) => String(v), monthOf: (i) => M[i], needed: n1 });
  assert.match(l1.map(l => l.text).join('\n'), /ต้องไปให้ถึง 12 ภายใน 3 เดือนที่เหลือ \(เพิ่มอีก 3\)/);
  const defSum = { kpi_catalog: { summary_mode: 'sum' } };
  const n2 = neededRunRate({ actual: cum.map(p => p.v), target: 20, def: defSum });   // Σ = 45 ≥ 20 แล้ว
  const l2 = buildInsight({ series: cum, valueIdx: 8, value: 9, target: 20, dir: 'up', fmt: (v) => String(v), monthOf: (i) => M[i], needed: n2 });
  assert.match(l2.map(l => l.text).join('\n'), /ได้ 0 ก็ยังผ่าน/);
});

test('buildInsight: เรียงตามความสำคัญ — ตกเป้า/จบปีไม่ถึง/ต้องทำเท่าไหร่ มาก่อน · ตัวแปรดิบ (🧮) ไปท้ายสุด', () => {
  /* 🔴 16/11 คำสั่ง user: popup โชว์แค่ 3-4 ข้อ ⇒ "3 ข้อแรก" ต้องเป็นข้อที่ต้องลงมือก่อน ไม่ใช่ลำดับที่เขียนโค้ด */
  const info = { key: 'dloh_pct', inputs: { 9: { dl: 900000, oh: 480000, sale_product: 147816190 }, 10: { dl: 856655, oh: 478507, sale_product: 113207777 } } };
  const actual = series.map(p => p.v);
  const def = { kpi_catalog: { summary_mode: 'average' } };
  const needed = neededRunRate({ actual, target: 1.017, def });
  const base = { series, valueIdx: 9, value: 1.1794, target: 1.017, commit: 1.0485, dir: 'down', targetCompare: '≤',
    monthStatus: statusOf, fmt, monthOf: (i) => M[i], info, needed };
  const good = buildInsight({ ...base, forecast: { ...yearForecast({ actual, plan: [], def, fallback: true }), status: 'good' } });
  assert.deepEqual(good.map(l => l.kind), ['gap', 'needed', 'driver', 'note', 'year', 'trend', 'forecast', 'vars']);
  assert.equal(good[0].icon, '❌');                                  // เดือนนี้หลุดเป้า = พาดหัว
  assert.ok(good.every((l, i) => i === 0 || l.prio >= good[i - 1].prio));
  assert.ok(good.slice(0, 3).every(l => l.kind !== 'vars'));         // 🧮 ห้ามแย่งที่ 3 ข้อแรก
  /* จบปีไม่ถึงเป้า = ขึ้นเป็นข้อที่ 2 (แซงอัตราที่ต้องทำ/เหตุหลัก) */
  const bad = buildInsight({ ...base, forecast: { ...yearForecast({ actual, plan: [], def, fallback: true }), status: 'bad' } });
  assert.deepEqual(bad.slice(0, 3).map(l => l.kind), ['gap', 'forecast', 'needed']);
  assert.ok(INSIGHT_PRIO.gapBad < INSIGHT_PRIO.fcBad && INSIGHT_PRIO.fcBad < INSIGHT_PRIO.vars);
});

/* 🧱 20/11 (user): "เดือนที่เหลือ" ที่เป็นไปไม่ได้ (OEE > 100 % · MTTR ติดลบ) ต้องบอก "ไม่ทัน" ไม่ใช่โชว์ตัวเลข — ขอบจากทะเบียน kpi_catalog.value_min/max เท่านั้น */
test('neededRunRate: หลุดช่วงที่เป็นไปได้ของทะเบียน = feasible:false · ไม่มีขอบ = ตัดสินไม่ได้ (ยังโชว์ตัวเลข)', () => {
  const oee = { direction: 'up', kpi_catalog: { summary_mode: 'average', value_min: 0, value_max: 100 } };
  const a = [6.1, 38.8, 52.9, 40, 30, 35, 20, 6.1, 38.8, 52.9, null, null];   // เฉลี่ย 10 ด. ต่ำ ⇒ ต้องได้ > 100 %/เดือน
  const n = neededRunRate({ actual: a, target: 77.2, def: oee });
  assert.equal(n.feasible, false);
  assert.equal(n.limit.kind, 'max'); assert.equal(n.limit.value, 100);
  assert.ok(n.perMonth > 100);
  /* ทะเบียนไม่มีเพดาน (เช่น % เติบโต) = ไม่ตัดสินว่าเป็นไปไม่ได้ */
  const open = neededRunRate({ actual: a, target: 77.2, def: { direction: 'up', kpi_catalog: { summary_mode: 'average' } } });
  assert.equal(open.feasible, true); assert.equal(open.trivial, false);
  /* MTTR ยิ่งต่ำยิ่งดี: ต้องไม่เกินติดลบ = ต่ำกว่าพื้น 0 */
  const mttr = { direction: 'down', kpi_catalog: { summary_mode: 'average', value_min: 0 } };
  const m = neededRunRate({ actual: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, null, null], target: 5, def: mttr });
  assert.equal(m.feasible, false); assert.equal(m.limit.kind, 'min');
  /* ยิ่งต่ำยิ่งดี แต่ "ต้องไม่เกิน" ≥ เพดาน = ผ่านแน่ */
  const easy = neededRunRate({ actual: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, null, null], target: 30, def: { direction: 'down', kpi_catalog: { summary_mode: 'average', value_min: 0, value_max: 100 } } });
  assert.equal(easy.feasible, true); assert.equal(easy.trivial, true);
  /* insight: ข้อ 🏁 กลายเป็นโทนแดง "ไม่ทัน Target" ไม่มีประโยค "ต้องได้อย่างน้อย … ถึงจะถึง" */
  const lines = buildInsight({ series: a.map((v, i) => ({ k: `2026-${String(i + 1).padStart(2, '0')}`, v, notes: [] })), valueIdx: 9, value: 52.9, target: 77.2, commit: null, dir: 'up', targetCompare: '≥',
    monthStatus: (p) => (p.v >= 77.2 ? 'good' : 'bad'), fmt: (v) => `${Number(v).toFixed(1)} %`, monthOf: (i) => M[i], info: null, forecast: null, needed: n });
  const nd = lines.find(l => l.kind === 'needed');
  assert.equal(nd.tone, 'bad'); assert.equal(nd.data.feasible, false);
  assert.match(nd.text, /ไม่ทัน Target 77\.2 % ทั้งปีแล้ว/); assert.match(nd.text, /สุดเพดาน 100\.0 % ทุกเดือน ทั้งปีดีสุดได้แค่ 43\.4 %/);   // (Σ10 ด. 320.6 + 2×100)/12
  assert.ok(Math.abs(n.bestCase - (a.slice(0, 10).reduce((x, y) => x + y, 0) + 200) / 12) < 1e-9);
  assert.equal(m.bestCase, (5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 + 14) / 12);   // MTTR: 2 เดือนที่เหลือ = พื้น 0
  assert.doesNotMatch(nd.text, /ถึงจะถึง Target/);
});
