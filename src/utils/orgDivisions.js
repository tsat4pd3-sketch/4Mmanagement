import { supabase } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from './masterCache';

/* ══ 🏢 ฝ่าย (Division) — ชั้นบนสุดของผังองค์กร · single source of truth ═══════════════
   ผังจริง ORG001_TSAT4_Overall Rev.09 มี 3 ชั้น: **ฝ่าย → ส่วน → แผนก/กลุ่ม**
   เก็บที่ `org_nodes.kind='division'` (migration `20260819_org_division_level.sql`)
   จัดการที่หน้า `/org-setup` คอลัมน์แรก

   ⚠️ กฎเหล็ก — **ห้าม hardcode ชื่อฝ่าย/cost center ในหน้าใดๆ**
   เปลี่ยนชื่อฝ่ายที่ /org-setup แล้วทุกหน้าต้องตามทันทีโดยไม่ต้องแก้โค้ด
   (เคยพลาดมาแล้วที่ /flow-tower รอบแรก — เขียนชื่อฝ่ายกับเลข cost center ไว้ในไฟล์หน้า)

   หน้าที่ต้องอ้างถึง "ฝ่าย" ให้อ้างด้วย **`code`** (LOG/ENG/PRD/MTN/SUP) ซึ่งนิ่งกว่าชื่อ
   แล้วเอาชื่อ/cost center จากที่นี่ · ไม่เจอ code = คืน null **ห้าม fallback เป็นชื่อที่เดาเอง**
   ═════════════════════════════════════════════════════════════════════════════════════ */

const KEY = 'org_divisions';

/** โหลดฝ่ายทั้งหมด (cache ตาม MASTER_TTL) → [{id, code, name, cost_center, sort_order}] */
export async function loadOrgDivisions() {
  return cachedMaster(KEY, async () => {
    const { data, error } = await supabase
      .from('org_nodes')
      .select('id, code, name, cost_center, sort_order, is_active')
      .eq('kind', 'division')
      .order('sort_order');
    // ⚠️ อ่านไม่ได้ = คืน [] แล้วให้หน้าจอบอกว่า "ยังไม่รู้ฝ่าย" — ห้ามแต่งชื่อฝ่ายขึ้นมาเอง
    if (error) { console.warn('loadOrgDivisions:', error.message); return []; }
    return (data || []).filter(d => d.is_active !== false);
  });
}

/** ล้าง cache — เรียกหลังแก้ผังที่ /org-setup */
export function invalidateOrgDivisions() { invalidateMaster(KEY); }

/** สร้างตัวค้นหาแบบ sync จากผลที่โหลดมาแล้ว */
export function divisionIndex(divisions) {
  const byCode = new Map();
  (divisions || []).forEach(d => { if (d.code) byCode.set(String(d.code).toUpperCase(), d); });
  return {
    /** คืน division ตาม code · ไม่เจอ = null (คนเรียกต้องจัดการเอง ห้ามเดาชื่อ) */
    byCode: (code) => (code ? byCode.get(String(code).toUpperCase()) || null : null),
    /** ชื่อฝ่ายสำหรับแสดงผล — ไม่เจอให้บอกตรงๆ ว่ายังไม่ได้ตั้งในผัง */
    labelOf: (code) => byCode.get(String(code || '').toUpperCase())?.name || 'ยังไม่ได้ตั้งฝ่ายในผังองค์กร',
    all: divisions || [],
  };
}
