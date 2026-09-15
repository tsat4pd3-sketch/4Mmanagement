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

## 📌 ค้างไว้ให้ session หน้า — ของเสียที่ "ชั้น OP" ต้องตัด component ไม่ใช่ตัดตัวเอง (2026-09-15 · โจทย์จาก user)

**user อธิบายปัญหาหน้างานตรงๆ (ห้ามลงมือเองจนกว่า user จะสั่ง — เขาจะมอบให้อีก session ทำ):**
> *"พนักงานงงงานที่เป็น OP เพราะไม่มี mat SAP · และเวลาออก scrap report มันจะตัดตัวมันเอง ซึ่งไม่ถูก
>  เพราะมันจะต้องไปตัด BOM ของมัน ตัวมันเองยังไม่เสร็จสมบูรณ์ ของที่เสียก็จะเป็น component ต่างๆ
>  ซึ่งเหมือนตอนนี้ในการตั้ง OP ไม่มีให้เซ็ท component ด้วย"*

**ข้อเท็จจริงที่ตรวจจากโค้ดแล้ว (15/09 — ใช้เป็นฐาน ไม่ต้องไล่ซ้ำ):**
- กล่องตั้งค่า 🔩 OP ใน `/products` (`ProductMaster.jsx` ~1151) มีแค่ **3 ช่อง**: ติ๊ก `is_operation` ·
  `op_parent_mat` (พาร์ทจริงปลายทาง) · `op_seq` — **ไม่มีที่ให้ตั้ง component ที่ขั้นนั้นกินจริง**
- BOM (`bom_items`) ผูกกับ `product_id` และกฎปัจจุบันคือ **"ห้ามเอารายการ OP เข้า BOM"** ⇒ OP จึงไม่มีสูตรของตัวเอง
- ปุ่ม "⤵ ดึงจาก Daily Report" รวม `defect_logs.qty_ng` group ด้วย **`prod_orders.mat_no`** ⇒ ใบของขั้น OP
  ได้แถว scrap เป็น **เลข OP ของตัวเอง** = อาการ "ตัดตัวเอง" ที่ user พูดถึง · และเลขนั้นไม่มีใน SAP ⇒ พนักงานงง
- **`ScrapReport.jsx` ไม่ได้เขียน `line_stock_transactions` เอง** — ใบ scrap วันนี้เป็น "บันทึก+ฟอร์มพิมพ์"
  การตัดสต็อกจริงเกิดที่ขาอื่น (`fn_post_confirmed_output` / `fn_explode_child_demand`) ซึ่ง**ข้ามรายการ OP อยู่แล้ว**
  (`if v_is_op then return null`) ⇒ **ต้องถาม user ให้ชัดว่า "ตัด" ที่ต้องการ = แถวบนใบ scrap หรือ ตัดสต็อกจริงด้วย**

**สิ่งที่ต้องออกแบบ (ยังไม่เคาะ):**
1. **ให้ชั้น OP ตั้ง component ได้** — ขั้นนั้นกินอะไรบ้าง/กี่ชิ้นต่อ 1 หน่วย · ทางเลือก:
   (ก) ให้ OP มีสูตรของตัวเองใน `bom_items` (มี `product_id` อยู่แล้ว ทำได้ทางเทคนิค) แต่ต้องกันไม่ให้ OP หลุดไปโผล่
       ใน BOM ของ FG / kanban / parts_master ตามกฎเดิม  (ข) ตารางใหม่แยก `op_components`
       (ค) ใช้ `part_routings` (มีโครงแล้ว ยังไม่ถูกใช้) ผูก component ต่อ step
2. **ของเสียที่ขั้น OP ระเบิดเป็น component ยังไง** — ตัดทุกตัวที่ขั้นนั้นกิน หรือให้คนเลือกว่าชิ้นไหนเสียจริง
   (เช่น นัทเบี้ยว = เสียเฉพาะนัท+blank ไม่ใช่ทั้งชุด) — **เป็น product decision ต้องถาม user**
3. **ใบ scrap ควรพิมพ์เลข MAT ของ component (มีใน SAP) แทนเลข OP** — แก้เรื่อง "ไม่มี mat SAP" ไปพร้อมกัน

**⚠️ ข้อควรระวังจากเหตุการณ์วันเดียวกัน (เต็ม ๆ ใน `docs/modules/oee.md` §ชั้น Operation บล็อก 🔴🔴🔴 2026-09-15):**
วันนั้นลองย้ายใบผลิต LASER-345 ไปอยู่บนเลขชั้น OP แล้ว **ยอด HDF1 + LASER-345 หายจากจอสรุปทันที** ต้องโรลแบคทั้งหมด
ต้นเหตุ `collapseOps` (`src/utils/pairTotals.js`): `if (present.has(parent)) return;` ⇒ **แถว OP ที่ parent มีใบผลิต
ในชุดข้อมูลเดียวกัน ถูกตัดทิ้งทั้งแถว** ไม่ใช่แค่ไม่บวกซ้ำ · **กฎ: ก่อนเปลี่ยน `is_operation`/`op_parent_mat`
ของ mat ที่มีใบผลิตเดินอยู่จริง ต้องเช็คก่อนเสมอว่าพาร์ทจริงตัวนั้นมีใบผลิตในชุดเดียวกันไหม**
· snapshot 4 ตาราง `*_bak_laser345_20260915` (DR) ยังอยู่ ห้ามลบจนกว่าจะปิดเรื่องนี้
