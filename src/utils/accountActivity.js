/* 🕵️ accountActivity.js — "บัญชีนี้มีคนใช้อยู่จริงไหม" กฎเดียวทั้งระบบ (2026-10-29)
 *
 * คำถาม user: "บัญชีของคน คนไหนไม่มีการเข้าใช้เลยบ้าง · admin ดู last login ได้มั้ย
 *               จะได้ลบหรือปิดถูก"
 *
 * 🔴 กฎข้อเดียวที่ห้ามพลาด — **"ไม่เคยเข้า" กับ "อ่านไม่ได้" ไม่ใช่เรื่องเดียวกัน**
 *    last_sign_in_at = null       ⇒ ไม่เคยเข้าเลยจริงๆ   (ลบ/ปิดได้ ถ้าเจ้าของเรื่องเคาะ)
 *    last_sign_in_at = undefined  ⇒ **ยังไม่รู้** (get_auth_users เป็น admin-only · ผู้ดูไม่ใช่ admin
 *                                   หรือ RPC ล้ม) ⇒ จอต้องเขียนว่าอ่านไม่ได้ **ห้ามขึ้น "ไม่เคยเข้า"**
 *    ปนกัน = จอชวนให้ลบบัญชีที่คนใช้อยู่ทุกวัน — กู้ไม่ได้
 *
 * 🔴 ห้ามเรียก Date.now() ในไฟล์นี้ — ทุกตัวรับ `now` เข้ามา (ด่าน "นาฬิกา +400 วัน" ใน npm test)
 */

/** ค้างนานกี่วันถือว่า "ไม่มีใครใช้แล้ว" — ตัวเลขเดียวทั้งระบบ */
export const DORMANT_DAYS = 90;

export const ACT_UNKNOWN = 'unknown';   // ยังไม่รู้ (อ่านไม่ได้/ไม่ใช่ admin)
export const ACT_NEVER   = 'never';     // ไม่เคยเข้าเลย
export const ACT_DORMANT = 'dormant';   // เคยเข้า แต่ค้างเกิน DORMANT_DAYS
export const ACT_ACTIVE  = 'active';    // ยังใช้อยู่

const DAY = 86400000;

function ms(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;   // ⚠️ Date.parse(number) = NaN
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * ตีความ last_sign_in_at ของบัญชีหนึ่งใบ
 * @param lastSignInAt  undefined = ยังไม่รู้ · null = ไม่เคยเข้า · string/Date = เวลาที่เข้าล่าสุด
 * @param now           เวลาอ้างอิง (ms หรือ Date) — **บังคับส่ง**
 * @param dormantDays   เกินกี่วันถือว่าค้าง (default DORMANT_DAYS)
 * @returns {{ state, days: number|null, text: string }}
 */
export function activityOf(lastSignInAt, { now, dormantDays = DORMANT_DAYS } = {}) {
  if (lastSignInAt === undefined) return { state: ACT_UNKNOWN, days: null, text: 'อ่านไม่ได้' };
  if (lastSignInAt === null)      return { state: ACT_NEVER,   days: null, text: 'ไม่เคยเข้าใช้' };

  const t = ms(lastSignInAt);
  if (t == null) return { state: ACT_UNKNOWN, days: null, text: 'อ่านไม่ได้' };

  const nowMs = ms(now);
  if (nowMs == null) return { state: ACT_UNKNOWN, days: null, text: 'อ่านไม่ได้' };

  // เวลาในอนาคต (นาฬิกาเครื่องเพี้ยน) = ยังใช้อยู่ ไม่ใช่ติดลบ
  const days = Math.max(0, Math.floor((nowMs - t) / DAY));
  return days >= dormantDays
    ? { state: ACT_DORMANT, days, text: `ค้าง ${days} วัน` }
    : { state: ACT_ACTIVE,  days, text: days === 0 ? 'วันนี้' : `${days} วันก่อน` };
}

/** สีของชิป — เทา = ยังไม่รู้ (ห้ามใช้สีเตือนกับสิ่งที่ยังไม่รู้) */
export function activityTone(state) {
  switch (state) {
    case ACT_NEVER:   return '#ef4444';
    case ACT_DORMANT: return '#f59e0b';
    case ACT_ACTIVE:  return 'var(--text2)';
    default:          return 'var(--muted)';
  }
}

/**
 * สรุปทั้งลิสต์ — ตัวเลขที่เอาไปเขียนหัวจอ
 * 🔴 `unknown` ต้องถูกนับแยก ห้ามยัดรวมกับ never
 */
export function activitySummary(rows, { now, dormantDays = DORMANT_DAYS } = {}) {
  const out = { total: 0, unknown: 0, never: 0, dormant: 0, active: 0 };
  (rows || []).forEach(r => {
    out.total++;
    const { state } = activityOf(r?.last_sign_in_at, { now, dormantDays });
    out[state]++;
  });
  return out;
}

/**
 * ข้อความสรุปบรรทัดเดียว — null = ไม่มีอะไรต้องเตือน
 * อ่านไม่ได้ทั้งลิสต์ ⇒ บอกว่าอ่านไม่ได้ **ห้ามบอกว่า "ไม่มีบัญชีค้าง"**
 */
export function activitySummaryText(s) {
  if (!s || !s.total) return null;
  if (s.unknown === s.total) return 'อ่านประวัติการเข้าใช้ไม่ได้ — ตัวเลขด้านล่างไม่รวมเรื่องนี้';
  const parts = [];
  if (s.never)   parts.push(`ไม่เคยเข้าใช้ ${s.never} ใบ`);
  if (s.dormant) parts.push(`ค้างเกิน ${DORMANT_DAYS} วัน ${s.dormant} ใบ`);
  if (s.unknown) parts.push(`อ่านไม่ได้ ${s.unknown} ใบ`);
  return parts.length ? parts.join(' · ') : null;
}
