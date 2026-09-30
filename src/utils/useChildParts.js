/* ── useChildParts — ทะเบียนพาร์ทลูก `parts_master` (DR) สำหรับป้ายชื่อ MAT (2026-09-30) ──

   ทำไมต้องมี: `<MatLabel>` เดิมสร้าง index จาก `dr_products` อย่างเดียว ซึ่งเก็บ**พาร์ทแม่/สินค้า**
   ส่วนของที่**สโตร์จับทั้งหมด** (2xx ผลิตเอง · 3xx ของซื้อ · 5xx วัตถุดิบ) อยู่ `parts_master`
   ⇒ การ์ด/จอฝั่งสโตร์ **ไม่เคยโชว์ Part No. ได้เลย** ไม่ว่าจะเรียงลำดับยังไง

   ⚠️ คอลัมน์คนละชื่อกับ `dr_products` — `part_name`/`part_no` (ไม่ใช่ `name`/`p_no`)
      select ผิด = 42703 เงียบ (ดู `wipMatOptions.js` ที่จดกับดักเดียวกันไว้)
   · ตารางอยู่ DR (anon เสมอ) · ผ่าน `cachedMaster` TTL 4 ชม. เพราะหลายจอเรียกพร้อมกัน */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache.js';
import { fetchAllRows } from './fetchAllRows.js';

const KEY = 'parts_master:matlabel';
export const CHILD_PART_COLUMNS = 'mat_no, part_name, part_no';

export async function loadChildParts() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await fetchAllRows(
      supabaseDR, 'parts_master', CHILD_PART_COLUMNS, q => q.order('mat_no'));
    if (error) throw error;
    return data || [];
  });
}
export const invalidateChildParts = () => invalidateMaster(KEY);

export default function useChildParts() {
  const [parts, setParts] = useState([]);
  useEffect(() => {
    let alive = true;
    // โหลดไม่ได้ = ป้ายตกกลับไปเป็นเลข MAT เปล่า (เหมือนก่อนมีฟีเจอร์นี้) ห้ามทำให้จอพัง
    loadChildParts().then(d => { if (alive) setParts(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return parts;
}
