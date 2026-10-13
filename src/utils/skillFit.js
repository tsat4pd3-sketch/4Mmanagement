/* ══ 🎯 Skill Fit — ทักษะของคน vs ทักษะที่จุดงานต้องการ (ของกลาง · 2026-10-12) ══════════════════
   สูตร: ผ่าน = คะแนนทักษะ ≥ `station_requirements.min_score` · คะแนนความเหมาะ = ข้อที่ผ่าน / ข้อที่จุดต้องการ × 100
   (สูตรเดียวกับ Management/Dashboard/OrderTrace ที่ยังเขียนแยกกันอยู่ 3 ที่ — ⚠️ ของใหม่ใช้ไฟล์นี้ ห้ามก๊อปเพิ่ม)
   🔴 จุดที่ไม่ได้ตั้งทักษะที่ต้องการ = `null` (ไม่รู้) **ไม่ใช่ 100** — จอต้องเขียนว่า "ยังไม่ตั้ง" ห้ามนับว่าผ่าน
   🔴 ไม่มีคะแนนทักษะนั้นเลย = 0 (ยังไม่เคยได้รับการประเมิน = ยังไม่ผ่าน) — ตรงกับ 3 ที่เดิม
      แต่ติดธง `assessed: false` ให้จอแยก "ยังไม่ประเมิน" ออกจาก "ประเมินแล้วไม่ถึง" (คนละเรื่อง คนละคนต้องแก้)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** แถว employee_skills ของคนหนึ่ง → { skill_name: score } */
export function skillMapOf(rows) {
  const m = {};
  for (const r of rows || []) m[r.skill_name] = Number(r.score) || 0;
  return m;
}

/** แถว employee_skills → { skill_name: pending_level } (เฉพาะที่มีคำขอเลื่อนขั้นค้างอนุมัติ) */
export function pendingMapOf(rows) {
  const m = {};
  for (const r of rows || []) if (r.pending_level != null) m[r.skill_name] = Number(r.pending_level);
  return m;
}

/**
 * @param {Array<{skill_name, min_score}>} reqs  ทักษะที่จุดงานต้องการ
 * @param {Object} skillMap  { skill_name: score }
 * @param {Object} [pendingMap] { skill_name: pending_level } — ได้ขั้นแล้วแต่รอหัวหน้าอนุมัติ
 *   ⇒ details[].pending = ขั้นที่รอ · `waitApproval` = ไม่ผ่านตอนนี้ แต่จะผ่านทันทีเมื่ออนุมัติ
 *   🔴 ยังนับว่า "ไม่ผ่าน" (คะแนนจริงยังไม่ถึง) — แค่ติดธงให้จอแยกว่าค้างที่คนอนุมัติ ไม่ใช่ฝีมือ
 * @returns null (จุดไม่ได้ตั้ง) | { score, passed, total, details: [{ skill_name, required, actual, assessed, pass, pending, waitApproval }] }
 */
export function skillFit(reqs, skillMap, pendingMap = null) {
  const list = (reqs || []).filter(r => r && r.skill_name);
  if (!list.length) return null;
  const details = list.map(r => {
    const required = Number(r.min_score) || 0;
    const assessed = skillMap != null && Object.prototype.hasOwnProperty.call(skillMap, r.skill_name);
    const actual = Number(skillMap?.[r.skill_name] ?? 0) || 0;
    const pending = pendingMap?.[r.skill_name] ?? null;
    const pass = actual >= required;
    return { skill_name: r.skill_name, required, actual, assessed, pass, pending, waitApproval: !pass && pending != null && pending >= required };
  });
  const passed = details.filter(d => d.pass).length;
  return { score: Math.round((passed / details.length) * 100), passed, total: details.length, details };
}
