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

/** ตัวอักษรที่ตั้งชื่อไฟล์ไม่ได้บน Windows/macOS — กันชื่อฟอร์มที่คนพิมพ์ `/` มาทำดาวน์โหลดล้ม */
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

/**
 * ชื่อไฟล์ CSV ที่ doc_control คุมได้
 * @param {string} docKey      คีย์ในทะเบียน doc_forms
 * @param {string} legacyName  ชื่อไฟล์เดิม (รวมบริบท เช่น ช่วงวันที่/เดือน) — ใส่ `.csv` หรือไม่ก็ได้
 */
export function csvDocName(docKey, legacyName) {
  const d = docFormSync(docKey, {});
  const base = safe(String(legacyName || docKey).replace(/\.csv$/i, '')) || docKey;
  const code = safe(d.form_code);
  const rev = safe(d.rev);
  const head = [code, rev && `Rev${rev}`].filter(Boolean).join('_');
  return `${head ? `${head}_` : ''}${base}.csv`;
}

/** สร้างไฟล์ + ดาวน์โหลด (BOM นำหน้าเสมอ — Excel ไทยอ่าน UTF-8 ไม่ออกถ้าไม่มี) */
export function downloadCsvDoc(docKey, legacyName, csvText) {
  const blob = new Blob([`﻿${csvText}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvDocName(docKey, legacyName);
  a.click();
  URL.revokeObjectURL(url);   // ไม่ revoke = รั่วทุกครั้งที่กด export
}

/** escape ตามมาตรฐาน CSV + กัน formula injection (`=`/`+`/`-`/`@` นำหน้า = Excel รันเป็นสูตร) */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ตาราง → ข้อความ CSV (หัว + แถว) */
export const csvText = (headers, rows) =>
  [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
