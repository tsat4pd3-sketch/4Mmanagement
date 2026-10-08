/* ══ csvDoc — CSV ที่หลุดออกจากระบบ ก็เป็น "เอกสาร" ต้องมีทะเบียน ════════════════════
   (2026-10-06 · คำสั่ง user หลัง QC audit — "CSV เข้าข่ายไหม" → ทำเลย)

   CLAUDE.md §doc-forms: *"เอกสาร export ใหม่ทุกตัว (ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน —
   ไม่มีข้อยกเว้น) ต้อง register เข้าทะเบียน `/doc-forms`"* — CSV dump เคยถูกมองข้ามเพราะ
   ไม่มีหัวกระดาษให้ใส่เลขฟอร์ม

   🔴 **เลขฟอร์ม/Rev ของ CSV ไปอยู่ที่ "ชื่อไฟล์" เท่านั้น ห้ามแทรกบรรทัดลงในเนื้อไฟล์**
      CSV ถูกเปิดด้วย Excel/Sheets แล้วใช้ "แถวแรก = หัวตาราง" ⇒ แทรกบรรทัดเลขฟอร์ม
      = คอลัมน์เลื่อนทั้งไฟล์ = พัง pivot/สูตรของคนที่ใช้อยู่ทุกวัน

   🔴 **ทะเบียนยังไม่ตั้งเลขฟอร์ม (`form_code` ว่าง) = ชื่อไฟล์เดิมเป๊ะ**
      ⇒ วันที่ apply migration พฤติกรรมไม่เปลี่ยนเลย · เลขฟอร์มโผล่เองเมื่อ doc_control
      ไปตั้งที่ `/doc-forms` (หลักเดียวกับ `withDocFoot` ของใบพิมพ์)

   ⚠️ หน้าที่เรียกต้อง `loadDocForms()` เองก่อน (lazy chunk ไม่ได้ pre-warm cache ให้)
      ไม่เรียก = `docFormSync` คืน fallback = ได้ชื่อเดิม ไม่ล้ม แต่ฟีเจอร์ไม่ทำงาน
   ══════════════════════════════════════════════════════════════════════════════════ */
import { docFormSync } from './docForms';

export { csvCell, csvText } from './csvCore';   // re-export — ผู้เรียกเดิมไม่ต้องแก้ import
import { docFileNameFrom } from './csvCore';

/**
 * ชื่อไฟล์ที่ doc_control คุมได้ — ใช้กับไฟล์ที่ไม่มีหัวกระดาษให้ใส่เลขฟอร์ม (CSV / Excel)
 * @param {string} docKey      คีย์ในทะเบียน doc_forms
 * @param {string} legacyName  ชื่อไฟล์เดิม (รวมบริบท เช่น ช่วงวันที่/เดือน)
 * @param {string} ext         นามสกุลผลลัพธ์ (ไม่มีจุด) เช่น `'csv'` · `'xlsx'`
 * ⚠️ `docFormSync` เป็น sync ⇒ หน้าที่เรียกต้อง `loadDocForms()` เองก่อน
 *    ไม่เรียก = ได้ชื่อไฟล์เดิม (ไม่ล้ม) แต่เลขฟอร์มที่ doc_control ตั้งไว้จะไม่โผล่
 */
export const docFileName = (docKey, legacyName, ext = 'csv') =>
  docFileNameFrom(docFormSync(docKey, {}), legacyName, ext, docKey);

/** ชื่อไฟล์ CSV */
export const csvDocName = (docKey, legacyName) => docFileName(docKey, legacyName, 'csv');

/**
 * ชื่อไฟล์ Excel — **Excel มีที่ใส่เลขฟอร์มในชีตได้ แต่ห้ามแทรกแถวบนสุด**
 * เหตุผลเดียวกับ CSV: ตัวอ่านฝั่งผู้ใช้ (pivot/สูตร/ตัวนำเข้า) ยึด "แถวแรก = หัวตาราง"
 * ⇒ เลขฟอร์มไปอยู่ที่ชื่อไฟล์เหมือนกัน
 */
export const xlsxDocName = (docKey, legacyName) => docFileName(docKey, legacyName, 'xlsx');

/** สร้างไฟล์ + ดาวน์โหลด (BOM นำหน้าเสมอ — Excel ไทยอ่าน UTF-8 ไม่ออกถ้าไม่มี) */
export function downloadCsvDoc(docKey, legacyName, text) {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvDocName(docKey, legacyName);
  a.click();
  URL.revokeObjectURL(url);   // ไม่ revoke = รั่วทุกครั้งที่กด export
}
