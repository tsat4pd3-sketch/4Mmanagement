/**
 * เทสโค้ดจริงของ src/lib/prodProblemReport.js — ช่อง "ปัญหา :" บนหัวใบ
 *
 * ที่มา (feedback หน้างาน 2026-08-28 · Sup Assy2): "ปัญหาลงตรงไหนได้บ้างครับ"
 *   → ตรวจแล้วช่องนั้นเป็น "ช่องตาย" — จุดเรียกจริงไม่เคยส่ง extra.problem มาเลย
 *     ใบจึงออกมาว่าง 100% ทุกครั้ง โดยไม่มีอะไรบอก (ล้มเหลวเงียบ)
 *
 * กติกาที่ห้าม regress:
 *   1. headline ต้องมาจาก "แถวจริงที่หนักสุด" — สืบกลับได้ ไม่ใช่ข้อความที่แต่งขึ้น
 *   2. downtime ยาวสุดชนะเสมอ (ทั้งเครื่องจักรและการรอ) — ไม่มี downtime ค่อยใช้ของเสียมากสุด
 *   3. ไม่มีรายการเข้าใบเลย = คืน '' **ห้ามแต่งข้อความให้**
 *   4. หยุดตามแผน (planned) และรายการสั้นกว่าเกณฑ์ ไม่เข้าใบ → ห้ามถูกเลือกเป็นหัวเรื่อง
 *
 * ไฟล์นี้ import docForms (พึ่ง supabaseClient) + ไฟล์รูปโลโก้ → เทสตรงใน node ไม่ได้
 * จึง bundle ด้วย rolldown + stub (pattern เดียวกับ spareSection.test.mjs)
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STUB_DOCFORMS = `
export const getDocForm = async (_k, fb) => (fb || {});
export const fullCode = () => '';
export const withDocFoot = h => h;
export const sigAt = () => ({ label: '', name: '' });
`;

let m;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/lib/prodProblemReport.js',
    plugins: [{
      name: 'stub-deps',
      resolveId(id) {
        if (/utils\/docForms$/.test(id)) return '\0docforms';
        if (/\.png$/.test(id)) return '\0asset';
        return null;
      },
      load(id) {
        if (id === '\0docforms') return STUB_DOCFORMS;
        if (id === '\0asset') return 'export default "";';
        return null;
      },
    }],
  });
  const out = join(tmpdir(), `prod-problem-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  m = await import(pathToFileURL(out).href);
});

const dt = (name, min, extra = {}) => ({
  dr_downtime_types: { name_th: name, category: 'unplanned' },
  duration_min: min, ...extra,
});
const df = (name, ng) => ({ dr_defect_types: { name_th: name }, qty_ng: ng });

test('หัวเรื่อง = downtime ที่ยาวสุด พร้อมหมายเลขเครื่องและนาที', () => {
  const R = m.buildProblemReport({
    downtimes: [dt('Jig มีปัญหา', 35), dt('Feed nut ติด', 45, { machine_no: 'SP-66' })],
    defects: [],
  });
  assert.equal(R.headline, 'Feed nut ติด (SP-66) 45 นาที');
});

test('การรอที่ยาวกว่าเครื่องจักร ก็ต้องได้เป็นหัวเรื่อง (ไม่ล็อกว่าเครื่องจักรมาก่อน)', () => {
  const R = m.buildProblemReport({
    downtimes: [dt('Jig มีปัญหา', 32), dt('รอเหล็ก', 90)],
    defects: [],
  });
  assert.equal(R.headline, 'รอเหล็ก 90 นาที');
});

test('ไม่มี downtime เข้าใบ → ใช้ของเสียที่จำนวนมากสุด', () => {
  const R = m.buildProblemReport({
    downtimes: [],
    defects: [df('ชิ้นงานเสียรูป', 3), df('GAP NG', 12)],
  });
  assert.equal(R.headline, 'GAP NG 12 ชิ้น');
});

test('หยุดตามแผน + รายการสั้นกว่าเกณฑ์ ห้ามถูกเลือกเป็นหัวเรื่อง', () => {
  const planned = { dr_downtime_types: { name_th: 'นับสต๊อก', category: 'planned' }, duration_min: 300 };
  const R = m.buildProblemReport({
    downtimes: [planned, dt('รายการสั้น', 10), dt('Jig มีปัญหา', 31)],
    defects: [],
  });
  assert.equal(R.headline, 'Jig มีปัญหา 31 นาที');
});

test('ไม่มีอะไรเข้าใบเลย = ว่าง ห้ามแต่งข้อความ', () => {
  const R = m.buildProblemReport({ downtimes: [dt('สั้นมาก', 5)], defects: [] });
  assert.equal(R.headline, '');
});

/* ── snapshot ของใบที่ออกไปแล้ว (FM-PD1-019 เก็บ 1 ปี · 2026-09-25) ──────────
 * 🔴 กติกาที่ห้าม regress:
 *   1. `checked` เป็น Set — JSON.stringify ตรงๆ ได้ {} เงียบๆ ⇒ ต้องแปลง array ทั้งไปและกลับ
 *   2. ใบเลขเดียวกันต้องพิมพ์ซ้ำได้เหมือนเดิม แม้ข้อมูลต้นทางถูกแก้ทีหลัง
 *   3. signature ต้องเปลี่ยนเมื่อ "เนื้อที่พิมพ์ลงใบ" เปลี่ยน — และห้ามเปลี่ยนเพราะตัวนับเฉยๆ
 */
const roundTrip = R => m.reportFromSnapshot(JSON.parse(JSON.stringify(m.serializeReport(R))));

test('snapshot ไป-กลับแล้วเนื้อใบเหมือนเดิม (Set ไม่หาย)', () => {
  const R = m.buildProblemReport({
    downtimes: [dt('Jig มีปัญหา', 45, { machine_no: 'SP-66' })],
    defects: [df('GAP NG', 12)],
  });
  assert.ok(R.quality.checked.has('GAP NG'), 'ตั้งต้นต้องติ๊ก GAP NG');
  const back = roundTrip(R);
  assert.ok(back.quality.checked instanceof Set);
  assert.ok(back.quality.checked.has('GAP NG'));
  assert.ok(back.machine.checked.has('Jig'));
  assert.deepEqual(back.quality.details, R.quality.details);
  assert.equal(back.headline, R.headline);
  assert.equal(m.reportSignature(back), m.reportSignature(R));
});

test('snapshot ว่าง/เสีย = null (ผู้เรียกต้องบอกให้ออกใบใหม่ ห้ามพิมพ์ใบเปล่า)', () => {
  assert.equal(m.reportFromSnapshot(null), null);
  assert.equal(m.reportFromSnapshot({}), null);
  assert.equal(m.reportFromSnapshot('x'), null);
});

test('signature เปลี่ยนเมื่อเนื้อใบเปลี่ยน (ข้อมูลต้นทางถูกแก้หลังออกใบ)', () => {
  const a = m.buildProblemReport({ downtimes: [dt('Jig มีปัญหา', 45)], defects: [] });
  const b = m.buildProblemReport({ downtimes: [dt('Jig มีปัญหา', 90)], defects: [] });
  assert.notEqual(m.reportSignature(a), m.reportSignature(b));
});

test('signature เปลี่ยนเมื่อมีการลงวิธีแก้ไขเพิ่ม (ใบที่พิมพ์ออกมาต่างกันจริง)', () => {
  const a = m.buildProblemReport({ downtimes: [dt('Jig มีปัญหา', 45)], defects: [] });
  const b = m.buildProblemReport({
    downtimes: [dt('Jig มีปัญหา', 45, { fix_action: 'เปลี่ยนสปริง', fix_by: 'ช่างเอ' })], defects: [],
  });
  assert.notEqual(m.reportSignature(a), m.reportSignature(b));
});

test('signature ไม่เปลี่ยนเพราะรายการที่ไม่เข้าใบ (สั้นกว่าเกณฑ์ / planned)', () => {
  const base = [dt('Jig มีปัญหา', 45)];
  const a = m.buildProblemReport({ downtimes: base, defects: [] });
  const b = m.buildProblemReport({
    downtimes: [...base, dt('สั้นมาก', 5), { dr_downtime_types: { name_th: 'นับสต๊อก', category: 'planned' }, duration_min: 300 }],
    defects: [],
  });
  assert.equal(m.reportSignature(a), m.reportSignature(b));
});

test('serializeReport(null) = null (กะที่ไม่มีอะไรเลย ห้ามเขียน snapshot ขยะ)', () => {
  assert.equal(m.serializeReport(null), null);
});
