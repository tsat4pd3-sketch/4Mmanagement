import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSheetGrid, MIN_SHEET_W, A4 } from '../sheetGrid.js';

const cells = (g) => g.cols * g.rows;

test('จอบอร์ด/TV แนวนอน — ต้องได้ผัง A4 5×2 เหมือนเดิม (ห้ามเปลี่ยนหน้าตาบอร์ดที่ใช้อยู่)', () => {
  const g = chooseSheetGrid(1744, 705, 10);
  assert.equal(g.cols, 5);
  assert.equal(g.rows, 2);
  assert.equal(g.fit, true);
  assert.ok(g.cw > MIN_SHEET_W, `แผ่นกว้าง ${Math.round(g.cw)} ต้องเกิน ${MIN_SHEET_W}`);
});

test('จอ 4K — แผ่นใหญ่ขึ้น ไม่ใช่แตกหน้าเพิ่ม', () => {
  const g = chooseSheetGrid(3600, 1860, 10);
  assert.equal(g.fit, true);
  assert.ok(cells(g) >= 10);
  assert.ok(g.cw > 400, `จอใหญ่ต้องได้แผ่นใหญ่ ไม่ใช่ ${Math.round(g.cw)}px`);
});

test('🔴 ห้ามบีบแผ่นจนแคบกว่าเกณฑ์อ่านออก — ยอมแบ่งหน้าแทน', () => {
  for (const [w, h] of [[1200, 500], [900, 420], [1280, 430], [1000, 380]]) {
    const g = chooseSheetGrid(w, h, 10);
    if (cells(g) > 1) {
      assert.ok(g.cw >= MIN_SHEET_W - 0.5, `${w}×${h} ได้แผ่นกว้าง ${Math.round(g.cw)} — แคบเกินอ่าน`);
    }
    assert.ok(g.ch <= h + 0.5, `${w}×${h} แผ่นสูง ${Math.round(g.ch)} ล้นกล่องสูง ${h}`);
  }
});

test('จอเตี้ยมาก = ใส่ได้น้อยแผ่นต่อหน้า (แล้วไปแบ่งหน้าเอา) ไม่ใช่ยัดให้ครบ', () => {
  const tall = chooseSheetGrid(1744, 705, 10);
  const short = chooseSheetGrid(1100, 260, 10);   // เตี้ยจนใส่ได้แถวเดียว
  assert.ok(cells(short) < cells(tall));
  assert.equal(short.fit, false);                 // ใส่ไม่ครบ = ผู้เรียกต้องแบ่งหน้า
  assert.equal(short.rows, 1);
});

test('จอเตี้ยแต่ยังพอ — ยอมให้แผ่น "เตี้ยกว่า A4" เพื่อให้ครบหน้าเดียว ดีกว่าแตกหน้า', () => {
  const g = chooseSheetGrid(1100, 380, 10);
  assert.equal(g.fit, true);
  assert.equal(cells(g), 10);
  assert.ok(g.ch < g.cw / A4, 'ต้องเป็นทรงเตี้ย ไม่ใช่ A4 เป๊ะ');
});

test('มือถือ — ไม่มีผังไหนผ่านเกณฑ์ ⇒ ใบเดียวเต็มกล่อง (ห้ามคืนแผ่นจิ๋ว)', () => {
  const g = chooseSheetGrid(370, 260, 10);
  assert.equal(cells(g), 1);
  assert.equal(g.cw, 370);
  assert.equal(g.ch, 260);
  assert.equal(g.fit, false);
});

test('แผ่นคงสัดส่วน A4 เมื่อที่ว่างพอ (ไม่ยืดจนเพี้ยน)', () => {
  const g = chooseSheetGrid(1744, 705, 10);
  assert.ok(Math.abs(g.cw / g.ch - A4) < 0.02, `สัดส่วน ${(g.cw / g.ch).toFixed(3)} ควรใกล้ A4 ${A4.toFixed(3)}`);
});

test('กล่องยังวัดไม่ได้ (0×0) — คืนค่าตั้งต้น ไม่ระเบิด ไม่หารศูนย์', () => {
  const g = chooseSheetGrid(0, 0, 10);
  assert.equal(g.cols, 5);
  assert.equal(g.rows, 2);
  assert.equal(g.cw, 0);
  assert.ok(Number.isFinite(g.k));
});

test('จำนวนแผ่นน้อย — ไม่ต้องแบ่งหน้า และแผ่นควรใหญ่ขึ้น', () => {
  const few = chooseSheetGrid(1744, 705, 4);
  assert.equal(few.fit, true);
  assert.ok(few.cw >= chooseSheetGrid(1744, 705, 10).cw);
});
