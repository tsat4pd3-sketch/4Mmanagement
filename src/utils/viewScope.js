/* ══ 👁️ ขอบเขต "ที่เห็นได้" ที่ตัดสินผ่าน **ผังองค์กร** — ไม่ใช่เทียบข้อความส่วนงานอย่างเดียว ══
 *                                                                           2026-10-22
 * ── ปัญหาที่แก้ (คำสั่ง user) ───────────────────────────────────────────────────────
 * *"ไล่เช็คเรื่อง relation ของข้อมูลที ทำไมยังบอกว่าไม่ link กัน เพราะพนักงานทุกคนจะมี cc
 *   ที่ตัวเองสังกัดหลัก นั่นแปลว่าถ้าบอกว่าหัวหน้าคนนี้รับผิดชอบงาน cc ไหนบ้างมันต้องเกี่ยวข้องกันสิ"*
 *
 * เดิมทุกจอกรองด้วย **ข้อความ** `employees.section` / `production_lines.section` ตรงตัว
 * (`.in('section', scopeSecs)`) ⇒ ขอบเขตที่เป็น **แผนก** หรือ **ไลน์** ใช้ไม่ได้เลย:
 *   · หัวหน้าแผนก SMALL PRESS อยากเห็นเฉพาะ LINE C+D → ตั้งได้แค่ "ทั้ง PD1" (ได้ 800/600 มาด้วย)
 *   · บัญชีที่ `section` เก็บชื่อแผนก (JIG MTN / Die MTN / MTN — วัด 22/10 = 15 ใบ) → กรองแล้วได้ 0 แถว
 * ทั้งที่ข้อมูลลิงก์กันครบอยู่แล้ว: `employees.org_node_id` 245/249 (98%) · ผังมี `parent_id` + `cost_center`
 *
 * ── สิ่งที่ไฟล์นี้ทำ ────────────────────────────────────────────────────────────────
 * แปลง "ชื่อหน่วยที่ตั้งไว้" (ส่วนงาน / แผนก / กลุ่ม / ไลน์ ปนกันได้) → ชุดที่เอาไปกรองแถวจริง
 *   · `sections` / `departments` → ใช้กับ `employees.section` / `employees.department`
 *   · `lineNames`                → ใช้กับ `production_lines.name` (รวมไลน์ใต้หน่วยนั้นทั้งหมด)
 *
 * 🔴 **กฎเหล็กของไฟล์นี้**
 *   1. ชื่อที่ผัง **ไม่รู้จัก** = คงพฤติกรรมเดิม (เทียบข้อความกับ `section`) — ห้ามบีบให้แคบลงเงียบ
 *      (ทะเบียนเก่าหลายที่เก็บข้อความนอกผัง · บีบ = คนหายจากจอโดยไม่มีใครรู้)
 *   2. `limited === false` = **ไม่จำกัด** (เห็นทั้งโรงงาน) — `[]` ของขอบเขตแปลว่า "ไม่จำกัด" เหมือนเดิม
 *   3. ไฟล์นี้ตอบแค่ **"เห็นได้ไหม"** — คนละแกนกับ "แก้ได้ไหม" (`writeScope.js` / `ccScope.js`)
 *   4. ไม่มีดัชนีผัง (`scopeIdx`) = ถอยไปพฤติกรรมเดิมทั้งหมด (จอยังทำงานได้ระหว่างโหลด)
 */
const norm = (s) => String(s ?? '').trim().toLowerCase();

/** ชื่อหน่วย → ชนิดในผัง (กว้าง→แคบ) · ไม่รู้จัก = null */
function kindOfName(idx, name) {
  if (!idx || typeof idx.has !== 'function') return null;
  const v = String(name ?? '').trim();
  if (!v) return null;
  for (const kind of ['section', 'department', 'line_group', 'line']) {
    if (idx.has(kind, v)) return kind;
  }
  return null;
}

/**
 * สร้างตัวกรอง "ที่เห็นได้" จากรายชื่อหน่วยที่ตั้งไว้
 * @param scopeNames ชื่อหน่วยที่บัญชีถูกจำกัด (= ผลของ `effectiveSections()`) · ว่าง = ไม่จำกัด
 * @param idx        ดัชนีผัง (`buildOrgScope()` · `UserContext.scopeIdx`) · ไม่มี = ถอยไปแกนข้อความ
 */
export function buildViewScope(scopeNames = [], idx = null) {
  const names = (Array.isArray(scopeNames) ? scopeNames : []).filter(Boolean);
  if (!names.length) {
    return { limited: false, sections: [], departments: [], lineNames: [], unknownNames: [],
      empOk: () => true, lineOk: () => true, byOrg: false };
  }
  const sections = new Set();
  const departments = new Set();
  const lineNames = new Set();
  const unknownNames = [];

  names.forEach((n) => {
    const kind = kindOfName(idx, n);
    if (!kind) { unknownNames.push(n); sections.add(n); return; }   // กฎข้อ 1 — ของเดิมต้องไม่พัง
    if (kind === 'section') sections.add(n);
    else if (kind === 'department') departments.add(n);
    (idx.lineNamesOf?.(kind, n) || []).forEach(x => lineNames.add(x));
  });

  const secSet = new Set([...sections].map(norm));
  const depSet = new Set([...departments].map(norm));
  const lineSet = new Set([...lineNames].map(norm));
  const byOrg = depSet.size > 0 || lineSet.size > 0;

  /** พนักงานคนนี้อยู่ในขอบเขตไหม — ส่วนงาน **หรือ** แผนก **หรือ** ไลน์ที่สังกัด */
  const empOk = (emp, lineNameOf) => {
    if (!emp) return false;
    if (secSet.has(norm(emp.section))) return true;
    if (depSet.has(norm(emp.department))) return true;
    if (lineSet.size && emp.line_id != null) {
      const ln = typeof lineNameOf === 'function' ? lineNameOf(emp.line_id) : null;
      if (ln && lineSet.has(norm(ln))) return true;
    }
    return false;
  };

  /** ไลน์นี้อยู่ในขอบเขตไหม — ชื่อไลน์ตรงชุดที่ขยายจากผัง หรือส่วนงานของไลน์ตรงกับขอบเขต */
  const lineOk = (line) => {
    if (!line) return false;
    const nm = typeof line === 'string' ? line : line.name;
    if (lineSet.has(norm(nm))) return true;
    if (typeof line === 'object' && secSet.has(norm(line.section))) return true;
    return false;
  };

  return {
    limited: true, byOrg,
    sections: [...sections], departments: [...departments], lineNames: [...lineNames],
    unknownNames, empOk, lineOk,
  };
}

/** เงื่อนไข `.or()` ของ PostgREST สำหรับกรองพนักงาน — `null` = ไม่ต้องกรอง (ไม่จำกัด)
 *  🔴 ต้องครอบค่าด้วย `"` เพราะชื่อหน่วยมีเว้นวรรค (JIG MTN) · ค่าที่มี `"` ถูกตัดออก (ไม่มีในทะเบียนจริง) */
export function empScopeOrFilter(vs, lineIds = []) {
  if (!vs || !vs.limited) return null;
  const q = (arr) => arr.map(v => String(v).replace(/"/g, '')).map(v => `"${v}"`).join(',');
  const parts = [];
  if (vs.sections.length) parts.push(`section.in.(${q(vs.sections)})`);
  if (vs.departments.length) parts.push(`department.in.(${q(vs.departments)})`);
  /* คนที่ผูก "ไลน์" ใต้หน่วยนั้น แต่ช่องส่วนงาน/แผนกเขียนอย่างอื่น — ต้องไม่หายจากจอ */
  const ids = (lineIds || []).filter(v => v != null);
  if (ids.length) parts.push(`line_id.in.(${ids.join(',')})`);
  return parts.length ? parts.join(',') : null;
}

/** id ของไลน์ที่อยู่ในขอบเขต (ไว้ส่งเข้า `empScopeOrFilter`) — `[]` = ไม่มี/ไม่จำกัด */
export function scopeLineIds(vs, lines = []) {
  if (!vs || !vs.limited || !vs.lineNames.length) return [];
  const want = new Set(vs.lineNames.map(n => String(n ?? '').trim().toLowerCase()));
  return (lines || []).filter(l => want.has(String(l?.name ?? '').trim().toLowerCase()))
    .map(l => l.id).filter(v => v != null);
}
