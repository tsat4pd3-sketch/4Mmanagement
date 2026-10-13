/* ── useCustomers — ทะเบียนลูกค้าชุดเดียวของทั้งแอป  (2026-09-07 derived → 2026-09-08 ตาราง `customers`) ──

   ตาราง DR `customers` (migration 20260908_customers_master_dr.sql) เป็นเจ้าของรายชื่อ:
     code = คีย์ normalize (upper · ยุบช่องว่าง) · name = สะกดหลักที่บันทึกลงคอลัมน์ customer ของตารางอื่น
     aliases = สะกดอื่นที่เคยเจอ → picker แม็ปเข้า name หลัก (ค่าเก่าในฐานยังอ่านออก)
   **คอลัมน์ customer ปลายทางยังเก็บ name (text) เหมือนเดิม** ไม่ผูก FK — จัดการที่ /products แท็บ 🏷️ ลูกค้า

   fallback: ตารางยังไม่ apply / ว่าง → derive distinct จาก dr_products.customer ∪ ship_to_plants.customer_name
   (พฤติกรรมเดิม 2026-09-07) เพื่อไม่ให้ picker ว่างทั้งแอป · แก้ master แล้วเรียก invalidateCustomers() */
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'customers:master';
const normKey = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

async function loadDerived() {
  const [p, s] = await Promise.all([
    supabaseDR.from('dr_products').select('customer').not('customer', 'is', null).limit(5000),
    /* แหล่งเสริม (เติมชื่อที่ยังไม่เคยผลิต · น้ำหนัก n=0) — ตารางอาจยังไม่มี ⇒ ไม่ให้ล้มทั้งก้อน
       แต่ห้ามไร้ร่องรอย: error จริงต้องเห็นใน log ไม่งั้น "ลูกค้าหาย" หาต้นเหตุไม่ได้ */
    supabaseDR.from('ship_to_plants').select('customer_name')
      .then(r => { if (r?.error) console.warn('[useCustomers] อ่าน ship_to_plants ไม่สำเร็จ — ชื่อลูกค้าที่ยังไม่เคยผลิตจะไม่ขึ้น', r.error); return r; },
            (e) => { console.warn('[useCustomers] อ่าน ship_to_plants ไม่สำเร็จ', e); return { data: [] }; }),
  ]);
  if (p.error) throw p.error;
  const count = new Map();
  const add = (name, n = 1) => {
    const k = normKey(name); if (!k) return;
    const cur = count.get(k);
    if (cur) cur.n += n; else count.set(k, { code: k, name: String(name).trim(), aliases: [], n, is_active: true, derived: true });
  };
  (p.data || []).forEach(r => add(r.customer));
  (s.data || []).forEach(r => add(r.customer_name, 0));
  return [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'th'));
}

/** คืน [{ code, name, aliases[], is_active, sort_order, n?, derived? }] — active ก่อน แล้วตาม sort_order/ชื่อ */
export async function loadCustomers() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabaseDR.from('customers')
      .select('code, name, aliases, note, sort_order, is_active').order('sort_order').order('name');
    if (error || !data?.length) return loadDerived();   // 42P01 ยังไม่ apply / ตารางว่าง
    return data.map(r => ({ ...r, aliases: r.aliases || [] }));
  });
}
export const invalidateCustomers = () => invalidateMaster(KEY);
export const customerKey = normKey;

/** หา "สะกดหลัก" ของชื่อที่ให้มา (ตรง name หรือ alias) — ไม่เจอ = คืนค่าเดิม */
export function canonicalCustomer(customers, name) {
  const k = normKey(name); if (!k) return name;
  const hit = (customers || []).find(c => normKey(c.name) === k || (c.aliases || []).some(a => normKey(a) === k));
  return hit ? hit.name : name;
}

/** สถานะโหลดทะเบียน — `{ rows, failed, stale, message, loading, reload }`
 *  🔴 ช่องเลือกที่ต้องบอกว่า "ลิสต์ว่างเพราะไม่มีของ หรือเพราะโหลดไม่สำเร็จ" ใช้ตัวนี้
 *     (ตัว default คืนแค่แถว = พฤติกรรมเดิม ไม่ต้องแก้จุดเรียกเก่า) */
export function useCustomersState() { return useMasterRows(KEY, loadCustomers); }

export default function useCustomers() { return useCustomersState().rows; }
