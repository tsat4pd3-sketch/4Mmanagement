// ─── กะที่พนักงานคนนี้เข้า (day/night) — single source of truth ─────────────────
// เดิม logic นี้ถูกเขียนซ้ำใน Checkin.jsx กับ Dashboard.jsx แล้ว **drift กันจริง**:
//   Checkin ให้ Team C = กะเช้าเสมอ · Dashboard ไม่ได้เช็ค → Team C ได้ null
//   → คนทีม C ที่เช็คชื่อแล้ว **หายจากบอร์ด** ทั้งฝั่งกะเช้าและกะดึก (บอร์ดกรองด้วย assignedShift)
// จึงรวมมาไว้ที่นี่ที่เดียว — จุดใหม่ที่ต้องรู้ว่า "คนนี้เข้ากะไหน" ให้ import จากไฟล์นี้เท่านั้น
//
// ── ขอบเขตของแถวตาราง shift_schedules (2026-08-11) ──
//   แถวหนึ่ง = ขอบเขตเดียว: `line_id` (ไลน์ผลิต) **หรือ** `dept_name` (หน่วยงานสนับสนุน)
//   ที่มา: พนักงานซัพพอร์ท (ช่าง MTN/JIG/DIE · QA · คลัง) ไม่มี line_id → เดิมไม่มีแถวให้ตั้งกะเลย
//   ทำให้ assignedShift = null ตลอด เหลือทางเดียวคือ shift_overrides ทีละคน-ทีละวัน (ใช้จริงไม่ไหว)
//   รูปแบบที่ user ยืนยัน: **หมุน A/B พร้อมกันทั้งแผนก เหมือนไลน์ผลิต**
//   (คนที่ไม่หมุนกะ = Team C ซึ่งกลไกเดิมรองรับอยู่แล้ว)

const norm = (s) => (s ?? '').toString().trim().toLowerCase();

/**
 * แปลงแถว shift_schedules เป็น map สำหรับ lookup
 * @returns {{ byLine: Object, byDept: Object, count: number }} count = จำนวนขอบเขตที่ตั้งกะไว้แล้ว
 */
export function buildScheduleMaps(rows) {
  const byLine = {}, byDept = {};
  for (const r of rows || []) {
    // dept_name อาจไม่มีคอลัมน์ (ยังไม่ apply migration) → r.dept_name = undefined → ตกไปสาย line ตามเดิม
    if (r?.dept_name) byDept[norm(r.dept_name)] = r.day_team;
    else if (r?.line_id != null) byLine[r.line_id] = r.day_team;
  }
  return { byLine, byDept, count: Object.keys(byLine).length + Object.keys(byDept).length };
}

/**
 * ทีมที่เข้ากะเช้าของพนักงานคนนี้ (ตามตารางกะ) — null = ยังไม่มีใครตั้งกะให้
 * ลำดับ: ไลน์ผลิตของตัวเองก่อน → ไม่มีค่อยใช้ของหน่วยงาน (employees.department)
 * (ช่างที่ถูกผูกกับไลน์ไว้ด้วย ยังได้กะของหน่วยงานถ้าไลน์นั้นไม่ได้ตั้งกะ — ไม่แย่กว่าเดิมแน่นอน)
 */
export function scheduleTeamFor(emp, maps) {
  if (!emp || !maps) return null;
  if (emp.line_id != null && maps.byLine[emp.line_id]) return maps.byLine[emp.line_id];
  const d = norm(emp.department);
  return (d && maps.byDept[d]) || null;
}

/**
 * ทีมที่เข้ากะเช้า (A/B) + ทีมของพนักงาน → กะที่เข้าจริง
 * ⚠️ Team C = กะเช้าตลอด ไม่หมุน A/B (กฎเดิมของระบบ — ห้ามตัดออก คนจะหายจากบอร์ด)
 */
export function shiftFromTeam(dayTeam, empTeam) {
  if (!dayTeam) return null;
  if (empTeam === 'C') return 'day';
  const nightTeam = dayTeam === 'A' ? 'B' : 'A';
  if (empTeam === dayTeam) return 'day';
  if (empTeam === nightTeam) return 'night';
  return null;
}

/**
 * ป้ายกำกับทีมสำหรับ dropdown/แสดงผล — **ห้ามเขียน "Team A (กะเช้า)" ตายตัวในหน้าใดๆ**
 * (เจอจริง 2026-08-21 ที่ `/operator`: dropdown เขียน A=กะเช้า B=กะดึก C=ไม่มีพันธะกะ — ผิดทั้ง 3 บรรทัด)
 *
 * ความจริงตาม `shiftFromTeam` ข้างบน:
 *   · A/B **หมุนสลับกันรายสัปดาห์** ตาม `shift_schedules.day_team` — สัปดาห์นี้ A เช้า สัปดาห์หน้า A ดึก
 *     ⇒ ไม่มีทางเขียนไว้ในป้ายได้ ต้องดูตารางกะของสัปดาห์นั้นเท่านั้น
 *   · **C คือทีมเดียวที่คงที่จริง** = กะเช้าตลอด ไม่หมุน
 *   · ทีมอื่นที่อาจมีในผังองค์กร (org_nodes kind='team') → `shiftFromTeam` คืน null
 *     = ระบบยังไม่รู้กติกาหมุนกะของทีมนั้น **ห้ามเดาให้** ป้ายจึงบอกแค่ชื่อทีม
 */
export function teamLabel(team) {
  const t = (team ?? '').toString().trim().toUpperCase();
  if (t === 'C') return `Team ${team} · กะเช้าตลอด (ไม่หมุนกะ)`;
  if (t === 'A' || t === 'B') return `Team ${team} · หมุนกะรายสัปดาห์`;
  return `Team ${team}`;
}

/**
 * กะที่พนักงานเข้าในวันนั้น ตามลำดับความสำคัญของระบบ:
 *   1. shift_overrides รายบุคคล  2. shift_merge_events (ไลน์ชนะ section)  3. ตารางกะ (ไลน์ → หน่วยงาน)
 * @param {object} emp                พนักงาน (ต้องมี line_id, team และ department ถ้าจะใช้กะระดับหน่วยงาน)
 * @param {object} ctx
 * @param {string} [ctx.overrideShift] กะที่ override ไว้ (ถ้ามี)
 * @param {string} [ctx.mergeShift]    กะจาก merge event ที่ครอบพนักงานคนนี้ (ถ้ามี)
 * @param {object} ctx.maps            ผลจาก buildScheduleMaps
 */
export function resolveAssignedShift(emp, { overrideShift, mergeShift, maps } = {}) {
  if (overrideShift) return overrideShift;
  if (mergeShift) return mergeShift;
  return shiftFromTeam(scheduleTeamFor(emp, maps), emp?.team);
}

/** เทียบชื่อหน่วยงาน (free text — เคส/ช่องว่างเพี้ยนกันได้) */
export const sameDept = (a, b) => norm(a) === norm(b) && norm(a) !== '';
