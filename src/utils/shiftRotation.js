/**
 * shiftRotation — ต่อ "รอบสลับกะ A/B" ไปข้างหน้าจากประวัติที่หัวหน้าตั้งไว้จริง
 *
 * ที่มา (feedback 2026-08-28): ตารางกะ PD4 หมดที่ 23/08 แล้วไม่มีใครตั้งต่อ
 *   → assignedShift = null → คนหายจากทุกกะบนจอ (ดูกฎ "คนที่จัดเข้ากะไม่ได้" ใน CLAUDE.md)
 *   หน้างานบอกว่า "ปกติสลับทุก 2 สัปดาห์อยู่แล้ว" → ต่อ pattern ให้เป็น fallback ได้
 *
 * ⚠️ กฎเหล็กของไฟล์นี้:
 *   1. **ระบบเสนอ คนตัดสิน** — ไฟล์นี้แค่คำนวณ ห้ามมีใครเอาไปเขียน DB โดยไม่ผ่าน preview + ปุ่มยืนยัน
 *   2. **pattern ไม่ชัด = ตอบ ok:false พร้อมเหตุผล ห้ามเดา** (ไลน์ที่เพิ่งเปิด/สลับไม่สม่ำเสมอ)
 *   3. **ทนช่องว่าง** — สัปดาห์ที่ไม่มีใครตั้งไว้ต้องไม่ทำให้ตรวจ pattern พลาด
 *      (ข้อมูลจริง GOR ขาดสัปดาห์ 10-16/08 แต่ 17/08 กลับมาตรงจังหวะ = ตกหล่น ไม่ใช่ pattern ต่าง)
 *   4. วันที่เป็น 'YYYY-MM-DD' local ล้วน — **ห้ามใช้ toISOString** (UTC เพี้ยนวันสำหรับไทย)
 */

const MS_DAY = 86400000;
const other = t => (t === 'A' ? 'B' : 'A');

/** 'YYYY-MM-DD' → Date เที่ยงวัน local (เที่ยงวันกัน DST/ปัดวันเพี้ยน) */
const toDate = s => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function addDays(dateStr, n) {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ (สัปดาห์เริ่มวันจันทร์ ตรงกับหน้า /shift-organize) */
export function mondayOf(dateStr) {
  const d = toDate(dateStr);
  const dow = d.getDay();            // 0=อา 1=จ ... 6=ส
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** จำนวนสัปดาห์ระหว่างวันจันทร์ 2 วัน (ติดลบได้) */
export function weeksBetween(fromMonday, toMonday) {
  return Math.round((toDate(toMonday) - toDate(fromMonday)) / (MS_DAY * 7));
}

/**
 * ตรวจว่ารอบสลับกะเป็นแบบ "ทุก K สัปดาห์" หรือไม่
 * @param weeks [{ monday, team }] ไม่ต้องเรียง ไม่ต้องต่อเนื่อง
 * @returns { ok, periodWeeks, anchorMonday, anchorTeam, lastMonday, weeksSeen } | { ok:false, reason }
 */
export function detectRotation(weeks, { maxPeriod = 4, minWeeks = 4 } = {}) {
  const byMon = new Map();
  (weeks || []).forEach(w => {
    if (!w || !w.monday) return;
    if (w.team !== 'A' && w.team !== 'B') return;   // ทีม C/ค่าอื่น ไม่เข้ารอบสลับ
    byMon.set(w.monday, w.team);                     // monday ซ้ำ = เอาตัวหลัง
  });
  const list = [...byMon.entries()]
    .map(([monday, team]) => ({ monday, team }))
    .sort((a, b) => (a.monday < b.monday ? -1 : a.monday > b.monday ? 1 : 0));

  if (list.length < 2) return { ok: false, reason: 'ประวัติน้อยเกินไป (ต้องมีอย่างน้อย 2 สัปดาห์)' };
  if (new Set(list.map(w => w.team)).size < 2)
    return { ok: false, reason: 'ยังไม่เคยสลับกะเลยในช่วงที่ดู — ต่อรอบให้ไม่ได้' };

  /* ไล่จาก "ประวัติเต็ม" ก่อน แล้วค่อยตัดสัปดาห์เก่าสุดออกทีละอันถ้ายังไม่เข้ารูป
   * — รอบสลับเปลี่ยนกติกาได้ตามช่วงเวลา (ข้อมูลจริง: LINE APRON ASSY เดือน พ.ค. สลับทุกสัปดาห์
   *   แล้วมาเป็นทุก 2 สัปดาห์ตั้งแต่ มิ.ย.) เหตุการณ์เก่าไม่ควรทำให้ต่อรอบปัจจุบันไม่ได้
   * ⚠️ แต่ต้องเหลืออย่างน้อย minWeeks สัปดาห์และมีการสลับจริง ไม่งั้นกลายเป็นเดาจากข้อมูล 2-3 จุด
   * ⚠️ ต้องรายงาน weeksSeen/ignoredOlder ออกไปให้จอแสดง — คนต้องรู้ว่าดูจากกี่สัปดาห์ */
  for (let start = 0; start <= list.length - minWeeks; start++) {
    const win = list.slice(start);
    if (new Set(win.map(w => w.team)).size < 2) break;   // ตัดจนไม่เหลือการสลับแล้ว
    const anchorMonday = win[0].monday;
    const anchorTeam = win[0].team;
    const idx = win.map(w => ({ ...w, i: weeksBetween(anchorMonday, w.monday) }));
    for (let k = 1; k <= maxPeriod; k++) {
      // ต้องเห็นอย่างน้อย 2 บล็อกของรอบนั้น ไม่งั้นข้อมูล 3-4 จุดจะ "เข้ารูป" กับรอบยาวๆ ได้เสมอ
      // (เจอจริงตอนเทส: 4 สัปดาห์มั่วๆ ถูกตีเป็น "สลับทุก 3 สัปดาห์")
      if (win.length < 2 * k) continue;
      const fit = idx.every(w => w.team === (Math.floor(w.i / k) % 2 === 0 ? anchorTeam : other(anchorTeam)));
      if (fit) {
        return {
          ok: true, periodWeeks: k, anchorMonday, anchorTeam,
          lastMonday: win[win.length - 1].monday,
          weeksSeen: win.length, ignoredOlder: start,
        };
      }
    }
  }
  return { ok: false, reason: 'รูปแบบการสลับไม่สม่ำเสมอ — ต้องตั้งเอง' };
}

/** กะของสัปดาห์นั้นตามรอบที่ตรวจได้ (รองรับสัปดาห์ก่อน anchor ด้วย — index ติดลบ) */
export function teamForWeek(rot, monday) {
  if (!rot || !rot.ok) return null;
  const i = weeksBetween(rot.anchorMonday, monday);
  const blk = Math.floor(i / rot.periodWeeks);
  return (((blk % 2) + 2) % 2) === 0 ? rot.anchorTeam : other(rot.anchorTeam);
}

/**
 * ต่อสัปดาห์ไปข้างหน้า — ข้ามสัปดาห์ที่มีข้อมูลอยู่แล้วเสมอ (ห้ามทับของที่คนตั้งไว้)
 * @param existingMondays Set/Array ของวันจันทร์ที่มีแถวอยู่แล้ว
 * @returns { weeks: [{monday, team}], skipped: number }
 */
export function projectWeeks({ rotation, fromMonday, count, existingMondays = [] }) {
  const have = existingMondays instanceof Set ? existingMondays : new Set(existingMondays);
  const weeks = [];
  let skipped = 0;
  for (let n = 0; n < count; n++) {
    const monday = addDays(fromMonday, n * 7);
    if (have.has(monday)) { skipped++; continue; }
    const team = teamForWeek(rotation, monday);
    if (!team) continue;
    weeks.push({ monday, team });
  }
  return { weeks, skipped };
}
