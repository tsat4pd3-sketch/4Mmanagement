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

/* 🔴 :v2 (2026-09-25) = รอบที่เพิ่ม `pair_mat_no` + `op_seq` — **เปลี่ยนชุดคอลัมน์ต้องเปลี่ยนคีย์เสมอ**
   ใช้คีย์เดิม = เครื่องที่มี cache ค้างได้แถวที่ **ไม่มี pair_mat_no** ไปอีก 4 ชม. โดยไม่มี error
   ⇒ `loadPairMap()` เห็นเป็น "ไม่มีคู่" ⇒ **OEE นับงานคู่ 2 เท่าเงียบๆ** (กฎเหล็ก CLAUDE.md "ชิ้น ≠ shot") */
const KEY = 'dr_products:picker:v2';
export const PRODUCT_COLUMNS = 'id, mat_no, name, p_no, customer, line_name, process_type, is_active, is_operation, op_parent_mat, op_seq, pair_mat_no';

export async function loadProductsMaster() {
  return cachedMaster(KEY, async () => {
    let r = await fetchAllRows(supabaseDR, 'dr_products', PRODUCT_COLUMNS, q => q.order('mat_no').order('id'));
    /* ถอยเมื่อ migration ชั้น OP ยังไม่ลง — **แต่ `pair_mat_no` ต้องอยู่ในชุดถอยด้วยเสมอ**
       (คอลัมน์นี้มีมานานแล้ว · ขาดไป = งานคู่ถูกนับ 2 เท่า ซึ่งแย่กว่าไม่ collapse ชั้น OP มาก) */
    if (r.error) r = await fetchAllRows(supabaseDR, 'dr_products', 'id, mat_no, name, p_no, customer, line_name, process_type, is_active, pair_mat_no', q => q.order('mat_no').order('id'));
    if (r.error) throw r.error;
    return r.data || [];
  });
}
export const invalidateProducts = () => invalidateMaster(KEY);

/**
 * map `{ [mat_no]: pair_mat_no }` สำหรับยุบงานคู่ (gang die / RH-LH) — `computeLiveOee({ pairMap })`
 * 🔴 **คืน `null` เมื่อยังไม่รู้ ห้ามคืน `{}`** — `{}` แปลว่า "รู้แล้วว่าไม่มีพาร์ทคู่เลย"
 *    ซึ่งทำให้ยอดงานคู่ถูกนับ 2 เท่าเงียบๆ · `null` = ไม่ยุบ (พฤติกรรมเดิมของจอที่ไม่ส่ง pairMap)
 */
export async function loadPairMap() {
  const rows = await loadProductsMaster().catch(() => undefined);
  if (!rows) return null;                               // โหลดไม่สำเร็จ
  if (rows.length && !('pair_mat_no' in rows[0])) {     // cache รุ่นเก่าค้างอยู่ (คีย์ไม่ถูก bump)
    console.warn('[loadPairMap] cache ไม่มีคอลัมน์ pair_mat_no — ไม่ยุบงานคู่รอบนี้');
    return null;
  }
  const m = {};
  rows.forEach(p => { if (p.mat_no && p.pair_mat_no) m[p.mat_no] = p.pair_mat_no; });
  return m;
}

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
