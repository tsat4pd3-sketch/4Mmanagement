/**
 * Role-permission helpers — shared across App.jsx (route/nav gating) and any
 * page that needs a role-gated action (e.g. "edit master data").
 * Backed by the `role_permissions` table (role, permission_key, allowed),
 * manageable from the ตั้งค่าโปรแกรม,ฐานข้อมูล > จัดการสิทธิ์ page.
 *
 * ⚠️ 'admin' always has access to everything, regardless of what's stored —
 * this is a hardcoded safety net so an admin can never lock themselves out
 * of the permissions page (or any other page) via a misconfigured table.
 */
import { supabase } from '../supabaseClient';
import { sideAllows, normalizeSides } from './logisticSide.js';   // .js เพื่อให้เทส node:test resolve ได้ (bundler ไม่สน)

let cache = null; // Map<`${role}:${permission_key}`, boolean>
let loadingPromise = null;

// แอดมินหน่วยงาน (department admin) — flag ต่อ user ซ้อนบน role เดิม (2026-08-03)
//   ตั้งจาก App.jsx ตอน fetchProfile (เหมือน setDrActorName) → hasPermission อ่าน bucket 'dept_admin' เพิ่ม
//   เก็บเป็น module-level กัน thread ผ่าน can() หลายร้อยจุด · ปรับสิทธิ์ bucket ที่ /permissions
let _deptAdmin = false;
export function setDeptAdmin(v) { _deptAdmin = !!v; }
export function isDeptAdminActive() { return _deptAdmin; }

// ฝั่งงาน Logistic ของ user (ชั้น 3 · 2026-09-04) — ชั้น "จำกัดเพิ่ม" ทับสิทธิ์ role ของหน้าในหมวด Logistic
//   _userSides  = ฝั่งที่ user ทำ (จาก profiles.logistic_sides หรือตกทอดจากแผนกพนักงาน — ตั้งจาก App.jsx
//                 ตอน fetchProfile/จำลอง role เหมือน setDeptAdmin) · [] = ไม่จำกัด
//   _pageSides  = path → ฝั่งของหน้า (App.jsx ลงทะเบียนจาก NAV_ITEMS + NAV_GROUP_META.side ตอนโหลดโมดูล)
//   หน้าที่ไม่มีฝั่ง (หมวดอื่น) ผ่านเสมอ · **ไม่เคยเปิดหน้าที่ role ไม่มีสิทธิ์** — เช็คหลัง role ผ่านแล้วเท่านั้น
//   เก็บเป็น module-level เพราะ canAccessPage ถูกเรียก sync จาก sidebar/route/Home/notification หลายร้อยจุด
let _userSides = [];
let _pageSides = new Map();
export function setUserSides(arr) { _userSides = normalizeSides(arr); }
export function getUserSides() { return _userSides; }
export function registerPageSides(map) { _pageSides = map instanceof Map ? map : new Map(Object.entries(map || {})); }
/** หน้านี้อยู่ในฝั่งที่ user ทำไหม (ไม่รู้จัก path = หน้ากลาง ผ่าน) */
export function sideOkForPath(path) { return sideAllows(_pageSides.get(path) || [], _userSides); }

export async function loadPermissions(forceRefresh = false) {
  if (cache && !forceRefresh) return cache;
  if (loadingPromise && !forceRefresh) return loadingPromise;
  loadingPromise = (async () => {
    // ⚠️ ต้องดึงแบบแบ่งหน้า (.range) — Supabase ตัดผลลัพธ์ที่ 1000 แถวโดย default
    // ตารางโต >1000 แถวแล้ว (1,135 แถว ณ 2026-08-03) → แถวที่ seed ทีหลัง (เช่น bucket dept_admin)
    // หายเงียบจาก cache = สิทธิ์ที่ตั้งใน DB ถูกต้องแต่ปุ่ม/เมนูไม่โผล่ (fail-closed) — บั๊กจริงที่เจอ
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      // ⚠️⚠️ ต้อง .order() ให้ครบคีย์ที่ unique เสมอเมื่อใช้ .range() แบ่งหน้า
      // PostgreSQL ไม่รับประกันลำดับแถวถ้าไม่สั่ง ORDER BY → พอมีคนกดแก้สิทธิ์ที่ /permissions
      // (UPDATE ทำให้แถวขยับตำแหน่งใน heap) ลำดับของหน้า 1 กับหน้า 2 จะไม่ต่อกัน
      // → **บางแถวไม่โผล่ในหน้าไหนเลย** = สิทธิ์มีอยู่ใน DB แต่ปุ่ม/เมนูไม่ขึ้น แบบสุ่มคนสุ่มรอบ
      // (เคสจริง 2026-08-19: planner_store มี line_stock:manage_rounds แต่ปุ่ม "+ เพิ่มรอบจัดส่ง" หาย)
      const { data, error } = await supabase.from('role_permissions')
        .select('role, permission_key, allowed')
        .order('role').order('permission_key')
        .range(from, from + PAGE - 1);
      // ⚠️ ห้ามเขียนทับ cache ด้วยผลลัพธ์ว่าง/บางส่วนตอน fetch ล้ม (network/RLS สะดุด) —
      // ถ้าหน้าไหนล้ม ให้คืน cache เดิมทั้งก้อน (Map ที่ขาดแถว = non-admin โดนล็อกเมนูค้างถาวร)
      if (error || !data) return cache || new Map();
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    if (rows.length === 0) return cache || new Map();
    cache = new Map(rows.map(r => [`${r.role}:${r.permission_key}`, r.allowed]));
    return cache;
  })().then(m => { loadingPromise = null; return m; })
    .catch(() => {
      // เผื่อ promise reject จริง — คืน cache เดิม ไม่ค้าง loadingPromise ที่ reject
      loadingPromise = null;
      return cache || new Map();
    });
  return loadingPromise;
}

/** ใช้แบบ sync หลังเรียก loadPermissions() แล้วครั้งหนึ่ง (เช่นตอน bootstrap ของ App) */
export function hasPermission(permissionKey, role) {
  if (role === 'admin') return true;
  if (!cache) return false; // ยังไม่โหลด → ปิดกั้นไว้ก่อน (fail closed)
  if (cache.get(`${role}:${permissionKey}`) === true) return true;
  // แอดมินหน่วยงาน — ได้สิทธิ์เพิ่มตาม bucket 'dept_admin' (คุมที่ /permissions)
  // bucket ให้ได้เฉพาะ "action" เท่านั้น — ห้ามปลดล็อกหน้า (page:*) เด็ดขาด แม้ข้อมูล seed จะหลุดมา
  // (migration หน้าใหม่ที่ seed ด้วย enum_range จะแจก page:* ให้ทุก role ในอีนัมรวม dept_admin ด้วย
  //  → บังคับกฎในโค้ดที่นี่ ไม่พึ่งความถูกต้องของ seed อย่างเดียว · QC audit 2026-08-03)
  if (_deptAdmin && !permissionKey.startsWith('page:') && cache.get(`dept_admin:${permissionKey}`) === true) return true;
  return false;
}

export function canAccessPage(path, role) {
  // ชั้น 1 = สิทธิ์ role (data-driven) · ชั้น 2 = ฝั่งงาน Logistic ของ user (จำกัดเพิ่มเท่านั้น)
  // admin ข้ามด่านฝั่งเสมอ — safety net เดียวกับสิทธิ์หน้า (ตั้งฝั่งผิดต้องแก้ตัวเองได้ที่ /add-user)
  return roleCanAccessPage(path, role) && (role === 'admin' || sideOkForPath(path));
}

function roleCanAccessPage(path, role) {
  // Daily Checker = ศูนย์รวมแท็บ (PM Daily / LPA / ...) — เข้าได้ถ้ามีสิทธิ์แท็บใดแท็บหนึ่ง
  // (piggyback สิทธิ์เดิม ไม่ต้อง seed page:/daily-checker · แท็บใน DailyChecker.jsx โผล่ตามสิทธิ์ย่อย)
  if (path === '/daily-checker') {
    return hasPermission('page:/daily-checker', role)
        || hasPermission('page:/daily-pm', role)
        || hasPermission('page:/pokayoke', role)
        || hasPermission('page:/lpa', role)
        || hasPermission('page:/bbs', role);
  }
  // ศูนย์ PM = ศูนย์รวมแท็บงานซ่อมบำรุงตามแผน (ตรวจ/แผน/ล่วงหน้า/ประสานงาน/ตั้งค่า)
  // piggyback สิทธิ์หน้าเดิมทั้ง 5 — ไม่ต้อง seed page:/pm · แท็บใน PmHub.jsx โผล่ตามสิทธิ์ย่อย
  if (path === '/pm') {
    return hasPermission('page:/pm', role)
        || hasPermission('page:/pm-check', role)
        || hasPermission('page:/pm-schedule', role)
        || hasPermission('page:/pm-forecast', role)
        || hasPermission('page:/pm-coordination', role)
        || hasPermission('page:/pm-setup', role);
  }
  return hasPermission(`page:${path}`, role);
}

/**
 * สิทธิ์ระดับ action (Phase 0 — docs/PERMISSIONS-DESIGN.md)
 * key ในตาราง = `${resource}:${action}` เช่น 'products:create', 'four_m:approve_qa'
 * ใน component แนะนำใช้ hook usePerms() (src/utils/usePerms.js) แทนการเรียกตรง
 */
export function can(resource, action, role) {
  return hasPermission(`${resource}:${action}`, role);
}

/**
 * เช็คว่า permission key นี้ถูก seed ในระบบแล้วหรือยัง (มีอย่างน้อย 1 role ในตาราง)
 * ใช้เพื่อทำ feature ใหม่แบบ backward-compatible: ถ้ายังไม่ seed → ยังไม่เปิดใช้ (fallback ของเดิม)
 */
export function isActionSeeded(resource, action) {
  if (!cache) return false;
  const suffix = `:${resource}:${action}`;   // cache key = `${role}:${resource}:${action}`
  for (const k of cache.keys()) if (k.endsWith(suffix)) return true;
  return false;
}

/**
 * สิทธิ์ "ลบ" แบบแยก — deploy-safe:
 *   • ถ้า `${resource}:delete` ถูก seed แล้ว → ใช้สิทธิ์ลบแยก (Admin ปรับรายบุคคลได้)
 *   • ถ้ายังไม่ seed (ก่อน apply migration) → fallback สิทธิ์เดิมที่เคยคุมการลบ (พฤติกรรมไม่เปลี่ยน)
 * เมื่อ seed ด้วยค่าเท่ากับผู้ถือสิทธิ์เดิม ผลลัพธ์เหมือนเดิมเป๊ะ แต่หลังจากนั้น Admin ปิดเฉพาะ role ได้
 */
export function canDelete(resource, fallbackAction, role) {
  if (role === 'admin') return true;
  return isActionSeeded(resource, 'delete')
    ? can(resource, 'delete', role)
    : can(resource, fallbackAction, role);
}

/** อ่าน permission ทั้งหมดของ role หนึ่ง ๆ เป็น object { [permission_key]: boolean } — ใช้ในหน้าจัดการสิทธิ์ */
export function getAllForRole(role) {
  if (!cache) return {};
  const out = {};
  for (const [k, v] of cache.entries()) {
    const [r, ...rest] = k.split(':');
    if (r === role) out[rest.join(':')] = v;
  }
  return out;
}
