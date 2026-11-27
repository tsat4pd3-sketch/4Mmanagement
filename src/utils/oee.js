/*
  OEE — single source of truth ของการคำนวณทุกตัวชี้วัดที่ใช้ร่วมหลายจอ
  ═══════════════════════════════════════════════════════════════════
  รวมไว้ไฟล์เดียวโดยตั้งใจ (เดิมแตกเป็น liveOee/strictOee/oeeAvg แล้วสูตรเริ่ม drift กัน)
  — จอไหนจะโชว์ A/P/Q/OEE/OOE/TEEP ต้อง import จากที่นี่ ห้ามเขียนสูตรเองในหน้า

  ค่าที่ stamp ตอนปิดกะ (`production_sessions.oee_a/p/q/oee`) คือความจริงสูงสุดของกะที่ปิดแล้ว
  — ห้ามคำนวณใหม่ด้วย master ปัจจุบัน · ตัวชี้วัดอื่น (OOE/TEEP/strict) คูณ "สัดส่วนฐานเวลา"
  จากค่าที่ stamp เสมอ เพื่อไม่ให้ได้ตัวเลขคนละชุดกับ Daily Report

  สารบัญ:
    1) wavg / wLoad / wRun / wProd  — เฉลี่ยข้ามกะแบบถ่วงน้ำหนัก (ห้าม mean-of-percentages)
    2) ctForMat                     — cycle time ต่อ MAT (kanban_standards → dr_products)
    3) policyBreakMin               — เวลาพักตามนโยบายที่ทับกับช่วงเวลาที่สนใจ
    4) computeLiveOee               — OEE สดของกะที่ยังไม่ปิด
    5) strictOee                    — "OEE จริง" นับหยุดในแผนเป็นการสูญเสีย
    6) orderProducedQty             — "ใบผลิตใบนี้ผลิตได้กี่ชิ้น" (สูตรบังคับของโปรเจค)
    7) ngByMatFrom                  — ชิ้นที่เครื่องทำออกมาแต่ไม่ดี แยกตาม MAT (ตัวเศษ %P)

  🔴🔴 กฎเหล็ก — **%P นับ "ทุกชิ้นที่เครื่องทำออกมา" · %Q นับ "กี่ชิ้นในนั้นที่ดี"** (2026-10-04)
     P = CT × **Total Count** ÷ Run Time   ·   Q = **Good** ÷ Total Count   (Nakajima / SEMI E79)
     Total Count = งานดี **+ ของเสีย + งานทดลอง + ของสงสัย** — ทุกชิ้นกินรอบเครื่องเท่ากันหมด
     ⇒ นับแต่งานดีในตัวเศษ %P = ของเสีย 1 ชิ้นถูกหัก **2 ครั้ง** (ที่ %P และที่ %Q) = OEE ต่ำกว่าจริง
     (ที่มา: หัวหน้าทัก 04/10 *"P คิดที่งานผลิตได้ งานที่ผลิตเสียออกมาไม่คิด ทำให้ P ตก"* — จริง
      · user ชี้ขาดว่า**งานทดลองก็ต้องเข้า** เพราะ "ใช้เครื่องลองผลิต" เครื่องเดินรอบจริง)
     · ตัวเศษเติมผ่าน `ngByMatFrom` → พารามิเตอร์ `ngForP` (computeLiveOee) / จาก `defects` (computeSessionOee)
     · 🔴 **%P ใช้ `defectQtyAll` (เห็นทุกชิ้น) · %Q ใช้ `defectQty`/`sumDefectQty` line-mode — ห้ามสลับ**
       ผลพลอยได้ที่ถูกต้อง: QA ตัดสินของสงสัยแล้ว **%Q ขยับ · %P ไม่ขยับ** (ความเร็วไม่ได้เปลี่ยน)
     · 🔴 ของเสียที่ชี้ MAT ไม่ได้ = ไม่รู้ CT ⇒ **ไม่เข้า %P แต่ต้องรายงาน `ngNoMatP` ออกจอ** ห้ามเดา
     · มีด่าน `oee-live-needs-ngforp` ใน regressionGuards (ลืมส่ง = จอตอบ %P ต่ำกว่าจออื่นเงียบๆ)
*/

// งานคู่ gang die / RH-LH — ยุบเป็น "1 shot" ก่อนคิดเวลามาตรฐานของ %P (ดูกติกา ชิ้น≠shot ในไฟล์นั้น)
import { collapsePairShots } from './pairTotals.js';
import { tr } from './i18n.js';
// §8 computeSessionOee ต้องรู้โหมดไลน์/จำนวนสถานีขนาน (source of truth = lineTypes.js · ไม่มี import วนกลับ)
import { parallelUnitsOf, flowModeOf } from './lineTypes.js';
/* 🏷️ คีย์เลขเครื่อง — `machine_no` เป็นข้อความอิสระ (SW10 vs SW-10 = เครื่องเดียวกัน)
   ทะเบียน "ครอบกี่เลน" ต้อง join ด้วยคีย์เดียวกับทั้งระบบ ห้ามเทียบสตริงดิบ (utils/machineNo.js) */
import { machineKey } from './machineNo.js';
import { applyBreakLineRules, breakLineRuleIndexSync, breakLineRuleIndexOf, breakRulesForLine, breakBandName, breakBandTitle } from './breakLineRules.js';   // ข้อยกเว้นเวลาพัก "รายไลน์" (เจ้าของกฎไล่สายแม่-ลูก)
import { applyHolidayBreaks } from './workingDay.js';
/* 🏭 ป้ายบนแถบเงาเวลาพัก — เจ้าของข้อความอยู่ `breakLineRules.js` ส่งต่อที่นี่เพื่อให้จอ
   **import จาก `utils/oee` ที่เดียว** คู่กับ `halfDayBreakBands` ที่ผลิต band ให้
   (จอที่ไล่สายไลน์ด้วย `getAncestorNames` เรื่องอื่นอยู่ จะได้ไม่ต้อง import breakLineRules
    ซึ่งด่าน `break-line-rules-single-entry` ข้อ ③ จับไว้ว่า "ห้ามไล่สายกฎเวลาพักเองในหน้า") */
export { breakBandName, breakBandTitle };
import { WORK_DAY_START_HOUR } from './workDate.js';   // ขอบวันทำงาน (ก่อน 08:00 = วันก่อนหน้า) — เจ้าของกฎ

/* ═══ 6) ยอดผลิตของใบผลิต 1 ใบ ═══════════════════════════════════════════════════════
   สูตรบังคับของโปรเจค: confirmed → `qty_ok ?? qty` · สถานะอื่นทั้งหมด → `qty_actual ?? 0`

   ⚠️ เดิมสูตรนี้ถูกเขียนซ้ำ **7 ที่** (DailyReport · OEEAnalytics · Dashboard · MorningMeeting ·
      QualityControl · wipChain · computeLiveOee ในไฟล์นี้เอง) แล้ว drift กันจริง —
      ยุบเหลือที่นี่ที่เดียว 2026-09-09 · **ห้ามเขียนซ้ำในหน้าอีก**

   ⭐ กติกาสำคัญที่พลาดกันบ่อย — `imported` ต้องนับเหมือน `carry_over`:
      สถานะ 2 ตัวนี้คือ "ใบเดียวกันคนละจังหวะ" — `carry_over` = ยกยอดออกไปแล้วแต่กะถัดไปยังไม่รับ ·
      `imported` = กะถัดไปรับไปแล้ว · **ตัวใบต้นทางยังถือยอดที่ตัวเองผลิตได้จริงอยู่ใน `qty_actual` เสมอ**
      เดิมหลายจอกรอง `imported` ทิ้งทั้งแถว ⇒ **พอกะถัดไปกด "รับยอดค้าง" ยอดผลิตของกะที่ทำจริง
      ลดลงเงียบๆ ทันที** (วัดจริง 2026-09-09: 3,213 ชิ้น ใน 170 กะ หายจากยอดผลิตทั้งระบบ)

   ✅ ไม่ double count: ตอนรับยอด กะถัดไปเปิดใบใหม่ด้วย **ยอดที่เหลือ** เท่านั้น
      (`remainQty = qty − qty_actual` ใน handleImportCarryOrders) → 5 (ต้นทาง) + 30 (ปลายทาง) = 35 ✅

   ⛔ **ห้ามใช้ฟังก์ชันนี้คิด "เป้า"** — ใช้ `orderPlanQty()` (§6.1 ข้างล่าง) ที่เดียว
      (เป้าของใบ `imported` ส่วนที่ยังไม่ทำถูกย้ายไปอยู่ที่ใบของกะถัดไปแล้ว)  */
export function orderProducedQty(o) {
  if (!o) return 0;
  return o.status === 'confirmed'
    ? Number(o.qty_ok ?? o.qty ?? 0)
    : Number(o.qty_actual ?? 0);
}

/* ═══ 6.0.1) ยอดผลิตของ "ทั้งกะ" — จุดเดียวที่รวมใบผลิตเป็นยอดกะ (2026-10-12) ════════════
   เดิมสูตรนี้ถูกเขียนมือซ้ำ 2 ที่ (`computeSessionOee` และ `handleCloseSession`) ด้วยกติกา
   `confirmed → o.qty` ขณะที่ `orderProducedQty()` ใช้ `qty_ok ?? qty` ⇒ 3 สำเนาของกฎเดียวกัน
   (ตรวจฐานจริง 12/10: ใบ confirmed 17,584 ใบ ไม่มีสักใบที่ `qty_ok` ต่างจาก `qty` ⇒ ยุบรวมได้
    โดยตัวเลขไม่ขยับ — แต่ถ้าวันหนึ่งต่างกันเมื่อไหร่ ต้องต่างกัน "ทุกจอพร้อมกัน" ไม่ใช่บางจอ)
   🔴 จุดที่รวม "ยอดผลิตของกะ" ต้องเรียกตัวนี้ **ห้ามวน reduce ใบผลิตเองในหน้า**
   `carryQtyActual` = ช่องยอดที่หัวหน้ากรอกตอนปิดกะ (ชนะค่าที่บันทึกไว้ · ว่าง/0 = ใช้ค่าในฐาน) */
export function sessionProducedQty(orders = [], carryQtyActual = {}) {
  return (orders || []).reduce((sum, o) => {
    if (!o) return sum;
    const base = Number(orderProducedQty(o)) || 0;
    if (o.status === 'confirmed') return sum + base;
    const typed = parseInt(carryQtyActual?.[o.id]);
    return sum + (typed || base);
  }, 0);
}

/* ═══ 6.1) "เป้า/แผน" ของใบผลิต 1 ใบ — คู่กับ orderProducedQty (QC audit 05/10 · roadshow) ═══
   เดิมแต่ละจอคิดเป้าเอง 3 แบบ: (ก) Σqty ทุกสถานะ (Obeya/FactoryMap/GroupOverview/DeptDashboard)
   ⇒ ใบยกยอดถูกนับเป้า 2 รอบ: ต้นทาง 35 + ปลายทาง 30 = 65 ทั้งที่งานจริง 35 (จอเดโมขึ้น 71% แทน 100%)
   (ข) ตัด imported/carry_over ทิ้งทั้งใบ (MorningMeeting) ⇒ ยอดผลิตของต้นทางยังนับ แต่เป้าหาย = เกิน 100%
   กติกาเดียว (นับเป้าครั้งเดียวทั้งสาย ไม่ว่าจะยกกี่ทอด):
     · `cancelled`  → 0 (ยกเลิกแล้ว ไม่ใช่แผน)
     · `imported`   → min(เป้า, qty_actual) = ส่วนของเป้าที่ "ใช้ไปในกะนี้" — ที่เหลือถูกออกใบใหม่ที่กะถัดไป
                      ด้วย `qty − qty_actual` แล้ว (handleImportCarryOrders) ⇒ 5 + 30 = 35 ✅
     · `carry_over` → เป้าเต็ม (ยังไม่มีใครรับไป = ส่วนที่เหลือยังไม่ได้ออกใบที่ไหน — ตัดทิ้ง = แผนหายเงียบ)
     · อื่นๆ        → `qty_target ?? qty` (ใบ manual/ปิดยอดเศษเก็บเป้าเดิมไว้ที่ qty_target)
   ⚠️ trade-off ที่ยอมรับ: กะต้นทางที่ส่งงานต่อ จะเห็นเป้าของใบนั้น = ยอดที่ทำได้ (ส่วนที่เหลือย้ายไปกะถัดไป)
   🔴 จุดที่รวม "เป้า" ของใบผลิตต้องเรียกตัวนี้ **ห้ามเขียน `o.qty_target ?? o.qty` / `Number(o.qty)` เองในหน้า** */
export function orderPlanQty(o) {
  if (!o || o.status === 'cancelled') return 0;
  const t = Number(o.qty_target ?? o.qty ?? 0) || 0;
  if (o.status === 'imported') return Math.max(0, Math.min(t, Number(o.qty_actual ?? 0) || 0));
  return t;
}


/* ═══ 6.2) "เวลาปิด" ของใบผลิต 1 ใบ — เจ้าของสูตรเดียวของทั้งระบบ (2026-10-20 · feedback หน้างาน) ═══
   เดิมหน้าเดียวกันคิดคนละแบบ ⇒ MAT เดียว กะเดียว เห็นเวลาจบไม่ตรงกัน:
     · การ์ด %P รายพาร์ท + modal แก้เวลา → ตัด `imported` ทิ้ง         = จบ 19:28
     · แท็บประวัติ + backfill ฝั่ง DB      → นับ `stopped_at` ด้วย      = จบ 20:00
   ⇒ หัวหน้าไลน์แก้ "เวลาจบ" แล้วจอตีกลับเป็นเวลาปิดกะทุกครั้ง (เคสจริง Apron Assy 20/10)
   กติกาเดียว (ตรงกับ migration 20260915 ฝั่ง DB — `case when confirmed then confirmed_at else stopped_at`):
     · `confirmed`                         → `confirmed_at`
     · `carry_over` / `imported` / `cancelled` → `stopped_at` (ไม่ได้กรอก = ถอยไป `confirmed_at`)
     · `open`                              → **ยังไม่ปิด = null** (ห้ามเดาเป็นปลายกะ)
   🔴 **ห้ามเขียน `o.confirmed_at || o.stopped_at` เองในหน้าอีก** (มีด่าน `order-close-single-entry`) */
export function orderCloseMs(o) {
  if (!o) return null;
  const st = o.status;
  const pick = st === 'confirmed' ? o.confirmed_at
    : (st === 'carry_over' || st === 'imported' || st === 'cancelled') ? (o.stopped_at || o.confirmed_at)
    : null;
  if (!pick) return null;
  const ms = new Date(pick).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/* กรอบ "ช่วงที่ MAT นี้วิ่งในกะนี้" แบบดิบ — ยังไม่รัดเข้ากรอบกะ
   🔴 คนเรียกต้องส่งต่อ `clampWinToShift(...)` เสมอ (ใบที่ยืนยันย้อนหลังข้ามวันเคยลาก "ควรได้" เป็นพัน) */
export function matRawWindow(orders = []) {
  let startMs = null, endMs = null;
  for (const o of orders || []) {
    const op = o?.opened_at ? new Date(o.opened_at).getTime() : null;
    if (op != null && Number.isFinite(op)) startMs = startMs == null ? op : Math.min(startMs, op);
    const cl = orderCloseMs(o);
    if (cl != null) endMs = endMs == null ? cl : Math.max(endMs, cl);
  }
  return { startMs, endMs };
}


/* ═══ 1) เฉลี่ยถ่วงน้ำหนัก ═══ */
// เฉลี่ยถ่วงน้ำหนัก — ไม่มีน้ำหนัก (ทุกตัว 0) ถอยไปเป็น mean ธรรมดา · ไม่มีค่า valid = null
export function wavg(items, valFn, wFn) {
  let ws = 0, vs = 0, plainN = 0, plainSum = 0;
  for (const it of items) {
    const v = valFn(it);
    if (v == null || isNaN(v)) continue;
    plainN++; plainSum += Number(v);
    const w = wFn ? Number(wFn(it)) || 0 : 1;
    if (w > 0) { ws += w; vs += Number(v) * w; }
  }
  if (ws > 0) return +(vs / ws).toFixed(1);
  return plainN ? +(plainSum / plainN).toFixed(1) : null;
}

// น้ำหนักมาตรฐาน — row ต้องมี shift_min, plannedMin (นาที DT ในแผน), calcA/oee_a, actual_qty/qty_ng
// 🔴 `plannedMin` ต้องเป็น "นาทีของไลน์" แล้ว ⇒ มาจาก `dtMinBySession(…, { lines })` เท่านั้น (§3.2)
//    ส่งนาทีรวมรายเครื่องของไลน์ขนานเข้ามา = ตัวลบบวมจนทะลุความยาวกะ ⇒ น้ำหนักเหลือ 0
//    = กะนั้นหายจากค่าเฉลี่ยโดยไม่มี error (เคสจริง LASER-345 ก.ย. 2026)
export const wLoad = it => Math.max(0, (Number(it.shift_min ?? it.shiftMin) || 0) - (Number(it.plannedMin) || 0));
export const wRun  = it => wLoad(it) * ((it.calcA != null ? it.calcA : (it.oee_a != null ? +it.oee_a : 100)) / 100);
export const wProd = it => (Number(it.totalQty != null ? it.totalQty : it.actual_qty) || 0) + (Number(it.ngQty != null ? it.ngQty : it.qty_ng) || 0);

/* ═══ 2) Cycle time ต่อ MAT — single source ═══ */
/*
  ลำดับ fallback (ต้นฉบับ: ctForMatNo ใน DailyReport):
    kanban_standards → dr_products (แถวที่มี CT)  — kanban บางแถวลิงก์ product_id ที่ CT ว่าง
    ทั้งที่มี dr_products อีกแถวของ mat เดียวกันตั้ง CT ไว้ (เคยทำ P/OEE ทั้งกะเป็น null 7 กะ · 2026-07-15)
  ⚠️ จอที่ดึง CT จาก dr_products อย่างเดียวจะได้ P คนละชุดกับตอนปิดกะ — ให้เรียกตัวนี้เสมอ
*/
export function ctForMat(matNo, { kanbanStds = [], products = [] } = {}) {
  if (!matNo) return 0;
  const fromKanban = kanbanStds.find(s => s.mat_no === matNo)?.dr_products?.cycle_time_sec;
  if (fromKanban) return Number(fromKanban);
  return Number(products.find(p => p.mat_no === matNo && p.cycle_time_sec)?.cycle_time_sec) || 0;
}

// สร้าง map mat_no → CT ครั้งเดียว (ใช้กับจอที่ต้องหา CT ซ้ำๆ เช่น computeLiveOee)
export function buildCtMap({ kanbanStds = [], products = [] } = {}) {
  const m = {};
  products.forEach(p => { if (p.cycle_time_sec) m[p.mat_no] = Number(p.cycle_time_sec); });
  kanbanStds.forEach(k => { const ct = k.dr_products?.cycle_time_sec; if (ct) m[k.mat_no] = Number(ct); });
  return m;
}

/* ═══ 3) เวลาพักตามนโยบาย — single source ═══ */
/*
  นาทีของ break_policies ที่ทับกับช่วง [startMs, endMs] — ต้นฉบับ: computePolicyBreakMin ใน DailyReport
  กรอง 2 ชั้นเสมอ: กะ (shift/both) + กระบวนการ (common หรือตรง processType ของกะ)
  ⚠️ เดิมมี 3 implementation ให้ผลต่างกัน (แท็บประวัติไม่กรอง process = นับพักเกิน ·
  OEE Analytics ทิ้งนโยบายเฉพาะ process + ใช้เวลาเริ่มกะตายตัว 08:00/20:00 = นับพักขาด)
  → ทำให้ OEE จริง/OOE ของกะเดียวกันไม่ตรงกันระหว่างหน้าจอ (รวมเป็นตัวนี้ 2026-08-05)

  processType = null → ใช้เฉพาะนโยบาย common (ไม่รู้ process ของกะ — ปลอดภัยกว่าเดานโยบายเฉพาะ)
*/
/** รวมช่วงที่ทับ/ต่อกัน — input เรียงตามเวลาเริ่มแล้ว */
const mergeIv = (iv) => {
  if (!iv.length) return [];
  const out = [iv[0].slice()];
  for (let k = 1; k < iv.length; k++) {
    const cur = out[out.length - 1];
    if (iv[k][0] <= cur[1]) cur[1] = Math.max(cur[1], iv[k][1]);
    else out.push(iv[k].slice());
  }
  return out;
};

/** รวมช่วงพักที่ทับ/ต่อกัน **โดยเก็บป้ายไว้** — input เรียงตาม `s` แล้ว
 *  🔴 เงื่อนไขการรวมต้องตรงกับ `mergeIv` เป๊ะ (`b.s <= cur.e`) ไม่งั้นนาทีพักที่หักออกจากฐานเวลา
 *     ของ `breakIntervalsIn` จะขยับจากของเดิม = %A/%P เปลี่ยนทั้งระบบโดยไม่มีใครสั่ง */
const mergeBands = (bands) => {
  if (!bands.length) return [];
  const out = [{ ...bands[0], policies: [...bands[0].policies] }];
  for (let k = 1; k < bands.length; k++) {
    const cur = out[out.length - 1], b = bands[k];
    if (b.s <= cur.e) {
      cur.e = Math.max(cur.e, b.e);
      cur.policies.push(...b.policies);
      // ช่วงที่รวมกันแล้ว: ป้าย "ตั้งเอง" ของตัวแรกที่มีเป็นตัวแทน (รายละเอียดครบอยู่ใน policies)
      if (cur.lineRuleMin === null && b.lineRuleMin !== null) {
        cur.lineRuleMin = b.lineRuleMin; cur.centralMin = b.centralMin;
      }
    } else out.push({ ...b, policies: [...b.policies] });
  }
  return out;
};

/** union ช่วงเวลาหลายชุดที่ยังไม่เรียง → [[s, e], ...] เรียง + รวมช่วงที่ทับกัน
 *  ⚠️ `mergeIv` ข้างบนต้องการ input ที่เรียงมาแล้ว — ตัวนี้เรียงให้ก่อน ใช้กับชุดที่ผสมมาจากหลายที่
 *  (เช่น "ช่วงที่พาร์ทวิ่ง" ∪ "ช่วงพักตามนโยบาย" ตอนหา downtime ที่ตกนอกงานทั้งหมด — §7) */
export function unionIv(intervals = []) {
  const clean = intervals
    .filter(iv => Array.isArray(iv) && iv[0] != null && iv[1] != null && iv[1] > iv[0])
    .map(iv => [Number(iv[0]), Number(iv[1])])
    .sort((a, b) => a[0] - b[0]);
  return mergeIv(clean);
}

/** **ช่วงเวลา**พักตามนโยบายที่ทับกรอบ [startMs, endMs] → [[s, e], ...] (epoch ms) เรียง + รวมช่วงที่ทับกัน
 *  กติกาทั้งหมดของ "พักนโยบาย" อยู่ที่ฟังก์ชันนี้ที่เดียว: กรองกะ → กรองกระบวนการ → ot_scope → กะดึกข้ามวัน
 *  · `policyBreakOverlapMin` = ผลรวมนาทีของช่วงที่ได้จากตัวนี้
 *  · จุดที่ต้องรู้ว่า "พักอยู่ช่วงไหนบ้าง" (เช่นตัด downtime ที่ทับพักออก) ให้เรียกตัวนี้ **ห้ามสร้างช่วงพักเองซ้ำ**
 *  ⚠️ union ช่วงที่ทับกัน: ชุดนโยบายปัจจุบันไม่มีคู่ไหนทับกัน (ผลลัพธ์เท่าเดิมเป๊ะ) แต่ถ้าวันหน้ามีคนตั้งทับ
 *     การบวกดิบๆ จะนับพักเกิน — union กันไว้ตั้งแต่ต้น */
export function breakIntervalsIn({ policies = [], startMs, endMs, workDate, shift, processType = null, shiftEndMs = null, lineRules = null, lineName = null }) {
  return breakBandsIn({ policies, startMs, endMs, workDate, shift, processType, shiftEndMs, lineRules, lineName })
    .map(b => [b.s, b.e]);
}

/** ช่วงพักเดียวกับ `breakIntervalsIn` แต่**ติดป้ายมาด้วย** — สำหรับจอที่ "วาดแถบเงาเวลาพัก"
 *  คืน `[{ s, e, policies: [...], lineRuleMin, centralMin }]` (เรียง + รวมช่วงที่ทับกันแบบเดียวกัน)
 *  · `policies`    นโยบายที่ทำให้เกิดช่วงนี้ (ช่วงที่ทับกันถูกรวม ⇒ ได้มากกว่า 1 ตัวได้)
 *  · `lineRuleMin` นาทีที่ **ไลน์นี้ตั้งเอง** (`break_line_rules`) · ไม่ได้ตั้ง = `null`
 *  · `centralMin`  ค่ากลางของนโยบาย — ให้จอเขียนเทียบได้ว่า "ตั้งเอง 10 จากค่ากลาง 20"
 *  🔴 **จอห้ามเดาเองว่าแถบนี้คือนโยบายไหนด้วยการจับคู่เวลา** — พักที่ `anchor = 'shift_end'`
 *     ไม่ได้อยู่ที่ `start_time` (ของจริง `start_time = null`) และไลน์ที่ตั้งเองยังเลื่อน offset อีก
 *     ⇒ บอร์ดไทม์ไลน์ 3 จอเคยจับคู่ไม่ติดแล้วเขียน tooltip ว่า "undefined" (แก้ 20/10) */
export function breakBandsIn({ policies = [], startMs, endMs, workDate, shift, processType = null, shiftEndMs = null, lineRules = null, lineName = null }) {
  if (!startMs || !endMs || endMs <= startMs || !workDate) return [];
  /* 🔚 `anchor = 'shift_end'` — พักที่ผูกกับ **ปลายกะ** ไม่ใช่เวลานาฬิกา (2026-10-20 · feedback หน้างาน)
     เหตุ: 5ส. ท้ายกะเป็นเรื่องเดียวกันแต่เวลาเลื่อนตามรูปแบบวัน (เลิก 17:30 / 20:00 / 17:00 วันหยุด /
     08:00 กะดึก) · ทะเบียนเดิมผูกเวลานาฬิกา ⇒ ต้องแตกเป็นหลายแถว แล้ว**ยังไม่ครอบวันหยุด 8 ชม.**
     (กะ 08:00–17:00 ไม่ถูกหักพัก 20 นาที = %A/%P ตกทั้งที่ทำงานครบ — เคสจริง Laser LWR 17/10)
     🔴 `shiftEndMs` = เวลาเลิกกะจริง · **ไม่ส่งมา = ใช้ปลายกรอบ** ซึ่งถูกต้องเฉพาะกรอบที่เป็น "ทั้งกะ"
        จุดที่กรอบคือ "ถึงตอนนี้" (OEE สด) หรือ "ช่วงที่พาร์ทวิ่ง" **ต้องส่งมาเสมอ**
        ไม่งั้นพักท้ายกะจะไหลตามปลายกรอบ = หักพักผิดที่/ซ้ำ (มีด่าน `break-anchor-needs-shift-end`) */
  const endAnchor = Number(shiftEndMs) > 0 ? Number(shiftEndMs) : endMs;
  const rangeOf = (p) => {
    let ps, pe;
    if (p.anchor === 'shift_end') {
      const off = Number(p.offset_min);
      // ตั้งไม่ครบ = **ไม่เดา** (CHECK ฝั่ง DB กันอีกชั้น) — เดา 0 จะกลายเป็นพักยาวถึงปลายกะ
      if (!(off > 0)) return null;
      ps = endAnchor - off * 60000;
      pe = ps + (Number(p.duration_min) || 0) * 60000;
    } else {
      const [ph, pm] = String(p.start_time || '00:00').split(':').map(Number);
      ps = new Date(`${workDate}T${String(ph).padStart(2, '0')}:${String(pm).padStart(2, '0')}:00`).getTime();
      pe = ps + (Number(p.duration_min) || 0) * 60000;
      if (pe < startMs) { ps += 86400000; pe += 86400000; }  // พักกะดึกหลังเที่ยงคืน
    }
    const s = Math.max(ps, startMs), e = Math.min(pe, endMs);
    if (!(e > s)) return null;
    /* `line_rule_min` / `line_rule_central_min` ถูกแปะโดย `applyBreakLineRules` เฉพาะตัวที่ถูกทับจริง
       ⇒ ไลน์ที่ตั้งเท่าค่ากลาง = ไม่มีป้าย (ไม่มีอะไรต้องบอกคน) */
    const lr = p.line_rule_min;
    return { s, e, policies: [p], lineRuleMin: lr === undefined ? null : lr,
             centralMin: lr === undefined ? null : (Number(p.line_rule_central_min) || 0) };
  };
  /* 🏖️ วันที่ "ไม่ใช่วันทำงาน" ตามปฏิทินบริษัท ใช้นาทีพักอีกชุด (`duration_min_holiday` · 27/10)
     เคสจริง: วันหยุดที่คนมาทำ OT พักเที่ยง 50 → 60 นาที (คำสั่ง user)
     🔴 ทับ **ก่อน** `applyBreakLineRules` เสมอ ⇒ ไลน์ที่ตั้งนาทีของตัวเองยังชนะ (ค่าเจาะจงที่สุด)
     🔴 ปฏิทินยังไม่โหลด / เป็นวันทำงาน / ไม่ได้ตั้งค่าวันหยุด = คืนชุดเดิมเป๊ะ (ดู utils/workingDay.js) */
  const applicable = applyHolidayBreaks(policies.filter(p => {
    if (!(p.shift === 'both' || p.shift === shift)) return false;
    const proc = p.process_type;
    return !(proc && proc !== 'common' && proc !== processType);
  }), workDate);
  /* ⚠️ นโยบายที่เกิด "เฉพาะตอนทำโอ / เฉพาะตอนไม่ทำโอ" (break_policies.ot_scope · 2026-09-14)
     เคสจริงที่ user จับได้: 5ส. กะเช้ามี 2 แถว — 17:10 (ไม่ทำโอ) กับ 19:40 (ทำโอ) ซึ่งเป็น
     "อย่างใดอย่างหนึ่ง" แต่กะ 08:00-20:00 กวาดทั้งคู่ ⇒ หักพักเกินจริง 20 นาที ทุกกะที่ทำโอ
     (ควรต่างจากกะไม่ทำโอแค่ 30 นาที = เบรค OT แต่กลายเป็น 50)
     กติกา: กรอบนี้ครอบนโยบาย 'ot' อยู่แล้ว = กะนี้ทำโอ ⇒ ทิ้ง 'no_ot' ทั้งหมด
     — data-driven ล้วน ไม่ต้องรู้เวลาเลิกงานปกติของกะไหนเลย · แถวที่ไม่ตั้ง = 'always' = เหมือนเดิม */
  /* 🔴 `isOt` ตัดสินจาก **ค่ากลาง** ก่อนทับรายไลน์ — ไลน์ที่ตั้งพักโอเป็น 0 แปลว่า
        "ไลน์นี้ไม่พักรอบนั้น" **ไม่ใช่ "ไลน์นี้ไม่ได้ทำโอ"** · เอาค่าหลังทับไปตัดสินจะปลุก
        นโยบาย `no_ot` กลับมา = หักพักซ้ำเงียบๆ (ดูหัวไฟล์ `utils/breakLineRules.js`) */
  const isOt = applicable.some(p => p.ot_scope === 'ot' && rangeOf(p));
  /* 🏭 ข้อยกเว้น "ไลน์นี้พักกี่นาที" (`break_line_rules` · 20/10)
     ไม่ส่ง `lineRules` = อ่าน**ทะเบียนกลาง** (`utils/breakLineRules.js` — เหตุผลอยู่ที่นั่น)
     ⇒ จอไม่ต้องไล่ส่ง prop · ไม่รู้ไลน์ / ไลน์นั้นไม่ได้ตั้งอะไร / ทะเบียนยังไม่มา
       ⇒ `applyBreakLineRules` คืน array เดิม = **พฤติกรรมเดิมเป๊ะ** */
  const bands = applyBreakLineRules(applicable, lineRules ?? breakLineRuleIndexSync(), lineName)
    .filter(p => !(isOt && p.ot_scope === 'no_ot'))
    .map(rangeOf).filter(Boolean)
    .sort((a, b) => a.s - b.s);
  return mergeBands(bands);
}

/* ═══ 📸 snapshot "ของที่ใช้คิด OEE ตอนปิดกะ" (2026-11-11 · คำสั่ง user) ══════════════════
   ปัญหาที่แก้: %A/%P/%Q ที่ stamp ไว้ คิดจาก **ทะเบียนที่แก้ได้ภายหลัง** — CT (`kanban_standards`
   /`dr_products`) · นโยบายพัก (`break_policies`) · ข้อยกเว้นพักรายไลน์ (`break_line_rules`) ·
   ปฏิทินวันหยุด · `process_type` ของไลน์ ⇒ กดคำนวณใหม่คนละวัน **ได้เลขไม่เท่าเดิม**
   (เคสจริง 10/11: restamp 5 กะ มิ.ย.–ก.ย. ไม่มีกะไหนได้ค่าเดิม เพราะนโยบายพักถูกแก้ 20/10 + 05/11
    ⇒ ออดิทเทียบ "เลขที่เก็บ" กับ "เลขที่คำนวณได้" ไม่ตรง = ระบบเสียความน่าเชื่อถือ)

   🔴 กฎ: เก็บ **input ไม่ใช่ผลลัพธ์** — เก็บช่วงพักสำเร็จรูปไว้จะแก้เวลาเริ่ม/เลิกกะแล้วคิดใหม่ไม่ได้
   🔴 กฎ: **ไม่มี snapshot = ถอยไปอ่านทะเบียนสดเหมือนเดิมเป๊ะ** (กะที่ปิดก่อนวันนี้ทั้งหมด)
          ห้ามบล็อก ห้ามเดา ห้ามเขียน snapshot ย้อนหลังให้กะเก่า (เดาทะเบียนของวันนั้นไม่ได้)
   🔴 กฎ: กะที่ **มี** snapshot แล้ว คำนวณใหม่ต้องใช้ snapshot เดิมต่อ ห้ามทับด้วยทะเบียนวันนี้
          (`computeSessionOee` คืน `breakSnapshot` = ตัวที่ใช้คิดรอบนี้ ให้จอ stamp กลับได้ตรงๆ)
   ⚠️ นาทีพัก "ของวันหยุด" (`duration_min_holiday`) ถูก resolve ลง `duration_min` ตอนทำ snapshot แล้ว
      (ปฏิทินบริษัทแก้ย้อนหลังได้) · แต่ **กฎรายไลน์เก็บแบบยังไม่ทับ** เพราะ `isOt` ต้องตัดสินจาก
      ค่ากลางก่อนทับ (ดูหัวข้อ `breakBandsIn`) — ทับไปแล้วจะปลุกนโยบาย `no_ot` กลับมาเงียบๆ */
export const BREAK_SNAPSHOT_V = 1;

/** สร้าง snapshot นโยบายพักของกะนี้ → เก็บลง `production_sessions.break_snapshot`
 *  @returns {{v:number,process_type:string|null,policies:Array,line_rules:object}|null}
 *           `null` = ยังไม่รู้ (ทะเบียนพักยังไม่โหลด) ⇒ อย่าเขียนทับของเดิม */
export function makeBreakSnapshot({ breakPolicies = [], session = null, processType = null, lineRules = null } = {}) {
  const pol = (breakPolicies || []).filter(Boolean);
  if (!pol.length) return null;
  const shift = session?.shift || 'day';
  const keep = applyHolidayBreaks(pol.filter(p => {
    if (!(p.shift === 'both' || p.shift === shift)) return false;
    const proc = p.process_type;
    return !(proc && proc !== 'common' && proc !== processType);
  }), session?.work_date);
  const rules = breakRulesForLine(lineRules ?? breakLineRuleIndexSync(), session?.line_name ?? null);
  const line_rules = {};
  if (rules) for (const [pid, min] of rules) line_rules[String(pid)] = Number(min);
  return {
    v: BREAK_SNAPSHOT_V,
    process_type: processType ?? null,
    policies: keep.map(p => ({
      id: p.id ?? null, name: p.name ?? null,
      shift: p.shift ?? null, process_type: p.process_type ?? null, ot_scope: p.ot_scope ?? null,
      anchor: p.anchor ?? null, start_time: p.start_time ?? null, offset_min: p.offset_min ?? null,
      duration_min: Number(p.duration_min) || 0,
      ...(p.holiday_min != null ? { holiday_min: p.holiday_min, holiday_central_min: p.holiday_central_min } : {}),
    })),
    line_rules,
  };
}

/** อ่าน snapshot กลับมาเป็น input ของ `breakIntervalsIn` — เวอร์ชันที่ไม่รู้จัก = `null` (ถอยไปทะเบียนสด)
 *  ⚠️ `policies: []` **ไม่ใช่ null** — แปลว่า "กะนั้นไม่มีพักที่เข้าเงื่อนไขจริงๆ" ต้องเคารพ */
export function readBreakSnapshot(session) {
  const s = session?.break_snapshot;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  if (Number(s.v) !== BREAK_SNAPSHOT_V || !Array.isArray(s.policies)) return null;
  return {
    policies: s.policies.filter(Boolean),
    processType: s.process_type ?? null,
    lineRules: breakLineRuleIndexOf(session?.line_name ?? null, s.line_rules || {}),
  };
}

/** CT ที่ถูกใช้คิด %P ตอนปิดกะ (`production_sessions.ct_snapshot` = `{ MAT: วินาที }`)
 *  🔴 เก็บเฉพาะตัวที่ **รู้ค่า (> 0)** — MAT ที่ตอนนั้นไม่รู้ CT ไม่ตรึงไว้ ให้ถอยไปทะเบียนสด
 *     (เติม CT ทีหลังแล้วคำนวณใหม่ได้เลขที่ "ดีกว่า" = ตั้งใจ · ตัวที่ขาดดูได้จาก snapshot เอง) */
export function readCtSnapshot(session) {
  const s = session?.ct_snapshot;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = {};
  for (const [mat, v] of Object.entries(s)) { const n = Number(v); if (mat && n > 0) out[mat] = n; }
  return Object.keys(out).length ? out : null;
}

/** นาทีของช่วง [sMs, eMs] ที่ทับกับ intervals (ผลลัพธ์จาก breakIntervalsIn — merged แล้ว) */
export function overlapMinutesWith(sMs, eMs, intervals = []) {
  if (!(eMs > sMs) || !intervals.length) return 0;
  let t = 0;
  for (const [a, b] of intervals) {
    const s = Math.max(a, sMs), e = Math.min(b, eMs);
    if (e > s) t += (e - s) / 60000;
  }
  return t;
}

export function policyBreakOverlapMin({ policies = [], startMs, endMs, workDate, shift, processType = null, shiftEndMs = null, lineRules = null, lineName = null }) {
  return breakIntervalsIn({ policies, startMs, endMs, workDate, shift, processType, shiftEndMs, lineRules, lineName })
    .reduce((s, [a, b]) => s + (b - a) / 60000, 0);
}

/** ช่วงพักบน "ครึ่งวัน" ของกริดเวลา 24 ชม. (บอร์ดไทม์ไลน์ Dashboard · /management · Heijunka)
 *  half = { key: 'am' | 'pm', startMs } — am = กะเช้า 08:00→20:00 · pm = กะดึก 20:00→08:00 วันถัดไป
 *  🔴 QC 05/10 — เดิม 4 จอก๊อปสูตรเอง (`half.hours.indexOf(ชั่วโมง)`) ไม่กรอง process_type/ot_scope
 *     ⇒ พัก 5ส. ไม่ทำโอ (17:10) กับพักโอ (17:30/19:40) ขึ้นพร้อมกัน = คิวการ์ดถูกดันเกินจริง
 *     ⇒ ผ่าน `breakIntervalsIn` ที่เดียว · กรอบ 12 ชม. ครอบช่วงโอ = ตีเป็นกะทำโอ (ทิ้ง `no_ot`)
 *  processType = null → เฉพาะนโยบาย common (จอที่ไม่รู้กระบวนการของไลน์ ห้ามเดานโยบายเฉพาะ) */
export function halfDayBreakIntervals({ policies = [], half, processType = null, lineRules = null, lineName = null }) {
  return halfDayBreakBands({ policies, half, processType, lineRules, lineName }).map(b => [b.s, b.e]);
}

/** เหมือน `halfDayBreakIntervals` แต่**ติดป้ายนโยบาย + ป้าย "ไลน์นี้ตั้งเอง"** มาด้วย
 *  ⇒ บอร์ดไทม์ไลน์ 24 ชม. (`/dashboard` · `/management` · `/heijunka-kanban`) ใช้วาดแถบเงา
 *     **ส่ง `lineName` ของแถวนั้นเสมอ** — ไม่ส่ง = ได้ค่ากลาง (ไลน์ที่ตั้ง 5ส. 10 นาทีจะถูกวาด 20) */
export function halfDayBreakBands({ policies = [], half, processType = null, lineRules = null, lineName = null }) {
  if (!half?.startMs) return [];
  const d = new Date(half.startMs);
  const p2 = (n) => String(n).padStart(2, '0');
  const workDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return breakBandsIn({
    policies, startMs: half.startMs, endMs: half.startMs + 12 * 3600000, workDate,
    shift: half.key === 'pm' ? 'night' : 'day', processType, lineRules, lineName,
  });
}

/* ═══ 3.1) 🔴🔴 กฎเหล็ก — downtime ที่ทับ "เวลาพักตามนโยบาย" ห้ามหักซ้ำ (2026-09-15 · user ถาม) ═══
   พักตามนโยบาย = planned stop ที่ถูกกันออกจากฐานเวลาไปแล้ว ⇒ นาที downtime ที่ตกอยู่ในช่วงพัก
   ถูกหักไปรอบหนึ่งแล้ว · การบวก `duration_min` เต็มใบเข้าไปอีก = **หักซ้ำ**
     เครื่องเสีย 11:30-13:00 (90 น.) คร่อมพักเที่ยง 11:50-12:40 (50 น.)
       ที่ถูก  : หักจากเวลากะ 50 (พัก) + 40 (เสียนอกพัก) = 90
       ของเดิม : 50 + 90 = 140  ⇒ runMin หายเกินจริง 50 นาที
   วัดจริง 90 วัน (1,298 กะที่ปิดแล้ว · ฐาน DR): planned 16,673 นาที (11.1% ของ DT ในแผน)
   + unplanned 3,659 นาที (5.4%) ตกอยู่ในช่วงพัก ⇒ **664 กะ (51%) %A ต่ำกว่าจริงเฉลี่ย 1.52 จุด
   (สูงสุด 41.1)** และ %P เฟ้อเพราะตัวหาร runMin หดเกินจริง · 5 กะ netAvail กลายเป็น 0 ทั้งที่ยังเหลือเวลา
   ⇒ **ทุกจุดที่เอา downtime ไปหักจากฐานเวลา ต้องผ่าน `dtMinOutsideBreaks()` เท่านั้น**
      (จุดที่ตอบคำถาม "เครื่องหยุดไปกี่นาที" เช่นพาเรโต/มูลค่า ยังใช้ `duration_min` เต็มเหมือนเดิม —
       เครื่องหยุดจริงเท่านั้นนาที แค่ไม่ใช่นาทีที่ "เสียโอกาสผลิต") */

/* ═══ 3.2) ไลน์เครื่องขนาน — "1 เครื่องหยุด ≠ ทั้งไลน์หยุด" (2026-10-12) ═══════════════
   ไลน์ที่มีหลายเครื่องทำงานขนานกัน (LASER-345/LASER-789 = 3 เครื่อง · SUB APRON = 6 สถานี)
   บันทึก downtime **รายเครื่อง** ⇒ ผลรวม `duration_min` ของกะเดียวทะลุความยาวกะได้ตามปกติ
   (วัดจริง ก.ย. 2026: LASER-345 วันที่ 09/09 กะเช้า บันทึก 1,025 นาที บนกะ 720 นาที = 1.42 เท่า)

   🔴 แปลงเป็น "นาทีของไลน์" ต้องหารด้วยจำนวนเลนเสมอ — ใช้ `laneWeightFn()` ที่เดียว
      `computeSessionOee` ทำถูกมาตั้งแต่แรก (%A ที่ stamp จึงถูก) แต่ `dtMinBySession`
      ซึ่งเป็นตัวป้อน **น้ำหนัก `wLoad` ของค่าเฉลี่ยรายเดือน** ไม่เคยหาร ⇒ `plannedMin`
      บวมเกินความยาวกะ ⇒ `wLoad` ถูก clamp เหลือ 0 = **กะนั้นถูกตัดออกจากค่าเฉลี่ยเงียบๆ**
      (ก.ย. 2026: 11 กะน้ำหนักเป็น 0 · LASER-345 22 จาก 37 กะโดนลดน้ำหนักเกินครึ่ง
       ⇒ OEE เดือนของไลน์นั้นเพี้ยนจาก 82.9% เหลือ 80.6% แล้วถูก export เป็นฟอร์มไปเซ็น)

   ⚠️ หารเฉพาะแถวที่ **ระบุเครื่อง** (`machine_no`) — แถวที่ไม่ระบุเครื่องคือ "หยุดทั้งไลน์"
      (ไฟดับ/ไม่มีแผนผลิต/เปลี่ยนรุ่นทั้งไลน์) หารแล้วจะ**ต่ำกว่าจริง** */
/* 🔀 "อุปกรณ์ตัวนี้หยุดแล้วกระทบกี่เลน" — ทะเบียน `machines.affects_lanes`  (2026-10-27 · คำสั่ง user)

   ที่มา (คำอธิบายหน้างาน HDF1 → LASER-345): เลเซอร์ 3 เครื่องทำงานขนาน **ไม่รอกัน**
   เครื่องไหนพังก็ไม่กระทบตัวอื่น ⇒ ครอบ 1 เลน · แต่ **คอนเวเยอร์ที่ลำเลียงงานมาเลี้ยงทั้ง 3 เครื่อง
   พังเมื่อไหร่ หยุดทันทีทั้ง 3** ⇒ ครอบ 3 เลน · และ **โรบอทตัวกลางป้อนเลเซอร์ 4+5** ⇒ ครอบ 2 เลน
   ⇒ ธง 2 ค่า (เลน/ของกลาง) ไม่พอ ต้องเป็น **ตัวเลข**

   🔴 **ว่าง/ไม่รู้จัก = 1 เลน = พฤติกรรมเดิมเป๊ะ** ⇒ ทยอยกรอกทีละไลน์ได้ ไม่ต้องมีวัน cut-over
      (กรอกเฉพาะ "ตัวยกเว้น" ที่ครอบ >1 เลน)

   🏭 **ของกลางของสาย = `stops_whole_line` ไม่ใช่ตัวเลข** (2026-10-28 · user ชี้เพิ่ม)
      *"conveyor อยู่ไลน์แม่ เป็นเหมือนส่วนกลางที่ใช้ทั้ง hdf1, hdf2, laser345, laser789"*
      ⇒ อุปกรณ์ตัวเดียวถูกใช้โดยไลน์ที่มีจำนวนเลนไม่เท่ากัน (HDF1 = 1 · LASER-345 = 3)
      "กระทบกี่เลน" จึงไม่มีคำตอบเป็นเลขเดียว · ธงนี้แปลว่า **ทุกเลนของไลน์ที่ใบนั้นอ้างถึง**
      เก็บเป็น `Infinity` ในแมป แล้วให้ `laneWeightFn` เพดานที่ `N` เอง (น้ำหนัก = 1 ทุกไลน์) */
export function affectsLanesMap(machines = []) {
  const m = {};
  for (const r of (Array.isArray(machines) ? machines : [])) {
    const k = machineKey(r?.machine_no);
    if (!k) continue;
    /* ของกลางของสาย ชนะตัวเลขเสมอ — ตั้งธงแล้วยังกรอกเลขไว้ = เจตนาคือ "ทั้งไลน์" */
    if (r?.stops_whole_line === true) { m[k] = Infinity; continue; }
    const n = Number(r?.affects_lanes);
    if (n > 1) m[k] = n;   // เก็บเฉพาะตัวยกเว้น — ค่า 1 คือ default อยู่แล้ว
  }
  return m;
}

/**
 * น้ำหนักของ 1 แถว downtime → "นาทีของไลน์"
 * @param {number} parallelN  จำนวนเลนของไลน์ (1 = ไม่ใช่ไลน์ขนาน)
 * @param {Object|null} affectsBy  แมปจาก `affectsLanesMap()` — ไม่ส่ง = ทุกเครื่องครอบ 1 เลน (เดิม)
 *
 * น้ำหนัก = (ครอบกี่เลน ÷ จำนวนเลน) · แถวที่ **ไม่ระบุเครื่อง** = หยุดทั้งไลน์ ห้ามหาร
 * 🔴 เพดานที่ `parallelN` — กรอกเกินจำนวนเลน (พิมพ์ผิด/ไลน์ลดเครื่อง) ต้องไม่ทำให้นาทีบวมเกินจริง
 */
export const laneWeightFn = (parallelN = 1, affectsBy = null) => (d) => {
  const N = Number(parallelN) || 1;
  if (N <= 1) return 1;            // ไลน์เลนเดียว = ไม่หารอยู่แล้ว
  if (!d?.machine_no) return 1;    // ไม่ระบุเครื่อง = ไฟดับ/ไม่มีแผนผลิต/เปลี่ยนรุ่นทั้งไลน์
  const hit = affectsBy ? Number(affectsBy[machineKey(d.machine_no)]) : 0;
  const affects = Math.min(Math.max(1, hit || 1), N);
  return affects / N;
};

/* 🔴 นาที downtime ของ **1 แถว** ในหน่วย "นาทีของไลน์" — จุดเดียวที่จอใช้ตอบ "ไลน์หยุดกี่นาที"
   (2026-10-27 · คำสั่ง user: *"มันไม่ควรนับรวมเป็น 306 นาที สำหรับไลน์ขนาน เพราะความจริงมันคือ 102 นาที"*)

   เคสจริง LASER-345 22/10 — ราง Conveyor เสีย 1 ครั้ง แต่พนักงานลง downtime **3 แถว** (LS-03/04/05)
   แถวละ 50 นาที ⇒ ผลรวมดิบ 150 นาที ทั้งที่ไลน์หยุดจริง **50 นาที**
     3×50 + 3×42 + 1×30 = 306 นาทีดิบ  →  ÷3 = **102 นาทีของไลน์** (= 50 + 42 + 10) ✔ ตรงกับ %A ที่ stamp ไว้
   วัด 30 วัน (5 ไลน์ที่ตั้ง `parallel_stations`): ดิบ 68,137 → ของไลน์ 21,517 นาที (โป่งเกิน ~777 ชม.)

   ⚠️ **หน่วยคนละตัวกับ "นาที-เครื่อง"** (`dtRawMin`) ที่ตอบว่า *ช่างเสียเวลา/ค่าใช้จ่ายรายเครื่องเท่าไหร่*
      — จอไหนใช้ตัวไหนต้อง **เขียนหน่วยกำกับเสมอ** ห้ามโชว์เลขลอยๆ ให้คนเดาเอง */
export const dtLineMin = (d, parallelN = 1, { affectsBy = null, nowMs = null } = {}) =>
  dtRawMin(d, nowMs) * laneWeightFn(parallelN, affectsBy)(d);

/** แมป `session_id → จำนวนเลน` — จอที่รวมนาที downtime จากหลายกะใช้ตัวนี้คู่กับ `dtLineMin`
 *  กะที่ไม่รู้ไลน์/ไม่อยู่ในชุดที่ส่งมา = 1 เลน (พฤติกรรมเดิมเป๊ะ — ไม่เดาว่าเป็นไลน์ขนาน) */
export function laneBySessionId(sessions = [], lines = []) {
  const laneOf = parallelNBySession(lines);
  const by = {};
  for (const s of sessions || []) if (s?.id) by[s.id] = laneOf(s);
  return by;
}

/** ทะเบียนไลน์ → ฟังก์ชัน `(session) => จำนวนเลน` สำหรับส่งให้ `dtMinBySession`
 *  รับได้ทั้ง **อาร์เรย์แถวไลน์** และ **แมป `{ [ชื่อไลน์]: แถว }`** (จอที่มีแต่แมปอยู่แล้วจะได้ไม่ต้องแปลง)
 *  ไม่รู้จักชื่อไลน์ = 1 เลน (พฤติกรรมเดิมเป๊ะ — ไม่เดาว่าเป็นไลน์ขนาน) */
export function parallelNBySession(lines = []) {
  const by = {};
  if (Array.isArray(lines)) {
    for (const l of lines) if (l?.name) by[l.name] = parallelUnitsOf(l);
  } else {
    for (const [name, l] of Object.entries(lines || {})) by[name] = parallelUnitsOf(l);
  }
  return (s) => by[s?.line_name] || 1;
}

/** นาที downtime ดิบของ 1 แถว — แถวที่ยังเปิดค้างนับถึง nowMs (ไม่ส่ง nowMs = ไม่นับ) */
export function dtRawMin(d, nowMs = null) {
  if (!d) return 0;
  if (d.ended_at || d.duration_min != null) return Number(d.duration_min) || 0;
  return (nowMs && d.started_at) ? Math.max(0, (nowMs - new Date(d.started_at).getTime()) / 60000) : 0;
}

/** นาที downtime ของ 1 แถวที่ **อยู่นอกช่วงพัก** = ที่หักจากฐานเวลาได้จริง
 *  แถวไม่มี `started_at` → ตัดไม่ได้ คืนเต็มตามเดิม (ฐานจริง 90 วันไม่มีแถวแบบนี้เลย แต่ต้องกันไว้) */
export function dtMinOutsideBreaks(d, intervals = [], nowMs = null) {
  const raw = dtRawMin(d, nowMs);
  if (!(raw > 0) || !intervals.length || !d?.started_at) return raw;
  const s = new Date(d.started_at).getTime();
  const e = d.ended_at ? new Date(d.ended_at).getTime() : s + raw * 60000;
  return Math.max(0, raw - overlapMinutesWith(s, e, intervals));
}

// รูปแบบย่อสำหรับจอที่มีแค่ (กะ, นาทีกะ) — คิดจากเวลาเริ่มกะจริงถ้ามี ไม่งั้น 08:00/20:00
export const SHIFT_START_MIN = { day: 8 * 60, night: 20 * 60 };
export function policyBreakForShift({ policies = [], shift, shiftMin, workDate, startTime = null, processType = null, lineRules = null, lineName = null }) {
  if (!shiftMin || !workDate) return 0;
  const hhmm = startTime ? String(startTime).slice(0, 5)
    : `${String(Math.floor((SHIFT_START_MIN[shift] ?? SHIFT_START_MIN.day) / 60)).padStart(2, '0')}:00`;
  const startMs = new Date(`${workDate}T${hhmm}:00`).getTime();
  return policyBreakOverlapMin({ policies, startMs, endMs: startMs + Number(shiftMin) * 60000, workDate, shift, processType, lineRules, lineName });
}


/** กรอบเวลาของกะ [startMs, endMs] จากแถว production_sessions (work_date + start_time + shift_min)
 *  คืน null เมื่อข้อมูลไม่พอ — **ห้ามเดา 08:00/20:00 แทน** (กะเปิดสายเป็นเรื่องปกติ) */
export function sessionWindow(session, { nowMs = null } = {}) {
  const wd = session?.work_date;
  const st = session?.start_time;
  if (!wd || !st) return null;
  // 🔴 วันของเวลาเริ่มกะต้องผ่าน shiftStartDate() — กะดึกเริ่ม 00:00-07:59 = เช้าวันถัดไป
  const startMs = new Date(`${shiftStartDate(wd, String(st).slice(0, 5), session?.shift)}T${String(st).slice(0, 5)}:00`).getTime();
  if (!startMs) return null;
  const min = Number(session.shift_min) || 0;
  const endMs = min > 0 ? startMs + min * 60000 : (nowMs || null);
  return endMs && endMs > startMs ? { startMs, endMs, workDate: wd, shift: session.shift } : null;
}

/** สรุปนาที downtime ของ "1 กะ" ที่เอาไปหักจากฐานเวลาได้ — จุดเดียวที่ตัดส่วนทับพักออกให้ครบ (§3.1)
 *  ทุกจอที่คิด netAvail / runMin / wLoad ต้องเรียกตัวนี้ **ห้ามรวม duration_min เองในหน้า**
 *  คืน:
 *    · `planned` / `unplanned`       นาทีที่หักจากฐานเวลาได้จริง (ตัดส่วนที่ทับพักออกแล้ว + ถ่วง weightFn)
 *    · `plannedRaw` / `unplannedRaw` นาทีเต็มตามที่บันทึก — ใช้ตอบ "เครื่องหยุดไปกี่นาที" (พาเรโต/มูลค่า)
 *      ⚠️ ห้ามสลับ 2 ชุดนี้: ชุดแรกตอบ "เสียโอกาสผลิตกี่นาที" ชุดหลังตอบ "เครื่องหยุดกี่นาที"
 *    · `breakMin` / `breakIv`        เวลาพักตามนโยบายที่ทับกรอบกะ (ยอดรวม / ช่วงเวลา)
 *    · `breakOverlapMin`             นาที DT ที่ถูกตัดทิ้งเพราะทับพัก (เอาไปโชว์ให้ตรวจย้อนได้)
 *    · `noBreakPolicy`               ผู้เรียกไม่ได้ส่งนโยบายพักมา ⇒ ตัวเลขจะไม่ตรงกับค่าที่ stamp */
export function sessionDowntimeMin({
  session = null, downtimes = [], breakPolicies = [], processType = null,
  weightFn = null, nowMs = null, startMs = null, endMs = null, workDate = null, shift = null,
  lineRules = null,
} = {}) {
  const win = (startMs && endMs) ? { startMs, endMs, workDate: workDate || session?.work_date, shift: shift || session?.shift }
    : sessionWindow(session, { nowMs });
  const brkIv = (win && breakPolicies.length)
    ? breakIntervalsIn({ policies: breakPolicies, startMs: win.startMs, endMs: win.endMs, workDate: win.workDate, shift: win.shift, processType, lineName: session?.line_name ?? null, lineRules })
    : [];
  const w = weightFn || (() => 1);
  let planned = 0, unplanned = 0, plannedRaw = 0, unplannedRaw = 0, breakOverlapMin = 0, plannedOverMin = 0;
  for (const d of downtimes) {
    const raw = dtRawMin(d, nowMs);
    const eff = dtMinOutsideBreaks(d, brkIv, nowMs);
    breakOverlapMin += Math.max(0, raw - eff);
    /* เพดานของ "หยุดตามแผน" — เกินเพดานไหลไปเป็น unplanned (§เพดาน · ห้ามแยกเองที่นี่) */
    const sp = dtPlannedSplit(d, eff, w(d));
    planned += sp.planned; unplanned += sp.unplanned; plannedOverMin += sp.overMin;
    if ((d?.dr_downtime_types?.category ?? d?.dt_category) === 'planned') plannedRaw += raw;
    else unplannedRaw += raw;
  }
  return {
    planned, unplanned, plannedRaw, unplannedRaw, breakOverlapMin, plannedOverMin,
    breakIv: brkIv, breakMin: brkIv.reduce((a, [x, y]) => a + (y - x) / 60000, 0),
    noBreakPolicy: !breakPolicies.length,
  };
}

/* ═══ 🧾 เพดานของ "หยุดตามแผน" — เกินมาตรฐาน = ความสูญเสีย (2026-11-16 · คำสั่ง user) ════
   ที่มา (วัดจริง ก.ย.–พ.ย. 69): นาทีที่ตีเป็น "หยุดตามแผน" ส่วนใหญ่ **ไม่ใช่งานตามแผนจริง**
   ⇒ ถูกตัดออกจากฐานเวลาทั้ง %A และ %P ⇒ **ยิ่งลงหยุดตามแผนเยอะ OEE ยิ่งสูง** (incentive กลับทาง)
   · `Set up Machine` 733 ใบ — p50 = p75 = p90 = **30 นาทีเป๊ะ** (หน้างานลงเลขมาตรฐาน) แต่ max 345
   · `เปลี่ยน Cap Tip` p50 6 · max 32 · `เปลี่ยนตะกร้า` เกิน 10 นาทีถึง 59-73% ของนาทีทั้งหมด

   🔴 กติกา: ประเภทที่เป็น `planned` และ **ตั้งเพดานไว้** (`dr_downtime_types.planned_cap_min`)
      ⇒ นาทีที่เกินเพดาน **ของใบนั้น** ไหลไปเป็น `unplanned` (= หักจาก %A ตามจริง)
   🔴 **เพดานอยู่ในทะเบียน ห้าม hardcode ในโค้ด** (กฎเดียวกับเวลา setup ใน `pressSetup.js`)
   🔴 **ไม่ได้ตั้งเพดาน (null) = พฤติกรรมเดิมเป๊ะ** — ห้ามเดาเพดานให้ใคร
   🔴 เพดานเทียบกับ "นาทีของใบหลังหักช่วงพัก **ก่อน**หารเลน" — เปลี่ยนรุ่น 1 ครั้งบนไลน์ 6 เลน
      ก็ยังเป็นการเปลี่ยนรุ่น 1 ครั้ง (ถ้าหารเลนก่อน เพดานจะไม่มีวันทำงานบนไลน์ขนาน)
   ⚠️ **คิวรีที่ join `dr_downtime_types(category)` ต้องดึง `planned_cap_min` มาด้วยทุกที่**
      ไม่ดึง = ไม่มีเพดาน = เงียบสนิท (คลาสเดียวกับลืม `select('pair_mat_no')`) — มีด่าน      */

/** แยกนาทีของใบ downtime 1 ใบเป็น planned/unplanned ตามเพดานของประเภท
 *  @param {object} d        แถว downtime (ต้อง join `dr_downtime_types(category, planned_cap_min)`)
 *  @param {number} effMin   นาทีของใบหลังหักช่วงพักแล้ว **ก่อน**หารเลน
 *  @param {number} weight   น้ำหนักเลน (`laneWeightFn`) — คูณท้ายสุดกับทั้ง 2 ขา
 *  @returns {{planned:number, unplanned:number, overMin:number}}
 */
export function dtPlannedSplit(d, effMin, weight = 1) {
  const eff = Math.max(0, Number(effMin) || 0);
  const w = Number(weight);
  const wt = Number.isFinite(w) ? w : 1;
  const cat = d?.dr_downtime_types?.category ?? d?.dt_category;
  if (cat !== 'planned') return { planned: 0, unplanned: eff * wt, overMin: 0 };
  const capRaw = d?.dr_downtime_types?.planned_cap_min ?? d?.dt_planned_cap_min;
  const cap = Number(capRaw);
  // ไม่ได้ตั้งเพดาน / ตั้งค่าอ่านไม่ออก = ไม่มีเพดาน (ห้ามเดา)
  if (capRaw == null || !Number.isFinite(cap) || cap < 0) return { planned: eff * wt, unplanned: 0, overMin: 0 };
  const inPlan = Math.min(eff, cap);
  const over = eff - inPlan;
  return { planned: inPlan * wt, unplanned: over * wt, overMin: over * wt };
}

/** นาที downtime ต่อกะ สำหรับใช้เป็น **น้ำหนัก/ฐานเวลา** (wLoad, OOE/TEEP, strictOee)
 *  → { [sessionId]: { planned, unplanned, breakMin } } · นาทีที่ทับช่วงพักถูกตัดออกแล้ว (§3.1)
 *  sessions ต้องมี id/work_date/shift/start_time/shift_min · downtimes ต้องมี session_id + join category
 *  ไม่ส่ง breakPolicies = ไม่ตัด (เท่าพฤติกรรมเดิม) — จอที่โชว์ค่าเฉลี่ยถ่วงน้ำหนักต้องส่งเสมอ
 *  ไม่งั้นน้ำหนักของกะที่มี PM คร่อมพักจะเบากว่าจอ /oee-analytics = ค่าเฉลี่ยคนละเลข
 *  🔴 `opts.lines` = ทะเบียนไลน์ (`name`, `flow_mode`, `parallel_stations`) — **จอที่เอาผลไปถ่วง
 *     `wLoad` ต้องส่งเสมอ** ไม่งั้นไลน์เครื่องขนานได้นาทีรวมของทุกเครื่องมาหักจากเวลากะเดียว (§3.2)
 *     ไม่ส่ง = ไม่หารเลน (พฤติกรรมเดิมเป๊ะ สำหรับจอที่โชว์ "เครื่องหยุดกี่นาที" ล้วนๆ) */
export function dtMinBySession(sessions = [], downtimes = [], breakPolicies = [], { lines = null, lineRules = null, affectsBy = null } = {}) {
  const laneOf = lines ? parallelNBySession(lines) : null;
  const ivBy = {}, wBy = {};
  for (const s of sessions) {
    const win = sessionWindow(s);
    ivBy[s.id] = (win && breakPolicies.length)
      ? breakIntervalsIn({ policies: breakPolicies, startMs: win.startMs, endMs: win.endMs, workDate: win.workDate, shift: win.shift, lineName: s?.line_name ?? null, lineRules })
      : [];
    if (laneOf) wBy[s.id] = laneWeightFn(laneOf(s), affectsBy);
  }
  const out = {};
  for (const d of downtimes) {
    const sid = d.session_id;
    const o = (out[sid] ||= { planned: 0, unplanned: 0, breakMin: 0 });
    // กะที่ไม่ได้ส่งมาใน sessions (ไม่รู้ไลน์) = น้ำหนัก 1 — ห้ามเดาว่าเป็นไลน์ขนาน
    const effRaw = dtMinOutsideBreaks(d, ivBy[sid] || []);
    const sp = dtPlannedSplit(d, effRaw, wBy[sid] ? wBy[sid](d) : 1);
    o.planned += sp.planned; o.unplanned += sp.unplanned; o.plannedOverMin = (o.plannedOverMin || 0) + sp.overMin;
  }
  for (const s of sessions) {
    const o = (out[s.id] ||= { planned: 0, unplanned: 0, breakMin: 0 });
    o.breakMin = (ivBy[s.id] || []).reduce((a, [x, y]) => a + (y - x) / 60000, 0);
  }
  return out;
}

/* ═══ 4) OEE สด (กะยังไม่ปิด) ═══ */
export const LIVE_MIN_ELAPSED = 10; // นาทีแรกของกะ ยังประเมินไม่ได้ (ตัวหารเล็กเกินไป)

// parallelN: จำนวนเครื่องหลักวิ่งขนานของไลน์ (production_lines.parallel_stations ผ่าน parallelUnitsOf ใน lineTypes.js)
// — DT ที่ระบุเครื่อง (machine_no) หักน้ำหนัก 1/N (เครื่องเดียวหยุด อีก N-1 ยังวิ่ง) · DT ไม่ระบุเครื่อง = หยุดทั้งไลน์ หักเต็ม
// สูตรเดียวกับ computeOEE ตอนปิดกะใน DailyReport (เคส LASER-345/789 N=3 · 2026-08-05) · ไม่ส่งมา = 1 (พฤติกรรมเดิม)
/* parallelN = หัก DT รายเครื่อง 1/N (ทุกโหมดไหลงาน)
   parallelCap = เพดานเครื่องที่เดินขนานได้ (production_lines.parallel_stations)
                 ใช้เฉพาะไลน์ที่ CT เป็น "ต่อเครื่อง" (flow_mode = parallel_machine)
   ⚠️ 2 ตัวนี้ไม่เท่ากันเสมอไป และห้ามเอามารวมกัน (คำสั่ง user 2026-08-11):
     · ผลิตต่อเนื่อง (one_piece_flow เช่น LASER-345/789 เลเซอร์ 3 ตัวเป็นสายเดียว)
       → CT ที่กรอกเป็นของ "ทั้งไลน์" อยู่แล้ว → parallelCap = 1 ห้ามหาร
       (เคยคิดจะหาร N=3 ทั้งกระดาน — เช็คแล้ว P จะร่วงจาก 63-98% เหลือ 21-33% = พัง)
     · เครื่อง stand-alone ต่างคนต่างรัน (parallel_machine เช่น SUB APRON)
       → CT เป็นของ "ต่อเครื่อง" → ตัวหารต้องเป็น "เวลาเครื่องที่ถูกใช้จริง"

   ⚠️⚠️ ตัวหารต้องวัดจาก "ช่วงเวลาที่แต่ละพาร์ทวิ่ง" (busyMinutes) — **ห้ามใช้จำนวนคน**
   (2026-08-13 · แก้ของที่เคย ship ผิดเอง) เหตุผล: 1 คนคุมได้หลายเครื่อง ไลน์นี้เป็นเครื่อง
   load/unload เอง — เคสจริง SUB APRON 05/08 กะเช้า: เช็คชื่อ 4 คน แต่ 6 พาร์ทเปิดพร้อมกัน
   ตั้งแต่ต้นกะ = 6 เครื่องเดินจริง (งาน 4,044 นาที ÷ 6 เครื่อง × 720 นาที = 93.6% สมเหตุผล)
   ถ้าหารด้วยจำนวนคนจะได้ 4 → P พุ่งเกินจริง · และกะที่ไม่มีใครลงเช็คชื่อจะหารด้วย N เต็ม
   → P ร่วงทั้งที่แค่ "ไม่รู้" (ขัดกฎ "ประเมินไม่ได้ = null ห้ามแปลงเป็นเลข")
   วิธีวัดจาก order window ใช้ได้กับทุกกะรวมกะที่ไม่มีข้อมูลเช็คชื่อ และไม่ต้องพึ่ง master ใดๆ */
// เวลาเครื่องที่ถูกใช้จริง (นาที) = Σ ช่วงเวลาที่แต่ละพาร์ทวิ่ง — ทับกัน = หลายเครื่องเดินพร้อมกัน
// clamp ในกรอบ [startMs, endMs] เสมอ: ใบที่ปิดด้วยเวลาเลยกรอบกะ (เจอจริง ปิด 08:00 ของวันถัดไป
// ทั้งที่กะจบ 20:00) จะลากตัวหารให้ยาวเกินจริงจน P ต่ำผิด
//
// ⚠️ ต่อพาร์ทต้อง "รวมช่วงที่ทับกัน (union)" ไม่ใช่ min..max และไม่ใช่บวกทุกใบตรงๆ:
//   · บวกทุกใบตรงๆ → พังกับ "สแกนรวบ" (เปิด 6 ใบใน 10 วินาที = window ซ้อนกันเกือบสนิท)
//     ตัวหารจะพองเป็นเท่าตัวของจำนวนใบ → P ต่ำผิด
//   · min..max → นับ "ช่วงที่พาร์ทนั้นไม่ได้วิ่ง" (เช้าล็อตหนึ่ง บ่ายอีกล็อต) เป็นเวลาเครื่องด้วย
// union ตอบตรงคำถาม "เครื่องตัวนั้นถูกใช้กี่นาที" ทั้งสองเคส
export function busyMinutes(orders = [], startMs, endMs) {
  if (!(endMs > startMs)) return 0;
  const byMat = {};
  orders.forEach(o => {
    if (!o.mat_no || !o.opened_at) return;
    const s = Math.max(new Date(o.opened_at).getTime(), startMs);
    const e = Math.min(o.confirmed_at ? new Date(o.confirmed_at).getTime() : endMs, endMs);
    if (!(e > s)) return;
    (byMat[o.mat_no] ||= []).push([s, e]);
  });
  let total = 0;
  Object.values(byMat).forEach(iv => {
    iv.sort((a, b) => a[0] - b[0]);
    let [cs, ce] = iv[0];
    for (let i = 1; i < iv.length; i++) {
      const [s, e] = iv[i];
      if (s <= ce) ce = Math.max(ce, e);           // ทับ/ต่อกัน → ขยายช่วงเดิม
      else { total += ce - cs; [cs, ce] = [s, e]; } // ขาดตอน → ปิดช่วงเดิม เริ่มช่วงใหม่
    }
    total += ce - cs;
  });
  return total / 60000;
}

/* ⚠️ **A สด ต้องเป็นสูตรเดียวกับตอนปิดกะเป๊ะ** (คำสั่ง user 2026-09-14: "%A มันควรสูตรเดียวกันหมด")
   เดิมตัวนี้คิด A = (elapsed − DT ทุกชนิด) / elapsed คือ **ไม่แยกหยุดตามแผน และไม่หักเวลาพัก**
   ⇒ กะเดียวกัน %A กระโดดขึ้นตอนปิดกะ (จอ TV/ผังรวม/Dashboard ต่ำกว่ารายงานตลอด) — bug ที่ค้างมานาน
   สูตรที่ถูก (ตรงกับ computeOEE ใน DailyReport):
     plannedDT = หยุดตามแผนที่ลง + เวลาพักตามนโยบายที่ผ่านไปแล้ว
     netAvail  = elapsed − plannedDT          ← ตัวหารของ A (ไม่ใช่ elapsed ดิบ)
     runMin    = netAvail − หยุดนอกแผน        ← ตัวหารของ P ด้วย (P = stdMin / runMin)
   ⇒ ผู้เรียก **ต้องส่ง `breakPolicies` และ downtime ที่ join `dr_downtime_types(category)` มาเสมอ**
     ไม่ส่ง = ไม่หักพัก → กลับไปต่างจากค่าที่ stamp อีก (util คืน `noBreakPolicy: true` ให้จอรู้ตัว)
   ⚠️ netAvail ≤ 0 (เพิ่งเปิดกะแล้วยังอยู่ในประชุมแถว/พัก) = **ประเมินไม่ได้ → คืน null**
     ห้ามคืน A = 0 (กฎเดียวกับ noOutput/noCt — 0 แปลว่า "แย่มาก" ไม่ใช่ "ยังไม่รู้") */
export function computeLiveOee({ session, orders = [], downtimes = [], ctMap = {}, ngQty = null, workDate, nowMs = Date.now(), parallelN = 1, parallelCap = 1, breakPolicies = [], processType = null, pairMap = null, ngForP = null, qRows = null, lineRules = null, affectsLanes = null }) {
  if (!session?.start_time) return null;
  const wd = workDate || session.work_date;
  if (!wd) return null;

  /* ── หมุดเริ่มกะ (t0) ต้องอยู่ใน "กรอบกะ" เสมอ (2026-09-16) ─────────────────────────
     เดิมต่อ `work_date + start_time` ตรงๆ ⇒ พังเงียบ 2 เคส:
       (ก) ค่าหลุดกรอบ — มีจริงในฐาน 4 แถว เช่น `shift='night'` แต่ `start_time='08:00'`
           (Laser GOR 01/08 · Line 61 06/07) และ `shift='day'` ที่ `start_time='22:30'`
           ⇒ t0 เพี้ยนไป 12 ชม. → elapsed พุ่งจน cap ที่ shift_min ⇒ %A/%P อ่านเหมือนกะจบแล้ว
           ตั้งแต่นาทีแรก → clamp กลับต้นกะ + ตั้งธง `startTimeOutOfFrame` ให้จอบอกว่าข้อมูลผิด
       (ข) กะดึกที่บันทึกเวลาเริ่มเป็น 00:00–07:59 = **เช้าของวันถัดไป** ต้อง +1 วัน
           (กติกาเดียวกับ `carryImportOpenedAt` ใน DailyReport) ไม่งั้น t0 เร็วไป ~20 ชม.
     ⚠️ กะดึกเข้างานปกติ 22:30 (121 กะในฐาน) อยู่ในกรอบ ห้ามถูก clamp */
  const startHm = session.start_time.slice(0, 5);
  const startH = Number(startHm.slice(0, 2));
  const inDayWindow = startH >= 8 && startH < 20;          // กะเช้า 08:00–19:59 · กะดึก 20:00–07:59
  const isNight = session.shift === 'night';
  const startTimeOutOfFrame = isNight ? inDayWindow : (session.shift === 'day' && !inDayWindow);
  let openedDate = wd, openedHm = startHm;
  if (startTimeOutOfFrame) openedHm = isNight ? '20:00' : '08:00';
  else openedDate = shiftStartDate(wd, startHm, session.shift);   // กะดึกข้ามคืน — ของกลางเดียวกับ shiftFrameOf
  const opened = new Date(`${openedDate}T${openedHm}:00`).getTime();
  let elapsed = (nowMs - opened) / 60000;
  if (session.shift_min) elapsed = Math.min(elapsed, session.shift_min);
  if (!(elapsed >= LIVE_MIN_ELAPSED)) return null;

  /* 🔚 พักที่ผูกปลายกะ (`anchor='shift_end'` เช่น 5ส.) ต้องรู้ "เวลาเลิกกะจริง" ก่อน
     กะที่ยังเปิดอยู่ **ไม่มี `end_time` และส่วนใหญ่ไม่มี `shift_min`** (วัดจริง ก.ย.: เปิดอยู่ 6 กะ
     มี end_time 0 · มี shift_min 1) ⇒ ยังไม่รู้ว่าจะเลิกกี่โมง
     🔴 ห้ามเดาเวลาเลิกกะ (กฎเดียวกับ `checkCloseTime`) และ **ห้ามปล่อยให้ไหลตาม "ตอนนี้"** —
        ไม่งั้นพักท้ายกะจะถูกหักทุกนาทีที่จอ refresh · ยังไม่รู้ = ไม่หัก + ชูธงให้จอเขียนบอก
     ⏱️ ช่วงท้ายกะจริงๆ ค่าสดจะสูงกว่าค่าที่ stamp เล็กน้อย แล้วตรงกันเองตอนปิดกะ (ตอนนั้นมี end_time) */
  const hardEndMs = (() => {
    if (session.end_time) {
      const hm = String(session.end_time).slice(0, 5);
      let e = new Date(`${openedDate}T${hm}:00`).getTime();
      if (Number.isFinite(e)) { if (e <= opened) e += 86400000; return e; }   // กะดึกข้ามเที่ยงคืน
    }
    return Number(session.shift_min) > 0 ? opened + Number(session.shift_min) * 60000 : null;
  })();
  const anchoredPolicies = breakPolicies.filter(p => p?.anchor === 'shift_end');
  const usablePolicies = hardEndMs ? breakPolicies : breakPolicies.filter(p => p?.anchor !== 'shift_end');
  // เวลาพักตามนโยบายที่ทับช่วง [เปิดกะ, ตอนนี้] — สูตรกลางตัวเดียวกับตอนปิดกะ
  // เก็บเป็น "ช่วงเวลา" ไม่ใช่แค่ยอดรวม เพราะต้องเอาไปตัด downtime ที่ทับพักออกด้วย (§3.1)
  const brkIv = usablePolicies.length
    ? breakIntervalsIn({
        policies: usablePolicies, startMs: opened, endMs: opened + elapsed * 60000,
        workDate: wd, shift: session.shift, processType, shiftEndMs: hardEndMs,
        lineName: session.line_name ?? null, lineRules,
      })
    : [];
  const breakMin = brkIv.reduce((s, [a, b]) => s + (b - a) / 60000, 0);
  // Downtime ที่ยังเปิดค้าง (ไม่มีเวลาจบ/นาที) นับถึงตอนนี้ · นาทีที่ตกในช่วงพักถูกตัดออก (ห้ามหักซ้ำ §3.1)
  /* 🔀 น้ำหนักเลน — **ต้องผ่าน `laneWeightFn` (§3.2) ห้ามเขียนสูตรซ้ำที่นี่**
     ของกลางของไลน์ (คอนเวเยอร์/ระบบลม) ที่กรอก `machines.affects_lanes` ไว้ ต้องไม่ถูกหารเลน
     ไม่ส่ง `affectsLanes` = ทุกเครื่องครอบ 1 เลน = พฤติกรรมเดิมเป๊ะ */
  const dtW = laneWeightFn(parallelN, affectsLanes);
  const dtOne = (d) => dtMinOutsideBreaks(d, brkIv, nowMs) * dtW(d);
  /* แยกหยุดตามแผน (PM/เปลี่ยนรุ่น) ออกจากหยุดนอกแผน — ต้อง join dr_downtime_types(category) มา
     ไม่ได้ join = ทุกแถวถูกนับเป็นนอกแผน (fail-safe ฝั่งเข้มงวด ไม่ใช่ปล่อยผ่าน) */
  let plannedDtMin = 0, unplannedDtMin = 0, plannedOverMin = 0;
  downtimes.forEach(d => {
    // เพดาน "หยุดตามแผน" คิดก่อนหารเลน แล้วค่อยถ่วงน้ำหนัก (§เพดาน)
    const sp = dtPlannedSplit(d, dtMinOutsideBreaks(d, brkIv, nowMs), dtW(d));
    plannedDtMin += sp.planned; unplannedDtMin += sp.unplanned; plannedOverMin += sp.overMin;
  });
  const netAvail = elapsed - plannedDtMin - breakMin;
  if (!(netAvail > 0)) return null;                    // ยังอยู่ในพัก/หยุดตามแผนทั้งช่วง = ยังประเมินไม่ได้
  const runMin = Math.max(1, netAvail - unplannedDtMin);

  /* ⚠️ **ชิ้น ≠ shot** — `produced`/`ng` นับ "ชิ้น" (ใช้กับ %Q) · เวลามาตรฐานนับ "shot" (ใช้กับ %P)
     งานคู่ gang die / RH-LH: 1 จังหวะเครื่องได้ 2 ชิ้น แต่ CT ที่ตั้งไว้คือเวลาต่อ **1 จังหวะ**
     ⇒ บวก qty×CT ทั้งสองข้าง = ตัวเศษ 2 เท่า → %P ทะลุ 100 แล้วโดน cap เงียบ
     (วัดจริง 18/09: HDF1 159% · LASER-345 160% — ดู utils/pairTotals.js `collapsePairShots`)
     `pairMap` ไม่ส่ง = ไม่ยุบอะไรเลย = พฤติกรรมเดิมเป๊ะ */
  let produced = 0, ngFromOrders = 0, qtyNoCt = 0;
  const matsNoCt = new Set();
  const stdRows = new Map();                       // mat_no → { mat_no, qty, ct } สำหรับคิดเวลามาตรฐาน
  orders.forEach(o => {
    const q = orderProducedQty(o);
    produced += q;
    ngFromOrders += o.qty_ng || 0;
    const ct = Number(ctMap[o.mat_no]) || 0;
    if (!(ct > 0)) { if (q > 0) { qtyNoCt += q; if (o.mat_no) matsNoCt.add(o.mat_no); } return }
    const key = o.mat_no ?? '__nomat__';
    const row = stdRows.get(key) || { mat_no: o.mat_no ?? null, qty: 0, ct };
    row.qty += q; row.ct = Math.max(row.ct, ct);
    stdRows.set(key, row);
  });
  /* 🔴 ของเสีย/งานทดลอง/ของสงสัย **ก็กินรอบเครื่อง** ⇒ เข้าตัวเศษของ %P ด้วย (ดู `ngByMatFrom`)
     ไม่ส่ง `ngForP` = ไม่บวกอะไรเลย = พฤติกรรมเดิมเป๊ะ (back-compatible) */
  let ngInP = 0, ngNoCtP = 0;
  Object.entries(ngForP?.byMat || {}).forEach(([mat, v]) => {
    const n = Number(v) || 0;
    if (!(n > 0)) return;
    const ct = Number(ctMap[mat]) || 0;
    if (!(ct > 0)) { ngNoCtP += n; if (mat) matsNoCt.add(mat); return; }   // ไม่มี CT = คิดไม่ได้ ห้ามเดา
    const row = stdRows.get(mat) || { mat_no: mat, qty: 0, ct };
    row.qty += n; row.ct = Math.max(row.ct, ct);
    stdRows.set(mat, row);
    ngInP += n;
  });
  qtyNoCt += ngNoCtP;
  const ngPInfo = { ngInP, ngNoMatP: Number(ngForP?.noMat) || 0, ngNoCtP };

  const pairOf = pairMap ? (m => pairMap[m] ?? null) : undefined;
  const stdMin = collapsePairShots([...stdRows.values()], pairOf)
    .reduce((s, r) => s + r.qty * r.ct / 60, 0);
  const ng = ngQty != null ? ngQty : ngFromOrders;

  const A = Math.min(1, runMin / netAvail);
  const pct = v => Math.max(0, Math.min(100, Math.round(v * 1000) / 10));
  /* ตัวเลขฐานที่ใช้ตรวจย้อนกลับได้ว่า A สดมาจากไหน (จอเอาไปโชว์ tooltip ได้ ไม่ต้องคำนวณเอง)
     `noBreakPolicy` = ผู้เรียกลืมส่งนโยบายพัก ⇒ A จะไม่ตรงกับค่าที่ stamp ตอนปิดกะ */
  const baseInfo = {
    netAvailMin: Math.round(netAvail), breakMin: Math.round(breakMin),
    plannedDtMin: Math.round(plannedDtMin), unplannedDtMin: Math.round(unplannedDtMin),
    noBreakPolicy: !breakPolicies.length, startTimeOutOfFrame, plannedOverMin: Math.round(plannedOverMin),
    /* ยังไม่รู้เวลาเลิกกะ ⇒ พักท้ายกะ (5ส.) ยังไม่ถูกหัก — จอต้องเขียนบอก ห้ามเงียบ */
    noShiftEndBreak: !hardEndMs && anchoredPolicies.length > 0,
  };

  // ยังไม่ผลิตชิ้นแรก (เพิ่งเปิดกะ/รอของ) → ประเมิน P/Q/OEE ไม่ได้ ต้องคืน null
  // ห้ามคืน P=0 → OEE 0% (เคยทำการ์ด "กำลังผลิต" ขึ้น 0% แดง ทั้งที่กะเพิ่งเปิด 19 นาที · 2026-08-05)
  if (produced <= 0) {
    return { A: pct(A), P: null, Q: null, oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
      stdMin: 0, denomMin: Math.round(runMin), produced: 0, ngQty: ng, noOutput: true, ...baseInfo };
  }

  /* %Q = งานดี ÷ **ยอดผลิต** (§7.2.2 · สูตรกลาง `qRatio`) — ไม่ใช่ ยอดสแกน ÷ (ยอดสแกน + ของเสีย)
     🔴 ฐานของ %Q ต้องมาจาก **แถว `defect_logs`** (`qRows`) ไม่ใช่ `ngForP`:
        `ngForP` เป็นขา %P ที่ **นับงานทดลองด้วย** ⇒ เอามาเป็นฐาน %Q = งานทดลองดันค่า Q ขึ้นลอยๆ
        (เคสจริงในเทส vsmLive: ทดลอง 99 ชิ้น ดัน Q จาก 95.2 → 97.3) · กฎ "งานทดลองออกทั้งคู่"
     🔴 `Math.max` คือด่าน back-compat: ไม่ส่ง `qRows` = ฐานถอยไปเป็น `produced + ng`
        ⇒ `qRatio` คืนค่า **เท่าสูตรเดิมเป๊ะ** · และฐานไม่ต่ำกว่าสูตรเดิมได้เลย (ของเสียที่หัก
        ต้องอยู่ในฐานเสมอ ไม่งั้น %Q ติดลบ) */
  const qBase = Math.max(qTotalCount(produced, qRows || []), produced + ng);
  const Q = qRatio(qBase, ng);

  /* ผลิตแล้วแต่ "ไม่มีชิ้นงานไหนตั้ง CT ไว้เลย" → stdMin = 0 → P = 0 → OEE = 0%
     ⚠️ นั่นคือคำกล่าวอ้างเท็จว่า "ไลน์เดินได้แย่มาก" ทั้งที่ความจริงคือ **ไม่รู้มาตรฐาน**
     (หลักเดียวกับ noOutput ที่ห้ามคืน 0) → P/OEE = null + flag noCt ให้จอบอกว่าต้องไปตั้ง CT
     A กับ Q ยังตอบได้ (ไม่ต้องใช้ CT) จึงคืนตามปกติ */
  if (stdMin <= 0) {
    return { A: pct(A), P: null, Q: pct(Q), oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
      stdMin: 0, denomMin: Math.round(runMin),
      produced, ngQty: ng, noOutput: false, noCt: true, qtyNoCt, matsNoCt: [...matsNoCt], ...ngPInfo, ...baseInfo };
  }

  /* ไลน์เครื่องขนาน: ตัวหารต้องเป็น "เวลาเครื่อง" ไม่ใช่ "เวลาไลน์"
     งานกระจายอยู่บนหลายเครื่อง → เอา runMin (เวลาไลน์) เป็นตัวหารตรงๆ ทำให้ P สูงได้ถึง N เท่า
     แล้วโดน cap 100% เงียบๆ — ต้นเหตุที่ SUB APRON โชว์ OEE ~99% แทบทุกกะ (2026-08-13)
     busy = เวลาเครื่องที่ถูกใช้จริงจาก order window · clamp [runMin, N×runMin]:
       - พาร์ทเดียววิ่ง → busy ≈ runMin → เท่าสูตรเดิมเป๊ะ (ไลน์ปกติไม่กระทบ)
       - N พาร์ทวิ่งพร้อมกัน → busy ≈ N×runMin → P ถูกต้อง
     ไลน์ที่ไม่ใช่ parallel_machine ส่ง parallelCap = 1 → ข้ามทั้งบล็อก พฤติกรรมเดิมเป๊ะ */
  const cap = Math.max(1, Number(parallelCap) || 1);
  let denomMin = runMin, machineMin = null;
  if (cap > 1) {
    // ไม่ตั้ง shift_min = ไม่รู้ว่ากะจบเมื่อไหร่ → ใช้ "ตอนนี้" เป็นขอบ (ตรงกับวิธีคิด elapsed ด้านบน)
    const shiftEnd = Number(session.shift_min) > 0 ? opened + Number(session.shift_min) * 60000 : nowMs;
    machineMin = busyMinutes(orders, opened, Math.min(nowMs, shiftEnd));
    denomMin = Math.min(cap * runMin, Math.max(runMin, machineMin));
  }
  const pRaw = denomMin > 0 ? stdMin / denomMin : 0;
  const P = Math.min(1, pRaw);
  const oee = A * P * Q;
  if (!isFinite(oee)) return null;

  /* pOver = P ทะลุ 100% ก่อนโดน cap — ห้ามกลืนเงียบ (กฎ "ห้ามล้มเหลวเงียบ")
     แปลว่างานมาตรฐานที่บันทึก > เวลาเครื่องที่มี = มีอะไรผิดในข้อมูล (CT/ยอด/เวลาเปิด-ปิดใบ/N)
     ถ้ามี guard นี้ตั้งแต่แรกจะจับได้ตั้งแต่กะแรก แทนที่จะปล่อยจน OEE อ่านไม่ได้ทั้งไลน์ 14 กะ */
  // qtyNoCt > 0 = ตั้ง CT ไม่ครบทุกชิ้นงาน → stdMin ขาด → %P ต่ำกว่าจริง (จอควรติดป้ายเตือน)
  return { A: pct(A), P: pct(P), Q: pct(Q), oee: pct(oee), elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
    stdMin: Math.round(stdMin), denomMin: Math.round(denomMin),
    produced, ngQty: ng, noOutput: false, noCt: false, qtyNoCt, matsNoCt: [...matsNoCt], ...ngPInfo,
    pOver: pRaw > 1.001, pRawPct: Math.round(pRaw * 1000) / 10,
    machineMin: machineMin == null ? null : Math.round(machineMin), parallelCap: cap, ...baseInfo };
}

/* ── นาทีที่หายไปของกะ — "แปล" computeLiveOee เป็นหน่วยที่หน้างานสั่งงานได้ (2026-09-16) ──
   ที่มา (user): "จะรู้ได้ยังไงว่าตอนนี้ดีเลย์ไปแล้วกี่ใบ และต้อง recover ยังไง"
   คำตอบคือ **นาที ไม่ใช่ใบ** — 1 ใบของคนละพาร์ท CT ต่างกัน และใบที่ช้า 2 นาทีกับ 3 ชม.
   ก็นับเป็น 1 เท่ากัน · ที่สำคัญกว่านั้น ใบ backfill (35% ของใบทั้งระบบ) ถูกยกเว้นจากการตีดีเลย์
   รายใบ ⇒ นับ "ใบ" เท่าไหร่ก็ต่ำกว่าจริงตลอด · นับ "นาที" จากยอดที่ผลิตได้จริงไม่มีปัญหานี้

   🔴 ฟังก์ชันนี้ **ไม่คำนวณอะไรใหม่เลย** — แค่จัดนาทีที่ `computeLiveOee` คิดไว้แล้วเป็นก้อน
   ห้ามคำนวณหนี้เวลาเองในหน้า และห้ามสร้างสูตรคู่ขนาน (กฎเดียวกับ OEE: สูตรอยู่ไฟล์นี้ที่เดียว)
   ผลพลอยได้คือตัวเลขนาทีตรงกับ %A/%P/%Q ที่จอโชว์อยู่แล้วเป๊ะ เพราะเป็นตัวเดียวกัน

       elapsedMin
       ├─ breakMin      ⬛ พักตามนโยบาย        ← กันออกจากฐานแล้ว ไม่ใช่เวลาที่เสีย
       ├─ plannedMin    🟦 หยุดตามแผน (PM/เปลี่ยนรุ่น)
       └─ netAvailMin
          ├─ dtMin      🟧 หยุดนอกแผน          ← เสียจริง แต่ **อธิบายได้แล้ว**
          └─ runMin
             ├─ workMin 🟩 งานที่ทำได้ (Σ ยอด×CT)
             └─ unknownMin ⬜ **อธิบายไม่ได้**  ← ก้อนเดียวที่ต้องตามหาคำตอบ

   ⚠️ ไลน์เครื่องขนาน (parallelCap > 1): ฐานของ 2 ก้อนล่างเป็น "เวลาเครื่อง" ไม่ใช่ "เวลาไลน์"
      → คืน `unit: 'machine'` ให้จอเขียนกำกับ **ห้ามเอาไปวาดรวมแถบเดียวกับก้อนบนเงียบๆ**
   ⚠️ `state` ต้องถูกแสดงบนจอเสมอ ห้ามกลืน (กฎ "ไม่รู้ ≠ ไม่มี" · ห้ามล้มเหลวเงียบ):
      'over'   = งานมาตรฐาน > เวลาที่มี ⇒ ข้อมูลผิด (CT/ยอด/เวลาเปิด-ปิดใบ) **ห้ามบอกว่าหนี้ = 0**
      'no_ct'  = บางพาร์ทไม่ได้ตั้ง CT ⇒ workMin ขาด ⇒ ⬜ สูงเกินจริง
      'no_output' = ยังไม่ผลิตชิ้นแรก ⇒ ⬜ = runMin เต็ม (จริง แต่ต้องบอกว่าเพราะยังไม่เริ่ม) */
export function liveTimeSplit(live) {
  if (!live) return null;
  const cap        = Math.max(1, Number(live.parallelCap) || 1);
  const runMin     = Math.max(0, Number(live.runMin) || 0);
  const denomMin   = Math.max(0, Number(live.denomMin ?? runMin) || 0);
  const workMin    = Math.max(0, Number(live.stdMin) || 0);
  const rawUnknown = denomMin - workMin;
  return {
    elapsedMin:  Math.max(0, Number(live.elapsedMin)  || 0),
    breakMin:    Math.max(0, Number(live.breakMin)    || 0),
    plannedMin:  Math.max(0, Number(live.plannedDtMin)|| 0),
    dtMin:       Math.max(0, Number(live.unplannedDtMin) || 0),
    netAvailMin: Math.max(0, Number(live.netAvailMin) || 0),
    runMin, capacityMin: denomMin, workMin,
    unknownMin:  Math.max(0, rawUnknown),
    unit: cap > 1 ? 'machine' : 'line',
    parallelCap: cap,
    over: rawUnknown < 0 || !!live.pOver,
    state: live.pOver || rawUnknown < 0 ? 'over'
         : live.noCt                    ? 'no_ct'
         : live.noOutput                ? 'no_output'
         : 'ok',
    noBreakPolicy: !!live.noBreakPolicy,
    startTimeOutOfFrame: !!live.startTimeOutOfFrame,
    qtyNoCt: Number(live.qtyNoCt) || 0,
  };
}

/* ═══ 5) OEE จริง (strict) ═══ */
// คืน null เมื่อคำนวณไม่ได้ (ไม่มีเวลากะ / ฐาน ≤ 0 / ไม่มีค่า A ที่ stamp)
export function strictOee({ shiftMin, breakMin = 0, plannedDtMin = 0, a = null, p = null, q = null }) {
  const shift = Number(shiftMin) || 0;
  const brk = Math.max(0, Number(breakMin) || 0);
  const planned = Math.max(0, Number(plannedDtMin) || 0);

  const base = shift - brk;                        // loading time (หักเฉพาะพักตามนโยบาย)
  if (!(base > 0) || a == null) return null;
  const loadOfficial = Math.max(0, base - planned); // ฐานของสูตรมาตรฐาน
  const ratio = loadOfficial / base;                // ≤ 1 เสมอ

  const r1 = v => Math.round(v * 10) / 10;
  const aStrict = Math.max(0, Math.min(100, Number(a) * ratio));
  const pv = p == null ? null : Number(p);
  const qv = q == null ? null : Number(q);
  const oee = pv == null || qv == null ? null : r1(aStrict * pv * qv / 10000);

  return {
    a: r1(aStrict),
    oee,
    baseMin: Math.round(base),
    loadMin: Math.round(loadOfficial),
    plannedDtMin: Math.round(planned),
    // สัดส่วนเวลาที่ถูก "กันออก" จากฐาน A ของสูตรมาตรฐาน — สูงผิดปกติ = ควรตรวจการจัดประเภท Downtime
    plannedSharePct: r1((planned / base) * 100),
  };
}

// ต่างกันกี่จุดจาก OEE มาตรฐานที่ stamp ไว้ (บวก = OEE มาตรฐานสูงกว่า)
export const strictGap = (stampedOee, strictOeeVal) =>
  stampedOee == null || strictOeeVal == null ? null : Math.round((Number(stampedOee) - strictOeeVal) * 10) / 10;

// เกณฑ์เตือน: หยุด "ในแผน" กินฐานเกินเท่าไหร่ถึงควรไปตรวจการจัดประเภท
export const STRICT_WARN_SHARE_PCT = 5;

/* ═══ 6) Lean — 6 Big Losses (TPM) + 8 Wastes (DOWNTIME) ═══ */
/*
  จำแนกจาก master ที่มีอยู่: `dr_downtime_types.six_big_loss/waste_type` และ `dr_defect_types.*`
  (migration 20260805_lean_loss_classification.sql · ปรับเองได้จาก Daily Report → ⚙️ ตั้งค่า)

  ⚠️ แยกคนละแกนกับ `category` (ในแผน/นอกแผน) ที่ใช้คิด OEE โดยตั้งใจ —
  แต่ละบริษัทนิยาม "ในแผน" ต่างกันตาม KPI ที่ตกลงกันไว้ ระบบไม่ตัดสินให้ (คำสั่ง user 2026-08-05)
  แกน Lean นี้ตอบคนละคำถาม: "เวลาที่เสียไป เป็นความสูญเปล่าประเภทไหน จะแก้ด้วยเครื่องมืออะไร"

  ไม่จำแนก (null) = แสดงเป็น "ยังไม่จัดหมวด" ห้ามเดาแทนผู้ใช้
*/
export const SIX_BIG_LOSSES = [
  { key: 'breakdown',     label: 'เครื่องเสีย (Breakdown)',        oee: 'A', icon: '🔧', color: '#ef4444', fix: 'TPM / PM เชิงป้องกัน · วิเคราะห์ MTBF-MTTR · ใบซ่อม MO ซ้ำซาก' },
  { key: 'setup',         label: 'ตั้งเครื่อง/เปลี่ยนรุ่น (Setup)', oee: 'A', icon: '🔄', color: '#f59e0b', fix: 'SMED — แยกงาน internal/external · เตรียมแม่พิมพ์ล่วงหน้า' },
  { key: 'minor_stop',    label: 'หยุดเล็กน้อย/รอ (Minor stop)',   oee: 'P', icon: '⏸️', color: '#eab308', fix: 'ดู pattern การรอ · เติมของตามจังหวะ kanban · poka-yoke จุดติดขัด' },
  { key: 'reduced_speed', label: 'เดินช้ากว่ามาตรฐาน (Speed)',     oee: 'P', icon: '🐢', color: '#a855f7', fix: 'เทียบ CT จริง vs มาตรฐาน · ตรวจสภาพเครื่อง/ทักษะคน' },
  { key: 'defect',        label: 'ของเสีย/แก้งาน (Defect)',        oee: 'Q', icon: '🚫', color: '#ec4899', fix: 'QC 7 tools · poka-yoke · คุมพารามิเตอร์กระบวนการ' },
  { key: 'startup',       label: 'เริ่มเดินเครื่อง (Start-up)',    oee: 'Q', icon: '🌅', color: '#06b6d4', fix: 'มาตรฐานการเริ่มเครื่อง · ลดของเสียช่วง warm-up' },
];
export const EIGHT_WASTES = [
  { key: 'defect',           label: 'ของเสีย (Defects)',              icon: '🚫', color: '#ef4444' },
  { key: 'overproduction',   label: 'ผลิตเกิน (Overproduction)',      icon: '📦', color: '#f97316' },
  { key: 'waiting',          label: 'การรอคอย (Waiting)',             icon: '⏳', color: '#eab308' },
  { key: 'non_utilized',     label: 'ไม่ใช้ศักยภาพคน (Non-utilized)', icon: '🧠', color: '#84cc16' },
  { key: 'transportation',   label: 'การขนย้าย (Transportation)',     icon: '🚚', color: '#06b6d4' },
  { key: 'inventory',        label: 'สต๊อกเกินจำเป็น (Inventory)',    icon: '🏭', color: '#3b82f6' },
  { key: 'motion',           label: 'การเคลื่อนไหว (Motion)',         icon: '🚶', color: '#a855f7' },
  { key: 'extra_processing', label: 'ทำเกินจำเป็น (Extra-processing)', icon: '🔁', color: '#ec4899' },
];
export const lossMeta  = key => SIX_BIG_LOSSES.find(l => l.key === key) || null;
export const wasteMeta = key => EIGHT_WASTES.find(w => w.key === key) || null;

/*
  รวมนาที/ชิ้น เข้าถังตามแกนที่เลือก ('six_big_loss' | 'waste_type')
  downtimes: แถว downtime_logs ที่ embed dr_downtime_types(name_th, category, six_big_loss, waste_type)
  defects:   แถว defect_logs ที่ embed dr_defect_types(name_th, six_big_loss, waste_type)
  ctSecFn:   (session_id) => CT วินาที — ใช้แปลงของเสียเป็น "นาทีที่เสียไป" ให้เทียบกับ downtime ได้
             ไม่ส่งมา = ไม่แปลง (ของเสียจะนับเฉพาะจำนวนชิ้น)
  คืน [{ key, meta, min, count, qty, types: [{name, min, count, qty}] }] เรียงนาทีมากสุด
*/
export function groupLean({ axis = 'six_big_loss', downtimes = [], defects = [], ctSecFn = null, includePlanned = true }) {
  const buckets = {};
  const put = (key, name, { min = 0, count = 0, qty = 0 }) => {
    const k = key || '_none';
    const b = (buckets[k] ||= { key: k, min: 0, count: 0, qty: 0, typeMap: {} });
    b.min += min; b.count += count; b.qty += qty;
    const t = (b.typeMap[name] ||= { name, min: 0, count: 0, qty: 0 });
    t.min += min; t.count += count; t.qty += qty;
  };
  downtimes.forEach(d => {
    const ty = d.dr_downtime_types || {};
    if (!includePlanned && ty.category === 'planned') return;
    put(ty[axis], ty.name_th || tr("ไม่ระบุประเภท"), { min: Number(d.duration_min) || 0, count: 1 });
  });
  defects.forEach(d => {
    const ty = d.dr_defect_types || {};
    const qty = defectQtyAll(d);   // พาเรโต/6 Big Loss = "เห็นทุกอย่าง" รวมของสงสัยที่ยังไม่ตัดสิน (คนละตัวกับที่คิด %Q)
    if (!qty) return;
    const ct = ctSecFn ? ctSecFn(d.session_id) : 0;
    put(ty[axis] || 'defect', ty.name_th || 'ของเสีย', { qty, count: 1, min: ct > 0 ? (qty * ct) / 60 : 0 });
  });
  return Object.values(buckets)
    .map(b => ({
      key: b.key === '_none' ? null : b.key,
      meta: axis === 'six_big_loss' ? lossMeta(b.key) : wasteMeta(b.key),
      min: Math.round(b.min), count: b.count, qty: b.qty,
      types: Object.values(b.typeMap).sort((x, y) => (y.min - x.min) || (y.qty - x.qty))
        .map(t => ({ ...t, min: Math.round(t.min) })),
    }))
    .sort((a, b) => (b.min - a.min) || (b.qty - a.qty));
}


/* ═══ 7) งานทดลอง (Try-out) — แยกออกจาก %Q แต่ยังนับเป็นมูลค่าของเสีย (2026-08-17) ═══
   ไลน์ไม่ควรถูกลงโทษใน OEE จากงานลองแม่พิมพ์/ลองงานใหม่ แต่ของที่เสียไปมีต้นทุนจริง
   ต้องเห็นทั้ง 2 มุม: "มูลค่าของเสียทั้งหมด" vs "เฉพาะไลน์ผลิต" (= ตัวเดียวกับที่คิด %Q)

   ทำเครื่องหมายได้ 2 ทาง (migration 20260817_defect_trial_flag):
     • defect_logs.is_trial              — ติ๊กรายครั้งในฟอร์มบันทึกงานเสีย
     • dr_defect_types.excl_from_q       — ตั้งที่ประเภท (⚙️ ตั้งค่า) ทั้งประเภทเป็นงานทดลอง

   ⚠️ ต้องอ่าน excl_from_q ผ่าน join → query ที่เอาไปคิด %Q ต้อง select
      `dr_defect_types(..., excl_from_q)` ด้วย ไม่งั้นจะเห็นแค่ is_trial แล้วตกหล่นเงียบ
   ⚠️ จุดที่ "แสดงรายการ" ของเสีย ห้ามกรองทิ้ง — งานทดลองเป็นของเสียจริง ต้องเห็นในลิสต์/พาเรโต */

/** รายการนี้เป็นงานทดลองมั้ย (ไม่นับเข้า %Q) */
export const isTrialDefect = (d) =>
  d?.is_trial === true || d?.dr_defect_types?.excl_from_q === true;

/* ═══ 7.1) 🔴🔴 กฎเหล็กข้าม session — "ของสงสัย" ยังไม่ใช่ของเสีย จนกว่า QA จะตัดสิน (2026-09-30 · คำสั่ง user) ═══

   เดิม: `defectQty = qty_ng + qty_suspect` ⇒ ของสงสัยถูกนับเป็นของเสีย**ทันทีที่ลง**
   และ**ไม่มีทางย้อน** — QA ตัดสินทีหลังว่า "งานดี" ก็ไม่มีอะไรวิ่งกลับไปแก้ %Q ของกะนั้น
   เคสจริง: Line 60 กะ 21/07 ลงสงสัย 12 ชิ้น เขียนว่า "รอพิจารณา" → ถึง 30/09 ยังรออยู่ (71 วัน)
   และกะนั้นถูกหัก 12 ชิ้นถาวร

   🔴 ของสงสัย = **ยังไม่รู้ว่าดีหรือเสีย** ⇒ เอาไปหัก %Q ไม่ได้ และเอาไปบวกเป็นงานดีก็ไม่ได้
      ต้อง **กันออกจากสูตร แล้วเขียนบนจอว่ายังมีของรอพิจารณาอยู่กี่ชิ้น** (%Q ยังไม่สรุป)
      — หลักเดียวกับ "งานทดลอง" (§7) และกฎความซื่อสัตย์ของจอ Obeya: ข้อมูลไม่พอให้เขียนบนจอ
        ห้ามโชว์เลขที่แน่ใจไม่ได้เหมือนเลขที่แน่ใจ

   ผลพิจารณามาจากทะเบียนถังเหลือง/แดง (`quality_bin_records` ผูกด้วย `defect_log_id`)
   ตัดสินตาม WI-PD3-069 §5.4 — ตัวตัดสินอยู่ `src/utils/qualityBin.js` (QA_DECISIONS 4 ทาง)
     'scrap'                        → เสียจริง          ⇒ **นับเข้า %Q**
     'good' | 'repair' | 'use_as_is' → ไม่ใช่ของเสีย      ⇒ ไม่นับ (ซ่อมแล้วกลับเข้ากระบวนการ)
     `return_date` (กลับเข้ากระบวนการแล้ว)               ⇒ ไม่นับ
     ย้ายลงถังแดงแล้ว (มีใบแดงที่ `from_yellow_id` ชี้มา) ⇒ **นับเข้า %Q** (ยืนยันเสียแล้ว)
     ยังไม่มีใบถัง / มีใบแต่ยังไม่ตัดสิน                  ⇒ **รอพิจารณา — ไม่นับ + ต้องขึ้นบนจอ**

   ⚠️⚠️ **"ยังไม่ตัดสิน" กับ "ไม่ได้ถามมา" ต้องแยกให้ออก — ห้ามยุบเป็นอันเดียว**
      คิวรีที่เอาไปคิด %Q ต้อง embed ทะเบียนถังมาด้วย: `.select('..., ' + QBIN_EMBED)`
      · มี key `quality_bin_records` (แม้เป็น `[]`) = ถามแล้ว ⇒ ตัดสินตามกฎด้านบน
      · **ไม่มี key เลย = คิวรีนั้นไม่ได้ถาม** ⇒ คืนพฤติกรรมเดิม (นับสงสัยเป็นของเสีย)
        พร้อมธง `unknown` — ตัวเลขจะ "เท่าเดิม" ไม่เงียบๆ เปลี่ยนหลังบ้าน
        (บทเรียน `excl_from_q`: ลืม select แล้วตกหล่นเงียบ — คราวนี้ทำให้ *ตรวจจับได้* แทน)
      มีด่าน `regressionGuards` (`oee-suspect-needs-qbin-embed`)                            */

/** คอลัมน์ทะเบียนถังที่ต้อง embed มากับ defect_logs ทุกครั้งที่จะเอาไปคิด %Q */
export const QBIN_EMBED =
  'quality_bin_records(id, bin, qa_decision, return_date, special_use_doc_no, from_yellow_id, is_active, qty, qty_ng)';

/** ผลพิจารณาที่ถือว่า "เสียจริง" — ค่าอื่นที่ตัดสินแล้วคือไม่เสีย */
const QA_SCRAP = 'scrap';
/** ผลพิจารณาที่ถือว่า "เคลียร์แล้ว ไม่ใช่ของเสีย" ทันทีที่ตัดสิน
 *  🔴 `repair` ไม่อยู่ในนี้แล้ว (2026-11-10 · สายใบถังแบบ MO): "ส่งซ่อม" ยังไม่รู้ผล — ซ่อมอาจไม่ผ่าน
 *     ⇒ เคลียร์เมื่อ QA ตรวจรับ (`return_date`) เท่านั้น ก่อนหน้านั้น = รอ (qualityBin.js `ncStep` ขั้น 3-4) */
const QA_CLEARED = ['good', 'use_as_is'];

/**
 * สถานะของ "ของสงสัย" ในแถวของเสีย 1 แถว
 * @returns 'none'    ไม่มีของสงสัยในแถวนี้
 *          'unknown' คิวรีไม่ได้ embed ทะเบียนถังมา — ตอบไม่ได้ (ใช้พฤติกรรมเดิม)
 *          'pending' ยังไม่มีผลพิจารณา ⇒ กันออกจาก %Q + ต้องขึ้นบนจอ
 *          'scrap'   QA ตัดสินว่าเสีย / ย้ายลงถังแดงแล้ว ⇒ นับเข้า %Q
 *          'cleared' ตัดสินแล้วว่าไม่เสีย ⇒ ไม่นับ
 */
export function suspectState(d) {
  if (!(Number(d?.qty_suspect) || 0)) return 'none';
  const bins = d?.quality_bin_records;
  if (bins === undefined || bins === null) return 'unknown';
  /* ใบที่ถูกลบ (soft delete `is_active=false`) ห้ามมีสิทธิ์ตัดสิน — ไม่ select มา (undefined) = ถือว่ายังใช้อยู่ */
  const rows = (Array.isArray(bins) ? bins : [bins]).filter(r => r && r.is_active !== false);
  if (!rows.length) return 'pending';

  /* ยืนยันเสียแล้ว = ใบเหลืองของแถวนี้ถูกย้ายลงแดง (`from_yellow_id` ชี้ใบเหลืองในชุด)
     🔴 ใบแดงที่ลงตรงจาก NG (`from_yellow_id` ว่าง) **ไม่ใช่คำตัดสินของสงสัย** ถ้าแถวนี้มีใบเหลืองอยู่ด้วย
        (QA 05/10: โมดัลลงถังติ๊ก 2 ถังพร้อมกัน — แดงจาก NG + เหลืองจากสงสัย ⇒ เดิมนับสงสัยเป็นเสียทันที)
        ไม่มีใบเหลืองเลย = เอาของสงสัยลงแดงตรง ⇒ ยังถือว่าเสีย (พฤติกรรมเดิม) */
  const yellowIds = new Set(rows.filter(r => r?.bin === 'yellow').map(r => r?.id).filter(Boolean));
  const movedToRed = rows.some(r => r?.bin === 'red'
    && (yellowIds.size ? yellowIds.has(r.from_yellow_id) : r?.from_yellow_id == null));
  if (movedToRed) return QA_SCRAP;

  const yellows = rows.filter(r => r?.bin === 'yellow');
  const pool = yellows.length ? yellows : rows;
  if (pool.some(r => r?.qa_decision === QA_SCRAP)) return QA_SCRAP;
  if (pool.some(r => r?.return_date || QA_CLEARED.includes(r?.qa_decision))) return 'cleared';
  return 'pending';
}

/** ของสงสัยแถวนี้ต้องรอ QA อยู่ไหม (จอต้องเอาไปเขียนว่า "%Q ยังไม่สรุป") */
export const isSuspectPending = (d) => suspectState(d) === 'pending';

/* ═══ 7.2) 🔴 NG ที่เข้าถังเหลืองแล้ว = ยังไม่ใช่ของเสีย จนกว่า QA จะตัดสิน (2026-11-10 · คำสั่ง user) ═══

   user: *"ถ้าซ่อมกลับมาเป็นงานดี จะคืน %Q มั้ย … ไม่เกี่ยวกับ FTT นะ"* → ยืนยัน "ลุยเลย":
     1. NG ที่อยู่ในถังเหลืองรอพิจารณา **ยังไม่หัก %Q** (เหมือนของสงสัย §7.1 — จอเขียนว่ารอกี่ชิ้น)
     2. QA ตัดสิน งานดี / ซ่อมแล้วดี / ขอใช้ / กลับเข้ากระบวนการ ⇒ **ไม่หัก**
     3. QA ตัดสิน ทำลาย / ย้ายลงถังแดง / ซ่อมแล้ว NG ⇒ หักเฉพาะชิ้นที่เสียจริง
   เหตุ: ตั้งแต่ 05/11 ทุกแถวงานเสียถูกตั้งแท็กเหลืองอัตโนมัติ (ทั้ง NG + สงสัย ในใบเดียว)
         แต่สูตรเดิมนับ NG เป็นของเสียทันที ⇒ ป้ายบอก "รอพิจารณา" ขณะที่ %Q หักไปแล้ว (วัด 10/11: 53 ชิ้น)

   🔴 ใช้เฉพาะแถวที่ "ใบเหลืองครอบ NG" — ผลรวม `qty` ของใบเหลือง ≥ NG + สงสัย **และ** ไม่มีใบแดงตรง
      (`from_yellow_id` ว่าง = NG ถูกส่งลงแดงตรงจากโมดัลลงถังแบบเก่า) ไม่ครอบ = **พฤติกรรมเดิมเป๊ะ**
      (NG นับเสมอ + ของสงสัยตาม §7.1) ⇒ แถวก่อน 05/11 / ตั้งแท็กไม่สำเร็จ / ไม่ได้ถาม embed — เลขเท่าเดิม
   ⚠️ %P ไม่ขยับตอน QA ตัดสิน (ตัวเศษ %P ใช้ `defectQtyForP` = นับทุกชิ้นที่เครื่องทำออกมาตั้งแต่แรก §7.2.1)
      · ชิ้นที่ซ่อมกลับมาดี "ไม่ถูกหัก %Q" แต่**ยังไม่ถูกบวกเข้ายอดสแกน** (การ์ดถูกสแกนไปแล้วตอนผลิต) */
const binRows = (d) => {
  const b = d?.quality_bin_records;
  if (b === undefined || b === null) return null;
  return (Array.isArray(b) ? b : [b]).filter(r => r && r.is_active !== false);
};

/**
 * แบ่งชิ้นของแถวที่ใบเหลืองครอบ NG → { scrap, cleared, pending } (รวม = NG + สงสัย)
 * @returns null เมื่อแถวนี้ไม่เข้ากติกา §7.2 (ใช้สูตรเดิม)
 */
export function binCoveredSplit(d) {
  const ng = Number(d?.qty_ng) || 0;
  const sus = Number(d?.qty_suspect) || 0;
  /* 🔧 25/11 (คำสั่ง user) — ชิ้นที่ "ส่งซ่อม" เข้าถังเหลืองแล้ว (`binPiecesOf` ใน qualityBin.js)
     ⇒ ต้องอยู่ในการแบ่งก้อนนี้ด้วย ไม่งั้นผลซ่อมไม่มีทางไหลกลับมาแก้ %Q ของกะต้นทาง
     · ซ่อมแล้วดี (`return_date`/`good`/`use_as_is`) → `cleared` = ไม่หัก %Q (เหมือนเดิม)
     · ซ่อมแล้วเสีย (`scrap`/ลงถังแดง)             → `scrap`   = หัก %Q ของ**กะที่ทำมันออกมา**
     · ยังไม่ตัดสิน                                  → `pending` = จอเขียน "รอพิจารณา" (ไม่หัก) */
  const rep = Number(d?.qty_repair) || 0;
  /* 🔴 25/11 (คำสั่ง user) — เดิมด่านนี้ตัดแถว "สงสัยล้วน" ออก (ให้ §7.1 `suspectState()` ตอบ)
     แต่ `suspectState()` ตอบได้แค่ **ทั้งแถว** (scrap/cleared/pending) ⇒ เคสที่ user ยกมา
     *"สงสัย 5 ซ่อมได้ 3 ไม่ได้ 2 ต้องทิ้ง"* **เขียนลงระบบไม่ได้เลย** (ใบแดง 2 ชิ้น = เสียทั้ง 5)
     ⇒ ให้ตัวแบ่งตามสัดส่วนนี้รับแถวสงสัยล้วนด้วย · ตรวจฐานจริง 25/11: ใบเหลือง 80 ใบ
       สงสัยล้วน 6 ใบ และ **ไม่มีใบไหนที่ใบแดงครอบไม่เต็ม** ⇒ ผลลัพธ์ของข้อมูลเดิมเท่าเดิมทุกใบ
       (คำตัดสินแบบ "ทั้งใบ" ให้ผลเดียวกันทั้ง 2 ราง — มีเทสตรึงความเท่ากันไว้) */
  if (!(ng > 0) && !(rep > 0) && !(sus > 0)) return null;   // แถวเปล่า = ไม่มีอะไรให้แบ่ง
  const rows = binRows(d);
  if (!rows) return null;                              // ไม่ได้ถาม = พฤติกรรมเดิม
  if (rows.some(r => r.bin === 'red' && r.from_yellow_id == null)) return null;   // NG ลงแดงตรง
  const yellows = rows.filter(r => r.bin === 'yellow');
  const total = ng + sus + rep;
  const yQty = yellows.reduce((a, y) => a + (Number(y.qty) || 0), 0);
  if (!yellows.length || yQty < total) return null;    // ใบเหลืองไม่ครอบ NG
  let scrap = 0, cleared = 0, pending = 0;
  for (const y of yellows) {
    const q = Number(y.qty) || 0;
    const kids = rows.filter(r => r.bin === 'red' && r.from_yellow_id === y.id);
    const done = !!y.return_date || QA_CLEARED.includes(y.qa_decision);   // ซ่อม = เคลียร์ตอน QA ตรวจรับ (return_date)
    if (y.qa_decision === QA_SCRAP || (kids.length && kids.some(k => !(Number(k.qty) > 0)))) {
      scrap += q;                                      // ทำลายทั้งใบ / ใบแดงไม่รู้จำนวน = เสียทั้งใบ (ปลอดภัยฝั่งลูกค้า)
      continue;
    }
    const red = Math.min(q, kids.reduce((a, k) => a + (Number(k.qty) || 0), 0)
      || (done && y.qa_decision === 'repair' ? (Number(y.qty_ng) || 0) : 0));
    scrap += red;
    if (done) cleared += q - red; else pending += q - red;
  }
  /* ใบเหลืองนับเกินชิ้นของแถว (ใบซ้ำ) — ตัดส่วนเกินจาก "รอ" ก่อน แล้ว "ไม่เสีย" ห้ามตัดส่วน "เสีย" ก่อน */
  let over = scrap + cleared + pending - total;
  const cut = (v) => { const c = Math.min(v, Math.max(0, over)); over -= c; return v - c; };
  pending = cut(pending); cleared = cut(cleared); scrap = cut(scrap);
  return { scrap, cleared, pending };
}

/**
 * จำนวนของเสียของ 1 แถว — ใช้คิด %Q
 * NG นับเสมอ · ของสงสัยนับเฉพาะที่ QA ตัดสินว่าเสีย (ดู §7.1)
 * ⚠️ ยึด `defect_logs` ไม่ใช่คอลัมน์ rollup ของ session (กฎเดิม)
 */
export const defectQty = (d) => {
  const cov = binCoveredSplit(d);          // §7.2 NG ที่อยู่ในถังเหลือง — ตัดสินจากใบถัง
  if (cov) return cov.scrap;
  const ng = Number(d?.qty_ng) || 0;
  const sus = Number(d?.qty_suspect) || 0;
  if (!sus) return ng;
  const st = suspectState(d);
  /* 'unknown' = คิวรีไม่ได้ถามทะเบียนถัง ⇒ คงพฤติกรรมเดิมไว้ ห้ามเปลี่ยนเลขเงียบๆ */
  return (st === QA_SCRAP || st === 'unknown') ? ng + sus : ng;
};

/**
 * จำนวนของเสีย "ทุกอย่าง" ของ 1 แถว — NG + สงสัยทั้งหมดไม่สนผลพิจารณา
 * ⚠️ ใช้กับจอที่ **แสดงรายการ/พาเรโต/มูลค่า** เท่านั้น — ของสงสัยเป็นปัญหาจริงที่ต้องเห็น
 *    🔴 ห้ามเอาไปคิด %Q (นั่นคือ `defectQty`) — สลับ 2 ตัวนี้ = จอเดียวกันตอบคนละเลข
 */
export const defectQtyAll = (d) => (Number(d?.qty_ng) || 0) + (Number(d?.qty_suspect) || 0);

/* ═══ 7.2.1) 🔴 งานซ่อม (`qty_repair`) — เครื่องทำออกมาแล้ว แต่ "ยังไม่ใช่ของดี" (2026-11-25 · คำสั่ง user) ═══

   user: *"ผลิตออกมา 210 ชิ้น มีต้องสงสัย 7 ชิ้นรอ rework … ปิดกะส่งยอด ระบบจะมองเหลือ 203
           แล้วไปคิด %P ทำให้ OEE ตก"* — ถูกต้องตามที่ทัก **และเป็นบั๊ก**

   กติกาที่มีอยู่แล้ว (`handleCloseSession` · 2026-08-02): **"การ์ดที่สแกน = ของดีล้วน ·
   NG/สงสัย/ซ่อม คือของที่ผลิตเพิ่มต่างหาก ไม่หักซ้ำ"** ⇒ ชิ้นที่รอซ่อม **ไม่เคยอยู่ในยอดสแกน**
   แต่ `defectQtyAll` (ตัวเติมตัวเศษ %P) นับแค่ `qty_ng + qty_suspect` ⇒ **ชิ้นที่รอซ่อมหายจาก %P**
   ทั้งที่เครื่องเดินทำมันออกมาจริง (วัดจริง Assy GOR 24/11 กะเช้า: ตัวเศษ 203 แทนที่จะเป็น 210
   ⇒ %P 83.05 แทน 85.91 · OEE 39.88 แทน 41.25 = **หาย 1.4 จุด**)

   🔴 %P ถามว่า *"เครื่องเดินไปกี่รอบ"* ไม่ใช่ *"ของดีกี่ชิ้น"* ⇒ **ซ่อมต้องอยู่ในตัวเศษ %P**
      (หลักเดียวกับของเสีย/ของสงสัย/งานทดลอง §7 — ไม่งั้นถูกหัก 2 ครั้งทั้ง %P และ %Q)
   🔴 **%Q ไม่เปลี่ยน** — `defectQty` ไม่นับซ่อมเหมือนเดิม ⇒ ชิ้นรอซ่อมอยู่นอกทั้งตัวเศษและตัวหารของ %Q
      = ท่า "รอพิจารณา" เดียวกับของสงสัย (§7.1) ⇒ **จอต้องเขียนว่ารอซ่อมกี่ชิ้น** (`reworkPendingQty`)
      ห้ามปล่อยให้ %Q โชว์ 100% เฉยๆ เหมือนไม่มีอะไรค้าง (กฎจอซื่อสัตย์)
   🔴 **ห้ามเอา `qty_repair` ไปใส่ `defectQtyAll`** — ตัวนั้นเป็นชุดของ **พาเรโต/มูลค่าของเสีย**
      (ชิ้นที่ซ่อมได้ไม่ใช่ของเสียที่ต้องคิดมูลค่าทิ้ง) · 2 ตัวนี้คนละคำถาม ห้ามยุบรวม          */

/** ชิ้นที่ **เครื่องทำออกมา** ของแถวนี้ — NG + สงสัย + ซ่อม ⇒ ตัวเติม "ตัวเศษ %P" (ค่า default ของ `ngByMatFrom`) */
export const defectQtyForP = (d) => defectQtyAll(d) + (Number(d?.qty_repair) || 0);

/** ชิ้นที่รอซ่อม/รอยืนยันหลังซ่อมของแถวนี้ — ไม่ใช่ของดี ไม่ใช่ของเสีย ⇒ **จอต้องเขียนบอก** */
export const reworkPendingQty = (d) => {
  /* 🔧 มีใบถังครอบแล้ว = `suspectPendingQty()` รายงาน "รอพิจารณา" ให้ครบอยู่แล้ว (รวมชิ้นรอซ่อม)
     ⇒ ที่นี่คืน 0 ไม่งั้นจอนับซ้ำ 2 ที่ · ไม่มีใบถัง (แถวเก่า/ตั้งแท็กไม่สำเร็จ) = ยังต้องเขียนบอก */
  if (binCoveredSplit(d)) return 0;
  return Number(d?.qty_repair) || 0;
};

/** รวมชิ้นรอซ่อมทั้งชุด — จอเอาไปเขียน "รอซ่อม N ชิ้น · ยังไม่นับเป็นของดี" */
export const sumReworkPending = (rows) =>
  (rows || []).reduce((s, d) => s + reworkPendingQty(d), 0);

/* ═══ 7.2.2) 🔴🔴 "ยอดผลิต" = ทุกชิ้นที่เครื่องทำออกมา · %Q = งานดี ÷ ยอดผลิต (2026-11-25 · คำสั่ง user) ═══

   user: *"ยอดผลิตไม่ใช่ `qty_ok` นะ ยอดผลิต = งานดี + งานต้องสงสัย"* และขยายด้วยตัวอย่าง:
     *"ผลิตได้งาน 100 มีต้องสงสัย 5 งานดีเหลือ 95 · หลังจากนั้นงานต้องสงสัยถูกซ่อมได้ 3 ไม่ได้ 2
       ต้องทิ้ง · งานดีที่จะได้จากกะนี้จริงๆ ก็จะเป็น 98 งานเสีย 2 **แต่ยอดผลิตที่ออกจากกะนี้ก็ยัง
       ควรนับว่าผลิตได้ 100 ชิ้น** แต่ดี 98 เสีย 2"*

   ⇒ กติกา 3 ข้อที่ได้ (ตรงกับสูตรสากล Nakajima/SEMI E79 เป๊ะ — ดูหัวไฟล์ §1):
     ① **ยอดผลิต = ยอดสแกน + NG + สงสัย + ซ่อม** = `Total Count` ตัวเดียวกับตัวเศษ %P
        (ของเสียที่ตัดสินแล้ว **ยังอยู่ใน** ยอดผลิต — ทิ้งแล้วก็ยังนับว่าเครื่องทำมันออกมา)
     ② **%Q = งานดี ÷ ยอดผลิต** (98 ÷ 100) **ไม่ใช่** ยอดสแกน ÷ (ยอดสแกน + ของเสีย) (95 ÷ 97)
     ③ **ยอดผลิตนิ่ง · งานดี/งานเสียขยับ** เมื่อ QA ตัดสินของสงสัย/ผลซ่อม

   🔴 ข้อ ② คือตัวที่ทำให้ *"ยอดดีของชิ้นที่ซ่อมเสร็จกลับไปที่กะต้นทาง"* เป็นจริง —
      ชิ้นที่ซ่อมได้อยู่ใน "ยอดผลิต" มาตั้งแต่ต้น ตอน QA เคลียร์ มันจึงเลื่อนไปเป็น **งานดี**
      ของกะต้นทางเองโดยไม่ต้องมีใบงานซ่อม/ยอดเด้งกลับ (สูตรเดิมไม่มีมันในตัวหาร = ไม่มีทางได้คืน)

   🔴 **งานทดลองออกทั้งคู่** — ฐานของ %Q ตัดงานทดลองออก (`qTotalCount`) ให้เข้าคู่กับ
      `sumDefectQty(…, 'line')` ที่ตัดงานทดลองอยู่แล้ว · ส่วน "ยอดผลิต" ที่โชว์บนจอ
      (`producedTotalCount`) **นับงานทดลองด้วย** เพราะเครื่องทำมันออกมาจริง
      ⇒ 2 ตัวนี้คนละคำถาม **ห้ามสลับ** (หลักเดียวกับ `defectQty`/`defectQtyAll`/`defectQtyForP`)   */

/** ชิ้นที่เครื่องทำออกมาแต่ไม่ใช่ของดี — รวมจาก "แถว defect_logs" */
export const sumDefectForP = (rows) => (rows || []).reduce((s, d) => s + defectQtyForP(d), 0);

/** …หรือจากผลของ `ngByMatFrom()` (จอสดส่ง `ngForP` มาแล้ว ไม่มีแถวดิบในมือ)
 *  🔴 ต้องบวก `noMat` ด้วย — ของเสียที่ชี้ MAT ไม่ได้ก็เป็นชิ้นที่เครื่องทำออกมา
 *     (เข้า %P ไม่ได้เพราะไม่รู้ CT แต่ "ยอดผลิต" ไม่ต้องใช้ CT) */
export const sumNgForP = (ngForP) =>
  Object.values(ngForP?.byMat || {}).reduce((s, v) => s + (Number(v) || 0), 0)
  + (Number(ngForP?.noMat) || 0);

/**
 * 🔴 **"ยอดผลิต" ของกะ/ใบ — ทุกชิ้นที่เครื่องทำออกมา** (§7.2.2 ข้อ ①)
 * @param {number} scannedOk  ยอดสแกน (`sessionProducedQty()` / `orderProducedQty()`)
 * @param {Array|Object} extra แถว `defect_logs` (array) **หรือ** ผลของ `ngByMatFrom()` (`{byMat,noMat}`)
 * @returns {number} เป็น **"ชิ้น"** — 🔴 ห้ามส่ง `scannedOk` ที่ยุบคู่ RH/LH มาปนกับของเสียรายชิ้น
 *          (จอที่โชว์หน่วย "คู่/shot" ต้องยุบของเสียด้วย `collapsePairShots` ให้เข้าหน่วยกันก่อน)
 */
export const producedTotalCount = (scannedOk, extra) =>
  (Number(scannedOk) || 0) + (Array.isArray(extra) ? sumDefectForP(extra) : sumNgForP(extra));

/** ฐาน (ตัวหาร) ของ **%Q** — เหมือน `producedTotalCount` แต่ **ตัดงานทดลองออก**
 *  ให้เข้าคู่กับ `sumDefectQty(rows,'line')` ที่เป็นตัวหักของ %Q (§7.2.2 ย่อหน้าสุดท้าย) */
export const defectQtyForQBase = (d) => (isTrialDefect(d) ? 0 : defectQtyForP(d));

export const qTotalCount = (scannedOk, rows = []) =>
  (Number(scannedOk) || 0) + (rows || []).reduce((s, d) => s + defectQtyForQBase(d), 0);

/**
 * 🔴🔴 **%Q = งานดี ÷ ยอดผลิต — สูตรเดียวทั้งระบบ**
 * ห้ามเขียน `produced / (produced + ng)` ที่ไหนอีก (เคยมี 3 สำเนา: `computeLiveOee` ·
 * `computeSessionOee` · `restampQPatch` ⇒ QA ตัดสินแล้วบางจอขยับบางจอไม่ขยับ · ด่าน `q-ratio-single-entry`)
 * @param {number} totalCount ยอดผลิต (`qTotalCount()`)
 * @param {number} scrapQty   ของเสียที่ตัดสินแล้ว (`sumDefectQty(rows,'line')`) — ของสงสัยที่รอ QA **ไม่เข้า**
 * @returns {number|null} 0..1 · `null` = ยอดผลิต 0 ⇒ **ตอบไม่ได้ ห้ามคืน 0** (กฎจอซื่อสัตย์)
 */
/**
 * 🔴 "ยอดผลิต" ของกะ **จากคอลัมน์ rollup ที่ stamp ไว้ตอนปิดกะ** — ใช้เมื่อ**ไม่มีแถว `defect_logs` ในมือ**
 * (รายงาน/ไฟล์ export ที่วนหลายร้อยกะ — ดึงแถวของเสียมาด้วยทุกกะ = egress บาน §11)
 *
 * ✅ ใช้ได้กับ "ยอดผลิต" เพราะ **ยอดผลิตไม่ขยับตอน QA ตัดสิน** (§7.2.2 ข้อ ③) ⇒ ค่าที่ stamp
 *    ตอนปิดกะยังจริงเสมอ · 🔴 **ห้ามเอาไปคิด %Q** — ตัวหักของ %Q ขยับตามผลพิจารณา
 *    ต้องยึด `defect_logs` เหมือนเดิม (กฎเดิม §7.1/§7.2)
 * 🔴 มีแถว `defect_logs` อยู่แล้ว = ใช้ `producedTotalCount(scanned, rows)` แม่นกว่า (rollup อาจ
 *    ไม่ได้ stamp ในกะที่ยังไม่ปิด)
 */
export const sessionTotalCount = (s) =>
  (Number(s?.actual_qty) || 0) + (Number(s?.qty_ng) || 0)
  + (Number(s?.qty_suspect) || 0) + (Number(s?.qty_repair) || 0);

export function qRatio(totalCount, scrapQty) {
  const tc = Number(totalCount) || 0;
  if (!(tc > 0)) return null;
  return Math.max(0, Math.min(1, (tc - (Number(scrapQty) || 0)) / tc));
}

/**
 * 🔴 **จำนวนชิ้นที่เครื่องทำออกมาจริง แยกตาม MAT — ไว้บวกเข้า "ตัวเศษ" ของ %P**
 * (2026-10-04 · คำสั่ง user: *"ต้องเข้าหมดเพราะใช้เครื่องลองผลิต"*)
 *
 * %P วัด **ความเร็ว** ไม่ใช่ความดี ⇒ ชิ้นที่ออกมาเสีย/ทดลอง/รอ QA ก็ **กินรอบเครื่องเท่ากับชิ้นดี**
 * ⇒ ต้องอยู่ในตัวเศษ ไม่งั้นของเสีย 1 ชิ้นถูกหัก 2 ครั้ง (ทั้ง %P และ %Q) = OEE ต่ำกว่าจริง
 * — ตรงกับสูตรสากล (Nakajima/SEMI E79): `P = CT × Total Count ÷ Run Time` · `Q = Good ÷ Total Count`
 *
 * ใช้ `defectQtyForP` (NG + สงสัย + ซ่อม ทุกใบ **ไม่สน** `is_trial`/`excl_from_q`/ผล QA) เพราะคำถามของ %P คือ
 * *"เครื่องเดินไปกี่รอบ"* ไม่ใช่ *"ใครผิด"* — ผลพลอยได้: **%P นิ่ง ไม่ขยับตอน QA ตัดสินของสงสัย**
 * (ต่างจาก %Q ที่ต้องขยับ — นั่นคือ `defectQty` · 🔴 ห้ามสลับ 2 ตัวนี้)
 *
 * @param {Array} defects  แถว defect_logs (ต้องมี `prod_order_id` หรือ embed `prod_orders(mat_no)`)
 * @param {Array} orders   ใบในกะ (ใช้ map `id → mat_no`)
 * @param {function} [qtyOf] วิธีนับต่อแถว — default `defectQtyForP` = NG + สงสัย + **ซ่อม** (ขา %P · §7.2.1)
 *                   ส่ง `defectQty` เมื่อต้องการขา **%Q** (ของสงสัยที่ QA ยังไม่ตัดสินไม่นับ)
 *                   🔴 มีตัวแยกราย MAT **ชุดเดียว** — ห้ามเขียนลูปแยกของเสียราย MAT ที่อื่นอีก
 * @returns {{ byMat: Object<string,number>, noMat: number }}
 *          `noMat` = ของเสียที่**ชี้ MAT ไม่ได้** (ไม่ผูกใบ) ⇒ ไม่รู้ CT ⇒ บวกเข้า %P ไม่ได้
 *          🔴 ห้ามเกลี่ยมั่วลง MAT อื่น — คืนตัวเลขออกไปให้จอเขียนบอกแทน
 */
export function ngByMatFrom(defects = [], orders = [], qtyOf = defectQtyForP) {
  const matOf = new Map();
  (orders || []).forEach(o => { if (o?.id != null) matOf.set(o.id, o.mat_no ?? null); });
  const byMat = {};
  let noMat = 0;
  (defects || []).forEach(d => {
    const q = qtyOf(d);
    if (!(q > 0)) return;
    const mat = d?.prod_orders?.mat_no ?? (d?.prod_order_id != null ? matOf.get(d.prod_order_id) : null);
    if (mat == null) { noMat += q; return; }          // ชี้ MAT ไม่ได้ = ไม่รู้ CT (ห้ามเดา)
    byMat[mat] = (byMat[mat] || 0) + q;
  });
  return { byMat, noMat };
}

/** จำนวนชิ้นที่ยังรอ QA ในแถวนี้ (0 เมื่อไม่มี/ตัดสินแล้ว/ตอบไม่ได้)
 *  รวม NG ที่อยู่ในถังเหลืองรอพิจารณาด้วย (§7.2) — ชื่อเดิมคงไว้ เพราะทุกจอเรียกตัวนี้เขียน "รอพิจารณา N ชิ้น" */
export const suspectPendingQty = (d) => {
  const cov = binCoveredSplit(d);
  if (cov) return cov.pending;
  return suspectState(d) === 'pending' ? (Number(d?.qty_suspect) || 0) : 0;
};

/** รวมจำนวนของเสีย
 *  mode 'line' (ดีฟอลต์) = ไม่รวมงานทดลอง → ใช้คิด %Q / OEE
 *  mode 'all'            = รวมทุกอย่าง     → ใช้คิดมูลค่าของเสียทั้งหมด */
export const sumDefectQty = (rows, mode = 'line') =>
  (rows || []).reduce((s, d) => s + ((mode === 'all' || !isTrialDefect(d)) ? defectQty(d) : 0), 0);

/**
 * แยกยอดในรอบเดียว — คืน { all, line, trial, pending, unknown }
 *   pending = ของสงสัยที่ยังรอ QA (ไม่อยู่ใน all/line/trial — ยังไม่รู้ว่าเป็นของเสียไหม)
 *   unknown = true เมื่อมีแถวที่คิวรีไม่ได้ embed ทะเบียนถังมา ⇒ จอห้ามอ้างว่า "สรุปแล้ว"
 * 🔴 จอที่โชว์ %Q ต้องอ่าน `pending`/`unknown` แล้วเขียนบนจอ ห้ามกลืน
 */
export function splitDefectQty(rows) {
  let all = 0, trial = 0, pending = 0, unknown = false;
  (rows || []).forEach(d => {
    const q = defectQty(d);
    all += q;
    if (isTrialDefect(d)) trial += q;
    pending += suspectPendingQty(d);
    if (suspectState(d) === 'unknown') unknown = true;
  });
  return { all, line: all - trial, trial, pending, unknown };
}

/** ของสงสัยที่ยังรอ QA รวมทั้งชุด — จอเอาไปเขียน "รอพิจารณา N ชิ้น · %Q ยังไม่สรุป" */
export const sumSuspectPending = (rows) =>
  (rows || []).reduce((s, d) => s + suspectPendingQty(d), 0);

/* ═══ 7.3) 🔴🔴 กฎเหล็กข้าม session — PPM ของเสียภายใน มีสูตรที่นี่ที่เดียว (2026-11-16) ═══
   ที่มา: feedback ประชุม 16/11 (นาย ณัฐวุฒิ ทรงดอน) *"แก้ PPM ไลน์ปั๊มที่มีการเทส
   แล้วทำให้ PPM กระโดดไปเกิน 100 สูงผิดปกติ"* (เป้า PPM ในทะเบียน = 50 / 75 / 300)

   เดิมสูตรนี้ถูกเขียนมือ **5 ที่** (QualityControl · DeptDashboard · KpiMonthly ·
   obeyaYear · monthlyReviewPptx) แล้ว drift กันจริง 2 คลาส — ทั้งคู่ดัน PPM **ขึ้น**:

     (1) **ตัวเศษกับตัวหารคนละฐาน (งานทดลอง)** — `/dept-dashboard` แท็บ QA บวก
         `qty_ng + qty_suspect` ดิบ (ไม่ดู `is_trial`/`excl_from_q`/ผลพิจารณาถัง)
         แล้วหารด้วยยอดผลิตของไลน์ ⇒ ของเสียจากการลองแม่พิมพ์ไปโทษไลน์ผลิต
         วัดฐานจริง 16/11: Laser GOR 145 → 1,432 PPM (9.9×) · Laser LWR 347 → 2,358 (6.8×) ·
         LINE A (800 Ton) 0 → 22 (ของเสียทุกชิ้นของไลน์นี้เป็นงานทดลอง) ·
         รายกะ LINE A 03/10 (ผลิต 1,800 · ทดลองเสีย 3) = 1,664 PPM ทั้งที่ของจริง 0

     (2) **ตัวหารเป็น "shot" แต่ตัวเศษเป็น "ชิ้น"** — เด็ค Monthly Review เอา `output`
         ที่ผ่าน `pairAwareTotal`/`collapseOps` (ยุบงานคู่ RH/LH เป็น 1 stroke) มาเป็นตัวหาร
         ⇒ ไลน์แม่พิมพ์คู่ (ปั๊ม/เลเซอร์) ตัวหารหายไปเกือบครึ่ง · วัดฐานจริง 16/11:
         HDF1 1,941 → 3,503 · LASER-345 1,900 → 3,410 · HDF2 1,043 → 1,858 ·
         LASER-789 1,126 → 1,856 · LINE B (600 Ton) 21 → 32  (1.5–1.8 เท่า)

   🔴 กติกาที่ห้ามพลาด (ต่อจากกฎ "ชิ้น ≠ shot" ใน CLAUDE.md §OEE):
     · PPM = **1 − %Q** ⇒ ตัวเศษ/ตัวหาร**ต้องฐานเดียวกันเสมอ** (งานทดลองออกทั้งคู่ · นับ "ชิ้น" ทั้งคู่)
     · ตัวหาร = **ยอดผลิตจริงเป็นชิ้น** (สแกนดี + ของเสีย) — **ห้ามใช้ยอดที่ยุบคู่/ยุบขั้น (OP)**
     · ยอดผลิตยังไม่ถูกบันทึก (`goodQty <= 0`) = **ตอบไม่ได้ ⇒ `null`** ห้ามคืน 0 และห้ามคืน 1,000,000
     · PPM = ชิ้นต่อล้าน ⇒ **จำนวนเต็มเสมอ** (ทศนิยมไม่มีความหมาย · feedback 16/11)
   🔴 **ห้ามเขียน `… / … * 1e6` เองในหน้าอีก** (มีด่าน `ppm-single-entry` + `ppm-base-not-pair-collapsed`) */

/** ตอบได้ไหมว่าแถวนี้เป็น "งานทดลอง" — `'trial'` | `'line'` | `'unknown'`
 *  `'unknown'` = คิวรีไม่ได้ embed `dr_defect_types(excl_from_q)` มา ⇒ **ตอบไม่ได้ ห้ามเดา**
 *  (คงพฤติกรรมเดิมไว้: นับเข้าตัวเศษ แต่ `ppmFromDefects` คืน `unsureQty` ให้จอเขียนบอก) */
export function trialState(d) {
  if (!d || typeof d !== 'object') return 'unknown';
  if (d.is_trial === true) return 'trial';
  if (d.excl_from_q !== undefined) return d.excl_from_q === true ? 'trial' : 'line';   // แถว rollup/แบน
  if ('dr_defect_types' in d) {
    const t = d.dr_defect_types;
    if (t == null) return 'line';                                 // ไม่มีประเภทผูกไว้ = ตอบได้ว่าไม่ใช่
    if ('excl_from_q' in t) return t.excl_from_q === true ? 'trial' : 'line';
  }
  return 'unknown';                                               // ไม่ได้ขอทะเบียนประเภทมา = ตอบไม่ได้
}

/**
 * PPM จาก "ตัวเลขสองตัวที่ฐานเดียวกันแล้ว" — จุดเดียวที่คูณ 1e6 ได้ในระบบ
 * @param {number} ngQty    ของเสีย line-mode เป็น **ชิ้น** (ไม่รวมงานทดลอง)
 * @param {number} goodQty  ยอดสแกน (ของดีล้วน) เป็น **ชิ้น** — ห้ามส่งยอดที่ยุบคู่/ยุบขั้น
 * @returns {number|null} จำนวนเต็ม · `null` เมื่อยังไม่มียอดผลิต (ตอบไม่ได้ — ห้ามเป็น 0)
 */
export function ppmOf(ngQty, goodQty) {
  const ng = Number(ngQty) || 0;
  const good = Number(goodQty) || 0;
  if (!(good > 0)) return null;        // ผลิต 0 แต่มีของเสีย ≠ "เสียล้านชิ้นในล้าน" (UX audit 05/10)
  return Math.round((ng / (good + ng)) * 1e6);
}

/**
 * PPM จากแถว `defect_logs` ดิบ — กรองงานทดลอง/ของสงสัยให้ตามกฎ §7.1/§7.2 ในตัว
 * @param {Array}  rows     แถว defect_logs (ควร embed `dr_defect_types(excl_from_q)` + `QBIN_EMBED`)
 * @param {number} goodQty  ยอดสแกน (ของดีล้วน) เป็นชิ้น
 * @returns {{ppm:number|null, ngQty:number, goodQty:number, baseQty:number, trialQty:number, pendingQty:number, unsureQty:number}}
 *   `trialQty`  = ของเสียงานทดลอง (กันออกจาก PPM แล้ว — จอควรเขียนแยกว่ามีกี่ชิ้น ห้ามหายเงียบ)
 *   `pendingQty`= ของสงสัย/NG ในถังเหลืองที่ QA ยังไม่ตัดสิน (ยังไม่เข้า PPM ⇒ PPM เป็นค่าชั่วคราว)
 *   `unsureQty` = ของเสียที่ **แยกไม่ออกว่าเป็นงานทดลองหรืองานผลิต** (คิวรีไม่ได้ embed ทะเบียนประเภท)
 *                 🔴 นับเข้าตัวเศษไว้ตามพฤติกรรมเดิม แต่ **จอต้องเขียนบอกว่ามีกี่ชิ้น**
 */
export function ppmFromDefects(rows, goodQty) {
  let ng = 0, trial = 0, pending = 0, unsure = 0;
  (rows || []).forEach((d) => {
    const q = defectQty(d);
    pending += suspectPendingQty(d);
    const st = trialState(d);
    if (st === 'trial') { trial += q; return; }
    if (st === 'unknown') unsure += q;    // ตอบไม่ได้ = คงพฤติกรรมเดิม (เข้าตัวเศษ) + ชูธง
    ng += q;
  });
  const good = Number(goodQty) || 0;
  return {
    ppm: ppmOf(ng, good), ngQty: ng, goodQty: good,
    baseQty: good > 0 ? good + ng : 0, trialQty: trial, pendingQty: pending, unsureQty: unsure,
  };
}

/** ข้อความ PPM บนจอ — จำนวนเต็มเสมอ · `null` = ขีด (ห้ามเป็น 0) */
export const fmtPpm = (v, dash = '—') =>
  (v == null || !Number.isFinite(Number(v)) ? dash : Math.round(Number(v)).toLocaleString());

/* ═══ เป้า A/P/Q และค่าเฉลี่ยข้ามเดือน/ไตรมาส (2026-09-08 · เด็ค Monthly Review โหมด full data) ═══
   อยู่ในไฟล์นี้เพราะเป็น "สูตร OEE" — กฎโปรเจค: util OEE มีไฟล์เดียว ห้ามแตกเพิ่ม */

/** เป้ามาตรฐานเมื่อกลุ่มนั้นยังไม่ได้ตั้งค่า (A 90 × P 90 × Q 99 → OEE 80.2) */
export const DEFAULT_OEE_TARGET = { a: 90, p: 90, q: 99 };

/** เป้า OEE = A × P × Q เสมอ — **ห้ามอ่าน `oee_targets.target_oee`** (คอลัมน์ vestigial) */
export const targetOeeOf = (t = {}) => {
  const a = t.a ?? DEFAULT_OEE_TARGET.a, p = t.p ?? DEFAULT_OEE_TARGET.p, q = t.q ?? DEFAULT_OEE_TARGET.q;
  return Math.round(((a / 100) * (p / 100) * (q / 100) * 100) * 10) / 10;
};

/**
 * แถว `oee_targets` (หรือ null) → { a, p, q, oee, isDefault, missing }
 * - `isDefault` = ไม่มีแถวเลย (ยังไม่เคยตั้งเป้ากลุ่มนี้)
 * - `missing`   = ชื่อช่องที่ **มีแถวแต่เว้นว่างไว้** แล้วถูกแทนด้วยค่ามาตรฐาน (เช่น ['p'])
 *   ⚠️ ต้องมีเพราะของจริงมีหลายกลุ่มตั้งแค่ A กับ Q ปล่อย P ว่าง — ถ้าไม่บอก คนอ่านจะเข้าใจว่า
 *      P 90% เป็นเป้าที่ทีมตั้งเอง ทั้งที่เป็นค่าที่ระบบเติมให้ (ห้ามล้มเหลว/เติมค่าแบบเงียบ)
 */
export function normOeeTarget(row) {
  const isBlank = (v) => v == null || v === '' || Number.isNaN(Number(v));
  const pick = (v, d) => (isBlank(v) ? d : Number(v));
  const t = {
    a: pick(row?.target_a, DEFAULT_OEE_TARGET.a),
    p: pick(row?.target_p, DEFAULT_OEE_TARGET.p),
    q: pick(row?.target_q, DEFAULT_OEE_TARGET.q),
  };
  const missing = row
    ? ['a', 'p', 'q'].filter(k => isBlank(row[`target_${k}`]))
    : [];
  return { ...t, oee: targetOeeOf(t), isDefault: !row, missing };
}

/**
 * เป้ารวมของ "หลายกลุ่มไลน์" (section / ทั้ง scope) — **ไม่เก็บใน DB คำนวณสดเสมอ**
 * rows = แถวดิบ `oee_targets` ของแต่ละกลุ่ม (ใส่ `null`/`undefined` ได้สำหรับกลุ่มที่ยังไม่ตั้งเป้า)
 *
 * ⚠️ กติกา 2 ข้อที่พลาดกันบ่อย (ต้นฉบับ: `targetOf` ใน OEEAnalytics — ย้ายมาที่นี่ 2026-09-10
 *    เพื่อให้จอ OEE กับเด็ค .pptx ใช้เลขชุดเดียวกัน · util OEE มีไฟล์เดียว ห้ามแตกเพิ่ม):
 *  1. **A/P/Q เฉลี่ยเฉพาะกลุ่มที่ "ตั้งค่านั้นไว้จริง"** — กลุ่มที่เว้นว่างไม่ถูกนับเข้าค่าเฉลี่ย
 *     (ไม่งั้นค่ามาตรฐาน 90 จะดึงค่าเฉลี่ยของทีมที่ตั้งเป้าสูงกว่าลงมา)
 *  2. **OEE = เฉลี่ยของ (A×P×Q ต่อกลุ่ม)** ไม่ใช่ `a*p*q` ของค่าเฉลี่ย — ต่างกันจริงเมื่อกลุ่มตั้งเป้าไม่ครบ
 *     ⇒ `out.oee !== targetOeeOf(out)` เป็นเรื่องปกติ **ห้าม "แก้" ให้เท่ากัน**
 *
 * คืน { a, p, q, oee, configured, missing }
 *  · `configured` = มีอย่างน้อย 1 กลุ่มที่ตั้งเป้าไว้ (false = ใช้ค่ามาตรฐานล้วน — จอต้องบอกผู้อ่าน)
 *  · `missing`    = ช่องที่ **ไม่มีกลุ่มไหนตั้งเลย** จึงใช้ค่ามาตรฐาน (เช่น ['p'])
 */
export function avgOeeTarget(rows = []) {
  const isBlank = (v) => v == null || v === '' || Number.isNaN(Number(v));
  const effs = (rows.length ? rows : [null]).map(r => ({
    a: isBlank(r?.target_a) ? null : Number(r.target_a),
    p: isBlank(r?.target_p) ? null : Number(r.target_p),
    q: isBlank(r?.target_q) ? null : Number(r.target_q),
  }));
  const out = { configured: effs.some(e => e.a != null || e.p != null || e.q != null), missing: [] };
  for (const k of ['a', 'p', 'q']) {
    const vals = effs.map(e => e[k]).filter(v => v != null);
    if (vals.length) out[k] = Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
    else { out[k] = DEFAULT_OEE_TARGET[k]; out.missing.push(k); }
  }
  // ⚠️ ห้ามปัดเศษ OEE ของแต่ละกลุ่มก่อนเฉลี่ย (อย่าเรียก targetOeeOf ตรงนี้) — ปัดครั้งเดียวตอนท้าย
  //    เคยต่างกัน 0.1 จุดกับเลขบนจอ /oee-analytics ตอนย้ายสูตรมาที่นี่ (2026-09-10)
  const D = DEFAULT_OEE_TARGET;
  const oees = effs.map(e => ((e.a ?? D.a) * (e.p ?? D.p) * (e.q ?? D.q)) / 10000);
  out.oee = Math.round((oees.reduce((s, v) => s + v, 0) / oees.length) * 10) / 10;
  return out;
}

/**
 * เป้า OEE ของ "ชุดไลน์" — กติกาเดียวกับห้อง OBEYA (QC audit 05/10 · เดิม FactoryMap/GroupOverview/DeptDashboard
 * ตัดสีด้วยเลขตายตัว 80/65 ขณะที่ Obeya ใช้เป้ากลุ่ม ⇒ ไลน์เดียวกันเขียวจอหนึ่ง แดงอีกจอ)
 *  · กลุ่มของไลน์ = `parent_line_name || name` (oee_targets ตั้งที่ระดับกลุ่ม/ไลน์แม่)
 *  · `targetsByGroup` = { [group_name]: แถว oee_targets } · **null = ยังไม่รู้เป้า (โหลดไม่ได้/ยังไม่โหลด) ⇒ คืน null**
 *    (ผู้เรียกต้องวาดเป็น "ตัดสินไม่ได้" — ห้ามถอยไปเลขตายตัว) · กลุ่มที่ไม่ตั้ง = ค่ามาตรฐาน 90×90×99 ตาม avgOeeTarget
 * คืนผลของ avgOeeTarget ({ a, p, q, oee, configured, missing }) หรือ null
 */
export function oeeTargetForLines(names = [], lines = [], targetsByGroup = null) {
  if (!targetsByGroup) return null;
  const byName = new Map((lines || []).map(l => [l.name, l]));
  const groups = [...new Set((names || []).filter(Boolean).map(n => byName.get(n)?.parent_line_name || n))];
  return avgOeeTarget(groups.map(g => targetsByGroup[g] || null));
}

/**
 * เฉลี่ย OEE ข้ามหลายเดือน (ไตรมาส/ทั้งปี) — **ถ่วงน้ำหนักด้วยเวลารับภาระ ห้าม mean-of-percentages**
 * rows = [{ oee, loadHr, nSess }] · ข้ามเดือนที่ไม่มีกะปิด (nSess = 0) และเดือนที่ OEE เป็น null
 * ไม่มีน้ำหนักเลย (loadHr หายทุกแถว) → ถอยไปเฉลี่ยธรรมดา ดีกว่าคืน null ทั้งที่มีข้อมูล
 * คืน null เมื่อไม่มีเดือนที่ใช้ได้เลย (= "ไม่มีข้อมูล" ไม่ใช่ 0)
 */
export function weightedOeeOf(rows, filterFn = null) {
  const ms = (rows || []).filter(r => r && (r.nSess ?? 1) > 0 && r.oee != null && (!filterFn || filterFn(r)));
  if (!ms.length) return null;
  const w = ms.reduce((a, r) => a + (Number(r.loadHr) || 0), 0);
  const v = w > 0
    ? ms.reduce((a, r) => a + Number(r.oee) * (Number(r.loadHr) || 0), 0) / w
    : ms.reduce((a, r) => a + Number(r.oee), 0) / ms.length;
  return Math.round(v * 10) / 10;
}

/**
 * สัปดาห์ที่เท่าไหร่ของเดือน (1-4) จาก work_date 'YYYY-MM-DD'
 * W1 = วันที่ 1-7 · W2 = 8-14 · W3 = 15-21 · **W4 = 22 ถึงสิ้นเดือน** (กลืนวันที่ 29-31 เข้า W4)
 *
 * ⚠️ ที่มา (2026-09-09 · user ทักว่า "เค้าแตก week 1 2 3 4 ในเดือนนั้น ไม่ใช่ quarter"):
 *    เด็คที่วิศวกรทำมือใช้ป้าย "Q1..Q4" แต่**ไม่ใช่ไตรมาสปฏิทิน** — พิสูจน์จากไฟล์จริง
 *    (Apron 060/061 ส.ค. 2026): แท่งที่ 5 "OEE" = ค่าของ **เดือนรายงาน** ตรงเป๊ะทั้ง 2 ไลน์
 *    และถ้าเป็นไตรมาสปฏิทิน Q2 ต้อง = 0.7815/0.7814 แต่ในไฟล์เป็น 0.8137/0.8089 → ไม่ตรง
 *    ⇒ เป็นการ "ซอยเดือนนั้นออกเป็น 4 ช่วง" · ห้ามกลับไปใช้ไตรมาสปฏิทินอีก
 */
export const weekOfMonth = (workDate) => {
  const d = Number(String(workDate).slice(8, 10));
  if (!d) return null;
  return Math.min(4, Math.ceil(d / 7));
};

/* ═══ 7) จับกลุ่ม "ชิ้นงานเดียวกัน" — ใช้ตรวจ parallel ใน computeOEE ═══════════════════════
   🔁 ตัวสูตรย้ายไป `src/utils/partGroup.js` แล้ว (05/10) เพราะชั้น OP ใน `pairTotals.js`
   ต้องตัดสิน "สินค้าตัวเดียวกัน" ด้วยกฎเดียวกัน และ `oee.js` import `pairTotals.js` อยู่แล้ว
   (ให้ pairTotals ดึง oee กลับ = import วงกลม)
   ⚠️ ห้ามก๊อปสูตรกลับมาไว้ที่นี่ — re-export ไว้ให้ที่เรียกเดิมใช้ `from '../utils/oee'` ได้เหมือนเดิม
   ⚠️ ห้ามใช้ `family_id` เป็นคีย์ (เหตุผล + ตัวเลขวัดจริง 09/09 เขียนไว้ในหัว partGroup.js) */
export { partCoreOf, groupSameProductKeys } from './partGroup.js';
/* `export … from` ไม่ได้ผูกชื่อเข้าสโคปไฟล์นี้ — `computeOEE` เรียก `groupSameProductKeys`
   เองด้วย ⇒ ต้อง import คู่กันเสมอ (ลืม = `no-undef` ที่ด่าน lint:critical จับได้) */
import { groupSameProductKeys } from './partGroup.js';


/* ═══ 7) 🔴 กรอบเวลาของกะ — ช่วงเวลาของพาร์ทต้องอยู่ในกะเสมอ (2026-09-17 · user จับได้) ═══
   ใบผลิตถูก "ยืนยันย้อนหลัง" ได้ (หัวหน้ามาปิดการ์ดเช้าวันรุ่งขึ้น / SV อนุมัติทีหลัง)
   ⇒ `confirmed_at` / `stopped_at` ของใบ ตกนอกเวลาเปิด-ปิดกะของตัวเองได้จริง
   วัดจริง 17/09 (ฐาน DR · กะที่ปิดแล้ว): **251 ใบ ใน 64 กะ มีเวลาปิดหลังกะจบ เฉลี่ยเกิน 715 นาที
   (~12 ชม.) สูงสุด 13,314 นาที (9.2 วัน)**

   เอาเวลานั้นไปสร้าง "ช่วงที่พาร์ทวิ่ง" ตรงๆ ⇒ ฐานเวลาของพาร์ทยาวเกินจริงหลายเท่า:
     เคสจริง Assy LWR 15/09 กะเช้า — MAT 10105769 มีใบหนึ่ง confirmed_at = 08:30 ของ *วันถัดไป*
     ⇒ window 08:00→08:30+1d = 24.5 ชม. ⇒ "ควรได้" 1,278 ชิ้นในกะเดียว (จอโชว์ช่วงเป็น "08:00–08:30"
     เพราะตัดเหลือ HH:MM เลยดูเหมือนครึ่งชั่วโมง) ⇒ %P รายชิ้นเหลือ 6% ทั้งที่งานตัวเดียวกัน
     คนละลูกค้า (10105770) ได้ 70%

   ⇒ **ทุกจุดที่ประกอบ "ช่วงเวลาที่ MAT.NO วิ่ง" ต้องรัดด้วย `clampWinToShift()` เสมอ**
      (ทั้ง %A แยกตาม MAT · ตัวหาร %P · "ควรได้" บนจอ) — พาร์ทวิ่งนอกกะของตัวเองไม่ได้
   ⚠️ ห้ามแก้ด้วยการทิ้งใบที่เวลาเกินไปเฉยๆ — ยอดผลิตของใบนั้นเป็นของกะนี้จริง หายไม่ได้ */

/**
 * วันปฏิทินของ "เวลาเริ่มกะ" — กะดึกที่บันทึกเวลาเริ่มเป็น 00:00–07:59 คือ **เช้าของวันถัดไป**
 *
 * 🔴 ของกลางของกฎนี้ (QC 06/10) — เดิม `computeLiveOee` บวก 1 วันให้ แต่ `shiftFrameOf` **ไม่บวก**
 *    ⇒ กะดึกที่เริ่ม 02:00 ได้กรอบกะ **เร็วไป 20 ชั่วโมง** ⇒ `clampWinToShift()` รัดช่วงของพาร์ท/
 *      downtime ทิ้งทั้งหมดเพราะ "อยู่นอกกรอบ" ⇒ **%A หาย downtime · "ควรได้" เพี้ยน** แบบเงียบ
 *    วัดฐานจริง 06/10: มี **5 กะ** (23/09–05/10) ที่ `shift='night'` + `start_time` 00:00–07:59
 *    ⇒ ไม่ใช่เคสทฤษฎี และยังเกิดเพิ่มเรื่อยๆ
 *    ⚠️ กะดึกเข้างานปกติ 22:30 ไม่เข้าเงื่อนไขนี้ — ห้ามเลื่อนวัน
 *
 * 🧭 **ทำไมที่นี่ดูเลขชั่วโมงได้ ทั้งที่ด่าน `shift-midnight-hardcoded-hour` ห้าม**
 *    ด่านนั้นห้าม "เดาวันของ **เวลาที่คนกรอก**" (เช่น เวลาปิด 5ส. ท้ายกะ) เพราะกะดึกที่จบ 08:00+
 *    จะหลุดเงื่อนไข `< 8` แล้วถูกตรึงผิดวัน — ตัวนั้นต้องใช้ `resolveShiftTime()` ซึ่งเทียบกับ**กรอบกะ**
 *    แต่ฟังก์ชันนี้คือ **ตัวสร้างกรอบกะเอง** จะไปเทียบกับกรอบกะไม่ได้ (วนลูป)
 *    ⇒ ที่นี่เทียบกับ **ขอบวันทำงาน** `WORK_DAY_START_HOUR` (เจ้าของกฎ "ก่อน 08:00 = วันก่อนหน้า"
 *       ใน `workDate.js`) ไม่ใช่เลข 8 ดิบ — ขยับขอบวันทำงานวันหลัง ที่นี่ตามไปเอง
 * @returns `'YYYY-MM-DD'` ของวันที่เวลาเริ่มกะอยู่จริง
 */
export function shiftStartDate(workDate, startHm, shift) {
  const h = Number(String(startHm || '').slice(0, 2));
  if (shift !== 'night' || !(h >= 0 && h < WORK_DAY_START_HOUR)) return workDate;
  const d = new Date(`${workDate}T12:00:00`);            // เที่ยงวัน = ไม่โดน DST/ขอบวัน
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** กรอบเวลาของกะเป็น ms — คืน null ถ้าข้อมูลเวลาไม่พอ · กะดึกข้ามวันบวก 1 วันให้เอง
 *  overrides: เวลาที่หัวหน้าแก้ในฟอร์มปิดกะ (มาก่อนค่าที่เก็บไว้ใน session) */
export function shiftFrameOf(session, { startTime = null, endTime = null } = {}) {
  const wd = session?.work_date;
  const st = startTime || session?.start_time;
  const et = endTime   || session?.end_time;
  if (!wd || !st) return null;
  // 🔴 วันของเวลาเริ่มกะต้องใช้กฎเดียวกับ computeLiveOee — ดู shiftStartDate() ข้างบน
  const startDate = shiftStartDate(wd, String(st).slice(0, 5), session?.shift);
  const startMs = new Date(`${startDate}T${String(st).slice(0, 5)}:00`).getTime();
  if (!Number.isFinite(startMs)) return null;
  if (!et) return { startMs, endMs: null };
  let endMs = new Date(`${startDate}T${String(et).slice(0, 5)}:00`).getTime();
  if (!Number.isFinite(endMs)) return { startMs, endMs: null };
  if (endMs <= startMs) endMs += 86400000;   // กะดึกข้ามเที่ยงคืน
  return { startMs, endMs };
}

/** รัด [startMs, endMs] ให้อยู่ในกรอบกะ — คืน { startMs: null, endMs: null } เมื่อไม่เหลือช่วง
 *  frame = null (ไม่รู้เวลากะ) → คืนค่าเดิม ไม่รัด */
export function clampWinToShift(startMs, endMs, frame) {
  if (!frame) return { startMs, endMs };
  const lo = frame.startMs, hi = frame.endMs;
  let s = startMs, e = endMs;
  if (s != null && lo != null) s = Math.max(s, lo);
  if (s != null && hi != null) s = Math.min(s, hi);
  if (e != null && lo != null) e = Math.max(e, lo);
  if (e != null && hi != null) e = Math.min(e, hi);
  if (s != null && e != null && e <= s) return { startMs: null, endMs: null };
  return { startMs: s, endMs: e };
}

/** นาที downtime ของ 1 แถวที่ **อยู่ในกรอบกะ แต่ตกนอกทุกช่วงใน `coveredIv`**
 *  ใช้จับ "เครื่องเสียตอนที่ไม่มีพาร์ทไหนวิ่ง" ซึ่ง %A แบบแยกตาม MAT.NO มองไม่เห็น (บั๊ก 2026-09-17)
 *    coveredIv = union ของ (ช่วงที่พาร์ทวิ่ง) ∪ (ช่วงพักตามนโยบาย) — ผ่าน `unionIv()`
 *    ต้องรวมช่วงพักด้วยเสมอ ไม่งั้นนาทีที่ทับพักถูกหักซ้ำ (กฎเหล็ก §3.1)
 *  แถวที่ไม่มี `started_at` คืน 0 — ตะกร้า untimed มีตัวรับแยกอยู่แล้ว (นับ 2 รอบไม่ได้) */
export function dtMinOutsideWork(d, coveredIv = [], frame = null) {
  if (!d?.started_at || !frame) return 0;
  const raw = Number(d.duration_min) || 0;
  if (!(raw > 0)) return 0;
  const s0 = new Date(d.started_at).getTime();
  const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + raw * 60000;
  const a = Math.max(s0, frame.startMs), b = Math.min(e0, frame.endMs);
  if (!(b > a)) return 0;                       // นอกกรอบกะ = ไม่ใช่เรื่องของกะนี้
  return Math.max(0, (b - a) / 60000 - overlapMinutesWith(a, b, coveredIv));
}

/* ══ §8 computeSessionOee — A/P/Q/OEE ของ "กะหนึ่งกะ" (ตัวที่ stamp ลงฐานตอนปิดกะ) ══════
   ย้ายออกมาจาก `DailyReport.computeOEE` (closure ในคอมโพเนนต์ 4,000 บรรทัด) เมื่อ 2026-09-24

   **ทำไมต้องย้าย** — กฎโปรเจคเขียนไว้ตั้งแต่ต้นว่า `src/utils/oee.js` = single source of truth
   ของสูตร OEE แต่ "ตัวประกอบร่าง" ของสายปิดกะกลับอยู่ในหน้า ⇒ เรียกจากที่อื่นไม่ได้เลย
   ผลที่ตามมาจริง (24/09): ต้องแก้ `start_time` ของ 10 กะที่ปิดไปแล้วแล้วคำนวณ OEE ใหม่
   — ทำไม่ได้เลยนอกจากให้คนเปิดหน้าจอกดเองทีละกะ หรือ **เขียนสูตรซ้ำใน SQL ซึ่งผิดกฎ**
   (มี OEE 2 ชุด = เถียงกันว่าเชื่อจอไหน)

   🔴 ฟังก์ชันนี้คือสูตรเดียวกับตอนปิดกะ — `DailyReport.computeOEE` เป็นเปลือกบางๆ ที่ส่ง state เข้ามา
      **แก้สูตรที่นี่ที่เดียว ห้ามแก้ในหน้า** · สายสด (ยังไม่ปิดกะ) ยังเป็น `computeLiveOee` เหมือนเดิม
      (คนละฐานเวลา: สด = "ถึงตอนนี้" · ปิดกะ = "เวลาเปิด→ปิดที่กรอก") ห้ามเอามารวมกัน

   ⚠️ พารามิเตอร์กลุ่ม `carry*`/`matTimeOverride` = state ชั่วคราวบนฟอร์มปิดกะ
      **กะที่ปิดไปแล้วส่งว่างเสมอ** (ใบกลายเป็น carry_over/imported แล้ว ค่าอยู่ที่ `qty_actual`)
      — นี่คือเหตุผลที่คำนวณกะเก่าย้อนหลังได้จากข้อมูลในฐานล้วนๆ
   ══════════════════════════════════════════════════════════════════════════════════════ */

/** @returns {{A,P,Q,oee,shiftMin,...}} — ค่าเดียวกับที่ `handleCloseSession` เอาไป stamp */
export function computeSessionOee({
  session,
  orders = [],
  downtimes = [],
  defects = [],
  ngQty: ngQtyOverride = null,
  products = [],
  kanbanStds = [],
  breakPolicies = [],
  processType = null,
  lineRules = null,
  lineFlow = {},
  machineCount = 0,
  /* 🔀 แมป "เครื่องไหนครอบกี่เลน" จาก `affectsLanesMap(machines)` — ไม่ส่ง = ทุกเครื่องครอบ 1 เลน (เดิม) */
  affectsLanes = null,
  startTime = null,
  endTime = null,
  carryQtyActual = {},
  carryOverDecisions = {},
  carryStopTime = {},
  matTimeOverride = {},
}) {
  const dtl = downtimes;
  const workDate = session?.work_date;
  // ยอดผลิตของกะ = สูตรกลาง §6.0.1 (ห้ามวน reduce เอง — เคยเป็นสำเนาที่ 2 ของกฎเดียวกัน)
  const totalProduced = sessionProducedQty(orders, carryQtyActual);
  const ngQty = ngQtyOverride !== null && ngQtyOverride !== undefined
    ? ngQtyOverride : sumDefectQty(defects, 'line');

  const startTimeStr = startTime || session?.start_time;
  /* 🔴 วันของ "เวลาเริ่มกะ" ต้องผ่าน `shiftStartDate()` — กะดึกที่บันทึกเวลาเริ่ม 00:00-07:59
     คือ **เช้าของวันถัดไป** (QC 08/10 · เดิมที่นี่ต่อ `work_date + start_time` ตรงๆ = **สำเนาที่ 3**
     ของกฎเดียวกัน ที่รอบแก้ 06/10 ไปแก้แค่ `shiftFrameOf` กับ `computeLiveOee`)
     ⇒ กรอบกะเร็วไป 20 ชม. แล้วไปโดน `clampWinToShift` (ช่วงของ MAT) + `dtMinOutsideWork`
       ⇒ **%A และ %P ที่ stamp ตอนปิดกะเพี้ยนเงียบ** · `shift_min` ไม่โดน (เป็นผลต่าง หักกลบกันเอง)
     ⚠️ กะดึกเข้างานปกติ 22:30 ไม่เข้าเงื่อนไข — ค่าเดิมทุกกะไม่เปลี่ยน (มีเทสคุม) */
  const openedDate = (workDate && startTimeStr)
    ? shiftStartDate(workDate, startTimeStr.slice(0, 5), session?.shift) : workDate;
  const openedAt = (openedDate && startTimeStr) ? new Date(`${openedDate}T${startTimeStr.slice(0, 5)}:00`) : null;
  let closedAt = new Date();
  if (openedDate && endTime) {
    closedAt = new Date(`${openedDate}T${endTime.slice(0, 5)}:00`);
    if (openedAt && closedAt < openedAt) closedAt = new Date(closedAt.getTime() + 86400000);
  }
  const shiftMin = openedAt ? Math.round((closedAt - openedAt) / 60000) : 0;
  const shiftFrame = openedAt ? { startMs: +openedAt, endMs: +closedAt } : null;

  const parallelN = parallelUnitsOf(lineFlow, machineCount);
  const dtW = laneWeightFn(parallelN, affectsLanes);   // §3.2 — สูตรเดียวกับที่ dtMinBySession ใช้ ห้ามเขียนซ้ำ
  const sessionShift = session?.shift || 'day';
  /* 📸 snapshot ชนะทะเบียนสด — กะที่ปิดพร้อม snapshot ต้องคำนวณซ้ำได้ค่าเดิมเป๊ะ (§snapshot)
     ไม่มี snapshot (กะเก่า) = ถอยไปทะเบียนสดเหมือนเดิมทุกบรรทัด */
  const ctSnap = readCtSnapshot(session);
  const brkSnap = readBreakSnapshot(session);
  const brkPolicies = brkSnap ? brkSnap.policies  : breakPolicies;
  const brkLineRules = brkSnap ? brkSnap.lineRules : lineRules;
  const brkProcessType = brkSnap ? brkSnap.processType : processType;
  const ctForMatNo = (matNo) => {
    const snap = ctSnap?.[matNo];
    return snap > 0 ? snap : ctForMat(matNo, { kanbanStds, products });
  };
  const pairOf = (mat) => products.find(p => p.mat_no === mat)?.pair_mat_no || null;

  /* 🔚 กรอบที่ส่งเข้ามาคือ "ช่วงที่ MAT ตัวนี้วิ่ง" ไม่ใช่ทั้งกะ ⇒ ต้องบอก **ปลายกะจริง** ด้วย
     ไม่งั้นพักที่ผูกปลายกะ (5ส.) จะไปเกาะปลายช่วงของแต่ละ MAT = หักพักซ้ำทุกใบ */
  const brkIvIn = (a, b) => breakIntervalsIn({
    policies: brkPolicies, startMs: a ? a.getTime() : 0, endMs: b ? b.getTime() : 0,
    workDate, shift: sessionShift, processType: brkProcessType, shiftEndMs: shiftFrame?.endMs ?? null,
    lineName: session?.line_name ?? null, lineRules: brkLineRules,
  });
  const ivMin = (iv) => iv.reduce((sum, [a, b]) => sum + (b - a) / 60000, 0);
  const dtOverlapMin = (startMs, endMs, pred, logs, weightFn, breakIv = []) => {
    if (!startMs || !endMs || endMs <= startMs) return 0;
    return logs.filter(pred).reduce((sum, d) => {
      if (!d.started_at) return sum;
      const s0 = new Date(d.started_at).getTime();
      const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
      const s = Math.max(s0, startMs), e = Math.min(e0, endMs);
      if (!(e > s)) return sum;
      const min = (e - s) / 60000 - overlapMinutesWith(s, e, breakIv);
      return min > 0 ? sum + min * weightFn(d) : sum;
    }, 0);
  };
  const breakIv = brkIvIn(openedAt, closedAt);
  const policyBreakMin = ivMin(breakIv);
  const dtEff = d => dtMinOutsideBreaks(d, breakIv) * dtW(d);
  /* 🧾 สัดส่วนของใบที่ยังนับเป็น "ตามแผน" หลังชนเพดาน (§เพดาน)
     ชั้น %P คิดเป็น **ช่วงเวลาต่อ MAT** ⇒ เพดานซึ่งเป็น "ต่อใบ" ต้องเฉลี่ยลงตามสัดส่วนของใบ
     (ไม่มีเพดาน = 1 หรือ 0 ตามหมวด = พฤติกรรมเดิมเป๊ะ) */
  const plannedShare = (d) => {
    const full = dtMinOutsideBreaks(d, breakIv);
    const sp = dtPlannedSplit(d, full, 1);
    const tot = sp.planned + sp.unplanned;
    return tot > 0 ? sp.planned / tot : 0;
  };
  const wPlanned = d => dtW(d) * plannedShare(d);
  const wUnplanned = d => dtW(d) * (1 - plannedShare(d));
  const anyRow = () => true;
  /* เพดานของ "หยุดตามแผน" — เกินเพดานไหลไปเป็น unplanned (§เพดาน · ของกลาง `dtPlannedSplit`) */
  let loggedPlannedDT = 0, loggedUnplannedDT = 0, plannedOverMin = 0;
  dtl.forEach(d => {
    const sp = dtPlannedSplit(d, dtMinOutsideBreaks(d, breakIv), dtW(d));
    loggedPlannedDT += sp.planned; loggedUnplannedDT += sp.unplanned; plannedOverMin += sp.overMin;
  });
  const dtBreakOverlapMin = dtl.reduce((s, d) =>
    s + Math.max(0, ((Number(d.duration_min) || 0) - dtMinOutsideBreaks(d, breakIv)) * dtW(d)), 0);
  const plannedDT = loggedPlannedDT + policyBreakMin;
  const netAvail = Math.max(0, shiftMin - plannedDT);
  const runMin = Math.max(0, netAvail - loggedUnplannedDT);

  /* ── %A แยกตามช่วงเวลาของแต่ละ MAT.NO (ดูเหตุผลเต็มใน §7) ── */
  const applyMatTimeOverride = (matNo, hasOpenOrders, startMs, endMs) => {
    if (hasOpenOrders) return { startMs, endMs };
    const ov = matTimeOverride[matNo];
    if (!ov || !workDate) return { startMs, endMs };
    let s = startMs, e = endMs;
    if (ov.start) s = new Date(`${workDate}T${ov.start.slice(0, 5)}:00`).getTime();
    if (ov.end) {
      e = new Date(`${workDate}T${ov.end.slice(0, 5)}:00`).getTime();
      if (s != null && e < s) e += 86400000;
    }
    return { startMs: s, endMs: e };
  };
  let totalNetAvailByMat = 0, totalRunMinByMat = 0;
  const matRunMinMap = {}, matNetAvailMap = {};
  const matWins = [];
  Array.from(new Set(orders.map(o => o.mat_no))).forEach(matNo => {
    const ords = orders.filter(o => o.mat_no === matNo);
    const hasOpenOrders = ords.some(o => o.status === 'open');
    const openedTimes = ords.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
    const closedTimes = ords.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
    const openStopTimes = ords.filter(o => o.status === 'open' && carryOverDecisions[o.id]).map(o => {
      const stopStr = carryStopTime[o.id] ?? endTime;
      if (!stopStr || !workDate) return null;
      let ms = new Date(`${workDate}T${stopStr.slice(0, 5)}:00`).getTime();
      if (o.opened_at && ms < new Date(o.opened_at).getTime()) ms += 86400000;
      return ms;
    }).filter(Boolean);
    let matStartMs = openedTimes.length ? Math.min(...openedTimes) : null;
    let matEndMs = (closedTimes.length || openStopTimes.length) ? Math.max(...closedTimes, ...openStopTimes) : null;
    ({ startMs: matStartMs, endMs: matEndMs } = applyMatTimeOverride(matNo, hasOpenOrders, matStartMs, matEndMs));
    ({ startMs: matStartMs, endMs: matEndMs } = clampWinToShift(matStartMs, matEndMs, shiftFrame));
    if (matStartMs == null || matEndMs == null || matEndMs <= matStartMs) return;
    const windowMin = (matEndMs - matStartMs) / 60000;
    const matBreakIv = brkIvIn(new Date(matStartMs), new Date(matEndMs));
    const matPolicyBreakMin = ivMin(matBreakIv);
    const matLoggedPlanned = dtOverlapMin(matStartMs, matEndMs, anyRow, dtl, wPlanned, matBreakIv);
    const matLoggedUnplanned = dtOverlapMin(matStartMs, matEndMs, anyRow, dtl, wUnplanned, matBreakIv);
    const matNetAvail = Math.max(0, windowMin - matPolicyBreakMin - matLoggedPlanned);
    const matRunMin = Math.max(0, matNetAvail - matLoggedUnplanned);
    totalNetAvailByMat += matNetAvail;
    totalRunMinByMat += matRunMin;
    matRunMinMap[matNo] = matRunMin;
    matNetAvailMap[matNo] = matNetAvail;           // 👈 ใช้ต่อใน §OEE รายพาร์ท
    matWins.push([matStartMs, matEndMs]);
  });
  const untimed = dtl.filter(d => !d.started_at);
  const untimedPlanned = untimed.reduce((s, d) => s + (d.duration_min || 0) * wPlanned(d), 0);
  const untimedUnplanned = untimed.reduce((s, d) => s + (d.duration_min || 0) * wUnplanned(d), 0);
  const coveredIv = unionIv([...matWins, ...breakIv]);
  const outsidePlanned = dtl.reduce((s, d) => s + dtMinOutsideWork(d, coveredIv, shiftFrame) * wPlanned(d), 0);
  const outsideUnplanned = dtl.reduce((s, d) => s + dtMinOutsideWork(d, coveredIv, shiftFrame) * wUnplanned(d), 0);
  if (totalNetAvailByMat > 0 && (untimedPlanned || untimedUnplanned || outsidePlanned || outsideUnplanned)) {
    totalNetAvailByMat = Math.max(0, totalNetAvailByMat - untimedPlanned - outsidePlanned);
    totalRunMinByMat = Math.max(0, totalRunMinByMat - untimedPlanned - untimedUnplanned - outsidePlanned - outsideUnplanned);
  }
  const A = totalNetAvailByMat > 0 ? Math.min(1, totalRunMinByMat / totalNetAvailByMat)
    : (netAvail > 0 ? Math.min(1, runMin / netAvail) : null);

  /* ── %P ──
     🔴 ตัวเศษ = **ชิ้นที่เครื่องทำออกมาทั้งหมด** = งานดี + ของเสีย/ทดลอง/ของสงสัย (ดู `ngByMatFrom`)
        ไม่ใช่ "งานดีอย่างเดียว" — ของเสียกินรอบเครื่องไปแล้ว ถ้าไม่นับ = ถูกหักซ้ำทั้ง %P และ %Q */
  const { byMat: ngPByMat, noMat: ngNoMatP } = ngByMatFrom(defects, orders);
  const runSec = runMin * 60;
  const matPDataRaw = [];
  let unknownQty = 0, ngInP = 0;
  Array.from(new Set(orders.map(o => o.mat_no))).forEach(matNo => {
    const ords = orders.filter(o => o.mat_no === matNo);
    const ngThis = Number(ngPByMat[matNo]) || 0;
    const qty = ords.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
      + ords.filter(o => ['open', 'carry_over', 'cancelled', 'imported'].includes(o.status))
        .reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || Number(o.qty_actual) || 0), 0)
      + ngThis;
    if (!qty) return;
    const ctSec = ctForMatNo(matNo);
    if (ctSec <= 0) { unknownQty += qty; return; }
    ngInP += ngThis;
    const openedTimes = ords.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
    const closedTimes = ords.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
    const stopTimes = ords.filter(o => o.status === 'open' && carryOverDecisions[o.id]).map(o => {
      const s = carryStopTime[o.id] ?? endTime;
      if (!s || !workDate) return null;
      let ms = new Date(`${workDate}T${s.slice(0, 5)}:00`).getTime();
      if (o.opened_at && ms < new Date(o.opened_at).getTime()) ms += 86400000;
      return ms;
    }).filter(Boolean);
    const { startMs: winStart, endMs: winEnd } = clampWinToShift(
      openedTimes.length ? Math.min(...openedTimes) : null,
      [...closedTimes, ...stopTimes].length ? Math.max(...closedTimes, ...stopTimes) : null,
      shiftFrame);
    matPDataRaw.push({ matNo, qty, ctSec, winStart, winEnd });
  });
  const knownQty = matPDataRaw.reduce((s, d) => s + d.qty, 0);
  const matPData = collapsePairShots(
    matPDataRaw.map(d => ({ mat_no: d.matNo, qty: d.qty, ct: d.ctSec, winStart: d.winStart, winEnd: d.winEnd })),
    pairOf,
  ).map(r => ({ matNo: r.mat_no, qty: r.qty, ctSec: r.ct, winStart: r.winStart, winEnd: r.winEnd }));

  const prodInfoOf = (matNo) =>
    kanbanStds.find(s => s.mat_no === matNo)?.dr_products
    || products.find(p => p.mat_no === matNo)
    || null;
  const groupKeyByMat = groupSameProductKeys(matPData.map(d => {
    const info = prodInfoOf(d.matNo);
    return { matNo: d.matNo, name: info?.name, pNo: info?.p_no };
  }));
  const prodGroupMap = {};
  matPData.forEach(d => {
    const k = groupKeyByMat[d.matNo] || `MAT:${d.matNo}`;
    const g = (prodGroupMap[k] ||= { key: k, stdSec: 0, runMin: 0, ws: null, we: null,
      netAvailMin: 0, qtyAll: 0, matNos: [], name: null, pNo: null });
    const info = prodInfoOf(d.matNo);
    if (!g.matNos.includes(d.matNo)) g.matNos.push(d.matNo);
    if (!g.name && info?.name) g.name = info.name;
    if (!g.pNo && info?.p_no) g.pNo = info.p_no;
    g.netAvailMin += matNetAvailMap[d.matNo] ?? 0;
    g.qtyAll += d.qty;
    g.stdSec += d.qty * d.ctSec;
    g.runMin += matRunMinMap[d.matNo] ?? 0;
    if (d.winStart != null) g.ws = g.ws == null ? d.winStart : Math.min(g.ws, d.winStart);
    if (d.winEnd != null) g.we = g.we == null ? d.winEnd : Math.max(g.we, d.winEnd);
  });
  const prodGroups = Object.values(prodGroupMap);
  const overlapOf = (a, b) => Math.max(0, (Math.min(a.we, b.we) - Math.max(a.ws, b.ws)) / 60000);
  const isParallel = prodGroups.length > 1 && prodGroups.some((a, i) =>
    prodGroups.slice(i + 1).some(b => {
      if (a.ws == null || a.we == null || b.ws == null || b.we == null) return false;
      const ov = overlapOf(a, b);
      const minDurMin = Math.min(a.we - a.ws, b.we - b.ws) / 60000;
      return ov > 15 && ov > 0.2 * minDurMin;
    })
  );
  const perMachineCt = flowModeOf(lineFlow.flow_mode) === 'parallel_machine';
  let P = null, pRawRatio = null, dtOverstateMin = null, stdMin = 0;
  if (runSec > 0 && matPData.length > 0) {
    const totalStdSec = matPData.reduce((s, d) => s + d.qty * d.ctSec, 0);
    stdMin = totalStdSec / 60;                 // "เวลามาตรฐานของกะ" — คู่กับ stdMin ของ computeLiveOee
    if (isParallel || perMachineCt) {
      const rawDenom = prodGroups.reduce((s, g) => s + g.runMin * 60, 0) || runSec;
      const denomSec = perMachineCt
        ? Math.min(Math.max(rawDenom, runSec), runSec * Math.max(1, parallelN))
        : rawDenom;
      pRawRatio = totalStdSec / denomSec;
      P = Math.min(1, pRawRatio);
    } else {
      pRawRatio = totalStdSec / runSec;
      P = Math.min(1, pRawRatio);
      if (pRawRatio > 1.001) dtOverstateMin = Math.round(totalStdSec / 60 - runMin);
    }
  }

  /* %Q = งานดี ÷ **ยอดผลิต** (§7.2.2 · สูตรกลาง `qRatio`) — ฐานตัดงานทดลองออกให้เข้าคู่กับ
     `ngQty` ที่มาจาก `sumDefectQty(…, 'line')` · ชิ้นที่ซ่อมเสร็จ/ของสงสัยที่ QA เคลียร์
     กลับมาเป็น "งานดี" ของกะนี้เองโดยไม่ต้องเด้งยอด (นั่นคือเหตุผลที่ต้องเปลี่ยนตัวหาร) */
  /* 🔴 `Math.max` = ด่าน back-compat — ผู้เรียกที่ส่ง `ngQty` มาเองโดยไม่ส่งแถว `defects`
     (เทส/จอเก่า) จะได้ฐานเดิม `totalProduced + ngQty` = ผลลัพธ์เท่าสูตรก่อน 25/11 เป๊ะ
     · กรณีปกติ (มีแถว) `qTotalCount` ใหญ่กว่าเสมอ เพราะ `defectQtyForP ≥ defectQty` ทุกแถว */
  const qBaseQty = Math.max(qTotalCount(totalProduced, defects), totalProduced + ngQty);
  const Q = qRatio(qBaseQty, ngQty);
  const oee = (A != null && P != null && Q != null) ? A * P * Q : null;

  /* ── 📦 OEE รายพาร์ท (2026-11-20 · คำสั่ง user "oee by part/product ต้องการให้มีนะ") ──────
     🔴 **ไม่มีสูตรใหม่** — ใช้ของที่คิดไปแล้วข้างบนทั้งหมด:
        %A = `matRunMinMap` ÷ `matNetAvailMap` (ช่วงเวลาที่พาร์ทนั้นเปิดใบอยู่)
        %P = `stdSec` ÷ `runMin` ของกลุ่ม (จับกลุ่มด้วย `groupSameProductKeys` ตัวเดิม)
        %Q = ยอดดี ÷ (ยอดดี + ของเสีย) ราย MAT ผ่าน `ngByMatFrom(..., defectQty)` ตัวเดิม
     🔴 **ชิ้น ≠ shot** — %A/%P อยู่บน shot (ยุบคู่ RH/LH แล้ว) · %Q อยู่บน **ชิ้น** ⇒ ใช้ยอดดิบ
        ก่อนยุบคู่ (`matPDataRaw`) เป็นตัวหาร ห้ามใช้ `qtyAll` ที่ยุบแล้ว
     🔴 **`overlap: true` = ห้ามเอาไปบวกเป็นภาพรวมไลน์** — ไลน์เดินหลายพาร์ทพร้อมกัน
        นาทีที่เครื่องหยุด 1 นาทีถูกคิดให้ทุกพาร์ทที่ช่วงเวลาคาบกัน ⇒ ผลรวมจะเกินความจริง
        จอที่โชว์ต้องเขียนบอก (UI §6.43) — เทียบพาร์ทต่อพาร์ทได้ บวกรวมไม่ได้
     🔴 พาร์ทที่ **ไม่รู้ CT** ไม่อยู่ในลิสต์นี้เลย (ไม่เข้า `matPData` ตั้งแต่ต้น)
        ⇒ จอต้องเขียนว่าชี้ไม่ได้กี่ชิ้นจาก `unknownQty` (กฎจอซื่อสัตย์) */
  const rawQtyByMat = {};
  matPDataRaw.forEach(d => { rawQtyByMat[d.matNo] = (rawQtyByMat[d.matNo] || 0) + d.qty; });
  const { byMat: ngQByMat } = ngByMatFrom(defects, orders, defectQty);
  /* ฐานของ %Q รายพาร์ท = ยอดสแกน + ชิ้นที่ไม่ใช่ของดี (ตัดงานทดลอง) — §7.2.2 เหมือนระดับกะ
     🔴 ใช้ `ngByMatFrom` ตัวเดิมแค่เปลี่ยนวิธีนับต่อแถว ห้ามเขียนลูปราย MAT ชุดใหม่ */
  const { byMat: ngQBaseByMat } = ngByMatFrom(defects, orders, defectQtyForQBase);
  const groupList = Object.values(prodGroupMap);
  const byProduct = groupList.map(g => {
    /* คู่ RH/LH ถูกยุบไปแล้วในขา %P ⇒ ขา %Q ต้องตามไปเก็บ MAT ฝั่งคู่ด้วย ไม่งั้นของเสียหาย */
    const mats = new Set(g.matNos);
    g.matNos.forEach(m => { const pm = pairOf(m); if (pm) mats.add(pm); });
    let pcsAll = 0, ngAll = 0, ngForQ = 0, ngQBase = 0;
    mats.forEach(m => {
      pcsAll  += Number(rawQtyByMat[m]) || 0;
      ngAll   += Number(ngPByMat[m]) || 0;
      ngForQ  += Number(ngQByMat[m]) || 0;
      ngQBase += Number(ngQBaseByMat[m]) || 0;
    });
    const good = Math.max(0, pcsAll - ngAll);        // ยอดสแกนของกลุ่มนี้ (pcsAll นับของเสียไว้แล้ว)
    /* ฐาน %Q = ยอดสแกน + ชิ้นที่ไม่ใช่ของดีที่ไม่ใช่งานทดลอง · `Math.max` = ด่านเดียวกับระดับกะ */
    const qBasePcs = Math.max(good + ngQBase, good + ngForQ);
    const gA = g.netAvailMin > 0 ? Math.min(1, g.runMin / g.netAvailMin) : null;
    const gP = g.runMin > 0 ? Math.min(1, (g.stdSec / 60) / g.runMin) : null;
    const gQ = qRatio(qBasePcs, ngForQ);
    const overlap = g.ws != null && g.we != null && groupList.some(o =>
      o !== g && o.ws != null && o.we != null && overlapOf(g, o) > 15);
    return {
      key: g.key, matNos: g.matNos.slice(), name: g.name, pNo: g.pNo,
      netAvailMin: Math.round(g.netAvailMin), runMin: Math.round(g.runMin),
      stdMin: Math.round(g.stdSec / 60), shots: g.qtyAll,
      pcs: pcsAll, good, ngQty: ngForQ, qBasePcs,
      winStart: g.ws, winEnd: g.we, overlap,
      A: gA, P: gP, Q: gQ,
      oee: (gA != null && gP != null && gQ != null) ? gA * gP * gQ : null,
    };
  }).sort((a, b) => (b.runMin - a.runMin) || (b.pcs - a.pcs));
  const ctUsed = {};
  matPData.forEach(d => { ctUsed[d.matNo] = d.ctSec; });
  /* 📸 "คิดรอบนี้ด้วยอะไร" — ให้จอ stamp กลับลงกะได้ตรงๆ (§snapshot)
     มี snapshot อยู่แล้ว = คืนตัวเดิม **ห้ามทับด้วยทะเบียนวันนี้** · ไม่มี = ตรึงทะเบียนที่ใช้รอบนี้ */
  const breakSnapshot = brkSnap
    ? session.break_snapshot
    : makeBreakSnapshot({ breakPolicies, session, processType, lineRules });
  return {
    A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, plannedDT, breakSnapshot,
    totalProduced, ngQty, knownQty, unknownQty, ctUsed, ngInP, ngNoMatP, stdMin,
    loggedPlannedDT, loggedUnplannedDT, dtBreakOverlapMin, plannedOverMin,
    byProduct, byProductOverlap: byProduct.some(g => g.overlap),
    pOver: pRawRatio != null && pRawRatio > 1.001,
    pRawPct: pRawRatio == null ? null : Math.round(pRawRatio * 1000) / 10,
    dtOverstateMin, loggedDtMin: Math.round(loggedPlannedDT + loggedUnplannedDT),
  };
}
