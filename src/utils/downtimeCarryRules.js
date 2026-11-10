/* ── downtimeCarryRules — ส่วน pure ของ "Downtime ตัดยอดข้ามกะ" ─────────────────────────
   แยกจาก `src/lib/downtimeCarry.js` (ซึ่ง import supabaseClient → `import.meta.env` ของ Vite
   รันใน node:test ไม่ได้) ด้วยเหตุผลเดียวกับที่ `downtimeRules` ถูกแยกจาก `downtimeAlarm`     */

/** แถวที่ยัง "ไม่มีตัวต่อเนื่อง" — กันสร้างซ้ำเมื่อถูกเรียกทั้งทางดึง (เปิดกะ) และทางดัน (ปิดกะ) */
export function pendingCarryRows(carryRows = [], contRows = []) {
  const done = new Set((contRows || []).map(c => c.carried_from_id));
  return (carryRows || []).filter(d => !done.has(d.id));
}

/* payload ของแถวต่อเนื่อง
   🔴 ก๊อปเฉพาะ "เนื้ออาการ" — ห้ามลาก `duration_min`/`ended_at` (แถวใหม่ต้องเป็นเปิดค้างจริง)
      และห้ามลาก `call_mtn` (ใบเก่าปิดไปแล้ว ช่างเคลียร์ไปแล้ว — ต้องการช่างอีกก็กดเรียกใหม่) */
export function carryPayload({ rows = [], toSessionId, startISO, by = null, byUid = null }) {
  return rows.map(d => ({
    session_id:       toSessionId,
    downtime_type_id: d.downtime_type_id,
    machine_no:       d.machine_no,
    mat_no:           d.mat_no,
    description:      d.description,
    started_at:       startISO,
    carried_from_id:  d.id,
    reported_by_name: by,
    reported_by_uid:  byUid,
  }));
}
