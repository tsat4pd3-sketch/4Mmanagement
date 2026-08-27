/* ══════════════════════════════════════════════════════════════════════════
   ผลตรวจ PM/AM — `inspections.status`  (2026-08-25)

   ⚠️ กฎเหล็ก (CLAUDE.md): **เทียบตรงตัวเท่านั้น ห้ามใช้ regex**
      ค่าที่เป็นไปได้มีแค่ 4 ตาม check constraint `pm_inspections_status_check`:
        pending | pass | fail | warning
      `/fail|ng/i` จับ "pe·nd·ing" และ "warni·ng" ติดทั้งคู่ → `pending` (ค่า default
      ของคอลัมน์ และเป็นค่าที่ `computeOverall()` คืนทุกครั้งที่ตรวจไม่ครบทุกจุด)
      จะขึ้นแดงว่า "พบผิดปกติ" = สร้างหลักฐานเท็จในจอที่ใช้สอบสวนคุณภาพ

   ⚠️ "ตรวจไม่ครบ" เป็นสัญญาณของตัวเอง — คนละเรื่องกับ "พบของเสีย" ห้ามยุบรวม
   ══════════════════════════════════════════════════════════════════════════ */

/** สถานะที่แปลว่า "ตรวจแล้วเจอปัญหา" */
export const INSP_NG = new Set(['fail', 'warning', 'ng']);

export const INSP_META = {
  pass:    { key: 'pass',    icon: '✅', label: 'ปกติ',            color: '#22c55e' },
  ng:      { key: 'ng',      icon: '⚠️', label: 'พบผิดปกติ',       color: '#ef4444' },
  pending: { key: 'pending', icon: '⏳', label: 'ตรวจไม่ครบทุกจุด', color: '#9ca3af' },
};

/** status ดิบ → meta (ไม่รู้จัก/ว่าง = ถือว่าตรวจไม่ครบ ไม่ใช่ผ่าน) */
export function inspMeta(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (INSP_NG.has(s)) return INSP_META.ng;
  if (s === 'pass') return INSP_META.pass;
  return INSP_META.pending;
}

export const isInspNg = (raw) => INSP_NG.has(String(raw || '').trim().toLowerCase());
/** ตรวจจบจริง (ครบทุกจุด) — ผ่านหรือเจอปัญหาก็นับว่า "ทำแล้ว" */
export const isInspDone = (raw) => {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'pass' || INSP_NG.has(s);
};
