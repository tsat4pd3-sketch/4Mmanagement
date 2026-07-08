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

let cache = null; // Map<`${role}:${permission_key}`, boolean>
let loadingPromise = null;

export async function loadPermissions(forceRefresh = false) {
  if (cache && !forceRefresh) return cache;
  if (loadingPromise && !forceRefresh) return loadingPromise;
  loadingPromise = supabase.from('role_permissions').select('role, permission_key, allowed').then(({ data }) => {
    cache = new Map((data || []).map(r => [`${r.role}:${r.permission_key}`, r.allowed]));
    loadingPromise = null;
    return cache;
  });
  return loadingPromise;
}

/** ใช้แบบ sync หลังเรียก loadPermissions() แล้วครั้งหนึ่ง (เช่นตอน bootstrap ของ App) */
export function hasPermission(permissionKey, role) {
  if (role === 'admin') return true;
  if (!cache) return false; // ยังไม่โหลด → ปิดกั้นไว้ก่อน (fail closed)
  return cache.get(`${role}:${permissionKey}`) === true;
}

export function canAccessPage(path, role) {
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
