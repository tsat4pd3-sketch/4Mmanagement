/* ── useDiePressLines — ทะเบียนกลุ่มเครื่องปั๊ม/ไลน์ของแม่พิมพ์ (DR `die_press_lines`)  (2026-09-08) ──
   migration 20260908_die_press_lines_dr.sql · die_sets.line_name / machines.line_name (die) เก็บ name (text) เหมือนเดิม
   ตั้งใจแยกจาก production_lines (ไม่ให้ "LINE A ( 800 Ton )" โผล่ใน dropdown ไลน์ผลิตทุกหน้า)
   ref_production_line = ชื่อไลน์ผลิตจริงเมื่อกลุ่มนั้นคือไลน์ (HDF1/HDF2) — ใช้ต่อ linkage OEE/session ในอนาคต
   จัดการที่ /die-registry แผง ⚙️ กลุ่มเครื่องปั๊ม · แก้แล้วเรียก invalidateDiePressLines() */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'die_press_lines:master';

export async function loadDiePressLines() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabaseDR.from('die_press_lines')
      .select('code, name, tonnage, ref_production_line, note, sort_order, is_active').order('sort_order').order('name');
    if (error) return [];
    return data || [];
  });
}
export const invalidateDiePressLines = () => invalidateMaster(KEY);

export default function useDiePressLines() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    loadDiePressLines().then(d => { if (alive) setRows(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return rows;
}
