/* ══ ลำดับมาตรฐานของ "รายการที่ใช้ซ้ำหลายหน้า" — จุดเดียวทั้งระบบ (2026-10-01 · คำสั่ง user) ══════════
   ที่มา: *"ดู dropdown ตัวอื่นๆ ด้วย ที่ใช้เหมือนกันหลายหน้า อย่าให้มั่ว"* (ต่อจากรอบ dropdown ไลน์)
   วัดจริง (MAIN 01/10): ผังองค์กรตัวเดียวกันถูกดึง 3 แบบ — `order('name')` / `order('sort_order')` / ไม่สั่งเรียง
   แล้วบางหน้า `.sort()` ทับอีกชั้น ⇒ dropdown "แผนก" ของ PD3 หน้าหนึ่งขึ้น LINE APRON ASSY → HYDROFORM
   (ตามที่ตั้งในผัง) อีกหน้าขึ้น HYDROFORM → LINE APRON ASSY (ตัวอักษร) · แผนกช่าง QA → MTN กับ MTN → QA

   กติกา:
     1. **ของจากผังองค์กร (ส่วนงาน/แผนก/กลุ่ม/ทีม) = `sort_order` ที่ตั้งใน /org-setup → ชื่อแบบธรรมชาติ**
        (data-driven — admin จัดลำดับเองได้ ไม่ต้องแก้โค้ด) · ว่าง sort_order = ท้าย
     2. **ค่าที่ไม่อยู่ในผัง** (ดึงจากข้อมูลจริง เช่น section ของไลน์/พนักงาน) = ต่อท้าย เรียงธรรมชาติ — **ห้ามหาย**
     3. **"ธรรมชาติ"** = ไม่สนตัวพิมพ์/ช่องว่าง/วงเล็บ/ขีด · ตัวเลขเรียงแบบเลข (PD9 < PD10 · Line 60 = LINE 60)
     4. ไลน์ผลิตมีกติกาของตัวเอง (ส่วนงาน → แม่ → ลูก) → `src/utils/lineHierarchy.js` ซึ่งใช้ตัวเทียบจากไฟล์นี้
   ห้ามเรียงรายการพวกนี้เองในหน้าด้วย `.sort()` ดิบ / `localeCompare` / `order('name')` — มีด่าน regressionGuards */

const COLL = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const normKey = (s) => String(s ?? '').replace(/[\s()_\-]+/g, ' ').trim();

/** เทียบแบบธรรมชาติ — `X 9` < `X 10` · ไม่สนตัวพิมพ์/ช่องว่าง/วงเล็บ · เสมอกันจริงค่อยเทียบตัวดิบ (ลำดับนิ่ง) */
export const naturalCompare = (a, b) =>
  COLL.compare(normKey(a), normKey(b)) || COLL.compare(String(a ?? ''), String(b ?? ''));

/** ค่าของ node ที่หน้าใช้เป็น value ของ dropdown (code ก่อน · ไม่มี code ใช้ name) */
export const orgKey = (n) => n?.code || n?.name || '';

/** เทียบ node ในผังองค์กร — sort_order (ว่าง = ท้าย) → ชื่อธรรมชาติ */
export function orgNodeCompare(a, b) {
  const sa = a?.sort_order ?? null, sb = b?.sort_order ?? null;
  if (sa !== sb) return sa == null ? 1 : sb == null ? -1 : sa - sb;
  return naturalCompare(orgKey(a), orgKey(b)) || naturalCompare(a?.name, b?.name);
}

/** เรียง node ตามผัง แล้วคืนค่า (code||name) ไม่ซ้ำ ตามลำดับนั้น */
export function orgValues(nodes) {
  const seen = new Set(); const out = [];
  for (const n of [...(nodes || [])].sort(orgNodeCompare)) {
    const k = orgKey(n);
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** เรียง `values` ตามลำดับของ `ordered` (ลิสต์ที่เรียงมาตรฐานแล้ว เช่นส่วนงานจากผัง)
 *  ค่าที่ไม่อยู่ใน `ordered` = ต่อท้าย เรียงธรรมชาติ · ตัดค่าว่าง/ซ้ำ · ไม่แก้ array เดิม */
export function sortLike(values, ordered = []) {
  const rank = new Map((ordered || []).map((v, i) => [v, i]));
  const uniq = [...new Set((values || []).filter(v => v != null && v !== ''))];
  return uniq.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity, rb = rank.has(b) ? rank.get(b) : Infinity;
    return (ra === rb ? 0 : ra < rb ? -1 : 1) || naturalCompare(a, b);
  });
}
