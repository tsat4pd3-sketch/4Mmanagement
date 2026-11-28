/* ══ ♻️ 5S Dashboard — สูตรทั้งหมดของจอ (ยกจาก Core `fiveSDash.ts` + `summarize5s` 27/11 · loop smf01) ══
   ไฟล์ข้อมูลล้วน (ไม่มี React / ไม่ยิง DB) · หน้า `Dashboard.jsx` โหลดแถวแล้วส่งเข้าที่นี่
   · เดือนของใบตรวจ = เวลาไทย (Asia/Bangkok) ไม่ใช่ UTC
   · ไม่มีใบในเดือนนั้น = `audits: 0` + `percent: null` (จอเขียน "-" ห้ามโชว์ 0)
   · ฟังก์ชันที่ต้องรู้ "วันนี้" รับ `today` เป็นพารามิเตอร์ (เทสตรึงค่าได้ · ด่านนาฬิกา +400 วัน) */
import { S_GROUPS } from './labels.js';

const bkk = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric', day: 'numeric' });

/** เดือน (1–12) ของเวลา ISO ตามเวลาไทย · อ่านไม่ออก = 0 */
export function monthOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Number(bkk.formatToParts(d).find(p => p.type === 'month')?.value) || 0;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const avg = (xs) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null);
const round = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** เกณฑ์ผ่านของปี (act02_setting) · ลำดับ: รายที่ (`:factory`/`:office`) → รายปี → ค่ากลาง → pass_percent → 80 */
export function passOf(settings, year) {
  const m = new Map((settings || []).map(r => [String(r.setting_key), num(r.setting_value)]));
  const base = m.get(`pass_percent:${year}`) || m.get('pass_percent') || 80;
  const self = m.get(`pass_self:${year}`) || m.get('pass_self') || base;
  const committee = m.get(`pass_committee:${year}`) || m.get('pass_committee') || base;
  const place = (p) => ({ self: m.get(`pass_self:${year}:${p}`) || self, committee: m.get(`pass_committee:${year}:${p}`) || committee });
  return { self, committee, factory: place('factory'), office: place('office') };
}

/** เส้นเป้าบนกราฟ: เลือกที่แล้ว = เส้นของที่นั้น · ทั้งหมดและ 2 ที่เท่ากัน = เส้นเดียว · ต่างกัน = 2 เส้น */
export function marksOf(pass, kind, areaType) {
  const f = pass.factory[kind];
  const o = pass.office[kind];
  if (areaType === 'factory') return [{ place: 'factory', value: f }];
  if (areaType === 'office') return [{ place: 'office', value: o }];
  return f === o ? [{ value: f }] : [{ place: 'factory', value: f }, { place: 'office', value: o }];
}

/** 12 เดือน: ค่าเฉลี่ย percent_score ของใบในเดือนนั้น */
export function monthly(audits) {
  const buckets = Array.from({ length: 12 }, () => []);
  for (const a of audits) {
    const m = monthOf(a.audited_at);
    if (m >= 1 && m <= 12) buckets[m - 1].push(num(a.percent_score));
  }
  return buckets.map((xs, i) => ({ month: i + 1, percent: round(avg(xs), 2), audits: xs.length }));
}

/** ภาพรวม: ใบที่ผ่านตัวกรอง → ค่าเฉลี่ยราย ส (จากวิว act02_audit_group) + รายเดือนแยก Self / Committee */
export function summarize({ areas, audits, groups, areaType = '', areaId = '', type = '' }) {
  const allowed = new Set(areas.filter(a => (!areaType || a.area_type === areaType) && (!areaId || a.act_area === areaId)).map(a => a.act_area));
  const done = audits.filter(a => a.status === 'COMPLETED' && allowed.has(a.act_area));
  const picked = type ? done.filter(a => a.audit_type === type) : done;
  const ids = new Set(picked.map(a => a.act_audit));
  const byGroup = new Map();
  for (const g of groups) {
    if (!ids.has(g.act_audit)) continue;
    const list = byGroup.get(g.s_group) || [];
    list.push(num(g.percent));
    byGroup.set(g.s_group, list);
  }
  return {
    count: picked.length,
    groups: S_GROUPS.map(g => ({ group: g, percent: round(avg(byGroup.get(g) || []), 1) })),
    self: monthly(done.filter(a => a.audit_type === 'SELF')),
    committee: monthly(done.filter(a => a.audit_type === 'COMMITTEE')),
  };
}

/** อันดับพื้นที่ (สะสม ม.ค. → เดือน upTo) แยกโรงงาน / สำนักงาน · เรียงค่าเฉลี่ยมาก → น้อย */
export function ranking({ areas, audits, groups, upTo = 12 }) {
  const inRange = audits.filter(a => a.status === 'COMPLETED' && monthOf(a.audited_at) >= 1 && monthOf(a.audited_at) <= upTo);
  const byAudit = new Map();
  for (const g of groups) {
    if (!byAudit.has(g.act_audit)) byAudit.set(g.act_audit, new Map());
    byAudit.get(g.act_audit).set(g.s_group, num(g.percent));
  }
  const byArea = new Map();
  for (const a of inRange) {
    const list = byArea.get(a.act_area) || [];
    list.push(byAudit.get(a.act_audit) || new Map());
    byArea.set(a.act_area, list);
  }
  const out = {};
  for (const kind of ['factory', 'office']) {
    const rows = areas
      .filter(a => a.area_type === kind && byArea.has(a.act_area))
      .map(a => {
        const list = byArea.get(a.act_area);
        const values = S_GROUPS.map(g => round(avg(list.map(m => m.get(g)).filter(v => v != null)), 1));
        return { id: a.act_area, code: a.area_code, name: a.act_area_name, groups: values, average: round(avg(values.filter(v => v != null)), 1), audits: list.length };
      })
      .sort((x, y) => (y.average ?? -1) - (x.average ?? -1) || String(x.code).localeCompare(String(y.code)));
    out[kind] = rows;
  }
  return out;
}

/** ผู้ตรวจ (บทบาท auditor ที่มีทีม · ปีนั้น · Active) เทียบแผนของทีม กับใบ Committee ที่ชื่ออยู่ใน auditors */
export function auditorStats({ team, plans, audits, passTarget }) {
  const committee = audits.filter(a => a.status === 'COMPLETED' && a.audit_type === 'COMMITTEE');
  const seen = new Set();
  const people = team.filter(m => m.role === 'auditor' && m.team && m.status === 'Active' && !seen.has(m.employee_code) && seen.add(m.employee_code));
  const rows = people.map(m => {
    const mine = committee.filter(a => (a.auditors || []).includes(m.employee_code));
    const planned = plans.filter(p => p.team === m.team).length;
    const actual = mine.length;
    const percent = planned > 0 ? Math.round((actual / planned) * 100) : actual > 0 ? 100 : 0;
    return {
      code: m.employee_code, name: m.employee_name || '', team: m.team, planned, actual, percent,
      avgScore: round(avg(mine.map(a => num(a.percent_score))), 2),
      audits: mine.slice().sort((x, y) => String(y.audited_at).localeCompare(String(x.audited_at))),
    };
  }).sort((a, b) => a.team.localeCompare(b.team) || a.code.localeCompare(b.code));
  const passed = rows.filter(r => r.percent >= passTarget).length;
  return {
    rows,
    total: rows.length,
    planned: rows.reduce((s, r) => s + r.planned, 0),
    actual: rows.reduce((s, r) => s + r.actual, 0),
    avgParticipation: rows.length ? Math.round(rows.reduce((s, r) => s + r.percent, 0) / rows.length) : null,
    passed,
    teams: [...new Set(rows.map(r => r.team))].sort((a, b) => a.localeCompare(b)),   // ทีม A–I
  };
}

/** สถานะผู้ตรวจ (ตัวกรอง + ป้าย) */
export function auditorState(r, passTarget) {
  if (r.percent >= 100) return 'complete';
  if (r.percent >= passTarget) return 'pass';
  return r.percent > 0 ? 'below' : 'none';
}

/* แผนงาน: สูตรย้ายไปของกลาง `src/utils/planTasks.js` (28/11 · ใช้ทุกกิจกรรม) — export ต่อให้ที่เดิมใช้ได้ */
export { planStatus, derive, taskTree } from '../../utils/planTasks.js';

/** กลุ่มในแท็บทีม (กติกาเดิมของ Core): ทีมมาตรฐาน / วิชาการ / ประชาสัมพันธ์ / ตรวจประเมิน (auditor + owner) / คณะกรรมการ (ที่เหลือ) */
export function teamBucket(role) {
  if (['standard', 'academic', 'pr'].includes(role)) return role;
  if (['auditor', 'owner'].includes(role)) return 'audit';
  return 'board';
}
