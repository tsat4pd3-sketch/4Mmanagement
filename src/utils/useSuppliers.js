/* ── useSuppliers — ทะเบียนผู้ขาย/ผู้รับจ้าง/แหล่งที่มา (DR `suppliers`) สำหรับ picker  (2026-09-08) ──
   migration 20260908_suppliers_master_dr.sql · คอลัมน์ปลายทาง (parts_master.supplier · container_types.supplier ·
   part_routings.vendor_name · mtn_spare_parts.supplier · npi_tooling_plans.maker_name) ยังเก็บ name (text) เหมือนเดิม
   จัดการที่ /products แท็บ 🏭 Supplier · แก้แล้วเรียก invalidateSuppliers()
   ⚠️ หน้าใหม่ที่ต้องการ "เลือก supplier" ใช้ <SupplierSelect> ห้าม <input> เปล่า */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'suppliers:master';
export const SUPPLIER_KINDS = {
  material: { label: 'วัตถุดิบ/เหล็ก', icon: '🪨' },
  parts:    { label: 'ชิ้นส่วน/อะไหล่', icon: '🔩' },
  tooling:  { label: 'แม่พิมพ์/จิ๊ก',   icon: '🧱' },
  service:  { label: 'จ้างนอก/บริการ',  icon: '🛠️' },
  internal: { label: 'ผลิตเอง/ในเครือ', icon: '🏭' },
  other:    { label: 'อื่นๆ',           icon: '🏷️' },
};

export async function loadSuppliers() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabaseDR.from('suppliers')
      .select('code, name, kind, contact, phone, lead_time_days, note, sort_order, is_active').order('sort_order').order('name');
    if (error) return [];   // ยังไม่ apply migration → picker ทำงานแบบพิมพ์เองพร้อมป้าย
    return data || [];
  });
}
export const invalidateSuppliers = () => invalidateMaster(KEY);

export default function useSuppliers() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    loadSuppliers().then(d => { if (alive) setRows(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return rows;
}
