import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* bundle ก่อนเทส — wipMatOptions.js import matPrefix.js (ESM ในโปรเจค) */
const dir = mkdtempSync(join(tmpdir(), 'wipmat-'));
const entry = join(dir, 'e.mjs');
writeFileSync(entry, `export * from '${process.cwd()}/src/utils/wipMatOptions.js';\n`);
const out = join(dir, 'b.mjs');
execFileSync('npx', ['rolldown', entry, '-o', out, '-f', 'esm'], { stdio: 'pipe' });
const { mergeMatRegistry, buildWipMatOptions, filterWipMatByCat, rankMat, WIP_MAT_GROUPS } = await import(out);

/* ── ข้อมูลจำลองตามของจริง ─────────────────────────────────────────────────
   LINE APRON ASSY (แม่) → Line 60 / Line 61 (ลูก) · HDF1 ป้อนงานให้ LASER-345 */
const PM = [
  { mat_no: '10100384', part_name: 'REINF ASY FRT FNDR INR BDY RH (FTM)' },
  { mat_no: '20066636', part_name: 'REINF FRT FNDR RH (ชุบดำ)' },
  { mat_no: '30051864', part_name: 'NUT M8' },          // ซื้อนอก — ไม่มีใน dr_products เลย
  { mat_no: '50031601', part_name: 'COIL WSS-M1A367' }, // วัตถุดิบ
  { mat_no: '90031601', part_name: 'ชิ้นงาน HDF1 ก่อนเลเซอร์' },
];
const DR = [
  { mat_no: '10100384', name: 'REINF ASY FRT FNDR INR BDY RH (FTM)', line_name: 'Line 60' },
  { mat_no: '20066636', name: 'REINF FRT FNDR RH (ชุบดำ)', line_name: 'LINE APRON ASSY' },
  { mat_no: '90031601', name: 'ชิ้นงาน HDF1 ก่อนเลเซอร์', line_name: 'HDF1' },
  { mat_no: 'M6 ไม่มีเกลียว', name: 'ขับนัท M6', line_name: 'SUB APRON' }, // ยังไม่เข้าทะเบียน
];
const LINES = [
  { name: 'LINE APRON ASSY', parent_line_name: null },
  { name: 'Line 60', parent_line_name: 'LINE APRON ASSY' },
  { name: 'Line 61', parent_line_name: 'LINE APRON ASSY' },
  { name: 'HDF1', parent_line_name: 'HYDROFORM' },
  { name: 'SUB APRON', parent_line_name: null },
];

test('mergeMatRegistry: ทะเบียนกลางครบ + mat ที่มีแต่ใน dr_products ต้องไม่หาย', () => {
  const r = mergeMatRegistry(PM, DR);
  assert.equal(r.length, 6); // 5 ในทะเบียน + 'M6 ไม่มีเกลียว' ที่ยังไม่เข้าทะเบียน
  assert.ok(r.some(p => p.mat_no === 'M6 ไม่มีเกลียว'), 'เลขชั่วคราวที่ยังไม่เข้าทะเบียนต้องยังเลือกได้');
  // ชื่อจาก parts_master ชนะ (part_name) · ไลน์มาจาก dr_products
  assert.equal(r.find(p => p.mat_no === '10100384').lines[0], 'Line 60');
  assert.equal(r.find(p => p.mat_no === '30051864').lines.length, 0, 'พาร์ทซื้อนอกไม่ผูกไลน์ผลิต');
});

test('พาร์ทซื้อนอก 3xx / วัตถุดิบ 5xx ต้องอยู่ในลิสต์ (บั๊กเดิมดึงจาก dr_products เลยไม่มีทางโผล่)', () => {
  const opts = buildWipMatOptions(mergeMatRegistry(PM, DR), { line: 'Line 60', lines: LINES });
  const ids = opts.map(o => o.id);
  assert.ok(ids.includes('30051864'));
  assert.ok(ids.includes('50031601'));
});

test('เรียงลำดับ: ไลน์นี้ → ครอบครัวไลน์ → ต้นน้ำ → ทะเบียนทั้งหมด (ไม่ตัดอะไรทิ้ง)', () => {
  const opts = buildWipMatOptions(mergeMatRegistry(PM, DR), {
    line: 'Line 60', lines: LINES, upstreamLines: new Set(['HDF1']),
  });
  assert.equal(opts.length, 6, 'ทุก mat ต้องยังอยู่ในลิสต์');
  const g = (mat) => opts.find(o => o.id === mat).group;
  assert.equal(g('10100384'), WIP_MAT_GROUPS[0]);          // ผลิตที่ Line 60
  assert.equal(g('20066636'), WIP_MAT_GROUPS[1]);          // ไลน์แม่ = ครอบครัวไลน์
  assert.equal(g('90031601'), WIP_MAT_GROUPS[2]);          // HDF1 = ต้นน้ำ
  assert.equal(g('30051864'), WIP_MAT_GROUPS[3]);
  assert.equal(opts[0].id, '10100384', 'ของไลน์นี้ต้องอยู่บนสุด');
});

test('ไลน์แม่เห็นของไลน์ลูก (บั๊กเดิม .eq ตรงเป๊ะ ทำให้หายหมด)', () => {
  const opts = buildWipMatOptions(mergeMatRegistry(PM, DR), { line: 'LINE APRON ASSY', lines: LINES });
  const hit = opts.find(o => o.id === '10100384');
  assert.equal(hit.group, WIP_MAT_GROUPS[1], 'ของ Line 60 ต้องอยู่กลุ่มครอบครัวไลน์ ไม่ใช่หายไป');
});

test('rankMat: ไม่มีไลน์ต้นน้ำ = ไม่ตกไปกลุ่มต้นน้ำมั่ว', () => {
  const p = { mat_no: '90031601', lines: ['HDF1'] };
  assert.equal(rankMat(p, { line: 'Line 60', family: new Set(['Line 60']), upstream: new Set() }), 3);
  assert.equal(rankMat(p, { line: 'Line 60', family: new Set(['Line 60']), upstream: new Set(['HDF1']) }), 2);
});

test('กรองตามประเภท: เทียบเลขตัวแรกตัวเดียว + ทนค่าเก่า "200" + คืนจำนวนที่ซ่อน', () => {
  const opts = buildWipMatOptions(mergeMatRegistry(PM, DR), { line: 'Line 60', lines: LINES });
  const two = filterWipMatByCat(opts, '2');
  assert.deepEqual(two.rows.map(o => o.id), ['20066636']);
  assert.equal(two.hidden, 5, 'ต้องบอกจำนวนที่ซ่อน ห้ามหายเงียบ');
  // ค่าเก่าในฐานเป็น '200' — ต้องได้ผลเท่ากับ '2'
  assert.deepEqual(filterWipMatByCat(opts, '200').rows.map(o => o.id), ['20066636']);
  // ไม่เลือกประเภท / กด "ดูทุกประเภท" = ครบทุกแถว
  assert.equal(filterWipMatByCat(opts, '').rows.length, 6);
  assert.equal(filterWipMatByCat(opts, '2', true).rows.length, 6);
});

test('ค้นได้ทั้งรหัส ชื่อ และไลน์ที่ผลิต', () => {
  const o = buildWipMatOptions(mergeMatRegistry(PM, DR), { line: 'Line 60', lines: LINES })
    .find(x => x.id === '90031601');
  assert.ok(o.keywords.includes('HDF1'));
  assert.ok(o.keywords.includes('ก่อนเลเซอร์'));
  assert.ok(o.sub.includes('HDF1'));
});
