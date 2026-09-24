/* 🗺️ แผนที่สิทธิ์ทั้งระบบ — route × permission key × role hardcode      2026-09-23
 *
 * ตอบ 4 คำถามที่ตอบไม่ได้มาก่อน (เริ่มงาน "ตบเรื่องสิทธิ์" ตามคำสั่ง user 23/09):
 *   1. route ไหน **ไม่ได้** ห่อ RoleRoute = พิมพ์ URL ตรงเข้าได้ทั้งที่เมนูไม่โผล่
 *   2. route ไหนไม่มีใน NAV_ITEMS = หน้าที่เข้าถึงได้แต่ไม่มีใครเห็นว่ามีอยู่
 *   3. คีย์ `can('x')` ที่ใช้ในโค้ด — เทียบกับทะเบียน role_permissions (คีย์ที่ไม่มีในทะเบียน = ปุ่มตายถาวร)
 *   4. จุดที่ยัง hardcode `role === 'x'` = สิทธิ์ที่ /permissions ปรับไม่ได้ (นอกเหนือการควบคุม)
 *
 * รัน: node audit/permmap.mjs            (ตาราง + สรุป)
 *      node audit/permmap.mjs --keys     (คีย์ในโค้ดอย่างเดียว บรรทัดละคีย์ — เอาไปเทียบ DB)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const APP   = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');

/* ── 1) routes ─────────────────────────────────────────────────────────── */
const routes = [...APP.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)(?=<Route\s|<\/Routes>)/g)]
  .map(m => ({ path: m[1], guarded: /<RoleRoute\b/.test(m[2]), redirect: /<Navigate\b/.test(m[2]) }))
  /* `<Navigate to="/hub?tab=x">` = ทางลัดไปหน้ารวม — ด่านอยู่ที่หน้าปลายทาง ไม่ใช่ที่นี่
     (เคยอ่านผิดว่า 9 หน้านี้ไม่มีด่าน — ที่จริงเป็น redirect ทั้งหมด) */
  .filter(r => r.path !== '*' && r.path !== '/login' && !r.redirect);

const navPaths = new Set([...APP.matchAll(/to:\s*'([^']+)'/g)].map(m => m[1]));

/* ── 2) เดินไฟล์ src เก็บ can() + role hardcode ─────────────────────────── */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '__tests__', 'dist'].includes(e) || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(e)) out.push(full);
  }
  return out;
}

const keyUse = new Map();      // key -> Set<file>
const hardcoded = [];          // {file, line, text}
/* `role === 'x'` / `role !== 'x'` / `['admin','manager'].includes(role)` — สิทธิ์ที่ปรับจากจอไม่ได้ */
const ROLE_CMP = /\b(?:real)?[Rr]ole\s*[=!]==\s*'([a-z_]+)'|\[\s*'(?:admin|manager|supervisor|leader)'[^\]]*\]\s*\.includes\(\s*(?:real)?[Rr]ole/;

for (const file of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  /* ⚠️ ลายเซ็นจริงคือ can(resource, action, role) — คีย์ในทะเบียนคือ `resource:action`
     (เคยดึงมาแค่ argument แรก แล้วได้คีย์ปลอม เช่น 'am' 'approve' ลอยๆ) */
  for (const m of src.matchAll(/\bcan\(\s*'([a-z0-9_.-]+)'\s*,\s*'([a-z0-9_.-]+)'/g)) {
    const k = `${m[1]}:${m[2]}`;
    if (!keyUse.has(k)) keyUse.set(k, new Set());
    keyUse.get(k).add(rel);
  }
  // permissions.js เองคือที่นิยาม admin-override — ไม่นับเป็น hardcode ที่ต้องล้าง
  if (rel === 'src/utils/permissions.js') continue;
  src.split('\n').forEach((ln, i) => {
    if (ROLE_CMP.test(ln)) hardcoded.push({ file: rel, line: i + 1, text: ln.trim().slice(0, 96) });
  });
}

if (process.argv.includes('--keys')) {
  console.log([...keyUse.keys()].sort().join('\n'));
  process.exit(0);
}

/* ── รายงาน ────────────────────────────────────────────────────────────── */
const ungated = routes.filter(r => !r.guarded);
const orphanRoutes = routes.filter(r => r.guarded && !navPaths.has(r.path));
const byFile = hardcoded.reduce((a, h) => ((a[h.file] = (a[h.file] || 0) + 1), a), {});

console.log(`\n🗺️  แผนที่สิทธิ์  —  ${routes.length} route · ${keyUse.size} คีย์ can() · ${hardcoded.length} จุด hardcode role\n`);

console.log(`── 1) หน้าจริงที่ไม่ได้ห่อ RoleRoute (${ungated.length}) ` + '─'.repeat(28));
console.log(ungated.length ? ungated.map(r => `   ⚠️  ${r.path}`).join('\n')
                           : '   ✅ ทุก route ผ่าน canAccessPage');

console.log(`\n── 2) route ที่ไม่มีในเมนู NAV_ITEMS (${orphanRoutes.length}) ` + '─'.repeat(22));
console.log(orphanRoutes.length ? orphanRoutes.map(r => `   • ${r.path}`).join('\n') : '   ✅ ตรงกันหมด');

console.log(`\n── 3) hardcode role มากสุด 15 ไฟล์ ` + '─'.repeat(30));
Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([f, n]) => console.log(`   ${String(n).padStart(3)}  ${f}`));

console.log(`\n── 4) คีย์ can() ที่ใช้ในโค้ด (${keyUse.size}) ` + '─'.repeat(28));
console.log([...keyUse.entries()].sort()
  .map(([k, files]) => `   ${k.padEnd(34)} ${files.size} ไฟล์`).join('\n'));
console.log();
