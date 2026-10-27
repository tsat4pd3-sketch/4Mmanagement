# ISA-95 (IEC 62264) Audit — ESM เทียบมาตรฐานระบบบริหารการผลิตระดับ 3 (MOM)

> **สถานะ: 📌 บันทึกผล audit — ข้อเสนอทั้งหมดยังไม่ลงมือ ห้าม session ใดหยิบไปทำเองจนกว่า user สั่ง** (2026-10-26)
> รีวิวจาก **โค้ด + migration + เอกสารโมดูล** ณ 2026-10-26 (main `6f2caba`) — ไม่ได้นับแถวข้อมูลจริงใน DB
> ⇒ คะแนนข้างล่าง = **"ระบบรองรับไหม"** ไม่ใช่ **"หน้างานใช้จริงแค่ไหน"** (คนละคำถาม · ดูบทเรียน IATF16949-GAP-REVIEW ข้อ "บันทึกว่าง")

**ขอบเขต ISA-95 ที่ใช้เทียบ**
- **Part 1/2** — แบบจำลองวัตถุ (Equipment · Personnel · Material · Process Segment · Product Definition · Schedule/Performance)
- **Part 3** — กิจกรรม MOM 4 หมวด (Production · Quality · Maintenance · Inventory) × 8 กิจกรรม
- **Part 5 / Purdue model** — การเชื่อมระดับ 2 (เครื่องจักร/SCADA) ↔ 3 (ESM) ↔ 4 (ERP/SAP) + รูปแบบข้อความ (B2MML)

**ตำแหน่งของ ESM:** ระบบระดับ 3 เต็มตัว (MOM) — ทำงานระดับ 3 ได้กว้างมาก แต่ **ขอบทั้งบน (L4) และล่าง (L2) ยังต่อด้วยคน/ไฟล์**

---

## 1. สรุปคะแนน (Part 3 — 4 หมวด × 8 กิจกรรม)

`●` = ครบ · `◐` = บางส่วน · `○` = ไม่มี · คะแนน ●=2 ◐=1 ○=0 (เต็ม 16 ต่อหมวด)

| กิจกรรม | Production | Quality | Maintenance | Inventory |
|---|---|---|---|---|
| Resource management | ● | ◐ | ● | ● |
| Definition management | ◐ | ● | ● | ● |
| Detailed scheduling | ● | ◐ | ● | ● |
| Dispatching | ◐ | ◐ | ◐ | ● |
| Execution management | ● | ● | ● | ● |
| Data collection | ◐ | ● | ● | ◐ |
| Tracking | ◐ | ● | ● | ◐ |
| Performance analysis | ● | ● | ● | ◐ |
| **คะแนน** | **12/16** | **12/16** | **15/16** | **13/16** |

**รวม 52/64 (81%)** — ความกว้างของงานระดับ 3 สูงกว่าระบบ MES สำเร็จรูปส่วนใหญ่ (มี 4M · CQI-15 · LPA · 8D→PFMEA · Heijunka · ทักษะ/EXP ที่ MES ทั่วไปไม่มี)
**ที่ฉุดคะแนนเป็นแกนเดียวกันทั้ง 4 หมวด: ไม่มีอะไรไหลเข้า/ออกเองอัตโนมัติ** (dispatch ถึงเครื่อง · เก็บข้อมูลจากเครื่อง · ส่งผลกลับ ERP)

### หลักฐานรายช่อง (ย่อ)

**Production**
- Resource ● `/manpower-board` `/shift-organize` `/skills-report` · `employees` `station_assignment_logs` `manpower_slot_plans` `machines` `workstations`
- Definition ◐ `/products` (`dr_products` `bom_items` `part_routings`) · `/process-setup` · `/pe-docs` · CT `ct_proposals` — **ขั้นตอนผลิตมี 3 ชุดที่ไม่ผูกคีย์กัน** (ดู §2.4) · `part_routings` ว่าง 101/106 พาร์ท (21/09 · `bom-levels.md`)
- Scheduling ● `/production-plan` (`production_plan_lots` · `planLots.js` `planTimeline.js` `capacityModel.js`) · `/heijunka` (`heijunkaQueue.js`)
- Dispatching ◐ ปล่อยล็อตเข้าไลน์ = เปลี่ยนสถานะมือ (`HeijunkaKanban.jsx` · `LineOrderBoard.jsx`) — **ไม่มีการส่งงาน/สูตร (recipe) ลงเครื่อง**
- Execution ● `/daily-report` · `production_sessions` · `sessionStatus.js` `closeShiftOrders.js`
- Data collection ◐ คนกรอกล้วน (`downtime_logs` `defect_logs` `prod_orders`) · shot = derive จากยอดผลิต (`pairTotals.js`)
- Tracking ◐ `/order-trace` `/product-history` — **สอบกลับได้ระดับใบสั่งผลิต ไม่ถึงล็อตวัตถุดิบ/serial**
- Performance ● `src/utils/oee.js` · `/oee-analytics` `/line-oee` `/obeya` `/vsm` `/monitoring`

**Quality**
- Resource ◐ เครื่องมือวัด + สอบเทียบ (`qa_instruments`) · ไม่มี MSA/GR&R · ไม่มีทะเบียนคุณสมบัติผู้ตรวจแยก
- Definition ● `/qa-setup` (`qa_parts` `qa_characteristics` `qa_part_drawings` · `qaSpec.js`) · Control Plan/PFMEA `/pe-docs` · `/doc-forms`
- Scheduling ◐ FME (`qa_fme_obligations` · `qaFmeForecast.js`) · แผน LPA (`lpa_plans`) · CQI-15 matrix — **ไม่มีคิวตรวจกลางที่ดึงจากเหตุการณ์ผลิต** (นอกจาก 4M/CQI-15)
- Dispatching ◐ `qaStages.js` `qaSequential.js` + แจ้งเตือน
- Execution ● `/qa` (`qa_inspection_sheets` …) · `/event-log` (`cqi15_event_logs`) · 4M (`four_m_logs`)
- Data collection ● `qa_measurements` `defect_logs` `quality_bin_records` (`qualityBin.js`) · `/scrap-report` · `pokayoke_checks`
- Tracking ● NCR→CAPA/8D (`qa_ncr` `qa_capa` `qa_customer_claims`) · ลูปปิด 8D→PFMEA (`closed-loop-8d-pfmea.md`)
- Performance ● PPM/FTT/Pareto + SPC X̄-R · Cp/Cpk/Pp/Ppk (`QualityControl.jsx`) — ⚠️ SPC มี 3 ชุดแยกกัน (`QualityControl.jsx` · `qc7.js` XmR · `lib/spc.js` เช็คแค่ limit) และ **ไม่มี run rules (Western Electric) / ไม่เตือนทันทีตอนกรอก**

**Maintenance**
- Resource ● `mtn_teams` `mtn_technicians` `line_technicians` `mtn_labor_rates` · อะไหล่ `mtn_spare_parts` · ผังคลัง
- Definition ● `/pm` (`pm_plans` `checklists` `machine_points` `jig_checkpoints`) · WI ซ่อม `repair_wi_registry`
- Scheduling ● `PMSchedule.jsx` `PmForecast.jsx` · ประสานงาน `pm_coordination_plans` · `pmRunDay.js`
- Dispatching ◐ มอบงาน MO + ส่งต่อทีม (`mtn_order_handoffs`) · ไม่มีคิวงานรายช่างบนมือถือแยกจากขั้น MO
- Execution ● `/mtn-repair` MO 7/8 ขั้น (`mtnStepPerm.js`) · `DailyPM.jsx` · `/daily-checker`
- Data collection ● `inspection_results` `mtn_order_parts` `mtn_order_labor` `mtn_stock_txns` `fixture_shim_events`
- Tracking ● ประวัติซ่อมรายเครื่อง · สถานะแม่พิมพ์ (`die-maintenance.md`) · ใบขอซื้อ `mtn_purchase_requests`
- Performance ● `/mtn-analysis` MTBF/MTTR (`mtnMetrics.js`) + QC 7 Tools · Rank อะไหล่ (`spareRank.js`)

**Inventory**
- Resource ● `storage_locations` (SLoc ตรง SAP · `storageLoc.js`) `storage_zones` · `/transport` (`transport_vehicles` `transport_nodes`) · `container_types`
- Definition ● `parts_master` `kanban_standards` `line_part_levels` `product_packaging` · คำนวณคัมบัง `kanbanCalc.js`
- Scheduling ● `/customer-demand` (`customer_forecasts` · `demandExplode.js`) · รอบส่ง `kanban_delivery_rounds` · รอบขนส่ง
- Dispatching ● ใบขอเติม/เบิก (`wip_replenish_requests` `raw_withdrawal_requests` `material_requests`) · `replenishGate.js`
- Execution ● `/line-stock` (`line_stock_transactions`) · `stock_receipts` · ขาออก `customer_shipping_orders`
- Data collection ◐ สแกน QR + กรอกมือ · ไม่มีการกระทบยอดกับ SAP
- Tracking ◐ `line_stock_summary` `lineWipLedger.js` `/flow-tower` — backflush **ทำงานแล้ว** (แก้ 21/08) แต่ 🔴 **การย้ายของ STORE → ไลน์ส่วนใหญ่ไม่ถูกบันทึก** (ต.ค. 273 คู่ไลน์×พาร์ท) ⇒ ยอดที่ไลน์ต่ำกว่าจริง และยอด STORE ไม่ลดตามการใช้จริง *(แก้ 27/10 — ฉบับแรกอ้างตัวเลข 40 : 5,908 ที่ล้าสมัย)*
- Performance ◐ `/store-monitor` (`v_store_abnormal`) · `wipRunout.js` — ไม่มี KPI stock accuracy / inventory turns

---

## 2. แบบจำลองวัตถุ (Part 1/2)

| วัตถุ ISA-95 | สถานะ | ที่มีในระบบ | ช่องว่างหลัก |
|---|---|---|---|
| **Equipment hierarchy** (Enterprise→Site→Area→Work Center→Work Unit) | ◐ | `org_nodes` (Main · `parent_id` FK) · `production_lines` (Main) · `workstations` (Main) · `machines` + `equipment_die` (DR) · `die_press_lines` (DR) · `pm_org_nodes`/`pm_facility_areas` (DR) | **5 ลำดับชั้นขนานกัน** · ไลน์แม่-ลูกผูกด้วยชื่อ (`parent_line_name` text) · `machines.line_name` / `workstations.line_name` = text ข้ามโปรเจค · ไม่มีชั้น Enterprise/Site |
| Equipment class / capability | ◐ | `equipment_kind` `equipment_category` (`equipmentKinds.js`) · `machine_types` `machine_automation_levels` (`machineTraits.js`) | ไม่มีชุด property ต่อคลาส · ไม่มีความสามารถเครื่อง (capacity/availability ต่อ segment) · tonnage เป็น text |
| **Personnel** class / person / qualification | ● (แข็งแรงสุด) | `employees` · `positions` · `grades` · `staff_kind` · `skill_definitions` · `employee_skills` + EXP v2 (`employee_skill_evidence`) · `station_requirements` · OJT | ทักษะผูกด้วยชื่อ (text) ไม่ FK · ไม่มีวันหมดอายุ/ต่ออายุใบรับรอง · ทักษะผูกกับ "จุดงาน" ไม่ผูกกับ "ขั้นตอนผลิต" · `employees` ≠ `profiles` และฝั่ง DR เก็บชื่อคน ไม่เก็บ id |
| **Material** definition / class | ◐ | `dr_products` + `parts_master` (2 master) · คลาสจากเลขหน้า MAT 1xx/2xx/3xx/5xx (`matPrefix.js`) · `bom_items` (`bomTree.js`) | 2 ทะเบียนวัสดุ · ไม่มี sync material master กับ SAP |
| **Material lot / sublot / genealogy** | ○ | `lot_no` มีที่เดียวคือใบตรวจ QA (`20260804_qa_inspection_check_sheet.sql`) · "ล็อต" อื่นในระบบ = ล็อตแผน/ความต้องการ ไม่ใช่ล็อตของจริง | **ไม่มีล็อตวัตถุดิบ → ใบผลิต → กล่อง FG** · ไม่มี serial · ตรงกับช่องว่าง IATF 8.5.2 ที่บันทึกไว้แล้ว |
| **Process segment** | ◐ | `process_types` · `part_routings` (CT/setup/คน/เครื่อง) · `dr_products.is_operation`/`op_parent_mat` · `pe_processes` (Main) | **3 ชุดขั้นตอนที่ไม่ผูกคีย์กัน** (PE ops · `part_routings` · OP-products) · ไม่มี resource spec (ชั้นเครื่อง/คน/วัสดุเข้า-ออก/พารามิเตอร์) ต่อขั้น |
| **Product definition** | ◐ | BOM + routing + CT + Control Plan/PFMEA | Control Plan เป็นแถวเอกสาร ไม่ใช่พารามิเตอร์ที่ execution ใช้ได้ |
| **Production schedule → request → response → performance** | ◐ | แผน `production_plan_lots` → ของจริง `prod_orders`/`production_sessions` · เทียบด้วย `matchPlanToActual` | ไม่มี response รายขั้นตอน (มีแค่รายกะ/รายใบ) · แรงงานอยู่คนละโปรเจค (Main) เทียบด้วยชื่อไลน์+วันที่ · การใช้วัสดุผูกกับใบผลิตแค่บางส่วน (`ref_order_id`) |

> ✅ **ที่สอดคล้อง ISA-95 อยู่แล้ว (อย่ารื้อ):** แผน = "Schedule" · ใบผลิตเปิดคัมบัง = "Response" แยกกันตามกฎ Layer 1/2 ของ `production-plan.md`
> — ISA-95 เองก็แยก schedule กับ performance และให้เทียบกันภายหลัง **ช่องว่างจริงคือความละเอียด (รายขั้นตอน) ไม่ใช่การแยกชั้น**

---

## 3. การเชื่อมต่อระดับ 2 ↔ 3 ↔ 4 (Purdue / Part 5)

| ช่องทาง | สถานะ | รายละเอียด |
|---|---|---|
| L4 → ESM: BOM จาก SAP | ◐ ไฟล์มือ | `sapBomImport.js` (CS12 / BOM & Routing export) ดูตัวอย่างก่อนเขียน · ไม่ลบแถวของ ESM |
| L4 → ESM: ความต้องการลูกค้า EDI 830/862 | ◐ อีเมล → คิว → คนกดนำเข้า | `tools/outlook-mail-ingest` → edge `ingest-demand-mail` → `/planner-sales` · เป็น Excel portal (ไม่ใช่ X12/EDIFACT) |
| L4 → ESM: ตัวเลขบัญชี KPI | ◐ batch | `scripts/acct-import` (GitHub Actions วันที่ 10–21) → `kpi_base_inputs` |
| **ESM → L4: ผลผลิต / การใช้วัสดุ / ของเสีย เข้า SAP** | ○ | `ICS-SAP-INTEGRATION.md` §3 "นี่คือช่องว่างเดียว" · ยังเป็นงานศึกษา รอคำตอบ TSG IT |
| รูปแบบข้อความมาตรฐาน (B2MML / ISA-95 JSON) | ○ | ไม่มีในรีโป |
| Master data ownership | ◐ | หลักการตกลงแล้ว: **SAP = เจ้าของบัญชีสต๊อก · ESM = เจ้าของกระบวนการหน้างานและสูตร** (`SCADA_REALTIME_DESIGN.md` §1 · ICS §6) — แต่ในทางปฏิบัติ material master ไม่ sync · BOM นำเข้ามือ ⇒ 2 ระบบเบี้ยวกันได้ |
| **L2 → ESM: SCADA / PLC / OPC UA** | ○ (ออกแบบแล้ว · **พักตามคำสั่ง user 14/10**) | `SCADA_REALTIME_DESIGN.md` — ห้ามเริ่มจนกว่า user สั่ง |
| L2 → ESM: มิเตอร์ไฟฟ้า MQTT | ○ (เขียนแล้ว ไม่ deploy) | `ingest-energy` ยังไม่ deploy · migration MQTT topics ตั้งใจไม่ apply · ตอนนี้จดมิเตอร์มือ |
| ESM → L2: ส่งงาน/สูตรลงเครื่อง | ○ | ไม่มี |

> ✅ **หลักการ "SCADA = ข้อเท็จจริง · คน = เหตุผล · ESM = เจ้าของสูตร" ตรงกับ ISA-95 เป๊ะ** — ระดับ 3 เป็นเจ้าของการคำนวณ performance ระดับ 2 ส่งแค่ข้อมูลดิบ ⇒ วันที่ปลดพัก SCADA ให้ยึดเอกสารนี้

---

## 4. ความปลอดภัย / ความถูกต้องของข้อมูล (ข้ามมาตรฐาน — ISA-95 Part 1 + IEC 62443)

| ประเด็น | สถานะ | หมายเหตุ |
|---|---|---|
| ฝั่ง DR ไม่มีการยืนยันตัวตนที่ DB (`supabaseDR` = anon เสมอ) | 🔴 known gap | CLAUDE.md §Supabase Projects · ด่านสิทธิ์ชั้น ③ ฝั่ง DR อยู่ที่จออย่างเดียว ยิง API ตรงข้ามได้ |
| สิทธิ์ 3 ชั้น (`writeScope.js` · `ccScope.js`) | ◐ | ครบที่จอ · RLS ฝั่ง Main 68 policy ยังไม่กรองรายหน่วย (`permission-scope-audit.md`) |
| Audit trail | ◐ | `fn_audit()` ทั้ง 2 โปรเจค · ฝั่ง DR ผู้แก้ = ชื่อที่ client ส่งมา (ไม่ใช่ตัวตนที่ยืนยันแล้ว) |
| แบ่งโซน OT/IT (Purdue / IEC 62443 zone-conduit) | ○ | ยังไม่มีเครือข่าย OT ให้แบ่ง · แผน on-prem (`LOCAL-SERVER-MIGRATION-SPEC.md`) วาง LAN-only + VPN ไว้แล้ว |
| คีย์อ้างอิงข้ามระบบ | ◐ | `machine_no`/ชื่อไลน์/ชื่อทักษะ = text · 2 DB ไม่มี FK ข้ามกัน · `sync-station-output` copy DR→Main รายวัน |
| แบบจำลองเวลา (วันทำงาน/กะ) | ● | `workDate.js` `shiftWindow.js` `companyCalendar.js` — ยังมีสำเนาเก่า 27 จุดที่รอกวาด · on-prem ต้องมี NTP |

---

## 5. ประเด็นเน้น

1. **ESM แข็งที่ "กลาง" ของระดับ 3 แต่ "ขอบ" ทั้งสองด้านยังเป็นคน** — กิจกรรม Execution/Performance ครบทุกหมวด ขณะที่ Dispatching + Data collection ◐ แทบทุกหมวด และ L4 ขาออก ○
   ⇒ ตัวเลข OEE ทั้งหมดแม่นได้เท่าที่คนกรอก — นี่คือความเสี่ยงอันดับ 1 ต่อความน่าเชื่อถือของจอทุกจอ
2. **ไม่มีล็อตของจริง = ไม่มี genealogy** — ISA-95 ถือ Material Lot เป็นแกนของ tracking · ช่องว่างเดียวกับ IATF 8.5.2 ⇒ ทำตัวเดียวปิดได้ 2 มาตรฐาน
3. **การย้ายของ STORE → ไลน์ไม่ถูกบันทึก** — backflush ทำงานแล้ว (ของที่บันทึกจ่าย ระบบหักครบ) แต่ ต.ค. มี 273 คู่ไลน์×พาร์ทที่ผลิตใช้โดยไม่มีบันทึกรับเข้า ⇒ Inventory Tracking ยังตอบ "ค้างเท่าไหร่" ไม่ได้ และยอด STORE ที่แผนผลิตเอาไปหักอาจสูงเกินจริง (`demand-flow-tower.md` §27/10) *(แก้ 27/10)*
4. **ลำดับชั้นอุปกรณ์มี 5 ชุด ผูกด้วยข้อความ** — ทุกการเชื่อมข้ามโมดูลต้องผ่านการเทียบชื่อ (`machine_key()` · `orgNodeRefs.js`) ⇒ ต้นทุนแฝงของทุกฟีเจอร์ linkage ใหม่ (ขัดเป้า golden thread)

---

## 6. ลำดับงานที่เสนอ (ยังไม่ทำ — รอ user สั่ง)

ตามกฎ CLAUDE.md ข้อ 5 — ทำบน **พาร์ทต้นแบบสาย 060/061** ให้เห็นภาพเต็มก่อน แล้วค่อยขยาย

| # | งาน | ปิดช่องว่าง ISA-95 | ขนาด | หมายเหตุ |
|---|---|---|---|---|
| 1 | ~~แก้ backflush~~ → **ให้สโตร์บันทึกการย้ายของเข้าไลน์ทุกครั้ง** (user เคาะ 27/10 · แก้ที่หน้างาน ไม่แก้โค้ด) | Inventory Tracking/Perf | S | trigger ทำงานถูกแล้ว · ส่ง worklist 273 คู่ให้สโตร์ · วัดซ้ำด้วยคิวรีภาคผนวก |
| 2 | **ล็อตวัตถุดิบ + genealogy** บนสาย 060/061: รับเข้า (lot supplier) → ผูกใบผลิต → กล่อง FG | Material Lot · Production Tracking · IATF 8.5.2 | M–L | ต่อยอด `stock_receipts` + `line_stock_transactions.ref_order_id` + `/order-trace` |
| 3 | **ทะเบียนอุปกรณ์ชั้นเดียว**: ติดชั้น ISA (site/area/work center/work unit) + เปลี่ยนไลน์แม่เป็น id + คีย์ `equipment_id` คงที่ข้าม Main/DR | Equipment hierarchy | L | schema ข้าม 2 โปรเจค = ต้องถาม user · เริ่มจาก "ตารางเทียบ" แบบอ่านอย่างเดียวก่อน |
| 4 | **รวมนิยามขั้นตอนผลิต**: ให้ `part_routings` เป็น process segment หลัก ผูกคีย์ไปยัง `pe_processes` + OP-products · เติม routing ให้ 060/061 ครบ | Process segment · Product definition | M | `peRouting.js` เสนอ routing จาก PFC อยู่แล้ว |
| 5 | **ไฟล์ส่งออก ESM → SAP** (ผลผลิต/การใช้วัสดุ/ของเสีย) ใช้โครง B2MML-like (ProductionPerformance / MaterialActual) | L4 ขาออก · B2MML | M | ทางเลือกใน ICS-SAP-INTEGRATION §4 · รอ TSG IT |
| 6 | **SPC ชุดเดียว** + run rules + เตือนตอนกรอก | Quality Performance | S–M | ยุบ 3 ชุด (`QualityControl.jsx` · `qc7.js` · `lib/spc.js`) |
| 7 | ประตู Edge Function ให้ฝั่ง DR (เริ่มจากตารางที่เขียนผลผลิต) | IEC 62443 / ความถูกต้องข้อมูล | L | known gap เดิม |
| 8 | SCADA / MQTT | L2 ↔ L3 | L | **พักตามคำสั่ง user 14/10 — ห้ามเริ่ม** ออกแบบไว้แล้วสอดคล้อง ISA-95 |

---

## ภาคผนวก — คิวรีวัดซ้ำ "ไลน์ใช้ของที่ไม่มีบันทึกรับเข้า" (DR · "Product DB" `eyhclzkifitbhbljgoav`)

อ่านอย่างเดียว · เปลี่ยนช่วงวันที่ได้ · ตัวเลข "ควรใช้" = สูตรเดียวกับ `fn_explode_child_demand` (ใบ `confirmed` × `bom_items.qty_per_unit`)

```sql
with fg as (select distinct on (mat_no) mat_no, id, coalesce(is_operation,false) is_op
            from dr_products where is_active order by mat_no, id),
o as (select ps.line_name, o.mat_no, o.qty from prod_orders o
      join production_sessions ps on ps.id = o.session_id
      where o.status = 'confirmed' and ps.work_date between '2026-10-01' and '2026-10-26' and o.qty > 0),
need as (select o.line_name, b.mat_no child, sum(o.qty * b.qty_per_unit) need
         from o join fg on fg.mat_no = o.mat_no and not fg.is_op
         join bom_items b on b.product_id = fg.id and b.is_active group by 1, 2),
iss as (select line_name, mat_no child, sum(qty) issued from line_stock_transactions
        where type = 'issue' and work_date between '2026-10-01' and '2026-10-26' group by 1, 2)
select n.line_name, count(*) child_mats,
       count(*) filter (where coalesce(i.issued, 0) < n.need) short_mats,
       round(sum(n.need)) need, round(sum(coalesce(i.issued, 0))) issued
from need n left join iss i using (line_name, child)
group by 1 order by need desc;
```
