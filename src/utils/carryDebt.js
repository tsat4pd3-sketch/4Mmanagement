/* ═══ 📥 ของค้างที่ยังไม่มีใครรับ — "ต้องไล่เก็บอีกเท่าไหร่" ═════════════════════════════
 *
 * ที่มา (2026-10-20 · แชทหน้างาน):
 *   user:  *"ไม่ใช่เปิดตามที่จะผลิตได้ **ตามหลักต้องเปิดให้เห็นว่า ต้องไล่เก็บอีกแค่ไหน**"*
 *   JongZ: *"นั่นละปัญหาเลยครับ **มันหาย** เขาเลยเลือกที่จะทยอยปริ้นครับ"*
 *
 * 🕳️ **ต้นเหตุที่ "มันหาย"** (วัดจริง 20/10): ตัวหายอดค้างเดิมดึง "ใบของ **8 กะล่าสุด**" ของไลน์
 *    ไลน์เดิน 2 กะ/วัน ⇒ 8 กะ ≈ **4 วัน** · ของที่ค้างเกินนั้น**หลุดหน้าต่างแล้วหายถาวร**
 *    ของจริงที่หายตอนวัด: Assembly Line D 4 ใบ (8 วัน) · LASER E50 (28) · Line 60 3 ใบ (33) · LWR BAR (97)
 *    ⇒ แก้ที่ **แหล่งข้อมูล** (ถามด้วย "สถานะ" ไม่ใช่ "กี่กะล่าสุด") ไม่ใช่ขยาย limit
 *      (ขยาย limit = ดึงใบทุกสถานะของหลายสิบกะ = egress บาน · ดูคอมเมนต์ CARRY_COLS ใน DailyReport)
 *
 * ไฟล์นี้ pure — ห้าม import supabase/react · กติกาการตัดสินยกมาจากของเดิมครบทุกข้อ ห้ามตัดทิ้ง
 * 📄 docs/modules/daily-report.md §ของค้าง
 * ═══════════════════════════════════════════════════════════════════════════════════ */

/** สถานะที่แปลว่า "งานนี้ยังค้างอยู่จริง" — ที่เหลือคือจบแล้ว/ถูกรับไปแล้ว */
export const PENDING_STATUSES = ['open', 'carry_over'];
/** กะที่ "ยอดค้างของมันหยิบมาได้" — กะที่ยัง `open` ห้ามหยิบ (เจ้าของกะยังทำงานอยู่) */
export const TAKEABLE_SESSION_STATUSES = ['closed', 'pending_close'];

/**
 * เลือกใบที่ควรเสนอให้กะนี้ "รับยอดค้าง"
 *
 * กติกา (ยกมาจากของเดิมทั้งหมด — แต่ละข้อมาจาก feedback หน้างานจริง **ห้ามตัด**):
 *  ① ใบล่าสุดของ `prod_no` นั้นต้องยังค้างจริง (`open`/`carry_over`)
 *     — `confirmed` = กะหลังทำจบแล้ว · `cancelled` = ยกเลิกแล้ว ⇒ ห้ามปลุกใบเก่าขึ้นมาเสนอซ้ำ
 *  ② 🔴 **`imported` ห้ามเป็น "ใบล่าสุด"** (09/09 Assy LWR) — `imported` แปลว่า "ถูกกะอื่นรับไปแล้ว"
 *     = **มีใบต่อจากมันเสมอ** ไม่ใช่จุดจบ · ถ้าปล่อยให้ชนะ rank จะทับใบ `carry_over` ตัวจริง
 *     ⇒ กะถัดไปไม่เห็นยอดค้างเลย
 *  ③ กะต้นทางต้องปิดแล้ว/ขอปิดแล้ว (กะที่ยัง `open` = เจ้าของยังทำอยู่ ห้ามแย่ง)
 *  ④ `prod_no` ที่รับเข้ากะนี้แล้ว ไม่เสนอซ้ำ
 *  ⑤ ผลิตครบเป้าแล้ว (`qty_actual >= qty`) ไม่ใช่ยอดค้าง — ไม่งั้นกลายเป็น "ผีค้าง" ทุกกะ
 *
 * @param {Array}    rows             ใบของ prod_no ที่มีหนี้ค้าง — **ทุกสถานะ** (ต้องรู้ว่ามีใบใหม่กว่าไหม)
 * @param {Function} rankOf           (row) => number · 0 = กะใหม่สุด (ใช้ตัดสินว่าใบไหน "ล่าสุด")
 * @param {Set}      currentProdNos   prod_no ที่อยู่ในกะปัจจุบันแล้ว
 * @param {Function} isTakeable       (row) => boolean · กะต้นทางหยิบได้ไหม
 * @returns {Array} ใบที่ควรเสนอ
 */
export function carryOffers({ rows = [], rankOf = () => 99, currentProdNos = new Set(), isTakeable = () => true } = {}) {
  const latest = {};
  for (const o of rows || []) {
    if (!o?.prod_no) continue;
    const cur = latest[o.prod_no];
    const r = rankOf(o) ?? 99;
    const sup = o.status === 'imported' ? 1 : 0;      // ② 0 = ยังพูดแทนงานนี้ได้ · 1 = ถูกรับไปแล้ว
    if (!cur || sup < cur.sup || (sup === cur.sup && r < cur.rank)) latest[o.prod_no] = { row: o, rank: r, sup };
  }
  return Object.values(latest).map(x => x.row).filter(o => {
    if (currentProdNos.has(o.prod_no)) return false;                    // ④
    if (!PENDING_STATUSES.includes(o.status)) return false;             // ①
    if (!isTakeable(o)) return false;                                   // ③
    if ((Number(o.qty_actual) || 0) >= (Number(o.qty) || 0)) return false; // ⑤
    return true;
  });
}

/** ยอดที่ยังต้องไล่เก็บของใบนี้ (ชิ้น) — `qty - qty_actual` ไม่ติดลบ */
export const debtPcs = (o) => Math.max(0, (Number(o?.qty) || 0) - (Number(o?.qty_actual) || 0));

/** ค้างมากี่วัน — นับจากวันงานของกะต้นทาง · ไม่รู้วัน = `null` **ห้ามคืน 0** (0 = "ของวันนี้")
 *  🔴 รับ `today` เป็นพารามิเตอร์เสมอ (เทสตรึงเวลาได้ · กฎ "เทสระเบิดเวลา" ใน build-gates) */
export function debtAgeDays(workDate, today) {
  if (!workDate || !today) return null;
  const a = Date.parse(`${String(workDate).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** สรุปหนี้ต่อพาร์ท — จอต้องตอบ user ได้ว่า "ต้องไล่เก็บอีกแค่ไหน"
 *  @returns [{ mat_no, part_name, pcs, cards, oldestDays }] เรียงหนี้มาก→น้อย */
export function debtByPart(offers = [], today = null, workDateOf = (o) => o?.work_date) {
  const by = new Map();
  for (const o of offers || []) {
    if (!o) continue;
    const k = o.mat_no || o.prod_no || '—';
    const cur = by.get(k) || { mat_no: o.mat_no || '', part_name: o.part_name || '', pcs: 0, cards: 0, oldestDays: null };
    cur.pcs += debtPcs(o);
    cur.cards += 1;
    const age = debtAgeDays(workDateOf(o), today);
    /* 🔴 อายุที่คำนวณไม่ได้ ต้องไม่ไปกดให้ "เก่าสุด" เพี้ยน — เก็บเฉพาะค่าที่รู้จริง */
    if (age != null) cur.oldestDays = cur.oldestDays == null ? age : Math.max(cur.oldestDays, age);
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.pcs - a.pcs);
}
