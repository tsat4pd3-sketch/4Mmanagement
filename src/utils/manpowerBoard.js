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
import { getLineFamily, lineAncestorIds, lineChainIds } from './lineHierarchy.js';
import { orgNodeCompare, naturalCompare } from './listOrder.js';
import { wavg, wLoad, wRun } from './oee.js';
import { skillFit, skillMapOf, pendingMapOf } from './skillFit.js';
import { costCenterOfNode } from './ccScope.js';
import { tr } from './i18n.js';

/** แถว (row) ของผังที่คนแต่ละตำแหน่งไปอยู่ */
/** ถังคนที่ไม่มีแผนก (key ของ dept ใน buildManpowerBoard) — ใช้ร่วม lineDeptsOf */
const NO_DEPT_KEY = '__none__';

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

/* ── 🏃 คนวิ่งข้ามแผนก / 🎖️ รักษาการ — ทะเบียนเดียวกัน (`employee_flex_units`) แยกด้วย `kind` ──
   🔴 **ค่าว่าง/ไม่รู้จัก = `flex`** (พฤติกรรมเดิมก่อน migration 20/10 · แถวเก่าไม่มีคอลัมน์นี้)
   ⇒ จอที่ยังไม่ `select('kind')` ทำงานเหมือนเดิมทุกประการ ไม่ใช่ "รักษาการหายเงียบ" แบบสลับกัน */
export const FLEX_KINDS = Object.freeze({ FLEX: 'flex', ACTING: 'acting' });
export const flexKind = (fu) => (fu?.kind === FLEX_KINDS.ACTING ? FLEX_KINDS.ACTING : FLEX_KINDS.FLEX);
/** แถว "รักษาการ" ของหน่วยหนึ่ง — เทียบ `org_node_id` ตรงตัว **ห้ามไล่ขึ้นหาแม่**
 *  (รักษาการ PD4 ไม่ได้แปลว่ารักษาการทุกแผนกใต้ PD4 — คนละเรื่องกับขอบเขตสิทธิ์) */
export const actingOf = (flexUnits = [], nodeId) =>
  (flexUnits || []).filter(f => f?.employee_id && f.org_node_id === nodeId && flexKind(f) === FLEX_KINDS.ACTING);

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
 * @param {object[]} [p.slotPlans]   manpower_slot_plans { org_node_id, team, slots } — จำนวนช่องที่หัวหน้าตั้งเอง (ชนะ std)
 * @param {object[]} [p.lineTechs]   line_technicians { employee_id, line_id } — ช่างประจำไลน์ (ข้ามแผนกได้ เช่นช่าง MTN)
 * @param {object[]} [p.helpers]     ผลของ mergeBorrowedEmployees() (พนักงาน + _helperTo/_helperFrom/_helperShift)
 *                                   — คนยืมตัววันนี้ · **ห้ามคิวรี line_helpers เอง** (UI §6.13)
 * @param {object[]} [p.flexUnits]   employee_flex_units { employee_id, org_node_id, note, kind } — **2 ความหมาย**
 *   · `kind='flex'`   🏃 คนวิ่งข้ามแผนก — ไปช่วยหน่วยอื่น**ประจำ** (คนละตัวกับ `helpers` ที่เป็นรายวัน/รายกะ)
 *                     ⇒ ขึ้นการ์ดในแผนกที่ไปช่วย
 *   · `kind='acting'` 🎖️ **รักษาการ** — ดูแล/บังคับบัญชาหน่วยนั้น ⇒ ขึ้น **"หัวผัง" ของหน่วยที่ระบุ**
 *                     (รากบอร์ด → แถวผู้จัดการ/หัวหน้าส่วน · แผนก → แถวหัวหน้าแผนกของแผนกนั้น)
 *   🔴 **ทั้ง 2 แบบไม่นับเป็นกำลังคน** — บ้านจริงนับเขาอยู่แล้ว นับ 2 ที่ = กำลังคนปลอม
 *   🔴 **ไม่ย้ายสังกัด ไม่แตะ cost center** — การ์ดเขียนบ้านจริง + CC ของบ้านจริงกำกับเสมอ
 *   · ว่าง/ไม่ส่ง/ไม่มีคอลัมน์ `kind` = พฤติกรรมเดิมเป๊ะ (ค่าว่าง = `flex`)
 * @param {object[]} [p.stations]     workstations { id, line_id, line_name, station_name }
 * @param {object[]} [p.stationPlans] station_slot_plans { station_id, per_shift } — จุดงานต้องมีกี่คนต่อกะ
 * @param {object}   [p.homeByEmp]    { [employee_id]: station_id } (employee_home_positions)
 *  ลำดับที่มาของ "ช่องว่าง" ต่อกะ: ① ช่องต่อทีมที่ตั้งเอง ② ผลรวมช่องจุดงาน ③ std ของไลน์ — ตัวแรกที่มีชนะ
 */
export function buildManpowerBoard({ section, nodes = [], employees = [], lines = [], maps = null, attendance = {},
  slotPlans = [], lineTechs = [], helpers = [], stations = [], stationPlans = [], homeByEmp = {},
  flexUnits = [] }) {
  if (!section) return null;
  const idx = indexNodes(nodes);
  const sub = descendants(idx, section.id);
  const subIds = new Set([section.id, ...sub.map(n => n.id)]);
  /* 🏛️ รากของบอร์ดเป็น **แผนกขึ้นตรงฝ่าย** ได้ (JIG MTN · QA — ไม่มีส่วนงานแม่ · ORPHAN_SECTION
     ใน sectionScope.js) ⇒ ต้องนับตัวเองเป็นแผนกของบอร์ดด้วย ไม่งั้นคนทั้งหน่วยตกถัง "ไม่ระบุแผนก"
     (`deptOfNode` คืนโหนดตัวเองเมื่อ kind='department' อยู่แล้ว) */
  const deptNodes = [...(section.kind === 'department' ? [section] : []),
    ...sub.filter(n => n.kind === 'department')].sort(orgNodeCompare);

  const members = employees.filter(e =>
    e.org_node_id ? subIds.has(e.org_node_id) : sectionMatches(section, e.section));

  const top = [], support = [];
  const depts = new Map(deptNodes.map(d => [d.id, {
    node: d, key: d.id, name: d.name, heads: [], techs: [], people: [],
  }]));
  const NO_DEPT = NO_DEPT_KEY;
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
  const empById = new Map(employees.map(e => [e.id, e]));
  /* 🏠 "บ้านจริง" ที่ต้องเขียนกำกับการ์ดเสมอ — หน่วยสังกัด + cost center ของหน่วยนั้น
     🔴 การ์ด flex/acting **ห้ามโชว์ CC ของหน่วยที่ไปช่วย/รักษาการ** — ค่าแรงยังลงบ้านจริง
     อ่าน CC ผ่าน `costCenterOfNode()` (ตกทอดจากแม่ · กฎอยู่ไฟล์เดียวใน ccScope.js) */
  const homeRefOf = (e, fu) => ({
    /* แผนกก่อน (พฤติกรรมเดิมของการ์ด flex) → ถ้าสังกัดอยู่ระดับส่วนงานเอง (ผจก./หัวหน้าส่วน)
       `deptOfNode` คืน null ⇒ ใช้ชื่อโหนดนั้นตรงๆ → สุดท้ายค่อยถอยไปคอลัมน์ข้อความ */
    nodeName: (e.org_node_id ? deptOfNode(idx, e.org_node_id)?.name : null)
      || (e.org_node_id ? idx.byId.get(e.org_node_id)?.name : null)
      || String(e.department || '').trim() || String(e.section || '').trim() || null,
    costCenter: costCenterOfNode(e.org_node_id, nodes).code,
    note: String(fu?.note || '').trim(),
  });
  const lineById = new Map(lines.map(l => [String(l.id), l]));
  const helperByEmp = new Map(helpers.map(h => [h.id, h]));
  const needOf = new Map(stationPlans.map(sp => [String(sp.station_id), Number(sp.per_shift) || 0]));
  const cardOf = (e, extra) => ({ ...e, row: rowOfPosition(e.position), team: normTeam(e.team),
    attend: attendanceState(attendance[e.id]), log: attendance[e.id] || null, unknownPos: !levelOfPosition(e.position), ...extra });
  const out = [];
  for (const b of depts.values()) {
    // ไลน์ของแผนก = ไลน์ที่ผัง (kind='line'.ref_line_id) ชี้ + ไลน์ที่คนในแผนกสังกัด
    const lineRefs = new Set();
    if (b.node) for (const n of descendants(idx, b.node.id)) if (n.kind === 'line' && n.ref_line_id != null) lineRefs.add(n.ref_line_id);
    for (const p of [...b.heads, ...b.techs, ...b.people]) if (p.line_id != null) lineRefs.add(p.line_id);
    const family = lineFamilyOf(lines, [...lineRefs]);
    const famIds = new Set(family.map(l => String(l.id)));
    const famNames = new Set(family.map(l => String(l.name || '').trim().toLowerCase()));
    const plan = { day: planOf(family, 'day'), night: planOf(family, 'night') };

    // 🔧 ช่างประจำไลน์ (line_technicians) — ช่างแผนกอื่น (MTN/DIE/JIG) ที่ผูกไลน์ของแผนกนี้ไว้ ขึ้นแถวช่างด้วย
    //    `linkedLines` = ไลน์ที่ผูก · `external` = ไม่ใช่คนในสังกัดแผนกนี้ (ห้ามนับเป็นกำลังคนแผนก)
    const techById = new Map(b.techs.map(t => [t.id, t]));
    for (const lt of lineTechs) {
      if (!famIds.has(String(lt.line_id))) continue;
      const ln = lineById.get(String(lt.line_id))?.name;
      const cur = techById.get(lt.employee_id);
      if (cur) { (cur.linkedLines ||= []).push(ln); continue; }
      const e = empById.get(lt.employee_id);
      if (!e) continue;   // พนักงานลาออก/ไม่ active — ไม่วาด (ทะเบียนผูกไว้แต่คนไม่อยู่แล้ว)
      const card = cardOf(e, { linkedLines: [ln], external: true });
      techById.set(e.id, card); b.techs.push(card);
    }

    // 🤝 คนยืมตัววันนี้ — ยืมมาช่วยไลน์ของแผนกนี้ (ไม่ใช่คนในสังกัด) · คนในสังกัดที่ไปช่วยที่อื่น = ติดป้าย lentTo
    const memberIds = new Set([...b.heads, ...b.people].map(p => p.id));
    const borrowed = [];
    for (const h of helpers) {
      if (memberIds.has(h.id) || !famNames.has(String(h._helperTo || '').trim().toLowerCase())) continue;
      borrowed.push(cardOf(h, { borrowed: { from: h._helperFrom || '', to: h._helperTo || '', shift: h._helperShift || null } }));
    }
    for (const p of b.people) {
      const h = helperByEmp.get(p.id);
      if (h && !famNames.has(String(h._helperTo || '').trim().toLowerCase())) p.lentTo = { to: h._helperTo || '', shift: h._helperShift || null };
    }

    // 🏃 คนวิ่งข้ามแผนก (`employee_flex_units`) — บ้านจริงอยู่หน่วยอื่น แต่มาช่วยแผนกนี้ "ประจำ"
    //    (คนละตัวกับ 🤝 ยืมตัวรายวัน · ยืม = วันนี้ · flex = ทะเบียนถาวร)
    //    🔴 **ไม่นับเป็นกำลังคนของแผนกนี้** — ไม่เข้า cols/reg/opsTotal ⇒ ช่องว่างและตัวนับไม่ขยับ
    //       (บ้านจริงนับเขาอยู่แล้ว · นับ 2 ที่ = กำลังคนปลอม แล้วเลิกเชื่อทั้งจอ) · หลักเดียวกับ
    //       `external` ของช่างประจำไลน์ · 🔴 cost center ยังเป็นของบ้านจริง ห้ามย้าย
    const flex = [];
    if (b.node) {
      const here = new Set([...b.heads, ...b.techs, ...b.people].map(p => p.id));
      for (const fu of flexUnits) {
        if (!fu?.employee_id || !fu.org_node_id) continue;
        if (flexKind(fu) !== 'flex') continue;        // 🎖️ รักษาการ ขึ้นหัวผัง ไม่ใช่การ์ดในแผนก
        const to = deptOfNode(idx, fu.org_node_id);
        if (!to || to.id !== b.node.id) continue;
        if (here.has(fu.employee_id)) continue;      // คนในสังกัด/ช่างของแผนกนี้แล้ว — ไม่วาดซ้ำ
        const e = empById.get(fu.employee_id);
        if (!e) continue;                            // ลาออก/ปิดใช้งาน — ทะเบียนผูกไว้แต่คนไม่อยู่แล้ว
        here.add(e.id);                              // ผูกไว้หลายหน่วยในแผนกเดียว = การ์ดใบเดียว
        flex.push(cardOf(e, { flexFrom: homeRefOf(e, fu) }));
      }
    }

    /* 🎖️ รักษาการของ **แผนกนี้** — ขึ้นแถวหัวหน้าแผนก (ไม่นับกำลังคน · ไม่แตะสังกัด/CC)
       คนที่สังกัดแผนกนี้อยู่แล้วไม่ต้องติดป้าย (เขาเป็นหัวหน้าตัวจริงของหน่วยตัวเอง) */
    if (b.node) {
      const headIds = new Set(b.heads.map(p => p.id));
      for (const a of actingOf(flexUnits, b.node.id)) {
        if (headIds.has(a.employee_id)) continue;
        const e = empById.get(a.employee_id);
        if (!e || e.org_node_id === b.node.id) continue;
        headIds.add(e.id);
        b.heads.push(cardOf(e, { acting: homeRefOf(e, a) }));
      }
    }

    // ช่องที่หัวหน้าตั้งเอง (manpower_slot_plans) ของแผนกนี้ — ทีม → จำนวนช่อง
    const planned = new Map(slotPlans.filter(sp => b.node && sp.org_node_id === b.node.id).map(sp => [normTeam(sp.team), Number(sp.slots) || 0]));

    // แผนกเปล่า (ไม่มีหัวหน้า/ช่าง/คน/ช่องที่ตั้งไว้/คนยืม/คนวิ่งข้ามมา) = ไม่วาด · แต่นับไว้บอกบนจอ
    if (!b.heads.length && !b.techs.length && !b.people.length && !planned.size && !borrowed.length && !flex.length) continue;

    // คอลัมน์ทีม — ทีมที่มีคน ∪ ทีมที่ตั้งช่องไว้ (ตั้งช่องแต่ยังไม่มีคน = คอลัมน์ช่องว่างล้วน)
    // ตั้ง 0 ช่องและไม่มีคน = ไม่ต้องมีคอลัมน์ (ตั้ง 0 = "ทีมนี้ไม่มีตำแหน่ง" ไม่ใช่คอลัมน์ว่าง)
    const teams = [...new Set([...b.people.map(p => p.team), ...[...planned].filter(([, n]) => n > 0).map(([t]) => t)])].sort(teamCompare);
    const cols = teams.map(t => {
      const ppl = b.people.filter(p => p.team === t);
      const rep = ppl.find(p => p.line_id != null) || ppl[0];
      const shift = t ? shiftFromTeam(scheduleTeamFor(rep, maps), t) : null;
      const leaders = ppl.filter(p => p.row === ROW.LEADER).sort(byName);
      const ops = ppl.filter(p => p.row === ROW.OPERATOR).sort(byName);
      // ตั้งช่องเองไว้ = ใช้ค่านั้นตรงๆ (ไม่ต้องรู้กะ) · `slotSource` บอกจอว่าเลขมาจากไหน
      if (planned.has(t)) return { team: t, shift, leaders, ops, slots: Math.max(0, planned.get(t) - ops.length), slotPlan: planned.get(t), slotSource: 'plan' };
      return { team: t, shift, leaders, ops, slots: null, slotPlan: null, slotSource: null };
    });

    // ช่องว่างจาก std (เฉพาะคอลัมน์ที่ไม่ได้ตั้งช่องเอง) — std ของกะ − คนในทะเบียนของกะนั้น
    // ลงที่คอลัมน์ทีมหมุนกะ (A/B) ของกะนั้นใบแรก · คอลัมน์ที่ตั้งเองถูกนับคนแล้ว ต้องหักออกจาก std ด้วย
    const reg = { day: 0, night: 0 };
    for (const c of cols) if (c.shift) reg[c.shift] += c.ops.length;
    const free = cols.filter(c => c.slotSource !== 'plan');

    // 📍 ช่องระดับจุดงาน — จุดที่ตั้ง "ต้องมีกี่คนต่อกะ" ไว้ · มีคน = พนักงานในแผนกที่จุดประจำ (home) อยู่ที่จุดนั้น
    //    และทีมของเขาเข้ากะนั้นวันนี้ · ขาด = ช่องว่างที่บอกได้ว่า "จุดไหน"
    const shiftOfTeam = new Map(cols.map(c => [c.team, c.shift]));
    const famStations = stations.filter(st => famIds.has(String(st.line_id)) || famNames.has(String(st.line_name || '').trim().toLowerCase()));
    const plannedStations = famStations.filter(st => (needOf.get(String(st.id)) || 0) > 0);
    let stationInfo = null;
    if (plannedStations.length) {
      const opsAll = cols.flatMap(c => c.ops);
      const missing = { day: [], night: [] };
      const need = { day: 0, night: 0 };
      for (const st of plannedStations) {
        const n = needOf.get(String(st.id));
        const here = opsAll.filter(p => String(homeByEmp[p.id] ?? '') === String(st.id));
        for (const sh of ['day', 'night']) {
          need[sh] += n;
          const have = here.filter(p => shiftOfTeam.get(p.team) === sh).length;
          if (have < n) missing[sh].push({ station: st, n: n - have });
        }
      }
      const stIds = new Set(famStations.map(st => String(st.id)));
      stationInfo = {
        planned: plannedStations.length, total: famStations.length, need, missing,
        // คนในแผนกที่ยังไม่มีจุดประจำในไลน์ของแผนก — ไม่ถูกนับลงจุดไหน ⇒ ช่องว่างอาจดูมากกว่าความจริง ต้องบอกบนจอ
        noHome: opsAll.filter(p => !stIds.has(String(homeByEmp[p.id] ?? ''))).length,
      };
    }

    for (const sh of ['day', 'night']) {
      if (cols.some(c => c.shift === sh && c.slotSource === 'plan')) continue;   // ① กะนี้หัวหน้าตั้งช่องต่อทีมเองแล้ว
      const host = free.find(c => c.shift === sh && c.team !== 'C') || free.find(c => c.shift === sh);
      if (!host) continue;
      if (stationInfo) {                                                         // ② ช่องจุดงาน
        host.slots = stationInfo.missing[sh].reduce((a, m) => a + m.n, 0);
        host.slotSource = 'station';
        host.slotStations = stationInfo.missing[sh].flatMap(m => Array.from({ length: m.n }, () => m.station.station_name || ''));
        continue;
      }
      if (plan[sh] == null) continue;                                            // ③ std
      host.slots = Math.max(0, plan[sh] - reg[sh]); host.slotSource = 'std';
    }
    const unknownShiftTeams = cols.filter(c => c.team && !c.shift && c.ops.length && c.slotSource !== 'plan').map(c => c.team);

    const allOps = cols.flatMap(c => c.ops);
    out.push({
      key: b.key, name: b.name, node: b.node,
      heads: b.heads.sort(byName), techs: b.techs.sort((x, y) => (!!x.external - !!y.external) || byName(x, y)), cols,
      borrowed: borrowed.sort(byName),
      flex: flex.sort(byName),
      lines: family,
      plan, registered: reg,
      planTotal: plan.day == null && plan.night == null ? null : (plan.day || 0) + (plan.night || 0),
      opsTotal: allOps.length,
      present: allOps.filter(p => p.attend === 'present').length,
      lentOut: allOps.filter(p => p.lentTo).length,
      unknownShiftTeams,
      unknownPos: allOps.filter(p => p.unknownPos).length,
      stationInfo,
    });
  }
  out.sort((a, b) => (a.key === NO_DEPT) - (b.key === NO_DEPT) || (a.node && b.node ? orgNodeCompare(a.node, b.node) : 0));

  /* 🎖️ รักษาการของ **หน่วยรากของบอร์ด** → ขึ้นหัวผัง (แถวผู้จัดการ/หัวหน้าส่วน)
     เคสจริง 20/10: ผจก.ฝ่ายสังกัด PD3 รักษาการ ผจก. ของ PD4 + JIG MTN ด้วย
     ⇒ หัวผัง 2 หน่วยนั้นว่างทั้งที่หน้างานมีคนดูแลจริง
     🔴 **ไม่นับเป็นกำลังคน** (top[] ไม่เคยเข้า cols/ops อยู่แล้ว) · **ไม่ย้ายสังกัด ไม่แตะ cost center**
        การ์ดเขียนบ้านจริง + CC ของบ้านจริงกำกับ ⇒ อ่านแล้วรู้ทันทีว่าเป็นคนของหน่วยอื่น */
  {
    const topIds = new Set(top.map(p => p.id));
    for (const a of actingOf(flexUnits, section.id)) {
      if (topIds.has(a.employee_id)) continue;
      const e = empById.get(a.employee_id);
      if (!e || e.org_node_id === section.id) continue;   // สังกัดหน่วยนี้อยู่แล้ว = ตัวจริง ไม่ใช่รักษาการ
      topIds.add(e.id);
      top.push(cardOf(e, { acting: homeRefOf(e, a) }));
    }
  }

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
      borrowed: sum(d => d.borrowed.length),
      // 🏃 คนวิ่งข้ามแผนกที่โผล่ในส่วนงานนี้ — **ไม่รวมใน `ops`** (ไม่ใช่กำลังคนของที่นี่)
      flex: sum(d => d.flex.length),
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
export function layoutPeople({ stations = [], homeByEmp = {}, attendance = {}, empById = {}, shiftOfEmp = () => null, stationPlans = [] }) {
  const needOf = new Map(stationPlans.map(sp => [String(sp.station_id), Number(sp.per_shift) || 0]));
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
    // 📍 ช่องที่ยังขาดต่อกะ (station_slot_plans) — นับเฉพาะคนประจำจุดนี้ (ไม่นับคนย้ายมาชั่วคราว ✳)
    //    ไม่ตั้ง = need null (จอวาด + แบบเดิมเมื่อไม่มีใครเลย)
    const need = needOf.has(String(s.id)) ? needOf.get(String(s.id)) : null;
    let missing = null;
    if (need != null) {
      const own = people.filter(p => !p.temp);
      const unknown = own.filter(p => p.shift !== 'day' && p.shift !== 'night').length;
      if (unknown) {
        // 🔴 มีคนประจำที่ระบบไม่รู้ว่าเข้ากะไหน (ตารางกะยังไม่ตั้ง) — ห้ามเดาว่าเขาเติมกะไหน
        //    ⇒ บอกแค่ "ขาดรวม N ช่อง ยังไม่รู้กะ" (จอวาดวงเทา ?)
        missing = { day: 0, night: 0, unknown: Math.max(0, need * 2 - own.length) };
      } else {
        missing = { ...Object.fromEntries(['day', 'night'].map(sh => [sh, Math.max(0, need - own.filter(p => p.shift === sh).length)])), unknown: 0 };
      }
    }
    return { station: s, people, need, missing };
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
      ...Array.from({ length: c.slots || 0 }, (_, i) => ({ kind: 'slot', station: c.slotStations?.[i] || null })),
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

/* ── 📜 ประวัติการเปลี่ยนช่อง (2026-10-06 · คำสั่ง user "ทำจอสรุปประวัติการเปลี่ยนช่องต่อเลย") ─────────
   อ่านจาก `audit_log` (fn_audit ของ 3 ตารางค่าตั้งบอร์ด) — **ไม่มีตารางประวัติแยก** (audit คือแหล่งความจริงเดียว)
   ตาราง: manpower_slot_plans (ช่องต่อทีม) · station_slot_plans (คนต่อกะของจุด) · line_technicians (ช่างประจำไลน์)
   🔴 แถวที่อ้างของที่ถูกลบไปแล้ว (แผนก/จุด/คน) = ใช้ชื่อเท่าที่รู้ + "(ถูกลบแล้ว)" ห้ามทิ้งแถว (ประวัติต้องครบ)
   🔴 actor ว่าง = เขียนโดยระบบ/migration — เขียนว่า "ระบบ" ห้ามเว้นว่างให้ดูเหมือนข้อมูลหาย */
export const SLOT_AUDIT_TABLES = Object.freeze(['manpower_slot_plans', 'station_slot_plans', 'line_technicians']);
export const SLOT_KIND_META = Object.freeze({
  team:    { label: 'ช่องต่อทีม', icon: '🧑‍🤝‍🧑' },
  station: { label: 'คนต่อกะของจุด', icon: '📍' },
  tech:    { label: 'ช่างประจำไลน์', icon: '🔧' },
});
const KIND_OF_TABLE = { manpower_slot_plans: 'team', station_slot_plans: 'station', line_technicians: 'tech' };

/**
 * @param {object[]} rows   audit_log (table_name, action, actor, old_data, new_data, changed_at)
 * @param {object}   ctx    { nodeById: Map, stationById: Map, lineById: Map, empById: Map,
 *                            inScope: ({ kind, nodeId, lineId }) => boolean }  — ตัดตามส่วนงานที่ดูอยู่
 * @returns {Array<{ id, at, month, actor, kind, action, where, team, before, after, delta, text }>}
 *   before/after = จำนวน (ช่อง/คน) · null = ไม่มีค่า (สร้างใหม่/ลบ) · delta = after−before (ช่างนับ +1/−1)
 */
export function describeSlotChanges(rows, ctx = {}) {
  const { nodeById = new Map(), stationById = new Map(), lineById = new Map(), empById = new Map(), inScope = () => true } = ctx;
  const out = [];
  for (const r of rows || []) {
    const kind = KIND_OF_TABLE[r.table_name];
    if (!kind) continue;
    const o = r.old_data || null, n = r.new_data || null, d = n || o || {};
    let where = '', team = null, before = null, after = null, nodeId = null, lineId = null;
    if (kind === 'team') {
      nodeId = d.org_node_id;
      where = nodeById.get(nodeId)?.name || 'แผนก (ถูกลบแล้ว)';
      team = d.team ?? '';
      before = o ? Number(o.slots) : null; after = n ? Number(n.slots) : null;
    } else if (kind === 'station') {
      const st = stationById.get(String(d.station_id));
      lineId = st?.line_id ?? null;
      const ln = st ? (lineById.get(String(st.line_id))?.name || st.line_name || '') : '';
      where = st ? `${st.station_name}${ln ? ` · ${ln}` : ''}` : 'จุดงาน (ถูกลบแล้ว)';
      before = o ? Number(o.per_shift) : null; after = n ? Number(n.per_shift) : null;
    } else {
      lineId = d.line_id;
      const ln = lineById.get(String(d.line_id))?.name || 'ไลน์ (ถูกลบแล้ว)';
      const emp = empById.get(d.employee_id)?.name || 'พนักงาน (ไม่อยู่ในทะเบียนแล้ว)';
      where = `${ln} · ${emp}`;
      before = r.action === 'INSERT' ? 0 : r.action === 'DELETE' ? 1 : null;
      after = r.action === 'INSERT' ? 1 : r.action === 'DELETE' ? 0 : null;
    }
    if (!inScope({ kind, nodeId, lineId })) continue;
    // UPDATE ที่ค่าไม่เปลี่ยน (แก้แค่ note) — นับเป็นการแก้ แต่ delta 0
    const delta = (after ?? 0) - (before ?? 0);
    const unit = kind === 'station' ? 'คน/กะ' : kind === 'team' ? 'ช่อง' : '';
    const text = kind === 'tech'
      ? (r.action === 'INSERT' ? 'ผูกเป็นช่างประจำไลน์' : r.action === 'DELETE' ? 'เอาออกจากช่างประจำไลน์' : 'แก้ข้อมูล')
      : r.action === 'INSERT' ? `ตั้ง ${after} ${unit}`
      : r.action === 'DELETE' ? `ล้างค่า (เดิม ${before} ${unit}) → กลับไปใช้ค่าถัดไปในลำดับ`
      : before === after ? `แก้รายละเอียด (ค่าเท่าเดิม ${after} ${unit})`
      : `${before} → ${after} ${unit}`;
    out.push({
      id: r.id, at: r.changed_at, month: String(r.changed_at || '').slice(0, 7),
      actor: r.actor || 'ระบบ', kind, action: r.action, where, team, before, after, delta, text,
    });
  }
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return out;
}

/** สรุปรายเดือน — จำนวนครั้ง · ช่องสุทธิที่เพิ่ม/ลด (ทีม + จุดงาน) · ช่างเข้า/ออก · คนแก้ (ไม่ซ้ำ) */
export function summarizeSlotChanges(list) {
  const by = new Map();
  for (const c of list || []) {
    if (!by.has(c.month)) by.set(c.month, { month: c.month, count: 0, teamDelta: 0, stationDelta: 0, techIn: 0, techOut: 0, actors: new Set() });
    const m = by.get(c.month);
    m.count += 1; m.actors.add(c.actor);
    if (c.kind === 'team') m.teamDelta += c.delta;
    else if (c.kind === 'station') m.stationDelta += c.delta;
    else if (c.delta > 0) m.techIn += 1; else if (c.delta < 0) m.techOut += 1;
  }
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month)).map(m => ({ ...m, actors: [...m.actors] }));
}

/* ── 📊 แผน vs มาจริงรายวัน (2026-10-08 · คำสั่ง user "ทำข้อ 3 ต่อเลย") ─────────────────────────
   ตอบ "แต่ละแผนกขาดคนบ่อยแค่ไหน · ขาดเพราะอะไร" จากเช็คชื่อที่มีอยู่แล้ว (ไม่มีตารางใหม่)
   หลัก:
   - **ที่นั่ง (seats) = ตำแหน่งที่บอร์ดวาดในวันนั้น** = การ์ดคนในทะเบียน + ช่องว่าง ของกะนั้น
     ⇒ ใช้กฎลำดับช่องเดียวกับบอร์ด (ช่องต่อทีม → จุดงาน → std) ห้ามคิดสูตรแผนใหม่ที่นี่
     คอลัมน์ที่ไม่มีที่มาของช่องเลย (`slotSource` null) = ที่นั่งเท่าคนในทะเบียน + ธง `noPlan` ให้จอบอก
   - 🔴 **กะที่ไม่มีใครในแผนกถูกเช็คชื่อเลย = "ไม่ได้เช็คชื่อ" (`gap: null`) ห้ามนับเป็นขาดทั้งกะ**
     (วันหยุด/กะที่ไม่เปิด/หัวหน้าลืมเช็ค แยกกันไม่ออก — ไม่รู้ ≠ ขาด)
   - ขาด (gap) = ที่นั่ง − คนยืนจริง · แตกได้ลงตัวเป๊ะ:
       gap = ช่องว่าง + ลา + ขาดงาน + ยังไม่เช็ค + ถูกยืมออก − ยืมเข้า   (ติดลบ = เกิน)
     "ยังไม่เช็ค" ในกะที่เช็คแล้ว = ไม่ยืนยันว่ามา ⇒ นับในช่องขาดแต่แยกคอลัมน์ให้เห็นว่าเป็น "ไม่รู้"
   - กะไม่รู้ (ตารางกะไม่ตั้ง) = ถัง `unknown` นับคน ไม่คิดที่นั่ง

   ══ 🔴 "ขาด" มี 2 ชนิด ห้ามบวกรวมเป็นเลขเดียว (15/10 · คำสั่ง user) ══════════════════════
   เดิมพาดหัว "ขาดรวม" เอาทั้ง 2 ชนิดมารวมกัน แล้ว**กะที่ขาดคนขึ้น 100% ทุกแผนก** —
   ตัวชี้วัดที่เข้าเงื่อนไขทุกกะ = ไม่มีข้อมูลอยู่ในนั้น (วัด 15/10: APRON ขาดรวม 562 ของจริง
   เป็น "ช่องว่าง" 470 = 84% · HYDROFORM 443 เป็นคนขาดจริง 249 = 56% — คนละโรคแต่จอบอกเลขใกล้กัน)
     · `absentGap` = **คนขาด** (ลา + ขาดงาน + ยังไม่เช็ค + ถูกยืมออก − ยืมเข้า) → เรื่องรายวัน หัวหน้าทำได้
     · `structGap` = **ช่องว่างอัตรากำลัง** (ที่นั่งที่ยังไม่มีคน) → เรื่องอัตรากำลัง/รับคน คนละ action
   🔴 `shortShifts`/`worst` นับจาก `absentGap` เท่านั้น — ช่องว่างไม่ใช่ "วันนี้ขาดคน"

   ══ 🔴 ตัวหารต้องเป็น "ความต้องการของกะนั้นจริง" ไม่ใช่จำนวนจุดงานทั้งแผนก ══════════════
   ที่มา (user 15/10): *"PD3 มีคนเต็มออแกไนซ์ 10 แต่มีจุด 15 จะมีบางจุดที่ใช้คนวนๆ และไม่ได้ผลิตงานทุกวัน"*
   ⇒ ช่องจากจุดงานเฟ้อ 2 ทาง: จุดที่ไม่เคยตั้งใจมีคนประจำ + กะที่ไลน์ไม่ได้เดิน
     ② **ยืนยันไม่ได้ว่าไลน์เดินในกะนั้น ⇒ `structGap = null` ไม่ใช่ 0** (`ranKnown:false`)
        — ไม่รู้ ≠ ไม่ขาด · จอต้องเขียนว่ามีกี่กะที่คิดช่องว่างไม่ได้
     ③ **เพดาน: ช่องว่าง ≤ กำลังคนตามผัง(std) − คนที่มาจริง** · ส่วนที่เกิน = `capped` ให้จอบอก
        (คนวนจุด/ไม่มีจุดประจำ ทำให้ช่องว่างเฟ้อ แม้เขามาทำงานจริง) · **std ไม่รู้ = ไม่ตัดเพดาน**  */
const emptyShift = () => ({ seats: 0, registered: 0, empty: 0, emptyRaw: 0, present: 0, leave: 0, absent: 0, unchecked: 0,
  lentOut: 0, borrowedIn: 0, checked: 0, noPlan: false, onFloor: 0, gap: null, absentGap: null, structGap: null,
  std: null, capped: 0, ranKnown: true, evaluated: false });

/**
 * ผลของแผนก 1 แผนก (จาก `buildManpowerBoard().depts[i]` ที่สร้างด้วยเช็คชื่อ/ตารางกะ/คนยืมของวันนั้น)
 * @param {object} [opt.ran]  { day, night } = ยืนยันได้ไหมว่าไลน์ของแผนกเดินในกะนั้น (จากกะผลิตที่ปิดแล้ว)
 *        ไม่ส่ง = ถือว่ายืนยันได้ทุกกะ (พฤติกรรมเดิม) · `false` = ไม่คิดช่องว่างของกะนั้น
 */
export function staffingOfDept(d, { ran = null } = {}) {
  const out = { day: emptyShift(), night: emptyShift(), unknown: emptyShift() };
  for (const c of d.cols || []) {
    const s = out[c.shift === 'day' || c.shift === 'night' ? c.shift : 'unknown'];
    s.registered += c.ops.length;
    if (c.shift) {
      s.empty += c.slots || 0;
      if (c.slotSource == null && c.ops.length) s.noPlan = true;
    }
    for (const p of c.ops) {
      if (p.log) s.checked += 1;
      const lent = p.lentTo && (p.lentTo.shift == null || p.lentTo.shift === c.shift);
      if (p.attend === 'present') { if (lent) s.lentOut += 1; else s.present += 1; }
      else if (p.attend === 'leave') s.leave += 1;
      else if (p.attend === 'absent') s.absent += 1;
      else s.unchecked += 1;
    }
  }
  for (const b of d.borrowed || []) {
    const sh = b.borrowed?.shift;
    out[sh === 'day' || sh === 'night' ? sh : 'unknown'].borrowedIn += 1;
  }
  for (const k of ['day', 'night', 'unknown']) {
    const s = out[k];
    s.onFloor = s.present + s.borrowedIn;
    if (k === 'unknown') continue;
    s.evaluated = s.checked > 0 || s.borrowedIn > 0;
    s.emptyRaw = s.empty;
    s.std = d.plan?.[k] ?? null;

    // ③ เพดาน — ช่องว่างห้ามเกิน "กำลังคนตามผัง − คนที่มาจริง" (std ไม่รู้ = ไม่ตัด)
    if (s.std != null) {
      const cap = Math.max(0, s.std - s.onFloor);
      if (s.empty > cap) { s.capped = s.empty - cap; s.empty = cap; }
    }
    // ② ยืนยันไม่ได้ว่าไลน์เดินในกะนี้ ⇒ ไม่คิดช่องว่าง (null ไม่ใช่ 0)
    s.ranKnown = ran ? !!ran[k] : true;
    if (!s.ranKnown) { s.empty = 0; s.capped = 0; }

    s.structGap = s.ranKnown ? s.empty : null;
    s.absentGap = s.evaluated ? s.leave + s.absent + s.unchecked + s.lentOut - s.borrowedIn : null;
    s.seats = s.registered + (s.structGap || 0);
    s.gap = s.evaluated ? s.seats - s.onFloor : null;
    // 🧩 กรองถึงไลน์ (`narrowDeptToLine`) — ช่องตำแหน่งตั้งรายทีม แยกลงไลน์ไม่ได้ ⇒ ไม่คิดช่องว่าง (null ไม่ใช่ 0)
    //    เทียบ "คนมาจริง vs std ของไลน์" แทน (user 23/11 เลือก) · std ไม่ตั้ง = gap null
    if (d.lineFilter) {
      s.structGap = null; s.empty = 0; s.capped = 0;
      s.seats = s.std;
      s.gap = s.evaluated && s.std != null ? s.std - s.onFloor : null;
      /* 🔴 "ขาด" ของไลน์ = std − คนที่ยืนจริง (ไม่ใช่ ลา+ขาดงาน ของทะเบียน) — คนสังกัดไลน์แม่ที่ไม่มา
         ไม่เคยถูกวางจุดของไลน์ลูก ⇒ ไม่โผล่ในทะเบียนของไลน์ ⇒ นับแบบเดิมได้ "มาครบ 100%" เสมอ (เจอตอนทำ 23/11)
         std ไม่ตั้ง = ตัดสินไม่ได้ (null ไม่ใช่ 0) */
      s.absentGap = s.gap;
    }
  }
  return out;
}

/** สรุปช่วงวันต่อแผนก · `days` = [{ date, depts: [{ key, name, shifts: staffingOfDept() }] }] */
export function summarizeStaffing(days) {
  const by = new Map();
  for (const day of days || []) {
    for (const d of day.depts || []) {
      if (!by.has(d.key)) by.set(d.key, { key: d.key, name: d.name, shifts: 0, notChecked: 0, shortShifts: 0, overShifts: 0,
        seats: 0, registered: 0, onFloor: 0, short: 0, absentShort: 0, structShort: 0, empty: 0, leave: 0, absent: 0,
        unchecked: 0, lentOut: 0, borrowedIn: 0, noPlanShifts: 0, structUnknownShifts: 0, capped: 0, stdUnknownShifts: 0,
        worst: null, lineMode: !!d.lineMode });
      const a = by.get(d.key);
      for (const sh of ['day', 'night']) {
        const s = d.shifts[sh];
        if (!s.seats && !s.evaluated) continue;            // กะนี้แผนกไม่มีที่นั่งและไม่มีใครมา = ไม่ใช่กะของแผนก
        if (!s.evaluated) { a.notChecked += 1; continue; }
        a.shifts += 1; a.seats += s.seats; a.registered += s.registered; a.onFloor += s.onFloor;
        for (const k of ['empty', 'leave', 'absent', 'unchecked', 'lentOut', 'borrowedIn', 'capped']) a[k] += s[k];
        if (s.noPlan) a.noPlanShifts += 1;
        if (!s.ranKnown) a.structUnknownShifts += 1;       // คิดช่องว่างของกะนี้ไม่ได้ — ต้องเขียนบนจอ
        if (s.std == null) a.stdUnknownShifts += 1;        // ไม่รู้กำลังคนตามผัง = ไม่ได้ตัดเพดาน
        if (s.structGap > 0) a.structShort += s.structGap;
        /* 🔴 "กะที่ขาดคน" = กะที่คนขาดจริง ไม่ใช่กะที่มีช่องว่าง (ไม่งั้นขึ้น 100% ทุกแผนก · 15/10) */
        if (s.absentGap > 0) { a.shortShifts += 1; a.absentShort += s.absentGap; }
        if (s.gap > 0) a.short += s.gap; else if (s.gap < 0) a.overShifts += 1;
        if (s.absentGap > 0 && (!a.worst || s.absentGap > a.worst.gap)) a.worst = { date: day.date, shift: sh, gap: s.absentGap };
      }
    }
  }
  /* `fill` = มาจริง ÷ **คนในทะเบียนของกะนั้น** — ไม่ใช่ ÷ ที่นั่ง
     (หารด้วยที่นั่ง = เอาช่องว่างอัตรากำลังมาปนกับการมาทำงาน แล้วทุกแผนกดูเหมือนมากันครึ่งเดียว) */
  // 🧩 กรองถึงไลน์ (`lineFilter`) — ตัวหาร = std ของไลน์ (ที่นั่ง) แทนทะเบียน (ทะเบียนของไลน์ลูก = คนที่มาวางจุดแล้ว = 100% เสมอ)
  return [...by.values()].map(a => ({ ...a, fill: a.lineMode ? (a.seats ? a.onFloor / a.seats : null) : (a.registered ? a.onFloor / a.registered : null) }));
}

/** คนในทะเบียน "ณ วันนั้น" — ตัดคนที่เริ่มงานหลังวันนั้น (start_date)
 *  🔴 start_date เชื่อไม่ได้ทั้งหมด (ตรวจข้อมูลจริง 12/10: 21 คนกรอกปี พ.ศ. ลงช่อง ค.ศ. เช่น 2565 ·
 *     บางคนวันเริ่มงานช้ากว่าวันที่มาเช็คชื่อจริง) ⇒ 3 กฎ:
 *     ① ไม่มี start_date = นับ (ไม่รู้ ≠ ยังไม่เข้า)
 *     ② start_date อยู่หลัง "วันนี้" = ค่าผิดปกติ ⇒ ไม่ใช้ตัดใคร (กฎเดียวกับ Turnover ใน /workforce-insight)
 *     ③ ถูกเช็คชื่อวันนั้น = อยู่ในทะเบียนแน่นอน ไม่ว่า start_date จะว่าอะไร (ของจริงชนะทะเบียน) */
export function rosterOn(employees, date, { today = null, attendance = null } = {}) {
  return (employees || []).filter(e => {
    const sd = e.start_date ? String(e.start_date).slice(0, 10) : '';
    if (!sd || sd <= date) return true;
    if (today && sd > today) return true;
    return !!attendance?.[e.id];
  });
}

/* ── 🔗 คนมาน้อย ↔ OEE (2026-10-12 · คำสั่ง user "ลุย" ข้อ 2 ของข้อเสนอ) ─────────────────────────────
   ตอบ "ขาดคนแล้วเสียอะไร" — เทียบ OEE ของกะที่ "คนมาตามปกติ" กับกะที่ "คนมาน้อยกว่าปกติ" ในแผนกเดียวกัน
   - 🔴 **"ปกติ" = มัธยฐานของคนยืนจริงต่อกะของแผนกนั้นเอง** — ไม่ใช่ "ครบตามที่นั่ง"
     เหตุ (ตรวจข้อมูลจริง 12/10): std ของไลน์สูงกว่าคนในทะเบียน (APRON std 17/กะ · มีคน 12–13/กะ)
     ⇒ เกือบทุกกะ "ขาด" เทียบที่นั่ง ⇒ ไม่มีกลุ่ม "ครบ" ให้เทียบ · เทียบกับตัวเองตอบได้เสมอ และไม่ขึ้นกับ std ที่ยังไม่แม่น
   - 🔴 ใช้ค่าที่ stamp ตอนปิดกะเท่านั้น (`production_sessions.oee/oee_p`) ห้ามคำนวณ OEE ใหม่ (หลักเดียวกับ axisOee)
     ถ่วงน้ำหนักตามตำรา: OEE ด้วยเวลารับภาระ (`wLoad`) · %P ด้วยเวลาเดินเครื่อง (`wRun`)
   - 🔴 **ไม่รวมยอดชิ้น (`actual_qty`) ข้ามไลน์ในแผนก** — ไลน์ย่อยป้อนกันเป็นขั้น (sub-assy → assy) บวกกัน = นับซ้ำ
     (กฎ "พาร์ทจริง/ชั้น OP") ⇒ เทียบเป็น "อัตรา" (OEE · %P) ที่เทียบข้ามกะได้ตรงๆ
   - กะที่ไม่ได้เช็คชื่อ (`gap: null`) / ไม่มีกะผลิตปิดแล้ว (วันหยุด · ไลน์ไม่เดิน) = ไม่เข้ากลุ่มไหน
   - กลุ่มละ < `MIN_SHIFTS_TO_COMPARE` กะ = `verdict: 'thin'` จอต้องเขียนว่าน้อยเกินจะสรุป (ห้ามโชว์ส่วนต่างเหมือนเป็นข้อสรุป)
   - เป็น "ความสัมพันธ์" ไม่ใช่ข้อพิสูจน์สาเหตุ — กะที่คนมาน้อยอาจมีเครื่องเสียด้วย ⇒ จอต้องบอกข้อนี้  */
export const MIN_SHIFTS_TO_COMPARE = 3;
const normName = (v) => String(v || '').trim().toLowerCase();

/** OEE ของกะผลิตชุดหนึ่ง (แถว production_sessions ที่ปิดแล้ว) — ไม่มีแถวที่มี oee = null */
export function oeeOfSessions(rows) {
  const ok = (rows || []).filter(r => r.oee != null);
  if (!ok.length) return null;
  return {
    oee: wavg(ok, r => Number(r.oee), wLoad),
    p: wavg(ok, r => (r.oee_p == null ? null : Number(r.oee_p)), wRun),
    sessions: ok.length,
  };
}

/** จัดกะผลิตเป็นดัชนี `วัน|กะ|ชื่อไลน์` */
export function indexSessions(sessions) {
  const m = new Map();
  for (const s of sessions || []) {
    const k = `${s.work_date}|${s.shift}|${normName(s.line_name)}`;
    (m.get(k) || m.set(k, []).get(k)).push(s);
  }
  return m;
}

/** กะผลิตของแผนก (ทุกไลน์ในครอบครัว) วัน/กะนั้น */
export function sessionsOfDeptShift(idx, lines, date, shift) {
  const out = [];
  for (const l of lines || []) out.push(...(idx.get(`${date}|${shift}|${normName(l.name)}`) || []));
  return out;
}

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * `days` = [{ date, depts: [{ key, name, shifts: staffingOfDept(), sessions: { day: [...], night: [...] } }] }]
 * คืนต่อแผนก { key, name, normal: number|null (มัธยฐานคนยืนจริง), usual: {shifts, oee, p}, low: {...},
 *            diffOee, diffP, verdict: 'ok'|'thin'|'none' }
 *   usual = กะที่คนยืนจริง ≥ มัธยฐาน · low = กะที่น้อยกว่ามัธยฐาน
 */
export function compareOeeByStaffing(days) {
  const by = new Map();
  for (const day of days || []) {
    for (const d of day.depts || []) {
      if (!by.has(d.key)) by.set(d.key, { key: d.key, name: d.name, cells: [] });
      for (const sh of ['day', 'night']) {
        const s = d.shifts?.[sh];
        const rows = (d.sessions?.[sh] || []).filter(r => r.oee != null);
        if (!s || s.gap == null || !rows.length) continue;
        by.get(d.key).cells.push({ onFloor: s.onFloor, rows });
      }
    }
  }
  return [...by.values()].map(a => {
    const normal = median(a.cells.map(c => c.onFloor));
    const pick = (f) => {
      const cs = a.cells.filter(f);
      return cs.length ? { shifts: cs.length, ...oeeOfSessions(cs.flatMap(c => c.rows)) } : null;
    };
    const usual = normal == null ? null : pick(c => c.onFloor >= normal);
    const low = normal == null ? null : pick(c => c.onFloor < normal);
    const verdict = !a.cells.length ? 'none'
      : (!usual || !low || usual.shifts < MIN_SHIFTS_TO_COMPARE || low.shifts < MIN_SHIFTS_TO_COMPARE) ? 'thin' : 'ok';
    const diff = (k) => (usual?.[k] != null && low?.[k] != null ? +(low[k] - usual[k]).toFixed(1) : null);
    return { key: a.key, name: a.name, normal, usual, low, diffOee: diff('oee'), diffP: diff('p'), verdict };
  });
}

/* ── 🎯 คนมาครบ แต่ฝีมือถึงไหม (2026-10-12 · คำสั่ง user "ลุย" ข้อ 3 ของข้อเสนอ) ─────────────────────
   จากผลของ `layoutPeople()` — คนที่ "มาวันนี้และยืนอยู่ที่จุดนั้นจริง" เทียบทักษะกับที่จุดงานต้องการ (`skillFit()`)
   - นับเฉพาะ attend = present และไม่ใช่ `away` (วันนี้ไปยืนจุดอื่น → ถูกนับที่จุดที่ไปยืนแทน)
     คนลา/ขาด/ยังไม่เช็คชื่อ = ไม่ได้ยืนอยู่ ⇒ ไม่นับ (ไม่ใช่ความเสี่ยงฝีมือ)
   - 🔴 จุดที่ยังไม่ตั้งทักษะที่ต้องการ = นับแยก `noReqPeople` ห้ามนับว่า "ผ่าน"
   - `temp` (ย้ายมาวันนี้) ติดธงไว้ — คนย้ายมาชั่วคราวคือกลุ่มเสี่ยงที่หัวหน้าต้องเห็นก่อน
   คืน { gaps: [{ emp, station, shift, temp, fit, missing:[details ที่ไม่ผ่าน], onlyApproval }] (เรียงคะแนนต่ำก่อน),
         checked, ok, noReqPeople, noReqStations, onlyApproval }
   ⏳ `onlyApproval` = ทุกข้อที่ขาด ได้ขั้นแล้วแต่ค้างรอหัวหน้าอนุมัติ (pending_level ≥ เกณฑ์) — ค้างที่คน ไม่ใช่ฝีมือ  */
export function stationSkillGaps(placed, { skillsByEmp = {}, reqsByStation = {} } = {}) {
  const gaps = [];
  let checked = 0, ok = 0, noReqPeople = 0, noReqStations = 0;
  for (const x of placed || []) {
    const reqs = reqsByStation[String(x.station.id)] || [];
    const standing = (x.people || []).filter(p => p.attend === 'present' && !p.away);
    if (!reqs.length) { noReqStations += 1; noReqPeople += standing.length; continue; }
    for (const p of standing) {
      const rows = skillsByEmp[p.emp.id];
      const fit = skillFit(reqs, skillMapOf(rows), pendingMapOf(rows));
      checked += 1;
      if (fit.score >= 100) { ok += 1; continue; }
      const missing = fit.details.filter(d => !d.pass);
      // ⏳ ทุกข้อที่ขาด "ได้ขั้นแล้ว รอแค่หัวหน้าอนุมัติ" = ค้างที่คนอนุมัติ ไม่ใช่ฝีมือ
      gaps.push({ emp: p.emp, station: x.station, shift: p.shift, temp: !!p.temp, fit, missing,
        onlyApproval: missing.length > 0 && missing.every(d => d.waitApproval) });
    }
  }
  gaps.sort((a, b) => a.fit.score - b.fit.score || (b.temp - a.temp) || naturalCompare(a.emp.name || '', b.emp.name || ''));
  return { gaps, checked, ok, noReqPeople, noReqStations, onlyApproval: gaps.filter(g => g.onlyApproval).length };
}

/* ── 🗺️ ภาพรวมทั้งโรงงาน (แท็บผัง LAYOUT · 2026-11-20 · คำสั่ง user "ภาพรวมทั้งโรงงาน … ทำอะไรเจ๋งๆ") ──
   กรอบไลน์บนผังรวม (`factory_line_regions` ชุดเดียวกับ /factory-map) ระบายสีตามกำลังคน **กะปัจจุบัน**
   🔴 ฐานเทียบ = **กำลังคนตามผัง (std ต่อกะ · `planOf` → `stdCapacityOf`) ไม่ใช่จำนวนจุดงาน** (user 20/11:
      "จุดงานส่วนใหญ่เยอะกว่าจำนวนพนักงาน — คนเดียวขึ้นจุด a ครึ่งวัน จุด b ครึ่งวัน")
   เกณฑ์ (user เคาะ 20/11):
     🔴 bad  = ขาด (std − มาจริง) ≥ 3 คน
     🟡 warn = ขาด 1–2 คน **หรือ** มีคนยืนจุดที่ทักษะยังไม่ถึง
     🟢 good = มาครบ std
     ⚪ none = ตัดสินไม่ได้ — ไม่รู้ std / กะนี้ยังไม่มีใครเช็คชื่อ (เขียนเหตุผลใน `reason` · ห้ามโชว์ 0) */
export const LINE_STAFF_SHORT_BAD = 3;

/** ไลน์ของกรอบ = ตัวเอง + ลูกลงไป (**ไม่รวมไลน์แม่** — กรอบไลน์ลูกห้ามนับของแม่) · ไม่อยู่ในทะเบียน = [] */
export function lineFamilyDown(lines, lineName) {
  const self = (lines || []).find(l => l.name === lineName);
  if (!self) return [];
  const up = lineAncestorIds(lines, self.id);
  return getLineFamily(lines, lineName).filter(l => !up.has(l.id));
}

/** 🧺 กลุ่มที่ใช้ตัดสินสีกรอบ = **ไลน์แม่บนสุด** (user 20/11 "ตัดสินทั้งกลุ่ม")
    เหตุ: std ของกลุ่มอยู่ที่ไลน์แม่ (`stdManpower.js` กฎข้อ 1 — ลูกบางกลุ่มก็อปเลขแม่มา เช่น HYDROFORM 14 ทุกลูก)
    และพนักงานสังกัดไลน์แม่ ⇒ กรอบไลน์ลูกทุกกรอบในกลุ่มเดียวกัน = สถานะเดียวกัน · ไม่อยู่ในทะเบียน = ชื่อเดิม */
export function lineGroupRoot(lines, lineName) {
  const self = (lines || []).find(l => l.name === lineName);
  if (!self) return lineName;
  const rootId = lineChainIds(lines, self.id)[0];
  return (lines.find(l => String(l.id) === String(rootId)) || self).name;
}

/** จุดงานของกรอบไลน์ — จับด้วย line_id ก่อน ถอยไปชื่อ (ws เก่าไม่มี line_id) */
export function stationsOfLineFamily(lines, lineName, stations) {
  const fam = lineFamilyDown(lines, lineName);
  const ids = new Set(fam.map(l => String(l.id)));
  const names = new Set((fam.length ? fam.map(l => l.name) : [lineName]).map(n => String(n || '').trim().toLowerCase()));
  return (stations || []).filter(s => (s.line_id != null && ids.has(String(s.line_id)))
    || names.has(String(s.line_name || '').trim().toLowerCase()));
}

/**
 * คนที่มากะนี้ของกรอบ เทียบ std
 * @param familyLines   lineFamilyDown()
 * @param stationIds    Set ของ id จุดงานในกรอบ
 * @param allStationIds Set ของ id จุดงานทั้งโรงงาน (รู้ว่าวันนี้ไปยืนจุดของไลน์อื่น)
 * @param attendance    { [employee_id]: log วันนี้ } · empById { [id]: employee }
 * @param shift         'day' | 'night' (กะปัจจุบัน — `getCurrentShift()`)
 * นับคนเข้ากรอบ: วางจุดงานวันนี้แล้ว = ตามจุด (ยืมเข้า/ยืมออกถูกเอง) · ยังไม่วางจุด = ตามไลน์สังกัด (`employees.line_id`)
 * คืน { status, reason, shift, std, onFloor, checked, short, gapPeople }
 */
export function lineStaffStatus({ familyLines = [], stationIds = new Set(), allStationIds = new Set(), attendance = {}, empById = {}, shift, fit = null } = {}) {
  const famIds = new Set(familyLines.map(l => String(l.id)));
  let onFloor = 0, checked = 0;
  for (const [empId, log] of Object.entries(attendance || {})) {
    if (!log || log.shift !== shift) continue;
    const st = log.assigned_line != null ? String(log.assigned_line) : null;
    const mine = st && allStationIds.has(st) ? stationIds.has(st) : famIds.has(String(empById[empId]?.line_id ?? ''));
    if (!mine) continue;
    checked += 1;
    if (log.is_present) onFloor += 1;
  }
  const std = familyLines.length ? planOf(familyLines, shift) : null;
  const gapPeople = fit?.gaps?.filter(g => g.shift === shift).length || 0;
  const base = { shift, std, onFloor, checked, short: null, gapPeople };
  if (std == null) return { ...base, status: 'none', reason: familyLines.length ? 'ยังไม่ตั้งกำลังคน (std)' : 'ไม่ใช่ไลน์ในทะเบียน' };
  if (!checked) return { ...base, status: 'none', reason: `${shift === 'night' ? 'กะดึก' : tr("กะเช้า")}ยังไม่เช็คชื่อ` };
  const short = Math.max(0, std - onFloor);
  const out = { ...base, short };
  if (short >= LINE_STAFF_SHORT_BAD) return { ...out, status: 'bad', reason: null };
  if (short > 0 || gapPeople > 0) return { ...out, status: 'warn', reason: null };
  return { ...out, status: 'good', reason: null };
}

/** ป้ายสั้นบนกรอบ — ตัวเลขล้วน (`เช้า มา 9/11 · ขาด 2`) · none = เหตุผล */
export function lineStaffLabel(s) {
  if (!s) return null;
  if (s.status === 'none') return s.reason;
  const parts = [`${s.shift === 'night' ? 'ดึก' : 'เช้า'} มา ${s.onFloor}/${s.std}`];
  if (s.short) parts.push(`ขาด ${s.short}`);
  if (s.gapPeople) parts.push(`ทักษะไม่ถึง ${s.gapPeople}`);
  return parts.join(' · ');
}

/** ทักษะของคนที่ยืนจุดนี้วันนี้ — 'ok' | 'gap' | 'noreq' | null (ไม่ได้ยืน = ไม่ตัดสิน) */
export function personFitState(x, p, fit) {
  if (p.attend !== 'present' || p.away) return null;
  if (!(x.station.station_requirements || []).length) return 'noreq';
  return (fit?.gaps || []).some(g => g.emp.id === p.emp.id && String(g.station.id) === String(x.station.id)) ? 'gap' : 'ok';
}

/* ── 🧩 กรองบอร์ดของแผนกลงถึง "ไลน์" (23/11 · user "ให้แท็บอื่นกรองถึงระดับไลน์ด้วย") ─────────────
   ใช้กับทุกแท็บที่ถือ dept ของ `buildManpowerBoard` (ผังกำลังคน · 4M · แผน vs มาจริง)
   · คน = `line_id` อยู่ในไลน์ที่เลือก + ไลน์ลูกลงไป (**กรองตรง** · user เลือก) — ไลน์ไม่มีคนสังกัดตรง = ว่าง แล้วจอเขียนบอก
   · ช่องตำแหน่ง (`manpower_slot_plans`) ตั้ง**รายทีม** แยกลงไลน์ไม่ได้ ⇒ `slots: null` + `slotSource: 'line'` (ห้ามโชว์ 0)
   · กำลังคนตามผัง = std ของไลน์ (`planOf`) · คนวิ่งข้ามแผนก (ตั้งรายหน่วย) แยกไลน์ไม่ได้ = ซ่อน + นับบอก
   · หัวหน้าแผนก/ช่าง = งานระดับแผนก คงไว้ (ไม่นับเป็นกำลังคนอยู่แล้ว)
   @param familyLines  `lineFamilyDown(lines, ชื่อไลน์)` · ว่าง = คืน null (ไม่รู้จักไลน์ ห้ามเดา) */
export function narrowDeptToLine(d, familyLines = [], lineName = '', { stationIds = null } = {}) {
  if (!d || !familyLines.length) return null;
  const famIds = new Set(familyLines.map(l => String(l.id)));
  const famNames = new Set(familyLines.map(l => String(l.name || '').trim().toLowerCase()));
  /* 👥 คนของไลน์ = สังกัดตรง **หรือ** วันนี้ยืนจุดงานของไลน์นี้ (user 23/11: "อยู่กับแม่ก็กระจายลงลูกได้ตอนทำงาน")
     ⇒ คนสังกัดไลน์แม่ที่ถูกวางที่จุดของไลน์ลูก (`log.assigned_line` = id จุดงาน) ขึ้นที่ไลน์ลูก · ไม่ต้องย้ายสังกัด */
  const st = stationIds instanceof Set ? stationIds : new Set();
  const atStation = (p) => !!p?.log?.is_present && p.log.assigned_line != null && st.has(String(p.log.assigned_line));
  const keep = (p) => famIds.has(String(p?.line_id ?? '')) || atStation(p);
  const cols = (d.cols || []).map(c => ({ ...c, leaders: c.leaders.filter(keep), ops: c.ops.filter(keep),
    slots: null, slotPlan: null, slotSource: 'line', slotStations: undefined }))
    .filter(c => c.leaders.length || c.ops.length);
  const allOps = cols.flatMap(c => c.ops);
  const reg = { day: 0, night: 0 };
  for (const c of cols) if (c.shift) reg[c.shift] += c.ops.length;
  const plan = { day: planOf(familyLines, 'day'), night: planOf(familyLines, 'night') };
  return {
    ...d,
    cols,
    borrowed: (d.borrowed || []).filter(b => famNames.has(String(b.borrowed?.to || '').trim().toLowerCase())),
    flex: [],
    lines: familyLines,
    plan, registered: reg,
    planTotal: plan.day == null && plan.night == null ? null : (plan.day || 0) + (plan.night || 0),
    opsTotal: allOps.length,
    present: allOps.filter(p => p.attend === 'present').length,
    lentOut: allOps.filter(p => p.lentTo).length,
    unknownShiftTeams: cols.filter(c => c.team && !c.shift && c.ops.length).map(c => c.team),
    unknownPos: allOps.filter(p => p.unknownPos).length,
    stationInfo: null,
    lineFilter: { name: lineName, deptOps: d.opsTotal || 0, hiddenFlex: (d.flex || []).length,
      stations: st.size, viaStation: allOps.filter(p => !famIds.has(String(p.line_id ?? '')) && atStation(p)).length },
  };
}

/** 🧩 บอร์ดทั้งส่วนงานที่ "กรองถึงไลน์" แล้ว — ตัวเลขหัวผัง (แผน/ในทะเบียน/มาวันนี้) ต้องคิดจากแผนกที่กรองแล้ว
    ไม่งั้นหัวผังโชว์ยอดทั้งส่วนงานคู่กับคนของไลน์เดียว = จออ่านผิด (เจอตอนทำ 23/11) · ผู้จัดการ/วิศวกร (top/support) คงไว้ */
export function boardForLine(board, lineDepts) {
  if (!board) return board;
  const sum = (f) => lineDepts.reduce((a, d) => a + (f(d) || 0), 0);
  return {
    ...board,
    depts: lineDepts,
    emptyDepts: [],
    totals: {
      ...board.totals,
      plan: lineDepts.some(d => d.planTotal != null) ? sum(d => d.planTotal) : null,
      ops: sum(d => d.opsTotal),
      present: sum(d => d.present),
      borrowed: sum(d => (d.borrowed || []).length),
      flex: 0,
    },
  };
}

/** 🧩 แผนกที่ "ครอบไลน์ที่เลือก" แล้วกรองถึงไลน์ (ใช้ทั้งผังกำลังคน/4M/แผน vs มาจริง)
    🔴 std ของไลน์นับ **ครั้งเดียว** ที่แผนกหลัก — ถังไม่ระบุแผนก (`NO_DEPT`) ครอบไลน์เดียวกันได้ (คนที่ไม่มีแผนก)
       เดิมบวก std ซ้ำ 2 เท่า (เจอตอนทำ 23/11: HDF1 std 28 ขึ้นหัวผัง 56) ⇒ แผนกรองถัดไปไม่มี std + ไม่มีคน = ไม่แสดง */
export function lineDeptsOf(depts, familyLines = [], lineName = '', opts = {}) {
  if (!familyLines.length) return depts;
  const ids = new Set(familyLines.map(l => String(l.id)));
  const hits = (depts || []).filter(d => (d.lines || []).some(l => ids.has(String(l.id))));
  hits.sort((a, b) => (a.key === NO_DEPT_KEY) - (b.key === NO_DEPT_KEY));
  return hits.map((d, i) => {
    const n = narrowDeptToLine(d, familyLines, lineName, opts);
    if (!n || i === 0) return n;
    if (!n.opsTotal && !(n.borrowed || []).length) return null;
    return { ...n, plan: { day: null, night: null }, planTotal: null };
  }).filter(Boolean);
}
