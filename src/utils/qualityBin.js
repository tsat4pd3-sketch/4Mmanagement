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
