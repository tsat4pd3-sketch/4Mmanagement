import { getLineFamilyNames } from './lineHierarchy.js';
import { buildViewScope } from './viewScope.js';   // 👁️ ขยายขอบเขตผ่านผัง (แผนก/ไลน์ ไม่ใช่แค่ส่วนงาน)
import { orgNodeCompare } from './listOrder.js';
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

/**
 * 🔴 **"หัวหน้าหน้างานที่ตั้งไว้ให้เห็นทั้งโรงงาน"** — ขอบเขตกว้างเกินหน้าที่ (24/10)
 *
 * เคสจริง: หัวหน้ากลุ่ม LWR BAR และ HYDROFORM ถูกตั้ง `scope_depth='all'`
 * ⇒ `effectiveSections()` คืน `[]` = ไม่จำกัด ⇒ ทุกจอที่กรองด้วย `sections` โชว์ทั้งโรงงาน
 * (user แจ้งจากหน้างาน: *"หัวหน้ากลุ่มแจ้งว่าเค้าเห็นทุกไลน์ผลิตเลย"*)
 *
 * `scopedLines()` บีบ leader กลับเป็นครอบครัวไลน์ให้แล้วเป็นตาข่าย — แต่ **การตั้งค่ายังผิดอยู่**
 * ⇒ ต้องเอาขึ้นคิวทบทวนสิทธิ์ให้คนไปแก้ ห้ามปล่อยเงียบ (ISO 27001 A.5.18 · หลักเดียวกับ `scopeIneffective`)
 *
 * 🔴 role ที่ "เห็นทั้งโรงงานเป็นเรื่องปกติ" (qa/mtn/engineer/manager/display ฯลฯ) **ไม่เข้าข่าย**
 *    — จำกัดเฉพาะ role ที่ผูกกับหน่วยหน้างานโดยธรรมชาติ
 */
export const FLOOR_SCOPED_ROLES = ['leader', 'supervisor'];
export function scopeTooWide(p) {
  if (!p || p.role === 'admin') return false;
  if (!FLOOR_SCOPED_ROLES.includes(p.role)) return false;
  return p.scope_depth === 'all';
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
export function scopedLineNames(args) {
  /* ✅ 29/10 — **user เคาะแล้วว่าให้ยุบเป็นท่าเดียว**: *"ให้เห็นส่วนงานตัวเองทุกจอ"*
     เดิมตัวนี้ใช้ท่า 'own' (ครอบครัวไลน์ล้วน) ต่างจาก scopedLines() ที่ใช้ 'view'
     ⇒ บัญชีเดียวกันได้คำตอบคนละชุดใน 2 กลุ่มจอ = ต้นเหตุของ
       *"เห็นของทุกไลน์ แต่เปิดกะเลือกไลน์ตัวเองไม่ได้"* ที่แก้ไม่จบมาหลายรอบ
     เหตุผลที่เคยเขียนไว้ ("ตัวนี้คือไลน์ที่ **รับผิดชอบ**") **ไม่ตรงกับผู้เรียกจริง** —
     22 จอที่เรียกส่วนใหญ่เป็นจอดู/รายงาน (TvBoard · Obeya · DeptDashboard · ScrapReport …)
     🔴 ขอบเขตยังเป็นค่าที่ admin ตั้งไว้ที่ /add-user เสมอ — ไม่มีใครเห็นข้ามส่วนงานเพิ่ม */
  const r = lineScope(args);
  return r.unlimited ? null : (r.names.length ? r.names : null);
}

/**
 * 🔭🔭 **แกนเดียวของคำถาม "บัญชีนี้เห็นไลน์ไหน"** (29/10 · คำสั่ง user "ทำข้อ1 ให้จบในรอบนี้")
 *
 * เดิมคำถามนี้มี **2 ตัวตอบที่ไม่ตรงกัน** ⇒ บั๊กเรื้อรังที่ user เจอซ้ำทุกสัปดาห์:
 *   `scopedLines()`     (ช่องเลือกไลน์ · ~20 จอ) → หัวหน้า 306 เห็น  306 + ไลน์แม่ + 250T
 *   `scopedLineNames()` (กรองข้อมูล   · ~22 จอ) → หัวหน้า 306 เห็น  306 **ไลน์เดียว**
 * ⇒ อาการที่หน้างานแจ้ง *"เห็นของทุกไลน์ แต่เปิดกะเลือกไลน์ตัวเองไม่ได้"* คือ
 *   จอ 2 ชุดนี้ตอบคนละอย่างบนบัญชีเดียวกัน — ไม่ใช่บั๊กของจอใดจอหนึ่ง
 * ⇒ **ตั้งแต่นี้ทั้งคู่เป็น wrapper บางๆ ของตัวนี้** · มีด่าน `line-scope-two-answers`
 *
 * ✅ **29/10 ยุบเหลือท่าเดียวแล้ว (คำสั่ง user: "ให้เห็นส่วนงานตัวเองทุกจอ")**
 *   `scopedLines()` และ `scopedLineNames()` ใช้กฎชุดเดียวกันเป๊ะ — ต่างกันแค่ "คืนตัวไลน์ หรือ คืนชื่อ"
 *   กฎ = ครอบครัวไลน์ตัวเอง **∪ ไลน์ในส่วนงานที่ admin กำกับไว้** (กฎ 26/10 · ใช้ทุกจอแล้ว)
 *   🔴 `scope: 'own'` (ครอบครัวไลน์ล้วน) **ยังเหลือไว้ให้เรียกได้** เผื่อจอ "ลงบันทึกแทนคนอื่น"
 *      ในอนาคต — **แต่วันนี้ไม่มีจอไหนใช้ และห้ามเอาไปใช้โดยไม่ถาม user**
 *
 * คืน `{ unlimited, unsure, reason, lines, names }`
 *  · `unlimited` = เห็นทั้งโรงงาน (admin / ขอบเขตไม่ถูกจำกัด / ทะเบียนยังไม่โหลด)
 *  · 🔴 `unsure` = **ตัดขอบเขตให้ไม่ได้จริง** (ทะเบียนยังไม่โหลด · หาไลน์ตัวเองไม่เจอ)
 *       ⇒ จอ **ต้องเขียนบนจอ** ห้ามเงียบ — "ไม่มีรายการ" ทั้งที่ตัดขอบเขตไม่ได้ = จอโกหก
 *  · `lines` = ตัวไลน์ (fail-closed: ตัดไม่ได้ + ไม่มีส่วนงานกำกับ = `[]`)
 *  · `names` = ชื่อไลน์ชุดเดียวกัน (ชุดเดียวกันเสมอ — ห้ามให้ 2 ช่องนี้ไม่ตรงกันอีก)
 */
export function lineScope({ role, lineId, sections = [], lines = [], scopeIdx = null } = {},
  { scope = 'view' } = {}) {
  const all = lines || [];
  const out = (sel, { unlimited = false, unsure = false, reason = null } = {}) => ({
    unlimited, unsure, reason,
    lines: unlimited ? all : sel,
    names: (unlimited ? all : sel).map(l => l.name),
  });

  if (role === 'admin') return out(all, { unlimited: true, reason: 'admin' });
  // ทะเบียนไลน์ยังไม่โหลด = ยังตัดขอบเขตไม่ได้ ⇒ ไม่จำกัด **แต่ต้องบอกว่าไม่ชัด**
  if (!all.length) return out([], { unlimited: true, unsure: true, reason: 'registry_unloaded' });

  const secs = (sections || []).filter(Boolean);

  if (role === 'leader' && lineId) {
    /* 🔴🔴 แกน "ไลน์" มาก่อนแกน "ส่วนงาน" เสมอ — ตาข่ายกันการตั้ง scope_depth='all' ผิด (24/10)
       🔴🔴 แต่ล็อก "ไลน์ตัวเองไลน์เดียว" ไม่ได้ (26/10 · ทั้งโรงงานเปิดกะไม่ได้เช้าวันจันทร์)
          ⇒ เห็น **ไลน์ตัวเอง ∪ ไลน์ในส่วนงานที่ถูกกำกับไว้** */
    const me = all.find(l => String(l.id) === String(lineId));
    const fam = me ? new Set(getLineFamilyNames(all, me.name)) : null;
    const own = fam?.size ? all.filter(l => fam.has(l.name)) : [];
    if (!own.length) {
      /* หาไลน์ตัวเองไม่เจอทั้งที่ทะเบียนโหลดแล้ว (line_id ชี้ไลน์ที่ถูกลบ/เปลี่ยนชื่อ)
         ⚠️ มีส่วนงานกำกับ ⇒ ยังตัดด้วยส่วนงานได้ · ไม่มีเลย ⇒ fail-closed `[]`
         🔴 ทั้ง 2 ทางคือ `unsure` — จอต้องเขียนว่าขอบเขตไม่ชัด ห้ามโชว์ "ไม่มีรายการ" เฉยๆ */
      if (!secs.length) return out([], { unsure: true, reason: 'own_line_unknown' });
      return out(scopedBySections(secs, all, scopeIdx), { unsure: true, reason: 'own_line_unknown' });
    }
    if (!secs.length || scope === 'own') return out(own, { reason: 'own_family' });
    const bySec = scopedBySections(secs, all, scopeIdx);
    const seen = new Set(own.map(l => l.name));
    return out(own.concat(bySec.filter(l => !seen.has(l.name))), { reason: 'own_family+sections' });
  }

  if (!secs.length) return out(all, { unlimited: true, reason: 'no_limit' });
  const sel = scopedBySections(secs, all, scopeIdx);
  /* ส่วนงานที่ผังไม่รู้จักเลย ⇒ กรองแล้วเหลือ 0 = ตัดขอบเขตไม่ได้ ไม่ใช่ "ไม่มีไลน์"
     ⇒ ไม่จำกัด + unsure (พฤติกรรมเดิมของ scopedLineNames ที่คืน null — คงไว้ แต่เลิกเงียบ) */
  if (!sel.length) return out([], { unlimited: true, unsure: true, reason: 'sections_unmatched' });
  return out(sel, { reason: 'sections' });
}

/**
 * 🔭 **ไลน์ที่ผู้ใช้เห็นได้ — คืน "ตัวไลน์" ไม่ใช่ชื่อ** (22/10)
 *
 * pattern เดิมที่ก๊อปกระจายอยู่ ~10 หน้า: `lines.filter(l => inSectionScope(scopeSecs, l.section))`
 * ⇒ ขอบเขตที่ไม่ใช่ "ส่วนงาน" (แผนก/กลุ่ม/ไลน์เดี่ยว) ตกหมด เพราะเทียบข้อความ `l.section` ตรงตัว
 *
 * 🔴 ส่ง `scopeIdx` (ดัชนีผังจาก `UserContext`) มาด้วย = ขยายผ่านผังองค์กร
 *    **ไม่ส่ง = พฤติกรรมเดิมเป๊ะ** — ห้ามบีบแคบลงเงียบ (ชื่อที่ผังไม่รู้จักยังถอยไปเทียบข้อความ)
 * ⚠️ `sections` ว่าง (ไม่จำกัด) หรือทะเบียนไลน์ยังโหลดไม่เสร็จ → คืน `lines` ทั้งก้อน
 *    ห้ามคืน `[]` เพราะจะกลายเป็น "ไม่เห็นอะไรเลย" ระหว่างโหลด
 * 🔴 ผู้เรียกที่เอาไปกรอง**ตาราง** ต้องเขียนบนจอว่าซ่อนไปกี่รายการ (ดู `filterRowsByLineScope`)
 */
export function scopedLines(args) {
  const { lines = [] } = args || {};
  if (!lines?.length) return lines || [];
  const r = lineScope(args);
  /* 🔴 `sections_unmatched` คืน unlimited เพื่อคงพฤติกรรมเดิมของ scopedLineNames
     แต่ฝั่ง "ตัวไลน์" เดิมคืนลิสต์ที่กรองแล้ว (= ว่าง) ⇒ คง fail-closed ของเดิมไว้ที่นี่
     ⚠️ ความต่างนี้เหลืออยู่ **จุดเดียว** และถูกตั้งธง unsure ไว้แล้ว (ดู §ช่องว่างที่เหลือ) */
  if (r.reason === 'sections_unmatched') return [];
  return r.lines;
}

/** กรองไลน์ด้วย "ส่วนงาน" ล้วน — ผังองค์กรก่อน ถ้าผังไม่ครอบค่อยถอยไปเทียบชื่อ section */
function scopedBySections(secs, lines, scopeIdx) {
  if (scopeIdx) {
    const vs = buildViewScope(secs, scopeIdx);
    if (vs.byOrg) return lines.filter(l => vs.lineOk(l));
  }
  return lines.filter(l => inSectionScope(secs, l.section));
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
// ลำดับ = ตามผัง (sort_order → ชื่อ · listOrder.js) ไม่ขึ้นกับว่าหน้าที่เรียก query มาเรียงแบบไหน (2026-10-01)
export const orphanDepts = (deptNodes = []) => deptNodes.filter(d => !d.parent_id).sort(orgNodeCompare);

/**
 * ตัวเลือกแผนกตามค่าที่เลือกในช่อง Section (cascade — UI-CONVENTIONS §5.3)
 * sentinel = แผนกขึ้นตรงฝ่าย · ชื่อ section = แผนกใต้ section นั้น · ว่าง = ไม่มีตัวเลือก
 */
export function deptOptionsFor(sectionValue, sectionNodes = [], deptNodes = []) {
  if (sectionValue === ORPHAN_SECTION) return orphanDepts(deptNodes);
  const node = sectionNodes.find(s => (s.code || s.name) === sectionValue);
  return node ? deptNodes.filter(d => d.parent_id === node.id).sort(orgNodeCompare) : [];
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

/**
 * 🔭 กรองแถวข้อมูลตาม "ขอบเขตไลน์" แบบซื่อสัตย์ — คืนทั้งของที่เหลือ **และของที่ซ่อน**
 * (2026-10-09 · QC audit รอบ 4 — เดิม `/line-stock` กรองแค่ dropdown แต่ตาราง/ชิปโชว์ทุกไลน์
 *  ทั้งที่ป้ายเขียนว่า "ในสิทธิ์ที่เห็น" = จอโกหก)
 *
 * @param rows                แถวข้อมูล
 * @param opts.scopedNames    ชื่อไลน์ที่เห็นได้ (ผลของ `scopedLineNames`) · **`null` = ไม่จำกัด**
 * @param opts.lineNames      ชื่อไลน์ทั้งทะเบียน — ใช้ตอบว่า "ค่านี้เป็นไลน์หรือเปล่า"
 * @param opts.nameOf         ดึงชื่อไลน์ออกจากแถว (default `r.line_name`)
 * @returns {{rows: any[], hidden: number, offRegistry: string[]}}
 *
 * 🔴 **ค่าที่ไม่อยู่ในทะเบียนไลน์ = "ตัดสินไม่ได้" ⇒ ไม่ซ่อน** แต่ผู้เรียก**ต้องเขียนบนจอ**
 *    ว่าโชว์อยู่เพราะตัดสินไม่ได้ (หลักเดียวกับล็อกฝั่งใบ MO: *ไม่รู้ = ไม่บล็อก แต่จอต้องบอก*)
 *    — วัดจริง 09/10: `line_stock_summary` มี `STORE` 119 แถว + `FG WAREHOUSE` 73 แถว
 *      = **44% ของทั้งจอ** และทั้งคู่**ไม่มีใน `production_lines`** ⇒ กรองตรงๆ = ยอดคลังหายหมด
 * 🔴 **`hidden` ต้องถูกเขียนบนจอเสมอ** — ซ่อนเงียบ = จอโกหกอีกแบบ (คนนับยอดไม่ตรงกันข้ามแผนก)
 * ⚠️ ทะเบียนไลน์ยังโหลดไม่เสร็จ (`lineNames` ว่าง) = ทุกค่าตัดสินไม่ได้ ⇒ ไม่ซ่อนอะไรเลย (fail-open
 *    โดยตั้งใจ — ห้ามซ่อนข้อมูลเพราะ "ยังไม่รู้" · `scopedLineNames` ก็คืน null ในสถานะนี้อยู่แล้ว)
 */
export function filterRowsByLineScope(rows = [], { scopedNames = null, lineNames = [], nameOf } = {}) {
  const get = nameOf || ((r) => r?.line_name);
  if (!scopedNames || !scopedNames.length) return { rows, hidden: 0, offRegistry: [] };
  const allow = new Set(scopedNames.map(norm));
  const known = new Set((lineNames || []).map(norm));
  const off = new Map();                               // norm → ชื่อที่เขียนจริง (ไว้โชว์)
  const kept = rows.filter((r) => {
    const raw = get(r);
    const n = norm(raw);
    if (allow.has(n)) return true;
    if (!known.has(n)) { off.set(n, raw || '(ไม่ระบุไลน์)'); return true; }
    return false;
  });
  return { rows: kept, hidden: rows.length - kept.length, offRegistry: [...off.values()] };
}

/**
 * 🚩 **"หัวหน้ากลุ่มที่ไม่มีสมอ"** — role ที่ขอบเขตผูกกับไลน์ (`leader`) แต่บัญชีไม่มี `line_id`
 * ⇒ ด่านไลน์ไม่ทำงาน · ต้อง**ถอยไปใช้ขอบเขตส่วนงาน** ห้ามเขียน `if (leader) {…} else if (sections)`
 *
 * เจอ 2026-10-19 ที่ `/checkin`: โครง else-if ทำให้ leader ที่ไม่มี `line_id`
 * **หลุดทั้งสองด่าน = เห็นพนักงานทั้งโรงงาน** (วันนั้นยังไม่มีบัญชีไหนอยู่สถานะนี้ —
 * แต่การตั้ง "รักษาการหลายหน่วย" ด้วย `sections` สร้างบัญชีแบบนี้ขึ้นมาทันที)
 *
 * คืน `true` = ไม่มีสมอทั้งไลน์และส่วนงาน ⇒ 🔴 **จอต้องเขียนบนจอว่ากำลังแสดงทั้งโรงงาน**
 * (กฎความซื่อสัตย์ของจอ · **ไม่บล็อก** — บล็อกเงียบ = เช็คชื่อไม่ได้ทั้งกะ)
 */
export function scopeAnchorless({ role, lineId, sections = [] }) {
  if (role !== 'leader') return false;
  return !lineId && !(Array.isArray(sections) ? sections.filter(Boolean) : []).length;
}
