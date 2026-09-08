/* ── useProducts — Product Master (DR `dr_products`) ชุดเดียวสำหรับ picker  (2026-09-07) ──

   ที่มา: `mat_no` คือกุญแจ golden thread (kanban_standards · line_stock · PE doc set · NPI ·
   die_sets · VSM · OrderTrace) แต่หลายฟอร์มให้พิมพ์ MAT เองผ่าน input/datalist โดยไม่เช็คทะเบียน
   → MAT ที่ไม่มีจริงหลุดเข้าฐานเงียบๆ แล้วทุกหน้าที่ join หาไม่เจอ

   ⚠️ หน้าใหม่ที่ต้องการ "เลือกสินค้า/พาร์ท" ให้ใช้ <ProductSelect> (src/components/ProductSelect.jsx)
      ห้าม select dr_products มาทำ datalist เองอีก · ตารางอยู่ DR (anon เสมอ) */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';
import { fetchAllRows } from './fetchAllRows';

const KEY = 'dr_products:picker';
export const PRODUCT_COLUMNS = 'id, mat_no, name, p_no, customer, line_name, process_type, is_active, is_operation, op_parent_mat';

export async function loadProductsMaster() {
  return cachedMaster(KEY, async () => {
    let r = await fetchAllRows(supabaseDR, 'dr_products', PRODUCT_COLUMNS, q => q.order('mat_no').order('id'));
    if (r.error) r = await fetchAllRows(supabaseDR, 'dr_products', 'id, mat_no, name, p_no, customer, line_name, process_type, is_active', q => q.order('mat_no').order('id'));
    if (r.error) throw r.error;
    return r.data || [];
  });
}
export const invalidateProducts = () => invalidateMaster(KEY);

/** คืน { products, loading, failed } — products รวม is_active=false (picker ตัด/ติดป้ายเอง) */
export default function useProducts() {
  const [state, setState] = useState({ products: [], loading: true, failed: false });
  useEffect(() => {
    let alive = true;
    loadProductsMaster().then(d => { if (alive) setState({ products: d || [], loading: false, failed: false }); })
      .catch(() => { if (alive) setState({ products: [], loading: false, failed: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}
