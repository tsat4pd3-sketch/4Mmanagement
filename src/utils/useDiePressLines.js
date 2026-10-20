/* ── useDiePressLines — ทะเบียนกลุ่มเครื่องปั๊ม/ไลน์ของแม่พิมพ์ (DR `die_press_lines`)  (2026-09-08) ──
   migration 20260908_die_press_lines_dr.sql · die_sets.line_name / machines.line_name (die) เก็บ name (text) เหมือนเดิม
   ตั้งใจแยกจาก production_lines (ไม่ให้ "LINE A ( 800 Ton )" โผล่ใน dropdown ไลน์ผลิตทุกหน้า)
   ref_production_line = ชื่อไลน์ผลิตจริงเมื่อกลุ่มนั้นคือไลน์ (HDF1/HDF2) — ใช้ต่อ linkage OEE/session ในอนาคต
   จัดการที่ /die-registry แผง ⚙️ กลุ่มเครื่องปั๊ม · แก้แล้วเรียก invalidateDiePressLines() */
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'die_press_lines:master';

export async function loadDiePressLines() {
  return cachedMaster(KEY, async () => {
    return mrows(await supabaseDR.from('die_press_lines')
      .select('code, name, tonnage, ref_production_line, note, sort_order, is_active').order('sort_order').order('name'));
  });
}
export const invalidateDiePressLines = () => invalidateMaster(KEY);

/** สถานะโหลดทะเบียน — `{ rows, failed, stale, message, loading, reload }`
 *  🔴 ช่องเลือกที่ต้องบอกว่า "ลิสต์ว่างเพราะไม่มีของ หรือเพราะโหลดไม่สำเร็จ" ใช้ตัวนี้
 *     (ตัว default คืนแค่แถว = พฤติกรรมเดิม ไม่ต้องแก้จุดเรียกเก่า) */
export function useDiePressLinesState() { return useMasterRows(KEY, loadDiePressLines); }

export default function useDiePressLines() { return useDiePressLinesState().rows; }
