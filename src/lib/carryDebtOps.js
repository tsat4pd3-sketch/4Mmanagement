/* ═══ 📥 ของค้าง — โหลด + รับเข้ากะ (ที่เดียวทั้งระบบ) ═══════════════════════════════════
 *
 * ที่มา (2026-10-20 · คำสั่ง user): *"**กะถัดไปพอเปิดกะก็ต้องรับงานยกยอดออโต้เลย**"*
 * ⇒ มีผู้เรียก 2 ทาง — ตอนเปิดกะ (อัตโนมัติ) และปุ่ม "📥 รับยอดต่อ" (คนกดเอง)
 *   **ห้ามก๊อปตรรกะไปไว้ 2 ที่** (กฎ CLAUDE.md: สูตรกลางอยู่ที่เดียว)
 *
 * 🧩 ทำไม "รับออโต้" ถึงปลอดภัยแล้ว (ก่อนหน้านี้ไม่ปลอดภัย):
 *   เดิมรับเข้ามาแล้ว **ต้องจ่ายตอนปิดกะ** (ตัดสินใจทีละใบ หรือกดยกเลิก) ⇒ หน้างานเลยไม่กดรับ
 *   ตอนนี้ใบที่ไม่ได้แตะ **ยกออกเองอัตโนมัติ** (`utils/closeShiftOrders.js`) ⇒ รับเข้ามาไม่มีต้นทุน
 *   ⇒ ของไหลผ่านกะไปเรื่อยๆ จนกว่าจะมีคนทำจริง ตรงกับ *"มันควรจะต้องส่งต่อไปเรื่อยๆ"*
 *   🔴 **ถ้าวันไหนถอด auto-carry ตอนปิดกะออก ต้องถอด auto-import ตอนเปิดกะด้วย**
 *      ไม่งั้นจะกลายเป็น "ยัดงานเข้ากะให้ แล้วบังคับให้ไล่เคลียร์เอง" = แย่กว่าเดิมทั้งคู่
 *
 * 📄 docs/modules/daily-report.md §ของค้าง
 * ═══════════════════════════════════════════════════════════════════════════════════ */
import { supabaseDR } from '../supabaseClient';
import { fetchByIds } from '../utils/fetchByIds';
import { checkWriteRows } from '../utils/dbWrite';
import { carryOffers, debtPcs, PENDING_STATUSES, TAKEABLE_SESSION_STATUSES } from '../utils/carryDebt';

/* 🔴 คอลัมน์ต้องเลือกเท่าที่ใช้ (egress วัดจริง 25/09: `select=*` ที่นี่ = 61% ของ traffic ตารางนี้)
   **เพิ่มฟิลด์ที่ `importCarryOrders` ส่งต่อ = ต้องเติมที่นี่ด้วย** ไม่งั้นค่าหายเงียบ */
export const CARRY_COLS = 'id, session_id, prod_no, mat_no, part_name, p_no, customer, qty, qty_actual, status, is_manual, carry_over_note, opened_at';
const SESS_EMBED = ', production_sessions!inner(id, status, line_name, work_date, shift, created_at)';

/**
 * ของค้างของไลน์นี้ที่ยังไม่มีใครรับ
 * 🔴 **ถามด้วย "สถานะ" ไม่ใช่ "กี่กะล่าสุด"** — ของเดิมดึง 8 กะล่าสุด = หน้าต่าง ~4 วัน
 *    ของที่ค้างเกินนั้นหายถาวร (วัดจริง 20/10: 8 / 28 / 33 / 97 วัน · หน้างานเรียกว่า "มันหาย")
 * @returns {{ offers: Array, error: string|null }} — `error != null` = **ตอบไม่ได้**
 *          ห้ามแปลว่า "ไม่มีของค้าง" (จอต้องเขียนบอก)
 */
export async function loadCarryOffers({ lineName, sessionId, currentProdNos = new Set() } = {}) {
  if (!lineName) return { offers: [], error: null };
  const { data: pending, error: pendErr } = await supabaseDR.from('prod_orders')
    .select(CARRY_COLS + SESS_EMBED)
    .in('status', PENDING_STATUSES)
    .eq('production_sessions.line_name', lineName)
    .neq('session_id', sessionId || '00000000-0000-0000-0000-000000000000');
  if (pendErr) return { offers: [], error: pendErr.message };

  const prodNos = [...new Set((pending || []).map(o => o.prod_no).filter(Boolean))];
  if (!prodNos.length) return { offers: [], error: null };

  /* ประวัติเฉพาะ `prod_no` ที่ค้าง — ต้องรู้ว่ามีใบ "ใหม่กว่า" ที่จบไปแล้วหรือยัง (กฎ ①②)
     `.in()` ยาว = URL เกินเพดาน proxy แล้วคืนค่าว่างเงียบ ⇒ ผ่าน fetchByIds เสมอ */
  const hist = await fetchByIds(prodNos, (part) => supabaseDR.from('prod_orders')
    .select(CARRY_COLS + SESS_EMBED)
    .eq('production_sessions.line_name', lineName)
    .in('prod_no', part));
  if (hist.failed || hist.truncated) return { offers: [], error: hist.error || 'โหลดประวัติใบไม่ครบ' };

  const rows = hist.rows || [];
  /* rank = ความใหม่ของกะ (0 = ใหม่สุด) */
  const order = [...new Set(rows.map(o => o.production_sessions?.created_at).filter(Boolean))]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const rankByTime = new Map(order.map((t, i) => [t, i]));
  const takeable = new Set(TAKEABLE_SESSION_STATUSES);
  return {
    offers: carryOffers({
      rows,
      rankOf: (o) => rankByTime.get(o.production_sessions?.created_at) ?? 99,
      currentProdNos,
      isTakeable: (o) => takeable.has(o.production_sessions?.status),
    }),
    error: null,
  };
}

/** ปิดใบต้นทางทุกใบของ prod_no นี้ที่ยังค้างอยู่นอกกะปัจจุบัน
 *  🔴 ต้อง**นับแถว** — ไม่ปิดต้นทาง = แบนเนอร์ไม่เคลียร์ แล้วใบเดิมถูกรับซ้ำรอบหน้า (เป้านับซ้ำ) */
const closeSource = async (prodNo, sessionId) => {
  /* ⚠️ `checkWriteRows` รับ "ผลลัพธ์ที่ await แล้ว" — ส่ง query builder เข้าไปตรงๆ = นับแถวไม่ได้
     แล้วถอยไปโหมด checkWrite เงียบๆ (RLS ปฏิเสธ = 0 แถว ไม่มี error ⇒ กลืนหมด) */
  const res = await supabaseDR.from('prod_orders').update({ status: 'imported' })
    .eq('prod_no', prodNo).in('status', PENDING_STATUSES).neq('session_id', sessionId).select('id');
  return checkWriteRows(res, 'ปิดใบต้นทาง', {
    zeroMsg: `ไม่ได้ปิดใบต้นทาง ${prodNo} (0 แถว — อาจมีกะอื่นปิดไปแล้ว) · ถ้าแบนเนอร์ยอดค้างยังไม่หาย กดรับยอดอีกครั้ง`,
  });
};

/**
 * รับของค้างเข้ากะ — ใช้ทั้งตอนเปิดกะ (อัตโนมัติ) และปุ่ม "รับยอดต่อ"
 * @returns {{ imported:number, pcs:number, failed:number }}
 */
export async function importCarryOrders({ session, offers = [], existingProdNos = new Set(), openedAt = null, by = '' } = {}) {
  if (!session?.id) return { imported: 0, pcs: 0, failed: 0 };
  let imported = 0, pcs = 0, failed = 0;
  for (const o of offers) {
    /* มีในกะนี้แล้ว / ผลิตครบเป้าแล้ว = ไม่ต้องสร้างใบใหม่ แค่ปิดต้นทางไม่ให้เตือนค้างอีก */
    const remainQty = debtPcs(o);
    if (existingProdNos.has(o.prod_no) || remainQty <= 0) {
      await closeSource(o.prod_no, session.id);
      continue;
    }
    const { error } = await supabaseDR.from('prod_orders').insert({
      session_id: session.id,
      prod_no: o.prod_no, mat_no: o.mat_no, part_name: o.part_name, p_no: o.p_no, customer: o.customer,
      qty: remainQty, status: 'open', opened_by: by,
      /* ⚠️ ธงใบ manual ต้องตามใบยกยอดไปด้วย (QC flow-audit #13) — หายแล้วปุ่ม "ปิดใบนี้ (ยอดจริง)" หาย
         ⇒ ต้องพิมพ์ MANUAL-… ปิดแบบสแกน = `qty_ok` ถูกตั้งเป็นเป้าแทนยอดจริง */
      ...(o.is_manual ? { is_manual: true, qty_target: remainQty } : {}),
      qty_actual: 0,
      carry_over_from_session_id: o.session_id,
      carry_over_note: o.carry_over_note || `ค้างจากกะก่อน (ทำได้ ${o.qty_actual || 0}/${o.qty} ชิ้น)`,
      ...(openedAt ? { opened_at: openedAt } : {}),
    });
    if (error) { failed++; continue; }
    imported++; pcs += remainQty;
    await closeSource(o.prod_no, session.id);
  }
  return { imported, pcs, failed };
}
