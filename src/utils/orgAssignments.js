/* 👔 "ใครคุมหน่วยไหน" + รักษาการ — src/utils/orgAssignments.js      2026-09-24
 *
 * ที่มา: ผังองค์กรจริง ORG-001 Rev.09 พิสูจน์ว่า **7 จาก 14 ส่วน (50%) หัวหน้าเป็นรักษาการ**
 * และ **คนเดียวคุมได้หลายหน่วย** (ศักดา = Press Production + Tooling MTN)
 * ⇒ "คุมหน่วยไหนบ้าง" เป็นคนละคำถามกับ "สังกัดที่ไหน" (`employees.org_node_id`)
 *   และเป็นได้หลายค่า + มีวันหมดอายุ → ต้องเป็นตารางแยก (`org_assignments`)
 *
 * ── 🔴 หมดอายุ "คิดตอนอ่าน" ไม่มี cron ไปเขียนสถานะ ────────────────────────
 * cron ที่ไม่ได้รัน = สิทธิ์ค้างเงียบ ซึ่งคือปัญหาที่โมดูลนี้มาแก้พอดี
 * ⇒ ทุกฟังก์ชันรับ `today` เข้ามาได้ (ค่า default = วันนี้)
 *   **ห้ามอ่านนาฬิกาข้างในโดยไม่เปิดให้ส่งค่า** — เทสจะกลายเป็นระเบิดเวลา
 *   (กฎ CLAUDE.md: `npm test` รันรอบ "นาฬิกา +400 วัน" ด้วย)
 *
 * ── ⚖️ ทำไมการ "เพิ่มขอบเขต" ตรงนี้ไม่ขัดกฎ role-centric ───────────────────
 * กฎใน docs/ACCESS-CONTROL-STANDARDS.md §2 ห้าม **อนุมานสิทธิ์กว้างจากการเว้นว่าง**
 * (fail-open) ซึ่งคนละเรื่องกับตารางนี้ — ตรงนี้เป็นข้อมูลที่คนกรอกชัดเจน ·
 * ขยาย**ขอบเขต (เห็นที่ไหน)** ไม่ได้ขยาย**สิทธิ์ (ทำอะไรได้)** เพดานยังเป็น role เหมือนเดิม ·
 * และ **มีวันหมดอายุ** ซึ่ง fail-open ไม่มี
 */

export const ASSIGNMENT_KINDS = {
  head:   { label: 'หัวหน้าหน่วย',  icon: '👔', short: 'หัวหน้า' },
  acting: { label: 'รักษาการ',      icon: '🔄', short: 'รก.' },
};
export const kindLabel = (k) => (ASSIGNMENT_KINDS[k] || ASSIGNMENT_KINDS.head).label;

/** วันนี้แบบ local date (YYYY-MM-DD) — ไม่ใช้ toISOString() (UTC เพี้ยนสำหรับไทย) */
export function todayLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const STATUS = {
  active:     { label: 'มีผลอยู่',           color: '#22c55e' },
  future:     { label: 'ยังไม่เริ่ม',         color: '#94a3b8' },
  expired:    { label: 'หมดอายุแล้ว',        color: '#ef4444' },
  open_ended: { label: 'ไม่กำหนดวันสิ้นสุด',  color: '#f59e0b' },
};

/**
 * สถานะของรายการหนึ่ง ณ วันที่ `today`
 * 🔴 `open_ended` ใช้กับ **รักษาการ** เท่านั้น — หัวหน้าตัวจริงไม่มีวันสิ้นสุดเป็นเรื่องปกติ
 *    (รักษาการที่ไม่มีวันจบ = สิทธิ์ถาวรที่ไม่มีใครรู้ว่าต้องถอนเมื่อไหร่ — ISO 27001 A.5.18)
 */
export function assignmentStatus(row, today = todayLocal()) {
  if (!row) return null;
  if (row.starts_on && row.starts_on > today) return 'future';
  if (row.ends_on && row.ends_on < today) return 'expired';
  if (row.kind === 'acting' && !row.ends_on) return 'open_ended';
  return 'active';
}

/** รายการนี้ให้ขอบเขตอยู่จริงไหม ณ วันนี้ — หมดอายุ/ยังไม่เริ่ม = ไม่ให้ */
export function isGranting(row, today = todayLocal()) {
  const st = assignmentStatus(row, today);
  return st === 'active' || st === 'open_ended';
}

/** 🔴 รักษาการที่ยังไม่กำหนดวันสิ้นสุด — คิวงานที่ต้องตามเก็บ */
export const needsEndDate = (row) => row?.kind === 'acting' && !row?.ends_on;

/** ระบบใส่ให้จากผังองค์กร ยังไม่มีคนยืนยัน */
export const needsConfirm = (row) => !!row && row.source !== 'manual' && !row.confirmed_at;

/** ใกล้หมดอายุภายใน N วัน (ยังไม่หมด) — เตือนล่วงหน้าก่อนสิทธิ์หลุด */
export function expiringWithin(row, days = 30, today = todayLocal()) {
  if (!row?.ends_on || row.ends_on < today) return false;
  const end = new Date(`${row.ends_on}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  return (end - now) / 86400000 <= days;
}

/**
 * สรุปคิวงานทบทวนสิทธิ์ (ISO 27001 A.5.18) จากรายการทั้งหมด
 * @returns {{openEnded, expired, expiring, unconfirmed, total}}
 */
export function reviewSummary(rows = [], { today = todayLocal(), days = 30 } = {}) {
  const r = { openEnded: [], expired: [], expiring: [], unconfirmed: [], total: rows.length };
  for (const row of rows) {
    if (needsEndDate(row))                       r.openEnded.push(row);
    if (assignmentStatus(row, today) === 'expired') r.expired.push(row);
    else if (expiringWithin(row, days, today))   r.expiring.push(row);
    if (needsConfirm(row))                       r.unconfirmed.push(row);
  }
  return r;
}
