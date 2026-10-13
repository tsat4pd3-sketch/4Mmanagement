/* ── useCostCenters — ทะเบียน Cost Center (Main `cost_centers`) สำหรับ picker  (2026-09-08) ──
   migration 20260908_cost_centers_main.sql · production_lines / org_nodes / cost_center_rates เก็บ code (text) เหมือนเดิม
   จัดการที่ /org-setup แผง 💰 Cost Center (สิทธิ์ cost_rate:manage — คีย์เดียวกับ RLS) · แก้แล้วเรียก invalidateCostCenters()
   ⚠️ ช่อง "Cost Center" ทุกหน้าใช้ <CostCenterSelect> ห้าม <input>/datalist เอง */
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'cost_centers:master';

export async function loadCostCenters() {
  return cachedMaster(KEY, async () => {
    // mrows: ตารางยังไม่มี → [] (เดิม) · error อื่น → โยน ห้าม cache ลิสต์ว่างทับของดี
    return mrows(await supabase.from('cost_centers')
      .select('code, name, section, note, sort_order, is_active').order('sort_order').order('code'));
  });
}
export const invalidateCostCenters = () => invalidateMaster(KEY);

/** สถานะโหลดทะเบียน — `{ rows, failed, stale, message, loading, reload }`
 *  🔴 ช่องเลือกที่ต้องบอกว่า "ลิสต์ว่างเพราะไม่มีของ หรือเพราะโหลดไม่สำเร็จ" ใช้ตัวนี้
 *     (ตัว default คืนแค่แถว = พฤติกรรมเดิม ไม่ต้องแก้จุดเรียกเก่า) */
export function useCostCentersState() { return useMasterRows(KEY, loadCostCenters); }

export default function useCostCenters() { return useCostCentersState().rows; }
