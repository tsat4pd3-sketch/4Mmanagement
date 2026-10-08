/* ═══════════════════════════════════════════════════════════════════════════
   🔩 อะไหล่ของแผน PM — ความต้องการล่วงหน้า + ความพร้อมรายแผน          2026-10-08

   คำสั่ง user: "ทำเรื่องผูก Spare เข้ากับแผน PM ต่อเลย" (ทีมช่าง: "เหลือส่วน PM กับ Spare
   จะกรอกเป็น Target Plan PM ที่จะถึง")
   ตาราง `pm_plan_spares` (DR · migration `20261008_pm_plan_spares_dr.sql`) = PM 1 รอบใช้อะไหล่อะไร กี่ชิ้น
   ตอบ 2 คำถาม:
     1) "PM ใบนี้ อะไหล่พร้อมไหม"                 → planReadiness()
     2) "PM ที่จะถึงใน N วัน ต้องใช้อะไหล่อะไรรวมเท่าไหร่
         ของพอไหม · ถ้าไม่พอต้องสั่งภายในวันไหน"      → spareDemand()

   ── กติกา ──────────────────────────────────────────────────────────────────
   · นับ "ครั้งที่ PM จะเกิด" ในหน้าต่าง ไม่ใช่นับแผนละครั้ง — แผนรายสัปดาห์ใน 30 วัน = 4-5 ครั้ง
     (นับครั้งเดียว = ความต้องการต่ำกว่าจริง 4 เท่า ⇒ ของขาดกลางเดือน)
   · PM ที่เลยกำหนด = ต้องทำวันนี้ ⇒ นับเป็นครั้งแรกที่วันนี้ แล้วรอบต่อไปนับจากวันนี้ + รอบ
   · แผนที่ "ยังไม่มีวันครบกำหนด" คาดไม่ได้ ⇒ **ห้ามตีเป็น 0 เงียบๆ** คืนเป็นรายการ `noDue` ให้จอบอก
   · แผนนับจาก "วันเครื่องเดิน" (run_day) ใช้รอบปฏิทินแทน = **ประมาณเผื่อ** (เครื่องไม่ได้เดินทุกวัน
     ใช้จริงน้อยกว่าหรือเท่า) ⇒ ติดธง `estimate` ให้จอเขียนบอก — สำหรับเตรียมอะไหล่ เผื่อเกินดีกว่าขาด
   · "ต้องสั่งภายใน" = วันแรกที่ยอดสะสมเกินสต็อก − leadtime ของอะไหล่ · ไม่มี leadtime = null (ห้ามเดา)
   · สต็อกต่ำกว่า min_qty หลังหัก = เตือน (ยังพอทำ PM แต่ขาด safety stock ตาม WI-JIG-010)

   ⚠️ pure ทั้งไฟล์ · วันที่เป็นสตริง YYYY-MM-DD ทั้งหมด · รับ todayStr จากผู้เรียก (เทสตรึงวันได้)
   ═══════════════════════════════════════════════════════════════════════════ */
import { addDaysStr } from './workDate.js';   // ของกลาง — UTC ล้วน ไม่พึ่ง timezone เครื่อง (ด่าน no-utc-workdate)

export const SPARE_HORIZON_DAYS = 30;
const MAX_OCCURRENCES = 400;   // กันลูปไม่จบ (รายวัน 1 ปี = 365)

export const addDaysYmd = (ymd, n) => addDaysStr(ymd, n);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** วันที่ PM จะเกิดในหน้าต่าง [today … today+horizon] · ไม่มีวันครบ = [] */
export function pmOccurrences({ dueYmd, cycleDays, todayStr, horizonDays = SPARE_HORIZON_DAYS }) {
  if (!dueYmd || !todayStr) return [];
  const end = addDaysYmd(todayStr, horizonDays);
  const step = num(cycleDays) > 0 ? Math.round(num(cycleDays)) : null;
  const out = [];
  let d = dueYmd < todayStr ? todayStr : String(dueYmd).slice(0, 10);
  while (d <= end && out.length < MAX_OCCURRENCES) {
    out.push(d);
    if (!step) break;            // ไม่มีรอบ = ครั้งเดียว (วันที่กำหนดเอง)
    d = addDaysYmd(d, step);
  }
  return out;
}

/**
 * ความพร้อมอะไหล่ของ PM 1 ใบ (รอบถัดไป 1 ครั้ง)
 * @param lines [{ part_id, qty_per_pm }] ของแผนนี้
 * @param partsById Map/obj id → part
 * @returns {{ items:[{ line, part, qty, stock, ok, missing }], allOk:boolean|null, shortCount }}
 *   allOk = null เมื่อยังไม่ได้ผูกอะไหล่เลย (ไม่ใช่ "พร้อม")
 */
export function planReadiness(lines = [], partsById = {}) {
  const get = (id) => (partsById instanceof Map ? partsById.get(id) : partsById[id]);
  const items = lines.map(l => {
    const part = get(l.part_id) || null;
    const qty = num(l.qty_per_pm) || 0;
    const stock = part ? (num(part.stock_qty) ?? 0) : null;
    return { line: l, part, qty, stock, ok: part != null && stock >= qty, missing: !part };
  });
  const shortCount = items.filter(i => !i.ok).length;
  return { items, allOk: items.length ? shortCount === 0 : null, shortCount };
}

/**
 * ความต้องการอะไหล่ของ PM ที่จะถึง
 * @param p.plans  [{ checklistId, name, dueYmd, cycleDays, estimate }]  (แผนที่มีอะไหล่ผูกอยู่)
 * @param p.lines  pm_plan_spares [{ checklist_id, part_id, qty_per_pm }]
 * @param p.parts  mtn_spare_parts [{ id, name, code, unit, stock_qty, min_qty, lead_time_days }]
 * @returns {{ rows, noDue, summary }}
 *   row: { part, needQty, stock, after, shortQty, belowMin, firstUseYmd, firstShortYmd,
 *          orderByYmd, orderLate, uses:[{checklistId,name,ymd,qty}], estimate }
 */
export function spareDemand({ plans = [], lines = [], parts = [], todayStr, horizonDays = SPARE_HORIZON_DAYS } = {}) {
  const partById = new Map(parts.map(p => [p.id, p]));
  const planById = new Map(plans.map(p => [p.checklistId, p]));
  const byPart = new Map();
  const noDue = new Map();      // checklistId → plan (มีอะไหล่ผูก แต่คาดวัน PM ไม่ได้)

  for (const l of lines) {
    const plan = planById.get(l.checklist_id);
    const part = partById.get(l.part_id);
    if (!plan || !part) continue;
    const qty = num(l.qty_per_pm) || 0;
    if (!(qty > 0)) continue;
    const occ = pmOccurrences({ dueYmd: plan.dueYmd, cycleDays: plan.cycleDays, todayStr, horizonDays });
    if (!plan.dueYmd) { noDue.set(plan.checklistId, plan); continue; }
    if (!occ.length) continue;   // ครบกำหนดหลังหน้าต่าง — ยังไม่ต้องเตรียม
    let r = byPart.get(part.id);
    if (!r) { r = { part, uses: [], estimate: false }; byPart.set(part.id, r); }
    for (const ymd of occ) r.uses.push({ checklistId: plan.checklistId, name: plan.name, ymd, qty });
    if (plan.estimate) r.estimate = true;
  }

  const rows = [...byPart.values()].map(r => {
    r.uses.sort((a, b) => a.ymd.localeCompare(b.ymd));
    const stock = num(r.part.stock_qty) ?? 0;
    const needQty = r.uses.reduce((s, u) => s + u.qty, 0);
    const after = stock - needQty;
    let cum = 0, firstShortYmd = null;
    for (const u of r.uses) { cum += u.qty; if (cum > stock) { firstShortYmd = u.ymd; break; } }
    const lead = num(r.part.lead_time_days);
    const orderByYmd = firstShortYmd && lead != null ? addDaysYmd(firstShortYmd, -lead) : null;
    const minQ = num(r.part.min_qty);
    return {
      part: r.part, uses: r.uses, estimate: r.estimate,
      needQty, stock, after,
      shortQty: Math.max(0, needQty - stock),
      belowMin: after >= 0 && minQ != null && minQ > 0 && after < minQ,
      firstUseYmd: r.uses[0]?.ymd || null,
      firstShortYmd, leadDays: lead, orderByYmd,
      orderLate: orderByYmd != null && orderByYmd < todayStr,
    };
  }).sort((a, b) =>
    (b.shortQty > 0) - (a.shortQty > 0)
    || (a.orderByYmd || a.firstShortYmd || '9999').localeCompare(b.orderByYmd || b.firstShortYmd || '9999')
    || (b.belowMin - a.belowMin)
    || String(a.firstUseYmd).localeCompare(String(b.firstUseYmd)));

  return {
    rows,
    noDue: [...noDue.values()],
    summary: {
      parts: rows.length,
      short: rows.filter(r => r.shortQty > 0).length,
      orderLate: rows.filter(r => r.orderLate).length,
      belowMin: rows.filter(r => r.belowMin).length,
      noDuePlans: noDue.size,
      horizonDays,
    },
  };
}
