/* ══ 🔐 ชั้นที่ 3 ของระบบสิทธิ์ — "แถวนี้เป็นของหน่วยงานเราไหม" (2026-10-15 · คำสั่ง user) ═══
 *
 * > *"user บาง role เข้าหน้าได้ทุกหน้า แต่ต้องไม่มีสิทธิ์ไปแก้ข้อมูลส่วนงานคนอื่น"*
 *
 * เดิมระบบมี 2 ชั้น — ①เข้าหน้าได้ไหม (`page:/x`) ②กดปุ่มเป็นไหม (`can()`) — **ไม่มีชั้นที่ ③**
 * ⇒ ช่องเลือกขอบเขต/ทีม เป็นแค่ตัวกรองการดู เปลี่ยน dropdown หรือ `?scope=`/`?dept=` ก็เขียนของคนอื่นได้
 * 📄 ผลตรวจทั้งระบบ (20 จุดรั่ว · ตัวเลขจากฐานจริง) → `docs/modules/permission-scope-audit.md`
 *
 * ══ 🔴 กฎข้อแรก: **"ขอบเขตที่เห็น" ≠ "ขอบเขตที่แก้ได้"** (คำสั่ง user 15/10) ══════════════
 *   · เห็น  = `effectiveSections()` (`sectionScope.js`) — **ว่าง = เห็นทั้งโรงงาน** · ไฟล์นี้ไม่แตะ
 *   · แก้   = **`profiles.section` = บ้านจริง** (ไฟล์นี้)
 *   ทำไมห้ามใช้ `sections` ตัดสินการแก้: วัดจริง 15/10 มี **31 จาก 122 บัญชี** ที่ `sections` ว่าง
 *   (เป็น role `mtn` 16 คน) เพราะช่างต้อง*เห็น*ทุกไลน์จริง ⇒ ถ้าเอา `sections` มาตัดสินการแก้
 *   = ช่างแก้ได้ทั้งโรงงาน (เคสที่ user แจ้ง) · ถ้าไปบีบ `sections` ให้แคบ = ช่างมองไม่เห็นงานซ่อม
 *   ⇒ **ต้องเป็นคนละแกน** — ต้นแบบที่ทำถูกอยู่แล้วคือ `operator.jsx` (`homeSection`)
 *
 * ══ 🔑 คนที่งานเป็นงานทั้งโรงงานจริง = คีย์ `scope:all_units` ═══════════════════════════
 *   QA · สโตร์/วางแผน · PE/NPI · document control — ปรับเองได้ที่ `/permissions` **ห้าม hardcode role**
 *   (role `admin` ยัง hardcode เป็นตาข่ายกันตาย — หลักเดียวกับ `hasPermission()`)
 *
 * ══ 💰 แกนที่ 2 — **Cost Center + ลำดับชั้น** (2026-10-19 · คำสั่ง user) ═══════════════════
 *   > *"เซ็ตได้ว่า user ไหน response กับ cost center ไหน **ตามลำดับชั้นด้วย**
 *   >  ถ้า response ชั้นส่วน 46 ก็ response ได้ทั้งหมดลงไป"*
 *
 *   แกนเดิม (ข้อความชื่อส่วนงาน) ตอบได้แค่ "ชื่อตรงกันไหม" ⇒ ทำ 2 อย่างนี้ไม่ได้เลย
 *     · รับผิดชอบ**ชั้นส่วนงาน** แล้วได้ทุกแผนก/ไลน์/ทีม**ใต้ลงไป**
 *     · รับผิดชอบ**แผนกเดียว** โดยไม่ได้ทั้งส่วนงาน (แผนกพี่น้องไม่เคยถูกแยกจากกันมาก่อน)
 *
 *   🔑 **สลับแกนอัตโนมัติ — จอไม่ต้องรู้เรื่อง** (นี่คือเหตุผลที่ยัดไว้ในไฟล์นี้ ไม่ใช่ไปแก้ 20 จอ):
 *     มี `ctx.respCostCenters` (ตั้งที่ `/add-user` ④) **และ** `ctx.scopeIdx` (ดัชนีผังจาก
 *     `UserContext.scopeIdx`) ⇒ ตัดสินด้วย `canWriteScope()` (`utils/ccScope.js`)
 *     ไม่มีอย่างใดอย่างหนึ่ง ⇒ **ใช้แกนข้อความเดิมเป๊ะ** (122 บัญชีวันที่ลง ยังไม่มีใครตั้ง CC = พฤติกรรมเดิม 100%)
 *   🔴 **ชื่อหน่วยที่ผังไม่รู้จัก = ถอยไปแกนเดิม ไม่ใช่บล็อก** — ทะเบียนเก่าหลายที่เก็บข้อความนอกผัง
 *      (ถ้าบล็อก = คนทั้งโรงงานแก้ของเดิมไม่ได้ทันทีที่มีใครตั้ง CC)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
import { canWriteScope } from './ccScope.js';   // .js — ให้ node:test resolve ได้ (bundler ไม่สน)

const norm = (s) => (s || '').toString().trim().toLowerCase();

/** ชื่อหน่วย (ข้อความ) → ขอบเขตในผัง · ลองจากชั้นกว้างไปแคบ · ไม่รู้จัก = `null`
 *  🔴 ส่วนงานกับ "แผนกขึ้นตรงฝ่าย" (QA · MTN · JIG MTN) ถูกเก็บในช่องเดียวกันมาตลอด
 *     ⇒ ต้องลอง `department` ด้วย ไม่ใช่เดาว่าเป็น section เสมอ */
const scopeOfUnitName = (idx, name) => {
  const v = String(name ?? '').trim();
  if (!v || typeof idx?.has !== 'function') return null;
  for (const kind of ['section', 'department', 'line_group', 'line']) {
    if (idx.has(kind, v)) return { kind, value: v };
  }
  return null;
};

/** ตัดสินด้วยแกน CC ถ้าใช้ได้ — คืน `null` = "แกนนี้ตอบไม่ได้ ให้ใช้แกนข้อความเดิม" */
function ccDecide(ctx, target, opts) {
  const idx = ctx?.scopeIdx;
  const ccs = (Array.isArray(ctx?.respCostCenters) ? ctx.respCostCenters : []).filter(Boolean);
  if (!ccs.length) return null;
  /* 🔴 ตั้ง CC ไว้แต่อ่านผังไม่สำเร็จ = **fail-closed** (กฎเหล็ก DB ข้อ 12: อ่านไม่ได้แล้วจะเขียน = ห้าม)
     ถอยไปใช้แกนข้อความไม่ได้ — บัญชีที่ `sections` เคยกว้างกว่า CC จะได้สิทธิ์คืนมาเงียบๆ */
  if (idx?.failed) return { ok: false, code: 'scope_unreadable' };
  if (!idx) return null;
  const sc = scopeOfUnitName(idx, target);
  if (!sc) return null;
  return canWriteScope(idx, ctx, sc, opts);
}

/** หน่วยงาน "บ้านจริง" ที่คนนี้แก้ข้อมูลได้ — **`[]` = ยังตัดสินไม่ได้ (ไม่ใช่ "ได้ทุกหน่วย")**
 *  🔴 ต่างจาก `effectiveSections()` ตรงนี้: ที่นั่น `[]` = ไม่จำกัด · ที่นี่ `[]` = ไม่รู้ ⇒ บล็อก */
export function writeUnitsOf({ section, sections } = {}) {
  const arr = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (arr.length) return arr;
  const one = String(section || '').trim();
  return one ? [one] : [];
}

/** ถือใบผ่านข้ามหน่วยงานไหม (คีย์ `scope:all_units` หรือ admin) */
export function hasAllUnits({ role, allUnits } = {}) {
  return role === 'admin' || allUnits === true;
}

/**
 * แก้ข้อมูลของส่วนงาน `target` ได้ไหม — **ตัวตัดสินจุดเดียวของทั้งระบบ**
 *
 * คืน `{ ok, code }` (ไม่คืน boolean ล้วน เพราะจอต้องบอกเหตุได้ — ห้ามล้มเหลวเงียบ)
 *   ok:true  code:'all_units' | 'own' | 'unknown_target'
 *   ok:false code:'other_unit' | 'no_home_unit'
 *
 * 🔴 `target` ว่าง (แถวไม่ผูกหน่วยงาน = ทะเบียนกลาง) **default = ผ่าน** เพราะไม่มีหน่วยให้เทียบ
 *    — จุดที่อยากให้ทะเบียนกลางเป็นของส่วนกลางจริงๆ ส่ง `{ unknownTarget: 'block' }` เอง
 *    (ห้ามเปลี่ยน default เป็น block: ทะเบียนร่วมอย่าง `lpa_questions` จะล็อกคนทั้งโรงงานทันที)
 */
export function canWriteUnit(ctx = {}, target, { unknownTarget = 'allow' } = {}) {
  if (hasAllUnits(ctx)) return { ok: true, code: 'all_units' };
  /* 💰 แกน Cost Center มาก่อน (ถ้าบัญชีตั้งไว้ + หน้าส่งดัชนีผังมา) — ดูหัวไฟล์ */
  const cc = ccDecide(ctx, target, { unknownTarget });
  if (cc) return cc;
  const units = writeUnitsOf(ctx);
  if (!units.length) return { ok: false, code: 'no_home_unit' };
  const t = norm(target);
  if (!t) return unknownTarget === 'block'
    ? { ok: false, code: 'other_unit' }
    : { ok: true, code: 'unknown_target' };
  return units.some(u => norm(u) === t)
    ? { ok: true, code: 'own' }
    : { ok: false, code: 'other_unit' };
}

/** ข้อความบอกคนกด — **ต้องบอกทางแก้ด้วย ห้ามขึ้นแค่ "ไม่มีสิทธิ์"** (ENGINEERING-PRINCIPLES) */
export function writeBlockText(res, { what = 'ข้อมูลนี้', unit = '' } = {}) {
  if (!res || res.ok) return '';
  if (res.code === 'no_home_unit')
    return `บัญชีนี้ยังไม่ได้ตั้งส่วนงาน จึงแก้${what}ไม่ได้ — ให้แอดมินตั้งให้ที่หน้าจัดการบัญชี`;
  /* 💰 มาจากแกน CC: อ่านผังไม่ได้ ⇒ ยังตัดสินขอบเขตไม่ได้ (บล็อกไว้ก่อน ไม่ใช่ "ไม่มีสิทธิ์") */
  if (res.code === 'scope_unreadable')
    return `ยังแก้${what}ไม่ได้ — ระบบอ่าน**ผังองค์กร**ไม่สำเร็จ จึงตัดสินไม่ได้ว่าอยู่ในขอบเขตที่คุณรับผิดชอบไหม`
      + ' · โหลดหน้าใหม่อีกครั้ง ถ้ายังไม่หายให้แจ้ง admin';
  /* 💰 มาจากแกน CC: ระบบระบุหน่วยเจ้าของของแถวไม่ได้ (ผังยังไม่ผูกรหัส) — คนละเรื่องกับ "ของหน่วยอื่น" */
  if (res.code === 'unknown_target')
    return `ระบบยังระบุไม่ได้ว่า${what}${unit ? ` (${unit})` : ''}เป็นของหน่วยงานไหน จึงยังไม่ให้แก้`
      + ' — ผังองค์กรยังไม่ผูกรหัส Cost Center ให้หน่วยนั้น (ตั้งที่ /org-setup)';
  return `${what}เป็นของ${unit ? `ส่วนงาน ${unit}` : 'ส่วนงานอื่น'} — ดูได้ แต่แก้ไม่ได้`
    + ' (ต้องให้คนในส่วนงานนั้นแก้ หรือขอสิทธิ์ข้ามหน่วยงาน)';
}

/** รุ่นที่ใช้กับ "ไลน์" — หาส่วนงานเจ้าของไลน์จากทะเบียนก่อน แล้วค่อยตัดสิน
 *  🔴 ไลน์ที่หาไม่เจอในทะเบียน = **ไม่รู้เจ้าของ** ไม่ใช่ "ของเรา" ⇒ เดินตามกฎ `unknownTarget` */
export function canWriteLine(ctx = {}, lineName, lines = [], opts = {}) {
  if (hasAllUnits(ctx)) return { ok: true, code: 'all_units' };
  /* 💰 แกน CC ตัดสินที่ "ตัวไลน์" ตรงๆ ได้ ถ้าผังรู้จักไลน์นี้ — **แม่นกว่าถอยไปใช้ส่วนงานของไลน์**
     ไลน์ในผัง 22/26 ตัวมีรหัสของตัวเอง ⇒ คนที่รับผิดชอบแค่ "แผนก" ยังแก้ไลน์ใต้แผนกตัวเองได้
     (ถ้าแปลงเป็นส่วนงานก่อน จะกลายเป็น "ขอสิทธิ์ทั้งส่วนงาน" แล้วถูกบล็อกทั้งที่เป็นไลน์ของเขา) */
  const ccLine = ccDecide(ctx, lineName, opts);
  if (ccLine) return ccLine;
  const n = norm(lineName);
  const row = (lines || []).find(l => norm(l?.name) === n);
  return canWriteUnit(ctx, row?.section, opts);
}

/** กรองลิสต์ให้เหลือ "แถวที่แก้ได้" — ใช้ตอนอยากซ่อนปุ่ม (ยังต้องเช็คซ้ำใน handler ด้วย) */
export function writableRows(ctx = {}, rows = [], sectionOf, opts = {}) {
  if (hasAllUnits(ctx)) return rows || [];
  return (rows || []).filter(r => canWriteUnit(ctx, sectionOf?.(r), opts).ok);
}
