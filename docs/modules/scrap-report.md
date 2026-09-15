# Scrap Report — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export · 2026-07-16)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


หน้า `/scrap-report` (`ScrapReport.jsx`, **กลุ่มฝ่ายผลิต** — ฝ่ายผลิตเป็นผู้ใช้งานหลัก) — แทนฟอร์มกระดาษ "ใบรายงานของเสีย" ที่เขียนมือ · ลงยอด scrap ต่อ **ไลน์/วัน** แล้ว export Excel ตรงฟอร์ม 100% · ⚠️ `production_lines` อยู่ **Main project** (client `supabase`) ไม่ใช่ DR — dropdown ไลน์ต้องดึงจาก `supabase` (เคยพลาดใช้ `supabaseDR` แล้ว dropdown ว่าง)

- **ตาราง (DR project — anon RLS):** `scrap_reports` (หัวใบ: report_date, line_name, dept/section/division, product_categories[], storage_location, doc_no, สายอนุมัติ inspector/requester/approver_qa/pd/gm, sender/receiver, status draft/submitted/approved) · `scrap_report_items` (รายการต่อพาร์ท: source main/sub, part_no/part_name/mat_no/model/code A-E/bom_ref, qty, m_cause m1-m5, stage in_process/post_process, confirm_qty, defect_codes, src_defect_from_logs) · `scrap_defect_types` (master P1-P20 กระบวนการ / A1-A18 ประกอบ-เชื่อม — seed จากชีท Defect Type จริง) · migration `20260716_scrap_report.sql` (DR) + `20260716_scrap_report_permissions.sql` (Main)
- **⭐ ดึงเข้าใบได้ 2 ทาง (2026-08-24 · user: "scrap report ดึงได้ 2 ทาง จาก daily report และ ใบเบิกของ QA")**
  1. **⤵ ดึงจาก Daily Report** — ของเสียที่เกิดจากการผลิต (`defect_logs` → ธง `src_defect_from_logs`)
  2. **⤵ ดึงจากใบเบิก QA** — ชิ้นงานที่ QA เบิกไปทดสอบแบบทำลาย (ใบ FM-STO-003 · ดู section ถัดไป)
     → ผูกกลับด้วย **`scrap_report_items.src_request_item_id`** (FK จริง อยู่ DR project เดียวกัน ·
     `on delete set null` — ใบ scrap เป็นบันทึกคุณภาพ ต้องอยู่ต่อแม้ใบเบิกถูกลบ) · แถวติดไอคอน 📦
     · ตั้ง `code='D' (TRY-OUT)` + `stage='post_process'` ให้เป็นค่าตั้งต้น (แก้ทับได้)
- **sync = ดึงตั้งต้น + แก้เองได้ (คำสั่ง user):** ปุ่ม "⤵ ดึงจาก Daily Report" รวม `defect_logs.qty_ng` ของ session ไลน์+วันนั้น group ตาม `prod_orders.mat_no` → เติมแถว main product (flag `src_defect_from_logs`) แล้วแก้/เพิ่มได้ · **พาร์ทย่อย** (nut/สกรู ที่เสียก่อนเข้ากระบวนการหลัก — ไม่มีใน production session) เพิ่มเองผ่านปุ่ม "เพิ่มจาก SAP/BOM" (ดึง `dr_products` main + `bom_items` sub + **`parts_master` sub (2026-08-06)** — พาร์ทซื้อนอก 300/วัตถุดิบ 500 ที่ยังไม่ถูกผูกใน BOM ใดเลย (~257 รายการ) เดิมไม่ขึ้นให้เลือกต้องกรอกมือ · dedupe ด้วย mat_no ลำดับ dr_products > bom_items > parts_master) หรือกรอกมือ
- **⚠️ กับดัก: `dr_products.p_no` บางไลน์ถูกกรอกเป็น "หมายเลขเครื่อง" ไม่ใช่เลขพาร์ท (2026-08-05)** — เจอจริง **SUB APRON** 4 แถว p_no = `SP-72/74/83/88` (ตรงกับ `machines.machine_no` เป๊ะ) + `mat_no` เป็นข้อความ ("M10 ไม่มีเกลียว") ไม่ใช่เลข SAP → ใบ Scrap พิมพ์ PART NO. เป็นหมายเลขเครื่อง · **เป็นปัญหา data ไม่ใช่ logic — ต้องไปแก้ที่ `/products`** · โค้ดไม่ปล่อยเงียบ: SAP/BOM picker โหลด `machines.machine_no` มาเทียบ เจอ p_no ตรงหมายเลขเครื่อง → **ไม่เอามาเป็น part_no (ปล่อยว่างให้กรอกเอง) + ป้าย ⚠ ในลิสต์ + toast เตือนตอนเลือก** (flag `badMaster`) · หน้าอื่นที่ใช้ `p_no` เป็นเลขพาร์ทลูกค้า (Planner&Sales map EDI, Production Plan `resolveMat`) เจอปัญหาเดียวกันได้ — master ผิดกระทบทุกที่ที่ map ด้วย p_no
- **export Excel (`src/lib/scrapExportExcel.js`):** ExcelJS วาดตรง layout FM-PD2-002 Rev.06 (หัวบริษัท, ตาราง A-S: ลำดับ/PART NO/NAME/MAT SAP/รูป/MODEL/CODE/BOM/Q'TY/M1-M5/ยืนยัน/รหัสงานเสีย, TOTAL, CODE legend A-E, สายอนุมัติ 5 ขั้น, ผู้ส่ง/รับ HRM) · **⚠️ ช่อง M1-M5 = เครื่องหมายติ๊ก `✓` ว่าเสียเพราะสาเหตุไหน ไม่ใช่จำนวน** (จำนวนอยู่คอลัมน์ Q'TY/ยืนยันแล้ว — เดิมใส่ `qty` ทำให้ดูเหมือนยอดของเสียซ้ำสองที่ · แถว TOTAL ของ M1-M5 = **จำนวนรายการ**ที่ติ๊กสาเหตุนั้น · แก้ 2026-08-05) · ตรึง 27 แถวเหมือนกระดาษ
- **พิมพ์/บันทึก PDF (`src/lib/scrapPrint.js` · 2026-08-05):** ปุ่ม 🖨️ PDF ข้างปุ่ม Excel ในลิสต์ใบ — window.open + print (pattern เดียวกับ LPA/OJT/MO) วาด HTML layout เดียวกับ Excel (A4 portrait) · **เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้ อ่านจากทะเบียนเอกสารเดียวกัน** (`getDocForm('scrap_report')` + `urlToDataUrl(df.logo_url || tsLogoUrl)` + `fullCode` มุมล่างขวา) — แก้ที่ `/doc-forms` มีผลทั้ง Excel และ PDF · เซฟ PDF จาก dialog พิมพ์เบราว์เซอร์ · popup ถูกบล็อก = toast บอก · **เลขฟอร์ม/Rev/ป้ายช่องลายเซ็น 5 ช่อง อ่านจากทะเบียนเอกสาร `getDocForm('scrap_report', {fallback})` — register แล้ว (`20260724_doc_form_scrap_report.sql`) แก้ที่ /doc-forms ได้ · fullCode พิมพ์มุมล่างขวา (2026-07-24)** · CODE legend A-E เป็น form body ไม่อยู่ใน registry
- **สิทธิ์:** ดู = `page:/scrap-report` (admin/mgr/sv/leader/qa/doc_control) · `scrap:record` (สร้าง/แก้) = admin/mgr/sv/leader/qa · `scrap:manage` (อนุมัติ/ลบ) = admin/mgr/qa
- เลขเอกสาร running รายวัน `TSAT4-PDX NNNN/เดือน-ปี` (นับใบในเดือน)

---

---

## 📌 ค้างไว้ให้ session หน้า — "ตัด scrap report" + ชั้น OP น่าจะเป็นปัญหาเดียวกัน (2026-09-15 · user สั่ง)

user แจ้งว่าจะให้อีก session แก้ **เรื่องตัดของเสียในใบ scrap report** พร้อมกับ **เรื่องชั้น OP**
เพราะ *"เหมือนจะปัญหาเดียวกัน"* — **ห้ามลงมือเองจนกว่า user จะสั่ง** · อาการฝั่ง scrap ยังไม่ได้ระบุละเอียด

**เบาะแสที่ควรอ่านก่อนเริ่ม — เหตุการณ์จริงวันเดียวกัน (เต็ม ๆ อยู่ใน `docs/modules/oee.md` §ชั้น Operation บล็อก 🔴🔴🔴 2026-09-15):**
วันนั้นลองย้ายใบผลิต LASER-345 ไปอยู่บนเลขชั้น OP แล้ว **ยอดของ HDF1 + LASER-345 หายจากจอสรุปทันที** ต้องโรลแบคทั้งหมด
ต้นเหตุคือ `collapseOps` (`src/utils/pairTotals.js`): `if (present.has(parent)) return;`
⇒ **แถว OP ที่ parent มีใบผลิตอยู่ในชุดข้อมูลเดียวกัน จะถูกตัดทิ้งทั้งแถว** ไม่ใช่แค่ไม่บวกซ้ำ

**สมมติฐานที่ควรตรวจ (ยังไม่ได้พิสูจน์):** ใบ scrap ดึงของเสียจาก `defect_logs` แล้ว group ด้วย `prod_orders.mat_no`
⇒ ถ้าของเสียเกิดบนใบของ **ชั้น OP** ยอดจะไปเกาะเลข OP ไม่ใช่พาร์ทจริง · ควรไล่ดูว่า
(1) ปุ่ม "⤵ ดึงจาก Daily Report" ยุบชั้น OP หรือไม่ (ตอนนี้**ไม่ได้ส่ง opMap เข้าไป**)
(2) ของเสียของขั้นตอนควรนับเป็นของเสียของพาร์ทจริง หรือแยกรายขั้น — **เป็น product decision ต้องถาม user ก่อน**
(3) `mat_no` ที่ลงในใบเป็นเลข OP จะพิมพ์ออกฟอร์มเป็นเลขที่ไม่มีใน SAP (กับดักเดียวกับหัวข้อ `p_no` เป็นหมายเลขเครื่องด้านบน)

**กฎที่ตกผลึกแล้วและใช้กับงานนี้ด้วย:** ก่อนเปลี่ยน `is_operation` / `op_parent_mat` ของ mat ที่มีใบผลิตเดินอยู่จริง
ต้องเช็คก่อนเสมอว่า **พาร์ทจริงตัวนั้นมีใบผลิตในชุดข้อมูลเดียวกันไหม** — มี = สถานีนั้นจะหายจากจอสรุป
· snapshot 4 ตาราง `*_bak_laser345_20260915` (DR) ยังอยู่ ใช้ทำรอบใหม่ได้ทันที ห้ามลบจนกว่าจะปิดเรื่องนี้
