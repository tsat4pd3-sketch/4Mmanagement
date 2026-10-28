/* ── useProductionLines — ทะเบียนไลน์ผลิตชุดเดียวของทั้งแอป  (2026-08-21) ──

   ที่มา: audit dropdown ทั้งระบบเจอว่าแต่ละหน้า `select(...)` ของตัวเอง แล้วขอคอลัมน์
   ไม่ครบ — บางหน้า `select('name')` อย่างเดียว → dropdown ไม่มีลำดับชั้น (ไม่มี
   parent_line_name) กรอง scope ไม่ได้ (ไม่มี section) และไลน์ทดลองโผล่ปน (ไม่มี is_active)

   ⚠️ หน้าใหม่ที่ต้องการรายชื่อไลน์ ให้ใช้ hook นี้ ห้าม select production_lines เอง
      — คอลัมน์ที่ dropdown ต้องใช้จะครบเสมอ และประหยัด egress (cache ร่วมทั้งแอป)

   คู่กับ <LineSelect> (src/components/LineSelect.jsx) ซึ่งรับ array นี้ไปวาด dropdown */
import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster, masterLoadState } from './masterCache';
import useMasterRows from './useMasterRows.js';

/* 🔴 ชุดคอลัมน์นี้เป็น **superset ของทุกหน้าที่ใช้** ตั้งใจให้ทุกจอแชร์ cache ก้อนเดียว (2026-09-25)
   เดิมมีแค่ 5 คอลัมน์ ⇒ หน้าที่อยากได้ `cost_center`/`flow_mode`/`line_type`/กำลังคน **ยิงเองแทน**
   วัดจริง 23/09: `production_lines` โดน **4,041 ครั้ง/วัน** จาก **107 จุดที่ select เองทั่วรีโป**
   (ตัวใหญ่สุด `id,name,section,parent_line_name` = 1,761 ครั้ง/วัน)
   ตารางนี้มีแค่ ~50 แถว/16 คอลัมน์ ⇒ ขอเพิ่มคอลัมน์ถูกกว่าปล่อยให้ยิงเองเป็นพันครั้งมาก
   **ต้องการคอลัมน์เพิ่ม → เติมที่นี่ + bump คีย์ อย่าแยกไปยิงเอง**
   (ไม่เอา description/capacity/head_name/created_at/updated_at — ไม่มี dropdown ไหนใช้) */
export const LINE_COLUMNS =
  'id, name, parent_line_name, section, is_active, cost_center, flow_mode, parallel_stations, line_type, unit_kind, std_day_shift, std_night_shift';

/* 🔴 เปลี่ยนชุดคอลัมน์เมื่อไหร่ **ต้องเปลี่ยนคีย์ด้วยเสมอ** — cache อยู่ localStorage อายุ 4 ชม.
   ใช้คีย์เดิม = เครื่องที่มีของเก่าค้างได้แถวที่**ขาดคอลัมน์ใหม่**ไปอีก 4 ชม. โดยไม่มี error
   (บทเรียนเดียวกับ storage_locations:v2 · `:v2` = รอบที่เพิ่ม 6 คอลัมน์นี้) */
const KEY = 'production_lines:v3';   // v3 = เพิ่ม unit_kind (13/10)

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
/**
 * รูปแบบ `{ data, error }` ของ `loadProductionLines()` — **มีไว้เพื่อให้จุดเก่าสลับมาใช้ cache ได้บรรทัดเดียว**
 * (2026-09-25) audit 07/09 ทำให้ทุกหน้าใช้ `LINE_COLUMNS` ชุดเดียวกันแล้วจริง **แต่ยัง
 * `supabase.from('production_lines').select(LINE_COLUMNS)` เองอยู่ ~30 จุด = ไม่ผ่าน cache เลย
 * ⇒ "คอลัมน์ตรงกัน" กับ "ยิงครั้งเดียว" เป็นคนละเรื่อง — อันแรกทำแล้ว อันหลังเพิ่งทำ
 * 🔴 **เคยคืน `error: null` เสมอ — เป็นต้นเหตุ "เปิดกะไม่ได้" ของหน้างาน 28/10**
 *    `loadProductionLines()` กลืน error แล้วคืน `[]` (ตาม cachedMaster) ⇒ ตัวนี้ห่อเป็น
 *    "สำเร็จ แต่ว่าง" ⇒ จุดที่เอาไปใส่ `cachedMaster('production_lines:dr', …)` อีกชั้น
 *    **มองว่าสำเร็จ แล้ว `lsWrite([])` ลง localStorage อายุ 4 ชม.**
 *    ⇒ เครื่องนั้น "ไม่มีไลน์ให้เลือก" ค้างยาว 4 ชม. ทั้งที่คนอื่นใช้ได้ปกติ
 *    (cache ซ้อน cache: ชั้นในล้มเงียบ ชั้นนอกจดความว่างนั้นเป็นของจริง)
 * ⇒ **ต้องส่งต่อความล้ม** — `mrows()` จะ throw ให้ชั้นนอกรู้ว่า "อย่าจดลิสต์ว่างนี้"
 */
export const loadLinesRes = async () => {
  const data = await loadProductionLines();
  const fail = masterLoadState(KEY);          // ธงล้มของชั้นใน (cachedMaster จดไว้)
  /* ล้ม **และ** ไม่มีของเก่าให้ใช้ = ความว่างนี้ไม่ใช่ความจริง ห้ามให้ใครจดเก็บ */
  if (fail && !data?.length) {
    return { data: [], error: { message: fail.message || 'อ่านทะเบียนไลน์ไม่สำเร็จ', code: 'LINES_LOAD_FAILED' } };
  }
  return { data: data || [], error: null };
};

export const invalidateProductionLines = () => invalidateMaster(KEY);

/** สถานะโหลดทะเบียน — `{ rows, failed, stale, message, loading, reload }`
 *  🔴 ช่องเลือกที่ต้องบอกว่า "ลิสต์ว่างเพราะไม่มีของ หรือเพราะโหลดไม่สำเร็จ" ใช้ตัวนี้
 *     (ตัว default คืนแค่แถว = พฤติกรรมเดิม ไม่ต้องแก้จุดเรียกเก่า) */
export function useProductionLinesState() { return useMasterRows(KEY, loadProductionLines); }

export default function useProductionLines() { return useProductionLinesState().rows; }
