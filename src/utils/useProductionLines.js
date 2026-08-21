/* ── useProductionLines — ทะเบียนไลน์ผลิตชุดเดียวของทั้งแอป  (2026-08-21) ──

   ที่มา: audit dropdown ทั้งระบบเจอว่าแต่ละหน้า `select(...)` ของตัวเอง แล้วขอคอลัมน์
   ไม่ครบ — บางหน้า `select('name')` อย่างเดียว → dropdown ไม่มีลำดับชั้น (ไม่มี
   parent_line_name) กรอง scope ไม่ได้ (ไม่มี section) และไลน์ทดลองโผล่ปน (ไม่มี is_active)

   ⚠️ หน้าใหม่ที่ต้องการรายชื่อไลน์ ให้ใช้ hook นี้ ห้าม select production_lines เอง
      — คอลัมน์ที่ dropdown ต้องใช้จะครบเสมอ และประหยัด egress (cache ร่วมทั้งแอป)

   คู่กับ <LineSelect> (src/components/LineSelect.jsx) ซึ่งรับ array นี้ไปวาด dropdown */
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

export const LINE_COLUMNS = 'id, name, parent_line_name, section, is_active';
const KEY = 'production_lines';

/** โหลดครั้งเดียวแล้วแชร์ทั้งแอป — คืน [] จนกว่าจะโหลดเสร็จ */
export async function loadProductionLines() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabase.from('production_lines')
      .select(LINE_COLUMNS).order('name');
    if (error) throw error;
    // ยังไม่ apply migration is_active → คอลัมน์ไม่มี = undefined = ถือว่ายังใช้งานอยู่
    return data || [];
  });
}

/** เรียกหลังแก้ทะเบียนไลน์ (LineSetup) เพื่อให้หน้าอื่นเห็นทันทีไม่ต้องรอ TTL */
export const invalidateProductionLines = () => invalidateMaster(KEY);

export default function useProductionLines() {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    let alive = true;
    loadProductionLines().then(d => { if (alive) setLines(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return lines;
}
