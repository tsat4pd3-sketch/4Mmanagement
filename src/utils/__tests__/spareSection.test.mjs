/**
 * เทสโค้ดจริงของ src/utils/spareSection.js — กติกาที่ห้าม regress:
 *   1. section ว่าง/null = "ของกลาง" ต้องเห็นเสมอไม่ว่าเลือกหน่วยงานไหน (pattern เดียวกับ team null)
 *   2. เทียบแบบ trim + ตัวพิมพ์ใหญ่ (คนพิมพ์ ' pd3 ' ต้องจับคู่กับ 'PD3')
 *   3. ค่านอกผังองค์กร **ห้ามหายจาก dropdown** — ต้องโผล่พร้อมป้าย ⚠ ให้ไปตามแก้
 *   4. guessSectionFromCode เดาได้เฉพาะ prefix ที่ตรงกับส่วนงานจริงในผัง — ไม่ตรง = null (ห้ามเดามั่ว)
 * เคสอ้างอิงจริง: คลังอะไหล่ Production ตั้งรหัสเอง `PD3-SP-UPE-001` 87 รายการ (feedback 2026-08-25)
 *
 * spareSection.js import supabaseClient (พึ่ง import.meta.env) → เทสตรงใน node ไม่ได้
 * จึง bundle ด้วย rolldown + stub client (pattern เดียวกับ permissions.test.mjs)
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STUB = `
export const supabase = {
  from() {
    const q = {
      select() { return q; }, eq() { return q; }, order() { return q; },
      then(resolve) { resolve({ data: globalThis.__FAKE_ORG || [], error: null }); },
    };
    return q;
  },
};
export const supabaseDR = supabase;
`;

let m;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/utils/spareSection.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `spare-section-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });

  // ผังจริง: PD1-PD4 (ฝ่ายผลิต) + Planning&Store · โค้ดของ Planning&Store เป็น null → ใช้ name แทน
  globalThis.__FAKE_ORG = [
    { code: 'PD1', name: 'PD1', sort_order: 1 },
    { code: 'PD2', name: 'PD2', sort_order: 2 },
    { code: 'PD3', name: 'PD3', sort_order: 3 },
    { code: 'PD4', name: 'PD4', sort_order: 4 },
    { code: null,  name: 'Planning&Store', sort_order: 5 },
  ];
  m = await import(pathToFileURL(out).href);
  await m.loadSpareSections();
});

test('โหลดส่วนงานจากผัง — code ว่างให้ตกไปใช้ name (Planning&Store)', () => {
  const codes = m.spareSectionsSync().map(s => s.code);
  assert.deepEqual(codes, ['PD1', 'PD2', 'PD3', 'PD4', 'Planning&Store']);
});

test('ของกลาง (section ว่าง/null) เห็นเสมอไม่ว่าเลือกหน่วยงานไหน', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(m.inSectionScope(v, 'PD1'), true, `ค่า ${JSON.stringify(v)} ต้องถือเป็นของกลาง`);
    assert.equal(m.inSectionScope(v, 'PD3'), true);
  }
});

test('ยังไม่เลือกหน่วยงาน = เห็นทุกแถว', () => {
  assert.equal(m.inSectionScope('PD3', ''), true);
  assert.equal(m.inSectionScope('PD3', null), true);
});

test('เทียบแบบ trim + ตัวพิมพ์ใหญ่', () => {
  assert.equal(m.inSectionScope(' pd3 ', 'PD3'), true);
  assert.equal(m.inSectionScope('PD3', ' pd3'), true);
  assert.equal(m.inSectionScope('PD3', 'PD1'), false);
});

test('filterBySection: เลือก PD1 ได้ของ PD1 + ของกลาง ไม่ได้ของ PD3', () => {
  const rows = [
    { id: 1, section: 'PD1' }, { id: 2, section: 'PD3' },
    { id: 3, section: null },  { id: 4, section: 'pd1' },
  ];
  assert.deepEqual(m.filterBySection(rows, 'PD1').map(r => r.id), [1, 3, 4]);
  assert.deepEqual(m.filterBySection(rows, '').map(r => r.id), [1, 2, 3, 4]);
});

test('ค่านอกผังต้องโผล่ใน dropdown พร้อมป้าย ⚠ (ห้ามซ่อน — หาแถวที่ต้องแก้ไม่เจอ)', () => {
  const opts = m.sectionOptions([{ section: 'PD3' }, { section: 'OLDPD' }, { section: null }]);
  const off = opts.filter(o => o.offOrg);
  assert.deepEqual(off.map(o => o.code), ['OLDPD']);
  assert.match(off[0].label, /นอกผัง/);
  // ส่วนงานในผังต้องอยู่ครบและมาก่อนเสมอ
  assert.deepEqual(opts.filter(o => !o.offOrg).map(o => o.code), ['PD1', 'PD2', 'PD3', 'PD4', 'PLANNING&STORE']);
});

test('guessSectionFromCode: เดาได้เฉพาะ prefix ที่มีจริงในผัง', () => {
  assert.equal(m.guessSectionFromCode('PD3-SP-UPE-001'), 'PD3');
  assert.equal(m.guessSectionFromCode('pd1_ls_cuh_002'), 'PD1');
  assert.equal(m.guessSectionFromCode('SP-001'), null);        // prefix ไม่ใช่ส่วนงาน = ไม่เดา
  assert.equal(m.guessSectionFromCode('MTN-01'), null);
  assert.equal(m.guessSectionFromCode(''), null);
  assert.equal(m.guessSectionFromCode(null), null);
});

test('sectionLabel: ไม่มีค่า = เขียนว่าของกลาง ห้ามคืนค่าว่าง', () => {
  assert.equal(m.sectionLabel(null), m.COMMON_SECTION_LABEL);
  assert.equal(m.sectionLabel('PD3'), 'PD3');
  assert.equal(m.sectionLabel('OLDPD'), 'OLDPD');   // นอกผังก็ต้องอ่านออก
});
