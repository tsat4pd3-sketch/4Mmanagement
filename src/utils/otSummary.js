/**
 * otSummary — สรุป "จำนวนวันที่ทำ OT รายบุคคล" ต่อเดือน (ตอบคำถาม HR ที่ถามซ้ำทุกเดือน)
 *
 * ที่มา (คำขอ user 2026-09-14): ทุกเดือน HR/ฝ่ายบุคคลส่งเมลขอ "รายชื่อคนที่ทำ OT เกิน 20 วัน
 * ของเดือนที่แล้ว + เหตุผลรายคน" แล้วหัวหน้าต้องไปนั่งนับจากไฟล์ Excel เอง — ข้อมูลดิบมีอยู่ในระบบแล้ว
 * (เช็คชื่อรายวัน has_ot + ใบจอง OT + ปฏิทินบริษัท) ขาดแค่ตัวสรุปให้ตรงรูปแบบที่เขาขอ
 *
 * ⚠️ กฎที่ยึด (CLAUDE.md · ENGINEERING-PRINCIPLES.md):
 * - **"ไม่รู้ ≠ ไม่มี"** — วันที่ไม่มีการเช็คชื่อเลย (โดยเฉพาะ เสาร์/อาทิตย์ ที่คนมาทำ OT วันหยุด)
 *   ต้องรายงานเป็น "ช่องโหว่ข้อมูล" เสมอ ห้ามปล่อยให้ตัวเลขต่ำกว่าจริงแบบเงียบๆ → `coverage.missingDays`
 * - **วันหยุด/วันทำงาน อ้างปฏิทินบริษัทก่อนเสมอ ห้ามเดาจากวันในสัปดาห์อย่างเดียว** (กฎ user 2026-07-21)
 *   กติกาเดียวกับ `countWorkingDaysInMonth`: มาร์คไว้ = เชื่อมาร์ค · ไม่มาร์ค จ-ศ = วันทำงาน · ไม่มาร์ค ส-อา = หยุด
 * - **ห้าม `new Date('YYYY-MM-DD')`** (ถูกตีเป็น UTC → วันในสัปดาห์เพี้ยนได้) — แตก string เองเสมอ
 * - ฟังก์ชันทั้งไฟล์เป็น pure (ไม่แตะ network/เวลาปัจจุบันเอง) → มีเทสใน __tests__ และ **รับ `now`
 *   เป็นพารามิเตอร์** ตามกฎกันเทสระเบิดเวลา (CLAUDE.md — `npm test` รันรอบนาฬิกา +400 วันด้วย)
 *
 * นิยามที่ตกลงไว้ (เปลี่ยนที่นี่ที่เดียว):
 *   1 วัน OT = 1 วันงานที่คนนั้น "ทำ OT" — ไม่ว่าจะกี่ชั่วโมง (has_extended_ot ไม่นับเพิ่มเป็นอีกวัน)
 *   เพราะคำถามของ HR คือ *จำนวนวัน* ไม่ใช่จำนวนชั่วโมง (ระบบยังไม่เก็บชั่วโมง OT จริงรายคน)
 */

/** วันในสัปดาห์จาก 'YYYY-MM-DD' แบบ local (0=อา .. 6=ส) — ห้ามใช้ new Date(str) ตรงๆ (UTC) */
export function dowOf(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getDay();
}

/**
 * ชนิดของวัน สำหรับการนับ OT
 * @returns {{ type: string, holiday: boolean, marked: boolean }}
 *   type: 'working' | 'ot15' | 'ot2' | 'shutdown75' | 'weekend'  (weekend = ส-อา ที่ไม่มีมาร์คในปฏิทิน)
 *   holiday: true = โรงงานหยุดวันนั้น (มาทำ = "OT วันหยุด" ในสายตา HR)
 */
export function dayKindOf(dateStr, dayTypeMap) {
  const marked = dayTypeMap?.get ? dayTypeMap.get(dateStr) : dayTypeMap?.[dateStr];
  if (marked) return { type: marked, holiday: marked !== 'working', marked: true };
  const dow = dowOf(dateStr);
  const weekend = dow === 0 || dow === 6;
  return { type: weekend ? 'weekend' : 'working', holiday: weekend, marked: false };
}

/** ทุกวันของเดือน 'YYYY-MM' เป็น array ของ 'YYYY-MM-DD' */
export function daysOfMonth(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return [];
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);
}

/** เดือนก่อนหน้าของ 'YYYY-MM' (เดือนที่ HR ถามถึงตามปกติ) */
export function prevMonthKey(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * สรุป OT รายบุคคลของเดือนหนึ่ง
 *
 * @param {object} p
 * @param {string} p.monthKey       'YYYY-MM'
 * @param {Array}  p.logs           แถว daily_production_logs ของเดือนนั้น {work_date, employee_id, has_ot, is_present}
 * @param {Array}  p.bookings       แถว ot_night_bookings ของเดือนนั้น {work_date, employee_id, task_type_id, ot_period}
 * @param {Map|object} p.taskNameById  id งาน OT → ชื่องาน (ot_task_types)
 * @param {Map|object} p.dayTypeMap    'YYYY-MM-DD' → day_type จาก company_calendar
 * @param {(id:string)=>boolean} [p.includeEmployee] ตัวกรองขอบเขต (scope/ส่วนงาน) — ไม่ส่ง = เอาทุกคน
 * @param {boolean} [p.countBookingOnly=true] นับวันที่มี "ใบจอง OT" แต่ไม่มีแถวเช็คชื่อด้วยหรือไม่
 *        (จำเป็นสำหรับวันหยุด — วันหยุดมักไม่มีการเช็คชื่อ แต่มีใบจองรถ OT อยู่)
 */
export function summarizeOtMonth({
  monthKey, logs = [], bookings = [], taskNameById, dayTypeMap,
  includeEmployee, countBookingOnly = true,
}) {
  const get = (mapLike, k) => (mapLike?.get ? mapLike.get(k) : mapLike?.[k]);
  const inMonth = (d) => String(d || '').slice(0, 7) === monthKey;
  const keep = (id) => (includeEmployee ? includeEmployee(id) : true);

  // เก็บ "วันที่ทำ OT" ต่อคน — key = employee_id → Map<date, { kind, viaLog, viaBooking, task }>
  const byEmp = new Map();
  const touch = (empId, date) => {
    if (!byEmp.has(empId)) byEmp.set(empId, new Map());
    const days = byEmp.get(empId);
    if (!days.has(date)) days.set(date, { date, kind: dayKindOf(date, dayTypeMap), viaLog: false, viaBooking: false, tasks: [] });
    return days.get(date);
  };

  for (const r of logs) {
    if (!r?.has_ot || !inMonth(r.work_date) || !keep(r.employee_id)) continue;
    touch(r.employee_id, r.work_date).viaLog = true;
  }
  for (const b of bookings) {
    if (!inMonth(b?.work_date) || !keep(b.employee_id)) continue;
    const hasLog = byEmp.get(b.employee_id)?.get(b.work_date)?.viaLog;
    if (!hasLog && !countBookingOnly) continue;   // ไม่นับใบจองลอย — แต่ยังต้องเก็บ "เหตุผล" ของวันที่มี log
    const day = touch(b.employee_id, b.work_date);
    day.viaBooking = true;
    const name = b.task_type_id ? get(taskNameById, b.task_type_id) : null;
    if (name) day.tasks.push(name);
  }

  const rows = [];
  for (const [employeeId, days] of byEmp) {
    let working = 0, holiday = 0, shutdown = 0, bookingOnly = 0;
    const reasonCount = new Map();
    const dayList = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const d of dayList) {
      if (d.kind.type === 'shutdown75') shutdown++;
      else if (d.kind.holiday) holiday++;
      else working++;
      if (!d.viaLog) bookingOnly++;
      for (const t of d.tasks) reasonCount.set(t, (reasonCount.get(t) || 0) + 1);
    }
    const reasons = [...reasonCount.entries()]
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    rows.push({
      employeeId,
      working, holiday, shutdown, bookingOnly,
      total: dayList.length,
      days: dayList,
      reasons,
      reasonText: reasonText(reasons),
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

/** ข้อความ "เหตุผล" สำหรับช่องหมายเหตุ — งานที่จองบ่อยสุด 3 อันดับ (ตัวที่ไม่ระบุงานไม่ต้องเดา) */
export function reasonText(reasons = [], top = 3) {
  if (!reasons.length) return '';
  const head = reasons.slice(0, top).map(r => `${r.name} (${r.n} วัน)`);
  const restN = reasons.slice(top).reduce((s, r) => s + r.n, 0);
  return restN ? `${head.join(' · ')} · อื่นๆ ${restN} วัน` : head.join(' · ');
}

/**
 * ช่องโหว่ข้อมูลของเดือน — วันไหน "ไม่มีร่องรอยการเช็คชื่อเลย"
 * วันหยุดที่ไม่มีข้อมูลคือจุดที่ทำให้ยอด OT วันหยุดต่ำกว่าจริงมากที่สุด → แยกนับให้เห็นชัด
 */
export function otCoverage({ monthKey, logs = [], bookings = [], dayTypeMap, today = null }) {
  const logged = new Set(logs.map(r => r?.work_date).filter(d => String(d || '').slice(0, 7) === monthKey));
  const booked = new Set(bookings.map(r => r?.work_date).filter(d => String(d || '').slice(0, 7) === monthKey));
  const all = daysOfMonth(monthKey).filter(d => !today || d <= today);
  const missing = all
    .filter(d => !logged.has(d))
    .map(d => ({ date: d, kind: dayKindOf(d, dayTypeMap), hasBooking: booked.has(d) }));
  return {
    days: all.length,
    loggedDays: all.length - missing.length,
    missingDays: missing,
    missingHolidayDays: missing.filter(m => m.kind.holiday).length,
    missingWorkingDays: missing.filter(m => !m.kind.holiday).length,
  };
}

/**
 * คาดการณ์ยอดสิ้นเดือนจากอัตราที่ทำมาแล้ว (ใช้เฉพาะแท็บ "เดือนปัจจุบัน" — เตือนก่อนเกินเกณฑ์)
 * ตั้งใจให้เป็นเส้นตรงแบบง่าย: เห็นแนวโน้มพอ ไม่ใช่คำพยากรณ์ — ปัดขึ้นเสมอ (เตือนไว้ก่อนดีกว่าพลาด)
 */
export function projectTotal(count, elapsedDays, totalDays) {
  if (!elapsedDays || !totalDays || elapsedDays >= totalDays) return count;
  return Math.ceil((count * totalDays) / elapsedDays);
}

/** จำนวนวันทำงาน/วันหยุดของเดือนตามปฏิทิน (ใช้เป็นตัวหารของ projection + แสดงบริบทบนจอ) */
export function monthDayStats(monthKey, dayTypeMap, upTo = null) {
  const days = daysOfMonth(monthKey).filter(d => !upTo || d <= upTo);
  let working = 0, holiday = 0;
  for (const d of days) (dayKindOf(d, dayTypeMap).holiday ? holiday++ : working++);
  return { days: days.length, working, holiday };
}
