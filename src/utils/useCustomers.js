/* ── useCustomers — รายชื่อลูกค้าชุดเดียวของทั้งแอป  (2026-09-07 · single-source audit) ──

   ⚠️ ระบบ **ยังไม่มีตาราง customers** — ชื่อลูกค้าเป็น text ใน dr_products.customer และถูกพิมพ์เอง
   ซ้ำใน ≥10 ฟอร์ม (Product Master · QA part/claim · PE doc set · NPI project/template · MO ·
   Kanban Std) ขณะที่ forecast/shipping/claims จัดกลุ่มด้วยสตริงนี้ → "FORD"/"Ford"/"FORD MOTOR"
   แตกเป็นคนละลูกค้า

   ทางแก้ระยะนี้ (ไม่แตะ schema): ให้ **Product Master เป็นเจ้าของรายชื่อ** — รวม distinct จาก
   dr_products.customer ∪ ship_to_plants.customer_name (ทั้งคู่ DR) แล้วทุกฟอร์มเลือกจากลิสต์นี้ผ่าน
   <CustomerSelect> (allowFree + ป้าย "ไม่ได้อยู่ในทะเบียน" สำหรับลูกค้าใหม่จริง)
   ถ้าจะทำตาราง `customers` (code/name/alias) ในอนาคต แก้ที่ loader นี้ตัวเดียว ทุกฟอร์มตามเอง */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

const KEY = 'customers:derived';
const normKey = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

export async function loadCustomers() {
  return cachedMaster(KEY, async () => {
    const [p, s] = await Promise.all([
      supabaseDR.from('dr_products').select('customer').not('customer', 'is', null).limit(5000),
      supabaseDR.from('ship_to_plants').select('customer_name').then(r => r).catch(() => ({ data: [] })),
    ]);
    if (p.error) throw p.error;
    const count = new Map();   // key → { name, n }
    const add = (name, n = 1) => {
      const k = normKey(name); if (!k) return;
      const cur = count.get(k);
      if (cur) cur.n += n; else count.set(k, { name: String(name).trim(), n });
    };
    (p.data || []).forEach(r => add(r.customer));
    (s.data || []).forEach(r => add(r.customer_name, 0));
    // ชื่อที่ใช้บ่อยขึ้นก่อน (สะกดหลัก) · เก็บ n ไว้โชว์เป็น badge "กี่สินค้า"
    return [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'th'));
  });
}
export const invalidateCustomers = () => invalidateMaster(KEY);
export const customerKey = normKey;

export default function useCustomers() {
  const [customers, setCustomers] = useState([]);
  useEffect(() => {
    let alive = true;
    loadCustomers().then(d => { if (alive) setCustomers(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return customers;
}
