/* ── useStorageLocations — ทะเบียนรหัสคลัง (DR `storage_locations`) สำหรับ picker  (2026-09-07) ──
   คู่กับ helper pure ใน storageLoc.js (format/ชนิด) — ไฟล์นี้เป็นตัวโหลด+cache เท่านั้น
   ⚠️ หน้าใหม่ที่ต้องการ "เลือกรหัสคลัง" ใช้ <StorageLocSelect> ห้ามพิมพ์ input เปล่า */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'storage_locations:picker';

export async function loadStorageLocations() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabaseDR.from('storage_locations')
      .select('code, name, kind, is_active, sort_order').order('sort_order').order('code');
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
