# 📋 รายการจุดที่ "บัญชีกลาง" ยังลบ/แก้ได้ — ให้ user ไล่ติ๊กว่าจะปิดอันไหน (2026-10-13)

> **สถานะ:** ยังไม่แตะ รอ user ตัดสินทีละรายการ (คำสั่ง *"ยังไม่ทำ — ขอดูรายการก่อน"*)
> **สิ่งที่ตัดสินไปแล้ว:** *"ช่างทีม MTN จะใช้บัญชีกลางในการทำงาน — ที่แน่ๆ **ห้ามลบ** ไม่งั้นมั่ว
> ส่วนช่างผลิต ช่าง JIG เหมือนมี user ละ"*
> ⇒ **ลบ = ปิด** (ทำไปแล้วบางส่วน) · **ทำงานประจำวัน = เปิดไว้** · ที่เหลือรอชี้

วิธีอ่าน: `🔒` = ปิดแล้ว · `⬜` = ยังเปิดอยู่ รอตัดสิน · ฝั่ง **DR = ไม่มีด่าน DB** (จอคือด่านเดียว)

---

## A. ที่ปิดไปแล้ว (บัญชีกลางกดไม่ได้แล้ว)

| 🔒 | จุด | ฝั่ง |
|---|---|---|
| 🔒 | ลบใบ MO (`mtn_orders`) | DR |
| 🔒 | ลบสินค้า/พาร์ท · kanban · BOM · บรรจุภัณฑ์ (`ProductMaster`) | DR |
| 🔒 | ปิดใช้งานเครื่องจักร · ชนิดเครื่อง · ผังจ่ายไฟ (`MachineDatabase`) | DR |
| 🔒 | ลบกะผลิต + ใบผลิต/downtime/ของเสียของกะ (`DailyReport`) | DR |
| 🔒 | ลบใบ LPA · คำถาม · แผนวันตรวจ | Main |
| 🔒 | ลบ CQI-15 event log · ลบงาน OJT + ผู้เข้าอบรม | Main |
| 🔒 | ลบไลน์/จุดงาน/ผังไลน์ (`LineSetup` — ใช้ `canDelete` อยู่แล้วแต่เดิม) | Main |
| 🔒 | ทุกคีย์ที่ลงท้าย `:delete` ฝั่ง Main (`line_setup` · `lpa` · `shift_schedule` · `skills`) ที่ชั้น DB | Main |

## B. ⬜ ลบได้อยู่ — **131 จุด / 64 ไฟล์** (DR 54 · Main 77)

### B1. ลบของที่เป็น "บันทึกงาน" (ลบแล้วหาย — ควรปิดก่อน)
| ⬜ | จุด | ตาราง | ฝั่ง |
|---|---|---|---|
| ⬜ | ลบผลตรวจ PM | `inspections` (`PMCheckData`) | DR |
| ⬜ | ลบใบรายงานของเสีย + รายการ | `scrap_reports` · `scrap_report_items` | DR |
| ⬜ | ลบใบเบิกสโตร์ + รายการ | `material_requests` · `material_request_items` | DR |
| ⬜ | ลบค่าแรงในใบ MO | `mtn_order_labor` | DR |
| ⬜ | ลบโปรเจค Kaizen + ไมล์สโตน | `improvements` · `improvement_milestones` | DR |
| ⬜ | ลบ forecast/ออเดอร์ลูกค้าทั้ง batch | `customer_forecasts` · `customer_shipping_orders` (`MonitoringUpload`) | DR |
| ⬜ | ลบรอบส่งคัมบัง | `kanban_deliveries` | DR |
| ⬜ | ลบค่าวัด QA | `qa_measurements` | Main |
| ⬜ | ลบบันทึก BBS | `bbs_observations` | Main |
| ⬜ | ลบการจองกะดึก/OT · คนช่วยไลน์ | `ot_night_bookings` · `line_helpers` | Main |
| ⬜ | ลบ override/merge กะ | `shift_overrides` · `shift_merge_events` | Main |
| ⬜ | ลบคะแนนทักษะ/นิยามทักษะ | `employee_skills` · `skill_definitions` (`operator`) | Main |

### B2. ลบ "ทะเบียน/ตั้งค่า" (ลบแล้วกระทบทั้งระบบ)
| ⬜ | จุด | ตาราง | ฝั่ง |
|---|---|---|---|
| ⬜ | ทะเบียนช่าง/ค่าแรง/ลักษณะปัญหา/ชนิดอุปกรณ์ (soft) | master ของ `MtnRepair` | DR |
| ⬜ | ประเภท downtime/งานเสีย · นโยบายพัก · กระบวนการ | `dr_downtime_types` · `dr_defect_types` · `break_policies` · `process_types` | DR |
| ⬜ | จิ๊ก + จุดตรวจ + รูป · checklist PM | `jigs` · `jig_checkpoints` · `checklists` | DR |
| ⬜ | ผังเครื่อง/พื้นที่ · ผังชั้นวาง · รหัสคลัง | `pm_facility_*` · `mtn_rack_cells` · `storage_locations` | DR |
| ⬜ | ผังขนส่ง (ลบได้ทั้งชุด) | `transport_nodes` · `transport_edges` | DR |
| ⬜ | ผังองค์กร · การมอบหมายหน่วยงาน | `org_nodes` · `org_assignments` | Main |
| ⬜ | ทะเบียนเอกสาร (เลขฟอร์ม/Rev) | `doc_form_scopes` · `doc_form_revisions` | Main |
| ⬜ | แม่แบบ APQP/PPAP กลาง · คลัง PFMEA กลาง | `npi_template_*` · `pe_master_items` | Main |
| ⬜ | ห้องแจ้งเตือน Telegram | `telegram_channels` | Main |
| ⬜ | เป้า OEE | `oee_targets` | Main |
| ⬜ | ช่องกำลังคน/ช่างประจำไลน์ | `manpower_slot_plans` · `line_technicians` | Main |
| ⬜ | อุปกรณ์ Poka-Yoke · รอบจอ TV · เรทศูนย์ต้นทุน | `pokayoke_devices` · `display_rotations` · `cost_center_rates` | Main |

### B3. ⬜ "ลบ" ที่เป็น soft-delete — **26 จุด** (ด่าน DB แบบ `%:delete` มองไม่เห็นเลย)
`machines` · `dr_products` (3 จุด) · `bom_items` · `product_packaging` · `container_types` ·
`mtn_spare_parts` · `mtn_rack_maps` · `die_storage_areas` · `fixture_points` · `part_routings` ·
`quality_bin_records` · `kanban_delivery_rounds` · `pm_daily_line_targets` · `shipping_workflow_steps` ·
`prod_orders → cancelled` · `stock_receipts → cancelled` · `rack_requests → cancelled` ·
`employees → is_active:false` · `kpi_definitions` · `kpi_month_notes` · `safety_events` ·
`bbs_agreements` · `wip_replenish_requests` · `qa_fme_obligations`

> 🔴 ถ้าจะ "ห้ามลบ" ให้ครบจริง **ต้องปิด B3 ด้วย** — ไม่งั้นปุ่มเขียนว่า "ลบ" ก็ยังกดได้ แค่เปลี่ยนวิธีลบ

## C. ⬜ เซ็น / อนุมัติ / ปิดใบ — ลายเซ็นบัญชีกลาง = สอบกลับไม่ได้ว่าใครเซ็น

| ⬜ | จุด | ฝั่ง | หมายเหตุ |
|---|---|---|---|
| ⬜ | ใบ MO ขั้น 5-8 + ช่องเซ็นรูป (ตรวจรับ · QA · หัวหน้าแผนก · ปิดใบ) | DR | **ขั้น 2-3 (รับงาน/ลงผลซ่อม) = งานประจำของช่าง MTN — ไม่ควรปิด** |
| ⬜ | อนุมัติ 4M (SV → QA) | Main | |
| ⬜ | ปิดกะ / อนุมัติปิดกะ | DR | ปิดกะเป็นงานประจำของหัวหน้ากะ — เช็คก่อน |
| ⬜ | QA ตัดสินของสงสัย (ชี้ %Q) | DR | บัญชี qa 14 ตัวที่ติด `shared` ส่วนใหญ่น่าจะเป็นคนจริง |
| ⬜ | ใบรายงานของเสีย 3 ช่องอนุมัติ (QA/PD/GM) | DR | |
| ⬜ | ใบเบิกสโตร์ `approved_by_name` | DR | |
| ⬜ | ลายเซ็นผู้ตรวจ LPA (ดึงจาก `profiles.signature_url` ของบัญชีกลาง) | Main | |
| ⬜ | อนุมัติ NPI/PE/VSM/shim/CT/line_stock/level-up | Main+DR | |

## D. สิ่งที่ "ห้ามปิด" (งานประจำของบัญชีกลางที่ยังต้องใช้)

ตามที่ user ยืนยัน — **ช่างทีม MTN ใช้บัญชีกลางทำงานจริง**
- เปิดใบ MO · รับงาน/จ่ายงาน (ขั้น 2) · ลงผลซ่อม + รูป (ขั้น 3) · เบิกอะไหล่ · ลงค่าแรง
- PM daily check · ลงบันทึกผลิต/downtime/ของเสีย · สแกนคัมบัง · ยืนยันรอบส่ง (คลัง/ส่งของ)
- อัปโหลด forecast/order (planningstore)

📌 **ประเด็นที่ user ชี้เพิ่ม:** ช่างผลิต + ช่าง JIG **มี user ของตัวเองแล้ว**
⇒ `jigmaintenance` / `toolingmaintenance` อาจปิดได้มากกว่า `maintenance` — **รอ user ยืนยันทีละตัว**

## E. ก่อนปิดเพิ่ม ต้องล้างทะเบียนก่อน

บัญชีที่ตั้ง `account_kind='shared'` แต่เป็น **ชื่อคนจริง**: `qa` 14 บัญชี · `ขวัญพร` (supervisor) ·
`ชัยยุทธ` (manager) ⇒ แก้ประเภทบัญชีเป็น **"บัญชีของคน"** ที่ `/add-user` ก่อน
🔴 **ห้ามให้ AI session แก้ `account_kind` เอง** — มันคือตัวตนของบัญชี คนต้องยืนยัน

---

📄 ตัวเลขรวม + ทางเลือกกลไกบังคับ (ห่อ client / `canWrite()` / restrictive policy) →
`docs/modules/shared-account-audit.md`
