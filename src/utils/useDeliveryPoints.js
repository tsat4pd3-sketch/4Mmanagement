/* ── useDeliveryPoints — ทะเบียน "จุดส่งของหน้าไลน์" (DR `line_delivery_points`)  (2026-10-01) ──
   ป้าย QR จุดส่ง = **ที่อยู่ ไม่มียอด** (ดู CLAUDE.md §เลิกจุด WIP) ⇒ เป็น master ที่แทบไม่เปลี่ยน
   แต่วัดจริง 01/10 กลับโดนยิง **1,546 ครั้ง/วัน จากคำถามเดิมแค่ 22 แบบ (ซ้ำ 70 เท่า)**
   — ทุกแผงที่เปิดอยู่ยิง `.contains('line_names', [lineName])` ของตัวเองใหม่ทุกรอบโหลด

   ⇒ โหลด**ทั้งตารางครั้งเดียว** (ตารางเล็ก ~22 ไลน์) แล้วให้แต่ละจอกรองฝั่ง client เอง
     เหตุผลเดียวกับ `useStorageLocations.js` ที่แก้ไปแล้ว 21/09 (850 ครั้ง/ครึ่งวัน → cache)

   🔴 เปลี่ยน "ชุดคอลัมน์" เมื่อไหร่ **ต้องเปลี่ยนคีย์ด้วยเสมอ** — cache อยู่ localStorage อายุ 4 ชม.
      ใช้คีย์เดิม = เครื่องที่มีของเก่าค้างได้แถวที่ขาดคอลัมน์ใหม่ไปอีก 4 ชม. โดยไม่มี error
   🔴 **ทุกจุดที่ insert/update ตารางนี้ต้องเรียก `invalidateTable('line_delivery_points')` หลังบันทึกสำเร็จ**
      (ไม่งั้นแก้จุดส่งแล้วจอตัวเองยังเห็นของเก่าถึง 4 ชม.)                                        */
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'line_delivery_points:v1';

/**
 * ทุกแถวของทะเบียนจุดส่ง (รวมที่ `is_active=false` — ให้จอตัดสินเองว่าจะโชว์ไหม)
 * ⚠️ ตารางนี้เป็น "ของเสริม (เฟส 4)" — ยังไม่ apply migration ก็ได้ ⇒ คืน `[]` ไม่ใช่ throw
 *    (เดิมทุกจุดเรียกเขียน comment กำกับไว้ว่า "ห้ามลากทั้งแผงล้ม แค่ถือว่ายังไม่มีจุด")
 */
export async function loadDeliveryPoints() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabaseDR.from('line_delivery_points')
      .select('*').order('sort_order').order('name');
    if (error) return [];
    return data || [];
  });
}

export const invalidateDeliveryPoints = () => invalidateMaster(KEY);

/** จุดส่งของไลน์นี้ — แทน `.contains('line_names', [lineName])` ที่เคยยิงเองทุกรอบ */
export const deliveryPointsOfLine = (rows, lineName) =>
  (rows || []).filter(d => Array.isArray(d.line_names) && d.line_names.includes(lineName));
