# HANDOFF — PM Inspection Setup Gaps (เทียบฟอร์มจริง)

> ไฟล์นี้ถูกกู้คืนจาก session ก่อน (ต้นฉบับไม่ถูก push) และอัปเดตสถานะ ณ 2026-07-09
> เนื้อหา = ช่องว่างของระบบ PM Setup/CheckData เทียบกับฟอร์มตรวจ JIG จริง (Locate Pin / Support Datum / Air Clamp)

## ⚠️ กฎเหล็กฝั่ง DR project

- Schema จริงอยู่บน **DR/Product project `eyhclzkifitbhbljgoav`** ผ่าน client `supabaseDR` ที่วิ่งด้วย role **anon เสมอ** (ไม่มี JWT)
- ตาราง/คอลัมน์ใหม่ทุกตัวต้องตั้ง RLS แบบ **anon-friendly** — **ห้าม `TO authenticated` เด็ดขาด** (เคยพังทั้ง PM/Product/Machine มาแล้ว — ดู CLAUDE.md)
- pattern: `create policy xxx on public.yyy for all to anon, authenticated using (true) with check (true);`
- **Migration files เก่าล้าสมัย** — `20260701_add_pm_maintenance_module.sql` ใช้ชื่อ `pm_equipment/pm_checklists/pm_checkpoints` แต่ DB จริงคือ `jigs / checklists / jig_checkpoints / inspections / inspection_results` → ก่อนแก้ schema ให้ verify กับ live DB เสมอ (`mcp__Supabase__list_tables` / `execute_sql`)
- วันที่/เวลา ใช้ helper local time (`getWorkDate`) ห้าม `new Date().toISOString()` สำหรับ work date

## Live schema (verify แล้ว 2026-07-09)

- `jig_checkpoints`: id, jig_id, checklist_id, name, type(variable/attribute/note), axis, category, checking_method, unit, nominal, lsl, usl, lcl, ucl, x_pos, y_pos, sort_order **+ ใหม่: group_name, group_order, description, image_path**
- `inspection_results`: value_1/2/3, avg_value, value_attribute, status, action_text, recheck_value_1/2/3, recheck_avg, final_status, recheck_by/at (ยังไม่มี remark — TASK 5)

## สถานะงาน

### ✅ TASK 1 — Grouping / Section + เลขหัวข้อ (เสร็จ 2026-07-09)
- Schema: `group_name text, group_order int` บน jig_checkpoints (migration `20260709_jig_checkpoints_group_desc_image.sql` — apply แล้ว)
- PMSetup: ช่อง "กลุ่ม/หัวข้อ (Item)" ต่อการ์ด (มี datalist ชื่อกลุ่มที่ใช้แล้ว), การ์ดจัดกลุ่มใต้ header `Item N — ชื่อกลุ่ม`, label การ์ด/pin เป็น `N.sub` (เช่น 1.3), save เรียง sort_order ตามกลุ่ม
- PMCheckData: หน้า record แสดง header กลุ่มคั่น
- Export Excel/PDF: จัดกลุ่มตาม group_name เมื่อมี (fallback category แบบเดิม), กลุ่มผสม variable+attribute ได้ (แยกสองตาราง)

### ✅ TASK 2 — Attribute เกณฑ์ข้อความหลายบรรทัด (เสร็จ 2026-07-09)
- Schema: `description text`
- PMSetup: textarea "เกณฑ์ตัดสิน (Standard)" เมื่อ type = attribute/note
- PMCheckData: แสดงเกณฑ์ใต้ชื่อจุด (record + history)
- Export: คอลัมน์ Standard ของ attribute ใช้ description (fallback ชื่อจุด)

### ✅ TASK 3 — รูปอ้างอิงต่อ checkpoint (เสร็จ 2026-07-09)
- Schema: `image_path text` (bucket `jig-images` path `jigs/{jigId}/cp-{key}.{ext}`)
- PMSetup: ปุ่มแนบรูปต่อการ์ด (imageCompression 0.2MB/900px, อัพโหลดตอน save)
- PMCheckData: thumbnail ต่อแถว คลิกเปิดเต็มจอ
- Export: Excel ฝังรูปในช่อง Picture (แถวสูง 42), PDF วาดรูปในคอลัมน์ Picture

### ✅ TASK 4 — Multi-axis ลดการกรอกซ้ำ (เสร็จ 2026-07-09 — แนวทางง่าย)
- ปุ่ม "⧉ อีกแกน" ต่อการ์ด variable: copy ชื่อ/tool/กลุ่ม/ตำแหน่ง pin สลับแกน X↔Y ให้กรอกแค่ spec
- แนวทางผูกเป็น point เดียว sub-rows X/Y ยังเป็นคำถามเปิด (ดูด้านล่าง)

### 🟡 TASK 5 — Remark ต่อ checkpoint ตอนบันทึกผล (ยังไม่ทำ)
- `alter table inspection_results add column remark text;` + ช่องใน VariableRow/AttrRow + คอลัมน์ Remark ใน export

### 🟡 TASK 6 — Revision table ใน header (ยังไม่ทำ)
- ตาราง `checklist_revisions(checklist_id, rev, description, date)` (anon RLS) + แสดงใน header export

## ไฟล์ที่เกี่ยวข้อง

- `src/pages/PMSetup.jsx` — setup UI (groupCheckpoints helper, CheckpointCard, EquipmentModal)
- `src/pages/PMCheckData.jsx` — execution/history (group header, CpImage, description)
- `src/lib/pmExportExcel.js`, `src/lib/pmExportPDF.js` — export (named-group + picture + description)
- `src/lib/pmTaxonomy.js`, `src/lib/pmChecklists.js`, `src/lib/spc.js`
- `supabase/migrations/20260709_jig_checkpoints_group_desc_image.sql`

## Out of scope / คำถามเปิด

- **ระบบ 2 (QA First-Middle-End = ตรวจคุณภาพชิ้นงานต่อ order)** เป็นคนละเรื่อง — ดู `docs/INSPECTION_ALARM_SYSTEMS.md`
  ฝั่ง QA มีโครงรองรับแล้ว: หน้า `/qa-setup` (qa_parts + qa_inspection_items ตามฟอร์ม FM-QA-112, stage รวม setup_first/inprocess/final) บน MAIN project — จะผูก F-M-E execution ต่อจากตรงนั้น
- ต้องยืนยันกับเจ้าของงาน: "จุดเดียวหลายแกน" อยากได้แบบผูกเป็น point เดียว (sub-rows X/Y) หรือปุ่ม duplicate ที่ทำไปแล้วเพียงพอ
