/* 🧭 ตำแหน่ง 2 ชั้น — "ตามบริษัท" vs "ที่ปฏิบัติงานจริง"  (2026-10-14 · คำสั่ง user)
 *
 * > *"ตำแหน่งจริงที่เค้าเป็นอยู่กับบริษัทคือตามฐานพนักงาน
 * >   แต่ตำแหน่งงานและงานที่ตัวเค้าทำ คือทำในตำแหน่งตรงกับบัญชี"*
 *
 * 🔴 กติกาที่ห้าม regress: **ต้องเป็น fallback ห้ามสลับขาดตัว**
 *    วัด 14/10: พนักงาน active 220 คน มีบัญชีใช้แอปแค่ 45 ⇒ อ่านจากบัญชีอย่างเดียว
 *    = อีก 175 คนไม่มีค่า แล้วตกไปแถวพนักงานฝ่ายผลิตหมด (ในนั้น 34 คนไม่ใช่ operator)
 *
 * positions.js import supabaseClient → bundle ด้วย rolldown + stub (วิธีเดียวกับ manpowerBoard.test.mjs)
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STUB = `export const supabase = { from() { throw new Error('no db in test'); } }; export const supabaseDR = supabase;`;
let M;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/utils/positions.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `positions-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  M = await import(pathToFileURL(out).href);
});

test('มีบัญชีและกรอกตำแหน่งไว้ = ตำแหน่งที่ปฏิบัติงานชนะ', () => {
  // สุวิทย์ชัย ดีทั่ว — บริษัทบรรจุหัวหน้าไลน์ แต่ทำงานเป็นหัวหน้าแผนก
  assert.equal(M.workingPositionOf({ position: 'line_leader' }, 'dept_head'), 'dept_head');
  assert.equal(M.isActingPosition({ position: 'line_leader' }, 'dept_head'), true);
});

test('🔴 ไม่มีบัญชี = ถอยไปตำแหน่งตามบริษัท ห้ามกลายเป็น null', () => {
  for (const acting of [null, undefined, '']) {
    assert.equal(M.workingPositionOf({ position: 'technician' }, acting), 'technician', String(acting));
    assert.equal(M.isActingPosition({ position: 'technician' }, acting), false);
  }
});

test('ตรงกันทั้ง 2 ฝั่ง = ไม่ใช่การรักษาการ (ไม่ต้องติดป้าย)', () => {
  assert.equal(M.workingPositionOf({ position: 'operator' }, 'operator'), 'operator');
  assert.equal(M.isActingPosition({ position: 'operator' }, 'operator'), false);
});

test('🔴 ไม่รู้ทั้ง 2 ฝั่ง = null (ให้ตัวจัดแถวตัดสินเองว่าลงตะกร้าไหน) ห้ามพัง', () => {
  assert.equal(M.workingPositionOf({}, null), null);
  assert.equal(M.workingPositionOf(null, null), null);
  assert.equal(M.isActingPosition(null, 'dept_head'), false);
  assert.equal(M.isActingPosition({ position: 'x' }, null), false);
});

test('🔴 จัดแถวด้วยตำแหน่งที่ปฏิบัติงานแล้วต้องย้ายแถวจริง (ไม่ใช่แค่เปลี่ยนป้าย)', () => {
  const row = (p) => M.levelOfPosition(p);
  assert.notEqual(row('line_leader'), row('dept_head'));   // หัวหน้าไลน์ → หัวหน้าแผนก
  assert.notEqual(row('operator'), row('technician'));     // พนักงาน → ช่าง
  assert.notEqual(row('operator'), row('clerk'));          // พนักงาน → ธุรการ (สายสนับสนุน)
});

test('ระดับของตำแหน่งที่ปฏิบัติงานต้องไปโผล่ที่ positionRank (= ด่านช่องเซ็น MO)', () => {
  const emp = { position: 'line_leader' };
  assert.equal(M.positionRank(M.workingPositionOf(emp, 'dept_head')), 50);
  assert.equal(M.positionRank(M.workingPositionOf(emp, null)), 40);
});
