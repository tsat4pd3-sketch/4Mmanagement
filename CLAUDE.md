# ESM — Enterprise Shopfloor Management · Project Knowledge Base

ระบบบริหารจัดการโรงงานครบวงจร สำหรับ **Thai Summit Group**  
ครอบคลุม 4M Change Management, CQI-15 Welding Event Log, การเช็คชื่อ-PPE รายวัน, Daily Production Report, Employee Skills Matrix, Shift Management และ Approval Workflow

> ชื่อเดิม: 4M Management System (ยกระดับเป็น Enterprise Shopfloor Management)

---

## ⚠️ กฎการทำงานทุก session — เช็คกฎก่อน, แก้แล้วอัพเดทกฎ (คำสั่งถาวรจาก user 2026-07-09)

**ก่อนลงมือทำงานใดๆ:**
1. อ่านไฟล์นี้ (CLAUDE.md) ให้จบก่อนเสมอ — โดยเฉพาะกฎเหล็ก supabaseDR, Date/Time utilities, Organizational Hierarchy
2. ถ้างานแตะ UI → **ต้องอ่าน `docs/UI-CONVENTIONS.md` ก่อน** และทำตามอย่างเคร่งครัด (marker วงกลม+MK+clamp, Andon, ฟอนต์ขั้นต่ำ 11-12px, can() ฯลฯ)
3. ถ้า convention ขัดกับสิ่งที่กำลังจะทำ → ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยนชัดเจน
4. มีหลาย session ทำงานขนานกัน — `git pull origin main` ก่อนเริ่ม และเช็คว่างานที่จะทำ session อื่นทำไปแล้วหรือยัง

**หลังแก้/เพิ่มอะไรก็ตาม — อัพเดทกฎในคอมมิทเดียวกัน:**
- สร้าง/เปลี่ยน pattern ที่ใช้ร่วมกันหลายหน้า → อัพเดท `docs/UI-CONVENTIONS.md` (พร้อมวันที่)
- เปลี่ยน schema / ตาราง / Edge Function / workflow / กฎธุรกิจ → อัพเดท CLAUDE.md ส่วนที่เกี่ยวข้อง
- เจอกับดัก/บั๊กที่คนถัดไปน่าจะเจอซ้ำ → บันทึกไว้ใน CLAUDE.md (เช่นส่วน "กับดัก CSS")
- เปลี่ยน DB schema → เขียน migration file ใน `supabase/migrations/` เสมอ
- **สร้างฟอร์ม/เอกสารพิมพ์ใหม่ทุกตัว → ต้อง register เข้าระบบทะเบียนเอกสาร `/doc-forms` (Document Master)** ให้ admin/doc_control ปรับแต่งได้เอง (เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer/โลโก้) โดยไม่ต้องแก้โค้ด — ขั้นตอนบังคับ: (1) seed แถวใน `doc_forms` (migration) (2) ฟังก์ชันพิมพ์อ่านค่าผ่าน `src/utils/docForms.js` (`getDocForm`/`docFormSync`/`fullCode` + fallback ค่าเดิมในโค้ดเสมอ) (3) โลโก้ผ่าน `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)` **ห้าม hardcode เลขฟอร์ม/โลโก้ในโค้ด** (ดูรายละเอียดแถว `/doc-forms` ใน Pages & Routes)
- **ห้าม**แก้พฤติกรรมระบบแล้วปล่อยให้เอกสารล้าสมัย — เอกสารที่ผิดแย่กว่าไม่มีเอกสาร

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 19.2.6 |
| Build tool | Vite | 8.0.12 |
| Routing | React Router DOM | 7.15.0 |
| Animation | Framer Motion | 12.38.0 |
| Charts | Recharts | 3.8.1 |
| Database | Supabase (PostgreSQL) | - |
| Auth | Supabase Auth | - |
| Storage | Supabase Storage | - |
| Realtime | Supabase Realtime | - |
| Edge Functions | Deno (Supabase) | - |
| Notification | Telegram Bot API | - |
| Deploy | Render.com (Static Site) | - |

---

## Supabase Projects

ระบบใช้ **2 Supabase projects แยกกัน** — ห้ามสมมติว่าเป็น project เดียว

| Project | ID | ใช้เก็บอะไร | Client ใน code |
|---------|-----|------------|----------------|
| Main | `ewhdfqwfwofivojtsizn` | auth, profiles, employees, production_lines, four_m_logs, cqi15_event_logs, role_permissions ฯลฯ | `supabase` (`src/supabaseClient.js`) |
| DR (Daily Report/PM) | `eyhclzkifitbhbljgoav` | production_sessions, downtime_logs, defect_logs, machines, prod_orders, dr_products, improvements ฯลฯ | `supabaseDR` (`src/supabaseClient.js`) |

> ⚠️ **กฎเหล็ก — `supabaseDR` ไม่เคย authenticate**
> `supabaseDR` ถูกสร้างด้วย `createClient(url, anonKey)` เฉยๆ ไม่มี `auth` config ผูกกับ session เลย
> ไม่ว่า user จะ login เข้าแอปแล้วหรือไม่ ทุก query ผ่าน `supabaseDR` วิ่งด้วย role `anon` เสมอ
> **ห้าม** เปลี่ยน RLS policy ของตารางฝั่ง DR project จาก `public`/`anon` ไปเป็น `TO authenticated` แบบเหมาว่าจะปลอดภัยขึ้น — จะพังทันทีเพราะ client ไม่มี JWT ให้เช็ค (เคยทำพังมาแล้วครั้งหนึ่ง: Product Master, Machine List, PM data, เปิดกะหายหมดทั้งระบบ ต้อง revert ฉุกเฉิน)
> ถ้าจะ secure ฝั่ง DR project จริงๆ ต้องผ่าน Edge Function ที่ validate ฝั่ง server เอง — ยังไม่ได้ทำ เป็น known gap

---

## Database Schema

### หลัก
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `employees` | ข้อมูลพนักงาน | id, employee_id_code, name, image_url, line_id, team (A/B/C), section, is_active, position |
| `production_lines` | ไลน์ผลิต | id, name, section, parent_line_name, std_day_shift, std_night_shift, **line_type** (ประเภทไลน์: stamping/hydroform/laser/welding_assembly/other — source of truth `src/utils/lineTypes.js` · ตั้งค่าที่ LineSetup แผง Standard Manpower · ใช้จัดกลุ่มกำลังผลิต/ผูกที่มา MAT เบอร์ 200 · **คนละตัวกับ `process_type`** ฝั่ง DR (dr_products/machines) ที่ใช้กรอง downtime/defect types · migration `20260722_production_lines_line_type.sql` backfill จากชื่อไลน์ HDF/LASER/ASSY) |
| `oee_targets` | Target **A/P/Q รายกรุ๊ป** (parent line/ไลน์เดี่ยว) — **เป้า OEE ไม่ตั้งเอง คำนวณจาก A×P×Q เสมอ** · ระดับ section ไม่เก็บใน DB ใช้**ค่าเฉลี่ยของกรุ๊ป**คำนวณสดในหน้า OEE (2026-07-13) | group_name (unique), target_a/p/q (null = ค่ามาตรฐาน 90/90/99 → OEE 80.2) · `target_oee` เป็นคอลัมน์ vestigial ห้ามใช้ (แอปคำนวณเอง) · ตั้งจากปุ่ม 🎯 ใน /oee-analytics (สิทธิ์ manage_master_data) · migration `20260713_oee_targets.sql` |
| `profiles` | User roles + scope | id, email, role, **position** (ตำแหน่งจริง — แสดงผลเท่านั้น), full_name, line_id, section, sections[], **mtn_teams[]** (ทีมช่างซ่อมที่สังกัด — แยกคิวใบแจ้งซ่อม MO · แยกจาก sections ที่คุม scope ผลิต · ตั้งที่ /add-user เฉพาะ role งานซ่อม · migration `20260722_profiles_mtn_teams.sql` · 2026-07-22), notify_email, signature_url, avatar_url (รูปโปรไฟล์ user — 2026-07-14) |
| `role_permissions` | สิทธิ์เข้าหน้า/action ตาม role (data-driven) | role, permission_key, allowed |

### การผลิตรายวัน
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `daily_production_logs` | เช็คชื่อ + PPE | work_date, employee_id, is_present, has_helmet, has_boots, has_gloves, assigned_line, shift, has_ot, has_extended_ot |
| `ot_night_bookings` | จองรถ OT ล่วงหน้า (ธุรการจองรถรับส่ง) | work_date, shift (day/night), employee_id, task_type_id, ot_period (วันหยุด 8/10 ชม. — null = OT ปกติ), booked_by · unique(employee_id, work_date, shift) |
| `bus_routes` / `ot_task_types` | master สายรถ / งาน OT (จัดการจากแท็บจองรถใน Report) | code, name, is_active, sort_order |
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
| `shift_schedules` | ตารางกะ A/B รายสัปดาห์ (line_id, work_date, day_team, **`is_manual`**) · **ไลน์ลูก inherit กะจากไลน์แม่อัตโนมัติ** เว้นแต่ `is_manual=true` (ตั้งเอง) — ตั้งกะไลน์แม่แล้ว save จะ cascade ไปไลน์ลูกที่ยังตามแม่ (`effTeam`/`parentIdOf` ใน ShiftOrganize) · migration `20260721_shift_schedule_inherit.sql` |
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
| `meeting_action_items` | Action item จากประชุมแถวเช้า (ติดตามข้ามวันจนปิด) | meeting_date, section, line_name, problem, root_cause, ref_kind/ref_id (ที่มา: downtime/defect/4m/order_miss), assignee, due_date, status (open/doing/done/cancelled) |
| `event_comments` (**DR**) | 💬 คอมเมนต์+🔔mention ใต้เหตุการณ์ (นำร่อง: ใบซ่อม MO + downtime — ก้าวแรกของสื่อสารในระบบแทน chat แยก, 2026-07-16) | ref_kind (mtn_order/downtime), ref_id (text), author_id/author_name (snapshot — profiles อยู่คนละ project), body, mentions jsonb · component กลาง `src/components/EventComments.jsx` (embed ใน MtnRepair DetailDrawer + แถว DT ใน DailyReport) · mention → client insert `notifications` ตรง (policy `notifications_insert_authenticated`) + รายชื่อจาก RPC `list_mention_users` (SECURITY DEFINER, guard auth.uid, revoke anon) — migrations `20260716_event_comments.sql` (DR) + `20260716_mention_notify.sql` (Main) · จุดใหม่ที่อยากมีคอมเมนต์ให้ reuse component นี้ + เพิ่มค่า ref_kind ใน check constraint |

### Layer Process Audit — LPA (FM-QMR-008 — paperless · 2026-07-20)
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `lpa_questions` | คำถาม checklist (seed 23 ข้อมาตรฐาน) — `line_name` null = ทุกไลน์ · category `special` = ข้อเฝ้าระวังปัญหา (สีแดง) ผูกไลน์+ช่วง issue_start/end แสดงเฉพาะช่วงเฝ้าระวัง | category (safety/quality/systemic/visual/special), seq, question, line_name, issue_start/end, is_active |
| `lpa_plans` | แผนตรวจรายเดือน (unique ไลน์+กะ+เดือน) | line_name, shift (day/night), month_key 'YYYY-MM', leader/supervisor/manager/gm_name, stations (list ใช้เติมแผนอัตโนมัติ) |
| `lpa_plan_days` | รายวันของแผน: สถานีตรวจ + ชั้นที่วางแผน | plan_id (FK cascade), day 1-31, station, plan_leader/supervisor/manager/gm |
| `lpa_audits` | ผลตรวจ 1 ครั้ง (unique ไลน์+กะ+วัน+ชั้น) | audit_date, layer (leader/supervisor/manager/gm), station, auditor_name/sig_url |
| `lpa_audit_answers` | คำตอบรายข้อ (snapshot question_text) | audit_id (FK cascade), question_id, answer (Y/N/T/NA), note (บังคับเมื่อ N/T) |

### OJT (ใบแจ้งการอบรมสอนงาน FM-HRM-004 — paperless · 2026-07-20)
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `ojt_trainings` | หัวใบอบรม OJT (หน้า `/ojt-training` · migration `20260714_ojt_training.sql`) | train_date, time_from/to, location, dept/section/department, for_new/for_review/for_method_change, topic, scope, trainer_name, duration_min, maker/approver/hr (name+sig_url — เลือกจาก profiles ที่มี signature_url), status (open/completed) |
| `ojt_training_attendees` | ผู้เข้าอบรมต่อใบ (snapshot ชื่อ/รหัส กัน master เปลี่ยน) | training_id (FK cascade), employee_id, emp_code/emp_name, pre_score/post_score (0-4), sign_url (เซ็นบนจอ → bucket `signatures` path ของ user ที่บันทึก), eval_agree, evaluator_name, sort_order |

---

## Pages & Routes

> สิทธิ์เข้าถึงแต่ละหน้า **ไม่ได้ hardcode ในโค้ดอีกต่อไป** — อ่านจากตาราง `role_permissions` ผ่าน `src/utils/permissions.js` (`canAccessPage`) ปรับได้จากหน้า `/permissions` (admin เท่านั้น) คอลัมน์ "Role" ด้านล่างคือ default ตอน seed ไม่ใช่ source of truth
> ⚠️ **กับดัก seed "ทุก role":** migration ที่ seed ด้วย `enum_range(user_role)` ล็อกรายชื่อ role ณ เวลานั้น — **role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าหน้านั้นไม่ได้ (fail-closed)** เช่น mtn/engineer/planner_store (เพิ่ม 2026-07-13) ไม่มีแถวของ `page:/improvements`/`page:/morning-meeting` (seed 2026-07-12/13) — ถ้าต้องการให้เข้าได้ ให้ admin ติ๊กจากหน้า `/permissions` (ทั้ง 2 หน้าอยู่ใน matrix แล้ว) หรือ migration เพิ่ม role ใหม่ต้อง seed page keys ที่ควรได้ด้วย

> **จัดหมวดเมนูใหม่ทั้งระบบ 2026-07-20 (คำสั่ง user):** ภาพรวม (จอแสดงผล/ผู้บริหาร) → ฝ่ายผลิต (งานประจำวัน) → วิเคราะห์ & รายงาน → พนักงาน & ทักษะ (ใหม่) → Logistic - Store → ซ่อมบำรุง → QA/QC → ตั้งค่า,ฐานข้อมูล — ลำดับอยู่ที่ `NAV_GROUP_ORDER` ใน App.jsx

| Group (sidebar) | Route | Component | Role (seed default) |
|---|---|---|---|
| ภาพรวม | `/` | DeptHub — หน้า Hub เลือกโมดูล (เต็มจอ ไม่มี sidebar, ชิปเมนูดึงจาก NAV_ITEMS) | ทุก role |
| (ไม่อยู่ในเมนูหมวด) | `/remote` | RemoteControl — 🎮 รีโมทจอ: มือถือคุมจอ TV · ลิงก์ 🎮 + ปุ่ม 📺 รับรีโมท อยู่คู่กันโซนล่าง sidebar เห็นเมื่อมีสิทธิ์ `page:/remote` (ดู section "Remote Control") | ทุก role (ปรับที่ /permissions) |
| ภาพรวม | `/dashboard` | Dashboard (ย้ายกลับหมวด ภาพรวม 2026-07-20 — โซนจอแสดงผล) | ทุก role |
| ภาพรวม | `/factory-map` | FactoryMap — ผังรวมโรงงาน: วาด polygon ล้อมแต่ละไลน์บนผังใหญ่ผังเดียว ระบายสีตามสถานะการผลิต (ดู section "Factory Master Map") | ทุก role (edit: admin/mgr/sv) |
| ฝ่ายผลิต | `/morning-meeting` | MorningMeeting — ประชุมแถวเช้า (ดู section "Morning Meeting") | ทุก role (record: admin/mgr/sv/leader) |
| ฝ่ายผลิต | `/checkin` | Checkin | ทุก role |
| ฝ่ายผลิต | `/management` | Management | ทุก role |
| ฝ่ายผลิต | `/daily-report` | DailyReport | ทุก role |
| ฝ่ายผลิต | `/production-plan` | ProductionPlan — วางแผนการผลิต (active planner ดู section "Production Plan") | admin/manager/supervisor/leader/planner_store/sale |
| วิเคราะห์ & รายงาน | `/oee-analytics` | OEEAnalytics | ทุก role |
| ฝ่ายผลิต | `/daily-pm` | DailyPM | ทุก role |
| ฝ่ายผลิต | `/improvements` | Improvements (Kaizen — ดู section "Improvements") | ทุก role (manage: admin/mgr/sv/leader) |
| ฝ่ายผลิต | `/lpa` | LayerProcessAudit — LPA paperless (แผนตรวจ+บันทึกผล+รายงาน FM-QMR-008 — ดู section "Layer Process Audit") | ทุก role (record: mgr/sv/leader/engineer/qa · manage: mgr/sv · delete: mgr) |
| Logistic - Store | `/line-stock` | LineStock | ทุก role |
| Logistic - Store | `/heijunka` | HeijunkaKanban | ทุก role |
| Logistic - Store | `/rack-center` | RackCenter | ทุก role |
| Logistic - Store | `/planner-sales` | PlannerSales | manager/supervisor/leader/qa/sale/planner_store |
| Logistic - Store | `/rundown-stock` | RundownStock | manager/supervisor/leader/qa/sale/planner_store |
| Logistic - Store | `/customer-demand` | CustomerDemand (Delivery) | manager/supervisor/leader/qa/sale/planner_store |
| การตรวจสอบและซ่อมบำรุง | `/mtn-repair` | MtnRepair — ใบแจ้งซ่อม MO 7 ขั้น (ดู section "MTN Work-Order") | ทุก role (ดู) · report/service/qa/approve/manage_master ตามสิทธิ์ |
| การตรวจสอบและซ่อมบำรุง | `/pm-check` | PMCheckData | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-schedule` | PMSchedule | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/mtn-layout` | MtnMachineLayout | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-setup` | PMSetup | admin/manager/supervisor |
| ควบคุมคุณภาพ QA/QC | `/qa` | QualityControl | admin/manager/supervisor/leader/qa/doc_control |
| ควบคุมคุณภาพ QA/QC | `/qa-setup` | QAInspectionSetup | admin/manager/qa |
| ควบคุมคุณภาพ QA/QC | `/event-log` | EventLog | admin/manager/supervisor/leader/qa (CQI-15 + Approval) |
| วิเคราะห์ & รายงาน | `/report` | Report | ทุก role (7 tabs: รายวัน/รายพนักงาน/Log จุดงาน/สรุปช่วงเวลา/4M/ใบบันทึก/จองรถ OT + CSV export) |
| พนักงาน & ทักษะ | `/skills-report` | `<Report mode="skills" />` — 3 แท็บสกิลที่แยกจาก /report (Skill Matrix / ค่าฝีมือ / Multi-Skill Form) component อยู่ใน Report.jsx เดิมทั้งหมด (`SKILL_TAB_IDXS`) | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/org-setup` | OrgSetup | admin |
| พนักงาน & ทักษะ | `/register` | Register | admin/manager/supervisor |
| พนักงาน & ทักษะ | `/operator` | Operator | admin/manager/supervisor/leader |
| พนักงาน & ทักษะ | `/ojt-training` | OjtTraining — ใบอบรม OJT paperless FM-HRM-004: บันทึก+เซ็นบนจอ+พิมพ์ PDF ตามฟอร์มกระดาษ (สิทธิ์บันทึก `ojt:record` = mgr/sv/leader · ลบ `ojt:delete` = mgr · scope ผู้เข้าอบรมตาม leader family/sections · ย้ายจากหมวดฝ่ายผลิตมาอยู่คู่ฐานข้อมูลพนักงาน/สกิล ตามคำสั่ง user 2026-07-20) | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/products` | ProductMaster | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/linesetup` | LineSetup | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/machine-database` | MachineDatabase | admin/manager/supervisor |
| พนักงาน & ทักษะ | `/shift-organize` | ShiftOrganize | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/company-calendar` | CompanyCalendar | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/notification-config` | NotificationConfig | admin เท่านั้น |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/doc-forms` | DocFormsRegistry — 📄 ทะเบียนเอกสาร & ฟอร์ม (Document Master): เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer ของฟอร์มพิมพ์ทุกตัว แก้แล้วใบพิมพ์ใช้ทันทีไม่ต้องแก้โค้ด · ฟังก์ชันพิมพ์อ่านผ่าน `src/utils/docForms.js` (`getDocForm`/`docFormSync` + fallback ค่าเดิมในโค้ดเสมอ) · **ฟอร์มพิมพ์ใหม่ทุกตัวต้อง: (1) seed แถวใน `doc_forms` (2) อ่านเลขฟอร์มผ่าน util นี้ ห้าม hardcode** · ตาราง `doc_forms` (Main, migration `20260720_doc_forms_registry.sql` — seed 6 ฟอร์ม: ojt/lpa_report/lpa_plan/mo_report/multi_skill/individual_skill · sig_blocks ใช้แล้วทั้ง ojt/multi_skill/individual_skill/mo_report — จำนวนช่องต้องเท่า layout เดิม เปลี่ยนได้เฉพาะข้อความ) | ทุก role (แก้: `doc_forms:manage` = mgr/doc_control) |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/permissions` | PermissionsManagement | admin เท่านั้น |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/add-user` | AddUser — จัดการผู้ใช้งาน (ย้ายจากลิงก์พิเศษท้าย sidebar เข้าหมวดตั้งค่าฯ 2026-07-20) | admin เท่านั้น |
| (ไม่อยู่ใน sidebar) | `/login` | Login | ไม่ต้อง auth |

---

## Organizational Hierarchy (Thai Summit Group)

ลำดับชั้นองค์กรที่สอดคล้องกันทั้งระบบ — **ห้ามเพิ่มฟีเจอร์ที่ขัดกับลำดับชั้นนี้**

```
ระดับส่วน (Section)      → org_nodes.kind='section'  cost center 21404XXXX
  เช่น PD1, PD2, QA, MTN, JIG MTN, DIE MTN
      ↓
ระดับแผนก (Department)  → org_nodes.kind='department' cost center 21405XXXX
  เช่น HYDROFORM, ASSEMBLY
      ↓
ระดับกลุ่ม/ไลน์หลัก    → production_lines ที่ parent_line_name IS NULL
  เช่น HYDROFORM (parent), LINE APRON ASSY
      ↓
ระดับไลน์ผลิต           → production_lines ที่ parent_line_name SET
  เช่น HDF1, HDF2, LASER123, LASER456, LASER E50, LASER EXPORT
      ↓
ระดับ Team              → employees.team = 'A' | 'B' | 'C'
  A/B หมุนกะ | C กะเช้าตลอด
```

**กฎการ link ข้ามระดับ:**
- **แผนกที่ไม่ขึ้นกับ Section ใด (ขึ้นตรงฝ่าย) รองรับแล้ว (2026-07-13):** `org_nodes.kind='department'` ที่ `parent_id IS NULL` — สร้าง/ย้ายได้จาก OrgSetup (ตัวเลือก "🏛️ ขึ้นตรงฝ่าย" ในฟอร์ม + กลุ่ม "ขึ้นตรงฝ่าย" ในคอลัมน์ Section) · ข้อจำกัดโดยตั้งใจ: dropdown แผนกใน Register/operator เป็น cascade จาก section ของพนักงาน แผนกขึ้นตรงฝ่ายจึงไม่โผล่ที่นั่น (พนักงานฝ่ายผลิตต้องมี section เสมอเพื่อ scoping)
- `production_lines.section` = `org_nodes.code` ของ section
- `production_lines.parent_line_name` = `name` ของ production_line ระดับแผนก (เช่น 'HYDROFORM')
- Department name ใน org_nodes ต้องตรงกับ parent production_line name เพื่อให้ Register กรอง LINE dropdown ถูก
- Register.jsx กรอง LINE โดย: `l.name === department || l.parent_line_name === department`
- **Dropdown ลำดับชั้น (Section→แผนก→Line→Team) ทุกหน้าต้อง cascade + ล้างตัวลูกเมื่อเปลี่ยนตัวแม่** — กฎเต็มดู `docs/UI-CONVENTIONS.md` §5.3 (เพิ่ม 2026-07-21 หลังพบ Report 5 จุด + operator filter bar โชว์แผนกข้าม section)

> ### ⚠️ กฎเหล็ก — เปลี่ยนชื่อไลน์ (rename) ต้อง cascade `line_name` ทุกตาราง **2 project** (2026-07-22)
> **ชื่อไลน์ถูกเก็บเป็น text snapshot (ไม่ใช่ FK) ในหลายสิบตารางทั้ง Main + DR** — `production_lines.name` เป็นแค่ที่เดียว ที่เหลืออ้างด้วยชื่อ · เปลี่ยนชื่อแล้ว**ไม่ตามไปแก้ทุกที่ = ข้อมูลชื่อเก่ากำพร้าเงียบๆ ทันที**
> **เคสจริงที่เจอ:** เปลี่ยนชื่อไลน์ Laser ใน `/linesetup` → "กะที่เปิดค้าง" หายจากรายการ "กะที่เปิดอยู่" ใน Daily Report (เพราะ `production_sessions.line_name` = ชื่อเก่า แต่หน้ากรองด้วยชื่อไลน์ปัจจุบัน — leader `.in('line_name',[children])`, scoped role `lineMap[s.line_name].section` — session ยังเปิดอยู่ใน DB **แค่ถูกกรองพ้นสายตา** ไม่ได้หาย) · `dr_products.line_name` เก่ายังทำให้เปิด order/สแกนของไลน์ที่เปลี่ยนชื่อไม่ได้ด้วย
> **`handleRenameLine` (LineSetup.jsx) cascade แล้ว (best-effort ต่อ table):** Main = `workstations, line_layouts, wip_buffer_points, machine_points, machine_flow_links, four_m_logs, factory_line_regions, lpa_plans, lpa_audits, meeting_action_items` · DR = `machines, production_sessions, dr_products, line_stock_transactions, jigs, pm_daily_line_targets, mtn_orders, improvements, scrap_reports` + `pm_plans.usage_source_line` · **เพิ่มตารางใหม่ที่เก็บ `line_name` ต้องมาเติมในลิสต์นี้ด้วย** · `handleDeleteLine` มีช่องโหว่เดียวกัน (ลบไลน์ที่ยังมี session เปิด = orphan) — ยังไม่ปิด, เลี่ยงลบไลน์ที่มีกะเปิดค้าง
> **กู้ session ที่กำพร้าไปแล้ว (rename ก่อนมี fix):** ใน `/linesetup` เปลี่ยนชื่อไลน์**กลับเป็นชื่อเก่า** (session ชื่อเก่ากลับมาโผล่) แล้ว**เปลี่ยนเป็นชื่อใหม่ที่ต้องการอีกรอบ** — รอบสองจะ cascade `production_sessions` ตามไปด้วย (fix ใหม่) · หรือ UPDATE `production_sessions.line_name` ชื่อเก่า→ใหม่ ตรงใน DR SQL editor

### ทีมช่างซ่อม 4 ส่วน — data-driven + ยึด department เป็นหลัก (2026-07-22)

**เลิก hardcode ชื่อทีมในโค้ด** (คำสั่ง user) — ทีมช่าง (MTN/JIG MTN/DIE MTN/PRODUCTION) มาจากตาราง **`mtn_teams`** (DR · migration `20260722_mtn_teams.sql`): `key` (=`checklists.department`: maintenance/jig_maintenance/die_maintenance/production) · `label` · `icon` · `equip_type` (machine/jig/die/null) · `dept_name` (โยง `mtn_orders.mtn_dept`) · `color` · เพิ่ม/แก้ทีมได้จากตารางนี้ไม่ต้องแก้โค้ด
- โหลดผ่าน **`src/utils/pmTeams.js`** (`loadPmTeams()` cache + `pmTeamsSync()` + `DEFAULT_TEAMS` fallback ถ้า migration ยังไม่ apply) — หน้า PMSchedule / PMCheckData / MtnMachineLayout ดึง options+label+สี+icon จากตัวนี้ (เดิมต่างคนต่าง hardcode DEPT_OPTIONS/MTN_DEPTS · MtnMachineLayout เคยตกหล่น PRODUCTION)
- **ยึด `checklists.department` เป็นหลักในการแยกทีม** (คำสั่ง user — 1 เครื่องมี PM หลายทีมได้: ผลิตตรวจรายวัน / MTN เข้า PM รายไตรมาส = คนละ checklist คนละ department) · **PMCheckData เดิมกรองด้วย `equipment_type` (jig/die/machine)** ทำให้ของชิ้นเดียวโผล่คนละแท็บกับ PMSchedule → แก้เป็น union: โผล่ใต้ทีม D ถ้า **มี checklist ของ D อยู่แล้ว** (ตรงกับ PMSchedule) **หรือ** ประเภทอุปกรณ์ = `equip_type` default ของทีม (ให้เริ่ม checklist ใหม่ได้) · `clDeptByJig` (jig_id→Set(department)) ใน PMCheckData
- **DEPT_LABEL (`src/lib/pmSchedule.js`) เปลี่ยนชื่อแสดงผลให้ตรงฝั่งแจ้งซ่อม** (MTN/JIG MTN/DIE MTN/PRODUCTION แทน "ซ่อมบำรุง/Die Maintenance/ฝ่ายผลิต") · key เดิมคงไว้
- **ยังเหลือ:** MtnRepair ใช้ `mtn_dept` (ชื่อ "JIG MTN") ยังเก็บ value คนละแบบกับ `checklists.department` ("jig_maintenance") — `mtn_teams.dept_name` เป็นตัวโยง 2 ฝั่ง (ถ้าจะรวม value ให้ตรงกันจริงต้อง migrate data ทีหลัง) · UI จัดการทีม (เพิ่ม/แก้ row) = future (ตอนนี้แก้ผ่านตาราง)
>>>>>>> 043e06f (feat(pm): ทีมช่าง data-driven (mtn_teams) + ยึด department เป็นหลัก)

### Direct / Indirect Labor + รวมช่างเข้าฐานพนักงาน (2026-07-22)

**คนทุกคนอยู่ที่ `employees` ที่เดียว** — operator (ฝ่ายผลิต) และช่างซ่อมบำรุง เป็น employee เหมือนกัน ต่างกันแค่ **ประเภทแรงงาน** และ **section**

- **ประเภทแรงงานตั้งที่ผังองค์กร** (`org_nodes.labor_type` — 'direct'/'indirect') ตั้งได้ทั้ง **section และ department** จาก OrgSetup · **⚠️ ช่างส่วนใหญ่อยู่ระดับแผนก (department) ไม่ใช่ section** → พนักงาน derive **จาก department ก่อน แล้ว section** · seed default (section): ผลิต (PD*/GOR/HYDRO/ASSY/LINE ฯลฯ) = direct, ที่เหลือ = indirect · migration `20260722_org_labor_type.sql`
- **derive ผ่าน `src/utils/laborType.js`** (`buildLaborMap(orgNodes)` รวมทั้ง section+department → `laborTypeOf(section, department, laborMap)` เช็คแผนกก่อน · fallback heuristic: ชื่อเข้าเกณฑ์สนับสนุน MTN/JIG/DIE/QA/คลัง/ธุรการ/ขาย = indirect ก่อน แล้วเกณฑ์ผลิต = direct) — **ห้าม hardcode ว่า node ไหน direct/indirect ในหน้า** อ่านจาก org_nodes เสมอ
- แสดง/กรองในหน้า `/operator` (badge 🔧/🗂️ + ปุ่มกรอง Direct/Indirect) — direct = 🔧 เขียว, indirect = 🗂️ ฟ้า
- **ช่างซ่อมบำรุง = พนักงานแผนก/ส่วน MTN/JIG/DIE** (indirect) มี `employee_skills` เหมือน operator (สกิลซ่อมบำรุง) · สร้างแผนก/ส่วน MTN/JIG/DIE ใน OrgSetup (ตั้ง labor_type = indirect) แล้วลงทะเบียนช่างที่ Register/operator ปกติ
- **MtnRepair dropdown "มอบหมายช่าง" ดึงจาก employees ทีมช่าง** (`teamForSection` ใน `mtnTeams.js` map **department ก่อน แล้ว section** →ทีม) + รวมกับ `mtn_technicians` เดิม (ช่างเฉพาะกิจนอกฐานพนักงาน — fallback ไม่ลบ) · `assigned_to` ยังเก็บเป็น **ชื่อ (text)** เหมือนเดิม (backward-compatible) · ⚙️ MasterTab: ช่างจากฐานพนักงานแสดง read-only (แก้ที่หน้าพนักงาน) เพิ่มได้เฉพาะช่างเฉพาะกิจ · **MtnRepair อ่าน employees ผ่าน client `supabase` (Main, authenticated)** ไม่ใช่ supabaseDR

---

## Role System

> **role = "ชุดสิทธิ์ใช้ระบบ" ไม่ใช่ตำแหน่งงาน (2026-07-10)** — ตำแหน่งจริงในโรงงาน
> (ผู้จัดการฝ่าย/หัวหน้าแผนก/หัวหน้าส่วน/วิศวกร/เจ้าหน้าที่/ช่างเทคนิค ฯลฯ) เก็บที่ `profiles.position`
> (text อิสระ มี datalist แนะนำใน AddUser) ใช้แสดงตัวตน/รายงาน/ลายเซ็นเท่านั้น **ไม่มีผลต่อ permission**
> ตัวอย่าง: คน QA ทุกระดับ (technician→manager) ใช้ role `qa` เหมือนกันถ้าทำงานในระบบเหมือนกัน
> ต่างกันแค่ position · ถ้าวันหน้าระดับต่างกันต้องได้**สิทธิ์**ต่างกันจริง ค่อยเพิ่ม role ใหม่ + แถวใน
> role_permissions (ระบบรองรับ) — **ห้ามเพิ่ม role ตามชื่อตำแหน่งโดยที่ชุดสิทธิ์ไม่ต่างจาก role เดิม**

11 roles ใน enum `user_role`: `admin, manager, supervisor, leader, qa, document_control, sale, mtn, engineer, planner_store, display`

> **ชื่อแสดงผลของ role ไม่ใช้คำตำแหน่งบริษัทแล้ว (2026-07-13)** — เพื่อไม่ให้ชนกับ `profiles.position`
> ชื่อ/ไอคอน/สี/คำอธิบายทั้งหมดอยู่ที่ **`src/utils/roleMeta.js` จุดเดียว** (`ROLE_META`, `ROLE_OPTIONS`, `roleLabel()`)
> — **ห้ามนิยาม label ของ role ซ้ำในหน้าใดๆ** (เคยซ้ำ 4 ไฟล์: App/DeptHub/AddUser/PermissionsManagement — รวมแล้ว)
> รหัสใน DB (enum) คงเดิม เปลี่ยนเฉพาะการแสดงผล · ข้อความ UI ที่พูดถึง role ให้เรียกตามชื่อใหม่ ไม่เรียก Manager/Supervisor/Leader

| Role (รหัสใน DB) | ชื่อแสดงผล | สิทธิ์หลัก |
|------|-----------|-----------|
| `admin` | 🛡️ ผู้ดูแลระบบ (System Admin) | ทุกอย่าง รวมถึง Add User, จัดการสิทธิ์ |
| `manager` | 🏭 สิทธิ์ทั้งฝ่าย (Full Access) | ดูและแก้ไขได้ทุกหน้า ยกเว้น Add User/จัดการสิทธิ์ |
| `supervisor` | 🏢 สิทธิ์ระดับส่วน (Section Scope) | จัดการเฉพาะ section ตัวเอง, Register พนักงาน, อนุมัติ 4M step 1 |
| `leader` | 👥 สิทธิ์ระดับไลน์ (Line/Team Scope) | เห็นเฉพาะ line/team ของตัวเอง |
| `qa` | ✅ งานคุณภาพ (Quality) | ดู Dashboard + Report, อนุมัติ 4M step QA |
| `document_control` | 🗂️ งานเอกสาร (Document Control) | จัดการเอกสาร CQI-15, ปฏิทินบริษัท |
| `sale` | 🚚 ขาย-จัดส่ง (Sales & Delivery) | ทีมขาย — Planner & Sales, Delivery, Kanban, Dashboard (seed: `20260708_sale_role_demand_page_permissions.sql`) |
| `mtn` | 🔧 ซ่อมบำรุง (Maintenance) | ทีมซ่อมบำรุง (MTN/JIG/DIE) — หน้า PM ทั้งหมด, ผังเครื่องจักร, ฐานข้อมูลเครื่องจักร (seed: `20260713_mtn_role.sql`) |
| `engineer` | ⚙️ งานวิศวกรรม (Engineering) | process engineering — Product Master `products:create/edit` (BOM/EC/New Model) โดยไม่พ่วงอำนาจจัดการผลิต/อนุมัติ QA/งาน PM · **ตั้งใจไม่รวมกับ qa/mtn** เพราะอำนาจอนุมัติคุณภาพกับ master เครื่องจักรต้องแยกคนถือ (seed: `20260713_engineer_planner_store_roles.sql`) |
| `planner_store` | 📦 แผนงาน-คลัง (Planner & Store) | ฝั่งคลัง/แผนงาน — Store, Kanban, Rack, Rundown, อัพโหลด Forecast (`heijunka:operate`, `line_stock:issue/manage_rounds`, `rack_center:operate`, `demand:upload`) — แยกจาก `sale` ที่โฟกัส Delivery/Ship-to (seed เดียวกัน) |
| `display` | 📺 จอแสดงผล (View Only) | ดูอย่างเดียว (จอแสดงผลลอย ไม่ login เป็นคน) |

### สิทธิ์ตามหน้า/action — `role_permissions` (data-driven, ไม่ hardcode)

- ตาราง `role_permissions (role, permission_key, allowed)` เป็น source of truth เดียวสำหรับ "role ไหนเข้าหน้า/ทำ action ไหนได้บ้าง"
- โหลดผ่าน `loadPermissions()` (cache ใน memory) แล้วเช็คด้วย `hasPermission(key, role)` / `canAccessPage(path, role)` — ไฟล์ `src/utils/permissions.js`
- `admin` bypass เสมอ (return true ทันทีไม่ query cache) กันกรณี config ผิดจนตัวเองเข้าไม่ได้
- แก้ได้จากหน้า `/permissions` (`src/pages/PermissionsManagement.jsx`) — ตาราง matrix role × permission key, toggle แล้ว upsert ทันที
- permission key รูปแบบ `page:/route` สำหรับสิทธิ์เข้าหน้า, `manage_master_data` สำหรับสิทธิ์แก้ master data รวม (แทนที่เช็ค `['admin','manager','supervisor'].includes(role)` แบบ hardcode ที่กระจายอยู่ ~10 ไฟล์เดิม)
- **ต่างจาก scoping ตาม section/line/team** (ด้านล่าง) — permission ตอบว่า "เข้าหน้านี้ได้ไหม/ทำ action นี้ได้ไหม" ส่วน scoping ตอบว่า "เห็นข้อมูลแถวไหนบ้าง" สองเรื่องนี้แยกกันคนละกลไก

### Section/Line/Team Scoping — รองรับหลาย section ต่อ user แล้ว (2026-07-09)

- ขอบเขตส่วนงานเก็บที่ `profiles.sections text[]` (หลายค่า เช่น `{PD1,PD2,QA}`) โดยยังมี `profiles.section` เดี่ยว (legacy) อยู่คู่กัน — ตีความผ่าน `effectiveSections(role, sections, section)` ใน `src/utils/sectionScope.js` ตามลำดับ:
  1. `admin` → ไม่จำกัดเสมอ
  2. **role คุณภาพทั้งโรงงาน (`qa`) → ไม่จำกัดเสมอ** (2026-07-16) — QA เป็นผู้อนุมัติ 4M step QA / งานคุณภาพข้ามสายผลิตทั้งโรงงาน และ section ของ QA เอง (ค่าจริงในระบบคือ `"QA"`) **ไม่ใช่สายผลิต** ถ้าปล่อยให้ scope ตาม section จะกรองข้อมูลผลิตออกหมด (เห็น 4M/รายงาน = 0 ทุกใบ — bug ที่เจอจริง) · กำหนดใน `FACTORY_WIDE_ROLES` ใน `sectionScope.js` — ถ้าจะให้ QA แยกดูแลราย section จริงต้องคิดกลไกใหม่ (ปัจจุบัน QA ทุกคน sections=`["QA"]`)
  3. `sections` มีค่า → จำกัดตาม array นั้น **ใช้ได้ทุก role ที่เหลือ** (เช่น manager ที่ดูแลเฉพาะ PD1+PD2)
  4. `supervisor` ที่มีแค่ `section` เดี่ยว → `[section]` (พฤติกรรมเดิมเป๊ะ)
  5. role อื่นที่มีแค่ `section` เดี่ยวค้างอยู่ → **ไม่จำกัด** (ตั้งใจ — กัน manager เก่าที่เคยกรอก section ไว้เฉยๆ โดนจำกัดกะทันหันหลัง deploy)
- UserContext ส่ง `sections` = array ผลลัพธ์สุดท้าย (`[]` = ไม่จำกัด) — ในหน้าเช็คด้วย `scopeSecs.length` แล้วกรองด้วย `inSectionScope(scopeSecs, value)` (เทียบ trim+lowercase) หรือ `.in('section', scopeSecs)` ใน query
- `leader` ยังผูก `profiles.line_id` + `team` เหมือนเดิม ไม่เกี่ยวกับ sections — เช็ค branch ของ leader **ก่อน** branch ของ scope เสมอ
- AddUser.jsx: ช่อง Section เป็น checkbox เลือกหลายอันได้ทุก role และ**ยังเขียน `section` เดี่ยว (= ตัวแรกที่ติ๊ก) คู่กันเสมอ — ห้ามเลิกเขียน** เพื่อให้ revert โค้ดกลับเวอร์ชันเก่าได้โดย supervisor ไม่หลุด scope · supervisor ยังบังคับติ๊กอย่างน้อย 1 (Edge Function `create-user` ยังไม่รู้จัก sections — AddUser update ตามหลังด้วย id ที่ได้กลับมา)
- หน้าที่ปิดช่องโหว่แล้ว: Management, Checkin, operator, Register, DailyReport (Live/History/Export), Report (ครบทั้ง 10 แท็บ — รายวัน/รายพนักงาน/Log จุดงาน/สรุปช่วงเวลา/4M + สิทธิ์อนุมัติ SV/Skill Matrix/ค่าฝีมือ/ใบบันทึก/Multi-Skill Form/จองรถ OT — 2026-07-10), ShiftOrganize (ตารางกะ/override/merge event/dropdown ใน modal — 2026-07-10), OEEAnalytics, LineSetup, EventLog, Improvements, Dashboard, MachineDatabase (2026-07-12 — user ยืนยัน: Dashboard/MachineDatabase ก็กรอง ใครไม่มี scope เห็นหมดเหมือนเดิม) — pattern: mandatory scope filter ก่อน แล้วค่อย apply free-text filter ทับ
- หน้าใหม่ที่ query ข้อมูลตาม line/section **ต้องเพิ่ม scope filter แบบเดียวกัน** ไม่งั้นเห็นข้อมูลข้ามส่วนงานโดยไม่ตั้งใจ
- Rollback: `docs/ROLLBACK_MULTI_SECTION_SCOPE.md` — **ห้าม drop คอลัมน์ `sections` ก่อน revert โค้ด** (App.jsx select คอลัมน์นี้ตอน login ถ้า drop ก่อนจะ login ไม่ได้ทั้งระบบ)

### Auth Session & Auto-Logout (กติกาสำคัญ — 2026-07-14 หลังไล่แก้ "เด้ง login บ่อย")

- Session เก็บใน **localStorage** (default ของ supabase-js) แชร์ทุกแท็บของ browser เดียวกัน — **ห้ามเปลี่ยนเป็น sessionStorage** (แท็บใครแท็บมันจะถือ refresh token คนละก๊อปปี้ พอ token หมุนแท็บเก่าหลุดเงียบๆ — ดู comment ใน `src/supabaseClient.js`)
- **`signOut` ทุกจุดต้องใช้ `{ scope: 'local' }`** — default คือ `global` ซึ่ง revoke refresh token ของ user นั้น**ทุกเครื่อง** → account ที่ใช้ร่วมกันหลายจุดในโรงงานโดนเด้งพร้อมกันหมดทุกครั้งที่เครื่องเดียว logout/auto-logout (เคยเป็นสาเหตุหลักของ "เด้ง login บ่อย")
- **Auto-logout (`useAutoLogout` ใน App.jsx):** idle 30 นาที → modal เตือน 5 นาที → logout (role `display` ยกเว้น) โดย:
  - นับ idle **ร่วมกันทุกแท็บ** ผ่าน `localStorage['esm-last-activity']` (เขียน throttle 5 วิ + ฟัง storage event) — ห้ามกลับไปนับต่อแท็บ ไม่งั้นแท็บที่เปิดทิ้งไว้จะ logout ทั้งที่ user ใช้งานอีกแท็บอยู่
  - ระหว่าง countdown ถ้ามี activity (เมาส์/คีย์/แตะจอ — แท็บไหนก็ได้) → ปิดคำเตือนอัตโนมัติ ไม่ต้องกดปุ่ม
- อยากปรับระยะ idle → แก้ `IDLE_TIMEOUT_MS`/`WARN_DURATION_MS` ใน App.jsx จุดเดียว
- **เพดานเวลา login ตามกะ (2026-07-15):** role หน้างานที่ทำงานสลับกะ+ใช้เครื่องเช็คชื่อร่วมกัน (`leader`+`supervisor`) จะถูก **เตะออกทันทีเมื่อเลย "สิ้นกะที่ตอน login + 60 นาที"** ไม่สนใจ idle (กะเช้า 08:00–19:59 → หมดอายุ 21:00 · กะดึก 20:00–07:59 → หมดอายุ 09:00 เช้าถัดไป) — แก้ปัญหาหัวหน้ากะก่อนไม่ logout แล้วคนกะใหม่มาเช็คผิด session · stamp เวลา login ที่ `localStorage['esm-session-started']` ตอน `SIGNED_IN` (ล้างตอน signout) · admin/manager/office/display **ไม่โดน** (ทำงานเครื่องตัวเอง มี idle-logout คุมพอ) · ปรับขอบเขตที่ list `shiftCapped` + ค่า `SHIFT_GRACE_MS`/`shiftDeadlineFrom()` ใน App.jsx

---

## 4M Approval Workflow

```
สร้าง Log → status: "pending"
     ↓
Supervisor อนุมัติ → status: "pending_qa"  (ถ้า requires_qa = true)
                  → status: "approved"     (ถ้าไม่ต้อง QA)
     ↓
QA อนุมัติ → status: "approved"
     ↓ (หรือ)
Reject → status: "rejected" + reject_reason

ทุก status change → Telegram Group แจ้งเตือนทันที
```

---

## Logistic — Planner & Sales / Delivery / Rundown Stock (2026-07-10..11)

โมดูลติดตามการส่งงานลูกค้า (ตารางทั้งหมดอยู่ **DR project**) — 3 หน้า:
`/planner-sales` (Sales อัพโหลด Forecast 830 / Order 862 + Forecast Planner) ·
`/customer-demand` = **Delivery** (Shipping Chart + Ship-to Config) · `/rundown-stock` (Balance FG รายวัน)

### รหัส MAT SAP — ภาษากลาง (2026-07-22 · ใช้คำนี้คุยกับ user ให้ตรงกัน)

| ขึ้นต้น | เรียกว่า | คืออะไร | การไหลของ stock |
|---|---|---|---|
| **1** (เบอร์ 100 เช่น 10100401) | **FG** (Finished Goods) | งานสำเร็จพร้อมขายลูกค้า | ปิดออเดอร์ → เข้า `FG WAREHOUSE` อัตโนมัติ · **ห้ามจ่ายเข้าไลน์/สโตร์** — หักออกทางเดียวคือกด "ส่งแล้ว" หน้า Delivery (แก้ยอดใช้ ปรับยอด ผ่านคิวอนุมัติ) |
| **2** (เบอร์ 200) | **พาร์ทย่อยผลิตเอง** (Child — in-house) | ชิ้นส่วนผลิตภายในโรงงาน ส่วนใหญ่จากไลน์ปั๊ม/stamping (`process_type = metal_forming`) เพื่อป้อนไลน์ประกอบ | ปิดออเดอร์ผลิต → เข้า `STORE` อัตโนมัติ → Store จ่ายเข้า mini-store ของไลน์ → backflush เมื่อ FG ปิดออเดอร์ |
| **3** (เบอร์ 300) | **พาร์ทซื้อภายนอก** (Bought-out) | ชิ้นส่วนซื้อจาก supplier (nut/โบลท์/ชิ้นส่วนสำเร็จ) — **ไม่มีออเดอร์ผลิตภายใน** จึงไม่เข้าจาก trigger ปิดออเดอร์ | รับของเข้า `STORE` ด้วยการบันทึกรับ/ปรับยอดที่หน้า Store → จ่ายเข้าไลน์/backflush เหมือนพาร์ทย่อยปกติ (บนบอร์ด Kanban รวมเรียก "Store Child (200/300)") |
| **5** (เบอร์ 500) | **วัตถุดิบ** (Raw Mat) | วัตถุดิบตั้งต้น | เบิกจาก Store Raw ไปไลน์ผลิต child (ใบเบิกจาก lot request) |
| MB3B/RB3B… | เลขพาร์ทลูกค้า (Ford P/N) | ไม่ใช่ MAT SAP | ใช้เป็น key ชั่วคราวเมื่อจับคู่ mat ภายในไม่ได้ (เพิ่ม P/N ใน Product Master แล้วอัพโหลดใหม่เพื่อ map) |

- UI ฝั่ง Store (`LineStock.jsx` helper `isFgMat`): แถว FG ไม่มีปุ่ม "+ จ่าย" (โชว์ "🚚 หักผ่าน Delivery" แทน)
  และฟอร์มบล็อก type `issue` สำหรับ MAT ขึ้นต้น 1

### กฎธุรกิจที่ห้ามทำพัง

- **กรอบวันงาน 08:00 → 08:00 วันถัดไป** — order ที่ `ship_time < 08:00` ของวันถัดไปนับเป็นกะดึกของวันงานนี้
- **สถานะรอบส่ง (chain เดียว ห้ามข้าม):** `pending → confirmed → prepared → loaded → shipped`
  ตรงกับ 4 activity ของ walkback (`shipping_workflow_steps` — default: ยืนยันออเดอร์ −240 นาที →
  เตรียมเสร็จ −120 → โหลดขึ้นรถ −60 → ถึงลูกค้า 0 · override รายลูกค้าได้ เพิ่ม/ลดจำนวนเฟสได้)
- **เลยเวลา (แดง):** ยังไม่ shipped และ (ก) เป็นวันงานปัจจุบันและเลยเวลาส่งแล้ว หรือ (ข) **เป็นวันงานที่ผ่านมาแล้ว
  — แดงเสมอทั้งวัน** ห้ามผูกกับ `isToday` อย่างเดียว (เคยพัง: พอข้ามวัน ใบตกดิวกลายเป็นเหลือง "รอยืนยัน"
  และตัวนับเลยเวลา = 0) · เฟส walkback ที่ไม่เสร็จของวันเก่านับ "หลุดเฟส" เช่นกัน
  · หัวหน้า Delivery มีปุ่มแดง "⏰ ค้างส่งจากวันก่อน N ใบ" (สแกนย้อน 14 วัน กดกระโดดไปวันนั้น)
- **order ไม่ระบุเวลา (`ship_time = null`):** ไม่เดาเวลาให้ (จะหลอก walkback/phase alert) —
  บนชาร์ตรวมเป็นชิป ⏳ ท้ายแถว, การ์ดโชว์ "⏳ ไม่ระบุเวลา"
- **แจ้งเตือนหลุดเฟสเป็นหน้าที่ scanner ฝั่ง server** (`shipping-phase-scan` pg_cron ทุก 10 นาที
  + dedup ใน `shipping_phase_alerts`) — ห้ามย้ายกลับมา client (ทำงานแม้ไม่มีใครเปิดหน้า)

### วงจร FG stock (ครบ loop — ห้ามตัดขาตอนแก้)

```
สแกนปิดออเดอร์ผลิต (prod_orders → confirmed)
  → trigger trg_post_confirmed_output post เข้า stock ปลายทางทันที ไม่รอปิดกะ
    (กฎปลายทาง stock_inflow_rules: MAT ขึ้นต้น 1 → FG WAREHOUSE · 2 → STORE ·
     ปรับได้ที่ Store management → ⚙️ รับเข้าอัตโนมัติ · กันซ้ำด้วย ref_order_id)
  → Shipping Chart เห็น stock พร้อมส่งต่อรอบ (FIFO ตามเวลาส่ง): เขียวครบ / เหลืองขาดบางส่วน /
    🚨 แดง "ไม่มี stock ต้องผลิต!" (ห้ามปล่อยใบไม่มี stock เงียบ) + ตัวนับ "N รอบ stock ไม่พอ"
  → กด "ส่งแล้ว" หัก stock อัตโนมัติ (line_stock_transactions type consume)
  → Rundown Stock: Balance วัน D = stock ตอนนี้ − order ค้างส่งสะสม (ค้างเก่ารวมเข้าวันนี้
    เรียงพาร์ทที่จะขาดเร็วสุดขึ้นบน) — realtime ไม่ต้องรอปิดกะ
```

- การจับคู่เลขพาร์ทลูกค้า → mat ภายใน: normalize (ตัด ขีด/ช่องว่าง, uppercase) เทียบ `p_no`
  ใน kanban_standards/dr_products — FG (ขึ้นต้น 1) ชนะ child · จับคู่ไม่ได้ = เก็บด้วยเลขพาร์ทลูกค้าไปก่อน
- นำเข้า EDI ซ้ำ = **แทนที่ฉบับเดิมของ ship-to เดียวกัน** (ยอดไม่ทบ) เก็บใบที่เลย pending ไปแล้วเสมอ
- **order เข้าระบบได้ 3 ทาง:** (1) EDI 862 (source `edi_862`) (2) Excel manual mapping (3) ปุ่ม
  "➕ เพิ่ม order ด่วน" บนหน้า Delivery คีย์ทีละใบ (source `manual` · สิทธิ์ `can('shipping','config')` ·
  ลูกค้าสั่งนอกไฟล์ EDI/โทรสั่ง) — ใบ source อื่นที่ไม่ใช่ `edi_862` **ไม่ถูกแทนที่**ตอนอัพโหลด 862 ซ้ำ ·
  ใบคีย์มือที่ยัง pending ลบได้จาก popup บนชาร์ต
- การปรับ stock ที่กรอกมือ (type adjust) เข้าคิว ⏳ รออนุมัติก่อนมีผลต่อยอด — auto movement ไม่เข้าคิว
- แจ้งเตือน Telegram ผ่าน framework `notification_rules` category `logistic`:
  `edi_import`, `shipping_shipped`, `shipping_overdue`, `shipping_phase_alert`

---

## Kanban Auto-Calc — คำนวณ kanban จาก forecast (แท็บ 🎴 คำนวณ Kanban ใน /planner-sales · 2026-07-16..17)

Planner/Sale อัพโหลด forecast ลูกค้า → ระบบคำนวณจำนวน kanban ที่ใช้ในระบบดึงอัตโนมัติ · สูตรถอดจากไฟล์ Excel จริง (verify กับตัวอย่างที่คำนวณมือ) · helper กลาง **`src/utils/kanbanCalc.js`** (pure functions — `calcWithdrawalKanban`/`calcProductionKanban`/`nextMonthKey`, `⌈x⌉` = `Math.ceil(x-1e-9)`) · UI = `KanbanCalcTab` ใน `PlannerSales.jsx`

- **2 ชนิด (toggle บนหัวแท็บ):** 🔄 **Withdrawal** (คัมบังเบิกถอน FG) · 🏭 **Production** (คัมบังสั่งผลิต press — Vol/Day, Info/Process/Safety LT, Kanban/Lot, Kanban(sys))
- **เดือน default = เดือนถัดไป** (`nextMonthKey` — planner คำนวณปลายเดือนสำหรับเดือนหน้า) · **วันทำงาน/เดือน ลิงก์ปฏิทินบริษัท** (`countWorkingDays`: จ-ศ − วันหยุด + เสาร์/อาทิตย์ที่มาร์ค `working` · แก้ทับได้) · Production เพิ่มช่อง ชม.ทำงาน/วัน (default 16) คิด available time
- **flow:** แก้ param ในตาราง (edit ชั่วคราว > param บันทึก > default จาก master) → ค่าคำนวณอัปเดตทันที → **Preview & Apply** → เขียน `kanban_standards` (`min_qty`/`max_qty` = ชิ้น, `qty_per_kanban` = pkg, `total_kanban` = ใบ, `lot_size`) — **Store (LineStock) ดึง min/max ตรงนี้ต่อ = จุดเดียวที่ Store↔Planner sync** · param ที่ใช้จำลง `kanban_calc_params` (รอบหน้า prefill) · **export CSV** (Production แนบตารางสรุป capacity ท้ายไฟล์)
- **สรุปภาระการผลิต (Production):** Σ work-time/ไลน์ [(setup+lot×CT)×(order/lot)] เทียบ available (ชม./วัน×วันทำงาน) = **%load** ต่อไลน์ (<85 เขียว · 85–100 เหลือง · >100 แดง=เกิน capacity)
- **⚠️ กุญแจ sync = `mat_no` (เลข SAP ภายใน) เท่านั้น:** ตอนอัพโหลด forecast ระบบ map เลขพาร์ทลูกค้า → SAP ผ่าน **`p_no`** ใน `dr_products`/`kanban_standards` (normalize ตัดขีด/ช่องว่าง · FG ขึ้นต้น 1 ชนะ) · **จับคู่ไม่ได้ = เก็บเลขพาร์ทลูกค้าไว้ใน `mat_no` ไปก่อน** (`PlannerSales.jsx` insert: `mat_no: hit ? hit.mat_no : r.part`) → แถวนั้นคำนวณ kanban ไม่ได้ + Store/Production ที่ใช้เลข SAP จะไม่เห็น · **ปุ่ม 🔗 จับคู่เลข SAP** ในแท็บ (banner เตือน N พาร์ท) เขียน `p_no` ให้ dr_products (auto-map รอบหน้า) + re-point `customer_forecasts.mat_no` เดิม → ต้องเติม p_no ให้ครบ Store/Planner ถึง sync จริง · modal มี **auto-suggest จับคู่ด้วย base part** (`baseOfPart` — ตัด revision token ตัวท้าย ≤2 ตัว แล้วเทียบ p_no ที่มีในระบบ · เช่น forecast `MB3B 16C274 CE` ↔ dr `MB3B-16C274`) ตัวเดียวชัด = เติมให้อัตโนมัติ · กำกวมหลายตัว = โชว์ชิปเขียวให้กดเลือก · พาร์ทที่ไม่มีใน Product Master เลยต้องไปสร้างก่อน
- **⚠️ Order/Month รวม forecast source เดียว กัน double-count (2026-07-21):** `customer_forecasts.period_month` เก็บ 2 grain ปนกัน — EDI 830 = วันราย週 (`period_month = r.date`) · manual = ต้นเดือน (`monthFirst`) · ตอนรวม Order/Month ต่อ mat ถ้าบวกทุก row จะซ้ำเมื่อ mat มีทั้ง 2 source ในเดือนเดียว → **รวมเฉพาะ source เดียว: EDI 830 (official) ก่อน ไม่มีค่อยใช้ manual** (`fBySrc` ใน KanbanCalcTab `load()`) · weekly ที่คาบเกี่ยวขอบเดือนยังนับตามเดือนที่ `period_month` ตก (calendar-month bucket — accept ได้)
- **DB:** `kanban_calc_settings` (working_days/efficiency_pct/**hours_per_day**) · `kanban_calc_params` (per-part param + **calc_type/process_count/lot_qty/setup_time_sec** สำหรับ production) · migration `20260710_kanban_auto_calc.sql` + **`20260716_kanban_production_calc.sql`** (DR, additive) — ⚠️ ถ้ายังไม่ apply migration ตัวหลัง: หน้ายังคำนวณ/Preview/Apply เข้า kanban_standards ได้ปกติ แต่ param เฉพาะ production + hours_per_day จะยังไม่ถูกจำข้ามรอบ (โค้ด best-effort + toast เตือน)

---

## Daily Report — ออเดอร์ manual สำหรับไลน์ไม่มี kanban card (2026-07-12)

ไลน์บางไลน์ (เช่น HDF1 ที่ส่งงานต่อ LASER CUT 123) **ไม่มีเลข SAP order ให้สแกน** เปิด-ปิดใบแบบปกติไม่ได้:

- ปุ่ม "✍️ เปิดเป้า (ไม่มีบาร์โค้ด)" ข้างปุ่ม Scan เปิด Order — leader ตั้งเป้า (เลือกสินค้า + จำนวน) → สร้าง `prod_orders` ที่ `is_manual=true`, `prod_no='MANUAL-HHmmss'`, `qty_target`=เป้า, `qty`=เป้า (ใช้กับ capacity check/บอร์ดเหมือนใบปกติ) · มี ⏪ **เปิดย้อนหลัง**เหมือนใบสแกน (บังคับกรอกเวลา + กันหลุดกรอบกะ + `opened_at` anchor กับ work_date — helper ร่วม `backfillIsoFromTime` · 2026-07-13) · **งานคู่ RH/LH**: สินค้ามี `pair_mat_no` → ถาม confirm แล้วเปิดเป้าคู่ให้อัตโนมัติ (`prod_no`+`P`, ผูก `paired_order_id` สองทาง, sync `opened_at`) รองรับคู่**คนละไลน์** — เปิดเข้า session ที่เปิดอยู่ของไลน์คู่ (วัน/กะเดียวกัน) ถ้าไลน์คู่ยังไม่เปิดกะจะเตือนให้ไปเปิดเอง (2026-07-13)
- **งานคู่ RH/LH บนบอร์ด Heijunka = แถบวางขนาน ไม่เรียงต่อกัน (2026-07-21):** แม่พิมพ์คู่ปั๊มครั้งเดียวได้ทั้ง LH+RH = ทำพร้อมกัน (parallel) · บอร์ด (Dashboard + Management) จัดคิว **ระดับ sub-line** ปกติ "1 ไลน์ทีละใบ เรียงต่อกัน" แต่**พาร์ทที่มี `pair_mat_no` และคู่ของมันอยู่ในไลน์เดียวกันจริง → แยกเป็นเลนคิวของตัวเอง (parallel) เริ่มพร้อมกัน** แถบ LH/RH จึงตรงกัน (helper `laneKeyOf` ตอนจัดกลุ่ม `byLane` ก่อนเรียก `computeQueuedPositionsFull`) · เดิมไม่เช็ค pair_mat_no เลยจับ LH เรียงหน้า RH เรียงหลังผิด (นับเวลาซ้ำ 2 เท่า) · พาร์ทไม่มีคู่ยังเรียงต่อกันเหมือนเดิม (1 ไลน์ทีละใบ ห้ามซ้อน)
- พนักงาน**อัพเดทยอดสะสม (`qty_actual`) ทุกช่วงเบรคตาม break policy** จากช่องบนการ์ดใบ — เห็นยอดจริงทุก ~2 ชม. · `qty_updated_at` เก็บเวลาล่าสุด ใบที่ไม่อัพเดท > 2.5 ชม. ขึ้นเตือนเหลือง (นิ่ง — ตาม Andon เหลืองไม่กระพริบ)
- ปิดใบด้วยปุ่ม "✓ ปิดใบนี้ (ยอดจริง)" (ไม่ต้องสแกน) → `status=confirmed`, **`qty` และ `qty_ok` ถูกแทนด้วยยอดจริง** เพื่อให้ OEE/รายงาน/stock trigger (`coalesce(qty_ok, qty)`) นับจากของที่ผลิตได้จริง — เป้าเดิมยังอยู่ที่ `qty_target`
- ใบ manual ที่ค้างเปิดตอนปิดกะ เข้า flow ยกยอด/กรอก actual ของ modal ปิดกะเหมือนใบปกติ
- **ยอดสะสมของใบ manual ที่ยังเปิด ถูกนับเข้า "ผลิตได้"/ความคืบหน้า/แยกตามชิ้นงาน ทันที** (ไม่ต้องรอปิดใบ — ไม่งั้นเห็น 0 ทั้งกะ) และ**ทุกครั้งที่กรอกถูก log ลง `prod_order_qty_updates`** (qty_accum, qty_delta, is_final, logged_at/by) → การ์ดใบโชว์ชิปประวัติต่อช่วง เช่น "10:00 · สะสม 200 (+200)" "12:00 · สะสม 480 (+280)" (migration `20260713_prod_order_qty_update_log.sql`)
- **บนบอร์ด Heijunka (Dashboard/Management):** การ์ด manual ใช้ไอคอน ✍️ + ยอด `ทำได้/เป้า` และแถบ fill ในการ์ดวิ่งตาม qty_actual (ใบสแกนปกติแสดงเหมือนเดิม)
- migration: `20260712_prod_orders_manual_mode.sql` (DR, additive — ใบสแกนปกติไม่กระทบ)

### ถอยใบที่สแกนปิดไปแล้ว (revert confirmed → open) — 2026-07-15

ปุ่ม **↩️ ถอยใบ** บนใบ `confirmed` ใน DailyReport (เคสจริง: หัวหน้ากลุ่มสแกนปิดเกินยอดที่ผลิตได้/ปิดผิดใบ):
- เงื่อนไข: **เฉพาะกะที่ยังเปิดอยู่** (`selSession.status === 'open'`) — หลังปิดกะ/ส่งขออนุมัติ ยอด+OEE ถูก stamp ลง session แล้ว ถอยไม่ได้ · สิทธิ์ = `canEditRecords` (leader ตอนกะเปิด / manager+)
- สิ่งที่ย้อนให้: status→open, ล้าง confirmed_by/at + qty_ok, ใบ manual คืน `qty = qty_target` (ยอดสะสม qty_actual คงไว้) + **ถอนแถว stock ที่ trigger `trg_post_confirmed_output` โพสต์อัตโนมัติ** (ลบ `line_stock_transactions` ที่ `ref_order_id`+`created_by='auto'`+`type='issue'` — ตัวกันโพสต์ซ้ำของ trigger เช็คจากแถวนี้ ลบแล้วสแกนปิดใหม่จะโพสต์ให้ใหม่ถูกต้อง)
- Audit: `prod_orders.reopened_by/reopened_at/reopen_count` (migration `20260715_prod_orders_reopen_log.sql` DR) — การ์ดใบโชว์ชิป "↩️ เคยถอยใบ N ครั้ง · ชื่อ" เสมอ ให้หัวหน้าแผนกตรวจย้อนหลังได้ · update guard `.eq('status','confirmed')` กันถอยซ้ำสองเครื่องพร้อมกัน

---

## OEE (computeOEE ใน DailyReport) — กฎ P สำหรับหลาย MAT.NO (2026-07-14)

- **ตรวจ parallel ระดับ "product" ไม่ใช่ระดับ MAT.NO** — MAT ที่เป็น product เดียวกันแตกตามลูกค้า (ชื่อชิ้นงานเดียวกัน เช่น FVL/FTM/AAT) คืองานตัวเดียวกันแค่ส่งแยกลูกค้า **ขึ้น parallel กันเองไม่ได้** ระบบรวมเป็นสายเดียวก่อน (จับกลุ่มด้วยชื่อ product จาก kanban_standards→dr_products) แล้วค่อยเช็ค overlap ระหว่าง "คนละ product จริงๆ"
- **parallel = คนละ product ที่ window ทับกัน >15 นาที + >20% ของ window ที่สั้นกว่า** (จังหวะสแกนคาบเกี่ยวไม่นับ) — เช่น RH ที่ Line 60 + LH ที่ Line 61 ใน session ไลน์แม่ APRON ASSY · P แบบ parallel = Σ(qty×CT) ÷ Σ(run ต่อ product group) — **ห้าม mean เท่าๆ กัน** (งานแทรกเล็กเคยลาก P ทั้งกะจาก ~93 เหลือ 48)
- ไม่เข้าเกณฑ์ = sequential: P = Σ(qty×CT) ÷ run ทั้งกะ (จับ idle ระหว่างงานด้วย)
- บั๊กเดิม (ก่อน 2026-07-14) ทำ P ต่ำเกินจริงในกะ multi-MAT — แก้ย้อนหลังใน DB แล้ว 12 กะ (22/06–13/07) ด้วย SQL ที่ replicate สูตรแล้ว validate กับการคำนวณมือ

> ### ⚠️ กฎงานคู่ RH/LH — ต้องตั้ง `dr_products.pair_mat_no` ให้ครบ **ทั้ง 2 ทาง** (ทุก session ต้องรู้ · 2026-07-21)
> งานคู่ (แม่พิมพ์คู่ ปั๊มครั้งเดียวได้ทั้ง LH+RH = ทำพร้อมกัน) ผูกกันด้วย `pair_mat_no` ใน **Product Master (DR `dr_products`)** — LH ต้องชี้ไป RH **และ** RH ต้องชี้กลับมา LH (ตั้งจากหน้า `/products`) · ค่านี้เป็น source of truth เดียวที่ 3 จุดนี้พึ่งพา:
> 1. **เปิดเป้าคู่อัตโนมัติ** (DailyReport manual open — สร้าง prod_orders คู่ให้เอง)
> 2. **OEE `computeOEE`** — จับเป็น product group เดียว/parallel ถูกต้อง (ดูบล็อกด้านบน)
> 3. **บอร์ด Heijunka (Dashboard + Management)** — วางแถบ **ขนาน (parallel lane)** เริ่มพร้อมกัน แทนการเรียงต่อกัน (helper `laneKeyOf` · 2026-07-21)
> 4. **สรุปยอด "ภาพใหญ่" นับงานคู่เป็น 1 คู่/stroke** (1 ปั๊ม = 1 คู่ ไม่บวกชิ้น LH+RH ซ้ำ) — util กลาง `src/utils/pairTotals.js` `pairAwareTotal(perMat, pairOf)`: คู่ที่มีทั้ง 2 พาร์ทในชุด → เป้า/ผลิต = **max ของสองข้าง** · พาร์ทเดี่ยว/ไม่ระบุ mat = บวกปกติ · ใช้แล้วที่ DailyReport (ภาพรวมทั้งกะ) / FactoryMap (metric ยอดผลิต) / Dashboard (การ์ด demand/actual) / MorningMeeting (ผลิตจริง-เป้ากะ) / OEEAnalytics (KPI ผลิตวันนี้ panel 3) · **แถบรายพาร์ทยังโชว์แยก RH/LH เหมือนเดิม** · INPUT/material ยังนับชิ้นจริง (เบิกตามชิ้น) · จอสรุปใหม่ที่บวกยอดข้ามพาร์ทให้ใช้ helper นี้ (2026-07-21)
>    - **หลักการ (trial phase — cutoff ระบบเก่าสิ้นเดือน):** ยอดรวม "ภาพใหญ่" คำนวณ**สด**จาก `prod_orders` ต่อ mat ทุกจอ ไม่แตะ DB/ค่าที่ stamp ตอนปิดกะ — ข้อมูลรายพาร์ท/รายลูกค้า/เจาะราย MAT SAP ยังอยู่ครบใน prod_orders (แยก LH/RH, เสียเท่าไหร่ ดูได้เหมือนเดิม) · **เฉพาะกะที่มีคู่จริงถึง recompute** (blast radius แคบ) — กะไม่มีคู่ใช้ค่า stamped เดิม (MorningMeeting `sessTarget/sessActual`, OEEAnalytics `tdKpi`)
>
> **ถ้าไม่ตั้ง `pair_mat_no` หรือ ตั้งข้างเดียว** → อาการ: แถบ LH/RH บนบอร์ดไม่ตรงกัน (LH ต้นกะ RH ท้ายกะ) · OEE นับเวลา run ซ้ำ 2 เท่า · เปิดเป้าคู่ไม่ทำงาน — **เจ ออาการพวกนี้ให้เช็ค `pair_mat_no` ก่อนแก้โค้ด** · เพิ่มฟีเจอร์ที่แตะคู่ RH/LH ให้ยึด `pair_mat_no` เป็นตัวจับคู่เสมอ ห้ามเดาจากชื่อ LH/RH

### OEE Insight Engine — แท็บ 🧠 วิเคราะห์สาเหตุ ใน /oee-analytics (2026-07-14)

`src/components/OeeInsightPanel.jsx` — วิเคราะห์ภาพรวมอัตโนมัติ (rule-based + สถิติ ไม่ใช่ ML) ตอบ "ทำไมยอดไม่ได้เป้า / pattern ไหนกระทบ OEE" จากกะที่ปิดแล้วย้อนหลัง 14/30/60/90 วัน (เลือกไลน์เดี่ยวได้ · รับ `lines` = `linesFull` ที่ scope แล้วจาก OEEAnalytics):
1. **Loss decomposition** — แตกเป้าที่หาย (target−actual ของกะพลาดเป้า) เป็นชิ้นด้วย CT เฉลี่ยถ่วงน้ำหนักต่อกะ: Downtime นอกแผน (นาที×60÷CT, cap ที่ shortfall) / NG+สงสัย / เศษ = ความเร็วต่ำกว่า CT
2. **Downtime เรื้อรัง** — จับกลุ่ม ชนิด×เครื่อง ที่เกิด ≥3 กะ (top 3 ตามนาที) · นับเฉพาะนอกแผน
3. **กะเช้า vs กะดึก** — ต่างเฉลี่ย ≥5 จุด (ทั้งคู่ ≥3 กะ) + ชี้ตัวต่างหลัก A หรือ P
4. **วันในสัปดาห์ DT หนักผิดปกติ** — เฉลี่ยนาที/วัน > 1.6× ค่ากลาง (n ≥2 วัน)
5. **คนขาด ↔ OEE** — เทียบกะวันมีคนขาด (จาก daily_production_logs ฝั่ง Main ผูกผ่าน employees.line_id — best-effort try/catch) vs วันคนครบ ต่าง ≥5 จุด
6. **Product วิ่งช้าซ้ำ** — P<75 ใน ≥3 กะที่มี product เดียว (ชี้ CT master ตั้งเร็วเกิน/micro-stop)
7. **NG กระจุกประเภทเดียว** — ประเภท top ≥50% ของ NG รวม ≥20 ชิ้น
- ทุก insight มีหลักฐานตัวเลขแนบ (นาที/ชิ้น/จำนวนกะ) เรียงตาม severity (high/med/info) แล้วตาม impact · <3 กะ = "ข้อมูลยังไม่พอ" ไม่เดา · เกณฑ์ตัวเลข (threshold) อยู่ในไฟล์ component จุดเดียว

---

## Improvements — โปรเจคปรับปรุง Kaizen (2026-07-12)

หน้า `/improvements` (กลุ่มฝ่ายผลิต) — บันทึกโปรเจคปรับปรุงผูกกับปัญหาจริง แล้ว**เทียบผลก่อน/หลังจากข้อมูลที่เกิดจริงอัตโนมัติ** ไม่ต้องกรอกผลเอง

- ตาราง `improvements` อยู่ **DR project** (anon-open ตาม convention) + bucket `improvement-images` (cap 5MB, รูปบีบ 1280px q0.85 ก่อนอัปโหลด, เปลี่ยน/ลบแล้วลบไฟล์เก่าเสมอ) — migration: `20260712_improvements_module.sql` (DR) + `20260712_improvements_page_permissions.sql` (Main)
- จุดยึดโปรเจค: `line_name` + `problem_source` (downtime/defect) + `problem_type_id` (→ `dr_downtime_types`/`dr_defect_types`) + optional `machine_no`/`mat_no` + `start_date` (วันเริ่มแก้) + `baseline_days` (หน้าต่างเทียบ 14/30/60/90 วัน)
- **สูตรเทียบผล:** ก่อน = [start−baseline, start) · หลัง = [start, min(วันนี้, start+baseline)] — ดึง `downtime_logs.duration_min` หรือ `defect_logs.qty_ng` ผ่าน session ของไลน์ แล้วหารด้วย**จำนวนวันที่มีการผลิตจริง** (นับจาก `production_sessions`) ไม่ใช่วันปฏิทิน — แสดง % ลด/เพิ่ม + แถบเทียบ ก่อน(แดง)/หลัง(เขียว)
- ตอนสร้างมี**พาเรโต้ Top 10** ของไลน์ (ตามหน้าต่างเดียวกัน) คลิกเลือกปัญหา → prefill เป้าโปรเจค + ตั้งชื่อให้อัตโนมัติ
- สถานะ: `monitoring` (เหลือง นิ่ง) → `done` (เขียว พร้อม result_note) / `cancelled` — snapshot ชื่อปัญหาไว้ใน `problem_label` กัน master ถูกลบ
- **Milestone/Gantt ต่อโปรเจค (2026-07-14 — คำสั่ง user: ไม่ใช่ฟอร์มทีเดียวจบ ต้องตามงานทีมแบบ gantt):** ตาราง `improvement_milestones` (DR, migration `20260714_improvement_milestones.sql`) — โปรเจคใหม่ seed ขั้นงานมาตรฐาน **PDCA 5 ขั้น** กระจายวันตาม baseline อัตโนมัติ (แก้/เพิ่ม/ลบอิสระ) · การ์ดมีแผง "🗓 แผนงาน x/y ขั้น" + progress + gantt ในตัว: แถบตามแผนสีตามสถานะ (กดป้ายวน todo→doing→done, stamp `done_at`), เลยแผน = แดง "⚠ เลยแผน", เส้นวันนี้สีชมพู (playhead convention) · พาเรโต้: งานในแผน priority รอง (จาง+ป้าย 📅 ในแผน) และแต่ละแถวโชว์ note พนักงาน 💬 (สำคัญกับ "อื่นๆ")
- สิทธิ์: ทุก role เข้าดูได้ · สร้าง/แก้/ลบ/เปลี่ยนสถานะ + จัดการ milestone = `can('improvements','manage')` (seed: admin/manager/supervisor/leader)
- Scope: leader เห็นเฉพาะ family ไลน์ตัวเอง · role อื่นกรองตาม `sections` (pattern มาตรฐาน)
- **เชื่อมกับ MTN Work-Order (2026-07-14):** `problem_source = 'mtn'` (migration `20260714_improvements_mtn_source.sql` ขยาย check constraint) → วัดผลก่อน/หลังจาก**ใบซ่อม MO** (จำนวนใบ + นาที breakdown จาก `mtn_orders`) แทน downtime/defect · พาเรโต้ตอนสร้างมีโหมด "ใบซ่อม MTN" (เครื่อง+อาการที่มีใบเยอะสุด) · การ์ดโชว์ชิป "🔧 ใบ MO N ใบ" (นับตั้งแต่ start_date) · ฝั่ง MtnRepair: ปุ่ม "💡 เปิดโปรเจคปรับปรุง" ใน DetailDrawer ส่ง prefill ผ่าน `sessionStorage['imp_prefill']` แล้ว navigate มา /improvements (เด่นเมื่อ step6 ติดตามได้ "เกิดปัญหาซ้ำ/แก้ไขไม่ได้") + ชิป "มีโปรเจคปรับปรุงกำลังทำ" บนใบของเครื่องที่มี improvement status=monitoring

---

## Morning Meeting — ประชุมแถวเช้า (2026-07-13)

หน้า `/morning-meeting` (กลุ่มฝ่ายผลิต) — บอร์ดประชุมทบทวนเช้าก่อนเริ่มงาน **ข้อมูลดึงอัตโนมัติทั้งหมด ไม่ต้องทำสไลด์** วาระ: ภาพรวมเมื่อวาน (ผลิตจริง/เป้า, OEE, DT, NG, เข้างาน) → งานหลุดแผน+สาเหตุ → Top Downtime/ของเสีย → 4M → ความพร้อมเช้านี้ → Action items

- **วันที่ default = วันงานล่าสุดที่จบ:** ก่อน 08:00 ใช้ `getWorkDate()` ตรงๆ (ยังเป็นเมื่อวาน) · หลัง 08:00 ถอย 1 วัน — ห้ามใช้ getWorkDate()-1 เสมอ (ช่วงประชุม 07:30-08:00 จะกลายเป็น 2 วันก่อน)
- **แหล่งข้อมูล:** DR = production_sessions/prod_orders/downtime_logs/defect_logs · Main = four_m_logs/daily_production_logs · เป้าใบงาน = `qty_target ?? qty`, ยอดจริง = `qty_ok ?? qty_actual` · **เป้ากะ = `target_qty` → รวมเป้าใบงานของกะ (`qty_target ?? qty`) เท่านั้น** (เป้า 0 = แสดง "ไม่มีเป้า"/"—" ห้ามโชว์ 0% แดง) · ยอดจริงกะ = `qty_ok` → `actual_qty` → รวมจากใบงาน
  - ⚠️ **ห้าม fallback เป้ากะไป `production_lines.std_day_shift`/`std_night_shift`** — ค่านั้นคือ **"จำนวนคนต่อกะ (headcount)"** ไม่ใช่เป้าจำนวนชิ้น (HYDROFORM=14 คน, GOR=11, Line60=6) · เคย fallback แล้วไลน์ไม่มีใบงานโชว์ "0/14 · 0%" ทั้งที่ควรเป็น "ไม่มีเป้า" (แก้ 2026-07-15 MorningMeeting + OEEAnalytics panel 3)
  - **การ์ด/รายงาน DT ต่อไลน์-ต่อกะ นับเฉพาะ "นอกแผน"** เหมือน KPI รวม — planned (ไม่มีแผนผลิต/นับสต๊อก) ไม่ใช่ loss ห้ามเอามาคิด % หลัก/โป่งตัวเลขการ์ด (เคยโชว์ DT 569/1620น. สีแดงทั้งที่แค่ไม่มีแผนผลิต · OEEAnalytics 2.1 เคยโชว์รวม 5,512น. 38.68% ที่จริง 4,684น.เป็น planned) · 2.3 Top-by-part ก็กรอง planned ออก (ไม่งั้น "ไม่ระบุ MAT.NO" ครองอันดับ 1 · แก้ 2026-07-15)
- **เช็คชื่อ:** `daily_production_logs.assigned_line` เก็บ **id จุดงาน ไม่ใช่ชื่อไลน์** — หาไลน์ของคนต้อง join `employees.line_id` (เคยพลาด query ตรงแล้วได้ 0/0)
- **Downtime KPI นับเฉพาะ "นอกแผน"** (planned เช่น นับสต็อก/ไม่มีแผนผลิต แสดงแยกจางๆ ไม่นับใน % — ไม่ใช่ความเสียหาย ถ้ารวมจะกลบตัวเลขจริง) — ผลรวมนาทีทุกรายการทุกเครื่อง (เวลาซ้อนกันได้ เกิน 24 ชม./วันได้) แสดงเป็น **% เทียบฐานเวลาเครื่องรวม** = Σ ต่อกะที่เปิด (`shift_min` (fallback 570) × จำนวนเครื่องจากทะเบียน `machines` ของไลน์ ไม่มีทะเบียน = 1) · เกณฑ์สี <3% เขียว / 3-8% เหลือง / >8% แดง · Top Downtime แยกส่วน นอกแผน (แถบ+note) / ในแผน (จางท้ายแผง) · Top Downtime/ของเสีย แสดง note ของพนักงาน (description) ใต้แต่ละประเภท — สำคัญกับประเภท "อื่นๆ"
- **กฎบังคับ (DailyReport):** บันทึก Downtime/งานเสียประเภทชื่อมี "อื่น" ต้องกรอกรายละเอียด (description) เสมอ ไม่งั้นบันทึกไม่ผ่าน — ไม่งั้นรายงาน/ประชุมเช้าอ่านไม่รู้เรื่อง (2026-07-13)
- **สาเหตุงานหลุดแผน (อัตโนมัติ):** chip จาก downtime กะเดียวกัน (top ตามนาที), NG ของใบ, คนขาดของไลน์, 4M ค้างอนุมัติ, ใบยกยอด/ยังไม่ปิด — ปุ่ม "➕ Action" prefill เป็น action item (`ref_kind`/`ref_id` ผูกที่มา)
- **Action items:** ตาราง `meeting_action_items` (Main — migration `20260713_morning_meeting.sql`) · รายการ open/doing จากวันก่อนโผล่ทุกประชุมพร้อมป้าย ⏮ จนกว่าจะปิด · เขียนได้เมื่อ `can('morning_meeting','record')` (seed: admin/manager/supervisor/leader)
- **ความพร้อมเช้านี้:** เครื่องซ่อมค้างตอนนี้ (open DT จากกะ 3 วันล่าสุด — แดงกระพริบตาม Andon), 4M ค้างอนุมัติ (เหลืองนิ่ง)
- **โหมดประชุม (📺):** full-screen ไล่วาระทีละสไลด์ (◀ ▶ / Esc) เนื้อหา component เดิม + `zoom: 1.3` สำหรับจอ TV · 🖨️ พิมพ์สรุป (pattern window.open + print เหมือน Report) · 📤 ส่งสรุป Telegram (event `morning_meeting`)
- **📷 Gesture Mode (2026-07-15):** ควบคุมวาระด้วยท่ามือผ่านกล้อง (MediaPipe `@mediapipe/tasks-vision` GestureRecognizer) — ตัวหลัก = **☝️ ชี้นิ้วบอกทิศ+ค้าง 0.45s** (◀/▶ เปลี่ยนวาระ · ▲/▼ เลื่อนหน้า ค้างต่อ = เลื่อนต่อเนื่อง — ทิศอ่านจากเวกเตอร์ landmark 5→8 + เงื่อนไขชี้นิ้วเดียว เสถียรกว่าการปัดที่ภาพเบลอ), ✋ ปัดซ้าย/ขวา = เปลี่ยนวาระ (ตัวรอง — trail ทน track หลุด ≤220ms), 👍 ค้าง 0.6s = ถัดไป, ✊ ค้าง 0.9s = ออกจากโหมด · `src/components/GestureCam.jsx` · **กฎ:** opt-in เท่านั้น (ปุ่มในโหมดประชุม), ประมวลผลในเครื่อง 100% (ห้ามส่งภาพออก), โมเดล+WASM self-host ที่ `public/mediapipe/` (~19MB, cache 30 วันใน render.yaml — เปลี่ยนเวอร์ชันโมเดล = เปลี่ยนชื่อไฟล์), lazy-load ทั้งหมด (bundle หลักไม่บวม), มีจุดแดง+preview บอกว่ากล้องทำงานเสมอ, gesture ผูกได้แค่เปลี่ยนหน้า/ออกจากโหมด **ห้ามผูกกับ action ที่แก้ข้อมูล**
- **Scope:** leader = family ไลน์ตัวเอง (branch มาก่อน) · role อื่นตาม `sections` — pattern มาตรฐาน

---

## Layer Process Audit — LPA paperless (2026-07-20)

หน้า `/lpa` (`LayerProcessAudit.jsx`, กลุ่มฝ่ายผลิต — ฝ่ายผลิตเป็นผู้ใช้งานหลัก ย้ายจากหมวด QA/QC ตามคำสั่ง user 2026-07-20) — แทนฟอร์มกระดาษ 2 ใบ: **Layer Process Audit Plan** (แผนตรวจรายเดือนต่อไลน์+กะ) + **Layer Process Audit Report FM-QMR-008 Rev.01** · ชั้นผู้ตรวจ 4 ชั้น: Leader ทุกวัน · Supervisor/Engineer รายสัปดาห์ (W1-W4) · Manager รายเดือน · GM รายไตรมาส

- **4 แท็บ:** ✅ บันทึกผลตรวจ (ตอบ Y/N/T/NA รายข้อ + ปุ่ม "ยังไม่ตอบ=Y" · **N/T บังคับกรอกรายละเอียดปัญหา** · ลายเซ็น default จาก profiles.signature_url เซ็นใหม่ได้) · 📅 แผนตรวจ **(มองทีละไตรมาส — เห็น 3 เดือนเรียงกัน · 2026-07-20)** + ปุ่มเลื่อนไตรมาส · 📊 รายงาน (grid คำถาม×วัน + W1-4/M/Q + ลิสต์ปัญหา N/T) · ⚙️ คำถาม (สิทธิ์ manage — คำถามมาตรฐาน + ข้อเฝ้าระวัง special ผูกไลน์+ช่วงวันที่)
  - **สถานีตรวจ (Station for audit) ดึงจาก "จุดงาน (workstations)" อัตโนมัติ (2026-07-20):** ปุ่ม 📍 ดึงจุดงานในไลน์ (`workstations.station_name` ของไลน์+ไลน์ย่อยในครอบครัว — Main project) → เติมเป็นสถานีตั้งต้น แล้วแก้เอง · auto-fill ตอนไลน์ยังไม่มีแผน · **LPA = audit กระบวนการ/คนที่จุดงาน ไม่ใช่ตรวจทุกเครื่องจักร → ใช้ workstations ไม่ใช่ `machines`** (คำสั่ง user — จุดงานต่อไลน์ ~10-20 จุด น้อยกว่าเครื่องจักร) · รายชื่อสถานี+ชื่อผู้ตรวจ (Leader/SV/MGR/GM) เป็น **ชุดเดียวใช้ทั้งไตรมาส**
  - **⚡ เติมแผนทั้งไตรมาส:** กระจายจุดงานให้ **ครบทุกจุดภายในแต่ละเดือน** (สถานี/วัน = `⌈จำนวนจุดงาน ÷ วันทำงาน⌉` — เกิน 1 วันจะใส่หลายสถานีคั่นด้วย `,`) · Leader ทุกวันทำงาน · SV วันทำงานแรกของแต่ละบล็อกสัปดาห์ · MGR 1 วัน/เดือน · GM 1 ครั้ง/ไตรมาส (เดือนแรก) · 💾 บันทึกแผนไตรมาส = upsert `lpa_plans` 3 เดือน + แทน `lpa_plan_days` · สถานะ ○ วางแผน / ● ตรวจแล้ว / ⊗ เลยกำหนด derive จาก lpa_audits · **บันทึกผล/รายงาน/พิมพ์ยังเป็นราย"เดือน"** (เลือกเดือนโฟกัสในไตรมาส)
- **พิมพ์ 2 ฟอร์ม** (window.open + print): ใบแผน A4 landscape (สัญลักษณ์ ○●⊗ คอลัมน์วันหยุดเขียว สถานีแนวตั้ง) + ใบรายงาน FM-QMR-008 A3 landscape (หมวดแนวตั้ง rowspan, ข้อ special สีแดง + Issue Date, W1-4 เขียว/Monthly เทา/Quarterly เหลือง, แถว Work Station + ลายเซ็นผู้ตรวจรายวัน, legend + Effective Date 12/05/2017)
- **วันหยุด** = ปฏิทินบริษัท (`company_calendar` มาร์คแล้วตาม day_type, ไม่มาร์ค = เสาร์/อาทิตย์หยุด) — ตรรกะเดียวกับ countWorkingDays ฝั่ง kanban
- **Weekly mapping:** วันที่ 1-7 = W1 · 8-14 = W2 · 15-21 = W3 · 22+ = W4 (`weekOfDay`)
- สิทธิ์: ดู = ทุก role · `lpa:record` = mgr/sv/leader/engineer/qa · `lpa:manage` (แผน+คำถาม) = mgr/sv · `lpa:delete` = mgr · Scope ไลน์: leader = family ตัวเอง, role อื่นตาม sections (pattern มาตรฐาน)
- migration: `20260720_layer_process_audit.sql` (Main — ตาราง 5 + seed คำถาม 23 ข้อ + permission)

---

## Scrap Report — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export · 2026-07-16)

หน้า `/scrap-report` (`ScrapReport.jsx`, **กลุ่มฝ่ายผลิต** — ฝ่ายผลิตเป็นผู้ใช้งานหลัก) — แทนฟอร์มกระดาษ "ใบรายงานของเสีย" ที่เขียนมือ · ลงยอด scrap ต่อ **ไลน์/วัน** แล้ว export Excel ตรงฟอร์ม 100% · ⚠️ `production_lines` อยู่ **Main project** (client `supabase`) ไม่ใช่ DR — dropdown ไลน์ต้องดึงจาก `supabase` (เคยพลาดใช้ `supabaseDR` แล้ว dropdown ว่าง)

- **ตาราง (DR project — anon RLS):** `scrap_reports` (หัวใบ: report_date, line_name, dept/section/division, product_categories[], storage_location, doc_no, สายอนุมัติ inspector/requester/approver_qa/pd/gm, sender/receiver, status draft/submitted/approved) · `scrap_report_items` (รายการต่อพาร์ท: source main/sub, part_no/part_name/mat_no/model/code A-E/bom_ref, qty, m_cause m1-m5, stage in_process/post_process, confirm_qty, defect_codes, src_defect_from_logs) · `scrap_defect_types` (master P1-P20 กระบวนการ / A1-A18 ประกอบ-เชื่อม — seed จากชีท Defect Type จริง) · migration `20260716_scrap_report.sql` (DR) + `20260716_scrap_report_permissions.sql` (Main)
- **sync = ดึงตั้งต้น + แก้เองได้ (คำสั่ง user):** ปุ่ม "⤵ ดึงจาก Daily Report" รวม `defect_logs.qty_ng` ของ session ไลน์+วันนั้น group ตาม `prod_orders.mat_no` → เติมแถว main product (flag `src_defect_from_logs`) แล้วแก้/เพิ่มได้ · **พาร์ทย่อย** (nut/สกรู ที่เสียก่อนเข้ากระบวนการหลัก — ไม่มีใน production session) เพิ่มเองผ่านปุ่ม "เพิ่มจาก SAP/BOM" (ดึง `dr_products` main + `bom_items` sub) หรือกรอกมือ
- **export Excel (`src/lib/scrapExportExcel.js`):** ExcelJS วาดตรง layout FM-PD2-002 Rev.06 (หัวบริษัท, ตาราง A-S: ลำดับ/PART NO/NAME/MAT SAP/รูป/MODEL/CODE/BOM/Q'TY/M1-M5/ยืนยัน/รหัสงานเสีย, TOTAL, CODE legend A-E, สายอนุมัติ 5 ขั้น, ผู้ส่ง/รับ HRM) · qty ลงคอลัมน์ M ตาม m_cause · ตรึง 27 แถวเหมือนกระดาษ
- **สิทธิ์:** ดู = `page:/scrap-report` (admin/mgr/sv/leader/qa/doc_control) · `scrap:record` (สร้าง/แก้) = admin/mgr/sv/leader/qa · `scrap:manage` (อนุมัติ/ลบ) = admin/mgr/qa
- เลขเอกสาร running รายวัน `TSAT4-PDX NNNN/เดือน-ปี` (นับใบในเดือน)

---

## Factory Master Map — ผังรวมโรงงานผังเดียว (2026-07-16)

หน้า `/factory-map` (`FactoryMap.jsx`, กลุ่มฝ่ายผลิต) — รูปผังใหญ่ของทั้งโรงงาน **1 รูป** แล้ววาด **polygon (รูปทรงอิสระ)** ล้อมพื้นที่แต่ละไลน์ ระบายสีตามสถานะการผลิตของไลน์นั้น — ดูทุกไลน์บนจอเดียว (เหมาะจอ TV)

- **ตาราง (Main project):** `factory_map` (รูปผังใหญ่ 1 รูป — image_url) · `factory_line_regions` (line_name unique, `points` jsonb = `[[x,y],...]` เป็น % ของรูปจริง 0-100 วนรอบ polygon) · migration `20260716_factory_master_map.sql` + `20260716_factory_map_permissions.sql`
- **polygon ไม่ใช่แค่สี่เหลี่ยม** — รองรับไลน์รูป L/U shape (คำสั่ง user) · วาดโดยคลิกทีละจุดล้อมพื้นที่ คลิกจุดแรกซ้ำ/กด "เสร็จ" = ปิดรูป · แก้: ลากกลางรูป=ย้ายทั้งไลน์, ลากจุดมุม=ปรับรูปทรง · dropdown เลือกไลน์ + Shift ล็อกเส้นตั้งฉาก + แม่เหล็กดูดปิดรูปเมื่อใกล้จุดแรก
- **ตีกรอบเฉพาะไลน์ใบ (leaf) เท่านั้น (2026-07-16):** ไลน์แม่ที่มีลูก (ชื่อถูกอ้างเป็น `parent_line_name` ของไลน์อื่น) ถูกตัดออกจากรายการ/ตัวนับ — ตีเฉพาะลูก (ไม่งั้นกรอบแม่ทับลูก) · `leafNames` ใน component · metric ก็รวมยอดตามไลน์ใบที่มี session/คน/เครื่องจริง
- **แสดงผล:** SVG `<polygon>` viewBox 0 0 100 100 `preserveAspectRatio="none"` + `vector-effect: non-scaling-stroke` (เส้นไม่ยืด) · รูปแสดง `width:100% height:auto` → % ตรงกับรูปเป๊ะไม่ต้องหัก letterbox · ป้ายชื่อ+ยอดวางที่ centroid เป็น **HTML** (ไม่โดน SVG ยืด)
- **เลือก metric ได้ 6 แบบ (2026-07-16):** แท็บบนหน้า — 📦 ยอดผลิต (ยอด/เป้า %) · ⚙️ OEE (ปิดกะ=ค่าที่ stamp · **เปิดกะ=คำนวณสด A×P×Q จากข้อมูลปัจจุบัน** ป้าย "(สด)" — สูตรย่อของ computeSessionOEE) · 🔧 Downtime (Σ `duration_min` + active) · 🚫 ของเสีย (`qty_ng`) · 👷 คนเข้างาน (Main `daily_production_logs` present/total ต่อไลน์ ผูก `employees.line_id` — refresh 60 วิ, +⚠PPE ไม่ครบ) · 🛠️ PM เครื่องจักร (DR `machines`→`checklists`→`pm_plans.next_due_date` นับเกินกำหนด/ใกล้ครบ ต่อไลน์ — refresh 5 นาที) · แต่ละ metric กำหนดสี region + ตัวเลขบนกรอบเอง (config `METRICS` ในไฟล์จุดเดียว — เพิ่ม metric ใหม่ที่นี่) · หมวดสี: good เขียว / ok เหลือง / bad แดง / down แดงกระพริบ (`region-alarm`) / idle เทา
- **อ่านง่ายบนผังจริง (2026-07-16):** ป้ายไลน์ = การ์ดทึบ (`rgba(9,11,18,0.86)`) + ขอบสีสถานะ (ไม่จมไปกับภาพ) · scrim หรี่ภาพ `rgba(6,8,14,0.32)` ให้กรอบเด่น · side panel มีชิปสรุปจำนวนไลน์ตามสถานะ + อันดับ (เลข + จุดสี + ค่า + แถบเทียบสัดส่วน)
- **Side panel ขวา (ใช้พื้นที่ข้าง — คำสั่ง user):** จัดอันดับทุกไลน์ตาม metric ที่เลือก (ปัญหาขึ้นบน) · คลิกแถว = เน้น region บนผัง (highlight ชั่วคราว) + เปิด popup เจาะดู · โชว์ไลน์ที่ยังไม่ตีกรอบด้วย · ซ่อนตอน edit (เปิดพื้นที่วาด)
- **Hover preview + คลิกเปิดผังไลน์ (2026-07-21):** วางเม้าส์บนกรอบไลน์ = **การ์ดพรีวิวลอยตามเคอร์เซอร์** (เฉพาะ `pointerType==='mouse'` — จอสัมผัสไม่ขึ้น) สรุปทุก metric แบบย่อ (metric ปัจจุบันไฮไลต์) + สี region เข้มขึ้น · การ์ด hover ใช้ **theme variable ล้วน** (`--card`/`--bg3`/`--text` ฯลฯ — ห้าม hardcode สีเทา-น้ำเงินอีก เคยหลุดธีมเขียว + พังโหมด light) + วัดความสูงจริง (`hoverCardRef.offsetHeight`) แล้ว clamp/flip กันตกขอบล่าง
  - **คลิกกรอบ/แถว panel → เปิดผังไลน์พร้อมพนักงานแบบ Dashboard** (`openLine`): ไลน์ที่มี `line_layouts` → `navigate('/dashboard?line=NAME&from=factory-map')` ให้ Dashboard เปิด Expanded Line Map (deep-link) — ใช้ผังจริงตัวเดียวกัน ไม่ duplicate · ไลน์ที่**ไม่มีผังพื้น** → fallback popup สรุป metric + ตารางแยกไลน์ย่อย (`detailLine`)
  - **⚠️ ผังไลน์แม่-ลูกคนละรูป (คนอยู่บนผังลูก):** `floorMapTarget` เลือกผังที่**มีคนจริง** — ไลน์แม่มีผัง+คนของตัวเอง=โชว์ตัวเอง · ไลน์แม่ว่าง (คนอยู่ไลน์ลูก เช่น GOR→Assy GOR/Laser GOR) = เด้งไปโชว์**ผังลูกที่มีคนมากสุด** (จาก `manpower[n].present`) · ยังไม่มีใครเข้างาน = ผังตัวเอง/ตัวแรก · (การทาบ-สเกลพิกัดลูกลงผังแม่ผังเดียว = future enhancement ยังไม่ทำ)
  - **Dashboard รับ deep-link:** `useSearchParams` อ่าน `?line=NAME` ตอน `layouts` โหลดเสร็จ → หา layout ที่ตรงชื่อ/ครอบชื่อ (`layoutLineNamesForCard`) แล้ว `setExpandedLine` + ล้าง param (`replace:true`) กันเปิดซ้ำ · `from=factory-map` → ปิด modal แล้ว `navigate('/factory-map')` (ไม่ค้างที่ Dashboard) ผ่าน `closeExpandedLine` — backward-compatible (ไม่มี param = ไม่เปลี่ยนพฤติกรรม)
- **Dashboard "Line Floor Maps" — โหมดใหญ่สำหรับหัวหน้า (2026-07-21):** `floorBig = scopeActive && visibleLayouts.length ≤ 3` → หัวหน้า/ผู้ใช้ scope แคบ เห็นผังไลน์ตัวเอง**ใหญ่เต็มความกว้าง** (bottom grid stack 1 คอลัมน์ + floor grid `auto-fit minmax(480px,1fr)`) แตกไลน์ลูกเป็นการ์ดใหญ่แยกกัน · ภาพรวมทั้งโรงงาน (passAll/หลายผัง) คงกริดย่อ 2-3 คอลัมน์เหมือนเดิม (เหมาะจอ TV ดูรวม)
- **🔴 downtime ค้างโชว์เสมอทุก metric:** จุดแดงหน้าชื่อไลน์ (แม้ดู metric อื่น) — alarm ต้องไม่ถูกซ่อน · refresh DR ทุก 30 วิ
- **สิทธิ์:** เข้าดู = ทุก role (`page:/factory-map`) · อัปโหลด/วาด/ลบ = `can('factory_map','edit')` (admin/manager/supervisor)
- **รูปเก็บ** bucket `employee-photos` path `factory/` — cleanup-orphan-photos whitelist `factory_map.image_url` + สแกนโฟลเดอร์ factory/ แล้ว (กันลบผิด) · เปลี่ยนรูปลบไฟล์เก่าทิ้ง (best-effort)

---

## Production Plan — วางแผนการผลิต (Active Planner, 2026-07-15)

หน้า `/production-plan` (กลุ่มฝ่ายผลิต) — จากยอดลูกค้า (order รายวัน + forecast รายเดือน) เทียบ **"กำลังผลิตที่ทำได้จริง"** → บอกว่าต้องเปิดกี่กะ กี่วัน วันไหนเปิด OT/กะดึก/ทำวันหยุด วันไหนไม่ต้อง เพื่อทันดิว · **เฟส 1 อ่านอย่างเดียว ไม่เขียน DB**

- **กำลังผลิต = median(ยอดดีจริงต่อกะ) ใน 60 วันล่าสุด** ต่อ (ไลน์+พาร์ท) — util กลาง `src/utils/capacityModel.js` · median ตัดค่าโดด (วันเทพ/หายนะ) + บวก OEE/เบรค/NG ไว้ในตัว · พาร์ทที่มีประวัติ < 3 กะ fallback = (นาทีกะ×60÷CT)×OEE median ของไลน์ + ติดป้าย "ข้อมูลน้อย" · เลือกโหมดวางแผน **median (สมจริง)** หรือ **P25 (ปลอดภัยไว้ก่อน)**
  - **normalize กะที่แชร์ไลน์ (2026-07-21):** กะที่พาร์ทวิ่งไม่เต็มกะ (แชร์กับพาร์ทอื่น) ทำให้ยอด/กะต่ำ → median กำลังต่ำเกิน → OT/backlog เกินจริง · ProductionPlan โหลด `opened_at`/`confirmed_at` คิด run-min ต่อ (session,mat) แล้ว: กะวิ่ง **50–90%** ของกะ → คูณกลับเป็นเต็มกะ (scale ≤2×) **cap ด้วยกำลังทฤษฎี `shift×60÷CT` กัน over-scale** (overstate = วางแผนน้อยไป อันตราย) · กะวิ่ง **<50% = ตัดทิ้ง**จาก median (สัญญาณน้อยเกิน) · ไม่มี timestamp = ใช้ค่าดิบเดิม
- **หน่วยกลาง = shift-load** (qty ÷ กำลังต่อกะ) เพื่อรวมหลายพาร์ทบนไลน์เดียวถูกต้อง (ไลน์มี 1 กะ แต่หลาย product คนละ rate)
- **แท็บรายวัน:** order ค้างส่ง 21 วันข้างหน้า → เดินปฏิทินวันต่อวัน (greedy: กะเช้า → +กะดึก(ถ้าไลน์มี) → +OT 25% → วันหยุดทำเฉพาะเมื่อ backlog) · **ลำดับใช้วันหยุด (กฎ user 2026-07-21): วัน `shutdown75` (ม.75) = กำลังสำรองที่เรียกได้ด้วยค่าแรงปกติ ใช้เต็มกำลังเหมือนวันทำงาน (⚡ ยกเลิกหยุด75% สีม่วง) ก่อนถึง OT วันหยุด ot15/ot2 (⚠ แดง) เสมอ** — ทั้งแท็บรายวันและ verdict รายเดือน (tier ⚡ อยู่ก่อน 🚨 เกินกำลัง) · แถบปฏิทินระบายสี ☀/⏰/🌙/⚡/⚠ + สรุปต่อไลน์ · endBacklog > 0 = 🚨 เปิดเต็มที่ยังไม่ทัน
- **แท็บรายเดือน:** forecast 6 เดือนข้างหน้า → กะที่ต้องใช้ (shiftsNeeded) vs วันทำงานในเดือน (จาก company_calendar) → verdict: กะเช้าพอ / ต้อง OT N วัน / ต้องกะดึก / 🚨 เกินกำลังต้องเพิ่มไลน์-คน
- **แหล่งข้อมูล:** DR = customer_shipping_orders (order), customer_forecasts (forecast), production_sessions+prod_orders (กำลังจริง), dr_products (mat→line, CT) · Main = production_lines (std กะ), company_calendar (วันทำงาน) · map พาร์ท→ไลน์ผ่าน `dr_products.line_name` + normalize mat (ตัดขีด/ช่องว่าง)
- **⚠️ map เลขลูกค้า→SAP ต้องผ่าน `p_no` ด้วย (2026-07-21):** order/forecast มักอ้าง**เลขลูกค้า** (เช่น `RB3B 8B225 AA`) ไม่ใช่ mat_no SAP — `resolveMat()` ลอง ตรง → normalize mat → `pnoToMat[normalize(p_no)]` · **map ไม่เจอ = ขึ้น banner ⚠️ (N ออเดอร์/พาร์ท ยังไม่ตั้ง SAP)** ห้ามทิ้งเงียบ (เดิม map ผ่าน mat_no อย่างเดียว ทิ้ง ~38% order/85% forecast เงียบ) · ต้นเหตุหลัก = master data `dr_products.p_no` ยังไม่กรอก → ไปตั้งที่ Product Master / ปุ่ม 🔗 จับคู่ SAP ในหน้า Planner&Sales
- **⚠️ กับดัก `prod_orders` ไม่มีคอลัมน์ `line_name`/`work_date`** — 2 ค่านี้อยู่บน `production_sessions` (join ผ่าน `session_id`) · select ตรงจาก prod_orders = PostgREST error 42703 (ถ้าดึงแค่ `data` จะถูกกลืนเงียบ prodArr ว่าง) — เคยพังที่ PmForecast (shot สะสม = 0) · หน้าใหม่ที่ query prod_orders ตามไลน์/วัน ให้ embed `production_sessions!inner(line_name, work_date)` + เช็ค `error` เสมอ (2026-07-21)
- **Scope:** leader = family ไลน์ตัวเอง (branch มาก่อน) · role อื่นตาม `sections` · migration สิทธิ์: `20260715_production_plan_page_permission.sql`
- **แผนต่อไป (ยังไม่ทำ):** เฟส 2 what-if (เพิ่มคน/ลด NG ทันมั้ย) · เฟส 3 ผูก `ot_night_bookings` — กดจากแผนแล้วจองรถ OT/เปิดกะอัตโนมัติ + Telegram

---

## Remote Control — จอตาม-มือถือคุม (2026-07-15)

แก้โจทย์จอที่ไม่มีเมาส์/คีย์บอร์ด/กล้อง (Smart TV, โปรเจคเตอร์, จอบอร์ดหน้าไลน์) — **ใช้ได้ทุกหน้า** ผ่าน Supabase Realtime broadcast (channel `esm-remote-<รหัส 6 หลัก>`) ไม่มีตาราง/เซิร์ฟเวอร์ใหม่:

- **ที่อยู่เมนู:** ลิงก์ 🎮 รีโมทจอ (ไปหน้า `/remote`) + ปุ่ม 📺 รับรีโมทจอ (จอตาม) **อยู่คู่กันโซนล่างสุดของ sidebar** (เหนือ Light Mode) — ทั้งคู่เห็นเฉพาะ role ที่มีสิทธิ์ `page:/remote` (default ทุก role, ปรับที่ `/permissions`) · `/remote` **ไม่อยู่ในเมนูหมวด/DeptHub** โดยตั้งใจ (เข้าจากลิงก์นี้เท่านั้น)
- **ฝั่งจอ (Receiver):** ปุ่ม "📺 รับรีโมทจอ (จอตาม)" → สุ่มรหัส 6 หลัก (จำใน localStorage ข้ามรีเฟรช) + ป้ายสถานะมุมล่างซ้ายแสดงรหัส/สถานะเชื่อมต่อเสมอ · `src/components/RemoteReceiver.jsx` ฝังระดับ App (ใน Router) — จอ**ต้อง opt-in เอง** และกด ✕ ปิดได้ตลอด
- **ฝั่งมือถือ:** หน้า `/remote` (🎮 รีโมทจอ) ใส่รหัสจากจอ → **Touchpad: ลาก 1 นิ้ว = เลื่อน pointer แดงบนจอ · แตะ = คลิก (elementFromPoint + native .click()) · ลาก 2 นิ้ว = scroll** + ปุ่ม ◀ ▶ Esc (ยิง KeyboardEvent — โหมดประชุมแถวเช้าฟัง keydown อยู่แล้ว) + ปุ่มเลื่อนขึ้น/ลง + ชิปสั่งจอกระโดดไปหน้าใดก็ได้ (เมนูจาก `navItemsForGroups` ชุดเดียวกับ sidebar — สิทธิ์เข้าหน้าคุมที่ฝั่งจอผ่าน RoleRoute ตามปกติ)
- **กลไก pointer:** จอถือตำแหน่งเอง มือถือส่ง delta (throttle ~25Hz) · scroll เดินหา ancestor ที่ overflow แล้ว scrollBy ที่ตัวนั้น (รองรับ inner scroll container) · คลิกหา interactive ใกล้สุดด้วย `.closest('button, a, [role=button], input, ...')`
- **ข้อควรระวัง:** ใครมีบัญชี ESM + รหัส 6 หลักที่เห็นบนจอ ก็สั่งจอได้ — จอเป็นฝ่ายเปิดรับเองเสมอ, รหัสโชว์บนจอเท่านั้น, ปิดเมื่อไม่ใช้ · migration สิทธิ์: `20260715_remote_page_permission.sql`

---

## MTN Work-Order — ใบแจ้งซ่อม MO 7 ขั้น (2026-07-14)

หน้า `/mtn-repair` (`MtnRepair.jsx`, กลุ่มการตรวจสอบและซ่อมบำรุง) — **clone ระบบ AppSheet เดิม (Jig MTN) มาอยู่ใน ESM** เพื่อไม่ต้องแยกระบบ + เก็บฐานข้อมูลเดียวกัน · ตารางทั้งหมดอยู่ **DR project** (anon-open ตาม convention)

- **Workflow 7 ขั้น (mirror ของเดิม):** 1 แจ้งซ่อม → 2 รับ/จ่ายงาน (**ออกเลข MO อัตโนมัติ**) → 3 ดำเนินการซ่อม → 4 ตรวจหลังซ่อม → 5 คุณภาพหลังซ่อม (**เฉพาะงานที่ step4 ระบุ "เกี่ยวกับคุณภาพ"** ไม่งั้นข้ามไป step6) → 6 รับมอบ/ติดตาม → 7 อนุมัติปิด (Close MO) · `status`: pending→assigned→repaired→checked→qa→handover→closed · `rejected` (step2 เลือก "Reject MO") · `current_step` 1..7 ใช้คิด % ความคืบหน้า
- **ประเมินความพึงพอใจบริการซ่อม (step 6 รับมอบ/ติดตาม — KPI หน่วยงานซ่อม · 2026-07-22):** หน่วยงานผู้แจ้งให้คะแนน **5 ด้าน × 3 ระดับ** (เฉยๆ=1/พอใจ=2/พอใจมาก=3): คุณภาพงานซ่อม · ความเร็วในการตอบสนอง · ความสามารถในการแก้ไขปัญหา · ความสุภาพ/PPE · ความพร้อมในการเข้าแก้ไขปัญหา · เก็บ `mtn_orders.satisfaction` jsonb (ด้านที่ไม่ประเมิน = ไม่มี key · **ไม่บังคับ ข้ามได้**) · const กลาง `SAT_DIMS`/`SAT_LEVELS` ใน MtnRepair · **แท็บ 📊 KPI** เพิ่มการ์ด "ความพึงพอใจเฉลี่ย %" + แถบรายด้าน (avg/3 · เขียว≥2.5/เหลือง≥2/แดง) นับเฉพาะใบที่ประเมิน · migration `20260722_mtn_satisfaction.sql` (DR additive)
- **⚠️ ฟิลเตอร์สถานะไม่ให้ซ้ำ:** dropdown สถานะ render จาก `STATUS_META` (มี `closed: '✅ ปิด MO'` อยู่แล้ว) + `open`/`all` เท่านั้น — **ห้ามเพิ่ม `<option value="closed">` ซ้ำ** (เคยมี "✅ ปิดแล้ว" ซ้ำกับ "✅ ปิด MO" — ลบแล้ว 2026-07-22)
- **เลข MO auto:** RPC `mtn_assign_mo_no(order_id, prefix)` (SECURITY DEFINER, idempotent — ออกเลขครั้งเดียวต่อใบ) ออกตอน step2 = `PREFIX-DDMMYY-ลำดับรายวัน` · prefix ตามประเภทงานซ่อม: BM(Breakdown)/IM(Improvement)/CM(Corrective)/PM(Preventive)/AM(Autonomous)/RE(Reject) · ลำดับ atomic ต่อวัน (ตาราง `mtn_mo_counter` keyed ด้วย DDMMYY เวลาไทย)
- **ตาราง (DR):** `mtn_orders` (แถวเดียวต่อใบ เก็บครบ 7 ขั้น) · `mtn_order_parts` (log เบิกอะไหล่ต่อใบ + หัก stock) · master: `mtn_technicians` `mtn_spare_parts` `mtn_problem_types` (cascade ลักษณะปัญหา→รายละเอียด) `mtn_repair_types` `mtn_item_types` · `mtn_mo_counter` · migration `20260714_mtn_work_order.sql` (seed taxonomy 20 + ช่าง 8 + item/repair types)
- **รูป/ลายเซ็น:** bucket **`mtn-images`** (DR, anon-open, cap 5MB) — รูปก่อน/หลังซ่อม/QA บีบ 1280px q0.85 ก่อนอัปโหลด (helper `resizeImage`) · ลายเซ็นต่อขั้น (step4/5/6/7) วาดใน `SignaturePad` (canvas→PNG) · ลบใบ = ลบไฟล์ที่ผูกทุกอัน (best-effort)
- **KPI (คำนวณสดจาก timestamp ไม่เก็บ):** Response = accept−report · TTR = repair_done−accept · Breakdown = repair_done−report · แท็บ 📊 KPI มีการ์ดเฉลี่ย + พาเรโต้ลักษณะปัญหา Top 10 (กรองช่วงวัน/ไลน์)
- **สิทธิ์ (role_permissions, migration `20260714_mtn_work_order_permissions.sql`):** `page:/mtn-repair`+`mtn_repair:report` = ทุก role · `mtn_repair:service` (step2-4) = admin/manager/mtn · `mtn_repair:qa` (step5) = admin/manager/qa · `mtn_repair:approve` (step7) = admin/manager · `mtn_repair:manage_master` (ช่าง/อะไหล่/taxonomy + ลบใบ) = admin/manager/mtn · ปุ่ม action แต่ละขั้นเช็ค `can()` ตามนี้ (ไม่ hardcode)
- **เชื่อมกับ Downtime:** ปุ่ม "📝 เปิดใบซ่อม" ในแถว Downtime (DailyReport) → สร้าง `mtn_orders` prefill (ไลน์/เครื่อง/อาการจาก dt type) `status=pending`, `source_downtime_id` ผูกที่มา (กันเปิดซ้ำ) แล้ว MTN ไปรับงานต่อที่ `/mtn-repair`
- **หลายทีมซ่อม (2026-07-14):** ครอบคลุม **PRODUCTION(Autonomous) / JIG MTN / DIE MTN / MTN** — `mtn_technicians.dept` (ทีมของช่าง, master แยกกลุ่มตามทีม) + `mtn_orders.mtn_dept` ("แจ้งถึงหน่วยงาน" auto จากชนิดอุปกรณ์: JIG→JIG MTN, DIE→DIE MTN, อื่น→MTN แก้ได้) · ฟิลเตอร์รายการตามหน่วยงาน · migration `20260714_mtn_multi_team.sql`
- **แจกงานให้ถูกทีม 4 ส่วน (2026-07-16 — คำสั่ง user):** ทำ 3 อย่างพร้อมกัน จับคู่ทีมของ user ผ่าน `teamsForUser(mtnTeams, sections)` (util `src/utils/mtnTeams.js`):
  - **ทีมมาจาก `profiles.mtn_teams` ที่ตั้งใน `/add-user` โดยตรง (2026-07-22)** — ช่อง "🔧 ทีมช่างซ่อม" (multi-select JIG MTN/DIE MTN/MTN/PRODUCTION) โผล่เฉพาะ role งานซ่อม (`MTN_TEAM_ROLES` = mtn/engineer/leader/supervisor) · **แยกจาก Section ไม่กระทบ scope ข้อมูลผลิต** · ช่างฝ่ายผลิต first-response เลือก `PRODUCTION` + PD ของตัวเองได้ · เขียน best-effort หลัง create/update (edge `create-user` ยังไม่รู้จัก field นี้) · UserContext expose `mtnTeams` (โหลด best-effort เหมือน avatar_url กัน login พังถ้ายังไม่ apply migration)
  - **fallback (backward-compat):** ไม่ได้ตั้ง `mtn_teams` → `teamsForUser` เดา JIG/DIE/MTN จาก **section string** เหมือนเดิม (`teamForSection`) · PRODUCTION ไม่เดาจาก section (section ฝ่ายผลิตมีหลายชื่อ) — ต้องตั้ง mtn_teams เอง
  1. **บังคับเลือกทีมตอนแจ้ง** — ReportModal ฟิลด์ "แจ้งถึงทีมช่าง" (required, default = ทีมของผู้แจ้ง) · **เปิดใบจาก Downtime มี picker เลือกทีม** (DailyReport `openMoPicker` → modal 4 ปุ่ม, เดา default จากชื่อเครื่อง) แทน hardcode 'MTN' เดิม
  2. **คิวงานแยกทีม** — MtnRepair default ฟิลเตอร์หน่วยงาน = ทีมของ user (สังกัดทีมเดียว, ไม่ใช่ admin) เปิดมาเห็นคิวทีมตัวเองก่อน ปรับเป็น "ทุกหน่วยงาน" ได้
  3. **แจ้งเตือน Telegram แยกห้องต่อทีม** — `telegram_channels.team` (migration `20260716_telegram_channels_team.sql` Main) แท็กห้องเป็นของทีมไหน · edge `send-mtn-notification` v4: มีห้องของทีมตาม `mtn_dept` → ส่งเข้าห้องทีม, ไม่มี → route เดิม (ห้องรวม/fallback) · ตั้งทีมของห้องได้ที่ `/notification-config` (dropdown ต่อห้อง) · **backward-compatible: ห้อง team=NULL = ห้องรวมพฤติกรรมเดิม**
- **Cost Center auto:** ดึงจาก `production_lines.cost_center` ตามไลน์ที่เลือก (fallback ไลน์แม่ถ้า sub-line ไม่มี) แก้ทับได้
- **วันที่ (want_at/target_done_at) เป็น date-only:** input `type=date` (**ปฏิทิน ค.ศ.**) + echo "= DD/MM/พ.ศ." ใต้ช่องกันสับสน ปี · เก็บ/แสดงเฉพาะวันที่ ไม่มีเวลา
- **ลายเซ็นใช้ซ้ำจากโปรไฟล์ (2026-07-14):** `SignField` default = ใช้ `profiles.signature_url` ของ user (ไม่สร้างไฟล์ใหม่ทุกครั้ง) · กด "เซ็นใหม่" เพื่อวาดเฉพาะกิจ (ค่อยอัปโหลด) — ลดไฟล์รูปสะสมมาก (เดิมเซ็น 4 ครั้ง/ใบ = 4 ไฟล์)
- **แก้ไขหลังบันทึก:** DetailBox แต่ละสเตปมีปุ่ม ✏️ แก้ไข (StepModal `editMode` — อัพเดทเฉพาะฟิลด์ ไม่เลื่อนสถานะ/ไม่แจ้งซ้ำ) · สิทธิ์: `manage_master` (หัวหน้า) หรือผู้มีสิทธิ์ทำสเตปนั้น (ผู้กรอกแก้ของตัวเองได้)
- **Spare part + stock control:** master `mtn_spare_parts` (code/name/unit/stock_qty/min_qty) + ledger `mtn_stock_txns` (in/adjust/consume) · แท็บอะไหล่: ➕รับเข้า / ปรับยอด (log ledger) + แถบแดงเมื่อ ≤ min · ขั้นซ่อมเบิกอะไหล่ = หัก stock + log consume อัตโนมัติ · migration `20260714_mtn_stock_txns.sql`
- **ค่าแรงซ่อมมาตรฐาน + ค่าใช้จ่ายต่อใบ (2026-07-22 · คำสั่ง user):** master `mtn_labor_rates` (name/unit/price/dept) — แท็บ ⚙️ ข้อมูลตั้งต้น → 💰 ค่าแรงมาตรฐาน (ช่างกรอกราคามาตรฐานไว้เลือกใช้) · ขั้นซ่อม (step 3) มีช่อง **(1) ค่าแรงซ่อม** (เลือกจากราคามาตรฐาน หรือพิมพ์เอง) + **(2) ค่าอะไหล่/อุปกรณ์** → เก็บ `mtn_orders.labor_cost`/`parts_cost` (numeric) · พิมพ์ลงฟอร์ม **FM-MTN-006** ช่อง (1)/(2)/รวม อัตโนมัติ · migration `20260722_mtn_labor_cost.sql` (DR additive)
- **แจ้งเตือน Telegram — ครบทุกสเตป (คำสั่ง user 2026-07-14):** edge function `send-mtn-notification` events `mtn_reported`(1,+รูปก่อน)/`mtn_assigned`(2)/`mtn_repaired`(3,+รูปหลัง)/`mtn_checked`(4)/`mtn_qa`(5,+รูป QA)/`mtn_handover`(6)/`mtn_closed`(7) · format mirror ระบบเดิม + หน่วยงานในหัวข้อ · วันที่ พ.ศ. · route ผ่าน notification_rules category maintenance (ตั้งค่า/ปิด/แก้ข้อความที่ `/notification-config`)
  - **ไหลตามสเตป (v5, 2026-07-22 — คำสั่ง user):** step1 แจ้งเข้าห้องทีมที่เกี่ยวข้อง (ห้องรวม smart maintenance วันนี้ · อนาคตแยกห้อง MTN/JIG MTN/DIE MTN/PRODUCTION ผ่าน `telegram_channels.team`) · ทุกสเตปต่อท้ายบรรทัด **"⏳ ขั้นต่อไป: รอ…"** (map `NEXT`) ให้ห้องแชทเดิมรู้ว่ารออะไรต่อ (รับงาน→รอซ่อม→รอตรวจ→รอคุณภาพ/รับมอบ→รออนุมัติปิด) จนจบ step7 แจ้งปิดงาน
  - **สรุปงานค้างทุกเช้า 09:00 (2026-07-22):** edge `mtn-daily-summary` (Main pg_cron 02:00 UTC) รวมใบที่ยังไม่ปิดนับตามทีม+ขั้นที่ค้าง ส่งภาพรวมห้องรวม + แยกรายทีมเข้าห้องทีม (event `mtn_daily_summary` · ปิด/แก้ห้องที่ `/notification-config`)
- **พิมพ์ใบ MO / บันทึก PDF — เลือกฟอร์มตามทีมช่าง (2026-07-22 · คำสั่ง user "ฟอร์ม maintenance กับ jig/die ไม่เหมือนกัน"):** ปุ่ม 🖨️ ใน DetailDrawer → `printMoReport(o, dparts)` **แยก layout ตาม `mtn_dept`**:
  - **JIG MTN / DIE MTN / PRODUCTION → FM-JIG-008** (`printMoReport` เดิม): โลโก้ TS + หัว 3 คอลัมน์ + ส่วน 1 ผู้แจ้ง | 2 รับงาน + 3 ซ่อม + BEFORE/AFTER + 4&5 คุณภาพ | 6 รับมอบ + ตารางอนุมัติ 4 ช่อง (JIG/MTN·QA·PD·MGR) + footer FM-JIG-008-REV.00 (doc_key `mo_report`)
  - **MTN เท่านั้น → FM-MTN-006** (`printMoReportMtn` ใหม่ · คำสั่ง user: อีก 3 แผนกใช้ฟอร์มเดิม): layout ตามใบ M/O กระดาษ — หัว M/O + ส่วนผู้แจ้ง/checkbox รอ-ดำเนินการ/ประเภทงาน(ซ่อม/ปรับปรุง) + ดำเนินงานซ่อมบำรุง + BEFORE/AFTER + ตารางอะไหล่ 5 แถว + ค่าใช้จ่าย (1)+(2) + **ตารางประเมินความพึงพอใจ 5 ข้อ × เฉยๆ/พอใจ/พอใจมาก (ติ๊กจาก `o.satisfaction`)** + ลายเซ็น ผู้ตรวจสอบและรับรอง/ผู้อนุมัติ + footer FM-MTN-006 (doc_key `mo_report_mtn` · fallback ในโค้ด — migration `20260722_doc_form_mo_mtn.sql` ทำให้แก้ที่ `/doc-forms` ได้)
  - เพิ่มทีม/ฟอร์มใหม่ → เพิ่ม branch ใน `printMoReport` + register doc_key ใน doc_forms · เซฟ PDF จาก dialog พิมพ์เบราว์เซอร์
- **Scope:** leader = family ไลน์ตัวเอง (branch มาก่อน) · role อื่นตาม `sections` — pattern มาตรฐาน
- **ข้อมูลเก่า 677 ใบจาก Google Sheet ยังไม่ย้าย** (user เลือก "ย้ายทีหลัง") — ระบบเริ่มนับ MO ใหม่จาก 0

---

## PM Predictive & Planner Sync — เห็นวัน PM ล่วงหน้า + buffer (2026-07-16)

หน้า `/pm-forecast` (🔧 PM ล่วงหน้า (Planner), กลุ่มการตรวจสอบและซ่อมบำรุง) — ให้ **วางแผน/ผลิตเห็นวันที่จะต้อง PM ล่วงหน้า 1-2 สัปดาห์** + **buffer ที่ต้องผลิตเผื่อ** ก่อนเครื่องหยุดทำ PM

- **สูตร (helper `src/lib/pmPredictive.js` — pure):**
  - **ตามรอบเวลา** (plan_type time) → คาดวัน = `next_due_date` ตรงๆ
  - **ตาม shot/ยอดผลิต** (usage) → คาดวัน = วันนี้ + (`usage_threshold` − shot สะสม) ÷ อัตราผลิต/วัน
  - **shot สะสม** = Σ `qty_ok`(?? qty) ของ prod_orders confirmed ในไลน์ family ตั้งแต่ `last_done_at` (DR)
  - **อัตรา/วัน** = forecast เดือนนี้ (`customer_forecasts` ของ mat ที่ไลน์ผลิต) ÷ 22 วันทำงาน · ไม่มี forecast → เฉลี่ยจริง 30 วัน (rateSource บอกที่มา)
  - **buffer** = อัตรา/วัน × (`pm_duration_hours` ÷ 16) × (1 + `buffer_margin_pct`/100)
  - **เข้า window** เมื่อ daysTo ≤ `lead_time_days` (แถวส้ม) · เลยกำหนด = แถวแดง
- **config ต่อแผน** (MTN กรอกในตารางนี้ สิทธิ์ `pm:setup`): `pm_duration_hours` / `lead_time_days` (default 10) / `buffer_margin_pct` (default 15) — migration `20260716_pm_predictive_buffer.sql` (DR) · usage_metric/usage_threshold/usage_source_line มีอยู่แล้วใน pm_plans
- **Scope:** leader = family ไลน์ตัวเอง · role อื่นตาม sections · เรียงตามใกล้ถึงสุด
- สิทธิ์เข้าหน้า: ทุก role (`page:/pm-forecast`, migration `20260716_pm_forecast_permission.sql` Main)
- อัตรา/วัน อ่านวันทำงานจริงจากปฏิทินบริษัท (`countWorkingDaysInMonth` — fallback 22 เมื่อปฏิทินว่าง · 2026-07-21)
- **เฟสถัดไป (ยังไม่ทำ):** cron/edge แจ้ง Telegram ผลิต+planner ตอนเข้า window อัตโนมัติ (ตอนนี้เห็นผ่านหน้า + andon เหลืองบน org map)

## ตั้งค่าผัง/Floorplan — แยก display ออกจาก setup (2026-07-16)

**หลักการ:** หน้า display (ผังรวมโรงงาน/Dashboard) = **ดู + popup เท่านั้น** · การตั้งค่าผังทั้งหมดรวมที่ **`/layout-setup` "🗺️ ตั้งค่าผัง/Floorplan"** (หมวดตั้งค่าโปรแกรม) แยกแท็บตาม POV — เตรียมรับ Store/AMR ในอนาคต
- **`FactoryMap` รับ prop `setupMode`** (default false): `/factory-map` = display-only (canEdit=false, ไม่มีปุ่มแก้ผัง) · `/layout-setup` แท็บภาพรวมโรงงาน = `<FactoryMap setupMode />` (แก้ผัง/วาด polygon ได้)
- **`MtnMachineLayout` รับ prop `setupMode`** เช่นกัน (default false): `/mtn-layout` = view รวม (overview/production/facility) · `/layout-setup` แท็บ MTN = `<MtnMachineLayout setupMode />` (default view=facility)
  - **⚠️ แก้ผัง facility ใช้สิทธิ์ `pm:setup` ไม่ผูก `setupMode` (2026-07-22):** เดิม `canEdit = setupMode && can('pm','setup')` → ทีม MTN (role mtn) แก้ผัง facility ไม่ได้เลย เพราะ mtn เข้า `/layout-setup` ไม่ได้ (admin/mgr/sv เท่านั้น) เข้าได้แค่ `/mtn-layout` (display) · facility เป็น domain ของช่าง → เปลี่ยนเป็น `canEdit = can('pm','setup',role)` แก้ผัง facility (เพิ่ม/ลบโซน/อัปรูป/วางจุด) ได้บน `/mtn-layout` เลย (canEdit ในไฟล์นี้ใช้กับ facility ล้วน ไม่กระทบ production/overview)
- **ฐานเครื่องจักรรองรับ Facility/Utility (2026-07-22):** `machines.equipment_category` ('production'/'facility'/'utility' · migration `20260722_machines_equipment_category.sql` DR) — MachineDatabase มีปุ่มหมวด 🏭 ไลน์ผลิต / 🔧 Facility / ⚡ Utility · เลือก Facility/Utility → ช่อง "ระบบ/พื้นที่" เป็น datalist (suggest จาก `pm_facility_areas` + พิมพ์ใหม่ได้ เช่น ระบบน้ำ/ลม/High Pressure) **ไม่ต้องผูกไลน์ผลิต** (เดิมบังคับเลือกไลน์ → เพิ่ม facility ไม่ได้) · เก็บชื่อระบบใน `line_name` (group ในลิสต์)
- **แท็บ:** 🗺️ ภาพรวมโรงงาน (FactoryMap setupMode) · 🏭 ผลิต (ลิงก์ LineSetup — LineSetup ทำหลายอย่างเลยลิงก์ไม่ยกโค้ด) · 🔧 MTN (MtnMachineLayout setupMode ฝังในแท็บ) · 📦 Store/AMR (placeholder รอระบบ AMR) · component `src/pages/LayoutSetup.jsx`
- สิทธิ์: `page:/layout-setup` (admin/manager/supervisor · admin bypass) · migration `20260716_layout_setup_permission.sql`
- **หน้า display อื่นที่ควรแยก setup ออก (audit อยู่):** ดูผล review — อย่าฝัง setup/config ในหน้า operational ใหม่ ให้ไปหมวดตั้งค่า

## ผังรวมโรงงาน — ผังภาพรวมทั้งโรงงานที่เดียว (ยุบรวมแล้ว 2026-07-16)

**ผังรวมโรงงาน = `/factory-map` (FactoryMap) ที่เดียวเท่านั้น** — polygon ต่อไลน์ + หลายโหมด (ยอดผลิต/OEE/Downtime/ของเสีย/คน/**PM เครื่องจักร**) ดู "Factory Master Map" ด้านบน
- ⚠️ **เคยทำ MTN org map แยก (แท็บ "ภาพรวม Org" ใน `/mtn-layout` + component `FactoryPlanManager` ใน LineSetup) แล้วมันซ้ำซ้อนกับ `/factory-map` → ยุบทิ้งแล้ว** (2026-07-16) · `/mtn-layout` เหลือปุ่มลิงก์ "🗺️ ภาพรวมทั้งโรงงาน" → `/factory-map` แทน · **อย่าสร้างผังรวมโรงงานอันใหม่ ให้ต่อยอดที่ `/factory-map`**
- ตาราง `pm_org_nodes` (migration `20260716_pm_org_nodes.sql`) เป็น vestigial (additive ไม่ลบ แต่ไม่มีโค้ดใช้แล้ว) · ถ้าอยากได้ signal "ใบซ่อม MO ค้าง" บนผังรวม ให้เพิ่มเป็น metric ใน FactoryMap (มี Downtime/PM mode อยู่แล้ว)

## PM Photo-Compare Inspection — ❌ ถอดออกแล้ว (2026-07-22)

**ถอดระบบเทียบรูปเงา (photo-hunt / PhotoCompareModal) ออกทั้งหมด** ตามคำสั่ง user: มันไม่ได้เทียบความเหมือนด้วย AI (แค่ wipe/blink/diff เงา) — ไม่คุ้ม · **ใช้ฟีเจอร์ที่มีอยู่พอ = เห็นรูปมาตรฐาน + เห็นจุดที่ต้องเช็ค**
- ลบ `src/components/PhotoCompareModal.jsx` + ปุ่ม "เทียบรูป/ตั้งรูปมาตรฐาน" + การเก็บรูปหลักฐาน NG (evidenceBlobs) ออกจาก PMCheckData
- **ยังเหลือ:** `CpImage` แสดง thumbnail รูปมาตรฐาน (`jig_checkpoints.image_path`) คลิกเปิดเต็มจอ บนทุกแถวจุดตรวจ — ผู้ตรวจเห็นรูป+จุดที่ต้องเช็คได้เหมือนเดิม · ตั้งรูปมาตรฐานที่ PMSetup (เหมือนเดิม)
- คอลัมน์ `inspection_results.evidence_path` (migration `20260715_inspection_evidence_photo.sql`) เป็น vestigial — ไม่เขียนใหม่แล้ว แต่ HistoryModal ยังโชว์รูปหลักฐานเก่าถ้ามี (harmless) · ไม่ต้อง rollback migration
- **ถ้าจะทำ AI ตรวจสภาพจริง** (YOLO/anomaly) ค่อยเริ่มใหม่เป็นระบบแยก — การเทียบเงาเฉยๆ ไม่เหมาะ (user ยืนยัน)

---

## Employee Skills & EXP Farming (ย้ายฝั่ง server ทั้งหมด — 2026-07-13)

ระบบสะสม EXP ทักษะพนักงานจากการทำงานจริง — **ห้ามเขียนคะแนน `employee_skills` จาก client นอกเหนือจาก
2 flow ที่อนุญาต** (แก้สกิลใน modal พนักงาน + อนุมัติ/ปฏิเสธ level up ใน `/operator`) ทุกการเพิ่มคะแนน
อัตโนมัติต้องเป็นฟังก์ชันฝั่ง DB เท่านั้น · migration: `20260713_skill_farming_server_side.sql` (Main)

### กลไก (SQL functions บน Main project — ซอร์สอยู่ใน migration ข้างบน)

| Function | รันโดย | ทำอะไร |
|---|---|---|
| `fn_daily_skill_farm(p_work_date?)` | pg_cron `daily-skill-farm` ทุกวัน 01:20 UTC (**08:20 ไทย** — หลังจบกรอบวันงาน 08:00) | +1 EXP/วัน ต่อ (พนักงาน, สกิล) ที่มาทำงานจริงที่สถานีที่มี `station_requirements.min_score >= 70` · cap 3 ชั้น: min_score / เพดานขั้น 24-49-74-99 / หยุดเมื่อมี `pending_level` · dedup ด้วย `last_daily_farm_date` (วันละครั้งเสมอ ไม่ว่าจะเรียกกี่รอบ) |
| `fn_weekly_skill_update(p_week_start?)` | pg_cron `weekly-skill-update` จันทร์ 01:05 UTC (**08:05 ไทย**) + ปุ่ม 🔄 ใน `/operator` (สิทธิ์ `skills:run_weekly_update`) | ทำงาน ≥3 วัน/สัปดาห์ที่สถานีที่ต้องการสกิล → +2 (cap เพดานขั้น) · ชนเพดาน → สร้าง `skill_level_up_requests` + ตั้ง `pending_level` (หยุด farm จนกว่าจะ approve/reject) · ไม่ได้ทำงานเลยทั้งสัปดาห์ → decay −2 (floor 25) · **idempotent: สัปดาห์เดียวกันประมวลผลครั้งเดียว** (กันใน `skill_update_runs` — เรียกซ้ำได้ข้อความ "ประมวลผลไปแล้ว") |

### Level Up flow

```
farm ชนเพดานขั้น (24/49/74/99) → คำขอ level up (to_level = 25/50/75/100) + pending_level
   → อนุมัติใน /operator แท็บ ⬆️: to_level < 100 = can('skills','approve_levelup') (sv/mgr/admin)
                                  to_level = 100 = can('skills','approve_levelup_100') (mgr/admin) + บังคับแนบเอกสารอบรม
   → approved: score = to_level, pending_level = null · rejected: pending_level = null (farm ต่อจากคะแนนเดิม)
```

### กฎเหล็กของระบบนี้ (บั๊กที่เคยเกิด — ห้ามทำซ้ำ)

- **ห้ามคืน daily farming ฝั่ง client** — เดิมอยู่ใน Checkin.jsx handleSave: กดบันทึกซ้ำ = +1 ซ้ำไม่จำกัด,
  เหมาพนักงานทุกไลน์ทั้งโรงงาน (query ไม่ scope), และข้ามด่านอนุมัติ 25/50/75 ได้เอง → พนักงานสกิลอัพเร็วผิดปกติทั้งระบบ
- **RPC ฝั่ง skill ทุกตัวต้อง guard สิทธิ์ในตัวฟังก์ชัน** (เช็ค `auth.uid()` + role จาก profiles — cron ที่ไม่มี JWT ผ่านได้)
  และ **revoke EXECUTE จาก anon/PUBLIC** — เดิม anon key (ฝังใน JS bundle สาธารณะ) ยิง `fn_weekly_skill_update` ซ้ำได้ไม่ต้อง login
- **job อัตโนมัติต้อง idempotent เสมอ** — เดิมเรียกซ้ำ = +2/−2 ซ้ำ · pattern: กันด้วย `skill_update_runs` (weekly)
  หรือ dedup รายแถว (`last_daily_farm_date` — daily)
- **pg_cron ใช้ UTC** — เวลาไทยต้อง −7 ชม. (เคยตั้ง `5 8 * * 1` แล้วได้จันทร์ 15:05 ไทยแทน 08:05)
- คะแนนที่เฟ้อไปแล้วจากบั๊กเก่า**ไม่ได้ถูก reset อัตโนมัติ** — supervisor/manager ปรับมือได้จากแท็บ ⚙️ กำหนดสกิลใน `/operator`
  (weekly decay จะค่อยๆ ดึงคะแนนคนที่ไม่ได้ทำงานจริงลงเอง)

### Export ฟอร์ม Skill Matrix (ตามฟอร์มกระดาษ Thai Summit — 2026-07-16)

ระบบ export ฟอร์มทักษะได้ 2 แบบใน `/report` (แท็บสกิลอยู่ `/skills-report`) ให้เหมือนฟอร์มกระดาษของบริษัท:

- **สรุปทั้งไลน์** (`MULTI SKILL OF OPERATORS`, รหัส FM-PD1-017) — แท็บ 🏅 Multi-Skill Form · ตารางพนักงาน × สกิล แต่ละช่องเป็น**วงกลมแบ่ง 4 ส่วน 5 ระดับ** (0-24/25-49/50-74/75-99/100 = `MS_LEVELS`+`scoreToLevel`+`skillGaugeSvgStr`) · ลายเซ็น จัดทำ/ตรวจสอบ/อนุมัติ ดึงจาก `profiles` ตาม role ของไลน์ · A3 landscape
- **รายบุคคล** (`ใบประเมินทักษะฯ`, รหัส F-PRS-P1-119) — แท็บ 📊 Skill Matrix → คลิกพนักงาน → ปุ่ม 🖨️ ใน radar panel (`buildIndividualSkillHtml`) · มี radar SVG (`buildRadarSvg`), รูป+3 ลายเซ็น, ตารางหัวข้อย่อยต่อสกิล + คะแนน 4 ระดับ, สรุป/legend/เกณฑ์/หมายเหตุ · A4 portrait
- **โหมด Hybrid (สำคัญ):** ระบบเก็บแค่คะแนนเดียว 0-100 ต่อสกิล — ใบรายบุคคลจึง (ก) เอา**ข้อความหัวข้อย่อย**จาก `skill_sub_items` (ถ้าสกิลไม่มี → fallback 1 แถว = ชื่อสกิล) (ข) **ค่าติ๊ก 4 ระดับรายแถว derive จากคะแนน** (`distributeLevels` กระจายระดับให้เฉลี่ย ≈ score/25 เหมือนฟอร์มกระดาษที่หัวข้อเป็นสเต็ป 25%) (ค) **% สรุปกลุ่ม/radar/โดยรวม ใช้คะแนนจริง** (เที่ยงตรง ไม่ปัดเป็น 25) · ถ้าวันหน้าจะเก็บผลประเมินรายหัวข้อจริง (ไม่ derive) ต้องเพิ่มตารางผลประเมิน + UI กรอก แล้วเปลี่ยนที่มาของค่าติ๊ก
- **โลโก้ Thai Summit** = ไฟล์ทางการ `src/assets/TS logo.png` (ตัวเดียวกับ App/Login/DailyReport/OJT/LPA/MtnRepair ใช้ — import เป็น `tsLogoUrl`) · **override ได้ด้วยรูปที่อัปโหลดใน `/doc-forms` (`doc_forms.logo_url`)** → เป๊ะ 100% · **pattern มาตรฐานทุกฟอร์มพิมพ์:** handler แปลงเป็น dataURL ผ่าน `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)` แล้วส่งเข้า builder (`tsLogoHtml(logoUrl)`) — **ห้าม hardcode/วาดโลโก้เอง** (เคยพลาดวาดกล่อง T/S แยก ไม่ตรงตราจริง)
- **ใบรายบุคคลบังคับ ≤ 1 หน้า A4 เสมอ (2026-07-21):** พนักงานสกิลเยอะ (เช่น LINE APRON ASSY ~20 สกิล) ตารางยาวเกินหน้า → สคริปต์ `fitOnePage()` วัดความสูงจริงเทียบ 287mm แล้วตั้ง **`el.style.zoom`** ให้พอดี 1 หน้า (ใช้ `zoom` ไม่ใช่ `transform: scale` — transform เป็นภาพลวงตา ไม่ลดกล่อง layout → print ยังนับหลายหน้า · zoom ลด layout จริง Chrome นับหน้าถูก) · เคสสกิลน้อยไม่ย่อ คงขนาดเต็ม · รอ `document.fonts.ready` ก่อนวัด กัน webfont ทำความสูงเพี้ยน — **pattern นี้ reuse ได้กับฟอร์มพิมพ์อื่นที่ต้อง fit 1 หน้าแบบ dynamic**
- helper ทั้งหมดอยู่ใน `src/pages/Report.jsx` · หัวข้อย่อยจัดการที่ `/operator` ⚙️ ปุ่ม 📝 (`SkillSubItemsModal`)

---

## Edge Functions

### `send-notification`
- **Endpoint:** `POST /functions/v1/send-notification`
- **Payload:** `{ event: "status_change", log: { ...four_m_log } }`
- **Events อื่น:** `checkin_summary`, `checkin_update`, `ot_booking`, `prod_close`, `downtime`, `downtime_recovered`, `downtime_call_mtn`, `downtime_open_15min`, `morning_meeting`
  - ⚠️ **หมวดเช็คชื่อแยกเป็น 3 event (2026-07-21 — คำสั่ง user: หัวหน้าแผนกงงว่าทำไมเช็คชื่อซ้ำ):** ปุ่ม "บันทึก" ตัวเดียวในหน้า Checkin ทำ 3 อย่าง (เช็คชื่อ / แก้กำลังคน / จองรถ OT) เดิมยิง `checkin_summary` **ทุกครั้ง** — พอหัวหน้ากลุ่มมาลงจอง OT กะดึกระหว่างวันแล้วกดบันทึก จะเด้ง "เช็คชื่อเสร็จแล้ว" ซ้ำ หัวหน้าแผนกเลยงง · แก้: `Checkin.jsx handleSave` เก็บ `baseline` ตอนโหลด แล้วเทียบตอนบันทึก → เลือก event ตามสิ่งที่เปลี่ยนจริง:
    - `checkin_summary` — บันทึกครั้งแรกของวัน (ยังไม่มี log ของคนที่แสดงอยู่) = เช็คชื่อเริ่มงาน (payload เดิม `{ event, summary }`)
    - `checkin_update` — เคยเช็คชื่อแล้ว + ข้อมูลเข้างาน/ลา/PPE เปลี่ยน = อัพเดทกำลังคน (payload `{ event, summary: {...+changed_count, changed_names} }` — ลิสต์คนที่เปลี่ยน)
    - `ot_booking` — สถานะจอง OT/งาน/ช่วงเวลาเปลี่ยน = จองรถ OT (payload `{ event, booking: {line_name, work_date, date_label, shift_label, count, items, booked_by} }` — items = รายชื่อ+งาน+เวลาต่อคนของวันจองหลัก · กะดึกจองคืนถัดไป กะเช้าจองวันนี้)
    - ไม่เปลี่ยนอะไร (re-save เฉยๆ) = **เงียบ ไม่ยิงอะไร** · ทั้ง 3 event category `manpower` ปรับห้อง/ปิด/แก้ข้อความได้ที่ `/notification-config` (migration `20260721_checkin_notification_split.sql` seed default เข้าห้องเดียวกับ checkin_summary) · **ต้อง deploy edge function `send-notification` ให้รู้จัก 2 event ใหม่** (ก่อน deploy: 2 event ใหม่ได้ 400 เงียบๆ ฝั่ง client fire-and-forget — bug ซ้ำหายทันทีจากฝั่ง frontend, แค่ยังไม่มีข้อความ update/OT)
  - `morning_meeting` — สรุปประชุมแถวเช้าจากหน้า `/morning-meeting` (payload `{ event, summary: {...} }` — ผลิตรวม/เป้า, OEE, DT, NG, งานหลุดแผน, action ค้าง) · rule/template แก้ได้จากหน้าตั้งค่าการแจ้งเตือน (deploy v30 2026-07-13)
  - ⚠️ **Downtime notification overhaul (2026-07-14) — ลดสัญญาณรบกวน + เรียกช่างแบบตั้งใจ** (คำสั่ง user: แจ้งเยอะเกิน เบรคดาวน์เล็กน้อยก็แจ้ง + พนักงานลงย้อนหลังไม่ได้ตั้งใจเรียกช่าง):
    - **บันทึก Downtime ใหม่ = ไม่แจ้ง Telegram ทันทีอีกต่อไป** (ทั้งปิดแล้วและเปิดค้าง) — ตัด `notifyDowntime` ตอน insert ใน `DailyReport.jsx handleAddDT`
    - **ปิดรายการย้อนหลัง (ลงแล้วปิดเลย)** → เงียบ ไปสรุปตอนปิดกะแทน (`prod_close` มี downtimes[]/dt_total_min ครบอยู่แล้ว)
    - **เปิดค้าง (ไม่ปิดรายการ)** → `downtime-open-scan` (DR pg_cron ทุก 5 นาที) แจ้ง `downtime_open_15min` เมื่อ `started_at` เกิน `dt_alert_config.open_alert_min` นาที (config ได้จากหน้า `/notification-config`, default 15) แล้ว stamp `open_alerted_at` กันซ้ำ → เตือน**เสียงหน้า Production** (Dashboard/Management)
    - **ปุ่ม "📞 เรียกช่าง" ในแถว Downtime (DailyReport)** → `downtime_call_mtn` แจ้งทันที (set `call_mtn=true, call_mtn_at, call_mtn_by`) → เตือน**เสียงหน้า Maintenance** (MtnMachineLayout)
    - **เสียงบนเว็บ:** `src/components/DowntimeSiren.jsx` (mode `call_mtn` / `open_15min`) — Web Audio วนจนกด "รับทราบ" (set `call_mtn_ack_at` / `open_ack_at`) · scope เสียงแยกหน้าตามคำสั่ง user (เรียกช่างดังหน้า MTN, เปิดค้างดังหน้า Production)
    - `downtime_recovered` ยิงเฉพาะตอนปิดรายการที่**เคยถูกแจ้ง**แล้ว (`open_alerted_at` หรือ `call_mtn`) — ปิดรายการที่ไม่เคยดังก็เงียบ ไม่รก
    - schema: `20260714_downtime_alert_v2.sql` (DR: คอลัมน์ open_alerted_at/open_ack_at/call_mtn*/ + ตาราง `dt_alert_config`) · cron: `20260714_downtime_open_scan_cron.sql` (DR) · rules: `20260714_downtime_notification_rules.sql` (Main)
  - `downtime` — event เดิม (payload `{ event: "downtime", downtime: {...} }`) ยังมีอยู่แต่**เลิกยิงจาก DailyReport แล้ว** (เก็บไว้เผื่อ manual/backward compat) — คู่กับ alarm กระพริบแดงที่จุดเครื่องจักรบน Dashboard/Management (helper: `src/utils/downtimeAlarm.js` — alarm เฉพาะเมื่อ downtime ยังไม่ปิดรายการ ปิดรายการแล้วดับทันที)
  - **Person alarm (ไม่เกี่ยว Telegram):** marker คนบนผัง Dashboard/Management กระพริบด้วย helper `src/utils/personAlarm.js` — แดง = เช็คชื่อแล้วแต่ PPE ไม่ครบ (Management แสดงเป็นแถบเตือนเหนือผัง เพราะคน PPE ไม่ครบไม่เข้า pool), เหลือง = ย้ายจุด/ข้ามไลน์แล้ว 4M Man ยังรออนุมัติ (จับคู่คน↔log ด้วยชื่อใน description เพราะ four_m_logs ไม่มี employee_id)
  - `downtime_recovered` — แจ้งเมื่อรายการ Downtime ที่เปิดค้าง (ไม่มีเวลาจบ/ระยะเวลา) ถูกแก้ไขจนปิดรายการ = เครื่องกลับมารันได้ (เฉพาะเคสนี้ การแก้ไขทั่วไปไม่แจ้งซ้ำ)
  - `prod_close` — รองรับ field เสริม (start_time/end_time/shift_min, total_qty, qty_repair, oee_a/p/q, parts[], downtimes[], dt_count, dt_total_min, dt_carry[]) — ข้อความ Telegram จะสรุปครบเหมือนหน้าปิดกะ ทุก field optional เพื่อ backward compat
  - **Downtime ตัดยอดข้ามกะ:** ถ้าเครื่องยังซ่อมไม่เสร็จตอนปิดกะ เลือก "ยังซ่อมอยู่ — ตัดยอดข้ามกะ" ใน modal ปิดกะ → รายการกะนี้ถูกปิดด้วยเวลาปิดกะ (`downtime_logs.carry_over = true`) และเมื่อเปิดกะถัดไปของไลน์เดียวกัน ระบบสร้างรายการต่อเนื่องให้อัตโนมัติ (`carried_from_id` ชี้รายการเดิม) — OEE ถูกต้องทั้งสองกะ, alarm กระพริบต่อเนื่อง, แจ้ง "เครื่องกลับมารันได้" เฉพาะตอนปิดรายการจริง (migration: `20260709_downtime_carry_over.sql`)
- **Secrets ที่ต้องตั้งใน Supabase:**
  - `TELEGRAM_BOT_TOKEN` — จาก @BotFather
  - `TELEGRAM_CHAT_ID` — Group Chat ID (เลขติดลบ เช่น `-5279077923`)

### Functions อื่นๆ ที่ deploy อยู่ (สรุปย่อ — เพิ่มเอกสาร 2026-07-10)

| Function | Project | ทำอะไร |
|---|---|---|
| `daily-4m-summary` | Main | สรุป 4M รายวันส่ง Telegram — default = **work date เมื่อวาน** (ตัด 08:00 ตามกฎ getWorkDate ไม่ใช่วันปฏิทิน — แก้ 2026-07-12 v3) |
| `send-cqi15-notification` | Main | แจ้งเตือน CQI-15 Event Log + approval แยกจาก send-notification |
| `pm-daily-scan` | DR (pg_cron) | สแกน Daily PM alarm สีส้ม (เช็คไม่เสร็จตามเวลา) — เขียว/แดง event-driven จากแอป |
| `pm-plan-reminder` | DR (pg_cron รายวัน) | เตือน Planned PM ตามขั้น 30/14/3 วัน/เกินกำหนด → POST ไป send-notification ฝั่ง Main |
| `shipping-phase-scan` | DR (pg_cron ทุก 10 นาที) | สแกน shipping walkback phase misses บนกรอบวันงาน 08:00→08:00 |
| `downtime-open-scan` | DR (pg_cron ทุก 5 นาที) | สแกน Downtime ที่เปิดค้างเกิน `dt_alert_config.open_alert_min` นาที → POST `downtime_open_15min` ไป send-notification ฝั่ง Main + stamp `open_alerted_at` กันซ้ำ (2026-07-14) |
| `send-mtn-notification` | Main | แจ้งเตือนใบแจ้งซ่อม MO — **แจ้งครบทุกสเตป 1-7** (`mtn_reported`/`assigned`/`repaired`/`checked`/`qa`/`handover`/`closed`) · **แยกไฟล์จาก send-notification (กันไฟล์ใหญ่พัง) แต่ route ผ่าน notification_rules/telegram_channels เดียวกัน** → ตั้งค่า/ปิด/เลือกห้อง/แก้ข้อความได้จาก `/notification-config` (category maintenance) · **route ตามทีม:** มีห้องแท็ก `telegram_channels.team` = `mtn_dept` → เข้าห้องทีม, ไม่มี → ห้องรวม (smart maintenance/fallback) · **v5 (2026-07-22): แต่ละสเตปต่อท้าย "⏳ ขั้นต่อไป: รอ…"** ให้ห้องแชทรู้ว่ารออะไรต่อ (map `NEXT` ในไฟล์) · payload `{ event, mo: {...} }` |
| `mtn-daily-summary` | Main (pg_cron 02:00 UTC = **09:00 ไทย**) | **สรุปงานซ่อม (MO) ค้างประจำวัน** (2026-07-22) — อ่าน `mtn_orders` ฝั่ง DR (`DR_URL`/`DR_ANON_KEY`, status ไม่ใช่ closed/rejected) นับตามทีม (`mtn_dept`) + ขั้นที่ค้าง (pending→รอรับงาน … handover→รออนุมัติปิด) → ส่งภาพรวมเข้าห้องรวม (event `mtn_daily_summary`) + แยกรายทีมเข้าห้องที่แท็ก team ไว้ · verify_jwt=false (cron เรียกได้ไม่ต้อง JWT) · ปิด/แก้ห้องได้ที่ `/notification-config` · migration `20260722_mtn_daily_summary_rule.sql` (rule) + `20260722_mtn_daily_summary_cron.sql` (cron Main) |
| `telegram-webhook` | Main | **ขา "รับ" ของบอท** (2026-07-16): Telegram ยิงทุก update เข้า function นี้ (setWebhook + secret) → (1) กวาดเก็บข้อความกลุ่มที่ลงทะเบียน → `telegram_messages` (2) **reply ใต้ข้อความแจ้งเตือน = คอมเมนต์ `event_comments` ผูกใบงานอัตโนมัติ** (mapping จาก `telegram_sent_messages` — send-notification/send-mtn-notification ถูก patch ให้จำ message_id ของ event ที่มี ref: mtn ทุก event + downtime_call_mtn/open_15min · payload ต้องส่ง `id` มาด้วย) (3) **AI intake**: `/dt RB80 โรบอทชนจิ๊ก 14.00-14.20` ทุกกลุ่ม หรือพิมพ์อิสระในกลุ่มที่อยู่ใน env `AI_INTAKE_CHAT_IDS` → Claude Haiku แยกฟิลด์ → ground กับ machines/dr_downtime_types/production_sessions จริง (work date ตัด 08:00 ไทย) → ปุ่ม [✅ บันทึก][❌ ยกเลิก] ใน Telegram — **คนกดยืนยันเท่านั้นถึง insert `downtime_logs` · AI ห้ามเขียนฐานเอง** (คิว `telegram_pending_actions` หมดอายุ 6 ชม.) · secrets: `TELEGRAM_WEBHOOK_SECRET`, `DR_URL`, `DR_ANON_KEY`, `ANTHROPIC_API_KEY` (ไม่ตั้ง = ปิดเฉพาะ AI), `AI_INTAKE_CHAT_IDS` · migration `20260716_telegram_intake.sql` (Main — 3 ตาราง service-role-only) |

### `cleanup-orphan-photos` (Main project — 2026-07-09)
- ล้างไฟล์กำพร้าใน bucket `employee-photos` = ไฟล์ที่ไม่มี `employees.image_url` / `line_layouts.image_url` ชี้ถึงแล้ว
- `POST /functions/v1/cleanup-orphan-photos?dry_run=1` + header `x-cleanup-token` (token ฝังในซอร์ส function) — **รัน dry_run ดูรายงานก่อนลบจริงเสมอ**, มี safety ข้ามไฟล์ที่อัปโหลดภายใน 24 ชม.
- รันครั้งแรกล้างได้ 117 ไฟล์ / 100.6MB — ปกติไม่ต้องรันซ้ำ เพราะแอปลบไฟล์เก่าเองตอนเปลี่ยนรูปแล้ว (ดู "Storage & รูปภาพ")
- ถ้า environment โดน network policy บล็อกยิงตรงไป supabase.co → เรียกผ่าน `net.http_post` (pg_net) จาก SQL แทน (ดู pattern ใน migration `20260708_pm_daily_scan_cron.sql`)

---

## Storage & รูปภาพ (กติกาสำคัญ — 2026-07-09)

- **อัปโหลดรูปทุกหน้าต้องผ่าน `ImageCropModal`** — รูปนิ่งถูก crop + บีบเป็น JPEG 480px q0.85 (~100KB) อัตโนมัติ
  - **ข้อยกเว้นที่ตั้งใจ (crop ไม่เหมาะ):** รูปที่ต้องเห็นทั้งใบ/คมชัด ให้**บีบก่อนอัปโหลดแทน** — รูป jig/checkpoint (PMSetup), รูปหลักฐาน 4M/QA/เอกสาร level-up (Management/Report/operator: helper `resizeImage` 1280px q0.85) · drawing ฝั่ง QA: **รูปบีบ 2560px/2.5MB/q0.9** (สเปคเดียวกับผัง — ต้องซูมอ่าน dimension ได้ · user ยืนยัน 2026-07-12 ว่าบีบได้), **PDF เท่านั้นที่ส่งดิบ** (≤20MB) · **ห้ามอัปโหลดรูปดิบโดยไม่บีบเลย**
  - **รูปผัง/layout (LineSetup, MtnMachineLayout) บีบเบากว่ารูปอื่น: 2560px / 2.5MB / q0.9** (2026-07-10) — layout มีจำนวนน้อยทั้งระบบ (≤20 รูป) แต่ต้องซูมอ่านรายละเอียดผังได้ **ห้ามลดกลับไป 1600px/0.5MB** เคยบีบแรงจนเบลอใช้งานไม่ได้ (รูปเดิมที่เบลอไปแล้วต้องอัปโหลดต้นฉบับซ้ำ ระบบไม่มีต้นฉบับเก็บไว้)
- **GIF (รูปขยับ) ถูกส่งทั้งไฟล์โดยไม่แปลง** เพื่อคงการเคลื่อนไหว (วาดลง canvas จะเหลือเฟรมแรกเฟรมเดียว = การขยับหายเงียบๆ) — จำกัด ≤ 2MB **ทุกจุดที่รับ GIF** (ImageCropModal + LineSetup) **ห้ามถอด cap ออก** (GIF ไม่จำกัดขนาดเฉลี่ย ~4MB เคยกินครึ่ง bucket)
- **เปลี่ยน/ลบรูปแล้วต้องลบไฟล์เก่าจาก storage เสมอ** (ลบ**หลัง** DB update สำเร็จเท่านั้น + best-effort ห้ามทำ flow หลักพัง) — ทำแล้วใน: DeptHub.jsx (รูปโปรไฟล์ user — bucket `avatars` **แยกจาก employee-photos โดยเจตนา** เพราะ cleanup-orphan-photos สแกน employee-photos เทียบ employees/line_layouts เท่านั้น ไฟล์ avatar ที่ไปอยู่ที่นั่นจะโดนลบ · migration `20260714_profiles_avatar.sql`), operator.jsx (รูปพนักงาน), LineSetup.jsx (ผังไลน์ ทั้งตอนเปลี่ยนผังและตอนลบไลน์ — เฉพาะผังของตัวเอง **ห้ามลบผังที่ยืมแสดงจากไลน์แม่**), ProductMaster.jsx (dr_products + parts_master ทั้งตอนเปลี่ยนรูปและตอนลบสินค้า — มี guard ไม่ลบรูปที่สินค้า/พาร์ทอื่นแชร์ URL เดียวกัน), QAInspectionSetup.jsx (replace/delete drawing + ลบทั้งโฟลเดอร์ตอนลบ part), PMSetup.jsx (ลบ jig = ลบรูปทั้งชุด frame-*/cp-*), SignatureModal.jsx (ลายเซ็นเก่า — เฉพาะโฟลเดอร์ user ตัวเอง), Management.jsx (รูปหลักฐาน OJT แนบทับ = ลบรูปเดิม), MtnMachineLayout.jsx (รูปโซน facility), Improvements.jsx (รูป before/after ทั้งตอนเปลี่ยนและตอนลบโปรเจค) · หน้าใหม่ที่มีการเปลี่ยนรูปต้องทำแบบเดียวกัน ไม่งั้นไฟล์กำพร้าสะสม (เคยค้าง 117 ไฟล์ / 100MB เพราะอัปโหลดชื่อใหม่ `emp_<timestamp>` โดยไม่ลบของเดิม)
- **อุปกรณ์ PM ใช้ "รูปหลายมุม (spin)" เท่านั้น — ไม่มีโมเดล 3D แล้ว** (ถอดออก 2026-07-10 เพราะเกินจำเป็น + dep หนัก three/occt wasm 7.6MB): PMSetup อัปหลายรูปมุมต่างๆ (SpinAnnotator) ปักหมุดจุดตรวจต่อเฟรม, หน้าตรวจ (JigSpinCheck) ปัดหมุน+auto-play+หมุด sync checklist · คอลัมน์ vestigial `jigs.model_path`/`model_format` และ bucket `jig-images` (cap 40MB + mime GLB) ยังคงอยู่จาก migration เดิม (additive ไม่กระทบ) แต่**ไม่มีโค้ดใช้แล้ว** — ถ้าจะรื้อ 3D กลับมาให้ดู git history (`src/lib/model3d.js`, `src/components/Model3DViewer.jsx`)
- **Quota Free plan (ต่อ project):** DB 500MB · Storage 1GB · Egress 5GB/เดือน — ตรวจล่าสุด 2026-07-10: Main DB 22MB (~4%), DR DB 18MB (~4%), Storage หลัก ~156MB (~15%) → พนักงาน ≤300 คน + อัตราข้อมูลโตปัจจุบัน อยู่ได้อีกหลายปี ถ้าใกล้เต็มค่อยอัป Pro ($25/เดือน = DB 8GB + Storage 100GB) โดยไม่ต้องย้ายระบบ

---

## File Structure

> รายชื่อไฟล์เต็มดูของจริงใน `src/` — ด้านล่างคือ "ไฟล์โครงสร้าง/ของกลาง" ที่ทุก session ควรรู้จัก
> (เลิกลิสต์ pages ทั้งหมดในเอกสาร — เคยลิสต์แล้วล้าสมัยตลอด · pages ปัจจุบัน ~33 ไฟล์ ดูตาราง Pages & Routes ข้างบน)

```
src/
├── App.jsx            # Router + Sidebar + UserContext + NAV_ITEMS (source of truth เมนู/หมวด)
│                      #   exports: UserContext, navItemsForGroups, focusSidebarGroups, accessSummaryForRole
├── main.jsx           # bootstrap + RootErrorBoundary + vite:preloadError auto-reload (ห้ามถอด)
├── index.css          # theme variables + CSS กลาง (.now-line/.now-chip, .dt-alarm-*, .person-alarm-*, .table-sticky)
├── supabaseClient.js  # 2 clients: supabase (Main) / supabaseDR (DR — anon เสมอ)
├── components/        # ของกลาง: Toast, ImageCropModal, MachineFloorMap, SpinAnnotator,
│                      #   InternalTimeBoard, SignatureModal, TaxonomyManagerModal, ChangePasswordModal,
│                      #   DowntimeSiren (เสียงเตือน downtime — 2026-07-14)
├── utils/             # กฎ/สูตรกลาง — permissions.js (can/canAccessPage), usePerms.js, sectionScope.js,
│                      #   roleMeta.js (ชื่อ/สี role จุดเดียว), useIsMobile.js, markerScale.js, timeFrame.js,
│                      #   downtimeAlarm.js, personAlarm.js, lineHierarchy.js, companyCalendar.js,
│                      #   otPeriods.js, dateFormat.js, useImgBox.js
├── lib/               # logic เฉพาะโดเมน (pmNotify, pmDailyAlarm, pmExportPDF/Excel, changePointChecklist)
└── pages/             # ~35 หน้า — ชื่อไฟล์ตรงกับ route (⚠️ operator.jsx ตัวพิมพ์เล็ก)

supabase/
├── migrations/        # ทุกการเปลี่ยน schema ต้องมีไฟล์ที่นี่ (ดู docs/sql/00_schema_snapshot_*.sql = โครงตารางทั้งหมด)
└── functions/         # 11 ตัว (ซอร์สอยู่ใน repo ครบแล้ว): send-notification, send-cqi15-notification,
                       #   daily-4m-summary, create-user (v14 2026-07-13: admin-only + validate role
                       #   กับ enum ผ่าน RPC get_user_roles ห้าม hardcode + เขียนโปรไฟล์ครบทุก field
                       #   จังหวะเดียว), delete-user (admin-only · กันลบตัวเอง/ลบ admin),
                       #   reset-user-password (admin-only · ตั้งรหัสใหม่ให้ user ที่ลืมรหัส —
                       #   ห้ามใช้กับบัญชี admin · ปุ่ม 🔑 ใน modal แก้ไขของ /add-user · 2026-07-14),
                       #   pm-daily-scan, pm-plan-reminder, shipping-phase-scan,
                       #   downtime-open-scan (DR cron 5 นาที — เปิดค้างเกินเกณฑ์), cleanup-orphan-photos
                       # หน้า Login แยก error "ไม่พบบัญชี" vs "รหัสผิด" ผ่าน RPC login_email_exists
                       #   (anon เรียกได้ — enumeration trade-off ที่ตั้งใจ ดู migration 20260714)

docs/                  # UI-CONVENTIONS.md (บังคับอ่านก่อนแก้ UI) · PERMISSIONS-DESIGN.md ·
                       #   ROLLBACK_*.md · sql/ (schema snapshot + seed อ้างอิง)
```

---

## Patterns & Utilities

### Toast (Singleton)
```js
import { toast } from '../components/Toast'
toast.success('บันทึกสำเร็จ')
toast.error('เกิดข้อผิดพลาด')
toast.info('กำลังโหลด...')
```

### UserContext
```js
const { role, lineId, team, section, sections, fullName } = useContext(UserContext)
// sections = ขอบเขตส่วนงานผลลัพธ์สุดท้าย (array, [] = ไม่จำกัด) — ดู "Section/Line/Team Scoping"
```

### Date/Time Utilities

> ⚠️ **กฎสำคัญ — ห้ามใช้ `new Date().toISOString()` เพื่อหาวันที่งาน**  
> `toISOString()` คืนค่า UTC ซึ่งต่างจากเวลาไทย (UTC+7) ทำให้วันที่คลาดเคลื่อน  
> ให้ใช้ฟังก์ชันด้านล่างเท่านั้น และต้องใช้เหมือนกันทุกหน้า

```js
// ✅ ใช้ทุกครั้งที่ต้องการ work_date สำหรับ query DB
getWorkDate()
// → คืน "YYYY-MM-DD" แบบ local time
// → ถ้าเวลาปัจจุบัน < 08:00 ให้นับเป็นวันก่อนหน้า (งานกะดึกข้ามวัน)

// ✅ ใช้ detect กะปัจจุบัน
getCurrentShift()
// → "day"   เมื่อ 08:00–19:59
// → "night" เมื่อ 20:00–07:59

// ✅ ใช้แสดงผลเวลา (ไม่ใช่สำหรับ query)
new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })

// ❌ ห้ามใช้เพื่อหาวันที่งาน
new Date().toISOString()          // UTC — ผิดสำหรับไทย
new Date().toISOString().slice(0,10)  // อาจได้วันที่ผิด
```

```js
getShiftInfo()  // object { shift, label } — กะเช้า 08:00-20:00 / กะดึก 20:00-08:00
```

> ⚠️ **กฎวันทำงาน (คำสั่ง user 2026-07-21): ทุกการคำนวณที่เกี่ยวกับ "วันทำงาน" ต้องอ้างอิงปฏิทินบริษัทก่อน ห้ามใช้ค่าคงที่ (22/26 วัน)** — ใช้ helper กลาง `countWorkingDaysInMonth(monthKey, fallback)` ใน `src/utils/companyCalendar.js` (เรียก `loadCompanyCalendar()` ก่อน) หรือ logic เดียวกัน: จ-ศ ไม่มาร์ค = ทำงาน · มาร์คเป็นวันหยุดทุกชนิด (ot15/ot2/shutdown75) = หยุด · เสาร์/อาทิตย์มาร์ค working = ทำงาน · จุดที่ใช้แล้ว: kanban calc (PlannerSales), Production Plan รายวัน+รายเดือน, PM Forecast, LPA — บั๊กที่เคยเจอ: regex เทียบ day_type ไม่ match ค่าจริง (kanban นับวันหยุด จ-ศ เป็นวันทำงาน) และนับเฉพาะวันที่มาร์ค working ชัดๆ (แผนรายเดือนได้ 4-5 วัน/เดือน) — แก้แล้วทั้งคู่ 2026-07-21

> **ฝั่ง SQL (DR project)** มี helper กลาง `work_date_bangkok()` (migration `20260714_work_date_bangkok_fallback.sql`)
> = work date ไทยตัด 08:00 — trigger/function/default ใหม่ฝั่ง DR ที่ต้องการวันที่งาน **ให้ใช้ตัวนี้
> ห้ามใช้ `current_date`** (คือ UTC — เพี้ยนช่วง 07:00-07:59 ไทย เคยเป็นบั๊กใน fn_post_confirmed_output)

### Skill Fit Scoring
```js
computeFit(employee, station)  // % ของทักษะที่ผ่าน min_score
fitColor(score)   // 80+ green | 60-79 amber | 40-59 orange | <40 red
```

---

## กฎการทำงานของทุก AI session (Workflow Discipline)

ลำดับที่ต้องทำทุกครั้ง ไม่ว่าจะแก้อะไร:
1. **เช็คกฎก่อนลงมือ** — อ่าน section ที่เกี่ยวข้องใน CLAUDE.md นี้ + เอกสารเฉพาะทาง:
   - แก้ UI → `docs/UI-CONVENTIONS.md` (บังคับ)
   - แตะสิทธิ์/role → `docs/PERMISSIONS-DESIGN.md`
   - แตะ DB → section "Supabase Projects" (2 projects!) + เขียน migration ลง `supabase/migrations/` เสมอ
2. **ทำงานให้สอดคล้องกับกฎ** — ถ้าสิ่งที่จะทำขัดกับ convention เดิม ให้ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยน (แล้วต้องไล่แก้ทุกจุดที่ใช้ pattern นั้นให้ตรงกัน)
3. **อัพเดทกฎหลังทำ** — งานที่สร้าง/เปลี่ยน pattern, schema, สิทธิ์, หรือ workflow ที่ session อื่นต้องรู้ → อัพเดทเอกสารที่เกี่ยวข้อง (CLAUDE.md / UI-CONVENTIONS.md / PERMISSIONS-DESIGN.md) **ในคอมมิทเดียวกัน** พร้อมวันที่
4. build ผ่าน (`npm run build`) ก่อน commit เสมอ · merge เข้า `main` = deploy จริง

### QC Agent — ตรวจโค้ดขัดกฎโปรเจค (2026-07-10)

- **Agent:** `.claude/agents/qc-project-rules.md` (subagent_type: `qc-project-rules`, read-only — ห้ามแก้โค้ด)
  มี checklist กฎ 7 หมวด: A Date/Time · B Supabase 2 projects · C Permissions · D Section scoping ·
  E Storage/รูป · F UI Conventions · G Workflow/เอกสาร — แต่ละข้อ map กลับมาที่ CLAUDE.md /
  docs/UI-CONVENTIONS.md / docs/PERMISSIONS-DESIGN.md (checklist เป็นแค่แผนที่ ตัว agent ต้องอ่านเอกสารจริงก่อนตรวจเสมอ)
- **Slash command:** `/qc-audit` (`.claude/commands/qc-audit.md`) — ไม่มี argument = ตรวจทุกหมวดทั้งโปรเจค
  (fan-out 4 subagents ขนาน), ระบุหมวด (`/qc-audit B D`) หรือไฟล์ (`/qc-audit src/pages/X.jsx`) ได้
- รายงานแบ่ง 🔴 ขัดกฎเหล็ก / 🟡 ขัด convention / 🔵 legacy-ข้อสังเกต / ✅ ผ่าน พร้อม file:line + วิธีแก้
- **เมื่อเพิ่ม/เปลี่ยนกฎใน CLAUDE.md หรือ docs/** ที่ตรวจอัตโนมัติได้ → อัพเดท checklist ใน
  `.claude/agents/qc-project-rules.md` ในคอมมิทเดียวกันด้วย ไม่งั้น QC agent จะตรวจไม่ครบ
- แนะนำรัน `/qc-audit` ก่อน merge งานใหญ่เข้า main และรันเต็มเป็นระยะเพื่อจับ drift ระหว่าง session ขนาน

## Design System

> ### ⚠️ บังคับอ่านก่อนแก้ UI ทุกครั้ง: `docs/UI-CONVENTIONS.md`
> มาตรฐานกลางของ UI ที่หลาย session ต้องทำให้เหมือนกัน — จุด/marker บนผังไลน์ (**วงกลม+ป้ายใต้เท่านั้น ห้ามเหลี่ยม** สูตรขนาด MK สเกลตามผัง + edge clamp), ไฟ Andon เขียว/เหลือง/แดง (**กระพริบเฉพาะแดง** เหลือง=นิ่ง), การ์ดสูงเท่ากันใน grid, ฟอนต์ขั้นต่ำ 11-12px (จอ TV), modal ผังต้อง fit จอเดียวไม่มี scroll, hover ใช้ได้เฉพาะอุปกรณ์มีเมาส์จริง, playhead ไทม์ไลน์ใช้ `.now-line`/`.now-chip`, สิทธิ์ action ผ่าน `can()` ห้าม hardcode role array เพิ่ม
> **ถ้าสร้าง/เปลี่ยน pattern ที่ใช้หลายหน้า ต้องอัพเดท docs/UI-CONVENTIONS.md (พร้อมวันที่) ในคอมมิทเดียวกัน**


### CSS Variables
```css
--bg, --bg2, --bg3      /* พื้นหลัง 3 ระดับ */
--card                  /* Card background */
--border, --border2
--accent                /* สีหลัก (green) */
--accent2               /* สีรอง (amber) */
--text, --text2, --muted
--sidebar-w: 252px
--radius-lg: 8px
```

### ⚠️ กับดัก CSS ที่เจอซ้ำหลายจุด — จำไว้

- **`index.css` ตั้ง `input, select, textarea { width: 100% }` เป็น default ทั้งแอป** — input ที่วางใน toolbar/แถบควบคุมแนวนอน (เช่น `<input type="date">` ข้างปุ่ม ◀ ▶) **ต้องกำหนด `width` เองเสมอ** (เช่น `width: 140`) ไม่งั้นมันจะกินเต็มความกว้าง container แล้วดันปุ่มรอบๆ แตกเป็นหลายบรรทัดทั้งที่พื้นที่เหลือ — เคยกัดมาแล้วที่หัวบอร์ด Heijunka ทั้งหน้า Dashboard และหน้าจัดการไลน์ · checkbox/radio เคยโดนยืดจนบีบ label ข้างๆ หายทั้งแถบ (หน้า Daily PM) — ตอนนี้มี rule ยกเว้น `input[type="checkbox"], input[type="radio"] { width: auto }` ใน index.css แล้ว แต่ input ชนิดอื่นใน flex row ยังต้องระวังเอง
- UI ที่ตั้งใจให้ดูจากระยะไกล (จอ TV/บอร์ดหน้างาน) อย่าใช้ font 8–9px ทั้งที่พื้นที่แนวนอนเหลือ — เกิดคำถาม "ตัวหนังสือเล็ก พื้นที่ว่างเหลือเยอะ" ซ้ำหลายรอบ ให้เริ่มที่ 11–12px สำหรับชิป/ป้าย และ 14–15px สำหรับหัวข้อ

### Breakpoints
| ชื่อ | ขนาด |
|------|------|
| Mobile | < 768px |
| Tablet | 768–1279px |
| Desktop | 1280–1599px |
| Ultra-wide | ≥ 1600px |

### Fonts: Sarabun (Thai body), Tahoma (display)

---

## Shift Logic

| กะ | เวลา | OT |
|----|------|-----|
| กะเช้า (Day) | 08:00–17:30 | 17:30–20:00 |
| กะดึก (Night) | 20:00–07:59 | 20:00–22:30 |
| Extended OT | 20:00–23:00 | กะเช้าพิเศษ |

- **Team A/B** — หมุนกะสลับกัน
- **Team C** — กะเช้าตลอด ไม่หมุน
- **Work date:** ก่อน 08:00 = นับเป็นวันก่อนหน้า

### OT วันหยุด (2026-07-10)

ตาราง OT ด้านบนใช้เฉพาะ**วันทำงานปกติ** — วันหยุด (`company_calendar.day_type != 'working'`) การมาทำ OT คือมาทั้งกะ มี 4 รูปแบบ:

| รูปแบบ | เวลา | ค่าใน `ot_night_bookings.ot_period` |
|---|---|---|
| เช้า 8 ชม. | 08:00–17:00 | `holiday_day_8h` |
| เช้า 10 ชม. | 08:00–20:00 | `holiday_day_10h` |
| ดึก 10 ชม. | 20:00–08:00 | `holiday_night_10h` |
| ดึก 8 ชม. | 22:00–08:00 | `holiday_night_8h` |

- source of truth เดียว: `src/utils/otPeriods.js` (label/ตัวเลือกตามกะ/ค่า default) — ห้าม hardcode ช่วงเวลาซ้ำในหน้า
- `ot_period = null` = OT ต่อท้ายกะวันทำงานปกติ (และการจองเก่าก่อนมีฟีเจอร์นี้ — Report แสดง "⚠️ ไม่ระบุ" เมื่อวันนั้นเป็นวันหยุด)
- จุดจองทุกทางในหน้าเช็คชื่อ (กะดึกจองพรุ่งนี้ / has_ot กะเช้า / ช่องวันหยุดล่วงหน้า 🔶 / modal จองรถ OT อิสระ) จะโชว์ select ช่วงเวลาอัตโนมัติเมื่อวันที่จองเป็นวันหยุด — default 8 ชม. ของกะนั้น
- migration: `20260710_ot_booking_holiday_period.sql` (Main project)

**วันหยุดจ่าย 75% — มาตรา 75 (2026-07-21):** `company_calendar.day_type = 'shutdown75'` (สีม่วง ตั้งจากปฏิทินบริษัท — เพิ่มรายวัน ไม่มีใน bulk รายสัปดาห์) = หยุดชั่วคราวเหตุลูกค้าลด order: หยุดได้ค่าจ้าง 75% · ถูกเรียกมาทำงาน = ค่าแรงปกติ · **ระบบเก็บเป็นข้อมูลอ้างอิง ยังไม่คำนวณเงิน** · ความหมาย "วันหยุด" แยก 2 ชั้น: (ก) วันหยุดโรงงาน (working-day calc: kanban/LPA/แผนงาน — เช็ค `!= 'working'`) shutdown75 นับเป็นหยุด (ข) **วันหยุดแบบ OT** (จองรถ OT/ชม. OT 8-10 ชม.) ใช้ helper `isOtHolidayType()`/`isOtHoliday()` ใน `companyCalendar.js` = **ot15/ot2 เท่านั้น** — โค้ดใหม่ที่เช็ควันหยุดต้องเลือก helper ให้ตรงความหมาย ห้ามเช็ค `!= 'working'` แบบเหมา · migration `20260721_calendar_shutdown75.sql`

---

## Deploy

```
Platform:    Render.com (Static Site)
Build cmd:   npm run build
Output dir:  ./dist
Branch:      main
Dev:         npm run dev

Environment Variables:
  VITE_SUPABASE_URL=https://ewhdfqwfwofivojtsizn.supabase.co
  VITE_SUPABASE_ANON_KEY=<key from Supabase dashboard>
```

> ⚠️ **กับดักหลัง deploy — จอดำในแท็บที่เปิดค้าง (แก้แล้ว 2026-07-10):** ทุกหน้าเป็น lazy chunk ชื่อไฟล์มี hash
> deploy ใหม่ = ไฟล์เก่าหายจาก server → แท็บเก่าเปลี่ยนหน้าแล้วโหลด chunk พัง → React ล่มเป็นจอดำเงียบๆ
> `src/main.jsx` มีตัวจัดการแล้ว: `vite:preloadError` → auto reload 1 ครั้ง (กัน loop 30 วิ) + `RootErrorBoundary`
> แสดงหน้า "โหลดหน้าใหม่" แทนจอดำ — **ห้ามถอดออก** และ error อื่นที่ไม่ใช่ chunk จะโชว์ข้อความ error ให้ debug ได้
>
> ⚠️ **กับดักที่สอง — แท็บใหม่ (ctrl+click) ได้เวอร์ชันเก่าจาก browser cache (แก้แล้ว 2026-07-12):**
> เบราว์เซอร์ cache index.html แบบเดา (heuristic) ได้ถ้า server ไม่ส่ง Cache-Control → แท็บใหม่บูตแอปเวอร์ชันเก่า
> คลิกอะไรก็เงียบ · แก้ 2 ชั้น **ห้ามถอดทั้งคู่**: (1) **version guard** ใน `src/main.jsx` เทียบ `__BUILD_ID__`
> (จาก `vite.config.js` define + emit `dist/version.json`) กับ `/version.json` (no-store) ตอนเปิด+กลับมาโฟกัสแท็บ
> ไม่ตรง = reload อัตโนมัติ · (2) `render.yaml` ตั้ง header: `/*` = no-cache, `/assets/*` = immutable
> (ถ้า service ไม่ได้สร้างจาก Blueprint ต้องตั้ง 2 rules นี้เองใน Render dashboard → Redirects/Headers)
>
> ⚠️ **กับดักที่สาม — เปิดหลายแท็บแล้วบางแท็บหลุด login เงียบๆ เป็น "หน้าผี" (แก้แล้ว 2026-07-14):**
> เดิม auth ฝั่ง Main เก็บใน `sessionStorage` (แยกต่อแท็บ) → หลายแท็บถือ refresh token คนละก๊อปปี้
> พอ token หมุน แท็บที่ถือของเก่าโดนปฏิเสธ → query ฝั่ง Main ล้มหมดแต่ฝั่ง DR (anon) ยังขึ้น
> (อาการชี้ตัว: เลขไลน์/downtime ขึ้น แต่เช็คชื่อ/4M เป็น 0 + ชิปเมนูและป้าย role หาย)
> แก้: `supabaseClient.js` ใช้ localStorage (default — **ห้ามเปลี่ยนกลับ**, ความปลอดภัยเครื่องส่วนกลาง
> มี auto-logout idle 30 นาทีคุมแทน) + `fetchProfile` ใน App.jsx เป็น fail-visible: token เสีย/user
> ถูกลบ → signOut ไปหน้า login, network สะดุด → ค้าง "กำลังโหลด..." (ไม่ signOut — localStorage
> แชร์ข้ามแท็บ เดี๋ยวพาแท็บดีๆ หลุดตาม) · หมายเหตุ test harness: seed token ต้องลง localStorage แล้ว

---

## Branch & Deploy Workflow

- **Main branch:** `main`
- **Development branch:** เปลี่ยนชื่อทุก session (Claude Code on the web สุ่มชื่อให้ใหม่) — เช็คชื่อจริงจาก `git branch --show-current` หรือคำสั่งของ user ในแต่ละ session อย่าอ้างอิงชื่อ branch เก่าจาก session ก่อนหน้า
- **ไม่มี staging/test environment แยก** — "merge เข้า main" คือขั้นตอนทดสอบของ user เอง ถ้าพังจะสั่ง rollback เอง ดังนั้น: build ผ่าน (`npm run build`) แล้ว merge เข้า main ได้เลย ไม่ต้องรอ "ทดสอบก่อน" เพิ่ม
- **Auto-merge เข้า main — ไม่ต้องถาม user ก่อน** (คำสั่ง user 2026-07-10) เมื่อครบ **3 เงื่อนไขบังคับ**:
  1. **Build ผ่าน** (`npm run build`)
  2. **เช็คแล้วว่าไม่กระทบส่วนอื่น** — ไล่ดูทุกจุดที่พึ่งพาสิ่งที่แก้ (ตาราง/view/trigger/หน้า/utility ร่วม, ทั้ง main + DR project) และพิสูจน์ว่าพฤติกรรมเดิมไม่เปลี่ยน (เช่น snapshot/hash เทียบก่อน-หลังสำหรับ DB, grep ผู้ใช้งานร่วมสำหรับโค้ด)
  3. **เตรียม rollback ไว้** — ก่อน merge บันทึก SHA ของ `origin/main` ปัจจุบัน (= จุด rollback) แล้วรายงานให้ user พร้อมวิธีย้อน: `git revert -m 1 <merge-sha>` (ปลอดภัยสุด) หรือ `git reset --hard <old-sha> && git push --force-with-lease`; ถ้ามี DB migration ให้ระบุลำดับ revert ที่ปลอดภัย (revert โค้ดก่อน แล้วค่อยแตะ schema — ดูตัวอย่าง `docs/ROLLBACK_*.md`) และ migration ต้องเขียนแบบ backward-compatible (คอลัมน์ใหม่มี default, view เปลี่ยนแบบ `create or replace`) เพื่อให้ย้อนได้ไม่พังของเดิม
  - **ข้อยกเว้น (ต้องหยุดถามก่อน merge):** ถ้าเงื่อนไข 2 ไม่ผ่าน/ไม่แน่ใจว่ากระทบส่วนอื่น, หรือเป็นการเปลี่ยน schema/RLS/พฤติกรรมที่ย้อนยาก, หรือเป็น product decision ที่ตีความได้หลายแบบ → หยุดถาม user ก่อน อย่า auto-merge
- ถ้า development branch ที่กำหนดมา merge เข้า main ไปแล้ว (ไม่มี commit ใหม่ค้าง) ให้ restart จาก main ล่าสุด: `git checkout -B <branch> origin/main` ก่อนทำงานต่อ ห้าม stack งานใหม่บน history ที่ merge ไปแล้ว
- **ห้ามแก้ RLS policy หรือ schema migration แบบ blanket** (เช่น loop เปลี่ยน policy หลายตารางพร้อมกัน) โดยไม่เข้าใจว่าตารางนั้นอยู่ project ไหนและ client ฝั่งไหนอ่าน — ดู "Supabase Projects" ด้านบน เคยทำพังมาแล้วครั้งหนึ่งกับฝั่ง DR project
- เปลี่ยน DB schema ทุกครั้ง ให้เขียนเป็น migration file ใน `supabase/migrations/` เพื่อให้ session อื่นเห็นประวัติ ไม่ใช่แก้ตรงผ่าน MCP เฉยๆ

---

## Reusable สำหรับโปรเจคถัดไป (PM Checker)

| สิ่งที่มี | นำไปใช้ได้เลย |
|---------|-------------|
| Supabase Auth + Profiles + Roles | ✅ ใช้ระบบ Auth เดิม |
| Toast.jsx | ✅ Copy ไปใช้ |
| Telegram Bot notification | ✅ Copy Edge Function + ตั้ง Secrets ใหม่ |
| In-app notification bell | ✅ ใช้กับ notifications table เดิม |
| 4M Approval workflow | ✅ ดัดแปลงเป็น PM approval flow |
| SignatureModal.jsx | ✅ ลายเซ็นยืนยันงาน PM |
| CSV export | ✅ Report ประวัติ PM |
| Dark/Light theme | ✅ Copy index.css variables |
| Recharts | ✅ แสดงสถิติ PM |
