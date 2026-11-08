/* เทส dieUsage — แม่พิมพ์นับจากพาร์ทของชุด ไม่ใช่ยอดไลน์ (user 08/11)
   โจทย์:
   1. 🔴 ตัวอย่าง user: ไลน์ผลิต A100 B100 — แม่พิมพ์ของ A ต้องได้ 100 ไม่ใช่ 200
   2. ชุดไม่ผูก MAT = null (นับไม่ได้) ห้ามคืน 0 ห้ามถอยไปยอดไลน์
   3. separate LH/RH: OP10/20 (1→1) · OP30 (1→2) ผลิต 2,000 ชิ้น = ทุก OP 1,000 shot
   4. chain ข้อมูลไม่ครบ = null + บอกเหตุผล (ห้ามเดา ratio = 1)
   5. legacy (ไม่มีใครกรอกชิ้นเข้า) = พฤติกรรมเดิม finished ÷ ชิ้น/shot
   6. common die: แม่พิมพ์ที่ 2 ชุดใช้ร่วม = shot รวมทั้ง 2 ชุด */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFinishedUsage, opShotFactor, dieUsage, setMatsOf } from '../dieUsage.js';

const rows = [
  { mat_no: 'A', work_date: '2026-11-01', qty: 100 },
  { mat_no: 'B', work_date: '2026-11-01', qty: 100 },
  { mat_no: 'LH', work_date: '2026-11-02', qty: 1000 },
  { mat_no: 'RH', work_date: '2026-11-02', qty: 1000 },
];
const die = (id, ext = {}) => ({ id, ext });
const mem = (d, opSeq) => ({ die: d, opSeq });

test('ตัวอย่าง user — ไลน์ผลิต A100 B100 · แม่พิมพ์ของ A = 100 ไม่ใช่ 200', () => {
  const setA = { set_code: 'SA', mat_no: 'A', pieces_per_stroke: 1 };
  const d = die('dA');
  const u = dieUsage('dA', [{ set: setA, members: [mem(d, 10)] }], rows);
  assert.equal(u.pieces, 100);
  assert.equal(u.shots, 100);
});

test('ชุดไม่ผูก MAT = null (ไม่ใช่ 0 · ไม่ใช่ยอดไลน์)', () => {
  assert.equal(setFinishedUsage(rows, { mat_no: null }), null);
  const u = dieUsage('d', [{ set: { set_code: 'S0' }, members: [mem(die('d'), 10)] }], rows);
  assert.equal(u.pieces, null);
  assert.equal(u.shots, null);
  assert.deepEqual(u.noMatSets, ['S0']);
});

test('MAT normalize trim/upper ตรงกับ RPC', () => {
  assert.deepEqual(setMatsOf({ mat_no: ' lh ', mat_no_2: 'LH' }), ['LH']);
  assert.equal(setFinishedUsage(rows, { mat_no: ' lh ', mat_no_2: 'rh' }).qty, 2000);
});

test('separate LH/RH — ผลิต 2,000 ชิ้น = ทุก OP 1,000 shot', () => {
  const set = { set_code: 'S', mat_no: 'LH', mat_no_2: 'RH' };
  const o10 = die('o10', { pieces_in_per_stroke: 1, pieces_per_stroke: 1 });
  const o20 = die('o20', { pieces_in_per_stroke: 1, pieces_per_stroke: 1 });
  const o30 = die('o30', { pieces_in_per_stroke: 1, pieces_per_stroke: 2 });
  const members = [mem(o10, 10), mem(o20, 20), mem(o30, 30)];
  for (const id of ['o10', 'o20', 'o30']) {
    const u = dieUsage(id, [{ set, members }], rows);
    assert.equal(u.pieces, 2000, id);
    assert.equal(u.shots, 1000, id);
  }
});

test('progressive จากม้วน OP แรก (coil) แล้วตัดแยกที่ OP ถัดไป', () => {
  const set = { set_code: 'P', mat_no: 'LH', mat_no_2: 'RH' };
  const p10 = die('p10', { feed_type: 'coil', pieces_per_stroke: 1 });
  const p20 = die('p20', { pieces_in_per_stroke: 1, pieces_per_stroke: 2 });
  const members = [mem(p10, 10), mem(p20, 20)];
  assert.equal(dieUsage('p10', [{ set, members }], rows).shots, 1000);
  assert.equal(dieUsage('p20', [{ set, members }], rows).shots, 1000);
});

test('chain ไม่ครบ = null + เหตุผล (ห้ามเดา ratio = 1)', () => {
  const set = { set_code: 'S', mat_no: 'LH', mat_no_2: 'RH', pieces_per_stroke: 2 };
  const o10 = die('o10', { pieces_in_per_stroke: 1, pieces_per_stroke: 1 });
  const o30 = die('o30', {});                       // OP หลังยังไม่กรอก
  const members = [mem(o10, 10), mem(o30, 30)];
  const f = opShotFactor(members, 'o10', set);
  assert.equal(f.factor, null);
  assert.equal(f.mode, 'chain');
  assert.match(f.why, /OP30/);
  const u = dieUsage('o10', [{ set, members }], rows);
  assert.equal(u.pieces, 2000);                     // ชิ้นยังรู้
  assert.equal(u.shots, null);                      // shot ไม่รู้
  // ลำดับ OP ไม่รู้ = คิดย้อนไม่ได้
  assert.equal(opShotFactor([mem(o10, 10), mem(o30, null)], 'o10', set).factor, null);
});

test('legacy (ไม่มีใครกรอกชิ้นเข้า) = พฤติกรรมเดิม ชิ้น ÷ ชิ้น/shot ของชุด', () => {
  const set = { set_code: 'L', mat_no: 'LH', mat_no_2: 'RH', pieces_per_stroke: 2 };
  const members = [mem(die('a'), 10), mem(die('b'), 20)];
  const u = dieUsage('a', [{ set, members }], rows);
  assert.equal(u.shots, 1000);
  assert.equal(u.legacy, true);
  // ไม่รู้ชิ้น/shot เลย = null (ห้ามเดาเป็น 1)
  assert.equal(dieUsage('a', [{ set: { ...set, pieces_per_stroke: null }, members }], rows).shots, null);
});

test('common die — ใช้ร่วม 2 ชุด = shot รวม', () => {
  const shared = die('s');
  const setA = { set_code: 'SA', mat_no: 'A', pieces_per_stroke: 1 };
  const setB = { set_code: 'SB', mat_no: 'B', pieces_per_stroke: 1 };
  const u = dieUsage('s', [{ set: setA, members: [mem(shared, 10)] }, { set: setB, members: [mem(shared, 10)] }], rows);
  assert.equal(u.pieces, 200);
  assert.equal(u.shots, 200);
  // ชุดหนึ่งไม่ผูก MAT = ชิ้นรู้บางส่วน แต่ shot รวมไม่ครบ ⇒ null + บอกชุดที่ขาด
  const p = dieUsage('s', [{ set: setA, members: [mem(shared, 10)] }, { set: { set_code: 'SX' }, members: [mem(shared, 10)] }], rows);
  assert.equal(p.pieces, 100);
  assert.equal(p.shots, null);
  assert.deepEqual(p.noMatSets, ['SX']);
});

test('since exclusive — นับหลังวัน PM', () => {
  const set = { mat_no: 'A', pieces_per_stroke: 1 };
  assert.equal(setFinishedUsage(rows, set, { since: '2026-11-01' }).qty, 0);
  assert.equal(setFinishedUsage(rows, set, { since: '2026-10-31' }).qty, 100);
});
