/**
 * orgScope — ขอบเขตตามผังองค์กรทุกมิติ (2026-09-23)
 * โจทย์จาก user: "เลือกส่วนงานตอนนี้เหมือนเลือกได้แค่ section และไม่ตรงกับผังองค์กร ควรกรองได้ทุกมิติ"
 * รูปทรงข้อมูลในเทส = ถอดจากฐานจริง 23/09 (PD3 › HYDROFORM/LINE APRON ASSY · JIG MTN ขึ้นตรงฝ่าย ·
 * Store Raw Material = org line node ที่ไม่ผูก production line · TEST section ไม่มีป้ายฝ่าย)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrgScope, scopeKey, parseScopeKey, scopeCovers, scopeOfDef, defScopeColumns, filterScopeOptions, PLANT,
} from '../orgScope.js';

const nodes = [
  { id: 's3', kind: 'section', code: 'PD3', name: 'PD3', parent_id: null, division: 'production', sort_order: 3, cost_center: '2140462000' },
  { id: 'd-hdf', kind: 'department', code: null, name: 'HYDROFORM', parent_id: 's3', sort_order: 62, cost_center: '2140562100' },
  { id: 'd-apr', kind: 'department', code: 'LINE APRON ASSY', name: 'LINE APRON ASSY', parent_id: 's3', sort_order: 61 },
  { id: 'l-hdf1', kind: 'line', name: 'HTDROFORM1', parent_id: 'd-hdf', ref_line_id: 23 },
  { id: 'l-hdf2', kind: 'line', name: 'HYDROFORM2', parent_id: 'd-hdf', ref_line_id: 24 },
  { id: 'l-sub', kind: 'line', name: 'SUB ASSY', parent_id: 'd-apr', ref_line_id: 6 },
  { id: 'l-apr', kind: 'line', name: 'APRON ASSY', parent_id: 'd-apr', ref_line_id: 6 }, // 2 node ชี้ไลน์เดียวกัน (ของจริง)
  { id: 'd-jig', kind: 'department', name: 'JIG MTN', parent_id: null, division: 'maintenance', sort_order: 36, cost_center: '2140563100' },
  { id: 's-pln', kind: 'section', code: 'Planning&Store', name: 'PLN & STO', parent_id: null, division: 'logistic', sort_order: 42 },
  { id: 'd-sto', kind: 'department', name: 'STORE', parent_id: 's-pln', division: 'logistic' },
  { id: 'l-rm', kind: 'line', name: 'Store Raw Material', parent_id: 'd-sto', ref_line_id: null, cost_center: '2140524100' },
  { id: 's-test', kind: 'section', code: null, name: 'TEST', parent_id: null, division: null, sort_order: 60 },
  { id: 't-a', kind: 'team', code: 'A', name: 'Team A', parent_id: 'l-hdf1' },
  { id: 'x-old', kind: 'department', name: 'ปิดแล้ว', parent_id: 's3', is_active: false },
];
const lines = [
  { id: 6, name: 'LINE APRON ASSY', section: 'PD3', parent_line_name: null, cost_center: '2140562100' },
  { id: 60, name: 'Line 60', section: 'PD3', parent_line_name: 'LINE APRON ASSY', cost_center: '2140662201' },
  { id: 61, name: 'Line 61', section: 'PD3', parent_line_name: 'LINE APRON ASSY', cost_center: '2140662201' },
  { id: 22, name: 'HYDROFORM', section: 'PD3', parent_line_name: null },
  { id: 23, name: 'HDF1', section: 'PD3', parent_line_name: 'HYDROFORM', cost_center: '2140662101' },
  { id: 24, name: 'HDF2', section: 'PD3', parent_line_name: 'HYDROFORM' },
  { id: 27, name: 'LASER E50', section: 'PD3', parent_line_name: 'HYDROFORM' },   // ผังยังไม่ชี้มา แต่ครอบครัวเดียวกัน
  { id: 90, name: 'Rework - PD3', section: 'PD3', parent_line_name: null },        // ไลน์ที่ผังยังไม่ผูกแผนก
  { id: 14, name: 'test', section: 'TEST', parent_line_name: null },
  { id: 15, name: 'test child', section: 'TEST', parent_line_name: 'test' },
  { id: 99, name: 'FG WAREHOUSE', section: 'Planning & Store', parent_line_name: null }, // สะกดต่างจาก code ในผัง
  { id: 77, name: 'ไลน์ปลดระวาง', section: 'PD3', parent_line_name: null, is_active: false },
];
const divisions = [
  { code: 'production', label: 'ฝ่ายผลิต', icon: '🏭', sort_order: 10 },
  { code: 'maintenance', label: 'ฝ่ายช่าง', icon: '🔧', sort_order: 20 },
  { code: 'logistic', label: 'ฝ่ายวางแผน-คลัง', icon: '📦', sort_order: 40 },
];
const costCenters = [
  { code: '2140462000', name: 'PD3', is_active: true },
  { code: '2140662201', name: 'Line 60', is_active: true },
  { code: '2140563100', name: 'JIG MTN', is_active: true },
  { code: '2140524100', name: 'Store Raw Material', is_active: true },
  { code: '9999999999', name: 'ปิดแล้ว', is_active: false },
];
const idx = buildOrgScope({ nodes, lines, divisions, costCenters });
const keys = idx.options.map(o => o.key);

test('ต้นไม้ครบทุกมิติ: โรงงาน → ฝ่าย → ส่วนงาน → แผนก → กลุ่มไลน์ → ไลน์ + แกน cost center', () => {
  assert.equal(keys[0], 'plant');
  assert.ok(keys.includes('division:production'));
  assert.ok(keys.includes('section:PD3'));
  assert.ok(keys.includes('department:HYDROFORM'));
  assert.ok(keys.includes('line_group:HYDROFORM'));
  assert.ok(keys.includes('line:HDF1'));
  assert.ok(keys.includes('cost_center:2140662201'));
  // ลำดับ depth-first: แผนกอยู่หลังส่วนงานของมัน · กลุ่มไลน์อยู่หลังแผนก
  assert.ok(keys.indexOf('section:PD3') < keys.indexOf('department:HYDROFORM'));
  assert.ok(keys.indexOf('department:HYDROFORM') < keys.indexOf('line_group:HYDROFORM'));
  assert.ok(keys.indexOf('line_group:HYDROFORM') < keys.indexOf('line:HDF1'));
});

test('🔴 แผนกที่ขึ้นตรงฝ่าย (JIG MTN) ต้องเลือกได้ — บั๊กเดิมคือหายจากตัวเลือกทั้งระบบ', () => {
  const jig = idx.optionOf('department', 'JIG MTN');
  assert.ok(jig, 'JIG MTN ต้องอยู่ในตัวเลือก');
  assert.equal(jig.parentKey, 'division:maintenance');
  assert.deepEqual(idx.lineNamesOf('department', 'JIG MTN'), [], 'ไม่มีไลน์ผลิต = [] (จอต้องบอกว่าข้อมูลไปไม่ถึง)');
  assert.equal(idx.sectionOf('department', 'JIG MTN'), null);
  assert.equal(idx.labelOf('department', 'JIG MTN'), 'แผนก: JIG MTN');
});

test('แผนกครอบครอบครัวไลน์ทั้งกลุ่ม แม้ผังชี้มาแค่บางไลน์ลูก (org line node → production line → กลุ่ม)', () => {
  const hdf = idx.lineNamesOf('department', 'HYDROFORM').sort();
  assert.deepEqual(hdf, ['HDF1', 'HDF2', 'HYDROFORM', 'LASER E50']);
  // 2 org node ชี้ไลน์ 6 เดียวกัน → กลุ่มเดียว ไม่ซ้ำ
  assert.equal(keys.filter(k => k === 'line_group:LINE APRON ASSY').length, 1);
  assert.deepEqual(idx.lineNamesOf('department', 'LINE APRON ASSY').sort(), ['LINE APRON ASSY', 'Line 60', 'Line 61']);
});

test('🔴 ไลน์ที่ผังยังไม่ผูกแผนก ต้องอยู่ใต้ส่วนงานตรงๆ ไม่หาย · ไลน์ปลดระวางไม่โผล่', () => {
  const rw = idx.optionOf('line_group', 'Rework - PD3');
  assert.ok(rw, 'Rework - PD3 ต้องมีที่อยู่');
  assert.equal(rw.parentKey, 'section:PD3');
  assert.equal(rw.unlinked, true, 'ติดป้ายว่าผังยังไม่ผูก');
  assert.ok(!keys.some(k => k.includes('ปลดระวาง')));
  // ส่วนงานครอบทุกไลน์ในส่วน (รวมที่ยังไม่ผูก)
  assert.ok(idx.lineNamesOf('section', 'PD3').includes('Rework - PD3'));
  assert.equal(idx.lineNamesOf('section', 'PD3').length, 8);
});

test('ชื่อส่วนงานเทียบแบบ normalize: "Planning & Store" ในทะเบียนไลน์ = code "Planning&Store" ในผัง', () => {
  assert.deepEqual(idx.lineNamesOf('section', 'Planning&Store'), ['FG WAREHOUSE']);
  assert.ok(!keys.includes('section:Planning & Store'), 'ต้องไม่สร้างส่วนงานซ้ำจากสะกดต่าง');
});

test('org line node ที่ไม่ผูก production line (Store Raw Material) ยังเลือกได้ พร้อมป้าย noData', () => {
  const o = idx.optionOf('line', 'Store Raw Material');
  assert.ok(o); assert.equal(o.noData, true); assert.equal(o.parentKey, 'department:STORE');
  assert.equal(idx.sectionOf('line', 'Store Raw Material'), 'Planning&Store');
});

test('ส่วนงานที่ไม่มีป้ายฝ่าย (TEST) อยู่ใต้โรงงานตรงๆ — ห้ามซ่อน', () => {
  assert.equal(idx.optionOf('section', 'TEST').parentKey, 'plant');
});

test('ancestorsOf ไต่ขึ้นครบสาย · cost_center มีแค่ plant เป็นแม่ (คนละแกน)', () => {
  assert.deepEqual(idx.ancestorsOf('line', 'HDF1'), [
    PLANT, { kind: 'division', value: 'production' }, { kind: 'section', value: 'PD3' },
    { kind: 'department', value: 'HYDROFORM' }, { kind: 'line_group', value: 'HYDROFORM' },
  ]);
  assert.deepEqual(idx.ancestorsOf('cost_center', '2140662201'), [PLANT]);
  assert.deepEqual(idx.ancestorsOf('plant', ''), []);
  assert.deepEqual(idx.pathOf('line', 'HDF1'), ['PD3', 'HYDROFORM', 'HYDROFORM']);
});

test('sectionsOf: ฝ่ายผลิต → {PD3} · โรงงาน → null (ไม่จำกัด) · แผนก → ส่วนงานของมัน', () => {
  assert.deepEqual([...idx.sectionsOf('division', 'production')], ['PD3']);
  assert.equal(idx.sectionsOf('plant', ''), null);
  assert.deepEqual([...idx.sectionsOf('line_group', 'HYDROFORM')], ['PD3']);
});

test('cost center รวมไลน์ที่ตั้ง cc เดียวกัน + ไลน์ใต้ node ที่ติด cc นั้น', () => {
  assert.deepEqual(idx.lineNamesOf('cost_center', '2140662201').sort(), ['Line 60', 'Line 61']);
  // แผนก HYDROFORM ติด cc 2140562100 = cc เดียวกับไลน์แม่ LINE APRON ASSY (ข้อมูลจริงตั้งไว้แบบนี้) → รวมทั้งสองฝั่ง
  assert.ok(idx.lineNamesOf('cost_center', '2140562100').includes('HDF1'));
  assert.ok(idx.lineNamesOf('cost_center', '2140562100').includes('LINE APRON ASSY'));
});

test('scopeKey/parseScopeKey กลับไปกลับมาได้ · ค่าประหลาด = plant', () => {
  assert.equal(scopeKey('department', 'JIG MTN'), 'department:JIG MTN');
  assert.deepEqual(parseScopeKey('department:JIG MTN'), { kind: 'department', value: 'JIG MTN' });
  assert.deepEqual(parseScopeKey('line:HDF:1'), { kind: 'line', value: 'HDF:1' }, 'ชื่อไลน์มี : ได้ ตัดที่ตัวแรกเท่านั้น');
  assert.deepEqual(parseScopeKey('bogus:x'), PLANT);
  assert.deepEqual(parseScopeKey(''), PLANT);
  assert.deepEqual(parseScopeKey('section:'), PLANT);
});

test('scopeCovers: นิยามระดับแม่ตกทอดถึงลูก · ลูกไม่ครอบแม่ · plant ครอบทุกอย่าง', () => {
  const sel = { kind: 'line_group', value: 'HYDROFORM' };
  assert.equal(scopeCovers(idx, PLANT, sel), true);
  assert.equal(scopeCovers(idx, { kind: 'section', value: 'PD3' }, sel), true);
  assert.equal(scopeCovers(idx, { kind: 'department', value: 'HYDROFORM' }, sel), true);
  assert.equal(scopeCovers(idx, sel, sel), true);
  assert.equal(scopeCovers(idx, { kind: 'line', value: 'HDF1' }, sel), false, 'ลูกไม่ครอบแม่');
  assert.equal(scopeCovers(idx, { kind: 'section', value: 'PD3' }, PLANT), false, 'ดูทั้งโรงงานเห็นเฉพาะนิยามโรงงาน');
  assert.equal(scopeCovers(idx, { kind: 'department', value: 'LINE APRON ASSY' }, sel), false, 'คนละแผนก');
});

test('scopeOfDef รองรับแถวเก่า (section/line_group) และแถวใหม่ (scope_kind/value) · defScopeColumns เขียน section เผื่อจอเก่า', () => {
  assert.deepEqual(scopeOfDef({ section: 'PD3', line_group: null }), { kind: 'section', value: 'PD3' });
  assert.deepEqual(scopeOfDef({ section: 'PD3', line_group: 'HYDROFORM' }), { kind: 'line_group', value: 'HYDROFORM' });
  assert.deepEqual(scopeOfDef({ scope_kind: 'department', scope_value: 'JIG MTN' }), { kind: 'department', value: 'JIG MTN' });
  assert.deepEqual(scopeOfDef({ scope_kind: 'plant', section: null }), PLANT);
  assert.deepEqual(defScopeColumns(idx, { kind: 'department', value: 'HYDROFORM' }),
    { scope_kind: 'department', scope_value: 'HYDROFORM', section: 'PD3', line_group: null });
  assert.deepEqual(defScopeColumns(idx, { kind: 'line_group', value: 'HYDROFORM' }),
    { scope_kind: 'line_group', scope_value: 'HYDROFORM', section: 'PD3', line_group: 'HYDROFORM' });
  assert.deepEqual(defScopeColumns(idx, PLANT), { scope_kind: 'plant', scope_value: null, section: null, line_group: null });
  assert.equal(defScopeColumns(idx, { kind: 'department', value: 'JIG MTN' }).section, null);
});

test('filterScopeOptions: user สังกัด PD3 เห็นสายของตัวเอง + ฝ่าย/โรงงานเป็นทางขึ้น · ไม่เห็น JIG MTN/TEST', () => {
  const scopeSet = new Set(idx.lineNamesOf('section', 'PD3'));
  const got = filterScopeOptions(idx, { scopeSet, sections: ['PD3'] }).map(o => o.key);
  assert.ok(got.includes('plant'));
  assert.ok(got.includes('division:production'));
  assert.ok(got.includes('section:PD3'));
  assert.ok(got.includes('line:HDF1'));
  assert.ok(!got.includes('department:JIG MTN'));
  assert.ok(!got.includes('section:TEST'));
  assert.ok(!got.includes('division:maintenance'), 'ฝ่ายที่ไม่มีลูกในสังกัด = ไม่โผล่');
  // ไม่จำกัด = ครบ
  assert.equal(filterScopeOptions(idx, { scopeSet: null, sections: [] }).length, idx.options.length);
});

/* ══ 23/09 · คำสั่ง user: "อย่าปนกัน cost center แยกอีกช่อง · เลือก PD4 ควรโชว์รหัส · พิมพ์รหัสควรเจอ PD3" ══ */

test('ccOf: หน่วยในผังตอบรหัส cost center ของตัวเองได้ · กลุ่มที่ลูกใช้หลายรหัสห้ามเดา', () => {
  assert.deepEqual(idx.ccOf('section', 'PD3'), { code: '2140462000', multi: 0 }, 'ส่วนงานอ่านจาก org_nodes');
  assert.deepEqual(idx.ccOf('department', 'JIG MTN'), { code: '2140563100', multi: 0 }, 'แผนกขึ้นตรงฝ่ายก็ต้องได้');
  assert.deepEqual(idx.ccOf('line', 'HDF1'), { code: '2140662101', multi: 0 }, 'ไลน์อ่านจาก production_lines');
  assert.deepEqual(idx.ccOf('line', 'Store Raw Material'), { code: '2140524100', multi: 0 }, 'org line node ที่ไม่ผูกไลน์ผลิต');
  // แถวไลน์แม่ LINE APRON ASSY มีรหัสของตัวเอง ⇒ ชนะรหัสของลูก (Line 60/61 = 2140662201)
  assert.deepEqual(idx.ccOf('line_group', 'LINE APRON ASSY'), { code: '2140562100', multi: 0 });
  // HYDROFORM: HDF1 มีรหัส · HDF2/LASER E50 ไม่มี ⇒ เหลือรหัสเดียว = ของกลุ่ม
  assert.deepEqual(idx.ccOf('line_group', 'HYDROFORM'), { code: '2140662101', multi: 0 });
  assert.deepEqual(idx.ccOf('plant', ''), { code: null, multi: 0 });
  assert.deepEqual(idx.ccOf('section', 'ไม่มีจริง'), { code: null, multi: 0 }, 'หน่วยที่ไม่รู้จัก = ไม่มีรหัส ไม่ใช่พัง');
});

test('ccOf: กลุ่มไลน์ที่ลูกใช้คนละรหัส ต้องคืน multi ไม่ใช่หยิบรหัสใดรหัสหนึ่ง', () => {
  const ix = buildOrgScope({
    nodes: [{ id: 's', kind: 'section', code: 'PD9', name: 'PD9', parent_id: null }],
    lines: [
      { id: 1, name: 'GRP', section: 'PD9', parent_line_name: null },
      { id: 2, name: 'A', section: 'PD9', parent_line_name: 'GRP', cost_center: '111' },
      { id: 3, name: 'B', section: 'PD9', parent_line_name: 'GRP', cost_center: '222' },
    ],
  });
  assert.deepEqual(ix.ccOf('line_group', 'GRP'), { code: null, multi: 2 });
});

test('ccOwnersOf: พิมพ์รหัสแล้วย้อนกลับไปหาหน่วยงานเจ้าของได้ · เรียงกว้าง → แคบ', () => {
  assert.deepEqual(idx.ccOwnersOf('2140462000'), [{ kind: 'section', value: 'PD3' }], 'รหัสส่วนงาน → ส่วนงาน');
  assert.deepEqual(idx.ccOwnersOf('2140563100'), [{ kind: 'department', value: 'JIG MTN' }]);
  // รหัสที่ไลน์ลูกใช้ร่วมกัน (แต่ไลน์แม่มีรหัสของตัวเอง) ⇒ เจ้าของคือไลน์ลูกทั้งคู่ ไม่ใช่กลุ่ม
  assert.deepEqual(idx.ccOwnersOf('2140662201').map(o => `${o.kind}:${o.value}`), ['line:Line 60', 'line:Line 61']);
  assert.deepEqual(idx.ccOwnersOf('2140562100').map(o => `${o.kind}:${o.value}`),
    ['department:HYDROFORM', 'line_group:LINE APRON ASSY'], 'รหัสเดียวผูก 2 หน่วย = ต้องคืนครบ (ข้อมูลจริงมีซ้ำ)');
  assert.deepEqual(idx.ccOwnersOf('2140662101').map(o => `${o.kind}:${o.value}`), ['line_group:HYDROFORM', 'line:HDF1']);
  assert.deepEqual(idx.ccOwnersOf('ไม่มีรหัสนี้'), [], 'รหัสที่ผังไม่มีใครอ้าง = ว่าง ไม่ใช่พัง');
  assert.deepEqual(idx.ccOwnersOf(null), []);
});

test('ccLabel: เอาชื่อจากทะเบียน cost_centers เท่านั้น — ไม่มีชื่อก็คืนรหัสเปล่า ห้ามเดาจากผัง', () => {
  assert.equal(idx.ccLabel('2140462000'), '2140462000 · PD3');
  assert.equal(idx.ccLabel('2140662101'), '2140662101', 'ไม่มีในทะเบียน = รหัสเปล่า');
  assert.equal(idx.ccLabel('9999999999'), '9999999999', 'แถวปิดใช้งานไม่เอาชื่อมาใช้');
  assert.equal(idx.ccLabel(''), '');
});

test('filterScopeOptions({ withCostCenter: false }) ตัดแกน cost center ออกจากลิสต์ผัง (ช่องผังห้ามมีรหัสปน)', () => {
  const org = filterScopeOptions(idx, { withCostCenter: false });
  assert.equal(org.some(o => o.kind === 'cost_center'), false);
  assert.ok(org.some(o => o.key === 'section:PD3'));
  const all = filterScopeOptions(idx, {});
  assert.ok(all.some(o => o.kind === 'cost_center'), 'default ยังได้ครบ (ช่อง 💰 ใช้ลิสต์นี้)');
  assert.equal(all.length - org.length, idx.options.filter(o => o.kind === 'cost_center').length);
});

test('ตัวเลือก cost center พก ชื่อ + เจ้าของ ติดตัวมา (ช่อง 💰 โชว์ `รหัส · ชื่อ` และบอกว่าเป็นของใคร)', () => {
  const o = idx.options.find(x => x.key === 'cost_center:2140462000');
  assert.equal(o.cc_name, 'PD3');
  assert.deepEqual(o.owners, [{ kind: 'section', value: 'PD3' }]);
  const orphan = idx.options.find(x => x.key === 'cost_center:2140662101');
  assert.equal(orphan.cc_name, '', 'ไม่มีในทะเบียน = ชื่อว่าง ไม่ใช่ undefined');
});
