/* ══ kpiAuto — KPI ที่ระบบคำนวณเองตาม "สูตรทางการ" ใน KPI Guideline 2026 (pure · ห้าม import supabase/DOM) ══
   2026-09-24 · user ส่ง `KPI_Guideline_2026_As_of_29.01.2026.pdf` ซ้ำ ("เคยส่งให้แล้ว ดูให้ละเอียดอีกรอบ")
   → หน้า 10 ตาราง "Maintenance" กำหนดสูตรครบทั้ง 4 ตัว (docs/OBEYA-KPI-SOURCES.md §15.2) — **ไม่ต้องรอเคาะอะไรอีก**

   สูตร (verbatim จากหน้า 10):
     MO Closed on target = (MO Closed on target / Total MO) × 100
     Machine Break Down  = (No. of hours the machine has been stopped / No. of hours the machine can work normally) × 100
     MTBF                = [(730 × Number of machines) − Total breakdown times] / Number of machines
     MTTR                = Total hours of breakdown / Total frequency times

   ที่มาตัวเลข = RPC `kpi_mtn_rollup` (DR · Σ ต่อเดือน ไม่หาร) — migration `20260924_kpi_mtn_rollup_dr.sql`
     mo[]       {m, team, closed, on_target, no_target, closed_all}   ← mtn_orders ตามทีมช่าง (mtn_dept)
                🔴 closed/on_target/no_target = **เฉพาะ Breakdown (prefix BM)** ตั้งแต่ 14/10 · closed_all = ทุกประเภท (ไว้บอกบนจอว่าตัดไปเท่าไหร่)
     dt[]       {m, kind, events, breakdown_min}          ← downtime_logs นอกแผนที่ปิดแล้ว ตามชนิดอุปกรณ์ (machines.equipment_kind)
     machines[] {kind, n}                                  ← เครื่อง active ต่อชนิด
     months[]   เดือนที่มี downtime_logs (เดือนที่ไม่มีเลย = "ไม่มีข้อมูล" ไม่ใช่ 0)

   🔴 ข้อสมมติที่ต้องเขียนบนจอเสมอ (ไม่ใช่ซ่อน):
     · "730" = ชั่วโมงต่อเดือนคงที่ตามเอกสาร (ไม่ใช่ชั่วโมงเดินเครื่องจริง) — ค่า MTBF จึงเทียบกับ `mtnMetrics`
       (ที่ใช้เวลาเดินเครื่องจริง) ไม่ได้ · จอ KPI ใช้ตัวนี้เพราะใบทางการใช้ตัวนี้
     · Machine Break Down: เอกสารเขียนตัวหารว่า "ชั่วโมงที่เครื่องทำงานได้ปกติ" โดยไม่นิยามเพิ่ม —
       ใช้ฐานเดียวกับ MTBF ในเอกสารเดียวกัน = 730 × จำนวนเครื่อง (`ASSUMPTION_MBD`) · เปลี่ยนฐานที่นี่ที่เดียว
     · ชนิดอุปกรณ์ที่ทีมดูแล มาจาก `mtn_teams.equip_type` (data-driven) — JIG MTN = jig · MTN = machine · DIE MTN = die
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export const HOURS_PER_MONTH = 730;   // ตามเอกสาร KPI Guideline 2026 หน้า 10 — ห้ามเปลี่ยนเป็นชั่วโมงจริงเงียบๆ
export const ASSUMPTION_MBD = `ตัวหาร "ชั่วโมงที่เครื่องทำงานได้ปกติ" ใช้ฐาน ${HOURS_PER_MONTH} ชม./เครื่อง/เดือน (ฐานเดียวกับ MTBF ในเอกสาร)`;

/** KPI ช่างที่ระบบคำนวณให้ได้ — จับคู่กับแถวนิยามด้วยชื่อ (ทะเบียนมาตรฐานสะกดตามนี้) */
export const MTN_AUTO_KPIS = [
  { key: 'mo_on_target', label: 'MO Closed on target', unit: '%',   match: /mo\s*closed|closed\s*on\s*target/i,
    formula: '(MO Closed on target ÷ Total MO) × 100', note: 'นับเฉพาะใบประเภท Breakdown (BM) ที่ซ่อมเสร็จในเดือนนั้น — ทุกทีมช่างใช้เกณฑ์เดียวกัน (คำสั่ง user 14/10) · ตรงเป้า = เสร็จไม่เกินกำหนดที่ตั้งในใบ · ใบที่ไม่ได้ตั้งกำหนดนับเป็น "ไม่ตรงเป้า" และบอกจำนวนไว้' },
  { key: 'mbd',          label: 'Machine Break Down',  unit: '%',   match: /break\s*down/i,
    formula: `(ชม.เครื่องหยุด ÷ (${HOURS_PER_MONTH} × จำนวนเครื่อง)) × 100`, note: ASSUMPTION_MBD },
  { key: 'mtbf',         label: 'MTBF',                unit: 'ชม.', match: /mtbf|between\s*failure/i,
    formula: `[(${HOURS_PER_MONTH} × จำนวนเครื่อง) − ชม.เสียรวม] ÷ จำนวนเครื่อง`,
    /* 🔴 เขียนให้ชัดว่าค่านี้วัดอะไรจริงๆ — ตัวหารเป็น "จำนวนเครื่อง" ⇒ มันคือชั่วโมงเดินเฉลี่ย
       ต่อเครื่อง ไม่ใช่ "ระยะห่างระหว่างการเสีย" ตามความหมายของตัวย่อ (11/11 · คำสั่ง user) */
    note: `${HOURS_PER_MONTH} = ชั่วโมง/เดือนคงที่ตามเอกสาร · ค่านี้คือ "ชั่วโมงเดินเฉลี่ยต่อเครื่อง" (ตัวหาร = จำนวนเครื่อง ไม่ใช่จำนวนครั้งที่เสีย)` },
  { key: 'mttr',         label: 'MTTR',                unit: 'ชม.', match: /mttr|time\s*to\s*repair/i,
    formula: 'ชม.เสียรวม ÷ จำนวนครั้งที่เสีย', note: 'เฉพาะ downtime นอกแผนที่ปิดแล้ว (ยังไม่ปิด = ยังไม่รู้ว่านานเท่าไหร่)' },
];

/** จับคู่แถวนิยาม KPI (ชื่อจากทะเบียน/ที่พิมพ์) → KPI อัตโนมัติ · ไม่เข้าคู่ = null (แถวกรอกมือปกติ) */
export function autoKpiOfName(name) {
  const s = String(name || '');
  return MTN_AUTO_KPIS.find(k => k.match.test(s)) || null;
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const div = (a, b) => (b > 0 ? a / b : null);   // หารศูนย์ = ไม่รู้ ห้ามคืน 0

/**
 * คำนวณ 12 เดือนของทีมช่างหนึ่งจากผลรวมของ RPC
 * @param roll     ผลจาก kpi_mtn_rollup ({ mo, dt, machines, months })
 * @param year     ปี ค.ศ.
 * @param team     { key: 'jig_maintenance', equip_type: 'jig' }  (จาก mtn_teams / pmTeams)
 * @returns { months: [{k:'2026-01', mo_on_target, mbd, mtbf, mttr, closed, on_target, no_target, events, breakdown_hr, hasData}], machines }
 *   ค่า null = คำนวณไม่ได้ (ไม่มีข้อมูล/ตัวหารศูนย์) — จอต้องเขียน ไม่ใช่โชว์ 0
 */
export function mtnAutoSeries(roll, year, team) {
  const teamKey = team?.key || null;
  const kind = team?.equip_type || null;
  const machines = (roll?.machines || []).filter(x => !kind || x.kind === kind).reduce((s, x) => s + num(x.n), 0);
  const withData = new Set(roll?.months || []);
  const out = [];
  for (let i = 1; i <= 12; i++) {
    const k = `${year}-${String(i).padStart(2, '0')}`;
    const mo = (roll?.mo || []).filter(x => x.m === k && (!teamKey || x.team === teamKey));
    const dt = (roll?.dt || []).filter(x => x.m === k && (!kind || x.kind === kind));
    const closed = mo.reduce((s, x) => s + num(x.closed), 0);
    const onT = mo.reduce((s, x) => s + num(x.on_target), 0);
    const noT = mo.reduce((s, x) => s + num(x.no_target), 0);
    // RPC รุ่นก่อน 14/10 ไม่มี closed_all ⇒ null (ไม่รู้) ห้ามเดาเท่ากับ closed
    const allC = mo.some(x => x.closed_all != null) ? mo.reduce((s, x) => s + num(x.closed_all), 0) : null;
    const events = dt.reduce((s, x) => s + num(x.events), 0);
    const bdHr = dt.reduce((s, x) => s + num(x.breakdown_min), 0) / 60;
    const hasDt = withData.has(k);
    const avail = HOURS_PER_MONTH * machines;
    const r = {
      k, machines, closed, closed_all: allC, on_target: onT, no_target: noT, events, breakdown_hr: bdHr, hasData: hasDt || closed > 0,
      mo_on_target: closed > 0 ? (onT / closed) * 100 : null,
      // เดือนที่มีข้อมูล downtime แต่ชนิดนี้ไม่เสียเลย = 0% / MTBF เต็ม 730 (ถูกต้อง ไม่ใช่ "ไม่มีข้อมูล")
      mbd: hasDt && avail > 0 ? (bdHr / avail) * 100 : null,
      mtbf: hasDt && machines > 0 ? (avail - bdHr) / machines : null,
      /* ⏱️ **"ชม.เดินต่อการเสีย 1 ครั้ง"** (ชื่อที่ user เคาะ 11/11) — ตัวหาร = **จำนวนครั้งที่เสีย**
         🔴 **ไม่ใช่ค่าทางการ ห้ามเอาไปส่งกลุ่ม** — ของทางการคือ `mtbf` ด้านบน (เอกสารหน้า 10)
         🔴 **ห้ามตั้งชื่อที่มีคำว่า MTBF** (เช่น "MTBF สากล"/"MTBF จริง") — บนใบที่ส่งกลุ่ม
            มันอ่านเป็นการบอกว่าสูตรบริษัทผิด · ตั้งชื่อด้วย**หน่วย** จึงชนกับของทางการไม่ได้
         ทำไมต้องมี: สูตรทางการหารด้วย*จำนวนเครื่อง* ⇒ ค่าเกาะ 730 ทุกเดือน แยกเดือนดี/แย่ไม่ออก
           machine ก.ย. 728.7 · ต.ค. 726.9 (ขยับ 0.25% ทั้งที่ ต.ค. เสีย 2 เท่า · ชม.เสีย 2.4 เท่า)
           ตัวนี้: ก.ย. 211.4 · ต.ค. 103.6 = ลดลงครึ่งหนึ่ง ตรงกับที่หน้างานเจอจริง
         📄 docs/OBEYA-KPI-SOURCES.md §15.2 (ใบเป้าทางการเองก็ใช้คนละสูตรกันระหว่างทีม) */
      hr_per_fail: hasDt && events > 0 ? div(avail - bdHr, events) : null,
      mttr: hasDt ? (events > 0 ? div(bdHr, events) : null) : null,
    };
    out.push(r);
  }
  return { months: out, machines };
}

/* ══ 📊 แตกชั่วโมง "ไลน์หยุด" เป็นช่วง — เลขตัวเดียวกัน ไม่มีตรงไหนหายไป ══  2026-11-11
   คำสั่ง user: *"ให้โชว์กราฟแท่งแบบนี้ เพื่อให้เห็นว่าเลขตัวเดียวกัน ไม่ได้มีตรงไหนหายไป
   แต่บอกได้ว่าไปอยู่ช่วงไหน"* (ไดอะแกรมที่ user วาด — ดู `utils/mtnTimeline.js`)

   🔴 **ตัวตั้งคือ "ไลน์หยุด" (Line stop) ซึ่งเป็นเลขเดียวกับที่ KPI ทางการใช้** — ไม่ใช่เลขชุดใหม่
      ⇒ ①+②+③+④+ยังแบ่งไม่ได้ **ต้องเท่ากับ `breakdown_hr` เป๊ะ** (ฝั่ง SQL clamp มาให้แล้ว)
   🔴 **"ยังแบ่งไม่ได้" ห้ามหาย** — ต.ค. 2026 ฝั่ง machine แบ่งได้ 162.7 จาก 810.1 ชม. (20%)
      ที่เหลือ 647.6 ชม. คือครั้งที่ไม่มีใบ MO (1,493 จาก 1,818 ครั้ง) ⇒ ไม่มี stamp ให้แบ่ง
      นี่คือ "ข้อมูลที่ขาด" ที่ต้องเห็นบนจอ ไม่ใช่สิ่งที่ควรซ่อนเพราะแท่งจะได้สวย
   🔴 RPC รุ่นก่อน 11/11 ไม่มี `seg_*` ⇒ `known:false` ห้ามคืน 0 */
export function mtnSegSeries(roll, year, team) {
  const kind = team?.equip_type || null;
  const rows = (roll?.dt || []).filter(x => !kind || x?.kind === kind);
  if (!rows.length || !rows.some(x => x?.seg_unsplit_min != null)) {
    return { known: false, parts: [], unknownHr: 0, totalHr: 0, moEvents: 0, events: 0 };
  }
  const yr = String(year);
  const mine = rows.filter(x => String(x?.m || '').startsWith(yr));
  const sum = (f) => mine.reduce((s, x) => s + num(x[f]), 0) / 60;
  return {
    known: true,
    totalHr: sum('breakdown_min'),
    parts: [
      { key: 'precall', label: '① ก่อนเรียกช่าง', hr: sum('seg_precall_min') },
      { key: 'mtta',    label: '② MTTA รอช่างรับงาน', hr: sum('seg_mtta_min') },
      { key: 'ttr',     label: '③ TTR เวลาซ่อม', hr: sum('seg_ttr_min') },
      { key: 'restart', label: '④ คืนไลน์ (Restart)', hr: sum('seg_restart_min') },
    ],
    unknownHr: sum('seg_unsplit_min'),
    events: mine.reduce((s, x) => s + num(x.events), 0),
    moEvents: mine.reduce((s, x) => s + num(x.mo_events), 0),
    /* M/C Breakdown ตามที่ user วาด = Line stop − ④ คืนไลน์ (ไม่ใช่ค่าทางการ — ของทางการคือ Line stop เต็ม) */
    mcBreakdownHr: sum('mc_breakdown_min'),
  };
}

/* ══ 🕳️ "ชั่วโมงที่ยังชี้เจ้าของไม่ได้" ══════════════════════════  2026-11-11
   คำสั่ง user: *"single source truth ต้องไม่มีค่าไหนหายไป แต่ต้องเคาะว่าจะไปอยู่ตรงไหน"*

   🔴 **แยกเป็นฟังก์ชันของมันเอง ไม่ยัดเข้า `mtnAutoSeries(team)` โดยเจตนา** —
      ชั่วโมงกลุ่มนี้คือชั่วโมงที่ "ไม่รู้ว่าเป็นอุปกรณ์ชนิดไหน" ⇒ **ชี้ทีมไม่ได้**
      ถ้าคืนปนไปกับค่าของทีม จอจะเผลอบวกเข้า KPI ทีมใดทีมหนึ่ง = เดาเจ้าของ (ผิดกฎ)
      ⇒ เป็นยอด **รวมทั้งโรงงาน** จอต้องเขียนกำกับแบบนั้นเสมอ

   แยก 2 เหตุเพราะ **คนละทางแก้** (ยุบรวม = ไล่แก้ผิดที่):
     `no_machine_no` ไม่ได้กรอกเลขเครื่องตอนลง downtime → แก้ที่ช่องกรอก/คนกรอก
     `not_in_master` กรอกแล้วแต่ไม่มีในทะเบียน         → แก้ที่ทะเบียนเครื่อง `/machines`
   วัดจริง ต.ค. 2026: ไม่กรอก 192 ครั้ง/111.9 ชม. · ไม่มีในทะเบียน 106 ครั้ง/24.6 ชม.
   (ตัวที่ขาดเกือบทั้งหมดเป็นจิ๊ก — JIG-005 · JIG-004#A · JIG LUBE BENDING · CONVEYOR)

   🔴 RPC รุ่นก่อน 11/11 ไม่มี `dt_gap` ⇒ คืน `known:false` **ห้ามคืน 0**
      (0 = "ไม่มีชั่วโมงตกหล่น" คนละเรื่องกับ "ยังไม่รู้") */
export function mtnGapSeries(roll, year) {
  const rows = Array.isArray(roll?.dt_gap) ? roll.dt_gap : null;
  if (!rows) return { known: false, months: [], top: [], totalHr: 0 };
  const months = [];
  for (let i = 1; i <= 12; i++) {
    const k = `${year}-${String(i).padStart(2, '0')}`;
    const mine = rows.filter(x => x?.m === k);
    const pick = (reason) => {
      const r = mine.filter(x => x?.reason === reason);
      return { events: r.reduce((s, x) => s + num(x.events), 0),
               hr: r.reduce((s, x) => s + num(x.mins), 0) / 60 };
    };
    const noNo = pick('no_machine_no');
    const notMaster = pick('not_in_master');
    months.push({ k, noNo, notMaster, hr: noNo.hr + notMaster.hr, any: mine.length > 0 });
  }
  return {
    known: true,
    months,
    top: (Array.isArray(roll?.dt_gap_top) ? roll.dt_gap_top : [])
      .map(x => ({ machineNo: x?.machine_no || '', events: num(x?.events), hr: num(x?.mins) / 60 })),
    totalHr: months.reduce((s, x) => s + x.hr, 0),
  };
}

/** หน่วยที่ "สูตรทางการ" บังคับ — ตรวจว่าหน่วยที่คนตั้งในนิยาม/ทะเบียนขัดกับสูตรไหม (2026-10-13)
 *  เคสจริง: ทีม MTN แก้ทะเบียนกลาง Machine Break Down จาก % เป็น "Hrs." แล้วคีย์ค่ากรอกมือเป็นชั่วโมง
 *  ⇒ บอร์ดเอา "ชั่วโมง" (กรอกมือ) วางข้าง "%" (ระบบคำนวณ) ในแผ่นเดียวกัน · สูตรหน้า 10 คูณ 100 = % เท่านั้น
 *  @returns null = ไม่ขัด/ไม่ใช่ KPI อัตโนมัติ/ยังไม่ตั้งหน่วย · { expect, got } = ขัด (จอเตือน ไม่บล็อก — ใบจริงบางใบใช้นาที) */
export function autoUnitMismatch(name, unit) {
  const ak = autoKpiOfName(name);
  const u = String(unit || '').trim().toLowerCase();
  if (!ak || !u) return null;
  if (ak.unit === '%') return u.includes('%') ? null : { expect: '%', got: unit };
  // MTBF/MTTR = หน่วยเวลา (ชม. หรือ นาที — toRowUnit แปลงให้) · อย่างอื่น เช่น % / ครั้ง = ขัด
  return /ชม|hr|hour|นาที|min/.test(u) ? null : { expect: ak.unit, got: unit };
}

/** ข้อความ "ที่มาของเลข" ต่อเดือน สำหรับแถว auto — user 13/10 "อยากเห็น hrs. ด้วย" ทั้งที่ KPI เป็น %
 *  ⇒ ตัวตั้ง/ตัวหารต้องโผล่บนจอคู่กับ % (tooltip + บรรทัดรองของแผ่น) ไม่ใช่เปลี่ยนหน่วย KPI */
export function autoDetailText(m, autoKey) {
  if (!m) return '';
  const hr = (v) => (v == null ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 1 }));
  if (autoKey === 'mo_on_target') return `ตรงเป้า ${m.on_target ?? 0}/${m.closed ?? 0} ใบ BM${m.no_target ? ` · ไม่ตั้งกำหนด ${m.no_target}` : ''}${m.closed_all != null && m.closed_all > (m.closed ?? 0) ? ` · ไม่นับงานประเภทอื่น ${m.closed_all - (m.closed ?? 0)} ใบ` : ''}`;
  if (autoKey === 'mbd' || autoKey === 'mtbf') return `หยุด ${hr(m.breakdown_hr)} ชม. · ${m.events ?? 0} ครั้ง · ${m.machines ?? 0} เครื่อง`;
  if (autoKey === 'mttr') return `หยุด ${hr(m.breakdown_hr)} ชม. ÷ ${m.events ?? 0} ครั้ง`;
  return '';
}

/** แปลงหน่วยให้ตรงกับที่แถวนิยามตั้งไว้ — MTBF/MTTR ใบ JIG ใช้ "นาที" เด็คใช้ "ชม." (docs §12.3) */
export function toRowUnit(value, autoKey, rowUnit) {
  if (value == null) return null;
  const u = String(rowUnit || '').toLowerCase();
  if ((autoKey === 'mtbf' || autoKey === 'mttr') && /นาที|min/.test(u)) return value * 60;
  return value;
}
