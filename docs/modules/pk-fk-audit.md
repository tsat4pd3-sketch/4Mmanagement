# 🔑 Audit PK / FK ทั้ง 2 โปรเจค — "ทะเบียนหลักผูกกันด้วย FK หรือด้วยข้อความ" (2026-10-28)

> คำสั่ง user: *"Audit sql ทั้ง 2 ตัวในโปรเจค เรื่อง PK กับ FK — สงสัยว่าหลายตารางไม่ยอมใช้ FK ลิงก์กัน
> ไม่ว่าจะฐานข้อมูลพนักงาน เครื่องจักร ไลน์ผลิต ชิ้นงาน ทุกเรื่องที่ต้องลงข้อมูลเป็นฐานข้อมูลหลัก"*
>
> **สถานะ: ตรวจแล้ว · ยังไม่แก้** — ไฟล์นี้คือผลตรวจ + ลำดับแก้ที่เสนอ · การแก้แต่ละข้อเป็นคนละงาน ต้องมี migration
> ของตัวเอง (additive · ย้อนได้) และต้องถาม user ก่อนทุกข้อที่แตะ schema
>
> ตรวจสดจาก `pg_catalog` + นับแถวจริง (ไม่ใช่ `reltuples`) · SQL ที่ใช้อยู่ท้ายไฟล์ รันซ้ำได้ทั้ง 2 ฝั่ง

---

## 0. สรุปครึ่งหน้า

**ข้อสงสัยของ user ถูกต้อง แต่ไม่ใช่ทุกตารางที่ "ไม่ยอม" — มีสาเหตุ 3 ชั้นที่ต้องแยกกัน:**

| ชั้น | อาการ | แก้ด้วย FK ได้ไหม |
|---|---|---|
| **A. ข้าม project** — ทะเบียนไลน์/พนักงาน/ผังองค์กรอยู่ **Main** แต่ทรานแซคชันผลิตทั้งหมดอยู่ **DR** | DR **ไม่มีตาราง** `production_lines` · `employees` · `org_nodes` · `workstations` เลย ⇒ 29 คอลัมน์ `line_name` + 105 คอลัมน์ `*_by_name` ฝั่ง DR **เป็น text snapshot โดยจำเป็น** | ❌ Postgres ทำ FK ข้ามฐานไม่ได้ · ทางเดียวคือ **สำเนาทะเบียน (replica table) ฝั่ง DR** แล้วค่อยผูก FK กับสำเนา |
| **B. อยู่ project เดียวกัน แต่เลือกจับคู่ด้วย text** — `machine_no` · `mat_no` · `customer` · `supplier` · `section`/`department` · `skill_name` · `cost_center` | 10 คอลัมน์ `machine_no` / 32 คอลัมน์ `mat_no` ฝั่ง DR ไม่มี FK สักตัว ทั้งที่ `machines`/`dr_products` อยู่ฐานเดียวกัน | ✅ ทำได้ **แต่ต้องล้างข้อมูลกำพร้าก่อน** (ตัวเลขใน §2) และบางตัวตั้งใจไม่ผูก (§4) |
| **C. มีคอลัมน์ `*_id` เป็น uuid อยู่แล้ว แต่ไม่ประกาศ FK** | Main 7 คอลัมน์ · DR 28 คอลัมน์ · **ลบแม่แล้วลูกค้าง** เกิดจริงแล้ว 4 จุด (§3) | ✅ **ถูกที่สุด** — เพิ่ม constraint ได้เลยหลังล้างแถวกำพร้า |

**และมีคลาสที่ 4 ที่เจ็บกว่า "ไม่มี FK":** คอลัมน์ FK **มีอยู่แล้วแต่หน้าไม่เขียนลง** —
`four_m_logs.line_id` ว่าง 1,417/1,931 (73% · ใบล่าสุดวันนี้ก็ยังว่าง) · `workstations.line_id` ว่าง 102/132 (77%) ·
`production_sessions.product_id` ว่าง **2,051/2,051 (100%)** · `kanban_standards.product_id` ว่าง 255/459 ·
`station_assignment_logs.station_id` ว่าง 3,308/10,990 — ระบบจึงยัง join ด้วยชื่ออยู่ดี แม้ schema เตรียม id ไว้แล้ว

---

## 1. ภาพรวมเชิงตัวเลข (นับสด 2026-10-28)

| | Main (`ewhdfqwfwofivojtsizn`) | DR (`eyhclzkifitbhbljgoav`) |
|---|---|---|
| ตารางใน `public` | 140 | 156 |
| ตารางที่ไม่มี PK | **0** ✅ | **0** ✅ |
| FK ทั้งหมด | 152 (82 ตารางมี FK) | 97 (65 ตารางมี FK) |
| FK ชี้เข้า `employees` / `production_lines` / `org_nodes` / `workstations` | 16 / 11 / 7 / 3 | — (ไม่มีตารางเหล่านี้) |
| FK ชี้เข้า `machines` / `dr_products` / `parts_master` | — | **3 / 5 / 0** |
| คอลัมน์ `line_name` (text) | 31 | 29 |
| คอลัมน์ `line_id` (uuid) | 9 | **0** |
| คอลัมน์ `machine_no` (text) | — | 10 (FK = 0) |
| คอลัมน์ `mat_no` (text) | — | 32 (FK = 2 · ชี้เข้า `lot_post_configs`/`dr_products.pair_mat_no` เท่านั้น) |
| คอลัมน์ `*_by_name` / `*_by_uid` | — | 105 / 122 |

**PK ไม่มีปัญหา** — ทุกตารางทั้ง 2 ฝั่งมี PK · ทะเบียนหลักที่เป็น natural key มี unique ครบ:
`employees.employee_id_code` ✅ · `production_lines.name` ✅ · `dr_products.mat_no` ✅ · `parts_master.mat_no` ✅ ·
`machines.machine_no` ✅ (partial: เฉพาะ `is_active` + ไม่ว่าง · migration `20260803_asset_identity_unique.sql`) ·
`jigs.jig_no` ✅ (partial) · `mtn_teams.key` ✅ · `process_types.key` (PK) ✅ · `customers.code`/`suppliers.code` (PK) ✅
· ❌ **`mtn_spare_parts.part_no` ไม่มี unique** (ว่าง 236/295 · ที่กรอกแล้วไม่ซ้ำ)

---

## 2. ชั้น B — ผูกด้วย text ทั้งที่อยู่ฐานเดียวกัน: ข้อมูลกำพร้าจริงเท่าไร

> "กำพร้า" = ค่าในคอลัมน์ลูกไม่มีในทะเบียนแม่ · `machine_no` เทียบหลัง normalize ด้วย `public.machine_key()` แล้ว

### 2.1 เครื่องจักร (`machines.machine_no` · DR)

| ตารางลูก | กำพร้า / ทั้งหมด | ค่าที่กำพร้ามากสุด | อ่านว่า |
|---|---|---|---|
| `downtime_logs.machine_no` | **1,519 / 12,071 (12.6%)** | `SP-78/NF56`×90 · `เลเซอร์03..10`×~450 · `JIG-005`×73 · `LWR`×39 | 2 คลาส: (ก) **คู่เครื่อง "SP-xx/NF-yy"** — คนกรอกเป็นคู่แต่ทะเบียนมีทีละตัว · (ข) **ชื่อไทย "เลเซอร์0N"** ที่ทะเบียนเขียน `LASER-0N` — รูปแบบที่ `machine_key()` ยุบไม่ได้ (เป็นทับศัพท์ · ห้ามเดาตามกฎ `machineNo.js`) · กำพร้าพุ่งเดือน 07 (1,010) แล้วลดเหลือ ~200/เดือน หลัง `MachineSelect` |
| `prod_orders.machine_no` | **650 / 2,908 (22%)** | `SP-74/NF64`×178 · `SP-10/NF86`×158 · `SP-83/NF87`×147 · `SP-82/NF95`×103 | **ทั้งหมดเป็นคู่ "SP/NF"** ⇒ ไลน์ปั๊มที่ 1 ใบใช้ 2 เครื่อง · schema มีช่องเดียว คนจึงพิมพ์ 2 เลขติดกัน — นี่คือ **ปัญหา model ไม่ใช่ปัญหาคนกรอก** |
| `mtn_orders.machine_no` | **302 / 1,243 (24%)** | ว่าง (`''`)×134 · `CONVEYOR`×23 · คู่ SP/NF ×~100 | `''` 134 ใบ = MO ที่ไม่ระบุเครื่อง (ของกลาง/งานทั่วไป) — ต้องเป็น `null` ไม่ใช่ `''` · `CONVEYOR` = ของกลางที่ยังไม่มีในทะเบียน (กฎ `stops_whole_line` 28/10 ต้องการให้มี) |
| `jigs.machine_no` | 3 / 249 | — | `jigs.machine_id` (FK) **ครบ 249/249** ⇒ `machine_no` ที่นี่เป็นสำเนาเก่า ใช้ id ได้เลย |
| `improvements` · `part_routings` | 1 / 9 · 1 / 1 | — | ตารางเล็ก |

### 2.2 ชิ้นงาน (`dr_products.mat_no` / `parts_master.mat_no` · DR)

| ตารางลูก | กำพร้า / ทั้งหมด | อ่านว่า |
|---|---|---|
| `prod_orders.mat_no` | 97 / 25,312 (0.4%) | ดีมาก — เพราะเปิดใบจากคัมบัง/picker |
| `downtime_logs.mat_no` | 147 / 7,975 (1.8%) | |
| `customer_forecasts.mat_no` | **818 / 3,326 (25% · 31 MAT)** | MAT ลูกค้าที่ยังไม่ลงทะเบียน (`10088209 N1WB-17G799-BPIA01` ฯลฯ) — forecast มาก่อนทะเบียน = ปกติของต้นน้ำ แต่จอต้องบอก |
| `kanban_standards.mat_no` | 244 / 459 เทียบ `dr_products` · **3 / 459 เทียบ `dr_products ∪ parts_master`** | ⇒ 241 แถวเป็น**ชิ้นส่วนลูก** ที่อยู่ `parts_master` ไม่ใช่ `dr_products` — **ทะเบียนชิ้นงานมี 2 ใบ** (§4.2) |
| `monitor_board_parts.mat_no` | 49 / 281 | เทียบทั้ง 2 ใบแล้วยังกำพร้า |
| `customer_shipping_orders.mat_no` | 5 / 2,918 | |
| `line_stock_transactions` · `stock_receipts` · `purchase_requests` · `line_part_levels` · `bom_items` · `quality_bin_records` | 9 / 28,298 · 0 · 0 · 0 · 0 · 0 | ✅ สะอาด — ทุกตัวเขียนผ่าน picker/สแกน |
| `dr_products.mat_no ∉ parts_master` / กลับกัน | 55 / 232 · 254 / 430 | 2 ทะเบียนซ้อนกันไม่สนิท (§4.2) |

### 2.3 ไลน์ผลิต (`production_lines.name` · Main เท่านั้น — ฝั่ง DR เทียบไม่ได้ เพราะไม่มีตารางแม่)

| ตารางลูก (Main) | กำพร้า / ทั้งหมด | หมายเหตุ |
|---|---|---|
| `four_m_logs` · `lpa_audits` · `lpa_plans` · `machine_points` · `line_layouts` · `pokayoke_devices` · `pe_doc_sets` · `station_assignment_logs` | **0** · 0 · 0 · 0 · 0 · 0 · 0 · 7/10,990 | ✅ **rename cascade ใน `LineSetup.jsx` ทำงาน** (~40 ตาราง 2 project) |
| `bbs_sheets.line_name` | 4 / 32 | `ASSEMBLY 1` · `TSRA-1` · `LINE ASSY TSRA` — ชื่อที่พิมพ์เอง ไม่ใช่จาก picker |
| `factory_line_regions.line_name` | 4 / 25 | `P703/U704` · `Utility Hydrofroming` · `Airbooster` · `UTLITY  STEEL` — บริเวณบนผังที่ไม่ใช่ไลน์ (ตั้งใจ) |
| `production_sessions.line_name` (DR) | เทียบไม่ได้ | มีชื่อไลน์ **39 ชื่อ** ขณะที่ `machines.line_name` มี 35 · ทะเบียนจริง 37 ⇒ มีชื่อนอกทะเบียนแน่ แต่พิสูจน์ได้ต้องดึง 2 ฝั่งมาเทียบในแอป |

### 2.4 พนักงาน · ผังองค์กร · อื่นๆ (Main)

| ตารางลูก | กำพร้า / ทั้งหมด | อ่านว่า |
|---|---|---|
| `employees.department` ∉ `org_nodes(department)` | **49 / 371** | `ASSY2`×13 · ว่าง×13 · `ฝ่ายผลิต`×10 · `APRON ASSY`×8 · `HDF`×3 — ที่ `org-hierarchy.md` บันทึกไว้แล้ว ยังไม่ได้เคลียร์ |
| `employees.section` ∉ `org_nodes(section)` | 7 / 373 | `JIG MTN`×7 (ใช้ชื่อทีมแทน section) |
| `profiles.section` ∉ `org_nodes(section)` | **15 / 123** | `JIG MTN`×11 · `Die MTN`×2 · `MTN`×2 — ⚠️ **คอลัมน์นี้คือ "บ้านจริง" ของชั้น ③ writeScope** ถ้าชื่อไม่อยู่ในผัง `canWriteUnit` จะ fail-closed |
| `employees.org_node_id` null | 4 / 378 | FK มีแล้ว (`restrict`) แค่ 4 คนยังไม่ผูก |
| `employee_skills.skill_name` ∉ `skill_definitions` | 96 / 3,134 | ค่าเป็น `skill_xxxxxxxxxx` = **skill ที่ถูกลบจากทะเบียนแล้วคะแนนยังค้าง** |
| `cost_center_rates.cost_center` ∉ `cost_centers.code` | **29 / 52** | เลข CC 10 หลัก (`2140661402`…) ที่ไม่มีในทะเบียน — อัตราค่าแรงของ CC ที่ไม่มีใครรู้จัก |
| `kpi_definitions.section` · `shift_schedules.dept_name` | 13/118 · 14/126 | |
| `ojt_training_attendees.emp_code` | 2 / 524 | `employee_id` (uuid, ไม่มี FK) กลับ **ครบ 524/524** ⇒ ผูก FK ได้ทันที |

---

## 3. ชั้น C — มี `*_id` uuid แล้วแต่ไม่มี FK: จุดที่ "ลบแม่แล้วลูกค้าง" เกิดแล้วจริง 🔴

| คอลัมน์ | กำพร้า / ทั้งหมด | เกิดเมื่อไหร่ | ผลที่คนเห็น |
|---|---|---|---|
| **Main** `daily_production_logs.assigned_line` → `workstations.id` (เก็บเป็น **text** ไม่ใช่ uuid) | **3,714 / 10,757 (35% · 126 จุดงานที่ถูกลบ)** | ทุกเดือน 05→10 | ประวัติเช็คชื่อ 1 ใน 3 ชี้ไปจุดงานที่ไม่มีแล้ว ⇒ `/workforce-insight` ตอบ "ยืนจุดไหน" ไม่ได้ · `assigned_line` เป็น text จึง**ใส่ FK ไม่ได้จนกว่าจะเปลี่ยนชนิดเป็น uuid** |
| **Main** `lpa_audit_answers.question_id` → `lpa_questions.id` | **2,444 / 20,715 (12%)** | 07→10 (พีค 08 = 1,500) | แก้/ลบคำถาม LPA แล้วคำตอบเก่าชี้ไปคำถามที่ไม่มี ⇒ ใบตรวจย้อนหลังเปิดแล้วข้อหาย |
| **Main** `employee_home_positions.station_id` → `workstations.id` | 40 / 152 | | ตำแหน่งบ้านของพนักงานชี้จุดงานที่ถูกลบ |
| **DR** `mtn_orders.source_downtime_id` → `downtime_logs.id` | **35 / 709** | 08→10 เพิ่มขึ้นทุกเดือน | MO ที่เปิดจาก downtime แล้ว downtime ถูกลบ ⇒ ลิงก์ "ดูต้นเรื่อง" ตาย · MTTR/linkage ขาด |
| **DR** `stock_receipts.prod_order_id` → `prod_orders.id` | 79 / 6,990 | | |
| **DR** `line_stock_transactions.ref_order_id` → `prod_orders.id` | 120 / 24,144 | | ledger ชี้ใบที่ไม่มี |
| **DR** `improvements.problem_type_id` → `mtn_problem_types.id` | 5 / 5 (100%) | | Kaizen ทุกใบชี้ประเภทปัญหาที่ไม่มีแล้ว |
| **DR** `product_packaging.product_id` → `dr_products.id` | 2 / 2 (100%) | | |
| **DR** `mtn_stock_txns.ref_order_id` | 1 / 523 | | |

**ที่ตรวจแล้วสะอาด (ใส่ FK ได้ทันทีโดยไม่ต้องล้าง):** `facility_supply_links.machine_id` · `pm_coordination_plans.machine_id`/`pm_plan_id` ·
`stock_receipts.ref_session_id` · `customer_shipping_orders.pull_batch_id` · `kanban_scans.session_id` · `production_plan_lots.prod_order_id` ·
`quality_bin_records.scrap_report_id` · `pm_plan_deferrals.plan_id` · `ojt_training_attendees.employee_id`

**ที่ใส่ FK ไม่ได้เพราะข้าม project (ตั้งใจ · ต้องคง text/uuid ลอย):** `event_comments.author_id` · `inspections.inspector_id` ·
`fixture_shim_events.four_m_log_id`/`qa_ncr_id` · `production_plan_lots.npi_part_id` · `notifications.ref_id` (polymorphic)

---

## 4. ที่ "ไม่ผูก FK" โดยตั้งใจ — มีเหตุผลบันทึกไว้แล้ว อย่าไปแก้โดยไม่อ่าน

| เรื่อง | เหตุผลที่บันทึก | ที่มา |
|---|---|---|
| `customers` / `suppliers` / `die_press_lines` · `cost_centers` · `process_types.key` · `mtn_teams.key` — ปลายทางเก็บ name/code text | seed จากค่าที่มีอยู่จริง · ต้องรองรับ alias/สะกดหลายแบบ · ตั้งใจให้ "ลบทะเบียน" ต้องผ่าน `masterRefs.js`/`processTypeRefs.js` นับปลายทางก่อน (fail-closed) | CLAUDE.md §Database Schema · `db-schema.md` แถว customers · `process-types.md` |
| `*_by_name` snapshot 105 คอลัมน์ฝั่ง DR | profiles อยู่คนละ project · ชื่อตอนเซ็นต้องนิ่งแม้คนย้ายแผนก/ลาออก (เอกสาร = บันทึก) | `db-schema.md` แถว event_comments · กฎ "ฟอร์มที่ยื่นแล้ว = บันทึก" |
| `four_m_logs.line_name` · ชื่อไลน์ในใบที่พิมพ์ออกแล้ว | ใบที่ออกเลขแล้วต้องพิมพ์ซ้ำได้เหมือนเดิม | CLAUDE.md §ใบรายงานปัญหา |
| `wip_buffer_points` | ตารางอ่านประวัติเท่านั้น (เลิกจุด WIP 01/10) | CLAUDE.md §📦 |

### 4.2 ⚠️ สิ่งที่ยังไม่มีใครตัดสิน: ทะเบียนชิ้นงานมี 2 ใบ

`dr_products` (232 แถว · สินค้าที่เปิดกะ/มี CT) กับ `parts_master` (430 แถว · ชิ้นส่วน/วัตถุดิบ/ของซื้อ) ซ้อนกัน 177 MAT ·
`dr_products` 55 MAT ไม่อยู่ใน `parts_master` · `parts_master` 254 MAT ไม่อยู่ใน `dr_products` ·
FK ที่มีอยู่ชี้เข้า `dr_products.id` ทั้งหมด (5 ตัว) และ **ไม่มีสักตัวชี้เข้า `parts_master`** ·
ตารางคลัง (`line_part_levels` · `stock_receipts` · `purchase_requests` · `bom_items`) จับคู่ด้วย `mat_no` กับ**ทั้ง 2 ใบรวมกัน**
⇒ **จะใส่ FK บน `mat_no` ต้องตอบก่อนว่าแม่คือใบไหน** — ทางที่ไม่พังของเดิม: view/ตาราง `mat_registry (mat_no pk)` ที่ union 2 ใบ
แล้วค่อยผูก FK กับตารางกลาง (ไม่ใช่ยุบ 2 ใบเป็น 1 — `dr_products` มีคอลัมน์การผลิต ส่วน `parts_master` มีราคา/ผู้ขาย คนละโดเมน)

---

## 5. ลำดับแก้ที่เสนอ (ถูก→แพง · ทุกข้อเป็น migration แยก · ถาม user ก่อนทุกข้อ)

| # | งาน | ฝั่ง | ก่อนทำต้อง | ย้อนได้ไหม |
|---|---|---|---|---|
| **1** | เพิ่ม FK บน uuid ที่**สะอาดแล้ว** 9 คอลัมน์ (§3 ย่อหน้า "สะอาด") · `on delete restrict` หรือ `set null` ตามความหมาย | ทั้ง 2 | — | ✅ `drop constraint` บรรทัดเดียว |
| **2** | เพิ่ม FK บน uuid ที่**มีกำพร้า** (§3 ตาราง) — ต้องตัดสินก่อนว่าแถวกำพร้าทำอะไร: `set null` (ถ้าคอลัมน์ nullable) หรือ**ย้ายไป `archive.`** · 🔴 **ห้าม delete** | ทั้ง 2 | user ตัดสินรายตาราง · โดยเฉพาะ `lpa_audit_answers` (คำตอบใบตรวจ) และ `mtn_orders.source_downtime_id` | ✅ ถ้าใช้ `set null` + เก็บค่าเดิมใน archive |
| **3** | **`daily_production_logs.assigned_line` text → uuid + FK `workstations`** · 3,714 แถวชี้จุดงานที่ลบแล้ว ⇒ ต้อง (ก) เลิกลบจุดงาน ใช้ `is_active` แทน (ยังไม่มีคอลัมน์นี้ใน `workstations`) (ข) backfill แถวกำพร้าให้ชี้จุดงานปัจจุบันของไลน์เดียวกันไม่ได้ — **ไม่รู้ว่าเคยยืนจุดไหน** ⇒ ปล่อยเป็น null + บอกบนจอ | Main | เพิ่ม `workstations.is_active` ก่อน · แก้ `LineSetup.jsx` ลบจุดงาน = soft-delete · เช็ค `workforce-insight.md` | ⚠️ เปลี่ยนชนิดคอลัมน์ ย้อนยาก — ทำเป็นคอลัมน์ใหม่ `station_id uuid` คู่กันก่อน |
| **4** | **หน้าเขียน id ให้ครบ** (ไม่แตะ schema): `four_m_logs.line_id` (73% ว่าง · `Management.jsx` 3 จุด + `QaCheckSheet.jsx`) · `workstations.line_id` (77% · `LineSetup.jsx:890`) · `kanban_standards.product_id` · `station_assignment_logs.station_id` · backfill จาก `line_name` ย้อนหลังด้วย SQL (ทำได้เพราะ cascade rename ทำให้ชื่อตรง 100%) | Main | — | ✅ โค้ดล้วน |
| **5** | **`machines.machine_no` เป็น join key แต่ 1 ใบ = 2 เครื่อง** (`SP-74/NF64`) — ปัญหา model: `prod_orders`/`downtime_logs` ต้องรองรับ **หลายเครื่องต่อใบ** (ตารางลูก `prod_order_machines` หรือ `machine_nos text[]`) · ห้ามแก้ด้วยการเพิ่มแถว `SP-74/NF64` เข้าทะเบียน (ป้าย QR จะชี้ 2 เครื่อง · ขัด `20260803_asset_identity_unique.sql`) · ชื่อไทย `เลเซอร์0N` 450 ใบ = ต้องให้คน map ครั้งเดียวที่ `/machines` (ทะเบียน alias) **ห้ามเดา** (กฎ `machineNo.js`) | DR | user ตัดสิน model · ตรวจ `laneWeightFn`/`parallel_machine` ว่ากินคอลัมน์ไหน | ⚠️ |
| **6** | **สำเนาทะเบียน Main → DR** (`production_lines` · `employees` อย่างน้อย id+code+name) ผ่าน Edge Function/cron ที่ sync ทางเดียว · แล้ว `production_sessions`/`downtime_logs`/`mtn_orders` ค่อยเพิ่ม `line_id uuid` FK ไปที่สำเนา | DR | ออกแบบ sync + ตัดสินว่า RLS สำเนาเป็น anon-read ได้ไหม (ชื่อพนักงานทั้งโรงงานบน DR anon-open = **ข้อมูลส่วนบุคคลรั่ว** — น่าจะทำได้แค่ `production_lines`) | ⚠️ งานใหญ่ · เป็นก้าวแรกของ "ย้ายเข้า server บริษัท" (deploy.md) ที่สุดท้ายอาจรวม 2 ฐาน |
| **7** | `mat_registry` กลาง (§4.2) → FK `mat_no` ทั้ง 32 คอลัมน์ | DR | user ตัดสินว่า `dr_products` กับ `parts_master` ใบไหนเป็นแม่ของอะไร | ⚠️ |
| **8** | ล้างข้อมูล (ไม่ใช่โค้ด): `employees.department` 49 · `profiles.section` 15 (`JIG MTN`/`Die MTN`/`MTN` → ชื่อในผัง) · `cost_center_rates` 29 CC · `employee_skills` 96 แถว skill ที่ลบแล้ว · `mtn_orders.machine_no=''` 134 → null | ทั้ง 2 | เป็นการตั้งค่า ไม่ใช่งานโค้ด — ส่ง SQL ให้ user รัน + คิวรีเช็คผล | ✅ |

**ข้อที่ไม่ควรทำ:** ใส่ FK บน `line_name`/`*_name` text ทั่วไป — ชื่อเปลี่ยนได้ (rename cascade อยู่แล้ว) และใบที่พิมพ์แล้วต้องคงชื่อเดิม ·
FK ที่ถูกต้องคือบน **id** แล้วให้ `*_name` เป็น snapshot ต่อไป (ตามที่ `four_m_logs` ทำ: มีทั้ง `line_id` และ `line_name`)

---

## 6. ด่านที่ควรเพิ่ม (หลัง user ตัดสินข้อ 1-2)

- เทสใน `regressionGuards`: migration ใหม่ที่ `create table` มีคอลัมน์ `*_id uuid` **ต้องมี `references`** เว้นแต่คอมเมนต์บอกว่าข้าม project (`-- xproject:`)
  — จับคลาส §3 ไม่ให้เกิดซ้ำ (grep ได้แม่น)
- หน้า `/schema` แท็บ 🩺 เพิ่มแถว "uuid `*_id` ที่ไม่มี FK" + "แถวกำพร้า" จาก SQL ท้ายไฟล์นี้ — ให้เห็น drift สด ไม่ต้องรอ audit

---

## 7. SQL ที่ใช้ตรวจ (รันซ้ำได้ · SQL Editor บนเว็บ · ระบุ project ให้ถูก)

**7.1 ตารางที่ไม่มี PK (รันทั้ง MAIN และ Product DB — คาดว่าได้ 0 แถว)**
```sql
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
and not exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p') order by 1;
```

**7.2 คอลัมน์ uuid ชื่อ `*_id` ที่ไม่มี FK (รันทั้ง 2 ฝั่ง)**
```sql
select c.relname tbl, a.attname col
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
and a.atttypid='uuid'::regtype and a.attname like '%\_id' and a.attname<>'id'
and not exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='f' and a.attnum=any(k.conkey))
order by 1,2;
```

**7.3 นับแถวกำพร้า — ตัวอย่างฝั่ง Product DB (`eyhclzkifitbhbljgoav`)**
```sql
with m as (select machine_key(machine_no) k from machines)
select 'downtime_logs.machine_no' chk,
       count(*) filter (where machine_no is not null and machine_key(machine_no) not in (select k from m)) orphan,
       count(*) filter (where machine_no is not null) total
from downtime_logs
union all
select 'mtn_orders.source_downtime_id',
       count(*) filter (where source_downtime_id is not null and source_downtime_id not in (select id from downtime_logs)),
       count(*) filter (where source_downtime_id is not null)
from mtn_orders
union all
select 'kanban_standards.mat_no vs dr_products ∪ parts_master',
       count(*) filter (where mat_no not in (select mat_no from dr_products where mat_no is not null
                                              union select mat_no from parts_master where mat_no is not null)),
       count(*)
from kanban_standards;
```

**7.4 นับแถวกำพร้า — ตัวอย่างฝั่ง MAIN (`ewhdfqwfwofivojtsizn`)**
```sql
select 'daily_production_logs.assigned_line → workstations' chk,
       count(*) filter (where assigned_line ~ '^[0-9a-f-]{36}$' and assigned_line::uuid not in (select id from workstations)) orphan,
       count(*) filter (where assigned_line is not null) total
from daily_production_logs
union all
select 'lpa_audit_answers.question_id → lpa_questions',
       count(*) filter (where question_id not in (select id from lpa_questions)), count(*)
from lpa_audit_answers
union all
select 'four_m_logs.line_id ว่าง', count(*) filter (where line_id is null), count(*) from four_m_logs
union all
select 'profiles.section ∉ org_nodes(section)',
       count(*) filter (where section is not null and section not in (select name from org_nodes where kind='section')),
       count(*) filter (where section is not null)
from profiles;
```
