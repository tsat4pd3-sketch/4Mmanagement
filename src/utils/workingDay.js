/**
 * workingDay — "วันนี้เป็นวันทำงานไหม" + นาทีพักของวันที่ไม่ใช่วันทำงาน (2026-10-27 · คำสั่ง user)
 *
 * ⚠️ ไฟล์นี้ต้อง **ไม่ import supabaseClient** — `utils/oee.js` เรียกใช้ และ oee.js มีเทสที่รันใน node
 *    (ตัวโหลดปฏิทินจริงอยู่ `utils/companyCalendar.js` แล้ว *ป้อน* ทะเบียนเข้ามาที่นี่
 *     ด้วย `setDayTypeMap()` — แพทเทิร์นเดียวกับ `breakLineRules` ที่ oee.js อ่านทะเบียนกลางเอง)
 *
 * 🔴 กฎ "วันทำงาน" มีชุดเดียวในโปรเจค = `isWorkingDayFrom()` ไฟล์นี้
 *    (`countWorkingDaysInMonth` ใน companyCalendar.js เรียกตัวเดียวกัน — ห้ามเขียนกฎชุดที่ 2)
 */

/**
 * @returns {boolean|null} true = วันทำงาน · false = ไม่ใช่วันทำงาน · **null = ไม่รู้** (ปฏิทินยังไม่โหลด)
 * กติกา (เดิมจาก `countWorkingDaysInMonth` 2026-07-21):
 *   · มาร์คไว้ในปฏิทิน → เป็นวันทำงานก็ต่อเมื่อ `day_type === 'working'`
 *     (`ot15`/`ot2`/`shutdown75` = ไม่ใช่วันทำงาน)
 *   · ไม่ได้มาร์ค → จันทร์–ศุกร์ = วันทำงาน · เสาร์–อาทิตย์ = ไม่ใช่
 * 🔴 คิดวันในสัปดาห์แบบ UTC ล้วน — ห้ามพึ่ง timezone ของเครื่อง (กฎ Date/Time ของโปรเจค)
 */
export function isWorkingDayFrom(dayTypeMap, workDate) {
  if (!dayTypeMap || !workDate) return null;
  const t = typeof dayTypeMap.get === 'function' ? dayTypeMap.get(workDate) : dayTypeMap[workDate];
  if (t) return t === 'working';
  const [y, m, d] = String(workDate).split('-').map(Number);
  if (!(y > 0 && m > 0 && d > 0)) return null;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/* ── ทะเบียนกลางระดับโมดูล (ambient) — `companyCalendar.loadCompanyCalendar()` เป็นคนป้อน ── */
let ambient = null;
export function setDayTypeMap(map) { ambient = map || null; }
export function dayTypeMapSync() { return ambient; }

/** ใช้ทะเบียนกลาง · ปฏิทินยังไม่โหลด = `null` (ไม่รู้) */
export function isWorkingDay(workDate) { return isWorkingDayFrom(ambient, workDate); }

/**
 * 🔴 นาทีพักของ "วันที่ไม่ใช่วันทำงาน" — ทับ `duration_min` ด้วย `duration_min_holiday`
 *
 * เคสจริง: วันหยุดที่คนมาทำ OT พักเที่ยง **50 → 60 นาที** (คำสั่ง user 27/10)
 * ค่าตั้งอยู่ในทะเบียน `break_policies.duration_min_holiday` (ตั้งที่ ⚙️ ตั้งค่า → นโยบายหยุดพัก)
 * — **ห้ามฝังเลข 50/60 ในโค้ด** วันหลังโรงงานเปลี่ยนเป็น 45/70 จะต้องรอโปรแกรมเมอร์
 *
 * ลำดับการทับ: ค่ากลาง → **วันหยุด (ตัวนี้)** → ข้อยกเว้นรายไลน์ (`applyBreakLineRules`)
 *   ⇒ ไลน์ที่ตั้งนาทีของตัวเองไว้ **ชนะเสมอ** (เป็นค่าที่เจาะจงที่สุด)
 *
 * 🔴 ไม่รู้ว่าวันไหน (ปฏิทินยังไม่โหลด) **หรือ** เป็นวันทำงาน ⇒ คืน array เดิม = พฤติกรรมเดิมเป๊ะ
 *    ห้ามเดาว่าเป็นวันหยุด — เดาผิด = หักเวลาพักเกิน = %A/%P ตกทั้งกะโดยไม่มีใครเห็น
 */
export function applyHolidayBreaks(policies = [], workDate, dayTypeMap = undefined) {
  const list = Array.isArray(policies) ? policies : [];
  const map = dayTypeMap === undefined ? ambient : dayTypeMap;
  if (isWorkingDayFrom(map, workDate) !== false) return list;
  let changed = false;
  const out = list.map(p => {
    if (!p) return p;
    const hol = Number(p.duration_min_holiday);
    const base = Number(p.duration_min) || 0;
    if (!(hol >= 0) || p.duration_min_holiday == null || hol === base) return p;
    changed = true;
    /* ติดป้ายไว้ให้จอเขียนได้ว่า "วันหยุด 60 จากค่าปกติ 50" (แพทเทิร์นเดียวกับ line_rule_min) */
    return { ...p, duration_min: hol, holiday_min: hol, holiday_central_min: base };
  });
  return changed ? out : list;
}
