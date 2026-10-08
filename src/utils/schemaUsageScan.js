/* ══ 🗄️ schemaUsageScan — "หน้าไหนแตะตารางไหน" อ่านจากซอร์สจริงตอน build ══════════════
   (2026-09-22 · คู่กับหน้า /schema `src/pages/SchemaMap.jsx`)

   โจทย์: ทีมงานเจอบัคแล้วแจ้งว่า "หน้านี้เพี้ยน" — คนแก้ต้องมานั่งไล่เองว่าหน้านั้นอ่าน/เขียน
   ตารางไหนบ้าง · ถ้าเขียนรายชื่อไว้ในเอกสารมือ มันล้าสมัยใน 2 สัปดาห์ (บทเรียนเดียวกับ
   docs/sql/00_schema_snapshot_*.sql ที่ dump ครั้งเดียวเมื่อ 2026-07-10 แล้วไม่เคยตามอีกเลย)

   ⇒ ไม่เขียนมือ · ไม่ commit ไฟล์ generate · **สแกนซอร์สตอน build ทุกครั้ง**
     (`scripts/vite-plugin-schema-usage.mjs` → virtual module `virtual:schema-usage`)
     ไฟล์นี้เก็บเฉพาะ logic บริสุทธิ์ (ไม่แตะ fs) เพื่อให้มีเทสครอบ — ตัว plugin แค่ป้อนไฟล์เข้ามา

   ขอบเขตที่ตั้งใจ (เขียนไว้กันคนถัดไปเข้าใจผิดว่า "สแกนไม่ครบ = บั๊ก"):
   • จับเฉพาะ `supabase.from('ตาราง')` / `supabaseDR.from('ตาราง')` ที่เป็น **ชื่อตรงๆ ในโค้ด**
     — ทั้งระบบเขียนแบบนี้ 1,907 จุด เหลือ client กลางแบบตัวแปร (`client.from(...)`) แค่ 1 จุด
       ซึ่งถูกจัดเป็น "ไม่ทราบฝั่ง" แล้วไปเทียบกับทะเบียนตารางจริงบนจอเอา
   • `storage.from('bucket')` **ไม่ใช่ตาราง** — ตัวกรองรับเฉพาะชื่อ client ที่ whitelist ไว้
   ═══════════════════════════════════════════════════════════════════════════════════════ */

// ชื่อตัวแปร client → ฝั่งฐานข้อมูล (ดู CLAUDE.md "Supabase Projects" — 2 project คนละ DB)
const CLIENTS = { supabase: 'main', supabaseDR: 'dr' };
// client ที่ส่งเข้ามาเป็น prop/พารามิเตอร์ (component กลางใช้ได้ทั้ง 2 ฝั่ง) → ไม่ฟันธงฝั่ง
const GENERIC = new Set(['client', 'db', 'sb']);

const FROM_RE = /([A-Za-z_$][\w$]*)\s*\.\s*from\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;
const RPC_RE = /([A-Za-z_$][\w$]*)\s*\.\s*rpc\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;
// import/export ... from './x'  ·  import('./x')  — เอาเฉพาะ path ญาติ (ไฟล์ในโปรเจค)
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;

const emptyHit = () => ({ main: [], dr: [], unknown: [], rpc: [] });

/* ตัดคอมเมนต์ทิ้งก่อนสแกน — โปรเจคนี้คอมเมนต์ยาวและมักยกตัวอย่างโค้ดจริง
   (เช่น `checkWrite(await supabase.from('t')...)` ใน utils/dbWrite.js -> เคยได้ตาราง "t" ติดมา)
   ตัดแบบระวัง: คอมเมนต์บล็อกทั้งก้อน + บรรทัดที่ "ขึ้นต้น" ด้วย // หรือ *
   (ไม่ไล่ตัด // กลางบรรทัด เพราะจะไปโดน https:// ในสตริง) */
export function stripComments(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}

/** สแกนไฟล์เดียว → ตาราง/RPC ที่ไฟล์นั้นแตะ + รายการ import ญาติ */
export function scanCode(code) {
  const out = { main: new Set(), dr: new Set(), unknown: new Set(), rpc: new Set(), imports: [] };
  if (typeof code !== 'string' || !code) return finishScan(out);
  code = stripComments(code);

  for (const m of code.matchAll(FROM_RE)) {
    const side = CLIENTS[m[1]];
    if (side) out[side].add(m[2]);
    else if (GENERIC.has(m[1])) out.unknown.add(m[2]);
  }
  for (const m of code.matchAll(RPC_RE)) {
    if (CLIENTS[m[1]] || GENERIC.has(m[1])) out.rpc.add(m[2]);
  }
  for (const m of code.matchAll(IMPORT_RE)) out.imports.push(m[1]);
  return finishScan(out);
}

function finishScan(o) {
  return {
    main: [...o.main].sort(), dr: [...o.dr].sort(),
    unknown: [...o.unknown].sort(), rpc: [...o.rpc].sort(),
    imports: o.imports,
  };
}

/** รวมผลหลายไฟล์เป็นก้อนเดียว (ไม่ซ้ำ + เรียง) */
export function mergeHits(list) {
  const acc = { main: new Set(), dr: new Set(), unknown: new Set(), rpc: new Set() };
  for (const h of list) for (const k of Object.keys(acc)) (h?.[k] || []).forEach(v => acc[k].add(v));
  return { main: [...acc.main].sort(), dr: [...acc.dr].sort(), unknown: [...acc.unknown].sort(), rpc: [...acc.rpc].sort() };
}

/* เดินตาม import จากไฟล์หน้า → component/util ที่มันเรียกใช้ แล้วรวมตารางทั้งสาย
   (หน้าส่วนใหญ่ยิง DB ผ่าน component ลูก เช่น AuditLogViewer / EventComments —
    ถ้าดูแค่ไฟล์หน้าเดียวจะได้รายชื่อตารางไม่ครบจนใช้ตอบไม่ได้)
   • กันวนลูปด้วย seen · จำกัดความลึกกัน import graph ที่ลึกผิดปกติ
   • getFile / resolveSpec ถูกฉีดเข้ามา → ไฟล์นี้ไม่แตะ fs (เทสได้) */
export function walkTables(entry, { getFile, resolveSpec, maxDepth = 8, skip } = {}) {
  if (!entry || typeof getFile !== 'function' || typeof resolveSpec !== 'function') return { ...emptyHit(), files: [] };
  const seen = new Set();
  const hits = [];
  const files = [];
  const queue = [[entry, 0]];
  while (queue.length) {
    const [path, depth] = queue.shift();
    if (seen.has(path) || depth > maxDepth) continue;
    seen.add(path);
    // 🔴 skip: ผู้เรียก **ต้อง** กัน src/App.jsx ไว้เสมอ — มันคือ router ที่ import ทุกหน้า
    //    และหน้าเกือบทุกหน้า import { UserContext } from '../App' กลับมา
    //    เดินเข้าไปครั้งเดียว = ทุกหน้าได้รายชื่อตารางเหมือนกันหมดทั้งระบบ = จอนี้ไร้ประโยชน์
    //    (เจอจริงตอนทำ: /daily-report ได้ 112 ตาราง Main ทั้งที่จริงแตะไม่กี่ตัว)
    if (typeof skip === 'function' && skip(path)) continue;
    const code = getFile(path);
    if (code == null) continue;
    const hit = scanCode(code);
    if (hit.main.length || hit.dr.length || hit.unknown.length || hit.rpc.length) files.push(path);
    hits.push(hit);
    for (const spec of hit.imports) {
      const next = resolveSpec(path, spec);
      if (next && !seen.has(next)) queue.push([next, depth + 1]);
    }
  }
  return { ...mergeHits(hits), files };
}

/* ── อ่านโครงเมนู/route จาก src/App.jsx (source of truth เดียวของระบบ) ────────────────
   คืน { comps, routes, nav } — comps: ชื่อ component → path ไฟล์ · routes: path → component
   ⚠️ ผูกกับรูปแบบการเขียนใน App.jsx (lazy import + <Route path element={<RoleRoute…><X/>}>)
      ถ้าวันหนึ่ง App.jsx เปลี่ยนวิธีประกาศ route ให้มาแก้ที่นี่ — มีเทสจับว่า "หารูทไม่เจอเลย" */
export function parseAppRoutes(appCode) {
  const comps = {};
  const routes = [];
  const nav = {};
  if (typeof appCode !== 'string' || !appCode) return { comps, routes, nav };

  for (const m of appCode.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g)) comps[m[1]] = m[2];
  for (const m of appCode.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"](\.\/pages\/[^'"]+)['"]/g)) comps[m[1]] = m[2];

  for (const m of appCode.matchAll(/<Route\s+path=\s*["']([^"']+)["'][\s\S]{0,400}?element=\{([\s\S]*?)\}\s*\/>/g)) {
    const [, path, element] = m;
    const comp = [...element.matchAll(/<([A-Z][\w$]*)/g)].map(x => x[1]).find(name => comps[name]);
    if (comp) routes.push({ path, comp, file: comps[comp] });
  }

  // NAV_ITEMS — เอาแค่ไอคอน/ชื่อเมนูมาแสดงให้อ่านรู้เรื่อง (group เป็นตัวแปรบ้าง ไม่ต้องใช้)
  for (const line of appCode.split('\n')) {
    const to = line.match(/\{\s*to:\s*['"]([^'"]+)['"]/);
    if (!to) continue;
    const icon = line.match(/icon:\s*['"]([^'"]*)['"]/);
    const label = line.match(/label:\s*['"]([^'"]+)['"]/);
    if (label) nav[to[1]] = { icon: icon ? icon[1] : '', label: label[1] };
  }
  return { comps, routes, nav };
}

export default { scanCode, mergeHits, walkTables, parseAppRoutes };
