/* ══ 🚫 สถานะกะผลิต — "โมฆะ (void)" (pure · 2026-10-08 · คำสั่ง user) ═══════════════════
 *
 * ทำไมต้องมี `void`:
 *   กะที่ "เปิดผิดแล้วปิดทิ้ง" เคยมีแค่ 2 ทางเลือก ซึ่งแย่ทั้งคู่
 *     1. ปล่อยไว้ → `shift_min` ที่เป็นค่า default (720) ทำให้ไทม์ไลน์ลากแถบ 12 ชม.
 *        และจอนับเป็น "กะที่เดินจริง" อีก 1 กะ
 *     2. `delete` → ลบประวัติทิ้ง (และของเดิมลบลูกตามไปทั้งหมด) สืบย้อนไม่ได้ว่าเคยเปิดผิด
 *   `void` = **เก็บแถวไว้ แต่ประกาศว่าไม่ใช่กะจริง** (หลักเดียวกับ 4M ที่ใช้ `rejected` ห้าม `delete`
 *   และแผนล็อตที่ใช้ `cancelled` ห้าม `delete`)
 *
 * 🔴 กติกาที่ทุกจอต้องรู้:
 *   · **`void` ไม่ใช่กะ** — ห้ามนับเป็นกะที่เปิด/ปิด · ห้ามเอา `shift_min` ไปถ่วงน้ำหนัก ·
 *     ห้ามโผล่ในบอร์ด/ไทม์ไลน์เหมือนกะปกติ
 *   · คิวรีที่กรอง `status` **ต้องระบุสถานะที่ต้องการเป็นรายตัว** (`SESSION_STATUSES_*` ข้างล่าง)
 *     **ห้ามใช้ `.neq('status', …)`** — "ไม่ใช่ closed" จะลาก `void` เข้ามาเป็นกะที่เปิดค้างเงียบๆ
 *     (มีด่าน `session-status-no-neq` ใน regressionGuards)
 *   · ทำโมฆะได้เฉพาะ **กะเปล่า** (ไม่มีใบผลิต/downtime/ของเสีย และยอดผลิตเป็น 0) — ตัดสินที่
 *     `voidBlockReason()` ฝั่งจอ + **trigger `trg_session_void_guard` ฝั่ง DB เป็นด่านจริง**
 *     (กะที่มีข้อมูลแล้วซ้ำซ้อน = ต้องให้คนตัดสินว่าข้อมูลควรอยู่ใบไหน ห้ามซ่อนด้วย void)
 *   · **อ่านลูกไม่สำเร็จ ≠ ไม่มีลูก** — ส่ง `loadError: true` มา แล้วฟังก์ชันจะไม่ให้ทำโมฆะ
 *     (บทเรียนเดียวกับปุ่ม "ลบกะเปล่า" ที่เคยโผล่กับกะที่มีข้อมูลจริงตอนโหลดพลาด)
 */

export const SESSION_VOID = 'void';

/** สถานะของ "กะจริง" ทั้งหมด — ใช้แทน `.neq('status','void')` เพื่อให้ชัดว่าตั้งใจเอาอะไร */
export const SESSION_STATUSES_REAL = ['open', 'pending_close', 'closed'];
/** กะที่ยังไม่ปิด (เปิดค้าง) */
export const SESSION_STATUSES_LIVE = ['open', 'pending_close'];
/** กะที่ข้อมูลครบแล้ว (ปิดแล้ว / จบแล้วรออนุมัติ) */
export const SESSION_STATUSES_DONE = ['closed', 'pending_close'];

export const isVoidSession = (s) => s?.status === SESSION_VOID;

/** ป้ายสั้นสำหรับโชว์บนจอ — `null` เมื่อไม่ใช่ใบโมฆะ */
export const voidBadge = (s) => (isVoidSession(s)
  ? { text: '🚫 โมฆะ', title: s?.void_reason ? `เหตุผล: ${s.void_reason}` : 'ใบนี้ถูกทำเป็นโมฆะ' }
  : null);

/**
 * ทำโมฆะได้ไหม — คืน **เหตุผลที่ห้าม** (string) หรือ `null` เมื่อทำได้
 * ตรรกะต้องตรงกับ trigger `trg_session_void_guard` ฝั่ง DB (migration 20261008_session_void_dr.sql)
 */
export function voidBlockReason({
  session, orders = [], downtimes = [], defects = [], loadError = false,
} = {}) {
  if (!session) return 'ไม่ได้เลือกกะ';
  if (isVoidSession(session)) return 'ใบนี้เป็นโมฆะอยู่แล้ว';
  if (loadError) return 'อ่านข้อมูลของกะนี้ไม่สำเร็จ — ยังบอกไม่ได้ว่าเป็นกะเปล่า';
  const n = (v) => Number(v) || 0;
  const parts = [];
  if (orders.length) parts.push(`ใบผลิต ${orders.length}`);
  if (downtimes.length) parts.push(`Downtime ${downtimes.length}`);
  if (defects.length) parts.push(`ของเสีย ${defects.length}`);
  if (n(session.actual_qty) > 0) parts.push(`ยอดผลิต ${n(session.actual_qty)}`);
  if (n(session.qty_ok) > 0) parts.push(`งานดี ${n(session.qty_ok)}`);
  if (parts.length) return `กะนี้มีข้อมูลแล้ว (${parts.join(' · ')}) — ทำโมฆะไม่ได้`;
  return null;
}

/** เหตุผลที่กรอกต้องไม่ว่าง (DB มี CHECK คู่กัน) */
export const cleanVoidReason = (t) => {
  const s = String(t ?? '').trim();
  return s ? s : null;
};
