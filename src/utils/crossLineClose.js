/* ═══ 📤 ปิดใบผลิตข้ามไลน์ — "สแกนจากจอไหนก็ปิดได้" (2026-10-30 · คำสั่ง user) ═════════
 *
 * ที่มา: *"ตอนสแกนปิดออเดอร์ปัจจุบัน เราต้องปิดผ่านไลน์ใครไลน์มัน … เป็นไปได้ไหมว่า
 *          เวลาปิดออเดอร์ให้สแกนจากไลน์ไหนก็ได้ เพราะพอสแกนเจอเลขโค้ดออเดอร์
 *          มันก็จะเจอว่ามันเปิดออเดอร์ไหน แล้วก็ปิดได้เลย แค่ให้คอนเฟิร์ม"*
 *
 * เดิมโมดัล "Scan ปิด / Confirm" ค้นเฉพาะใบใน **กะที่เลือกอยู่** (`prodOrders`)
 * สแกนใบของไลน์ข้างๆ = ตีกลับ `✕ ไม่พบ PROD.NO นี้ในกะปัจจุบัน` = ทางตัน
 *
 * ไฟล์นี้ **pure** — ห้าม import supabase/react (มีเทส · เป็นตัวตัดสินที่ grep ได้)
 *
 * 🔴 กติกา 3 ข้อที่ห้ามถอด (เหตุผลอยู่กับแต่ละข้อ):
 *   ① `prod_no` **ไม่ unique เชิงโครงสร้าง** — ไม่มี unique index และของจริงมีใบที่ prod_no
 *      เป็นเลขสั้นมาก (วัดจริง 30/10: LINE A 800 Ton ใช้ `35`/`42`/`43`/`45`)
 *      ⇒ เจอมากกว่า 1 ใบ = **ห้ามเดา** ต้องให้คนเลือกไลน์เอง
 *   ② กะเจ้าของใบต้องยัง `open` — กะที่ `pending_close`/`closed` **stamp ยอด/OEE ลง
 *      `production_sessions` ไปแล้ว** ปิดใบย้อนหลังทำให้เลขที่ stamp ไม่ตรงกับใบ
 *      (เหตุผลเดียวกับที่ปุ่ม "ถอยใบ" บล็อกหลังปิดกะ)
 *   ③ ปิดใบของไลน์อื่น = **เขียนข้ามหน่วยงาน** ⇒ ต้องผ่าน `canWriteLine` (ชั้นที่ 3)
 *      ฝั่ง DR วิ่งด้วย role `anon` **ไม่มีด่านฝั่ง DB เลย** จอเป็นด่านเดียวที่มี
 *
 * 📄 docs/modules/daily-report.md §ปิดใบข้ามไลน์
 * ═══════════════════════════════════════════════════════════════════════════════════ */

/** คอลัมน์ที่คิวรีข้ามไลน์ต้องดึง — egress: ห้าม `select('*')` (ตารางนี้กว้าง)
 *  🔴 เพิ่มฟิลด์ที่หน้าจอ/ตัวเขียนใช้ = ต้องเติมที่นี่ ไม่งั้นค่าหายเงียบ */
export const CROSS_CLOSE_COLS =
  'id, prod_no, mat_no, part_name, qty, qty_actual, qty_ok, status, is_manual, qty_target, session_id';

/** กะของใบ (embed `production_sessions!inner`) */
const sessOf = (r) => r?.production_sessions || null;

/**
 * ตัดสินว่าใบที่สแกนเจอ "ปิดข้ามไลน์ได้ไหม"
 *
 * @param {Array}  rows             ใบที่คิวรีได้จาก prod_no นี้ (ทุกไลน์)
 * @param {string} currentSessionId กะที่เปิดจออยู่ — ใบของกะนี้ไม่ใช่งานของตัวนี้ (ทางปกติจัดการแล้ว)
 * @returns {{ state:'none'|'ambiguous'|'shift_locked'|'ready', row:Object|null, rows:Array }}
 */
export function crossLineCloseState({ rows = [], currentSessionId = null } = {}) {
  /* กันไว้ 2 ชั้น: คิวรีกรอง `status='open'` แล้ว แต่ถ้าใครแก้คิวรีทีหลัง ที่นี่ยังกรองอีกรอบ
     — ใบ confirmed/cancelled/imported **ห้ามปิดซ้ำ** */
  const open = (rows || []).filter(r => r?.status === 'open');
  /* ใบของกะที่เปิดจออยู่ = ทางเดิม (`prodOrders`) จัดการเอง — ไม่ใช่เคส "ข้ามไลน์" */
  const other = open.filter(r => String(r?.session_id || '') !== String(currentSessionId || ''));
  if (other.length === 0) return { state: 'none', row: null, rows: [] };
  /* ① เลขซ้ำ = ห้ามเดา */
  if (other.length > 1) return { state: 'ambiguous', row: null, rows: other };
  const row = other[0];
  /* ② กะเจ้าของใบปิด/ขอปิดไปแล้ว = ยอดถูก stamp แล้ว ห้ามปิดใบย้อนหลัง */
  if (sessOf(row)?.status !== 'open') return { state: 'shift_locked', row, rows: other };
  return { state: 'ready', row, rows: other };
}

/** ชื่อไลน์เจ้าของใบ — ใช้ทั้งข้อความบนจอและ `canWriteLine` (ชั้นที่ 3)
 *  🔴 ไม่รู้ชื่อไลน์ = `''` **ห้ามคืนชื่อไลน์ที่เปิดจออยู่แทน** (จะกลายเป็นเช็คสิทธิ์ผิดไลน์) */
export const crossLineNameOf = (row) => sessOf(row)?.line_name || '';

/** ป้ายกะของใบ — "☀️ กะเช้า 30/10/26" */
export function crossLineWhen(row) {
  const s = sessOf(row);
  if (!s) return '';
  const d = String(s.work_date || '').slice(0, 10);
  const th = d ? d.split('-').reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join('/') : '';
  const sh = s.shift === 'night' ? '🌙 กะดึก' : s.shift === 'day' ? '☀️ กะเช้า' : '';
  return [sh, th].filter(Boolean).join(' ');
}

/** ข้อความที่ต้องขึ้นบนจอของแต่ละสถานะ — **ห้ามเงียบ** (จอต้องตอบได้ว่าทำไมปิดไม่ได้) */
export function crossLineCloseText(state, row) {
  const where = row ? `${crossLineNameOf(row) || 'ไลน์ที่ไม่รู้จัก'} · ${crossLineWhen(row)}` : '';
  switch (state) {
    case 'ambiguous':
      return 'เลข PROD.NO นี้เปิดค้างอยู่หลายใบในหลายไลน์ — ระบบไม่เดาให้ เลือกใบที่จะปิดเอง';
    case 'shift_locked':
      return `ใบนี้เป็นของ ${where} ซึ่ง**ปิดกะ/ส่งขอปิดไปแล้ว** — ยอดกับ OEE ของกะนั้นถูกสรุปไปแล้ว`
        + ' ปิดใบย้อนหลังจะทำให้ตัวเลขไม่ตรงกัน · ให้เจ้าของกะเปิดกะนั้นขึ้นมาจัดการเอง';
    case 'ready':
      return `ใบนี้ไม่ได้อยู่ในกะที่เปิดอยู่ — เป็นของ ${where}`;
    default:
      return '';
  }
}
