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

---

## 📊 3 ชีทของไฟล์ Excel KPI = 3 ฟอร์มคนละเลข (2026-10-06 · QC audit)

`src/lib/kpiExportExcel.js` **เขียนกฎนี้ไว้ในหัวไฟล์เอง** ว่า *"เลขฟอร์ม/Rev อ่านจากทะเบียน doc_forms
(doc_key: kpi_monthly) — ห้าม hardcode"* แล้ว **ยัง hardcode ทั้ง 3 ที่** — ทั้งในหัวตารางและ**ในชื่อชีท**

**ต้นเหตุ:** 3 ชีท = **3 ฟอร์มคนละเลข** (`FM-HRM-6-022` / `FM-HRM-6-024(01)` / `FM-HRM-6-025(01)`)
แต่มี doc_key เดียว ⇒ **ใส่ลงทะเบียนไม่ได้ตั้งแต่แรก** ⇒ คนเขียนจำเป็นต้อง hardcode
= กรณีที่ "กฎถูก แต่โครงสร้างไม่รองรับกฎ" — ต้องแก้โครงสร้าง ไม่ใช่เตือนคนให้ทำตามกฎ

**แก้: 3 doc_key** — `kpi_appraisal` · `kpi_monitoring` · `kpi_action`
· `kpi_monthly` **คงไว้เหมือนเดิม** — ตัวนั้นเป็น "ใบพิมพ์" ของหน้า KPI (คนละใบกับ Excel นี้)
· seed `form_code` = **เลขที่ใช้อยู่จริงวันนี้** ⇒ ก่อน doc_control แก้ ไฟล์ที่ export เหมือนเดิมเป๊ะ
  (ต่างจาก migration CSV รอบเดียวกันที่ seed `form_code = null` เพราะ "ยังไม่มีเลขฟอร์มจริง")
· migration `20261006_doc_forms_kpi_excel_sheets.sql` (**apply แล้ว**)

🔴 **ชื่อชีท Excel มีข้อจำกัดของตัวเอง: ≤31 ตัวอักษร · ห้ามมี `: \ / ? * [ ]`**
⇒ เลขฟอร์มที่ doc_control แก้เองได้ **ต้องถูกล้างก่อนเอาไปตั้งชื่อชีท** ไม่งั้นไฟล์เปิดไม่ได้
→ `sheetName(base, code)` ใน `kpiExportExcel.js` (แทนอักขระต้องห้าม + ตัดที่ 31)
**ทุกที่ที่เอาค่าจากทะเบียนไปตั้งชื่อชีท/ชื่อไฟล์ ต้องมีตัวล้างแบบนี้** — ค่าในทะเบียนเป็น input จากคน

## 📑 CSV / Excel — เลขฟอร์มอยู่ที่ "ชื่อไฟล์" (รอบ 2 เก็บครบแล้ว 2026-10-08)

ไฟล์ที่ไม่มีหัวกระดาษให้ใส่เลขฟอร์ม (CSV · Excel) ⇒ **เลขฟอร์ม/Rev ไปอยู่ที่ชื่อไฟล์**
🔴 **ห้ามแทรกบรรทัดเลขฟอร์มในเนื้อไฟล์** — Excel/Sheets ยึด "แถวแรก = หัวตาราง"
⇒ คอลัมน์เลื่อนทั้งไฟล์ = พัง pivot/สูตร/ตัวนำเข้า ของคนที่ใช้อยู่ทุกวัน

**โครงไฟล์ (แยก pure ออกจากตัวที่อ่านฐาน):**

| ไฟล์ | หน้าที่ | เทส |
|---|---|---|
| `src/utils/csvCore.js` | **pure** — ประกอบชื่อไฟล์ · escape · กัน formula injection | `__tests__/csvCore.test.mjs` (12 เคส) |
| `src/utils/csvDoc.js` | ห่อด้วยการอ่านทะเบียน (`docFormSync`) + ตัวดาวน์โหลด | — (แตะ DOM/ฐาน) |

**ทำไมต้องแยก:** `csvDoc.js` → `docForms` → `supabaseClient` ที่ใช้ `import.meta.env`
⇒ `node --test` **โหลดโมดูลไม่ได้เลย** = ตรรกะที่พลาดแล้วเจ็บสุด (กัน formula injection)
ไม่มีเทสคุมมาตลอด ⇒ ย้ายส่วนที่ไม่แตะฐานมาไว้ `csvCore.js`

**วิธีใช้:**
```js
import { downloadCsvDoc, csvText } from '../utils/csvDoc';
import { loadDocForms } from '../utils/docForms';
loadDocForms();                       // ⚠️ docFormSync เป็น sync — ต้อง warm cache ที่หน้านั้นเอง
downloadCsvDoc('<doc_key>', '<ชื่อไฟล์เดิม>', csvText(headers, rows));
// Excel: XLSX.writeFile(wb, xlsxDocName('<doc_key>', '<ชื่อไฟล์เดิม>'))
```
· 🔴 ไม่เรียก `loadDocForms()` = **ได้ชื่อไฟล์เดิม ไม่ล้ม แต่ฟีเจอร์ไม่ทำงาน** (เงียบ)
· 🔴 ทะเบียนยังไม่ตั้ง `form_code` = **ชื่อไฟล์เดิมเป๊ะ** ⇒ วันที่ apply migration ไม่มีอะไรเปลี่ยน
· ด่าน **`csv-export-via-csvDoc`** — ห้าม `new Blob(… 'text/csv' …)` นอก `csvCore/csvDoc`

**ที่เก็บไปแล้ว:** รอบ 1 (06/10) 8 คีย์ · **รอบ 2 (08/10) 16 คีย์** =
`/report` 10 ปุ่ม + `/daily-report` 4 ชนิดรายงาน + Excel 2 ตัว (แม่แบบอะไหล่ · CQI-15 Event Log)
migration `20261008_doc_forms_csv_round2_main.sql` (MAIN · **apply จริง 08/10**)

> ### 🔴 "ไฟล์ migration เข้า main แล้ว" ≠ "ฐานมีของแล้ว" (บทเรียน 08/10)
> รอบ 2 **ไฟล์เข้า main แต่ไม่มีใคร apply** — ฐานยังมี csv 13 แถว ขณะโค้ดอ่าน **12 คีย์ที่ไม่มีใน
> ทะเบียน** ⇒ `docFormSync` คืน `undefined` ⇒ **ได้ชื่อไฟล์เดิม ไม่ล้ม ไม่มี error**
> = doc_control เปิด `/doc-forms` ก็ไม่เห็นปุ่มพวกนี้ ตั้งเลขฟอร์มไม่ได้เลย (อาการเงียบสนิท)
> · 2 session ทำเรื่องเดียวกันพร้อมกัน ⇒ คนเขียนไฟล์กับคน apply คนละคน แล้วตกหล่น
> **⇒ ปิด session ที่แตะทะเบียน ต้องคิวรีฐานทวนเสมอ ห้ามเชื่อว่าไฟล์ที่ merge แล้ว = apply แล้ว:**
> ```sql
> -- project "MAIN" (ewhdfqwfwofivojtsizn) · ควรได้ csv 22+ · xlsx 2
> select count(*) filter (where doc_key like 'csv\_%')  as csv_keys,
>        count(*) filter (where doc_key like 'xlsx\_%') as xlsx_keys from doc_forms;
> ```
> · เทียบกับคีย์ที่โค้ดอ่านจริง: `grep -rhoE "['\"](csv|xlsx)_[a-z0-9_]+['\"]" src/`
>   (⚠️ `/daily-report` ประกอบคีย์แบบ `csv_dr_${reportType}` ⇒ grep ตรงๆ ไม่เห็น 4 คีย์นั้น)

🧹 **คีย์ที่ไม่มีโค้ดอ่าน = "คีย์ไร้ปุ่ม" ต้องถอน** — ตั้งเลขฟอร์มแล้วไม่เห็นผล + มี 2 แถวของรายงาน
เดียวกันให้เลือกผิด · ถอนไป 7 คีย์ 08/10 (`20261008b_doc_forms_drop_dup_csv_keys_main.sql`)
· **ยังค้าง `csv_attendance`** — รอบ 2 ใช้ชื่อ `csv_attendance_sheet` แทน ⇒ ตัวเดิมไร้ปุ่ม

🔴 **สำเนาที่ก๊อปไปมักตกข้อ "กัน formula injection"** — `DailyReport.exportCSV` ตัวเดิมไม่มีด่านนี้
(ของ `Report.jsx` มี) ⇒ ค่าที่หน้างานพิมพ์ในช่อง 'รายละเอียด'/'เครื่องจักร' ขึ้นต้น `=` `+` `@`
ถูก Excel **รันเป็นสูตรบนเครื่องคนรับไฟล์** · นี่คือเหตุผลที่ต้องมีทางเดียว ไม่ใช่สำเนา

## 🖼️ โลโก้ในใบพิมพ์ ต้องอ่านจากทะเบียนก่อนเสมอ (2026-10-08)

`urlToDataUrl(docFormSync('<doc_key>', {}).logo_url || tsLogoUrl)` — ทะเบียนชนะ แล้วถอยไปโลโก้ TS
🔴 ตัว cache โลโก้ **ต้อง cache ต่อ "url" ไม่ใช่ตัวเดียวตายตัว** ไม่งั้นใบที่ตั้งโลโก้เองได้ค่าของใบอื่น
· แก้แล้ว 4 ใบ: `Report.jsx` 3 ใบ (`changing_point` · `skill_pay_summary` · `attendance_record`
  — ผ่าน helper `formLogo(docKey)`) + `PmCoordination` 1 ใบ
· ⚠️ **ข้อสังเกตที่ audit แจ้งผิด:** `PmCoordination` ไม่ต้องแปลงเป็น dataURL เพราะใช้
  `w.onload = () => w.print()` ซึ่ง **รอรูปโหลดเสร็จอยู่แล้ว** (ที่ผิดจริงคือไม่อ่านทะเบียน)
· 🔴 **backtick ในคอมเมนต์ที่อยู่ "ใน" template literal จะปิด literal ทันที** — เจอจริงตอนแก้ใบนี้
  ⇒ คอมเมนต์อธิบายต้องอยู่นอก template literal

## 🔢 เลขฟอร์มที่คนแก้รายใบได้ — ค่าตั้งต้นต้องมาจากทะเบียน (2026-10-08)

`Report.jsx` ใบบันทึกการมาทำงาน เคย `useState('F-HR-001')` hardcode แล้วพิมพ์ลงหัวใบ
ขณะที่ **ท้ายใบเดียวกัน** ห่อด้วย `withDocFoot(html, 'attendance_record')` ที่อ่านจากทะเบียน
⇒ doc_control ตั้ง `form_code` ใหม่ = **หัวใบขึ้นเลขหนึ่ง ท้ายใบขึ้นอีกเลข บนกระดาษใบเดียวกัน**
⇒ `useState(() => docFormSync('attendance_record', { form_code: 'F-HR-001' }).form_code || 'F-HR-001')`
(ช่องยังแก้รายใบได้เหมือนเดิม — แค่ค่าตั้งต้นไม่โกหก)
