/**
 * 🔐 ด่าน "คีย์สิทธิ์ที่โค้ดเรียก ต้องมีแถวใน permission_catalog" (2026-11-18)
 *
 * ที่มา (audit หน้า /permissions · คำสั่ง user "เหมือนไม่ได้อัพเดทตาม project"):
 *   หน้า /permissions อ่าน "รายการคีย์ให้ติ๊ก" จาก `permission_catalog` ไม่ใช่จากแถวใน `role_permissions`
 *   ⇒ migration ที่ seed แถว role_permissions แล้วเขียนว่า "role อื่น seed false ให้โผล่ในจอ" (20261014e) **ไม่โผล่**
 *   วัดจริง 18/11: คีย์ที่โค้ดเรียก 125 ตัว · ตกทะเบียน 5 ตัว (monitoring:manage · production_plan:write ·
 *   mtn_repair:spare_master · ppe:manage · org:manage) = ฟีเจอร์ที่ใช้งานจริงแต่ตั้งสิทธิ์จากจอไม่ได้เลย
 *   (role-system.md เคยเตือนเรื่องนี้ตั้งแต่ 06/08 — 8 คีย์หลุดรอบนั้น · หลุดซ้ำอีก 5 ⇒ ต้องเป็นด่าน build)
 *
 * วิธีตรวจ (อ่านซอร์สเป็นข้อความ · ไม่ต่อฐาน):
 *   ① ทะเบียน = ไล่ migration ตามชื่อไฟล์ · `insert into permission_catalog` เพิ่มคู่ (resource, action) ·
 *      `delete from permission_catalog` ถอดคู่ (รองรับ 3 รูป: `(resource, action) in (...)` · `resource = 'x' and action = 'y'`
 *      · `resource in (...)`) — comment ทั้ง `--` และ `/* *\/` ถูกตัดก่อน (บล็อก rollback ในคอมเมนต์ไม่นับ)
 *   ② คีย์ที่โค้ดเรียก = `can('a','b')` · `canSeeded('a','b')` · `hasPermission('a:b')` แบบ literal ใน src/ (ยกเว้น __tests__)
 *      (call แบบ dynamic เช่น `approve_${role}` / `STEP_PERM[step]` ตรวจไม่ได้ — ตรวจมือตาม role-system.md ข้อ 78)
 *   ③ seed `'a:b'` ใน role_permissions ของ migration ก็ต้องมี catalog (ยกเว้นคีย์ที่ปลดระวางแล้ว · ลิสต์ข้างล่างพร้อมเหตุผล)
 *
 * ตก = build ล่ม · ทางแก้: เขียน migration insert `permission_catalog` (group_name ตาม nav_groups · sort ช่วงของหมวด)
 *   ห้ามแก้ด้วยการเติมลิสต์ยกเว้น เว้นแต่คีย์นั้นเลิกใช้จริง (ต้องถอดจากโค้ดด้วย)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const MIG = join(ROOT, 'supabase/migrations');

const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

function walk(dir, exts, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some(e => f.endsWith(e))) out.push(p);
  }
  return out;
}

/* ── ① ทะเบียนจาก migration ─────────────────────────────────────────────── */
export function catalogFromMigrations() {
  const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort();
  const cat = new Map();   // 'res:act' → ไฟล์ที่เพิ่มล่าสุด
  /* รูปที่ใช้ในรีโป: `values ('res','act','label','group',N), (...)` · `select 'res','act','label', <group>, <sort> where not exists`
     (group/sort บางไฟล์เป็น coalesce(subselect) ⇒ จับแค่ 3 ตัวแรกที่เป็น literal เสมอ) · แถว role_permissions/nav_groups
     ไม่เข้ารูปนี้ (คีย์มี ':' · ช่องที่ 2 เป็นตัวเลข) และอ่านเฉพาะ statement ที่ insert ลง permission_catalog อยู่แล้ว */
  const ROW = /(?:\(|\bselect)\s*'([a-z_0-9]+)'\s*,\s*'([a-z_0-9]+)'\s*,\s*'[^']*'\s*,/gi;
  for (const f of files) {
    const sql = stripSql(readFileSync(join(MIG, f), 'utf8'));
    for (const stmt of sql.split(';')) {
      if (!/permission_catalog/.test(stmt)) continue;
      if (/insert\s+into\s+(public\.)?permission_catalog/i.test(stmt)) {
        for (const m of stmt.matchAll(ROW)) cat.set(`${m[1]}:${m[2]}`, f);
      } else if (/delete\s+from\s+(public\.)?permission_catalog/i.test(stmt)) {
        const pairs = stmt.match(/\(\s*resource\s*,\s*action\s*\)\s+in\s*\(([\s\S]*?)\)\s*$/i)
          || stmt.match(/\(\s*resource\s*,\s*action\s*\)\s+in\s*\(([\s\S]*)\)/i);
        if (pairs) {
          for (const m of pairs[1].matchAll(/\(\s*'([a-z_0-9]+)'\s*,\s*'([a-z_0-9]+)'\s*\)/g)) cat.delete(`${m[1]}:${m[2]}`);
          continue;
        }
        const one = stmt.match(/resource\s*=\s*'([a-z_0-9]+)'\s+and\s+action\s*=\s*'([a-z_0-9]+)'/i);
        if (one) { cat.delete(`${one[1]}:${one[2]}`); continue; }
        const byRes = stmt.match(/resource\s+in\s*\(([^)]*)\)/i);
        if (byRes) {
          const res = [...byRes[1].matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]);
          for (const k of [...cat.keys()]) if (res.includes(k.split(':')[0])) cat.delete(k);
        }
      }
    }
  }
  return cat;
}

/* ── ② คีย์ที่โค้ดเรียกแบบ literal ────────────────────────────────────── */
function keysFromSource() {
  const out = new Map();   // key → [file,...]
  const add = (k, f) => { if (!out.has(k)) out.set(k, []); out.get(k).push(relative(ROOT, f)); };
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    if (f.includes('__tests__')) continue;
    const src = stripJs(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\b(?:can|canSeeded)\(\s*'([a-z_0-9]+)'\s*,\s*'([a-z_0-9]+)'/g)) add(`${m[1]}:${m[2]}`, f);
    for (const m of src.matchAll(/\bhasPermission\(\s*'([a-z_0-9]+:[a-z_0-9]+)'/g)) add(m[1], f);
  }
  return out;
}

/* ── ③ seed ใน role_permissions ─────────────────────────────────────────── */
function seededKeysFromMigrations() {
  const out = new Map();
  for (const f of readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()) {
    const sql = stripSql(readFileSync(join(MIG, f), 'utf8'));
    for (const stmt of sql.split(';')) {
      if (!/insert\s+into\s+(public\.)?role_permissions/i.test(stmt)) continue;
      for (const m of stmt.matchAll(/'([a-z_0-9]+:[a-z_0-9]+)'/g)) {
        if (!out.has(m[1])) out.set(m[1], []);
        out.get(m[1]).push(f);
      }
    }
  }
  return out;
}

/* คีย์ที่เคย seed แต่ปลดระวางแล้ว (ไม่มีโค้ดเรียก · ถอดจาก catalog โดยตั้งใจ · แถว role_permissions เก็บไว้เผื่อ rollback)
   — ใส่ได้เฉพาะคีย์ที่ **ไม่มีใน keysFromSource()** (ด่านข้างล่างตรวจซ้ำ) */
const RETIRED_SEEDED = {
  'users:manage':          'ถอดจาก catalog 20260806 — /add-user คุมด้วย page:/add-user + edge function admin-only',
  'mtn_repair:close_cost': 'ยุบเข้า stageOf()/mtnStepPerm — ไม่มี can() เรียกตรง (ช่องเซ็นล็อกด้วยตำแหน่ง)',
  'mtn_repair:mtn_head':   'ยุบเข้า stageOf()/mtnStepPerm — ไม่มี can() เรียกตรง',
  'production_plan:start': 'ถอด 20261001 (plan_lot_start_perm_drop) — แผน = กรอบ ไม่สร้างใบผลิต/ไม่เขียนสถานะ',
  'scope:all_units':       'ยุบเป็นรายคน profiles.all_units (20261113_role_scope_p1 · audit 13/11 "role ≠ ขอบเขต") — โค้ดเลิกอ่านคีย์นี้แล้ว',
  'employees:edit_all_sections': 'ยุบเข้า canWriteUnit()/ใบผ่านรายคน (20261113_role_scope_p1) — โค้ดเลิกอ่านคีย์นี้แล้ว',
};

test('permission-catalog-coverage ① คีย์ที่โค้ด can()/canSeeded()/hasPermission() เรียก ต้องมี permission_catalog ใน migration', () => {
  const cat = catalogFromMigrations();
  assert.ok(cat.size > 100, `อ่าน catalog จาก migration ได้แค่ ${cat.size} คีย์ — regex อ่านรูปแบบ insert ไม่ออก?`);
  const code = keysFromSource();
  const missing = [...code.entries()].filter(([k]) => !cat.has(k));
  assert.deepEqual(missing.map(([k]) => k), [],
    '\n\n❌ คีย์สิทธิ์ที่โค้ดเรียก แต่ไม่มีแถวใน permission_catalog ⇒ ตั้งจาก /permissions ไม่ได้เลย (จอไม่ขึ้น):\n'
    + missing.map(([k, fs]) => `   ${k}  ← ${[...new Set(fs)].join(', ')}`).join('\n')
    + '\n   แก้: เขียน migration `insert into permission_catalog (resource, action, label, group_name, sort)`\n'
    + '   (group_name ตาม nav_groups · sort ในช่วงของหมวด · ดู docs/modules/role-system.md §permission key)\n');
});

test('permission-catalog-coverage ② seed role_permissions ใน migration ต้องมี catalog ด้วย (ไม่งั้น "seed false ให้โผล่ในจอ" = ไม่โผล่)', () => {
  const cat = catalogFromMigrations();
  const code = keysFromSource();
  const seeded = seededKeysFromMigrations();
  const bad = [];
  for (const [k, files] of seeded) {
    if (k.startsWith('page:')) continue;
    if (cat.has(k)) continue;
    if (RETIRED_SEEDED[k]) {
      assert.ok(!code.has(k), `\n\n❌ '${k}' อยู่ในลิสต์ปลดระวาง RETIRED_SEEDED แต่โค้ดยังเรียกอยู่ (${code.get(k)?.join(', ')}) — ถอดจากลิสต์แล้วเขียน migration เติม catalog\n`);
      continue;
    }
    bad.push(`   ${k}  ← ${[...new Set(files)].join(', ')}`);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ migration seed แถว role_permissions ให้คีย์นี้ แต่ไม่มี permission_catalog ⇒ จอ /permissions ไม่ขึ้น ตั้งค่าต่อไม่ได้:\n'
    + bad.join('\n') + '\n   เติม insert permission_catalog ในคอมมิทเดียวกัน (หรือถ้าเลิกใช้จริง ใส่ RETIRED_SEEDED พร้อมเหตุผล)\n');
});
