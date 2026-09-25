/* ═══ opItems — รายการ "ขั้นตอน (Operation)" ใต้พาร์ทจริง (เฟส 1 ของแบบ C · 2026-08-17) ═══
   งานขับนัท SUB APRON ถูกลงทะเบียนเป็น product แยก 1 ตัวต่อ 1 OP (M6/M8/M10 ไม่มีเกลียว ฯลฯ)
   เพื่อให้เครื่องแต่ละตัวมีใบงานบนบอร์ด — แต่ชิ้นเดียวกันเลยถูกนับยอด "ผลิตได้" ซ้ำหลายรอบ
   ธง is_operation + op_parent_mat (dr_products · migration 20260817_operation_items_dr) บอกระบบว่า
   รายการไหนเป็น "ขั้น" ของพาร์ทจริงตัวไหน → จอสรุปภาพใหญ่ collapse ผ่าน collapseOps (pairTotals.js)

   การใช้: loader ของหน้า await loadOpInfo() (cache ระดับ module) แล้วจุดคำนวณอ่าน opInfoSync()
   best-effort: migration ยังไม่ apply / query พัง → คืน {} = พฤติกรรมเดิมเป๊ะ ไม่มีอะไรพัง
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { loadProductsMaster, invalidateProducts } from './useProducts'

let _cache = null

/** โหลด map ของรายการ OP: { [mat_no]: { parent, seq } }
 *  parent ว่างได้เสมอ = ของที่ขั้นนี้ประกอบมาไม่มีใบผลิตของตัวเอง (ดู src/utils/opLink.js)
 *
 *  25/09: เดิมยิง `dr_products` เองแล้ว cache ไว้ใน**ตัวแปรของโมดูล** ⇒ หายทุกครั้งที่เปิดแอปใหม่
 *  (วัดจริง 481 ครั้ง/วัน ≈ จำนวน boot) — ย้ายมาอ่านทะเบียนสินค้าชุดกลางซึ่ง cache ข้าม boot
 *  ใน localStorage อยู่แล้ว · ตัวแปรด้านล่างเหลือไว้เป็น snapshot ให้ `opInfoSync()` อ่านแบบ sync */
export async function loadOpInfo(force = false) {
  if (_cache && !force) return _cache
  try {
    if (force) invalidateProducts()
    const rows = await loadProductsMaster()
    if (!rows) throw new Error('โหลดทะเบียนสินค้าไม่สำเร็จ')
    const m = {}
    rows.forEach(r => {
      if (r.is_operation && r.mat_no) m[r.mat_no] = { parent: r.op_parent_mat || null, seq: r.op_seq ?? null }
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
