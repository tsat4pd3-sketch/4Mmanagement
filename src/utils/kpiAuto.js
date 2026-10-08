/* ══ kpiAuto — KPI ที่ระบบคำนวณเองตาม "สูตรทางการ" ใน KPI Guideline 2026 (pure · ห้าม import supabase/DOM) ══
   2026-09-24 · user ส่ง `KPI_Guideline_2026_As_of_29.01.2026.pdf` ซ้ำ ("เคยส่งให้แล้ว ดูให้ละเอียดอีกรอบ")
   → หน้า 10 ตาราง "Maintenance" กำหนดสูตรครบทั้ง 4 ตัว (docs/OBEYA-KPI-SOURCES.md §15.2) — **ไม่ต้องรอเคาะอะไรอีก**

   สูตร (verbatim จากหน้า 10):
     MO Closed on target = (MO Closed on target / Total MO) × 100
     Machine Break Down  = (No. of hours the machine has been stopped / No. of hours the machine can work normally) × 100
     MTBF                = [(730 × Number of machines) − Total breakdown times] / Number of machines
     MTTR                = Total hours of breakdown / Total frequency times

   ที่มาตัวเลข = RPC `kpi_mtn_rollup` (DR · Σ ต่อเดือน ไม่หาร) — migration `20260924_kpi_mtn_rollup_dr.sql`
     mo[]       {m, team, closed, on_target, no_target}   ← mtn_orders ตามทีมช่าง (mtn_dept)
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
    formula: '(MO Closed on target ÷ Total MO) × 100', note: 'นับใบที่ซ่อมเสร็จในเดือนนั้น · ตรงเป้า = เสร็จไม่เกินกำหนดที่ตั้งในใบ · ใบที่ไม่ได้ตั้งกำหนดนับเป็น "ไม่ตรงเป้า" และบอกจำนวนไว้' },
  { key: 'mbd',          label: 'Machine Break Down',  unit: '%',   match: /break\s*down/i,
    formula: `(ชม.เครื่องหยุด ÷ (${HOURS_PER_MONTH} × จำนวนเครื่อง)) × 100`, note: ASSUMPTION_MBD },
  { key: 'mtbf',         label: 'MTBF',                unit: 'ชม.', match: /mtbf|between\s*failure/i,
    formula: `[(${HOURS_PER_MONTH} × จำนวนเครื่อง) − ชม.เสียรวม] ÷ จำนวนเครื่อง`, note: `${HOURS_PER_MONTH} = ชั่วโมง/เดือนคงที่ตามเอกสาร` },
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
    const events = dt.reduce((s, x) => s + num(x.events), 0);
    const bdHr = dt.reduce((s, x) => s + num(x.breakdown_min), 0) / 60;
    const hasDt = withData.has(k);
    const avail = HOURS_PER_MONTH * machines;
    const r = {
      k, machines, closed, on_target: onT, no_target: noT, events, breakdown_hr: bdHr, hasData: hasDt || closed > 0,
      mo_on_target: closed > 0 ? (onT / closed) * 100 : null,
      // เดือนที่มีข้อมูล downtime แต่ชนิดนี้ไม่เสียเลย = 0% / MTBF เต็ม 730 (ถูกต้อง ไม่ใช่ "ไม่มีข้อมูล")
      mbd: hasDt && avail > 0 ? (bdHr / avail) * 100 : null,
      mtbf: hasDt && machines > 0 ? (avail - bdHr) / machines : null,
      mttr: hasDt ? (events > 0 ? div(bdHr, events) : null) : null,
    };
    out.push(r);
  }
  return { months: out, machines };
}

/** แปลงหน่วยให้ตรงกับที่แถวนิยามตั้งไว้ — MTBF/MTTR ใบ JIG ใช้ "นาที" เด็คใช้ "ชม." (docs §12.3) */
export function toRowUnit(value, autoKey, rowUnit) {
  if (value == null) return null;
  const u = String(rowUnit || '').toLowerCase();
  if ((autoKey === 'mtbf' || autoKey === 'mttr') && /นาที|min/.test(u)) return value * 60;
  return value;
}
