/* เทส processTypeRefs — ด่าน fail-closed ก่อนลบแถวทะเบียน `process_types`
   โจทย์ที่ต้องผ่าน (จาก QC audit 2026-10-06):
   1. มีคนใช้อยู่ = บล็อก พร้อมบอกว่าตารางไหนกี่รายการ
   2. **คิวรีนับล้ม = บล็อก** (ห้ามตีความว่า 0 — เคสเดิมของ StorageLocPanel ที่ fail-open)
   3. ตารางปลายทางยังไม่ apply migration (42P01/42703) = นับเป็น 0 ได้จริง ไม่ใช่ "ไม่รู้" */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProcessTypeRefs, processTypeBlockMessage, PROCESS_TYPE_REF_TABLES,
} from '../processTypeRefs.js';

/** client ปลอม — `per` = { <ตาราง>: {count} | {error:{code}} } */
const fakeClient = (per) => ({
  from(table) {
    return {
      select: () => ({
        eq: () => Promise.resolve(per[table] ?? { count: 0 }),
      }),
    };
  },
});

test('ทุกปลายทางว่าง = ลบได้ (คืน null)', async () => {
  const refs = await loadProcessTypeRefs(fakeClient({}), 'welding');
  assert.equal(refs.partial, false);
  assert.equal(refs.total, 0);
  assert.equal(processTypeBlockMessage('เชื่อม', refs), null);
});

test('มีคนใช้อยู่ = บล็อก + บอกตารางและจำนวน', async () => {
  const refs = await loadProcessTypeRefs(fakeClient({
    machines: { count: 12 }, break_policies: { count: 3 },
  }), 'welding');
  assert.equal(refs.partial, false);
  assert.equal(refs.total, 15);
  const msg = processTypeBlockMessage('เชื่อม', refs);
  assert.match(msg, /ลบไม่ได้/);
  assert.match(msg, /สูตรเวลาพัก 3 รายการ/);
  assert.match(msg, /เครื่องจักร 12 รายการ/);
  // สูตรเวลาพักต้องมาก่อน (กระทบ %A/%P — คนต้องเห็นก่อน)
  assert.ok(msg.indexOf('สูตรเวลาพัก') < msg.indexOf('เครื่องจักร'));
});

test('🔴 คิวรีนับล้ม = partial ⇒ บล็อก ห้ามแปลว่า 0', async () => {
  const refs = await loadProcessTypeRefs(fakeClient({
    machines: { error: { code: '57014', message: 'timeout' } },
  }), 'welding');
  assert.equal(refs.partial, true);
  assert.equal(refs.total, 0);                       // total 0 แต่ห้ามลบ
  assert.match(processTypeBlockMessage('เชื่อม', refs), /ตรวจไม่ครบ/);
});

test('ปลายทางยังไม่ apply migration (42P01/42703) = นับเป็น 0 ได้ ไม่ใช่ partial', async () => {
  for (const code of ['42P01', '42703']) {
    const refs = await loadProcessTypeRefs(fakeClient({
      pe_master_processes: { error: { code, message: 'x' } },
    }), 'welding');
    assert.equal(refs.partial, false, code);
    assert.equal(processTypeBlockMessage('เชื่อม', refs), null, code);
  }
});

test('ปลายทางหายไปบางตัว + อีกตัวมีคนใช้ = ยังบล็อกด้วยตัวที่นับได้', async () => {
  const refs = await loadProcessTypeRefs(fakeClient({
    pe_master_processes: { error: { code: '42P01' } },
    dr_products: { count: 5 },
  }), 'welding');
  assert.equal(refs.partial, false);
  assert.match(processTypeBlockMessage('เชื่อม', refs), /สินค้า\/ชั้น OP 5 รายการ/);
});

test('ไม่ส่ง client/key = partial (ห้ามเผลอคืน "ลบได้")', async () => {
  for (const args of [[null, 'welding'], [fakeClient({}), ''], [null, null]]) {
    const refs = await loadProcessTypeRefs(...args);
    assert.equal(refs.partial, true);
    assert.notEqual(processTypeBlockMessage('x', refs), null);
  }
});

test('refs เป็น undefined/null = บล็อก (ผู้เรียกยังโหลดไม่เสร็จ)', () => {
  assert.notEqual(processTypeBlockMessage('x', null), null);
  assert.notEqual(processTypeBlockMessage('x', undefined), null);
});

test('break_policies ต้องอยู่ในลิสต์ปลายทาง และอยู่ลำดับแรก', () => {
  // ตกตัวนี้ = สูตรเวลาพักกำพร้า ⇒ นับพักผิด ⇒ %A/%P ของกะนั้นเพี้ยน (CLAUDE.md §OEE)
  assert.equal(PROCESS_TYPE_REF_TABLES[0][0], 'break_policies');
  const tables = PROCESS_TYPE_REF_TABLES.map(([t]) => t);
  for (const t of ['machines', 'dr_products', 'part_routings', 'pe_master_processes']) {
    assert.ok(tables.includes(t), t);
  }
});
