import { lineAncestorIds } from './lineHierarchy.js';
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
 * ⇒ **แหล่งความจริงคือทะเบียนพนักงาน** (`employees.position` + `team` + `line_id`) ซึ่งจอเช็คชื่อ/
 *    จัดกะ/บอร์ดกำลังคน อ่านอยู่แล้ว · `head_name` เหลือสถานะ "ชื่อที่พิมพ์ทับ" เท่านั้น
 *
 * กติกาที่ไฟล์นี้เป็นเจ้าของ (ห้ามเขียนชุดที่ 2 ในหน้า):
 *  1. **ไลน์ตัวเองชนะไลน์แม่เสมอ** — ไม่มีหัวหน้าของตัวเอง จึงค่อยไล่ขึ้นไปหาไลน์แม่ที่ใกล้ที่สุด
 *     (กฎตกทอดชุดเดียวกับ `cost_center`/`head_name` ที่ `LineSetup`/`Report` ใช้อยู่)
 *     🔴 **ไม่ดึงจากไลน์ลูก** — หัวหน้าของไลน์ย่อยไม่ใช่หัวหน้าของไลน์แม่
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
export function lineHeadsOf({ lineId, lines = [], employees = [], maps = null, legacyName = '' } = {}) {
  const empty = {
    rows: [], byShift: { day: [], night: [], unknown: [] },
    level: null, fromLineName: null,
    legacyName: txt(legacyName), legacyInRegistry: null,
  };
  if (lineId == null) return empty;

  // ① ไลน์ตัวเอง → ไลน์แม่ที่ใกล้ที่สุด (เรียงจากใกล้ไปไกล) — ตัวแรกที่มีคนชนะทั้งชุด
  const chain = [lineId, ...lineAncestorIds(lines, lineId)];
  const nameOfLine = (id) => lines.find(l => String(l.id) === String(id))?.name || null;

  let picked = [], level = null, fromId = null;
  outer:
  for (const lv of HEAD_LEVELS) {
    for (const id of chain) {
      const hit = employees.filter(e => String(e.line_id) === String(id) && levelOfPosition(e.position) === lv);
      if (hit.length) { picked = hit; level = lv; fromId = id; break outer; }
    }
  }

  const rows = picked.map(e => ({
    id: e.id,
    name: txt(e.name),
    position: e.position,
    team: txt(e.team).toUpperCase() || null,
    // ② กะจากตารางกะจริง — ไม่รู้ = null (ห้ามเดาจากตัวอักษรทีม)
    shift: maps ? shiftFromTeam(scheduleTeamFor(e, maps), txt(e.team).toUpperCase()) || null : null,
    lineName: nameOfLine(e.line_id),
  })).sort((a, b) =>
    (SHIFT_ORDER[a.shift ?? 'x'] - SHIFT_ORDER[b.shift ?? 'x'])
    || naturalCompare(a.team || 'zz', b.team || 'zz')
    || naturalCompare(a.name, b.name));

  const byShift = { day: [], night: [], unknown: [] };
  for (const r of rows) byShift[r.shift === 'day' || r.shift === 'night' ? r.shift : 'unknown'].push(r);

  const lg = txt(legacyName);
  return {
    rows, byShift, level,
    // null = หัวหน้าเป็นของไลน์ตัวเอง · มีค่า = ตกทอดมาจากไลน์แม่ชื่อนี้ (จอต้องเขียนบอก)
    fromLineName: fromId != null && String(fromId) !== String(lineId) ? nameOfLine(fromId) : null,
    legacyName: lg,
    /* 🔴 `null` = **ยังตัดสินไม่ได้** (ไม่มีชื่อพิมพ์ทับ หรือยังไม่ได้โหลดทะเบียนพนักงาน)
       ห้ามตีเป็น false แล้วขึ้นเตือน "ชื่อนี้ไม่มีในทะเบียน" ทั้งที่แค่ยังโหลดไม่เสร็จ */
    legacyInRegistry: !lg || !employees.length ? null
      : employees.some(e => sameName(e.name, lg)),
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
