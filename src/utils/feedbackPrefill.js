/* ══ feedbackPrefill — เปิดกล่อง 💬 แจ้งปัญหา พร้อมข้อความตั้งต้น จากหน้าไหนก็ได้ ══════
   (2026-09-22 · ใช้ครั้งแรกโดยหน้า /schema ปุ่ม "🐛 แจ้งบัคเรื่องตารางนี้")

   ทำไมต้องผ่าน event: กล่อง feedback (`FeedbackModal`) ถูก mount อยู่ใน `Sidebar` ซึ่งไม่ใช่
   บรรพบุรุษของหน้าใดๆ ⇒ ส่ง prop ลงไปไม่ได้ · และ**ห้ามทำกล่องแจ้งปัญหาใบที่ 2** ในหน้าอื่น
   (ที่เดียวที่รับ feedback = ตาราง `user_feedback` ผ่านกล่องนี้ — ดู docs/modules/feedback-inbox.md)

   ใช้:  openFeedback('ข้อความตั้งต้น...')      ← จากหน้าใดก็ได้
         takeFeedbackPrefill()                  ← FeedbackModal เรียกตอน mount (อ่านแล้วล้าง)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const EVENT = 'esm:open-feedback';
let pending = null;

/** ขอเปิดกล่องแจ้งปัญหา (พร้อมข้อความตั้งต้น ถ้ามี) */
export function openFeedback(text) {
  pending = text ? String(text) : null;
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* SSR/เทส — ไม่มี window */ }
}

/** อ่านข้อความตั้งต้น "ครั้งเดียว" แล้วล้างทิ้ง (เปิดกล่องรอบหน้าต้องว่างเปล่าตามปกติ) */
export function takeFeedbackPrefill() {
  const t = pending;
  pending = null;
  return t;
}

export const FEEDBACK_EVENT = EVENT;
export default openFeedback;
