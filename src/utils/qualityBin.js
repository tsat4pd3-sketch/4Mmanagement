/**
 * qualityBin — กติกาของถังเหลือง/ถังแดง ที่ถอดจาก WI จริง (ที่เดียวทั้งระบบ)
 *   WI-PD3-069 Rev.02 "Control of Non-Conforming product" + WI-PD3-087 "การใช้งาน Tag Green/Yellow/Red"
 *
 * ⚠️ ห้าม hardcode เลข 5 / 1 วัน หรือรายชื่อผลพิจารณา QA ซ้ำในหน้าไหนอีก — import จากที่นี่
 *    (บทเรียนเดียวกับ PROBLEM_MIN_MINUTES ที่เคยถูกก๊อปไป 3 จุดแล้วหลุดกันเอง)
 *
 * ⚠️ pure ทั้งไฟล์ — ไม่แตะ DB/DOM ให้เทสได้ · ฟังก์ชันที่กินเวลาปัจจุบันรับ `today` เป็นพารามิเตอร์
 *    (กฎ "เทสระเบิดเวลา" CLAUDE.md — ห้ามอ่านนาฬิกาเองข้างใน)
 */

/* ── §5.6 อายุแท็ก — นับจากวันที่ระบุใน Tag ──────────────────────────────
 * แท็กเหลือง (SUSPECT) 5 วัน · แท็กแดง (REJECT) 1 วัน
 * "วันที่บนแท็ก" ในระบบ = `work_date` (วันที่ลงถัง) ที่กรอกอยู่แล้ว
 *   — ไม่เพิ่มคอลัมน์ tag_date ใหม่ เพราะจะไม่มีจุดกรอก = ช่องตาย (บทเรียน extra.problem 2026-08-28)
 */
export const TAG_MAX_DAYS = { yellow: 5, red: 1 };

/** 'YYYY-MM-DD' → เลขวัน (UTC-based, ไม่กินเวลาเครื่อง) · รูปแบบผิด = null */
const dayNum = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const t = Date.UTC(y, mo - 1, d);
  return Number.isFinite(t) ? t / 86400000 : null;
};

/**
 * อายุแท็กของรายการในถัง
 * @param row    แถว quality_bin_records ({ bin, work_date })
 * @param today  วันทำงานปัจจุบัน 'YYYY-MM-DD' (เรียก getWorkDate() ฝั่งหน้าจอ)
 * @returns { days, limit, over, overBy } · null เมื่อข้อมูลไม่พอ (ห้ามเดาเป็น 0)
 */
export function binTagAge(row, today) {
  const a = dayNum(row?.work_date);
  const b = dayNum(today);
  if (a == null || b == null) return null;
  const days = Math.max(0, b - a);
  const limit = TAG_MAX_DAYS[row?.bin];
  if (limit == null) return { days, limit: null, over: false, overBy: 0 };
  return { days, limit, over: days > limit, overBy: Math.max(0, days - limit) };
}

/* ── §5.4 ผลการพิจารณาของ QA — 4 ทาง ────────────────────────────────────
 * WI เขียนไว้ 3 ทาง (ซ่อม | ทำลาย | ขอใช้) + กรณี "งานดี" ที่ตรวจแล้วใช้ได้
 * ⚠️ null = "ยังไม่พิจารณา" ไม่ใช่ "ไม่มีผล" — จอห้ามเดาผลให้
 */
export const QA_DECISIONS = [
  { value: 'good',      label: '✅ งานดี',  color: '#22c55e',
    hint: 'ตรวจแล้วใช้ได้ → ติดแท็กเขียว FM-QA-098 → กลับเข้ากระบวนการ' },
  { value: 'repair',    label: '🔧 ซ่อม',   color: '#0ea5e9',
    hint: 'ซ่อมตาม SOP/WI (I DO I CHECK) → QA ตรวจ/เซ็นแท็กเขียว → กลับเข้ากระบวนการ' },
  { value: 'use_as_is', label: '📄 ขอใช้',  color: '#a855f7',
    hint: 'ใช้ชิ้นส่วนเป็นกรณีพิเศษ — ต้องมีใบ FM-QA-042 อนุมัติ' },
  { value: 'scrap',     label: '🔴 ทำลาย',  color: '#e05252',
    hint: 'ติดแท็กแดง → ลงถังแดง → ใบรายงานของเสีย FM-PD2-002 → อนุมัติตาม DOA' },
];
export const decisionOf = (v) => QA_DECISIONS.find(d => d.value === v) || null;

/** ทาง "ขอใช้" ต้องมีเลขใบ FM-QA-042 — ไม่มี = ยังปิดไม่ได้ (WI §5.4) */
export const SPECIAL_USE_FORM = 'FM-QA-042';

/**
 * รายการนี้ "ออกจากถัง" แล้วหรือยัง — ใช้ตัดสินว่ายังต้องนับอายุแท็กอยู่ไหม
 *
 * ⚠️ ตั้งใจ **คำนวณจากข้อเท็จจริงที่มีอยู่แล้ว** ไม่เพิ่มคอลัมน์ closed_at ที่ต้องมีคนกดปิด
 *    คอลัมน์แบบนั้นไม่มีใครกด = ของค้างเทียมเต็มจอ แล้วคนเลิกเชื่อจอ
 *
 * เหลือง ปิดเมื่อ: กลับเข้ากระบวนการแล้ว (return_date) · QA ว่างานดี · ขอใช้แล้วมีเลข FM-QA-042
 *                  · ย้ายลงถังแดงไปแล้ว (มีแถวแดงที่ from_yellow_id ชี้มา — ส่งผ่าน hasRedChild)
 * แดง   ปิดเมื่อ: เข้าสายขออนุมัติทำลายแล้ว (มี scrap_report_id)
 */
export function binClosed(row, { hasRedChild = false } = {}) {
  if (!row) return false;
  if (row.bin === 'red') return !!row.scrap_report_id;
  if (row.return_date) return true;
  if (row.qa_decision === 'good') return true;
  if (row.qa_decision === 'use_as_is' && String(row.special_use_doc_no || '').trim()) return true;
  return !!hasRedChild;
}

/**
 * ของค้างเกินอายุแท็ก — สรุปสำหรับป้ายเตือนบนจอ
 * @param rows   แถวในถัง (ถังเดียวกัน)
 * @param today  วันทำงานปัจจุบัน 'YYYY-MM-DD'
 * @param redChildOf  Set ของ id ใบเหลืองที่มีแถวแดงชี้กลับมาแล้ว
 */
export function overdueBins(rows = [], today, redChildOf = new Set()) {
  const out = [];
  for (const r of rows) {
    if (binClosed(r, { hasRedChild: redChildOf.has(r.id) })) continue;
    const age = binTagAge(r, today);
    if (age?.over) out.push({ row: r, age });
  }
  return out.sort((a, b) => b.age.days - a.age.days);
}

/* ── 🟡 ทุกบันทึกงานเสีย = ของเข้า "ถังเหลือง" รอพิจารณา (2026-11-05 · คำสั่ง user) ──────
 *
 * user: *"พอลงว่ามีงานเสีย ต้องเด้งเข้าถังเหลืองอัตโนมัติเลย เพื่อพิจารณาว่ากลับมาดีได้
 *         หรือเสียแน่ๆ"*
 *
 * 🔴 **กฎนี้แทนกฎเดิม** ("ห้ามสร้างใบถังอัตโนมัติ ต้องมีคนกดยืนยัน" · 19/08) — user สั่งเปลี่ยนชัดเจน
 *    เหตุผลที่เปลี่ยนมีหลักฐาน: วัด 90 วัน (05/11) ของเสีย 252 รายการ ผูกใบถังแค่ 46 = 18%
 *    ⇒ "ต้องมีคนกด" แปลว่า 82% ของของจริงในถัง ระบบไม่รู้ว่ามีอยู่ · ถังเหลืองทั้งระบบมี 1 ใบ
 *    ⇒ สลับเป็น **ระบบตั้งแท็กรอพิจารณาให้ · คนตัดสินผล** (การตัดสินยังเป็นของคนเหมือนเดิม)
 *
 * 🔴 ลำดับนี้ตรงกับ WI/ฟอร์มกระดาษอยู่แล้ว: ต้องสงสัย → ซ่อม → OK กลับเข้ากระบวนการ ·
 *    NG → ติดแท็กแดง → ถังแดง → ใบรายงานของเสีย ⇒ **ถังเหลืองคือ "กล่องขาเข้า" ไม่ใช่ทางเลือก**
 *
 * ⚠️ **ไม่แตะสูตร %Q** — `suspectState()` ตัดสินจาก `qty_suspect` เท่านั้น (คืน `'none'` ทันทีเมื่อ
 *    ไม่มีของสงสัย) ⇒ ใบเหลืองที่สร้างจากแถว NG ล้วน **ไม่เปลี่ยนตัวเลข %Q ของกะใดๆ**
 *    อยากให้ผลพิจารณามีผลกับ %Q ต้องแก้ที่ `oee.js` โดยตั้งใจ ไม่ใช่ผลข้างเคียงของไฟล์นี้
 */

/** ของในแถวงานเสียที่ "ต้องเอาไปพิจารณา" = NG + ต้องสงสัย (ซ่อมไม่นับ — ของที่ซ่อมผ่านถังมาแล้ว) */
export const binPiecesOf = (d) => (Number(d?.qty_ng) || 0) + (Number(d?.qty_suspect) || 0);

/**
 * แถว `quality_bin_records` (ถังเหลือง) ที่ต้องสร้างจากบันทึกงานเสีย 1 แถว
 * pure — คนเรียกเป็นคน insert เอง (ไฟล์นี้ห้ามแตะ DB)
 *
 * @param defect  แถว defect_logs ที่เพิ่งเขียน (ต้อง embed `prod_orders`/`dr_defect_types`)
 * @param session กะของแถวนั้น ({ line_name, work_date })
 * @param opt     { actorName, partNo }
 * @returns payload หรือ **`null` เมื่อไม่มีของให้พิจารณา** (0 ชิ้น = ไม่ต้องตั้งแท็ก)
 */
export function yellowRowFromDefect(defect, session, { actorName = '', partNo = null } = {}) {
  const qty = binPiecesOf(defect);
  if (!defect?.id || !qty) return null;
  const typeName = defect?.dr_defect_types?.name_th || 'ของเสีย';
  return {
    bin: 'yellow',
    /* 🔴 วันงานของกะ ไม่ใช่วันปฏิทิน — อายุแท็กนับจากวันนี้ และต้องเทียบกับ defect_logs ได้
       (กะดึกลงของตอน 01:00 = วันงานเมื่อวาน · กับดักเดิมของหน้า /qa) */
    work_date: session?.work_date || null,
    line_name: session?.line_name || null,
    mat_no:    defect?.prod_orders?.mat_no || null,
    part_name: defect?.prod_orders?.part_name || null,
    part_no:   partNo || null,
    qty,
    /* สาเหตุ = ประเภท + รายละเอียดที่คนกรอก · งานทดลองต้องติดป้ายไว้ (ของจริงยังต้องกำจัด
       แต่ไม่นับ %Q) ไม่งั้น QA อ่านใบแล้วไม่รู้ว่ามาจากการลองเครื่อง */
    cause: [typeName, defect?.description, defect?.is_trial ? '🧪 งานทดลอง' : '']
      .map(x => String(x || '').trim()).filter(Boolean).join(' — '),
    reported_by: defect?.reported_by_name || actorName || null,
    defect_log_id: defect.id,
    found_img: defect?.defect_img || null,
    /* 🔴 `qa_decision` ต้องเป็น null = "ยังไม่พิจารณา" — นี่คือเหตุผลทั้งหมดของการตั้งแท็ก
       ห้ามเดาผลให้ (กฎ §5.4) */
  };
}

/**
 * ใบเหลืองที่ยัง "รอพิจารณา" — ของที่หน้างานต้องมาเคลียร์ว่า กลับมาดี หรือ เสียแน่
 * @param rows        แถวถังเหลือง (is_active)
 * @param redChildOf  Set id ใบเหลืองที่ย้ายลงแดงแล้ว
 * 🔴 "รอพิจารณา" = ยังไม่มีผล **และ** ยังไม่ปิดด้วยทางอื่น (กลับเข้ากระบวนการ/ย้ายแดง)
 */
export function pendingYellow(rows = [], redChildOf = new Set()) {
  return (rows || []).filter(r => r && r.bin === 'yellow' && r.is_active !== false
    && !r.qa_decision && !binClosed(r, { hasRedChild: redChildOf.has(r.id) }));
}
