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
*/


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
export function policyBreakOverlapMin({ policies = [], startMs, endMs, workDate, shift, processType = null }) {
  if (!startMs || !endMs || endMs <= startMs || !workDate) return 0;
  return policies.reduce((sum, p) => {
    if (!(p.shift === 'both' || p.shift === shift)) return sum;
    const proc = p.process_type;
    if (proc && proc !== 'common' && proc !== processType) return sum;
    const [ph, pm] = String(p.start_time || '00:00').split(':').map(Number);
    let ps = new Date(`${workDate}T${String(ph).padStart(2, '0')}:${String(pm).padStart(2, '0')}:00`).getTime();
    let pe = ps + (Number(p.duration_min) || 0) * 60000;
    if (pe < startMs) { ps += 86400000; pe += 86400000; }  // พักกะดึกหลังเที่ยงคืน
    return sum + Math.max(0, (Math.min(pe, endMs) - Math.max(ps, startMs)) / 60000);
  }, 0);
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


/* ═══ 4) OEE สด (กะยังไม่ปิด) ═══ */
export const LIVE_MIN_ELAPSED = 10; // นาทีแรกของกะ ยังประเมินไม่ได้ (ตัวหารเล็กเกินไป)

// parallelN: จำนวนเครื่องหลักวิ่งขนานของไลน์ (production_lines.parallel_stations ผ่าน parallelUnitsOf ใน lineTypes.js)
// — DT ที่ระบุเครื่อง (machine_no) หักน้ำหนัก 1/N (เครื่องเดียวหยุด อีก N-1 ยังวิ่ง) · DT ไม่ระบุเครื่อง = หยุดทั้งไลน์ หักเต็ม
// สูตรเดียวกับ computeOEE ตอนปิดกะใน DailyReport (เคส LASER-345/789 N=3 · 2026-08-05) · ไม่ส่งมา = 1 (พฤติกรรมเดิม)
export function computeLiveOee({ session, orders = [], downtimes = [], ctMap = {}, ngQty = null, workDate, nowMs = Date.now(), parallelN = 1 }) {
  if (!session?.start_time) return null;
  const wd = workDate || session.work_date;
  if (!wd) return null;

  const opened = new Date(`${wd}T${session.start_time.slice(0, 5)}:00`).getTime();
  let elapsed = (nowMs - opened) / 60000;
  if (session.shift_min) elapsed = Math.min(elapsed, session.shift_min);
  if (!(elapsed >= LIVE_MIN_ELAPSED)) return null;

  // Downtime ที่ยังเปิดค้าง (ไม่มีเวลาจบ/นาที) นับถึงตอนนี้
  const dtW = d => (parallelN > 1 && d.machine_no) ? 1 / parallelN : 1;
  const dtMin = downtimes.reduce((a, d) => {
    if (d.ended_at || d.duration_min != null) return a + (Number(d.duration_min) || 0) * dtW(d);
    return a + (d.started_at ? Math.max(0, (nowMs - new Date(d.started_at).getTime()) / 60000) * dtW(d) : 0);
  }, 0);
  const runMin = Math.max(1, elapsed - dtMin);

  let stdMin = 0, produced = 0, ngFromOrders = 0, qtyNoCt = 0;
  const matsNoCt = new Set();
  orders.forEach(o => {
    const q = o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
    produced += q;
    const ct = Number(ctMap[o.mat_no]) || 0;
    if (ct > 0) stdMin += q * ct / 60;
    else if (q > 0) { qtyNoCt += q; if (o.mat_no) matsNoCt.add(o.mat_no); }
    ngFromOrders += o.qty_ng || 0;
  });
  const ng = ngQty != null ? ngQty : ngFromOrders;

  const A = Math.min(1, runMin / elapsed);
  const pct = v => Math.max(0, Math.min(100, Math.round(v * 1000) / 10));

  // ยังไม่ผลิตชิ้นแรก (เพิ่งเปิดกะ/รอของ) → ประเมิน P/Q/OEE ไม่ได้ ต้องคืน null
  // ห้ามคืน P=0 → OEE 0% (เคยทำการ์ด "กำลังผลิต" ขึ้น 0% แดง ทั้งที่กะเพิ่งเปิด 19 นาที · 2026-08-05)
  if (produced <= 0) {
    return { A: pct(A), P: null, Q: null, oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin), produced: 0, ngQty: ng, noOutput: true };
  }

  const Q = produced / (produced + ng);

  /* ผลิตแล้วแต่ "ไม่มีชิ้นงานไหนตั้ง CT ไว้เลย" → stdMin = 0 → P = 0 → OEE = 0%
     ⚠️ นั่นคือคำกล่าวอ้างเท็จว่า "ไลน์เดินได้แย่มาก" ทั้งที่ความจริงคือ **ไม่รู้มาตรฐาน**
     (หลักเดียวกับ noOutput ที่ห้ามคืน 0) → P/OEE = null + flag noCt ให้จอบอกว่าต้องไปตั้ง CT
     A กับ Q ยังตอบได้ (ไม่ต้องใช้ CT) จึงคืนตามปกติ */
  if (stdMin <= 0) {
    return { A: pct(A), P: null, Q: pct(Q), oee: null, elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
      produced, ngQty: ng, noOutput: false, noCt: true, qtyNoCt, matsNoCt: [...matsNoCt] };
  }

  const P = Math.min(1, stdMin / runMin);
  const oee = A * P * Q;
  if (!isFinite(oee)) return null;

  // qtyNoCt > 0 = ตั้ง CT ไม่ครบทุกชิ้นงาน → stdMin ขาด → %P ต่ำกว่าจริง (จอควรติดป้ายเตือน)
  return { A: pct(A), P: pct(P), Q: pct(Q), oee: pct(oee), elapsedMin: Math.round(elapsed), runMin: Math.round(runMin),
    produced, ngQty: ng, noOutput: false, noCt: false, qtyNoCt, matsNoCt: [...matsNoCt] };
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

