/* ══ 🏛️ obeyaYear — จอ SQDCM โหมด "ปี" (12 แท่งรายเดือน + แท่งสรุป + YTD) ═══════════════════
   คำสั่ง user 2026-09-22: "อยากให้มีรายปี กราฟโชว์แต่ละเดือน เดือนไหนแดง คลิก drill-down เข้าไปดูรายวัน
   ของเดือนนั้น · ปีปฏิทิน 12 แท่ง + แท่งที่ 13 คือ averaged/total แล้วแต่ KPI นั้นๆ และมีตัวเลข YTD ด้วย"

   ── ทำไมแยกไฟล์จาก obeyaKpi.js ─────────────────────────────────────────────────────────
   โหมดสัปดาห์/เดือนโหลด "แถวดิบ" (กะ · downtime · defect · ใบงาน · เช็คชื่อ) แล้ว obeyaKpi
   คำนวณต่อวัน — ทั้งปีโหลดแบบเดียวกัน ≈ 5 MB/รอบ ⇒ จอที่รีเฟรชเองจะกินโควต้า egress หมด
   ⇒ โหมดปีอ่าน **ผลรวมรายเดือน** จาก RPC 2 ตัว (obeya_year_rollup ฝั่ง DR · obeya_attendance_rollup
   ฝั่ง Main — migration 20260922d_*) แล้วไฟล์นี้เป็นคน **หาร / ถ่วงน้ำหนัก / ตัดสิน** ⇒ RPC ห้ามคำนวณ KPI

   ── กฎของไฟล์นี้ (สืบทอดจาก obeyaKpi.js) ─────────────────────────────────────────────────
   1. pure function ล้วน · รับ `today` เข้ามา ห้ามแตะนาฬิกา (กฎ "เทสระเบิดเวลา")
   2. **ห้ามเฉลี่ยเปอร์เซ็นต์ตรงๆ** — ทุกค่าเฉลี่ยของปี/YTD ถ่วงด้วยน้ำหนักเดียวกับโหมดเดือน:
      OEE·A ถ่วง wLoad (= shift_min) · P ถ่วง wRun · Q ถ่วง wProd (นิยามใน oee.js — SQL ส่ง Σ มาให้แล้ว)
      ⇒ "แท่งที่ 13" ของ KPI อัตราส่วน = ค่าถ่วงน้ำหนักทั้งช่วง (ไม่ใช่ mean ของ 12 แท่ง) · ของ KPI จำนวน (บาท) = ผลรวม
   3. เดือนที่ยังไม่มีข้อมูล = `v: null` **ห้ามเป็น 0** (เดือนในอนาคตต้องเป็นช่องว่าง ไม่ใช่แท่งแดง)
   4. YTD = ถึงเดือนล่าสุดที่มีข้อมูล (ปีย้อนหลัง = ทั้งปี) — เลขใหญ่บนแผ่นคือค่านี้
   ════════════════════════════════════════════════════════════════════════════════════════ */
import { round1, statusOf, Q_THIN_DEFECT_ROWS } from './obeyaKpi.js';
import { scoreDef } from './kpiSetup.js';
import { DEFAULT_OEE_TARGET } from './oee.js';

/* ── ช่วงเวลา ─────────────────────────────────────────────────────────────────────── */
export const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const SUMMARY_KEY = 'ALL';           // คีย์ของแท่งที่ 13

export const yearOf = (today) => Number(String(today).slice(0, 4));
export const monthKeys = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
export const monthLabel = (k) => (k === SUMMARY_KEY ? 'สรุป' : MONTH_TH[Number(String(k).slice(5, 7)) - 1] || k);
export const lastDayOf = (k) => { const [y, m] = String(k).split('-').map(Number); return new Date(y, m, 0).getDate(); };

/** ปีปฏิทิน — ปีปัจจุบันตัดที่ `today` (เดือนถัดไปยังไม่เกิด) · ปีย้อนหลัง = ทั้งปี */
export function yearRange(year, today) {
  const y = Number(year);
  const to = yearOf(today) === y ? String(today) : `${y}-12-31`;
  return { from: `${y}-01-01`, to: to < `${y}-01-01` ? `${y}-01-01` : to };
}
/** ช่วงของ 1 เดือนที่ระบุ (ใช้ตอน drill-down จากแท่งเดือน) — เดือนปัจจุบันตัดที่ `today` */
export function monthRange(monthKey, today) {
  const k = String(monthKey).slice(0, 7);
  const from = `${k}-01`;
  const end = `${k}-${String(lastDayOf(k)).padStart(2, '0')}`;
  const to = String(today) < end ? String(today) : end;
  return { from, to: to < from ? from : to };
}
/** เดือนก่อนหน้าของ monthKey แบบเทียบ "วันเดียวกันของเดือน" (กติกาเดียวกับ prevRange('month')) */
export function prevMonthRange(monthKey, today) {
  const { from, to } = monthRange(monthKey, today);
  const [y, m] = from.split('-').map(Number);
  const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const pk = `${pm.y}-${String(pm.m).padStart(2, '0')}`;
  const dom = Math.min(Number(to.slice(8, 10)), lastDayOf(pk));
  return { from: `${pk}-01`, to: `${pk}-${String(dom).padStart(2, '0')}` };
}

/* ── ตัวช่วยรวมเป็นรายเดือน ────────────────────────────────────────────────────────── */
const div = (num, den) => (den > 0 && num != null ? round1(num / den) : null);
const n = (x) => Number(x) || 0;

/** รวมแถว rollup (ที่กรอง scope แล้ว) เข้า map เดือน → acc · `add(acc, row)` เป็นคนบวก */
function byMonth(rows, seed, add) {
  const out = new Map();
  rows.forEach((r) => {
    const k = String(r.m || '').slice(0, 7);
    if (!k) return;
    if (!out.has(k)) out.set(k, seed());
    add(out.get(k), r);
  });
  return out;
}
/** รวม acc รายเดือนเข้า total — บวกทุกช่องตัวเลข (acc ทุกแกนเป็น "ผลรวม" ล้วน จึงบวกตรงๆ ได้) */
const mergeAcc = (total, acc) => { Object.keys(acc).forEach((k) => { total[k] = n(total[k]) + n(acc[k]); }); };
/** สร้าง series 12 เดือน + แท่งสรุป จาก map เดือน → acc · `val(acc)` แปลงเป็นค่าที่โชว์ */
function monthSeries(year, map, seed, val, summaryKind) {
  const total = seed();
  const series = monthKeys(year).map((k) => {
    const acc = map.get(k);
    if (!acc) return { k, v: null, empty: true };
    mergeAcc(total, acc);
    return { k, v: val(acc), acc };
  });
  const months = series.filter(p => !p.empty).length;
  const ytd = months ? val(total) : null;
  series.push({ k: SUMMARY_KEY, v: ytd, summary: true, kind: summaryKind, acc: total });
  return { series, ytd, total, months };
}

/* ════ OEE ════ rows จาก rollup.sessions: { m, line, n, wload, oee_w, a_wload, a_w, wrun, p_w, wprod, q_w, qty, ng } */
const seedOee = () => ({ n: 0, wload: 0, oee_w: 0, a_wload: 0, a_w: 0, wrun: 0, p_w: 0, wprod: 0, q_w: 0, qty: 0, ng: 0 });
const addOee = (a, r) => { Object.keys(a).forEach(k => { a[k] += n(r[k]); }); };
export function axisOeeYear({ rows = [], year, target = null } = {}) {
  const tg = target && target.oee != null ? target.oee
    : Math.round(DEFAULT_OEE_TARGET.a * DEFAULT_OEE_TARGET.p * DEFAULT_OEE_TARGET.q / 100) / 100;
  const map = byMonth(rows, seedOee, addOee);
  const { series, ytd, total, months } = monthSeries(year, map, seedOee, a => div(a.oee_w, a.wload), 'avg');
  return {
    key: 'OEE', unit: '%', better: 'up', target: tg,
    value: ytd, state: ytd == null ? 'none' : 'ok',
    note: ytd == null ? 'ยังไม่มีกะที่ปิดแล้วในปีนี้' : null,
    a: div(total.a_w, total.a_wload), p: div(total.p_w, total.wrun), q: div(total.q_w, total.wprod),
    shifts: total.n, months, series, summaryKind: 'avg',
  };
}

/* ════ Q ════ %Q ถ่วง wProd (จาก rollup.sessions) + จำนวนแถว defect ไว้เตือน thin (จาก rollup.defects) */
export function axisQualityYear({ rows = [], defects = [], year, target = null } = {}) {
  const tg = target && target.q != null ? target.q : DEFAULT_OEE_TARGET.q;
  const map = byMonth(rows, seedOee, addOee);
  const { series, ytd, months } = monthSeries(year, map, seedOee, a => div(a.q_w, a.wprod), 'avg');
  const defectRows = defects.reduce((s, d) => s + n(d.rows), 0);
  const ngQty = defects.reduce((s, d) => s + n(d.ng) - n(d.trial_ng), 0);   // line-mode = ไม่รวมงานทดลอง
  const thin = defectRows < Q_THIN_DEFECT_ROWS * Math.max(1, months);       // เกณฑ์เดิมคือ 400 แถว/เดือน
  return {
    key: 'Q', unit: '%', better: 'up', target: tg, defectRows, ngQty, months,
    value: ytd, series, summaryKind: 'avg',
    state: ytd == null ? 'none' : (thin ? 'thin' : 'ok'),
    note: ytd == null ? 'ยังไม่มีกะที่ปิดแล้วในปีนี้'
      : thin ? `บันทึกของเสียทั้งปีมี ${defectRows.toLocaleString()} รายการ — น้อยผิดปกติเทียบเวลาเครื่องหยุด แปลว่าบันทึกไม่ครบ อ่านเป็นแนวโน้มได้ แต่ยังใช้ตัดสินใจแทนหน้างานไม่ได้`
        : null,
  };
}

/* ════ S · M ════ rows จาก obeya_attendance_rollup (map station→line แล้ว): { m, line, n, present, ppe_ok, ot } */
const seedAtt = () => ({ n: 0, present: 0, ppe_ok: 0, ot: 0 });
const addAtt = (a, r) => { a.n += n(r.n); a.present += n(r.present); a.ppe_ok += n(r.ppe_ok); a.ot += n(r.ot); };
export function axisSafetyYear({ rows = [], year, target = 100 } = {}) {
  const map = byMonth(rows, seedAtt, addAtt);
  const { series, ytd, total } = monthSeries(year, map, seedAtt, a => div(a.ppe_ok * 100, a.present), 'avg');
  return {
    key: 'S', unit: '%', better: 'up', target, hasIncidentRegistry: false, checked: total.present,
    value: ytd, series, summaryKind: 'avg',
    state: ytd == null ? 'none' : 'thin',
    note: ytd == null ? 'ยังไม่มีบันทึกเช็คชื่อ/PPE ในปีนี้'
      // 🔴 ข้อความเดียวกับโหมดเดือน — ต้องอยู่บนจอจนกว่าจะมีทะเบียนอุบัติเหตุจริง
      : 'ยังไม่มีทะเบียนอุบัติเหตุ/near-miss — ตัวเลขนี้คือ "ใส่ PPE ครบตอนเช็คชื่อ" ไม่ใช่ผลด้านความปลอดภัย',
  };
}
export function axisManYear({ rows = [], year, target = 95 } = {}) {
  const map = byMonth(rows, seedAtt, addAtt);
  const { series, ytd, total } = monthSeries(year, map, seedAtt, a => div(a.present * 100, a.n), 'avg');
  return {
    key: 'M', unit: '%', better: 'up', target,
    value: ytd, series, summaryKind: 'avg',
    present: total.present, absent: total.n - total.present, ot: total.ot,
    state: ytd == null ? 'none' : 'ok',
    note: ytd == null ? 'ยังไม่มีบันทึกเช็คชื่อในปีนี้' : null,
  };
}

/* ════ D ════ rows จาก rollup.orders: { m, line, status, n, qty, qty_ok_fb, qty_actual }
   กติกาเดียวกับโหมดเดือน: แผน = Σqty ทุกสถานะ · ทำได้ = confirmed→qty_ok(??qty) · carry_over/imported→qty_actual */
const seedOrd = () => ({ plan: 0, made: 0 });
const addOrd = (a, r) => {
  a.plan += n(r.qty);
  if (r.status === 'confirmed') a.made += n(r.qty_ok_fb);
  else if (r.status === 'carry_over' || r.status === 'imported') a.made += n(r.qty_actual);
};
export function axisDeliveryYear({ rows = [], year, targetPct = 100 } = {}) {
  const map = byMonth(rows, seedOrd, addOrd);
  const { series, ytd, total } = monthSeries(year, map, seedOrd, a => div(a.made * 100, a.plan), 'avg');
  return {
    key: 'D', unit: '%', better: 'up', target: targetPct, plan: total.plan, produced: total.made,
    value: ytd, series, summaryKind: 'avg',
    state: ytd == null ? 'none' : 'ok',
    note: ytd == null ? 'ใบงานในปีนี้ยังไม่มีเป้าหมาย (qty) — เทียบแผนไม่ได้' : null,
  };
}

/* ════ C ════ มูลค่าความสูญเสีย = เครื่องหยุดนอกแผน × บาท/ชม. + ของเสีย × ต้นทุน/ชิ้น
   ผู้เรียกแปลง rollup.downtime / rollup.defects เป็นบาทมาก่อน (ต้องใช้ rate/cost ที่โหลดจาก DB — ไฟล์นี้ไม่โหลด)
   rows: { m, dt (บาท), ng (บาท) } · missingRate/missingCost = จำนวนไลน์/พาร์ทที่คิดไม่ได้ (ห้ามใส่ 0 แทน) */
const seedCost = () => ({ dt: 0, ng: 0 });
const addCost = (a, r) => { a.dt += n(r.dt); a.ng += n(r.ng); };
export function axisCostYear({ rows = [], year, target = null, missingRate = 0, missingCost = 0 } = {}) {
  const map = byMonth(rows, seedCost, addCost);
  const { series, total, months } = monthSeries(year, map, seedCost, a => Math.round(a.dt + a.ng), 'sum');
  const sum = total.dt + total.ng;
  const notes = [];
  if (missingRate) notes.push(`${missingRate} ไลน์ยังไม่ได้ตั้งอัตราค่าแรง/ชม. (cost center)`);
  if (missingCost) notes.push(`${missingCost} พาร์ทยังไม่มีต้นทุน/ชิ้น`);
  return {
    key: 'C', unit: 'บาท', better: 'down', target, months,
    value: sum > 0 ? Math.round(sum) : (notes.length || !months ? null : 0),
    dtBaht: Math.round(total.dt), ngBaht: Math.round(total.ng),
    series: series.map(p => (p.acc ? { ...p, dt: Math.round(p.acc.dt), ng: Math.round(p.acc.ng) } : p)),
    summaryKind: 'sum',
    state: notes.length ? 'thin' : (sum > 0 ? 'ok' : 'none'),
    note: notes.length ? `คิดได้ไม่ครบ: ${notes.join(' · ')}` : (sum > 0 ? null : 'ยังไม่มีความสูญเสียที่คิดเป็นเงินได้ในปีนี้'),
  };
}

/* ════ Pareto ทั้งปี ════ rows จาก rollup.downtime (กรอง scope แล้ว): { m, line, type, category, min } */
export function paretoYear(rows = [], top = 6) {
  const g = {};
  rows.forEach((r) => { if (r.category === 'planned') return; g[r.type || 'ไม่ระบุสาเหตุ'] = (g[r.type || 'ไม่ระบุสาเหตุ'] || 0) + n(r.min); });
  const all = Object.entries(g).map(([name, min]) => ({ name, min: Math.round(min) })).sort((a, b) => b.min - a.min);
  return { rows: all.slice(0, top), total: all.reduce((a, r) => a + r.min, 0) };
}

/** สีของแท่งรายเดือน — เดือนว่าง = เทา (ไม่ใช่แดง) · แท่งสรุปใช้เกณฑ์เดียวกับเดือน */
export const monthBarStatus = (p, target, better) => (p == null || p.v == null ? 'none' : statusOf(p.v, target, better));

/* ════ PPM ปี (บอร์ด KPI ส่วนงาน · 2026-09-23) ════
   สูตรเดียวกับทุกจอ: ของเสีย ÷ ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย) × 1e6 · ไม่รวมงานทดลอง
   rows = rollup.sessions (qty) · defects = rollup.defects (ng − trial_ng = line-mode) — กรอง scope/กลุ่มไลน์มาแล้ว */
const seedPpm = () => ({ qty: 0, ng: 0, rows: 0 });
export function axisPpmYear({ sessions = [], defects = [], year, target = null, direction = 'down' } = {}) {
  const map = byMonth(sessions, seedPpm, (a, r) => { a.qty += n(r.qty); });
  defects.forEach((d) => {
    const k = String(d.m || '').slice(0, 7);
    if (!k) return;
    if (!map.has(k)) map.set(k, seedPpm());
    const a = map.get(k); a.ng += n(d.ng) - n(d.trial_ng); a.rows += n(d.rows);
  });
  const { series, ytd, total, months } = monthSeries(year, map, seedPpm,
    a => ((a.qty + a.ng) > 0 ? Math.round((a.ng / (a.qty + a.ng)) * 1e6) : null), 'avg');
  return {
    key: 'PPM', unit: 'PPM', better: direction === 'up' ? 'up' : 'down', target, months,
    value: ytd, series, summaryKind: 'avg', ngQty: total.ng, qty: total.qty, defectRows: total.rows,
    state: ytd == null ? 'none' : 'ok',
    note: ytd == null ? 'ยังไม่มีกะที่ปิดแล้วในปีนี้' : null,
  };
}

/* ════ KPI กรอกมือ — อนุกรม 12 เดือนจาก kpi_manual_entries ════
   entries = { [month 1-12]: value } · ไม่มีค่า = null (เดือนที่ยังไม่กรอกต้องเป็นช่องว่าง ห้ามเป็น 0)
   แท่งสรุป = ค่าเฉลี่ยธรรมดาของเดือนที่มีค่า (KPI กรอกมือไม่มีน้ำหนักให้ถ่วง — จอต้องเขียนกำกับว่า "เฉลี่ย")
   ⚠️ KPI แบบ "สะสม" (เช่น % ผ่านอบรม) เฉลี่ยแล้วไม่มีความหมาย — ผู้เรียกส่ง summary:'last' ให้ใช้ค่าเดือนล่าสุดแทน */
export function manualMonthSeries({ entries = {}, year, summary = 'avg' } = {}) {
  const series = monthKeys(year).map((k) => {
    const v = entries[Number(k.slice(5, 7))];
    return v == null || v === '' ? { k, v: null, empty: true } : { k, v: Number(v) };
  });
  const filled = series.filter(p => !p.empty);
  let sum = null;
  if (filled.length) {
    if (summary === 'sum') sum = filled.reduce((a, p) => a + p.v, 0);
    else if (summary === 'last') sum = filled[filled.length - 1].v;
    else sum = round1(filled.reduce((a, p) => a + p.v, 0) / filled.length);
  }
  series.push({ k: SUMMARY_KEY, v: sum, summary: true, kind: summary });
  return { series, ytd: sum, months: filled.length };
}

/** สถานะแท่งรายเดือนตาม **เกณฑ์ทางการ 1/0.5/0** (`scoreDef`) — ใช้กับแถว KPI บนบอร์ด KPI ส่วนงาน
 *  (จอ SQDCM ยังใช้ `monthBarStatus`/`statusOf` เพราะแกน SQDCM ไม่ใช่ "แถว KPI" ที่มี Commitment) */
export const monthBarScore = (p, def) => {
  if (p == null || p.v == null) return 'none';
  const st = scoreDef(p.v, def).status;
  return st === 'good' || st === 'warn' || st === 'bad' ? st : 'none';
};
