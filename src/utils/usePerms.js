/**
 * usePerms — hook สิทธิ์ระดับ action ผูก role ปัจจุบันจาก UserContext ให้อัตโนมัติ
 * (Phase 0 ของแผน CRUD-level permissions — docs/PERMISSIONS-DESIGN.md)
 *
 * แยกไฟล์จาก permissions.js เพื่อเลี่ยง circular import:
 * App.jsx → permissions.js อยู่แล้ว ส่วนไฟล์นี้ → App.jsx (เอา UserContext)
 *
 * ตัวอย่าง:
 *   const { can } = usePerms();
 *   {can('products', 'create') && <button>+ เพิ่มสินค้า</button>}
 *   {can('four_m', 'approve_qa') && <button>✅ QA Approve</button>}
 *
 * admin ได้ true เสมอ; ยังโหลด cache ไม่เสร็จ = false (fail-closed) —
 * ปกติไม่เกิดเพราะ App gate route tree ไว้หลัง loadPermissions() แล้ว
 */
import { useContext, useCallback } from 'react';
import { UserContext } from '../App';
import { can as canFor } from './permissions';

export function usePerms() {
  const { role } = useContext(UserContext);
  const can = useCallback((resource, action) => canFor(resource, action, role), [role]);
  return { can, role };
}
