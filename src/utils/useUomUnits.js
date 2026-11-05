/* ── useUomUnits — ทะเบียนหน่วยนับ (DR `uom_units`) สำหรับช่องเลือกหน่วย  (2026-11-05) ──
   migration 20261105_uom_units_dr.sql · กฎแม็ป EA/pcs → PC อยู่ `utils/uom.js` (normUom) ที่เดียว
   จัดการที่ /products แท็บ 📏 หน่วยนับ · แก้แล้วเรียก invalidateUomUnits() */
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import useMasterRows from './useMasterRows.js';

const KEY = 'uom_units:master';

export async function loadUomUnits() {
  return cachedMaster(KEY, async () => {
    // ยังไม่ apply migration → `mrows` คืน [] ⇒ ผู้เรียกถอยไปใช้ DEFAULT_UOMS · error อื่นโยน
    return mrows(await supabaseDR.from('uom_units')
      .select('code, name, aliases, sort_order, is_active').order('sort_order').order('code'));
  });
}
export const invalidateUomUnits = () => invalidateMaster(KEY);

/** `{ rows, failed, stale, message, loading, reload }` — ส่ง `failed` เข้าข้อความเตือนของช่อง (UI §6.26) */
export function useUomUnitsState() { return useMasterRows(KEY, loadUomUnits); }

export default function useUomUnits() { return useUomUnitsState().rows; }
