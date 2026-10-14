# Database Schema — ตารางหลักและกฎประจำตาราง

> ย้ายมาจาก `CLAUDE.md` 2026-09-23 (เพดาน 120 KB — CLAUDE.md เหลือเฉพาะกฎเหล็กข้าม session)
> 🔴 **โครงสร้างจริงอ่านสดที่หน้า `/schema`** (RPC `esm_schema_overview` / `esm_schema_table` ทั้ง 2 project)
> ไฟล์นี้เก็บ **"กฎ/เหตุผล/ประวัติของแต่ละตาราง"** ที่ pg_catalog บอกไม่ได้ — ไม่ใช่ snapshot คอลัมน์
> ⚠️ ถ้าสิ่งที่ต้องการคือ "ตารางนี้มีคอลัมน์อะไร" ให้ดู `/schema` เสมอ ลิสต์มือล้าสมัยทุกครั้ง
>
> ⚠️ **2 projects** — ตารางส่วนใหญ่ในไฟล์นี้อยู่ Main (`ewhdfqwfwofivojtsizn`) · ที่กำกับ **DR** อยู่ Product DB (`eyhclzkifitbhbljgoav` · anon เสมอ)


### หลัก
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `employees` | ข้อมูลพนักงาน | id, employee_id_code, name, image_url, line_id, team (A/B/C), section, is_active, position |
| `production_lines` | ไลน์ผลิต | id, name, section, parent_line_name, std_day_shift, std_night_shift (**กำลังคน — อ่านผ่าน `src/utils/stdManpower.js` เท่านั้น**), **line_type** (stamping/hydroform/laser/welding_assembly/other · source of truth `src/utils/lineTypes.js` · ตั้งที่ LineSetup · **คนละตัวกับ `process_type`** ฝั่ง DR ที่ใช้กรอง downtime/defect types) — 🔴 **ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ** · 🔴 **ไลน์ที่ `line_type` ว่าง ต้องมีตะกร้ารับท้ายลิสต์ ห้ามหายจาก dropdown** (ใช้จริงใน `moveTargets`/`checkStockPlacement`/`bomTree.checkIssueFlow`) · ไลน์ที่ยังว่าง + ประวัติ migration → `docs/modules/demand-flow-tower.md` · 🔴 **`unit_kind`** (`production` default / `support`) = **"เป็นไลน์ผลิตหรือเปล่า"** — ดู §unit_kind ข้างล่าง |
| `oee_targets` | Target **A/P/Q รายกรุ๊ป** (parent line/ไลน์เดี่ยว) — **เป้า OEE ไม่ตั้งเอง คำนวณจาก A×P×Q เสมอ** · ระดับ section ไม่เก็บใน DB ใช้**ค่าเฉลี่ยของกรุ๊ป**คำนวณสดในหน้า OEE (2026-07-13) | group_name (unique), target_a/p/q (null = ค่ามาตรฐาน 90/90/99 → OEE 80.2) · `target_oee` เป็นคอลัมน์ vestigial ห้ามใช้ (แอปคำนวณเอง) · ตั้งจากปุ่ม 🎯 ใน /oee-analytics (สิทธิ์ manage_master_data) · migration `20260713_oee_targets.sql` |
| `profiles` | User roles + scope · **⚠️ ไม่มีคอลัมน์ `email`** (อีเมล login อยู่ที่ `auth.users` เท่านั้น — เอกสารเคยเขียนผิดว่ามี จนเป็นต้นเหตุให้ `fn_audit` อ่าน `coalesce(full_name, email)` แล้วพังเงียบ ไม่บันทึกผู้แก้เลยทั้งระบบ ดูหัวข้อ Traceability) · **ระบบไม่มีการส่งอีเมล** — `notify_email` เป็นคอลัมน์ที่ไม่เคยถูกใช้ส่งอะไร (ช่องกรอกใน `/add-user` ถอดออกแล้ว 2026-08-17) | id, role, **position** (ตำแหน่งจริง — แสดงผลเท่านั้น), full_name, line_id, section, sections[], **mtn_teams[]** (ทีมช่างซ่อมที่สังกัด — แยกคิวใบแจ้งซ่อม MO · แยกจาก sections ที่คุม scope ผลิต · ตั้งที่ /add-user เฉพาะ role งานซ่อม · migration `20260722_profiles_mtn_teams.sql` · 2026-07-22), notify_email, signature_url, avatar_url (รูปโปรไฟล์ user — 2026-07-14) |
| `role_permissions` | สิทธิ์เข้าหน้า/action ตาม role (data-driven) | role, permission_key, allowed |
| `org_nodes` | ผังองค์กร 4 ชั้น (section/department/line/team) — **FK ที่ชี้มาเป็น `restrict` ทั้งหมดแล้ว** (05/10 · `parent_id` เดิม cascade · `employees/profiles.org_node_id` เดิม set null = คนหลุดสังกัดเงียบ) · RLS เขียน `org:manage` / `org:manage_own_unit` · ลบ/เปลี่ยนชื่อต้องผ่าน `src/utils/orgNodeRefs.js` (มีสำเนาชื่อแบบ text ในทะเบียนอื่นที่ไม่มี FK คุม) · 📄 `org-hierarchy.md` §relate table | id, kind, name, code, parent_id, ref_line_id, cost_center, labor_type, division, sort_order, is_active |
| `cost_centers` | ทะเบียน Cost Center (2026-09-08 · single-source audit) — production_lines/org_nodes/cost_center_rates เก็บ code text เหมือนเดิม · แก้ที่ /org-setup แผง 💰 · picker `CostCenterSelect` · RLS เขียน `cost_rate:manage` | code (pk), name, section, is_active |
| `customers` / `suppliers` / `die_press_lines` (**DR**) | ทะเบียนลูกค้า / ผู้ขาย-ผู้รับจ้าง / กลุ่มเครื่องปั๊มแม่พิมพ์ (2026-09-08) — คอลัมน์ปลายทาง (customer · supplier/vendor_name/maker_name · die line_name) เก็บ **name text เหมือนเดิม ไม่ผูก FK** · code = คีย์ normalize · seed จากค่าที่มีอยู่จริง · จัดการที่ /products แท็บ 🏷️ ลูกค้า · 🏭 Supplier และ /die-registry แผง ⚙️ · picker `CustomerSelect` (alias → สะกดหลัก) / `SupplierSelect` / `useDiePressLines` · **die_press_lines ตั้งใจแยกจาก production_lines** (ไม่ให้ "LINE A ( 800 Ton )" โผล่ใน dropdown ไลน์ผลิต) | code (pk), name, aliases[] / kind / tonnage+ref_production_line, is_active |

### การผลิตรายวัน
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `daily_production_logs` | เช็คชื่อ + PPE | work_date, employee_id, is_present, has_helmet, has_boots, has_gloves, assigned_line, shift, has_ot, has_extended_ot |
| `ot_night_bookings` | จองรถ OT ล่วงหน้า (ธุรการจองรถรับส่ง) | work_date, shift (day/night), employee_id, task_type_id, ot_period (วันหยุด 8/10 ชม. — null = OT ปกติ), booked_by · unique(employee_id, work_date, shift) |
| `bus_routes` / `ot_task_types` | master สายรถ / งาน OT (จัดการจากแท็บจองรถใน Report) | code, name, is_active, sort_order |
| `special_task_types` / `leave_types` | master งานนอกไลน์ (Management) / ประเภทลา (Checkin) — เลิก hardcode 2026-08-19 (migration `20260819_special_task_leave_masters_main.sql` **apply แล้ว 2026-08-19** — user รันผ่าน SQL Editor) · จัดการที่แผงจองรถ OT ใน Report (`SimpleNameMaster` · สิทธิ์ `ot_master:manage` เดิม) · โค้ด fallback ค่า default เดิมเมื่อตารางว่าง/ยังไม่ apply | name, is_active, sort_order |
| `attendances` | บันทึกเข้างาน | - |
| `operator_special_tasks` | งานนอกไลน์ | employee_id, work_date, task_type |

### สถานีงาน
| Table | คำอธิบาย |
|-------|---------|
| `workstations` | สถานีในแต่ละไลน์ (pos_top, pos_left สำหรับวาง map) |
| `station_requirements` | ทักษะที่ต้องการต่อสถานี (skill_name, min_score) |
| `line_layouts` | รูปผังไลน์ (image_url) |
| `employee_home_positions` | สถานีประจำของพนักงาน |

### ทักษะ
| Table | คำอธิบาย |
|-------|---------|
| `employee_skills` | คะแนนทักษะรายพนักงาน (skill_name, score 0-100, pending_level, last_daily_farm_date) — **RLS: อ่านได้ทุก role ที่ login, เขียนเฉพาะ admin/manager/supervisor/leader** (2026-07-13) |
| `skill_definitions` | นิยามทักษะ (id, name, label, color) |
| `skill_level_up_requests` | คำขออัพระดับข้ามขั้น 25/50/75/100 — ดู section "Employee Skills & EXP Farming" |
| `skill_update_runs` | log การรัน daily/weekly skill job (กันรันซ้ำ + audit) — เขียนโดยฟังก์ชัน SECURITY DEFINER เท่านั้น |
| `skill_sub_items` | หัวข้อการพิจารณาย่อยต่อสกิล (skill_name, seq, label, wi_ref) — ใช้ในใบประเมินรายบุคคล F-PRS-P1-119 · จัดการที่ operator ⚙️ ปุ่ม 📝 (สิทธิ์ `skills:edit`) · RLS: อ่านทุก role, เขียน admin/mgr/sv/leader (2026-07-16) |

### กะการทำงาน
| Table | คำอธิบาย |
|-------|---------|
| `shift_schedules` | ตารางกะ A/B รายสัปดาห์ · **1 แถว = 1 ขอบเขต: `line_id` (ไลน์ผลิต) หรือ `dept_name` (หน่วยงานสนับสนุน) อย่างใดอย่างหนึ่ง** (check constraint บังคับ) · **ไลน์ลูก inherit กะจากไลน์แม่อัตโนมัติ** เว้นแต่ `is_manual=true` (ตั้งเอง) — ตั้งกะไลน์แม่แล้ว save จะ cascade ไปไลน์ลูกที่ยังตามแม่ (`effTeam`/`parentIdOf` ใน ShiftOrganize) · migration `20260721_shift_schedule_inherit.sql` + `20260811_shift_schedule_department.sql` (ดูกฎเหล็ก "กะของพนักงาน" ด้านล่าง) |
| `shift_overrides` | Override กะรายบุคคล |
| `shift_merge_events` | Merge กะทั้ง section/line |

### PPE
| Table | คำอธิบาย |
|-------|---------|
| `ppe_items` | รายการ PPE (10 รายการ) |
| `ppe_requirements` | PPE ที่แต่ละไลน์ต้องการ (25 รายการ) |
| `ppe_checks` | บันทึกการตรวจ PPE |

### 4M & Notifications
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `four_m_logs` | บันทึกการเปลี่ยนแปลง 4M | work_date, line_name, category (Man/Machine/Material/Method), description, status, created_by, sv_approved_by, approved_by, reject_reason, requires_qa |
| `notifications` | In-app notifications | user_id, title, body, type (success/error/info), is_read, ref_table, ref_id |
| `meeting_action_items` | Action item จากประชุมแถวเช้า **+ ห้อง OBEYA** (ติดตามข้ามวันจนปิด) · **ตารางเดียวใช้ร่วมกัน ห้ามสร้างใหม่** · RLS = `has_perm('morning_meeting:record') or has_perm('obeya:record')` ครบ 4 cmd (2026-09-15) | meeting_date, section, line_name, problem, root_cause, ref_kind/ref_id (ที่มา: downtime/defect/4m/order_miss), assignee, due_date, status (open/doing/done/cancelled), **source** (morning/obeya), **kpi_key** (แกน SQDCM/OEE ที่ใบนี้ไปแก้ — ไม่มี check constraint ตั้งใจ), **target_value/result_value** |
| `event_comments` (**DR**) | 💬 คอมเมนต์+🔔mention ใต้เหตุการณ์ (นำร่อง: ใบซ่อม MO + downtime — ก้าวแรกของสื่อสารในระบบแทน chat แยก, 2026-07-16) | ref_kind (mtn_order/downtime), ref_id (text), author_id/author_name (snapshot — profiles อยู่คนละ project), body, mentions jsonb · component กลาง `src/components/EventComments.jsx` (embed ใน MtnRepair DetailDrawer + แถว DT ใน DailyReport) · mention → client insert `notifications` ตรง (policy `notifications_insert_authenticated`) + รายชื่อจาก RPC `list_mention_users` (SECURITY DEFINER, guard auth.uid, revoke anon) — migrations `20260716_event_comments.sql` (DR) + `20260716_mention_notify.sql` (Main) · จุดใหม่ที่อยากมีคอมเมนต์ให้ reuse component นี้ + เพิ่มค่า ref_kind ใน check constraint |

### Layer Process Audit — LPA (FM-QMR-008 · paperless)
> 📄 โครงตาราง `lpa_questions` · `lpa_plans` · `lpa_plan_days` · `lpa_audits` · `lpa_audit_answers` → `docs/modules/lpa-audit.md`

### OJT (ใบแจ้งการอบรมสอนงาน FM-HRM-004 · paperless)
> 📄 โครงตาราง `ojt_trainings` · `ojt_training_attendees` + กฎของโมดูล → `docs/modules/ojt-training.md`

### ใบรายงานปัญหาการผลิต + ถังเหลือง/ถังแดง + ทะเบียน WI ซ่อม (DR · 2026-09-25)
> 📄 `prod_problem_reports` (ใบ FM-PD1-019 ที่ออกไปแล้ว + `snapshot` เนื้อใบ) ·
> `quality_bin_records` (+`qa_decision`/`special_use_doc_no`) · `repair_wi_registry` (QRs ↔ WI ซ่อม)
> พร้อมกฎว่าทำไมไม่มีคอลัมน์ `tag_date`/`closed_at` → `docs/modules/production-problem-report-bins.md`

---

## 🏷️ `employees.department` = ต้นทางของชื่อหน่วยงานในตารางกะ (2026-10-04)

`shift_schedules.dept_name` **ไม่ใช่ทะเบียน** — `ShiftOrganize` ปั้นรายชื่อแผนกจาก
`employees.department` (ชื่อในผังองค์กรชนะชื่อที่พนักงานกรอก) แล้วเขียนลงทุกครั้งที่บันทึกกะ
⇒ **แก้ชื่อผิดที่ `shift_schedules` ไม่มีผล** สัปดาห์ถัดไปแถวผิดกลับมาใหม่ · ต้องแก้ที่ `employees`

⚠️ `employees.department` ถูกอ่านใน ~12 หน้า (ขอบเขตแจ้งเตือน · รายงาน · ตารางกะ)
⇒ เปลี่ยนค่าผิดตัวเดียว = คนหลุด scope เงียบๆ · **สำรองลง `archive.` ก่อนเสมอ**

**รวมชื่อไปแล้ว 04/10** (migration `20261004_employees_department_typos_main.sql` · apply + ตรวจกลับแล้ว ·
สำรอง `archive._bak_20261004_emp_dept` 6 แถว): `Smail Press`→`SMALL PRESS` · `Big Press`→`BIG PRESS`
· `ฝ่าผลิต`→`ฝ่ายผลิต`

🔴 **จงใจไม่แตะ** คู่ที่ตัดสินแทนคนไม่ได้ — ต้องให้ส่วนงานยืนยันก่อน:
`APRON ASSY` (8) vs `LINE APRON ASSY` (54) · `HDF` (3) vs `HYDROFORM` (46) ·
และ `ASSY2` (13) / `ฝ่ายผลิต` (39) ที่**ยังไม่มีในผังองค์กร** (คนละปัญหา: ผังไม่ครบ ไม่ใช่พิมพ์ผิด)

---

## § RLS ฝั่ง DR project — เคสที่เคยทำพังทั้งระบบ (ย้ายจาก CLAUDE.md 2026-10-05)

กฎย่ออยู่ใน CLAUDE.md §Supabase Projects — ที่นี่เก็บว่าพังแบบไหน

`supabaseDR` ถูกสร้างด้วย `createClient(url, anonKey)` เฉยๆ **ไม่มี `auth` config ผูกกับ session**
⇒ ไม่ว่า user จะ login เข้าแอปแล้วหรือไม่ ทุก query ผ่าน client นี้วิ่งด้วย role `anon` เสมอ

**เคยทำพังจริง 1 ครั้ง:** มี session เปลี่ยน RLS policy ตารางฝั่ง DR จาก `public`/`anon`
ไปเป็น `TO authenticated` แบบเหมา เพราะคิดว่า "ปลอดภัยขึ้น" ⇒ **หายทั้งระบบทันที**:
Product Master · Machine List · PM data · การเปิดกะ — ต้อง **revert ฉุกเฉิน**

**เคสคู่กัน (2026-09-07):** คิวรีเช็ค NPI (ตารางฝั่ง Main) ถูกรันบน "Product DB" แล้วขึ้น
`42P01 relation does not exist` ทั้งที่ migration ลง MAIN สำเร็จแล้ว — เสียเวลาไล่หาสาเหตุทั้งที่
migration ไม่ได้ผิดอะไร ⇒ ที่มาของกฎ "ระบุทั้งชื่อในจอและ project id ทุกครั้ง"

🔴 **ทางแก้ที่ถูกต้องถ้าจะ secure ฝั่ง DR จริง = Edge Function ที่ validate ฝั่ง server เอง**
(ยังไม่ได้ทำ — known gap · ห้ามแก้ด้วยการเปลี่ยน policy)


---

## 🧭 `production_lines.unit_kind` — แยก "หน่วยสนับสนุน" ออกจากไลน์ผลิต (2026-10-13 · คำสั่ง user)

> *"office pd4 เราเห็น user อยากใช้ระบบเช็คชื่อ แต่สร้างเป็นผังออฟฟิส ซึ่งไม่ใช่ไลน์ผลิต
>   มันจะทำให้ระบบงง"*

**ทำไมถึงเกิด:** `production_lines` เป็น**ทางเดียว**ที่ผูกคนเข้าระบบเช็คชื่อได้ (`employees.line_id`)
⇒ หน่วยงานที่ไม่ได้ผลิตถูกสร้างเป็น "ไลน์" ตามไปด้วย แล้วโผล่ใน dropdown ของจอผลิตทุกจอ
และถูกนับเป็นไลน์ในตัวหาร

**ค่า:** `production` (default — แถวเดิมทุกแถว) · `support`
migration `20261013_production_lines_unit_kind_main.sql` (**apply แล้ว 13/10** · Main project)
แถวที่ติดธงตอน apply (user เลือกเอง): `Office PD4` (7 คน) · `Coating` (0) · `Rework - PD1` (5 คน)
— `test` / `test child` / `test child 2` **ไม่ได้ติดธง** (user ไม่ได้เลือก)

### กฎ
🔴 **ตัดสินผ่าน `src/utils/unitKind.js` เท่านั้น** — `isProductionUnit()` / `isSupportUnit()` /
`productionUnits()` / `splitUnitKinds()` · **ห้ามเทียบ `unit_kind === '…'` เองในหน้า**
(ด่าน `unit-kind-via-util`) และ **ห้ามกรองด้วยการเทียบชื่อไลน์**

🔴 **ค่าว่าง/ไม่รู้จัก = ไลน์ผลิต (fail-open)** — ทิศเดียวกับ `staffKind.js`:
พลาดแล้ว "โผล่เกิน" เห็นแล้วรู้ · อีกทาง = ไลน์ผลิตหายจากจอเงียบๆ
⇒ `l.unit_kind === 'production'` **ผิด** เพราะทิ้งแถวที่ยังไม่มีค่าทั้งตาราง

🔴 **ตัวกรองทั้ง 3 ต้องทน `null`** — `= []` ของ default param ครอบแค่ `undefined` ไม่ครอบ `null`
(ผู้เรียกส่ง `null` ได้จริงตอนทะเบียนยังโหลดไม่เสร็จ) · มีเทสคุม

### ใครกรอง ใครไม่กรอง
| ช่องเลือก | default | จอที่ต้องส่ง `includeSupport` |
|---|---|---|
| `<LineSelect>` | **กรอง support ออก** | เช็คชื่อ · จัดกะ · ทะเบียนไลน์ · ผังองค์กร · เพิ่มผู้ใช้ · ทะเบียนพนักงาน · BBS |
| `<LineScopeSelect>` | **กรอง support ออก** | เช็คชื่อ |

· กติกาเดียวกับ `includeRetired` เป๊ะ รวมถึง **ค่าที่เลือกไว้แล้วยังโชว์เสมอ** —
  ติดป้าย `🗂️ หน่วยสนับสนุน` (ไม่ใช่ `(นอกขอบเขตของคุณ)` ซึ่งเป็นคนละเหตุผล
  บอกผิดแล้วคนไปตามหาสิทธิ์ทั้งที่เป็นเรื่องชนิดหน่วย)
· ตั้งค่าที่ `/line-setup` — **เลือกได้ตั้งแต่ตอนสร้างไลน์ใหม่** + แก้ของไลน์เดิมได้ในแผงรายละเอียด
· mock ของ crashsweep มีแถว `support` 1 ตัวเสมอ (แถว 5) — **ห้ามถอด** ไม่งั้นสาขานี้ไม่เคยถูกรัน

## 👥 `employees.staff_kind` — 3 กลุ่ม · 2 แกน (14/10 · คำสั่ง user)

**ค่า:** `shopfloor` (default) · **`technician` (ช่าง)** · `support` · + ค่าเก่า `direct`/`indirect` ที่ constraint ยังรับไว้
migration `20261014b_employees_staff_kind_technician_main.sql` (**apply แล้ว 14/10** · Main)
— **ขยาย constraint อย่างเดียว ไม่ย้ายใคร** ⇒ apply แล้วพฤติกรรมเดิมเป๊ะ จนกว่าจะ backfill

### 🔴 2 แกน — ห้ามยุบเป็นแกนเดียว
| คำถาม | ตอบด้วย | ใคร |
|---|---|---|
| **เช็คชื่อได้ไหม** | `checksInStaff()` = **true ทุกคน** | ทั้ง 3 กลุ่ม (คำสั่ง user: *"สายสนับสนุนอยากใช้ระบบเช็คชื่อ"*) |
| **เป็นกำลังคนของไลน์ไหม** | `isShopfloorStaff()` / `onlyShopfloorStaff()` | **`shopfloor` เท่านั้น** |

· แสดงผล/จัดกลุ่ม = `staffGroupOf()` + `STAFF_KINDS` (ลำดับ = ลำดับบนจอ) · ค่าเก่า `indirect` → กลุ่ม `support`
· 🔴 **ค่าว่าง/ไม่รู้จัก = `shopfloor` (fail-open)** · ตัวกรองใช้ `.not('staff_kind','in',…)` **ห้าม `.eq()`**
  (ค่าใหม่ในอนาคตจะหายจากทุกจอเงียบๆ) — ด่าน `staffKindGuard.test.mjs`

### ใครกรอง ใครไม่กรอง (ด่าน `src/utils/__tests__/staffKindGuard.test.mjs`)
| จอ | กรองไหม | เหตุผล |
|---|---|---|
| `Checkin` ลิสต์หลัก + ใบ export | ❌ ไม่กรอง | ใบเช็คชื่อต้องเห็นครบทุกกลุ่ม — **แยกด้วยการเรียง + แถวหัวข้อกลุ่ม** |
| `Checkin` ช่องยืมคนข้ามไลน์ | ✅ กรอง | ยืมไป "ช่วยไลน์ผลิต" = กำลังคนของไลน์จริง |
| `ShiftOrganize` | ❌ ไม่กรอง | ช่าง/สนับสนุนก็หมุนกะ A/B/C · กรอง = **ไม่มีกะเงียบๆ** |
| `Report` แท็บรายบุคคล (มาทำงาน) · รายงาน OT | ❌ ไม่กรอง | ประวัติ/OT ของคนคนนั้น — กรอง = เปิดดูเดือนของเขาไม่ได้ · OT ที่จ่ายเงินจริงหาย |
| `Report` แท็บสกิล/กำลังคน · `WorkforceInsight` · `ManpowerBoard` | ✅ กรอง | นับกำลังคนของไลน์ |
| `operator.jsx` (ทะเบียนพนักงาน) | ❌ ไม่กรอง | ทะเบียนต้องเห็นทุกคนไม่งั้นแก้ข้อมูลเขาไม่ได้ (เคยพลาด 23/09) · มีชิป 3 กลุ่มให้กรองดูเอง |

🔴 **จอที่กรองแล้วต้องเขียนบนจอว่าตัดใครออกไปเท่าไหร่** (กฎความซื่อสัตย์) —
`WorkforceInsight` แท็บกำลังคนเขียน "ไม่นับช่าง/สายสนับสนุน N คน (M แถวเช็คชื่อ)"
ไม่งั้นคนอ่านเทียบกับใบเช็คชื่อ (เห็นครบทุกกลุ่ม) แล้วตัวเลขไม่ตรง หาสาเหตุไม่ได้

### ⚠️ จอที่ **ยังนับรวมทุกกลุ่ม** (ไม่ join employees — รู้ตัวแล้ว ยังไม่แก้)
`ObeyaSqdcmBoard` (อัตรามาทำงาน KPI) · `WorkforceInsight` แท็บ OT · `Dashboard` · `DeptDashboard` ·
`GroupOverview` · `MorningMeeting` — คิวรี `daily_production_logs` ตรงๆ
⇒ **การ backfill ไม่เปลี่ยนเลขของจอพวกนี้** · จะเปลี่ยนต้องถาม user ก่อน เพราะเป็น**นิยาม KPI**
(อัตรามาทำงานของโรงงาน = รวมธุรการไหม — ทะเบียน KPI Online เป็นเจ้าของนิยาม ห้ามคิดเอง)
📄 ตัวเลขที่วัดไว้ + ผล audit ก่อน backfill → `docs/modules/staff-kind-audit-14-10.md`

### ⏳ backfill — ยังไม่ทำ (รอ user เคาะรายชื่อ)
วัด 14/10: active 223 คน = `shopfloor` 218 + `support` 5 · **`technician` 0 คน**
`position` เป็น enum แล้ว ⇒ ใช้จัดกลุ่มได้ตรง: `technician` 22 คน · สายสนับสนุน (clerk/officer/
engineer/manager/dept_head/section_head) 28 คน · `operator`+`line_leader` 168 คน = หน้างาน
🔴 **ห้าม backfill เหมาจาก `position` เอง** — 12 คนในนั้นเช็คชื่อ/ยืนจุดงานจริงอยู่ทุกวัน
(Office PD4 6 คน เช็คชื่อ 28/28 วัน · ช่าง HYDROFORM 4 คนผูกไลน์ไว้) ⇒ ต้องให้ user ยืนยันรายชื่อ
