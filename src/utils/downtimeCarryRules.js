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

/* ── "ใบ downtime หลังใส่คำตัดสินของฟอร์มปิดกะ" — ยังไม่เขียน DB ─────────────────────────
   🔴 ของกลางเพราะมี **2 ที่ต้องได้เลขเดียวกัน**: OEE preview บนจอปิดกะ กับ **ด่าน poka-yoke
      ก่อนส่งขอปิดกะ** (`utils/closeChecks.js`) — ถ้าคนละสูตร จอจะเตือนแต่ด่านไม่จับ (หรือกลับกัน)
   · `carry` = ตัดยอดที่เวลาปิดกะ แล้วเปิดใบต่อให้กะถัดไป · `close` = ปิดที่เวลาที่กรอก
   · ยังไม่ตัดสิน = คืนแถวเดิม (duration_min ยัง null ⇒ สูตรไม่นับ = เท่าพฤติกรรมเดิม)   */
export function decidedDtLogs({ dtLogs = [], decisions = {}, closeTimes = {}, carryEndTime = null, workDate = null }) {
  const open = (dtLogs || []).filter(d => d?.duration_min == null);
  if (!open.length || !workDate) return dtLogs || [];
  return (dtLogs || []).map(d => {
    if (d.duration_min != null || !d.started_at) return d;
    const decision = decisions[d.id];
    const endStr = decision === 'carry' ? carryEndTime : (decision === 'close' ? closeTimes[d.id] : null);
    if (!endStr) return d;
    const startMs = new Date(d.started_at).getTime();
    let endMs = new Date(`${workDate}T${String(endStr).slice(0, 5)}:00`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return d;
    if (endMs < startMs) endMs += 86400000;        // ข้ามเที่ยงคืน (กะดึก)
    return { ...d, ended_at: new Date(endMs).toISOString(), duration_min: Math.max(1, Math.round((endMs - startMs) / 60000)) };
  });
}
