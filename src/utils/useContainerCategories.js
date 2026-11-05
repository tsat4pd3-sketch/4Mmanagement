/* ── useContainerCategories — ทะเบียนประเภทภาชนะ (DR `container_categories`)  (2026-11-05) ──
   migration 20261105b_trial_reasons_container_categories_dr.sql · ปลายทาง container_types.category เก็บ **code**
   จัดการที่ /products แท็บ Packaging → จัดการภาชนะ · แก้แล้วเรียก invalidateContainerCategories() */
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'container_categories:master';

/** ชุดเดียวกับ seed — ใช้เมื่อทะเบียนยังโหลดไม่ได้ */
export const DEFAULT_CONTAINER_CATEGORIES = [
  { code: 'BOX', name: 'กล่อง' }, { code: 'RACK', name: 'แร็ค' }, { code: 'BASKET', name: 'ตะกร้า' },
  { code: 'PALLETTE', name: 'พาเลท' }, { code: 'OTHER', name: 'อื่นๆ' },
];

export async function loadContainerCategories() {
  return cachedMaster(KEY, async () => mrows(await supabaseDR.from('container_categories')
    .select('code, name, note, sort_order, is_active').order('sort_order').order('code')));
}
export const invalidateContainerCategories = () => invalidateMaster(KEY);

/** `{ rows, failed, stale, message, loading, reload }` */
export function useContainerCategoriesState() { return useMasterRows(KEY, loadContainerCategories); }

/** ตัวเลือก select — ทะเบียนว่าง = DEFAULT · ค่าเดิมนอกทะเบียนโชว์เป็น "ค่าเดิม" (ห้ามให้ช่องขึ้นตัวแรกแทน) */
export function containerCategoryOptions(rows, current = '') {
  const act = (rows || []).filter(r => r && r.is_active !== false && String(r.code || '').trim());
  const opts = (act.length ? act : DEFAULT_CONTAINER_CATEGORIES)
    .map(r => ({ value: String(r.code).trim(), label: r.name ? `${String(r.code).trim()} · ${r.name}` : String(r.code).trim() }));
  const cur = String(current ?? '').trim();
  if (cur && !opts.some(o => o.value === cur)) opts.unshift({ value: cur, label: `${cur} (ค่าเดิม · ไม่อยู่ในทะเบียน)`, legacy: true });
  return opts;
}
