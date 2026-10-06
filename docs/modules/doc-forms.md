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

---

## 📑 CSV export ก็เป็น "เอกสาร" — เข้าทะเบียนแล้ว (2026-10-06 · คำสั่ง user หลัง QC audit)

QC audit 06/10 ถามว่า *"CSV dump เข้าข่ายกฎ 'export ใหม่ทุกตัวต้อง register' ไหม"* — **user เคาะว่าเข้า ทำเลย**

### ทำไมเคยหลุด
CSV ไม่มีหัวกระดาษให้ใส่เลขฟอร์ม/Rev เหมือนใบพิมพ์ ⇒ ไม่มีใครรู้ว่าจะ register ไปทำอะไร
จึงถูกข้ามมาตลอด ทั้งที่ไฟล์พวกนี้หลุดออกจากระบบไปอยู่ในมือคนนอกเหมือนใบพิมพ์ทุกประการ

### กติกา
🔴 **เลขฟอร์ม/Rev ของ CSV อยู่ที่ "ชื่อไฟล์" เท่านั้น — ห้ามแทรกบรรทัดลงในเนื้อไฟล์**
CSV ถูกเปิดด้วย Excel/Sheets แล้วใช้ "แถวแรก = หัวตาราง" ⇒ แทรกบรรทัดเลขฟอร์ม = **คอลัมน์เลื่อนทั้งไฟล์**
= พัง pivot/สูตรของคนที่ใช้อยู่ทุกวัน (เสียหายกว่าประโยชน์ที่ได้)

🔴 **ทะเบียนยังไม่ตั้งเลขฟอร์ม (`form_code` ว่าง) = ชื่อไฟล์เดิมเป๊ะ**
⇒ วันที่ apply migration **ไม่มีอะไรเปลี่ยนเลย** · เลขฟอร์มโผล่เองเมื่อ doc_control ไปตั้งที่ `/doc-forms`
(หลักเดียวกับ `withDocFoot` ของใบพิมพ์)

⚠️ หน้าที่ export ต้องเรียก `loadDocForms()` เองตอน mount — lazy chunk ไม่ได้ pre-warm cache ให้
ไม่เรียก = `docFormSync` คืน fallback = ได้ชื่อเดิม (ไม่ล้ม แต่ฟีเจอร์ไม่ทำงาน)

### ของกลาง — `src/utils/csvDoc.js`
| ฟังก์ชัน | ใช้ทำอะไร |
|---|---|
| `csvDocName(docKey, legacyName)` | ชื่อไฟล์ที่ doc_control คุมได้ (เติม `<form_code>_Rev<rev>_` นำหน้าชื่อเดิม) |
| `downloadCsvDoc(docKey, legacyName, csvText)` | สร้าง blob + ดาวน์โหลด + **revoke URL** (ของเดิม 4 จุดไม่เคย revoke) |
| `csvCell(v)` | escape ตามมาตรฐาน CSV + **กัน formula injection** (`=`/`+`/`-`/`@` นำหน้า = Excel รันเป็นสูตร) |
| `csvText(headers, rows)` | ตาราง → ข้อความ CSV |

### doc_key ที่ seed แล้ว (migration `20261006_doc_forms_csv_exports.sql` · **apply แล้ว 06/10**)
`csv_manpower_daily` · `csv_station_moves` · `csv_ot_individual` (`/workforce-insight`) ·
`csv_heijunka_kanban` (`/heijunka`) · `csv_kanban_calc` (`/planner-sales`) ·
`csv_product_master` · `csv_product_template` · `csv_parts_template` (`/products`)

**ผลพลอยได้:** `ProductMaster` เดิมไม่ได้กัน formula injection (ของ `WorkforceInsight` กัน) — ตอนนี้ของกลางกันให้ทุกจุด
