import { lineAncestorIds, widerLineId } from './lineHierarchy.js';
import { levelOfPosition } from './positions.js';
import { shiftFromTeam, scheduleTeamFor } from './shiftAssign.js';
import { naturalCompare } from './listOrder.js';

/* 👨‍🔧 **"หัวหน้างานของไลน์นี้" — ใครบ้าง และของกะไหน** (2026-10-28 · feedback หน้างาน)
 *
 * *"ไลน์นึง มีหัวหน้าได้ 2-3 คน แล้วแต่ว่ามีกี่กะการทำงาน บางที่ 1 กะ บางที่ 2 กะ บางที่ 3 กะ"*
 *
 * 🔴 **`production_lines.head_name` = ช่องข้อความช่องเดียว ⇒ ตอบคำถามนี้ไม่ได้ตั้งแต่ต้น**
 *    วัดจริง 28/10 (13 ไลน์ที่กรอกไว้) — ช่องเดียวถูกกรอกเป็น **3 ความหมายปนกัน**:
 *      · หัวหน้าแผนก 3 ไลน์ · หัวหน้าไลน์ "ของกะเช้า" 3 ไลน์
 *      · ชื่อที่**จับคู่กับทะเบียนพนักงานไม่ได้เลย 6 ไลน์** (พิมพ์มือ สะกดไม่ตรง เช่น "สุวิทชัย" vs "สุวิทย์ชัย")
 *    และไลน์จริงมีหัวหน้า 1–4 คนต่อ 2 ทีม (เช่น LINE APRON ASSY: A×2 · B×2)
 *
 * ⇒ **แหล่งความจริงคือทะเบียนพนักงาน** (`employees.position` + `team`) ซึ่งจอเช็คชื่อ/
 *    จัดกะ/บอร์ดกำลังคน อ่านอยู่แล้ว · `head_name` เหลือสถานะ "ชื่อที่พิมพ์ทับ" เท่านั้น
 *
 * ── 🔴 2 ทะเบียนตอบคนละคำถาม — ห้ามใช้ตัวเดียวตอบทั้งคู่ (แก้ 28/10 รอบ 2 · feedback user
 *    *"มันมีหัวหน้าหมดแล้วนะ นอกจากฐานข้อมูลกับ user ใช้งานจะมั่วไม่ตรงกัน"*) ──
 *   | คำถาม | อ่านจาก | ทำไม |
 *   |---|---|---|
 *   | **เป็นหัวหน้าไหม** (ตำแหน่งงาน) | `employees.position` | `profiles.role` = **ชุดสิทธิ์ใช้ระบบ ไม่ใช่ตำแหน่งงาน** (กฎ CLAUDE.md) · ช่าง 4 คนของ HYDROFORM ถือ role `supervisor` ไว้ใช้สิทธิ์ ไม่ได้เป็นหัวหน้า |
 *   | **ดูแลไลน์ไหน** (ขอบเขต)      | **`widerLineId(profiles.line_id, employees.line_id)`** | กฎ 27/10 — หัวหน้าสังกัด*ไลน์ลูก* แต่แอดมินตั้ง `profiles.line_id` เป็น*ไลน์แม่* (ไลน์ที่เขาดูแลจริง) ⇒ เอาตัวที่กว้างกว่า |
 *   | **ทีม/กะ**                     | `employees.team` → ไม่มีจึง `profiles.team` | ตัวตนจริงชนะ |
 *   วัดจริง 28/10: `Assembly Line D - GWM&RA` มีหัวหน้า 3 คนใน `profiles` ผูกที่**ไลน์แม่**
 *   แต่ `employees.line_id` ของเขาอยู่ที่ **Line D2 / Line D3** ⇒ อ่านฝั่ง employees อย่างเดียว
 *   = **ไลน์แม่ไม่มีหัวหน้าเลย** ทั้งที่มีจริง
 *
 * 🔴 **ที่ 2 ทะเบียนไม่ตรงกัน = `conflicts`** — ห้ามเงียบ ห้ามเลือกข้างให้เอง
 *   (บัญชีตั้ง role หัวหน้า แต่ตำแหน่งเป็นพนักงาน / มีบัญชีแต่ไม่มีตัวตนในทะเบียนพนักงาน)
 *   จอต้องเขียนบนจอให้คนไปแก้ — **ห้าม backfill เดาให้**
 *
 * กติกาที่ไฟล์นี้เป็นเจ้าของ (ห้ามเขียนชุดที่ 2 ในหน้า):
 *  1. **ไลน์ตัวเองชนะไลน์แม่เสมอ** — ไม่มีหัวหน้าของตัวเอง จึงค่อยไล่ขึ้นไปหาไลน์แม่ที่ใกล้ที่สุด
 *     (กฎตกทอดชุดเดียวกับ `cost_center`/`head_name` ที่ `LineSetup`/`Report` ใช้อยู่)
 *     🔴 **ไม่ไล่ลงไปกวาดไลน์ลูก** — "ไลน์ที่เขาดูแล" ตัดสินที่ `widerLineId` ของคนคนนั้นทีละคน
 *     (หัวหน้าที่ดูแลไลน์แม่จริงจะถูกยกขึ้นมาเอง · คนที่ดูแลเฉพาะไลน์ลูกจะไม่ถูกยก)
 *  2. **กะมาจากตารางกะจริง** (`scheduleTeamFor` + `shiftFromTeam`) **ห้ามเดาว่า A = กะเช้า**
 *     ไม่ส่ง `maps` / ตารางกะยังไม่ตั้ง = `shift: null` ⇒ จอต้องเขียนว่า "ยังไม่รู้กะ" ห้ามเดา
 *  3. **ไม่มีหัวหน้าไลน์เลย จึงถอยไปหัวหน้าแผนก** (`level: 'supervisor'`) — บอกชั้นที่ใช้กลับไปด้วย
 *     เพื่อให้จอเขียนได้ว่า "นี่คือหัวหน้าแผนก ไม่ใช่หัวหน้าไลน์"
 *  4. 🔴 **คืน `[]` = "ทะเบียนยังไม่มี" ไม่ใช่ "ไลน์นี้ไม่มีหัวหน้า"** — ผู้เรียกต้องแยก 2 อย่างนี้บนจอ
 */

/** ระดับตำแหน่งที่ถือว่าเป็น "หัวหน้างาน" — เรียงจากใกล้หน้างานที่สุด */
export const HEAD_LEVELS = Object.freeze(['leader', 'supervisor']);

const txt = (v) => String(v ?? '').trim();
const SHIFT_ORDER = { day: 0, night: 1, x: 2 };

/**
 * @param {object}   p
 * @param {number|string} p.lineId     ไลน์ที่ถาม
 * @param {object[]} p.lines           ทะเบียนไลน์ (ผ่าน useProductionLines)
 * @param {object[]} p.employees       พนักงาน active ({ id, name, position, team, line_id })
 * @param {object}   [p.maps]          buildScheduleMaps(shift_schedules, lines) — ไม่ส่ง = ไม่รู้กะ
 * @param {string}   [p.legacyName]    `production_lines.head_name` ของไลน์นั้น (ชื่อที่พิมพ์ทับ)
 * @returns {{rows, byShift, level, fromLineName, legacyName, legacyInRegistry}}
 */
/**
 * ไลน์ที่ต้อง "ดึงพนักงานมาดู" เพื่อตอบหัวหน้าของไลน์นี้ — **ไม่ใช่ชุดเดียวกับคำตอบ**
 * = สายของตัวเอง (ตัวเอง+แม่) **บวกไลน์ที่สายนี้เป็นแม่ของมัน**
 * เพราะหัวหน้าที่ดูแลไลน์แม่ อาจ**สังกัด**ไลน์ลูก (`employees.line_id` = ไลน์ลูก) —
 * ไม่ดึงไลน์ลูกมาด้วย = คนคนนั้นไม่เคยถูกพิจารณา แล้วไลน์แม่ขึ้นว่า "ไม่มีหัวหน้า" ทั้งที่มี
 * 🔴 **ผู้เรียกต้องใช้ตัวนี้ตอนคิวรี** ห้ามคิวรีแค่ `[lineId, ...ancestors]` (เคสจริง Assembly Line D 28/10)
 */
export function headScopeLineIds(lines = [], lineId) {
  if (lineId == null) return [];
  const chain = [lineId, ...lineAncestorIds(lines, lineId)];
  const inChain = (id) => chain.some(c => String(c) === String(id));
  const out = new Set(chain);
  for (const l of lines) {
    if (out.has(l.id)) continue;
    for (const a of lineAncestorIds(lines, l.id)) if (inChain(a)) { out.add(l.id); break; }
  }
  return [...out];
}

export function lineHeadsOf({ lineId, lines = [], employees = [], profiles = [], maps = null, legacyName = '' } = {}) {
  const empty = {
    rows: [], byShift: { day: [], night: [], unknown: [] },
    level: null, fromLineName: null, conflicts: [], unlinkedAccounts: [],
    legacyName: txt(legacyName), legacyInRegistry: null,
  };
  if (lineId == null) return empty;

  const chain = [lineId, ...lineAncestorIds(lines, lineId)];
  const inChain = (id) => id != null && chain.some(c => String(c) === String(id));
  const nameOfLine = (id) => lines.find(l => String(l.id) === String(id))?.name || null;

  /* 🔑 จับคู่ "บัญชีผู้ใช้ ↔ พนักงาน" ด้วย **`profiles.employee_id` (FK) ก่อนเสมอ**
     ชื่อเป็น**ท่าสุดท้าย** สำหรับบัญชีที่ยังไม่ผูก FK — และติดธง `_byName` ให้จอรู้ว่าเป็นของเปราะ
     🔴 เคยพลาดมาแล้ว: จับด้วยชื่อล้วน ⇒ "ณัฐพล  คำผาง" (เว้น 2 เคาะ) จับไม่ติด = หัวหน้าหายทั้งไลน์
        (กฎ CLAUDE.md: ทะเบียนที่จับคู่ด้วย "ข้อความ" คือกับดัก — มี FK ให้ใช้ ต้องใช้ FK) */
  const profByFk = new Map(profiles.filter(p => p?.employee_id).map(p => [String(p.employee_id), p]));
  const profOf = (e) => profByFk.get(String(e?.id))
    || (profiles.find(p => !p?.employee_id && sameName(p.full_name, e?.name)) ? { ...profiles.find(p => !p?.employee_id && sameName(p.full_name, e?.name)), _byName: true } : null);
  /* ทิศกลับ: บัญชี → พนักงาน (ใช้ตอนหา conflicts) — FK ก่อน แล้วค่อยชื่อ */
  const empById = new Map(employees.map(e => [String(e.id), e]));
  const empOfProfile = (p) => (p?.employee_id ? empById.get(String(p.employee_id)) : null)
    || employees.find(x => sameName(x.name, p?.full_name)) || null;

  /* ① ไลน์ที่พนักงานคนนี้ "ดูแล" — ของบัญชีกว้างกว่าชนะ (กฎ 27/10 widerLineId) */
  const ownedLineId = (e) => widerLineId(profOf(e)?.line_id ?? null, e.line_id ?? null, lines);

  /* ② หัวหน้าของไลน์ในสาย — ชั้น leader ก่อน ไม่มีจึงถอยไป supervisor
        เลือกไลน์ที่ใกล้ตัวเองที่สุดในสาย (ไลน์ตัวเองชนะไลน์แม่) */
  let picked = [], level = null, fromId = null;
  outer:
  for (const lv of HEAD_LEVELS) {
    for (const id of chain) {
      const hit = employees.filter(e =>
        levelOfPosition(e.position) === lv && String(ownedLineId(e)) === String(id));
      if (hit.length) { picked = hit; level = lv; fromId = id; break outer; }
    }
  }

  const rows = picked.map(e => {
    const pr = profOf(e);
    const team = txt(e.team).toUpperCase() || txt(pr?.team).toUpperCase() || null;
    return {
      id: e.id,
      name: txt(e.name),
      position: e.position,
      team,
      // ③ กะจากตารางกะจริง — ไม่รู้ = null (ห้ามเดาจากตัวอักษรทีม)
      shift: maps ? shiftFromTeam(scheduleTeamFor({ ...e, team }, maps), team) || null : null,
      lineName: nameOfLine(ownedLineId(e)),
      hasAccount: !!pr,
      // 🔴 true = ผูกกันด้วย "ชื่อ" ไม่ใช่ FK ⇒ เปลี่ยนชื่อ/เว้นวรรคเมื่อไหร่ ความเชื่อมโยงขาดเงียบ
      linkedByName: !!pr?._byName,
    };
  }).sort((a, b) =>
    (SHIFT_ORDER[a.shift ?? 'x'] - SHIFT_ORDER[b.shift ?? 'x'])
    || naturalCompare(a.team || 'zz', b.team || 'zz')
    || naturalCompare(a.name, b.name));

  const byShift = { day: [], night: [], unknown: [] };
  for (const r of rows) byShift[r.shift === 'day' || r.shift === 'night' ? r.shift : 'unknown'].push(r);

  /* ④ 🔴 จุดที่ 2 ทะเบียนไม่ตรงกัน — ห้ามเลือกข้างให้เอง ให้จอเขียนแล้วคนไปแก้
        kind: 'role_only'  = บัญชีตั้ง role หัวหน้า แต่ตำแหน่งในทะเบียนพนักงานไม่ใช่หัวหน้า
              'no_employee'= มีบัญชีผูกไลน์นี้ แต่จับคู่ตัวตนในทะเบียนพนักงานไม่ได้ (ชื่อไม่ตรง/ยังไม่ลงทะเบียน) */
  const pickedIds = new Set(picked.map(e => e.id));
  const conflicts = [];
  for (const p of profiles) {
    if (!['leader', 'supervisor'].includes(p?.role)) continue;
    if (!inChain(p.line_id)) continue;
    const e = empOfProfile(p);
    if (!e) { conflicts.push({ kind: 'no_employee', name: txt(p.full_name), role: p.role, team: txt(p.team).toUpperCase() || null }); continue; }
    if (pickedIds.has(e.id)) continue;                       // ตรงกันแล้ว ไม่ใช่ปัญหา
    if (HEAD_LEVELS.includes(levelOfPosition(e.position))) continue;   // เป็นหัวหน้าของไลน์อื่นในสาย
    conflicts.push({ kind: 'role_only', name: txt(p.full_name), role: p.role,
      team: txt(e.team).toUpperCase() || txt(p.team).toUpperCase() || null, position: e.position });
  }

  const lg = txt(legacyName);
  return {
    rows, byShift, level, conflicts,
    // null = หัวหน้าเป็นของไลน์ตัวเอง · มีค่า = ตกทอดมาจากไลน์แม่ชื่อนี้ (จอต้องเขียนบอก)
    fromLineName: fromId != null && String(fromId) !== String(lineId) ? nameOfLine(fromId) : null,
    legacyName: lg,
    /* 🔴 `null` = **ยังตัดสินไม่ได้** (ไม่มีชื่อพิมพ์ทับ หรือยังไม่ได้โหลดทะเบียนพนักงาน)
       ห้ามตีเป็น false แล้วขึ้นเตือน "ชื่อนี้ไม่มีในทะเบียน" ทั้งที่แค่ยังโหลดไม่เสร็จ */
    legacyInRegistry: !lg || (!employees.length && !profiles.length) ? null
      : employees.some(e => sameName(e.name, lg)) || profiles.some(p => sameName(p.full_name, lg)),
    /* 🔑 บัญชีหัวหน้าของไลน์นี้ที่ยัง **ไม่ผูก `employee_id`** — จับคู่อยู่ได้ด้วยชื่อเท่านั้น (เปราะ)
       จอควรเขียนบอกให้ไปผูกที่ทะเบียนผู้ใช้ · ไม่ใช่ error แต่เป็นหนี้ที่รอวันขาด */
    unlinkedAccounts: profiles.filter(p => ['leader', 'supervisor'].includes(p?.role)
      && inChain(p.line_id) && !p.employee_id).map(p => txt(p.full_name)),
  };
}

/** เทียบชื่อคนแบบผ่อนคำนำหน้า/ช่องว่าง — "คุณสุวิทย์ชัย  ดีทั่ว" = "สุวิทย์ชัย ดีทั่ว"
 *  🔴 ผ่อนได้แค่ **รูปแบบ** เท่านั้น (คำนำหน้า/ช่องว่าง) — สะกดต่าง = คนละคน ห้ามเดาให้ตรง
 *  (หลักเดียวกับ `snapMachineNo` ของเลขเครื่อง) */
export function sameName(a, b) {
  const k = (s) => txt(s).replace(/^(คุณ|นาย|นาง|นางสาว|น\.ส\.)\s*/u, '').replace(/\s+/g, '');
  const ka = k(a), kb = k(b);
  return !!ka && ka === kb;
}

/** ข้อความสรุปสำหรับจอ — "กะเช้า: ก, ข · กะดึก: ค" · ไม่รู้กะ = บอกตรงๆ */
export function headsSummary(heads) {
  if (!heads?.rows?.length) return '';
  const part = [];
  if (heads.byShift.day.length) part.push(`กะเช้า: ${heads.byShift.day.map(r => r.name).join(', ')}`);
  if (heads.byShift.night.length) part.push(`กะดึก: ${heads.byShift.night.map(r => r.name).join(', ')}`);
  if (heads.byShift.unknown.length) {
    const u = heads.byShift.unknown;
    part.push(`ยังไม่รู้กะ: ${u.map(r => `${r.name}${r.team ? ` (ทีม ${r.team})` : ''}`).join(', ')}`);
  }
  return part.join(' · ');
}
