/* ═══ opItems — รายการ "ขั้นตอน (Operation)" ใต้พาร์ทจริง (เฟส 1 ของแบบ C · 2026-08-17) ═══
   งานขับนัท SUB APRON ถูกลงทะเบียนเป็น product แยก 1 ตัวต่อ 1 OP (M6/M8/M10 ไม่มีเกลียว ฯลฯ)
   เพื่อให้เครื่องแต่ละตัวมีใบงานบนบอร์ด — แต่ชิ้นเดียวกันเลยถูกนับยอด "ผลิตได้" ซ้ำหลายรอบ
   ธง is_operation + op_parent_mat (dr_products · migration 20260817_operation_items_dr) บอกระบบว่า
   รายการไหนเป็น "ขั้น" ของพาร์ทจริงตัวไหน → จอสรุปภาพใหญ่ collapse ผ่าน collapseOps (pairTotals.js)

   การใช้: loader ของหน้า await loadOpInfo() (cache ระดับ module) แล้วจุดคำนวณอ่าน opInfoSync()
   best-effort: migration ยังไม่ apply / query พัง → คืน {} = พฤติกรรมเดิมเป๊ะ ไม่มีอะไรพัง
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { loadProductsMaster, invalidateProducts } from './useProducts'
import { partCoreOf } from './partGroup'

let _cache = null

/** โหลด map ของรายการ OP: { [mat_no]: { parent, seq, alts? } }
 *  parent ว่างได้เสมอ = ของที่ขั้นนี้ประกอบมาไม่มีใบผลิตของตัวเอง (ดู src/utils/opLink.js)
 *
 *  🔴 `alts` = MAT อื่นที่เป็น **สินค้าตัวเดียวกับ `parent`** (คนละลูกค้า → คนละ MAT SAP คนละบิล
 *  แต่พาร์ทเดียวกัน · คำสั่ง user 05/10) จับกลุ่มด้วย **แกน `p_no` เท่านั้น ห้ามใช้ชื่อ**
 *  — `op_parent_mat` ชี้ได้ MAT เดียว ⇒ วันที่ไลน์รันลูกค้าอื่น ขั้นตอนจะไม่ยุบแล้วนับซ้ำ
 *  (วัดจริง 05/10: 27 กะ · 18,659 ชิ้น) · ตัวตัดสินอยู่ที่ `collapseOps` (pairTotals.js)
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
    /* แกน p_no → MAT ของ "พาร์ทจริง" ทุกตัวในแกนนั้น — **ตัดแถว OP ออก** (ขั้นตอนไม่ใช่ตัวจริง
       และ p_no ของขั้นมักเป็นเลขวัตถุดิบ/เลขส่งออก ซึ่งจับกลุ่มกับพาร์ทจริงไม่ได้) */
    const membersOf = {}, coreOf = {}
    rows.forEach(r => {
      if (!r.mat_no || r.is_operation) return
      const c = partCoreOf(r.p_no)
      if (!c) return
      coreOf[r.mat_no] = c
      ;(membersOf[c] = membersOf[c] || []).push(r.mat_no)
    })
    const m = {}
    rows.forEach(r => {
      if (!(r.is_operation && r.mat_no)) return
      const parent = r.op_parent_mat || null
      const core = parent ? coreOf[parent] : null
      const alts = core ? (membersOf[core] || []).filter(x => x !== parent) : []
      m[r.mat_no] = { parent, seq: r.op_seq ?? null, ...(alts.length ? { alts } : {}) }
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
