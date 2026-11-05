/* ✒️ ด่าน nav-icons-mapped (2026-11-05 · UI-CONVENTIONS §6.36)
   emoji ทุกตัวในทะเบียนเมนู (NAV_ITEMS / NAV_GROUP_META / เมนูโปรไฟล์ / แถบล่างมือถือ) และ `icon=` ของ <PageHeader>
   ต้องมีไอคอนเส้นใน ICON_MAP (components/Icon.jsx) — ไม่มี = จอวาด emoji ปนไอคอนเส้น (ไม่พัง แต่กลับไปหน้าตาเดิม) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.jsx')).map(f => `${dir}/${f}`);

const mapKeys = new Set([...read('src/components/Icon.jsx').matchAll(/'([^']+)': [A-Z]\w+/g)].map(m => m[1]));

test('✒️ emoji ในทะเบียนเมนู/หัวเพจทุกตัวต้องมีไอคอนเส้นใน ICON_MAP', () => {
  const miss = [];
  const reg = (file, re) => {
    for (const m of read(file).matchAll(re)) {
      const g = (m[1] || m[2] || '').trim();
      if (g && !mapKeys.has(g)) miss.push(`${file}: ${g}`);
    }
  };
  for (const f of ['src/App.jsx', 'src/utils/profileMenu.js', 'src/components/MobileNavBar.jsx']) reg(f, /\bicon:\s*'([^']+)'/g);
  for (const f of [...walk('src/pages'), ...walk('src/components')]) {
    for (const ph of read(f).matchAll(/<PageHeader\b([^>]*?)(?:\/>|>)/gs)) {
      const i = /\bicon=(?:"([^"]+)"|'([^']+)')/.exec(ph[1]);
      const g = i ? (i[1] || i[2]).trim() : '';
      if (g && !mapKeys.has(g)) miss.push(`${f}: ${g}`);
    }
  }
  assert.deepEqual([...new Set(miss)], [], '\n\n❌ emoji ที่ยังไม่มีไอคอนเส้น — เติมใน ICON_MAP (src/components/Icon.jsx)\n');
});
