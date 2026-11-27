import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companyOfEmployeeCode, groupBySpg } from '../companyCode.js';

const ROWS = [
  { code: 'TSA',  spg_no: '1000', spg_name: 'Holding', sap_code: '1100', com_code: '110', is_active: true },
  { code: 'TSAT', spg_no: '2000', spg_name: 'AMF',     sap_code: '2100', com_code: '210', is_active: true },
  { code: 'ITSA', spg_no: '2000', spg_name: 'AMF',     sap_b1_code: '600', com_code: '600', is_active: true },
  { code: 'OLD',  spg_no: '9000', spg_name: 'Other',   sap_code: '9900', com_code: '990', is_active: false },
];

test('companyOfEmployeeCode: 7 หลัก → บริษัทจาก Com Code 3 หลักแรก (template: 1100161 = TSA 110 + 0161)', () => {
  assert.equal(companyOfEmployeeCode('1100161', ROWS)?.code, 'TSA');
  assert.equal(companyOfEmployeeCode('2101990', ROWS)?.code, 'TSAT');
  assert.equal(companyOfEmployeeCode(' 2101990 ', ROWS)?.code, 'TSAT', 'ตัดช่องว่าง');
  assert.equal(companyOfEmployeeCode('6000012', ROWS)?.code, 'ITSA', 'บริษัท SAP B1 ใช้รหัส B1 เป็น Com Code');
});

test('companyOfEmployeeCode: ผู้รับเหมา/รูปแบบอื่น/บริษัทปิดใช้ = null ห้ามเดา', () => {
  assert.equal(companyOfEmployeeCode('STM0560', ROWS), null, 'ผู้รับเหมาไม่อยู่ใน template');
  assert.equal(companyOfEmployeeCode('210199', ROWS), null, '6 หลัก');
  assert.equal(companyOfEmployeeCode('9900001', ROWS), null, 'บริษัทปิดใช้งาน');
  assert.equal(companyOfEmployeeCode('', ROWS), null);
  assert.equal(companyOfEmployeeCode(null, ROWS), null);
  assert.equal(companyOfEmployeeCode('2101990', []), null, 'ทะเบียนว่าง = ไม่รู้');
});

test('groupBySpg: จัดกลุ่มตามเลข SPG เรียงตามเลข', () => {
  const g = groupBySpg(ROWS);
  assert.deepEqual(g.map(x => x.spg_no), ['1000', '2000', '9000']);
  assert.deepEqual(g[1].companies.map(c => c.code), ['TSAT', 'ITSA']);
});

test('migration seed: 26 บริษัทตาม template · TSAT = 2100/210 · ทุกแถวมี SAP หรือ SAP B1', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261125_companies_registry_main.sql', import.meta.url), 'utf8');
  const rows = [...sql.matchAll(/\(\s*'([A-Z0-9]+)',\s*'(\d{4})',\s*'[^']+',\s*(null|'\d{4}'),\s*(null|'\d{3}'),\s*'(\d{3})'/g)];
  assert.equal(rows.length, 26, 'จำนวนแถว seed ต้อง 26 ตาม template');
  const tsat = rows.find(r => r[1] === 'TSAT');
  assert.equal(tsat[3], "'2100'"); assert.equal(tsat[5], '210');
  for (const r of rows) assert.ok(r[3] !== 'null' || r[4] !== 'null', `${r[1]} ต้องมี SAP หรือ SAP B1`);
  const codes = rows.map(r => r[1]);
  assert.equal(new Set(codes).size, codes.length, 'รหัสย่อห้ามซ้ำ');
});
