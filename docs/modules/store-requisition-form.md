# 📦 ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01 (paperless · 2026-08-24)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


แท็บ **📦 ใบเบิกทดสอบ** ใน `/qa` (`src/components/MaterialRequests.jsx`) — user ส่งใบกระดาษมา
*"QA ต้องคอยเขียนเบิกชิ้นงานขอจากฝ่ายผลิต และผลิตมาออกใบ scrap report"*

**สายงานที่ปิดได้:** QA ออกใบเบิก → หัวหน้าอนุมัติ → สโตร์จ่ายของ → ทดสอบแบบทำลาย →
**ดึงเข้าใบรายงานของเสียที่ `/scrap-report`** (ทางที่ 2 ของการดึง)

| ตาราง (DR) | เก็บอะไร |
|---|---|
| `material_requests` | หัวใบ · `kind` (withdraw/return) · `move_code` (prefix SAP 311/261/201/907/202/908) · `doc_no` · plant/storage · `detail` · `line_name` · ลายเซ็น 5 ช่อง (ชื่อ+รูป+วันที่) · `status` |
| `material_request_items` | รายการ · `mat_no` · `description` · `qty` · `unit` · **`qty_issued`** (สโตร์กรอก) · `produced_date` · `batch_no` |

migration `20260824_material_request.sql` (DR) + `20260824_doc_form_material_request.sql` (Main) — **apply แล้วทั้งคู่ 2026-08-24**

> ### ⚠️ ทำไมอยู่ DR ไม่ใช่ Main (ทั้งที่ QA module อยู่ Main)
> 1. ปลายทางคือ `scrap_report_items` (DR) — **อยู่ project เดียวกันถึงผูก FK ได้จริง** (ข้าม project ต้องเทียบข้อความ ซึ่งขาดง่าย)
> 2. ตัวเลือกรหัสสินค้ามาจาก **`parts_master` (DR) = ทะเบียนกลางของทุก mat** ตามกฎ CLAUDE.md
> 3. precedent ตรงตัว: **`scrap_reports` ก็เป็นฟอร์มอนุมัติหลายขั้นของ QA และอยู่ DR อยู่แล้ว**
>
> → DR เป็น anon ไม่มี RLS จริง **สิทธิ์คุมที่ UI ด้วยคีย์เดิม `scrap:record` / `scrap:manage`**
> **ไม่เพิ่ม permission key ใหม่** (เลี่ยงกับดัก seed `enum_range` ที่ทำให้ role ใหม่ fail-closed)
> — `scrap:record` = admin/mgr/sv/leader/**qa** ซึ่งครอบคนที่ต้องใช้พอดีอยู่แล้ว

- **⚠️ ดึงเข้าใบ scrap ได้เฉพาะสถานะ `approved` / `issued` (`PULLABLE` ใน `src/utils/materialRequest.js`)**
  — ใบที่ยังไม่อนุมัติแปลว่า**ยังไม่ได้ของ** จะรายงานว่าทำลายไปแล้วไม่ได้ · **เกณฑ์อยู่ที่ util ห้ามเขียนซ้ำในหน้า**
- **⚠️ จำนวนที่ดึงยึด `qty_issued` (จ่ายจริง) ก่อนเสมอ ไม่มีค่อยใช้ `qty` (ที่ขอ)** — helper `effQty()`
  · สโตร์จ่ายไม่ครบเป็นเรื่องปกติ ใช้ยอดที่ขอจะรายงานของเสียเกินจริง
- **ดึงซ้ำไม่เพิ่มของซ้ำ** — เทียบ `src_request_item_id` ที่มีอยู่ในใบแล้ว
- ตัวเลือก move_code / สถานะ / `effQty` / `nextReqNo` อยู่ **`src/utils/materialRequest.js` (pure)** จุดเดียว
  · ใบพิมพ์ `src/lib/materialRequestPrint.js` (A4 แนวตั้ง · `layout_locked=true` · doc_key **`material_request`**
  · seed เลขฟอร์ม/Rev/Effective จากใบจริงได้เลย เพราะพิมพ์อยู่บนกระดาษ)
- **เปลี่ยนประเภท เบิก↔คืน แล้วต้องล้าง `move_code` ที่ไม่มีในชุดใหม่** (§5.3 cascade) — ทำแล้วใน `changeKind`
- ฟอร์มยัง**ใช้ได้ทั่วไปทุกหน่วยงาน** (ใบกระดาษเป็นฟอร์มสโตร์กลาง) แค่ทางเข้าอยู่ที่ QA และ default
  `requester_dept = 'QUALITY'` — แก้ได้
- **ยังไม่ทำ:** ยังไม่ตัดสต็อกจริง (`line_stock_transactions`) ตอนสโตร์จ่ายของ — ใบนี้เป็น "เอกสารขอ"
  ยอดจริงยังเดินทาง SAP เหมือนเดิม · ยังไม่มี KPI ว่าเบิกไปทดสอบเดือนละเท่าไหร่
