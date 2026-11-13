# 🔍 Audit role ↔ scope + ชุดสิทธิ์ Key User (แอดมินหน่วยงาน) — 2026-11-13

> **สถานะ: audit อ่านอย่างเดียว · ยังไม่แก้อะไร** — ส่งต่อให้ session ที่รับผิดชอบสิทธิ์/ขอบเขตแก้
> คำสั่ง user 13/11: *"manager ไม่ได้หมายความว่าข้ามแผนกได้นะ ปัญหาเรื่อง role/scope ยังซ้ำซ้อนกันอยู่ audit และสรุปมา จะให้ session ที่รับผิดชอบแก้"*
> ที่มา: ตอนออกแบบ `docs/E-WORKFLOW-DESIGN.md` §9.4 (key user = flag `is_dept_admin`)
> แหล่งข้อมูล: โค้ดที่ `bcf234a9` + คิวรีอ่านอย่างเดียวบนฐานจริง Main (`ewhdfqwfwofivojtsizn`) และ DR (`eyhclzkifitbhbljgoav`) · ย้อนหลัง 120 วัน
> 🔴 **ทุกข้อเปลี่ยน "ความหมายของสิทธิ์" ⇒ ห้าม auto-merge · ต้องพิสูจน์กับทะเบียนผู้ใช้จริงก่อน** (CLAUDE.md §Role System "เปลี่ยนกฎที่ตัดสินขอบเขต")

---

## 0. กฎที่ user ย้ำ (ใช้ตัดสินทุกข้อข้างล่าง)
- **role = ชุดสิทธิ์ใช้ระบบ ไม่ใช่ตำแหน่ง** · **`manager` ไม่ได้แปลว่าแก้ข้ามแผนกได้**
- ความกว้างของการ "แก้" ต้องมาจาก **ขอบเขตรายคน** เท่านั้น (บ้านจริง `profiles.section` · `resp_cost_centers` · `org_assignments`) — **ห้ามมาจากชื่อ role หรือชื่อคีย์**

---

## 1. 🔴 P1 — แก้ข้ามหน่วยได้อยู่วันนี้

### P1-1 `scope:all_units` (ใบผ่านข้ามหน่วย) แจกเป็นราย role ✅ ยืนยันกับฐานจริง
- ถือโดย role: `admin, document_control, engineer, engineer_nm, manager, planner_store, qa, warehouse_delivery` (คีย์อยู่ `role_permissions` = ทั้ง role ได้หมด)
- อ่านที่ `src/App.jsx:1945` (`allUnits: can('scope','all_units', …)`) → ชนะก่อนทุกด่าน: `writeScope.js:76-78` `hasAllUnits()` · `ccScope.js:143,212` · `mtnTeams.js:151` · DB `app_can_write_line()`
- ผล: manager 5/6 คนตั้ง `resp_cost_centers` ไว้แล้ว **แต่ไม่มีผลกับการแก้เลย** · qa 18 คน · warehouse_delivery 6 คน ฯลฯ แก้ได้ทั้งโรงงาน
- ทิศทาง: ย้ายเป็น **รายคน** (flag ใน profiles หรือ `org_assignments scope_depth='all'`) · ถอดจากทุก role ยกเว้น admin · ฝั่ง DB อ่านแหล่งเดียวกัน · **ต้องให้ user เคาะรายชื่อคนที่ควรได้จริง**

### P1-2 `role === 'manager'` = บอส ข้ามทีมช่าง ✅ ยืนยัน
- `src/utils/mtnTeamOwn.js:29` (`if (role === 'admin' || role === 'manager') return { ok:true, code:'boss' }`) · `MtnRepair.jsx:4505` (`isBoss`) · `TaxonomyManagerModal.jsx:39`
- ใช้ที่ `SparePartMaster.jsx:120` · `MtnPurchase.jsx:452` · `MtnRepair.jsx:4356,4511`
- ขัดกับ `canWriteTeam()` (`mtnTeams.js:150`) ที่ไม่มีทางลัด manager ⇒ ด่านทีม 2 ตัวตอบไม่ตรงกัน
- ทิศทาง: ใช้ `allUnits` (หลังแก้ P1-1) แทน `role==='manager'` · รวมด่านทีมเหลือตัวเดียว

### P1-3 อนุมัติ 4M ขั้น SV ตัดสินด้วย role + ขอบเขตที่ "เห็น" ✅ ยืนยัน
- `src/pages/Report.jsx:1510-1531` — `if (role === 'manager') return true; // manager ไม่กำหนด scope = ไม่จำกัด` · leader ใช้สาขา role · ที่เหลือใช้ `sections` (ขอบเขตที่เห็น) ไม่ใช่ `canWriteLine` · ขั้น QA ไม่มีด่านหน่วย
- DB: `four_m_logs` มี policy `"Allow authenticated full access four_m"` = **ALL · PERMISSIVE · `true`** ⇒ ใครล็อกอินก็เขียนได้ทั้งตาราง (มีแค่ด่าน DELETE แบบ restrictive)
- ทิศทาง: `canWriteLine(ctx, log.line_name, lines)` · แทน policy เปิดโล่งด้วย `has_perm` + ด่านหน่วย

### P1-4 `employees:edit_all_sections` = ใบผ่านข้ามแผนกของตารางพนักงาน ✅ ยืนยัน
- ถือโดย role: `admin, dept_admin, dept_scope, leader, manager, mtn, supervisor` ⇒ leader 24 · supervisor 29 · mtn 16 บัญชี แก้/ปิดพนักงานแผนกไหนก็ได้
- `src/pages/operator.jsx:130-131` (คอมเมนต์ในโค้ดเอง: "RLS ระดับ DB ยังไม่รู้จัก section ของพนักงาน") · `operator.jsx:161` ใช้ `MAINTENANCE_ROLES.includes(role)` (`sectionScope.js:103`)
- DB: policy UPDATE ของ `employees` = OR ของ `has_perm` ไม่มีด่านหน่วย
- ทิศทาง: เลิกคีย์นี้ → `canWriteUnit(ctx, emp.section)` + ด่านหน่วยฝั่ง DB

### P1-5 จัดกะ (`/shift-organize`) เขียนตามขอบเขตที่ "เห็น"
- `ShiftOrganize.jsx:132,179,295,422` ใช้ `lineScope()` ไม่ใช่ `canWriteLine`
- ฐานจริง: mtn ที่ถือ flag 5 คนมี `scope_depth='all'` ⇒ เห็นทุกไลน์ + ได้ `shift_schedule:edit` จาก bucket ⇒ ตั้งกะได้ทุกไลน์
- ⚠️ ยังไม่ยืนยันว่าตัวบันทึกใช้ `scopedLines` ตัวเดียวกับตอนวาด (unverified)

### P1-6 ฝั่งจอกับฝั่ง DB ตอบ "แก้หน่วยไหนได้" ไม่ตรงกัน ✅ ยืนยัน (โค้ด)
- จอ: `writeUnitsOf()` (`writeScope.js:68-73`) คืน **`sections` (ขอบเขตที่เห็น) ก่อน** แล้วค่อยถอยไป `profiles.section` — ขัดกฎ CLAUDE.md "ห้ามเอา `sections` มาตัดสินการแก้"
- DB: `app_can_write_line()` ใช้ `profiles.section` อย่างเดียว · มี `resp_cost_centers` = คืน true (ไม่เช็ค CC จริง)
- overlay `org_assignments` ขยาย `sections` ที่จอ (`App.jsx:2624-2633`) ⇒ รักษาการขยายการแก้ที่จอแต่ไม่ขยายที่ DB · รักษาการ `scope_depth='all'` ทำให้ `sections` ว่าง ⇒ แก้ได้แค่บ้าน (**แคบกว่า** รักษาการส่วนเดียว)
- เป็นคำถามค้างเดิม `docs/modules/permission-scope-audit.md:772`
- ทิศทาง: แหล่งเดียว (บ้าน + CC + มอบหมาย) ใช้ทั้ง JS และ SQL

### P1-7 `fn_can_manage_display()` ใช้ขอบเขตที่เห็นตัดสินการแก้
- `supabase/migrations/20261014_display_rotation_scope_main.sql:35-41` — `scope_depth='all'` / `sections` ว่าง / `section` ว่าง = true

### P1-8 (เล็ก) policy `document_controls_write_admin_manager` hardcode `role = ANY('{admin,manager}')`
- ไม่มีใครอ้างตารางใน `src/` (น่าจะตายแล้ว) → เปลี่ยนเป็น `has_perm` หรือ drop

---

## 2. 🟠 P2 — กลไก "ขอบเขตกว้างแค่ไหน" ซ้ำซ้อน/ขัดกัน (12 ทาง)

| # | กลไก | ปัญหา |
|---|---|---|
| 1 | `profiles.sections` | ใช้เป็นทั้งขอบเขตเห็น **และ** ขอบเขตแก้ (P1-6) · ยังใช้เดาทีมช่างเมื่อ `mtn_teams` ว่าง (`MtnRepair.jsx:615` · `PMSchedule.jsx:131` · `EquipmentHub.jsx:66` · `PMSetup.jsx:1663` · `PMCheckData.jsx:863`) |
| 2 | `profiles.section` (บ้าน) | `OrgSetup.jsx:45`/`orgNodeEdit.js` มีด่านของตัวเอง (`isAdmin || canOwn && mySecId`) ไม่สน `allUnits`/CC = ตัวตัดสินชุดที่ 3 |
| 3 | `scope_depth` | ตั้งใจเป็นขอบเขต "เห็น" แต่ไปคุมการแก้ (P1-5, P1-7) · backfill เดาจาก role (`20260924_profiles_scope_depth.sql:75-80`) · fallback `FACTORY_WIDE_ROLES=['qa']` (`sectionScope.js:25,53`) ยังทำงานระหว่างโหลดโปรไฟล์ |
| 4 | role `leader` = ขอบเขตไลน์ (hardcode) | `sectionScope.js:166,361` · `Checkin.jsx:352,604,1006` · `ShiftOrganize.jsx:237` · `Report.jsx:1517` · `Dashboard.jsx:709` · `OEEAnalytics.jsx:343` · `LineSelect.jsx:43` · `staleSessions.js:79,85` (`manager || supervisor` เห็นทั้งหมด) — ชื่อ role แทนความลึกขอบเขต ซ้ำกับ `scope_depth`+`line_id` |
| 5 | flag `is_dept_admin` + bucket `dept_admin` | ช่องคีย์สิทธิ์ทางที่ 2 ซ้อนบน role (ดู §4) |
| 6 | role `dept_scope` ✅ ยืนยัน 0 คนถือ | role ตั้งชื่อตามระดับขอบเขต · ไม่อยู่ใน `ROLE_META` (จอเลือกไม่ได้) · แต่ยังรับคีย์ใหม่ทุกครั้งที่ seed (157 คีย์) → ปลดระวาง |
| 7 | `scope:all_units` | ราย role (P1-1) |
| 8 | `resp_cost_centers` | ถูก `allUnits` ทับ · `partial_unit` (`ccScope.js:233`) ให้ผ่านทั้งส่วน ⇒ จอที่ถาม `canWriteUnit(ctx,'<ส่วน>')` เฉยๆ (`KpiMonthly.jsx:291` · `ObeyaSqdcmBoard.jsx:172`) เขียนได้ทั้งส่วน · DB ไม่เช็ค CC เลย |
| 9 | `org_assignments` overlay | ทำที่จอตอน login อย่างเดียว ไม่เข้า `has_perm`/`app_can_write_line` · เขียนผลลง `sections` = ขยายทั้งเห็นและแก้พร้อมกัน |
| 10 | `line_id`/`team`/`mtn_teams` | ไม่มีทีม = ไม่บล็อก ทั้ง 2 ด่าน แต่ `strict` ต่างกัน · ทางลัด manager มีด่านเดียว (P1-2) |
| 11 | viewAs (ดูในมุมมอง) | `App.jsx:2476,2480` เดาบ้าน = `viewAs.sections[0]` — บั๊กแบบเดียวกับที่แก้ใน AddUser แล้ว (`permission-scope-audit.md:738`) |
| 12 | `notify_recipients`/`notif_rule_reach` (DB) | `not r.strict and p.role in ('admin','manager')` ⇒ manager ได้แจ้งเตือนทั้งโรงงาน (ฝั่งอ่าน แต่เป็นกฎ role = ขอบเขต) |

---

## 3. 🟡 P3 — คีย์ที่ "ชื่อ" ฝังขอบเขต + ป้าย/เอกสารคลาดเคลื่อน

**คีย์คู่ที่ซ้ำกับชั้นขอบเขต** — ควรยุบเหลือ action เดียว + `canWriteUnit`/`canWriteTeam`:
`employees:edit_all_sections` · `shift_schedule:edit` vs `:edit_dept` · `org:manage_divisions` vs `org:manage_own_unit` · `mtn_repair:service` vs `:service_own_team`

**ป้าย/เอกสารที่ขัดกฎ 13/11:**
- `src/utils/roleMeta.js:9-11` — manager = "สิทธิ์ทั้งฝ่าย / Full Access" `orgLevel:3` + คำอธิบายว่าขอบเขตจำกัดแค่การดู ไม่จำกัดการแก้ · supervisor = "Section Scope" · leader = "Line/Team Scope"
- `docs/modules/role-system.md` + `20261021_role_dept_scope_main.sql:4` อธิบาย manager→supervisor→leader เป็นชั้นขอบเขต · `role-system.md:171` บอก `employees:edit_all_sections` = ตั้งใจ
- `AddUser.jsx:619-620,2281` บังคับกรอก sections/line_id ตาม role
- role ถูกใช้เป็นตำแหน่ง: เติมชื่อผู้เซ็น `Report.jsx:2987-2996,3019-3024` · `SkillRadarPanel.jsx:87-90` · `MtnRepair.jsx:163-164` (`MTN_HEAD_ROLES`/`DEPT_HEAD_ROLES`) · `PMSchedule.jsx:38` · LPA layer `LayerProcessAudit.jsx:206`
- ฟังก์ชัน DB มี role array: `fn_weekly_skill_update` (`20260820_skill_decay_skip_unmapped.sql:47-50` เช็ค `role in ('admin','manager')` แทน `has_perm('skills:run_weekly_update')` — ขัดกฎ DB ข้อ 3) · `fn_daily_skill_farm` (unverified ว่าเป็นด่านเขียนหรือผู้รับแจ้งเตือน)

**admin bypass ที่ถูกต้อง (ไม่ต้องแก้):** `permissions.js:76,190,204` · `writeScope.js:77` · `ccScope.js:143,212` · `mtnTeams.js:151` · `sectionScope.js:49,160` · `orgNodeEdit.js:32,41` · `OrgSetup.jsx:47` · `protect_profile_role` · `has_perm` · `PermissionsManagement.jsx:279`

---

## 4. ชุดสิทธิ์ Key User (bucket `dept_admin`) — ตรวจ 3 ชั้น

**ต้นเหตุ:** `20260803_dept_admin.sql` ก๊อปทุก action key ของ manager · คอมเมนต์บรรทัด 10 อ้างว่า "scope จำกัดตาม section/ทีมของ base role" **ซึ่งไม่จริง** (คีย์ระดับ role ไม่มีขอบเขต) · ตอนนี้ 147 คีย์ (หลังตัด 14 คีย์ใน `20261020_dept_admin_bucket_trim_main.sql`) · ไม่มี `scope:all_units` (คีย์เกิดทีหลัง) · คีย์ใหม่ที่ seed ให้ manager ไม่ไหลเข้า bucket อัตโนมัติ ⇒ 2 ชุด drift

**ผู้ถือ flag 14 คน:** supervisor 6 (PD1 1 · PD2 1 · PD3 3 · QA 1) · mtn 5 (Tooling 1 · JIG 3 · Maintenance 1 — ทั้ง 5 มี `scope_depth='all'`) · manager 1 · document_control 1 · planner_store 1

### 4.1 ผลรายคีย์ (คน = จำนวนที่ได้คีย์นี้ "เพราะ flag อย่างเดียว" · การใช้จริงจาก `audit_log`/คอลัมน์ผู้เซ็น 120 วัน)

| คีย์ | คน | ด่านชั้น ③ ในโค้ด | ใช้จริงโดยผู้ถือ flag | ข้อเสนอ |
|---|---|---|---|---|
| `company_calendar:edit` | 13 | ทั้งโรงงานโดยออกแบบ | 0 ครั้ง (ตารางมี audit) | **ตัด** |
| `org:manage_divisions` | 7 | ทั้งโรงงาน · ⚠ ถือคีย์นี้อย่างเดียวแก้ `org_nodes` ได้ 0 แถว | 0 ครั้งที่ `org_divisions` | **ตัด** |
| `skills:run_weekly_update` | 13 | ทั้งโรงงาน (RPC) | ไม่มีตัววัด (RPC) | **ตัด** |
| `four_m:manage_docs` | 13 | ทั้งโรงงาน (`doc_forms`) | 0 ครั้ง | **ตัด** |
| `products:create` | 13 | กันรายไลน์ที่จอสำหรับ `dr_products` · ทะเบียนกลางไม่มีด่าน | supervisor PD2/PD3 insert `dr_products` 12 ครั้ง (ไม่แยกว่ามาจากคีย์ไหน) | **รอเคาะ** (คนใช้อยู่) |
| `demand:upload` | 12 | ทั้งโรงงาน (ยอดลูกค้า) | วัดไม่ได้ (DR ไม่ stamp ผู้ทำ) | **ตัด** |
| `shipping:config` | 6 | ทั้งโรงงาน · ไม่มี `has_perm` เลย | วัดไม่ได้ (DR) | **ตัด** |
| `employees:edit_all_sections` | 2 (doc_control, planner_store) | คีย์นี้คือใบผ่านข้ามแผนกเอง | — | **ตัดจาก bucket** (ตัวจริงต้องแก้ P1-4 เพราะ supervisor/leader/mtn ได้จาก role) |
| `four_m:reset` | 13 | **ไม่มีด่านหน่วย (gap)** | supervisor PD1 รีเซ็ต 3 · PD3 รีเซ็ต 3 (ไลน์ในส่วนตัวเอง) | **รอเคาะ** — ใช้อยู่จริง · ถ้าเก็บต้องเติมด่านหน่วย |
| `mtn_repair:qa` | 13 | ไม่มีด่านหน่วย (ลายเซ็น QA) | 🔴 **เซ็นแทน QA 2 ใบ** (supervisor PD2 30/10 + mtn Tooling 01/09) + **ข้าม QA 1 ใบ** (supervisor PD2 30/10) | **ตัด** — คือเคสเซ็นแทนฝ่ายอื่นจริง |
| `event_log:approve_qt` | 13 | ไม่มีด่านหน่วย (QA ใน CQI-15) | วัดไม่ได้ (ตาราง CQI-15 ไม่มี audit trigger) | **ตัด** |
| `event_log:approve_me/_jme/_o` | 7 | เซ็นแทนฝ่าย | วัดไม่ได้ | **รอเคาะ** (ขึ้นกับว่า doc_control/mtn/planner ควรเซ็นช่องไหน) |
| `mtn_repair:assign/service/delete/spare_master` | 8 | ด่านทีมฝั่งจอ · ไม่มีทีม = ผ่าน (fail-open) · `SparePartMaster` เบิก/ปรับยอดไม่มีด่านทีม | supervisor PD3 แก้ `mtn_spare_parts` 6 ครั้ง | **ตัด** สำหรับ role ที่ไม่ใช่ช่าง (รอเคาะ) |
| `daily_report:open/close/approve_close/setup` | 7 (doc_control, mtn, planner) | ปิดกะ/อนุมัติปิดกะ **ไม่มีด่านหน่วย (gap)** | ผู้ปิดกะทั้งหมดเป็น supervisor ที่ได้จาก role อยู่แล้ว · ผู้ถือที่ได้เพราะ flag ใช้ 0 ครั้ง | **ตัด** |
| `qa:record` · `qa:record_action` | 7 | `QaCheckSheet` ไม่มีด่านหน่วย | วัดไม่ได้ (unverified) | **ตัด** |
| `line_stock:approve` | 13 | กันรายไลน์ฝั่งจอ (`writableRows`/`canWriteLine`) | วัดไม่ได้ (DR) | **รอเคาะ** |
| `lpa:delete` | 13 | ✅ กันทั้งจอ+DB | supervisor ลบ `lpa_questions` 8 ครั้ง (คนละคีย์) | เก็บไว้ได้ |
| `skills:delete` | 13 | กันฝั่งจอ · ⚠ ลบครึ่งเดียว (ถือ delete อย่างเดียว ลบ `skill_definitions` ได้ 0 แถวเงียบ) | supervisor ลบ `employee_skills` 380 แถว | **รอเคาะ** (ใช้อยู่) + แก้บั๊กลบครึ่งเดียว |
| `line_setup:delete` | 7 | **ไม่มีด่านหน่วย (gap)** · ⚠ ลบ `workstations` ไม่ได้ถ้าไม่มี `:edit` | ผู้ใช้จริงเป็น supervisor (ได้จาก role) | **ตัด** จาก bucket |

ข้อจำกัดของการวัด: DR หลายตาราง (`mtn_orders`, `production_sessions`, `customer_shipping_orders`) ไม่ stamp `actor_uid` ใน `audit_log` → ใช้คอลัมน์ผู้เซ็นในตารางแทนเท่าที่มี · ตาราง CQI-15 ไม่มี audit trigger

### ✅ ทำแล้ว 13/11 — ตัด 16 คีย์ที่เสนอ "ตัด" ออกจาก bucket
user รัน SQL ใน Main เอง · ผลเช็ค 16 คีย์ `allowed=false` · สำรอง `archive.bk_dept_admin_bucket_20261113` (168 แถว) · migration `supabase/migrations/20261113_dept_admin_bucket_trim2_main.sql`
คีย์ที่ระบุ **รอเคาะ** ในตารางบน ยังไม่แตะ · ผู้ถือ flag ต้อง login ใหม่สิทธิ์จึงมีผล
⚠️ ตัดได้เฉพาะช่องทาง flag — supervisor/leader/mtn ยังได้ `employees:edit_all_sections`/`daily_report:*` จาก role ⇒ ยังต้องแก้ P1

### 4.2 บั๊กที่เจอระหว่างทาง (ฝากแก้)
1. `skills:delete` ลบครึ่งเดียว — policy `skill_definitions` ต้อง `skills:edit` (`20261012_rls_round5…:148-150`) · `operator.jsx:794` เช็คแค่ `.error` ไม่นับแถว ⇒ ลบคะแนน/ข้อกำหนดไปแล้วแต่นิยามทักษะยังอยู่ ไม่มีอะไรเตือน (ขัดกฎ DB ข้อ 2)
2. `line_setup:delete` ลบจุดงานไม่ได้ถ้าไม่มี `line_setup:edit` (`round8:56-58`)
3. `fn_weekly_skill_update` เช็ค role แทน `has_perm` (ขัดกฎ DB ข้อ 3)
4. `daily_report:close_shift` (`DailyReport.jsx:2701-2965`) · `approve_close` (`:3079-3100`) · `four_m:reset` (`Report.jsx:2193-2200`) · `line_setup:delete` (`LineSetup.jsx`) — ไม่มีด่านชั้น ③ เลย

### 4.3 ทิศทางของ bucket
สร้างใหม่จาก **allow-list ชัดเจน** ("งานแอดมินของหน่วยตัวเอง") แทนการก๊อปจาก manager · แต่ละคีย์ต้องผ่าน `canWriteUnit`/`canWriteTeam` ตอนเขียนจริง · เพิ่ม `wf:design` ตอนทำ e-workflow (`E-WORKFLOW-DESIGN.md` §9.4)

---

## 5. ลำดับที่เสนอให้ session ที่รับผิดชอบ
1. **P1-1** ย้าย `scope:all_units` เป็นรายคน — user ต้องเคาะรายชื่อ + เล่นซ้ำกับทะเบียนจริง (`scopeRegistryGate.test.mjs`)
2. **P1-6** รวมแหล่ง "แก้หน่วยไหนได้" เป็นแหล่งเดียว ทั้ง JS (`writeUnitsOf`) และ SQL (`app_can_write_line`)
3. **P1-2..5, P1-7** เดินทุกจุดผ่าน `canWriteUnit`/`canWriteLine`/`canWriteTeam` · ปิด policy เปิดโล่ง `four_m_logs`
4. **§4** ✅ ตัด 16 คีย์แล้ว 13/11 · เหลือคีย์ "รอเคาะ" + สร้าง bucket ใหม่จาก allow-list (§4.3)
5. **§3** ยุบคีย์ที่ชื่อฝังขอบเขต · ปลด role `dept_scope` · แก้ป้าย `roleMeta.js` + `role-system.md`
6. เพิ่มด่าน `regressionGuards`: ห้าม `role === 'manager'` ในตัวตัดสินขอบเขต · ห้ามคีย์ที่ชื่อฝังขอบเขตใหม่


---
## ✅ สถานะ 13/11 (session exciting-faraday) — P1 ทั้งหมด + P2 dept_scope + บั๊ก 3 ตัว ทำแล้วบน branch `claude/exciting-faraday-g7gu9v`
รายละเอียด/ผลพิสูจน์กับทะเบียนจริง/สิ่งที่ยังเหลือ → `docs/modules/permission-scope-audit.md` §16 · migration `supabase/migrations/20261113_role_scope_p1_main.sql` (**ยังไม่ apply — ต้อง apply พร้อม deploy** · user เคาะก่อน merge)
