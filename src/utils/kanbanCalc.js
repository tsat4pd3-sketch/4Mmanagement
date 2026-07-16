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

/** YYYY-MM ของ "เดือนถัดไป" จากวันที่อ้างอิง (planner คำนวณปลายเดือนสำหรับเดือนหน้า) */
export function nextMonthKey(ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth(); // 0-based
  const d = new Date(y, m + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
