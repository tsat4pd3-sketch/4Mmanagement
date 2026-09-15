/* ═══════════════════════════════════════════════════════════════════════════
   ใบสั่งงานซ่อมบำรุง M/O ของทีม MTN — ค่าคงที่ + สูตรรวมเงิน       2026-09-15

   ที่มา: ฟอร์มกระดาษจริงที่ user ส่งมา (MO.No. MTN.2026/06-59) · คำสั่ง user
   "ต้องทำทั้งหมด เพราะ MTN จะใช้รูปแบบใบเดิมเหมือน 100%"

   ⚠️ pure ทั้งไฟล์ (ไม่ import supabase) — ใบพิมพ์ · ฟอร์มกรอก · สรุปค่าใช้จ่าย
      ต้องอ่านค่าจากที่นี่ที่เดียว ห้ามคิดเลขซ้ำในหน้า (เลขบนจอกับบนใบพิมพ์จะเพี้ยนกัน)
   ═══════════════════════════════════════════════════════════════════════════ */

/** จุดประสงค์ 4 แบบตามฟอร์ม — เดิมใบพิมพ์เดาจาก repair_type ได้แค่ ซ่อม/ปรับปรุง */
export const PURPOSES = [
  { key: 'repair',  label: 'ซ่อม' },
  { key: 'improve', label: 'ปรับปรุง' },
  { key: 'service', label: 'บริการ' },
  { key: 'build',   label: 'สร้าง' },
];

/** สาเหตุเกิดจาก — checkbox 4 หมวดบนฟอร์ม (root_cause ยังเป็นคำอธิบายยาวเหมือนเดิม) */
export const CAUSE_CATS = [
  { key: 'man',       label: 'คน' },
  { key: 'method',    label: 'วิธีการทำงาน' },
  { key: 'part_life', label: 'อายุอะไหล่' },
  { key: 'other',     label: 'อื่นๆ' },
];

/** งาน "สร้าง" ต้องผ่านผู้จัดการโรงงาน (ข้อความบนฟอร์ม: "MO. สร้าง ส่ง ผจก.โรงงานอนุมัติ") */
export const needsPlantManager = (purpose) => purpose === 'build';

/* ── เงิน ─────────────────────────────────────────────────────────────────
   กติกา: ถ้ามี `amount` ที่คนกรอกเอง ให้ใช้ค่านั้น (ใบจริงบางใบปัดเลขเอง)
   ไม่มี → คำนวณจาก rate × hours (ค่าแรง) หรือ qty × unit_price (อะไหล่)
   ⚠️ คืน null เมื่อ "ไม่รู้" — ห้ามคืน 0 (0 = ฟรี ซึ่งคนละเรื่องกับยังไม่กรอก) */
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function laborAmount(row = {}) {
  const a = num(row.amount);
  if (a != null) return a;
  const r = num(row.rate_per_hour), h = num(row.hours);
  return r != null && h != null ? r * h : null;
}

export function partAmount(row = {}) {
  const a = num(row.amount);
  if (a != null) return a;
  const q = num(row.qty), p = num(row.unit_price);
  return q != null && p != null ? q * p : null;
}

/** รวมยอด — คืน null ถ้าไม่มีแถวไหนกรอกเงินเลย (ช่องบนใบจะได้ว่าง ไม่ใช่ 0) */
const sumOf = (rows, fn) => {
  let sum = 0, hit = false;
  for (const r of rows || []) { const v = fn(r); if (v != null) { sum += v; hit = true; } }
  return hit ? sum : null;
};
export const sumLabor = (rows) => sumOf(rows, laborAmount);
export const sumParts = (rows) => sumOf(rows, partAmount);

/** (1) + (2) — ฝั่งไหนว่างก็ยังรวมได้ · ว่างทั้งคู่ = null */
export function grandTotal(laborRows, partRows, fallbackLabor = null, fallbackParts = null) {
  const l = sumLabor(laborRows) ?? num(fallbackLabor);
  const p = sumParts(partRows) ?? num(fallbackParts);
  if (l == null && p == null) return null;
  return (l || 0) + (p || 0);
}

/* ── ความพึงพอใจ ──────────────────────────────────────────────────────────
   ฟอร์มกระดาษ: พอใช้(1) ปานกลาง(2) ดี(3) × 5 หัวข้อ → "คะแนนรวม ... คิดเป็น %"
   คิด % จากคะแนนเต็มของ**ข้อที่ให้คะแนนมาจริง** (ข้อที่เว้นว่างไม่ถูกนับเป็น 0) */
export function satScore(satisfaction, dimKeys = []) {
  const vs = dimKeys.map(k => num(satisfaction?.[k])).filter(v => v >= 1 && v <= 3);
  if (!vs.length) return { sum: null, max: null, pct: null, n: 0 };
  const sum = vs.reduce((a, b) => a + b, 0);
  const max = vs.length * 3;
  return { sum, max, pct: Math.round((sum / max) * 100), n: vs.length };
}
