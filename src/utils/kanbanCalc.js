/**
 * Kanban calculation — Type A: Withdrawal Kanban (PW-PC Store Calculation).
 * ถอดจากไฟล์คำนวณจริง (docs: Kanban Calculation study). ⌈x⌉ = ROUNDUP.
 *
 *   Order/Day    = Order/Month / working_days
 *   CT (sec)     = 3600 / capacity_pc_hr
 *   Order/Round  = ⌈ Order/Day / delivery_cycle ⌉
 *   Prep         = ⌈ prep_time_min*60 / CT ⌉
 *   Fluctuation  = ⌈ (Order/Round + Prep) * fluctuation_pct/100 ⌉
 *   Safety-time  = ⌈ Order/Round * (100 - efficiency_pct)/100 ⌉
 *   Min (kanban) = ⌈ Order/Day * safety_days / packaging ⌉
 *   Max (kanban) = ⌈ (Round+Prep+Fluct+Safety)/packaging ⌉ + Min
 *   Total kanban = Max + lot_size
 * pcs = kanban * packaging.
 */
const up = (x) => (isFinite(x) && x > 0 ? Math.ceil(x - 1e-9) : 0);
const num = (x) => { const n = Number(x); return isFinite(n) ? n : 0; };

export function calcWithdrawalKanban(p) {
  const workingDays   = num(p.workingDays);
  const efficiencyPct = num(p.efficiencyPct);
  const orderMonth    = num(p.orderMonth);
  const packaging     = num(p.packaging);
  const capacity      = num(p.capacityPcHr);
  const deliveryCycle = num(p.deliveryCycle) || 1;
  const lotSize       = num(p.lotSize);
  const safetyDays    = num(p.safetyDays);

  const orderDay   = workingDays ? orderMonth / workingDays : 0;
  const ct         = capacity ? 3600 / capacity : 0;                  // sec/pc
  const orderRound = up(orderDay / deliveryCycle);
  const prep       = ct ? up(num(p.prepTimeMin) * 60 / ct) : 0;
  const fluct      = up((orderRound + prep) * num(p.fluctuationPct) / 100);
  const safetyTime = up(orderRound * (100 - efficiencyPct) / 100);
  const minKanban  = packaging ? up(orderDay * safetyDays / packaging) : 0;
  const maxKanban  = packaging ? up((orderRound + prep + fluct + safetyTime) / packaging) + minKanban : 0;
  const totalKanban = maxKanban + lotSize;

  return {
    orderDay, ct, orderRound, prep, fluct, safetyTime,
    minKanban, maxKanban, totalKanban,
    minPcs: minKanban * packaging,
    maxPcs: maxKanban * packaging,
    totalPcs: totalKanban * packaging,
    // ต้องมีครบถึงคำนวณได้: มี forecast, วันทำงาน, packaging, capacity
    valid: !!(orderMonth > 0 && workingDays > 0 && packaging > 0 && capacity > 0),
  };
}

/**
 * Kanban calculation — Type B: Production Kanban (PI Press).
 * ถอดจากไฟล์ PI_Press_Rev.1 และ verify กับ BRKT ENG (20066332):
 *   order/เดือน 11778, วันทำงาน 20, CT 10s, process 4, pkg 300, lot 3000, setup 900s, safety 3 วัน
 *   → Vol/Day 589, Kanban(sys) 16, Min 6, Max 16, work-time 121,313 s/เดือน
 *
 *   Vol/Day      = ⌈ Order/Month / working_days ⌉
 *   CT (sec)     = ctSec  หรือ  3600 / capacity_pc_hr
 *   Info LT      = lot_qty * CT        Process LT = process_count * CT
 *   Safety LT    = Vol/Day * CT * safety_days
 *   Kanban/Lot   = ⌈ lot_qty / packaging ⌉
 *   Kanban(sys)  = ⌈ (Info+Process+Safety) / CT / packaging ⌉   → total_kanban
 *   Min (kanban) = ⌈ Safety / CT / packaging ⌉
 *   Max (kanban) = Min + Kanban/Lot
 *   Work-time/part/month (sec) = (setup_time + lot_qty*CT) * (Order/Month / lot_qty)
 *   Available/line/month (sec) = hours_per_day * 3600 * working_days   → ใช้คิด %load
 */
export function calcProductionKanban(p) {
  const workingDays  = num(p.workingDays);
  const orderMonth   = num(p.orderMonth);
  const packaging    = num(p.packaging);
  const capacity     = num(p.capacityPcHr);
  const ct           = num(p.ctSec) || (capacity ? 3600 / capacity : 0);   // sec/pc
  const processCount = num(p.processCount);
  const lotQty       = num(p.lotQty);
  const setupTime    = num(p.setupTimeSec);
  const safetyDays   = num(p.safetyDays);
  const hoursPerDay  = num(p.hoursPerDay) || 16;

  const volDay       = up(workingDays ? orderMonth / workingDays : 0);
  const infoLT       = lotQty * ct;
  const procLT       = processCount * ct;
  const safetyLT     = volDay * ct * safetyDays;
  const kanbanPerLot = packaging ? up(lotQty / packaging) : 0;
  const kanbanSystem = (ct && packaging) ? up((infoLT + procLT + safetyLT) / ct / packaging) : 0;
  const minKanban    = (ct && packaging) ? up(safetyLT / ct / packaging) : 0;
  const maxKanban    = minKanban + kanbanPerLot;
  const workTimeMonth  = lotQty ? (setupTime + lotQty * ct) * (orderMonth / lotQty) : 0;  // sec/part/month
  const availableMonth = hoursPerDay * 3600 * workingDays;

  return {
    volDay, ct, infoLT, procLT, safetyLT, kanbanPerLot,
    minKanban, maxKanban, totalKanban: kanbanSystem,
    minPcs: minKanban * packaging,
    maxPcs: maxKanban * packaging,
    totalPcs: kanbanSystem * packaging,
    workTimeMonth, availableMonth,
    loadPct: availableMonth ? (workTimeMonth / availableMonth) * 100 : 0,
    // ต้องมีครบถึงคำนวณได้: forecast, วันทำงาน, packaging, CT, lot
    valid: !!(orderMonth > 0 && workingDays > 0 && packaging > 0 && ct > 0 && lotQty > 0),
  };
}

/** YYYY-MM ของ "เดือนถัดไป" จากวันที่อ้างอิง (planner คำนวณปลายเดือนสำหรับเดือนหน้า) */
export function nextMonthKey(ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth(); // 0-based
  const d = new Date(y, m + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
