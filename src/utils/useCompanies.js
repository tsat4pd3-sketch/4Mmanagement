/* ── useCompanies — ทะเบียนบริษัทในกลุ่ม (Main `companies`) · 2026-11-25 ───────────────────────────
   ที่มา: template Com Code ของกลุ่ม (คุยกัน 03/11 · ส่งตารางมา 25/11) — SPG → บริษัท (SAP 4 หลัก / SAP B1 3 หลัก)
   · migration 20261125_companies_registry_main.sql · จัดการที่ /org-setup แท็บ 🏢 บริษัทในกลุ่ม (สิทธิ์ org:manage_divisions)
   🔴 ไม่มี FK — org_nodes(company).code · cost_centers.company · employees.employee_id_code อ้างด้วยข้อความเหมือนเดิม
      ⇒ ลบ/เปลี่ยนรหัสผ่าน masterDeleteGuard (utils/masterRefs.js) นับปลายทางก่อนเสมอ
   🔴 Com Code = 3 หลักแรกของรหัสพนักงาน — กฎ pure อยู่ `utils/companyCode.js` (`companyOfEmployeeCode()` · เทสได้โดยไม่แตะ supabase) */
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'companies:master';
export const COMPANY_COLUMNS = 'code, name, spg_no, spg_name, sap_code, sap_b1_code, com_code, is_active, sort_order, note';

export async function loadCompanies() {
  return cachedMaster(KEY, async () => mrows(
    await supabase.from('companies').select(COMPANY_COLUMNS).order('sort_order').order('code')));
}
export const invalidateCompanies = () => invalidateMaster(KEY);

/** สถานะโหลดทะเบียน `{ rows, failed, stale, message, loading, reload }` (กฎ "ลิสต์ว่าง 2 ความหมาย") */
export function useCompaniesState() { return useMasterRows(KEY, loadCompanies); }
export default function useCompanies() { return useCompaniesState().rows; }

/* กฎ pure (รหัสพนักงาน ↔ บริษัท · จัดกลุ่ม SPG) อยู่ utils/companyCode.js — re-export ให้จุดเรียกใช้ที่เดียว */
export { companyOfEmployeeCode, groupBySpg } from './companyCode.js';
