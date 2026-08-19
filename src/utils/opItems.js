/* ═══ opItems — รายการ "ขั้นตอน (Operation)" ใต้พาร์ทจริง (เฟส 1 ของแบบ C · 2026-08-17) ═══
   งานขับนัท SUB APRON ถูกลงทะเบียนเป็น product แยก 1 ตัวต่อ 1 OP (M6/M8/M10 ไม่มีเกลียว ฯลฯ)
   เพื่อให้เครื่องแต่ละตัวมีใบงานบนบอร์ด — แต่ชิ้นเดียวกันเลยถูกนับยอด "ผลิตได้" ซ้ำหลายรอบ
   ธง is_operation + op_parent_mat (dr_products · migration 20260817_operation_items_dr) บอกระบบว่า
   รายการไหนเป็น "ขั้น" ของพาร์ทจริงตัวไหน → จอสรุปภาพใหญ่ collapse ผ่าน collapseOps (pairTotals.js)

   การใช้: loader ของหน้า await loadOpInfo() (cache ระดับ module) แล้วจุดคำนวณอ่าน opInfoSync()
   best-effort: migration ยังไม่ apply / query พัง → คืน {} = พฤติกรรมเดิมเป๊ะ ไม่มีอะไรพัง
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { supabaseDR } from '../supabaseClient'

let _cache = null

/** โหลด map ของรายการ OP: { [mat_no]: { parent, seq } } — cache ครั้งเดียวต่อ session */
export async function loadOpInfo(force = false) {
  if (_cache && !force) return _cache
  try {
    const { data, error } = await supabaseDR
      .from('dr_products')
      .select('mat_no, op_parent_mat, op_seq')
      .eq('is_operation', true)
    if (error) throw error
    const m = {}
    ;(data || []).forEach(r => {
      if (r.mat_no) m[r.mat_no] = { parent: r.op_parent_mat || null, seq: r.op_seq ?? null }
    })
    _cache = m
  } catch (e) {
    // คอลัมน์ยังไม่มี (migration ยังไม่ apply) หรือ query ล้ม → ไม่ collapse = ยอดนับแบบเดิม
    console.warn('loadOpInfo:', e?.message || e)
    _cache = {}
  }
  return _cache
}

/** map ล่าสุดจาก cache ({} จนกว่าจะมีใครเรียก loadOpInfo) — ใช้ในจุดคำนวณ/useMemo */
export const opInfoSync = () => _cache || {}

/** mat นี้เป็นรายการขั้นตอน (OP) ไหม */
export const isOpMat = (mat) => !!(_cache && _cache[mat])
