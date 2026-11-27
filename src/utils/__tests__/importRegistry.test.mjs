/* 📥 ทะเบียนนำเข้าไฟล์ — "ไฟล์นี้ต้องไปนำเข้าที่ไหน" + ป้ายปุ่มคำเดียวกันทั้งระบบ (2026-11-24 · คำสั่ง user) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMPORTS, IMPORT_KEYS, importLabel, whichImport, rowsFromText } from '../importRegistry.js';
import EN from '../../i18n/en.js';

const one = (rows) => [{ name: 'S1', rows }];

test('ป้ายปุ่ม = "นำเข้า <ชื่อไฟล์>" · ทุกจุดมีคำแปล "Import …" + ข้อมูลหัวหน้าต่างครบ', () => {
  assert.equal(importLabel('store_stock'), 'นำเข้า Stock_Store');
  for (const k of IMPORT_KEYS) {
    const d = IMPORTS[k];
    for (const f of ['name', 'file', 'from', 'cols', 'where', 'to']) assert.ok(d[f], `${k}.${f} ว่าง`);
    const en = EN[importLabel(k)];
    assert.ok(en, `ไม่มีคำแปล "${importLabel(k)}" ใน en.js`);
    assert.match(en, /^Import /, `คำแปล ${k} ต้องขึ้นต้นด้วย Import`);
    for (const f of ['from', 'cols', 'where', 'file']) if (/[\u0E00-\u0E7F]/.test(d[f])) assert.ok(EN[d[f]], `ไม่มีคำแปล ${k}.${f}: "${d[f]}"`);
  }
});

test('แยกชนิดไฟล์จากหัวคอลัมน์ — ทุกแบบที่มีหัวบอกชัด', () => {
  assert.equal(whichImport(one([[], ['Item', " Mat'l SAP", 'Part Name', 'Picture', 'STD/PC', 'MAX', 'MIN']])), 'store_stock');
  assert.equal(whichImport(one([['20.11.2026 Dynamic List Display'], [], ['', 'Plnt', 'SLoc', 'Material', 'Material Description', '   Unrestr.', 'BUn']])), 'sap_mb52');
  assert.equal(whichImport(one([['SMART Supplier - Part Usage Report'], [], ['Detailed SMART']])), 'esmart');
  assert.equal(whichImport(one([['Part Num', 'Forecast Net Qty', 'Forecast Date', 'Forecast Time', 'Dock Code']])), 'edi');
  assert.equal(whichImport(one([['', 'Plnt', 'SPT', 'Item', 'Level', '', 'Obj', 'Object description', 'Quantity', 'Un']])), 'sap_bom');
  assert.equal(whichImport(one([['name', 'mat_no', 'cycle_time_sec', 'line']])), 'product_csv');
  assert.equal(whichImport(one([['mat_no', 'part_name', 'part_no', 'uom', 'qty_per_pkg']])), 'parts_csv');
  assert.equal(whichImport(one([['รหัส', 'ชื่ออะไหล่', 'หน่วย', 'ทีม', 'MAT SAP', 'Part no.', 'ผู้ขาย']])), 'spare');
});

test('ไม่มั่นใจ = null (ห้ามเดา) · ไม่ตอบชื่อจุดที่กำลังนำเข้าเอง', () => {
  assert.equal(whichImport(one([['ชื่อ', 'จำนวน'], ['a', 1]])), null);
  assert.equal(whichImport([]), null);
  assert.equal(whichImport(one([[], ['Item', " Mat'l SAP", 'Part Name', 'STD/PC', 'MAX', 'MIN']]), 'store_stock'), null);
  assert.equal(whichImport([{ name: 'x', rows: null }]), null);
});

test('ไฟล์ข้อความ (CSV/tab) ใช้ตัวตรวจชุดเดียวกัน', () => {
  const rows = rowsFromText('﻿mat_no,part_name,qty_per_pkg\n"123",A,10');
  assert.deepEqual(rows[0], ['mat_no', 'part_name', 'qty_per_pkg']);
  assert.equal(whichImport([{ name: 'csv', rows }]), 'parts_csv');
  assert.equal(whichImport([{ name: 'tsv', rows: rowsFromText('Material\tSLoc\tUnrestricted\n1\tA\t2') }]), 'sap_mb52');
});

test('ด่าน: ปุ่ม/ป้ายนำเข้าไฟล์ข้อมูลเก่าห้ามกลับมา (ต้องผ่าน <ImportButton>)', () => {
  const OLD = {
    'src/pages/Monitoring.jsx': ['อัพโหลดไฟล์สโตร์', "tr('นำเข้าจากไฟล์ Excel')"],
    'src/components/SapStockCompare.jsx': ["tr('อัปโหลด MB52')"],
    'src/pages/CustomerDemand.jsx': ["tr('อัพโหลด e-SMART')"],
    'src/pages/ProductMaster.jsx': ["tr('นำเข้า CSV')", "tr('นำเข้า BOM จาก SAP')"],
    'src/components/SparePartMaster.jsx': ["tr('นำเข้า/อัพเดท')"],
    'src/pages/PEDocs.jsx': ["tr('นำเข้า Excel')"],
    'src/components/KpiBaseInputsPanel.jsx': ["tr('นำเข้าจาก Excel บัญชี')"],
  };
  for (const [f, bad] of Object.entries(OLD)) {
    const src = readFileSync(f, 'utf8');
    for (const b of bad) assert.ok(!src.includes(b), `${f} ยังมีป้ายเก่า ${b} — ใช้ <ImportButton k=…>`);
    assert.ok(src.includes('<ImportButton'), `${f} ต้องวาดปุ่มนำเข้าผ่าน <ImportButton>`);
  }
});

test('ด่าน import-button-standard: ช่องเลือกไฟล์ข้อมูล (xlsx/xls/csv) ทุกจุดต้องผ่าน ImportKit', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d) => readdirSync(d).flatMap(n => {
    const p = `${d}/${n}`;
    if (n === '__tests__' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : (/\.jsx$/.test(n) ? [p] : []);
  });
  const bad = walk('src').filter(f => {
    const src = readFileSync(f, 'utf8');
    return /accept="[^"]*\.(xlsx|xls|csv)/.test(src) && !src.includes('ImportKit');
  });
  assert.deepEqual(bad, [], `จุดนำเข้าไฟล์ข้อมูลใหม่ต้องเพิ่มแถวใน importRegistry + ใช้ <ImportButton>/<ImportInfo> (UI §6.44): ${bad.join(', ')}`);
});

test('ตัวอ่านหลวม (อะไหล่): ไฟล์จุดอื่นถูกจับก่อนแกะ · ไฟล์อะไหล่จริงไม่ถูกส่งไปที่อื่น', async () => {
  const { isImportOf } = await import('../importRegistry.js');
  const { TEMPLATE_HEADERS } = await import('../spareImport.js');
  const store = [{ name: 'R401', rows: [[], ['Item', " Mat'l SAP", 'Part Name', 'Picture', 'STD/PC', 'MAX', 'MIN'], [1, '50027624', 'X', null, 90, 1, 1]] }];
  assert.equal(isImportOf('spare', store), false);
  assert.equal(whichImport(store, 'spare'), 'store_stock');
  const spare = [{ name: 'spare parts', rows: [TEMPLATE_HEADERS, ['SP-001', 'โซลินอยด์วาล์ว', 'ชิ้น', 'MTN', '', 'VQ1000', 'SMC', '', 'A-01-1', 5, 2, 10, 850, 30, 'RB-104', '']] }];
  assert.equal(isImportOf('spare', spare), true);
  assert.equal(whichImport(spare, 'spare'), null);
});
