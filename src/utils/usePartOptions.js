/* ── usePartOptions — โหลดทะเบียนพาร์ท 3 แหล่ง (pe_doc_sets ∪ qa_parts ∪ dr_products) ครั้งเดียว cache ร่วม ──
   (2026-09-07) คู่กับ <PartSelect> · เรียกบนสุดของ component เท่านั้น (hook) */
import { useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';
import useProducts from './useProducts';
import { buildPartOptions } from './partOptions';

const KEY = 'part_registry:main';
/* ค่าว่างก้อนเดียวระดับโมดูล — สร้างใหม่ทุก render = useMemo ปลายทางคิดใหม่ทุกครั้ง (กฎเหล็ก DB ข้อ 9) */
const EMPTY_REG = { sets: [], qaParts: [] };

export async function loadPartRegistry() {
  return cachedMaster(KEY, async () => {
    const a = await supabase.from('pe_doc_sets').select('id, part_no, part_name, mat_no, customer, line_name, status').order('part_no');
    let b = await supabase.from('qa_parts').select('id, part_no, part_name, mat_no, customer, line_name, is_active').order('part_no');
    // qa_parts.mat_no มาจาก migration 20260819 — ยังไม่ apply (42703) ให้ถอยไปคอลัมน์พื้นฐาน ไม่ให้ลิสต์ว่างทั้งหน้า
    if (b.error) b = await supabase.from('qa_parts').select('id, part_no, part_name, customer, line_name, is_active').order('part_no');
    /* 🔴 `.data || []` ที่นี่คือจุดที่ทำให้ "โหลดล้ม" กลายเป็น "ไม่มีพาร์ท" แล้วถูก cache ทับ 4 ชม.
       (ล้มแบบนี้ `cachedMaster` ไม่เห็น error ⇒ toast กลางใน main.jsx ไม่ขึ้นด้วย = เงียบสนิท
        หน้างานเปิดช่องเลือกพาร์ทแล้วเห็นว่าง → สรุปว่าพาร์ทนี้ยังไม่ได้ลงทะเบียน)
       `mrows` = ตาราง/คอลัมน์ไม่มี → [] ตามเดิม · error อื่นโยน (ตรงกฎ master-cache-swallow) */
    return { sets: mrows(a), qaParts: mrows(b) };
  });
}
export const invalidatePartRegistry = () => invalidateMaster(KEY);

/** สถานะโหลดทะเบียนพาร์ท — `{ options, failed, stale, message, loading, reload }`
 *  🔴 ช่องเลือกพาร์ทที่ต้องบอกว่า "ว่างเพราะไม่มี หรือเพราะโหลดไม่สำเร็จ" ใช้ตัวนี้ */
export function usePartOptionsState() {
  const { products } = useProducts();
  const { rows: reg, ...st } = useMasterRows(KEY, loadPartRegistry, { empty: EMPTY_REG });
  const options = useMemo(
    () => buildPartOptions({ products, sets: reg.sets, qaParts: reg.qaParts }), [products, reg]);
  return { options, ...st };
}

export default function usePartOptions() { return usePartOptionsState().options; }
