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

/* ── ผจก.โรงงาน: เซ็นเฉพาะงบเกินแสน (user 2026-09-22) ─────────────────────────
   "ลายเซ็นทั้งหมด 7 จุด **ไม่รวม ผจก.โรงงาน** ที่เซ็นเฉพาะงบเกินแสน
    ตรงนั้นจะต้องปริ้นออกมาให้เซ็น แล้วส่งบัญชี"
   ⇒ ลายเซ็นนี้ **อยู่นอกลูป 9 ขั้น** — ไม่บล็อกใบ ไม่เพิ่มขั้น เป็นงานกระดาษต่อท้าย
   ⚠️ ห้ามเอาไปรวมกับ `needsApprovalFirst` (งานปรับปรุง/สร้าง) ซึ่งบล็อก*ก่อน*เริ่มงาน
      — คนละจังหวะกัน: อันนั้นก่อนซ่อม อันนี้หลังรู้ค่าใช้จ่ายจริง */
export const PLANT_MGR_COST_LIMIT = 100000;

/** ยอดรวมค่าใช้จ่ายของใบ (ค่าแรง + ค่าอะไหล่) — null = ยังไม่รู้ (ห้ามตีเป็น 0) */
export function orderCostTotal(order = {}, laborRows = null, partRows = null) {
  if (Array.isArray(laborRows) || Array.isArray(partRows)) {
    return grandTotal(laborRows || [], partRows || [], num(order.labor_cost), num(order.parts_cost));
  }
  const l = num(order.labor_cost), p = num(order.parts_cost);
  return l == null && p == null ? null : (l || 0) + (p || 0);
}

/** ใบนี้ต้องให้ ผจก.โรงงานเซ็น (เพราะงบเกินเพดาน) แล้วปริ้นส่งบัญชีไหม
 *  คืน false เมื่อยังไม่รู้ยอด — **ห้ามเตือนมั่วตอนยังไม่ได้ลงค่าใช้จ่าย** */
export function needsPlantMgrByCost(order = {}, laborRows = null, partRows = null) {
  const t = orderCostTotal(order, laborRows, partRows);
  return t != null && t > PLANT_MGR_COST_LIMIT;
}

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

/* ── ขั้นตอนของใบ MTN ต่างจาก JIG/DIE ─────────────────────────────────  2026-09-15
   คำสั่ง user: *"เรื่องยากกว่านั้น MO MTN ขั้นตอนไม่เหมือนกับ MO JIG/DIE"* + คำตอบ 3 ข้อ
     ① "งานสร้าง/ปรับปรุง ต้องให้ผู้จัดการอนุมัติก่อนช่างเริ่ม · แต่ **งานซ่อมกับบริการ
        แค่แจ้งให้ทราบ และมาไล่เซ็นรับทราบตามหลังได้ ไม่งั้นไลน์จะหยุดรอการอนุมัติ**"
     ② "ให้ QA กดตัดสิน พฤติกรรมเดิม แต่**เฉพาะงานซ่อม/บริการ**"
     ③ ขั้นรับมอบ (6) กับขั้นรับรอง (7) — "แยก 2 ขั้น" (ไม่ยุบรวม)

   ⚠️ ทุกเกณฑ์ที่นี่ตัดสินจาก **ค่าดิบ `order.purpose`** เท่านั้น ห้ามเดาจาก `repair_type`
      (`purposeOfPrint` เดาได้ เพราะเป็นแค่ช่องติ๊กบนใบพิมพ์ ไม่ใช่ด่านกั้นงาน)
      ใบเก่า/ทีมอื่นที่ purpose ว่าง = พฤติกรรมเดิมทุกอย่าง (ไม่บล็อก · ต้องผ่าน QA) */

/** จุดประสงค์ที่ "ต้องอนุมัติก่อนช่างเริ่มงาน" — งานที่ไม่ใช่ของเสียหน้างาน ใช้เงิน/เวลาเพิ่ม */
export const APPROVE_FIRST_PURPOSES = ['improve', 'build'];
/** จุดประสงค์ที่ "ไม่ต้องผ่าน QA หลังซ่อม" — ของยังไม่เข้าไลน์ผลิต จึงไม่มีชิ้นงานให้ตรวจ
 *  ⚠️ วันนี้บังเอิญเป็นชุดเดียวกับ APPROVE_FIRST_PURPOSES แต่**เป็นคนละกฎ** ห้ามยุบเป็นลิสต์เดียว
 *     (เพิ่มจุดประสงค์ใหม่วันหน้า อาจต้องอนุมัติก่อนแต่ยังต้องผ่าน QA หรือกลับกัน) */
export const NO_QA_PURPOSES = ['improve', 'build'];

/** ช่องติ๊ก "จุดประสงค์" บนใบพิมพ์ — ใบเก่าที่ไม่มี purpose เดาจาก repair_type ได้ (แค่การแสดงผล) */
export const purposeOfPrint = (order) =>
  order?.purpose || (/improve|ปรับปรุง/i.test(order?.repair_type || '') ? 'improve' : 'repair');

/** ใบนี้ต้องรอผู้จัดการเซ็นก่อนไหม (ยังไม่ดูว่าเซ็นหรือยัง) */
export const needsApprovalFirst = (order) => APPROVE_FIRST_PURPOSES.includes(order?.purpose);
/** ใบนี้ต้องผ่าน QA ไหม — ว่าง/ค่าที่ไม่รู้จัก = **ต้องผ่าน** (fail-safe ฝั่งคุณภาพ) */
export const qaAppliesTo = (order) => !NO_QA_PURPOSES.includes(order?.purpose);

/** เหตุผลมาตรฐานเมื่อ QA ถูกข้ามเพราะจุดประสงค์ของงาน (ไม่ใช่คนกดข้าม) */
export const QA_SKIP_REASON_PURPOSE = 'งานสร้าง/ปรับปรุง — ไม่ใช่งานซ่อมของที่กำลังผลิต จึงไม่ต้องตรวจคุณภาพหลังซ่อม';

/**
 * สถานะลายเซ็นผู้จัดการของใบ MTN — จุดเดียวที่ตัดสินว่า "ติดรออนุมัติ" หรือ "แค่รอเซ็นรับทราบ"
 *
 * คืน:
 *   needPlant  งานสร้างเท่านั้น (ตามข้อความบนฟอร์ม "MO. สร้าง ส่ง ผจก.โรงงานอนุมัติ")
 *   missing    ['dept'|'plant'] ที่ยังไม่มีลายเซ็น
 *   blocking   ใบประเภทนี้ต้องเซ็นก่อนเริ่มงานไหม (improve/build)
 *   blocked    blocking && ยังเซ็นไม่ครบ ⇒ **ช่างกดรับงาน (ขั้น 2-3) ไม่ได้**
 *   ackPending งานซ่อม/บริการที่ยังไม่เซ็น ⇒ เดินงานได้ตามปกติ แค่ค้าง "เซ็นรับทราบตามหลัง"
 */
export function mtnApprovalState(order = {}) {
  const needPlant = needsPlantManager(order?.purpose);
  const missing = [];
  if (!order?.dept_manager_at) missing.push('dept');
  if (needPlant && !order?.plant_manager_at) missing.push('plant');
  const blocking = needsApprovalFirst(order);
  return {
    purpose: order?.purpose || null, needPlant, missing, blocking,
    blocked: blocking && missing.length > 0,
    ackPending: !blocking && missing.length > 0,
  };
}
