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
| `production_lines` | ไลน์ผลิต | id, name, section, parent_line_name, std_day_shift, std_night_shift (**กำลังคน — อ่านผ่าน `src/utils/stdManpower.js` เท่านั้น**), **line_type** (stamping/hydroform/laser/welding_assembly/other · source of truth `src/utils/lineTypes.js` · ตั้งที่ LineSetup · **คนละตัวกับ `process_type`** ฝั่ง DR ที่ใช้กรอง downtime/defect types) — 🔴 **ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ** · 🔴 **ไลน์ที่ `line_type` ว่าง ต้องมีตะกร้ารับท้ายลิสต์ ห้ามหายจาก dropdown** (ใช้จริงใน `moveTargets`/`checkStockPlacement`/`bomTree.checkIssueFlow`) · ไลน์ที่ยังว่าง + ประวัติ migration → `docs/modules/demand-flow-tower.md` |
| `oee_targets` | Target **A/P/Q รายกรุ๊ป** (parent line/ไลน์เดี่ยว) — **เป้า OEE ไม่ตั้งเอง คำนวณจาก A×P×Q เสมอ** · ระดับ section ไม่เก็บใน DB ใช้**ค่าเฉลี่ยของกรุ๊ป**คำนวณสดในหน้า OEE (2026-07-13) | group_name (unique), target_a/p/q (null = ค่ามาตรฐาน 90/90/99 → OEE 80.2) · `target_oee` เป็นคอลัมน์ vestigial ห้ามใช้ (แอปคำนวณเอง) · ตั้งจากปุ่ม 🎯 ใน /oee-analytics (สิทธิ์ manage_master_data) · migration `20260713_oee_targets.sql` |
| `profiles` | User roles + scope · **⚠️ ไม่มีคอลัมน์ `email`** (อีเมล login อยู่ที่ `auth.users` เท่านั้น — เอกสารเคยเขียนผิดว่ามี จนเป็นต้นเหตุให้ `fn_audit` อ่าน `coalesce(full_name, email)` แล้วพังเงียบ ไม่บันทึกผู้แก้เลยทั้งระบบ ดูหัวข้อ Traceability) · **ระบบไม่มีการส่งอีเมล** — `notify_email` เป็นคอลัมน์ที่ไม่เคยถูกใช้ส่งอะไร (ช่องกรอกใน `/add-user` ถอดออกแล้ว 2026-08-17) | id, role, **position** (ตำแหน่งจริง — แสดงผลเท่านั้น), full_name, line_id, section, sections[], **mtn_teams[]** (ทีมช่างซ่อมที่สังกัด — แยกคิวใบแจ้งซ่อม MO · แยกจาก sections ที่คุม scope ผลิต · ตั้งที่ /add-user เฉพาะ role งานซ่อม · migration `20260722_profiles_mtn_teams.sql` · 2026-07-22), notify_email, signature_url, avatar_url (รูปโปรไฟล์ user — 2026-07-14) |
| `role_permissions` | สิทธิ์เข้าหน้า/action ตาม role (data-driven) | role, permission_key, allowed |
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
