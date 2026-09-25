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

/* 🔴 ชุดคอลัมน์นี้เป็น **superset ของทุกหน้าที่ใช้** ตั้งใจให้ทุกจอแชร์ cache ก้อนเดียว (2026-09-25)
   เดิมมีแค่ 5 คอลัมน์ ⇒ หน้าที่อยากได้ `cost_center`/`flow_mode`/`line_type`/กำลังคน **ยิงเองแทน**
   วัดจริง 23/09: `production_lines` โดน **4,041 ครั้ง/วัน** จาก **107 จุดที่ select เองทั่วรีโป**
   (ตัวใหญ่สุด `id,name,section,parent_line_name` = 1,761 ครั้ง/วัน)
   ตารางนี้มีแค่ ~50 แถว/16 คอลัมน์ ⇒ ขอเพิ่มคอลัมน์ถูกกว่าปล่อยให้ยิงเองเป็นพันครั้งมาก
   **ต้องการคอลัมน์เพิ่ม → เติมที่นี่ + bump คีย์ อย่าแยกไปยิงเอง**
   (ไม่เอา description/capacity/head_name/created_at/updated_at — ไม่มี dropdown ไหนใช้) */
export const LINE_COLUMNS =
  'id, name, parent_line_name, section, is_active, cost_center, flow_mode, parallel_stations, line_type, std_day_shift, std_night_shift';

/* 🔴 เปลี่ยนชุดคอลัมน์เมื่อไหร่ **ต้องเปลี่ยนคีย์ด้วยเสมอ** — cache อยู่ localStorage อายุ 4 ชม.
   ใช้คีย์เดิม = เครื่องที่มีของเก่าค้างได้แถวที่**ขาดคอลัมน์ใหม่**ไปอีก 4 ชม. โดยไม่มี error
   (บทเรียนเดียวกับ storage_locations:v2 · `:v2` = รอบที่เพิ่ม 6 คอลัมน์นี้) */
const KEY = 'production_lines:v2';

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
