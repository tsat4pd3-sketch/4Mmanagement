// ─── Person Alarm ────────────────────────────────────────────────
// เงื่อนไขที่ marker คนบนผังต้องกระพริบเตือน (คู่กับ CSS .person-alarm-red / .person-alarm-amber):
//   แดง   = เช็คชื่อแล้วแต่ PPE ไม่ครบ
//   เหลือง = ถูกย้ายจุด/ข้ามไลน์ แล้ว 4M Man log ยังรออนุมัติ (pending_doc/pending/pending_qa)

// 4M Man log ผูกกับพนักงานผ่าน "ชื่อใน description" (ตาราง four_m_logs ไม่มี employee_id)
// — รูปแบบ description ที่ Management สร้าง: `${ชื่อ} ย้าย(ข้ามไลน์)ไปจุด ${สถานี}`
export const MAN_PENDING_STATUSES = ['pending_doc', 'pending', 'pending_qa'];

// คืนฟังก์ชัน (employeeName) → log ที่ค้างอนุมัติของคนนั้น หรือ null
export function buildMan4mPendingMatcher(fourMLogs) {
  const pending = (fourMLogs || []).filter(
    l => l.category === 'Man' && MAN_PENDING_STATUSES.includes(l.status) && l.description,
  );
  return (name) => (name ? pending.find(l => l.description.includes(name)) || null : null);
}

// รายการ PPE ที่ขาด จาก record daily_production_logs (has_helmet/has_boots/has_gloves)
export function ppeMissingList(w) {
  const miss = [];
  if (!w) return miss;
  if (w.has_helmet === false) miss.push('หมวก');
  if (w.has_boots  === false) miss.push('รองเท้า');
  if (w.has_gloves === false) miss.push('ถุงมือ');
  return miss;
}
