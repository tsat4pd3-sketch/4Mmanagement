/* ══ csvCore — ส่วน "คิดเอง ไม่แตะฐาน" ของ CSV/Excel export (pure · มีเทส) ═════════════
   (แยกออกจาก `csvDoc.js` เมื่อ 2026-10-08 · QC audit รอบ 3)

   ทำไมต้องแยกไฟล์: `csvDoc.js` import `docForms` ซึ่ง import `supabaseClient` ที่ใช้
   `import.meta.env` ⇒ `node --test` **โหลดโมดูลไม่ได้เลย** = กฎการ escape / กัน formula
   injection / การประกอบชื่อไฟล์ ซึ่งเป็นตรรกะที่พลาดแล้วเจ็บที่สุด **ไม่มีเทสคุมเลย**
   ⇒ ย้ายส่วนที่ไม่แตะฐานมาที่นี่ (pure) แล้ว `csvDoc.js` ห่อด้วยการอ่านทะเบียน
   (pattern เดียวกับ `utils/orgNodeRefs.js` · `utils/planLots.js` — สูตรอยู่ util ที่เทสได้)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** ตัวอักษรที่ตั้งชื่อไฟล์ไม่ได้บน Windows/macOS — ชื่อฟอร์ม/ไลน์ที่คนพิมพ์ `/` มาทำดาวน์โหลดล้ม */
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

/**
 * ประกอบชื่อไฟล์จาก "แถวทะเบียน" (pure)
 * @param {{form_code?: string, rev?: string}} row  แถวจาก doc_forms (ว่างได้)
 * @param {string} legacyName  ชื่อไฟล์เดิม (รวมบริบท เช่น ช่วงวันที่/ไลน์) — ใส่นามสกุลหรือไม่ก็ได้
 * @param {string} ext         นามสกุลผลลัพธ์ (ไม่มีจุด)
 * @param {string} docKey      ใช้เป็นชื่อสำรองเมื่อไม่ส่ง legacyName (ห้ามได้ไฟล์ชื่อ ".csv")
 *
 * 🔴 ทะเบียนยังไม่ตั้ง `form_code` = **ชื่อไฟล์เดิมเป๊ะ** ⇒ วันที่ apply migration ไม่มีอะไรเปลี่ยน
 *    (หลักเดียวกับ `withDocFoot` ของใบพิมพ์ — ของใหม่ต้อง no-op จนกว่า doc_control จะตั้งค่า)
 */
export function docFileNameFrom(row, legacyName, ext = 'csv', docKey = '') {
  const base = safe(String(legacyName || docKey || '').replace(new RegExp(`\\.${ext}$`, 'i'), '')) || docKey || 'export';
  const head = [safe(row?.form_code), row?.rev && `Rev${safe(row.rev)}`].filter(Boolean).join('_');
  return `${head ? `${head}_` : ''}${base}.${ext}`;
}

/**
 * escape ตามมาตรฐาน CSV + **กัน formula injection**
 * ค่าที่คนพิมพ์ขึ้นต้นด้วย `=` `+` `-` `@` ถูก Excel/Sheets รันเป็นสูตรบนเครื่องคนรับไฟล์
 * 🔴 ยกเว้น **ตัวเลขติดลบจริง** (`-5` ไม่ใช่สูตร) — quote ทิ้งจะกลายเป็นข้อความ พัง SUM ของผู้ใช้
 */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ตาราง → ข้อความ CSV (หัว + แถว) */
export const csvText = (headers, rows) =>
  [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
