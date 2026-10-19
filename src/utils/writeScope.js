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
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

const norm = (s) => (s || '').toString().trim().toLowerCase();

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
  return `${what}เป็นของ${unit ? `ส่วนงาน ${unit}` : 'ส่วนงานอื่น'} — ดูได้ แต่แก้ไม่ได้`
    + ' (ต้องให้คนในส่วนงานนั้นแก้ หรือขอสิทธิ์ข้ามหน่วยงาน)';
}

/** รุ่นที่ใช้กับ "ไลน์" — หาส่วนงานเจ้าของไลน์จากทะเบียนก่อน แล้วค่อยตัดสิน
 *  🔴 ไลน์ที่หาไม่เจอในทะเบียน = **ไม่รู้เจ้าของ** ไม่ใช่ "ของเรา" ⇒ เดินตามกฎ `unknownTarget` */
export function canWriteLine(ctx = {}, lineName, lines = [], opts = {}) {
  if (hasAllUnits(ctx)) return { ok: true, code: 'all_units' };
  const n = norm(lineName);
  const row = (lines || []).find(l => norm(l?.name) === n);
  return canWriteUnit(ctx, row?.section, opts);
}

/** กรองลิสต์ให้เหลือ "แถวที่แก้ได้" — ใช้ตอนอยากซ่อนปุ่ม (ยังต้องเช็คซ้ำใน handler ด้วย) */
export function writableRows(ctx = {}, rows = [], sectionOf, opts = {}) {
  if (hasAllUnits(ctx)) return rows || [];
  return (rows || []).filter(r => canWriteUnit(ctx, sectionOf?.(r), opts).ok);
}
