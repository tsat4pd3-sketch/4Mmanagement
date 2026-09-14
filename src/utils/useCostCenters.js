/* ── useCostCenters — ทะเบียน Cost Center (Main `cost_centers`) สำหรับ picker  (2026-09-08) ──
   migration 20260908_cost_centers_main.sql · production_lines / org_nodes / cost_center_rates เก็บ code (text) เหมือนเดิม
   จัดการที่ /org-setup แผง 💰 Cost Center (สิทธิ์ cost_rate:manage — คีย์เดียวกับ RLS) · แก้แล้วเรียก invalidateCostCenters()
   ⚠️ ช่อง "Cost Center" ทุกหน้าใช้ <CostCenterSelect> ห้าม <input>/datalist เอง */
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'cost_centers:master';

export async function loadCostCenters() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabase.from('cost_centers')
      .select('code, name, section, note, sort_order, is_active').order('sort_order').order('code');
    if (error) return [];
    return data || [];
  });
}
export const invalidateCostCenters = () => invalidateMaster(KEY);

export default function useCostCenters() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    loadCostCenters().then(d => { if (alive) setRows(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return rows;
}
