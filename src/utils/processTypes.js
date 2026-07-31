/**
 * กระบวนการผลิต (process types) — master data-driven (ตาราง `process_types` ฝั่ง DR · 2026-07-23)
 * เดิม hardcode welding_assembly/metal_forming ในหลายหน้า — ตอนนี้ user เพิ่ม/แก้เองได้จาก
 * Daily Report → ⚙️ ตั้งค่า → 🏭 กระบวนการ แล้วทุกจุดใช้ร่วมกันผ่าน util นี้
 * ค่า 'common' = sentinel "ทุกกระบวนการ" ไม่อยู่ในตาราง (dropdown เติมเองต่อจุด)
 * fallback DEFAULT_PROCESS_TYPES เสมอ — ตาราง/เน็ตล่ม = พฤติกรรมเดิมเป๊ะ
 */
import { supabaseDR } from '../supabaseClient';

export const DEFAULT_PROCESS_TYPES = [
  { key: 'welding_assembly', label: 'Welding / Assembly', icon: '🔥', color: '#f97316', sort_order: 1, is_active: true },
  { key: 'metal_forming', label: 'Metal Forming', icon: '⚙', color: '#3b82f6', sort_order: 2, is_active: true },
];

let cache = null;

export async function loadProcessTypes(force = false) {
  if (cache && !force) return cache;
  try {
    const { data, error } = await supabaseDR.from('process_types').select('*').order('sort_order');
    if (error) throw error;
    cache = (data && data.length) ? data : DEFAULT_PROCESS_TYPES;
  } catch { cache = cache || DEFAULT_PROCESS_TYPES; }
  return cache;
}

/** ใช้หลัง loadProcessTypes() แล้ว (เรียกที่ module/mount ของหน้า) */
export function processTypesSync() { return cache || DEFAULT_PROCESS_TYPES; }

export function activeProcessTypes() { return processTypesSync().filter(p => p.is_active !== false); }

/** ป้ายแสดงผล เช่น "🔥 Welding / Assembly" — รู้จัก common/ค่าว่างด้วย */
export function procDisplay(key) {
  if (!key) return '❔ ยังไม่กำหนดกระบวนการ';
  if (key === 'common') return '🔗 ทุกกระบวนการ';
  const p = processTypesSync().find(x => x.key === key);
  return p ? `${p.icon || ''} ${p.label}`.trim() : key;
}

export function procColor(key, fallback = '#6b7280') {
  const p = processTypesSync().find(x => x.key === key);
  return p?.color || fallback;
}
