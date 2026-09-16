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
*/

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

   ⛔ **ห้ามใช้ฟังก์ชันนี้คิด "เป้า"** — เป้าของใบ `imported` ถูกย้ายไปอยู่ที่ใบของกะถัดไปแล้ว
      จุดที่รวมเป้าด้วย `o.qty` ดิบ ต้องกรอง `imported` ออกเหมือนเดิม ไม่งั้นเป้าถูกนับซ้ำ  */
export function orderProducedQty(o) {
  if (!o) return 0;
  return o.status === 'confirmed'
    ? Number(o.qty_ok ?? o.qty ?? 0)
    : Number(o.qty_actual ?? 0);
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

/** **ช่วงเวลา**พักตามนโยบายที่ทับกรอบ [startMs, endMs] → [[s, e], ...] (epoch ms) เรียง + รวมช่วงที่ทับกัน
 *  กติกาทั้งหมดของ "พักนโยบาย" อยู่ที่ฟังก์ชันนี้ที่เดียว: กรองกะ → กรองกระบวนการ → ot_scope → กะดึกข้ามวัน
 *  · `policyBreakOverlapMin` = ผลรวมนาทีของช่วงที่ได้จากตัวนี้
 *  · จุดที่ต้องรู้ว่า "พักอยู่ช่วงไหนบ้าง" (เช่นตัด downtime ที่ทับพักออก) ให้เรียกตัวนี้ **ห้ามสร้างช่วงพักเองซ้ำ**
 *  ⚠️ union ช่วงที่ทับกัน: ชุดนโยบายปัจจุบันไม่มีคู่ไหนทับกัน (ผลลัพธ์เท่าเดิมเป๊ะ) แต่ถ้าวันหน้ามีคนตั้งทับ
 *     การบวกดิบๆ จะนับพักเกิน — union กันไว้ตั้งแต่ต้น */
export function breakIntervalsIn({ policies = [], startMs, endMs, workDate, shift, processType = null }) {
  if (!startMs || !endMs || endMs <= startMs || !workDate) return [];
  const rangeOf = (p) => {
    const [ph, pm] = String(p.start_time || '00:00').split(':').map(Number);
    let ps = new Date(`${workDate}T${String(ph).padStart(2, '0')}:${String(pm).padStart(2, '0')}:00`).getTime();
    let pe = ps + (Number(p.duration_min) || 0) * 60000;
    if (pe < startMs) { ps += 86400000; pe += 86400000; }  // พักกะดึกหลังเที่ยงคืน
    const s = Math.max(ps, startMs), e = Math.min(pe, endMs);
    return e > s ? [s, e] : null;
  };
  const applicable = policies.filter(p => {
    if (!(p.shift === 'both' || p.shift === shift)) return false;
    const proc = p.process_type;
    return !(proc && proc !== 'common' && proc !== processType);
  });
  /* ⚠️ นโยบายที่เกิด "เฉพาะตอนทำโอ / เฉพาะตอนไม่ทำโอ" (break_policies.ot_scope · 2026-09-14)
     เคสจริงที่ user จับได้: 5ส. กะเช้ามี 2 แถว — 17:10 (ไม่ทำโอ) กับ 19:40 (ทำโอ) ซึ่งเป็น
     "อย่างใดอย่างหนึ่ง" แต่กะ 08:00-20:00 กวาดทั้งคู่ ⇒ หักพักเกินจริง 20 นาที ทุกกะที่ทำโอ
     (ควรต่างจากกะไม่ทำโอแค่ 30 นาที = เบรค OT แต่กลายเป็น 50)
     กติกา: กรอบนี้ครอบนโยบาย 'ot' อยู่แล้ว = กะนี้ทำโอ ⇒ ทิ้ง 'no_ot' ทั้งหมด
     — data-driven ล้วน ไม่ต้องรู้เวลาเลิกงานปกติของกะไหนเลย · แถวที่ไม่ตั้ง = 'always' = เหมือนเดิม */
  const isOt = applicable.some(p => p.ot_scope === 'ot' && rangeOf(p));
  const iv = applicable
    .filter(p => !(isOt && p.ot_scope === 'no_ot'))
    .map(rangeOf).filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  return mergeIv(iv);
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

export function policyBreakOverlapMin({ policies = [], startMs, endMs, workDate, shift, processType = null }) {
  return breakIntervalsIn({ policies, startMs, endMs, workDate, shift, processType })
    .reduce((s, [a, b]) => s + (b - a) / 60000, 0);
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
export function policyBreakForShift({ policies = [], shift, shiftMin, workDate, startTime = null, processType = null }) {
  if (!shiftMin || !workDate) return 0;
  const hhmm = startTime ? String(startTime).slice(0, 5)
    : `${String(Math.floor((SHIFT_START_MIN[shift] ?? SHIFT_START_MIN.day) / 60)).padStart(2, '0')}:00`;
  const startMs = new Date(`${workDate}T${hhmm}:00`).getTime();
  return policyBreakOverlapMin({ policies, startMs, endMs: startMs + Number(shiftMin) * 60000, workDate, shift, processType });
}


/** กรอบเวลาของกะ [startMs, endMs] จากแถว production_sessions (work_date + start_time + shift_min)
 *  คืน null เมื่อข้อมูลไม่พอ — **ห้ามเดา 08:00/20:00 แทน** (กะเปิดสายเป็นเรื่องปกติ) */
export function sessionWindow(session, { nowMs = null } = {}) {
  const wd = session?.work_date;
  const st = session?.start_time;
  if (!wd || !st) return null;
  const startMs = new Date(`${wd}T${String(st).slice(0, 5)}:00`).getTime();
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
} = {}) {
  const win = (startMs && endMs) ? { startMs, endMs, workDate: workDate || session?.work_date, shift: shift || session?.shift }
    : sessionWindow(session, { nowMs });
  const brkIv = (win && breakPolicies.length)
    ? breakIntervalsIn({ policies: breakPolicies, startMs: win.startMs, endMs: win.endMs, workDate: win.workDate, shift: win.shift, processType })
    : [];
  const w = weightFn || (() => 1);
  let planned = 0, unplanned = 0, plannedRaw = 0, unplannedRaw = 0, breakOverlapMin = 0;
  for (const d of downtimes) {
    const raw = dtRawMin(d, nowMs);
    const eff = dtMinOutsideBreaks(d, brkIv, nowMs);
    breakOverlapMin += Math.max(0, raw - eff);
    const isPlanned = (d?.dr_downtime_types?.category ?? d?.dt_category) === 'planned';
    if (isPlanned) { planned += eff * w(d); plannedRaw += raw; }
    else { unplanned += eff * w(d); unplannedRaw += raw; }
  }
  return {
    planned, unplanned, plannedRaw, unplannedRaw, breakOverlapMin,
    breakIv: brkIv, breakMin: brkIv.reduce((a, [x, y]) => a + (y - x) / 60000, 0),
    noBreakPolicy: !breakPolicies.length,
  };
}

/** นาที downtime ต่อกะ สำหรับใช้เป็น **น้ำหนัก/ฐานเวลา** (wLoad, OOE/TEEP, strictOee)
 *  → { [sessionId]: { planned, unplanned, breakMin } } · นาทีที่ทับช่วงพักถูกตัดออกแล้ว (§3.1)
 *  sessions ต้องมี id/work_date/shift/start_time/shift_min · downtimes ต้องมี session_id + join category
 *  ไม่ส่ง breakPolicies = ไม่ตัด (เท่าพฤติกรรมเดิม) — จอที่โชว์ค่าเฉลี่ยถ่วงน้ำหนักต้องส่งเสมอ
 *  ไม่งั้นน้ำหนักของกะที่มี PM คร่อมพักจะเบากว่าจอ /oee-analytics = ค่าเฉลี่ยคนละเลข */
export function dtMinBySession(sessions = [], downtimes = [], breakPolicies = []) {
  const ivBy = {};
  for (const s of sessions) {
    const win = sessionWindow(s);
    ivBy[s.id] = (win && breakPolicies.length)
      ? breakIntervalsIn({ policies: breakPolicies, startMs: win.startMs, endMs: win.endMs, workDate: win.workDate, shift: win.shift })
      : [];
  }
  const out = {};
  for (const d of downtimes) {
    const sid = d.session_id;
    const o = (out[sid] ||= { planned: 0, unplanned: 0, breakMin: 0 });
    const eff = dtMinOutsideBreaks(d, ivBy[sid] || []);
    if ((d?.dr_downtime_types?.category ?? d?.dt_category) === 'planned') o.planned += eff;
    else o.unplanned += eff;
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
export function computeLiveOee({ session, orders = [], downtimes = [], ctMap = {}, ngQty = null, workDate, nowMs = Date.now(), parallelN = 1, parallelCap = 1, breakPolicies = [], processType = null }) {
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
  else if (isNight && startH < 8) {                        // กะดึกข้ามคืน — เวลาเริ่มอยู่เช้าวันถัดไป
    const d = new Date(`${wd}T12:00:00`); d.setDate(d.getDate() + 1);
    openedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const opened = new Date(`${openedDate}T${openedHm}:00`).getTime();
  let elapsed = (nowMs - opened) / 60000;
  if (session.shift_min) elapsed = Math.min(elapsed, session.shift_min);
  if (!(elapsed >= LIVE_MIN_ELAPSED)) return null;

  // เวลาพักตามนโยบายที่ทับช่วง [เปิดกะ, ตอนนี้] — สูตรกลางตัวเดียวกับตอนปิดกะ
  // เก็บเป็น "ช่วงเวลา" ไม่ใช่แค่ยอดรวม เพราะต้องเอาไปตัด downtime ที่ทับพักออกด้วย (§3.1)
  const brkIv = breakPolicies.length
    ? breakIntervalsIn({
        policies: breakPolicies, startMs: opened, endMs: opened + elapsed * 60000,
        workDate: wd, shift: session.shift, processType,
      })
    : [];
  const breakMin = brkIv.reduce((s, [a, b]) => s + (b - a) / 60000, 0);
  // Downtime ที่ยังเปิดค้าง (ไม่มีเวลาจบ/นาที) นับถึงตอนนี้ · นาทีที่ตกในช่วงพักถูกตัดออก (ห้ามหักซ้ำ §3.1)
  const dtW = d => (parallelN > 1 && d.machine_no) ? 1 / parallelN : 1;
  const dtOne = (d) => dtMinOutsideBreaks(d, brkIv, nowMs) * dtW(d);
  /* แยกหยุดตามแผน (PM/เปลี่ยนรุ่น) ออกจากหยุดนอกแผน — ต้อง join dr_downtime_types(category) มา
     ไม่ได้ join = ทุกแถวถูกนับเป็นนอกแผน (fail-safe ฝั่งเข้มงวด ไม่ใช่ปล่อยผ่าน) */
  let plannedDtMin = 0, unplannedDtMin = 0;
  downtimes.forEach(d => {
    const m = dtOne(d);
    if ((d?.dr_downtime_types?.category ?? d?.dt_category) === 'planned') plannedDtMin += m;
    else unplannedDtMin += m;
  });
  const netAvail = elapsed - plannedDtMin - breakMin;
  if (!(netAvail > 0)) return null;                    // ยังอยู่ในพัก/หยุดตามแผนทั้งช่วง = ยังประเมินไม่ได้
  const runMin = Math.max(1, netAvail - unplannedDtMin);

  let stdMin = 0, produced = 0, ngFromOrders = 0, qtyNoCt = 0;
  const matsNoCt = new Set();
  orders.forEach(o => {
    const q = orderProducedQty(o);
    produced += q;
    const ct = Number(ctMap[o.mat_no]) || 0;
    if (ct > 0) stdMin += q * ct / 60;
    else if (q > 0) { qtyNoCt += q; if (o.mat_no) matsNoCt.add(o.mat_no); }
    ngFromOrders += o.qty_ng || 0;
  });
  const ng = ngQty != null ? ngQty : ngFromOrders;

  const A = Math.min(1, runMin / netAvail);
  const pct = v => Math.max(0, Math.min(100, Math.round(v * 1000) / 10));
  /* ตัวเลขฐานที่ใช้ตรวจย้อนกลับได้ว่า A สดมาจากไหน (จอเอาไปโชว์ tooltip ได้ ไม่ต้องคำนวณเอง)
     `noBreakPolicy` = ผู้เรียกลืมส่งนโยบายพัก ⇒ A จะไม่ตรงกับค่าที่ stamp ตอนปิดกะ */
  const baseInfo = {
    netAvailMin: Math.round(netAvail), breakMin: Math.round(breakMin),
    plannedDtMin: Math.round(plannedDtMin), unplannedDtMin: Math.round(unplannedDtMin),
    noBreakPolicy: !breakPolicies.length, startTimeOutOfFrame,
  };

  // ยังไม่ผลิตชิ้นแรก (เพิ่งเปิดกะ/รอของ) → ประเมิน P/Q/OEE ไม่ได้ ต้องคืน null
  // ห้ามคืน P=0 → OEE 0% (เคยทำการ์ด "กำลังผลิต" ขึ้น 0% แดง ทั้งที่กะเพิ่งเปิด 19 นาที · 2026-08-05)
  if (produced <= 0) {
    return { A: pct(A), P: null, Q: null, oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
      stdMin: 0, denomMin: Math.round(runMin), produced: 0, ngQty: ng, noOutput: true, ...baseInfo };
  }

  const Q = produced / (produced + ng);

  /* ผลิตแล้วแต่ "ไม่มีชิ้นงานไหนตั้ง CT ไว้เลย" → stdMin = 0 → P = 0 → OEE = 0%
     ⚠️ นั่นคือคำกล่าวอ้างเท็จว่า "ไลน์เดินได้แย่มาก" ทั้งที่ความจริงคือ **ไม่รู้มาตรฐาน**
     (หลักเดียวกับ noOutput ที่ห้ามคืน 0) → P/OEE = null + flag noCt ให้จอบอกว่าต้องไปตั้ง CT
     A กับ Q ยังตอบได้ (ไม่ต้องใช้ CT) จึงคืนตามปกติ */
  if (stdMin <= 0) {
    return { A: pct(A), P: null, Q: pct(Q), oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
      stdMin: 0, denomMin: Math.round(runMin),
      produced, ngQty: ng, noOutput: false, noCt: true, qtyNoCt, matsNoCt: [...matsNoCt], ...baseInfo };
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
    produced, ngQty: ng, noOutput: false, noCt: false, qtyNoCt, matsNoCt: [...matsNoCt],
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
    put(ty[axis], ty.name_th || 'ไม่ระบุประเภท', { min: Number(d.duration_min) || 0, count: 1 });
  });
  defects.forEach(d => {
    const ty = d.dr_defect_types || {};
    const qty = (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
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

/** จำนวนของเสียของ 1 แถว — NG + สงสัย (กฎเดิม: ยึด defect_logs ไม่ใช่คอลัมน์ rollup ของ session) */
export const defectQty = (d) => (Number(d?.qty_ng) || 0) + (Number(d?.qty_suspect) || 0);

/** รวมจำนวนของเสีย
 *  mode 'line' (ดีฟอลต์) = ไม่รวมงานทดลอง → ใช้คิด %Q / OEE
 *  mode 'all'            = รวมทุกอย่าง     → ใช้คิดมูลค่าของเสียทั้งหมด */
export const sumDefectQty = (rows, mode = 'line') =>
  (rows || []).reduce((s, d) => s + ((mode === 'all' || !isTrialDefect(d)) ? defectQty(d) : 0), 0);

/** แยก 2 ยอดในรอบเดียว — คืน { all, line, trial } */
export function splitDefectQty(rows) {
  let all = 0, trial = 0;
  (rows || []).forEach(d => { const q = defectQty(d); all += q; if (isTrialDefect(d)) trial += q; });
  return { all, line: all - trial, trial };
}

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
   ปัญหาที่แก้ (2026-09-09 · ทวนสอบกับ Excel หน้างาน ดู docs/OEE-EXCEL-VERIFY-2026-09-09.md):
   พาร์ทตัวเดียวกันที่แตก MAT ตาม **ลูกค้า/เรฟวิชั่น** ถูกตีเป็นคนละ product เพราะจับกลุ่มด้วย
   "ชื่อ product" ซึ่งสะกดไม่ตรงกันในทะเบียน:
     10105769 REINF ASY RAD SUPT LWR(306)(AAT)          RB3B-8C306-BC
     10105770 REINF ASY RAD SUPT LWR(RB3B-8C306-BC)     RB3B-8C306-BC
     10100381 REINF ASY RAD SUPT LWR (FVL)              RB3B-8C306-BB
     20066630 REINF ASY RAD LWR(MB3B-8C306-BA)ก่อนแพ็ก  MB3B - 8C306 - BA
   → 4 กลุ่ม → window ทับกัน → isParallel = true → ตัวหาร %P เปลี่ยน → P เพี้ยน
   (Assy LWR 06/08 กะดึก P 71.8 ที่ควรเป็น ~92.5 · 31/08 กะดึก 71.0 ที่ควรเป็น ~96.6)

   ⭐ กติกา: **ชื่อเดียวกัน "หรือ" เลขพาร์ทแกนกลางเดียวกัน = กลุ่มเดียวกัน (union)**
   ใช้ union ไม่ใช่เปลี่ยนคีย์ เพื่อให้กลุ่ม "หยาบขึ้นได้อย่างเดียว ห้ามละเอียดขึ้น" —
   ทุกคู่ที่เคยรวมกันด้วยชื่อยังรวมเหมือนเดิม (ไม่มีไลน์ไหนพฤติกรรมแย่ลงกว่าเดิม)
   และการรวมกลุ่มกระทบเฉพาะ heuristic `isParallel` เท่านั้น — ตัวหารของไลน์ parallel_machine
   (`Σ g.runMin`) ไม่เปลี่ยนค่า เพราะเป็นผลรวมข้ามทุกกลุ่มอยู่แล้ว

   ⚠️ ห้ามใช้ `family_id` เป็นคีย์ — วัดจริง 09/09: 145 สินค้า / 142 family = family คือ
   "MAT ตัวเดียวกันข้ามเรฟ" (คู่กับ effective_from/superseded_by) ไม่ใช่ "พาร์ทเดียวกันข้ามลูกค้า" */

/** แกนกลางของเลขพาร์ท: 'RB3B-8C306-BC' / 'MB3B - 8C306 - BA' → '8C306'
 *  ตัดตัวคั่นทุกแบบ แล้วเอา token กลาง (prefix รุ่นรถ + suffix เรฟ ต่างกันได้ในพาร์ทเดียวกัน)
 *  เข้าเงื่อนไขเฉพาะเมื่อ token กลางเป็นเลขพาร์ทจริง (≥3 ตัว + มีตัวเลข) ไม่งั้นคืนทั้งก้อน
 *  เพื่อไม่ให้ฟอร์แมตแปลกๆ ('SP-83', 'MB3BE102D04BC') ถูกรวมมั่ว */
export function partCoreOf(pNo) {
  const toks = String(pNo || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!toks.length) return '';
  if (toks.length >= 3) {
    const mid = toks.slice(1, -1).join('');
    if (mid.length >= 3 && /\d/.test(mid)) return mid;
  }
  return toks.join('');
}

/** rows = [{ matNo, name, pNo }] → { [matNo]: groupKey }
 *  MAT ที่ไม่มีทั้งชื่อและเลขพาร์ท จะอยู่กลุ่มของตัวเอง (พฤติกรรมเดิม) */
export function groupSameProductKeys(rows = []) {
  const parent = {};
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const add = (x) => { if (parent[x] === undefined) parent[x] = x; return x; };

  rows.forEach(r => {
    const self = add(`MAT:${r.matNo}`);
    const nm = String(r.name || '').trim().toUpperCase();
    if (nm) union(self, add(`NM:${nm}`));
    const core = partCoreOf(r.pNo);
    if (core) union(self, add(`PN:${core}`));
  });

  const out = {};
  rows.forEach(r => { out[r.matNo] = find(`MAT:${r.matNo}`); });
  return out;
}
