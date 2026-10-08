/* ══ vite plugin: virtual:schema-usage — "หน้าไหนแตะตารางไหน" สแกนสดตอน build ═════════
   (2026-09-22 · ใช้โดยหน้า /schema เท่านั้น — `src/pages/SchemaMap.jsx`)

   ทำไมเป็น virtual module ไม่ใช่ไฟล์ .json ที่ commit:
     ไฟล์ generate ที่ commit ไว้ = snapshot ที่ต้องมีคนจำมารันใหม่ → ล้าสมัยแน่นอน
     (บทเรียน docs/sql/00_schema_snapshot_*.sql) · แบบนี้ทุก build = ข้อมูลตรงกับโค้ด ณ วันนั้นเสมอ
     และไม่มีไฟล์ generate โผล่ใน git diff ให้รีวิวสับสน

   logic การสแกนอยู่ที่ `src/utils/schemaUsageScan.js` (pure + มีเทส) — ที่นี่แค่ป้อนไฟล์เข้าไป

   ⚠️ ต้องใส่ plugin นี้ทั้งใน `vite.config.js` และ `audit/vite.audit.mjs`
      (ไม่งั้น crashsweep/mobilesweep เปิดหน้า /schema ไม่ได้ = จอพังโดยไม่มีใครเห็น)
   ⚠️ ตอน dev: แก้ซอร์สแล้วตัวเลขในหน้านี้ไม่อัพเดททันที ต้อง restart dev server
      (ยอมแลก — จอนี้เป็นจอ reference ไม่ใช่จอทำงานรายวัน)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { walkTables, parseAppRoutes } from '../src/utils/schemaUsageScan.js';

const VIRTUAL_ID = 'virtual:schema-usage';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const EXTS = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx'];

export default function schemaUsagePlugin(rootDir) {
  const root = rootDir || process.cwd();
  const src = path.join(root, 'src');
  const cache = new Map();   // path → code | null (อ่านไฟล์เดิมซ้ำหลายรอบระหว่างเดินกราฟ)

  const read = (p) => {
    if (cache.has(p)) return cache.get(p);
    let code = null;
    try { if (fs.statSync(p).isFile()) code = fs.readFileSync(p, 'utf8'); } catch { code = null; }
    cache.set(p, code);
    return code;
  };
  const resolveSpec = (fromFile, spec) => {
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const ext of EXTS) {
      const cand = base + ext;
      if (read(cand) != null) return cand;
    }
    return null;
  };
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');

  const build = () => {
    cache.clear();
    const appFile = path.join(src, 'App.jsx');
    // 🔴 กัน App.jsx / main.jsx ออกจากกราฟ — App คือ router ที่ import ทุกหน้า
    //    (และทุกหน้า import UserContext กลับมาจาก App) ปล่อยไว้ = ทุกหน้าได้ตารางชุดเดียวกันหมด
    const skip = (f) => f === appFile || f === path.join(src, 'main.jsx');
    const appCode = read(appFile);
    const { routes, nav } = parseAppRoutes(appCode || '');
    const pages = routes.map(r => {
      const file = resolveSpec(appFile, r.file);
      const hit = file ? walkTables(file, { getFile: read, resolveSpec, skip }) : { main: [], dr: [], unknown: [], rpc: [], files: [] };
      const meta = nav[r.path] || {};
      return {
        path: r.path, comp: r.comp, file: file ? rel(file) : null,
        icon: meta.icon || '', label: meta.label || '',
        main: hit.main, dr: hit.dr, unknown: hit.unknown, rpc: hit.rpc,
        files: (hit.files || []).map(rel),
      };
    }).sort((a, b) => a.path.localeCompare(b.path));
    return { builtAt: new Date().toISOString(), pages };
  };

  return {
    name: 'esm-schema-usage',
    resolveId(id) { return id === VIRTUAL_ID ? RESOLVED_ID : null; },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export default ${JSON.stringify(build())};`;
    },
  };
}
