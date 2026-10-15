# 🔐 Audit — "เข้าหน้าได้ ≠ แก้ของหน่วยงานอื่นได้" (2026-10-15 · คำสั่ง user)

> *"ปัญหาหลักเลยเรื่องสิทธิ์ ตอนนี้มั่วเลย ... user เป็น mtn ที่เป็นแค่แอดมินส่วนงาน
>  แต่เข้าไปแก้ KPI ของแผนกอื่นได้ มั่วเลย"* → *"ต้องไม่เกิดเคสนี้อีก ที่ user บางรole
>  เข้าหน้าได้ทุกหน้า แต่ต้องไม่มีสิทธิ์ไปแก้ข้อมูลส่วนงานคนอื่น"*

ตรวจ **~60 จอที่เขียนข้อมูล** (4 ชุดขนาน) + **RLS ทั้ง 2 project** · ตัวเลขทุกตัวในไฟล์นี้วัดจากฐานจริง

---

## 1. ข้อสรุป — ไม่ใช่บั๊กรายหน้า แต่เป็น **ชั้นที่ไม่เคยมี**

ระบบมี 2 ชั้นที่ทำงานอยู่ · **ขาดชั้นที่ 3**

| ชั้น | คำถามที่ตอบ | มีไหม |
|---|---|---|
| 1. เข้าหน้าได้ไหม | `page:/xxx` | ✅ มี |
| 2. กดปุ่มนี้เป็นไหม | `can('resource','action')` | ✅ มี |
| **3. แถวนี้เป็นของหน่วยงานเราไหม** | **— ไม่มีของกลาง ไม่มีด่าน** | ❌ **ขาด** |

🔴 **ช่องเลือกขอบเขต/ไลน์/ทีม = ตัวกรองการดู ไม่ใช่ด่าน** — เปลี่ยน dropdown หรือ `?scope=` / `?dept=` / `?mo=`
ก็เขียนของหน่วยงานอื่นได้ · จอที่ "ปลอดภัย" วันนี้ ปลอดภัยเพราะ**บังเอิญกรองตอนโหลดลิสต์** ไม่ใช่เพราะมีด่าน

### ตัวเลขที่วัดได้ (15/10)
| สิ่งที่วัด | ค่า |
|---|---|
| RLS ฝั่ง Main ที่เขียนตาราง**ผูกหน่วยงาน** แต่ predicate เป็น `has_perm()` เปล่า | **68 policy** |
| ฝั่ง DR (`production_sessions`, `mtn_*`, `monitor_*`, `line_stock_*` ฯลฯ) | **ไม่มีด่าน DB เลย** (`anon` ไม่มี JWT) |
| ฟังก์ชันช่วยเรื่องขอบเขตฝั่ง DB | **ไม่มี** (มีแต่ `has_perm`) |
| คีย์ action ที่ bucket `dept_admin` ถือ | **101 คีย์ · 99 ตัวเป็นคีย์ของ `manager`** |
| บัญชีที่ `sections` ว่าง = **ไม่จำกัดขอบเขต** | **31 / 122 บัญชี** (เป็น role `mtn` 16 คน) |
| บัญชีที่มี `org_node_id` (สมอระดับแผนก) | 84 / 122 |

⇒ **"แอดมินหน่วยงาน" วันนี้ = manager ที่ไม่มีขอบเขต** ทั้งที่คอมเมนต์ใน `20260803_dept_admin.sql`
เขียนเองว่า *"เห็น/แก้ได้เฉพาะข้อมูลหน่วยงานตัวเอง"* — **โค้ดไม่เคยบังคับเจตนาของตัวเอง**

🔴 **แกนขอบเขตมีแค่ "ส่วนงาน" (`sections`) + "ไลน์" (leader) — ไม่มีแกน "แผนก"**
(`effectiveSections()` · `filterScopeOptions()` เทียบ section อย่างเดียว) ⇒ **แผนกพี่น้องในส่วนงานเดียวกัน
ไม่เคยถูกแยกจากกันที่ไหนในระบบ** · เติมด่านรายหน้าอย่างเดียว**แก้เคสแอดมินระดับแผนกไม่ได้**

---

## 2. จุดที่รั่วจริง (เรียงความรุนแรง)

ความรุนแรง: **A = ตัดสิน/อนุมัติ/ปิด/ลบ ของหน่วยงานอื่น** · **B = แก้ค่าที่กระทบตัวเลขเขา** · **C = แก้ทะเบียน**

| # | จอ | เขียนอะไร | คีย์ | ช่องทาง | ระดับ |
|---|---|---|---|---|---|
| 1 | `KpiMonthly.jsx` (OBEYA ตั้งค่า KPI) | `kpi_definitions` · `kpi_manual_entries` · `kpi_month_plans` · `kpi_catalog` | `kpi:manage` | `?scope=department:<คนอื่น>` → ตรวจแค่ `org.has()` = "มีในผังไหม" **ไม่เคยถามว่าอยู่ในสังกัดเราไหม** | **A** |
| 2 | `QualityControl.jsx` (CAPA/8D) | `qa_capa` | `qa:record` / `qa:manage` | ลิสต์ใบ 8D ทั้งโรงงานไม่กรอง → แก้ D1–D8 / **ปิดใบ** ของไลน์อื่น | **A** |
| 3 | `PMCheckData.jsx` | `inspections` · `pm_plans` | `pm:approve` · `pm:record`/`am:record` | คีย์ที่ใช้ตัดสินมาจาก **`?dept=`** ไม่ใช่ทีมของ user → อนุมัติผลตรวจ + **เลื่อนรอบ PM** ของทีมอื่น | **A** |
| 4 | `MtnRepair.jsx` ขั้น 2–3 + ลบใบ + `cascadeRename` | `mtn_orders` · `mtn_order_parts/labor` · RPC ตัดสต็อก | `mtn_repair:assign/service/manage_master` | ด่านแยกทีมมีแค่ขั้น 6/7 · ขั้น 2/3 ทุกทีมเป็น `side='mtn'` เหมือนกัน · `?mo=<id>` เปิดใบทีมไหนก็ได้ | **A** |
| 5 | `LineStock.jsx` `reviewTxn` | `line_stock_transactions` → approved/rejected | `line_stock:approve` | `loadPending()` ดึง `status='pending'` **ทั้งระบบ** (ขณะที่ลิสต์อื่นในไฟล์เดียวกันกรองแล้ว) → อนุมัติยอดสต็อกส่วนงานอื่น | **A** |
| 6 | `NPI.jsx` + `Npi*.jsx` | `npi_*` 13 ตาราง | `npi:edit` · `npi:approve` | ลิสต์โปรเจค/พาร์ทไม่กรอง → **ปล่อยแบบ · ตัดสิน ECI · บันทึกผล PPAP** ของพาร์ทส่วนงานอื่น · `delProject` ลบ cascade | **A** |
| 7 | `PEDocs.jsx` + `PeMasterLibrary.jsx` | `pe_doc_sets` · `pe_processes` · `pe_fmea_items` · `pe_cp_items` · master | `pe:edit` · `pe:approve` | `<LineSelect>` ที่ 727/826 **ไม่ส่ง `role/lineId/sections`** (ต่างจาก `NPI.jsx:468`) → แก้/ลบ PFC/PFMEA/CP ของพาร์ทคนอื่น · `pe:approve` ดันเข้าคลังกลาง version+1 ถึงทุกพาร์ท | **A** |
| 8 | `HeijunkaKanban.jsx` | `child_lot_requests` · `raw_withdrawal_requests` · `wip_replenish_requests` · **`line_stock_transactions`** | `heijunka:operate` ตัวเดียว | คิวทุกไลน์ขึ้นจอตั้งแต่เปิดหน้า → เดินสถานะ/ยืนยันส่ง/รับของ ของไลน์อื่น (ขยับยอดคงเหลือจริง) | **A** |
| 9 | `QAInspectionSetup.jsx` | `qa_parts` · `qa_inspection_items` · `qa_part_drawings` + ไฟล์ storage | `qa:manage` | **ทั้งไฟล์ไม่มีคำว่า `sections`/scope เลย** → แก้ spec/USL/LSL · **ลบพาร์ทพร้อมจุดตรวจ+แบบ** ของส่วนงานอื่น | **A** |
| 10 | `Monitoring.jsx` | `monitor_cells` · `customer_shipping_orders` | `monitoring:manage` · `demand:upload` | `loadBoards()` ดึงทุกบอร์ด ไม่กรอง ทั้งที่ `monitor_boards.line_name` ระบุเจ้าของ → กรอก/ลบช่อง + `syncRackOrder` ยิงเป็นใบส่งของจริง | **A** |
| 11 | `OrgSetup.jsx` `handleSave` | `org_nodes.parent_id` | `org:manage_own_unit` | guard เช็ค **พ่อเดิม** แต่ payload เขียน **พ่อใหม่** จาก dropdown ที่ลิสต์ทุก section → ย้ายแผนกตัวเองไปแขวนใต้ส่วนงานอื่น | **A** |
| 12 | `ObeyaSqdcmBoard.jsx` | `meeting_action_items` | `obeya:record`/`morning_meeting:record` | `scope` จาก URL **ไม่มีด่านเลย แม้แต่ `org.has()`** → เขียน Action ใส่ส่วนงานอื่น | **B** |
| 13 | `QualityControl.jsx` (SPC) | `qa_measurements` · `qa_characteristics` | `qa:record`/`qa:manage` | `loadChars()` ไม่กรอง → ลงค่าวัด/ลบค่าวัดของไลน์อื่น (กระทบ Cpk/แผนภูมิควบคุมเขา) | **B** |
| 14 | `PMSetup.jsx` | `jigs` · `jig_checkpoints` · `pm_plans` · **`mtn_teams.kind`** | `pm:setup` | `department` มาจาก `?dept=` ตรงๆ · `pmUserTeams` คำนวณไว้แต่ส่งเข้าแค่ modal เดียว · `toggleTeamKind` = **ย้ายด่านสิทธิ์ของทีมอื่น (AM⇄PM)** | **B** |
| 15 | `PmCoordination.jsx` | `pm_coordination_plans` · `pm_plans` | `pm_coord:manage` | ด่านเขียนว่า `scopeLines && p.line_name && !has(...)` ⇒ **แผนที่ `line_name` ว่าง หลุดตัวกรองทั้งหมด** | **B** |
| 16 | `LineStock.jsx` รอบจัดส่ง | `kanban_delivery_rounds` | `line_stock:manage_rounds` | `load()` ดึงทุกไลน์ → ✏️/🗑 รอบส่งของไลน์อื่น | **B** |
| 17 | `MtnRepair.jsx` master | `mtn_teams.mo_code` · `mtn_mo_seq` · `mtn_technicians` · `mtn_labor_rates` | `manage_master` | **ไม่ผ่าน `canEditRow`** (ต่างจาก `SimpleList` ในไฟล์เดียวกันที่ล็อกถูก) → แก้เลขรันใบ MO/ค่าแรงของทีมอื่น | **C** |
| 18 | `DocFormsRegistry.jsx` | `doc_form_scopes` (**มีคอลัมน์ `section` ตรงๆ**) · `doc_form_revisions` | `doc_forms:manage` | dropdown ส่วนงาน = `org_nodes` ทั้งผัง ไม่กรอง → ตั้งช่องเซ็น/footer/ผู้ออกเอกสารของส่วนงานอื่น | **C** |
| 19 | `LayerProcessAudit.jsx` | `lpa_questions` (`line_name = null` = ใช้ทุกไลน์) | `lpa:manage`/`lpa:delete` | แท็บแผน/ใบตรวจกรองแล้ว **แต่ทะเบียนคำถามกลางไม่กรอง** → ลบข้อ = หายจากใบตรวจทุกไลน์ | **C** |
| 20 | `QualityControl.jsx` (เครื่องมือวัด) | `qa_instruments` | `qa:manage` | ทะเบียนทั้งโรงงานไม่กรอง → แก้รอบ calibration ของส่วนงานอื่น | **C** |

---

## 3. แม่แบบที่ทำ "ถูก" อยู่แล้ว (ลอกจากพวกนี้ ห้ามคิดใหม่)

| แบบ | ตัวอย่างดีที่สุด | หลักการ |
|---|---|---|
| **① ปฏิเสธขอบเขตนอกสังกัด + เขียนบนจอ** | `ObeyaKpiBoard.jsx:213-222` | นอกสังกัด = `toast.info` + ถอยไปหน่วยตัวเอง **ไม่สลับเงียบ** |
| **② ดันขอบเขตเข้า query + fail-closed** | `EventLog.jsx:139-170` · `DailyReport.jsx:592-611` | `.in('line_name', scoped)` · ว่าง = `.eq('line_name','__none__')` ไม่ใช่ "ไม่กรอง" |
| **③ ตัวเลือกคือด่าน (URL ปลอมแล้วตกกลับ)** | `ManpowerBoard.jsx:168-171` | `?sec=` ที่ไม่อยู่ในขอบเขต → ตกกลับส่วนงานตัวเอง |
| **④ ด่านรายแถว + เช็คซ้ำตอนกดบันทึก** | `operator.jsx:123-125, 533-550` · `mtnStepPerm.js:296-357` | ซ่อนปุ่มอย่างเดียวไม่พอ — guard ต้องถูกเรียกใน handler ด้วย |
| **⑤ ด่านฝั่ง DB จริง** | trigger `protect_profile_role()` (`AddUser`) | ตัวเดียวในระบบที่กันคนยิง API ตรงได้ |

---

## 4. สิ่งที่ยัง "ตัดสินไม่ได้" — ต้องให้ user เคาะก่อนแก้

1. **QA / สโตร์-วางแผน / PE / NPI เป็นงานกลางทั้งโรงงานโดยธรรมชาติ** — ที่ผิดชัดคือ**คนนอกสายนั้น**
   ถือคีย์เดียวกัน (supervisor/leader/`dept_admin` ที่ถูกจำกัดสาขา) ⇒ ถ้ากรองทื่อๆ ทุกคน **งานจริงพัง**
   ⇒ ต้องแยก **"คีย์งานกลาง" ออกจาก "คีย์ของหน่วยงาน"** ไม่ใช่เติมด่านอย่างเดียว
2. **ทะเบียนกลาง** (`dr_products` · `machine_types` · `pm_facility_areas` · `lpa_questions` · `bbs_agreements`
   · `skill_definitions` · `break_policies`) — ตั้งใจให้ร่วมกันดูแล หรือควรมีเจ้าของ?
3. **ระดับของ "หน่วยงานตัวเอง"** = ส่วนงาน (มีแกนแล้ว) หรือ แผนก (**ยังไม่มีแกน ต้องสร้างก่อน**)
4. **`operator.jsx:119-120` fail-OPEN** — `!isActionSeeded(...) || can(...)` ⇒ ถ้า `loadPermissions()` ล้ม
   (คืน Map ว่าง) ด่านขอบเขตพนักงาน**ปลดทั้งหมด** · ยังไม่ได้พิสูจน์ว่าเกิดจริงได้แค่ไหน

---

## 5. แผนแก้ที่เสนอ (ยังไม่ลงมือ — รอ user เคาะข้อ 4)

- **ชั้น 1 ของกลาง:** `assertScopeAllowed(index, scope, {scopeSet, sections})` + `canWriteUnit(row)` ใน
  `src/utils/orgScope.js` — **ต้องถูกเรียกใน handler ที่เขียนจริง ไม่ใช่แค่ซ่อนปุ่ม**
- **ชั้น 2 กวาดจอ:** ไล่ 20 จุดข้างบนตามแม่แบบ ①–④
- **ชั้น 3 ฝั่ง DB (Main):** เพิ่มเงื่อนไขหน่วยงานใน RLS 68 policy · **ฝั่ง DR ทำไม่ได้** (anon · known gap)
- **ชั้น 4 ด่าน build:** `regressionGuards` — ไฟล์ที่เขียนคอลัมน์ `scope_value`/`section`/`org_node_id`/`line_name`
  ต้องเรียกของกลางชั้น 1
- **ชั้น 5 ข้อมูล:** 31 บัญชีที่ `sections` ว่าง — ตั้งขอบเขตให้ครบ (**แต่ MTN ต้องเห็นทั้งโรงงานจริง**
  ⇒ ต้องแยก "ขอบเขตที่เห็น" ออกจาก "ขอบเขตที่แก้ได้" ก่อน ไม่ใช่ไล่ตั้ง `sections` ให้แคบ)
