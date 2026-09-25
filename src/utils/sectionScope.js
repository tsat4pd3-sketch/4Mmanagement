import { getLineFamilyNames } from './lineHierarchy.js';
// ─── Multi-section scoping ──────────────────────────────────────────────────
// ขอบเขตส่วนงานของ user: profiles.sections (text[]) = จำกัดหลายส่วนงานได้
// (เช่น manager แผนกหนึ่งเห็นเฉพาะ PD1+PD2+QA) — ว่าง/NULL = ไม่จำกัด
//
// ลำดับการตีความ (effectiveSections):
//   1. admin → ไม่จำกัดเสมอ
//   2. role คุณภาพทั้งโรงงาน (qa) → ไม่จำกัดเสมอ — QA เป็นผู้อนุมัติ 4M step QA / งานคุณภาพ
//      ข้ามสายผลิตทั้งโรงงาน และ section ของ QA เอง ("QA") ไม่ใช่สายผลิต ถ้า scope ตาม
//      section จะกรองข้อมูลผลิตออกหมด (เห็น 4M/รายงาน = 0) — bug ที่เคยเจอ 2026-07-16
//   3. profiles.sections มีค่า → ใช้ array นั้น (ทุก role ที่เหลือ)
//   4. supervisor ที่มี profiles.section เดี่ยว → [section] (พฤติกรรมเดิม ห้ามเปลี่ยน)
//   5. role อื่นที่มีแค่ section เดี่ยว → ไม่จำกัด (เหมือนเดิม — กัน manager เก่าที่เคยกรอก
//      section ไว้เฉยๆ ไม่ให้โดนจำกัดขึ้นมากะทันหันหลัง deploy)
//
// เทียบค่าแบบ normalize (trim + lowercase) เหมือน normSection ที่ใช้กันใน DailyReport/Report
// เพราะ section เป็น text ที่พิมพ์มือได้ เคส/ช่องว่างเพี้ยนกันได้

const norm = (s) => (s || '').toString().trim().toLowerCase();

/** role คุณภาพทั้งโรงงานที่ไม่ผูกกับสายผลิตใด — ไม่ถูกจำกัดตาม section */
const FACTORY_WIDE_ROLES = ['qa'];

/**
 * คืน array ส่วนงานที่ user ถูกจำกัด — **`[]` = ไม่จำกัด เห็นทุกส่วนงาน**
 *
 * ── 🔭 ตั้งแต่ 25/09 `profiles.scope_depth` เป็นตัวตัดสิน ไม่ใช่การเดาจาก role/ช่องว่าง ──
 * (docs/ORG-AXES-DECISION.md §5.2 · docs/ACCESS-CONTROL-STANDARDS.md §2 — role-centric RBAC-A)
 *
 * พิสูจน์ก่อนสลับแล้วว่า**ผลลัพธ์เท่าของเดิมเป๊ะทั้ง 97 บัญชี** (backfill ถูกเขียนให้ล้อ
 * เงื่อนไขชุดเก่าทีละข้อ) — การสลับนี้จึงเปลี่ยน *กลไก* ไม่ใช่ *พฤติกรรม*
 *
 * 🔴 **`role === 'admin'` ยัง hardcode ไว้เป็นตาข่ายกันตาย** — หลักเดียวกับ `hasPermission()`:
 *    admin ต้องไม่มีทางล็อกตัวเองออกจากระบบด้วยการตั้งค่าผิด
 * 🔴 **role อื่น (qa/mtn/engineer) ไม่ hardcode อีกต่อไป** — แถวพวกนั้นถูก backfill เป็น `all`
 *    ไว้แล้ว ⇒ พฤติกรรมเท่าเดิม แต่ตอนนี้ admin **แคบลงได้จริงจากจอ** (เดิมตั้งแล้วไม่มีผล = no-op เงียบ)
 *
 * ⚠️ `scopeDepth` เป็น `undefined` (ยังโหลดไม่เสร็จ / แถวเก่าก่อน migration) → **ถอยไปใช้ตรรกะเดิม**
 *    ห้ามตีความว่า "แคบสุด" เพราะจะทำให้จอว่างทั้งระบบระหว่างโหลด
 *
 * ⚠️ **ขอบเขตแคบแต่ไม่มี anchor (ไม่ได้ตั้ง sections เลย) ยังคืน `[]` = ไม่จำกัด**
 *    เพราะ "จำกัดให้อยู่ในหน่วยของตัวเอง" ทำไม่ได้ถ้าไม่เคยบอกว่าหน่วยไหน
 *    — **ไม่ปิดเงียบ** แต่ให้จอทะเบียนผู้ใช้ฟ้องผ่าน `scopeIneffective()` ให้คนไปตั้ง
 */
export function effectiveSections(role, sections, section, scopeDepth) {
  if (!role || role === 'admin') return [];            // ตาข่ายกันตาย — ห้ามแตะ
  const arr = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (scopeDepth === undefined || scopeDepth === null) {
    // ── ตรรกะเดิมก่อนมี scope_depth (ใช้ตอนยังโหลดไม่เสร็จเท่านั้น) ──
    if (FACTORY_WIDE_ROLES.includes(role)) return [];
    if (arr.length) return arr;
    if (role === 'supervisor' && section) return [section];
    return [];
  }
  if (scopeDepth === 'all') return [];                 // ตั้งไว้ชัดเจนว่าเห็นทั้งโรงงาน
  if (arr.length) return arr;
  if (section) return [section];
  return [];                                           // ไม่มี anchor → ยังจำกัดไม่ได้ (ดู scopeIneffective)
}

/**
 * 🚩 "ตั้งขอบเขตแคบไว้ แต่ไม่มีผลจริง" — แคบกว่า `all` แต่ไม่มีหน่วยให้ยึด
 * ⇒ บัญชีนี้ยังเห็นทั้งโรงงานอยู่ ทั้งที่จอแสดงว่าถูกจำกัด
 * **ต้องเอาไปโชว์ในคิวทบทวนสิทธิ์ ห้ามปล่อยเงียบ** (ISO 27001 A.5.18)
 */
export function scopeIneffective(p) {
  if (!p || p.role === 'admin') return false;
  const d = p.scope_depth;
  if (!d || d === 'all') return false;
  const hasSections = Array.isArray(p.sections) && p.sections.filter(Boolean).length > 0;
  return !hasSections && !String(p.section || '').trim();
}

/** เช็คว่าค่า section หนึ่งอยู่ในขอบเขตไหม — scope ว่าง = ผ่านเสมอ */
/**
 * หน่วยงานช่าง — ดูแลเครื่องจักรทั้งโรงงาน จึงต้องเห็นสัญญาณ Andon/Downtime ทุกไลน์
 * (คำสั่ง user 2026-08-19: "หน่วยงานช่างทั้งหมดต้องเห็นของทั้งโรงงาน
 *  แต่หน่วยงานผลิต ควรเห็นแค่ของส่วนงานตัวเอง")
 */
export const MAINTENANCE_ROLES = ['mtn', 'engineer'];

/**
 * ไลน์ที่ผู้ใช้คนนี้ควรเห็น — pattern มาตรฐานที่กระจายอยู่ ~6 หน้า รวมไว้ที่เดียว
 * คืน `null` = ไม่จำกัด (เห็นทั้งโรงงาน) · คืน array = เห็นเฉพาะไลน์ในลิสต์
 *
 * ลำดับ: admin/หน่วยงานช่าง → ทั้งโรงงาน · leader → ครอบครัวไลน์ตัวเอง
 *        · มี sections → ไลน์ในส่วนงานนั้น · ไม่มีอะไรเลย → ทั้งโรงงาน
 *
 * ⚠️ leader ต้องเป็น "ทั้งครอบครัวไลน์" ห้ามเทียบ line_id ตรงตัว (กฎเหล็ก CLAUDE.md)
 * ⚠️ ต้องเรียกหลัง production_lines โหลดเสร็จ — lines ว่าง = คืน null (ไม่จำกัด)
 *    ห้ามคืน [] เพราะ `.in('line_name', [])` = ไม่เห็นอะไรเลย
 */
export function scopedLineNames({ role, lineId, sections = [], lines = [] }) {
  if (role === 'admin') return null;                       // ตาข่ายกันตาย (เหมือน effectiveSections)
  /* 🔭 25/09: **ถอด hardcode `MAINTENANCE_ROLES` ออกแล้ว** — ไม่ต้องรับ scopeDepth เพิ่ม เพราะ
     การตัดสินถูกยุบไว้ใน `sections` ที่ `effectiveSections()` คำนวณมาให้แล้ว (จุดเดียวของระบบ)
       · ช่าง/วิศวกรที่ `scope_depth='all'` ⇒ effectiveSections คืน [] ⇒ ตกมาที่ `return null` = ทั้งโรงงาน
       · ถ้าวันหน้า admin ตั้งขอบเขตให้ช่างแคบลง ⇒ sections มีค่า ⇒ **มีผลจริง**
     เดิมบรรทัดนี้คืน null ก่อนดู sections ⇒ ตั้งขอบเขตให้ช่างจากจอแล้ว **ไม่มีผลเงียบๆ** (no-op)
     ✅ พิสูจน์ก่อนถอด (25/09): ช่าง/วิศวกรทั้ง 16 บัญชี **ไม่มี `sections` เลยสักใบ**
        ⇒ ผลลัพธ์วันนี้เท่าเดิมเป๊ะ · คำสั่ง user 2026-08-19 ("หน่วยงานช่างเห็นทั้งโรงงาน")
        ยังเป็นจริง แต่มาจาก **ข้อมูลในฐาน** แทนการ hardcode ⇒ แก้ได้จากจอโดยไม่ต้องแก้โค้ด */
  if (!lines.length) return null;
  if (role === 'leader' && lineId) {
    const me = lines.find(l => String(l.id) === String(lineId));
    if (!me) return null;
    const fam = getLineFamilyNames(lines, me.name);
    return fam.length ? fam : null;
  }
  if (sections.length) {
    const names = lines.filter(l => inSectionScope(sections, l.section)).map(l => l.name);
    return names.length ? names : null;
  }
  return null;
}

export function inSectionScope(scopeSections, value) {
  if (!scopeSections || !scopeSections.length) return true;
  const v = norm(value);
  return scopeSections.some(s => norm(s) === v);
}

// ─── แผนกที่ขึ้นตรงฝ่าย (ไม่มี Section) ─────────────────────────────────────
// ผังองค์กรรองรับ `org_nodes.kind='department'` ที่ `parent_id IS NULL` = แผนกขึ้นตรงฝ่าย
// (MTN / JIG MTN / DIE MTN / QA — หน่วยงานสนับสนุนที่ไม่ได้สังกัดส่วนงานผลิตใด)
// แต่ dropdown แผนกในฟอร์มพนักงานเป็น cascade `d.parent_id === sectionNode.id` ตรงๆ
// → แผนกกลุ่มนี้ไม่มีวันโผล่ = ลงทะเบียนช่างไม่ได้เลย (เจอจริง 2026-08-06)
//
// แก้ด้วย sentinel ในช่อง Section: เลือก "ขึ้นตรงฝ่าย" → ปลดล็อกช่องแผนกให้เห็นแผนก parent_id = null
// แล้วบันทึกลง `employees.section` เป็น **null** (ตรงกับผังจริง — ห้ามยัดชื่อแผนกลง section
// เพื่อให้ cascade ผ่าน จะกลายเป็น section ปลอมที่ไม่มีในผัง)
//
// ผลข้างเคียงที่ตั้งใจ: พนักงานกลุ่มนี้ section ว่าง → ไม่เข้า scope ของหัวหน้าที่จำกัดราย section
// (ถูกต้องแล้ว — ช่างไม่ได้สังกัดส่วนงานผลิต) · การจับทีมช่าง/labor type ยังทำงานปกติเพราะ
// `teamForSection()` (mtnTeams.js) และ `laborTypeOf()` (laborType.js) เช็ค department ก่อน section

/** ค่า sentinel ในช่อง Section สำหรับ "แผนกขึ้นตรงฝ่าย" — ไม่ใช่ค่าที่เก็บลง DB */
export const ORPHAN_SECTION = '__org_direct__';
export const ORPHAN_SECTION_LABEL = '🏛️ ขึ้นตรงฝ่าย (ไม่มี Section)';

/** แปลงค่าจาก dropdown Section → ค่าที่เก็บลง employees.section (sentinel/ว่าง = null) */
export const sectionValueForSave = (v) => (!v || v === ORPHAN_SECTION ? null : v);

/** แผนกในผังที่ขึ้นตรงฝ่าย (parent_id ว่าง) */
export const orphanDepts = (deptNodes = []) => deptNodes.filter(d => !d.parent_id);

/**
 * ตัวเลือกแผนกตามค่าที่เลือกในช่อง Section (cascade — UI-CONVENTIONS §5.3)
 * sentinel = แผนกขึ้นตรงฝ่าย · ชื่อ section = แผนกใต้ section นั้น · ว่าง = ไม่มีตัวเลือก
 */
export function deptOptionsFor(sectionValue, sectionNodes = [], deptNodes = []) {
  if (sectionValue === ORPHAN_SECTION) return orphanDepts(deptNodes);
  const node = sectionNodes.find(s => (s.code || s.name) === sectionValue);
  return node ? deptNodes.filter(d => d.parent_id === node.id) : [];
}

/** node ของแผนกที่เลือก (ใช้ cascade ต่อไปยัง Group) — จำกัดอยู่ในตัวเลือกที่ถูกต้องเสมอ */
export function deptNodeFor(sectionValue, department, sectionNodes = [], deptNodes = []) {
  return deptOptionsFor(sectionValue, sectionNodes, deptNodes)
    .find(d => (d.code || d.name) === department) || null;
}

/**
 * 🧭 **แกนสังกัด — โหนดในผังที่ควรเก็บลง `org_node_id`** (2026-09-23 · docs/ORG-AXES-DECISION.md §5.1)
 *
 * ทุกจุดที่บันทึก "คนนี้สังกัดไหน" ต้องเรียกตัวนี้ **ห้ามประกอบ id เองในหน้า**
 * ละเอียดก่อนหยาบ: แผนกที่เลือก → ส่วนงานที่เลือก → null
 *
 * ทำไมต้องเก็บ id ทั้งที่มีคอลัมน์ข้อความอยู่แล้ว: ชื่อแผนกซ้ำกันได้จริง (`ทั่วไป` ใต้ PD2 และ PD4)
 * ⇒ ข้อความตัวเดียวชี้ได้ 2 หน่วย · และย้ายคน 1 คนต้องแก้ข้อความให้ตรงกันหลายคอลัมน์
 * คอลัมน์ข้อความยังเขียนเหมือนเดิมทุกตัว (เป็น "สำเนาไว้โชว์") — หน้าเก่าจึงไม่กระทบ
 *
 * @returns {string|null} org_nodes.id
 */
export function orgNodeIdFor(sectionValue, department, sectionNodes = [], deptNodes = []) {
  const dept = deptNodeFor(sectionValue, department, sectionNodes, deptNodes);
  if (dept?.id) return dept.id;
  if (!sectionValue || sectionValue === ORPHAN_SECTION) return null;
  return sectionNodes.find(s => (s.code || s.name) === sectionValue)?.id || null;
}

/** ที่มาของ org_node_id — 'manual' = คนเลือกเองจากฟอร์ม (เชื่อได้) ดูคอมเมนต์คอลัมน์ใน DB */
export const ORG_SRC_MANUAL = 'manual';

/**
 * ค่าที่ควรโชว์ในช่อง Section ของพนักงานที่มีอยู่แล้ว
 *  1. section ตรงกับส่วนงานในผัง → ใช้ค่านั้น
 *  2. แผนกของพนักงานเป็นแผนกขึ้นตรงฝ่าย → sentinel — ครอบ 2 เคส:
 *     (ก) section ว่าง (ลงทะเบียนใหม่หลังแก้นี้)  (ข) ข้อมูลเก่าที่กรอกชื่อแผนกซ้ำลง section
 *     ด้วย (เช่นช่างที่ย้ายเข้าฐานพนักงาน 2026-07-22 มี section='MTN' ทั้งที่ MTN เป็นแผนก
 *     ไม่ใช่ส่วนงาน) — ไม่งั้นช่องแผนกถูกล็อกจนแก้อะไรไม่ได้
 *     ⚠️ ฝั่งเซฟต้องส่งค่าผ่านฟังก์ชันนี้ก่อน `sectionValueForSave` ด้วย เพื่อให้ค่าที่เก็บตรงกับที่
 *     ช่อง Section โชว์อยู่เสมอ (ไม่งั้นโชว์ "ขึ้นตรงฝ่าย" แต่เซฟ 'MTN' กลับไปเหมือนเดิมเงียบๆ)
 *  3. ที่เหลือ (section นอกผังทั่วไป) → คืนค่าเดิม ไม่แตะ
 */
export function sectionValueForEdit(section, department, deptNodes = [], sectionNodes = []) {
  if (section && sectionNodes.some(s => (s.code || s.name) === section)) return section;
  if (department && orphanDepts(deptNodes).some(d => (d.code || d.name) === department)) return ORPHAN_SECTION;
  return section || '';
}
