/* ══════════════════════════════════════════════════════════════════════════
   📋 prodRoutine — "งานประจำกะของฝ่ายผลิตที่ยังไม่ทำ" · pure function ล้วน (2026-10-12)

   ที่มา (user 12/10): *"เครื่องจักรยังไม่ตรวจ AM หรืองาน routine อื่นๆ ที่ผลิตต้องทำก็ควรจะโชว์นะ"*
   ใช้บนจอ TV ฝ่ายผลิต (`/tv?dept=production`) — โหลด/วาดอยู่ที่ `components/ProdRoutineCard.jsx`

   งานประจำ 3 ระบบ (= แท็บของ `/daily-checker`) — ตัดสินแยกกัน แล้วรวมเป็นแถวต่อไลน์:
     ① AM รายวัน — **ไม่ได้ตัดสินที่นี่** ใช้ `dailyAmLineStatus()` (`lib/dailyAmBoard.js`) ที่เดียวทั้งระบบ
        (กฎ CLAUDE.md: "กะนี้ AM ตรวจแล้วหรือยัง" มีที่เดียว) · ไฟล์นี้แค่รับผลมารวมแถว
     ② Poka-Yoke — อุปกรณ์ที่ลงทะเบียนในไลน์ (`pokayoke_devices.is_active`) ยังไม่มีผลทดสอบของ
        วันงาน+กะนี้ (`pokayoke_checks` unique device+date+shift) → `pokayokeByLine()`
     ③ LPA — วันนี้มีแผนตรวจชั้นไหน (`lpa_plan_days.plan_<ชั้น>`) แต่ยังไม่มีใบตรวจของ
        ไลน์+กะ+วัน+ชั้นนั้น (`lpa_audits`) → `lpaByLine()` (กติกา ○/● เดียวกับหน้า `/lpa`)

   🔴 นับเฉพาะ **ไลน์ที่เปิดกะอยู่** (ไลน์ไม่ผลิต ยังไม่ต้องทำงานประจำกะ — โชว์ = กำแพงแดงทั้งโรงงาน)
      · AM ใช้เกณฑ์ของตัวเอง (`notStarted` = ยังไม่เปิดใบผลิต = ยังไม่ต้องตรวจ) ไม่นับเป็นค้าง
   🔴 ทะเบียนว่าง ≠ ทำครบ — ไลน์ที่ไม่ได้ลงทะเบียนอุปกรณ์/แผนไว้เลย ไม่ใช่ "เขียว" จอต้องบอกว่ากี่ไลน์ไม่มีทะเบียน
   ══════════════════════════════════════════════════════════════════════════ */

/** ชั้นผู้ตรวจ LPA — ที่เดียวทั้งระบบ (หน้า `/lpa` import จากที่นี่) */
export const LPA_LAYERS = [
  { key: 'leader', label: 'Leader', freq: 'ทุกวัน', planKey: 'plan_leader' },
  { key: 'supervisor', label: 'Supervisor', freq: 'รายสัปดาห์', planKey: 'plan_supervisor' },
  { key: 'manager', label: 'Manager', freq: 'รายเดือน', planKey: 'plan_manager' },
  { key: 'gm', label: 'GM', freq: 'รายไตรมาส', planKey: 'plan_gm' },
];

/**
 * Poka-Yoke ต่อไลน์ของกะนี้
 * @param {object[]} devices  pokayoke_devices (id, line_name, name, code, is_active)
 * @param {object[]} checks   pokayoke_checks ของวันงาน+กะนี้ (device_id, result)
 * @param {Set<string>} openLines  ไลน์ที่เปิดกะอยู่
 * @returns {{ [line]: { total, done, ng, missing: string[], ngNames: string[] } }}  เฉพาะไลน์ที่เปิดกะ
 */
export function pokayokeByLine(devices = [], checks = [], openLines = new Set()) {
  const chk = new Map(checks.map(c => [c.device_id, c]));
  const out = {};
  for (const d of devices) {
    if (d.is_active === false || !d.line_name || !openLines.has(d.line_name)) continue;
    const g = (out[d.line_name] ||= { total: 0, done: 0, ng: 0, missing: [], ngNames: [] });
    g.total++;
    const label = d.code ? `${d.code} ${d.name}` : d.name;
    const c = chk.get(d.id);
    if (!c) g.missing.push(label);
    else { g.done++; if (c.result === 'fail') { g.ng++; g.ngNames.push(label); } }
  }
  return out;
}

/**
 * LPA ต่อไลน์ของวันนี้+กะนี้
 * @param {object[]} plans   lpa_plans ของเดือนนี้+กะนี้ พร้อม `lpa_plan_days` (embed)
 * @param {object[]} audits  lpa_audits ของวันนี้+กะนี้ (line_name, layer)
 * @param {number} day       วันที่ของเดือน (1-31) ของวันงาน
 * @param {Set<string>} openLines
 * @returns {{ [line]: { planned: string[], missing: string[] } }}  label ของชั้น
 */
export function lpaByLine(plans = [], audits = [], day, openLines = new Set()) {
  const done = new Set(audits.map(a => `${a.line_name}|${a.layer}`));
  const out = {};
  for (const p of plans) {
    if (!p.line_name || !openLines.has(p.line_name)) continue;
    const pd = (p.lpa_plan_days || []).find(x => Number(x.day) === Number(day));
    if (!pd) continue;
    for (const L of LPA_LAYERS) {
      if (!pd[L.planKey]) continue;
      const g = (out[p.line_name] ||= { planned: [], missing: [] });
      g.planned.push(L.label);
      if (!done.has(`${p.line_name}|${L.key}`)) g.missing.push(L.label);
    }
  }
  return out;
}

/**
 * รวม 3 ระบบเป็นแถวต่อไลน์ — เฉพาะไลน์ที่ยังมีงานค้าง · เรียง: มี NG/เลยกรอบ AM ก่อน → ค้างมากก่อน → ชื่อ
 * @param {{ am:object, poka:object, lpa:object }} p   am = ผลของ dailyAmLineStatus()
 * @returns {{ rows: object[], counts: { am:number, amLate:number, poka:number, lpa:number, ng:number, lines:number } }}
 */
export function routineRows({ am = {}, poka = {}, lpa = {} } = {}) {
  const lines = new Set([...Object.keys(am), ...Object.keys(poka), ...Object.keys(lpa)]);
  const rows = [];
  const counts = { am: 0, amLate: 0, poka: 0, lpa: 0, ng: 0, lines: 0 };
  for (const line of lines) {
    const a = am[line];
    // AM ค้าง = ยังไม่ตรวจหลังไลน์เปิดใบผลิตแล้ว (รอในกรอบ + เลยกรอบ) · notStarted ไม่นับ
    const amMissing = a ? (a.late || 0) + (a.wait || 0) : 0;
    const amNames = a && amMissing ? (a.missing || []).map(m => m.name || m.machine_no).filter(Boolean) : [];
    const pk = poka[line];
    const lp = lpa[line];
    const ng = (a?.ngN || 0) + (pk?.ng || 0);
    const n = amMissing + (pk?.missing.length || 0) + (lp?.missing.length || 0);
    if (!n && !ng) continue;
    rows.push({
      line, ng,
      ngNames: [...(a?.ng || []).map(m => `AM ${m.name || m.machine_no || ''}`.trim()), ...(pk?.ngNames || []).map(x => `Poka-Yoke ${x}`)],
      am: amMissing ? { n: amMissing, late: a.late || 0, total: a.total, names: amNames } : null,
      poka: pk?.missing.length ? { n: pk.missing.length, total: pk.total, names: pk.missing } : null,
      lpa: lp?.missing.length ? { layers: lp.missing } : null,
    });
    counts.am += amMissing; counts.amLate += a?.late || 0;
    counts.poka += pk?.missing.length || 0; counts.lpa += lp?.missing.length || 0; counts.ng += ng;
  }
  rows.sort((x, y) => ((y.ng > 0) - (x.ng > 0)) || ((y.am?.late || 0) > 0) - ((x.am?.late || 0) > 0)
    || (sumOf(y) - sumOf(x)) || x.line.localeCompare(y.line));
  counts.lines = rows.length;
  return { rows, counts };
}
const sumOf = (r) => (r.am?.n || 0) + (r.poka?.n || 0) + (r.lpa?.layers.length || 0);

/** สีบนผังของไลน์ที่งานประจำกะค้าง (12/10 · user "ระบายสีไลน์ที่งานประจำค้างบนผังด้วย")
 *  ⚠️ **ห้ามใช้แดง/ส้ม/เหลือง** — 3 สีนั้นบนผังเป็นของสถานะเครื่อง (เรียกช่าง/หยุดเกินเกณฑ์/เพิ่งหยุด)
 *     ใช้สีเดียวกัน = คนอ่านว่าเครื่องหยุดทั้งที่แค่ยังไม่ได้ตรวจ · ฟ้าอมเขียว = "มีงานต้องทำ" แยกจากทุกสีที่มีอยู่
 *     (ม่วง = ไลน์เรียกของบนจอสโตร์) · ไม่กระพริบ (กฎ Andon: กระพริบเฉพาะแดงของเครื่อง) */
export const ROUTINE_MAP_COLOR = '#06b6d4';

/**
 * ป้ายบนผังต่อไลน์ จากผลของ routineRows() — สั้นพอวางในกรอบไลน์
 * ผิดปกติ (NG) ขึ้นก่อน → AM → Poka-Yoke → LPA · ทุกป้ายสีเดียวกัน แยกด้วยข้อความ
 * @returns {{ [line]: { color, label } }}
 */
export function routineMapOf(rows = []) {
  const out = {};
  for (const r of rows) {
    const parts = [];
    if (r.ng > 0) parts.push(`NG ${r.ng}`);
    if (r.am) parts.push(`AM ${r.am.n}${r.am.late ? '!' : ''}`);
    if (r.poka) parts.push(`PY ${r.poka.n}`);
    if (r.lpa) parts.push('LPA');
    if (parts.length) out[r.line] = { color: ROUTINE_MAP_COLOR, label: `📋 ${parts.join(' · ')}` };
  }
  return out;
}
