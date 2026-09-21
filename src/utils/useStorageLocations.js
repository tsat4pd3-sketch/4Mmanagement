/* ── useStorageLocations — ทะเบียนรหัสคลัง (DR `storage_locations`) สำหรับ picker  (2026-09-07) ──
   คู่กับ helper pure ใน storageLoc.js (format/ชนิด) — ไฟล์นี้เป็นตัวโหลด+cache เท่านั้น
   ⚠️ หน้าใหม่ที่ต้องการ "เลือกรหัสคลัง" ใช้ <StorageLocSelect> ห้ามพิมพ์ input เปล่า */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

/* 🔴 เปลี่ยน "ชุดคอลัมน์" ของ cachedMaster เมื่อไหร่ **ต้องเปลี่ยนคีย์ด้วยเสมอ** (2026-09-21)
   cache อยู่ใน localStorage ของแต่ละเครื่อง อายุ 4 ชม. ⇒ ถ้าใช้คีย์เดิม เครื่องที่มีของเก่าค้าง
   จะได้แถวที่**ขาดคอลัมน์ใหม่** ไปอีก 4 ชม. โดยไม่มี error — ตัวกรองที่พึ่งคอลัมน์นั้นจะเงียบๆ ว่างเปล่า
   (`:v2` = รอบที่เพิ่ม `line_names` เข้ามา) */
const KEY = 'storage_locations:v2';

/**
 * ทะเบียนรหัสคลัง — **ชุดคอลัมน์นี้เป็น superset ของทุกหน้าที่ใช้** ตั้งใจให้ทุกจอแชร์ cache ก้อนเดียว
 * (เดิม 3 หน้ายิงตรงด้วยชุดคอลัมน์ของตัวเอง = 3 คิวรี/จอ × ทุกรอบโหลด ทั้งที่เป็น master ที่แทบไม่เปลี่ยน
 *  วัดจริง 21/09: `storage_locations` โดน 850 ครั้งในครึ่งวัน)
 * หน้าที่ต้องการคอลัมน์เพิ่ม → **เติมที่นี่ + bump คีย์** อย่าแยกไปยิงเอง
 */
export async function loadStorageLocations() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabaseDR.from('storage_locations')
      .select('code, name, kind, line_names, is_active, sort_order').order('sort_order').order('code');
    // ยังไม่ apply migration 20260902 → ตารางไม่มี (42P01) — คืน [] ให้ picker ทำงานแบบพิมพ์เองพร้อมป้าย
    if (error) return [];
    return data || [];
  });
}
export const invalidateStorageLocations = () => invalidateMaster(KEY);

export default function useStorageLocations() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    loadStorageLocations().then(d => { if (alive) setRows(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return rows;
}
