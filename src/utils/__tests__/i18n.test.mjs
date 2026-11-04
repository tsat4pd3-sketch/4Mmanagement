/* ══ 🛡️ ด่านชั้นภาษา ไทย/English (2026-11-02) ════════════════════════════════════════════
   1. `tr()` ทำงานตามสัญญา: ไทย = ค่าเดิมเป๊ะ · อังกฤษ = แปล + คง emoji นำหน้า · ไม่มีคำ = คืนไทย + จด missing
   2. "โครงหลัก" ต้องมีคำแปลครบ — เมนู (NAV_ITEMS.label) · หมวด (NAV_GROUP_ORDER) · ชื่อย่อ rail ·
      ป้ายกรอง ALL · ช่วงเวลา (timeRange) · ชื่อหน้าแบบสตริงคงที่ใน <PageHeader title="…">
      เพิ่มเมนู/หน้าใหม่แล้วไม่เติม src/i18n/en.js = เทสนี้ตก (ไม่ใช่ให้ถอดเทส — ให้เติมคำ)
   อ่าน App.jsx เป็นข้อความ (ไม่ import JSX ใน node) แบบเดียวกับ regressionGuards */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import EN from '../../i18n/en.js';
import { tr, setLang, getLang, trMissing, trMissingReset, allLabel } from '../i18n.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const app = read('src/App.jsx');

test('tr(): ไทยคืนค่าเดิมเป๊ะ · ไม่ใช่สตริงส่งผ่าน', () => {
  setLang('th');
  assert.equal(tr('📋 รายการ MO'), '📋 รายการ MO');
  assert.equal(tr(null), null);
  assert.equal(tr(42), 42);
  assert.equal(getLang(), 'th');
});

test('tr(): อังกฤษแปลตามพจนานุกรม · คง emoji นำหน้า/ตามหลัง · ไม่มีคำ = คืนไทย + จดลง trMissing', () => {
  setLang('en');
  trMissingReset();
  assert.equal(tr('ภาพรวม'), 'Overview');
  assert.equal(tr('🏠 หน้าหลัก'), '🏠 Home');
  assert.equal(tr('⚡ Live กะนี้'), '⚡ Live — This Shift');
  assert.equal(tr('OEE'), 'OEE', 'ไม่มีอักษรไทย = ไม่แปล ไม่นับขาด');
  assert.equal(tr('คำที่ไม่มีในพจนานุกรมแน่ๆ 12345'), 'คำที่ไม่มีในพจนานุกรมแน่ๆ 12345');
  assert.deepEqual(trMissing(), ['คำที่ไม่มีในพจนานุกรมแน่ๆ 12345']);
  assert.equal(allLabel('ไลน์'), 'All lines');
  setLang('th');
  assert.equal(allLabel('ไลน์'), 'ทุกไลน์');
});

test('setLang(): ค่าที่ไม่รู้จักไม่เปลี่ยนภาษา', () => {
  setLang('th');
  assert.equal(setLang('fr'), 'th');
});

function strip(s) {
  // ตัด emoji/สัญลักษณ์นำหน้า-ตามหลังแบบเดียวกับ tr()
  return s.replace(/^(?:[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]|\s)+/u, '')
    .replace(/(?:\s|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}])+$/u, '');
}
const hasThai = (s) => /[฀-๿]/.test(s);
const needs = (list, where) => {
  const miss = [...new Set(list.map(strip).filter(hasThai).filter(k => !EN[k]))];
  assert.deepEqual(miss, [], `\n\n❌ ${where} ยังไม่มีคำแปลอังกฤษ ${miss.length} คำ — เติมใน src/i18n/en.js:\n`
    + miss.map(m => `  '${m}': '',`).join('\n') + '\n');
};

test('🛡️ เมนูทุกตัว (NAV_ITEMS.label) มีคำแปล', () => {
  const seg = app.slice(app.indexOf('export const NAV_ITEMS'), app.indexOf('export const NAV_GROUP_ORDER'));
  const labels = [...seg.matchAll(/\blabel:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(labels.length > 40, 'อ่าน NAV_ITEMS ไม่ออก');
  needs(labels, 'เมนู (NAV_ITEMS.label)');
});

test('🛡️ หมวดเมนู + ชื่อย่อ rail มีคำแปล', () => {
  const order = app.match(/export const NAV_GROUP_ORDER = \[([^\]]+)\]/)[1];
  const groups = [...order.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const metaSeg = app.slice(app.indexOf('export const NAV_GROUP_META'), app.indexOf('export function navItemsForGroups'));
  const shorts = [...metaSeg.matchAll(/short:\s*'([^']+)'/g)].map(m => m[1]);
  const logistic = read('src/utils/logisticSide.js');
  const lg = [...logistic.matchAll(/(?:inbound|outbound):\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(groups.length >= 9 && shorts.length >= 9 && lg.length === 2);
  needs([...groups, ...shorts, ...lg], 'หมวดเมนู / ชื่อย่อ rail');
});

test('🛡️ ป้ายกรอง ALL/PICK/NONE + ช่วงเวลา (timeRange) มีคำแปล', () => {
  const fl = read('src/utils/filterLabels.js');
  const all = [...fl.slice(fl.indexOf('const ALL_TH'), fl.indexOf('export const ALL')).matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
  const trg = read('src/utils/timeRange.js');
  const tl = [...trg.matchAll(/\b(?:label|short):\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(all.length >= 15 && tl.length >= 10);
  needs([...all, '— เลือก —', '— ไม่ระบุ —', ...tl], 'ป้ายกรอง/ช่วงเวลา');
});

test('🛡️ ชื่อหน้าแบบสตริงคงที่ใน <PageHeader title="…"> มีคำแปล', () => {
  const dir = join(ROOT, 'src/pages');
  const titles = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsx')) continue;
    const code = readFileSync(join(dir, f), 'utf8');
    for (const m of code.matchAll(/<PageHeader\b([^>]*?)(?:\/>|>)/gs)) {
      const t = m[1].match(/\btitle=(?:"([^"]+)"|'([^']+)'|\{\s*'([^']+)'\s*\})/);
      if (t) titles.push(t[1] || t[2] || t[3]);
    }
  }
  assert.ok(titles.length > 50, 'อ่าน title ของ PageHeader ไม่ออก');
  needs(titles, 'ชื่อหน้า (PageHeader title)');
});
