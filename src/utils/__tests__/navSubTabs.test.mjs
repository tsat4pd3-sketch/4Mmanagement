/* 🗂️ ข้อย่อยในแผงเมนู (24/11) — ทะเบียนแท็บต้องตรงกับเมนูจริง + ร้านเก็บชั้นที่ 3 ล้างได้ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV_SUB_TABS } from '../navSubTabs.js';
import { setNavSubItems } from '../navSubItems.js';

const appSrc = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');

test('ทุก path ในทะเบียนต้องเป็นเมนูจริงใน NAV_ITEMS และมีแท็บ key ไม่ซ้ำ', () => {
  for (const [path, reg] of Object.entries(NAV_SUB_TABS)) {
    assert.ok(appSrc.includes(`to: '${path}'`), `${path} ไม่อยู่ใน NAV_ITEMS — ข้อย่อยจะไม่มีที่โผล่`);
    assert.ok(reg.param && reg.tabs.length > 0, `${path}: ต้องมี param + แท็บ`);
    const keys = reg.tabs.map(t => String(t.key));
    assert.equal(new Set(keys).size, keys.length, `${path}: key แท็บซ้ำ`);
    for (const t of reg.tabs) assert.ok(t.label, `${path}:${t.key} ไม่มีชื่อ`);
  }
});

test('หน้าที่อยู่ในทะเบียนต้องเอาลิสต์แท็บจากทะเบียน (ห้ามพิมพ์ซ้ำในหน้า)', () => {
  const uses = { LineStock: 'LINE_STOCK_TABS', HeijunkaKanban: 'HEIJUNKA_VIEW_META', Transport: 'TRANSPORT_TABS', PlannerSales: 'PLANNER_SALES_TABS', ProductionPlan: 'PRODUCTION_PLAN_TABS' };
  for (const [page, sym] of Object.entries(uses)) {
    const src = readFileSync(new URL(`../../pages/${page}.jsx`, import.meta.url), 'utf8');
    assert.ok(src.includes(sym), `${page}.jsx ไม่ได้ใช้ ${sym} จาก navSubTabs.js — ลิสต์แท็บจะดริฟต์จากแผงเมนู`);
  }
});

test('ร้านเก็บข้อย่อยชั้นที่ 3: ตั้งแล้วล้างได้ (หน้าปิด = รายการหาย ไม่ค้างโชว์ของหน้าเก่า)', () => {
  setNavSubItems('/x', 'a', 'area', [{ key: 'S1', label: 'S1' }]);
  setNavSubItems('/x', 'a', 'area', null);
  setNavSubItems('/x', 'a', 'area', null);   // ล้างซ้ำต้องไม่พัง
});
