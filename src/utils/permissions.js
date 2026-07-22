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
  loadingPromise = supabase.from('role_permissions').select('role, permission_key, allowed').then(({ data, error }) => {
    loadingPromise = null;
    // ⚠️ ห้ามเขียนทับ cache ด้วยผลลัพธ์ว่างตอน fetch ล้ม (network/RLS สะดุด) —
    // supabase-js คืน { data:null, error } ไม่ reject · ถ้าเซ็ต Map ว่าง (truthy) ทับ cache
    // hasPermission จะคืน false ทุก key ค้างถาวรจนกว่าจะ reload → non-admin โดนล็อกเมนู/เด้งออกทุกหน้า
    // (เคยเป็นบั๊ก: ตอน login เน็ตกระตุก หรือตอน admin แก้สิทธิ์แล้ว broadcast ให้ทุกเครื่อง reload)
    if (error || !data) return cache || new Map();
    cache = new Map(data.map(r => [`${r.role}:${r.permission_key}`, r.allowed]));
    return cache;
  }).catch(() => {
    // เผื่อ promise reject จริง (แทนที่จะคืน {error}) — คืน cache เดิม ไม่ค้าง loadingPromise ที่ reject
    loadingPromise = null;
    return cache || new Map();
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
