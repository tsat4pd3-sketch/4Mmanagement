/* 🎨 นับสีดิบ (hex/rgba) ต่อไฟล์ใน src/pages + src/components → fixture ของด่าน "สีดิบห้ามเพิ่ม" (ratchet)
   รัน: node scripts/color-baseline.mjs   (หลังไล่สีหน้าหนึ่งเสร็จ ให้รันเพื่อ "ล็อกค่าใหม่ที่ต่ำลง")
   🔴 ห้ามรันเพื่อให้ด่านผ่านหลังเพิ่มสีดิบ — ด่านมีไว้ให้ตัวเลขลงอย่างเดียว (UI-CONVENTIONS §6.17 · 04/11) */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT = new URL('../', import.meta.url).pathname;
export const COLOR_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g;
/* ขาว/ดำล้วนไม่ใช่ "สี" (เป็นหมึกบนปุ่มสี) — ไม่นับ */
const NEUTRAL = new Set(['#fff', '#ffffff', '#000', '#000000']);
export function countColors(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
  return (noComments.match(COLOR_RE) || []).filter(c => !NEUTRAL.has(c.toLowerCase())).length;
}
export function scan() {
  const out = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(f)) {
    const n = countColors(readFileSync(p, 'utf8')); if (n) out[relative(ROOT, p)] = n; } } };
  walk(join(ROOT, 'src/pages')); walk(join(ROOT, 'src/components'));
  return Object.fromEntries(Object.entries(out).sort());
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = scan();
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  writeFileSync(join(ROOT, 'src/utils/__tests__/fixtures/colorBaseline.json'), JSON.stringify({ _meta: { generatedAt: new Date().toISOString().slice(0, 10), files: Object.keys(data).length, total }, files: data }, null, 2) + '\n');
  console.log(`✓ colorBaseline.json — ${Object.keys(data).length} ไฟล์ · สีดิบรวม ${total} จุด`);
}
