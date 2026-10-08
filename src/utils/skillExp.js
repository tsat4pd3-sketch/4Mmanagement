/* ══════════════════════════════════════════════════════════════════════
   EXP farming v2 — ตัวช่วย "แสดงผล" ของอัลกอริทึมสะสมทักษะ (2026-09-24)

   🔴 ไฟล์นี้ **ไม่ได้คำนวณคะแนน** — คะแนนคำนวณฝั่ง DB ที่เดียว
      (`fn_skill_exp_rebuild` · migration 20260924_skill_exp_v2_*.sql)
      เพราะ cron ต้องรันได้เองโดยไม่ผ่านเบราว์เซอร์ · ถ้าเขียนสูตรไว้ 2 ที่
      มันจะ drift กันแน่นอน (บทเรียน SKILL_LEVELS ที่เคยซ้ำใน 2 หน้าแล้วเพี้ยน)

   🔴 ค่าคงที่ทุกตัว (เพดานขั้น · ประตู · n_ref) อยู่ในตาราง `skill_exp_config`
      ไฟล์นี้รับ cfg เข้ามาเป็น argument เสมอ **ห้าม hardcode ตัวเลขเกณฑ์ที่นี่**

   ที่มาของสูตร + งานวิจัยอ้างอิง → docs/modules/employee-skills-exp.md §v2
   ══════════════════════════════════════════════════════════════════════ */

/* ขั้น 0-4 ↔ ช่วงคะแนน — ล้อกับ SKILL_LEVELS/SKILL_GATES ใน skillLevels.js */
export const BAND_ENTRY   = [0, 25, 50, 75, 100];
export const BAND_CEILING = [24, 49, 74, 99, 100];

export const bandOf = (score) => {
  const s = Number(score) || 0;
  return s < 25 ? 0 : s < 50 ? 1 : s < 75 ? 2 : s < 100 ? 3 : 4;
};

/* ชื่อ 4 ขาของหลักฐาน — ใช้เป็นหัวตาราง/ป้ายเหมือนกันทุกหน้า */
export const EVIDENCE_LEGS = [
  { key: 'volume',    icon: '📈', label: 'ปริมาณสะสม',   hint: 'รอบผลิตที่ผ่านมือ (หารตามจำนวนคนในกะ)' },
  { key: 'quality',   icon: '🎯', label: 'คุณภาพ',        hint: 'ของเสียช่วงที่อยู่ เทียบค่ากลางของไลน์' },
  { key: 'variety',   icon: '🔀', label: 'ความหลากหลาย', hint: 'จำนวนรุ่น · การเปลี่ยนรุ่น · วันที่เจอเหตุผิดปกติ' },
  { key: 'certified', icon: '📜', label: 'การรับรอง',     hint: 'OJT · เคยเป็นผู้สอน · เอกสารอบรม' },
];

/* ความคืบหน้าภายในขั้น (0..1) — ใช้วาดหลอด ไม่ใช่ตัดสินคะแนน
   รูปโค้ง log ตาม Wright (1936): ต้องใช้ปริมาณสะสมเพิ่มแบบทบเท่าเพื่อขึ้นขั้นถัดไป */
export function bandProgress(cumCycles, nRef, band, cfg) {
  const edges = [0, num(cfg?.band_cum_0), num(cfg?.band_cum_1), num(cfg?.band_cum_2), num(cfg?.band_cum_3)];
  const b = clampInt(band, 0, 4);
  if (b >= 4) return 1;
  const r  = num(nRef) > 0 ? num(cumCycles) / num(nRef) : 0;
  const lo = edges[b];
  const hi = edges[b + 1];
  if (!(hi > lo)) return 0;
  return Math.max(0, Math.min(1, (r - lo) / (hi - lo)));
}

/* รอบที่ยังขาดก่อนถึงเพดานขั้นปัจจุบัน — บอกหน้างานตรงๆ ว่า "อีกเท่าไหร่" */
export function cyclesToNextBand(cumCycles, nRef, band, cfg) {
  const edges = [0, num(cfg?.band_cum_0), num(cfg?.band_cum_1), num(cfg?.band_cum_2), num(cfg?.band_cum_3)];
  const b = clampInt(band, 0, 4);
  if (b >= 4 || !(num(nRef) > 0)) return null;
  return Math.max(0, Math.round(edges[b + 1] * num(nRef) - num(cumCycles)));
}

/* สถานะของแถวหลักฐาน — 🔴 "ประเมินไม่ได้" ต้องแยกจาก "คะแนนต่ำ" เสมอ
   (shadow_score = null แปลว่าไลน์ยังไม่มีข้อมูลยอดผลิต ไม่ใช่ว่าเขาทำได้ 0) */
export function evidenceState(ev) {
  if (!ev)                          return { key: 'none',      label: 'ยังไม่มีข้อมูลหลักฐาน', color: 'var(--muted)' };
  if (ev.shadow_score == null)      return { key: 'unknown',   label: 'ประเมินไม่ได้',          color: 'var(--muted)' };
  if (ev.verified === false)        return { key: 'unverified',label: 'ยังไม่มีหลักฐานรองรับ',  color: '#f59e0b' };
  if (ev.next_level != null)        return { key: 'ready',     label: 'พร้อมเลื่อนขั้น',        color: '#22c55e' };
  return { key: 'ok', label: 'กำลังสะสม', color: 'var(--accent)' };
}

/* สรุปสั้นๆ ว่าคะแนน v2 ต่างจากคะแนนปัจจุบันยังไง (ใช้ตอน shadow mode) */
export function shadowDelta(currentScore, shadowScore) {
  if (shadowScore == null) return null;
  return Math.round(Number(shadowScore) - (Number(currentScore) || 0));
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(Number(v) || 0)));
