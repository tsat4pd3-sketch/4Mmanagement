/*
  เทส pptxFit — ตัววัดข้อความของตัวสร้าง .pptx
  กันคลาสบั๊ก "ตัวหนังสือล้นตกบรรทัด / ตารางทับ footer" ที่ user ส่งกลับมา 2026-09-08
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  charWidthEm, textWidthIn, wrapLineCount, textHeightIn, fitOneLine, fitBox, rowHeightIn, layoutTable,
} from '../pptxFit.js';

test('สระ/วรรณยุกต์ไทยที่ลอยบนตัวอื่น ต้องกว้าง 0 (ไม่งั้นประมาณเกินเกือบเท่าตัว)', () => {
  ['ิ', 'ี', 'ุ', '่', '้', '์', 'ั'].forEach(ch => assert.equal(charWidthEm(ch), 0, ch));
  assert.ok(charWidthEm('ก') > 0.4);
  // "มี" = ม + ี → กว้างเท่า ม ตัวเดียว
  assert.equal(textWidthIn('มี', 20), textWidthIn('ม', 20));
});

test('ความกว้างเป็นสัดส่วนตรงกับขนาดฟอนต์ และ bold กว้างกว่า', () => {
  const a = textWidthIn('HELLO', 10);
  assert.ok(Math.abs(textWidthIn('HELLO', 20) - a * 2) < 1e-9);
  assert.ok(textWidthIn('HELLO', 10, { bold: true }) > a);
  assert.equal(textWidthIn('', 20), 0);
  assert.equal(textWidthIn(null, 20), 0);
});

test('หัวเรื่องจริงที่ล้นในเด็ค AUGUST 2026 ต้องถูกตรวจว่า "ล้น" และถูกย่อลง', () => {
  const t = 'MONTHLY PERFORMANCE REVIEW AUGUST 2026';
  assert.ok(textWidthIn(t, 40, { bold: true }) > 12.13, 'ที่ 40pt ต้องกว้างเกินกล่อง 12.13"');
  const fs = fitOneLine(t, 12.13, 40, 22);
  assert.ok(fs < 40 && fs >= 22);
  assert.ok(textWidthIn(t, fs, { bold: true }) <= 12.13 + 1e-9, 'ย่อแล้วต้องพอดีบรรทัดเดียว');
});

test('fitOneLine: ข้อความสั้นไม่ถูกย่อ · ยาวมากไม่ต่ำกว่าขั้นต่ำ', () => {
  assert.equal(fitOneLine('OK', 12, 36, 18), 36);
  assert.equal(fitOneLine('X'.repeat(400), 2, 36, 18), 18);
});

test('wrapLineCount: นับบรรทัดจาก \\n และจากการห่อ', () => {
  assert.equal(wrapLineCount('a\nb\nc', 10, 10), 3);
  assert.equal(wrapLineCount('', 10, 10), 1);
  assert.ok(wrapLineCount('aaaa bbbb cccc dddd', 1.0, 10) >= 2);
  assert.ok(wrapLineCount('aaaa bbbb cccc dddd eeee ffff', 0.8, 10) >= 3, 'กล่องแคบต้องได้หลายบรรทัด');
  // คำยาวรวดไม่มีช่องว่าง ต้องตัดกลางคำ ไม่ใช่ค้างเป็นบรรทัดเดียว
  assert.ok(wrapLineCount('A'.repeat(60), 1.0, 10) > 1);
  // ยิ่งกล่องกว้าง บรรทัดยิ่งน้อยลง (ไม่มีทางเพิ่ม)
  const long = 'ปัญหาจิ๊กชำรุดที่สถานีเชื่อมทำให้ต้องหยุดสายการผลิตเพื่อปรับแก้หลายครั้งในเดือนนี้';
  assert.ok(wrapLineCount(long, 2, 10) >= wrapLineCount(long, 6, 10));
});

test('textHeightIn โตตามจำนวนบรรทัด', () => {
  const one = textHeightIn('abc', 10, 12);
  assert.ok(textHeightIn('abc\ndef', 10, 12) > one);
});

test('fitBox: ย่อจนสูงไม่เกินกล่อง', () => {
  const t = 'บรรทัดยาวมากที่ต้องถูกย่อขนาดฟอนต์ลงเพื่อให้อยู่ในกล่องเตี้ยๆ ได้พอดีไม่ล้นออกไปทับของข้างล่าง';
  const fs = fitBox(t, 3, 0.5, 14, 8);
  assert.ok(fs <= 14 && fs >= 8);
  assert.ok(textHeightIn(t, 3, fs) <= 0.5 || fs === 8);
});

test('rowHeightIn: เนื้อหายาว = แถวสูงกว่าขั้นต่ำ (rowH ของ PowerPoint เป็นแค่ min)', () => {
  const colW = [2.3, 8.9, 1.1];
  const short = rowHeightIn(['A', 'B', 'C'], colW, 9.5, { minH: 0.3 });
  assert.equal(short, 0.3);
  const tall = rowHeightIn(['A', 'x\ny\nz\nw\nv\nu\nt\ns', 'C'], colW, 9.5, { minH: 0.3 });
  assert.ok(tall > 0.3, 'แถว 8 บรรทัดต้องสูงกว่าขั้นต่ำ');
});

test('layoutTable: ย่อฟอนต์ก่อน แล้วค่อยตัดแถว และรายงาน hidden เสมอ', () => {
  const head = ['A', 'B'];
  const rows = Array.from({ length: 20 }, (_, i) => [`row ${i}`, 'x']);
  const colW = [3, 3];
  const fit = layoutTable({ head, rows, colW, fontSize: 11.5, minRowH: 0.34, maxH: 12 });
  assert.equal(fit.hidden, 0);
  assert.equal(fit.rows.length, 20);
  assert.ok(fit.height <= 12);

  const tight = layoutTable({ head, rows, colW, fontSize: 11.5, minFontSize: 8, minRowH: 0.34, maxH: 2 });
  assert.ok(tight.hidden > 0, 'พื้นที่ไม่พอต้องตัดแถวและบอกจำนวน');
  assert.equal(tight.rows.length + tight.hidden, 20, 'แถวที่โชว์ + ที่ตัด ต้องเท่าของเดิมเสมอ');
  assert.ok(tight.height <= 2 + 1e-9);
  assert.ok(tight.rows.length >= 1, 'ต้องเหลืออย่างน้อย 1 แถวเสมอ');
});

test('layoutTable: ความสูงที่คืน = ผลรวมจริงของหัว+ทุกแถว (caller เอาไปวางของถัดไป)', () => {
  const fit = layoutTable({
    head: ['A', 'B'], rows: [['1', '2'], ['3', '4']], colW: [3, 3],
    fontSize: 10, minRowH: 0.5, headMinH: 0.4, maxH: 10,
  });
  const sum = fit.headRowH + fit.rowHs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(fit.height - sum) < 0.011);
  assert.equal(fit.rowHs.length, fit.rows.length);
});

test('layoutTable: ย่อฟอนต์เฉพาะเมื่อได้แถวเพิ่มจริง (ตารางแบ่งหน้าต้องไม่กลายเป็น 8pt ทั้งสไลด์)', () => {
  // สภาพจริงของสไลด์ OEE BREAKDOWN: ความสูงแถวติดเพดาน minRowH อยู่แล้ว → ย่อฟอนต์ไม่ได้แถวเพิ่ม
  const head = ['Area', 'OEE', 'A', 'P', 'Q', 'Readout', 'Focus'];
  const colW = [2.1, 1.2, 1.4, 1.5, 1.2, 2.7, 2.2];
  const mk = (n) => Array.from({ length: n }, (_, i) => [`LINE-${i} ชื่อยาว`, '75.0%', '93.1%', '81.1%', '99.7%', 'Performance focus', 'JIG มีปัญหา (ชำรุด/ปรับแก้)']);
  const opt = { head, colW, fontSize: 11, minFontSize: 8, minRowH: 0.38, headMinH: 0.38, maxH: 4.95 };
  const full = layoutTable({ ...opt, rows: mk(12) });
  const over = layoutTable({ ...opt, rows: mk(30) });
  assert.equal(full.hidden, 0);
  assert.ok(over.hidden > 0);
  assert.equal(over.fontSize, full.fontSize, 'ตัดแถวแล้ว แต่ฟอนต์ต้องไม่เล็กลงถ้าย่อแล้วไม่ได้แถวเพิ่ม');
  assert.equal(over.rows.length, full.rows.length);
});

test('layoutTable: ย่อฟอนต์เมื่อ "ได้แถวเพิ่มจริง" (เนื้อหายาวจนแถวโตเกินขั้นต่ำ)', () => {
  const head = ['A', 'B'];
  const longCell = 'ข้อความยาวมากที่จะห่อหลายบรรทัดเมื่อฟอนต์ใหญ่ แต่ห่อน้อยลงเมื่อฟอนต์เล็กลง จึงทำให้จำนวนแถวที่ลงได้เพิ่มขึ้นจริง';
  const rows = Array.from({ length: 8 }, (_, i) => [`r${i}`, longCell]);
  const colW = [1.2, 3.0];
  const big = layoutTable({ head, rows, colW, fontSize: 14, minFontSize: 8, minRowH: 0.2, headMinH: 0.3, maxH: 3 });
  assert.ok(big.fontSize < 14, 'กรณีนี้ย่อฟอนต์ได้แถวเพิ่ม → ต้องยอมย่อ');
  assert.equal(big.rows.length + big.hidden, 8);
});

test('layoutTable: กล่องเตี้ยมากยังต้องเหลือ 1 แถว และ hidden ตรงกับที่ตัดจริง', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [`r${i}`, 'x']);
  const tiny = layoutTable({ head: ['A', 'B'], rows, colW: [2, 2], fontSize: 10, minFontSize: 8, minRowH: 0.4, headMinH: 0.4, maxH: 0.45 });
  assert.equal(tiny.rows.length, 1);
  assert.equal(tiny.hidden, 4);
});
