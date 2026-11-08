import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIntermediate, phantomCounts, sortIntermediates, phantomRank, PHANTOM_VERDICTS,
} from '../bomPhantom.js';

test('ขั้น OP = ของลมอัตโนมัติ ไม่ต้องติ๊กทะเบียน', () => {
  assert.equal(classifyIntermediate({ isOperation: true }), 'op');
  // OP ชนะทุกอย่าง แม้อยู่ในทะเบียนหรือมีใบผลิต
  assert.equal(classifyIntermediate({ isOperation: true, inRegistry: true, ownOrders: 9 }), 'op');
});

test('อยู่ในทะเบียน — seeded แยกจากที่ PE ยืนยันแล้ว', () => {
  assert.equal(classifyIntermediate({ inRegistry: true, seeded: true }), 'seeded');
  assert.equal(classifyIntermediate({ inRegistry: true, seeded: false }), 'confirmed');
});

test('ไม่อยู่ในทะเบียน — มีใบผลิตเอง = ของจริง · ไม่มี = โซ่ขาด', () => {
  assert.equal(classifyIntermediate({ ownOrders: 3 }), 'real');
  assert.equal(classifyIntermediate({ ownOrders: 0 }), 'gap');
});

test('🔴 ownOrders อ่านไม่ได้ = unknown ห้ามเดาเป็น 0 (จะกลายเป็น "โซ่ขาด" เทียม)', () => {
  assert.equal(classifyIntermediate({}), 'unknown');
  assert.equal(classifyIntermediate({ ownOrders: null }), 'unknown');
  assert.equal(classifyIntermediate({ ownOrders: undefined }), 'unknown');
});

test('โซ่ขาดต้องแรงสุด (rank ต่ำสุด) — ขึ้นหัวลิสต์เสมอ', () => {
  const ranks = Object.keys(PHANTOM_VERDICTS).map(phantomRank);
  assert.equal(phantomRank('gap'), Math.min(...ranks));
  assert.equal(PHANTOM_VERDICTS.gap.tone, 'bad');
});

test('นับรายกลุ่ม + ตัวที่ตัดสินไม่ได้ต้องไม่หาย', () => {
  const c = phantomCounts([
    { verdict: 'gap' }, { verdict: 'gap' }, { verdict: 'seeded' },
    { verdict: 'real' }, { verdict: 'unknown' }, {},
  ]);
  assert.equal(c.gap, 2);
  assert.equal(c.seeded, 1);
  assert.equal(c.real, 1);
  assert.equal(c.unknown, 2);        // แถวที่ไม่มี verdict ต้องตกถัง unknown ไม่ใช่หายไป
  assert.equal(c.total, 6);
});

test('เรียง: โซ่ขาด → รอยืนยัน → ที่เหลือ แล้วค่อยเรียงเลข mat', () => {
  const out = sortIntermediates([
    { mat_no: '30000002', verdict: 'real' },
    { mat_no: '20000009', verdict: 'gap' },
    { mat_no: '30000001', verdict: 'real' },
    { mat_no: '20000001', verdict: 'seeded' },
  ]).map(r => r.mat_no);
  assert.deepEqual(out, ['20000009', '20000001', '30000001', '30000002']);
});

test('sortIntermediates ไม่แก้ array เดิม', () => {
  const src = [{ mat_no: 'B', verdict: 'real' }, { mat_no: 'A', verdict: 'gap' }];
  const copy = JSON.parse(JSON.stringify(src));
  sortIntermediates(src);
  assert.deepEqual(src, copy);
});
