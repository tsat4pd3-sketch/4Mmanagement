# ทะเบียนเอกสาร `/doc-forms` (Document Master) — ขั้นตอน register เอกสาร export ใหม่

> ย้ายมาจาก `CLAUDE.md` (2026-09-30 — CLAUDE.md ชนเพดาน 120 KB) · **ตัวกฎยังอยู่ใน CLAUDE.md**
> ไฟล์นี้เก็บ "ขั้นตอน 3 ข้อ + ชื่อฟังก์ชัน" ที่ยาวเกินจะอยู่ในไฟล์กฎกลาง
> ดูหน้าตา/แถวในทะเบียน + ข้อตกลง UI → `docs/UI-CONVENTIONS.md` §6.6

## กฎ (ย่อจาก CLAUDE.md)

**เอกสาร export ใหม่ทุกตัว (ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน — ไม่มีข้อยกเว้น) ต้อง register
เข้าทะเบียน `/doc-forms`** ให้ doc_control ปรับเลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer/โลโก้/
Legend/ผู้ออกเอกสาร/Revision History **ได้เองโดยไม่ต้องแก้โค้ด**

## ขั้นตอนบังคับ 3 ข้อ

1. **seed แถวใน `doc_forms`** (เป็น migration) — เอกสารที่ยังไม่มีเลขฟอร์มทางการก็ seed ด้วย
   `form_code = null` ไว้ก่อน
2. **ฟังก์ชันพิมพ์อ่านค่าผ่าน `src/utils/docForms.js`** — `getDocForm` / `docFormSync` / `fullCode` /
   `getDocFormRevisions` + **fallback ค่าเดิมในโค้ดเสมอ** · ฟอร์มทางการวาดหัว/footer เอง
   · **รายงานภายในที่ไม่มี layout ฟอร์ม อย่างน้อยห่อ html ก่อนพิมพ์ด้วย `withDocFoot(html, doc_key)`**
     (ทะเบียนยังไม่ตั้งเลขฟอร์ม = หน้าตาเดิมเป๊ะ · ตั้งเมื่อไหร่แถบเลขฟอร์มโผล่เอง)
3. **โลโก้ผ่าน `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)`**

🔴 **ห้าม hardcode เลขฟอร์ม/Rev/โลโก้ในโค้ด · ห้ามสร้างตารางทะเบียนเอกสารแยกใหม่**
(เคยมี `document_controls` ซ้อนกับทะเบียนกลาง — ยุบเข้าด้วยกันแล้ว 2026-07-30)

## ข้อความเดิมจาก CLAUDE.md (ยกมาทั้งบรรทัด กันข้อความหาย)

- **เอกสาร export ใหม่ทุกตัว (ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน — ไม่มีข้อยกเว้น) → ต้อง register เข้าระบบทะเบียนเอกสาร `/doc-forms` (Document Master)** ให้ doc_control ปรับแต่งได้เอง (เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer/โลโก้/Legend/ผู้ออกเอกสาร/Revision History) โดยไม่ต้องแก้โค้ด — ขั้นตอนบังคับ: (1) seed แถวใน `doc_forms` (migration — เอกสารที่ยังไม่มีเลขฟอร์มทางการก็ seed ด้วย form_code=null ไว้ก่อน) (2) ฟังก์ชันพิมพ์อ่านค่าผ่าน `src/utils/docForms.js` (`getDocForm`/`docFormSync`/`fullCode`/`getDocFormRevisions` + fallback ค่าเดิมในโค้ดเสมอ) — ฟอร์มทางการวาดหัว/footer เอง · **รายงานภายในที่ไม่มี layout ฟอร์ม อย่างน้อยห่อ html ก่อนพิมพ์ด้วย `withDocFoot(html, doc_key)`** (ทะเบียนยังไม่ตั้งเลขฟอร์ม = หน้าตาเดิมเป๊ะ ตั้งเมื่อไหร่แถบเลขฟอร์มโผล่เอง) (3) โลโก้ผ่าน `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)` **ห้าม hardcode เลขฟอร์ม/Rev/โลโก้ในโค้ด และห้ามสร้างตารางทะเบียนเอกสารแยกใหม่** (เคยมี `document_controls` ซ้อน ยุบแล้ว — `docs/UI-CONVENTIONS.md` §6.6)
