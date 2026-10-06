/* ═══════════════════════════════════════════════════════════════════════════════════════
   🧑‍🤝‍🧑 Manpower Control Board — กฎจัดผังกำลังคน (pure · มีเทส) · 2026-10-06 คำสั่ง user

   ที่มา: บอร์ดกระดาษหน้าไลน์ (MANPOWER CONTROL BOARD) ที่หัวหน้าแขวนการ์ด skill ของพนักงาน
   ไล่ผังจาก ผจก.ส่วน → หัวหน้าแผนก → หัวหน้ากลุ่มรายทีม → การ์ดพนักงาน + ช่องว่าง + ช่างประจำไลน์
   คู่กับ "ผัง LAYOUT รูปคนตามจุดงาน" และ "ป้ายสถานะ 4M ปกติ/ผิดปกติ" ของแต่ละแผนก

   หลักที่ยึด:
   - **ไม่มีตารางใหม่** — ทุกอย่างคำนวณจากของที่มีอยู่แล้ว (`org_nodes` · `employees.org_node_id/position/team`
     · `stdManpower.js` · `shift_schedules` · `daily_production_logs` · `employee_home_positions` · `four_m_logs`)
     บอร์ดกระดาษต้องมีคนเดินไปย้ายการ์ด ⇒ ของในระบบย้ายตามทะเบียนเอง ไม่มีช่องให้ลืมกรอก
   - ชั้นของคน = **ตำแหน่ง** (`positions.js` · `levelOfPosition`) ไม่ใช่ role · หน่วยของคน = `org_node_id`
     (ไม่มี node ค่อยถอยไปเทียบ `employees.section` แบบ text)
   - 🔴 **กะของทีมมาจาก `shiftFromTeam()` เท่านั้น** (A/B หมุนรายสัปดาห์ · C เช้าตลอด) — ห้ามเขียน "A = Shift 01"
   - 🔴 **ไม่รู้ ≠ ไม่มี** — ทีมที่ตารางกะยังไม่ตั้ง = ไม่รู้ว่าเข้ากะไหน ⇒ ไม่คำนวณช่องว่าง (`slots: null`)
     แล้วให้จอเขียนบอก · ไม่มี std = แผน `null` ไม่ใช่ 0
   - ช่องว่าง = std ของกะ − พนักงานในทะเบียนของกะนั้น (ไม่ใช่คนที่มาวันนี้ — บอร์ดกระดาษก็นับแบบนี้:
     ช่องว่าง = ตำแหน่งที่ยังไม่มีคนประจำ · คนลาวันนี้ยังมีการ์ดแขวนอยู่ แค่ติดป้ายลา)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { positionKeyOf, levelOfPosition } from './positions.js';
import { shiftFromTeam, scheduleTeamFor } from './shiftAssign.js';
import { stdCapacityOf } from './stdManpower.js';
import { getLineFamily } from './lineHierarchy.js';
import { orgNodeCompare, naturalCompare } from './listOrder.js';

/** แถว (row) ของผังที่คนแต่ละตำแหน่งไปอยู่ */
export const ROW = Object.freeze({
  TOP: 'top',          // ผู้จัดการ / หัวหน้าส่วน — หัวผัง
  SUPPORT: 'support',  // วิศวกร / เจ้าหน้าที่ / ธุรการ — ข้างหัวผัง
  HEAD: 'head',        // หัวหน้าแผนก
  LEADER: 'leader',    // หัวหน้ากลุ่ม/ไลน์ (รายทีม)
  TECH: 'tech',        // ช่างเทคนิคประจำไลน์
  OPERATOR: 'operator',
});

/** ตำแหน่ง → แถวบนผัง · ตำแหน่งที่ระบบไม่รู้จัก = ลงแถวพนักงาน + ธง `unknownPos` (ห้ามหายจากบอร์ด) */
export function rowOfPosition(position) {
  const key = positionKeyOf(position);
  const lv = levelOfPosition(position);
  if (key === 'section_head' || lv === 'manager') return ROW.TOP;
  if (lv === 'supervisor') return ROW.HEAD;
  if (lv === 'leader') return ROW.LEADER;
  if (lv === 'technician') return ROW.TECH;
  if (lv === 'engineer' || lv === 'staff') return ROW.SUPPORT;
  return ROW.OPERATOR;
}

const TEAM_ORDER = ['A', 'B', 'C'];
const normTeam = (t) => String(t ?? '').trim().toUpperCase();
export const teamCompare = (a, b) => {
  const ia = TEAM_ORDER.indexOf(a), ib = TEAM_ORDER.indexOf(b);
  if (!a !== !b) return a ? -1 : 1;                       // ไม่ระบุทีม → ท้ายสุด
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return naturalCompare(a, b);
};

/** สถานะวันนี้ของคน 1 คน จากแถว daily_production_logs (หรือ undefined = ยังไม่ถูกเช็คชื่อ) */
export function attendanceState(log) {
  if (!log) return 'unchecked';
  if (log.is_present) return 'present';
  if (log.leave_type) return 'leave';
  return 'absent';
}
export const ATTEND_META = Object.freeze({
  present:   { label: 'มา',               color: '#22c55e' },
  leave:     { label: 'ลา',               color: '#f59e0b' },
  absent:    { label: 'ขาด',              color: '#ef4444' },
  unchecked: { label: 'ยังไม่เช็คชื่อ',   color: '#64748b' },
});

/* ── ลำดับชั้น org_nodes ── */
function indexNodes(nodes) {
  const byId = new Map((nodes || []).map(n => [n.id, n]));
  const kids = new Map();
  for (const n of nodes || []) {
    if (!n.parent_id) continue;
    if (!kids.has(n.parent_id)) kids.set(n.parent_id, []);
    kids.get(n.parent_id).push(n);
  }
  return { byId, kids };
}
function descendants(idx, rootId) {
  const out = [], stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    for (const c of idx.kids.get(id) || []) { out.push(c); stack.push(c.id); }
  }
  return out;
}
/** node ของคน → แผนก (kind='department') ที่ครอบอยู่ · อยู่ที่ระดับส่วนงานเอง = null */
function deptOfNode(idx, nodeId) {
  let n = idx.byId.get(nodeId);
  while (n) {
    if (n.kind === 'department') return n;
    if (n.kind === 'section') return null;
    n = idx.byId.get(n.parent_id);
  }
  return null;
}

const sectionMatches = (sec, text) => {
  const t = String(text || '').trim().toLowerCase();
  return !!t && [sec?.code, sec?.name].some(v => String(v || '').trim().toLowerCase() === t);
};

/** ไลน์ทั้งครอบครัว (แม่+ลูก) ของชุดชื่อ/ไอดี — ใช้ทั้งนับ std และจับ 4M/ผัง */
export function lineFamilyOf(lines, refs) {
  const out = new Map();
  for (const r of refs) {
    // ref = id (ref_line_id/line_id) หรือชื่อ — getLineFamily แยกด้วย typeof ⇒ แปลง id เป็นชื่อก่อน (ทนทั้ง 2 แบบ)
    const self = lines.find(l => String(l.id) === String(r)) || lines.find(l => l.name === r);
    if (self) for (const l of getLineFamily(lines, self.name)) out.set(l.id, l);
  }
  return [...out.values()];
}

/** std ของกะนั้นรวมทั้งครอบครัว — `null` = ไม่มีไลน์ไหนตั้ง std ไว้เลย (ไม่รู้ ≠ 0) */
export function planOf(familyLines, shift) {
  if (!familyLines.length) return null;
  const anySet = familyLines.some(l => (shift === 'night' ? l.std_night_shift : l.std_day_shift) > 0);
  if (!anySet) return null;
  return familyLines.reduce((s, l) => s + stdCapacityOf(familyLines, l.name, shift), 0);
}

/**
 * ผังกำลังคนของ "ส่วนงาน" 1 ส่วน
 * @param {object}   p
 * @param {object}   p.section       org_nodes แถว kind='section'
 * @param {object[]} p.nodes         org_nodes ทั้งหมด (active)
 * @param {object[]} p.employees     พนักงาน active (id,name,image_url,position,team,line_id,department,section,org_node_id)
 * @param {object[]} p.lines         production_lines (ผ่าน useProductionLines)
 * @param {object}   p.maps          buildScheduleMaps(shift_schedules ของวันนี้)
 * @param {object}   p.attendance    { [employee_id]: แถว daily_production_logs วันนี้ }
 */
export function buildManpowerBoard({ section, nodes = [], employees = [], lines = [], maps = null, attendance = {} }) {
  if (!section) return null;
  const idx = indexNodes(nodes);
  const sub = descendants(idx, section.id);
  const subIds = new Set([section.id, ...sub.map(n => n.id)]);
  const deptNodes = sub.filter(n => n.kind === 'department').sort(orgNodeCompare);

  const members = employees.filter(e =>
    e.org_node_id ? subIds.has(e.org_node_id) : sectionMatches(section, e.section));

  const top = [], support = [];
  const depts = new Map(deptNodes.map(d => [d.id, {
    node: d, key: d.id, name: d.name, heads: [], techs: [], people: [],
  }]));
  const NO_DEPT = '__none__';
  const deptBucket = (id) => {
    if (!depts.has(id)) depts.set(id, { node: null, key: NO_DEPT, name: 'ไม่ระบุแผนก', heads: [], techs: [], people: [] });
    return depts.get(id);
  };

  for (const e of members) {
    const row = rowOfPosition(e.position);
    const card = { ...e, row, team: normTeam(e.team), attend: attendanceState(attendance[e.id]), log: attendance[e.id] || null,
      unknownPos: !levelOfPosition(e.position) };
    if (row === ROW.TOP) { top.push(card); continue; }
    if (row === ROW.SUPPORT) { support.push(card); continue; }
    const d = e.org_node_id ? deptOfNode(idx, e.org_node_id) : null;
    const b = deptBucket(d ? d.id : NO_DEPT);
    if (row === ROW.HEAD) b.heads.push(card);
    else if (row === ROW.TECH) b.techs.push(card);
    else b.people.push(card);   // leader + operator — จัดเป็นคอลัมน์ทีมข้างล่าง
  }

  const byName = (a, b) => naturalCompare(a.name || '', b.name || '');
  const out = [];
  for (const b of depts.values()) {
    // แผนกเปล่า (ไม่มีหัวหน้า/ช่าง/คน) = ไม่วาด · แต่นับไว้บอกบนจอ
    if (!b.heads.length && !b.techs.length && !b.people.length) continue;

    // ไลน์ของแผนก = ไลน์ที่ผัง (kind='line'.ref_line_id) ชี้ + ไลน์ที่คนในแผนกสังกัด
    const lineRefs = new Set();
    if (b.node) for (const n of descendants(idx, b.node.id)) if (n.kind === 'line' && n.ref_line_id != null) lineRefs.add(n.ref_line_id);
    for (const p of [...b.heads, ...b.techs, ...b.people]) if (p.line_id != null) lineRefs.add(p.line_id);
    const family = lineFamilyOf(lines, [...lineRefs]);
    const plan = { day: planOf(family, 'day'), night: planOf(family, 'night') };

    // คอลัมน์ทีม
    const teams = [...new Set(b.people.map(p => p.team))].sort(teamCompare);
    const cols = teams.map(t => {
      const ppl = b.people.filter(p => p.team === t);
      const rep = ppl.find(p => p.line_id != null) || ppl[0];
      const shift = t ? shiftFromTeam(scheduleTeamFor(rep, maps), t) : null;
      const leaders = ppl.filter(p => p.row === ROW.LEADER).sort(byName);
      const ops = ppl.filter(p => p.row === ROW.OPERATOR).sort(byName);
      return { team: t, shift, leaders, ops, slots: null };
    });

    // ช่องว่าง — std ของกะ − คนในทะเบียนของกะนั้น · ลงที่คอลัมน์ทีมหมุนกะ (A/B) ของกะนั้นใบแรก
    const reg = { day: 0, night: 0 };
    for (const c of cols) if (c.shift) reg[c.shift] += c.ops.length;
    for (const sh of ['day', 'night']) {
      if (plan[sh] == null) continue;
      const host = cols.find(c => c.shift === sh && c.team !== 'C') || cols.find(c => c.shift === sh);
      if (host) host.slots = Math.max(0, plan[sh] - reg[sh]);
    }
    const unknownShiftTeams = cols.filter(c => c.team && !c.shift && c.ops.length).map(c => c.team);

    const allOps = cols.flatMap(c => c.ops);
    out.push({
      key: b.key, name: b.name, node: b.node,
      heads: b.heads.sort(byName), techs: b.techs.sort(byName), cols,
      lines: family,
      plan, registered: reg,
      planTotal: plan.day == null && plan.night == null ? null : (plan.day || 0) + (plan.night || 0),
      opsTotal: allOps.length,
      present: allOps.filter(p => p.attend === 'present').length,
      unknownShiftTeams,
      unknownPos: allOps.filter(p => p.unknownPos).length,
    });
  }
  out.sort((a, b) => (a.key === NO_DEPT) - (b.key === NO_DEPT) || (a.node && b.node ? orgNodeCompare(a.node, b.node) : 0));

  const sum = (f) => out.reduce((s, d) => s + (f(d) || 0), 0);
  return {
    section,
    top: top.sort(byName), support: support.sort(byName),
    depts: out,
    emptyDepts: deptNodes.filter(d => !out.some(o => o.key === d.id)).map(d => d.name),
    totals: {
      plan: out.some(d => d.planTotal != null) ? sum(d => d.planTotal) : null,
      ops: sum(d => d.opsTotal),
      present: sum(d => d.present),
      members: members.length,
    },
  };
}

/* ── 4M วันนี้ ─────────────────────────────────────────────────────────────── */
export const FOUR_M = Object.freeze([
  { key: 'man',      label: 'MAN',      color: '#9f1d2b' },
  { key: 'machine',  label: 'MACHINE',  color: '#eab308' },
  { key: 'method',   label: 'METHOD',   color: '#0ea5e9' },
  { key: 'material', label: 'MATERIAL', color: '#db2777' },
]);

/**
 * ป้ายสถานะ 4M ของแผนก — มีใบ 4M วันนี้ (ที่ไม่ถูก reject) ในไลน์ของแผนก = "ผิดปกติ"
 * (ความหมายเดียวกับป้ายกระดาษ "สถานะการเปลี่ยนแปลงวันนี้" — มีการเปลี่ยนแปลง = ต้องเฝ้าระวัง)
 * ใบ rejected = ไม่ได้เปลี่ยนจริง ไม่นับ · ใบที่ยังรออนุมัติ นับ (เปลี่ยนแล้วแต่ยังไม่มีใครรับรอง)
 */
export function fourMStatus(familyLines, logs) {
  const ids = new Set(familyLines.map(l => String(l.id)));
  const names = new Set(familyLines.map(l => String(l.name || '').trim().toLowerCase()));
  const mine = (logs || []).filter(r => r.status !== 'rejected' && (
    (r.line_id != null && ids.has(String(r.line_id))) ||
    names.has(String(r.line_name || '').trim().toLowerCase())));
  const res = {};
  for (const m of FOUR_M) {
    const rows = mine.filter(r => String(r.category || '').trim().toLowerCase() === m.key);
    res[m.key] = { abnormal: rows.length > 0, rows, pending: rows.filter(r => r.status !== 'approved').length };
  }
  return res;
}

/* ── ผัง LAYOUT — คนต่อจุดงาน ─────────────────────────────────────────────── */
/**
 * @param {object[]} stations    workstations ของผังนี้
 * @param {object}   homeByEmp   { [employee_id]: station_id } (employee_home_positions)
 * @param {object}   attendance  { [employee_id]: แถว daily_production_logs วันนี้ }
 * @param {object}   empById     { [id]: card จาก buildManpowerBoard (มี shift ผ่าน shiftOfEmp) }
 * @param {(emp)=>('day'|'night'|null)} shiftOfEmp
 * คืน [{ station, people:[{ emp, shift, attend, temp }] }]
 *   temp = วันนี้ถูกจัดมาจุดนี้ แต่จุดประจำอยู่ที่อื่น (ย้ายชั่วคราว)
 *   away = จุดนี้คือจุดประจำ แต่วันนี้ไปยืนจุดอื่น
 */
export function layoutPeople({ stations = [], homeByEmp = {}, attendance = {}, empById = {}, shiftOfEmp = () => null }) {
  const sid = new Set(stations.map(s => String(s.id)));
  const at = new Map(stations.map(s => [String(s.id), new Map()]));
  for (const [empId, st] of Object.entries(homeByEmp)) {
    const k = String(st);
    if (!sid.has(k) || !empById[empId]) continue;
    at.get(k).set(empId, { temp: false, away: false });
  }
  for (const [empId, log] of Object.entries(attendance)) {
    const k = String(log?.assigned_line ?? '');
    if (!log?.is_present || !sid.has(k) || !empById[empId]) continue;
    const home = homeByEmp[empId] != null ? String(homeByEmp[empId]) : null;
    at.get(k).set(empId, { temp: home !== k, away: false });
    // วันนี้ไปยืนจุดอื่น → การ์ดที่จุดประจำยังอยู่ (ตำแหน่งเขา) แต่ติดธง "ไปช่วยจุดอื่น"
    if (home && home !== k && at.get(home)?.has(empId)) at.get(home).set(empId, { temp: false, away: true });
  }
  return stations.map(s => {
    const people = [...at.get(String(s.id)).entries()].map(([empId, x]) => {
      const emp = empById[empId];
      return { emp, shift: shiftOfEmp(emp), attend: attendanceState(attendance[empId]), temp: x.temp, away: x.away };
    });
    const so = { day: 0, night: 1 };
    people.sort((a, b) => (so[a.shift] ?? 2) - (so[b.shift] ?? 2) || naturalCompare(a.emp.name || '', b.emp.name || ''));
    return { station: s, people };
  });
}

/** สีกะบนผัง LAYOUT — ตรงตำนานบอร์ดกระดาษ (เขียว/น้ำเงิน) · ไม่รู้กะ = เทา */
export const SHIFT_META = Object.freeze({
  day:   { label: 'กะเช้า', color: '#22c55e' },
  night: { label: 'กะดึก',  color: '#3b82f6' },
  none:  { label: 'ยังไม่ตั้งกะ', color: '#64748b' },
});
export const shiftMeta = (s) => SHIFT_META[s] || SHIFT_META.none;

/* ── 📺 โหมดจอ TV — แบ่งหน้าแทนการเลื่อน (2026-10-06 · คำสั่ง user · UI §6.23) ───────────────
   จอ TV หน้าไลน์ไม่มีเมาส์ ⇒ ของใต้ขอบจอ = ไม่มีใครเห็น · กติกาเดียวกับ OBEYA (BoardPager)
   1 หน้า = 1 แผนก · คอลัมน์ทีมเรียงข้างกันเหมือนบอร์ดกระดาษ · การ์ดขนาดคงที่ ⇒ นับได้ว่าลงกี่ใบ
   แผนกที่การ์ดล้นช่อง → ตัดเป็นหลายหน้า (หน้า k แสดงช่วงที่ k ของ "ทุกคอลัมน์" พร้อมกัน
   ทีม A หน้า 2 จึงอยู่คู่ทีม B หน้า 2 เสมอ) · ช่องว่างนับเป็นการ์ด 1 ใบ (ห้ามหายเพราะไม่พอที่)
   🔴 ห้ามบีบการ์ดให้เล็กลงเพื่อยัดให้ครบ — แบ่งหน้าเพิ่มแทน (UI §6.23 ข้อ 2)

   @param {object[]} depts   board.depts (หลังกรองแผนก)
   @param {(nCols:number)=>number} capOf  จำนวนการ์ดที่ลงได้ต่อคอลัมน์ เมื่อแผนกมี nCols คอลัมน์ (≥1)
   @returns {Array<{ dept, part:number, parts:number, cols:Array<{ col, items:Array<{kind:'op',p}|{kind:'slot'}>, more:number }> }>} */
export function paginateTv(depts, capOf) {
  const pages = [];
  for (const d of depts || []) {
    const cols = d.cols || [];
    const cap = Math.max(1, Math.floor(Number(capOf(Math.max(1, cols.length))) || 1));
    const itemsOf = (c) => [
      ...c.ops.map(p => ({ kind: 'op', p })),
      ...Array.from({ length: c.slots || 0 }, () => ({ kind: 'slot' })),
    ];
    const all = cols.map(itemsOf);
    const parts = Math.max(1, ...all.map(a => Math.ceil(a.length / cap)));
    for (let k = 0; k < parts; k++) {
      pages.push({
        dept: d, part: k, parts,
        cols: cols.map((c, i) => ({ col: c, items: all[i].slice(k * cap, (k + 1) * cap), more: Math.max(0, all[i].length - (k + 1) * cap) })),
      });
    }
  }
  return pages;
}

/** การ์ดต่อคอลัมน์จากขนาดจริง — pure (เทสได้) · ไม่มีที่สักแถว/คอลัมน์ = 1 (กันหารศูนย์ · จอยังแบ่งหน้าต่อได้) */
export function tvCardCapacity({ areaW, areaH, nCols, cardW, cardH, gap = 6, colPad = 16, colGap = 8 }) {
  const colW = (areaW - colGap * (nCols - 1)) / Math.max(1, nCols) - colPad;
  const perRow = Math.max(1, Math.floor((colW + gap) / (cardW + gap)));
  const rows = Math.max(1, Math.floor((areaH + gap) / (cardH + gap)));
  return perRow * rows;
}
