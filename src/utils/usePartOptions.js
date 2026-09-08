/* ── usePartOptions — โหลดทะเบียนพาร์ท 3 แหล่ง (pe_doc_sets ∪ qa_parts ∪ dr_products) ครั้งเดียว cache ร่วม ──
   (2026-09-07) คู่กับ <PartSelect> · เรียกบนสุดของ component เท่านั้น (hook) */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';
import useProducts from './useProducts';
import { buildPartOptions } from './partOptions';

const KEY = 'part_registry:main';

export async function loadPartRegistry() {
  return cachedMaster(KEY, async () => {
    const a = await supabase.from('pe_doc_sets').select('id, part_no, part_name, mat_no, customer, line_name, status').order('part_no');
    let b = await supabase.from('qa_parts').select('id, part_no, part_name, mat_no, customer, line_name, is_active').order('part_no');
    // qa_parts.mat_no มาจาก migration 20260819 — ยังไม่ apply (42703) ให้ถอยไปคอลัมน์พื้นฐาน ไม่ให้ลิสต์ว่างทั้งหน้า
    if (b.error) b = await supabase.from('qa_parts').select('id, part_no, part_name, customer, line_name, is_active').order('part_no');
    return { sets: a.data || [], qaParts: b.data || [] };
  });
}
export const invalidatePartRegistry = () => invalidateMaster(KEY);

export default function usePartOptions() {
  const { products } = useProducts();
  const [reg, setReg] = useState({ sets: [], qaParts: [] });
  useEffect(() => {
    let alive = true;
    loadPartRegistry().then(r => { if (alive && r) setReg(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return useMemo(() => buildPartOptions({ products, sets: reg.sets, qaParts: reg.qaParts }), [products, reg]);
}
