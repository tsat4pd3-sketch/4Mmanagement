import { lineNameCompare } from './lineHierarchy.js';
/* ── pickerOptions — ตัวสร้าง option list ของ picker กลาง (pure · ไม่ import supabase/react) ──
   (2026-09-07 · single-source audit) ใช้โดย <PersonSelect> <MachineSelect> <ProductSelect>
   แยกออกมาให้เทสได้ตรงๆ (node:test) — กฎการ "เรียงของที่เกี่ยวข้องขึ้นก่อน ไม่ตัดของอื่นทิ้ง"
   และ "ค่าที่เลือกไว้ต้องไม่หายจากลิสต์" ถูกล็อกด้วยเทสใน __tests__/pickerOptions.test.mjs

   ⚠️ จุดใหม่ที่ต้องการ option ของคน/เครื่อง/สินค้า ให้เรียกตัวนี้ ห้ามเขียน map เองในหน้า */

const up = (s) => String(s ?? '').trim().toUpperCase();
const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
export const sameName = (a, b) => normName(a).toLowerCase() === normName(b).toLowerCase();

/** คน — profiles (user ระบบ) + employees (ทะเบียนพนักงาน)
 *  prefer ด้วย lines / lineIds / section / roles = ขึ้นก่อน (strict = ตัดคนอื่นทิ้ง) */
export function personOptions({
  profiles = [], employees = [], source = 'profiles', lines, lineIds, section, roles, teams, strict = false,
  posLabel = (v) => String(v || ''), roleLabel = (v) => String(v || ''),
} = {}) {
  const prefLines = new Set((lines || []).map(up).filter(Boolean));
  const prefLineIds = new Set((lineIds || []).filter(x => x != null && x !== '').map(Number));
  const prefSection = up(section);
  const prefRoles = new Set((roles || []).map(String));
  // ทีมช่าง (mtn_teams ของ profile / mtn_team ของ employee) — 06/10 คอมเมนต์ทีม DIE: หัวหน้าช่างที่เป็น "พนักงาน" ไม่มี role
  // ⇒ prefer ด้วย roles อย่างเดียวไม่มีวันขึ้น 🎯 · ส่ง teams=[ทีมของใบ] ให้คนในทีมขึ้นก่อน (ไม่ตัดคนอื่น)
  const prefTeams = new Set((teams || []).filter(Boolean).map(String));
  const hasPref = !!(prefLines.size || prefLineIds.size || prefSection || prefRoles.size || prefTeams.size);
  const prefer = (o) =>
    (prefLineIds.size && o.line_id != null && prefLineIds.has(Number(o.line_id))) ||
    (prefLines.size && o.line_name && prefLines.has(up(o.line_name))) ||
    (prefSection && o.section && up(o.section) === prefSection) ||
    (prefRoles.size && o.role && prefRoles.has(String(o.role))) ||
    (prefTeams.size && (o.mtn_teams || []).some(t => prefTeams.has(String(t)))) || false;

  const out = [];
  const byName = new Map();
  if (source === 'profiles' || source === 'both') {
    for (const p of profiles) {
      if (!p?.full_name) continue;
      const pos = posLabel(p.position) || roleLabel(p.role) || String(p.role || '');
      const o = {
        id: `p:${p.id}`, label: normName(p.full_name), sub: [pos, p.section].filter(Boolean).join(' · '),
        keywords: `${p.role || ''} ${p.section || ''} ${p.position || ''}`,
        kind: 'profile', uid: p.id, employee_id: p.employee_id || null, employee_code: null,
        signature_url: p.signature_url || null, section: p.section || null, position: p.position || null,
        role: p.role || null, line_id: p.line_id ?? null, line_name: p.line_name || null, team: null,
        mtn_teams: Array.isArray(p.mtn_teams) ? p.mtn_teams : [],
      };
      out.push(o); byName.set(o.label.toLowerCase(), o);
    }
  }
  if (source === 'employees' || source === 'both') {
    for (const e of employees) {
      if (!e?.name) continue;
      const nm = normName(e.name);
      const dup = source === 'both' ? byName.get(nm.toLowerCase()) : null;
      if (dup) {
        // คนเดียวกันมีทั้ง profile และ employee → profile นำ (มีลายเซ็น/role) แต่เติมรหัส/ไลน์จากทะเบียนพนักงาน
        dup.keywords += ` ${e.employee_id_code || ''}`;
        dup.employee_id = dup.employee_id || e.id; dup.employee_code = e.employee_id_code || null;
        if (dup.line_id == null) dup.line_id = e.line_id ?? null;
        if (!dup.position) dup.position = e.position || null;
        if (!dup.section) dup.section = e.section || null;
        if (e.mtn_team && !dup.mtn_teams.includes(e.mtn_team)) dup.mtn_teams = [...dup.mtn_teams, e.mtn_team];
        continue;
      }
      out.push({
        id: `e:${e.id}`, label: nm,
        sub: [e.employee_id_code, posLabel(e.position) || e.position, e.section || e.department].filter(Boolean).join(' · '),
        keywords: `${e.employee_id_code || ''} ${e.section || ''} ${e.department || ''} ${e.group_name || ''} ${e.team || ''} ${e.position || ''}`,
        kind: 'employee', uid: null, employee_id: e.id, employee_code: e.employee_id_code || null, signature_url: null,
        section: e.section || null, position: e.position || null, role: null, line_id: e.line_id ?? null, line_name: e.line_name || null, team: e.team || null,
        mtn_teams: e.mtn_team ? [e.mtn_team] : [],
      });
    }
  }
  // คนในทีมช่างของใบ (teams) อยู่ชั้นบนสุด — เหนือ "มี role หัวหน้า" ที่กว้างทั้งโรงงาน
  const inTeam = (o) => prefTeams.size > 0 && (o.mtn_teams || []).some(t => prefTeams.has(String(t)));
  const tagged = out.map(o => ({ ...o, _pref: hasPref ? (inTeam(o) ? 2 : prefer(o) ? 1 : 0) : 0 }));
  const kept = strict && hasPref ? tagged.filter(o => o._pref) : tagged;
  kept.sort((a, b) => (b._pref - a._pref) || a.label.localeCompare(b.label, 'th'));
  return kept.map(o => ({
    ...o,
    _pref: o._pref > 0,
    group: o._pref === 2 ? '👷 ทีมช่างของใบนี้' : (hasPref && o._pref ? '🎯 ที่เกี่ยวข้อง' : (o.kind === 'profile' ? '👤 ผู้ใช้ระบบ' : '🪪 พนักงาน')),
    badge: o.signature_url ? '✍️' : null,
  }));
}

const KIND_ICON = { machine: '⚙️', die: '🧱', jig: '🔧', facility: '🏭' };

/** ข้อความที่ต้องส่งให้ <SearchSelect> ของ picker กลาง — **คืน `undefined` = ปล่อยให้ SearchSelect ถือคำค้นเอง**
 *  ⚠️ กฎเหล็ก: picker ที่พาเรนต์เก็บแค่ **FK id** (valueKey='id') **ห้ามส่ง text เป็น ''** —
 *  '' คือ controlled ว่าง → ทุกตัวอักษรที่พิมพ์ถูกล้างทันที และ q='' ตลอด = ค้นหาไม่ทำงานเลย
 *  (เกิดจริง 2026-09-08: จอเพิ่มอุปกรณ์ PM พิมพ์หาจิ๊กไม่ได้ ต้องเลื่อนหาอย่างเดียว)
 *  พาเรนต์ที่เก็บ "ค่า text" เอง (machine_no/mat_no/ชื่อคน) ส่งค่าที่เก็บไว้ได้ตามปกติ */
export function pickerText({ selLabel, value, storesText = true }) {
  if (selLabel != null) return selLabel;
  return storesText ? (value || '') : undefined;
}

/** เครื่องจักร (DR machines) — prefer ด้วยครอบครัวไลน์ · กรอง kinds · ตัด is_active=false เว้นค่าที่เลือกอยู่ */
/*  `groupByLine` = จัดกลุ่มตาม 📍 ไลน์ (ใช้เมื่อยังไม่รู้ไลน์ปลายทาง จึง prefer ไม่ได้) — คนหน้างานไล่หา
    ของตัวเองจาก "ไลน์" เป็นหลัก · ทะเบียนจริง 635 ตัว ในนั้นเป็นแม่พิมพ์ 262 ตัวที่ใช้ชื่อพาร์ทยาวๆ
    เป็น machine_no → ลิสต์แบนเรียงตามรหัสอ่านไม่รู้เรื่อง (feedback หน้างาน 2026-09-08
    "ปกติมันจะเป็นไลน์ผลิตค่ะ ตอนจะแอดอุปกรณ์ใหม่")  */
export function machineOptions(machines, { lines, kinds, strict = false, includeInactive = false, current, groupByLine = false } = {}) {
  const pref = new Set((lines || []).map(up).filter(Boolean));
  const kindSet = kinds?.length ? new Set(kinds) : null;
  const cur = up(current);
  let rows = (machines || []).filter(m => m?.machine_no);
  if (kindSet) rows = rows.filter(m => kindSet.has(m.equipment_kind || 'machine'));
  if (strict && pref.size) rows = rows.filter(m => pref.has(up(m.line_name)));
  rows = rows.filter(m => includeInactive || m.is_active !== false || up(m.machine_no) === cur);
  const tagged = rows.map(m => ({
    id: m.id, label: m.machine_no, key: up(m.machine_no),
    sub: [m.machine_name, m.line_name].filter(Boolean).join(' · '),
    keywords: `${m.machine_name || ''} ${m.line_name || ''} ${m.process_type || ''} ${m.equipment_kind || ''}`,
    badge: m.is_active === false ? '⏸' : (KIND_ICON[m.equipment_kind] || null),
    badgeColor: m.is_active === false ? 'var(--muted)' : undefined,
    machine_no: m.machine_no, name: m.machine_name || null, line_name: m.line_name || null, equipment_kind: m.equipment_kind || 'machine',
    _pref: pref.size ? pref.has(up(m.line_name)) : false,
  }));
  // groupByLine: เรียงตามไลน์ก่อนแล้วค่อยรหัสเครื่อง — แถวของไลน์เดียวกันต้องอยู่ติดกัน
  // ไม่งั้นหัวกลุ่มโผล่ซ้ำ (SearchSelect ขึ้นหัวกลุ่มเมื่อค่า group เปลี่ยนจากแถวก่อนหน้า)
  tagged.sort((a, b) => (b._pref - a._pref)
    || (groupByLine ? ((!a.line_name) - (!b.line_name) || lineNameCompare(a.line_name || '', b.line_name || '')) : 0)   // ลำดับไลน์มาตรฐาน · ไม่ระบุไลน์ = ท้าย
    || a.label.localeCompare(b.label, undefined, { numeric: true }));
  return tagged.map(o => ({
    ...o,
    group: pref.size ? (o._pref ? '🎯 ไลน์ที่เลือก' : '🏭 ไลน์อื่น')
      : (groupByLine ? `📍 ${o.line_name || 'ไม่ระบุไลน์'}` : undefined),
  }));
}

/** สินค้า (DR dr_products) — prefer ด้วยไลน์ · ตัด OP (is_operation) เป็น default · extraOptions = พาร์ทลูก BOM */
export function productOptions(products, { lines, strict = false, includeOps = false, includeInactive = false, current, extraOptions = [] } = {}) {
  const pref = new Set((lines || []).map(up).filter(Boolean));
  const cur = up(current);
  let rows = (products || []).filter(p => p?.mat_no);
  if (!includeOps) rows = rows.filter(p => !p.is_operation);
  if (strict && pref.size) rows = rows.filter(p => pref.has(up(p.line_name)));
  rows = rows.filter(p => includeInactive || p.is_active !== false || up(p.mat_no) === cur);
  /* 🔴 2 บรรทัด · รหัสห้ามถูกตัด (2026-09-30 · feedback "ขอเห็นเลข Mat ด้วย")
     บรรทัด 1 = Part No. (lead · ห้ามตัด) + ชื่องาน (title · ตัดได้ตัวเดียว)
     บรรทัด 2 = MAT SAP (code · ห้ามตัด) + ลูกค้า/ไลน์ (sub · ตัดได้)
     `label` ยังเป็น mat_no เพราะเป็น **ค่าที่ฟอร์มเก็บจริง** — เปลี่ยนแล้วชิปที่เลือกจะโชว์คนละค่ากับที่บันทึก
     ไม่มีทั้ง Part No. และชื่อ ⇒ ยก MAT ขึ้นเป็นหัวแถว (ห้ามได้แถวหัวว่าง) */
  const tagged = rows.map(p => {
    const hasHead = !!(p.p_no || p.name);
    return {
    id: p.id, label: p.mat_no, key: up(p.mat_no),
    lead: p.p_no || null,
    title: hasHead ? (p.name || '') : `MAT ${p.mat_no}`,
    code: hasHead ? `MAT ${p.mat_no}` : null,
    sub: [p.customer, p.line_name].filter(Boolean).join(' · '),
    keywords: `${p.name || ''} ${p.p_no || ''} ${p.customer || ''} ${p.line_name || ''}`,
    badge: p.is_active === false ? '⏸' : (p.customer || null),
    badgeColor: p.is_active === false ? 'var(--muted)' : undefined,
    mat_no: p.mat_no, name: p.name || null, p_no: p.p_no || null, customer: p.customer || null, line_name: p.line_name || null,
    _pref: pref.size ? pref.has(up(p.line_name)) : false,
    };
  });
  tagged.sort((a, b) => (b._pref - a._pref) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  const main = tagged.map(o => ({ ...o, group: pref.size ? (o._pref ? '🎯 ไลน์ที่เลือก' : '🏭 ไลน์อื่น') : '📦 Product Master' }));
  const seen = new Set(main.map(o => o.key));
  const extra = [];
  for (const o of extraOptions || []) {
    if (!o?.mat_no) continue;
    const k = up(o.mat_no); if (seen.has(k)) continue; seen.add(k);
    extra.push({
      id: `x:${k}`, label: String(o.mat_no).trim(), key: k,
      lead: o.p_no || null,
      title: (o.p_no || o.name) ? (o.name || '') : `MAT ${String(o.mat_no).trim()}`,
      code: (o.p_no || o.name) ? `MAT ${String(o.mat_no).trim()}` : null,
      sub: o.sub || '', keywords: `${o.name || ''} ${o.p_no || ''} ${o.keywords || ''}`,
      mat_no: String(o.mat_no).trim(), name: o.name || null, p_no: o.p_no || null, customer: o.customer || null, line_name: o.line_name || null,
      group: o.group || '🧩 พาร์ทลูก (BOM / parts_master)', extra: true,
    });
  }
  return [...main, ...extra];
}

/** เติม "ค่าที่เคยบันทึกไว้" + "ค่าปัจจุบันที่ไม่อยู่ในทะเบียน" ต่อท้าย option ของ picker
 *  (2026-09-07 · คำสั่ง user: ทะเบียนไม่มี = ใช้ข้อมูลที่เคยลงไว้ได้ ห้ามล้าง/บล็อกเงียบ)
 *  - `history` = distinct ค่าจากคอลัมน์ปลายทาง (useColumnHistory) → กลุ่ม 📜 เฉพาะตัวที่ไม่มีในทะเบียน
 *  - `current` = ค่าที่เก็บอยู่ → ถ้าไม่ตรงทะเบียน/ประวัติ ให้เป็น option ด้วย (SearchSelect จะได้ไม่ล้าง)
 *  ทุกตัวติดป้าย ⚠ ให้เห็นว่านอกทะเบียน · `make(value)` สร้าง field เฉพาะของ picker นั้น */
export const HISTORY_GROUP = '📜 เคยบันทึกไว้ (ไม่มีในทะเบียน)';
export function appendHistoryOptions(options, { history = [], current = '', keyOf = (v) => up(v), make = () => ({}) } = {}) {
  const seen = new Set(options.map(o => o.key ?? keyOf(o.label)));
  const extra = [];
  const add = (v) => {
    const s = String(v ?? '').trim(); if (!s) return;
    const k = keyOf(s); if (!k || seen.has(k)) return;
    seen.add(k);
    extra.push({ id: `hist:${k}`, key: k, label: s, group: HISTORY_GROUP, badge: '⚠ นอกทะเบียน', badgeColor: 'var(--accent2)', history: true, ...make(s) });
  };
  (history || []).forEach(add);
  add(current);
  return extra.length ? [...options, ...extra] : options;
}
