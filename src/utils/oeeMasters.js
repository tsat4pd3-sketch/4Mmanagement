/* ── ทะเบียนที่สูตร OEE ต้องใช้ (DR) — loader กลางชุดเดียว (QC audit 05/10) ──
   นโยบายเวลาพัก · CT จาก dr_products · CT จาก kanban_standards

   เดิมแต่ละจอเขียน `cachedMaster(...)` เอง:
   · **คนละชุดคอลัมน์บนคีย์เดียวกัน** (`break_policies:active`: DailyReport = `*` · FactoryMap/LineOeeBoard
     = 5 คอลัมน์) ⇒ จอไหนโหลดก่อน ชุดนั้นค้าง cache 4 ชม. ให้จออื่น
   · `(await …).data || []` ⇒ คิวรีล้ม = "ไม่มีพัก/ไม่มี CT" แล้ว **cache ทับของดี 4 ชม.** เงียบๆ
     (หลบด่าน `master-cache-swallow` ได้เพราะเขียนแยก 2 บรรทัด)
   · `dr_products` ~1,500 แถว แต่ `select()` เปล่าได้แค่ 1,000 ⇒ พาร์ทที่เกินไม่มี CT ⇒ %P = null เงียบๆ

   🔴 จุดที่ต้องการของ 3 อย่างนี้ให้เรียกตัวนี้ **ห้ามเขียน cachedMaster ของตารางเหล่านี้เองอีก**
      ล้มเหลว = โยน (ผู้เรียกต้องจับแล้วบอกบนจอ ห้ามถือว่า "ไม่มีพัก/ไม่มี CT") */
import { supabase, supabaseDR } from '../supabaseClient';
import { cachedMaster, mrows } from './masterCache';
import { fetchAllRows } from './fetchAllRows';

/* :v2 (05/10) = ชุดเต็ม `*` ทุกจอ — bump จากคีย์เดิมที่ shape ไม่ตรงกันระหว่างจอ */
export const BREAK_POLICIES_KEY = 'break_policies:active:v2';
export function loadBreakPolicies() {
  return cachedMaster(BREAK_POLICIES_KEY, async () =>
    mrows(await supabaseDR.from('break_policies').select('*').eq('is_active', true).order('sort_order')));
}

/* :v2 (05/10) = แบ่งหน้าครบทุกแถว — คีย์เดิมอาจค้างชุดที่ถูกตัด 1,000 แถว */
export function loadCtProducts() {
  return cachedMaster('dr_products:ct:v2', async () =>
    mrows(await fetchAllRows(supabaseDR, 'dr_products', 'mat_no, cycle_time_sec, pair_mat_no, process_type', q => q.order('id'))));
}
export function loadCtKanban() {
  return cachedMaster('kanban_standards:ct:v2', async () =>
    mrows(await fetchAllRows(supabaseDR, 'kanban_standards', 'mat_no, dr_products(cycle_time_sec)', q => q.eq('is_active', true).order('id'))));
}

/** เป้า OEE ทุกกลุ่ม (Main `oee_targets`) → { byGroup, error } · ไม่ cache (แก้เป้าแล้วต้องเห็นทันที — แถวไม่กี่สิบ)
 *  error ≠ "ไม่ได้ตั้งเป้า" ⇒ byGroup = null ให้ `oeeTargetForLines` คืน null = จอตัดสินไม่ได้ (ห้ามเดาเป็น 80/65) */
export async function fetchOeeTargets() {
  const { data, error } = await supabase.from('oee_targets').select('group_name, target_a, target_p, target_q');
  if (error) { console.error('[oee_targets] โหลดเป้าไม่สำเร็จ:', error); return { byGroup: null, error }; }
  return { byGroup: Object.fromEntries((data || []).map(r => [r.group_name, r])), error: null };
}
