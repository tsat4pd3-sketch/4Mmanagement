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
