import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAbc, paretoGeometry, pickLabelAngle, labelBandHeight,
  collapseTail, labelWidthPx, niceAxisStep, isVagueLabel,
} from '../pareto.js';

/* ── ด่านกฎ "Pareto ตามมาตรฐานสากล" (2026-09-22 · user เทียบกับใบมาตรฐานแล้วบอกว่าของเราเทียบไม่ติด)
   ทุกเคสในไฟล์นี้ = องค์ประกอบบังคับของ Pareto (ASQ · Juran · Excel · QI Macros)
   ตกข้อใดข้อหนึ่ง = กราฟนั้นไม่ใช่ Pareto อีกต่อไป ⇒ build ต้องล่ม                            */

const DATA = [ // ตัวเลขจากใบอ้างอิง QI Macros ที่ user ส่งมา
  { name: 'Folded flaps', v: 105 }, { name: 'Bent flaps', v: 83 }, { name: "Carton won't open", v: 76 },
  { name: 'Poor ink adhesion', v: 33 }, { name: 'Off color', v: 31 }, { name: 'Ink smears', v: 24 },
  { name: 'Oil spots', v: 14 }, { name: 'Fisheye', v: 9 }, { name: 'Missing color', v: 8 },
];
const rows = classifyAbc(DATA, r => r.v);

test('① แท่งเรียงมาก→น้อยเสมอ', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  for (let i = 1; i < g.bars.length; i++) assert.ok(g.bars[i - 1].value >= g.bars[i].value);
});

test('② แท่งชิดกันสนิท ไม่มีช่องว่าง (จุดต่างสำคัญจาก bar chart ธรรมดา)', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  for (let i = 1; i < g.bars.length; i++) {
    assert.ok(Math.abs((g.bars[i - 1].x + g.bars[i - 1].w) - g.bars[i].x) < 1e-9,
      `แท่ง ${i - 1} กับ ${i} ไม่ชิดกัน — Pareto ห้ามมีช่องว่างระหว่างแท่ง`);
  }
  // แท่งแรกชิดแกนซ้าย · แท่งสุดท้ายชิดแกนขวา
  assert.equal(g.bars[0].x, g.padLeft);
  assert.ok(Math.abs((g.bars.at(-1).x + g.bars.at(-1).w) - (g.padLeft + g.plotW)) < 1e-9);
});

test('③ แกนซ้ายเริ่ม 0 เสมอ — ห้ามตัดฐาน (สัดส่วนความสูงคือสาระของกราฟ)', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  assert.equal(g.leftTicks[0].value, 0);
  assert.equal(g.leftTicks[0].y, g.base);
  assert.ok(g.yMax >= Math.max(...rows.map(r => r._val)), 'เพดานแกนต้องคลุมค่าสูงสุด');
});

test('🔴③b เพดานแกนซ้าย = ยอดรวม (accum) ไม่ใช่ค่าแท่งสูงสุด — user ชี้จุดนี้ 22/09', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  const total = rows.reduce((s, r) => s + r._val, 0);
  assert.ok(Math.abs(g.yMax - total) < 1e-9,
    'เพดาน = ยอดรวมเป๊ะ ห้ามปัดขึ้น (ปัดแล้ว 100% จะไม่ตรงยอดแกน)');
  assert.ok(g.yMax > Math.max(...rows.map(r => r._val)),
    'ถ้าเพดาน = ค่าแท่งสูงสุด แท่งแรกจะชนเพดานแต่หมุดแรกลอยต่ำ = เส้นกับแท่งคนละสเกลโดยไม่มีอะไรบอก');
});

test('🔴③c หมุด %สะสมตัวที่ i ต้องอยู่ระดับเดียวกับ "หัวแท่ง" ของยอดสะสมถึงแท่งนั้น', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  // หมุดแรก = หัวแท่งแรกพอดี (ภาพจำของ Pareto สากล: เส้นออกจากมุมบนขวาของแท่งที่ 1)
  assert.ok(Math.abs(g.line[1].y - g.bars[0].y) < 1e-9,
    'หมุดแรกไม่ตรงหัวแท่งแรก = เพดานแกนซ้ายไม่ได้ใช้ยอดรวม');
  // ทุกหมุด: y ต้องตรงกับ (ยอดสะสม ÷ ยอดรวม) บนแกนซ้าย
  let run = 0;
  rows.forEach((r, i) => {
    run += r._val;
    const want = g.base - (run / g.yMax) * g.plotH;
    assert.ok(Math.abs(g.line[i + 1].y - want) < 1e-9, `หมุด ${i} ไม่ตรงยอดสะสมบนแกนซ้าย`);
  });
});

test('④ เส้นสะสมเริ่ม 0% มุมล่างซ้าย → หมุดที่ขอบขวาของแต่ละแท่ง → จบ 100% พอดีขอบขวาสุด', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  assert.equal(g.line[0].pct, 0);
  assert.equal(g.line[0].x, g.padLeft);
  assert.equal(g.line[0].y, g.base);
  g.bars.forEach((b, i) => {
    assert.ok(Math.abs(g.line[i + 1].x - (b.x + b.w)) < 1e-9, `หมุด ${i} ต้องอยู่ขอบขวาของแท่ง`);
  });
  const last = g.line.at(-1);
  assert.ok(Math.abs(last.pct - 100) < 1e-6, 'หมุดสุดท้ายต้องเป็น 100%');
  assert.ok(Math.abs(last.y - g.padTop) < 1e-6, '100% ต้องอยู่ยอดแกนพอดี');
  assert.ok(Math.abs(last.x - (g.padLeft + g.plotW)) < 1e-9, '100% ต้องอยู่ขอบขวาสุด');
});

test('⑤ เส้นสะสมไต่ขึ้นอย่างเดียว ห้ามย้อนลง', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  for (let i = 1; i < g.line.length; i++) assert.ok(g.line[i].y <= g.line[i - 1].y + 1e-9);
});

test('⑥ เส้น 80% อยู่ตรงกับแกน % ขวา และ cutoffX ตรงรอยต่อ A→B', () => {
  const g = paretoGeometry(rows, { width: 800, height: 340 });
  const t80 = g.base - 0.8 * g.plotH;
  assert.ok(Math.abs(g.cutoffY - t80) < 1e-9);
  const lastA = rows.filter(r => r._cls === 'A').length;
  assert.ok(Math.abs(g.cutoffX - (g.padLeft + lastA * g.barW)) < 1e-9);
});

test('⑦ ป้ายแกน X เอียงเมื่อแนวนอนไม่พอ (user: 45° หรือ 90° ก็ได้) และฟอนต์ไม่ต่ำกว่า 11px', () => {
  const short = ['A', 'B', 'C'];
  assert.equal(pickLabelAngle(short, 120, 11.5), 0, 'ชื่อสั้น แท่งกว้าง = ไม่ต้องเอียง');
  assert.equal(pickLabelAngle(['เครื่องปั๊มเสียกะดึก', 'ชุดจับยึดหลวม'], 40, 11.5), -45);
  const many = Array.from({ length: 20 }, (_, i) => `สาเหตุที่ยาวมากอันที่ ${i}`);
  assert.equal(pickLabelAngle(many, 18, 11.5), -90, 'แท่งเยอะ+ชื่อยาว = ตั้งฉาก');
  // เอียงแล้วต้องกันที่ด้านล่างมากกว่าแนวนอน ไม่งั้นป้ายล้นออกนอกกราฟ
  assert.ok(labelBandHeight(many, -90, 11.5) > labelBandHeight(many, 0, 11.5));
  assert.ok(labelBandHeight(many, -45, 11.5) > labelBandHeight(many, 0, 11.5));
});

test('⑧ วัดความกว้างรู้จักภาษาไทย — สระ/วรรณยุกต์ลอยไม่กินที่แนวนอน', () => {
  assert.ok(labelWidthPx('เสีย', 12) > 0);
  // "กิ" (มีสระลอย) ต้องไม่กว้างกว่า "กก" (2 พยัญชนะเต็ม)
  assert.ok(labelWidthPx('กิ', 12) < labelWidthPx('กก', 12));
});

test('⑨ ยุบหางยาวเป็นแท่งเดียว: ยอดไม่หาย และเส้นสะสมยังจบ 100%', () => {
  const { rows: shown, tail } = collapseTail(rows, 5);
  assert.equal(shown.length, 5);
  assert.equal(tail.length, rows.length - 4);
  const sumAll = rows.reduce((s, r) => s + r._val, 0);
  const sumShown = shown.reduce((s, r) => s + r._val, 0);
  assert.ok(Math.abs(sumAll - sumShown) < 1e-9, 'ยุบแล้วยอดรวมต้องเท่าเดิม ห้ามหายเงียบ');
  assert.ok(Math.abs(shown.at(-1)._cum - 100) < 1e-6);
});

test('🔴 แท่ง "หางยาว" ห้ามใช้คำว่า "อื่นๆ" — ชนกับตัวจับข้อมูลกำกวม', () => {
  const { rows: shown } = collapseTail(rows, 5);
  const tailRow = shown.at(-1);
  assert.equal(tailRow._tail, true);
  assert.equal(isVagueLabel(tailRow.name), false,
    'ถ้าตั้งชื่อว่า "อื่นๆ" ตัวเตือน “ข้อมูลชี้เป้าไม่ได้” จะนับแท่งที่เราสร้างเองเข้าไปด้วย = เตือนผิด');
});

test('⑩ ไม่มีข้อมูล / รายการเดียว ต้องไม่ระเบิด', () => {
  const empty = paretoGeometry([], { width: 400, height: 200 });
  assert.equal(empty.bars.length, 0);
  assert.equal(empty.line.length, 0);
  const one = paretoGeometry(classifyAbc([{ name: 'x', v: 7 }], r => r.v), { width: 400, height: 200 });
  assert.equal(one.bars.length, 1);
  assert.ok(Math.abs(one.line.at(-1).pct - 100) < 1e-6);
  // ค่าเป็น 0 ทั้งหมด = ห้ามหาร 0 แล้วได้ NaN
  const zero = paretoGeometry(classifyAbc([{ name: 'a', v: 0 }, { name: 'b', v: 0 }], r => r.v), { width: 400, height: 200 });
  zero.bars.forEach(b => assert.ok(Number.isFinite(b.y) && Number.isFinite(b.h)));
});

test('⑪ ขั้นแกนอ่านสวย (1/2/2.5/5 × 10^k) ไม่ได้เลขห้อย', () => {
  assert.equal(niceAxisStep(21), 25);
  assert.equal(niceAxisStep(7), 10);
  assert.equal(niceAxisStep(1.1), 2);
  assert.equal(niceAxisStep(0), 1);       // กันค่าพัง
  assert.equal(niceAxisStep(-5), 1);
});

test('🔴 ยุบหางยาวเฉพาะเมื่อคุ้ม — หางเหลือ 1-2 ห้ามยุบ (แท่งรวมจะสูงกว่าเพื่อนบ้าน = ดูเหมือนไม่ได้เรียง)', () => {
  // 9 รายการ ขอ 8 แท่ง → หางเหลือ 2 → ห้ามยุบ
  assert.equal(collapseTail(rows, 8).tail, null);
  assert.equal(collapseTail(rows, 8).rows.length, 9);
  // ขอ 5 แท่ง → หางเหลือ 5 → ยุบได้
  assert.ok(collapseTail(rows, 5).tail.length >= 3);
});

test('🔴 หางยาวค่าน้อยมาก ต้องยังมี h > 0 — ห้ามคำนวณออกมาเป็น 0 (user ถาม "ท้ายๆ ค่าเป็น 0 รึป่าว")', () => {
  /* ข้อมูลจริง 90 วัน: ยอดรวม ~244,000 นาที · รายการท้ายสุด 10 นาที = 0.004%
     เพดานแกน = ยอดรวม ⇒ แท่งสูง ~1/40 พิกเซล · ตัววาดต้องยกพื้นให้เห็นเป็นเส้นบาง + บอกบนจอว่าไม่ใช่ 0 */
  const long = [50541, 35469, 12183, 108, 100, 93, 65, 50, 43, 40, 35, 21, 20, 10, 10]
    .map((v, i) => ({ name: 'c' + i, v }));
  const r = classifyAbc(long, x => x.v);
  const g = paretoGeometry(r, { width: 900, height: 360 });
  const last = g.bars.at(-1);
  assert.ok(last.value === 10, 'ค่าจริงต้องไม่ถูกปัดทิ้ง');
  assert.ok(last.h > 0, 'ความสูงที่คำนวณต้อง > 0 (ต่อให้เล็กกว่า 1 พิกเซล)');
  assert.ok(last.h < 1, 'เคสนี้ต้องเล็กกว่า 1 พิกเซลจริง — ไม่งั้นเทสนี้ไม่ได้ทดสอบอะไร');
  // ยอดสะสมยังต้องจบ 100% เป๊ะแม้หางจะจิ๋ว
  assert.ok(Math.abs(g.line.at(-1).pct - 100) < 1e-6);
});
