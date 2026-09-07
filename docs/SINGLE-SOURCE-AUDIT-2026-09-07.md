# 🔍 Single-Source-of-Truth Audit — ช่องกรอก "ชื่อ/รหัส" ทุกหน้า (2026-09-07)

> **คำสั่ง user:** ตรวจทุกฟีเจอร์ทุกหน้า — ชื่อคน / เครื่อง / ชิ้นส่วน / ประเภท / รหัส อะไรก็ตามที่ให้เลือกกรอก
> ถ้ามีทะเบียนในฐานข้อมูลแล้ว **ต้องไม่มีให้พิมพ์เอง** ให้เป็นการเลือก + กรองตามลำดับชั้นองค์กร หรือพิมพ์ค้นได้
>
> วิธี audit: 5 subagent อ่านโค้ดขนานกัน (แบ่ง 5 กลุ่ม ~120 ไฟล์) grep ทุก `<input>`/`<select>`/`datalist`
> แล้วอ่าน save path + ผู้ใช้งาน column ปลายทาง เพื่อจัดระดับ · แก้ด้วย 5 subagent ขนานกันบน component กลางชุดใหม่

## สรุปผล

| กลุ่ม | ไฟล์ | 🔴 free text บน join key | 🟡 free text แสดงผล/snapshot | 🔵 hardcode/`lines.map` ซ้ำ master | ✅ เป็น picker อยู่แล้ว |
|---|---|---|---|---|---|
| A ฝ่ายผลิต | 21 | 2 | 19 | 13 | ≈87 |
| B master/setup | 24 | 3 | 8 (11 ช่อง) | 3 (11 ช่อง) | 57 |
| C ซ่อมบำรุง/PM/แม่พิมพ์ | 23 | 8 | 18 | 9 | 57 |
| D คุณภาพ/PE/NPI | 25 | 7 | 52 | 1 | 45 |
| E โลจิสติกส์/สโตร์/อื่นๆ | 32 | 5 | 8 | 3 | 42 |
| **รวม** | **125** | **25** | **~105** | **~29** | **~288** |

**5 คลาสที่ซ้ำทั้งระบบ (ต้นเหตุจริง — แก้ที่ component กลาง ไม่ใช่รายหน้า):**

| คลาส | จำนวนจุด | เดิม | ตอนนี้ (single source) |
|---|---|---|---|
| ชื่อคน (ผู้ตรวจ/อนุมัติ/รับผิดชอบ/แจ้ง/สอน/หัวหน้า) | ~60 | `<input>` เปล่า / datalist `npi-users` | `<PersonSelect>` ← `usePeople` (profiles ∪ employees · เกี่ยวข้องขึ้นก่อน ไม่ตัดคนอื่น · ป้ายพิมพ์เอง) |
| หมายเลขเครื่อง/แม่พิมพ์/จิ๊ก (`machine_no` = text join key) | 6 | datalist / input | `<MachineSelect>` ← `useMachines` (ครอบครัวไลน์ขึ้นก่อน · kinds · ⏸ ปลดระวาง) |
| MAT SAP / เลขพาร์ท (golden thread) | ~14 | input / datalist ไม่เช็คทะเบียน | `<ProductSelect>` ← `useProducts` (+`extraOptions` BOM/parts_master · OP ตัดออก) |
| ลูกค้า (**ไม่มีตาราง customers**) | ~11 | input เปล่า สะกดคนละแบบ | `<CustomerSelect>` ← `useCustomers` (distinct dr_products ∪ ship_to_plants · Product Master เป็นเจ้าของรายชื่อ) |
| dropdown ไลน์เขียนเอง `lines.map(<option>)` | ~35 | ไม่มีลำดับชั้น/scope/ปลดระวาง | `<LineSelect>` (กฎเดิม 2026-08-21 — drift กลับมา) |
| ทีม A/B/C hardcode | 8 | `['A','B','C']` | `useOrgTeams()` (org_nodes kind='team' → fallback A/B/C) |
| รหัสคลัง (Stor.Loc.) | 4 | input | `<StorageLocSelect>` ← `useStorageLocations` |

## สถานะการแก้ (2026-09-07 — แก้ครบในวันเดียวกับ audit)

**แก้แล้ว: ทุก 🔴 / 🟡 / 🔵 ที่มีทะเบียนในฐาน (~150 ช่อง · 58 ไฟล์)** — ตรวจผ่าน `npm run build` (context · lint · เทส 6 เคสใหม่ · vite)
+ `audit/crashsweep.mjs` 70 หน้า พัง 0 + sweep เปิด modal/พิมพ์ในช่อง picker 40 หน้า 52 ครั้ง พัง 0

| component/loader ใหม่ | ใช้แทน | ไฟล์ที่ใช้ |
|---|---|---|
| `PersonSelect` + `usePeople` | ช่องชื่อคน ~60 จุด | Report · ScrapReport · QualityBins · ProblemFixModal · MorningMeeting · Improvements · LineSetup · OrgSetup · DocFormsRegistry · MtnRepair · PMSchedule · PokaYoke · QualityControl · LPA · OJT · PEDocs · NPI · Npi* · MaterialRequests · QaPieceStepper · EventLog · KpiMonthly · VSM |
| `MachineSelect` + `useMachines` | หมายเลขเครื่อง 7 จุด | MtnRepair · PMSetup · PmCoordination · RoutingPanel · PEDocs · EventLog · SparePartMaster |
| `ProductSelect` + `useProducts` | MAT SAP ~14 จุด | DailyReport · ScrapReport · QualityBins · LinePartCallPanel · ProductMaster · PMSetup · DieRegistry · PEDocs · NPI · CustomerDemand · LineStock · PlannerSales |
| `PartSelect` + `usePartOptions` | เลขพาร์ท P/N (กุญแจเอกสาร PE) 5 จุด | QualityControl (CAPA/NCR/SPC) · QaClaims |
| `CustomerSelect` + `useCustomers` | ลูกค้า ~11 จุด | DailyReport · ProductMaster · MtnRepair · QAInspectionSetup · QaClaims · PEDocs · PeExcelImportModal · NPI · NpiTemplates |
| `InstrumentSelect` + `useInstruments` | เครื่องมือวัด/วิธีตรวจ | QualityControl · QAInspectionSetup |
| `StorageLocSelect` + `useStorageLocations` | รหัสคลัง | ScrapReport · MaterialRequests ×2 |
| `SelectOrFree` | select + ระบุเอง (ซ้ำ 7 จุด) | QualityControl · PEDocs · OJT · MaterialRequests · LPA · PokaYoke · DieRegistry |
| `LineSelect` (เดิม) | `lines.map(<option>)` ~35 จุด | ทุกกลุ่ม — query ทุกตัวเปลี่ยนเป็น `LINE_COLUMNS` |
| `useOrgTeams` | ทีม A/B/C hardcode 8 จุด | Report ×7 · Checkin |
| `useOrgSections` fallback · `SearchSelect` allowFree=false ล้างค่านอกทะเบียนเมื่อปิดลิสต์ | — | ทุก picker |

**ข้ามตามที่ audit ระบุ (ไม่มี master / เป็น enum ในโค้ด / phase 4):** supplier (Y2 · #34 · #47) · `model` · `qa_instruments.inst_type` (#11) · `OWNER_ROLE` NPI (#40) · `PKG_CATEGORIES` (B3) · `jigs.equipment_type` vs `machines.equipment_kind` (#19 — derive จากเครื่องแล้ว แต่ยังคง 2 enum) · dock / plant name · ตัวเลือก enum สถานะ/ผล/ความรุนแรงทั้งหมด

**ไม่เปลี่ยน schema** — คอลัมน์ id ที่ไม่มี (mtn_orders.machine_id · jigs.mat_no · meeting_action_items.assignee_id · npi leader_uid/owner_uid · doc_form_revisions) ยังเก็บ text snapshot เหมือนเดิม · ถ้าอยากผูก FK จริงเป็นงานถัดไป (migration + picker คืน id ให้อยู่แล้ว)

---
**สิ่งที่ตั้งใจ "ยังไม่ทำ" (ต้องมี master ใหม่ = product decision · schema):**
- ตาราง `customers` (code/name/alias) — ระหว่างนี้ใช้ derived list จาก Product Master (`useCustomers.js` แก้จุดเดียวเมื่อมีตาราง)
- ตาราง `suppliers` — NPI migration ระบุเป็นเฟส 4 · พิมพ์ซ้ำใน parts_master / container_types / part_routings.vendor / mtn_spare_parts / purchase_slips / npi_tooling.maker
- กลุ่มเครื่องปั๊มของแม่พิมพ์ (`LINE A ( 800 Ton )`) ไม่อยู่ใน production_lines — DieRegistry ยังเลือกจากค่าที่มีอยู่ + ระบุใหม่ได้
- `transport_carriers.employee_id` (ผูก FK คนขับกับ employees) · `cost_centers` master
- `model` (MtnRepair / PMSetup / DieRegistry) ไม่มี owner table · `qa_instruments.inst_type` · `container_types.category`

## กฎที่ตกผลึก (บันทึกใน `docs/UI-CONVENTIONS.md` §5.1.2)
1. ช่องที่รับ "ชื่อคน / เลขเครื่อง / MAT / ลูกค้า / รหัสคลัง" ต้องใช้ component กลางเท่านั้น ห้าม `<input>`/datalist เอง
2. picker ทุกตัว "เรียงของที่เกี่ยวข้องขึ้นก่อน ไม่ตัดของอื่นทิ้ง" (`strict` เมื่อต้องจำกัดจริง) และ "ค่าที่เลือกไว้ต้องไม่หายจากลิสต์"
3. `allowFree` เปิดได้เฉพาะจุดที่ของนอกทะเบียนมีจริง (ลูกค้าใหม่ · คนนอกระบบ · พาร์ท NPI ก่อน SOP) และต้องมีป้ายบอกเสมอ
4. ค่าที่ DB เก็บ**ไม่เปลี่ยน** (ยังเป็นชื่อ/machine_no/mat_no text) — picker แค่บังคับให้สะกดตรงทะเบียน + เติม id เมื่อคอลัมน์มีอยู่แล้ว

---

# ═══ กลุ่ม A-production ═══

# Audit A — production floor · entity inputs vs master pickers (read-only · 2026-09-07)

Scope: 21 files (group A). Method: grep `<input|<select|<textarea|SearchSelect|datalist|list=|LineSelect` in every file, then read the surrounding code of each hit and the save path (`from('…')`) to classify. Free-text description/remark/note/search/numeric/date inputs and master-creation forms are excluded (per brief). Files with **no entity inputs at all**: `DailyChecker.jsx` (tab shell), `ProdProgressStrip.jsx`, `LineWipPanel.jsx`, `ShiftAutoFillModal.jsx`, `DowntimeTimeline.jsx`, `WipBetweenSteps.jsx` (only a count note), `QualityBinLinkModal.jsx` (only qty + free cause), `HeijunkaKanban.jsx` (only a search box).

Legend: 🔴 free text where master exists AND value is a join key / filter · 🟡 free text where master exists but display/snapshot only · 🔵 hardcoded option list (or manual `lines.map(<option>)`) duplicating a DB master · ✅ counted only.

---

## src/pages/DailyReport.jsx  (7347 lines)

| # | file:line | Field (label) | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| D1 | `src/pages/DailyReport.jsx:7108` | **MAT.NO \*** (modal "+ เพิ่ม MAT.NO / Kanban Standard") | product mat_no → `kanban_standards.mat_no` (DR) · `product_id` stays `null` unless pre-filled | `<input>` free text, `.toUpperCase()`; `handleKanbanSave` (≈L6990) validates only non-empty — no lookup against `dr_products` | `dr_products` (DR) | 🔴 | `SearchSelect` over `dr_products` (mat_no · name · line) → set both `mat_no` **and** `product_id`; `allowFree` NOT justified (a kanban std for an unregistered product is useless — scan-open joins on mat_no) |
| D2 | `src/pages/DailyReport.jsx:7065` | **Customer** (Product master modal) | customer name → `dr_products.customer` (DR) | `<input>` free text (placeholder "เช่น FORD") | **NO MASTER** — same free-text customer is typed in 9 more places (`ProductMaster.jsx:1082`, `NPI.jsx:376`, `PEDocs.jsx:595`, `QAInspectionSetup.jsx:945`, `MtnRepair.jsx:623`, `NpiTemplates.jsx:131`, `PeExcelImportModal.jsx:284`, `CustomerDemand.jsx:556` datalist, `VSM.jsx:712`) and `customer_forecasts` / `customer_shipping_orders` / `qa_customer_claims` key on it | 🟡 (→ new-master candidate, clearly reusable) | Create `customers` master (Main) + a shared `CustomerSelect`/`SearchSelect allowFree` helper; until then at least a `<datalist>` of distinct `dr_products.customer` |
| D3 | `src/pages/DailyReport.jsx:3517` | **ไลน์การผลิต** (modal "เปิดกะผลิตใหม่") | production line → `production_sessions.line_name` (DR, join key everywhere) | `<select>` built manually from `lines.filter(...)` + `parentChildrenMap` optgroups (own hierarchy, own scope via `openScopeLineNames`) | `production_lines` (Main) | 🔵 | Replace with `<LineSelect lines={lines.filter(scope)} value onChange>` — component already does hierarchy / retired-line / unknown-value handling; keep the `openScopeLineNames` pre-filter |

✅ count: **18** — L2935 machine (machines master, line-family filtered) · L3537/6696 shift (enum, no master) · L4608/4698/4909/5193 MAT.NO selects (products / kanban std / open orders) · L4925 defect type · L5093 downtime type (process-type filtered) · **L5169 machine `SearchSelect allowFree`** (justified — comment + `freeHint` "ไม่ได้อยู่ในทะเบียน") · L5560/6306/7074 `LineSelect` · L6550/6703/7069/7254 process_type via `activeProcessTypes()` · L7260 category, L7268 `SIX_BIG_LOSSES`, L7274 `EIGHT_WASTES` (code constants, no DB master) · master-creation forms L6547/6685/7050-7056/7251 (user IS defining the master).
Also noted: L4668/4827 PROD.NO are barcode scans (new order entity) — fine.

---

## src/pages/Report.jsx  (4371 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| R1 | `src/pages/Report.jsx:2273`, `:2274` | **Responsible / Approved** (Revision History of Changing Point Control Record) | person names → `doc_form_revisions.responsible`, `.approved_name` (Main) | `<input>` free text | `profiles` (Main; `issuedBy` at L2214 already uses a `profiles` select) | 🟡 | Same `profiles` select (or `SearchSelect`) as `issuedBy`; store id + snapshot name |
| R2 | `src/pages/Report.jsx:3010` | **ฝ่าย / ส่วน / แผนก / หัวหน้าแผนก** (Multi-skill sheet header) | org division/section/department + head name → print header only (state `dept` default `'Production'`, `section` auto from selected line L2856, `headName` auto from SV L2869) | 4× `<input>` free text | `org_nodes` (Main; `useOrgSections`/`useOrgDepts` are already imported in this file L29) + `profiles` for head | 🟡 (print-only snapshot) | ฝ่าย/ส่วน/แผนก: derive from the selected line via `useOrgSections/useOrgDepts` and render read-only (or `<select>`); หัวหน้าแผนก: `profiles` select |
| R3 | `src/pages/Report.jsx:3027` | **Maker / Checker / Approver name** (Multi-skill signature slots) | person → print only; auto-filled from `profiles` (leader/supervisor/manager by line) L2834-2869 but free-editable | `<input>` free text | `profiles` (Main, with `signature_url`) | 🟡 | `profiles` select restricted by `autoRole`; free edit not needed since signature image is bound to a profile anyway |
| R4 | `src/pages/Report.jsx:3707`, `:3712`, `:3717`, `:3722` | **บันทึกโดย หัวหน้างาน / ผู้จัดการต้นสังกัด / เจ้าหน้าที่ TA / ผจก.ส่วน HRM** (OT allowance form) | person names → print header only (`signerHead` auto from `production_lines.head_name`, others blank) | 4× `<input>` free text | `profiles` (Main) | 🟡 | `profiles` select (+ role filter); note `production_lines.head_name` is itself a free-text master column — see LineSetup (other group) |
| R5 | `src/pages/Report.jsx:3692` | **Cost Center** (OT allowance form) | cost-center code → print only; auto from `production_lines.cost_center` (parent fallback) | `<input>` free text override | `production_lines.cost_center` / `cost_center_rates` (Main) | 🟡 (low) | Render read-only from line master; if override is needed, `<datalist>` of distinct cost centers |
| R6 | `src/pages/Report.jsx:755`, `:1338`, `:1928`, `:3634`, `:4226` | **ไลน์** filter selects (daily / range / 4M / OT allowance / attendance form) | production line filter (value = id or name) | `<select>` with manual `xxxLines.map(l => <option>)` — flat, no hierarchy, no retired-line label | `production_lines` (Main) | 🔵 | `<LineSelect lines={...} valueKey="id"|"name">` — the file already uses it in `FilterBar` (L2318) so these 5 are drift within the same page |
| R7 | `src/pages/Report.jsx:759`, `:938`, `:1154`, `:1342`, `:2320`, `:3641`, `:4247` | **Team** filter | team A/B/C | `<select>` hardcoded `Team A / B / C` (7×) | `org_nodes kind='team'` (Main) — `operator.jsx:1601` already reads teams from org_nodes with A/B/C fallback | 🔵 (low) | Small shared `teamOptions()` helper (org_nodes teams → fallback A/B/C) reused by Report/Checkin/ShiftOrganize |

✅ count: **≈20** — section/dept selects from `useOrgSections/useOrgDepts` (L349/353/747/751/930/934/1139/1334/1924/2308/2313/4233/4240) · L944 employee select · L1143 station select (workstations grouped by line) · L2214 issuedBy (`profiles`) · L2318 `LineSelect` · L3685 workType (derived from `skill_definitions.allowance_type`) · shift/status/year/month/period enums · OT master creation forms L498/499/517/580 (user defines master rows).
Not flagged: L2202/2206 doc_no / revision — this panel **is** the `doc_forms` registry editor (upsert `doc_forms`), L4256 เลขที่เอกสาร F-HR-001 (print header; registry hook is other group's concern).

---

## src/pages/Checkin.jsx  (2067 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| C1 | `src/pages/Checkin.jsx:1237` | **มาช่วยไลน์** (borrow modal) | destination line → `line_helpers.line_id` (Main) | `<select>` manual `toHierarchicalOptions(scopedLines).map(<option>)` | `production_lines` | 🔵 | `<LineSelect lines={scopedLines} valueKey="id">` |
| C2 | `src/pages/Checkin.jsx:1461` | **ไลน์** (header filter) | line filter (id) | `<select>` manual `toHierarchicalOptions(linesForSection)` | `production_lines` | 🔵 | `<LineSelect lines={linesForSection} valueKey="id">` |
| C3 | `src/pages/Checkin.jsx:1953` | **ไลน์** (OT bus-booking modal) | line → filters employees for `ot_night_bookings` | `<select>` manual `otBookLineOptions.map(<option>)` (flat) | `production_lines` | 🔵 | `<LineSelect valueKey="id">` |
| C4 | `src/pages/Checkin.jsx:1961` | **ทีม** (OT bus-booking modal) | team filter | `<select>` hardcoded A/B/C | `org_nodes kind='team'` | 🔵 (low) | shared `teamOptions()` (see R7) |

✅ count: **≈11** — L1653 leave type (`leave_types` master with fallback) · OT task type selects L1796/1822/1858/2004 (`ot_task_types`) · holiday OT period selects L1784/1810/1847/1995 (`otPeriods.js` single source) · L1935 shift · L2047 export section (org, scope-filtered) · L1244 borrow search box.
Not flagged: L1670/1747 remark inputs (free text by design).

---

## src/pages/Management.jsx  (3342 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| M1 | `src/pages/Management.jsx:1199` | **ไลน์ผลิต** (left panel selector) | line (by name) → drives every query on the board | `<select>` manual `toHierarchicalOptions(lines).map(<option>)` | `production_lines` | 🔵 | `<LineSelect lines={lines} valueKey="name">` (lines already scope-filtered at fetch — pass through) |

✅ count: **1** — L2899 4M category (`Man/Machine/Material/Method` — code constant `CAT_META`, matches `four_m_logs.category` check; no DB master). Special-task assignment (L916 `assignSpecialTask`) uses `special_task_types` master via buttons. 4M Man modal fields are radios/checkboxes (no entity typing); description is free text by design.

---

## src/pages/operator.jsx  (2001 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| O1 | `src/pages/operator.jsx:1662` | **Group / กลุ่ม (Line)** — fallback branch when org chart has no groups under the dept | line → `employees.group_name` + `line_id` | `<select>` manual `filterLinesByDept(lines…).map(<option>)` (flat) | `production_lines` | 🔵 (low — fallback path only) | `<LineSelect lines={filterLinesByDept(...)} valueKey="name">` so retired lines / hierarchy behave like elsewhere |

✅ count: **18** — L802 Section/Dept/Group/Team filters (org + legacy lists) · skill master form L1207 category (`SKILL_CAT_META` constant), L1216 division (`divisionsSync`), L1224 section, L1235 allowance type (derived), same 4 on edit L1289-1317 · employee edit: L1527 position (`positions` master via `positionOptionsWith`), L1542 section (org), L1561 dept (org), L1601 team (org_nodes team → A/B/C fallback), L1618 mtn_team (`mtn_teams`), L1647 group (org_nodes line), L1681 bus route (`bus_routes`). L1516/1521 code/name and L1201/1983/1987 labels are master-creation fields.

---

## src/pages/ShiftOrganize.jsx  (988 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| S1 | `src/pages/ShiftOrganize.jsx:868` | **ไลน์ผลิต** (merge-shift modal, scope=line) | line → `shift_merge_events.line_id` (Main) | `<select>` manual `scopedLines.map(<option>)` (flat, shows section in label) | `production_lines` | 🔵 | `<LineSelect lines={scopedLines} valueKey="id">` |

✅ count: **3** — L858 section (scoped org sections) · L948 employee select for `shift_overrides.employee_id` (picker; consider `SearchSelect` when list > 30 — it lists the whole scoped `employees`) · L957 shift. L902/964 reasons are free text by design.

---

## src/pages/ScrapReport.jsx  (669 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| SC1 | `src/pages/ScrapReport.jsx:428` | **ไลน์ \*** | line → `scrap_reports.line_name` (Main) | `<select>` manual `toHierarchicalOptions(lines).map(<option>)` | `production_lines` | 🔵 | `<LineSelect lines={lines} valueKey="name">` |
| SC2 | `src/pages/ScrapReport.jsx:435` | **แผนก** | department → `scrap_reports.dept` | `<input>` free text | `org_nodes kind='department'` (Main) — `useOrgDepts` | 🟡 | Derive from selected line's org path (read-only) or `<select>` from `useOrgDepts(section)` |
| SC3 | `src/pages/ScrapReport.jsx:436` | **ส่วน** | section → `scrap_reports.section` (also put in Telegram notify L340) | `<input>` free text | `org_nodes kind='section'` / `production_lines.section` (Main) | 🟡 | Auto-fill from `lines.find(l=>l.name===line_name).section`, read-only; scope filtering (L89) already uses `lines.section` not this column |
| SC4 | `src/pages/ScrapReport.jsx:437` | **Storage Location** | SAP SLoc → `scrap_reports.storage_location` (Main) | `<input>` free text, no `slocValid()` check | `storage_locations` (DR, `20260902_storage_locations_master.sql`) + `src/utils/storageLoc.js` | 🟡 | `SearchSelect` over `storage_locations` with `allowFree` + `freeHint` "ไม่ได้อยู่ในทะเบียน" (the pattern the migration header prescribes) and `slocValid()` guard |
| SC5 | `src/pages/ScrapReport.jsx:477`, `:478`, `:481`, `:485` | **Part No / Part Name / MAT SAP / Model** (item rows) | product → `scrap_report_items.part_no / part_name / mat_no / model` (Main) | 4× `<input>` free text; a 🔍 button (L482) opens the SAP/BOM picker modal (`applySap`) but typing anything is still accepted | `dr_products` + `bom_items` (DR) — already loaded as `sapOptions` | 🟡 | Make MAT SAP cell a `SearchSelect` (options = `sapOptions`, `allowFree` justified by the "⚠ Master กรอกเลขพาร์ทเป็นหมายเลขเครื่อง" case) and lock part_no/part_name/model to auto-fill unless mat_no is free |
| SC6 | `src/pages/ScrapReport.jsx:528`-`:532` | **ผู้ตรวจสอบ (QC) / ผู้ขออนุมัติ / ผู้อนุมัติ ×3** | persons → `scrap_reports.inspector_name / requester_name / approver_qa_name / approver_pd_name / approver_gm_name` | 5× `<input>` free text | `profiles` (Main, with `signature_url`) / `employees` | 🟡 | `profiles` select per role (QA / PD manager / GM) — same pattern as OJT maker/approver; keep name snapshot column |

✅ count: **3** — L534 status enum · defect codes via `DefectPicker` (`scrap_defect_types`) L506/606 · SAP/BOM picker modal L551.
Not flagged: L487 `CODE_OPTS` A–E, L494 `M_OPTS` 4M cause, L499 `STAGE_OPTS` — codes printed on the paper form FM-PD2-002, no DB master (would be 🔵 only if a master is added later).

---

## src/pages/MorningMeeting.jsx  (1101 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| MM1 | `src/pages/MorningMeeting.jsx:1074` | **ไลน์** (Action Item modal) | line → `meeting_action_items.line_name` (Main; used as filter on the board) | `<select>` manual `viewLines.map(<option>)` (flat) | `production_lines` | 🔵 | `<LineSelect lines={viewLines} valueKey="name" placeholder="— เรื่องรวม —">` |
| MM2 | `src/pages/MorningMeeting.jsx:1086` | **ผู้รับผิดชอบ** | person → `meeting_action_items.assignee` (text; shown in chips, print, Telegram — no join) | `<input>` free text | `profiles` / `employees` (Main) | 🟡 | `SearchSelect` over `profiles` (+ `employees` leaders) storing `assignee_id` + name snapshot — enables "my action items" notification later |

✅ count: **1** — L977 section filter (org). Problem / root cause are free text by design.

---

## src/pages/Improvements.jsx  (1642 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| I1 | `src/pages/Improvements.jsx:1319` | **ไลน์ \*** (project modal) | line → `improvements.line_name` (DR; drives before/after auto-compare queries) | `<select>` manual `lineOptions.map(<option>)` (flat) | `production_lines` | 🔵 | `<LineSelect lines={lineOptions} valueKey="name">` |
| I2 | `src/pages/Improvements.jsx:1261` | **ผู้รับผิดชอบ** (new milestone row) | person → `improvement_milestones.assignee` (DR, text snapshot) | `<input>` free text | `profiles` / `employees` (Main — cross-project, so snapshot is legitimate) | 🟡 | `SearchSelect` over `profiles`; keep text snapshot (profiles are on Main, milestones on DR) |

✅ count: **9** — L840 status · L1255 PDCA phase (constant) · L1325 problem_source enum · L1334 MTN problem types (from `mtn_problem_types` via `mtnProblemTypes`) · L1341 downtime/defect types · L1349 machine (registry + "⚠ ไม่มีในทะเบียน" groups — good pattern) · L1387 product · L1429 target mode · L1446 baseline days.

---

## src/pages/ProductionPlan.jsx (502) · HeijunkaKanban.jsx (2495) · DailyChecker.jsx (66)

No findings. ✅: `ProductionPlan.jsx:373` section filter (org). `HeijunkaKanban.jsx:1087` is a search box. `DailyChecker.jsx` is a tab shell (pickers live in child components outside this group).

---

## src/components/ProblemFixModal.jsx  (174 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| PF1 | `src/components/ProblemFixModal.jsx:145` | **ผู้แก้ไข** | person → `downtime_logs.fix_by` / `defect_logs.fix_by` (DR, via `TABLE[kind]`) — printed on ใบรายงานปัญหาการผลิต | `<input>` free text (default `actorName`) | `profiles` (Main) / `mtn_technicians` (DR) | 🟡 | `SearchSelect` over `profiles` + `mtn_technicians` (the fixer is usually a technician); keep text snapshot since target tables are DR |
| PF2 | `src/components/ProblemFixModal.jsx:155` | **ผู้ตรวจติดตาม** | person → `downtime_logs.followup_by` / `defect_logs.followup_by` (DR) | `<input>` free text | `profiles` (Main) | 🟡 | Same picker; default to current user like `fixBy` |

---

## src/components/QualityBins.jsx  (379 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| QB1 | `src/components/QualityBins.jsx:320`-`:327` | **ชิ้นงาน (เลือกจาก Product Master หรือพิมพ์เอง)** | product → `quality_bin_records.mat_no` (DR) | `<input list="qbin-parts">` datalist of `products.slice(0, 400)` — **silently truncated at 400 rows** and **not filtered by the chosen line**; free text accepted | `dr_products` (DR) | 🟡 | `SearchSelect` over all active `dr_products`, pre-filtered by `getLineFamilyNames(form.line_name)` with fallback to all, `allowFree` + `freeHint` (unregistered parts do happen at the bin) |
| QB2 | `src/components/QualityBins.jsx:331`, `:333` | **ชื่อชิ้นงาน / Part No. (เลขลูกค้า)** | product attrs → `quality_bin_records.part_name / part_no` (auto-filled from product on mat_no match, but free-editable) | 2× `<input>` free text | `dr_products.name / p_no` | 🟡 | Lock (read-only) when `mat_no` matched a product; editable only when mat_no is free |
| QB3 | `src/components/QualityBins.jsx:338`, `:340`, `:347`, `:359` | **ผู้แจ้ง (พนักงาน) / ผู้ตรวจสอบ (QA) / ผู้ดำเนินการซ่อม / ผู้กำจัดทำลาย** | persons → `quality_bin_records.reported_by / qa_by / repair_by / disposed_by` (DR, text) | 4× `<input>` free text | `employees` + `profiles` (Main) | 🟡 | `SearchSelect` over `employees` (line-family filtered for ผู้แจ้ง/ผู้ซ่อม) and `profiles` role QA for ผู้ตรวจสอบ; store name snapshot (cross-project) |
| QB4 | `src/components/QualityBins.jsx:361` | **ตำแหน่ง** (of ผู้กำจัดทำลาย) | position → `quality_bin_records.disposed_position` | `<input>` free text (placeholder "ระดับหัวหน้ากลุ่ม-วิศวกรขึ้นไป") | `positions` (Main, `src/utils/positions.js`) | 🟡 | Auto-fill from the picked person's `employees.position` via `positionLabel()`; or `<select>` from `positionOptionsWith()` |

✅ count: **2** — L229 and L314 `LineSelect` (correct usage, scope-filtered). Cause / repair detail / note are free text by design.

---

## src/components/LinePartCallPanel.jsx  (591 lines)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| LP1 | `src/components/LinePartCallPanel.jsx:542` | **เพิ่มพาร์ทเอง (รหัส)** (ตั้งจุดเรียกเติม) | part code → `line_part_levels.mat_no` (DR) — join key against `line_stock_summary.mat_no`, `wip_replenish_requests`, BOM; a typo here creates a monitored part that never matches any stock row (min alert never fires, silently) | `<input>` free text + "+ เพิ่ม" (`addMat` L499 only dedupes within the list) | `dr_products` / `bom_items` (DR) | 🔴 | `SearchSelect` over `dr_products` ∪ BOM child parts of the line family (`bom_items` via `wipMatOptions`), no `allowFree` (or `allowFree` only with a loud `freeHint`) — keep the existing `q` search box for filtering existing rows |

---

## Summary

| file | 🔴 | 🟡 | 🔵 | ✅ |
|---|---|---|---|---|
| src/pages/DailyReport.jsx | 1 | 1 | 1 | 18 |
| src/pages/Report.jsx | 0 | 5 | 2 (12 elements: 5 line lists + 7 team lists) | ≈20 |
| src/pages/Checkin.jsx | 0 | 0 | 4 | ≈11 |
| src/pages/Management.jsx | 0 | 0 | 1 | 1 |
| src/pages/operator.jsx | 0 | 0 | 1 | 18 |
| src/pages/ShiftOrganize.jsx | 0 | 0 | 1 | 3 |
| src/pages/ScrapReport.jsx | 0 | 5 (11 inputs) | 1 | 3 |
| src/pages/MorningMeeting.jsx | 0 | 1 | 1 | 1 |
| src/pages/Improvements.jsx | 0 | 1 | 1 | 9 |
| src/pages/ProductionPlan.jsx | 0 | 0 | 0 | 1 |
| src/pages/HeijunkaKanban.jsx | 0 | 0 | 0 | 0 (search only) |
| src/pages/DailyChecker.jsx | 0 | 0 | 0 | 0 |
| src/components/ProdProgressStrip.jsx | 0 | 0 | 0 | 0 |
| src/components/ProblemFixModal.jsx | 0 | 2 | 0 | 0 |
| src/components/QualityBins.jsx | 0 | 4 (8 inputs) | 0 | 2 |
| src/components/QualityBinLinkModal.jsx | 0 | 0 | 0 | 0 |
| src/components/WipBetweenSteps.jsx | 0 | 0 | 0 | 0 |
| src/components/LinePartCallPanel.jsx | 1 | 0 | 0 | 0 |
| src/components/LineWipPanel.jsx | 0 | 0 | 0 | 0 |
| src/components/ShiftAutoFillModal.jsx | 0 | 0 | 0 | 0 |
| src/components/DowntimeTimeline.jsx | 0 | 0 | 0 | 0 |
| **Total** | **2** | **19** | **13** | **≈87** |

### Cross-cutting observations
1. **Manual `lines.map(<option>)` still in 11 places** across this group (DailyReport 3517 · Report 755/1338/1928/3634/4226 · Checkin 1237/1461/1953 · Management 1199 · ShiftOrganize 868 · ScrapReport 428 · MorningMeeting 1074 · Improvements 1319 · operator 1662) despite the `LineSelect` rule (2026-08-21). Several of the same files already import/use `LineSelect` elsewhere (Report, DailyReport, QualityBins) — pure drift.
2. **Person-name free text is the dominant 🟡 class (14 inputs)**: ScrapReport ×5, QualityBins ×4, Report ×(3+4+2), ProblemFixModal ×2, MorningMeeting, Improvements. A single shared `PersonSelect` (`SearchSelect` over `profiles` + optional `employees`, returns `{id, name}` and writes name snapshot for DR tables) would close all of them.
3. **`customer` has no master** and is typed as free text in 10 files (only `CustomerDemand.jsx` uses a datalist). It is a grouping key for forecasts/shipping/claims — strongest new-master candidate found in this group.
4. **Team A/B/C** is hardcoded in Report (7×) and Checkin (1×) while `operator.jsx` already reads teams from `org_nodes kind='team'` — one `teamOptions()` helper would unify.
5. Good patterns worth copying: DailyReport L5169 machine `SearchSelect allowFree + freeHint`; Improvements L1349 "⚠ มีในบันทึก แต่ไม่มีในทะเบียน" optgroup; LineSelect retired-line labelling.

# ═══ กลุ่ม B-master ═══

# Audit B — master data & setup (single-source-of-truth entity inputs)

Scope: 24 files (pages: ProductMaster, LineSetup, MachineDatabase, ProcessSetup, OrgSetup, LayoutSetup, Register, AddUser, PermissionsManagement, DocFormsRegistry, CompanyCalendar, NotificationConfig, QrLabels · components: ProcessTypeSetup, TaxonomyManagerModal, CostCenterRatePanel, RoutingPanel, LineFlowPanel, BomTreeView, StorageLocPanel, StorageZonePanel, DeliveryPointPanel, MachineFloorMap, FactoryMiniMap).
Read-only audit; every finding verified by reading the surrounding code and grepping the consumers of the saved column.

Files with **no entity inputs at all** (nothing to flag): `ProcessSetup.jsx` (wrapper), `LayoutSetup.jsx` (tab host), `PermissionsManagement.jsx` (checkbox matrix only), `BomTreeView.jsx`, `MachineFloorMap.jsx`, `FactoryMiniMap.jsx` (display-only), `CompanyCalendar.jsx` (day-type enum from `companyCalendar.js`, no DB master), `ProcessTypeSetup.jsx` (master-creation form only), `StorageLocPanel.jsx` (master-creation; `kind` from `storageLoc.js`), `StorageZonePanel.jsx` (master-creation; parts picker), `DeliveryPointPanel.jsx` (uses `LineSelect`), `QrLabels.jsx` (uses `LineSelect`).

---

## 🔴 Free text where a master exists AND the value is a join key / filter elsewhere

### R1 — `src/pages/ProductMaster.jsx:1904` BOM "ผลิตที่ไลน์ (source line — พาร์ทผลิตเอง 200)"
- Entity: production line → `dr_bom_items.source_line` (DR, text)
- Control: `<input list="bom-source-lines">` (datalist, free text accepted). Datalist source is **not** `production_lines` but the distinct `line_name` values of products loaded at line 1468 (`lineNames`), so a line with no product yet can't even be suggested.
- Master: `production_lines` (Main)
- Why 🔴: `source_line` is used as a grouping/routing key downstream — `HeijunkaKanban.jsx:796,1046,1049,1135` (lot requests grouped by `source_line`, destination of pull), `StoreLotQueue.jsx`, `FlowTower.jsx`, `VSM.jsx`, `PmForecast.jsx`, `OrderTrace.jsx`. A typo ("HDF-1" vs "HDF1") silently creates a phantom line bucket.
- Fix: replace with `<LineSelect lines={lines} value={form.source_line} onChange=…>` (needs `production_lines` selected with `id, name, parent_line_name, section, is_active` — the current query at line 245 only selects `id, name, parent_line_name`). No `allowFree`: empty = purchased part is already the documented convention.

### R2 — `src/pages/MachineDatabase.jsx:448` "ระบบ / พื้นที่ facility *"
- Entity: facility zone → `machines.line_name` (DR) for `equipment_category = facility`
- Control: `<input list="fac-areas">` datalist over `pm_facility_areas.name`, hint text explicitly says "พิมพ์ชื่อระบบใหม่ได้เลย".
- Master: `pm_facility_areas` (DR)
- Why 🔴: the value is matched **by name** against the zone master elsewhere — `MtnMachineLayout.jsx:255-258` (`String(j.line_name).trim().toLowerCase() === zNameKey` to list equipment in a zone) and `Energy.jsx:92-99` (union of `pm_facility_areas.name` + facility `machines.line_name` builds the zone list → a typo produces a duplicate zone).
- Fix: `<select>` (list is short) over `pm_facility_areas`, with a "+ เพิ่มโซนใหม่" action that inserts into `pm_facility_areas` first (same pattern as "+ ประเภทใหม่" for machine types on line 466). If free text must remain, use `SearchSelect allowFree` so the "not in registry" tag is visible.

### R3 — `src/pages/ProductMaster.jsx:1082` "Customer"
- Entity: customer → `dr_products.customer` (DR, text)
- Control: `<input>` free text (placeholder "เช่น FORD"). CSV import (line 628) also writes it raw.
- Master: **NO MASTER** — but this column is already *treated as* the master by other pages: `CustomerDemand.jsx:1091-1106` builds a customer option list from distinct `dr_products.customer`; `PlannerSales.jsx:199,241` matches EDI/forecast rows via `ship_to_plants.customer_name === dr_products.customer`; `customer_shipping_orders.customer`, `qa_customer_claims`, NPI templates are keyed by the same string.
- Why 🔴 (flagged despite "no master"): it is a join key across ≥4 modules and each new spelling ("FORD" / "Ford" / "FORD MOTOR") breaks EDI matching and forecast grouping.
- Fix: create a small `customers` master (DR, `code`, `name`, `is_active`) and use a `<select>`; interim: `SearchSelect allowFree` over distinct `dr_products.customer` ∪ `ship_to_plants.customer_name` so the "not in registry" tag appears. Clearly reusable across ProductMaster / CustomerDemand / PlannerSales / QA claims / NPI.

---

## 🟡 Free text where a master exists but value is display / snapshot only

### Y1 — `src/pages/ProductMaster.jsx:1215` Kanban Standard "MAT.NO *"
- Entity: product → `dr_kanban_standards.mat_no` (DR)
- Control: free `<input>` + 🗂 button that opens `PartsPickModal` over `parts_master` (line 1243) + "not in registry" warning. Free typing still allowed and the pick list is `parts_master`, not `dr_products` (a Kanban Std must reference a product).
- Master: `dr_products` (DR) / `parts_master` (DR)
- Fix: `SearchSelect` over active `dr_products` (mat_no + name), no `allowFree` (Kanban Std for a non-existent product is meaningless).

### Y2 — `src/pages/ProductMaster.jsx:2397` Parts Master "Supplier" · `:2620` Container Types "Supplier" · `src/components/RoutingPanel.jsx:293` "ผู้รับจ้าง *" (`part_routings.vendor_name`)
- Entity: supplier / outsource vendor → `parts_master.supplier`, `container_types.supplier`, `part_routings.vendor_name` (all DR)
- Control: plain `<input>` free text in all three.
- Master: **NO MASTER** (NPI migration `20260907_npi_apqp_main.sql:18,285` explicitly defers "supplier master = เฟส 4"; `maker_name` there is also text).
- Fix: when the phase-4 supplier master lands, all three should become `SearchSelect` over it. Until then at least a shared datalist of distinct existing values so spellings converge. Listed because the same free-text supplier is typed in 4 places (parts, containers, routing, NPI tooling).

### Y3 — `src/pages/LineSetup.jsx:2068` "👨‍🔧 หัวหน้างาน (ใช้ในใบค่าฝีมือ)"
- Entity: person → `production_lines.head_name` (Main)
- Control: `<input type="text">` free (placeholder "เช่น คุณสุวิทชัย ดีทั่ว").
- Master: `employees` / `profiles` (Main)
- Consumer: `Report.jsx:3306-3319` prints the name in the skill-allowance sheet signature box (display only).
- Fix: `SearchSelect` over `profiles.full_name` (or employees with position ≥ leader), `allowFree` acceptable for people without accounts, store snapshot name as today.

### Y4 — `src/pages/OrgSetup.jsx:385-387` "ผู้จัดการต้นสังกัด / เจ้าหน้าที่ TA / ผู้จัดการส่วน HRM"
- Entity: person → `section_signers.manager_name / ta_name / hrm_name` (Main)
- Control: three `<input type="text">` free.
- Master: `profiles` / `employees` (Main)
- Consumer: signature boxes on the printed skill-allowance summary (display only).
- Fix: same as Y3 — `SearchSelect` over profiles, `allowFree` justified (HR/TA staff may not have ESM accounts), keep storing the snapshot name.

### Y5 — `src/pages/DocFormsRegistry.jsx:440` "ชื่อผู้เซ็นประจำ (เว้นว่าง = เซ็นสด)"
- Entity: person → `doc_form_scopes.sig_names[]` (Main)
- Control: `<input list="doc-scope-people">` datalist of `profiles.full_name` (free text accepted).
- Master: `profiles` (Main) — already loaded on line 43 and used as a proper `<select>` for `issued_by` on lines 303/453, so the same list is used two different ways in one modal.
- Fix: `SearchSelect` over `profiles`, `allowFree` justified (a signer may be a manager without an ESM login) — the "not in registry" tag makes the distinction visible.

### Y6 — `src/pages/DocFormsRegistry.jsx:393-394` Revision History "Responsible" / "Approved"
- Entity: person → `doc_form_revisions.responsible / approved_name` (Main, migration `20260730_doc_control_center.sql:21-22`)
- Control: two `<input type="text">` free.
- Master: `profiles` (Main)
- Fix: `SearchSelect` over profiles with `allowFree` (historic revisions carry names of people who left).

### Y7 — `src/pages/AddUser.jsx:761-775` "ตำแหน่งงาน (Position)" → "อื่นๆ (พิมพ์เอง)..."
- Entity: position → `profiles.position` (Main)
- Control: `<select>` from `positionOptions()` (positions master, ✅) **plus** an "อื่นๆ" escape that shows a free `<input type="text">` (line 772).
- Master: `positions` (Main, migration `20260806_positions_master.sql`) — and `levelOfPosition()` / `maintenanceKindOfPosition()` on lines 780-795 derive job level and AM/PM kind from the key, so a custom string silently yields no level and no warning logic.
- Fix: remove the free escape; add "+ เพิ่มตำแหน่งใหม่" that inserts into `positions` (admin already has that right) and then selects it. `Register.jsx:174` does it correctly (no escape).

### Y8 — `src/pages/LineSetup.jsx:2058` "🏷️ Cost Center" · `src/pages/OrgSetup.jsx:435` "Cost Center" · `src/components/CostCenterRatePanel.jsx:262` "Cost Center *"
- Entity: cost-center code → `production_lines.cost_center` (Main), `org_nodes.cost_center` (Main), `cost_center_rates.cost_center` (Main)
- Control: LineSetup and OrgSetup = plain `<input type="text">`; CostCenterRatePanel = `<input list="cc-rate-codes">` datalist over the CC list derived from lines + org nodes (free text accepted on create).
- Master: no dedicated table — the code *originates* on `production_lines`/`org_nodes` and `cost_center_rates` joins by the string (`CostCenterRatePanel.jsx:71,128`; `costSaving.js`, `Improvements.jsx`, `OEEAnalytics.jsx`, `MaterialRequests.jsx`, `materialRequestPrint.js` read it). A rate row typed with a typo is an orphan that no line will ever hit.
- Fix: in CostCenterRatePanel use a `<select>` over `ccList` (it is already computed; only codes that exist on a line/org node can receive a rate). In LineSetup/OrgSetup add a datalist of existing codes so the same CC is reused across lines of one group; a real `cost_centers` master is a candidate if accounting supplies the list.

---

## 🔵 Hardcoded option list / manual `lines.map(<option>)` duplicating a DB master

### B1 — manual production-line dropdowns instead of `<LineSelect>` (LineSelect header explicitly forbids this pattern)
| file:line | field | how it is built today | note |
|---|---|---|---|
| `src/pages/ProductMaster.jsx:1104` | product "ไลน์ผลิตหลัก" → `dr_products.line_name` | `toHierarchicalOptions(lines).map(<option>)` | query at `:245` selects only `id, name, parent_line_name` → no `section`/`is_active` → retired lines still offered, no scope |
| `src/pages/ProductMaster.jsx:726` | list filter "ทุกไลน์" | `uniqueLines` from product rows | filter, low priority; still a flat unscoped list |
| `src/pages/MachineDatabase.jsx:291-306` | filter "ทุกไลน์" | hand-rolled `<optgroup>` from `scopedLines` + `parentChildrenMap` | reimplements hierarchy + scope locally |
| `src/pages/MachineDatabase.jsx:434-444` | form "ไลน์การผลิต *" → `machines.line_name` | same hand-rolled optgroup | join key to `production_lines.name`; hierarchy logic duplicated |
| `src/pages/LineSetup.jsx:1434-1442` | inline "ไลน์หลัก (parent)" → `production_lines.parent_line_name` | `lines.filter(root).map(<option>)` | root-only filter is legit but should go through `lineOptions()`/`LineSelect` with a filtered `lines` prop |
| `src/pages/LineSetup.jsx:1473-1478` | new line "ไม่มีไลน์หลัก (standalone)" | `lines.filter(root && section).map(<option>)` | same |
| `src/components/RoutingPanel.jsx:298-303` | routing step "ไลน์ที่ทำ *" → `part_routings.line_name` | `toHierarchicalOptions(uniq).map(<option>)` | join key used by VSM (`vsmModel.js:136`) |
| `src/components/LineFlowPanel.jsx:178-190` | flow link "ไลน์" → `line_flow_links.from_line/to_line` | manual `<optgroup>` leaf / parent | join key for Heijunka/FlowTower |

Fix for all: `<LineSelect lines={…} value onChange>` (pass a pre-filtered `lines` array where a subset is needed, e.g. roots only, leaf only); make every `production_lines` query select `id, name, parent_line_name, section, is_active`.

### B2 — `MTN_TEAMS` constant used as option source while `mtn_teams` table exists
- `src/pages/NotificationConfig.jsx:362-365` room "ทีม" → `notify_rooms.team`; `src/pages/AddUser.jsx:874-886` "ทีมช่างซ่อม" checkboxes → `profiles.mtn_teams[]`
- Control: `<select>` / checkboxes iterating `MTN_TEAMS = ['jig_maintenance','die_maintenance','maintenance','production']` hardcoded in `src/utils/mtnTeams.js:9`.
- Master: `mtn_teams` (Main, migration `20260722_mtn_teams.sql`), already loaded data-driven by `src/utils/pmTeams.js` (`pmTeamsSync()` with `DEFAULT_TEAMS` fallback). `TaxonomyManagerModal.jsx:173` does it right (teams passed from DB).
- Fix: iterate `pmTeamsSync()` (key + dept_name + icon) in both places; keep `MTN_TEAMS` only as the fallback inside the util.

### B3 — `src/pages/ProductMaster.jsx:2433,2615-2619` Container Types "ประเภท"
- `PKG_CATEGORIES = ['BOX','RACK','BASKET','PALLETTE','Other']` hardcoded + datalist of used values → `container_types.category`.
- Master: none (category is only a display grouping in the packaging list) — listed for completeness; acceptable as-is, low value to change.

---

## ✅ Already pickers (counted, not listed individually)

Notable ✅ items worth a remark:
- `ProductMaster.jsx:1873` BOM "คลังที่เบิก (Stor.Loc.)" — `<select>` over `storage_locations` + explicit "✏️ พิมพ์รหัสเอง" escape with format validation and "ยังไม่อยู่ในทะเบียน" warning: a good model for justified `allowFree`.
- `LineSetup.jsx:1684` WIP mat — `SearchSelect allowFree` over parts registry with `freeHint`: correct per §5.1.1.
- `AddUser.jsx:717-745` employee link — `<select>` of up to 300 employees with a separate search box; works, but is exactly the ">30 rows" case the `SearchSelect` rule targets (convention, not a SSOT issue).
- `DocFormsRegistry.jsx:303,453` `issued_by` — `<select>` of *all* profiles (will exceed 30 rows); same convention remark.

---

## Summary

| file | 🔴 | 🟡 | 🔵 | ✅ |
|---|---|---|---|---|
| src/pages/ProductMaster.jsx | 2 (R1, R3) | 2 (Y1, Y2×2 inputs) | 3 (B1×2, B3) | 8 |
| src/pages/LineSetup.jsx | 0 | 2 (Y3, Y8) | 2 (B1) | 9 |
| src/pages/MachineDatabase.jsx | 1 (R2) | 0 | 2 (B1) | 5 |
| src/pages/ProcessSetup.jsx | 0 | 0 | 0 | 0 |
| src/pages/OrgSetup.jsx | 0 | 2 (Y4, Y8) | 0 | 4 |
| src/pages/LayoutSetup.jsx | 0 | 0 | 0 | 0 |
| src/pages/Register.jsx | 0 | 0 | 0 | 6 |
| src/pages/AddUser.jsx | 0 | 1 (Y7) | 1 (B2) | 7 |
| src/pages/PermissionsManagement.jsx | 0 | 0 | 0 | 0 |
| src/pages/DocFormsRegistry.jsx | 0 | 2 (Y5, Y6) | 0 | 5 |
| src/pages/CompanyCalendar.jsx | 0 | 0 | 0 | 2 |
| src/pages/NotificationConfig.jsx | 0 | 0 | 1 (B2) | 3 |
| src/pages/QrLabels.jsx | 0 | 0 | 0 | 1 |
| src/components/ProcessTypeSetup.jsx | 0 | 0 | 0 | 0 |
| src/components/TaxonomyManagerModal.jsx | 0 | 0 | 0 | 2 |
| src/components/CostCenterRatePanel.jsx | 0 | 1 (Y8) | 0 | 0 |
| src/components/RoutingPanel.jsx | 0 | 1 (Y2 vendor; machine_no see note) | 1 (B1) | 1 |
| src/components/LineFlowPanel.jsx | 0 | 0 | 1 (B1) | 0 |
| src/components/BomTreeView.jsx | 0 | 0 | 0 | 0 |
| src/components/StorageLocPanel.jsx | 0 | 0 | 0 | 1 |
| src/components/StorageZonePanel.jsx | 0 | 0 | 0 | 2 |
| src/components/DeliveryPointPanel.jsx | 0 | 0 | 0 | 1 |
| src/components/MachineFloorMap.jsx | 0 | 0 | 0 | 0 |
| src/components/FactoryMiniMap.jsx | 0 | 0 | 0 | 0 |
| **Total** | **3** | **11 inputs (8 findings)** | **11 inputs (3 findings)** | **57** |

Additional 🟡 note not in a numbered finding: `src/components/RoutingPanel.jsx:307` "หมายเลขเครื่อง (ถ้ามี)" → `part_routings.machine_no` is a free `<input>`; master `machines` (DR) exists; usage is display-only in VSM (`vsmModel.js:136`, `VsmCanvas.jsx:249`, `VSM.jsx:852`) so 🟡 — fix: `SearchSelect` over active `machines` filtered by the selected `line_name` (cascade line → machine), no `allowFree`.

Cross-cutting recommendations (in priority order):
1. R1 + B1: one pass to put `<LineSelect>` on every line dropdown in these files and fix the two `production_lines` queries that omit `section, is_active` (ProductMaster:245, and verify RoutingPanel/LineFlowPanel receive the full column set from ProductMaster/LineSetup).
2. R2: `pm_facility_areas` picker with inline "add zone" — eliminates duplicate-zone drift in Energy and MTN layout.
3. R3 + Y2: decide on `customers` and `suppliers` masters (DR) — both strings are typed in ≥3 pages each today.
4. Y3–Y6: one shared "person picker" (`SearchSelect` over `profiles`, `allowFree`) reused by LineSetup, OrgSetup, DocFormsRegistry.
5. B2: swap `MTN_TEAMS` for `pmTeamsSync()` in NotificationConfig and AddUser.

# ═══ กลุ่ม C-mtn ═══

# Audit C — maintenance / PM / die / fixture · single-source-of-truth for entity inputs (read-only · 2026-09-07)

Scope: 23 files (see summary). Method: grep `<input|<select|<textarea|SearchSelect|datalist|list=|LineSelect|prompt(` then read surrounding code + save payload + downstream consumers (MtnAndonBoard, DieRegistry, PmCoordination, mtnStepPerm, RackMap, improvements).
Masters verified in `supabase/migrations` / `docs/sql`: machines (DR), jigs (DR), mtn_technicians / mtn_teams / mtn_problem_types / mtn_repair_types / mtn_item_types / mtn_spare_parts / mtn_spare_categories / mtn_labor_rates / mtn_rack_cells (DR), die_sets / die_op_types / die_storage_areas (DR), fixture_point_kinds (DR), pm_checking_methods / pm_checkpoint_categories (DR), pokayoke_devices (Main), employees / profiles / production_lines / org_nodes / workstations / cost_center_rates (Main), dr_products / process_types (DR). **No master exists for:** supplier/vendor, model, "press line group" of dies (only `production_lines.line_type=stamping`).

Legend: 🔴 free text + master exists + value is a join key / filter / linkage · 🟡 free text + master exists, display/snapshot only · 🔵 hardcoded list duplicating a master **or** manual `lines.map(<option>)` instead of `<LineSelect>` **or** `window.prompt` for a master value · ✅ counted only.

---

## src/pages/MtnRepair.jsx

| # | file:line | Field (label) | Entity → column | Current control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 1 | `MtnRepair.jsx:579-583` | หมายเลขเครื่อง / หมายเลขแม่พิมพ์ | machine / die → `mtn_orders.machine_no` (text, not id) | `<input list="mtn-mc-list">` datalist (free typing allowed) + 📷 scan | `machines` (DR, `equipment_kind` machine/die) | 🔴 | `machine_no` is the join key used by MtnAndonBoard (`normNo(o.machine_no)` → team / zone match), `improvements` prefill, `supplyByMachineNo`, DieRegistry open-MO status derive (`mtn_orders.machine_no ∈ dies`), OrderTrace. A typo silently breaks all of those. Replace with `SearchSelect` over `lineMachines` (already filtered by line / die kind), `allowFree` **only** with the "⚠ not in registry" tag, and store `machine_id` alongside `machine_no`. |
| 2 | `MtnRepair.jsx:562` | แผนก (PD) | org section → `mtn_orders.dept_section` | `<input>` free (auto-filled from `production_lines.section` on line pick, then editable) | `org_nodes` sections (Main) via `useOrgSections` | 🔴 | `orderInReporterScope()` (`mtnStepPerm.js:143-154`) falls back to `dept_section` for scope gating when the line is unknown (die/support orders) — a typed value can put the order in/out of someone's scope. Make it a `<select>` from `useOrgSections()` (default = line.section, editable only via picker). |
| 3 | `MtnRepair.jsx:561` | ส่วนงาน (ASSY) | org dept/section → `mtn_orders.work_area` | `<input>` free | `org_nodes` (Main) `useOrgDepts`/`useOrgSections` | 🟡 | Print/display only (`:724`, `:810`). Picker from org_nodes (dept level), keep blank allowed. |
| 4 | `MtnRepair.jsx:621` | Cost Center (จากฐานข้อมูลไลน์) | cost center → `mtn_orders.cost_center` | `<input>` free (auto from `production_lines.cost_center` / parent) | `production_lines.cost_center` + `cost_center_rates` (Main) | 🟡 | Only printed today, but MO cost roll-up per CC is the obvious next step. Make read-only derived from line (or `<select>` from distinct `cost_center_rates.cost_center`); drop free edit. |
| 5 | `MtnRepair.jsx:623` | ลูกค้า | customer → `mtn_orders.customer` | `<input>` free | `dr_products.customer` (distinct) / `customer_forecasts` (DR) | 🟡 | Datalist/SearchSelect from distinct `dr_products.customer`. (`โมเดล` → `mtn_orders.model` has **NO MASTER** — leave free.) |
| 6 | `MtnRepair.jsx:625` | ผู้แจ้ง (ผลิต) | person → `mtn_orders.reporter_prod` | `<input>` free (default `fullName`) | `profiles` / `employees` (Main) | 🟡 | Display + **fallback identity** for pre-stamp orders (`isOrderReporter()` `mtnStepPerm.js:84`). Use `SearchSelect` over profiles (scoped to reporter's section); keep `reported_by_name` stamp as the real identity. |
| 7 | `MtnRepair.jsx:626` | ผู้แจ้ง (คุณภาพ) | person → `mtn_orders.reporter_qa` | `<input>` free | `profiles` (role qa) / `employees` | 🟡 | `SearchSelect` filtered to QA section, `allowFree` ok (QA may not have an account yet). |
| 8 | `MtnRepair.jsx:1321` | ผู้รับเรื่อง / จ่ายงาน (หัวหน้าช่าง) | person → `mtn_orders.accepted_by` | `<input>` free (default `fullName`) | `profiles` (mtn_teams) / `employees.mtn_team` | 🟡 | Same `techOpts` grouping already exists for `assigned_to` — reuse it (or profiles of the order's team). |
| 9 | `MtnRepair.jsx:1403` | ชื่อผู้ตรวจรับงาน (ฝ่ายที่แจ้ง) | person → `mtn_orders.checker_name` | `<input>` free | `profiles` / `employees` | 🟡 | `SearchSelect` profiles scoped to the order's line section; signature already comes from profile. |
| 10 | `MtnRepair.jsx:1412` | ชื่อผู้ตรวจ (เจ้าหน้าที่ QA) | person → `mtn_orders.qa_checker` | `<input>` free | `profiles` role qa | 🟡 | `SearchSelect` profiles filtered role/section QA. |
| 11 | `MtnRepair.jsx:1417` | ชื่อผู้รับมอบงาน (หัวหน้าแผนกฝ่ายที่แจ้ง) | person → `mtn_orders.ho_checker` | `<input>` free | `profiles` (supervisor+ of order's section) | 🟡 | Picker of profiles with role ≥ supervisor in the order's section. |
| 12 | `MtnRepair.jsx:1438` | ชื่อผู้อนุมัติ (หัวหน้าแผนก/ส่วน/ผจก.) | person → `mtn_orders.approver_name` | `<input>` free | `profiles` | 🟡 | Same as #11 (role manager/supervisor). |
| 13 | `MtnRepair.jsx:392`, `:559`, `:1490` | ทุกไลน์ (filter) · ไลน์การผลิต (form, required) · KPI line filter | production line → `mtn_orders.line_name` | `<select>` with manual `toHierarchicalOptions(lines).map(<option>)` | `production_lines` (Main) | 🔵 | Replace all three with `<LineSelect lines={lines} …scope>` (LineSelect header says 26 such copies exist; this file has 3). Query at `:260` must also select `is_active` for retired handling. |

Not flagged (by design): `SCOPE_OPTS`, `CHECK_RESULTS`, `QUALITY_OPTS`, `QA_RESULTS`, `FOLLOW_OPTS`, `SAT_*` — hardcoded but no DB master; `:1620` ช่างเฉพาะกิจ name = master creation; `:1739/:1768` SimpleList = master editing; `:1652` labor rate name = master creation.
Observation (not a finding): `assigned_to` / `tech_main` / `tech_secondary` pickers store the technician **name** (`value={t.name}`), not `employees.id` — rename in employees → history splits. Same snapshot pattern as `NAME_CASCADE`.

✅ pickers counted: 19 (fDept, mtn_dept, item_type, problem_group, problem_characteristic, resubDept, repair_type, assigned_to, tech_main, tech_secondary, parts `SearchSelect allowFree` (justified: "พิมพ์เองได้ถ้าไม่มีในคลัง", no stock deduction, tagged), laborRates, ntech dept, tech-row dept, nrate dept, rate-row dept, SimpleList fTeam / nwTeam / row team).

---

## src/pages/PMSetup.jsx (EquipmentModal — writes `jigs` DR)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 14 | `PMSetup.jsx:1075` | ไลน์ / พื้นที่ (manual mode & edit) | production line → `jigs.line_name` | `<input>` free | `production_lines` (Main) — already loaded into `lineOptions` at `:491` | 🔴 | `jigs.line_name` is the grouping/scope key in DailyPM (`groupBy line`, `assignJigLine`), PMSchedule, PmForecast, FactoryMap PM mode. Use `<LineSelect>` with `allowFree`-style "⚠ not in registry" only for Utility Room-type areas (or add those as `pm_facility_areas` picker). |
| 15 | `PMSetup.jsx:1069` (row `Machine No.`) | Machine No. (manual mode) | machine → `jigs.machine_no` (with `machine_id` = null) | `<input>` free | `machines` (DR) — `machineOptions` loaded at `:486` | 🔴 | `machine_no` is matched by MtnAndonBoard (`j.machine_no`), PmCoordination (`jigs.machine_id/machine_no`), FactoryMap. In manual mode the link is lost. Use `SearchSelect` over `machineOptions` that also sets `machine_id`; workstation mode already does this at `:597-599`. |
| 16 | `PMSetup.jsx:1064` (row `Process`) | Process | process type → `jigs.process` | `<input>` free (ph "Welding") | `process_types` (DR) via `src/utils/processTypes.js` | 🟡 | `<select>` from `processTypes` (key stored, label shown). |
| 17 | `PMSetup.jsx:1066-1067` (rows `Part Name`, `Part No.`) | Part Name / Part No. | product → `jigs.part_name`, `jigs.part_no` | `<input>` free ×2 | `dr_products` (`name`, `p_no`, `mat_no`) (DR) | 🟡 | One `SearchSelect` on dr_products (by mat_no/name/p_no) that fills both; `allowFree` for tooling that serves multiple parts. (`Model` → **NO MASTER**, leave.) |
| 18 | `PMSetup.jsx:1110-1116` | นับยอดจากไลน์ | production line → `pm_plans.usage_line` | `<select>` manual `toHierarchicalOptions(lineOptions).map` | `production_lines` | 🔵 | `<LineSelect lines={lineOptions} includeRetired current=…>` (comment says intentionally unscoped — LineSelect supports that by omitting scope props). Query `:491` lacks `section,is_active`. |
| 19 | `PMSetup.jsx:1020-1029` + `src/lib/pmSchedule.js:24` | ประเภทอุปกรณ์ (JIG / Die / Machine) | equipment kind → `jigs.equipment_type` | button group from `EQUIP_TYPE_LABEL` {jig,die,machine} | parallel taxonomy in `src/utils/equipmentKinds.js` `EQUIPMENT_KINDS` {machine,die,jig,facility} = `machines.equipment_kind` (DR) | 🔵 | Two enums for the same axis (`jigs.equipment_type` vs `machines.equipment_kind`); `inferEquipType()` at `:42` guesses from the station code. Derive from the picked machine's `equipment_kind` and render from `EQUIPMENT_KINDS`. |

Not flagged: `:313` checkpoint name / `:314` group datalist (derived from this checklist's own groups — no master; acceptable), `:1051` equipment name, FREQ / plan-type buttons (no master), `CATEGORY_TYPE_META` production/facility/utility (no master).
✅ counted: 4 (category ← `pm_checkpoint_categories`, checking_method ← `pm_checking_methods`, moveTo ← pm teams, machine `<select>` ← machines in workstation mode).

---

## src/pages/PmCoordination.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 20 | `PmCoordination.jsx:387-391` | เครื่องจักร (พิมพ์/เลือกหมายเลขเครื่อง) | machine → `pm_coordination_plans.machine_no` + `machine_id` (resolved only on exact case-insensitive match, `:312-319`) | `<input list="pmcoord-mach">` datalist | `machines` (DR) | 🔴 | Non-matching text ⇒ `machine_id = null` silently (only a small ✓ hint when matched). `SearchSelect` over `machOpts` (id + no + line), `allowFree` not justified here (plans are for registered machines). |
| 21 | `PmCoordination.jsx:396-401` | ไลน์ | production line → `pm_coordination_plans.line_name` | `<select>` manual `toHierarchicalOptions(lines.filter(scope)).map` | `production_lines` | 🔵 | `<LineSelect lines={lines} role lineId sections>` (scope filter is what LineSelect already does). |

✅ counted: 2 (pm_plan link select, task team ← `pmTeams`).

---

## src/pages/PMSchedule.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 22 | `PMSchedule.jsx:394` | ตกลงร่วมกับ (planner / production) | person → `pm_plans.defer_agreed_with` (+ history `agreed_with`) | `<input>` free | `profiles` (Main; roles planner/supervisor) | 🟡 | `SearchSelect` on profiles (role planner_store / supervisor / manager); `allowFree` acceptable for phone agreements. |

✅ counted: 0.

---

## src/pages/PokaYokeCheck.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 23 | `PokaYokeCheck.jsx:138` | ผู้ตรวจ | person → `pokayoke_checks.checker_name` | `<input>` free (default `fullName`) | `profiles` / `employees` (Main) | 🟡 | Picker of employees on `selLine` (station operators) with `fullName` default; keep snapshot name column. |
| 24 | `PokaYokeCheck.jsx:211` | จุดงาน/ตำแหน่ง (device registry) | workstation → `pokayoke_devices.station` | `<input>` free | `workstations` (Main, per line) | 🟡 | `<select>` from `workstations` filtered by `dEditing.line_name`; `allowFree` for devices not on a station. |
| 25 | `PokaYokeCheck.jsx:126-130` | ไลน์ / พื้นที่ | production line → `pokayoke_devices.line_name` / `pokayoke_checks.line_name` | `<select>` manual `toHierarchicalOptions(visibleLines).map` | `production_lines` | 🔵 | `<LineSelect>` (scope logic at `:44-49` duplicates `scopeLines()` from LineSelect.jsx). |

Not flagged: `:133` shift (no master), `:208-209` code/name (device master creation), `:212` test_method, `:214` master_ref (free by design).
✅ counted: 0.

---

## src/pages/DailyPM.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 26 | `DailyPM.jsx:449-466` | 📍 เลือกไลน์ให้เครื่องนี้… / ย้ายไลน์ | production line → `jigs.line_name` (`assignJigLine`) | `<select>` manual `toHierarchicalOptions(scopedProdLines).map` ×2 (incl. hand-rolled "unknown current value" option at `:462`) | `production_lines` | 🔵 | `<LineSelect lines value={line} current>` — the unknown-value fallback at `:462` is exactly what LineSelect guarantees (#4 in its header). |

✅ counted: 0.

---

## src/pages/DieRegistry.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 27 | `DieRegistry.jsx:569-574` | MAT SAP (hint "ผูกกับ Product Master") | product → `die_sets.mat_no` | `<input list="die-mat-list">` datalist (free typing) | `dr_products.mat_no` (DR) | 🔴 | Explicit join key to Product Master (used by VSM / golden-thread linkage 060/061 and `pieces_per_stroke` roll-ups). Use `SearchSelect` (mat_no / name / p_no) and auto-fill `part_name` + `part_no` from the product. |
| 28 | `DieRegistry.jsx:580-585` | ไลน์ / กลุ่มเครื่องปั๊ม | press line group → `die_sets.line_name` (also `machines.line_name` for dies) | `<input list="die-line-list">` datalist built from **existing** `sets`/`dies` names (self-referential, `:174-179`) | `production_lines` (Main) exists but die values like `LINE A ( 800 Ton )` are not registered there (per comment `:170`, `MtnRepair.jsx:455-458`) | 🔴 | `line_name` is the scope key (`inScope()`), the filter at `:418`, and how MO/Andon/Factory-map link dies to a press. Either register press groups in `production_lines` (`line_type='stamping'`) and use `<LineSelect>` with retired/unknown handling, or add a `die_press_lines` master — stop typing it per set. |
| 29 | `DieRegistry.jsx:561`, `:565` | ชื่อพาร์ท / ชื่อชุด · เลขพาร์ท (P/N ลูกค้า) | product → `die_sets.part_name`, `die_sets.part_no` | `<input>` free ×2 | `dr_products.name`, `dr_products.p_no` (DR) | 🟡 | Auto-fill from #27 pick, editable only when no mat_no. (`รุ่น / Model` `:576` → **NO MASTER**.) |
| 30 | `DieRegistry.jsx:418-421` | ทุกไลน์ (filter) | press line group | `<select>` manual `dieLineNames.map` | see #28 | 🔵 | Follows #28 — once press lines are a master, use `<LineSelect>`. |

Not flagged: `:645` ชื่อ OP (as written on die — free), numeric fields, notes.
✅ counted: 4 (filterKind ← `DIE_SET_KINDS`, kind, die_set_id, op_type ← `die_op_types`).

---

## src/pages/FixtureRegistry.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 31 | `FixtureRegistry.jsx:242-244` | สร้างจุดจากแม่แบบ — ชนิดจุด | point kind → `fixture_points.kind_code` | `window.prompt()` where user must type the code (`locator_pin` …) | `fixture_point_kinds` (DR) — already loaded into `kinds` and used as a proper `<select>` at `:573` | 🔵 | Replace the prompt chain (`kind`, count, prefix) with a small modal using the same `<select>` as `:573`. |

Not flagged: `:570` point_no, `:587` name, numeric/notes.
✅ counted: 2 (fixture `<select>` ← machines `equipment_kind='jig'`, kind_code ← `fixture_point_kinds`).

---

## src/components/SparePartMaster.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 32 | `SparePartMaster.jsx:626-627` | ตำแหน่งชั้นวาง | rack cell → `mtn_spare_parts.shelf` | `<input list="spare-shelf-opts">` datalist built from **existing parts' shelf values** (`:116`), not from the rack master | `mtn_rack_cells.shelf_code` (DR, migration `20260805_rack_map.sql`) | 🔴 | `shelf` is the join key RackMap uses to place parts in cells (`RackMap.jsx:183-190` "unplaced" = shelf not in `mtn_rack_cells`). Typos create phantom shelves. `SearchSelect` over `mtn_rack_cells` (rack name · shelf_code), filtered by the part's team/section; `allowFree` only with the ⚠ tag. |
| 33 | `SparePartMaster.jsx:629` | ใช้กับ (เครื่อง/จิ๊ก) | machines/jigs → `mtn_spare_parts.used_with` (comma text) | `<input>` free (ph "RB-104, จิ๊ก APRON") | `machines` (DR) | 🟡 | Used only for search/sub-label today, but it is the natural link "which machine consumes this part" for MTBF/spare forecasting. Multi-pick `SearchSelect` over machines storing an array (`used_with_machine_ids`), keep text for display. |
| 34 | `SparePartMaster.jsx:641` | ผู้ขาย | supplier → `mtn_spare_parts.supplier` | `<input>` free | **NO MASTER** — same free text appears in purchase slips (`PurchaseBulkModal.jsx:50` `purchase_slips.supplier`) | 🟡 (candidate master) | Reused across ≥2 modules → candidate `mtn_suppliers` master (name, lead time, contact); until then a datalist of distinct existing values. |

Not flagged: `:587-590` name/code/mat_no/part_no (this *is* the spare-part master form), `:638` unit, `:1065-1067` category creation, notes.
✅ counted: 11 (fTeam, fSection ← org_nodes, fCat, fRank, fState, team, section, category ← `mtn_spare_categories`, rank_override, impSection, category-row team).

---

## src/components/FixtureClassify.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 35 | `FixtureClassify.jsx:129-134` | ทุกไลน์ (filter) | production line (filter only) | `<select>` manual `lineOpts.map` (distinct `machines.line_name`, `:49`) | `production_lines` | 🔵 | Filter-only, low impact; `<LineSelect>` with `current` for names not in registry. |

✅ counted: 1 (kind ← `EQUIPMENT_KINDS`).

---

## Files with no findings

| File | Notes | ✅ |
|---|---|---|
| `src/pages/MtnMachineLayout.jsx` | `:314` `window.prompt` = creating a new `pm_facility_areas` row (master creation) — OK | 0 |
| `src/pages/PMCheckData.jsx` | only notes / action / reject-reason textareas | 0 |
| `src/pages/PmForecast.jsx`, `src/pages/PmHub.jsx` | read-only | 0 |
| `src/pages/RackCenter.jsx` | uses `<LineSelect>` ×2 (`:286`, `:518`), container type ← `container_types`; `:593` scan input is a search box | 3 |
| `src/components/DieLayout.jsx` | area `<select>` ← `die_storage_areas`; `:630` = area master creation | 1 |
| `src/components/DieStatusEditor.jsx` | status ← `DIE_STATUSES` (no DB master); note free | 1 |
| `src/components/DieStatusBoard.jsx` | `<LineSelect>`; status ← `DIE_STATUSES`; `:94` prompt is a free note | 2 |
| `src/components/FixtureShimPanel.jsx` | point ← fixture_points, action/reason ← `SHIM_ACTIONS`/`SHIM_REASONS` (no DB master); numerics/notes | 3 |
| `src/components/MtnAndonBoard.jsx` | display only | 0 |
| `src/components/PurchaseBulkModal.jsx` | only a numeric "take" input; reads `purchase_slips.supplier` (see #34) | 0 |
| `src/components/RackMap.jsx` | rack ← `mtn_racks`, team ← pmTeams, section ← org_nodes; `:554` prefix / `:622` name = master creation | 3 |
| `src/components/EventComments.jsx` | mention picker = searchable list from RPC `list_mention_users` | 1 |

---

## Cross-cutting notes

1. **`machine_no` as text join key** (findings #1, #15, #20): three separate forms let users type a machine number with a datalist/free input, while MtnAndonBoard, DieRegistry, PmCoordination, improvements and OrderTrace all join on `normNo(machine_no)`. One `MachineSelect` (SearchSelect wrapper over `machines`, sets both `machine_id` + `machine_no`, kind-aware machine/die/jig) would close all three.
2. **Person names as free text** (#6–#12, #22, #23): 9 name columns in `mtn_orders` alone. They are snapshots (fine to keep as text), but the *input* should be a profile/employee picker so names are spelled consistently for KPI grouping (e.g. per-technician satisfaction) — `techOpts` grouping in MtnRepair is the pattern to reuse.
3. **Manual line dropdowns** (#13, #18, #21, #25, #26, #30, #35): 9 `<select>`s across 7 files re-implement `toHierarchicalOptions(...).map(<option>)`; LineSelect.jsx header explicitly forbids this. Several queries feeding them omit `is_active` (`MtnRepair.jsx:260`, `PMSetup.jsx:491`, `DieRegistry.jsx:112`, `PmCoordination`), so retired lines still appear.
4. **Die press-line identity** (#28): the die domain uses a line taxonomy (`LINE A ( 800 Ton )`) that exists in no master; every consumer works around it (MtnRepair lists *all* dies unfiltered, DieRegistry derives names from its own rows). Registering press groups (production_lines `line_type='stamping'` or a `die_press_lines` table) is the prerequisite for dies to participate in the golden-thread linkage.
5. **Candidate new masters** (only where typed repeatedly across pages): supplier (#34, also purchase slips); nothing else clearly reusable — `model` (MtnRepair, PMSetup, DieRegistry) is typed in 3 places but has no obvious owner table yet.

---

## Summary

| File | 🔴 | 🟡 | 🔵 | ✅ |
|---|---|---|---|---|
| src/pages/MtnRepair.jsx | 2 | 10 | 1 (3 selects) | 19 |
| src/pages/MtnMachineLayout.jsx | 0 | 0 | 0 | 0 |
| src/pages/PMSetup.jsx | 2 | 2 | 2 | 4 |
| src/pages/PMSchedule.jsx | 0 | 1 | 0 | 0 |
| src/pages/PMCheckData.jsx | 0 | 0 | 0 | 0 |
| src/pages/DailyPM.jsx | 0 | 0 | 1 (2 selects) | 0 |
| src/pages/PmCoordination.jsx | 1 | 0 | 1 | 2 |
| src/pages/PmForecast.jsx | 0 | 0 | 0 | 0 |
| src/pages/PmHub.jsx | 0 | 0 | 0 | 0 |
| src/pages/DieRegistry.jsx | 2 | 1 | 1 | 4 |
| src/pages/FixtureRegistry.jsx | 0 | 0 | 1 | 2 |
| src/pages/PokaYokeCheck.jsx | 0 | 2 | 1 | 0 |
| src/pages/RackCenter.jsx | 0 | 0 | 0 | 3 |
| src/components/DieLayout.jsx | 0 | 0 | 0 | 1 |
| src/components/DieStatusEditor.jsx | 0 | 0 | 0 | 1 |
| src/components/DieStatusBoard.jsx | 0 | 0 | 0 | 2 |
| src/components/FixtureClassify.jsx | 0 | 0 | 1 | 1 |
| src/components/FixtureShimPanel.jsx | 0 | 0 | 0 | 3 |
| src/components/SparePartMaster.jsx | 1 | 2 | 0 | 11 |
| src/components/MtnAndonBoard.jsx | 0 | 0 | 0 | 0 |
| src/components/PurchaseBulkModal.jsx | 0 | 0 | 0 | 0 |
| src/components/RackMap.jsx | 0 | 0 | 0 | 3 |
| src/components/EventComments.jsx | 0 | 0 | 0 | 1 |
| **Total** | **8** | **18** | **9** | **57** |

# ═══ กลุ่ม D-qa ═══

# Audit D — quality / PE / NPI / audits / training (read-only · 2026-09-07)

Scope: 25 files. Method: grep `<input|<select|<textarea|SearchSelect|datalist|list=|LineSelect` then read surrounding code + save payload + downstream consumers (join keys) for every hit.
Severity: 🔴 free text where master exists AND value is a join key / filter elsewhere · 🟡 free text where master exists but only display/snapshot (or the picker exists but is not the mandated shared one) · 🔵 hardcoded option list duplicating a DB master · ✅ counted only.

Files with **no findings** (nothing but genuine free text / search boxes / proper pickers): `QaFmeBoard.jsx` (0 inputs), `QaFmeQueue.jsx`, `PeFlowChart.jsx` (0 inputs), `PeChangeRequests.jsx` (selects are app enums DOC_LABEL/LEG_META, not DB masters), `CapaEffectiveness.jsx` (defect type `<select>` from `defect_types` ✅), `SymptomSearch.jsx` (search box), `QaCheckSheet.jsx` (part `<select>` from `qa_parts` ✅; inspector = `fullName` from context).

---

## src/pages/QualityControl.jsx

| # | file:line | Field (label) | Entity → column | Current control | Master (project) | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 1 | `QualityControl.jsx:1305` | ไลน์ผลิต (CAPA / 8D modal) | production line → `qa_capa.line_name` | `<input type=text>` free | `production_lines` (Main) | 🔴 | `<LineSelect>` with role/lineId/sections scope. **Join key**: `CapaEffectiveness.jsx:132` does `.eq('line_name', capa.line_name)` on `production_sessions`; also `matchDocSet(sets, partNo, lineName)` in `PeChangeRequests.jsx:114`. A typo silently yields "no data" for effectiveness. |
| 2 | `QualityControl.jsx:1301` | เลขพาร์ท (ใช้หาเอกสาร PFMEA/Control Plan) | part → `qa_capa.part_no` | `<input type=text>` free (placeholder `MB3B-8C306-BE`) | `pe_doc_sets.part_no` (Main) / `dr_products.p_no` & `mat_no` (DR) / `qa_parts` (Main) | 🔴 | `SearchSelect` over `pe_doc_sets` (+ `dr_products` p_no/mat_no as keywords), `allowFree` justified for parts without a PE set yet (show "not in registry" tag). Join key: `matchDocSet` (PE change requests) and `CapaEffectiveness.jsx:177` part matching. |
| 3 | `QualityControl.jsx:1296` | ผู้รับผิดชอบ (CAPA owner) | person → `qa_capa.owner_name` | `<input type=text>` free | `profiles` (Main) | 🟡 | `SearchSelect` over `profiles.full_name` (allowFree not needed — owner must be a system user to get notifications later). |
| 4 | `QualityControl.jsx:1005` | Part No. (เปิด NCR) | part → `qa_ncr.part_no` | `<input type=text>` free | `qa_parts` / `pe_doc_sets` (Main), `dr_products` (DR) | 🟡→🔴 | Same picker as #2. Note the NCR part_no is **copied into CAPA** on `openCapaFromNcr` (and `QaClaims.jsx:145`), so it becomes the 🔴 join key downstream. |
| 5 | `QualityControl.jsx:1006` | Part Name (NCR) | part name → `qa_ncr.part_name` | `<input type=text>` free | same as #4 | 🟡 | Auto-fill from the part picker; keep read-only or editable snapshot. |
| 6 | `QualityControl.jsx:828-829` | Part No. * / Part Name (จุดควบคุม SPC) | part → `qa_characteristics.part_no/part_name` | `<input type=text>` free | `qa_parts` (Main) — the QA part master built in `/qa-setup` | 🟡 | `SearchSelect` over `qa_parts` (then `dr_products`) and auto-fill part_name; `part_no` groups the SPC chart list so typos split the same part into two groups. |
| 7 | `QualityControl.jsx:848` | เครื่องมือวัด (gauge) | instrument → `qa_characteristics.gauge` | `<input type=text>` free (placeholder `Vernier VC-001`) | `qa_instruments` (Main — same page, tab "เครื่องมือวัด") | 🟡 | `SearchSelect` over `qa_instruments` (code · name), store code; `allowFree` acceptable for instruments not yet registered. Links SPC to calibration status. |
| 8 | `QualityControl.jsx:832-836` | ไลน์ผลิต (SPC characteristic modal) | line → `qa_characteristics.line_name` | `<select>` with manual `toHierarchicalOptions(lineObjs).map(<option>)` | `production_lines` | 🟡 (LineSelect drift) | Replace with `<LineSelect lines={lineObjs} …>` — no scope filter, retired lines still listed. |
| 9 | `QualityControl.jsx:998-1002` | ไลน์ผลิต (NCR modal) | line → `qa_ncr.line_name` | `<select>` manual map (scoped by `scopedLineNames`) | `production_lines` | 🟡 (LineSelect drift) | `<LineSelect>` (already handles section scope + leader family; drop the hand-rolled filter). |
| 10 | `QualityControl.jsx:1564-1568` | ไลน์ (instrument modal) | line → `qa_instruments.line_name` | `<select>` manual map | `production_lines` | 🟡 (LineSelect drift) | `<LineSelect>`. |
| 11 | `QualityControl.jsx:1557` | ชนิด (instrument type) | category → `qa_instruments.inst_type` | `<input type=text>` free (placeholder `caliper / micrometer / torque`) | **NO MASTER** | 🟡 (candidate) | Repeated category typed per row → small master (`qa_instrument_types`) or at least `<datalist>` of distinct existing values. Mention only; low priority. |
| 12 | `QualityControl.jsx:1562` | ตำแหน่ง/แผนก (instrument location) | department/location → `qa_instruments.location` | `<input type=text>` free | `org_nodes` (Main) via `useOrgDepts` | 🟡 | `<select>` from `useOrgSections/useOrgDepts`, allowFree for physical spots ("ห้อง CMM"). |

Also seen: `QualityControl.jsx:445` line filter and `:450` product filter are `<select>` built from the loaded sessions/orders (filters, acceptable); `:651` characteristic select ✅. NCR `source`/`severity`/`disposition` selects are app enums (not DB masters) — not flagged.

## src/pages/QAInspectionSetup.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 13 | `QAInspectionSetup.jsx:948-952` | ไลน์ผลิต (Part modal) | line → `qa_parts.line_name` | `<select>` manual `toHierarchicalOptions(lines).map(<option>)`; query selects only `id, name, parent_line_name` (no `section`, `is_active`) | `production_lines` | 🟡 (LineSelect drift) | `<LineSelect>` + select `id, name, parent_line_name, section, is_active`. `qa_parts.line_name` is used to scope parts in `QaCheckSheet` (`scopedParts`) → wrong name = part invisible to inspectors. |
| 14 | `QAInspectionSetup.jsx:945` | ลูกค้า | customer → `qa_parts.customer` | `<input type=text>` free | **NO MASTER** (customer is a text column on `dr_products`, `pe_doc_sets`, `npi_projects`, `qa_claims`, `kanban_standards`…) | 🟡 (candidate) | Cross-page repeated entity → candidate `customers` master (see summary note). Short-term: `<datalist>` of distinct `dr_products.customer`. |
| 15 | `QAInspectionSetup.jsx:1027` | วิธี / เครื่องมือตรวจ (check item) | instrument/method → `qa_check_items.method` | `<input type=text>` free (placeholder `Vernier / CF / Visual`) | `qa_instruments` (Main) | 🟡 | `SearchSelect` over `qa_instruments` with `allowFree` for methods that are not instruments (Visual). |

✅: `:917` BOM/Product Master search-and-fill for Part No. (custom list from `dr_products` + `bom_items`) — good pattern; `part_no` remains editable text after fill (acceptable, qa_parts *is* the master being defined). Stage/rank/kind selects are app enums.

## src/pages/EventLog.jsx (CQI-15)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 16 | `EventLog.jsx:394` | Station Number | machine/station (placeholder `SP-67` = machine_no pattern) → `cqi15_event_logs.station_number` | `<input type=text>` free | `machines` (DR: `machine_no`, `line_name`) / `workstations` (Main) | 🟡 | `SearchSelect` over DR `machines` filtered by the selected `form.line_name` (family via `getLineFamilyNames`), `allowFree` for stations without a machine record. Exported to the CQI-15 report (`:607-608`), so consistency matters for customer audits. |
| 17 | `EventLog.jsx:398` | Weld Cell Operator | employee → `cqi15_event_logs.weld_cell_operator` | `<input type=text>` free (placeholder "ชื่อพนักงาน") | `employees` (Main) | 🟡 | `SearchSelect` over `employees` filtered by line family (`employees.line_id`) / present today (`daily_production_logs`); store name snapshot (+ optionally `employee_id`). |

✅ 2: `<LineSelect>` at `:387`; Event `<select>` from `cqi15_event_definitions` at `:405`.

## src/pages/LayerProcessAudit.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 18 | `LayerProcessAudit.jsx:983` | Station ที่ตรวจ (audit) | workstation → `lpa_audits.station` | `<input type=text>` free (placeholder "ตามแผน / ระบุเอง") | `workstations` (Main) — the page already fetches them (`fetchStationNames` `:195-208`) | 🟡 | `<select>`/`SearchSelect` of the plan's station list ∪ `workstations` of the line family, `allowFree` for ad-hoc stations. |
| 19 | `LayerProcessAudit.jsx:937` | สถานี (plan day rows) | workstation → `lpa_plan_days.station` | `<input type=text>` free per day | `workstations` (Main) | 🟡 | `<datalist>`/`SearchSelect` from `qHeader.stations` (already parsed) — the header already has "ดึงจากจุดงาน" button; the per-day cell should pick from that list. |
| 20 | `LayerProcessAudit.jsx:988` | ผู้ตรวจ (auditor) | person → `lpa_audits.auditor_name` (+ `auditor_sig_url`) | `<input type=text>` free (default `fullName`) | `profiles` (Main, loaded at `:162` with `signature_url`) | 🟡 | `<select>` over `profiles` (like `OjtTraining` `NameSel`) so the signature auto-fills from the picked profile instead of only "my profile". |
| 21 | `LayerProcessAudit.jsx:879` (+datalist `:884`) | Leader / Supervisor / Manager / GM Plant (plan header) | person → `lpa_plans.leader_name/supervisor_name/manager_name/gm_name` | `<input list="lpa-profiles">` (datalist — free text with suggestions) | `profiles` (Main) | 🟡 | `SearchSelect` over `profiles` (no allowFree — these are the 4 audit layers and appear on the printed FM-QMR-008); datalist accepts any spelling. |
| 22 | `LayerProcessAudit.jsx:821-824`, `:1150-1154`, `:1229-1233` | เลือกไลน์ (3 places: main line picker, question scope filter, question editor line) | line → `selLine`, `lpa_questions.line_name` | `<select>` manual `toHierarchicalOptions(...).map(<option>)` | `production_lines` | 🟡 (LineSelect drift ×3) | `<LineSelect>` (query at `:160` lacks `is_active`). |

## src/pages/OjtTraining.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 23 | `OjtTraining.jsx:612` | ผู้สอนงาน (trainer) | person → `ojt_trainings.trainer_name` | `<input type=text>` free (default `fullName`) | `profiles` (loaded `:121`) / `employees` (loaded `:141`) | 🟡 | Reuse the page's own `NameSel` (profiles `<select>` with ✍️) or `SearchSelect` over `employees ∪ profiles`; printed on FM-HRM-004 and copied to every attendee's `evaluator_name` (`:221`). |
| 24 | `OjtTraining.jsx:691` | ผู้ประเมิน (per attendee) | person → `ojt_training_attendees.evaluator_name` | `<input type=text>` free | `profiles` / `employees` | 🟡 | Same picker as #23 (default = trainer). |
| 25 | `OjtTraining.jsx:582` | ฝ่าย (dept) | org department → `ojt_trainings.dept` | `<input type=text>` free | `org_nodes` (Main) via `useOrgDepts` | 🟡 | `<select>` from `useOrgDepts()` (top-level "ฝ่าย" nodes), consistent with the ส่วน/แผนก selects right below it (`:585`, `:602`) which already use org data. |

✅ 4: maker/approver/hr `NameSel` from `profiles` (`:474-480`), section `<select>` from org sections (`:585`), department `<select>` (`:602`), attendee search-add from `employees` (`:642`).

## src/pages/BbsCheck.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 26 | `BbsCheck.jsx:426` | รหัสพนักงาน (inspector code) | employee code → `bbs_sheets.inspector_code` | `<input>` free (placeholder `61234`) | `employees.employee_id_code` (Main) | 🟡 | Auto-fill from `employees` where `name = selected profile full_name` (or add `employee_id` to `profiles` link); keep editable fallback. |
| 27 | `BbsCheck.jsx:386-389` | ไลน์ | line → `selLine` (line id) | `<select>` manual `toHierarchicalOptions(...).map(<option>)` (value = `l.id`) | `production_lines` | 🟡 (LineSelect drift) | `<LineSelect valueKey="id">`. |

✅ 2: inspector `<select>` from `profiles` with signature (`:417`), agreement `<select>` from `bbs_agreements` (`:479`).

## src/pages/PEDocs.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 28 | `PEDocs.jsx:592` | MAT SAP | product → `pe_doc_sets.mat_no` | `<input type=text>` free (placeholder "เลขภายใน (โยงข้อมูลผลิต)") | `dr_products.mat_no` (DR) | 🔴 | `SearchSelect` over `dr_products` (mat_no · name · p_no; keywords = customer). **Join key** in `peRouting.js:62`, `VSM.jsx:114`, `OrderTrace.jsx:574`, `AdoptionOutlook.jsx:742`, `NPI.jsx:127/239` — the whole golden-thread PE↔production linkage hangs on this text. |
| 29 | `PEDocs.jsx:674-675` | เครื่อง (process modal) | machine → `pe_processes.machine_no` | `<input list="pe-machines">` datalist from DR `machines` | `machines` (DR) | 🟡→🔴 | `SearchSelect` over `machines` filtered by `procModal.line_name` family, `allowFree` (with tag) for machines not yet registered. Value flows into `part_routings.machine_no` via `PeRoutingSuggest` (`peRouting.js:41,88`) → VSM box. Datalist does not validate. |
| 30 | `PEDocs.jsx:595` | Customer | customer → `pe_doc_sets.customer` | `<input type=text>` free | **NO MASTER** (see #14) | 🟡 (candidate) | `<datalist>` of distinct `dr_products.customer` until a master exists. |
| 31 | `PEDocs.jsx:868-870` | ผู้ออก / ผู้ตรวจสอบ / ผู้รับรอง (revision) | persons → `pe_doc_revisions.issued_by/checked_by/approved_by` | `<input type=text>` free ×3 | `profiles` (Main) | 🟡 | `SearchSelect` over `profiles` (allowFree only for historical revisions imported from paper). |
| 32 | `PEDocs.jsx:755` | ผู้รับผิดชอบ (FMEA recommended action) | department/person → `pe_fmea_rows.responsibility` (placeholder `PD / QA / P…`) | `<input type=text>` free | `org_nodes` (departments) / `profiles` | 🟡 | `<select>` from `useOrgDepts()` + optional person `SearchSelect`; `allowFree` justified (form text imported from Excel). |
| 33 | `PEDocs.jsx:812` | ผู้คุม (Person in charge — CP row) | department → `pe_cp_rows.person` (placeholder `PD / QA / JIG MTN`) | `<input type=text>` free | `org_nodes` (departments) | 🟡 | Same as #32. |

✅ 6: set `<select>` `:259`, OP filter `:329`, `<LineSelect>` `:597` and `:678`, process `<select>` `:732`, `:799`. `kind`/`special_class`/`doc_type`/`ref_kind` selects are app enums.

## src/pages/NPI.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 34 | `NPI.jsx:408` | MAT No. (SAP) — hint "โยง Product Master ตอน SOP" | product → `npi_parts.mat_no` | `<input type=text>` free (also auto-filled from `pe_doc_sets.mat_no` `:239`) | `dr_products.mat_no` (DR) | 🔴 | `SearchSelect` over `dr_products` (allowFree justified: new part may not exist in Product Master before SOP — show "ยังไม่มีใน Product Master" tag). It is the declared SOP linkage key. |
| 35 | `NPI.jsx:387` (+datalist `:433`) | Project leader | person → `npi_projects.leader_name` | `<input list="npi-users">` datalist over `profiles` | `profiles` (Main) | 🟡 | `SearchSelect` over `users` (same `userOpts` pattern as `NpiTasks.jsx:115`), store `leader_uid` too so notifications can target the leader. |
| 36 | `NPI.jsx:423` | ผู้รับผิดชอบพาร์ท | person → `npi_parts.owner_name` | `<input list="npi-users">` datalist | `profiles` | 🟡 | Same as #35. |
| 37 | `NPI.jsx:376` | ลูกค้า (project) | customer → `npi_projects.customer` | `<input type=text>` free | **NO MASTER** (see #14) | 🟡 (candidate) | `<datalist>` of distinct customers from `npi_templates.customer ∪ dr_products.customer`. |

✅ 5: project `<select>` `:288`, template `<select>` `:379`, PE set `<select>` `:401`, `<LineSelect>` `:410` (with role/lineId/sections — model usage), QA part `<select>` `:413`.

## src/components/NpiPartPanel.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 38 | `NpiPartPanel.jsx:296` | ผู้รับผิดชอบเฟส | person → `npi_part_phases.owner_name` | `<input list="npi-users">` datalist | `profiles` | 🟡 | `SearchSelect` over users (as `NpiTasks`). |
| 39 | `NpiPartPanel.jsx:311` | ผู้รับผิดชอบ (deliverable) | person → `npi_part_deliverables.owner_name` | `<input list="npi-users">` datalist | `profiles` | 🟡 | Same. |
| 40 | `NpiPartPanel.jsx:312` (and `NpiTemplates.jsx:159`) | ทีมเจ้าของ (owner_role) | team/department → `npi_part_deliverables.owner_role`, `npi_template_deliverables.owner_role` | `<select>` from hardcoded `OWNER_ROLE` in `src/utils/npi.js:96` (engineer/qa/production/planning/sales/purchasing/mtn/manager) | `org_nodes` (departments, Main) — partial overlap | 🔵 | Low priority: keep as app enum if it is meant to map to permission roles; otherwise drive from `org_nodes` departments so new plants/departments need no code change (CLAUDE.md rule "data-driven ก่อน hardcode"). |

✅ 3: phase `<select>`, ref-kind linked selects (drawing / tooling) `:315-316`.

## src/components/NpiDrawingsEci.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 41 | `NpiDrawingsEci.jsx:223` (+datalist `:234`) | ECI/ECN ที่ทำให้เกิด rev นี้ | ECI record → `npi_drawing_revisions.eci_no` (text) | `<input list="npi-eci-nos">` datalist over `npi_eci` | `npi_eci` (Main) | 🟡 | `<select>`/`SearchSelect` of this part's ECIs storing `eci_id` (FK) + snapshot no.; ECI closure check (`affects_drawing` → `drawing_revision_id`) already links by id in the other direction, so the text link is a second, unvalidated path. |
| 42 | `NpiDrawingsEci.jsx:257` | ผู้ขอ/ต้นเรื่อง | person → `npi_eci.requested_by` | `<input type=text>` free | `profiles` (internal) — customer contacts have no master | 🟡 | `SearchSelect` over `profiles` with `allowFree` (source = customer → free text justified). |

✅ 6: part `<select>` `:137`, ECI part `:253`, drawing-rev `:269`, PE change request `:276`, 4M log `:283`, tooling plan `:290`.

## src/components/NpiTasks.jsx

✅ 4: part / phase / deliverable `<select>`s (`:111-113`); assignee `SearchSelect` with `allowFree` (`:115`) — **allowFree justified** (hint says non-system user allowed; `assignee_uid` kept for bell notifications). No findings.

## src/components/NpiTemplates.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 43 | `NpiTemplates.jsx:131` | ลูกค้า (template) | customer → `npi_templates.customer` | `<input type=text>` free | **NO MASTER** (see #14) | 🟡 (candidate) | Same as #37; template is matched to projects by this text. |
| — | `NpiTemplates.jsx:159` | ทีมเจ้าของ (default) | see #40 | `<select>` hardcoded `OWNER_ROLE` | | 🔵 | (counted in #40) |

✅ 1: phase `<select>` `:156`. Label/code/description fields are master-definition fields (template is the master) — not flagged.

## src/components/NpiTooling.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 44 | `NpiTooling.jsx:168` (+datalist `:178`) | ผูกชุดแม่พิมพ์ (die_sets) หลัง transfer | die set → `npi_tooling_plans.die_set_code` | `<input list="npi-die-sets">` datalist over DR `die_sets.set_code` | `die_sets` (DR) | 🔴 | `SearchSelect` over `dieSets` (set_code · part_no · model), no allowFree (a code that is not in the registry is shown as ⚠ "ไม่พบใน…" at `:119` — so the UI already knows it must match). Join key: `dieSets.find(d => d.set_code === t.die_set_code)` `:108`. |
| 45 | `NpiTooling.jsx:169` | ผู้รับผิดชอบ (plan) | person → `npi_tooling_plans.owner_name` | `<input list="npi-users">` datalist | `profiles` | 🟡 | `SearchSelect` over users. |
| 46 | `NpiTooling.jsx:194` | ผู้รับผิดชอบ (step) | person → `npi_tooling_steps.responsible_name` | `<input list="npi-users">` datalist | `profiles` | 🟡 | Same. |
| 47 | `NpiTooling.jsx:160` | ผู้ทำ (maker) | supplier → `npi_tooling_plans.maker_name` | `<input type=text>` free — hint "text ไปก่อน — supplier master เฟส 4" | **NO MASTER** (acknowledged, phase 4) | 🟡 (candidate, deferred by design) | No action now; when supplier master lands, switch to `SearchSelect`. |

✅ 2: part filter `:86`, part `<select>` `:157`. `tool_kind`/`maker_kind` are app enums.

## src/components/QaClaims.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 48 | `QaClaims.jsx:296` | เลขพาร์ท (กุญแจหาเอกสาร PFMEA) | part → `qa_claims.part_no` | `<input type=text>` free | `pe_doc_sets` (Main) / `dr_products` (DR) / `qa_parts` | 🔴 | `SearchSelect` as #2. Label itself says it is the key; it is passed to `PeChangeRequests` `matchDocSet` and copied into the CAPA created from the claim (`:145`). |
| 49 | `QaClaims.jsx:299-302` | ไลน์ผลิต | line → `qa_claims.line_name` | `<select>` with `lines.map(l => <option>)` — `lines` prop is a **flat array of names** (`QualityControl.jsx:1638`), no hierarchy / scope / retired handling | `production_lines` | 🟡 (LineSelect drift) | Pass line objects and use `<LineSelect>`; value is also used by `matchDocSet` line fallback. |
| 50 | `QaClaims.jsx:293` | ลูกค้า * | customer → `qa_claims.customer` | `<input type=text>` free (placeholder `FTM / AAT`) | **NO MASTER** (see #14) | 🟡 (candidate) | `<datalist>` of distinct `dr_products.customer` now; master later. Claim register per customer is a natural report grouping → typos split the group. |
| 51 | `QaClaims.jsx:297` | ชื่อพาร์ท | part name → `qa_claims.part_name` | `<input type=text>` free | same as #48 | 🟡 | Auto-fill from part picker. |

`category`/`severity` selects are app enums (not flagged).

## src/components/QaPieceStepper.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 52 | `QaPieceStepper.jsx:170` | ชื่อคนทำ action | person → `qa_check_actions.action_by` (`:448`) | `<input type=text>` free (default `fullName`) | `employees` / `profiles` (Main) | 🟡 | `SearchSelect` over `employees` of the part's line family (action is usually done by an operator/leader, not necessarily a system user) with `allowFree`. |

`FOUR_M` category `<select>` (`:175`) is the fixed 4M enum — not a DB master; not flagged.

## src/components/MaterialRequests.jsx (FM-STO-003)

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 53 | `MaterialRequests.jsx:428` | Storage Location ปลายทาง | SLoc → `material_requests.dest_storage_location` | `<input type=text>` free | `storage_locations` (DR, `20260902_storage_locations_master.sql` — code-format checked, registry with ⚠ pattern) | 🟡 | `SearchSelect` over `storage_locations` (code · name · kind) with `allowFree` + "⚠ ไม่ได้อยู่ในทะเบียน" tag — same pattern the migration prescribes for `bom_items.storage_location`. |
| 54 | `MaterialRequests.jsx:433` | รหัสคลังสินค้า / สโตร์ | SLoc → `material_requests.storage_location` | `<input type=text>` free | `storage_locations` (DR) | 🟡 | Same as #53. |
| 55 | `MaterialRequests.jsx:409` | ชื่อผู้ขอเบิก | person → `material_requests.requester_name` | `<input type=text>` free (default `fullName`) | `profiles` / `employees` | 🟡 | `SearchSelect` over `profiles` (allowFree for non-user requesters). |
| 56 | `MaterialRequests.jsx:410` | หน่วยงาน / ตำแหน่ง | department → `material_requests.requester_dept` (default hardcoded `'QUALITY'` at `:121`) | `<input type=text>` free | `org_nodes` (Main) via `useOrgDepts`; also `profiles.section`/`position` | 🟡 | Default from the user's `profiles.section`; `<select>` from `useOrgSections()` with allowFree. |
| 57 | `MaterialRequests.jsx:412-416` | ไลน์ที่ขอของ (ใช้จับคู่ใบของเสีย) | line → `material_requests.line_name` | `<select>` manual `toHierarchicalOptions(scopedLines).map(<option>)` | `production_lines` | 🟡 (LineSelect drift) | `<LineSelect>` (label says it is used to match scrap reports → keep names canonical). |
| 58 | `MaterialRequests.jsx:468` | หน่วย (item unit) | UoM → `material_request_items.unit` | `<input type=text>` free | `parts_master.uom` (DR, loaded `:83`) | 🟡 (minor) | Auto-fill/lock from the 🗂 picker result; free only when no mat_no. |

✅ 2: item `mat_no` has 🗂 registry picker from `parts_master` (`:463`) — good (text + picker); signer `<select>`s from `profiles` with signature (`:490`). `plant_code` (`:432`) has no master (single plant constant) — not flagged. `move_code` select comes from `movesFor()` (form-defined SAP movement types, not a DB master) — not flagged.

## src/components/PeExcelImportModal.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 59 | `PeExcelImportModal.jsx:284` | ลูกค้า (new set from Excel) | customer → `pe_doc_sets.customer` | `<input type=text>` free | **NO MASTER** (see #14) | 🟡 (candidate) | As #30. |

Other fields (`part_no`, `part_name`, `model`, doc numbers) define the new `pe_doc_sets` master row → not flagged. Note this modal has **no `mat_no` field** at all, so sets created by import always start with `mat_no = null` (the linkage key of #28) — worth a follow-up field with the `dr_products` picker. ✅ 1: target set `<select>` `:291`.

## src/components/PeRoutingSuggest.jsx

| # | file:line | Field | Entity → column | Control | Master | Sev | Fix |
|---|---|---|---|---|---|---|---|
| 60 | `PeRoutingSuggest.jsx:173-174` (+datalist `:185`) | ไลน์ (routing step) | line → `part_routings.line_name` (DR, via `toRoutingRows` `peRouting.js:87`) | `<input list="pe-rt-lines">` datalist of line names | `production_lines` (Main) | 🔴 | `<LineSelect lines={lines} …>` per row (compact style). **Join key**: VSM builds boxes from `part_routings.line_name` and pulls real CT/OEE from `production_sessions.line_name`; a typo = empty VSM box with no error. |

✅: `wip_label` is free text by design (WIP point name; `wip_buffer_points` exists but routing WIP labels are looser — could become a 🟡 later).

---

## Cross-file notes

1. **`customer` has no master anywhere** but is typed free-text in at least 6 places in this group alone (`qa_parts`, `qa_claims`, `pe_doc_sets` ×2 forms, `npi_projects`, `npi_templates`) plus `dr_products.customer`/`kanban_standards.customer` elsewhere — and is used to group claims/forecasts/templates. Clear candidate for a small `customers` master (code, name, aliases like FTM/AAT/FORD) with a shared picker; until then a shared `<datalist>` of distinct `dr_products.customer` would already stop drift.
2. **`part_no` as PE-doc key is typed free in 4 sinks** (CAPA #2, NCR #4, Claims #48, SPC #6) while `matchDocSet()` in `PeChangeRequests` and `CapaEffectiveness` need an exact normalized match. One shared "PartSelect" (`SearchSelect` over `pe_doc_sets ∪ qa_parts ∪ dr_products`, keywords = mat_no/p_no/name) used in all four would fix the whole 8D→PFMEA closed loop entry point.
3. **`npi-users` datalist pattern** (5 fields across `NPI.jsx`, `NpiPartPanel.jsx`, `NpiTooling.jsx`) stores only names; `NpiTasks` already shows the right pattern (`SearchSelect` + `assignee_uid` + name snapshot). Converging on it also enables bell notifications for owners.
4. **LineSelect drift** — 10 manual `…map(<option>)` line dropdowns in this group: `QualityControl` ×3, `QAInspectionSetup` ×1, `LayerProcessAudit` ×3, `BbsCheck` ×1, `QaClaims` ×1 (names-only), `MaterialRequests` ×1; plus 2 datalists (`PeRoutingSuggest`, and `PEDocs` machine list which is a machine, not a line). Several of the backing queries omit `section`/`is_active`, so retired lines keep appearing and scope is not applied.

## Summary

| file | 🔴 | 🟡 | 🔵 | ✅ |
|---|---|---|---|---|
| src/pages/QualityControl.jsx | 2 (#1 #2) | 10 (#3-#12) | 0 | 3 |
| src/pages/QAInspectionSetup.jsx | 0 | 3 (#13-#15) | 0 | 1 |
| src/pages/EventLog.jsx | 0 | 2 (#16 #17) | 0 | 2 |
| src/pages/LayerProcessAudit.jsx | 0 | 5 (#18-#22; #22 = 3 line selects) | 0 | 0 |
| src/pages/OjtTraining.jsx | 0 | 3 (#23-#25) | 0 | 4 |
| src/pages/BbsCheck.jsx | 0 | 2 (#26 #27) | 0 | 2 |
| src/pages/PEDocs.jsx | 1 (#28) | 5 (#29-#33) | 0 | 6 |
| src/pages/NPI.jsx | 1 (#34) | 3 (#35-#37) | 0 | 5 |
| src/components/QaCheckSheet.jsx | 0 | 0 | 0 | 1 |
| src/components/QaClaims.jsx | 1 (#48) | 3 (#49-#51) | 0 | 0 |
| src/components/QaFmeBoard.jsx | 0 | 0 | 0 | 0 |
| src/components/QaFmeQueue.jsx | 0 | 0 | 0 | 0 |
| src/components/QaPieceStepper.jsx | 0 | 1 (#52) | 0 | 0 |
| src/components/MaterialRequests.jsx | 0 | 6 (#53-#58) | 0 | 2 |
| src/components/CapaEffectiveness.jsx | 0 | 0 | 0 | 1 |
| src/components/PeChangeRequests.jsx | 0 | 0 | 0 | 0 |
| src/components/PeExcelImportModal.jsx | 0 | 1 (#59) | 0 | 1 |
| src/components/PeRoutingSuggest.jsx | 1 (#60) | 0 | 0 | 0 |
| src/components/PeFlowChart.jsx | 0 | 0 | 0 | 0 |
| src/components/NpiDrawingsEci.jsx | 0 | 2 (#41 #42) | 0 | 6 |
| src/components/NpiPartPanel.jsx | 0 | 2 (#38 #39) | 1 (#40) | 3 |
| src/components/NpiTasks.jsx | 0 | 0 | 0 | 4 |
| src/components/NpiTemplates.jsx | 0 | 1 (#43) | 0 (counted in #40) | 1 |
| src/components/NpiTooling.jsx | 1 (#44) | 3 (#45-#47) | 0 | 2 |
| src/components/SymptomSearch.jsx | 0 | 0 | 0 | 1 |
| **Total** | **7** | **52** | **1** | **45** |

# ═══ กลุ่ม E-logistic ═══

# Audit E — logistics / store / transport / energy / analytics / misc (read-only · 2026-09-07)

Scope: 32 files in group E. Method: grep `<input|<select|<textarea|SearchSelect|datalist|list=|LineSelect`, then read the surrounding code + the save path + the DB definition (migrations / docs/sql) for every hit.

Files with **no entity inputs at all** (nothing to flag): `RundownStock.jsx`, `FlowTower.jsx`, `DeptDashboard.jsx`, `DeptHub.jsx` (file input only), `AuditLog.jsx`, `RemoteControl.jsx` (6-digit pairing code), `StoreLotQueue.jsx`, `StoreWaitCards.jsx`, `SkillEditHistory.jsx`, `VsmCanvas.jsx`, `DemandVsProduction.jsx` (numeric horizon), `FeedbackModal.jsx` (free-text message only), `ScanModal.jsx` (barcode/scan box that resolves against masters = search box).

Masters confirmed to exist (checked in `supabase/migrations` / `docs/sql`):
- DR: `dr_products` (mat_no, customer, p_no), `parts_master`, `bom_items`, `ship_to_plants` (code → customer_name; the only "customer" master — **no `customers` table exists**; `dr_products.customer` is a free-text column whose distinct values act as the de-facto customer-name list), `transport_carriers` (emp_code free text, no employee FK), `transport_vehicles`, `transport_nodes` (line_name text), `storage_zones`, `pm_facility_areas`, `energy_points`, `energy_meter_topics`, `stock_inflow_rules` (dest_line_name text).
- Main: `production_lines`, `org_nodes` (sections), `employees`, `profiles`, `kpi_definitions` (category check-constraint; `action_owner` text), `factory_line_regions`.
- **NO MASTER**: dock code (`customer_shipping_orders.dock_code`), customer plant name (`ship_to_plants.plant_name`).

---

## 🔴 Free text where a master exists AND the value is a join key / filter

### E-01 `src/pages/CustomerDemand.jsx:556` — "ลูกค้า (Ship-to)" in ➕ เพิ่ม order ด่วน
- Entity: ship-to code → `customer_shipping_orders.customer` (DR)
- Control: `<input list="add-ord-shipto">` (datalist of `Object.keys(shipToMap)`), `.toUpperCase()`, **no validation** on save (`saveAddOrder` L88 inserts `addForm.customer.trim() || null`)
- Master: `ship_to_plants` (DR) — the same code is used as the join key for `custLabel()` (L1224), for grouping orders per customer in the shipping chart / walkback, and for customer-scoped `shipping_workflow_steps`
- Fix: `<select>` (list is ~7-10 codes) or `SearchSelect` over `ship_to_plants` (active only) — `allowFree` **not** justified (a new ship-to must be created in the ⚙️ Ship-to Config tab first; the tab already exists on the same page).

### E-02 `src/pages/CustomerDemand.jsx:561` — "MAT No. *" in ➕ เพิ่ม order ด่วน
- Entity: product → `customer_shipping_orders.mat_no` (DR)
- Control: `<input list="add-ord-mat">` (datalist from active `dr_products`), `.toUpperCase()`, only `!mat` is validated (L83) — an unknown MAT is inserted silently
- Master: `dr_products.mat_no` (DR) — join key to `dr_products` (line/CT), `line_stock_summary` (stock deduction on ship), `kanban_standards`, Rundown/FlowTower
- Fix: `SearchSelect` over `dr_products` (search by mat_no / name / p_no, > 30 rows). `allowFree` not justified — the page itself says products missing from the master must be added at Product Master first.

### E-03 `src/pages/LineStock.jsx:1392` — "ปลายทาง (พิมพ์เอง หรือเลือกไลน์)" in ➕ เพิ่ม/แก้กฎ (stock inflow rules)
- Entity: destination line / warehouse → `stock_inflow_rules.dest_line_name` (DR)
- Control: `<input list="inflow-dest-options">` — datalist = existing dests not in registry + `lines.filter(is_active)`; free text saved as-is
- Master: `production_lines` (Main) for lines; `storage_zones` (DR) / `WAREHOUSE_LOCATIONS` (`src/utils/storageZones.js`) for FG WAREHOUSE / STORE. `dest_line_name` is copied into `line_stock_transactions.line_name` by the DB trigger (`fn_stock_inflow…` L51) → it is the join key that `line_stock_summary`, `LineSelect` grouping and StoreMonitor use; a typo creates an orphan "line" with stock nobody can see (same failure the page already fixed for delivery rounds at L1021-1022).
- Fix: replace with `LineSelect` (registry lines, scope, retired excluded) + an extra optgroup "🏬 คลัง" fed from `storage_zones`/`WAREHOUSE_LOCATIONS`; no free text.

### E-04 `src/components/TransportMapEditor.jsx:491` — "ผูกไลน์/สโตร์ (optional)" on a transport node
- Entity: line served by a stop → `transport_nodes.line_name` (DR)
- Control: `<input list="tr-lines">` — datalist from `supabase.from('production_lines').select('name')` (L100: **no section / is_active** → retired lines included, no scope), free text accepted
- Master: `production_lines` (Main) + `storage_zones` (DR) for store nodes. Used as a join key in `Transport.jsx:479` (`isOfLine(n)` normalises `node.line_name` against `round._line` to auto-pick a round's stops) — a misspelled line means the round finds no stop.
- Fix: `LineSelect` (via `useProductionLines()`) + optgroup from `storage_zones`; drop the datalist. `allowFree` not justified.

### E-05 `src/pages/PlannerSales.jsx:1411` — "เลข SAP ภายใน" in 🔗 จับคู่เลขพาร์ทลูกค้า → เลข SAP
- Entity: internal product → written to `dr_products.p_no` (by `.eq('mat_no', sap)`) and re-points `customer_forecasts.mat_no` (DR)
- Control: `<input list="sap-opts">` (datalist of active `dr_products`) with red/green border + "✗ ไม่พบเลข SAP นี้" hint, **but `doMapping()` L1145 takes every non-empty `mapSel` value** — an unknown SAP updates 0 rows in `dr_products` (checkWrite does not count rows) and still re-points the forecast to a MAT that does not exist
- Master: `dr_products.mat_no` (DR)
- Fix: `SearchSelect` (search mat_no / name / line, > 30 rows) without `allowFree`, or at minimum filter `pairs` by `drMap[sap]` before writing.

---

## 🟡 Free text where a master exists but the value is display / snapshot / weakly linked

### E-06 `src/pages/LineStock.jsx:689` — "MAT SAP *" in the stock transaction form
- Entity: product → `line_stock_transactions.mat_no` (DR)
- Control: `<input>` with a hand-rolled autocomplete dropdown (`matOptions` from `bomMap` = `bom_items`, max 8 hits) + `window.confirm` gate when MAT is not in `knownMats`/`bomMap` (L244) → unknown MAT still allowed after confirm
- Master: `parts_master` / `dr_products` / `bom_items` (DR). Rated 🟡 rather than 🔴 only because of the confirm gate and because the page must accept sub-parts that are not yet in the master (documented "กันสร้างของผี").
- Fix: `SearchSelect` over `parts_master ∪ bom_items ∪ dr_products` with `allowFree` (justified — shows "not in registry" tag) instead of the custom dropdown + confirm.

### E-07 `src/pages/LineStock.jsx:1387` — "MAT No." (when ชนิดเงื่อนไข = MAT ตรงตัว) in inflow rules
- Entity: product → `stock_inflow_rules.match_value` (DR), compared exactly against `line_stock_transactions.mat_no` by the trigger
- Control: `<input>` free, monospace, no datalist at all (prefix mode is legitimately free text)
- Master: `dr_products` / `parts_master` (DR)
- Fix: when `match_type === 'mat'` render `SearchSelect` over `dr_products`; keep plain input for `prefix`.

### E-08 `src/pages/CustomerDemand.jsx:570` — "ชื่อพาร์ท" in ➕ เพิ่ม order ด่วน
- Entity: product name snapshot → `customer_shipping_orders.part_name`
- Control: `<input>` free (auto-filled from `prodNames[mat]` when MAT matches)
- Master: `dr_products.name` (DR). Display only.
- Fix: make read-only once MAT is picked from the master (E-02); free entry only when MAT is unknown (which E-02 removes).

### E-09 `src/pages/Transport.jsx:714` — "รหัสพนักงาน" in ➕/✏️ คนขับ (carrier form)
- Entity: employee → `transport_carriers.emp_code` (DR; migration comment: "ผูก employees ภายหลัง — เฟส 1 free text")
- Control: `<input>` free; the form does have a working employee search (L700 `empQ` → `pickEmp` fills name + emp_code + section) but the code stays editable and there is no `employee_id` column
- Master: `employees.employee_id_code` (Main). Currently display only (carrier name shown on rounds), so 🟡 — but this is the natural link for skills/driver history later.
- Fix: add `employee_id` (uuid) to `transport_carriers`, keep the existing picker, make `emp_code` read-only when picked; keep `name` free only for outsource drivers (justified).

### E-10 `src/pages/Transport.jsx:721` — "ส่วนงาน (optional)" in carrier form
- Entity: section → `transport_carriers.section` (DR) (comment: "scope ส่วนงาน")
- Control: `<input>` free
- Master: `org_nodes` kind=section (Main) via `useOrgSections()`
- Fix: `<select>` from `useOrgSections()` (+ blank = ไม่ระบุ).

### E-11 `src/components/KpiMonthly.jsx:797` — "RESPONSIBILITY" in ✏️ นิยาม KPI
- Entity: owner (person / section) → `kpi_definitions.action_owner` (Main)
- Control: `<input>` free
- Master: `profiles` / `employees` (Main) or `org_nodes` — display only on the appraisal sheet
- Fix: `SearchSelect` over `profiles.full_name` (allowFree justified: the paper form sometimes names a department, not a person).

### E-12 `src/pages/VSM.jsx:590` — "ผู้รับผิดชอบ" column of ⑥ แผนดำเนินการ (A3)
- Entity: person → `vsm_maps.a3.plan[].who` (DR jsonb)
- Control: `<input>` free
- Master: `profiles` / `employees` (Main) — display/print only
- Fix: `SearchSelect` over profiles with `allowFree` (A3 owners can be a team name).

### E-13 `src/pages/FactoryMap.jsx:3211` — "➕ พิมพ์ชื่อโซนใหม่…" with type 🔧 โซน MTN / Facility
- Entity: facility zone → `factory_line_regions.line_name` (Main) — matched by trimmed/lower-cased name to `pm_facility_areas.name` + facility `machines.line_name` (DR) for colouring/status (L528-530, L1089)
- Control: `<input>` free; unlike the 🏬 store branch (which creates the `storage_zones` row in the same step, L1861) the fac branch creates **no** `pm_facility_areas` row → a typed name that does not match an existing area is an orphan frame with no status
- Master: `pm_facility_areas` (DR)
- Fix: mirror the store path — insert into `pm_facility_areas` when `newZoneType === 'fac'`, or restrict the fac option to the existing `facilityZones` list (already offered in the same select) and drop free text for fac.

---

## 🔵 Hardcoded / hand-rolled option lists that duplicate a DB master

### E-14 `src/pages/ProductHistory.jsx:306` — "ไลน์" filter
- `lineGroups.groups.map(... <optgroup> ... <option>)` built by hand from `production_lines` (L62) instead of `<LineSelect>`; no section scope, retired lines included. (The extra "⚠ นอกผัง" group for orphan names is a good idea and should be kept — `LineSelect` supports an unknown current value.)
- Fix: `LineSelect` + `useProductionLines()`, keep the orphan optgroup as `extraOptions`.

### E-15 `src/pages/OEEAnalytics.jsx:1320-1335` — Today tab "ทุกส่วนงาน / ทุกแผนก / ไลน์" filters
- Three manual `<select>`s built from `linesFull` (`sectionOptions` / `deptOptions` / `lineOptions` L369-381) re-implementing section → parent → child hierarchy that `LineSelect` already provides; `linesFull` is loaded with its own query (L320) instead of `useProductionLines()`.
- Fix: `useOrgSections()` for section + `LineSelect` (hierarchy, scope, retired) for dept/line.

### E-16 `src/pages/OEEAnalytics.jsx:1825` — Trend tab "ทุกไลน์"
- Manual `lines.filter(...).map(<option>)` + hand-built `parentChildrenMap` optgroups; `lines` comes from distinct `production_sessions.line_name` (L960) — so a line that was renamed in the registry shows under its old name and a registry line with no sessions is missing.
- Fix: `LineSelect` fed by `useProductionLines()`; keep an "⚠ นอกทะเบียน" optgroup for session names that no longer match (pattern from ProductHistory / TvBoard L190).

---

## Notes (not counted)
- `CustomerDemand.jsx:582` "Dock" (`dock_code`) and `:1174` "โรงงาน/ท่า" (`plant_name`) — **NO MASTER**. Dock is keyed per order, comes mostly from EDI 862, display only. Candidate for a `ship_to_docks` master only if Transport ever routes by dock.
- `CustomerDemand.jsx:1261-1272` `CustomerPicker` — already a select from distinct `dr_products.customer` with an explicit "✏️ พิมพ์เอง" escape + warning. Fine; but it highlights that **there is no `customers` table** — customer name lives as free text in `dr_products.customer` and is copied into `ship_to_plants.customer_name`. A real `customers` master (DR) would remove the normalise-and-compare hack (`norm()` L1247).
- `Transport.jsx:712` carrier "ชื่อ *" free text is justified (outsource drivers; employee picker exists above it).
- `DeliverScanModal.jsx:154` `OVERRIDE_REASONS`, `TransportMapEditor.jsx:359/486` `NODE_KINDS`, `FactoryMap.jsx:3216` `ZONE_KINDS`, `EnergyMqttTopics.jsx:149` `MQTT_FIELDS`, `Energy.jsx:361` source (manual/meter/estimated), `KpiMonthly.jsx:744` `CATS` (matches DB check constraint), `Transport.jsx:716` `SHIFTS`, `OEEAnalytics.jsx:1338` Team A/B/C — code-level enums with no DB master table; not flagged.
- `PlannerSales.jsx:607` column-mapping selects and `:761` month select are not entity pickers.

---

## Summary

| file | 🔴 | 🟡 | 🔵 | ✅ (already picker) |
|---|---|---|---|---|
| src/pages/PlannerSales.jsx | 1 | 0 | 0 | 1 (LineSelect) |
| src/pages/CustomerDemand.jsx | 2 | 1 | 0 | 3 (scope select from ship_to_plants · requires_status · CustomerPicker) |
| src/pages/RundownStock.jsx | 0 | 0 | 0 | 0 |
| src/pages/LineStock.jsx | 1 | 2 | 0 | 6 (LineSelect ×4 · BOM product select · shift) |
| src/pages/StoreMonitor.jsx | 0 | 0 | 0 | 1 (LineSelect) |
| src/pages/Transport.jsx | 0 | 2 | 0 | 5 (carrier assign · round · vehicle · employee search · vehicle chips) |
| src/pages/Energy.jsx | 0 | 0 | 0 | 1 (source) |
| src/pages/FlowTower.jsx | 0 | 0 | 0 | 0 |
| src/pages/VSM.jsx | 0 | 1 | 0 | 2 (FG product search+select · state) |
| src/pages/OrderTrace.jsx | 0 | 0 | 0 | 1 (PFMEA failure-mode select) |
| src/pages/ProductHistory.jsx | 0 | 0 | 1 | 0 |
| src/pages/WorkforceInsight.jsx | 0 | 0 | 0 | 4 (section ×3 via useOrgSections · shift) |
| src/pages/FactoryMap.jsx | 0 | 1 | 0 | 2 (assign line/zone select · ZONE_KINDS) |
| src/pages/TvBoard.jsx | 0 | 0 | 0 | 1 (section, with orphan guard) |
| src/pages/Dashboard.jsx | 0 | 0 | 0 | 1 (section from context) |
| src/pages/DeptDashboard.jsx | 0 | 0 | 0 | 0 |
| src/pages/DeptHub.jsx | 0 | 0 | 0 | 0 |
| src/pages/OEEAnalytics.jsx | 0 | 0 | 2 | 3 (section · shift ×2) |
| src/pages/AuditLog.jsx | 0 | 0 | 0 | 0 |
| src/pages/RemoteControl.jsx | 0 | 0 | 0 | 0 |
| src/components/StoreLotQueue.jsx | 0 | 0 | 0 | 0 |
| src/components/StoreWaitCards.jsx | 0 | 0 | 0 | 0 |
| src/components/StockMoveToChild.jsx | 0 | 0 | 0 | 1 (grouped destination line select) |
| src/components/DeliverScanModal.jsx | 0 | 0 | 0 | 1 (override reason) |
| src/components/TransportMapEditor.jsx | 1 | 0 | 0 | 2 (node kind ×2) |
| src/components/EnergyMqttTopics.jsx | 0 | 0 | 0 | 2 (field · energy_points scope) |
| src/components/KpiMonthly.jsx | 0 | 1 | 0 | 5 (year · section ×2 · category · direction) |
| src/components/FeedbackModal.jsx | 0 | 0 | 0 | 0 |
| src/components/SkillEditHistory.jsx | 0 | 0 | 0 | 0 |
| src/components/VsmCanvas.jsx | 0 | 0 | 0 | 0 |
| src/components/DemandVsProduction.jsx | 0 | 0 | 0 | 0 |
| src/components/ScanModal.jsx | 0 | 0 | 0 | 0 |
| **Total** | **5** | **8** | **3** | **42** |

Top priorities: E-01/E-02 (manual order entry writes unvalidated ship-to + MAT into the demand chain), E-03/E-04 (line-name datalists feeding stock and transport join keys — same bug class the repo already fixed for delivery rounds), E-05 (SAP mapping writes unknown MAT into forecasts).
