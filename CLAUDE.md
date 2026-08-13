# ESM — Enterprise Shopfloor Management · Project Knowledge Base

ระบบบริหารจัดการโรงงานครบวงจร สำหรับ **Thai Summit Group**  
ครอบคลุม 4M Change Management, CQI-15 Welding Event Log, การเช็คชื่อ-PPE รายวัน, Daily Production Report, Employee Skills Matrix, Shift Management และ Approval Workflow

> ชื่อเดิม: 4M Management System (ยกระดับเป็น Enterprise Shopfloor Management)

---

## ⚠️ กฎการทำงานทุก session — เช็คกฎก่อน, แก้แล้วอัพเดทกฎ (คำสั่งถาวรจาก user 2026-07-09)

**ก่อนลงมือทำงานใดๆ:**
0. **อ่าน `docs/ENGINEERING-PRINCIPLES.md`** — หลักการแก้ไข/ต่อยอดอย่างยั่งยืน (คิดเผื่ออนาคต ไม่แก้ฉาบฉวย): single source of truth · data-driven ก่อน hardcode · backward-compatible migration · ห้ามล้มเหลวเงียบ · blast radius + rollback · checklist ก่อน commit/merge — **ใช้กับทุกงานไม่ว่าเล็กหรือใหญ่**
1. อ่านไฟล์นี้ (CLAUDE.md) ให้จบก่อนเสมอ — โดยเฉพาะกฎเหล็ก supabaseDR, Date/Time utilities, Organizational Hierarchy
2. ถ้างานแตะ UI → **ต้องอ่าน `docs/UI-CONVENTIONS.md` ก่อน** และทำตามอย่างเคร่งครัด (marker วงกลม+MK+clamp, Andon, ฟอนต์ขั้นต่ำ 11-12px, can() ฯลฯ)
   - **หน้าใหม่/แก้หัวหน้าเพจ → ต้องใช้ `PageHeader` + `useTabParam` ห้ามวาดหัวเรื่อง/แถบแท็บเอง** (UI-CONVENTIONS §6.8)
3. ถ้า convention ขัดกับสิ่งที่กำลังจะทำ → ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยนชัดเจน
4. มีหลาย session ทำงานขนานกัน — `git pull origin main` ก่อนเริ่ม และเช็คว่างานที่จะทำ session อื่นทำไปแล้วหรือยัง

**หลังแก้/เพิ่มอะไรก็ตาม — อัพเดทกฎในคอมมิทเดียวกัน:**
- สร้าง/เปลี่ยน pattern ที่ใช้ร่วมกันหลายหน้า → อัพเดท `docs/UI-CONVENTIONS.md` (พร้อมวันที่)
- เปลี่ยน schema / ตาราง / Edge Function / workflow / กฎธุรกิจ → อัพเดท CLAUDE.md ส่วนที่เกี่ยวข้อง
- เจอกับดัก/บั๊กที่คนถัดไปน่าจะเจอซ้ำ → บันทึกไว้ใน CLAUDE.md (เช่นส่วน "กับดัก CSS")
- เปลี่ยน DB schema → เขียน migration file ใน `supabase/migrations/` เสมอ
- **เอกสาร export ใหม่ทุกตัว (ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน — ไม่มีข้อยกเว้น) → ต้อง register เข้าระบบทะเบียนเอกสาร `/doc-forms` (Document Master)** ให้ doc_control ปรับแต่งได้เอง (เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer/โลโก้/Legend/ผู้ออกเอกสาร/Revision History) โดยไม่ต้องแก้โค้ด — ขั้นตอนบังคับ: (1) seed แถวใน `doc_forms` (migration — เอกสารที่ยังไม่มีเลขฟอร์มทางการก็ seed ด้วย form_code=null ไว้ก่อน) (2) ฟังก์ชันพิมพ์อ่านค่าผ่าน `src/utils/docForms.js` (`getDocForm`/`docFormSync`/`fullCode`/`getDocFormRevisions` + fallback ค่าเดิมในโค้ดเสมอ) — ฟอร์มทางการวาดหัว/footer เอง · **รายงานภายในที่ไม่มี layout ฟอร์ม อย่างน้อยห่อ html ก่อนพิมพ์ด้วย `withDocFoot(html, doc_key)`** (ทะเบียนยังไม่ตั้งเลขฟอร์ม = หน้าตาเดิมเป๊ะ ตั้งเมื่อไหร่แถบเลขฟอร์มโผล่เอง) (3) โลโก้ผ่าน `urlToDataUrl(docFormSync(key).logo_url || tsLogoUrl)` **ห้าม hardcode เลขฟอร์ม/Rev/โลโก้ในโค้ด และห้ามสร้างตารางทะเบียนเอกสารแยกใหม่** (เคยมี `document_controls` ซ้อน — ยุบเข้าทะเบียนกลางแล้ว 2026-07-30 · ดูรายละเอียดแถว `/doc-forms` ใน Pages & Routes + `docs/UI-CONVENTIONS.md` §6.6)
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
| `production_lines` | ไลน์ผลิต | id, name, section, parent_line_name, std_day_shift, std_night_shift (**กำลังคน — อ่านผ่าน `src/utils/stdManpower.js` เท่านั้น ดูกฎด้านล่าง**), **line_type** (ประเภทไลน์: stamping/hydroform/laser/welding_assembly/other — source of truth `src/utils/lineTypes.js` · ตั้งค่าที่ LineSetup แผง "ข้อมูลเฉพาะไลน์นี้" · **คนละตัวกับ `process_type`** ฝั่ง DR (dr_products/machines) ที่ใช้กรอง downtime/defect types · migration `20260722_production_lines_line_type.sql` **apply แล้ว 2026-08-05** — ค้างมา 2 สัปดาห์ ระหว่างนั้นช่องนี้เซฟไม่ติดเงียบๆ + ลาก flow_mode ปิดตามไปด้วย · `20260805_..._fix_laser.sql` แก้ backfill ที่ตีไลน์เลเซอร์ใต้กลุ่ม HYDROFORM เป็น hydroform ผิด — **กฎ: ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ** · ⚠️ ยังไม่มีหน้าไหนอ่าน line_type เลย เป็น master ที่ตั้งไว้รอใช้) |
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
| `lpa_questions` | คำถาม checklist (seed 23 ข้อมาตรฐาน) — **โมเดลรายไลน์ (2026-07-23):** `line_name` null = **common ฐาน backfall ทุกไลน์** · `line_name`=ไลน์ = ข้อเฉพาะไลน์นั้น · **`hidden_for_lines[]`** = ไลน์ที่ "ไม่ใช้" ข้อ common นั้น (ซ่อนรายไลน์) → แต่ละไลน์ = common − ข้อที่ซ่อน + ข้อเฉพาะไลน์ · category `special` = ข้อเฝ้าระวังปัญหา (สีแดง) ผูกไลน์+ช่วง issue_start/end | category (safety/quality/systemic/visual/special), seq, question, line_name, **hidden_for_lines[]**, issue_start/end, is_active |
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
| ภาพรวม | `/dept-dashboard` | **DeptDashboard — 📋 Dashboard ส่วนงาน** หน้าเดียวสลับส่วนงานด้วย `?dept=production\|maintenance\|store\|qa` · **เลย์เอาต์ 4 ชั้นเหมือนกันทุกใบ** (🚨 ต้องทำตอนนี้ → 📊 KPI → 📈 ชี้เป้าให้แก้ → 🔗 ทางลัด) · **อ่านอย่างเดียว** ทุก action = ลิงก์ไปหน้าที่ทำงานจริง · เพิ่มส่วนงานใหม่ = เพิ่ม entry ใน `DEPTS` (loader + View) **ห้ามสร้างหน้า dashboard แยกต่อส่วนงาน** · ดู section "Dashboard ส่วนงาน" + `docs/DASHBOARD-DESIGN.md` | ทุก role (ข้อมูลกรองตาม scope) |
| ภาพรวม | `/group-overview` | **GroupOverview — 🏢 ภาพรวมกลุ่มบริษัท TSG (MOCKUP หลายบริษัท)** ตัวอย่างหน้าจอตอบโจทย์ผู้บริหาร "ระบบดูหลายบริษัทในกลุ่มพร้อมกันได้มั้ย" — **แผนที่ภาคกลาง+ตะวันออก (โซนบางนา/โซนตะวันออก)** + drill-down 2 แกน `TSG → โซน\|กลุ่มธุรกิจ → บริษัท → ไลน์` · **TSAT4 = ข้อมูลจริง** ที่เหลือ **จำลอง** จากข้อมูลชุดเดียวกัน (ดู section "Group Overview") | admin/manager (seed) |
| ฝ่ายผลิต | `/morning-meeting` | MorningMeeting — ประชุมแถวเช้า (ดู section "Morning Meeting") | ทุก role (record: admin/mgr/sv/leader) |
| ฝ่ายผลิต | `/checkin` | Checkin | ทุก role |
| ฝ่ายผลิต | `/management` | Management | ทุก role |
| ฝ่ายผลิต | `/daily-report` | DailyReport | ทุก role |
| ฝ่ายผลิต | `/production-plan` | ProductionPlan — วางแผนการผลิต (active planner ดู section "Production Plan") | admin/manager/supervisor/leader/planner_store/sale |
| วิเคราะห์ & รายงาน | `/oee-analytics` | OEEAnalytics · **ปุ่ม 📽️ รายงานเดือน (2026-07-30): generate เด็ค Monthly Performance Review เป็นไฟล์ `.pptx` ตาม template TSG** (Tahoma · เขียว 0D3D14 + ส้ม C0561E) จากข้อมูลกะปิดแล้วของเดือนที่เลือก — Executive Summary → OEE/A/P/Q รายส่วน/ไลน์ → Top Downtime + การแก้ไข (ผูก `mtn_orders.solution` ผ่าน source_downtime_id) → Next-month Focus พร้อม story rule-based · `src/lib/monthlyReviewPptx.js` (builder — **pptxgenjs dynamic import เป็น lazy chunk ห้าม import แบบ static**) + `src/components/MonthlyReviewExport.jsx` (modal เลือกเดือน/ส่วนงาน scope ตาม sections) · สิทธิ์ `oee:export_review` (admin/mgr/sv) · doc_key `monthly_review` ใน doc_forms · migration `20260730_monthly_review_pptx.sql` · output นับ pair-aware + carry_over ตามกฎ · DT นับเฉพาะนอกแผน | ทุก role |
| ฝ่ายผลิต | `/daily-checker` | **DailyChecker** — 🗂️ ศูนย์รวมระบบเช็ครายวัน (แท็บ: 🔧 Autonomous Maintenance (AM) [=Daily PM ฝ่ายผลิต เดิม · เปลี่ยนชื่อแสดงผลให้ตรงศัพท์ TPM 2026-07-23 · department ยังเป็น `production`] / 🛡️ Poka-Yoke Check [`/pokayoke` — TPM daily poka-yoke verification ด้วยชิ้น master NG · ตาราง `pokayoke_devices`+`pokayoke_checks` Main · สิทธิ์ `pokayoke:record`/`pokayoke:manage` · migration `20260723_pokayoke_check.sql`] / 📋 LPA / +ระบบเช็คอื่นในอนาคต) · embed component หน้าเดิมทั้งดุ้น (`DailyPM`/`LayerProcessAudit`) · แท็บโผล่ตามสิทธิ์หน้าย่อย · **สิทธิ์เข้าหน้า piggyback** `page:/daily-pm`‖`page:/lpa` (canAccessPage special-case ใน permissions.js — ไม่ต้อง seed permission ใหม่) · เพิ่มระบบเช็คใหม่ = เพิ่ม entry ใน `TABS` (DailyChecker.jsx) · `?tab=pm\|lpa` deep-link (2026-07-23) | ทุก role (ตามแท็บ) |
| (ไม่อยู่ใน sidebar) | `/daily-pm` | DailyPM — ยังเป็น route แยก (เป็นแท็บใน Daily Checker + deep-link) | ทุก role |
| ฝ่ายผลิต | `/improvements` | Improvements (Kaizen — ดู section "Improvements") | ทุก role (manage: admin/mgr/sv/leader) |
| (ไม่อยู่ใน sidebar) | `/lpa` | LayerProcessAudit — LPA paperless (แท็บใน Daily Checker + deep-link · ดู section "Layer Process Audit") | ทุก role (record: mgr/sv/leader/engineer/qa · manage: mgr/sv · delete: mgr) |
| Logistic - Store | `/line-stock` | LineStock | ทุก role |
| Logistic - Store | `/heijunka` | HeijunkaKanban | ทุก role |
| Logistic - Store | `/rack-center` | RackCenter · **QR เรียกภาชนะ (2026-08-03):** deep-link `?line=&ctype=&qty=` → เปิดฟอร์มกรอกครบ เหลือกดยืนยัน · ปุ่ม 🏷️ ป้าย QR (พิมพ์แผ่น A4 ไลน์×ชนิดภาชนะ — lazy import `qrcode` · doc_key `rack_qr_labels` ผ่าน withDocFoot, migration `20260803_doc_form_rack_qr_labels.sql` Main) · ปุ่ม 📷 สแกน (BarcodeDetector ในแอป + ช่องปืนยิง keyboard-wedge — parse URL ตัวเดียวกัน) · กล้องมือถือสแกนตรงก็ได้ (เปิดลิงก์) | ทุก role |
| Logistic - Store | `/planner-sales` | PlannerSales | manager/supervisor/leader/qa/sale/planner_store |
| Logistic - Store | `/rundown-stock` | RundownStock | manager/supervisor/leader/qa/sale/planner_store |
| Logistic - Store | `/customer-demand` | CustomerDemand (Delivery) | manager/supervisor/leader/qa/sale/planner_store |
| Logistic - Store | `/store-monitor` | **StoreMonitor — 🚨 เฝ้าระวังสต๊อก & รอบส่ง (Abnormality Monitor)**: read-only monitor ถอดจาก 17 เคส TEI-TEI (Toyota TPS) → เฟส 1 จับ 5 เคสที่ detect ได้จริงจากข้อมูลปัจจุบัน สรุปเป็นผล 🟥 Shortage / 🟧 Over stock แบบ andon (แดงกระพริบเฉพาะรุนแรง เหลืองนิ่ง) · เคส: #A on-hand<Min · #B on-hand>Max (เทียบ `kanban_standards`) · #C รอบส่งเลยเวลายังไม่ยืนยัน (`kanban_delivery_rounds`/`kanban_deliveries`) · #D รับไม่ครบ partial · #E `purchase_requests` สั่งซื้อค้างเกินวันกำหนด · **scope ตาม pattern มาตรฐานแล้ว** (leader = family ไลน์ตัวเอง · role อื่นตาม sections · admin/ไม่มี scope = ทั้งโรงงาน — กรองที่ `scoped` ครอบทั้งลิสต์/ตัวนับ/dropdown ไลน์ · QC audit 2026-08-03 เดิมเขียน `lineSection` ค้างไว้ไม่ได้ใช้ = เห็นทุกไลน์) · ฟิลเตอร์ไลน์/ชนิด · refresh 60s · **ไม่แตะ write-path ของ store** · เคส ผิดกล่อง/pattern/pallet ต้องมี kanban-scan ก่อน = เฟสถัดไป · migration `20260721_store_monitor_permission.sql` | ทุก role (read-only) |
| Logistic - Store | `/transport` | **Transport — 🚚 มอบหมายขนส่ง (Teiki-bin เฟส 1 ก้อน ก)**: มอบหมาย carrier (คนขับ/ผู้ขน) + สกิลยานพาหนะ ให้ "รอบส่ง" ที่มีอยู่ (`kanban_delivery_rounds`) รายวัน — **ต่อยอดบนรอบเดิม ไม่สร้างคิว/บอร์ดใหม่ ไม่คำนวณ demand ซ้ำ** · ตาราง DR (anon): `transport_vehicles` (master ยานพาหนะ data-driven: handlift/tow/forklift/cart/amr) · `transport_carriers` (name/emp_code/shift/vehicles[]/section/is_active) · `transport_round_assignments` (work_date+round_id unique → carrier) · แท็บ: 🗓️ มอบหมายวันนี้ (dropdown carrier ต่อรอบ กรองตามกะ · สถานะรอบจาก `getRoundStatus` util) + 👷 คนขับ/ยานพาหนะ (CRUD carrier) · สิทธิ์: ดู = ทุก role · `transport:manage` = admin/mgr/sv/leader/planner_store · migration `20260721_transport_carriers.sql` (DR) + `20260721_transport_page_permission.sql` (Main) · **Load รอบส่ง (2026-08-03):** `transport_vehicles.capacity_pkg` (กล่อง/เที่ยว — ตั้งใน route tab ช่อง "จุ") + Heijunka ⏰ รอบจัดส่งวันนี้ โชว์ "N กล่อง ÷ จุ C = M เที่ยว" ต่อรอบ (1 การ์ด kanban = 1 กล่อง · รถ = ของคนขับที่มอบหมายรอบนั้น ไม่มีมอบหมาย = คันจุมากสุด + หมายเหตุ · >1 เที่ยว = ส้ม) — migration `20260803_transport_vehicle_capacity.sql` (DR · **apply แล้ว** — ตรวจคอลัมน์จริง 2026-08-10) · **route tab (2026-08-03):** ปุ่ม ✨ เรียงจุดจอดสั้นสุด (`bestStopOrder` TSP ใน transportGraph.js — ล็อกจุดแรกเป็นต้นทาง) · sim นับเวลาแวะจริง (timeline วิ่ง+แวะ จุดส้ม ⏸) · แผนที่โชว์ถนนทั้งโรงงาน (เทาบาง) + legend · **บทบาทจุดจอดต่อรอบ `transport_round_stops.action`** ('load' ⬆รับ/'drop' ⬇ส่ง · null = เดาจากชนิดจุด dock→load) — ป้ายคลิกสลับในลิสต์ + badge บนแผนที่ · migration `20260803_transport_stop_action.sql` (DR · saveStops คงค่า action ตอนเรียงใหม่ — ใส่คีย์เฉพาะเมื่อคอลัมน์มีจริง) · เฟสถัดไป (ดู `docs/TRANSPORT_AMR_DESIGN.md`): Dispatch Board รวมทุกคิว · empty_return · มือถือคนขับ · KPI lead-time | ทุก role (ดู) · manage ตามสิทธิ์ |
| การตรวจสอบและซ่อมบำรุง | `/mtn-repair` | MtnRepair — ใบแจ้งซ่อม MO 7 ขั้น (ดู section "MTN Work-Order") · แท็บ **🔩 คลังอะไหล่** = FM-JIG-009 + Rank WI-JIG-010 · แท็บ **🗺️ ผังคลัง** = ผังชั้นวางมุมหน้า ค้นของแล้วรู้ว่าอยู่ช่องไหน (ดู section "คลังอะไหล่") | ทุก role (ดู) · report/service/qa/approve/manage_master ตามสิทธิ์ |
| การตรวจสอบและซ่อมบำรุง | `/pm-check` | PMCheckData | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-schedule` | PMSchedule | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-coordination` | PmCoordination — 🗓️ แผนประสานงาน PM ข้ามวัน (แบบเมล MTN แจ้ง Production): งาน PM/แก้เครื่องหลายวัน + ทีมรับผิดชอบแต่ละวัน + ช่วง Production Support → แจ้ง Telegram + พิมพ์ใบ (ดู section "PM Coordination") | ทุก role (ดู) · `pm_coord:manage` = admin/mgr/sv/mtn/engineer/leader |
| การตรวจสอบและซ่อมบำรุง | `/mtn-layout` | MtnMachineLayout | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-setup` | PMSetup | admin/manager/supervisor |
| ควบคุมคุณภาพ QA/QC | `/qa` | QualityControl — 6 แท็บ: Dashboard คุณภาพ · **✅ ใบตรวจ (Check Sheet)** · SPC/Cp-Cpk · NCR · CAPA/8D · เครื่องมือวัด (ดู section "QA Inspection — setup → ใบตรวจ") | admin/manager/supervisor/leader/qa/doc_control |
| ควบคุมคุณภาพ QA/QC | `/qa-setup` | QAInspectionSetup — **หน้า setup เท่านั้น** (มาตรฐาน+drawing+balloon) ผลตรวจจริงอยู่แท็บใบตรวจใน `/qa` | admin/manager/qa |
| ควบคุมคุณภาพ QA/QC | `/event-log` | EventLog | admin/manager/supervisor/leader/qa (CQI-15 + Approval) |
| วิศวกรรม (PE) | `/pe-docs` | **PEDocs — 📐 PE Core Tools: Process Flow / PFMEA / Control Plan** (ดู section "PE Core Tools") | ทุก role (ดู) · แก้ = `pe:edit` (admin/mgr/engineer) · revision = `pe:approve` |
| วิเคราะห์ & รายงาน | `/report` | Report | ทุก role (7 tabs: รายวัน/รายพนักงาน/Log จุดงาน/สรุปช่วงเวลา/4M/ใบบันทึก/จองรถ OT + CSV export) · **Changing Point Control Record ย้ายเข้าทะเบียนกลาง `doc_forms`/`doc_form_revisions` doc_key `changing_point` แล้ว (2026-07-30)** — แผง "⚙️ จัดการเอกสาร" ในแท็บ 4M กับหน้า `/doc-forms` แก้ข้อมูลชุดเดียวกัน · ตารางเก่า `document_controls`/`document_control_revisions` เลิกใช้ (คงไว้เป็นประวัติ ห้าม drop จนกว่าจะยืนยันข้อมูลครบ) · **deep-link (2026-08-11): `?tab=` ของหน้านี้เป็น "เลข index ของ `TABS`"** (สัญญาเดิม ต่างจากหน้าอื่นที่ใช้ key ข้อความ — ดู UI-CONVENTIONS §6.8) → **สลับลำดับ TABS = ลิงก์ข้างนอกพาไปผิดแท็บเงียบๆ** · ที่อ้างอยู่ตอนนี้: `?tab=4` (4M Changes) จาก `/dept-dashboard` · **แท็บ 4M รับต่ออีก 3 param: `status` (ตัวกรองสถานะ · validate กับ `STATUS_META`) · `from=YYYY-MM-DD` (วันเริ่มช่วง) · `focus=<log id>` (เน้นแถว + เลื่อนไปหา)** → กระโดดเข้าคิวอนุมัติใบนั้นแล้วกด Approve ได้เลย · **ต้องส่ง `from` มาด้วยเสมอ** — ช่วง default คือ 7 วันล่าสุด ใบค้างมักเก่ากว่านั้น (ค้างจริง 60-80 วัน) ไม่ส่งจะเปิดมาเจอจอว่าง · หา `focus` ไม่เจอ = ขึ้นแถบแดงอธิบาย + ปุ่มล้างตัวกรอง (**ห้ามเงียบ**) |
| พนักงาน & ทักษะ | `/skills-report` | `<Report mode="skills" />` — 3 แท็บสกิลที่แยกจาก /report (Skill Matrix / ค่าฝีมือ / Multi-Skill Form) component อยู่ใน Report.jsx เดิมทั้งหมด (`SKILL_TAB_IDXS`) | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/org-setup` | OrgSetup | admin |
| พนักงาน & ทักษะ | `/register` | Register | admin/manager/supervisor |
| พนักงาน & ทักษะ | `/operator` | Operator | admin/manager/supervisor/leader |
| พนักงาน & ทักษะ | `/ojt-training` | OjtTraining — ใบอบรม OJT paperless FM-HRM-004: บันทึก+เซ็นบนจอ+พิมพ์ PDF ตามฟอร์มกระดาษ (สิทธิ์บันทึก `ojt:record` = mgr/sv/leader · ลบ `ojt:delete` = mgr · scope ผู้เข้าอบรมตาม leader family/sections · ย้ายจากหมวดฝ่ายผลิตมาอยู่คู่ฐานข้อมูลพนักงาน/สกิล ตามคำสั่ง user 2026-07-20) | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/products` | ProductMaster | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/linesetup` | LineSetup | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/machine-database` | MachineDatabase — **default กรอง `equipment_kind='machine'`** (ไม่งั้นแม่พิมพ์ 262 ตัวปนในลิสต์/dropdown/สถิติ) · สลับดูชนิดอื่นได้จากแถบกรอง | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/die-registry` | **DieRegistry — 🔨 ทะเบียนแม่พิมพ์**: มุมมองแม่พิมพ์บนตัวตนเดียวกับเครื่องจักร (ดูกฎเหล็ก "ชนิดอุปกรณ์เป็นแกน ไม่ใช่ตาราง") · จัดกลุ่มเป็น **ชุด (1 พาร์ท = 1 ชุด)** → กางดูสมาชิกราย OP (กระบวนการ/ตัน/shot สะสม/จำนวนครั้งที่เจียร) · แก้ชุดและแม่พิมพ์รายตัวได้ · **แถบ worklist "ข้อมูลที่ยังต้องเก็บให้ครบ" + ปุ่ม 🔎 ดูเฉพาะที่ต้องแก้** (ข้อมูลมาจากการแกะชื่อเครื่องเดิม ช่องที่แกะไม่ออกปล่อยว่าง — **ห้ามซ่อน** pattern เดียวกับแถบ ⚠️ ข้อมูลไม่ตรงผังองค์กรใน `/operator`) · **OP ซ้ำในชุด = สัญญาณว่าเป็นหลายชุดที่ถูกรวมกัน** (เช่นแยกตามวัสดุ RAW/AAW/LAW — เจอจริง 1 ชุด 24 ตัว = 4 วัสดุ × 6 OP) **ระบบชี้ให้เห็น ห้ามแยกให้เองอัตโนมัติ** · **ไม่ให้แก้ `shot_total`** (ตัวนับจากการผลิต ไม่ใช่ค่าที่คนพิมพ์ทับ) · dropdown ไลน์ลิสต์จาก**ไลน์ที่แม่พิมพ์ใช้จริง** ไม่ใช่ `production_lines` อย่างเดียว (ไลน์แม่พิมพ์เป็นชื่อกลุ่มเครื่องปั๊ม เช่น `LINE A ( 800 Ton )` ซึ่งไม่มีในตารางไลน์ผลิต) · **สิทธิ์แก้ = `machines:edit`** (ตัวตนเดียวกัน คนกลุ่มเดียวกันดูแล — เลี่ยงกับดัก seed `enum_range` ของ permission key ใหม่) · scope ตาม pattern มาตรฐาน · migration `20260810_die_registry_permission.sql` | admin/manager/supervisor/mtn |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/process-setup` | ProcessSetup — จุดจัดการ master กระบวนการผลิต (process_types) ทางเข้าเสริมนอกจาก Daily Report ⚙️ · component ร่วม `ProcessTypeSetup.jsx` | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/qr-labels` | QrLabels — 🏷️ พิมพ์ป้าย QR อุปกรณ์ (เครื่องจักร/จิ๊ก) เลือกไลน์+ติ๊กรายการ → พิมพ์สติกเกอร์ A4 (3 ขนาด) · ดู section "QR / บาร์โค้ดอุปกรณ์" | ทุก role (พิมพ์: `qr_labels:print` = admin/mgr/sv/mtn/engineer) |
| พนักงาน & ทักษะ | `/shift-organize` | ShiftOrganize | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/company-calendar` | CompanyCalendar | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/notification-config` | NotificationConfig | admin เท่านั้น |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/doc-forms` | DocFormsRegistry — 📄 ทะเบียนเอกสาร & ฟอร์ม (Document Master): เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/footer/**Legend/ผู้ออกเอกสาร (issued_by)/Revision History** ของเอกสาร export ทุกตัว แก้แล้วใบพิมพ์ใช้ทันทีไม่ต้องแก้โค้ด · ฟังก์ชันพิมพ์อ่านผ่าน `src/utils/docForms.js` (`getDocForm`/`docFormSync`/`getDocFormRevisions`/`withDocFoot` + fallback ค่าเดิมในโค้ดเสมอ) · **เอกสาร export ใหม่ทุกตัว (รวมรายงานภายใน) ต้อง: (1) seed แถวใน `doc_forms` (2) อ่านผ่าน util นี้ ห้าม hardcode — รายงานที่ไม่มี layout ฟอร์มทางการ อย่างน้อยห่อ html ด้วย `withDocFoot(html, doc_key)`** (ไม่ตั้งเลขฟอร์มในทะเบียน = หน้าตาเดิมเป๊ะ) · ตาราง `doc_forms` + `doc_form_revisions` (Main — **ทั้งหมด 24 ฟอร์ม ครอบทุกเอกสาร export**: 9 ฟอร์มควบคุมเดิม + changing_point/cqi15_event_log/pm_coordination/morning_meeting/ot_booking/report_daily/report_employee/report_station_log/report_period_summary/skill_matrix/skill_pay_summary/attendance_record (migration `20260730_doc_control_center.sql`) + **ot_compensation_report/daily_production_report/daily_report_export** (migration `20260804_doc_forms_attendance_dpr.sql` · QC audit 2026-08-04 — เดิม 3 ตัวนี้ hardcode หัวเรื่อง/ช่องลายเซ็น/legend ในโค้ด: Checkin `handleExportForms` 2 ใบ (ชดเชย-OT + บันทึกการมาทำงาน = `attendance_record` ที่ seed ไว้แล้ว) · DailyReport `exportShiftFormPDF` (DPR ประจำกะ) + `exportPDF` (รายงานภายใน 4 ตัว — แถบเลขฟอร์มท้ายหน้า))) · sig_blocks: จำนวนช่องต้องเท่า layout เดิม เปลี่ยนได้เฉพาะข้อความ | ทุก role (แก้: `doc_forms:manage` = mgr/doc_control) | · **🖨️ ปุ่มทดลองพิมพ์/บันทึก PDF จากทะเบียนได้เลย (2026-08-06)** — ใบตัวอย่าง (specimen) มี**ลายน้ำ “ตัวอย่าง” + แถบเตือน** กันเอาไปใช้แทนใบจริง · แสดง**เฉพาะส่วนที่ทะเบียนคุม** (หัวเอกสาร/ช่องเซ็น/legend/footer/Revision History) ตัวเนื้อหามาจากหน้าที่ใช้งานจริง — `src/lib/docFormPreview.js` **ห้ามจำลอง layout ใบจริงมาไว้ที่นี่** (จะกลายเป็น layout ชุดที่ 2 ที่ต้องตามแก้) · **ขนาด/แนวกระดาษเป็นคอลัมน์จริงแล้ว** `paper_size` + `orientation` + **`layout_locked`** — ฟอร์มทางการ layout ผูกกับแนวกระดาษตายตัว (ตารางกว้างตามจำนวนวัน) เปลี่ยนแล้วใบพัง → **ล็อกไม่ให้แก้ + อธิบายเหตุผลบนจอ ห้ามปล่อยให้กดแก้แล้วเงียบ** · `layout_locked=false` (รายงานภายในที่ห่อด้วย `withDocFoot`) เปลี่ยนแนวแล้ว**มีผลจริง** ผ่าน `pageCss()`/`withDocFoot` ที่ inject `@page` · **✍️ ชุดช่องลายเซ็นแยกรายส่วนงาน — ตาราง `doc_form_scopes`** (migration `20260806_doc_form_scopes.sql`): เลขฟอร์ม/Rev เป็นของ**บริษัท** (ชุดเดียว ห้ามแตกตามแผนก) แต่**ป้ายช่องเซ็น + ชื่อผู้เซ็นประจำ + footer/legend/ผู้ออกเอกสาร แยกตามส่วนงานได้** · ไม่มีแถว = ใช้ชุดกลาง (pattern เดียวกับ `lpa_questions.line_name` null = common) · **จำนวนช่องล็อกตาม layout เปลี่ยนได้แค่ข้อความ** · ฟังก์ชันพิมพ์รับส่วนงานผ่าน `getDocForm(key, fb, { section })` / `docFormSync(...)` แล้วอ่านช่องด้วย **`sigAt(df, i)`** (คืน `{label, name}`) — **ฟอร์มที่ยังไม่ส่ง `section` = ได้ชุดกลางเหมือนเดิมเป๊ะ**
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/permissions` | PermissionsManagement | admin เท่านั้น |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/add-user` | AddUser — จัดการผู้ใช้งาน (ย้ายจากลิงก์พิเศษท้าย sidebar เข้าหมวดตั้งค่าฯ 2026-07-20) | admin เท่านั้น |
| (ไม่อยู่ใน sidebar) | `/login` | Login | ไม่ต้อง auth |

---


### 🧭 โครงนำทาง — หัวหน้าเพจ / แท็บ / ทางลัด (2026-08-11 · ดู `docs/NAVIGATION-REVIEW.md` §6)

- **ทุกหน้าขึ้นด้วย `<PageHeader>`** (`src/components/PageHeader.jsx`) — breadcrumb `🏠 หน้าหลัก › หมวด › หน้า › แท็บ` **generate เองจาก `NAV_ITEMS`** ตาม pathname ไม่ต้องใส่มือ · เว้น `paddingRight: 52` กัน 🔔 ให้แล้ว · **ห้ามวาดหัวเรื่อง/แถบแท็บเอง** (เดิมแต่ละหน้าวาดเอง เลยได้มุมโค้งแท็บ 7/8/12 ปนกัน)
- **หน้าที่มีแท็บผูก URL ด้วย `useTabParam`** (`src/utils/useTabParam.js`) — refresh/แชร์ลิงก์/Back อยู่แท็บเดิม · ค่าที่ไม่รู้จัก = ตกกลับแท็บ default (ห้ามจอว่าง) · แท็บ default ไม่ใส่ใน URL · param อื่น (`?line=`) ถูกรักษาไว้
  - **⚠️ แท็บซ้อนแท็บต้องคนละ param** — หน้าที่ถูกฝังในหน้ารวมใช้ `?sub=` (`/linesetup` ใน `/layout-setup` · `/daily-pm` `/lpa` ใน `/daily-checker`) ไม่งั้นแย่ง `?tab=` กับหน้าแม่
  - **⚠️ แท็บที่ต้องมีสิทธิ์ ต้อง guard ค่าจาก URL ด้วย** ซ่อนปุ่มอย่างเดียวไม่พอ (คนแปะลิงก์ให้กันได้) — ทำแล้วที่ daily-report `setup` · lpa `questions` · operator `skills`/`levelup` · mtn-layout `overview` ตอน setupMode
  - **⚠️ `setTab` เปลี่ยน identity ตาม URL** — ถ้าใช้ใน `useCallback`/`useEffect` ต้องใส่ใน deps (ต่างจาก setter ของ `useState` ที่นิ่ง)
  - **⚠️ เป็น hook → ต้องอยู่บนสุดก่อน early return** (rules-of-hooks · React #310)
  - **ไม่ผูก URL กับ state ที่ระบบสั่งสลับเอง** (เช่น PMCheckData บันทึก→ประวัติ ตอนกดบันทึก) ไม่งั้นประวัติ Back งอกทุกครั้ง · ถ้าจำเป็นต้องผูกจริงๆ ให้ระบบสลับด้วย **`setTab(k, { replace: true })`** (EventLog บันทึกเสร็จ→รายการ)
- **route ที่ยุบเป็นแท็บแล้วต้อง `<Navigate to="…?tab=x" replace />`** ห้าม render ซ้ำสองทาง — `/daily-pm` `/pokayoke` `/lpa` → `/daily-checker?tab=` · **ลิงก์ภายในให้ชี้ปลายทางจริง** ไม่เด้งผ่าน redirect · **ยกเว้น `/linesetup`** ที่คงไว้เป็นทาง "ดูอย่างเดียว" ของคนไม่มีสิทธิ์ `line_setup:edit` (redirect แล้ววนกลับมาที่เดิม)
- **ทางลัดหาเมนู (เมนู 51 รายการ 8 หมวด):** ช่องค้นหาบนหัว sidebar (พิมพ์แล้วยุบเป็นลิสต์แบน) + **`Ctrl/⌘+K` เปิด `CommandPalette`** (ค้นแบบ subsequence · ↑↓ Enter Esc) — **ทั้งคู่ดึงจาก `NAV_ITEMS` + `canAccessPage` เมนูใหม่โผล่เอง ห้ามพิมพ์รายชื่อหน้าซ้ำ**
- **"ใช้บ่อย"** = `src/utils/navRecent.js` (localStorage ต่อเครื่อง · decay ครึ่งชีวิต 14 วัน ไม่ค้างบนสุดเพราะเคยกดรัวๆ) · `trackVisit` เรียกจากจุดเดียวใน `App.jsx` (ProtectedLayout ตอน pathname เปลี่ยน)
- **4 หน้าที่ไม่มีหัวเรื่องโดยตั้งใจ:** `Login` (มีแบรนด์เอง) · `Dashboard`/`Management` (บอร์ดจอ TV หัวเรื่องกินที่แนวตั้ง) · `LineSetup` (ถูกฝังในแท็บหน้าอื่น หัวเรื่องอยู่ที่หน้าแม่)

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
- **แผนกที่ไม่ขึ้นกับ Section ใด (ขึ้นตรงฝ่าย) รองรับแล้ว (2026-07-13):** `org_nodes.kind='department'` ที่ `parent_id IS NULL` — สร้าง/ย้ายได้จาก OrgSetup (ตัวเลือก "🏛️ ขึ้นตรงฝ่าย" ในฟอร์ม + กลุ่ม "ขึ้นตรงฝ่าย" ในคอลัมน์ Section) · **ลงทะเบียนพนักงานในแผนกขึ้นตรงฝ่ายได้แล้ว (2026-08-06):** เดิม dropdown แผนกใน Register/operator เป็น cascade `d.parent_id === sectionNode.id` ตรงๆ → แผนกที่ `parent_id IS NULL` ไม่มีวันโผล่ = **ลงทะเบียนช่าง MTN/JIG MTN/DIE MTN ไม่ได้เลย** (เจอจริง: ผังมี 4 แผนกขึ้นตรงฝ่าย แต่ฟอร์มบังคับเลือก Section ก่อนถึงปลดล็อกแผนก) · แก้ด้วย **sentinel `ORPHAN_SECTION` ในช่อง Section** (helper รวมที่ `src/utils/sectionScope.js`: `ORPHAN_SECTION`/`ORPHAN_SECTION_LABEL`/`sectionValueForSave`/`sectionValueForEdit`/`orphanDepts`/`deptOptionsFor`/`deptNodeFor`) — เลือก "🏛️ ขึ้นตรงฝ่าย (ไม่มี Section)" → ช่องแผนกโชว์แผนก `parent_id IS NULL` · **บันทึกลง `employees.section` เป็น `null`** (ตรงผังจริง — **ห้ามยัดชื่อแผนกลง section เพื่อให้ cascade ผ่าน** จะกลายเป็น section ปลอมที่ไม่มีในผัง) · ตัวเลือกนี้เห็นเฉพาะ user ที่ไม่ถูกจำกัด scope (หัวหน้าราย section ลงทะเบียนคนนอกส่วนงานตัวเองไม่ได้) · **ผลข้างเคียงที่ตั้งใจ:** พนักงานกลุ่มนี้ section ว่าง → ไม่เข้า scope ของหัวหน้าที่จำกัดราย section (ถูกต้อง — ช่างไม่สังกัดส่วนงานผลิต) · การจับทีมช่าง/labor type ไม่กระทบเพราะ `teamForSection()` (mtnTeams.js) และ `laborTypeOf()` (laborType.js) เช็ค **department ก่อน** section อยู่แล้ว · **ข้อมูลเก่าที่กรอกชื่อแผนกซ้ำลง section** (ช่าง 14 คนที่ย้ายเข้าฐาน 2026-07-22 มี `section='MTN'` ทั้งที่ MTN เป็นแผนกไม่ใช่ส่วนงาน) → `sectionValueForEdit` โชว์เป็น sentinel ให้แก้ต่อได้ (เดิมช่องแผนกล็อกตาย) และ normalize เป็น null เมื่อเซฟทับ · **พนักงานฝ่ายผลิตยังต้องมี section เสมอเพื่อ scoping** (มีตัวเลือก Section ปกติให้เลือกเหมือนเดิม)
- `production_lines.section` = `org_nodes.code` ของ section
- `production_lines.parent_line_name` = `name` ของ production_line ระดับแผนก (เช่น 'HYDROFORM')
- Department name ใน org_nodes ต้องตรงกับ parent production_line name เพื่อให้ Register กรอง LINE dropdown ถูก
- Register.jsx กรอง LINE โดย: `l.name === department || l.parent_line_name === department`
- **Dropdown ลำดับชั้น (Section→แผนก→Line→Team) ทุกหน้าต้อง cascade + ล้างตัวลูกเมื่อเปลี่ยนตัวแม่** — กฎเต็มดู `docs/UI-CONVENTIONS.md` §5.3 (เพิ่ม 2026-07-21 หลังพบ Report 5 จุด + operator filter bar โชว์แผนกข้าม section)
- **⚠️ ตัวเลือก "ส่วนงาน" (section picker) ทุกหน้าต้องยึด `org_nodes` (kind='section') ไม่เดาจาก `production_lines.section`** — ลิสต์/ลำดับตามผัง แล้ว fallback เดาจาก production_lines เมื่อผังยังว่าง (backward-compat) · กรองด้วย `scopeSecs`/`inSectionScope` ทับเสมอ · หน้าที่ทำแล้ว: Report (ทุกแท็บ ผ่าน `useOrgSections`/`useOrgDepts` cascade แผนก 2026-07-21), Dashboard (`orgSections` 641), operator/Register/OJT (แผนก cascade), **ProductionPlan + MorningMeeting (section picker → org_nodes, 2026-07-24)** — เดิม 2 หน้านี้ derive `sectionOpts` จาก `scopedLines.map(l=>l.section)` ทำให้ลิสต์/ลำดับไม่ตรงผัง · หน้าใหม่ที่มี section picker ให้โหลด org_nodes แบบเดียวกัน
- **⚠️ `employees.department`/`section` เป็น free text ไม่ผูก FK กับ `org_nodes`** — data drift ได้ (เจอจริง: พนักงาน PD4 กรอก department ASSY/ASSY2/ทั่วไป แต่ผัง PD4 = GOR/LWRBAR) · dropdown แผนกใน `/operator` จึง cascade จาก `org_nodes` (แผนกใต้ section เรียงตามผัง = optgroup "ในผังองค์กร") + ต่อท้าย legacy ที่พนักงานกรอกแต่ไม่มีในผัง (optgroup "⚠ นอกผัง") ให้ยังกรองได้ระหว่างจัดข้อมูล (2026-07-22) — **ถ้าอยากให้ตรงผัง 100% ต้องจัด `employees.department` ให้ตรงชื่อแผนกใน org_nodes** (data cleanup แยกจากโค้ด)
  - **⚠️ 2 กับดักของตัวจัดกลุ่ม "ในผัง/นอกผัง" (แก้แล้ว 2026-08-06 · user ทักว่า dropdown ไม่สอดคล้องกับผัง):**
    1. **ต้อง fallback เป็น "ทั้งผัง" เมื่อยังไม่เลือกตัวแม่** — ตัวกรอง Group เดิมเขียน `grpDepNode ? lines ของแผนกนั้น : []` → **ยังไม่เลือกแผนก = ลิสต์ในผังว่าง → กลุ่มทุกตัวตกไปกอง "นอกผัง" ทั้งที่มีในผังจริง** (ตัวกรอง Dept ทำถูกอยู่แล้ว: ไม่เลือก section = เอาทุกแผนก) · ลำดับที่ถูก: เลือกแผนก → กลุ่มใต้แผนกนั้น · เลือกแค่ section → กลุ่มของทุกแผนกใน section · ไม่เลือกอะไร → ทั้งผัง
    2. **กลุ่ม (kind='line') ต้องเทียบทั้ง `name` และ `code`** — `code` ของ line เป็น**เลขไลน์** ('9', '12') ไม่ใช่ชื่อ ขณะที่ `employees.group_name` เก็บ**ชื่อ** → เทียบด้วย `code || name` อย่างเดียว ทำให้พนักงานทั้งไลน์ถูกตีเป็นนอกผัง (เจอจริง LINE ASSY TSRA code='9' → 35 คนหลุด) · **ฟอร์มแก้ไขพนักงานก็ต้องบันทึก `name` ไม่ใช่ `code || name`** ไม่งั้นแก้ทีนึงช่อง Group กลายเป็นเลข "9" (มี 2 คนโดนไปแล้ว — แก้ได้เองเมื่อเปิดแก้ไขแล้วเลือกกลุ่มใหม่)
  - **หมายเหตุ: `code || name` ยังถูกสำหรับ section/department** (code เป็น PD1/PD2… หรือ null) — กฎนี้ใช้กับ **kind='line' เท่านั้น**
  - **⚠️ ห้ามซ่อน optgroup "นอกผัง" ทิ้ง (2026-08-06 · user ถามว่าควรซ่อนไหม):** ซ่อนแล้ว**หาคนที่ต้องแก้ไม่เจอ** — ข้อมูลผิดยังอยู่ในตารางแต่กรองหาไม่ได้ = ผิดแบบมองไม่เห็น · ทำเป็น **worklist** แทน: `/operator` มีแถบเหลือง "⚠️ ข้อมูลไม่ตรงผังองค์กร N คน" + ปุ่ม 🔎 ดูเฉพาะที่ต้องแก้ (`filterOffOrg`) + ช่องแผนก/กลุ่มในตารางที่ผิดขึ้นสีเหลือง + tooltip บอกเหตุผล → ไล่แก้จนเหลือ 0 แล้วแถบหายเอง
  - **⚠️ บาง section แก้ผ่านฟอร์มไม่ได้ ต้องเพิ่มในผังก่อน** — ผังไม่มีแผนกใต้ section นั้นเลย = dropdown ว่าง เลือกอะไรไม่ได้ (ข้อมูลจริง 2026-08-06: **PD1 32 คน** ผังมี 0 แผนก) · แถบเตือนแยกนับให้แล้ว ("ในนี้ N คน แก้ที่ฟอร์มยังไม่ได้ — ต้องเพิ่มที่ผังองค์กรก่อน" + ลิงก์ `/org-setup`) — **ห้ามบอกให้ user ไปไล่แก้เฉยๆ โดยไม่บอกว่าบางส่วนแก้ไม่ได้**
  - **ฟอร์มพิมพ์ชื่อแผนก/กลุ่มเองไม่ได้แล้ว** — ทั้ง `/register` และโมดัลแก้ไขใน `/operator` เป็น `<select>` จาก org_nodes ล้วน (ตั้งแต่ 2026-07-22) และไม่มี bulk import พนักงาน → **drift ใหม่เกิดไม่ได้จาก UI** ที่ค้างอยู่คือข้อมูลก่อนหน้านั้น

> ### ⚠️ กฎเหล็ก — เปลี่ยนชื่อไลน์ (rename) ต้อง cascade `line_name` ทุกตาราง **2 project** (2026-07-22)
> **ชื่อไลน์ถูกเก็บเป็น text snapshot (ไม่ใช่ FK) ในหลายสิบตารางทั้ง Main + DR** — `production_lines.name` เป็นแค่ที่เดียว ที่เหลืออ้างด้วยชื่อ · เปลี่ยนชื่อแล้ว**ไม่ตามไปแก้ทุกที่ = ข้อมูลชื่อเก่ากำพร้าเงียบๆ ทันที**
> **เคสจริงที่เจอ:** เปลี่ยนชื่อไลน์ Laser ใน `/linesetup` → "กะที่เปิดค้าง" หายจากรายการ "กะที่เปิดอยู่" ใน Daily Report (เพราะ `production_sessions.line_name` = ชื่อเก่า แต่หน้ากรองด้วยชื่อไลน์ปัจจุบัน — leader `.in('line_name',[children])`, scoped role `lineMap[s.line_name].section` — session ยังเปิดอยู่ใน DB **แค่ถูกกรองพ้นสายตา** ไม่ได้หาย) · `dr_products.line_name` เก่ายังทำให้เปิด order/สแกนของไลน์ที่เปลี่ยนชื่อไม่ได้ด้วย
> **`handleRenameLine` (LineSetup.jsx) cascade แล้ว (best-effort ต่อ table):** Main = `workstations, line_layouts, wip_buffer_points, machine_points, machine_flow_links, four_m_logs, factory_line_regions, lpa_plans, lpa_audits, lpa_questions, meeting_action_items, station_assignment_logs, pokayoke_devices, wip_replenish_requests, employee_home_positions, qa_parts, qa_characteristics, qa_instruments, qa_ncr` · DR = `machines, production_sessions, dr_products, line_stock_transactions, jigs, pm_daily_line_targets, pm_daily_alerts, mtn_orders, improvements, scrap_reports, facility_supply_links, pm_coordination_plans, kanban_delivery_rounds, kanban_deliveries, rack_requests, kanban_calc_params, transport_nodes` + `pm_plans.usage_source_line` + คอลัมน์ `source_line` (`bom_items, child_lot_requests, packaging_withdrawal_requests`) + **`lpa_questions.hidden_for_lines[]`** (text[] — bump ธรรมดาไม่ได้ ต้องอ่าน-แก้-เขียนรายแถวด้วย `.contains()`) · (ขยายลิสต์ 2026-07-30 จาก single-source audit — เดิมตกหล่น supply route/PM ประสานงาน/poka-yoke/QA/คำขอ logistic · **ขยายอีกรอบ 2026-08-03 จาก QC audit** — เดิมตกหล่น lpa_questions/kanban_calc_params/transport_nodes/station_assignment_logs/pm_daily_alerts) · **เพิ่มตารางใหม่ที่เก็บ `line_name`/`source_line` ต้องมาเติมในลิสต์นี้ด้วย** · `handleDeleteLine` มีช่องโหว่เดียวกัน (ลบไลน์ที่ยังมี session เปิด = orphan) — ยังไม่ปิด, เลี่ยงลบไลน์ที่มีกะเปิดค้าง
> **กู้ session ที่กำพร้าไปแล้ว (rename ก่อนมี fix):** ใน `/linesetup` เปลี่ยนชื่อไลน์**กลับเป็นชื่อเก่า** (session ชื่อเก่ากลับมาโผล่) แล้ว**เปลี่ยนเป็นชื่อใหม่ที่ต้องการอีกรอบ** — รอบสองจะ cascade `production_sessions` ตามไปด้วย (fix ใหม่) · หรือ UPDATE `production_sessions.line_name` ชื่อเก่า→ใหม่ ตรงใน DR SQL editor

> ### ⚠️ กฎเหล็ก — กำลังคนมาตรฐาน (`std_day_shift`/`std_night_shift`) อ่านผ่าน `src/utils/stdManpower.js` เท่านั้น (2026-08-05)
> **`production_lines` เก็บ std ได้ทั้งไลน์แม่และไลน์ลูก แต่ไม่เคยมีกฎ inherit** → ข้อมูลจริงมี **3 convention ปนกันในตารางเดียว**: HYDROFORM (แม่ 14/14 · ลูกทั้ง 6 ก็อป 14/14 มาหมด) · LINE APRON ASSY (แม่ 17 · ลูก 6+7+6=19) · GOR/LWR BAR (แม่ตั้ง · ลูก 0/0) — ส่วน**พนักงานจริง (`employees.line_id`) ผูกกับไลน์แม่ 100% ทุกกลุ่ม**
> **แต่ละหน้าเลยเดากันเอง แล้วตอบ "ไลน์นี้มีคนกี่คน" ไม่ตรงกัน** (Dashboard 28 · OrderTrace 14 · ProductionPlan ทิ้งไลน์แม่ทั้งดุ้น)
> **กฎที่ใช้ (ยึด pattern เดียวกับ `shift_schedules`: ลูกตามแม่ เว้นแต่ตั้งเอง):**
> - **ตัวเลขกำลังคนของ "กลุ่ม" อยู่ที่ไลน์แม่** — แม่ตั้งไว้ = นั่นคือยอดกลุ่ม **ห้ามบวกลูกซ้ำ** · แม่ไม่ได้ตั้ง = รวมจากลูก
> - **คุณสมบัติไลน์** (เช่น "เดินกะดึกได้ไหม") **ตกทอด**จากแม่ลงลูกได้ — คนละเรื่องกับตัวเลขกำลังคน
>
> | export | ใช้ตอบ | ใช้ที่ |
> |---|---|---|
> | `stdCapacityOf(lines, name, shift)` | การ์ดรายไลน์ + **ผลรวมทั้งลิสต์ (ไม่นับซ้ำ)** — ไลน์ลูกที่แม่ตั้งไว้แล้ว = 0 | Dashboard |
> | `stdGroupOf(lines, name, shift)` | "กลุ่มนี้ทั้งกลุ่มกี่คน" | OrderTrace |
> | `stdInheritedOf` / `hasNightShift` | **คุณสมบัติไลน์** (มีกะดึกไหม) — ⚠️ ห้ามใช้รวมยอด จะซ้ำกับแม่ | ProductionPlan |
>
> **จุดใหม่ที่แตะกำลังคน ห้ามอ่าน `line.std_day_shift` ตรงๆ ห้ามเขียน heuristic เอง** (Dashboard เคยใช้ "ไลน์ย่อยที่ไม่มีพนักงาน = 0" ซึ่งพังทันทีที่ลูกมีคนสักคน — LASER E50 มี 1 คน → HYDROFORM กลายเป็น 28 แทน 14 · **พนักงานคนเดียวลงผิดไลน์ = ตัวหารทั้งโรงงานเพี้ยน 14**) · ยอดรวมกะเช้าทั้งโรงงานหลังแก้ = **67 คน** (เดิม 81 จากการนับซ้ำ)
> **⚠️ `parallel_stations` (N) = "เครื่องหลักที่เดินพร้อมกันจริงตอน**เต็มกำลัง**"** — **ไม่ใช่จำนวนเครื่องทั้งหมดในทะเบียน และไม่ใช่จำนวนคนที่มาวันนี้** (ผังรวมปรับตามกำลังคนที่มาจริงให้เองแล้ว ดูหัวข้อ Factory Master Map) · ตั้งสูงเกินจริงจะเพี้ยน 2 ทางพร้อมกัน: "ควรผลิตได้ตอนนี้" สูงเกิน (ไลน์ดูตามหลังตลอด) + หัก DT 1/N มากเกิน (%A สูงเกินจริง) · ไลน์ที่เป็น `parallel_machine` แต่ไม่ตั้ง N = ผังรวมถอยไปสูตรอัตราตามเวลา และแผง LineSetup ขึ้นแถบเตือนสีส้มให้ไปตั้ง
> **`cost_center` / `head_name` ก็ตกทอดจากแม่** (ลูกไม่ได้กรอก = ใช้ของแม่) — ทำแล้วที่ MtnRepair + Report (ใบค่าฝีมือ)
> **แผง LineSetup แยก 2 กลุ่มแล้ว:** 🏢 ข้อมูลของกลุ่ม (กำลังคน/cost center/หัวหน้า — ตกทอด) vs 🏭 คุณสมบัติของไลน์นี้ (ประเภทไลน์/โหมดไหลงาน/N เครื่องขนาน — ไม่ตกทอด) พร้อมข้อความบอกว่าค่าที่กรอกจะถูกนับหรือไม่ · **ชื่อแผง = "⚙️ ตั้งค่าไลน์ (กำลังคน + คุณสมบัติไลน์)"** — เดิมชื่อ "Standard Manpower" อย่างเดียวทั้งที่ข้างในมีคุณสมบัติไลน์ด้วย user ทักว่าสับสน (2026-08-06) · **เพิ่ม field ใหม่ในแผงนี้ต้องวางให้ตรงกลุ่ม** และถ้าไม่ใช่เรื่องคน ห้ามไปกองรวมกับกำลังคน
> **⚠️ ProductionPlan ห้ามกรองเหลือเฉพาะไลน์ลูก (leaf-only)** — `lineOfMat` map 1 พาร์ท → 1 ไลน์ ตาม `dr_products.line_name` เท่านั้น ไลน์แม่จึงไม่มีทางนับซ้ำกับลูก · เดิมกรอง leaf ทิ้ง → **HYDROFORM ที่มีสินค้าผูกกับตัวแม่ 5 พาร์ท หายจากแผนผลิตทั้งหมด** และ GOR/LWR BAR (ลูก std_night=0) **ไม่เคยถูกเปิดกะดึกในแผนเลย** ทั้งที่ไลน์เดินกะดึกจริง

### ทีมช่างซ่อม 4 ส่วน — data-driven + ยึด department เป็นหลัก (2026-07-22)

**เลิก hardcode ชื่อทีมในโค้ด** (คำสั่ง user) — ทีมช่าง (MTN/JIG MTN/DIE MTN/PRODUCTION) มาจากตาราง **`mtn_teams`** (DR · migration `20260722_mtn_teams.sql`): `key` (=`checklists.department`: maintenance/jig_maintenance/die_maintenance/production) · `label` · `icon` · `equip_type` (machine/jig/die/null) · `dept_name` (โยง `mtn_orders.mtn_dept`) · `color` · เพิ่ม/แก้ทีมได้จากตารางนี้ไม่ต้องแก้โค้ด
- โหลดผ่าน **`src/utils/pmTeams.js`** (`loadPmTeams()` cache + `pmTeamsSync()` + `DEFAULT_TEAMS` fallback ถ้า migration ยังไม่ apply) — หน้า **PMSchedule / PMCheckData / MtnMachineLayout / PMSetup** ดึง options+label+สี+icon จากตัวนี้ (เดิมต่างคนต่าง hardcode DEPT_OPTIONS/MTN_DEPTS · MtnMachineLayout เคยตกหล่น PRODUCTION · PMSetup เป็นหน้าสุดท้ายที่ยัง hardcode — แก้แล้ว 2026-07-22)
> ### ⚠️ กฎเหล็ก — `user_role` ถือ 3 แกน ห้ามเพิ่ม role เมื่อเจอแกนใหม่ (2026-08-06 · คำสั่ง user)
> `user_role` คอลัมน์เดียวปนกัน 3 เรื่อง ทำให้เข้าใจผิดซ้ำๆ ว่า role = ตำแหน่งงาน:
> **`scope`** ระดับสิทธิ์/ขอบเขต (admin·manager·supervisor·leader) · **`unit`** หน่วยงาน (mtn·qa·engineer·sale·planner_store·document_control) · **`device`** อุปกรณ์ (display) · **`tier`** ชั้นเสริม (dept_admin — bucket ของ flag)
> - **ติดป้ายแกนที่ `ROLE_META[x].axis`** (`src/utils/roleMeta.js`) → `/add-user` จัดกลุ่ม dropdown + แผงอธิบายตามแกนอัตโนมัติ · **เพิ่ม role ใหม่ต้องระบุ `axis` เสมอ** (ไม่ระบุ = ตกกลุ่ม `unit`)
> - **⚠️ `engineer` = "ส่วนวิศวกรรม" (หน่วยงาน) ไม่ใช่ "ตำแหน่งวิศวกร"** — เคสจริง: **วิศวกรที่ทำ PM สังกัดแผนก MTN ใช้ role `mtn`** (ข้อมูลจริง 2026-08-06: role `engineer` มีบัญชีเดียว `processengineering` · ส่วน role `mtn` 8 คน ในนั้นตำแหน่ง "วิศวกร" 3 คน) · เคยเข้าใจผิดจนเกือบแจกสิทธิ์ PM ให้ผิด role
> - **ตำแหน่งจริงอยู่ที่ `profiles.position` / `employees.position`** แยกจาก role เด็ดขาด
> - **เจอแกนใหม่ → เพิ่ม attribute ห้ามเพิ่ม role** (precedent ที่ได้ผลแล้ว 3 ครั้ง: `sections[]` แยก scope · `is_dept_admin` แยก tier · `mtn_teams[]` แยกทีมช่าง) — ไม่งั้นตอน rollout หลายโรงงาน role จะระเบิดเป็นสิบตัว
> - **✅ แกนที่ 4 "ระดับงาน" ทำแล้ว (2026-08-06 · เฟส 2)** — ตาราง **`positions`** (Main · migration `20260806_positions_master.sql` · apply แล้ว)
>   - **`employees.position` / `profiles.position` เก็บ "key" แล้ว แสดงผลผ่าน `positionLabel()`** — เดิมเป็น free text ปนไทย-อังกฤษ (`Operator` 195 + `พนักงานฝ่ายผลิต` 6 = อันเดียวกันแต่แยกกันในข้อมูล · `Technician` 17 + `ช่างเทคนิค` 6 · `Engineer` 1 + `วิศวกร` 5) → normalize แล้ว **ทุกแถวจับคู่ level ได้ 100% ไม่มีค่ากำพร้า**
>   - **แบ่ง 2 ชั้นโดยตั้งใจ:** ตาราง `positions` = **ชื่อตำแหน่ง** (ข้อมูล เปลี่ยนบ่อย ต่างกันได้ทุกโรงงานตอน rollout) · `POSITION_LEVELS` ใน `src/utils/positions.js` = **ระดับงาน** (แนวคิด TPM ที่นิ่ง) — **เพิ่มตำแหน่งใหม่ = เพิ่มแถวชี้ไป level เดิม ไม่ต้องแตะโค้ด**
>   - `maintenanceKindOfPosition()` → `am` (operator/leader) · `pm` (technician/engineer) · `both` (หัวหน้า/ผจก.) · `null` (ธุรการ/เลขา/เจ้าหน้าที่)
>   - **payoff:** `/add-user` เตือนเมื่อระดับงานไม่ตรงกับสิทธิ์ที่ให้ — เคสจริงที่จับได้: **ธุรการที่ role `mtn` ได้ `pm:approve` เต็ม** · **เป็นคำแนะนำเท่านั้น ไม่บล็อก** (หน้างานมีข้อยกเว้นเสมอ) สิทธิ์จริงยังคุมที่ `role_permissions`
>   - **⚠️ จุดที่แสดง/พิมพ์ `position` ต้องผ่าน `positionLabel()` เสมอ** ไม่งั้นใบพิมพ์ขึ้น `operator` — ทำแล้ว: sidebar, `/add-user`, ใบ Multi-Skill + CSV (Report), ใบประเมินรายบุคคล (individualSkillPrint) · **component ร่วมที่พิมพ์เอกสารต้อง `await loadPositions()` เองก่อนอ่าน** (กฎเดียวกับ `loadDocForms()` — SkillRadarPanel ทำแล้ว)
>
> #### ⚠️ AM (ผลิตตรวจเอง) ≠ PM (ช่าง) — คนละงาน คนละทะเบียน คนละสิทธิ์ (คำสั่ง user 2026-08-05 · เป็นข้อมูล 2026-08-06)
> ศัพท์ TPM: **`production` = AM (Autonomous Maintenance)** พนักงานผลิตดูแล/ตรวจเครื่องเองทุกต้นกะ · **ทีมช่าง (MTN/JIG MTN/DIE MTN) = PM (Preventive/Predictive · อนาคต prescriptive)** ตรวจตามรอบเวลา/ยอดผลิต · **key ใน DB ยังเป็น `production` เหมือนเดิม เปลี่ยนเฉพาะการแสดงผล**
> **นิยาม:** **AM** = พนักงานหน้างานตรวจเองทุกต้นกะ · **PM** = ช่าง (technician/engineer ทุกส่วนงาน) ตรวจ**ตามอีเวนต์** ไม่ใช่ทุกวัน — `pm_plans.plan_type` = `time` (รอบเวลา) / `usage` (ยอดผลิต) / `hybrid` + `condition_rules`
> - **⚠️ แกน AM/PM เป็น "ข้อมูล" ไม่ใช่เงื่อนไขในโค้ด — `mtn_teams.kind` (`am`/`pm`)** (migration `20260806_am_pm_axis_dr.sql` · apply แล้ว) · อ่านผ่าน **`teamKindOf(key)` / `isAmTeam(key)`** · เดิม hardcode `key === 'production'` ซึ่ง**พังเงียบ**ทันทีที่แยก AM รายส่วนงาน (AM-PD1/PD2) หรือ rollout โรงงานที่เรียกทีมคนละชื่อ — ทีมใหม่จะกลายเป็น PM โดยไม่มีใครรู้ · ทีมที่ไม่รู้จัก → **PM (fail-safe เลือกฝั่งสิทธิ์แคบกว่า)** · **สลับได้ที่ปุ่มใน PM Setup** (หัวข้อ AM/PM ข้างชื่อแผนก)
> - **⚠️ สิทธิ์บันทึกแยกแกนแล้ว: `am:record` (พนักงานหน้างาน) vs `pm:record` (ช่าง)** — เลือกด้วย **`recordPermFor(dept)`** ห้าม hardcode `can('pm','record')` อีก · migration `20260806_am_pm_permission_axis.sql` **seed `am:record` เท่ากับ `pm:record` เดิมทุกประการ → พฤติกรรมไม่เปลี่ยน ไม่มีใครหลุดสิทธิ์** แล้วค่อยไปรัดเองที่ `/permissions` (เช่น ถอด `pm:record` ออกจาก leader ให้เหลือแต่ AM)
> - **`display` ถูกถอด `pm:record`/`pm:approve`/`am:record` แล้ว** — จอ TV/บอร์ดหน้าไลน์เป็นอุปกรณ์ ไม่ใช่คน ไม่มีใครรับผิดชอบสิ่งที่บันทึก
> - **ชื่อ/คำอธิบายอยู่ที่ `src/utils/pmTeams.js` จุดเดียว** — `DEFAULT_TEAMS` label `production` = "AM (ผลิตตรวจเอง)" + `teamKind(key)` คืน `{short, full, desc}` (AM_KIND/PM_KIND) · **หน้าใดที่โชว์ชื่อทีมให้เรียก `teamKind()` มาอธิบาย ห้าม hardcode คำว่า "PM ฝ่ายผลิต"** · ใช้แล้วที่ PMSetup + PMCheckData (บรรทัดใต้แท็บ) · DailyPM/DailyChecker ใช้ชื่อ AM อยู่แล้วตั้งแต่ 2026-07-23
> - `mtn_teams` **apply แล้ว** (ตรวจ 2026-08-06 — เอกสารเดิมเขียนว่ายังไม่ apply ซึ่งไม่จริงแล้ว) → **เปลี่ยนชื่อทีมให้แก้ที่ตาราง `mtn_teams.dept_name`** ไม่ต้องแก้โค้ด · `DEFAULT_TEAMS` เหลือเป็น fallback ตอนโหลดไม่ทัน/ตารางล่ม
>
> #### ⚠️ 2 หน้า PM ฝั่งผลิตใช้เกณฑ์คนละอย่าง — เคยดูเหมือนข้อมูลหาย (2026-08-05)
> | หน้า | ลิสต์อะไร | เกณฑ์ |
> |---|---|---|
> | **PM Setup** (`/pm-setup?dept=production`) | เครื่องที่ **ลงจุดตรวจ AM ไว้แล้ว** | มีแถว `checklists` (module mtn, department `production`) |
> | **PM ตรวจสอบ** (`/pm-check?dept=production`) | เครื่องที่ **ต้องตรวจทุกต้นกะจริง** | มีแถว **`pm_daily_line_targets`** (ทะเบียน AM · ติ๊กที่ `/daily-checker?tab=pm`) |
>
> **2 เกณฑ์นี้ไม่เท่ากันโดยธรรมชาติ** (ข้อมูลจริง 2026-08-05: มี checklist 27 · ลงทะเบียน 7 · **ลงจุดตรวจแล้วแต่ไม่ได้ลงทะเบียน 21** · ลงทะเบียนแต่ยังไม่มีจุดตรวจ 1) — **เป็นเรื่อง data ไม่ใช่ bug ของ logic** (จะให้ไลน์ไหนตรวจเครื่องอะไรทุกกะ เป็นการตัดสินใจของคน **ห้ามให้ระบบลงทะเบียนให้เองอัตโนมัติ**)
> **แต่ห้ามเงียบ** — ทำให้เห็นทั้ง 2 ทางแล้ว: PM ตรวจสอบ มีบล็อกส้มท้ายลิสต์ "⚠ มีรายการตรวจ AM แล้ว แต่ยังไม่ได้ลงทะเบียน · N เครื่อง" (+รายชื่อ+ลิงก์ไปลงทะเบียน) และรายการที่ลงทะเบียนแต่ยังไม่มีจุดตรวจขึ้น "⚠ ยังไม่มีจุดตรวจ AM" · PM Setup การ์ดเครื่องที่ยังไม่ลงทะเบียนขึ้นชิป "⚠ ยังไม่ได้ลงทะเบียน AM" พร้อมลิงก์
> **ลำดับที่ถูกต้อง: PM Setup ลงจุดตรวจ → `/daily-checker?tab=pm` ⚙️ ติ๊กลงทะเบียน → เครื่องถึงโผล่ให้ตรวจ**

- **AM ฝ่ายผลิต แยกจาก PM หน่วยงานช่าง:** `/daily-pm` = operator/หัวหน้าไลน์เช็คเครื่อง**ผลิต**รายวัน (department `production` + registry `pm_daily_line_targets`) · ลิสต์ลงทะเบียน AM กรองเฉพาะ**เครื่องผลิต** (ตัด `equipment_type` jig/die + `equipment_category` facility/utility ออก — เดิมโชว์ทุกอย่างปนกัน · DailyPM.jsx `prodOnly`) · PM หน่วยงานช่าง (JIG/DIE/MTN) แยกตามส่วนงานที่หน้า PMSchedule/PMCheck/PMSetup ตามปกติ · **1 เครื่องมีได้ทั้ง checklist ผลิตรายวัน + checklist ช่างรายไตรมาส** (คนละ department คนละ checkpoints — pmChecklists key = equipment_id+module+department)
- **ยึด `checklists.department` เป็นหลักในการแยกทีม** (คำสั่ง user — 1 เครื่องมี PM หลายทีมได้: ผลิตตรวจรายวัน / MTN เข้า PM รายไตรมาส = คนละ checklist คนละ department) · **PMCheckData เดิมกรองด้วย `equipment_type` (jig/die/machine)** ทำให้ของชิ้นเดียวโผล่คนละแท็บกับ PMSchedule → แก้เป็น union: โผล่ใต้ทีม D ถ้า **มี checklist ของ D อยู่แล้ว** (ตรงกับ PMSchedule) **หรือ** ประเภทอุปกรณ์ = `equip_type` default ของทีม (ให้เริ่ม checklist ใหม่ได้) · `clDeptByJig` (jig_id→Set(department)) ใน PMCheckData
> #### ⚠️ กฎเหล็ก — checklist เกิดตอน "บันทึก" เท่านั้น ห้ามสร้างตอนเปิดดู (2026-08-05)
> `checklists` แถวหนึ่ง = **การประกาศว่า "แผนกนี้รับผิดชอบตรวจเครื่องนี้"** — ทั้ง PMSchedule/PMCheckData/DailyPM ตัดสินว่าเครื่องโผล่ในแท็บแผนกไหนจากการมีอยู่ของแถวนี้ (`clDeptByJig`) · **แค่เปิดดูจึงต้องไม่สร้าง**
> **บั๊กที่เกิดจริง:** `PMSetup` (เปิด modal แก้ไข) + `PMCheckData` (เลือกเครื่อง) เรียก `getOrCreateChecklist` ตอนเปิด → **เปิดดูเครื่อง X ในแท็บ JIG MTN ครั้งเดียว = เกิด checklist เปล่า 0 จุดตรวจของ JIG MTN ทันที แล้วเครื่อง X ค้างอยู่ในแท็บ JIG MTN ตลอดไป** ดูเหมือน "เครื่องอยู่ผิดหมวด/ผิดทีม" · พบเงาแบบนี้ **24 แถว** (jig/die/production ปนกันทั้งที่ไม่มีใครลงจุดตรวจ)
> **กติกาปัจจุบัน:**
> - **เปิดดู → `findChecklist()` (อ่านอย่างเดียว)** · **บันทึกจริง → `getOrCreateChecklist()`** — ทั้ง 2 ฟังก์ชันอยู่ `src/lib/pmChecklists.js` · หน้าใหม่ที่แตะ checklist ต้องแยก 2 จังหวะนี้เสมอ
> - ไม่มี checklist ของแผนกที่เปิดอยู่ = ฟอร์มเปล่าให้เริ่มลงจุดตรวจใหม่ (PMSetup) / ข้อความอธิบาย + ชี้ทางไปตั้งค่า (PMCheckData) — **ไม่ใช่ error**
> - **unique index `checklists_equipment_module_dept_uniq` (equipment_id, module, department)** บังคับ 1 เครื่อง = 1 checklist ต่อแผนก (กันเงาซ้ำระดับ DB)
> - migration ล้างเงา + ย้าย daily→production + unique index: `20260805_pm_dept_ownership_cleanup.sql` (DR · apply แล้ว — ล้าง 24 เงา, จุดตรวจครบ 254 ไม่หาย)
> - **ลงจุดตรวจไว้ผิดแผนกแล้วไม่ต้องพิมพ์ใหม่:** PM Setup → เปิดแก้ไขเครื่อง → แผง **"🗂️ รายการตรวจของเครื่องนี้ (แยกตามแผนก)"** โชว์ทุกแผนกพร้อมจำนวนจุด/จำนวนครั้งที่เคยตรวจ + ปุ่ม **➡️ ย้าย** (เปลี่ยน `department` ของ checklist เดิม — **ประวัติการตรวจ + แผน PM ย้ายตามไปทั้งก้อน** เพราะทุกตารางอ้าง `checklist_id` เดียวกัน) และ **⧉ คัดลอก** (สำเนาเฉพาะนิยามจุดตรวจไปแผนกอื่น ประวัติแยกกัน) · helper `listChecklistsByDept`/`moveChecklistDept`/`copyChecklistToDept`
> - **ปลายทางมีประวัติการตรวจแล้ว = ย้ายทับไม่ได้** (FK `inspections.checklist_id` เป็น `NO ACTION` — DB กันอยู่แล้ว) ให้ใช้คัดลอกแทน · ปลายทางมีจุดตรวจแต่ยังไม่เคยตรวจ = ถาม confirm ก่อนแทนที่
> - **เพิ่มรายการตรวจให้ "แผนกใหม่" ของเครื่องที่มีอยู่แล้ว:** PM Setup ลิสต์เฉพาะเครื่องที่มี checklist ของแผนกที่เลือก (แท็บ = ความรับผิดชอบ) → ทำได้ 2 ทาง (ก) แท็บแผนกนั้น → **เพิ่มอุปกรณ์ใหม่ → เลือกจาก Machine Master** เครื่องเดิม — **save จะใช้แถว `jigs` เดิม (lookup ด้วย `machine_id`) ไม่สร้างอุปกรณ์ซ้ำ** (เดิม mint uuid ใหม่เสมอ = 2 แถวต่อเครื่อง · ยังไม่เคยเกิดจริง ตรวจแล้ว 0 เคส) และมีข้อความบอกว่าเครื่องนี้แผนกไหนตรวจอยู่บ้าง (ข) เปิดเครื่องในแท็บแผนกที่มีจุดตรวจอยู่ → **⧉ คัดลอก** ไปแผนกใหม่
> - **⚠️ รูปจุดตรวจถูกแชร์หลังคัดลอก** (แถวสำเนาอ้าง `image_path` เดิม ไม่ก๊อปไฟล์) → การเก็บกวาดไฟล์ตอน save ของ PMSetup เช็ค `jig_checkpoints` ก่อนลบทุกครั้ง (ไฟล์ที่แผนกอื่นยังอ้างอยู่ = ไม่ลบ)

- **DEPT_LABEL (`src/lib/pmSchedule.js`) เปลี่ยนชื่อแสดงผลให้ตรงฝั่งแจ้งซ่อม** (MTN/JIG MTN/DIE MTN/PRODUCTION แทน "ซ่อมบำรุง/Die Maintenance/ฝ่ายผลิต") · key เดิมคงไว้
- **MtnRepair dropdown "แจ้งถึงทีมช่าง"/ฟิลเตอร์/master ดึงจาก `pmTeamsSync().dept_name` (data-driven จาก `mtn_teams`) แล้ว (2026-07-24)** — เลิก hardcode `MTN_DEPTS` (เหลือเป็น fallback default ในลายเซ็น component เท่านั้น เท่ากับ `DEFAULT_TEAMS` ให้พฤติกรรมเดิมเมื่อ table ว่าง) · `loadPmTeams()` เรียกตอน mount → `setMtnDepts` แล้วส่งผ่าน `cp` ไปทุก sub-component · เพิ่ม/แก้ทีมที่ตาราง `mtn_teams` dropdown ตามทันที
> #### ⚠️ กฎเหล็ก — ทีมช่างเก็บเป็น "รหัส" แสดงเป็น "ชื่อ" (unify แล้ว 2026-08-06)
> เดิมมี **2 encoding ปนกัน**: ฝั่งใบซ่อมเก็บชื่อ (`mtn_orders.mtn_dept = 'JIG MTN'`) ฝั่ง PM เก็บรหัส (`checklists.department = 'jig_maintenance'`) → เทียบ/join ข้ามฝั่งตรงๆ ไม่ได้ ต้องพึ่ง normalize ตลอด
> **รวมเป็นรหัส (`mtn_teams.key`) หมดแล้วทั้ง 2 project** — migration `20260806_unify_team_encoding_dr.sql` + `_main.sql` (**apply แล้ว**): DR = `mtn_orders.mtn_dept`/`returned_from_dept`, `mtn_technicians.dept`, `mtn_labor_rates.dept`, คอลัมน์ `team` ทุกตัว · Main = `telegram_channels.team`, `profiles.mtn_teams[]`
> - **เหตุผล:** ชื่อทีมเปลี่ยนได้ (เคยเปลี่ยน PRODUCTION → "AM (ผลิตตรวจเอง)") ถ้าเก็บชื่อ ข้อมูลเก่ากำพร้าทันที — หลักเดียวกับ role / process_type / line_type ทั้งระบบ
> - **เขียน DB = `teamKeyOf(x)` เสมอ · แสดงผล = `deptNameOf(x)` เสมอ** (`src/utils/mtnTeams.js`) · dropdown ใช้ `teamOptions()` (`value` = key, ข้อความ = ชื่อ) หรือ `<TeamOpts>` ใน MtnRepair — **ห้ามเอาชื่อทีมไปเก็บลง DB อีก**
> - `teamForItem` / `teamForSection` / `teamsForUser` / `MTN_TEAMS` **คืน key ทั้งหมดแล้ว** (เดิมคืนชื่อ)
> - helper ยัง normalize ชื่อ→รหัสต่อไป (ข้อมูลที่ export/พิมพ์ไว้ก่อน หรือคนกรอกมือ อาจยังเป็นชื่อ) — **ห้ามถอด `teamKeyOf` ออกเพราะคิดว่า data สะอาดแล้ว**
> - **✅ edge function deploy แล้ว (2026-08-06)** — `send-mtn-notification` v7 + `mtn-daily-summary` v3 (`verify_jwt=false` ทั้งคู่ตามเดิม — **client เรียกโดยไม่ส่ง token ถ้าตั้ง true จะพังทั้งระบบแจ้งเตือน**) · จัดกลุ่มด้วย key เสมอ (ข้อมูลเก่าที่เป็นชื่อไม่แตกเป็นคนละกลุ่ม) + แปลงเป็นชื่อทีมตอนแสดงผ่าน `teamName()` · สรุปรายวันดึงชื่อสดจาก `mtn_teams` (เปลี่ยนชื่อทีมแล้วตามทันที) fallback ค่าเริ่มต้นถ้าดึงไม่ได้ · client ยังส่ง**ชื่อทีม**ใน payload แจ้งเตือน (`notifyMtn`) ซึ่งถูกต้องทั้ง edge เก่าและใหม่
- **ยังเหลือ:** UI จัดการทีม (เพิ่ม/แก้ row ใน `mtn_teams`) = future (ตอนนี้แก้ผ่านตาราง) — แต่ **`mtn_teams` apply จริงแล้ว** (ตรวจ 2026-08-06 · เอกสารเก่าเขียนว่ายังไม่ apply = ไม่จริงแล้ว)

> ### ⚠️ กฎเหล็ก — "ตัวตนอุปกรณ์ = ของกลาง · รายละเอียด = มุมมองของแต่ละทีม" (2026-08-06 · คำสั่ง user)
> ระบบช่าง **4 ทีมใช้ร่วมกัน** (MTN / JIG MTN / DIE MTN / PRODUCTION) — สิ่งที่ต้อง "ตรงกัน" มีแค่**ตัวตนของอุปกรณ์**
> `machines.id` / `machines.machine_no` / `jigs.id` / ชื่อเครื่อง = **ของกลางชุดเดียว ห้ามแตกตามทีม**
> (ไม่งั้นเครื่องเดียวกันกลายเป็นคนละตัวในสายตาแต่ละทีม → สืบประวัติข้ามทีมไม่ได้ ซึ่งคือหัวใจของระบบซ่อมบำรุงรวม)
> **แต่ "รายละเอียด" อื่นเป็นมุมมองเฉพาะทีม ต้องแยก** — JIG มอง Locator/Clamp/Gripper ชำรุด · DIE มองแม่พิมพ์บิ่น/สึก · MTN มองมอเตอร์/อินเวอร์เตอร์
>
> **วิธีแยก: คอลัมน์ `team` แบบ nullable — `null`/ว่าง = 🌐 ใช้ร่วมทุกทีม (common)**
> (pattern เดียวกับ `lpa_questions.line_name` null = ข้อ common) · ค่าใช้ `mtn_teams.key` · กรองผ่าน **`filterByTeam(rows, team)` / `inTeamScope()` ใน `src/utils/mtnTeams.js` จุดเดียว — ห้ามเขียนเงื่อนไขกรองทีมเอง** (normalize ให้แล้ว รับทั้ง key `jig_maintenance` และ label `JIG MTN`)
>
> | ระดับ | ตาราง | มิติทีม |
> |---|---|---|
> | **ของกลาง (ห้ามแยก)** | `machines`, `jigs`, `mtn_teams`, `pm_facility_areas` | — ไม่มีโดยตั้งใจ |
> | **มุมมองทีม** | `mtn_problem_types`, `mtn_item_types`, `mtn_repair_types`, `mtn_spare_categories`, `pm_checkpoint_categories`, `pm_checking_methods` | `team` (เพิ่ม 2026-08-06 · migration `20260806_mtn_master_team_scope.sql`) |
> | | `mtn_technicians`, `mtn_labor_rates` | `dept` (มีอยู่เดิม) |
> | | `mtn_spare_parts`, `mtn_rack_maps`, `pm_coordination_tasks` | `team` |
> | | `checklists` | `department` — **1 เครื่องมีได้หลาย checklist คนละทีม** (ดูกฎ checklist ownership) |
> | | `mtn_orders` | `mtn_dept` (label) |
> | **derive เอา ไม่ต้องมีคอลัมน์** | `inspections`, `inspection_results`, `jig_checkpoints`, `pm_plans`, `pm_plan_deferrals/reminders` | ← `checklists.department` |
> | | `mtn_order_parts`, `mtn_stock_txns`, `mtn_spare_usage_monthly` | ← part/order |
> | | `mtn_rack_cells` | ← `mtn_rack_maps.team` |
> | | `pm_facility_points` | ← jig |
>
> **จุดที่ต้องกรอง (ทำแล้ว):** ⚙️ ข้อมูลหลัก → `SimpleList` มีแถบเลือกทีม + ตั้งทีมรายแถว (นับ "ซ่อน N รายการของทีมอื่น" ไม่ให้หายเงียบ) · **ฟอร์มแจ้งซ่อม** ชนิดอุปกรณ์/ลักษณะปัญหา กรองตามทีมที่แจ้งถึง + **ล้างค่าที่เลือกไว้เมื่อเปลี่ยนทีมแล้วค่าเดิมไม่อยู่ในลิสต์** (กฎ cascade §5.3) · **ขั้นรับงาน** ประเภทงานซ่อมกรองตามทีมของใบ · **คลังอะไหล่** dropdown หมวดกรองตามทีม + ตั้งทีมของหมวดได้ · **PM Setup** จัดการประเภทจุดตรวจ/วิธีตรวจ (`TaxonomyManagerModal` รับ prop `teams` → มี dropdown ทีม + badge บอกว่าแถวไหนของทีมไหน · ว่าง = 🌐 ทุกทีม แบบเดียวกับ `equip_types` ที่มีอยู่เดิม) · **แท็บ 🔧 ประเภทงานซ่อม** ใน ⚙️ ข้อมูลหลัก (เดิมไม่มี UI เลย แก้ได้ทางตารางอย่างเดียว — รหัสย่อของประเภทเป็นส่วนหนึ่งของเลข MO เปลี่ยนแล้วมีผลกับใบที่ออกเลขใหม่เท่านั้น)
> **⚠️ หมายเลขเครื่องใน dropdown ห้ามกรองตามทีม** — ของกลาง ทุกทีมต้องอ้างเครื่องเดียวกันได้
> #### ⚠️ ใบซ่อมเก็บ "ชื่อ" ของ taxonomy เป็น snapshot — เปลี่ยนชื่อ master ต้องถามก่อน (2026-08-06)
> `mtn_orders` เก็บ **ข้อความ** ของ `item_type` / `problem_characteristic` / `problem_detail` / `repair_type` / `assigned_to`
> (ไม่ใช่ id) — **ตั้งใจ** ตาม pattern snapshot เดียวกับ `lpa_audit_answers.question_text`, `ojt_training_attendees.emp_name`:
> ใบเก่าต้องอ่านออกเหมือนวันที่แจ้ง แม้ master ถูกแก้/ลบทีหลัง
> **แต่ KPI พาเรโต้จัดกลุ่มด้วยข้อความ** (`byChar[o.problem_characteristic]`) → เปลี่ยนชื่อใน ⚙️ ข้อมูลหลัก **กราฟแตกเป็น 2 แท่งทันที**
> → แก้ชื่อในตาราง `NAME_CASCADE` (MtnRepair.jsx) จะ**ถามก่อน**ว่าให้ใบเก่าตามไปด้วยไหม (ตกลง = รวมกลุ่มเดียว · ยกเลิก = คงประวัติเดิม)
> **ห้ามเขียนทับประวัติเงียบๆ** และ **เพิ่มฟิลด์ taxonomy ใหม่ที่ใบซ่อมเก็บเป็นชื่อ ต้องมาเติมใน `NAME_CASCADE` ด้วย**
> (ทางเลือกระยะยาวถ้าอยากเลิกพึ่งข้อความ: เพิ่มคอลัมน์ `*_id` คู่กับ snapshot แล้วให้ KPI จัดกลุ่มด้วย id — ยังไม่ทำ)
>
> #### ⚠️ กฎเหล็ก — master ของทีมช่าง "ใครเป็นเจ้าของ คนนั้นแก้" (2026-08-11 · คำสั่ง user)
> เดิมใครมีสิทธิ์ `mtn_repair:manage_master` (admin/manager/**ทุกคน role `mtn`**) **แก้ได้ทุกแถวของทุกทีม** — MTN เข้าไปเปลี่ยนชื่อของ DIE MTN ได้ · ลบของ JIG ได้ · แถว 🌐 ของกลางแก้ทีเดียวกระทบทุกทีม (user เทียบกับเคส "แย่งกันตั้งเลข MAT")
> **กติกาใน `SimpleList` (⚙️ ข้อมูลตั้งต้น):**
> - แถว **ของทีมตัวเอง** (`profiles.mtn_teams`) → แก้/ลบ/ย้ายทีมได้
> - แถว **ของทีมอื่น** → อ่านอย่างเดียว (input readOnly + 🔒 ดูอย่างเดียว + tooltip บอกว่าเป็นของทีมไหน)
> - แถว **🌐 ใช้ร่วมทุกทีม (`team` null)** → **admin/manager เท่านั้น** — แก้ทีเดียวกระทบทุกทีม
> - **เพิ่มรายการใหม่**: คนทีมเดียวเพิ่มได้แต่ของทีมตัวเอง (dropdown ตัด 🌐 ออก) · สร้างของกลางได้เฉพาะหัวหน้า
> - **⚠️ fallback บังคับ: user ที่ยังไม่ได้ตั้ง `mtn_teams` = ไม่ล็อก** (แสดงแถบเตือนแทน) — ไม่งั้นวันที่ deploy ช่างที่ยังไม่ถูกตั้งทีมจะแก้อะไรไม่ได้ทั้งระบบ · ตั้งทีมที่ `/add-user`
> - **เปลี่ยนทีมของแถว = confirm เสมอ ห้ามเงียบ** — ของหายจากลิสต์ทีมเดิมทันที (เคสจริง: ติ๊กของเดิมเป็น JIG แล้วทีม MTN เหลือชนิดอุปกรณ์ตัวเดียว)
> - **`cascadeRename` บอก breakdown รายทีม** (ใบไหนของทีมไหน) + เตือนพิเศษเมื่อกระทบหลายทีม — เขียนทับประวัติข้ามทีมคือความเสี่ยงที่แรงที่สุดของหน้านี้
> - **ที่กันไว้อยู่แล้ว:** ลบ = soft delete (`is_active=false` ใบเก่ายังอ่านออก กู้ได้) · `mtn_item_types`/`mtn_problem_types`/`mtn_spare_categories` อยู่ใน `DR_AUDIT_TABLES` → `audit_log` รู้ว่าใครแก้
> - **📜 แท็บ "ประวัติการแก้ไข" ใน ⚙️ ข้อมูลตั้งต้น (2026-08-11)** — `MasterAuditLog` อ่าน `audit_log` ฝั่ง DR (300 รายการล่าสุด · กรองตามตาราง) โชว์ **ใคร/เมื่อไหร่/ค่าเก่า → ค่าใหม่** รายฟิลด์ · actor มาจาก `updated_by_name` ที่ wrapper ใน `supabaseClient.js` ฝังให้ (DR เป็น anon ไม่มี `auth.uid()`) · เพิ่มตาราง master ใหม่เข้าแท็บนี้ = เติมใน `AUDIT_TABLES` + ต้องอยู่ใน `DR_AUDIT_TABLES` ด้วย
>
> - **ใช้กติกาเดียวกันแล้วที่ `TaxonomyManagerModal`** (ประเภทจุดตรวจ/วิธีตรวจ ใน PM Setup — `pm_checkpoint_categories`/`pm_checking_methods` ก็มีคอลัมน์ `team`) · รับ prop `role` + `myTeams` (จาก `teamsForUser`) · **จุดใหม่ที่ reuse component นี้กับตารางที่มี `team` ต้องส่ง 2 prop นี้ด้วย** ไม่งั้นกลับไปแก้ข้ามทีมได้เหมือนเดิม
>
> **เพิ่ม master ใหม่ในระบบช่าง ให้ถามก่อนว่า "ของกลางหรือมุมมองทีม"** — ถ้าเป็นมุมมองทีมต้องมีคอลัมน์ `team` + กรองด้วย `filterByTeam` + **ล็อกตามเจ้าของแบบเดียวกัน** ตั้งแต่แรก
> **`teamForItem(name, itemRows)` เป็น data-driven แล้ว** — อ่าน `mtn_item_types.team` ก่อน แล้วค่อย fallback เดาจากชื่อ (JIG→JIG MTN ฯลฯ) ที่ hardcode ไว้เดิม
> **⚠️ backfill เป็น `null` ทั้งหมดโดยตั้งใจ = ทุกทีมยังเห็นทุกแถวเหมือนก่อน apply** — การไล่ติ๊กว่าแถวไหนของทีมไหนเป็นงาน "จัดข้อมูล" ทำผ่าน UI ไม่เดาให้ใน migration
>
> #### ⚠️ ลิสต์ตั้งต้นของระบบแจ้งซ่อมเป็นของ JIG MTN ล้วน — ทีมใหม่ต้อง seed ลิสต์ของตัวเอง (2026-08-10)
> `mtn_item_types` / `mtn_problem_types` ที่ seed ไว้ตอนแรก (`20260714_mtn_work_order.sql`) **ยกมาจากระบบ AppSheet ของ JIG MTN ทั้งดุ้น** — ชนิดอุปกรณ์ 7 ตัวเป็น JIG/ROBOT/CONVEYOR/NUT FEEDER · ลักษณะปัญหา 21 ตัวเป็นเรื่อง jig fixture/โรบอท/เซนเซอร์
> → **ทีม DIE MTN เปิดฟอร์มแจ้งซ่อมแล้วไม่มีอะไรตรงกับงานตัวเองเลย** (ทีมงานแจ้งเข้ามาเอง 2026-08-10) · ทีม MTN (เครื่องจักร) ก็มีอาการเดียวกัน — ยังไม่มีลิสต์มอเตอร์/อินเวอร์เตอร์/ระบบไฮดรอลิก
> - **แม่พิมพ์ seed แล้ว** — `20260810_mtn_die_master_lists.sql` (DR): ชนิดอุปกรณ์ 5 (DIE TANDEM/PROGRESSIVE/TRANSFER/SINGLE/SET — **ขึ้นต้น "DIE" ทุกตัว** เพื่อให้ `teamForItem` fallback เดาทีมถูกแม้คอลัมน์ team ยังไม่ apply · ชนิดอิง `die_sets.kind` ที่มีจริง) + ลักษณะปัญหา 22 (คมตัด → อาการที่ชิ้นงาน → การไหลของเศษ → ชิ้นส่วนกลไก → ระบบประกอบ) ทั้งหมด `team='die_maintenance'`
> - **ไม่ seed "อื่นๆ" ซ้ำ** — ใช้แถว `อื่นๆ` เดิมที่เป็น common ร่วมกัน ไม่งั้นทีมเดียวเห็น "อื่นๆ" สองตัว
> - **⚠️ seed อย่างเดียวยังไม่พอที่จะให้ลิสต์สั้นลง** — แถวเดิม 28 ตัวยัง `team=null` (common) จึงติดมาในลิสต์ทุกทีมเสมอ (user เปิดฟอร์มจริงแล้วเจอ: เลือก DIE MTN ยังขึ้น JIG/ROBOT/STATIONARY ครบ) → **`20260810_mtn_split_lists_by_team.sql` (apply แล้ว 2026-08-10)** ติ๊กของเดิมเป็น `jig_maintenance` + seed ลิสต์ทีม MTN (เครื่องจักร 9 ชนิด · ปัญหา 13)
>   - **⚠️ 2 ก้อนนี้ต้องรันคู่กันเสมอ ห้ามรันก้อนติ๊กอย่างเดียว** — โยน JIG/ROBOT/STATIONARY/NUT FEEDER ไปเป็นของ JIG แล้ว **ทีม MTN เหลือชนิดอุปกรณ์แค่ `CONVEYOR` ตัวเดียว** ซึ่งเป็น required field = แจ้งซ่อมเครื่องจักรไม่ได้เลย · **ติ๊กของทีมหนึ่ง = ต้องเช็คเสมอว่าทีมที่เหลือยังมีของพอใช้ไหม**
>   - คงเป็น 🌐 ของกลางโดยตั้งใจ: `CONVEYOR` · เซนเซอร์ชำรุด · กระบอกลม · ลมรั่ว · ระบบไฟฟ้า · เครื่องมาร์ค · Poka-yoke · อื่นๆ (เจอได้ทุกทีม — ผูกทีมใดทีมหนึ่งไม่ได้)
>   - ผลหลัง apply: DIE MTN เห็น 6 ชนิด · JIG MTN 7 (เท่าเดิม ไม่มีอะไรหาย) · MTN 10
>
> #### ⚠️ ช่อง "หมายเลขเครื่อง" ในฟอร์มแจ้งซ่อม ต้องแยกตามชนิดอุปกรณ์ (2026-08-10)
> **บั๊กที่เจอจริง:** เลือกทีม DIE MTN + ชนิดอุปกรณ์ `DIE SINGLE` แล้วช่องหมายเลขเครื่อง**ขึ้นแต่เครื่องจักร** (`HDF-01`) ไม่มีแม่พิมพ์ให้เลือกเลย — ต้นเหตุ 2 ชั้น:
> 1. `loadMasters` **ไม่ได้ select `equipment_kind`** → แยกแม่พิมพ์ (262) ออกจากเครื่องจักร (214) ไม่ได้ ทั้งที่อยู่ตาราง `machines` เดียวกัน
> 2. `lineMachines` กรอง `m.line_name === f.line_name` เสมอ แต่ **แม่พิมพ์ผูก `line_name` เป็นชื่อกลุ่มเครื่องปั๊ม** (`LINE A ( 800 Ton )`) ซึ่ง**ไม่มีใน `production_lines`** → กรองด้วยไลน์ที่เลือกในฟอร์มไม่มีวันเจอแม่พิมพ์
>
> **กติกา:** `wantDie` (ชนิดอุปกรณ์ขึ้นต้น `DIE` · หรือทีม `die_maintenance` ตอนยังไม่เลือกชนิด) → ลิสต์ **แม่พิมพ์ทั้งหมด ไม่กรองไลน์** (แม่พิมพ์ถอดย้ายเครื่องได้ ไลน์ไม่ใช่ตัวจำกัด) + label เปลี่ยนเป็น "หมายเลขแม่พิมพ์ (N ตัว · ทุกไลน์)" · ไม่ใช่งานแม่พิมพ์ → **ตัด `die` ออกจากลิสต์เครื่องจักร** (เดิมปนกันมาตลอด) · ทะเบียนว่าง = เตือนสีส้มชี้ไป `/die-registry` ไม่ปล่อยเงียบ
> **จุดใหม่ที่มี picker เลือกอุปกรณ์ ต้องถามก่อนว่า "ชนิดไหน" แล้วกรองด้วย `equipment_kind` — ห้ามกรองด้วย `line_name` อย่างเดียว** (สมมติฐาน "อุปกรณ์ผูกกับไลน์" ใช้ไม่ได้กับแม่พิมพ์)
> - **เพิ่มลิสต์ให้ทีมใหม่ ทำที่ `/mtn-repair` → ⚙️ ข้อมูลตั้งต้น ได้เลยไม่ต้องแก้โค้ด** (SimpleList มีตัวกรองทีม + ติ๊กทีมรายแถว) — migration ใช้เมื่อ seed ก้อนใหญ่ทีเดียว

> ### ⚠️ กฎเหล็ก — "ชนิดอุปกรณ์" เป็น **แกน** ไม่ใช่ **ตาราง** · แยกหน้าจอได้ ห้ามแยกฐานข้อมูล (2026-08-10)
> **ปัญหาที่เจอ:** `machines` มี 505 แถว active แต่ **262 แถวเป็นแม่พิมพ์ ไม่ใช่เครื่องจักร** (คีย์ปนกันมาตั้งแต่ต้นเพราะไม่เคยมีแกน "ชนิด") → ทะเบียนเครื่องจักรอ่านไม่รู้เรื่อง · dropdown เลือกเครื่องมีแม่พิมพ์ปน · สถิติจำนวนเครื่องผิด
> **คำถามที่ถูกถามและคำตอบ: "แยกเป็น 3 ตาราง machines/jigs/dies ดีไหม" → ไม่**
> `machines` เป็น **ตารางตัวตนของอุปกรณ์** อยู่แล้ว — `machine_no` unique และ **MO / downtime / prod_orders / QR / ผังเครื่องจักร อ้างเลขนี้รวม 12+ ตาราง** · แยกตาราง = ทุกตารางที่อ้างอุปกรณ์ต้อง polymorphic (`equipment_type + equipment_id`) + QR ต้องมี prefix ต่อชนิด + **ทำลายหัวใจของระบบซ่อมบำรุงรวมคือ "เปิดอุปกรณ์ตัวนี้ เห็นประวัติทั้งหมด"**
> → ใช้โมเดล **SAP PM / Maximo: 1 ตัวตน + แกนชนิด + ตารางส่วนขยายต่อชนิด**
> - **`machines.equipment_kind`** (`machine`/`die`/`jig`/`facility` · null = machine) — source of truth `src/utils/equipmentKinds.js`
> - **⚠️ คนละแกนกับ `equipment_category`** (`production`/`facility` = **ที่ตั้ง/การใช้งาน**) — เครื่องจักรอยู่ facility ได้ · แม่พิมพ์อยู่ production **สองแกนตัดกัน ห้ามยุบรวม**
> - **ส่วนขยายต่อชนิด:** `equipment_die` (1:1 กับ machines — `machine_id` เป็นทั้ง PK และ FK · OP/ตัน/shot/regrind) · ชนิดอื่นเพิ่มตารางส่วนขยายแบบเดียวกัน **ห้ามยัดคอลัมน์เฉพาะชนิดลง `machines`**
> - **`die_sets`** = ชุดแม่พิมพ์ (**1 พาร์ท = 1 ชุด**) · `kind` tandem/progressive/transfer/single · `pieces_per_stroke` (งานคู่ LH/RH = 2 — ต่อกับกฎ SCADA "1 stroke ≠ 1 ชิ้น") · `mat_no` โยง Product Master
> - **`die_op_types`** = master กระบวนการ (13 ค่า data-driven) — เพิ่มกระบวนการใหม่ไม่ต้องแก้โค้ด
> - **แยก "หน้าจอ" ได้เต็มที่:** `/machine-database` default กรอง `equipment_kind='machine'` · `/die-registry` เป็นมุมมองแม่พิมพ์ — **แยกหน้าจอ ≠ แยกฐานข้อมูล**
> - **`jigs.equipment_type` ของ "แถวเงา" ต้อง derive จาก `machines.equipment_kind` เสมอ** (`jigEquipTypeOf`) — เดิมตั้งอิสระจากเครื่องจริงจนเพี้ยน (เครื่องอัดลม/คูลลิ่งทาวเวอร์ 9 ตัวกลายเป็น `jig`)
> - **backfill 2026-08-10:** machine 214 · die 262 · facility 29 · ไม่ระบุ 0 · ชุดแม่พิมพ์ 92 (tandem 52 · progressive 26 · single 14) ผูกแล้ว 259/262 — เลือก **"ติดป้าย" ไม่ใช่ "ย้ายตาราง"** reference ทุกเส้นยังอยู่ครบ rollback ง่าย · **ฟิลด์ที่แกะจากชื่อไม่ออกปล่อยว่าง ห้ามเดา** (ยังไม่ระบุตัน 180 · ไม่ระบุ OP 49 · ไม่ระบุกระบวนการ 90) → เป็น worklist ในหน้า `/die-registry` ไม่ใช่ bug
> - migration: `20260810_equipment_kind_and_die_master.sql` · `20260810_backfill_dies_from_machines.sql` · `20260810_sync_shadow_jig_equipment_type.sql` (**apply แล้วทั้งหมด 2026-08-10**)

### Direct / Indirect Labor + รวมช่างเข้าฐานพนักงาน (2026-07-22)

**คนทุกคนอยู่ที่ `employees` ที่เดียว** — operator (ฝ่ายผลิต) และช่างซ่อมบำรุง เป็น employee เหมือนกัน ต่างกันแค่ **ประเภทแรงงาน** และ **section**

- **ประเภทแรงงานตั้งที่ผังองค์กร** (`org_nodes.labor_type` — 'direct'/'indirect') ตั้งได้ทั้ง **section และ department** จาก OrgSetup · **⚠️ ช่างส่วนใหญ่อยู่ระดับแผนก (department) ไม่ใช่ section** → พนักงาน derive **จาก department ก่อน แล้ว section** · seed default (section): ผลิต (PD*/GOR/HYDRO/ASSY/LINE ฯลฯ) = direct, ที่เหลือ = indirect · migration `20260722_org_labor_type.sql`
- **derive ผ่าน `src/utils/laborType.js`** (`buildLaborMap(orgNodes)` รวมทั้ง section+department → `laborTypeOf(section, department, laborMap)` เช็คแผนกก่อน · fallback heuristic: ชื่อเข้าเกณฑ์สนับสนุน MTN/JIG/DIE/QA/คลัง/ธุรการ/ขาย = indirect ก่อน แล้วเกณฑ์ผลิต = direct) — **ห้าม hardcode ว่า node ไหน direct/indirect ในหน้า** อ่านจาก org_nodes เสมอ
- แสดง/กรองในหน้า `/operator` (badge 🔧/🗂️ + ปุ่มกรอง Direct/Indirect) — direct = 🔧 เขียว, indirect = 🗂️ ฟ้า
- **ช่างซ่อมบำรุง = พนักงานแผนก/ส่วน MTN/JIG/DIE** (indirect) มี `employee_skills` เหมือน operator (สกิลซ่อมบำรุง) · สร้างแผนก/ส่วน MTN/JIG/DIE ใน OrgSetup (ตั้ง labor_type = indirect) แล้วลงทะเบียนช่างที่ Register/operator ปกติ
- **MtnRepair dropdown "มอบหมายช่าง" ดึงจาก employees ทีมช่าง** (`teamForSection` ใน `mtnTeams.js` map **department ก่อน แล้ว section** →ทีม) + รวมกับ `mtn_technicians` เดิม (ช่างเฉพาะกิจนอกฐานพนักงาน — fallback ไม่ลบ) · **ช่างเดิมทั้ง 14 คน (JIG MTN 7 + MTN 7) ย้ายเข้า employees แล้ว 2026-07-22** (รหัสชั่วคราว TECH-JIG-xx/TECH-MTN-xx รอเติมรหัสจริง · mtn_technicians ทุกแถวถูกปิด is_active=false เหลือไว้เป็นประวัติ — migration `20260722_migrate_technicians_to_employees.sql`) · `assigned_to` ยังเก็บเป็น **ชื่อ (text)** เหมือนเดิม (backward-compatible) · ⚙️ MasterTab: ช่างจากฐานพนักงานแสดง read-only (แก้ที่หน้าพนักงาน) เพิ่มได้เฉพาะช่างเฉพาะกิจ · **MtnRepair อ่าน employees ผ่าน client `supabase` (Main, authenticated)** ไม่ใช่ supabaseDR

---

## Role System

> **role = "ชุดสิทธิ์ใช้ระบบ" ไม่ใช่ตำแหน่งงาน (2026-07-10)** — ตำแหน่งจริงในโรงงาน
> (ผู้จัดการฝ่าย/หัวหน้าแผนก/หัวหน้าส่วน/วิศวกร/เจ้าหน้าที่/ช่างเทคนิค ฯลฯ) เก็บที่ `profiles.position`
> (text อิสระ มี datalist แนะนำใน AddUser) ใช้แสดงตัวตน/รายงาน/ลายเซ็นเท่านั้น **ไม่มีผลต่อ permission**
> ตัวอย่าง: คน QA ทุกระดับ (technician→manager) ใช้ role `qa` เหมือนกันถ้าทำงานในระบบเหมือนกัน
> ต่างกันแค่ position · ถ้าวันหน้าระดับต่างกันต้องได้**สิทธิ์**ต่างกันจริง ค่อยเพิ่ม role ใหม่ + แถวใน
> role_permissions (ระบบรองรับ) — **ห้ามเพิ่ม role ตามชื่อตำแหน่งโดยที่ชุดสิทธิ์ไม่ต่างจาก role เดิม**
>
> **ตัวเลือก "ตำแหน่งงาน" (position) รวมศูนย์ที่ `src/utils/positions.js` จุดเดียว (2026-07-22)** — master list ไทยชุดเดียวใช้ร่วมทั้ง **พนักงาน (`employees.position` — Register/operator)** และ **user (`profiles.position` — AddUser)** · `positionOptionsWith(current)` เติมค่าเก่านอกลิสต์ (เช่น Operator/Leader/Technician/Engineer) ไว้หัวลิสต์ให้ยังเลือก/แสดงได้ไม่หาย · AddUser ยังมี "อื่นๆ (พิมพ์เอง)" · **ห้าม hardcode ลิสต์ position ซ้ำในหน้าใดๆ** เพิ่ม/แก้ตำแหน่งแก้ที่ไฟล์นี้ที่เดียว (เดิมกระจาย 3 หน้า ลิสต์ไม่ตรงกัน — operator/Register เป็นอังกฤษ, AddUser เป็นไทย)

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
- **⚠️ กับดัก Supabase ตัด 1000 แถว/query (เจอจริง 2026-08-03):** `role_permissions` โตเกิน 1000 แถวแล้ว (1,135) — query ที่ไม่ `.range()` ได้แค่ 1000 แถวแรก **แถวที่ seed ทีหลัง (เช่น bucket `dept_admin`) หายเงียบ** = สิทธิ์ใน DB ถูกแต่ปุ่ม/เมนูไม่โผล่ (fail-closed) · แก้แล้ว: `loadPermissions()` + หน้า `/permissions` ดึงแบบแบ่งหน้า · **โค้ดใหม่ที่ select ตารางนี้ (หรือตารางใดที่โตได้เกิน 1000) ต้อง paginate เสมอ**
- `admin` bypass เสมอ (return true ทันทีไม่ query cache) กันกรณี config ผิดจนตัวเองเข้าไม่ได้
- แก้ได้จากหน้า `/permissions` (`src/pages/PermissionsManagement.jsx`) — ตาราง matrix role × permission key, toggle แล้ว upsert ทันที
- permission key รูปแบบ `page:/route` สำหรับสิทธิ์เข้าหน้า, `resource:action` สำหรับสิทธิ์ทำงานในหน้า (เช่น `products:create`, `oee:set_target`) — โหลดจาก `permission_catalog` แสดงในแท็บ "สิทธิ์การทำงาน"
- **🛡️ แอดมินหน่วยงาน (Department Admin) — 2 ชั้นต่อหน่วยงานสนับสนุน (2026-08-03 · คำสั่ง user):** แยก "คนใช้งาน" (ดู/ใช้ แต่แก้ไม่ได้) ออกจาก "แอดมินหน่วยงาน" (แก้ master/ตั้งค่า/อนุมัติ — เฉพาะ scope หน่วยงานตัวเอง ไม่ใช่ admin ระบบ) โดย**ไม่เพิ่ม role รายหน่วยงานเป็นสิบตัว**
  - **โมเดล = flag ต่อ user** `profiles.is_dept_admin` (migration `20260803_dept_admin.sql`) ซ้อนบน role เดิม · role เดิม (mtn/qa/sale/planner_store/supervisor/leader...) = **ชั้น user** · ติ๊ก flag = **ชั้นแอดมินหน่วยงาน**
  - **กลไก:** `dept_admin` เป็น **"bucket สิทธิ์" ใน `role_permissions`** (เพิ่มใน enum `user_role` แต่**ไม่ assign เป็น base role ให้ใคร**) · `permissions.js` module-level `_deptAdmin` (ตั้งจาก `App.jsx fetchProfile` ผ่าน `setDeptAdmin` เหมือน `setDrActorName`) → `hasPermission(key, role)` เช็ค base role ก่อน **แล้ว fallback bucket `dept_admin:${key}`** ถ้า flag เปิด — **ไม่ต้อง thread flag ผ่าน `can()` หลายร้อยจุด** · bucket มีเฉพาะ **action (ไม่มี `page:*`)** → ไม่ปลดล็อกหน้าใหม่ (แอดมินหน่วยงานเห็นหน้าตาม base role เท่านั้น) — **บังคับในโค้ดแล้ว** (`hasPermission` ข้าม bucket เมื่อ key ขึ้นต้น `page:` · QC audit 2026-08-03 — เดิมพึ่งความถูกต้องของ seed อย่างเดียว ซึ่งเสี่ยงเพราะ migration หน้าใหม่ที่ seed ด้วย `enum_range` จะแจก `page:*` ให้ทุก role ในอีนัมรวม `dept_admin`) · scope ยังจำกัดตาม section/ทีมของ base role
  - **ตั้งค่า "แอดมินหน่วยงานทำอะไรได้" ที่ `/permissions` คอลัมน์ 🛡️ แอดมินหน่วยงาน** (data-driven · seed default = action ทั้งหมดที่ manager ทำได้) · **ติ๊ก flag ที่ `/add-user`** (checkbox "เป็นแอดมินหน่วยงาน" โผล่ทุก role ยกเว้น admin/display · เขียน best-effort เหมือน mtn_teams) · `roleMeta.js`: `dept_admin` มี `bucket:true` → `ROLE_OPTIONS` (ตัวเลือก base role) ตัดออก, `PERMISSION_COLUMN_ROLES` รวมไว้เป็นคอลัมน์
  - **ผล:** เช่น planner_store (base role ไม่มี `products:edit`) เข้า Product Master/Kanban Std ได้แต่เดิม**แก้ไม่ได้** (ปุ่ม ✏️ แก้ไข gate ด้วย `can('products','edit')`) → ติ๊กแอดมินหน่วยงาน = ปุ่มแก้โผล่ · **จุดใหม่ที่อยากให้แยก user/แอดมิน ให้ gate ด้วย `can(resource,action)` ตามปกติ** — flag จัดการ tier ให้เอง
  - **ยังไม่ทำ (phase 2):** "จัดการ user ในหน่วยงานตัวเอง" (เพิ่ม/แก้ user รายหน่วยงาน) — ต้องแก้ Edge Function `create-user`/`delete-user` (ตอนนี้ admin-only) · ตอนนี้แอดมินหน่วยงานได้ครบ **แก้ master/config + อนุมัติ workflow** แล้ว
- **legacy `manage_master_data` เกษียณแล้ว (2026-07-22)** — สวิตช์รวมเก่า (แทน `['admin','manager','supervisor'].includes(role)` hardcode ~10 ไฟล์) ถูกแตกเป็นสิทธิ์ย่อยครบแล้ว: `oee:set_target` (ปุ่ม 🎯 ตั้งเป้า OEE) · `ot_master:manage` (Report แผงจองรถ OT — สายรถ/งาน OT) · `management:assign_manpower` (ลากจัดกำลังคนบนผัง) · seed default = admin/mgr/sv เท่าเดิม (พฤติกรรมไม่เปลี่ยน) · migration `20260722_retire_manage_master_data.sql` · แถว `manage_master_data` เดิมใน role_permissions คงไว้แต่ไม่มีโค้ดอ่านแล้ว (เผื่อ rollback) — **ห้ามผูกฟีเจอร์ใหม่กับ manage_master_data อีก**
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
- **ข้อยกเว้นทางการ — `/factory-map` (ผังรวมโรงงาน) ไม่ scope โดยตั้งใจ ทุก role เห็นทั้งโรงงาน** (คำสั่ง user 2026-08-05 ปิดเคสจาก QC audit) — เป็นผังภาพรวมสำหรับจอ TV/ผู้บริหาร/ประชุม การกรองเหลือเฉพาะไลน์ตัวเองทำให้ "ภาพรวม" หมดความหมาย · **ห้ามเติม scope filter ให้หน้านี้** เว้นแต่ user สั่งเปลี่ยน · หน้าอื่นยังยึดกฎ scope ตามปกติ (รวมหน้าที่ deep-link ออกไปจากผัง เช่น Dashboard/MtnMachineLayout ซึ่ง gate ด้วย RoleRoute/scope ของตัวเองอยู่แล้ว)
- **⚠️ dropdown ก็ต้อง scope ไม่ใช่แค่ query (audit 2026-07-23):** `<select>` ที่ลิสต์ **ไลน์/ส่วนงาน/พนักงาน** ต้องกรองตาม scope เหมือนกัน (ไม่งั้น supervisor/leader เห็นไลน์ข้ามส่วนงานใน dropdown แม้ข้อมูลกรองแล้ว) · ปิดช่องโหว่ dropdown แล้ว: **DailyReport เปิดกะ** (leaf+optgroup ตาม `openScopeLineNames`), **Checkin** (แถบ section + ไลน์), **MtnRepair** ReportModal (ผ่าน `scopedLineObjs` ใน cp), **PmCoordination** PlanModal, **DailyPM** ทะเบียน (assign/move — เพิ่ม `scopedProdLines`) · ยังเหลือ (primary user = store/logistic ไม่ใช่ผลิต เลยยัง N/A): LineStock/RackCenter line filter — ถ้าให้ leader ใช้ตรงต้องเพิ่ม scope
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

> ### ⚠️ 4M ที่ระบบสร้างเอง ห้ามเข้าคิวอนุมัติเงียบๆ (2026-08-10)
> **เคสจริง:** พ.ค. 2026 มีตัวสร้าง 4M Man อัตโนมัติ (`[Auto] <ชื่อ> ประจำจุด <จุดงาน> เป็นครั้งแรก` · `created_by = null` · `requires_qa = true`) ยิงจากบั๊กการเทียบเกณฑ์สกิล — ออกมา **392 ใบใน 10 วัน** (18-27 พ.ค.) ทั้งที่ไม่ใช่การเปลี่ยนแปลงกำลังคนจริง · ตัวสร้างถูกแก้ไปแล้ว (มิ.ย. เป็นต้นมา = 0 ใบ) แต่ **323 ใบค้างคิวอนุมัติอยู่ 2 เดือนครึ่ง กลบใบจริง 19 ใบจนหัวหน้ามองไม่เห็นงานที่ต้องทำ** (แผงประชุมเช้า/`/dept-dashboard` โชว์ "รออนุมัติ QA 89")
> **ล้างแล้ว** — migration `20260810_void_stale_auto_4m_man.sql` (Main · apply แล้ว) ตั้ง 323 ใบเป็น `rejected` **ไม่ลบทิ้ง** (4M เป็นบันทึกคุณภาพ CQI-15/Changing Point — ลบแล้วสืบย้อนไม่ได้) · ฝัง**สถานะเดิม**ไว้ใน `reject_reason` → rollback ได้ตรงใบ (คำสั่งอยู่หัวไฟล์ migration) · ไม่แตะ `[Auto]` ที่ approved ไปแล้ว 69 ใบ และไม่แตะใบที่คนกรอกเองสักใบ
> **กฎที่ตกผลึก:**
> - **ตัวสร้าง 4M อัตโนมัติต้องมีเพดาน/ตัวนับ + จุดเฝ้าดู** — ยิงวันละหลายสิบใบต่อเนื่องเป็นสัปดาห์โดยไม่มีใครรู้ = บั๊กที่มองไม่เห็น · ก่อน insert อัตโนมัติ ให้เช็คว่ามีใบซ้ำของ (คน+จุดงาน+ไลน์) อยู่แล้วหรือยัง
> - **แยกใบที่ระบบสร้างออกจากใบที่คนกรอกให้เห็นในคิว** (คิวปนกันแล้วคนไม่กล้าเคลียร์ทั้งก้อน สุดท้ายค้างทั้งคู่) — ปัจจุบันแยกได้แค่ `created_by is null` + ข้อความ `[Auto]` ยังไม่มีคอลัมน์บอกที่มาจริงจัง
> - **เคลียร์คิวค้างจากบั๊ก = `rejected` + เหตุผลที่อ่านรู้เรื่อง ห้าม `delete` และห้าม `approved`** (approve = โกหกว่ามีคนพิจารณาแล้ว)
> - งานที่ค้างเกิน ~30 วันในคิวอนุมัติควรมีสัญญาณเตือน — ตอนนี้ยังไม่มี (ใบเก่าสุดที่เหลือ 81 วัน)

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
| **9** (เบอร์ 900 เช่น 90031601/2) | **เลขภายในตั้งเอง** (พาร์ทพิเศษ ยังไม่มี routing) | **ไม่ใช่เลข SAP จริง** — SAP ของโรงงานมีเฉพาะช่วง 100–700 · ทีมงาน**ตั้งใจ**ตั้งเบอร์ 900 ให้พาร์ทที่จะสร้างพิเศษซึ่งยังไม่มีระบบ routing ใน SAP (user ยืนยัน 2026-08-10) — **ห้ามไล่ "แก้" เป็นเลข SAP / ห้ามลบ** จนกว่าพาร์ทนั้นจะเข้าระบบ routing แล้ว user สั่งเปลี่ยนเลขเอง | ไหลตามที่ตั้งค่าใน stock_inflow_rules/การใช้งานจริง (ไม่เข้าเกณฑ์ prefix 1/2/3/5 อัตโนมัติ) |
| MB3B/RB3B… | เลขพาร์ทลูกค้า (Ford P/N) | ไม่ใช่ MAT SAP | ใช้เป็น key ชั่วคราวเมื่อจับคู่ mat ภายในไม่ได้ (เพิ่ม P/N ใน Product Master แล้วอัพโหลดใหม่เพื่อ map) |

- UI ฝั่ง Store (`LineStock.jsx` helper `isFgMat`): แถว FG ไม่มีปุ่ม "+ จ่าย" (โชว์ "🚚 หักผ่าน Delivery" แทน)
  และฟอร์มบล็อก type `issue` สำหรับ MAT ขึ้นต้น 1

> ### ⚠️ กฎเหล็ก — `parts_master` = ทะเบียนกลางของทุก mat (material master · 2026-08-06 คำสั่ง user)
> โมเดลเดียวกับ SAP Material Master + Views: **ตัวตนสินค้า (mat_no / ชื่อ / UOM / qty_per_pkg / supplier) อยู่ `parts_master` ที่เดียว ครอบทุกเบอร์ 1/2/3/5** (ข้อมูลจริง 287 รายการ ครบทุกเบอร์แล้ว) — ตารางอื่นเป็น "มุมมอง" ที่**เลือกจากทะเบียน** ไม่พิมพ์เลขใหม่เอง:
> - `dr_products` = **มุมการผลิต** (เฉพาะของที่ผลิตในไลน์: ไลน์/CT/p_no/pair_mat_no/process_type) — ฟอร์มเพิ่มสินค้าใน `/products` มีปุ่ม 🗂 เลือกจาก Parts Master (prefill mat+ชื่อ) + เตือนส้มเมื่อพิมพ์ mat ที่ไม่มีในทะเบียน (ไม่บล็อก)
> - `kanban_standards` = **มุมการดึง** (qty_per_kanban default = qty_per_pkg · แท็บ 🎴 ลิสต์จาก parts_master อยู่แล้ว) · `bom_items` = โครงสร้าง (picker จาก parts_master อยู่แล้ว) · Packaging เลือกจาก product (มุมส่งลูกค้า — ถูกแล้ว เพราะ pack คือเรื่องของ FG)
> - **"ชื่อสินค้า" parts_master เป็นเจ้าของที่เดียว** — ชื่อฝั่งทะเบียนละเอียดกว่า (มีเลขลูกค้า/ลูกค้ากำกับ) · sync ชื่อ dr_products ให้ตรงแล้ว + ลบ product ทดสอบ 100999/2000999 (migration `20260806_parts_registry_cleanup.sql` DR — apply แล้ว) · จุดใหม่ที่แก้ชื่อสินค้าให้แก้ที่ Parts Master ไม่แก้ที่ dr_products
> - **"รูปพาร์ท" ก็เป็นตัวตน → เจ้าของคือ parts_master เช่นกัน (2026-08-06):** backfill รูปจาก dr_products เข้าทะเบียน 20 mat แล้ว (migration `20260806_parts_master_image_backfill.sql` DR) · picker 🗂 เลือกจากทะเบียน = prefill รูปให้ฟอร์มสินค้าด้วย (เฉพาะเมื่อฟอร์มยังไม่มีรูป) · อัปรูปฝั่งไหน → เติมให้อีกฝั่งของ mat เดียวกัน**เฉพาะที่ยังว่าง** (fill-if-empty ไม่ทับของเดิม — ทำแล้วทั้ง 2 ทางใน ProductMaster.jsx) · **⚠️ URL รูปแชร์ไฟล์เดียวกันข้ามตาราง dr_products ↔ parts_master ได้ — guard ลบไฟล์เก่าตอนเปลี่ยนรูปต้องเช็คอีกตารางเสมอ** (count query ก่อน remove — ทำแล้วทั้ง 2 ฝั่ง ห้ามถอด ไม่งั้นเปลี่ยนรูปฝั่งหนึ่ง = รูปอีกฝั่งเป็นลิงก์ตาย)
> - **ลำดับลงข้อมูล: Parts Master ให้ครบก่อน → มุมมองอื่น "เลือก" ไม่ใช่ "พิมพ์ใหม่"**
> - **เลขชั่วคราวใน dr_products (SUB APRON: M6/M8/127/E024/"300xxx & 300xxx") ห้ามลบ** — ตรวจ 2026-08-06: ทุกตัวมีใบผลิตจริง (3-48 ใบ) บางตัวมี forecast/สต๊อก · ทางแก้คือ "เปลี่ยนเลข" เป็น SAP จริง (update mat_no + cascade prod_orders/kanban/stock/forecast ที่อ้างเลขเดิม) เมื่อ user หาเลขจริงมาให้ — ยังรออยู่ · **ส่วน 90031601/2 (HYDROFORM) ไม่ใช่เลขรอแก้** — เป็นเบอร์ 900 ที่ทีมงานตั้งใจตั้งเอง (ดูตาราง MAT ข้างบน · user ยืนยัน 2026-08-10)

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
- **⚠️ PI (Production) กับ PW (Withdrawal) ไม่คำนวณพาร์ทร่วมกัน — แยกด้วย `dr_products.process_type` ไม่ใช่เลข MAT (2026-08-03 · คำสั่ง user):** Production kanban สั่งไลน์**ปั๊ม/ผลิตเป็น lot** · Withdrawal เบิกถอน/ป้อนไลน์**ประกอบ** · **ห้ามแยกด้วยเลข MAT SAP** — งานปั๊มที่ขายตรงก็เป็น FG เบอร์ 1 ได้ (เลข MAT บอกไม่ได้ว่าปั๊มหรือประกอบ) · เกณฑ์จริง (`procMatchesTab` ใน KanbanCalcTab): Production = `process_type==='metal_forming'` · Withdrawal = `!== 'metal_forming'` (welding_assembly + พาร์ทที่ยังไม่ตั้ง process ซึ่ง default = welding_assembly) · `'common'` (ทุกกระบวนการ) = แสดงทั้ง 2 แท็บ · banner บนแต่ละแท็บนับ "ซ่อน N พาร์ทที่เป็นอีกกระบวนการ" (โปร่งใส ไม่ปล่อยหายเงียบ) + ชี้ให้ตั้ง process_type ที่ Product Master · **ถ้าพาร์ทปั๊มไม่ขึ้นแท็บ Production = process_type ยังไม่ตั้งเป็น metal_forming (data ไม่ใช่ logic)** — แก้ที่ `/products`
- **เดือน default = เดือนถัดไป** (`nextMonthKey` — planner คำนวณปลายเดือนสำหรับเดือนหน้า) · **วันทำงาน/เดือน ลิงก์ปฏิทินบริษัท** (`countWorkingDays`: จ-ศ − วันหยุด + เสาร์/อาทิตย์ที่มาร์ค `working` · แก้ทับได้) · Production เพิ่มช่อง ชม.ทำงาน/วัน (default 16) คิด available time
- **flow:** แก้ param ในตาราง (edit ชั่วคราว > param บันทึก `kanban_calc_params` > default จาก master) → ค่าคำนวณอัปเดตทันที → **Preview & Apply**
- **⚠️ param ที่เป็น "คุณสมบัติสินค้า" ต้องดึงจาก master ไม่ให้กรอกเองทุกเดือน (2026-08-03 · คำสั่ง user "ไม่ควรต้องมากรอกเอง"):** `paramOf` default chain (ใน `firstPos` = ตัวแรกที่ >0): **PKG (จำนวน/กล่อง)** = `parts_master.qty_per_pkg` → `kanban_standards.qty_per_kanban` · **CAP/ชม.** = `3600 ÷ dr_products.cycle_time_sec` · **LOT** = `kanban_standards.lot_size` → 1 · ที่เหลือ (เตรียม/ผันผวน/รอบส่ง/safety/process/setup) = นโยบายวางแผน เก็บใน `kanban_calc_params` ตอน Apply → prefill รอบหน้าเอง (ไม่กรอกซ้ำ) · **PKG ยังว่าง = master ไม่มีค่า (data ไม่ใช่ logic)** → กรอก `qty_per_kanban` ที่ Product Master · **⚠️ `qty_per_kanban` อยู่ตาราง `kanban_standards` ไม่ใช่ `dr_products`** (ห้าม select จาก dr_products = 42703 พังทั้ง tab) → เขียน `kanban_standards` (`min_qty`/`max_qty` = ชิ้น, `qty_per_kanban` = pkg, `total_kanban` = ใบ, `lot_size`) — **Store (LineStock) ดึง min/max ตรงนี้ต่อ = จุดเดียวที่ Store↔Planner sync** · param ที่ใช้จำลง `kanban_calc_params` (รอบหน้า prefill) · **export CSV** (Production แนบตารางสรุป capacity ท้ายไฟล์)
- **สรุปภาระการผลิต (Production):** Σ work-time/ไลน์ [(setup+lot×CT)×(order/lot)] เทียบ available (ชม./วัน×วันทำงาน) = **%load** ต่อไลน์ (<85 เขียว · 85–100 เหลือง · >100 แดง=เกิน capacity)
- **⚠️ กุญแจ sync = `mat_no` (เลข SAP ภายใน) เท่านั้น:** ตอนอัพโหลด forecast ระบบ map เลขพาร์ทลูกค้า → SAP ผ่าน **`p_no`** ใน `dr_products`/`kanban_standards` (normalize ตัดขีด/ช่องว่าง · FG ขึ้นต้น 1 ชนะ) · **จับคู่ไม่ได้ = เก็บเลขพาร์ทลูกค้าไว้ใน `mat_no` ไปก่อน** (`PlannerSales.jsx` insert: `mat_no: hit ? hit.mat_no : r.part`) → แถวนั้นคำนวณ kanban ไม่ได้ + Store/Production ที่ใช้เลข SAP จะไม่เห็น · **ปุ่ม 🔗 จับคู่เลข SAP** ในแท็บ (banner เตือน N พาร์ท) เขียน `p_no` ให้ dr_products (auto-map รอบหน้า) + re-point `customer_forecasts.mat_no` เดิม → ต้องเติม p_no ให้ครบ Store/Planner ถึง sync จริง · modal มี **auto-suggest จับคู่ด้วย base part** (`baseOfPart` — ตัด revision token ตัวท้าย ≤2 ตัว แล้วเทียบ p_no ที่มีในระบบ · เช่น forecast `MB3B 16C274 CE` ↔ dr `MB3B-16C274`) ตัวเดียวชัด = เติมให้อัตโนมัติ · กำกวมหลายตัว = โชว์ชิปเขียวให้กดเลือก · พาร์ทที่ไม่มีใน Product Master เลยต้องไปสร้างก่อน
- **⚠️ Order/Month รวม forecast source เดียว กัน double-count (2026-07-21):** `customer_forecasts.period_month` เก็บ 2 grain ปนกัน — EDI 830 = วันราย週 (`period_month = r.date`) · manual = ต้นเดือน (`monthFirst`) · ตอนรวม Order/Month ต่อ mat ถ้าบวกทุก row จะซ้ำเมื่อ mat มีทั้ง 2 source ในเดือนเดียว → **รวมเฉพาะ source เดียว: EDI 830 (official) ก่อน ไม่มีค่อยใช้ manual** (`fBySrc` ใน KanbanCalcTab `load()`) · weekly ที่คาบเกี่ยวขอบเดือนยังนับตามเดือนที่ `period_month` ตก (calendar-month bucket — accept ได้)
- **DB:** `kanban_calc_settings` (working_days/efficiency_pct/**hours_per_day**) · `kanban_calc_params` (per-part param + **calc_type/process_count/lot_qty/setup_time_sec** สำหรับ production) · migration `20260710_kanban_auto_calc.sql` + **`20260716_kanban_production_calc.sql`** (DR, additive) — ⚠️ ถ้ายังไม่ apply migration ตัวหลัง: หน้ายังคำนวณ/Preview/Apply เข้า kanban_standards ได้ปกติ แต่ param เฉพาะ production + hours_per_day จะยังไม่ถูกจำข้ามรอบ (โค้ด best-effort + toast เตือน)

---

## Daily Report — ออเดอร์ manual สำหรับไลน์ไม่มี kanban card (2026-07-12)

ไลน์บางไลน์ (เช่น HDF1 ที่ส่งงานต่อ LASER CUT 123) **ไม่มีเลข SAP order ให้สแกน** เปิด-ปิดใบแบบปกติไม่ได้:

- ปุ่ม "✍️ เปิดเป้า (ไม่มีบาร์โค้ด)" ข้างปุ่ม Scan เปิด Order — leader ตั้งเป้า (เลือกสินค้า + จำนวน) → สร้าง `prod_orders` ที่ `is_manual=true`, **`prod_no='MANUAL-YYMMDD-HHmmss-XX'`** (YYMMDD=วันงานของกะ · HHmmss=เวลากดเปิด · XX=สุ่ม 2 ตัว [อักษร/เลขไม่กำกวม] — กันเลขซ้ำข้ามวัน+กันชน 2 ไลน์วินาทีเดียวกัน · เดิม `MANUAL-HHmmss` มีแค่เวลาในวันเลยซ้ำข้ามวันจริง เจอ MANUAL-084627 ซ้ำ 15/07+17/07 กระทบ traceability `/order-trace`+backflush `source_prod_no` · เปลี่ยน 2026-08-03), `qty_target`=เป้า, `qty`=เป้า (ใช้กับ capacity check/บอร์ดเหมือนใบปกติ) · **⚠️ `prod_no` ไม่ unique ในตารางโดยตั้งใจ (ยกยอดข้ามกะสร้างแถวใหม่ prod_no เดิม) — ห้ามใส่ unique index** · มี ⏪ **เปิดย้อนหลัง**เหมือนใบสแกน (บังคับกรอกเวลา + กันหลุดกรอบกะ + `opened_at` anchor กับ work_date — helper ร่วม `backfillIsoFromTime` · 2026-07-13) · **งานคู่ RH/LH**: สินค้ามี `pair_mat_no` → ถาม confirm แล้วเปิดเป้าคู่ให้อัตโนมัติ (`prod_no`+`P`, ผูก `paired_order_id` สองทาง, sync `opened_at`) รองรับคู่**คนละไลน์** — เปิดเข้า session ที่เปิดอยู่ของไลน์คู่ (วัน/กะเดียวกัน) ถ้าไลน์คู่ยังไม่เปิดกะจะเตือนให้ไปเปิดเอง (2026-07-13)
- **งานคู่ RH/LH บนบอร์ด Heijunka = แถบวางขนาน ไม่เรียงต่อกัน (2026-07-21):** แม่พิมพ์คู่ปั๊มครั้งเดียวได้ทั้ง LH+RH = ทำพร้อมกัน (parallel) · บอร์ด (Dashboard + Management) จัดคิว **ระดับ sub-line** ปกติ "1 ไลน์ทีละใบ เรียงต่อกัน" แต่**พาร์ทที่มี `pair_mat_no` และคู่ของมันอยู่ในไลน์เดียวกันจริง → แยกเป็นเลนคิวของตัวเอง (parallel) เริ่มพร้อมกัน** แถบ LH/RH จึงตรงกัน (helper `laneKeyOf` ตอนจัดกลุ่ม `byLane` ก่อนเรียก `computeQueuedPositionsFull`) · เดิมไม่เช็ค pair_mat_no เลยจับ LH เรียงหน้า RH เรียงหลังผิด (นับเวลาซ้ำ 2 เท่า) · พาร์ทไม่มีคู่ยังเรียงต่อกันเหมือนเดิม (1 ไลน์ทีละใบ ห้ามซ้อน)
- **โหมดการไหลงานของไลน์ (`production_lines.flow_mode`) — one-piece flow vs parallel machine (2026-07-23):** ไลน์บางไลน์ (เช่น SUB APRON) มีเครื่อง stand-alone หลายตัว (SP-10/72/74…) วิ่งพร้อมกันคนละรายการ ไม่ใช่สายเดียวไหลทีละชิ้น — เดิมบอร์ดจับ 1 sub-line = 1 เลนเรียงคิว เลยดูเหมือนงานต่อคิวกัน (พนักงาน workaround แตกเป็นไลน์ย่อยแยก) · เพิ่ม `flow_mode` (`one_piece_flow` ดีฟอลต์ / `parallel_machine`) + `parallel_stations` (จำนวนเครื่อง · null = นับจาก `machine_points`) — ตั้งที่ **LineSetup แผง ⚙️ ตั้งค่าไลน์ → 🏭 คุณสมบัติของไลน์นี้** (source of truth `src/utils/lineTypes.js` `FLOW_MODES`/`isParallelLine`) · migration `20260723_line_flow_mode.sql` (Main)
  - **บอร์ด (`byLane` ใน Dashboard+Management) แตกเลนตาม flow_mode:** `parallel_machine` → ใบที่ผูกเครื่อง (`prod_orders.machine_no`) = เลนของเครื่องนั้น (`line||M:no`) · ใบที่ยังไม่ผูก = กระจาย round-robin N เลน (`line||P:i%N`) เริ่มพร้อมกัน · `one_piece_flow` = 1 เลน/ไลน์ เรียงคิวเหมือนเดิม (+ pair RH/LH แยกเลน) · **เลือกเครื่องตอนเปิด Order** → `prod_orders.machine_no` (migration `20260723_prod_orders_machine.sql` DR)
  - **backward-compatible:** select `flow_mode`/`machine_no` เขียนแบบ best-effort (แยก query / retry ตัดคอลัมน์) — ยังไม่ apply migration บอร์ดไม่พัง (ทุกไลน์เป็น one_piece_flow) · **เพิ่มไลน์ parallel ใหม่ ตั้งที่ LineSetup ไม่ต้องแตกไลน์ย่อยปลอมอีก**
- พนักงาน**อัพเดทยอดสะสม (`qty_actual`) ทุกช่วงเบรคตาม break policy** จากช่องบนการ์ดใบ — เห็นยอดจริงทุก ~2 ชม. · `qty_updated_at` เก็บเวลาล่าสุด ใบที่ไม่อัพเดท > 2.5 ชม. ขึ้นเตือนเหลือง (นิ่ง — ตาม Andon เหลืองไม่กระพริบ)
- ปิดใบด้วยปุ่ม "✓ ปิดใบนี้ (ยอดจริง)" (ไม่ต้องสแกน) → `status=confirmed`, **`qty` และ `qty_ok` ถูกแทนด้วยยอดจริง** เพื่อให้ OEE/รายงาน/stock trigger (`coalesce(qty_ok, qty)`) นับจากของที่ผลิตได้จริง — เป้าเดิมยังอยู่ที่ `qty_target`
- ใบ manual ที่ค้างเปิดตอนปิดกะ เข้า flow ยกยอด/กรอก actual ของ modal ปิดกะเหมือนใบปกติ
- **ยอดสะสมของใบ manual ที่ยังเปิด ถูกนับเข้า "ผลิตได้"/ความคืบหน้า/แยกตามชิ้นงาน ทันที** (ไม่ต้องรอปิดใบ — ไม่งั้นเห็น 0 ทั้งกะ) และ**ทุกครั้งที่กรอกถูก log ลง `prod_order_qty_updates`** (qty_accum, qty_delta, is_final, logged_at/by) → การ์ดใบโชว์ชิปประวัติต่อช่วง เช่น "10:00 · สะสม 200 (+200)" "12:00 · สะสม 480 (+280)" (migration `20260713_prod_order_qty_update_log.sql`)
- **บนบอร์ด Heijunka (Dashboard/Management):** การ์ด manual ใช้ไอคอน ✍️ + ยอด `ทำได้/เป้า` และแถบ fill ในการ์ดวิ่งตาม qty_actual (ใบสแกนปกติแสดงเหมือนเดิม)
- migration: `20260712_prod_orders_manual_mode.sql` (DR, additive — ใบสแกนปกติไม่กระทบ)

### ใบผลิต "ปิดก่อนเปิด" (confirmed_at < opened_at) — กัน 3 ชั้นแล้ว (2026-07-30)

เคยพบ 33 ใบที่ `confirmed_at < opened_at` จาก 2 สาเหตุ: (ก) **clock skew** — เปิดใบใช้ now() ฝั่ง DB (default) แต่ปิดใบใช้ `new Date()` ฝั่งเครื่อง client ที่นาฬิกาช้ากว่า ~25 วิ → ใบสแกนเปิด-ปิดไวติดลบไม่กี่วินาที (ข) **ยิงย้อนหลังกรอกเวลาอนาคต** — guard เดิมกันแค่หลุดกรอบกะ ไม่ได้กันเวลาที่ยังมาไม่ถึง (เจอจริง: ปิด 04:35 กรอกเริ่ม 05:17 → ติดลบได้เป็นชั่วโมง)
- **ชั้น UI:** handleScanOpen + handleManualOpen บล็อกเวลา backfill ที่ > ตอนนี้ ("ยังมาไม่ถึง")
- **ชั้น DB (safety net):** trigger `trg_prod_orders_close_time_guard` (BEFORE INSERT/UPDATE) — ใบ backfill ซ่อม `opened_at := confirmed_at` (เวลาปิดคือของจริง) · ใบปกติซ่อม `confirmed_at := opened_at` (เวลาเปิดฝั่ง server คือของจริง) · migration `20260730_prod_orders_close_time_guard.sql` (DR — apply แล้ว + ซ่อมข้อมูลเก่า 33 ใบเป็น 0)
- โค้ดใหม่ที่เขียน timestamp คู่เปิด-ปิดในตารางอื่น ให้ระวังเรื่องนาฬิกาสองแหล่ง (server default vs client `new Date()`) แบบเดียวกัน
- **ตรวจแล้ว: การซ่อม 33 ใบไม่กระทบ OEE ที่ stamp ไว้** (audit 2026-08-03 — replicate computeOEE ใน harness แล้วเทียบ timestamp เก่า vs ใหม่ ครบ 16 กะที่เกี่ยวข้อง: ค่า A/P เท่ากันทุกกะ ต่างสุด 0.03 จุด) เพราะ window ติดลบถูก `matEnd <= matStart` ข้ามอยู่แล้วในสูตร และ window ศูนย์หลังซ่อมก็ถูกข้ามแบบเดียวกัน — **ไม่ต้อง recompute ย้อนหลัง** · หมายเหตุ: 8 กะ stamped P ต่างจาก harness 4-19 จุดจากสาเหตุอื่น (CT master/break policy เปลี่ยนหลังปิดกะ / override ตอนปิด) — เป็นเหตุผลที่ห้าม blanket-recompute กะเก่าด้วย master ปัจจุบัน

### ถอยใบที่สแกนปิดไปแล้ว (revert confirmed → open) — 2026-07-15

ปุ่ม **↩️ ถอยใบ** บนใบ `confirmed` ใน DailyReport (เคสจริง: หัวหน้ากลุ่มสแกนปิดเกินยอดที่ผลิตได้/ปิดผิดใบ):
- เงื่อนไข: **เฉพาะกะที่ยังเปิดอยู่** (`selSession.status === 'open'`) — หลังปิดกะ/ส่งขออนุมัติ ยอด+OEE ถูก stamp ลง session แล้ว ถอยไม่ได้ · สิทธิ์ = `canEditRecords` (leader ตอนกะเปิด / manager+)
- สิ่งที่ย้อนให้: status→open, ล้าง confirmed_by/at + qty_ok, ใบ manual คืน `qty = qty_target` (ยอดสะสม qty_actual คงไว้) + **ถอนแถว stock ที่ trigger `trg_post_confirmed_output` โพสต์อัตโนมัติ** (ลบ `line_stock_transactions` ที่ `ref_order_id`+`created_by='auto'`+`type='issue'` — ตัวกันโพสต์ซ้ำของ trigger เช็คจากแถวนี้ ลบแล้วสแกนปิดใหม่จะโพสต์ให้ใหม่ถูกต้อง)
- Audit: `prod_orders.reopened_by/reopened_at/reopen_count` (migration `20260715_prod_orders_reopen_log.sql` DR) — การ์ดใบโชว์ชิป "↩️ เคยถอยใบ N ครั้ง · ชื่อ" เสมอ ให้หัวหน้าแผนกตรวจย้อนหลังได้ · update guard `.eq('status','confirmed')` กันถอยซ้ำสองเครื่องพร้อมกัน

### %A ไลน์เครื่องขนาน — DT ผูกเครื่องหักแค่ 1/N (2026-08-04 · แยก N ออกจาก flow_mode 2026-08-05)

ไลน์ที่มีเครื่องหลักหลายตัววิ่งขนาน (เช่น **LASER-345 = เลเซอร์ 3 ตัว LS-03/04/05**) พนักงานลง DT **แยกรายเครื่อง** ถูกต้องแล้ว — แต่ `computeOEE` เดิมบวกนาทีทุกเครื่องรวมแล้วหักจากเวลาไลน์เดียว → DT 3 เครื่องพร้อมกันถูกหัก 3 เท่า **%A โดนกดเป็น 0 ทั้งที่ของออกปกติ** (เจอจริง 2026-08-03: LASER-345 A=0.00, P=100, Q=97)
- แก้ที่ `computeOEE` + `dtOverlapMin` (รับ `weightFn`): DT ที่**ระบุเครื่อง** หักน้ำหนัก **1/N** · DT **ไม่ระบุเครื่อง** (ไฟดับ/รอวัตถุดิบทั้งไลน์) = หยุดทั้งไลน์ หักเต็มเหมือนเดิม · N=1 (ไม่ตั้ง) = พฤติกรรมเดิมเป๊ะ
- **⚠️ N (จำนวนเครื่องขนาน) แยกจาก `flow_mode` แล้ว (2026-08-05 · helper กลาง `parallelUnitsOf(line, fallbackCount)` ใน `src/utils/lineTypes.js`):** 2 แกนคนละเรื่อง —
  - **`parallel_stations` (N)** = หัก DT 1/N ใน %A · **ตั้งได้ทุกโหมดไหลงาน** ที่ LineSetup แผง ⚙️ ตั้งค่าไลน์ → 🏭 คุณสมบัติของไลน์นี้ — เคสหลัก: **ไลน์งานคู่ LH/RH เช่น LASER-345/789** (เลเซอร์ 3 ตัวขึ้น product เดียว 2 พาร์ทซ้าย-ขวา) เป็น `one_piece_flow` บนบอร์ด (เลนคู่มาจาก `pair_mat_no` ไม่ dispatch ผูกเครื่อง) แต่ตั้ง N=3 เพื่อหัก DT 1/3
  - **`flow_mode='parallel_machine'`** = การจัดเลนคิวบนบอร์ด + แผงเลือกเครื่องตอนเปิด Order (เช่น SUB APRON — เครื่อง stand-alone คนละ product) · ถ้าเป็นโหมดนี้แต่ไม่ตั้ง N → fallback นับเครื่อง active ของไลน์
  - จุดที่ใช้ 1/N ครบแล้ว: `DailyReport computeOEE` (ค่า stamp) + **OEE สด `Dashboard` (per-session board) + `FactoryMap` (loadStatus)** — ทั้งคู่ผ่าน `parallelUnitsOf` และ query `downtime_logs` ต้อง select `machine_no` · จุดใหม่ที่คำนวณ %A ให้ใช้ helper นี้เท่านั้น
- **แผงเลือกเครื่องตอนเปิด Order (ไลน์ parallel_machine) ลิสต์เฉพาะเครื่องของไลน์ที่เปิดกะจริง** (เดิมดึงทั้ง family → เครื่อง HYDROFORM 30+ ตัวโผล่ปน · fallback ไป family เฉพาะเมื่อไลน์ไม่มีเครื่องของตัวเอง + dedupe ตาม machine_no · 2026-08-05)
- **migration `20260723_line_flow_mode.sql` เพิ่ง apply บน Main จริง 2026-08-04** (ค้างมาตั้งแต่ 2026-07-23 — ก่อนหน้านี้คอลัมน์ไม่มีจริง โค้ด tolerant เลยเงียบ) · ไลน์ขนานอื่น (SUB APRON ฯลฯ) ตั้งเองที่ LineSetup แผง ⚙️ ตั้งค่าไลน์ → 🏭 คุณสมบัติของไลน์นี้
- **กะที่ stamp A=0 ผิดไปแล้ว (pending_close):** SV กด ✕ ปฏิเสธ → หัวหน้ากลุ่มขอปิดกะใหม่ = recompute ด้วยสูตรใหม่เอง (ห้าม blanket-recompute กะเก่าตามกฎเดิม)
- **✅ backfill กะปิดแล้วของ LASER-345/789 เสร็จ 2026-08-05** (migration `20260805_backfill_oee_a_parallel_one_third.sql` DR — apply แล้ว): replicate สาย A ของ computeOEE เป็น SQL (เงื่อนไขย่อสูตรตรวจกับข้อมูลจริง: DT ทุกแถวระบุเครื่อง+timestamp ครบ · ≤1 order confirmed/กะ · break policies ทั้งหมด common) คำนวณ a_old (weight 1)/a_new (1/3) → อัพเดทเฉพาะกะที่พิสูจน์ได้ว่า stamp ด้วยสูตรเก่า (|a_old−stamp|≤4) · ตรวจหลัง apply: 71/71 กะตรง a_new หมด · ตัวหนักสุด: 789 03/08 กะเช้า 31.69→77.23, 01/08 46.45→85.53, กะ A=0 สี่กะขึ้นเป็น 91-100 · กะที่ปิดหลัง deploy (stamp สูตรใหม่แล้ว) ไม่ถูกแตะ · **ไลน์ทั้งคู่ตั้ง `one_piece_flow` + `parallel_stations=3` แล้ว** (งานคู่ LH/RH — บอร์ดเลนคู่จาก pair_mat_no, ไม่มีแผงเลือกเครื่อง)

### %A ต้องนับ Downtime ที่กรอกแค่จำนวนนาที (ไม่มีเวลาเริ่ม) — แก้ 2026-07-24

`computeOEE` สาย A แบบแยกตาม MAT ใช้ `dtOverlapMin` (ทับซ้อนช่วงเวลา) ซึ่ง**ข้าม DT ที่ `started_at` = null** (โหมดกรอกแค่นาที) → เคสจริง: หยุดนอกแผน 20 นาทีแต่ %A = 100 (Sup Assy2) · แก้: หลัง loop ต่อ MAT หัก untimedPlanned/untimedUnplanned ที่**ยอดรวม** (`totalNetAvailByMat`/`totalRunMinByMat`) ก่อนหาร — ไม่ต้องรู้ว่าตกช่วง MAT ไหน · fallback ทั้งกะ (ไม่มี order) นับอยู่แล้วผ่าน duration sums

### Downtime — เครื่องจักร + ชิ้นงาน เป็น optional ทุกประเภท (2026-08-03 · คำสั่ง user)

ฟอร์มเพิ่ม Downtime ใน DailyReport เดิมบังคับเลือก**เครื่องจักร + ชิ้นงาน (mat_no)** ทุกกรณี → **ไม่บังคับทั้งคู่ทุกประเภทแล้ว** (`dtMachineOptional = true` เสมอ) เพราะ downtime หลายอย่างเป็นการหยุด**ระดับไลน์** ไม่ผูกเครื่อง/ชิ้นงานเฉพาะ — รอวัตถุดิบ/รอคน/ไฟดับ/ประชุม/**5ส/QA recheck** (หลายอย่างถูกจัด category `planned` เช่น 5ส แต่ก็ไม่ผูกเครื่อง) หรือเครื่องยังไม่ลงทะเบียน (เคสจริง Sub Assy2 SP-xx, Laser LWR) · **⚠️ เดิมลองแยกปลดเฉพาะ unplanned แล้วไม่พอ** — 5ส เป็น planned เลยยังบังคับ (หัวหน้ากลุ่มมองว่า "นอกแผน" แต่ระบบจัด planned) → เลิกแยก planned/unplanned ปลดหมด · คุมด้วย const `dtMachineOptional` (แก้ทั้ง 2 ฟิลด์ × 3 จุด: validation `handleAddDT`, label `(ถ้ามี)`, ปุ่ม disable) · `machine_no`/`mat_no` nullable + top-DT aggregation/notification/OEE (แยกด้วย category ไม่ใช่ mat) จัดการ null อยู่แล้ว · จะผูกเครื่อง/ชิ้นงานก็ยังเลือกได้ · **แต่ไม่ปล่อยข้ามเงียบ: unplanned (เครื่องเสีย 90%) ถ้าไม่เลือกเครื่อง เด้ง `window.confirm` ถามยืนยันก่อนบันทึก** (เผื่อ 10% พาร์ทหมด/ไฟดับทั้งโรงงานที่ลงเครื่องไม่ได้) · planned ไม่ถาม (ไม่ผูกเครื่องอยู่แล้ว) · คำสั่ง user "ห้ามปล่อยเงียบ" 2026-08-03

### หมายเหตุผู้อนุมัติปิดกะ (optional · 2026-07-24)

SV กรอก remark ได้ตอนกด ✅ อนุมัติใน modal ตรวจสอบคำขอปิดกะ (ไม่บังคับ — "เผื่อหัวหน้ามีอะไรเพิ่มเติม") → เก็บ `production_sessions.close_approve_note` (migration `20260724_session_close_approve_note.sql` DR — additive · โค้ด update แยก best-effort) · แสดงในแท็บประวัติตอน expand กะ (กล่องฟ้า 📝 + ชื่อผู้อนุมัติ)
- **remark เข้าแจ้งเตือน Telegram ด้วย (คำสั่ง user 2026-07-24):** client แนบ `approve_note` ใน payload `closed_approved` (reject มี `reject_reason` อยู่แล้ว) · edge `send-notification` ต่อบรรทัด "📝 หมายเหตุผู้อนุมัติ: …" / "📝 เหตุผล: …" ท้ายข้อความ approve/reject — **ต้อง deploy edge `send-notification` ใหม่** (ก่อน deploy: แจ้งเตือน approve/reject ยังส่งปกติ แค่ไม่มีบรรทัดหมายเหตุ — payload field ใหม่ backward-compatible)

### ปฏิเสธคำขอปิดกะ + remark ให้หัวหน้ากลุ่ม (2026-07-23)

leader กด "📋 ขอปิดกะ" → `pending_close` → SV ตรวจแล้วเลือก **อนุมัติ** หรือ **✕ ปฏิเสธ** · ตอนปฏิเสธ **บังคับพิมพ์ remark** (modal `showRejectModal` — บอกว่าต้องกลับไปแก้อะไร เช่น NG ไม่ตรง/ลืมปิด Downtime/เวลาผิด) กะกลับเป็น `open` แล้ว **หัวหน้ากลุ่มเห็น banner แดง (static ไม่กระพริบ) พร้อมข้อความ + ชื่อผู้ปฏิเสธ** ในหัว session จนกว่าจะแก้แล้วส่งขอปิดกะใหม่
- เก็บที่ `production_sessions.close_reject_reason / close_reject_by_name / close_reject_at` (migration `20260723_session_close_reject_reason.sql` DR — additive) · **เขียนเป็น update แยก best-effort (try/catch)** ต่อจากการ revert สถานะ → ยังไม่ apply migration = ปฏิเสธได้ปกติ แค่ยังไม่เก็บข้อความ (ไม่ทำ flow หลักพัง)
- 2 ทางเข้า reject (ปุ่มหัว session + ปุ่มใน modal ตรวจสอบ) เปิด `showRejectModal` ตัวเดียวกัน — `handleRejectClose` อ่าน `rejectReason` (บังคับไม่ว่าง) · เงื่อนไขเดิมยังอยู่: ปฏิเสธไม่ได้ถ้ายอดยกถูกกะถัดไปรับไปแล้ว (`prod_orders.status='imported'`)
- notify `closed_rejected` แนบ `reject_reason` (edge function ยังไม่ใช้ field นี้ — backward-compat, banner ในแอปเป็นช่องทางหลัก)

### การ์ด Order ยกยอด — โชว์ผลิตจริง/ยกไป ไม่ใช่เป้าเฉยๆ (2026-07-23)

หัวหน้างานงง: ใบที่ผลิตไม่จบ ยกยอดข้ามกะ การ์ดโชว์ยอด **เป้า** (เช่น 35) เหมือนผลิตครบ ทั้งที่ผลิตจริง 18 ยกไป 17
- **การ์ด order (`renderOrderRow`) แยกการแสดงยอดตามสถานะ** (เดิมโชว์ `o.qty` ก้อนเดียว label "ชิ้น" เหมือนกันหมด → open(เป้า) กับ confirmed(ผลิตจริง) ดูไม่ออกต่างกัน):
  - `carry_over` (ยกออก) → **`qty_actual/qty_target` label "ผลิตจริง/เป้า"** + บรรทัด "➡ ยกไป N ชิ้น" (N = เป้า−ผลิตจริง)
  - `confirmed` → label "ผลิตจริง (ชิ้น)" · `open` ปกติ → "เป้า (ชิ้น)" · carried-in (`carry_over_from_session_id`) → "ยังต้องทำ (ชิ้น)" + "เป้าเดิม X · กะก่อนทำ Y" (parse จาก `carry_over_note` `\d+/\d+`)
  - `cancelled` → `qty_actual/qty_target` "ทำได้/เป้า"
- **ภาพรวมทั้งกะ "ผลิตได้" รวม `qty_actual` ของใบ carry_over ด้วย** (เดิมนับแค่ confirmed + manual-open → ผลิตจริงส่วนที่ยกยอดหายจากยอดกะนี้ · เคสจริง live โชว์ 468 แต่ SV review โชว์ 486 = +18 ที่ยกยอด) — productRows `confirmed` + null-mat `totalConfirmed` เพิ่ม carry_over qty_actual · ที่เหลือ (remainQty) ไปนับที่กะถัดไป ไม่ double-count

### ยอดที่ "จะส่งต่อกะหน้า" — เห็นตั้งแต่ระหว่างกะ ไม่ต้องไปเปิดดูกะถัดไป (2026-08-10 · คำขอหัวหน้ากลุ่ม)

ฝั่ง **รับ** ทำไว้ดีแล้ว (ชิป "➡ ยกยอดมา (24/35)" + "ยังต้องทำ 11 ชิ้น") แต่ฝั่ง **ส่ง** ก่อนปิดกะเห็นแค่ "35 · เป้า" — หัวหน้ากลุ่มต้องไปเปิดดูกะถัดไปถึงรู้ว่าส่งต่อไปเท่าไหร่ ("มันขึ้นว่า 35 ตัวรอปิด")
**ต้นเหตุ:** สถานะ `carry_over` (ซึ่งมี "➡ ยกไป N ชิ้น" อยู่แล้ว) เกิดตอน **ปิดกะเท่านั้น** และ**ใบสแกนไม่มีช่องกรอกยอดระหว่างทาง** (มีเฉพาะใบ manual) → ระบบไม่รู้ยอดจริงจนกว่า leader จะกรอกใน modal ปิดกะ
- **ใบสแกน (kanban) ที่ยัง `open` กรอกยอดสะสมได้แล้ว — ไม่บังคับ** (`scanOpen` ใน `renderOrderRow` · ใช้ `handleManualQtyUpdate` ตัวเดียวกับใบ manual) · กรอกแล้วการ์ดเปลี่ยนเป็น **"ทำได้/เป้า" + "➡ ปิดกะตอนนี้ ยกไป N ชิ้น"** เหมือนฝั่งรับ · ยังไม่กรอก = หน้าตาเดิมเป๊ะ
- **⚠️ ใบสแกน "ไม่มี" ปุ่มปิดด้วยมือ** (`✓ ปิดใบนี้` เห็นเฉพาะ `manualOpen`) — ปิดใบยังต้องสแกนเสมอ ไม่งั้นเสีย traceability + ยอดเข้า stock · และกรอกเกินจำนวนใบไม่ได้ (kanban card จำนวนตายตัว — ใบ manual เกินได้เพราะเป็นเป้าที่ตั้งเอง)
- **แบนเนอร์สรุประดับกะ "⏭ จะส่งต่อกะหน้า ~X ชิ้น"** (คู่กับแบนเนอร์ "➡ มียอดค้างจากกะก่อน" ที่มีอยู่เดิม) แยก **ยืนยันยกยอดแล้ว** (`carry_over`) กับ **ใบที่ยังไม่ปิด** (`open`) · ใบที่ยังไม่กรอกยอด **นับเต็มใบไว้ก่อน** และขึ้นเตือนสีเหลืองว่ากี่ใบยังไม่กรอก + มี `~` นำหน้าตัวเลข — **ห้ามโชว์เลขคาดการณ์เหมือนเลขยืนยัน**
- **modal ปิดกะ prefill ช่อง "ยอดที่ทำได้จริง" จาก `qty_actual` ที่กรอกไว้ระหว่างกะ** (แก้ทับได้) — **ยังห้ามให้ระบบเดาจากเวลาที่เหลือเหมือนบั๊กเก่า** ข้อยกเว้นนี้ใช้ได้เพราะเป็นเลขที่ "คนกรอกเอง" · seed ตอนกดเปิด modal (ไม่ใช่ fallback ตอน render) เพราะ validation/สรุป/ตอนเซฟ อ่าน `carryQtyActual` state ตรงๆ — fallback เฉพาะตอนแสดงผลจะทำให้ **เซฟเป็น 0**
- **⚠️ ผลข้างเคียงที่ตั้งใจ — ยอด "ผลิตได้" ระหว่างกะขยับ:** `FactoryMap`/`OEEAnalytics`/`MorningMeeting`/`OrderTrace`/`oee.js computeLiveOee` ใช้สูตร `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` อยู่แล้ว → พอกรอกยอดใบสแกน จอพวกนี้เริ่มนับทันที (เดิมได้ 0) · **จึงแก้ภาพรวมทั้งกะใน DailyReport ให้นับใบ `open` ทุกชนิด** (เดิมนับเฉพาะ `is_manual && open`) ไม่งั้น 2 จอเลขไม่ตรงกัน · ไม่กรอก = `qty_actual` null = บวก 0 = พฤติกรรมเดิม · ค่าที่ stamp ตอนปิดกะไม่กระทบ
- **จุดใหม่ที่นับ "ผลิตได้" ระหว่างกะ ให้ใช้สูตร `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` เท่านั้น** ห้ามกรอง `is_manual` อีก

### หมายเหตุหัวหน้ากลุ่มตอนขอปิดกะ + ไอคอน "ถูกปฏิเสธ" ในลิสต์กะ (2026-08-10 · คำขอหัวหน้ากลุ่ม)

- **`production_sessions.close_request_note`** (migration `20260810_session_close_request_note.sql` DR · additive) — หมายเหตุที่**ผู้ขอปิดกะ**เขียนเอง (เช่น "ยอดไม่ถึงเพราะรอ material ตั้งแต่ 14:00") · ครบชุด 3 ช่อง: **ขอ** (`close_request_note`) → **อนุมัติ** (`close_approve_note`) / **ปฏิเสธ** (`close_reject_reason`) · แสดงใน modal ตรวจสอบคำขอของ SV (อ่านก่อนตัดสินใจ) + ประวัติกะ · เขียนแบบ **update แยก best-effort** — ยังไม่ apply migration = ปิดกะได้ปกติ **ห้ามยัดลง payload หลัก** (คอลัมน์ไม่มี = ปิดกะพังทั้งระบบ)
- **ไอคอน ✕ แดง (นิ่ง ไม่กระพริบ) ในลิสต์กะ** เมื่อ `status === 'open' && close_reject_at` — เดิมรู้ว่าถูกตีกลับต่อเมื่อกดเข้าไปในกะ หัวหน้าที่ดูแลหลายไลน์เลยไม่เห็น · คู่กับ ⏳ (pending_close) ที่มีอยู่เดิม · tooltip บอกคนปฏิเสธ + เหตุผล
- **ส่งขอปิดกะใหม่ = เคลียร์ `close_reject_*`** (เดิมเอกสารบอกว่าเคลียร์ แต่โค้ดไม่ได้ทำ → ไอคอน ✕ จะค้างทั้งที่แก้แล้ว) · เคลียร์ใน best-effort update ก้อนเดียวกับ note
- **⚠️ ไอคอน ✕ ขึ้นได้ต่อเมื่อ apply `20260723_session_close_reject_reason.sql` แล้ว** (เพราะ `close_reject_at` เขียน best-effort) — ถ้าแบนเนอร์แดงในกะยังไม่เคยโชว์ข้อความ แปลว่ายังไม่ apply

> ### ⚠️ กฎเหล็ก — `try { await supabaseDR...update() } catch {}` **ไม่ใช่ best-effort มันคือกลืน error ทิ้ง** (2026-08-10)
> **supabase-js "คืน" `{ error }` ไม่ได้ throw** → `try/catch` ที่ไม่ destructure `error` จะไม่มีวันจับอะไรได้เลย
> คอลัมน์ยังไม่มี (42703) = update ล้มเหลว **แต่หน้าจอบอกว่าสำเร็จ** — เจอจริงกับ `close_approve_note`/`close_reject_reason`/`close_request_note` ทั้ง 3 จุด (SV พิมพ์เหตุผลปฏิเสธ → หัวหน้ากลุ่มเห็นแบนเนอร์เปล่า ไม่รู้ว่าต้องแก้อะไร)
> **pattern ที่ถูกสำหรับคอลัมน์ additive ที่อาจยังไม่ apply:**
> ```js
> const { error } = await supabaseDR.from(t).update({...}).eq('id', id)
> if (error) { console.warn(...); toast.error('งานหลักสำเร็จ แต่ <ฟิลด์> ยังบันทึกไม่ได้ — ยังไม่ได้ apply migration <ชื่อ> (แจ้ง admin)') }
> ```
> **flow หลักต้องไม่พัง + ผู้ใช้ต้องรู้ว่าอะไรไม่ถูกบันทึก** — เงียบแปลว่าไม่มีใครไป apply migration สักที

### เปิดกะผิด (กะเปล่า) — ลบ + ไม่ทิ้ง phantom OEE (2026-07-23)

- **ลบกะเปล่าจากจอ Live ได้เลย** (ปุ่ม 🗑 ลบกะเปล่า ในหัว session) — เห็นเมื่อ `can('daily_report','delete_session')` **และ**กะ `open`/`pending_close` **และไม่มี Order/Downtime/Defect เลย** (guard ซ้ำใน `handleDeleteEmptySession`) · เดิมลบได้เฉพาะกะ **closed** ในแท็บประวัติ (`HistoryTab`) → หัวหน้าหาไม่เจอตอนกะยังเปิด
- **⚠️ สิทธิ์ `delete_session` seed ให้ `admin` เท่านั้น** (`20260708_phase0_permission_catalog.sql`) — supervisor/หัวหน้าแผนกไม่เห็นปุ่มลบ · ถ้าอยากให้ลบเองได้ admin เปิดที่ `/permissions`
- **ปิดกะที่ไม่มีผลผลิต (`totalProduced===0 && P==null`) → stamp `oee_a`/`oee_q` = null** (ไม่ใช่ 100/0) ทั้ง handleCloseSession + edit-times recompute · เดิมกะเปล่ามีเวลาเดินกะแต่ไม่มี DT → A=100/Q=100 ค้าง **รั่วเข้าค่าเฉลี่ย %A/%Q ในกราฟเทรนด์** (กรองแค่ != null) · OEE รวมไม่เคยกระทบ (oee=null ถูกกันอยู่แล้ว) · สอดคล้อง cleanup `20260715_oee_null_noproduction_cleanup.sql` (กันตั้งแต่ปิดกะ ไม่ต้องมาไล่ลบทีหลัง)

---

## QR / บาร์โค้ดอุปกรณ์ — สแกนเลือกเครื่อง/จิ๊ก/สินค้า (2026-08-03 · คำสั่ง user)

หน้างานเลือกอุปกรณ์จาก dropdown ยาวๆ ตอนใส่ถุงมือ/รีบ = ช้าและเลือกผิด → **พิมพ์ป้าย QR ติดอุปกรณ์ แล้วสแกนเลือก**

- **รูปแบบรหัสในป้าย (source of truth `src/utils/qrCode.js`):** `ESM:M:<uuid>` เครื่องจักร (`machines.id`) · `ESM:J:<uuid>` จิ๊ก/แม่พิมพ์ (`jigs.id`) · `ESM:P:<mat_no>` สินค้า/พาร์ท
  - **⚠️ เครื่อง/จิ๊กเข้ารหัสด้วย uuid ไม่ใช่เลขเครื่อง** — ป้ายอยู่หน้างานเป็นปี ถ้าใช้เลขเครื่องแล้ววันหนึ่งเปลี่ยนเลข ป้ายที่พิมพ์ไปแล้วชี้ผิดทั้งหมด · บนป้าย**พิมพ์เลขเครื่องตัวใหญ่ให้คนอ่าน** อยู่แล้ว (คนอ่านเลข เครื่องอ่าน uuid) · สินค้าใช้ `mat_no` เพราะเป็นภาษากลางที่ทั้งโรงงาน+SAP อ้างถึง
  - **ตัวอ่านทน 3 กรณีเสมอ:** QR ของระบบ · **เลขเปล่าจากบาร์โค้ด 1D เดิมที่ติดเครื่องอยู่ก่อนแล้ว** (resolve ผ่าน `normCode` ตัดขีด/ช่องว่าง/ตัวพิมพ์) · QR แบบ URL (`?c=ESM:M:…`)
  - `resolveMachine`/`resolveJig`/`resolveProduct` — **สแกนป้ายเครื่องในหน้างาน PM จะเด้งไปแถวเงา (`jigs.machine_id`) ให้เอง** (เครื่อง 1 ตัวมี 2 แถว: `machines` + jig เงาสำหรับผูก checklist PM)
- **ตัวสแกน = `src/components/ScanModal.jsx` (component กลาง reuse ทุกหน้า — ห้ามเขียนตัวอ่านใหม่ต่อหน้า):** 📷 กล้อง (Android/Chrome ใช้ `BarcodeDetector` ที่ติดมากับเบราว์เซอร์ ฟรี · เครื่องที่ไม่มี เช่น iPhone fallback `jsqr` **โหลด lazy เฉพาะตอนเปิดกล้อง** bundle หลักไม่บวม) + 🔫 **เครื่องยิงบาร์โค้ด** (ช่องกรอกโฟกัสรออยู่ ยิงแล้วต่อ `\n` = ส่งเอง — pattern เดียวกับ modal สแกนใบผลิตเดิม) + พิมพ์มือได้เสมอ (ป้ายเลอะ/สแกนไม่ติด งานต้องเดินต่อได้)
  - `onScan(parsed)` **คืน string = ข้อความ error** ให้โชว์ในโมดัล (เช่น "เครื่องนี้อยู่คนละไลน์") · คืน undefined = สำเร็จ ปิดโมดัลให้เอง · กันสแกนซ้ำรัว 1.5 วิ + สั่น (vibrate) บอกผล · ภาพกล้องประมวลผลในเครื่องล้วน ไม่ส่งออก
- **พิมพ์ป้าย = หน้า `/qr-labels`** เลือก เครื่องจักร/จิ๊ก → กรองไลน์+ค้นหา → ติ๊ก → พิมพ์ A4 (สติกเกอร์ 40×25 / 60×40 / 90×60 mm) · ป้ายมี QR + เลขตัวใหญ่ + ชื่อ + ไลน์ · register `doc_forms` doc_key **`qr_label`** (ยังไม่ตั้งเลขฟอร์ม = หน้าตาเดิม) · scope ไลน์ตาม pattern มาตรฐาน
- **จุดที่ต่อสแกนแล้ว:** MtnRepair แจ้งซ่อม (**สแกนเครื่อง → เติมไลน์/section/cost center ให้อัตโนมัติ** — ตรงนี้เจ็บสุดเพราะเดิมพิมพ์เลขเครื่องเอง) · DailyReport ฟอร์ม Downtime (เตือนถ้าเครื่องอยู่คนละไลน์กับกะที่เปิด) · **จุดใหม่ให้ใส่ปุ่ม 📷 ข้าง picker เดิม ห้ามรื้อ dropdown ทิ้ง** (สแกนไม่ได้ต้องเลือกมือได้)
- **ตัวตนต้อง unique — migration `20260803_asset_identity_unique.sql` (DR):** partial unique index `machines(machine_no) where is_active` + `jigs(jig_no) where jig_no ไม่ว่าง` · ตอนใส่ index ข้อมูล active สะอาดอยู่แล้ว (เลขซ้ำ 13 ค่าที่เคยเห็นเป็นแถวปิดใช้งานทั้งหมด) · partial → แถวปิดใช้งาน (ประวัติ) ยังซ้ำได้ + jig ที่ยังไม่กรอกเลขยังบันทึกได้ (ทยอยลงข้อมูล 300-400 ตัวได้)
- **สถานะข้อมูล (2026-08-03):** เครื่องจักร active 209 ตัว **พร้อมพิมพ์ป้ายแล้ว** · **จิ๊ก/DIE จริงยังไม่ได้ลงข้อมูล** (ตาราง `jigs` 35 แถว = เงาของเครื่อง 29 + facility 5 + จิ๊กจริง 1 · DIE 0) — พิมพ์ป้ายจิ๊กได้เมื่อลงข้อมูลแล้ว ระบบรออยู่
- **⚠️ ตาราง `jigs` ไม่ใช่ "ตารางจิ๊ก" — เป็นทะเบียน "อุปกรณ์ที่มีแผน PM"** (อะไรก็ได้ที่ต้องตรวจ: เครื่อง/จิ๊ก/แม่พิมพ์/facility) ชื่อตารางหลอกตา · `equipment_type` เป็นตัวบอกว่าจริงๆ คืออะไร
- **⚠️ 1 อุปกรณ์จริง = 1 ป้ายเท่านั้น — ต้องกรอง "แถวเงา" ออกเสมอ (2026-08-03):** เครื่องจักรที่ถูกวางบนผัง PM จะมีแถวเงาใน `jigs` (`machine_id` ชี้กลับ `machines` · `equipment_type='machine'`) → **ถ้าลิสต์ทั้งตารางมาพิมพ์ป้าย จะได้ QR 2 ใบคนละรหัสติดเครื่องตัวเดียวกัน** (สแกนแล้วเด้งคนละที่) · `/qr-labels` แท็บจิ๊กกรองด้วย `!machine_id && equipment_type !== 'machine'` แล้วโชว์ข้อความบอกว่าซ่อนไปกี่รายการ · **เครื่องจักรพิมพ์จากแท็บเครื่องจักรทางเดียว** · ข้อมูลจริง 2026-08-03: 35 แถวใน jigs = เงา 33 + จิ๊กจริง 1 (JIG6/A) + ขยะทดสอบ 1

---

## กระบวนการผลิต (process types) — master data-driven (2026-07-23)

**เลิก hardcode รายชื่อกระบวนการแล้ว** (คำสั่ง user — ยืดหยุ่นกับโรงงานอื่น): ตาราง **`process_types`** (DR · migration `20260723_process_types_master.sql`): key (ค่าที่เก็บใน process_type ของตารางอื่น — สร้างแล้วห้ามแก้)/label/icon/color/sort/is_active · seed welding_assembly + metal_forming (ค่าเดิมไม่ต้อง migrate — เทียบด้วย key เหมือนเดิม)
- **จัดการได้ 2 ทางเข้า (component เดียว `src/components/ProcessTypeSetup.jsx` — ไม่ duplicate logic · 2026-07-30):** (1) Daily Report → ⚙️ ตั้งค่า → แท็บ 🏭 กระบวนการ (ที่ฝ่ายผลิตใช้งาน) (2) **หน้า `/process-setup` "🏭 กระบวนการผลิต" ในหมวดตั้งค่าโปรแกรม,ฐานข้อมูล** (master กลางอยู่คู่กับ machine/product master · page perm `page:/process-setup` = admin/mgr/sv · migration `20260730_process_setup_permission.sql`) — การ **"แก้"** ยังคุมด้วยสิทธิ์ `daily_report:setup` ใน component ทั้ง 2 ทาง · เพิ่มกระบวนการใหม่ (เช่น Laser, Bending) → ไป tag เครื่อง/สินค้า → dropdown ทุกจุดเห็นเอง (logic จับคู่เทียบ key generic อยู่แล้ว) · **process_type เป็น master กลาง data ถูก centralize แล้ว (ตาราง `process_types` อ่านผ่าน `processTypes.js`) ไม่ผูกกับ Daily Report** — จุดจัดการอยู่ที่ไหนก็มีผลทั้งระบบ
- โค้ดอ่านผ่าน **`src/utils/processTypes.js`** (`loadProcessTypes()` cache + `activeProcessTypes()`/`procDisplay()`/`procColor()` + `DEFAULT_PROCESS_TYPES` fallback — ตารางล่ม/ยังไม่ apply = พฤติกรรมเดิม) · **'common' (ทุกกระบวนการ) เป็น sentinel ในโค้ด ไม่อยู่ในตาราง** dropdown เติมเองต่อจุด
- จุดที่ใช้แล้ว: DailyReport (dropdown ประเภท DT/งานเสีย/นโยบายพัก + กลุ่มแสดงรายการ + product quick manager) · ProductMaster (ฟอร์มสินค้า) — **ห้าม hardcode welding_assembly/metal_forming เพิ่มในหน้าใหม่** อ่านผ่าน util นี้ · หมายเหตุ: `line_type` (production_lines) เป็นคนละตัว ไม่เกี่ยว

## Daily Report — ไลน์ผสมหลาย process (welding + metal forming ในไลน์เดียว · 2026-07-22)

**dropdown ประเภท Downtime/งานเสีย ใช้ `sessionProcessTypesAll()` (union ทุก process ที่มีเครื่อง/สินค้าจริงใน**ครอบครัวไลน์** — แม่+ลูกทั้งหมดผ่าน `getLineFamilyNames` ไม่ใช่ชื่อไลน์ตรงเป๊ะ: กะมักเปิดบนไลน์ลูก แต่เครื่องลงทะเบียนใต้ไลน์พี่น้อง · แก้ 2026-07-24)** — เดิมใช้ `sessionProcessType()` (เสียงข้างมากตัวเดียว) ทำให้ไลน์ผสม เช่น LWR (laser=metal_forming + Stationary=welding_assembly) มองไม่เห็นประเภทของอีก process (เคสจริงจาก supervisor Assy2) · ประเภทที่ `process_type` = null/common เห็นเสมอทั้งสอง dropdown · **break policies ยังใช้ majority ตัวเดียว (`sessionProcessType`) โดยตั้งใจ** — union จะหักเวลาพักซ้ำสอง policy · ทางแก้ฝั่งข้อมูล: ประเภทที่อยากให้เห็นทุกไลน์ตั้ง process = "🔗 ทุกกระบวนการ" ใน ⚙️ ตั้งค่า

## OEE (computeOEE ใน DailyReport) — กฎ P สำหรับหลาย MAT.NO (2026-07-14)

- **ตรวจ parallel ระดับ "product" ไม่ใช่ระดับ MAT.NO** — MAT ที่เป็น product เดียวกันแตกตามลูกค้า (ชื่อชิ้นงานเดียวกัน เช่น FVL/FTM/AAT) คืองานตัวเดียวกันแค่ส่งแยกลูกค้า **ขึ้น parallel กันเองไม่ได้** ระบบรวมเป็นสายเดียวก่อน (จับกลุ่มด้วยชื่อ product จาก kanban_standards→dr_products) แล้วค่อยเช็ค overlap ระหว่าง "คนละ product จริงๆ"
- **parallel = คนละ product ที่ window ทับกัน >15 นาที + >20% ของ window ที่สั้นกว่า** (จังหวะสแกนคาบเกี่ยวไม่นับ) — เช่น RH ที่ Line 60 + LH ที่ Line 61 ใน session ไลน์แม่ APRON ASSY · P แบบ parallel = Σ(qty×CT) ÷ Σ(run ต่อ product group) — **ห้าม mean เท่าๆ กัน** (งานแทรกเล็กเคยลาก P ทั้งกะจาก ~93 เหลือ 48)
- ไม่เข้าเกณฑ์ = sequential: P = Σ(qty×CT) ÷ run ทั้งกะ (จับ idle ระหว่างงานด้วย)
- บั๊กเดิม (ก่อน 2026-07-14) ทำ P ต่ำเกินจริงในกะ multi-MAT — แก้ย้อนหลังใน DB แล้ว 12 กะ (22/06–13/07) ด้วย SQL ที่ replicate สูตรแล้ว validate กับการคำนวณมือ

### ⚠️ กฎ Q (Quality) — การ์ดที่สแกนปิด = "ของดีล้วน" (user ยืนยัน 2026-08-02)

- **ยอดที่สแกนปิดใบงาน (`prod_orders.qty` / `qty_actual` / `qty_ok`) = จำนวน "ของดี" ล้วน** — พนักงานผลิตจนได้ของดีครบเป้า ของเสียที่เกิดระหว่างทางถูกผลิต**เพิ่ม**จนได้ของดีครบ แล้วลง NG แยกที่ `defect_logs` · ตัวอย่าง: order 10 → สแกน 10 (ดี) + NG 1 = ผลิตจริง 11
- **`Q = ของดี / ผลิตจริงทั้งหมด = totalProduced / (totalProduced + ngQty)`** — **ห้าม** `(ดี − NG)/ดี` (หักซ้ำ ทำ %Q ต่ำเกินจริง: ดี100 NG50 ได้ 50% ที่ถูกคือ 66.7%) · **ยอด "ดี" (qty_ok) = ยอดสแกน ไม่ต้องลบ NG**
- แก้ครบ 5 จุด OEE (2026-08-02): `DailyReport.jsx` computeOEE Q (Q ที่ stamp) + totalQtyOk · `FactoryMap.jsx`/`Dashboard.jsx` liveOee (Q สด) · `OEEAnalytics.jsx` calcOEE fallback okQty — **จุดใหม่ที่คำนวณ Q ให้ใช้สูตรนี้เท่านั้น**
- **ฝั่ง QA แก้ตามด้วย (2026-08-02):** `QualityControl.jsx` FTT = `total/(total+ng)` (เดิม `(total−ng)/total` ต่ำเกินจริง) + PPM = `ng/(total+ng)×1e6` (เดิม `ng/total` สูงเกินจริง เพราะ `total`=ยอดสแกน=ของดี ต้องหารด้วยผลิตจริง=ดี+เสีย) ครบ 3 จุด ppm + 1 จุด ftt (บรรทัด ~360-372) · ⚠️ PPM เป็นเมตริกที่อาจอ้างอิงกับลูกค้า — ถ้า QMS นิยาม PPM = ng/ยอดสแกน ให้ revert เฉพาะจุดนี้
- **⚠️ กะที่ปิดไปแล้วมี `oee_q` ที่ stamp ด้วยสูตรเก่า (หักซ้ำ) ค้างอยู่** — backfill DR แล้ว 2026-08-02 (migration `20260802_backfill_oee_q_no_double_deduct.sql`): `oee_q = actual_qty/(actual_qty+ng)×100`, `oee = oee_a×oee_p×oee_q/1e4` (เฉพาะ closed + oee_a/p/q not null + actual_qty>0 · idempotent แตะเฉพาะแถวที่ค่าต่าง ≥0.05) · **ng นับจาก `defect_logs` (Σ qty_ng+qty_suspect ต่อ session) ไม่ใช่ session column `qty_ng`/`qty_suspect`** — column ไม่น่าเชื่อถือ (เจอ Line 60 21/07 column=0 แต่ defect_logs มี NG 12 → old_q=100 ผิด, ที่ถูก 97.6) · รันจริง 5 กะเปลี่ยน (swing −2.4..+1.0)

### OOE / TEEP — ต่างจาก OEE ที่ "ฐานเวลา" อย่างเดียว (`/oee-analytics` · 2026-08-04 · คำสั่ง user)

พนักงานเริ่มลง downtime เป็น **planned** มากขึ้น → **OEE มองไม่เห็นเวลาส่วนนั้น** (ถูกหักออกจากฐาน) ไลน์เลยดูสวยทั้งที่เวลาหายไปกับพัก/หยุดตามแผนเยอะ · เพิ่ม OOE + TEEP ให้ผู้บริหารเห็นภาพเต็ม

| | ฐานเวลา (ตัวหาร) | ตอบว่า |
|---|---|---|
| **OEE** | เวลารับภาระ = `shift_min − พักนโยบาย − planned DT` | ตอนที่ตั้งใจเดิน เดินดีแค่ไหน |
| **OOE** | **เวลากะทั้งหมด** = `shift_min` (รวมพัก + planned DT) | เวลาที่เปิดโรงงาน ใช้คุ้มแค่ไหน |
| **TEEP** | **ปฏิทิน 24 ชม.** = `จำนวนไลน์ × จำนวนวันในช่วงที่เลือก × 1440` | กำลังผลิตทั้งหมดที่มี ใช้ไปกี่ % |

- **สูตร: `OOE = OEE × (Σเวลารับภาระ ÷ Σเวลากะ)` · `TEEP = OEE × (Σเวลารับภาระ ÷ เวลาปฏิทิน)`** — คูณสัดส่วนฐานจาก OEE ที่ stamp ไว้ **ห้ามคำนวณ A/P/Q ใหม่** (จะได้คนละชุดกับ Daily Report) · ค่าเรียง **TEEP ≤ OOE ≤ OEE** เสมอ
- **⚠️ TEEP ต้องนับวันที่ไม่ได้เปิดกะด้วย** (ตามตำรา "Not Scheduled Time" อยู่ในฐาน TEEP) — ใช้ **ทุกวันในช่วง `dateFrom..dateTo`** ไม่ใช่เฉพาะวันที่มี session ไม่งั้น TEEP สูงเกินจริง
- เวลาพักนโยบายคิดจาก `break_policies` ผ่าน helper `policyBreakMin(shift, shiftMin, policies)` (ทับซ้อนกับกรอบกะ · กะเช้าเริ่ม 08:00 กะดึก 20:00 · นโยบายที่ผูก process เฉพาะถูกข้าม — ระดับนี้ไม่รู้ process ของกะ)
- การ์ด "เวลาที่หายไปก่อนถึง OEE" แยกให้เห็น **พักนโยบาย vs หยุดตามแผน** + แถบสัดส่วน 🟩 สร้างของดี / 🟪 เสียตอนเดินเครื่อง / 🟧 พัก+หยุดตามแผน
- **payoff:** TEEP ต่ำ + OEE สูง = ไม่ต้องซื้อเครื่อง เปิดกะเพิ่มพอ (ใช้คู่ `/production-plan` ตอนของบลงทุน)

### 🧩 Single source of truth ของ OEE — `src/utils/oee.js` (2026-08-05 · คำสั่ง user)

**ทุกสูตรที่เกี่ยวกับ A/P/Q/OEE/OOE/TEEP อยู่ไฟล์เดียว** — เดิมแตกเป็น `liveOee.js`/`strictOee.js`/`oeeAvg.js` + สูตรซ้ำในหน้า แล้ว drift กันจนตัวเลขคนละชุด · **จอไหนจะโชว์ค่าพวกนี้ต้อง import จากที่นี่ ห้ามเขียนสูตรเองในหน้า · ห้ามแตกไฟล์ util OEE เพิ่ม**

| # | export | ใช้ทำอะไร | เคยพังยังไงตอนต่างคนต่างเขียน |
|---|---|---|---|
| 1 | `wavg` / `wLoad` / `wRun` / `wProd` | เฉลี่ยข้ามกะแบบถ่วงน้ำหนัก | mean-of-percentages ใน 4 จอ → ไม่ตรง `/oee-analytics` |
| 2 | `ctForMat` / `buildCtMap` | CT ต่อ MAT (kanban_standards → dr_products) | FactoryMap/OEEAnalytics ดึง dr_products ล้วน · InsightPanel ดึง kanban ล้วน → P คนละชุด · แท็บประวัติ %P ว่างกับ MAT ที่ kanban ไม่มี CT |
| 3 | `policyBreakOverlapMin` / `policyBreakForShift` | เวลาพักตามนโยบายที่ทับช่วงเวลา (กรอง shift + process) | 3 implementation: แท็บประวัติไม่กรอง process (พักเกิน) · OEEAnalytics ทิ้งนโยบายเฉพาะ process + เวลาเริ่มกะตายตัว 08:00/20:00 (พักขาด) → OEE จริง/OOE ไม่ตรงกัน |
| 4 | `computeLiveOee` / `LIVE_MIN_ELAPSED` | OEE สดของกะที่ยังไม่ปิด | FactoryMap ไม่ส่ง NG → Q สด = 100% เสมอ |
| 5 | `strictOee` / `strictGap` / `STRICT_WARN_SHARE_PCT` | "OEE จริง" นับหยุดในแผนเป็นการสูญเสีย | — |
| 6 | `SIX_BIG_LOSSES` / `EIGHT_WASTES` / `groupLean` / `lossMeta` / `wasteMeta` | วิเคราะห์ Lean (ดูหัวข้อถัดไป) | — |

**query ต้อง select คอลัมน์ให้ครบด้วย** ไม่งั้น util ได้ข้อมูลไม่พอแล้วเงียบ: `break_policies.process_type` · `production_sessions.start_time/shift_min` · `dr_downtime_types(category, six_big_loss, waste_type)` · NG จาก `defect_logs` เสมอ

### 🧩 เจาะ "อื่นๆ" — จับกลุ่มหมายเหตุที่พนักงานพิมพ์เอง (2026-08-05 · คำสั่ง user)

Pareto Downtime มี **"อื่นๆ (นอกแผน)" ครองอันดับ 1 ที่ 37% (2,866 นาที) แต่บอกอะไรไม่ได้เลย** — ทั้งที่ระบบ**บังคับกรอกรายละเอียด**อยู่แล้วเมื่อเลือกประเภทที่มีคำว่า "อื่น" (กฎเดิมในหัวข้อ Morning Meeting) · ข้อมูลมีอยู่ในมือ แค่ไม่เคยถูกเอามาจัดกลุ่ม

- **util กลาง `src/utils/textCluster.js`** (pure, ไม่มี dependency) — `clusterNotes(records, noteOf, valueOf)` คืน `{ clusters, missing }`
  - **ไม่ตัดคำภาษาไทย (word segmentation) โดยตั้งใจ** — ภาษาไทยไม่มีช่องว่าง การตัดคำแม่นๆ ต้องใช้ dictionary/โมเดล (lib หนัก + ยังพลาดกับคำหน้างาน เช่น "โรบอทชนจิ๊ก") → ใช้ **character 3-gram + Jaccard** ซึ่งไม่ต้องรู้ขอบเขตคำ ทนพิมพ์ตก/เว้นวรรคต่างกัน
  - normalize: NFC → ตัดสัญลักษณ์ → **ตัดตัวเลขทิ้ง** (เวลา `14.00-14.20` / จำนวน ไม่ใช่สาระของสาเหตุ) → ยุบช่องว่าง
  - containment: ข้อความสั้น (≥5 ตัวอักษร หลังตัดช่องว่าง) ที่อยู่ใน ข้อความยาว = กลุ่มเดียวกัน ("ไฟดับ" ⊂ "ไฟดับทั้งโรงงาน") · เกณฑ์ `CLUSTER_THRESHOLD` = 0.45
  - greedy เรียง **ค่ามากก่อน** → แกนของกลุ่มคือเหตุการณ์ที่กินเวลาสูงสุด · ชื่อกลุ่ม = ข้อความที่เขียนบ่อยสุด + บอกว่ารวมกี่แบบ (`variants`) + ตัวอย่าง (`samples`)
  - **สูตรความเหมือนอยู่ที่ `simCore` จุดเดียว** ใช้ร่วมทั้ง `noteSimilarity` และ `clusterNotes` (เคยเขียนซ้ำ 2 ที่แล้ว drift — เวอร์ชันใน clusterNotes เทียบ containment บนสตริงที่ยังมีช่องว่าง ทำให้ "โรบอท ชนจิ๊ก" ไม่เข้ากลุ่ม "โรบอทชนจิ๊ก")
- **`ParetoAbcChart` รับมิติแบบ `{ key, label, cluster: true }`** → เจาะลึกด้วยการจับกลุ่มข้อความแทน group ตามฟิลด์ · ใช้ที่ `NOTE_DIM` ใน OEEAnalytics ทั้ง Pareto downtime + ของเสีย · **จุดใหม่ที่มีข้อความอิสระ (root cause / remark / อาการ) ให้เพิ่มมิติ cluster แบบเดียวกัน ห้ามเขียนตัวจับกลุ่มใหม่**
- **ห้ามกลบแถวที่ไม่มีโน้ต** — `missing` ถูกใส่กลับเข้าพาเรโตเป็นแถว "(ไม่ได้กรอกหมายเหตุ)" สีส้ม ถ้ามันขึ้นกลุ่ม A แปลว่าปัญหาอยู่ที่วินัยการบันทึก ไม่ใช่เครื่องจักร
- **ปิดลูป:** กลุ่มที่กิน ≥15% ของ "อื่นๆ" ขึ้นข้อความชวนไป**ตั้งเป็นประเภทของตัวเอง** (Daily Report → ⚙️ ตั้งค่า → ประเภท Downtime) รอบหน้าจะได้ไม่ตกไปกอง "อื่นๆ" อีก — **ระบบไม่แก้ master/ย้าย log ให้เอง** (การตัดสินว่าอะไรควรเป็นประเภทใหม่เป็นงานของคน)
- ประเภทชื่อ "อื่นๆ/ไม่ระบุ" ที่ติดกลุ่ม A ขึ้น banner ส้มเหนือกราฟ กดแล้วเด้งเข้ามิติหมายเหตุให้เลย

### 🧩 วิเคราะห์ Lean — 6 Big Losses (TPM) + 8 Wastes (DOWNTIME) (2026-08-05 · คำสั่ง user)

**แยกคนละแกนกับ `category` (ในแผน/นอกแผน) ที่ใช้คิด OEE โดยตั้งใจ** — user ยืนยันว่า**ไม่แก้การจัดประเภทในแผน/นอกแผน** เพราะแต่ละบริษัท/หน่วยงานนิยาม KPI ต่างกัน เป็นสิทธิ์ของเขา · แกน Lean ตอบคนละคำถาม: *"เวลาที่เสียไปเป็นความสูญเปล่าประเภทไหน ต้องแก้ด้วยเครื่องมืออะไร"*

- **เก็บที่ master เดิม ไม่สร้างตารางใหม่:** `dr_downtime_types.six_big_loss / waste_type` + `dr_defect_types.six_big_loss / waste_type` (migration `20260805_lean_loss_classification.sql` · nullable = ยังไม่จัดหมวด **ห้ามเดาแทนผู้ใช้**)
- **ตั้งค่าเอง** ที่ Daily Report → ⚙️ ตั้งค่า → ประเภท Downtime (dropdown 2 ช่องใต้หมวดหมู่ · ป้ายกำกับบอกชัดว่า "ไม่กระทบ OEE") — migration seed ค่าตั้งต้นจากคำในชื่อประเภทให้แล้ว (เหลือ 12/69 ที่ยังไม่จัด เช่น "อื่นๆ" ซึ่งควรให้คนจัดเอง)
- **6 Big Losses** ผูกกับตัวที่กระทบ: breakdown/setup → A · minor_stop/reduced_speed → P · defect/startup → Q · แต่ละหมวดมี `fix` = แนวทางแก้ตามตำรา (SMED, TPM, poka-yoke ฯลฯ) แสดงบนหน้า
- **แสดงที่แท็บ 🧠 วิเคราะห์สาเหตุ ใน `/oee-analytics`** (แผงบนสุด สลับแกน 6 Losses ↔ 8 Wastes) — **ไม่สร้างหน้าใหม่** · ของเสียถูกแปลงเป็น "นาทีที่เสียไป" ด้วย CT ของกะนั้น เพื่อเทียบหน่วยเดียวกับ downtime · โชว์เวลาที่ "ยังไม่จัดหมวด" เสมอ (ไม่ซ่อน) พร้อมบอกว่าไปจัดที่ไหน
- helper กลาง `groupLean({ axis, downtimes, defects, ctSecFn, includePlanned })` ใน `src/utils/oee.js` §6 — จุดใหม่ที่อยากวิเคราะห์ Lean ให้ reuse ตัวนี้

### ⚠️ ผล audit A/P/Q/OEE ทั้งระบบ — จุดที่เคยไม่ตรงกัน (แก้ครบ 2026-08-05)

audit ทุกไฟล์ที่แตะ A/P/Q/OEE/OOE/TEEP แล้วพบ **ตัวเลขคนละชุดระหว่างหน้าจอ 6 เรื่อง** — แก้แล้วทั้งหมด บันทึกไว้กัน regress:

| เรื่อง | อาการเดิม | แก้เป็น |
|---|---|---|
| **NG ของ OEE สดบนผังรวม** | `FactoryMap` ไม่ส่ง `ngQty` เข้า `computeLiveOee` → util fallback ไป `prod_orders.qty_ng` ซึ่ง**ไม่เคยถูกเขียนทั้งระบบ** (ยืนยัน 0/6100 แถว) → **Q สด = 100% เสมอ** OEE บนจอ TV สูงกว่าความจริง | โหลด `defect_logs` แล้วส่ง `ngQty` (qty_ng + qty_suspect) เหมือน `/oee-analytics` |
| **NG นับซ้ำ 2 เท่า** | `Σ defect_logs.qty_ng + session.qty_ng` — แต่คอลัมน์ session **คือ rollup ของ defect_logs** ที่ stamp ตอนปิดกะ → PPM สูงเกินจริง 2 เท่า / FTT ต่ำเกินจริง (QualityControl) · CSV/Excel/PDF ใบรายงานกะ ช่อง NG ผิด 2 เท่า | ยึด `defect_logs` เป็นหลัก (`มีแถว ? ผลรวม : คอลัมน์`) ทุกจุด |
| **ยอดดีหักซ้ำ** | `okQty = qty_ok \|\| (actual_qty − ngQty)` ใน CSV/PDF — ขัดกฎ Q (ยอดสแกน = ของดีล้วน) แถม ngQty ที่หักคือค่านับซ้ำ | `qty_ok ?? actual_qty` |
| **เฉลี่ย OEE แบบ mean ธรรมดา** | FactoryMap (ไลน์+ครอบครัว) · MorningMeeting (KPI+Telegram+ใบพิมพ์) · เด็ค Monthly Review ผู้บริหาร · OeeInsightPanel (เทียบกะเช้า/ดึก, วันคนขาด) — ทั้งหมด `sum/n` → ไม่ตรงกับ `/oee-analytics` | ทุกจุด import **`src/utils/oeeAvg.js`** (`wavg`/`wLoad`/`wRun`/`wProd`) — **ห้ามเขียน sum/n เอง** |
| **ผลิตรวมวันนี้ = 0 ระหว่างกะ** | `/oee-analytics` non-pair คืน `actual_qty` ซึ่งเขียนตอนปิดกะเท่านั้น | ไม่มีค่า → รวมจากใบงานสด (`qty_ok ?? qty` / `qty_actual`) |
| **NG จากคอลัมน์ session ปนกับ defect_logs ในหน้าเดียว** | MorningMeeting (KPI/ชิปรายกะ) · FactoryMap (สด/ทบทวน) · OeeInsightPanel (loss decomposition) ใช้คอลัมน์ ขณะที่แผง Top-defect ในหน้าเดียวกันใช้ defect_logs | ยึด `defect_logs` (qty_ng + qty_suspect) ทุกจุด |

**audit รอบ 2 — หน้า `/oee-analytics` (2026-08-05 · user เจอเอง):**
- 🔴 **Pareto Downtime นับ "ในแผน" ด้วย** → "นับสต๊อก/ไม่มีแผนผลิต" ครองอันดับ 1 ที่ 50% ทั้งที่ไม่ใช่ loss (ข้อมูลจริง: DT ในแผนคิดเป็น **73%** ของนาทีทั้งหมด — พาเรโตจึงชี้เป้าผิดหมด) · เป็นบั๊กเดียวกับที่แก้ในแผง Top Downtime ไปแล้ว 2026-07-15 แต่ Pareto ตกหล่น → **default นับเฉพาะนอกแผน + checkbox "รวมหยุดตามแผน" (ปิดไว้)** ไม่ซ่อนข้อมูล แต่ไม่ให้ปนกับ loss จริง
- 🔴 **`pairAwareTotal(...).actual` = undefined → NaN** — util คืน `{ target, produced }` เท่านั้น · ใช้ชื่อฟิลด์อื่นแล้ว JS ไม่ error แต่ได้ NaN เงียบๆ · **เจอ 2 จุด: เด็ค Monthly Review ผู้บริหาร (ยอด output ทั้งเด็ค) + ผลิตรวมแท็บแนวโน้มที่เพิ่งเขียน** → มีเทสกันไว้แล้ว (`pa.actual === undefined`)
- 🟡 **ผลิตรวมแท็บแนวโน้มไม่ pair-aware** (บวก actual_qty ตรงๆ) ขณะที่แท็บภาพรวมวันนี้นับคู่แล้ว → 2 แท็บในหน้าเดียวยอดไม่ตรง · แก้: โหลด `prod_orders` ของช่วง (แบ่งหน้าทีละ 1000) + pair map แล้วนับแบบเดียวกัน

**กฎที่ตกผลึกจาก audit นี้:**
- **Pareto/Top Downtime ทุกจุดนับเฉพาะ `category !== 'planned'`** — จะโชว์ในแผนต้องแยกส่วน/ให้ผู้ใช้เลือกเอง ห้ามปนกันโดยปริยาย
- **`pairAwareTotal` คืน `{ target, produced }`** — ห้ามอ่านชื่ออื่น (undefined → NaN เงียบ) · ตอนสร้าง perMat ต้องใส่ `mat_no` ด้วย ไม่งั้นจับคู่ไม่ได้
- **NG ทุกจุดยึด `defect_logs` (qty_ng + qty_suspect)** — คอลัมน์ `production_sessions.qty_ng` เป็น rollup ใช้เป็น fallback เท่านั้น ห้ามบวกทั้งสอง · `prod_orders.qty_ng` เป็น vestigial ไม่มีใครเขียน ห้ามอ่าน
- **เฉลี่ย OEE/A/P/Q ข้ามกะ ต้อง `import { wavg, wLoad, wRun, wProd } from '../utils/oeeAvg'`** จุดเดียว
- **ยอดดี = ยอดสแกน ห้ามลบ NG** (กฎ Q) · ยอดที่ต้องใช้ระหว่างกะให้คำนวณจาก `prod_orders` ไม่ใช่ `actual_qty` (เขียนตอนปิดกะ)
- ยังเหลือ (🟡 ยอมรับได้ แต่ระวัง): CT มาจากคนละแหล่งระหว่างจอ (kanban_standards vs dr_products) · `policyBreakMin` มี 3 implementation (DailyReport computePolicyBreakMin = ต้นฉบับกรอง process · histBreakOverlapMin ไม่กรอง · OEEAnalytics ทิ้งนโยบายเฉพาะ process + ใช้เวลาเริ่มกะ fix 08:00/20:00) → ค่า OEE จริง/OOE ต่างกันเล็กน้อยระหว่าง Daily Report กับ OEE Analytics

### ⚠️ กฎเฉลี่ย OEE รวมหลายกะ — ถ่วงน้ำหนักตามตำรา ห้าม mean-of-percentages (2026-08-02)

- **รวม A/P/Q/OEE ของหลายกะ (KPI/เทรนด์ใน `/oee-analytics`) ต้องถ่วงน้ำหนัก ไม่ใช่เฉลี่ยเปอร์เซ็นต์ตรงๆ** — helper `wavg(items, valFn, wFn)` ใน `OEEAnalytics.jsx` (มี fallback เป็นเฉลี่ยธรรมดาเมื่อไม่มีน้ำหนัก + กันหารศูนย์ + คืน null เมื่อไม่มีค่า valid):
  - **A, OEE** ถ่วงด้วย **เวลารับภาระ** (`wLoad` = `shift_min − plannedMin`)
  - **P** ถ่วงด้วย **เวลาเดินเครื่อง** (`wRun` = `wLoad × A/100`)
  - **Q** ถ่วงด้วย **จำนวนที่ผลิต** (`wProd` = ดี + เสีย)
- เดิม mean-of-percentages ทำให้กะเล็ก (ผลิต 10 ชิ้นครึ่ง ชม.) ถ่วงเท่ากะทั้งวัน + mean-of-means รายวันทำวันผลิตน้อยถ่วงเท่าวันผลิตเยอะ · ใช้ทั้ง `tdKpi`/`tdTrend`(ภาพรวมวันนี้) + `kpi`/`grouped`(เทรนด์รายวัน/เดือน) · query history ต้อง select `shift_min, actual_qty, qty_ng` เพิ่ม
- **จุดใหม่ที่รวม OEE หลายกะให้ใช้ `wavg` เท่านั้น ห้ามกลับไป `sum/n`** — mean-of-percentages เป็นข้อผิดพลาดคลาสสิกของ OEE

> ### ⚠️ กฎงานคู่ RH/LH — ต้องตั้ง `dr_products.pair_mat_no` ให้ครบ **ทั้ง 2 ทาง** (ทุก session ต้องรู้ · 2026-07-21)
> งานคู่ (แม่พิมพ์คู่ ปั๊มครั้งเดียวได้ทั้ง LH+RH = ทำพร้อมกัน) ผูกกันด้วย `pair_mat_no` ใน **Product Master (DR `dr_products`)** — LH ต้องชี้ไป RH **และ** RH ต้องชี้กลับมา LH (ตั้งจากหน้า `/products`) · ค่านี้เป็น source of truth เดียวที่ 3 จุดนี้พึ่งพา:
> 1. **เปิดเป้าคู่อัตโนมัติ** (DailyReport manual open — สร้าง prod_orders คู่ให้เอง)
> 2. **OEE `computeOEE`** — จับเป็น product group เดียว/parallel ถูกต้อง (ดูบล็อกด้านบน)
> 3. **บอร์ด Heijunka (Dashboard + Management)** — วางแถบ **ขนาน (parallel lane)** เริ่มพร้อมกัน แทนการเรียงต่อกัน (helper `laneKeyOf` · 2026-07-21)
> 4. **สรุปยอด "ภาพใหญ่" นับงานคู่เป็น 1 คู่/stroke** (1 ปั๊ม = 1 คู่ ไม่บวกชิ้น LH+RH ซ้ำ) — util กลาง `src/utils/pairTotals.js` `pairAwareTotal(perMat, pairOf)`: คู่ที่มีทั้ง 2 พาร์ทในชุด → เป้า/ผลิต = **max ของสองข้าง** · พาร์ทเดี่ยว/ไม่ระบุ mat = บวกปกติ · ใช้แล้วที่ DailyReport (ภาพรวมทั้งกะ) / FactoryMap (metric ยอดผลิต) / Dashboard (การ์ด demand/actual) / MorningMeeting (ผลิตจริง-เป้ากะ) / OEEAnalytics (KPI ผลิตวันนี้ panel 3) · **แถบรายพาร์ทยังโชว์แยก RH/LH เหมือนเดิม** · INPUT/material ยังนับชิ้นจริง (เบิกตามชิ้น) · จอสรุปใหม่ที่บวกยอดข้ามพาร์ทให้ใช้ helper นี้ (2026-07-21)
>    - **หลักการ (trial phase — cutoff ระบบเก่าสิ้นเดือน):** ยอดรวม "ภาพใหญ่" คำนวณ**สด**จาก `prod_orders` ต่อ mat ทุกจอ ไม่แตะ DB/ค่าที่ stamp ตอนปิดกะ — ข้อมูลรายพาร์ท/รายลูกค้า/เจาะราย MAT SAP ยังอยู่ครบใน prod_orders (แยก LH/RH, เสียเท่าไหร่ ดูได้เหมือนเดิม) · **เฉพาะกะที่มีคู่จริงถึง recompute** (blast radius แคบ) — กะไม่มีคู่ใช้ค่า stamped เดิม (MorningMeeting `sessTarget/sessActual`, OEEAnalytics `tdKpi`)
>
> **ถ้าไม่ตั้ง `pair_mat_no` หรือ ตั้งข้างเดียว** → อาการ: แถบ LH/RH บนบอร์ดไม่ตรงกัน (LH ต้นกะ RH ท้ายกะ) · OEE นับเวลา run ซ้ำ 2 เท่า · เปิดเป้าคู่ไม่ทำงาน — **เจ ออาการพวกนี้ให้เช็ค `pair_mat_no` ก่อนแก้โค้ด** · เพิ่มฟีเจอร์ที่แตะคู่ RH/LH ให้ยึด `pair_mat_no` เป็นตัวจับคู่เสมอ ห้ามเดาจากชื่อ LH/RH

### ⚠️ "OEE จริง" — ปิดช่องโหว่ติ๊ก Downtime เป็น "ในแผน" เพื่อดัน OEE (2026-08-05 · คำสั่ง user)

**ปัญหา:** สูตร OEE มาตรฐานกัน "หยุดตามแผน" ออกจากฐาน A (`A = run ÷ (กะ − พัก − หยุดในแผน)`) → ติ๊กประเภท DT เป็น "ในแผน" แล้ว A ไม่ตกเลย · หน้างานจึงติ๊กในแผนกับเหตุการณ์ที่จริงๆ เป็นการสูญเสีย (รอ QA ตรวจงาน, เปลี่ยนตะกร้าใส่งาน) ทำให้ OEE สวยเกินจริง — เคสจริง LASER EXPORT กะดึก 04/08: DT 40 น. เป็น "ในแผน" ทั้งหมด → A = 100%, OEE 90.3%

**ตัวชี้วัดใหม่ `strictOee` (`src/utils/strictOee.js`)** — ฐาน = **เวลากะ − พักตามนโยบาย** (นับ DT ทุกชนิดเป็นการสูญเสีย):
- `A จริง = A ที่ stamp × (เวลารับภาระเดิม ÷ ฐาน)` · `OEE จริง = A จริง × P × Q`
- **⚠️ คูณสัดส่วนฐานจากค่า stamp ห้ามคำนวณ A ใหม่จากเวลากะ** — A ที่ stamp คิดแบบแยกตามพาร์ท (window ที่แต่ละ MAT วิ่งจริง) ไม่ใช่ทั้งกะ · คำนวณใหม่แล้วได้คนละชุดกับ Daily Report และ**บางกะ "OEE จริง" กลับสูงกว่า OEE** (เจอจริงตอนเทส 3 กะ) · pattern เดียวกับ OOE/TEEP → รับประกัน `OEE จริง ≤ OEE` เสมอ และเท่ากันเป๊ะเมื่อไม่มีหยุดในแผน
- ลำดับฐาน: `OEE (กะ−พัก−หยุดในแผน) ≥ OEE จริง (กะ−พัก) ≥ OOE (เวลากะทั้งหมด) ≥ TEEP (24 ชม.)`
- **แสดงที่:** Daily Report แท็บประวัติ (แถบใต้ A/P/Q ของแต่ละกะ — บอกฐาน/หยุดในแผนกี่นาที/ต่ำกว่า OEE กี่จุด · หยุดในแผนกิน ≥ `STRICT_WARN_SHARE_PCT` (5%) ของฐาน = แถบเหลือง + เตือนให้ตรวจการจัดประเภท) · OEE Analytics แท็บภาพรวมวันนี้ (การ์ด KPI คู่กับ OOE/TEEP)
- **ไม่ได้แทนที่ OEE มาตรฐาน** — ใช้คู่กันเพื่อดูว่า "ถ้านับทุกการหยุด เวลาเหลือผลิตจริงเท่าไหร่"
- **ต้นเหตุจริงคือ master data**: ประเภท DT ที่ตั้ง `category='planned'` ทั้งที่เป็นการสูญเสีย → แก้ที่ Daily Report ⚙️ ตั้งค่า (ข้อมูลจริง 08/2026: 21 กะที่ OEE สูงกว่า OEE จริง ≥ 3 จุด · หนักสุด −42 จุด)

### แท็บ "ภาพรวมวันนี้" ใน /oee-analytics — การ์ดกะที่กำลังผลิต + เป้ากะ (2026-08-05)

- **การ์ดแรกคือ "กะที่กำลังผลิตอยู่ตอนนี้"** (ไม่มีกะเปิด = "กะล่าสุดของวันที่เลือก") — เดิมค่า A/P/Q/OEE เป็น `—` ตลอดเพราะอ่านจาก `oee_a/p/q` ที่ **stamp ตอนปิดกะเท่านั้น** · แก้แล้ว: กะที่ยังไม่ปิดคำนวณ**สด**ผ่าน util กลาง **`src/utils/liveOee.js` (`computeLiveOee`)** ซึ่ง `FactoryMap` ใช้ร่วม (ตัวเลขตรงกันทุกจอ) · ปิดกะแล้วยังใช้ค่า stamp เสมอ — **ห้ามคำนวณซ้ำด้วย master ปัจจุบัน**
  - สูตรสด (ประมาณระหว่างกะ): A = run ÷ elapsed · P = Σ(qty×CT) ÷ run · Q = ดี ÷ (ดี+เสีย) · DT ที่เปิดค้างนับถึงตอนนี้ · **ไม่หัก break policy** (ต่างจากสูตรตอนปิดกะโดยตั้งใจ)
  - **ยังไม่ผลิตชิ้นแรก (`produced = 0`) → คืน P/Q/OEE = null (`noOutput: true`) ห้ามคืน 0** — เคยทำการ์ดขึ้น "OEE 0%" แดงทั้งที่กะเพิ่งเปิด 19 นาที · A ยังคำนวณได้ปกติ
  - < 10 นาทีแรกของกะ (`LIVE_MIN_ELAPSED`) = null (ตัวหารเล็กเกินไป) · การ์ดอธิบายสถานะเป็นข้อความไทยใต้หัวข้อ + ป้าย "· สด"
  - ชิ้นงานในการ์ดดึงจาก **ใบงานจริง** (`prod_orders`) ไม่ใช่ `session.product_id` (ซึ่งมักว่างเพราะไลน์วิ่งหลายพาร์ทต่อกะ)
- **เป้ากะในการ์ด "จำนวนชิ้นงานที่ผลิตรวมของวันนี้"**: `target_qty` → **ไม่ได้ตั้ง (0 = เกือบทุกกะ) ให้รวมเป้าใบงาน (`qty_target ?? qty`)** — กฎเดียวกับ MorningMeeting · เดิม fallback มีเฉพาะกะที่มีงานคู่ RH/LH ทำให้ขึ้น "ยังไม่ตั้งเป้ากะ" ทั้งที่ใบงานมีเป้าครบ (เทียบข้อมูลจริง: 66/66 กะกลับมามีเป้า) · **ห้าม fallback ไป `std_day_shift`** (นั่นคือจำนวน "คน")
- **หัวข้อการ์ดในแท็บนี้ไม่ใช้เลขนำ (1.1 / 1.2 / 2 / 3)** — เลขเดิมเรียงไม่ตรงตำแหน่งจริงบนจอ ทำให้สับสน (คำสั่ง user 2026-08-05) · เพิ่มการ์ดใหม่ให้ตั้งชื่อหัวข้อสื่อความหมายตรงๆ ไม่ต้องไล่เลข

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
- **💰 Cost Saving (2026-08-11 · คำสั่ง user):** การ์ดโปรเจคแปลงผลก่อน/หลังเป็น **บาท/วัน + บาท/เดือน + ระยะคืนทุน** — โมเดล standard costing ของบัญชี:
  - **Activity rate ต่อ cost center** (DL/OH/DP บาท/ชม.) = ตาราง **`cost_center_rates`** (Main · migration `20260811_cost_center_rates_main.sql` · audit+updated_at ผูกแล้ว) — จัดการที่ **`/org-setup` แผง "💰 Activity Rate"** (`src/components/CostCenterRatePanel.jsx`) · เก็บแบบ **`effective_from`** (บช. ปรับรายปี — เพิ่มแถวใหม่ ไม่ทับประวัติ โปรเจคเก่าคำนวณด้วย rate ณ start_date)
  - **⚠️ rate มีที่ "ระดับกลุ่ม" (cost center ชุด 21406 — org kind='line'/production_lines) เท่านั้น (คำสั่ง user 2026-08-11)** — ระดับส่วน (21404)/แผนก (21405) **ไม่กรอก rate** · ยอดระดับบน = **sum ขึ้นตาม hierarchy จากกลุ่ม** (แถบสรุปใน /improvements: กลุ่ม → ส่วน → รวม) · แผง rate จึงลิสต์เฉพาะรหัสระดับกลุ่ม (+ ปุ่มแสดงทั้งหมด · รหัสที่ไลน์ใช้แต่ไม่ขึ้นต้น 21406 = badge เตือน data drift — เจอจริง: GOR/LWR BAR ใช้ 21405xxxx, LINE A พิมพ์ 21040661101 เกินหลัก)
  - **ต้นทุน/ชิ้น** = `parts_master.material_cost` (raw mat) + **`standard_cost`** (บช. คำนวณ รวม mat+DL+OH+DP — **มีค่าแล้วชนะ material_cost เสมอ**) — กรอก/นำเข้า CSV ที่ Product Master → 🗂 Parts Master (คอลัมน์ CSV ใหม่ optional — ไฟล์เก่า/เซลล์ว่างไม่ล้างค่าเดิม · ⚠ PostgREST bulk upsert บังคับทุก object คีย์ชุดเดียวกัน ห้าม spread รายแถว — เติมค่าเดิมกลับแทน) · migration `20260811_improvement_cost_saving_dr.sql` (DR — + `improvements.invest_cost` เงินลงทุน→payback)
  - **สูตร (helper `src/utils/costSaving.js` + `costSavingOf` ใน Improvements.jsx):** downtime = Δนาที/วัน × rate/60 · defect = Δชิ้น/วัน ราย mat × ต้นทุน/ชิ้น (standard_cost ‖ material_cost + conversion CT×rate/3600) · mtn = **Δค่าซ่อมจริง** (`mtn_orders.labor_cost+parts_cost` ต่อใบ) + Δนาที breakdown × rate · cost center ของไลน์ = `lineCostCenter` (ลูกไม่กรอก = ตกทอดไลน์แม่ pattern เดิม) · บาท/เดือน = × `countWorkingDaysInMonth` (ปฏิทินบริษัท)
  - **แสดง DL/OH/DP แยก 3 ก้อนเสมอ + เลือกได้ว่ายอดรวมนับก้อนไหน** (default ทั้งหมด — บางนโยบายบัญชีไม่นับ DP เป็น sunk cost · จำใน `localStorage['imp_cost_comps']`) · **ข้อมูลไม่ครบ = ขึ้น ⚠ บอกว่าขาดอะไร+แก้ที่ไหน ห้ามเดาตัวเลข** (ไม่มี cost center / ไม่มี rate / พาร์ทไม่มีต้นทุน)
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

- **4 แท็บ:** ✅ บันทึกผลตรวจ (ตอบ Y/N/T/NA รายข้อ + ปุ่ม "ยังไม่ตอบ=Y" · **N/T บังคับกรอกรายละเอียดปัญหา** · ลายเซ็น default จาก profiles.signature_url เซ็นใหม่ได้) · 📅 แผนตรวจ **(มองทีละไตรมาส — เห็น 3 เดือนเรียงกัน · 2026-07-20)** + ปุ่มเลื่อนไตรมาส · 📊 รายงาน (grid คำถาม×วัน + W1-4/M/Q + ลิสต์ปัญหา N/T) · ⚙️ คำถาม (สิทธิ์ manage — **จัดการรายไลน์ 2026-07-23:** dropdown เลือก "🌐 ทุกไลน์ (common)" หรือรายไลน์ · โหมดไลน์เห็น common (ฐาน) + ข้อเฉพาะไลน์ · ข้อ common กด **🚫 ซ่อนไลน์นี้** ได้ (เขียน `hidden_for_lines[]` ไลน์อื่นไม่กระทบ) · ข้อเฉพาะไลน์ (line_name=ไลน์) เพิ่ม/แก้/ลบเต็มที่ · special ผูกช่วงวันที่ · **ต้อง apply migration `20260723_lpa_question_hidden_for_lines.sql` ก่อน** ปุ่มซ่อนถึงทำงาน — ก่อน apply: เพิ่ม/แก้ข้อรายไลน์ได้ปกติ แค่ซ่อน common ไม่ได้)
  - **สถานีตรวจ (Station for audit) ดึงจาก "จุดงาน (workstations)" อัตโนมัติ (2026-07-20):** ปุ่ม 📍 ดึงจุดงานในไลน์ (`workstations.station_name` ของไลน์+ไลน์ย่อยในครอบครัว — Main project) → เติมเป็นสถานีตั้งต้น แล้วแก้เอง · auto-fill ตอนไลน์ยังไม่มีแผน · **LPA = audit กระบวนการ/คนที่จุดงาน ไม่ใช่ตรวจทุกเครื่องจักร → ใช้ workstations ไม่ใช่ `machines`** (คำสั่ง user — จุดงานต่อไลน์ ~10-20 จุด น้อยกว่าเครื่องจักร) · รายชื่อสถานี+ชื่อผู้ตรวจ (Leader/SV/MGR/GM) เป็น **ชุดเดียวใช้ทั้งไตรมาส**
  - **⚡ เติมแผนทั้งไตรมาส:** กระจายจุดงานให้ **ครบทุกจุดภายในแต่ละเดือน** (สถานี/วัน = `⌈จำนวนจุดงาน ÷ วันทำงาน⌉` — เกิน 1 วันจะใส่หลายสถานีคั่นด้วย `,`) · Leader ทุกวันทำงาน · SV วันทำงานแรกของแต่ละบล็อกสัปดาห์ · MGR 1 วัน/เดือน · GM 1 ครั้ง/ไตรมาส (เดือนแรก) · 💾 บันทึกแผนไตรมาส = upsert `lpa_plans` 3 เดือน + แทน `lpa_plan_days` · สถานะ ○ วางแผน / ● ตรวจแล้ว / ⊗ เลยกำหนด derive จาก lpa_audits · **บันทึกผล/รายงาน/พิมพ์ยังเป็นราย"เดือน"** (เลือกเดือนโฟกัสในไตรมาส)
- **พิมพ์ 2 ฟอร์ม** (window.open + print): ใบแผน A4 landscape (สัญลักษณ์ ○●⊗ คอลัมน์วันหยุดเขียว สถานีแนวตั้ง) + ใบรายงาน FM-QMR-008 A3 landscape (หมวดแนวตั้ง rowspan, ข้อ special สีแดง + Issue Date, W1-4 เขียว/Monthly เทา/Quarterly เหลือง, แถว Work Station + ลายเซ็นผู้ตรวจรายวัน, legend + Effective Date 12/05/2017) · **ลายเซ็นในช่องวันหมุนตะแคงแนวดิ่ง (rotate -90°) ตามฟอร์มกระดาษเดิม** (2026-08-06 · ทีมงานแนะนำ) — ช่องวันกว้าง ~20px แต่สูง 56px วางแนวนอนจะถูกย่อจนอ่านไม่ออก · **`transform` ไม่เปลี่ยนกล่อง layout** → ต้องวาง `<img>` แบบ absolute กลางช่องก่อนแล้วค่อยหมุน (ทิศเดียวกับข้อความ `vertical-rl` ที่ใช้ทั้งใบ = อ่านล่างขึ้นบน) — ฟอร์มพิมพ์อื่นที่มีช่องเซ็นแคบให้ใช้ pattern เดียวกัน
- **วันหยุด** = ปฏิทินบริษัท (`company_calendar` มาร์คแล้วตาม day_type, ไม่มาร์ค = เสาร์/อาทิตย์หยุด) — ตรรกะเดียวกับ countWorkingDays ฝั่ง kanban
- **Weekly mapping:** วันที่ 1-7 = W1 · 8-14 = W2 · 15-21 = W3 · 22+ = W4 (`weekOfDay`)
- สิทธิ์: ดู = ทุก role · `lpa:record` = mgr/sv/leader/engineer/qa · `lpa:manage` (แผน+คำถาม) = mgr/sv · `lpa:delete` = mgr · Scope ไลน์: leader = family ตัวเอง, role อื่นตาม sections (pattern มาตรฐาน)
- migration: `20260720_layer_process_audit.sql` (Main — ตาราง 5 + seed คำถาม 23 ข้อ + permission)

---

## Scrap Report — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export · 2026-07-16)

หน้า `/scrap-report` (`ScrapReport.jsx`, **กลุ่มฝ่ายผลิต** — ฝ่ายผลิตเป็นผู้ใช้งานหลัก) — แทนฟอร์มกระดาษ "ใบรายงานของเสีย" ที่เขียนมือ · ลงยอด scrap ต่อ **ไลน์/วัน** แล้ว export Excel ตรงฟอร์ม 100% · ⚠️ `production_lines` อยู่ **Main project** (client `supabase`) ไม่ใช่ DR — dropdown ไลน์ต้องดึงจาก `supabase` (เคยพลาดใช้ `supabaseDR` แล้ว dropdown ว่าง)

- **ตาราง (DR project — anon RLS):** `scrap_reports` (หัวใบ: report_date, line_name, dept/section/division, product_categories[], storage_location, doc_no, สายอนุมัติ inspector/requester/approver_qa/pd/gm, sender/receiver, status draft/submitted/approved) · `scrap_report_items` (รายการต่อพาร์ท: source main/sub, part_no/part_name/mat_no/model/code A-E/bom_ref, qty, m_cause m1-m5, stage in_process/post_process, confirm_qty, defect_codes, src_defect_from_logs) · `scrap_defect_types` (master P1-P20 กระบวนการ / A1-A18 ประกอบ-เชื่อม — seed จากชีท Defect Type จริง) · migration `20260716_scrap_report.sql` (DR) + `20260716_scrap_report_permissions.sql` (Main)
- **sync = ดึงตั้งต้น + แก้เองได้ (คำสั่ง user):** ปุ่ม "⤵ ดึงจาก Daily Report" รวม `defect_logs.qty_ng` ของ session ไลน์+วันนั้น group ตาม `prod_orders.mat_no` → เติมแถว main product (flag `src_defect_from_logs`) แล้วแก้/เพิ่มได้ · **พาร์ทย่อย** (nut/สกรู ที่เสียก่อนเข้ากระบวนการหลัก — ไม่มีใน production session) เพิ่มเองผ่านปุ่ม "เพิ่มจาก SAP/BOM" (ดึง `dr_products` main + `bom_items` sub + **`parts_master` sub (2026-08-06)** — พาร์ทซื้อนอก 300/วัตถุดิบ 500 ที่ยังไม่ถูกผูกใน BOM ใดเลย (~257 รายการ) เดิมไม่ขึ้นให้เลือกต้องกรอกมือ · dedupe ด้วย mat_no ลำดับ dr_products > bom_items > parts_master) หรือกรอกมือ
- **⚠️ กับดัก: `dr_products.p_no` บางไลน์ถูกกรอกเป็น "หมายเลขเครื่อง" ไม่ใช่เลขพาร์ท (2026-08-05)** — เจอจริง **SUB APRON** 4 แถว p_no = `SP-72/74/83/88` (ตรงกับ `machines.machine_no` เป๊ะ) + `mat_no` เป็นข้อความ ("M10 ไม่มีเกลียว") ไม่ใช่เลข SAP → ใบ Scrap พิมพ์ PART NO. เป็นหมายเลขเครื่อง · **เป็นปัญหา data ไม่ใช่ logic — ต้องไปแก้ที่ `/products`** · โค้ดไม่ปล่อยเงียบ: SAP/BOM picker โหลด `machines.machine_no` มาเทียบ เจอ p_no ตรงหมายเลขเครื่อง → **ไม่เอามาเป็น part_no (ปล่อยว่างให้กรอกเอง) + ป้าย ⚠ ในลิสต์ + toast เตือนตอนเลือก** (flag `badMaster`) · หน้าอื่นที่ใช้ `p_no` เป็นเลขพาร์ทลูกค้า (Planner&Sales map EDI, Production Plan `resolveMat`) เจอปัญหาเดียวกันได้ — master ผิดกระทบทุกที่ที่ map ด้วย p_no
- **export Excel (`src/lib/scrapExportExcel.js`):** ExcelJS วาดตรง layout FM-PD2-002 Rev.06 (หัวบริษัท, ตาราง A-S: ลำดับ/PART NO/NAME/MAT SAP/รูป/MODEL/CODE/BOM/Q'TY/M1-M5/ยืนยัน/รหัสงานเสีย, TOTAL, CODE legend A-E, สายอนุมัติ 5 ขั้น, ผู้ส่ง/รับ HRM) · **⚠️ ช่อง M1-M5 = เครื่องหมายติ๊ก `✓` ว่าเสียเพราะสาเหตุไหน ไม่ใช่จำนวน** (จำนวนอยู่คอลัมน์ Q'TY/ยืนยันแล้ว — เดิมใส่ `qty` ทำให้ดูเหมือนยอดของเสียซ้ำสองที่ · แถว TOTAL ของ M1-M5 = **จำนวนรายการ**ที่ติ๊กสาเหตุนั้น · แก้ 2026-08-05) · ตรึง 27 แถวเหมือนกระดาษ
- **พิมพ์/บันทึก PDF (`src/lib/scrapPrint.js` · 2026-08-05):** ปุ่ม 🖨️ PDF ข้างปุ่ม Excel ในลิสต์ใบ — window.open + print (pattern เดียวกับ LPA/OJT/MO) วาด HTML layout เดียวกับ Excel (A4 portrait) · **เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้ อ่านจากทะเบียนเอกสารเดียวกัน** (`getDocForm('scrap_report')` + `urlToDataUrl(df.logo_url || tsLogoUrl)` + `fullCode` มุมล่างขวา) — แก้ที่ `/doc-forms` มีผลทั้ง Excel และ PDF · เซฟ PDF จาก dialog พิมพ์เบราว์เซอร์ · popup ถูกบล็อก = toast บอก · **เลขฟอร์ม/Rev/ป้ายช่องลายเซ็น 5 ช่อง อ่านจากทะเบียนเอกสาร `getDocForm('scrap_report', {fallback})` — register แล้ว (`20260724_doc_form_scrap_report.sql`) แก้ที่ /doc-forms ได้ · fullCode พิมพ์มุมล่างขวา (2026-07-24)** · CODE legend A-E เป็น form body ไม่อยู่ใน registry
- **สิทธิ์:** ดู = `page:/scrap-report` (admin/mgr/sv/leader/qa/doc_control) · `scrap:record` (สร้าง/แก้) = admin/mgr/sv/leader/qa · `scrap:manage` (อนุมัติ/ลบ) = admin/mgr/qa
- เลขเอกสาร running รายวัน `TSAT4-PDX NNNN/เดือน-ปี` (นับใบในเดือน)

---

## QA Inspection — setup → ใบตรวจ (ปิดช่องว่าง 2026-08-04)

**สายงานคุณภาพแบ่งชัด 2 หน้า — อย่าเอาไปปนกัน:**

| | หน้า | ทำอะไร | ตาราง |
|---|---|---|---|
| **ตั้งมาตรฐาน** | `/qa-setup` มาตรฐานการตรวจ & Drawing | part master · อัพโหลด drawing หลายแผ่น · วาง balloon · กำหนดสเปค/Rank/Stage/ความถี่-n ต่อจุด | `qa_parts`, `qa_part_drawings`, `qa_inspection_items` |
| **ใช้งาน (ตรวจจริง)** | `/qa` แท็บ **✅ ใบตรวจ (Check Sheet)** | เลือกพาร์ท+วันงาน+กะ+รอบ → ตัดสิน ผ่าน/ไม่ผ่าน/ข้าม รายจุด → ปิดใบ | `qa_inspection_sheets`, `qa_inspection_results` |

- **ที่มา (คำสั่ง user):** เดิม `qa_inspection_items` **ไม่ถูกอ่านจากหน้าไหนเลยนอกจากหน้า setup เอง** → จุดชนิด **attribute (GO/NOGO) ไม่มีที่ลงผลเลย** ส่วน variable ไปได้ทางเดียวคือปุ่ม "ส่งเข้า SPC" (คัดลอกไป `qa_characteristics` **แบบไม่ผูก FK กลับ** — แก้สเปคที่ setup ทีหลังไม่ตามไปแก้ฝั่ง SPC) · แท็บใบตรวจปิดช่องว่างนี้ · migration `20260804_qa_inspection_check_sheet.sql` (Main)
- **1 ใบ = พาร์ท + วันงาน + กะ + รอบที่** (`unique(part_id, work_date, shift, round_no)`) — ความถี่แบบ "3 ชิ้น/กะ" = เปิดหลายรอบในกะเดียวได้ · **สร้างใบเมื่อบันทึกผลจุดแรกเท่านั้น** (ไม่ทิ้งใบเปล่า) · ชนกัน 2 เครื่อง = unique key กันให้ แล้วดึงใบของจริงมาใช้ต่อ
- **snapshot ชื่อจุด/สเปค/ชนิด ลงในแถวผลเสมอ** (`qa_inspection_results.balloon_no/characteristic/spec_text/item_type`) — มาตรฐานถูกแก้/ลบทีหลังได้ แต่ผลตรวจย้อนหลังต้องอ่านออกเหมือนวันที่ตรวจจริง (`item_id` เป็น `on delete set null`) · หลักเดียวกับ `ojt_training_attendees`/`lpa_audit_answers`
- **กฎที่คุมไว้ในแอป:** NG **บังคับกรอกรายละเอียด** (ผลตรวจที่ไม่บอกว่าเสียยังไง ใช้ต่อไม่ได้ — หลักเดียวกับ downtime "อื่นๆ") · จุด variable ที่ค่าหลุดสเปคแล้วกด "ผ่าน" = **บล็อก** พาไปฟอร์ม NG แทน (กันบันทึกของเสียเป็นของดี) · **ปิดใบไม่ได้จนกว่าจะตรวจครบทุกจุด** · บันทึกทีละแถวทันที (จอดับ/แบตหมดแล้วไม่หายทั้งใบ)
- **ปุ่ม "✓ ผ่านทั้งหมดที่ยังไม่ตรวจ"** ลดการกดซ้ำตอนทุกจุดปกติ (pattern เดียวกับ LPA "ยังไม่ตอบ=Y") — ไม่แตะจุดที่บันทึกผลไปแล้ว
- **NG → เปิด NCR ได้จากในแถว** (prefill พาร์ท/ไลน์/จุด/สเปค/จำนวน · severity จาก Rank: SC=critical · M=major · อื่น=minor) แล้วเก็บ `qa_inspection_results.ncr_id` ผูกกลับ — **เปิดได้แม้ใบปิดแล้ว** (NCR เป็นงานตามหลัง ไม่ใช่การแก้ผลตรวจ)
- **หมุดบนแบบ sync กับผลตรวจ** (เขียวผ่าน/แดงไม่ผ่าน/เทาข้าม/ยังไม่ตรวจ = สีตาม Rank) แตะหมุด ↔ เลื่อนไปแถวนั้น · ใช้ `CalloutPin` + สูตรรูปพอดีกรอบ 2 แกนตัวเดียวกับ `/qa-setup` (UI-CONVENTIONS §5.1)
- **สิทธิ์:** ดู = ทุก role ที่เข้า `/qa` ได้ · บันทึก/ปิดใบ/เปิด NCR = `qa:record` · ลบ = `qa:manage` (RLS pattern เดียวกับ `qa_measurements`/`qa_ncr`) · **Scope:** leader = family ไลน์ตัวเอง · role อื่นตาม `sections` — **ตัวเลือกพาร์ทก็ scope ด้วย** (พาร์ทที่ไม่ผูกไลน์ยังเห็นได้ทุกคน)
- `nextDocNo` ย้ายจาก QualityControl.jsx → **`src/utils/qaDocNo.js`** (ใบตรวจเรียกใช้ตัวเดียวกันโดยไม่เกิด circular import)
- **ยังไม่ทำ:** ผลตรวจยังไม่ไหลเข้า SPC อัตโนมัติ (จุด variable ที่กรอกค่าในใบตรวจ ยังไม่สร้าง `qa_measurements` ให้เอง — ต้องกด "ส่งเข้า SPC" ที่ setup แล้วกรอกที่แท็บ SPC เหมือนเดิม) · ยังไม่มีฟอร์มพิมพ์ใบตรวจ (ถ้าจะทำ ต้อง register ใน `/doc-forms` ตามกฎเอกสาร)

---

## Factory Master Map — ผังรวมโรงงานผังเดียว (2026-07-16)

หน้า `/factory-map` (`FactoryMap.jsx`, กลุ่มฝ่ายผลิต) — รูปผังใหญ่ของทั้งโรงงาน **1 รูป** แล้ววาด **polygon (รูปทรงอิสระ)** ล้อมพื้นที่แต่ละไลน์ ระบายสีตามสถานะการผลิตของไลน์นั้น — ดูทุกไลน์บนจอเดียว (เหมาะจอ TV)

- **ตาราง (Main project):** `factory_map` (รูปผังใหญ่ 1 รูป — image_url) · `factory_line_regions` (line_name unique, `points` jsonb = `[[x,y],...]` เป็น % ของรูปจริง 0-100 วนรอบ polygon) · migration `20260716_factory_master_map.sql` + `20260716_factory_map_permissions.sql`
- **polygon ไม่ใช่แค่สี่เหลี่ยม** — รองรับไลน์รูป L/U shape (คำสั่ง user) · วาดโดยคลิกทีละจุดล้อมพื้นที่ คลิกจุดแรกซ้ำ/กด "เสร็จ" = ปิดรูป · แก้: ลากกลางรูป=ย้ายทั้งไลน์, ลากจุดมุม=ปรับรูปทรง · dropdown เลือกไลน์ + Shift ล็อกเส้นตั้งฉาก + แม่เหล็กดูดปิดรูปเมื่อใกล้จุดแรก
- **ตีกรอบได้ทั้ง "กลุ่มบนสุด (1 กรอบรวมลูก)" หรือ "รายไลน์ลูก" — แต่ห้ามซ้ำซ้อน (2026-08-04):** กลุ่มถือว่า "ตีแล้ว" เมื่อตีที่ตัวแม่เอง **หรือ** ตีรายไลน์ลูกแล้ว (`coveredTop`) — ตีลูกครบแล้วชื่อแม่หายจาก dropdown/ตัวนับเอง ไม่ต้องตีแม่ซ้ำ (กรอบแม่จะทับลูก) · กลุ่มที่ตีลูกไปบางส่วน dropdown มี optgroup "↳ ไลน์ย่อยที่ยังไม่ได้ตี" ให้ตีต่อจนครบ · **กรอบแม่อัตโนมัติ (`autoHulls` 2026-08-04):** แม่ที่ไม่ได้ตีเอง+ลูกถูกตีแล้ว → ระบบวาด**เส้นประ convex hull ล้อมกรอบลูกทั้งหมด** + ป้ายกลุ่ม ▣ ยอดรวมทั้ง family (คำนวณสดตอน render ไม่เก็บ DB) — แก้ปัญหา "เช็คชื่อกันที่ไลน์แม่" (`employees.line_id` = แม่) ที่เดิมข้อมูลคนไม่โผล่บนผังเพราะแม่ไม่มีกรอบ · คลิก/hover hull = ข้อมูลรวมกลุ่ม (พื้นที่ทับลูก ลูกชนะเพราะวาดทีหลัง) · ซ่อนตอน edit · เดิม (2026-07-16) เคยเป็น leaf-only แล้วเปลี่ยนเป็น top-level แล้วชนกัน: ตัวนับ/dropdown นับเฉพาะชื่อแม่ตรงๆ ทำให้กลุ่มที่ตีลูกครบยังค้างในลิสต์ (user งง)
- **ตีกรอบโซน MTN/Facility ได้ด้วย ไม่ใช่แค่ไลน์ผลิต (2026-07-31 · คำสั่ง user):** dropdown "ตีกรอบให้ไลน์/โซนไหน" มี 2 optgroup — 🏭 ไลน์ผลิต (`topNames`) + 🔧 โซน MTN/Facility (`pm_facility_areas` + `line_name` ของเครื่อง `equipment_category` facility/utility) + **➕ พิมพ์ชื่อโซนใหม่** (free text เช่น ห้องปั๊มลม/MTN Workshop) · เก็บใน `factory_line_regions.line_name` เหมือนเดิม (ไม่มี migration — กรอบที่ `line_name` ไม่ตรงไลน์ผลิตใดเลย = โซน facility ผ่าน `isFac(name)=!allProdNames.has(name)`) · โซน facility: ป้ายมี 🔧 นำหน้า · **metric ที่มีความหมาย = PM เครื่องจักร (pmStatus[zone] ทำงานอัตโนมัติ — เครื่อง facility line_name=ชื่อโซน) + Supply Route (`facilitySupply[zone]` มุมกลับ: เครื่องในโซน down/open MO → กระทบไลน์ที่จ่าย `→ feeds`)** · metric ผลิต (ยอด/OEE/DT/NG/คน/จุดงาน) โซน facility = **สี health: เขียว "🔧 ปกติ" ถ้าไม่มีเหตุผิดปกติ · ส้ม/แดงเฉพาะเมื่อมี PM ค้าง/เครื่องซ่อม** (2026-07-31 · flag `facilityNA` ใน METRICS + helper `facHealth`/`regCat`/`regText` เช็ค `st.isFac`+supAtRisk/pmOverdue/pmDueSoon — โซนช่างไม่มีกะ default เขียวไม่ใช่เทา ตามคำสั่ง user) · **คลิกโซน facility = เด้งไป `/mtn-layout?view=facility&zone=<ชื่อโซน>&from=factory-map` เปิดผังเครื่องจักรของโซนนั้นเลย (2026-08-03)** — เดิมเปิด popup เมตริกผลิตที่เป็น "—" หมด ไม่มีประโยชน์ · MtnMachineLayout รับ deep-link (`view`/`zone` เทียบชื่อ `pm_facility_areas.name` แบบ case-insensitive) + ปุ่ม "← กลับผังรวมโรงงาน" เมื่อ `from=factory-map` · **⚠️ ต้อง apply migration `20260722_machines_equipment_category.sql` + `20260722_facility_supply_links.sql` (DR) ก่อน** ถึงจะมีข้อมูล facility โชว์ — 2 migration นี้ค้างไม่ได้ apply มานาน เพิ่ง apply 2026-07-31 (ทั้งชุดฟีเจอร์ facility/utility/supply-route จาก 2026-07-22 เลยเพิ่งเริ่มมีข้อมูลจริง)
- **แสดงผล:** SVG `<polygon>` viewBox 0 0 100 100 `preserveAspectRatio="none"` + `vector-effect: non-scaling-stroke` (เส้นไม่ยืด) · รูปแสดง `width:100% height:auto` → % ตรงกับรูปเป๊ะไม่ต้องหัก letterbox · ป้ายชื่อ+ยอดวางที่ centroid เป็น **HTML** (ไม่โดน SVG ยืด)
- **⚠️ "ควรผลิตได้ ณ ตอนนี้" (เลขกลางของ metric ยอดผลิต) คิดจาก CT ไม่ใช่สัดส่วนเวลาของกะ (2026-08-03 · คำสั่ง user):** ระบบเป็น **pull — ขายเท่าไหร่ ผลิตเท่านั้น** → **เป้า (เลขขวา) = ผลรวมใบที่เปิดแล้ว ถูกต้องแล้ว ห้ามเปลี่ยน** · แต่เลขกลางเดิม = `เป้า × (เวลาที่ผ่านไป ÷ เวลากะ)` **ต่ำเกินจริง** เพราะใบทยอยเปิดระหว่างกะ (เป้าโตทีหลัง) — เคสจริง Line 60: ทำได้ 110 แต่ระบบบอกควรได้ 53 → โชว์ 209% ทั้งที่จริงยังตามหลัง · **สูตรใหม่: `ควรผลิตได้ = min(เป้าจากใบที่เปิด, เวลาที่มีให้ผลิต ÷ CT)`** โดย **เวลาที่มีให้ผลิต** = ตั้งแต่ **max(เริ่มกะ, เปิดใบแรก)** ถึงตอนนี้ (ไม่เกินเวลาเลิกกะ) **− เวลาพักตามแผน (`break_policies` ที่ผ่านไปแล้ว) − หยุดตามแผน (planned downtime)** · **ไม่หัก unplanned downtime** (ต้องเห็นว่าตามหลังเพราะเครื่องเสีย) · CT = ถ่วงน้ำหนักตามสัดส่วนเป้าของแต่ละ mat ในกะ · **สินค้าไม่ได้ตั้ง CT → ถอยไปสูตรเดิม** (สัดส่วนเวลาของกะ) · เพดาน `min(เป้า, …)` = หลัก pull ห้ามคาดหวังเกินที่ลูกค้าดึง
  - **⚠️ ไลน์เครื่องขนาน: กำลังผลิต = N ÷ CT ไม่ใช่ 1 ÷ CT (2026-08-06 · user ให้ตรวจ SUB APRON)** — เคสจริง SUB APRON ผลิต 2500 แต่ระบบบอก "ควรได้ 796" = **314%** ทั้งที่ของออกปกติ (ยอดจริง = 3.14 เท่าของกำลังเครื่องเดียว) · แก้: คูณ `parallelUnitsOf(line)` เข้ากับกำลังผลิต · **ไลน์ที่ `flow_mode='parallel_machine'` แต่ยังไม่ตั้ง `parallel_stations` = ไม่รู้ N จริง ห้ามเดา** → ถอยไปสูตรอัตราตามเวลา (เป้า × สัดส่วนเวลาที่ผ่านไป) ซึ่งไม่ต้องรู้ N · **ห้ามนับจากทะเบียนเครื่อง** (SUB APRON ลงไว้ 14 ตัวแต่รวมจิ๊ก/โรบอท — เอามาหารจะเพี้ยนหนักกว่าเดิม) · **ตั้ง `parallel_stations` ที่ `/linesetup` แผง ⚙️ ตั้งค่าไลน์ → 🏭 คุณสมบัติของไลน์นี้** แล้วตัวเลขจะกลับมาคิดจากกำลังผลิตจริง
  - **⭐ N ที่ตั้งไว้ = "เต็มกำลัง" · วันไหนคนไม่พอต้องคิดตามที่เดินจริง (2026-08-06 · คำสั่ง user "เดินได้พร้อมกัน 6 เครื่อง แต่บางทีคนไม่พอ ก็จะเดินตามที่มีกำลังคน"):** เครื่องที่เดินได้จริง = `N × สัดส่วนกำลังคน` · clamp `[1, N]` · **ไม่มีข้อมูลกำลังคน = ไม่ปรับ ใช้ N เต็ม ห้ามตีเป็น 0 คน** · ตรวจกับข้อมูลจริง SUB APRON: N=6 · จุดงาน 6 มีคน 3 → คิด 3 เครื่อง = 2388 ชิ้น · ของออกจริง 2500 (3.14 เท่าของเครื่องเดียว) = **ตรงกับที่โมเดลทำนาย** · popup บอกกำกับเสมอว่า "คิดจากเดิน 3/6 เครื่อง (ตามกำลังคนที่มา)" ห้ามเปลี่ยนตัวหารเงียบๆ · ⚠️ `loadStatus` เป็น useCallback deps แคบ ต้องอ่านผ่าน `manpowerRef`/`manualLineRef` (อ่าน state ตรงๆ จะ stale)
    - **⚠️ ปรับเฉพาะ "ไลน์ที่คนโหลดเข้า-ออกเอง" (คำสั่ง user 2026-08-06: "เฉพาะไลน์ manual ที่ใช้คน load in-out ถึงคิด · บางไลน์ออโต้เป็นแค่พนักงานยืนซัพพอร์ท")** — ตัดสินจาก `machines.automation_level` ของเครื่องผลิตในไลน์: `manual` มากกว่า `auto`+`semi_auto` = ไลน์ manual · ไลน์ auto/semi เครื่องเดินเองได้ **ห้ามหารด้วยกำลังคน** · ไม่มีข้อมูล automation_level = ไม่ปรับ (ไม่เดาแทนหน้างาน) · ข้อมูลจริง: SUB APRON = manual/standalone 6 เครื่อง (ปรับ) · LASER-345/789 = auto/inline (ไม่ปรับ)
    - **⚠️ ถ่วงตามเวลา ไม่ใช่ดูแค่ ณ ตอนนี้ (user ถาม "ถ้าผ่านไป 4 ชั่วโมง มีการย้ายคนไปอีกเครื่อง ระบบจะรู้มั้ย")** — ใช้ `station_assignment_logs` (มี `started_at`/`ended_at` ต่อคน-จุดงาน เขียนจริงอยู่แล้ว) รวม "นาที-จุดงานที่มีคนอยู่" ตั้งแต่ต้นกะถึงตอนนี้ ÷ (จำนวนจุดงาน × นาทีที่ผ่านไป) · เดิมใช้ภาพ ณ ตอนนี้คูณเวลาทั้งกะ → ต้นกะเดิน 3 เครื่อง บ่ายย้ายมา 6 จะคิดเป็น 6 ทั้งกะ (คาดหวังสูงเกิน) · ไม่มี log ค่อยถอยไปภาพ ณ ตอนนี้ (`stationFilled/stationTotal`) แล้วค่อย `present/headTotal` · ตรวจข้อมูลจริง SUB APRON วันนี้: 3 คน × 196 นาที ÷ (6 จุด × 196 นาที) = 0.50 → เดิน 3 เครื่อง ✓
  - **⚠️ OEE บน modal เรื่องราวรายไลน์ ต้องใช้ค่าเดียวกับผัง (2026-08-06 · user ทัก "แปลกๆ มั้ย"):** modal อ่าน `production_sessions.oee` (stamp ตอนปิดกะ) ตรงๆ → กะที่ยังเปิดขึ้น **"—"** ขณะที่การ์ด hover บนผังเดียวกันโชว์ **"OEE 99% (สด)"** = จอเดียวกันตอบคนละอย่าง · แก้: `loadStatus` เก็บ OEE สดต่อ session ไว้ที่ `liveOeeRef` แล้ว modal อ่านตัวเดียวกัน (ปิดกะแล้ว = ค่า stamp · ยังเปิด = สด + ป้าย "(สด)") — **จุดใหม่ที่โชว์ OEE ของกะที่ยังเปิด ห้ามอ่าน `s.oee` ตรงๆ**
  - **ป้ายบนผังไม่โชว์ % (2026-08-06 · คำสั่ง user "คนจะงง ชนกับ OEE")** — เอาแค่ `ทำได้/ควรได้ตอนนี้/เป้ากะ` · สีกรอบยังบอกว่าทันจังหวะไหม · % เต็มๆ ดูที่ popup (ไม่แตะ) · **เลข 3 ตัวติดกันต้องมี legend อธิบายเหนือผังเสมอ** ไม่งั้นคนอ่านไม่ออก · ผลข้างเคียงที่ดี: ป้ายสั้นลง จอ 1250px ข้อมูลเต็มเพิ่มจาก 21 เป็น 24/27
  - **ยังไม่ทำ (เฟสถัดไป):** ไลน์ที่**ยังไม่เปิดใบเลย** เป้า = 0 → ควร fallback ไป `dr_products.target_per_shift` (มีข้อมูลจริง เช่น 550) หรือ **forecast ลูกค้า** (`customer_forecasts` — ต้องแตกรายเดือน ÷ วันทำงาน) ตามหลัก pull · ⚠️ `production_sessions.target_qty` ปัจจุบัน = 0 ทุกกะ (ไม่มีใครตั้ง) และ `prod_orders.qty_target` = NULL ทุกใบสำหรับใบสแกน — อย่าพึ่ง 2 ค่านี้โดยไม่เช็ค
- **เลือก metric ได้ 7 แบบ (2026-07-16 · +Supply Route 2026-07-22 · รวมคน+จุดงาน 2026-08-04):** แท็บบนหน้า — 📦 ยอดผลิต (ยอด/เป้า %) · ⚙️ OEE (ปิดกะ=ค่าที่ stamp · **เปิดกะ=คำนวณสด A×P×Q จากข้อมูลปัจจุบัน** ป้าย "(สด)" — สูตรย่อของ computeSessionOEE) · 🔧 Downtime (Σ `duration_min` + active) · 🚫 ของเสีย (`qty_ng`) · **👷 คน & จุดงาน (metric key `people` — รวม "คน/เข้างาน"+"จุดงานเข้าประจำ" เป็นแท็บเดียว 2026-08-04 คำสั่ง user: ป้าย `มา/ทั้งหมด คน · เข้าจุด/จุดทั้งหมด · ⚠PPE` สี=ด้านที่แย่กว่า · คน = Main `daily_production_logs` ผูก `employees.line_id` refresh 60 วิ · จุด = workstations)** · 🛠️ PM เครื่องจักร (DR `machines`→`checklists`→`pm_plans.next_due_date` นับเกินกำหนด/ใกล้ครบ ต่อไลน์ — refresh 5 นาที) · **🔗 Supply Route** (DR `facility_supply_links`+`machines`+`mtn_orders` — utility/facility จ่ายไลน์นี้ **กำลังมี MO เปิดค้าง = ไลน์กระพริบแดง "⚠ ชื่อเครื่อง ซ่อมอยู่"** · ไม่มี MO = เขียว "จ่ายโดย …" · map machine_no→open MO · refresh 30 วิ) · แต่ละ metric กำหนดสี region + ตัวเลขบนกรอบเอง (config `METRICS` ในไฟล์จุดเดียว — เพิ่ม metric ใหม่ที่นี่) · หมวดสี: good เขียว / ok เหลือง / bad แดง / down แดงกระพริบ (`region-alarm`) / idle เทา
- **อ่านง่ายบนผังจริง (2026-07-16):** ป้ายไลน์ = การ์ดทึบ (`rgba(9,11,18,0.86)`) + ขอบสีสถานะ (ไม่จมไปกับภาพ) · scrim หรี่ภาพ `rgba(6,8,14,0.32)` ให้กรอบเด่น · side panel มีชิปสรุปจำนวนไลน์ตามสถานะ + อันดับ (เลข + จุดสี + ค่า + แถบเทียบสัดส่วน)
- **Side panel ขวา (ใช้พื้นที่ข้าง — คำสั่ง user):** มี 2 โหมด (ปุ่มสลับหัวแผง) · คลิกแถว = เน้น region บนผัง (highlight ชั่วคราว) + เปิดผังไลน์/popup · โชว์ไลน์ที่ยังไม่ตีกรอบด้วย · ซ่อนตอน edit (เปิดพื้นที่วาด)
  - **📅 สรุปทบทวนรายวัน (default · 2026-08-02 — คำสั่ง user "แผงขวาซ้ำกับผัง ให้โชว์ภาพรวมเมื่อวานทั้งวันไว้ประชุมผู้จัดการ"):** ผังโชว์**สด**อยู่แล้ว → แผงขวาเปลี่ยนเป็น**สรุปทบทวนทั้งวัน (กะเช้า+ดึก)** ของวันที่เลือก (default = วันงานล่าสุดที่จบ ตรรกะเดียวกับ MorningMeeting: ก่อน 08:00 = getWorkDate ตรงๆ · หลัง 08:00 = ถอย 1 วัน) — **มีตัวเลือกวันที่ (◀ ▶ + input date, max = วันงานปัจจุบัน)** · แสดงยอดรวมทั้งโรงงาน (ผลิต/เป้า %, OEE เฉลี่ย, DT รวม, NG รวม, คนเข้างาน) + รายไลน์เรียงทำได้ต่ำสุดขึ้นบน (ปัญหาก่อน) พร้อมชิป OEE/DT/NG/คน · ใช้ค่า**ปิดกะแล้ว** (oee ที่ stamp · DT/NG/ผลิตทั้งวัน) ไม่ใช่ live · โหลด `reviewStatus` แยกจาก `lineStatus` (ไม่กระทบสีผัง) เมื่อเปลี่ยนวัน/เข้าโหมด · rollup ทั้งครอบครัวด้วย `reviewOf` · นับงานคู่ RH/LH ผ่าน `pairAwareTotal` เหมือนภาพใหญ่ · manpower ใช้ map พนักงาน→ไลน์ปัจจุบัน (ยอมรับได้สำหรับย้อนหลัง)
    - **OEE เฉลี่ย ถ่วงน้ำหนักด้วยเวลารับภาระ** (`oeeWSum/oeeWLoad`, wLoad = `shift_min − plannedMin`) ตามกฎ OEE — **ห้าม mean-of-percentages** (fallback = เฉลี่ยธรรมดาเมื่อไม่มีน้ำหนัก) · ต้อง select `shift_min` + แยก planned/non-planned downtime ต่อ session (เจอบั๊ก 2026-08-02: เดิมเฉลี่ยเปอร์เซ็นต์ตรงๆ กะเล็กถ่วงเท่ากะใหญ่ ค่าเพี้ยน)
    - **ปุ่ม ⓘ กางวิธีคิดบนจอ (2026-08-03 · คำสั่ง user "ต้องมีคำตอบอธิบายได้ เพราะบางคนจะมองว่าบวกกันหารแล้วไม่ตรง"):** เก็บรายกะไว้ใน `oeeRows` (line/shift/oee/w/shift_min/planned) ตอน `loadReview` แล้ว rollup ผ่าน `reviewOf`/`reviewTotals` → modal `oeeExplain` โชว์ **สูตร + ตารางรายกะ (OEE × เวลารับภาระ) + ผลรวม + เทียบ "ถ่วงน้ำหนัก (ที่ใช้จริง)" vs "บวกหารเฉยๆ"** พร้อมคำอธิบายว่าทำไมต่าง · ทางเข้า: การ์ด "OEE เฉลี่ย" ในแผงขวา (ทั้งโรงงาน) + ปุ่ม ⓘ ข้างชิป OEE ใน modal แยกไลน์ย่อย · **หน้าใหม่ที่โชว์ค่าเฉลี่ยถ่วงน้ำหนักควรมีทางกางวิธีคิดแบบนี้ด้วย**
    - **ลิสต์ 1 แถว/กลุ่มไลน์บนสุด** (`topNames` + กรอบที่ไม่ใช่ไลน์ลูก `!parentOf[n]`) — **ไม่ลิสต์ไลน์ลูกซ้ำ** แม้ลูกถูกตีกรอบไว้ (เช่น LWR BAR รวม Laser LWR+Assy LWR → เห็นแค่ LWR BAR ยอดรวม กันนับซ้ำในสายตา) · ใช้ทั้งโหมด review (`reviewRanked`) และ live (`ranked`)
    - **ไลน์แม่ที่มีลูกโชว์ "· ▸ N ไลน์ย่อย" (ไม่ใช่ "ยังไม่ตีกรอบ")** — เพราะเขาตีกรอบไลน์ลูก ไม่ใช่ตัวแม่ · **คลิกไลน์แม่ = เปิด modal `reviewDetail` แยกไลน์ย่อยของวันที่เลือก** (ยอดรวมกลุ่ม + แต่ละลูก ผลิต/เป้า %/OEE/DT/NG/คน · แตะลูกเปิดผังไลน์พร้อมพนักงาน) · ไลน์เดี่ยว (ไม่มีลูก) คลิก = เปิดผังไลน์ตรงเหมือนเดิม (2026-08-02)
  - **⚡ สด (จัดอันดับ):** โหมดเดิม — จัดอันดับทุกไลน์ตาม metric ที่เลือกบนผัง (ปัญหาขึ้นบน) + ตัวนับสถานะ
- **Hover preview + คลิกเปิดผังไลน์ (2026-07-21):** วางเม้าส์บนกรอบไลน์ = **การ์ดพรีวิวลอยตามเคอร์เซอร์** (เฉพาะ `pointerType==='mouse'` — จอสัมผัสไม่ขึ้น) สรุปทุก metric แบบย่อ (metric ปัจจุบันไฮไลต์) + สี region เข้มขึ้น · การ์ด hover ใช้ **theme variable ล้วน** (`--card`/`--bg3`/`--text` ฯลฯ — ห้าม hardcode สีเทา-น้ำเงินอีก เคยหลุดธีมเขียว + พังโหมด light) + วัดความสูงจริง (`hoverCardRef.offsetHeight`) แล้ว clamp/flip กันตกขอบล่าง
  - **⭐ คลิกไลน์ผลิต = เปิด modal "สรุปเรื่องราวทั้งวัน" (2026-08-03 · คำสั่ง user "กดเข้าไปเป็น layout ไลน์ ดูไม่ค่อยมีประโยชน์"):** `storyLine`/`story` — ดึงสดจาก DR+Main ตอนเปิด modal · **วันที่มาจากจุดที่คลิก (`openLine(name, date)`): คลิกกรอบบนผัง (live) = `getWorkDate()` วันนี้เสมอ (ป้าย "⚡ วันนี้ (สด)") · คลิกแถวในแถบขวาโหมดทบทวน = วันที่ในกรอบ** (คำสั่ง user 2026-08-03 — เดิมผูกกับ `panelMode` ทำให้คลิกจากผังสดได้ข้อมูลเมื่อวาน) แสดง: การ์ดสรุป (ผลิต/เป้า %, DT นอกแผน, ของเสีย, 4M) → **แยกตามกะ** (เป้า/ผลิต/OEE+A/P/Q/DT/NG ต่อ session) → **ผลิตรายชิ้นงาน** (ตาราง MAT/ชื่อ/เป้า/ผลิต/%/จำนวนใบ · ยอดรวมนับคู่ RH/LH ผ่าน `pairAwareTotal`) → **Downtime นอกแผนรายรายการ + 💬 หมายเหตุพนักงาน** (เรียงนาทีมากสุด · 🔴 ยังหยุดอยู่ · ในแผนแสดงแยกท้าย ไม่นับ loss) → **ของเสียแยกประเภท + หมายเหตุ** → **4M ของวัน + สถานะอนุมัติ** · ปุ่ม **"🏭 ผังไลน์ + พนักงาน"** ในหัว modal = พฤติกรรมเดิม (`openFloorMap` → Dashboard deep-link) · โซน facility ยังเด้งไป `/mtn-layout` เหมือนเดิม (ไม่เข้า modal นี้)
  - **(เดิม) คลิกกรอบ/แถว panel → เปิดผังไลน์พร้อมพนักงานแบบ Dashboard** (`openFloorMap` — ตอนนี้เรียกจากปุ่มใน modal): ไลน์ที่มี `line_layouts` → `navigate('/dashboard?line=NAME&from=factory-map')` ให้ Dashboard เปิด Expanded Line Map (deep-link) — ใช้ผังจริงตัวเดียวกัน ไม่ duplicate · ไลน์ที่**ไม่มีผังพื้น** → fallback popup สรุป metric + ตารางแยกไลน์ย่อย (`detailLine`)
  - **⚠️ ผังไลน์แม่-ลูกคนละรูป (คนอยู่บนผังลูก):** `floorMapTarget` เลือกผังที่**มีคนจริง** — ไลน์แม่มีผัง+คนของตัวเอง=โชว์ตัวเอง · ไลน์แม่ว่าง (คนอยู่ไลน์ลูก เช่น GOR→Assy GOR/Laser GOR) = เด้งไปโชว์**ผังลูกที่มีคนมากสุด** (จาก `manpower[n].present`) · ยังไม่มีใครเข้างาน = ผังตัวเอง/ตัวแรก · (การทาบ-สเกลพิกัดลูกลงผังแม่ผังเดียว = future enhancement ยังไม่ทำ)
  - **Dashboard รับ deep-link:** `useSearchParams` อ่าน `?line=NAME` ตอน `layouts` โหลดเสร็จ → หา layout ที่ตรงชื่อ/ครอบชื่อ (`layoutLineNamesForCard`) แล้ว `setExpandedLine` + ล้าง param (`replace:true`) กันเปิดซ้ำ · `from=factory-map` → ปิด modal แล้ว `navigate('/factory-map')` (ไม่ค้างที่ Dashboard) ผ่าน `closeExpandedLine` — backward-compatible (ไม่มี param = ไม่เปลี่ยนพฤติกรรม)
- **Dashboard "Line Floor Maps" — โหมดใหญ่สำหรับหัวหน้า (2026-07-21):** `floorBig = scopeActive && visibleLayouts.length ≤ 3` → หัวหน้า/ผู้ใช้ scope แคบ เห็นผังไลน์ตัวเอง**ใหญ่เต็มความกว้าง** (bottom grid stack 1 คอลัมน์ + floor grid `auto-fit minmax(480px,1fr)`) แตกไลน์ลูกเป็นการ์ดใหญ่แยกกัน · ภาพรวมทั้งโรงงาน (passAll/หลายผัง) คงกริดย่อ 2-3 คอลัมน์เหมือนเดิม (เหมาะจอ TV ดูรวม)
- **ป้ายบนผังกันทับกันเอง + แยกแม่-ลูก (2026-08-06 · คำสั่ง user):** เดิมป้ายไลน์ยึด "กึ่งกลางขอบบนของกรอบ" ตายตัว ไม่เลี่ยงอะไรเลย → ไลน์ที่วางชิดกันบนผังจริง (Laser GOR/Assy GOR · Laser LWR/Assy LWR) ป้ายทับกันจนอ่านไม่ออก · ตอนนี้ `labelLayout` จองกล่องแล้ววางแบบเลี่ยงกัน — **ป้ายกลุ่มวางก่อน** แล้วป้ายไลน์ (ตัวสถานะแย่กว่าได้เลือกที่ก่อน · กรอบใหญ่ก่อนเล็ก) · วัดความกว้างผังด้วย ResizeObserver · ⚠️ แกน y ต้องหาร `aspect` ให้เป็นหน่วยเดียวกับ x ก่อนเทียบ · ป้ายกลุ่ม = `▣` + ขอบประหนา + ชิป "N ไลน์" · ไลน์ลูก = `↳` นำหน้า
  - **ป้ายที่ลงในกรอบตัวเองได้ = ข้อความล้วน ไม่มีการ์ด/พื้นหลัง (2026-08-06 · คำสั่ง user):** กรอบมีพื้นสีอ่อนอยู่แล้ว ซ้อนการ์ดอีกชั้นเปลืองที่ + รก → ป้ายเล็กลง ใส่ข้อมูลได้ครบขึ้น (1800px 17/27 ใบลงในกรอบตัวเอง · 1250px เต็ม 20→21 · เหลือชื่ออย่างเดียว 3→1) · **ป้ายที่อยู่นอกกรอบยังใช้การ์ด** (ตัวหนังสือลอยบนรูปถ่ายอ่านไม่ออก) · ป้ายกลุ่มใช้การ์ดเสมอ
  - **⛔ ป้ายห้ามทับ "กรอบพื้นที่ของไลน์อื่น" (2026-08-06 · คำสั่ง user):** ทับกรอบตัวเองได้ แต่ห้ามไปนั่งบนพื้นที่ไลน์อื่น → **กรอบไลน์ทุกใบเป็น obstacle ตอนวางป้าย** (เดิมเช็คแค่ป้ายชนป้าย ป้าย Assy GOR/GOR เลยไปทับกรอบ Laser GOR/LWR BAR) · ป้ายกลุ่มเข้มกว่า: ห้ามทับกรอบไลน์ใดๆ เลยรวมลูกตัวเอง
  - **⭐ ตำแหน่งสำคัญกว่ารายละเอียด (2026-08-06 · user ทัก "ตำแหน่งมั่ว เด้งไปไกลจากไลน์"):** ป้ายใหญ่กว่ากรอบตัวเองหลายเท่า → ถ้ายืนกรานข้อความเต็มแล้วให้ตำแหน่งยืดหยุ่น ป้ายจะลอยห่างกรอบ **213px** · ลำดับที่ใช้: **ข้อความเต็ม × ทุกตำแหน่งที่ติดกรอบ → ย่อข้อความ → ชื่ออย่างเดียว → ค่อยขยับออก (จำกัด `MAX_AWAY` 9 หน่วย + เส้นประโยงกลับกรอบ) → จอกว้างที่ยังไม่พอ กลับตำแหน่งธรรมชาติยอมทับนิดเดียว** ห้ามลอยหนี · **ห้ามสลับลำดับนี้**
  - **จอแคบ (< `COMPACT_W` 820px) ย่อข้อความเหลือตัวเลขสำคัญ (`METRICS[*].short`) · PC/จอ TV ได้ข้อมูลครบเสมอ** (คำสั่ง user) · ไม่มีที่ว่างจริง = **ไม่วาดป้ายนั้น แล้วขึ้นชิปส้ม "จอแคบ · ซ่อนป้าย N ไลน์ — แตะกรอบเพื่อดู"** (ห้ามซ่อนเงียบ · กรอบสี+คลิกดูรายละเอียดยังทำงานปกติ)
  - เทสกับกรอบจริง 23 ไลน์ + 4 กลุ่ม (วัด 4 อย่าง: ป้ายชนป้าย · ป้ายทับกรอบไลน์อื่น · ห่างกรอบตัวเอง · หลุดขอบผัง): **1800px ทับ 0 · เต็ม 26/27 · 17 ใบเป็นข้อความล้วนในกรอบตัวเอง · ไม่มีใบไหนต้องย้าย** · 1250px ทับ 0 เต็ม 21 ย้าย 1 · 1100px ย้าย 5 (ไกลสุด 96px มีเส้นโยง) · 640px ซ่อน 4 · **ทับกรอบไลน์อื่น 0 · หลุดขอบผัง 0 ทุกความกว้าง** · กติกาเต็ม + กับดัก ดู `docs/UI-CONVENTIONS.md` §1 "ป้ายชื่อพื้นที่/ไลน์บนผังรวม"
- **🔴 downtime ค้างโชว์เสมอทุก metric:** จุดแดงหน้าชื่อไลน์ (แม้ดู metric อื่น) — alarm ต้องไม่ถูกซ่อน · refresh DR ทุก 30 วิ
- **สิทธิ์:** เข้าดู = ทุก role (`page:/factory-map`) · อัปโหลด/วาด/ลบ = `can('factory_map','edit')` (admin/manager/supervisor)
- **รูปเก็บ** bucket `employee-photos` path `factory/` — cleanup-orphan-photos whitelist `factory_map.image_url` + สแกนโฟลเดอร์ factory/ แล้ว (กันลบผิด) · เปลี่ยนรูปลบไฟล์เก่าทิ้ง (best-effort)

---

## Dashboard ส่วนงาน — 📋 `/dept-dashboard` (2026-08-06)

หน้าเดียวสลับส่วนงานด้วย `?dept=` — **เฟส 1: ฝ่ายผลิต · ซ่อมบำรุง · สโตร์ · QA** (ออกแบบเต็ม + ส่วนงานที่ยังไม่ทำ ดู `docs/DASHBOARD-DESIGN.md`)

- **โครง: 1 หน้า + config ต่อส่วนงาน** — `DEPTS = [{ key, icon, label, roles, load, View }]` ใน `src/pages/DeptDashboard.jsx` · **เพิ่มส่วนงานใหม่ = เพิ่ม entry (loader + View) ห้ามสร้างหน้าใหม่** (ไม่งั้นได้ dashboard คนละทรงแล้ว drift) · แท็บ default เลือกตาม role ของผู้ใช้ (mtn→ซ่อมบำรุง · qa→QA · planner_store/sale→สโตร์ · อื่น→ผลิต)
- **เลย์เอาต์บังคับ 4 ชั้นทุกใบ:** 🚨 ต้องทำตอนนี้ (คิวงานค้าง — ว่างต้องขึ้น "ไม่มีงานค้าง" **ห้ามซ่อนแผง**) → 📊 KPI (มีตัวเทียบเสมอ) → 📈 ชี้เป้าให้แก้ (ตาราง/พาเรโต) → 🔗 ทางลัด
- **อ่านอย่างเดียว** — ไม่มี insert/update/delete · ทุกแถวใน "ต้องทำตอนนี้" คือลิงก์ไปหน้าที่ทำงานจริง
- **⚠️ ลิงก์ต้องพาไปถึง "ตัวงานนั้น" ไม่ใช่หน้ารวมเปล่าๆ (2026-08-11 · user ทัก "กดแล้วไปหน้ารายงาน")** — คลิกแถวแล้วต้องเห็นรายการนั้นพร้อมกดอนุมัติ/แก้ได้ทันที ไม่ใช่ให้ไปไล่หาตัวกรองเอง · ทำแล้ว: 4M → `fourMLink(f)` = `/report?tab=4&status=&from=&focus=<id>` (helper กลางในไฟล์ ใช้ทั้ง ProductionView + QaView) · **แถวใหม่ที่เพิ่มต้องทำแบบเดียวกัน** — ถ้าหน้าปลายทางยังไม่รับ deep-link ให้ไปเพิ่ม param ที่หน้านั้นก่อน · **อย่าลืมส่งวันที่/ตัวกรองไปด้วย** ถ้าหน้าปลายทาง default เป็นช่วงวันแคบ (งานค้างมักเก่ากว่า default เสมอ — นี่คือสาเหตุที่ลิงก์เปล่าไร้ประโยชน์) · ชิปทางลัดของ QA มี "📝 4M รออนุมัติ" เปิดคิวทั้งก้อน (from = ใบเก่าสุด)
- **ห้ามคำนวณ KPI เอง** — OEE เฉลี่ยผ่าน `wavg` (utils/oee) ถ่วงด้วยเวลารับภาระ · ยอดผลิตนับคู่ RH/LH ผ่าน `pairAwareTotal` · NG ยึด `defect_logs` · DT นับเฉพาะนอกแผน · PPM = เสีย ÷ (ดี+เสีย) × 1e6
- **Scope มาตรฐาน** — leader = family ไลน์ตัวเอง · role อื่น = ตาม `sections` (helper `scopeLineNames` ในไฟล์) · สิทธิ์เข้าหน้าเดียว `page:/dept-dashboard` (migration `20260806_dept_dashboard_permission.sql` — seed ทุก role)
- **ส่วนงานที่ข้อมูลยังน้อย = adoption dashboard ไม่ใช่ analytics** (คำสั่งจากผลสำรวจข้อมูลจริง):
  - **ซ่อมบำรุง** — แผงเด่นคือ **"⚠️ เครื่องที่หยุดซ้ำ ≥2 ครั้งใน 30 วัน แต่ยังไม่มีใบแจ้งซ่อม"** (downtime 3,567 แถว vs ใบซ่อม 7 ใบ = ช่องว่างจริง) + PM เกินกำหนด/ใกล้ครบ
  - **QA** — แผงเด่นคือ **"ไลน์ที่เดินกะวันนี้แต่ยังไม่มีบันทึกของเสีย"** (ของดี 100% จริง หรือลืมลง?) + 4M รออนุมัติ QA + LPA ที่ตอบ N/T
- **ห้ามโชว์เลขที่ดูสมบูรณ์ทั้งที่ยังขาด** — KPI ผลิตมีการ์ด "กะที่ยังไม่ปิด" กำกับว่าตัวเลขยังไม่ครบทั้งวัน
- **⚠️ กับดัก: หน้าเดียวหลาย View ต้องผูกข้อมูลกับ "ส่วนงานที่โหลดมา" (`data = { dept, d }`)** — ตอนสลับแท็บ React จะ render View ของส่วนงานใหม่ **ก่อน** effect โหลดข้อมูลจะวิ่ง ถ้าเก็บแต่ก้อนข้อมูลเปล่า View ใหม่จะได้ข้อมูล**รูปทรงของส่วนงานเก่า** → พังทันที (เจอจริง 2026-08-06: `Cannot read properties of undefined (reading 'forEach')` ตอนคลิกแท็บ) · render เฉพาะเมื่อ `data.dept === dept` เท่านั้น · **build/lint จับไม่ได้ (เป็น runtime shape mismatch) — หน้าใหม่ที่สลับ View ด้วย state ต้องใช้ pattern นี้เสมอ**

---

## Group Overview — 🏢 ภาพรวมกลุ่มบริษัท TSG (MOCKUP หลายบริษัท · 2026-08-05)

หน้า `/group-overview` (`GroupOverview.jsx`, กลุ่มภาพรวม) — **เป็นตัวอย่างหน้าจอ (mockup) ไม่ใช่ระบบ multi-company จริง** สร้างตามคำสั่ง user เพื่อตอบผู้บริหารว่า "ระบบนี้ใช้กับหลายบริษัทในกลุ่ม + ดูภาพรวมข้ามบริษัทได้มั้ย"

- **🗺️ ดูได้ 2 แกน (ปุ่มสลับมุมขวาบน):** **ตามพื้นที่ (แผนที่ — default)** `TSG → โซน → บริษัท → ไลน์` · **ตามกลุ่มธุรกิจ** `TSG → กลุ่มธุรกิจ → บริษัท → ไลน์` — โซนพื้นที่ (`ZONES`) = **ไทย 2 โซน (บางนา/ตะวันออก) + 5 ประเทศ (เวียดนาม/อินโดนีเซีย/จีน/อินเดีย/อเมริกาเหนือ/แอฟริกาใต้)** ตัดขวางกลุ่มธุรกิจ — **ทั้ง 3 กลุ่มธุรกิจคละกันอยู่ในทุกโซน (ไม่ใช่ 1 โซน = 1 กลุ่มธุรกิจ)** ตามโครงจริงของกลุ่ม → แผนที่จึงต้องบอกกลุ่มธุรกิจของแต่ละหมุดได้: **ไอคอนในหมุด = กลุ่มธุรกิจ · สีหมุด = สถานะ** (2 มิติในหมุดเดียว) + **ชิปไฮไลต์กลุ่มธุรกิจ** เหนือแผนที่ (กดแล้วเห็นว่ากลุ่มนั้นกระจายอยู่โซนไหนบ้าง · ตัวที่ไม่เข้าฟิลเตอร์จาง 0.14 + ซ่อนป้าย ตาม §1) + การ์ด/ป้ายโซนโชว์ **ส่วนผสมกลุ่มธุรกิจ** (🔩2 🧩1 🏍️1) · ชั้นที่ 2-3 ใช้ component/ตัวเลขชุดเดียวกันทั้งสองแกน
- **🌏 แผนที่โลก = `src/components/WorldFactoryMap.jsx` + `src/components/worldGeo.js`:** เส้นขอบประเทศ **generate ครั้งเดียวจาก Natural Earth 110m (แพ็กเกจ `world-atlas`) แล้วฝังเป็นไฟล์ในโปรเจค** (128KB · lazy chunk) — **ไม่มี tile/CDN/API แผนที่ตอนใช้งาน** (โรงงานเน็ตปิดนอกก็ใช้ได้ · ถอน dep ออกแล้ว ไฟล์เป็นข้อมูล generate ห้ามแก้มือ) · พิกัด project equirectangular ล่วงหน้าเป็น 2000×1000 → หมุดวางด้วย lat/lon จริง · **2 ระดับ: ทั้งโลก = 1 บับเบิลต่อประเทศ (ขนาด ∝ √ยอดผลิต แบบ dashboard COVID) → คลิก = ซูมเข้าประเทศ (lerp viewBox ด้วย rAF ไม่ใช้ lib) เห็นหมุดรายโรงงาน** · ประเทศที่มีโรงงานถูกไฮไลต์ (จับคู่ด้วย `COUNTRY_META.geoName` ต้องตรงชื่อ Natural Earth) · **ป้ายชื่อ de-overlap โดยนับ "ตัวบับเบิลทุกวง" เป็นสิ่งกีดขวางด้วย** (ลองบน→ล่าง→ซ้าย/ขวา→ไกลออกไป) + เส้นประโยงกลับวง — คลัสเตอร์ไทย/เวียดนาม/จีน ชิดกันมาก ถ้าไม่ทำป้ายทับกันจนอ่านไม่ออก
- **แผนที่ไทยละเอียด = `src/components/ThailandZoneMap.jsx`** (ชายฝั่งอ่าวไทย/เจ้าพระยา/บางนา-ตราด/มอเตอร์เวย์ จากพิกัดจริง) — ใช้ตอน**เจาะเข้าโซนในไทย** (`thaiMap:true` = บางนา/ตะวันออก) · กรอบโซนคำนวณสดจาก bounding box ของหมุด + padding (เพิ่ม/ย้ายโรงงานแล้วกรอบขยับตาม ไม่มีทางหลุดกรอบ) · หมุด = **วงกลม + ป้ายชื่อใต้** ตาม §1 (สี Andon **นิ่ง ไม่กระพริบ**) · มือถือเลื่อนแนวนอน (minWidth 720) ตามข้อยกเว้น §6
- **โครงองค์กร (แกนกลุ่มธุรกิจ):** `TSG → กลุ่มธุรกิจ → บริษัท → ไลน์ผลิต` — กลุ่มธุรกิจ: **Automotive Metal Forming** (TSAT1 · **TSAT4 = บริษัทเรา** · TSLA · TSESA · TSRF) / **Plastech** / **Mocy** · breadcrumb กดย้อนชั้นได้ · **แก้รายชื่อกลุ่ม/บริษัทที่ const `ORG` จุดเดียว** (การ์ด/อันดับ/ตาราง/ชิป ตามให้เอง) · ⚠️ ชื่อบริษัทในกลุ่ม Plastech/Mocy เป็นตัวอย่าง (ยังไม่ได้รับรายชื่อจริง)
- **🏭 กรองตามประเภทไลน์ (แกนย่อยใต้กลุ่มธุรกิจ · 2026-08-05):** ชิปเหนือเนื้อหา — ปั๊ม/ไฮโดรฟอร์ม/เลเซอร์/เชื่อมประกอบ/**ฉีด/พ่นสี/ประกอบ** · **กรองแล้วมีผลทั้งหน้า** (KPI · แผนที่ · การ์ดโซน/กลุ่ม/บริษัท · ตารางไลน์ · ไลน์ที่ต้องดูแลด่วน) ไม่ใช่แค่ซ่อนแถว · บริษัทที่ไม่มีไลน์ประเภทนั้นถูกซ่อน **พร้อมบอกจำนวนบนจอ (ห้ามหายเงียบ)**
  - **นี่คือหน้าแรกที่อ่าน `production_lines.line_type` จริง** (master มีมาตั้งแต่ 2026-07-22 แต่ไม่เคยมีหน้าไหนใช้) — ไลน์บนสุดที่ไม่ได้ตั้งประเภทเอง ใช้ประเภทที่**ไลน์ลูกส่วนใหญ่**เป็น (ตัวเองตั้งไว้ชนะเสมอ)
  - **ยุบไฮโดรฟอร์มเข้ากับปั๊มขึ้นรูป (`LT_MERGE = { hydroform: 'stamping' }`)** — ผู้บริหารมองเป็น metal forming เหมือนกัน · **ยุบเฉพาะการแสดงผลในหน้านี้ ค่าใน `production_lines.line_type` ไม่ถูกแตะ** (ถ้าจะยุบทั้งระบบต้องแก้ `LINE_TYPES` + migrate ไลน์ที่เป็น hydroform 3 ไลน์)
  - `LTYPES` ในหน้า = `LINE_TYPES` (master กลาง) + **injection/painting/assembly ที่ทำเครื่องหมาย `extra:true`** — master ปัจจุบันเป็นของโรงงานโลหะล้วน · ชิปที่ extra มี `*` กำกับ + คำอธิบายว่าต้องไปเพิ่มใน `src/utils/lineTypes.js` ถ้าทำ multi-company จริง · บริษัทจำลองในกลุ่ม Plastech/Mocy กำหนดประเภทผ่าน `lineAlias: [{n, t}]`
- **ข้อมูล:** **TSAT4 = ข้อมูลจริง** จากฐานปัจจุบัน (กะที่ปิดแล้วของวันที่เลือก · aggregate ต่อ**ไลน์บนสุด** roll up ลูกเข้าแม่) · บริษัทอื่น = **ปั้นจากข้อมูลจริงชุดเดียวกัน** ด้วยตัวคูณต่อบริษัท (`qtyF`/`oeeD`/`dtF`/`ngF`/`keep`) + **seeded RNG** (`hash32`/`rnd`/`jit` keyed ด้วย บริษัท×ไลน์×วัน — ตัวเลข**นิ่ง ไม่ดิ้นทุกครั้งที่รีเฟรช** ซึ่งสำคัญกับความน่าเชื่อถือตอนเดโม) · กลุ่มธุรกิจที่ไม่ใช่ metal forming มี `lineAlias` เปลี่ยนชื่อไลน์ให้เข้ากับธุรกิจ (INJECTION/PAINT · MC FRAME/TANK) ไม่ให้ไลน์ปั๊มโลหะไปโผล่ใต้ Plastech
- **กดที่โรงงาน (หมุด/การ์ด/ชิป/แถวตาราง) → popup ถามก่อนว่าจะไปทางไหน:** 🗺️ เข้าหน้าผังโรงงาน (`/factory-map`) หรือ 📊 ดูภาพรวมรายไลน์ในหน้านี้ · บริษัทจำลองยังไม่มีผังเป็นของตัวเอง → ปุ่มผังถูกปิดพร้อมอธิบายว่าระบบจริงจะผูกผังกับ `company_id` (มีปุ่มรองให้ดูตัวอย่างผังของ TSAT4)
- **ไม่เขียน DB ใดๆ · ไม่มีตาราง company/plant** — ข้อมูลจำลองอยู่ใน memory ของหน้าเท่านั้น · migration มีแค่สิทธิ์เข้าหน้า `20260805_group_overview_permission.sql` (seed **admin/manager** เท่านั้น — จอผู้บริหาร + กันหน้างานเข้าใจผิดว่ามีหลายบริษัทจริง · role อื่นเปิดเพิ่มที่ `/permissions`)
- **ทุกหน้าจอต้องบอกชัดว่าอันไหนจริง/จำลอง** — แถบ 🧪 MOCKUP บนหัวเรื่อง + banner อธิบาย + ป้าย "จริง"(เขียว)/"จำลอง"(ส้ม ขอบประ) บนทุกการ์ด/ชิป/แถวตาราง **ห้ามถอดป้ายพวกนี้ออก**
- **ตัวเลขใช้สูตรกลางเดิมทั้งหมด** (ให้ตรงกับที่แต่ละหน้าเห็น): OEE เฉลี่ย = `wavg` จาก `src/utils/oee.js` ถ่วงด้วยเวลารับภาระ (`shift_min − plannedDT`) — **ถ่วงข้ามชั้นเสมอ** (กลุ่มธุรกิจ = wavg ของทุกไลน์ในกลุ่ม ไม่ใช่เฉลี่ยค่าเฉลี่ยบริษัท) · ยอดผลิตนับงานคู่ RH/LH เป็น 1 stroke ผ่าน `pairAwareTotal` · NG ยึด `defect_logs` (qty_ng + qty_suspect) · DT นับเฉพาะนอกแผน
- **วันที่:** default = วันงานล่าสุดที่จบ (ตรรกะเดียวกับ MorningMeeting) · **ถ้าวันที่เลือกไม่มีกะเลย ถอยหลังหาไม่เกิน 7 วัน** แล้วบอกบนจอว่าใช้วันไหนแทน (กันเดโมเปิดมาเจอจอว่าง)
- **ไม่ scope ตาม section/line โดยตั้งใจ** — เป็นจอภาพรวมผู้บริหาร (หลักเดียวกับข้อยกเว้น `/factory-map`) คุมด้วยสิทธิ์เข้าหน้าแทน
- **แผง "🛠️ ถ้าจะรองรับหลายบริษัทจริง ต้องทำอะไรบ้าง"** (พับได้ ท้ายหน้า) = คำตอบเชิงเทคนิคบนจอเดียวกับตัวอย่าง: **ขยาย `org_nodes.kind` ให้มี `business_group` + `company`** (โครง parent_id เดิมรองรับ ไม่ต้องสร้างตารางใหม่) + `company_id` ที่ `production_lines`/`profiles` — **ตารางรายวัน (session/order/downtime/defect) ไม่ต้องแก้** เพราะสืบบริษัทผ่านไลน์ได้ · ขยาย `effectiveSections()` เป็น บริษัท→ส่วนงาน + role ระดับกลุ่ม · master ที่ต้องแยกต่อบริษัท: ปฏิทิน/นโยบายพัก/เป้า OEE/ทะเบียนเอกสาร/ห้อง Telegram/ผังโรงงาน · 2 project เดิม (Main+DR) ใช้ต่อได้ ไม่ต้องแตก project ต่อบริษัท
- **ถ้าจะทำ multi-company จริง** ให้ยึดหน้านี้เป็น reference ของ "ชั้นรายงานรวม" แล้วเปลี่ยนแหล่งข้อมูลจากตัวจำลองเป็น query จริงต่อ `company_id` — โครง UI/สูตร/ตัว drill-down ใช้ต่อได้ทั้งหมด

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
- **↩️ ตีกลับให้ผู้แจ้ง (แจ้งผิดแผนก · 2026-07-22 · migration `20260722_mtn_return_reroute.sql` DR — ⚠️ ค้างไม่ได้ apply มา 2 สัปดาห์ เพิ่ง apply จริง 2026-08-06):** ทีมที่ได้รับใบผิดแผนกกด Reject ที่ step2 → `status='returned'` + `returned_at`/`returned_from_dept` + เหตุผลใน `reject_reason` (reuse ช่องเดิม) → **ใบเด้งกลับหาผู้แจ้ง ไม่ถูกทิ้ง** → ผู้แจ้งเลือกแผนกที่ถูกแล้วส่งใหม่ (`resubmit`) → กลับเป็น `pending` + **รีเซ็ต `report_at`** (นาฬิกา KPI เริ่มนับใหม่ให้แผนกที่ถูก — ไม่โทษทีมที่เพิ่งได้รับใบ) โดยเก็บ `first_report_at` (เวลาเปิดครั้งแรก) + `bounce_count` ไว้อ้างอิง · การ์ดใบโชว์ชิป "↩️ ใบนี้เคยถูกตีกลับ N ครั้ง" เสมอเมื่อ bounce_count > 0 · **ระหว่างที่ migration ยังไม่ apply ฟีเจอร์นี้พังเงียบ** — กด Reject/ส่งใหม่ได้ error 42703 (`update` ไม่ tolerant ตัดคอลัมน์ที่ไม่มี) · `mtn_orders.status` ไม่มี check constraint จึงรับค่า `returned` ได้ทันทีหลังเติมคอลัมน์
- **ประเมินความพึงพอใจบริการซ่อม (step 6 รับมอบ/ติดตาม — KPI หน่วยงานซ่อม · 2026-07-22):** หน่วยงานผู้แจ้งให้คะแนน **5 ด้าน × 3 ระดับ** (เฉยๆ=1/พอใจ=2/พอใจมาก=3): คุณภาพงานซ่อม · ความเร็วในการตอบสนอง · ความสามารถในการแก้ไขปัญหา · ความสุภาพ/PPE · ความพร้อมในการเข้าแก้ไขปัญหา · เก็บ `mtn_orders.satisfaction` jsonb (ด้านที่ไม่ประเมิน = ไม่มี key · **ไม่บังคับ ข้ามได้**) · const กลาง `SAT_DIMS`/`SAT_LEVELS` ใน MtnRepair · **แท็บ 📊 KPI** เพิ่มการ์ด "ความพึงพอใจเฉลี่ย %" + แถบรายด้าน (avg/3 · เขียว≥2.5/เหลือง≥2/แดง) นับเฉพาะใบที่ประเมิน · migration `20260722_mtn_satisfaction.sql` (DR additive)
- **⚠️ ฟิลเตอร์สถานะไม่ให้ซ้ำ:** dropdown สถานะ render จาก `STATUS_META` (มี `closed: '✅ ปิด MO'` อยู่แล้ว) + `open`/`all` เท่านั้น — **ห้ามเพิ่ม `<option value="closed">` ซ้ำ** (เคยมี "✅ ปิดแล้ว" ซ้ำกับ "✅ ปิด MO" — ลบแล้ว 2026-07-22)
- **เลข MO auto — แยกต่อทีม (2026-07-24 · คำสั่ง user):** RPC `mtn_assign_mo_no(order_id, prefix)` (SECURITY DEFINER, idempotent) ออกตอน step2 = **`<รหัสทีม>-<ประเภท>-<DDMMYY>-<เลขรันต่อเนื่องต่อทีม>`** เช่น `MTN-BM-250726-0678` · **รหัสทีม** = `mtn_teams.mo_code` (data-driven — maintenance→MTN/jig→JIG/die→DIE/production→PRD · แก้ได้) · **ประเภท** (prefix) = ประเภทงานซ่อม BM/IM/CM/PM/AM/RE · **DDMMYY** = วันออกเลข (เวลาไทย อ่านได้) · **เลขรัน = ต่อเนื่องต่อทีม ไม่รีเซ็ตรายวัน** (ตาราง `mtn_mo_seq` keyed by team_code) — ต่างจากเดิมที่ `mtn_mo_counter` นับรวมทุกทีมต่อวัน (ปนกัน แยกทีมไม่ได้) · migration `20260724_mtn_mo_per_team.sql` (DR · ต้อง apply หลัง `mtn_teams`) · signature เดิม client ไม่ต้องแก้ (RPC อ่าน `mtn_dept` จากใบเอง) · **ตั้งเลขเริ่มต้นต่อทีม (ต่อจากระบบเดิม) + แก้รหัสทีม ที่ ⚙️ ข้อมูลตั้งต้น → 🔢 เลขรัน MO** (ใส่ "เลขล่าสุด" ของแต่ละทีม เช่น 677 → ใบถัดไป 0678) · `mtn_mo_counter` เดิม vestigial · MO เก่ารูปแบบเดิมยังอยู่เป็นประวัติ
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

## คลังอะไหล่ (Spare Part Master) — FM-JIG-009 + Rank ตาม WI-JIG-010 (2026-08-05)

แท็บ **🔩 คลังอะไหล่** ใน `/mtn-repair` (`src/components/SparePartMaster.jsx`) — ย้าย spare part list จากไฟล์ Excel เข้าระบบ: ค้นหาอะไหล่/ตำแหน่งชั้นวางได้เร็ว · ยอดคงเหลือตรงกับการเบิกจริงในใบ MO · จัด Rank A/B/C อัตโนมัติ · ตารางอยู่ **DR project** (migration `20260805_spare_part_master.sql`)

- **แท็บนี้ทุก role ที่เข้าหน้าได้เห็น** (ช่างต้องค้นของ/ดูชั้นวางได้) — แก้ข้อมูล/หมวด = `mtn_repair:manage_master` · รับเข้า/เบิก/ปรับยอด = `mtn_repair:service` · **ไม่มี permission key ใหม่** (ใช้ของเดิม เลี่ยงกับดัก seed `enum_range` ที่ทำให้ role ใหม่ fail-closed)
- **ตัวแก้อะไหล่แบบย่อใน ⚙️ ข้อมูลหลัก (sub-tab `parts`) ถูกลบแล้ว** — เดิมมี 2 ที่แก้คนละกติกา (อันเก่าใช้ `prompt()` + read-modify-write)

> ### ⚠️ กฎเหล็ก — ยอดสต็อกอะไหล่เคลื่อนไหวผ่าน RPC `mtn_stock_move` เท่านั้น
> `mtn_stock_move(part_id, type, qty, note, by_name, ref_order)` — `type` = `in` (รับเข้า) / `issue` (เบิก) / `adjust` (ยอดนับจริง) · SECURITY DEFINER · **ล็อกแถวด้วย `FOR UPDATE` + กันสต็อกติดลบ + เขียน `mtn_stock_txns` ในทรานแซกชันเดียว** คืนยอดคงเหลือใหม่
> **ห้าม `update mtn_spare_parts.stock_qty` ตรงๆ จาก client อีก** — เดิมเป็น read-modify-write (อ่านยอด → ลบ → เขียนกลับ): 2 เครื่องบันทึกพร้อมกันยอดเพี้ยน และเบิกเกินสต็อกได้ · แก้แล้วทั้ง 3 จุด (ขั้นซ่อมในใบ MO + รับเข้า/ปรับยอดในคลัง)
> `adjust` ส่ง **ยอดที่นับได้จริง** (ไม่ใช่ส่วนต่าง) — ฟังก์ชันคำนวณ delta ให้เอง

- **Rank A/B/C คำนวณจากข้อมูลจริง ไม่กรอกเอง** — `src/utils/spareRank.js` (pure · **ห้าม hardcode เกณฑ์ Rank ซ้ำในหน้าอื่น**) ตามตารางที่ 1 ของ WI-JIG-010 (Rev.00 · Effective 07/04/2026): แกนตั้ง = ใช้เฉลี่ย/เดือน (>10 · ≤10 · <3) × แกนนอน = leadtime (<15 · <45 · >45 วัน) → **A** ต้องมีมากกว่า Safety Stock เสมอ · **B** มี Safety Stock · **C** ไม่มี Safety Stock · override ได้ (บังคับระบุเหตุผล — เก็บ `rank_override`/`rank_note` ชิปขึ้น ✎)
  - **⚠️ "ไม่มีข้อมูล" ≠ "ใช้ 0 ชิ้น" — ห้ามตีเป็น 0** (บั๊กที่เจอตอนเทส): `Number(null)` = **0 ไม่ใช่ NaN** → เช็ค "มีค่าไหม" ด้วย `Number(x)` เฉยๆ ไม่ได้ · ถ้าตีเป็น 0 อะไหล่ที่ยังไม่มีประวัติ + LT สั้น จะถูกจัดเป็น **C ทันที** → **ตอนย้ายข้อมูลจาก Excel เข้าครั้งแรกจะกลายเป็น C ยกคลัง กลบตัว Rank A ที่สำคัญจริง** · กติกา: ไม่มีเดือนไหนถูกบันทึกเลยในหน้าต่าง = ส่ง `null` ให้ตาราง = **"ยังไม่จัด Rank"** (แต่แกน leadtime ยังตัดสิน A ได้เองถ้า LT > 45 วัน) · เดือนที่บันทึกไว้ว่าใช้ 0 = 0 จริง จัด Rank ตามปกติ
  - หน้าต่างเฉลี่ย 6 เดือน (`RANK_RULE.windowMonths`) · หารด้วยจำนวนเดือนที่อะไหล่มีอยู่จริง (ของใหม่ไม่ถูกหารด้วย 6 จนค่าเฉลี่ยต่ำเกินจริง)
  - **ยอดใช้รายเดือนเก็บที่ `mtn_spare_usage_monthly`** (แทนคอลัมน์ PI/PO ในไฟล์ Excel) — `source='system'` สะสมอัตโนมัติจาก ledger ผ่าน trigger `trg_spare_usage_bucket` (นับเฉพาะ `in`/`issue`/`consume` · **`adjust` ไม่นับเป็นการใช้งาน** ไม่ให้การปรับยอดดัน Rank) · `source='manual'` = ยอดย้อนหลังที่คีย์จาก Excel ในฟอร์มแก้ไขอะไหล่ (แยก source กันทับกัน) → **จัด Rank ได้ทันทีไม่ต้องรอสะสม 6 เดือน**
  - trigger เป็น best-effort (`exception when others then return new`) — bucket ล้มเหลวห้ามทำให้การตัด/รับสต็อกพัง (pattern เดียวกับ `fn_audit`)
- **ตรวจ Safety Stock ตามนิยาม WI:** Rank A/B ที่ `min_qty = 0` ขึ้นแถบเตือนเหลือง (นิ่ง ไม่กระพริบ — ไม่ใช่ alarm) · **WI ไม่ได้ให้สูตรจำนวน Safety Stock ระบบจึงตรวจแค่ "มี/ไม่มี" ไม่คำนวณตัวเลขให้เอง**
- **หมวดอะไหล่ data-driven** (`mtn_spare_categories` — seed EE/PN/MC/LP/GN) เพิ่ม/แก้จากปุ่ม 🏷️ หมวด ไม่ต้องแก้โค้ด · **ทีมที่ดูแลคลัง** = `mtn_spare_parts.team` เก็บเป็น `mtn_teams.key` (เทียบด้วย `teamKeyOf()` เสมอ — mtn_dept ฝั่งใบซ่อมเป็น label คนละ encoding)
- **ตำแหน่งชั้นวาง (`shelf`) ใช้รหัสเดียวกันทั้งคลัง** — ช่อง input มี datalist ของรหัสที่เคยใช้ กันพิมพ์รหัสใหม่ทุกครั้ง · **รหัสนี้คือกุญแจที่แผนผังชั้นวาง (rack map) ใช้จับคู่** — ถ้ารหัสไม่นิ่ง แผนผังจะจับคู่ไม่ได้
- **พิมพ์รายการ** ผ่าน `withDocFoot(html, 'spare_part_list')` — doc_key `spare_part_list` = **FM-JIG-009 Rev.00** (migration `20260805_doc_form_spare_part_list.sql` ฝั่ง Main) แก้เลขฟอร์ม/Rev ที่ `/doc-forms` ได้
- รูปอะไหล่: bucket `mtn-images` path `spare/` ผ่าน `ImageCropModal` (480px) · เปลี่ยนรูป = ลบไฟล์เก่าหลัง DB สำเร็จ (best-effort)
- **📥 นำเข้า/อัพเดทจากไฟล์ Excel/CSV** (ปุ่มในแท็บ · สิทธิ์ `manage_master`) — ตัวแปลงอยู่ `src/utils/spareImport.js` (pure, มีเทส)
  - **อัพโหลดไฟล์เดิมซ้ำได้เรื่อยๆ = อัพเดททับ ไม่สร้างซ้ำ** (key เลือกได้: รหัสภายใน หรือ เลข MAT) · แถวที่คีย์ซ้ำกันเองในไฟล์ = ข้าม + บอกว่าซ้ำกับแถวไหน · **แถวไม่มีคีย์ = เตือนว่าอัพโหลดซ้ำจะได้ของซ้ำ**
  - **อัพเดทเฉพาะฟิลด์ที่มีค่าในไฟล์** — คอลัมน์ที่ไม่ได้ส่งมาไม่ล้างค่าเดิมทิ้ง (ไฟล์ย่อยที่มีแค่ 3 คอลัมน์ก็อัพเดทได้ไม่พัง)
  - หัวคอลัมน์รับทั้ง**ไทย/อังกฤษ**และพิมพ์ไม่เป๊ะ (`normHeader` ตัดช่องว่าง/จุด/ขีด/วงเล็บ) · **หาแถวหัวคอลัมน์เองใน 10 แถวแรก** (ไฟล์จริงมีโลโก้/หัวเรื่องอยู่บนตาราง) · คอลัมน์ที่ไม่รู้จักรายงานให้เห็น ไม่เงียบ
  - **คอลัมน์ชื่อ `YYYY-MM` = ยอดเบิกใช้ย้อนหลัง** (แทน PI/PO ในไฟล์เดิม) → เขียน `mtn_spare_usage_monthly` source `manual` → **Rank ใช้ได้ทันทีตั้งแต่วันแรก**
  - **⚠️ ยอดคงเหลือไม่เขียน `stock_qty` ตรงจากไฟล์** (กฎเหล็ก RPC) — ตัวแปลงแยกค่าไว้ที่ `stockQty` ต่างหาก · เป็น **opt-in checkbox** ตอนนำเข้า แล้วลงผ่าน `mtn_stock_move`: ของใหม่ = `in` (รับเข้า) · ของเดิม = `adjust` (ตรวจนับ) → ประวัติตรงกับยอดเสมอ
  - พรีวิวก่อนลงมือ: นับ เพิ่มใหม่/อัพเดท/ข้าม/ต้องดู + ตารางรายแถว · มีปุ่มดาวน์โหลดไฟล์ตัวอย่าง (หัวคอลัมน์ตาม FM-JIG-009)

### 🗺️ ผังคลัง (Rack Map) — digital twin ชั้นวาง มุมมองด้านหน้า (2026-08-05)

แท็บ **🗺️ ผังคลัง** ใน `/mtn-repair` (`src/components/RackMap.jsx`) — ถ่ายรูป**ด้านหน้า**ชั้นวางจริง → ตีช่องแต่ละชั้น → ผูกกับรหัสชั้นวางของอะไหล่ → **ค้นชื่อของแล้วช่องที่เก็บไฮไลต์บนผัง** (ตอบ "ของชิ้นนี้อยู่ตรงไหน" ซึ่งเป็นเป้าหมายข้อ 1 ของ WI-JIG-010) · ตาราง `mtn_rack_maps` + `mtn_rack_cells` (DR · migration `20260805_rack_map.sql`)

- **pattern เดียวกับ `factory_line_regions` / `pm_facility_points` / `transport_nodes`:** รูปจริง 1 รูป + **พิกัดเป็น % ของรูป (0-100)** · `<img>` `width:100%; height:auto` แล้ววาง overlay ตำแหน่ง % ทับ — ไม่ผูกกับขนาดจอ/ขนาดไฟล์ · **ต่างจาก FactoryMap ตรงที่ใช้ rect (x,y,w,h) ไม่ใช่ polygon** เพราะชั้นวางเป็นตาราง + มี **⊞ สร้างตารางอัตโนมัติ** (แถว × คอลัมน์ → ออกรหัส `A-01-1`…) ไม่ต้องลากทีละช่อง (ชั้นเดียวมีหลายสิบช่อง)
- **⚠️ กุญแจจับคู่ = `mtn_rack_cells.shelf_code` ↔ `mtn_spare_parts.shelf` (ข้อความ ไม่ใช่ FK)** เพราะ 1 ช่องมีอะไหล่ได้หลายตัว · เทียบแบบ **trim + uppercase** ทั้ง 2 ฝั่ง (คนพิมพ์รหัสไม่เป๊ะ — เทสแล้วว่า `' zz-01-1 '` จับคู่กับ `ZZ-01-1` ได้) · **รหัสชั้นวางต้องนิ่ง** ฟอร์มอะไหล่จึงมี datalist ของรหัสที่เคยใช้ — ถ้าปล่อยให้พิมพ์อิสระ ผังจะจับคู่ไม่เจอ
- **ห้ามปล่อยของหายเงียบ:** แผงขวามีบล็อก "⚠️ ยังหาบนผังไม่เจอ" นับ (ก) อะไหล่ที่ยังไม่กรอกชั้นวาง (ข) อะไหล่ที่มีรหัสชั้นวางแต่**ยังไม่ได้ตีช่องบนผังไหนเลย** (เทียบกับ `mtn_rack_cells` ทุกผัง ไม่ใช่แค่ผังที่เปิดอยู่)
- สีช่องตามสถานะสต็อกของของในช่อง (ว่าง=เทา · ปกติ=เขียว · มีของต่ำกว่าขั้นต่ำ=เหลือง · มีของหมด=แดง) — **นิ่งไม่กระพริบ** ตาม Andon (สถานะคลัง ไม่ใช่เครื่องหยุด) · ผลค้นหา = เหลือง + หรี่ช่องอื่น
- `unique (rack_id, shelf_code)` กันตีช่องรหัสซ้ำในผังเดียวกัน (UI แปลง error 23505 เป็นข้อความไทย)
- **สิทธิ์:** ดู = ทุก role ที่เข้าหน้าได้ · แก้ผัง/ตีช่อง/อัปรูป = `mtn_repair:manage_master` · **แก้ได้ในหน้านี้เลย ไม่ต้องไป `/layout-setup`** — ทีม MTN (role `mtn`) เข้า `/layout-setup` ไม่ได้ (admin/mgr/sv เท่านั้น) ถ้าไปกองไว้ที่นั่นคนที่เป็นเจ้าของคลังจริงจะแก้ไม่ได้ (precedent เดียวกับผัง facility ใน MtnMachineLayout ที่ใช้ `pm:setup` แทน `setupMode`)
- รูปชั้นวาง: bucket `mtn-images` path `rack/` · บีบ **2560px / q0.9 / ≤2.5MB** (สเปคเดียวกับรูปผัง — ต้องอ่านป้ายบนชั้นออก **ห้ามบีบแรงกว่านี้**) · เปลี่ยนรูป = ลบไฟล์เก่าหลัง DB สำเร็จ
- **แก้ช่องในโหมดแก้ผัง:** ลาก**พื้นที่ว่าง** = สร้างช่องใหม่ · ลาก**ตัวช่อง** = ย้าย · ลาก**มุมขวาล่าง** (มือจับสีเขียว) = ปรับขนาด · บันทึกลง DB ตอนปล่อยเมาส์ (ระหว่างลากใช้ state `live` พรีวิวให้ลื่น ไม่ยิง DB ทุกเฟรม) · clamp ไม่ให้ช่องหลุดขอบรูป
- **เฟสถัดไป (ยังไม่ทำ):** QR ต่อช่องให้สแกนแล้วเด้งเข้าอะไหล่ในช่องนั้น · เชื่อมกับใบเบิกในขั้นซ่อม MO (กดจากใบแล้วผังชี้ช่องให้เดินไปหยิบ) · ผังหลายชั้น/หลายห้องในจอเดียว

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

## PM Coordination — แผนประสานงาน PM ข้ามวัน (MTN แจ้ง Production · 2026-07-23)

หน้า `/pm-coordination` (`PmCoordination.jsx`, กลุ่มการตรวจสอบและซ่อมบำรุง) — ทำ **"ใบแจ้งแผน" แบบเมลที่ MTN ส่งประสานงาน** (เช่น "RE: แผนการ Cleaning Cutting Head เครื่อง Laser LS-10") สำหรับงาน PM/แก้เครื่องที่**กินหลายวัน + ต้องประสานหลายฝ่าย** (Production ถอดชุด → MTN ทำ → คืน+Calibration → Production support ปรับคุณภาพช่วงเวลาที่นัด) — ไม่ใช่ซ่อมจบในตัวแบบ MO

- **โครงสร้าง 1 แผน = หัวใบ (เครื่องจาก MachineDatabase + ไลน์ + Remark) + หลายขั้นงาน** แต่ละขั้น: วันที่ · ทีมรับผิดชอบ (production หรือ mtn_teams) · รายละเอียด · ช่วงเวลา (time_from/to optional) · flag **"⚠️ ต้อง Production Support"** (เน้นสีแดงในใบ/เมล) · ติ๊ก done รายขั้นได้
- **ช่องเครื่องจักร = พิมพ์/ค้นด้วยหมายเลขเครื่อง (input+datalist keyed `machine_no`) ไม่ใช่ชื่อรุ่น (คำสั่ง user 2026-07-31):** MTN/PD/PE อ้างอิงเลขเครื่องเวลาแจ้ง → พิมพ์ `RB-104`/`LS-10`/`CT-02` แล้ว resolve เป็นเครื่องในฐานข้อมูล (เติมชื่อรุ่น/ไลน์ให้) · datalist เรียงตาม machine_no · พิมพ์เลขที่ไม่มีในฐาน = เก็บเป็น free text ได้ (machine_id null)
- **ตาราง (DR):** `pm_coordination_plans` (title/machine_*/line_name/remark/status draft·notified·done·cancelled) + `pm_coordination_tasks` (plan_id cascade, task_date, team, description, time_from/to, is_support, done, sort_order) · migration `20260723_pm_coordination.sql`
- **แจ้ง Production:** ปุ่ม "📤 แจ้ง Production" → `send-notification` event **`pm_coordination`** (จัดรูปเหมือนเมล: หัวเรื่อง+เครื่อง+ลิสต์ขั้นงานราย日+Remark) → status เป็น `notified` · route category maintenance ปรับห้อง/ปิด/แก้ข้อความที่ `/notification-config`
- **พิมพ์ใบ** (window.open+print): โลโก้ TS + หัวเรื่อง + เครื่อง/ไลน์ + แผนงานเป็น bullet (ขั้น support สีแดง) + Remark + ช่องเซ็น ผู้จัดทำ(MTN)/รับทราบ(Production)
- **สิทธิ์:** ดู = ทุก role (Production ต้องเห็นแผนที่ถูกนัด) · `pm_coord:manage` (สร้าง/แก้/ลบ/แจ้ง/ติ๊ก done) = admin/manager/supervisor/mtn/engineer/leader · migration `20260723_pm_coordination_permission.sql` (Main — page + manage + notification_rule `pm_coordination`)
- **Scope:** leader = family ไลน์ตัวเอง · role อื่นตาม sections (กรองด้วย `line_name` ของแผน) — pattern มาตรฐาน
- **🔗 ผูกกับระบบแผน PM เดิม (`pm_plans`) — 2 ทาง (2026-07-23):** (1) ในหน้าสร้างแผนมี dropdown **"สร้างจากแผน PM เดิม"** — เลือกแผน PM ที่มีวันครบกำหนด → เติมเครื่อง/ไลน์/`pm_plan_id` + เพิ่มขั้นงานวันครบกำหนดให้อัตโนมัติ (resolve equipment ผ่าน `checklists.equipment_id` → **jigs (รวม shadow) หรือ machines** — PM model ใช้ jigs เป็นหลัก) (2) หน้า **PM Forecast (`/pm-forecast`)** มีปุ่ม **"🗓️ แผนประสานงาน"** ต่อแถว (เห็นเมื่อ `pm_coord:manage`) → ส่ง prefill ผ่าน `sessionStorage['pmcoord_prefill']` แล้ว navigate มา `/pm-coordination` เปิด modal ผูก plan+เครื่อง+วันคาด PM ให้เลย · การ์ดที่ผูกโชว์ชิป "🔗 ผูกแผน PM" · เก็บ `pm_coordination_plans.pm_plan_id`
- **🔔 ช่วง Production Support ที่กำลังจะถึง (2026-07-23):** แผงแดงบนหน้ารวมทุกขั้นงานที่ติ๊ก `is_support` ของแผนที่ยังไม่ done/cancelled (วันนี้เป็นต้นไป · scope ตามไลน์) เรียงตามวัน — เตือน Production ล่วงหน้าว่าถูกนัด support วันไหน/เวลาไหน
- **✅ sync "เสร็จ" กลับระบบแผน PM (2026-07-23):** ปิดแผนที่ผูก `pm_plan_id` เป็น "เสร็จ" → confirm แล้ว stamp `pm_plans.last_done_at = วันนี้` · แผนตามรอบเวลา (ไม่ใช่ usage) เลื่อน `next_due_date = วันทำ + interval_days` ให้อัตโนมัติ · usage → forecast คำนวณเองจาก last_done_at (การทำ PM checklist จริงยังบันทึกที่ PMCheckData แยกกัน — อันนี้แค่ sync วันรอบถัดไป)
- **ต้อง deploy edge `send-notification`** ให้รู้จัก event `pm_coordination` (ก่อน deploy: กด "แจ้ง" ได้ 400 เงียบ แต่ status ยังเป็น notified — ตัวใบ/พิมพ์ใช้ได้ปกติ)

## ตั้งค่าผัง/Floorplan — แยก display ออกจาก setup (2026-07-16)

**หลักการ:** หน้า display (ผังรวมโรงงาน/Dashboard) = **ดู + popup เท่านั้น** · การตั้งค่าผังทั้งหมดรวมที่ **`/layout-setup` "🗺️ ตั้งค่าผัง/Floorplan"** (หมวดตั้งค่าโปรแกรม) แยกแท็บตาม POV — เตรียมรับ Store/AMR ในอนาคต
- **`FactoryMap` รับ prop `setupMode`** (default false): `/factory-map` = display-only (canEdit=false, ไม่มีปุ่มแก้ผัง) · `/layout-setup` แท็บภาพรวมโรงงาน = `<FactoryMap setupMode />` (แก้ผัง/วาด polygon ได้)
- **`MtnMachineLayout` รับ prop `setupMode`** เช่นกัน (default false): `/mtn-layout` = view รวม (overview/production/facility) · `/layout-setup` แท็บ MTN = `<MtnMachineLayout setupMode />` (default view=facility)
  - **⚠️ แก้ผัง facility ใช้สิทธิ์ `pm:setup` ไม่ผูก `setupMode` (2026-07-22):** เดิม `canEdit = setupMode && can('pm','setup')` → ทีม MTN (role mtn) แก้ผัง facility ไม่ได้เลย เพราะ mtn เข้า `/layout-setup` ไม่ได้ (admin/mgr/sv เท่านั้น) เข้าได้แค่ `/mtn-layout` (display) · facility เป็น domain ของช่าง → เปลี่ยนเป็น `canEdit = can('pm','setup',role)` แก้ผัง facility (เพิ่ม/ลบโซน/อัปรูป/วางจุด) ได้บน `/mtn-layout` เลย (canEdit ในไฟล์นี้ใช้กับ facility ล้วน ไม่กระทบ production/overview)
- **ฐานเครื่องจักรรองรับ Facility (รวม Utility) (2026-07-22 · รวมหมวด 2026-07-24):** `machines.equipment_category` — เหลือ **2 ค่า `'production'` / `'facility'`** (เดิมมี `'utility'` แยก แต่ **ทีมช่างดูแลทีมเดียวกัน + แยกยาก → ยุบ utility เข้า facility** ตามคำสั่ง user · migration `20260724_merge_utility_into_facility.sql` update utility→facility ทั้ง machines+jigs) · MachineDatabase มีปุ่มหมวด **🏭 ไลน์ผลิต / 🔧 Facility / Utility** (2 ปุ่ม) · เลือก Facility → ช่อง "ระบบ/พื้นที่" เป็น datalist (suggest จาก `pm_facility_areas` + พิมพ์ใหม่ได้ เช่น ระบบน้ำ/ลม/High Pressure/Cooling Tower) **ไม่ต้องผูกไลน์ผลิต** · เก็บชื่อระบบใน `line_name` (group ในลิสต์) · โค้ดที่เหลือเช็ค `!= 'production'` (facility ครอบ utility เดิม) · migration `20260722_machines_equipment_category.sql` (เพิ่มคอลัมน์) ยังต้อง apply ก่อน
  - **⚠️ กับดัก: ยังไม่ apply `machines_equipment_category` = บันทึกหมวด Facility ไม่ติด (2026-07-31):** เดิม handleSave ตัดคอลัมน์ที่ไม่มีทิ้ง**เงียบ** แล้วขึ้น "บันทึกสำเร็จ" → เครื่อง facility (Cooling Tower/Air Compressor) ถูกเก็บเป็น `production` หมด → Facility filter = 0, ไปโผล่ใต้ไลน์ผลิต · แก้: **เตือนชัด**เมื่อหมวดถูกตัด + migration `20260731_recategorize_facility_machines.sql` ดึงเครื่อง utility/utlity line + ชนิด cooling tower/compressor/booster กลับเป็น facility (+ sync shadow jig) · **apply ตามลำดับ: `20260722_machines_equipment_category` → `20260724_merge_utility_into_facility` → `20260731_recategorize_facility_machines`**
  - **audit หน้าอื่น (2026-07-31 · consistent):** ทุกหน้าที่แยกหมวดจัดการ facility+utility รวมกันอยู่แล้ว — DailyPM (`=== 'facility' || 'utility'` ตัดออก · jigs-based, shadow jig default facility), MtnMachineLayout (`FACILITY_CATS=['facility','utility']`), PMSetup (`catScopeKey` map ทั้งคู่→facility) · หน้าผลิต (DailyReport/Management/MorningMeeting/LineSetup) โหลด machines กรองด้วย **production `line_name`** → เครื่อง facility (line_name=ชื่อระบบ) ไม่รั่วเข้าลิสต์ผลิต · **ปัญหาที่เจอเป็นเรื่อง data (หมวดผิด) ไม่ใช่ logic** — apply 3 migration แล้วถูกทุกหน้า
  - **แถบกรองในลิสต์ mach DB มีตัวกรอง "หมวด" (ทุกหมวด/ไลน์ผลิต/Facility) แล้ว (2026-07-31):** เดิม dropdown "ไลน์" ดึงจาก `production_lines` เท่านั้น → เครื่อง facility (line_name=ชื่อระบบ) **หาไม่เจอผ่าน dropdown เลย** (เจอเฉพาะเลื่อน/ค้นหา) · เพิ่ม `filterCat` + เมื่อเลือก Facility ช่อง "ไลน์" สลับเป็น **"ระบบ/พื้นที่"** ลิสต์ line_name ของเครื่องหมวดนั้น (`catLineNames`) · เปลี่ยนหมวด = ล้างไลน์ที่เลือก (§5.3 cascade) · **กลุ่มไลน์ในลิสต์ย่อ/ขยายได้ (§139)** — คลิกหัวกลุ่ม toggle (chevron ▼/▶) + ปุ่ม "ย่อ/กางทั้งหมด" · จำใน `localStorage['md_group_collapse']`
- **ลักษณะเครื่องจักร — automation level + operation mode (data-driven · 2026-07-24):** เครื่อง stand-alone ในไลน์ (เช่น SP spot/projection nut welding ใน SUB APRON) หลากหลาย — บางตัว gang auto บางตัว standalone manual · เพิ่ม **2 แกนแยกจาก machine_type** (กระบวนการ): `machines.automation_level` (manual/semi_auto/auto) + `machines.operation_mode` (standalone/gang/inline) + `gang_count` (ชิ้น/จังหวะ สำหรับ gang) — **data-driven** จาก master table `machine_automation_levels` + `machine_operation_modes` (DR · แก้/เพิ่มค่าเองได้ ไม่ล็อก) · source-of-truth `src/utils/machineTraits.js` (`loadMachineTraits`/`activeAutomationLevels`/`activeOperationModes` + `DEFAULT_*` fallback) · ฟอร์ม MachineDatabase มี 2 dropdown ใต้ประเภทเครื่อง (เฉพาะเครื่องผลิต) + gang_count เมื่อเลือก gang · **"parallel" ไม่อยู่ที่เครื่อง** — เป็นคุณสมบัติไลน์ (`production_lines.flow_mode=parallel_machine`) · migration `20260724_machine_traits.sql` (DR · +audit trigger) · 2 master table อยู่ใน `DR_AUDIT_TABLES` แล้ว · payoff: manpower (manual=ต้องมีคนคุม), capacity (gang=N/stroke), อ้างอิงเครื่อง SP
  - **Bridge: facility จากฐานเครื่องจักร → วางบนผัง PM (2026-07-22):** MtnMachineLayout แท็บ Facility ดึง `machines` (equipment_category facility/utility) ที่**ยังไม่มี shadow jig** (`jigs.machine_id`) มาอยู่ในลิสต์ "อุปกรณ์ที่ยังไม่วาง" (เส้นประ + ป้าย "ฐานเครื่องจักร") · คลิกวางบนผัง → `placeJig` สร้าง **shadow `jigs`** อัตโนมัติ (`module='mtn'`, `equipment_category`+`machine_id`+`machine_no`+`line_name` จาก machine) แล้ว insert `pm_facility_points` ผูก jig เงานั้น → **ลงทะเบียนที่ฐานเครื่องจักรที่เดียว ไม่ต้องคีย์ซ้ำ PM Setup** · PM checklist ผูกกับ jig เงาต่อได้ตามปกติ · จิ๊กเดิม (สร้างจาก PM Setup) ยังวางได้เหมือนเดิม · **ลิสต์ "ยังไม่วาง" ซ่อนอุปกรณ์ที่วางโซนอื่นไปแล้ว (2026-08-03 · คำสั่ง user):** เดิมเช็คจาก `facPoints` = จุดใน**โซนปัจจุบัน**เท่านั้น → ของที่วางโซนอื่นยังโผล่ให้วางซ้ำ (เจอจริง CT-01/AC-01 โผล่ในโซน Airbooster) · แก้เป็น `placedAnyZone` (query `pm_facility_points` ทุกโซนตอนโหลด)
  - **Supply route — utility จ่ายไลน์ไหน + ผลกระทบเวลาซ่อม/ตัดไฟ (2026-07-22 · คำสั่ง user):** ตาราง `facility_supply_links` (DR · machine_id→line_name, unique · migration `20260722_facility_supply_links.sql`) — ตั้งจาก MachineDatabase: แก้เครื่อง facility/utility (ที่ save แล้ว) จะมีแผง "🔗 Supply route" เลือกไลน์ผลิตที่ utility นี้จ่ายให้ (multi-select ชิปไลน์) · แถวในลิสต์โชว์ชิป "🔗 จ่าย N ไลน์" · **payoff:** `MtnRepair` DetailDrawer โชว์แบนเนอร์แดง "⚠️ อุปกรณ์นี้จ่ายให้ N ไลน์ — หยุดซ่อม/ตัดไฟจะกระทบ: …" เมื่อใบซ่อมเป็นเครื่อง facility/utility ที่มี supply link (map machine_no→lines ผ่าน machines) · **บนผังรวม (FactoryMap):** metric mode "🔗 Supply Route" — เลือกแล้วไลน์ที่ utility จ่ายให้ + utility นั้นกำลังมี MO เปิดค้าง = กระพริบแดง "⚠ ชื่อเครื่อง ซ่อมอยู่" เห็นผลกระทบทั้งโรงงานจอเดียว (2026-07-22)
- **แท็บ:** 🗺️ ภาพรวมโรงงาน (FactoryMap setupMode) · 🏭 ผลิต (ลิงก์ LineSetup — LineSetup ทำหลายอย่างเลยลิงก์ไม่ยกโค้ด) · 🔧 MTN (MtnMachineLayout setupMode ฝังในแท็บ) · 📦 Store/AMR (**วาดกราฟถนน/ทางเดินรถ — ดู "Transport Route Graph" ด้านล่าง**) · component `src/pages/LayoutSetup.jsx`

### Transport Route Graph — ถนน/ทางเดินรถในโรงงาน (Store/AMR · 2026-07-31)

ต่อยอด Transport เฟส 1: **วาด "กราฟถนน" ทับรูปผังใหญ่เดียวกับ `/factory-map`** (ใช้ `factory_map.image_url` ฝั่ง Main เป็นฉากหลัง ไม่อัปโหลดผังใหม่) แล้วคำนวณเส้นทางสั้นสุดของรอบส่ง/AMR
- **ตาราง (DR · migration `20260731_transport_route_graph.sql` · additive · allow_all RLS):** `transport_nodes` (kind junction/stop/dock/charge · x,y = % 0-100 เหมือน factory_line_regions · line_name optional · **ไม่ FK ข้ามไป Main** เก็บแค่ %coord) · `transport_edges` (a_node/b_node · `bidir` false = one-way · `weight` null = auto จากระยะ %coord) · `transport_round_stops` (ลำดับจุดจอดต่อ `kanban_delivery_rounds` · unique round_id+seq)
- **ตัววาด:** `src/components/TransportMapEditor.jsx` ฝังในแท็บ Store/AMR ของ `/layout-setup` — โหมด **✏️ วาดถนนต่อเนื่อง (pen)** [คลิกไล่ตามถนน วางจุด+ต่อเส้นอัตโนมัติ · Esc จบเส้น] / เพิ่มจุดเดี่ยว / เชื่อม 2 จุด / เลือก-ย้าย / ลบ · pattern เดียวกับ FactoryMap (img + SVG viewBox 0 0 100 100 preserveAspectRatio=none, `pctFromEvent`, marker เป็น HTML) · persist ต่อ action ฝั่ง DR (stamp `updated_by_name` เอง เหมือน Transport.jsx) · แก้ได้เมื่อ `can('transport','manage')`
  - **auto-junction (สำคัญ — กราฟถึงจะเดินได้จริง):** ถนน 2 เส้นตัดกันบนภาพเฉยๆ = ไม่เชื่อม (pathfind เดินผ่าน node เท่านั้น) → ตอนเพิ่มถนน `addEdge` ตรวจ `segIntersect` กับถนนเดิม เจอจุดตัด = **แทรก node (แยก) + ตัดถนนทั้งสองเป็นสี่แยกอัตโนมัติ** · คลิกวางจุด**ลงบนถนนเดิม** (draw) → `closestPointOnSeg` snap แล้ว `splitEdgeAt` = สามแยก · snap เข้าจุดเดิมในระยะ `SNAP_PCT` · **กับดัก stale**: node ที่เพิ่งสร้างในคลิกเดียวกันยังไม่เข้า render state → resolve พิกัดผ่าน `nodesRef`/`getNode` (ไม่ใช่ `nById`) ไม่งั้นเส้นต่อหลัง split เงียบหาย
- **คำนวณเส้นทาง:** util กลาง `src/utils/transportGraph.js` (pure — `buildAdj`/`shortestPath` = Dijkstra O(V²) พอสำหรับผังเล็ก/`routeThroughStops` ต่อ segment ระหว่างจุดจอด) · ระยะเป็น **"หน่วยผัง" (relative %)** ไม่ใช่เมตรจริงจนกว่าจะ calibrate scale
- **ผูก Transport:** แท็บ 🗺️ เส้นทางรอบส่ง ใน `/transport` — เลือกรอบ → จัดลำดับจุดจอด (stop/dock) → เห็น route polyline บนผัง + ระยะรวม/จำนวนช่วง + เตือน "ถนนขาด" ถ้าจุดจอดคู่ใดหากันไม่ถึง
- **มาตราส่วน + ความเร็ว + จำลอง (2026-07-31):** ปุ่ม 📏 มาตราส่วน ใน editor = คลิก 2 จุดที่รู้ระยะจริง กรอกเมตร → เก็บ `transport_settings.meters_per_unit` (แถวเดียว) แปลงหน่วยผัง→เมตร · ความเร็วต่อยานพาหนะ `transport_vehicles.speed_kmh` (แก้ใน route tab) · route tab คำนวณ **ระยะจริง(ม.) + เวลา(นาที)** = ระยะ/ความเร็ว + `dwell_min`×จำนวนจุด · **▶ จำลองการวิ่ง** = จุด 🚚 วิ่งตาม polyline ด้วย requestAnimationFrame (250ms/นาทีจำลอง) + นาฬิกา · migration `20260731_transport_scale_speed.sql` (DR additive)
- **เฟสถัดไป (ยังไม่ทำ):** empty_return · เชื่อม AMR fleet จริง (kind='charge' + สถานะหุ่น — เฟส 3) · scale ปัจจุบันเป็นเส้นตรง 2 จุด (พอสำหรับผังแบน)
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
- helper: ใบ Multi-Skill (`buildMultiSkillHtml`) ยังอยู่ใน `src/pages/Report.jsx` · **ใบรายบุคคลย้ายไป `src/lib/individualSkillPrint.js`** แล้ว (2026-08-06 — `/operator` เรียกใบเดียวกัน) · หัวข้อย่อยจัดการที่ `/operator` ⚙️ ปุ่ม 📝 (`SkillSubItemsModal`)

> ### ⚠️ การ์ดสรุปทักษะรายบุคคล = component กลาง `src/components/SkillRadarPanel.jsx` (2026-08-06)
> เดิมการ์ด radar อยู่ใน Report.jsx (ชื่อ `OperatorRadarPanel`) กดดูได้เฉพาะแท็บ 📊 Skill Matrix → หน้า **ฐานข้อมูลพนักงาน (`/operator`) กดดูไม่ได้** ทั้งที่มีคอลัมน์คะแนนสกิลอยู่แล้ว (คำสั่ง user: "หน้าฐานข้อมูล กดดูแบบหน้า skill matrix ไม่ได้หรอ")
> - **ทางเข้า:** `/skills-report` แท็บ Skill Matrix · `/operator` แท็บฐานข้อมูลพนักงาน — **คลิกทั้งแถว**เหมือนกันทั้งคู่ (คอลัมน์จัดการของ `/operator` ใส่ `stopPropagation` ไว้ ปุ่ม ✏️/🚫 จึงทำงานเหมือนเดิม — **ตารางที่มีปุ่ม action ในแถวแล้วจะเพิ่ม row click ต้องกันแบบนี้เสมอ**)
> - **props:** `emp` (ต้อง select `employee_skills(skill_name, score)` มาด้วย) · `skillDefs` · `subItemsByskill` (จาก `skill_sub_items` — ใช้ตอนพิมพ์ ไม่ส่ง = 1 แถว/สกิล) · `lines` · `onClose`
> - **จุดใหม่ที่อยากโชว์สกิลรายคนให้ reuse ตัวนี้ ห้ามก๊อป modal ใหม่** · `/operator` โหลดแบบ `lazy()` (recharts มาเฉพาะตอนเปิดการ์ด ไม่ถ่วงตอนเปิดหน้า)
> - **⚠️ กับดัก: component พิมพ์เอกสารที่ถูก reuse ต้องเรียก `await loadDocForms()` เองในฟังก์ชันพิมพ์** — `docFormSync()` อ่าน cache ระดับ module ที่ว่างจนกว่าจะมีใครเรียก `loadDocForms()` · หน้าเดิม (Report.jsx) เรียกไว้ระดับ module แต่หน้าใหม่ที่ reuse เป็น lazy chunk คนละก้อน **ไม่ได้เรียก = ใบพิมพ์ได้ fallback ในโค้ดเสมอ เลขฟอร์ม/Rev/ช่องลายเซ็นไม่ตรงกับที่ตั้งใน `/doc-forms` แบบเงียบๆ** (เจอจาก QC audit 2026-08-06) · **พึ่ง `loadDocForms()` ของหน้าแม่ไม่ได้ — ฟังก์ชันพิมพ์ที่อยู่ใน component ร่วมต้องโหลดเองก่อนอ่านค่า** (เรียกซ้ำคืน cache ทันที ไม่เปลือง)
> - **สเกลสกิล/หมวด/gauge = `src/utils/skillLevels.js` จุดเดียว** (`SKILL_LEVELS`/`getLevel`/`getBandCeiling`/`SKILL_GATES`/`SKILL_CAT_META`/`groupSkillsByCategory`/`MS_LEVELS`/`scoreToLevel`/`skillGaugeSvgStr`) — เดิมนิยามซ้ำใน Report.jsx กับ operator.jsx แล้ว drift (operator มี `desc`/`band` + หมวด `allowance_skill` ที่ Report ไม่มี) · **ห้ามนิยาม SKILL_LEVELS/หมวดสกิล ซ้ำในหน้าใดๆ อีก**
> - **`groupSkillsByCategory(defs)` default = 4 หมวดทักษะ ไม่รวม `allowance_skill`** (ใบเซอร์ค่าฝีมือเป็น มี/ไม่มี ไม่ใช่ระดับทักษะ → ไม่เข้า matrix/radar โดยตั้งใจ) · ต้องการรวมให้ส่ง `SKILL_CAT_META_FULL` เป็น arg ที่สอง (หน้าตั้งค่าสกิล/โมดัลแก้ไขพนักงานใน `/operator` ใช้แบบนี้)

---

## PE Core Tools — Process Flow / PFMEA / Control Plan (2026-08-13)

หน้า `/pe-docs` (`PEDocs.jsx`, หมวดใหม่ **วิศวกรรม (PE)** ใน NAV_GROUP_ORDER) — โมดูลทีม Process Engineering ถอดโครงจากเอกสารจริง TSAT (PFC-P703-01 Rev.12 / FMEA-P703-01 Rev.33 (AIAG 4th ed) / CNP-P703-01 Rev.22 ที่ user อัปโหลดให้ศึกษา)

- **หลักออกแบบ: กระดูกสันหลัง = "เลข Process (OP 10..280)" ใช้ร่วมทั้ง 3 เอกสาร** → เก็บข้อมูลชุดเดียว แสดง 3 มุมมอง (แท็บ Flow / PFMEA / Control Plan / Revisions ผ่าน `useTabParam` + `?set=` เลือกชุดเอกสาร) — **ห้ามแตกเป็น 3 โมดูลแยกที่ถือ process list ของตัวเอง** (จะ drift ทันที)
- **ตาราง (Main project — เหตุผล: เอกสารควบคุมมี workflow อนุมัติควรอยู่ฝั่ง authenticated (DR = anon-open) + Main DB ใช้ 30MB < DR 46MB + เก็บที่ DR ไว้ให้ข้อมูลผลิต/SCADA):** `pe_doc_sets` (1 พาร์ท = 1 ชุด PFC+FMEA+CP · part_no/mat_no/line_name = จุดโยงข้อมูลผลิต) · `pe_processes` (unique (set_id, op_no) · `machine_no` โยง machines ฝั่ง DR เป็น text · kind: process/incoming_insp/storage/transport/inspection/rework/warehouse/delivery) · `pe_fmea_items` (คอลัมน์ AIAG ครบ + action + S/O/D ใหม่ · **RPN ไม่เก็บใน DB คำนวณ S×O×D ในแอปเสมอ** ≥100 แดง ≥70 เหลือง) · `pe_cp_items` (จุดควบคุมราย Char No.) · `pe_doc_revisions` (**`ref_kind`/`ref_id` ผูกต้นเหตุ claim/ncr/defect/downtime/mtn** — ถอดจากพฤติกรรมจริงใน cover: เกือบทุก revision เกิดจากเคลมลูกค้า) · ทุกตารางมี audit+updated_at trigger · RLS authenticated (สิทธิ์คุมที่ UI ผ่าน `can()`) · migrations `20260813_pe_core_documents_main.sql` + `20260813_pe_images_main.sql` (**apply แล้ว 2026-08-13**)
- **รูป:** bucket **`pe-images`** (Main · 5MB cap) — `pe_doc_sets.image_url` (รูป product/drawing) + `pe_processes.image_url` (รูปประกอบ OP) · บีบ 2560px/q0.9 (tier drawing — ต้องซูมอ่านได้) · GIF ดิบ ≤2MB · เปลี่ยน/ลบ = ลบไฟล์เก่าหลัง DB สำเร็จ (best-effort) · lightbox คลิกดูเต็มจอ
- **สิทธิ์:** ดู = ทุก role (`page:/pe-docs`) — ฝ่ายผลิต/QA ต้องเช็คย้อนได้ · แก้ = `pe:edit` · ออก revision = `pe:approve` (seed: admin/manager/engineer + dept_admin bucket) — engineer = เจ้าของโมดูล (ตาม convention engineer = process engineering)
- **Seed พาร์ทแรก P703 (MB3B-16E060-CH = งาน Line 60):** migration `20260813_pe_seed_p703_main.sql` (idempotent) — 28 OP ครบตาม PFC (เครื่อง SP-74/78/80/81/82/85/10 + RB-122/126/127 ตรวจจาก CNP รายชีทแล้ว) + FMEA/CP ของ OP130 เป็นตัวอย่าง + ประวัติ revision 44 รายการจาก cover จริง (rev_no = null — cover ไม่ระบุเลขรายแถว จึงเรียงด้วย rev_date)
- **เฟสถัดไป (ยังไม่ทำ):** (1) ปุ่ม "🔍 ชน FMEA" จากแถวของเสีย/Downtime/NCR/ใบ MO — จับคู่ เครื่อง+ไลน์+ประเภทปัญหา → โชว์ failure mode + controls ที่เกี่ยว + เช็คว่า control ถูกทำจริงไหม (poka-yoke check/PM/ใบตรวจ) → ไม่เจอคู่ = เพิ่มเข้า FMEA + ออก rev (2) ตัว import จากไฟล์ Excel format TSAT (โครง parse ได้แล้ว — ดู session 2026-08-13) (3) เทียบ RPN ที่ประเมิน vs ความถี่เกิดจริงจาก defect_logs (4) พิมพ์ฟอร์ม FM-PE1-018/019 ผ่านทะเบียน doc_forms

---

## Traceability / Audit Log — ใครแก้อะไรเมื่อไหร่ (2026-07-24)

> ### ⚠️ กฎเหล็ก — ตาราง master/config ที่ "แก้ไขได้" ต้องมี audit
> เดิมตาราง master ~90% track แค่ `created_at` → แก้ไขแล้วสืบไม่ได้ว่าใคร/เมื่อไหร่/ค่าเก่าอะไร (เจอจริง: `dr_products.line_name` ถูกเปลี่ยนไลน์ สืบไม่ได้) · **ตาราง master/editable ใหม่ทุกตัวต้องผูก audit** (เพิ่มชื่อตารางใน `tbls[]` ของ migration `20260724_audit_log_*.sql`)

- **ตาราง `audit_log` กลาง (ต่อ project)** — เก็บ `table_name, row_pk, action (INSERT/UPDATE/DELETE), actor, changed_fields[], old_data jsonb, new_data jsonb, changed_at` · เขียนโดย generic trigger `fn_audit()` (SECURITY DEFINER) ที่ผูกกับตาราง master · migration `20260724_audit_log_main.sql` + `20260724_audit_log_dr.sql`
- **`fn_audit()` best-effort เสมอ** — ห่อ insert ด้วย `exception when others then null` → **audit ล้มเหลวห้ามทำ write หลักพัง** (สำคัญมากกับระบบ production) · UPDATE ที่ไม่มีอะไรเปลี่ยนจริง (นอกจาก updated_at) ไม่ log
- **actor (ใครแก้):** Main (authenticated) = `auth.uid()` → ชื่อจาก `profiles` · **DR เป็น anon เสมอ → `auth.uid()` = null** → actor มาจากคอลัมน์ `updated_by_name` บนแถว
  - **✅ DR actor ทำแล้ว (centralized) — 2026-07-24:** `supabaseClient.js` **wrap `supabaseDR.from`** ให้ฝัง `updated_by_name = ชื่อ user ปัจจุบัน` อัตโนมัติทุก `update/upsert/insert` ของตาราง master ใน `DR_AUDIT_TABLES` (ครอบทุกหน้าในทีเดียว ไม่ต้องไล่แก้ handler รายจุด) · `setDrActorName(fullName)` เรียกจาก `App.jsx fetchProfile` (ล้างตอน signout) · fn_audit อ่าน `updated_by_name` → actor · **⚠️ ตารางใน `DR_AUDIT_TABLES` ต้องมีคอลัมน์ `updated_by_name` (migration `20260724_dr_updated_by_name.sql`) ไม่งั้น write พัง** — เพิ่มตาราง DR ใหม่เข้า audit ต้องเพิ่มทั้งในลิสต์ migration + `DR_AUDIT_TABLES` ให้ตรงกัน
  - **DELETE ฝั่ง DR** actor = `updated_by_name` ของแถวเดิม (คนแก้ล่าสุด ไม่ใช่คนลบ) — gap เล็กๆ ยอมรับได้ (จะได้คนลบจริงต้องผ่าน `current_setting('app.actor')` ซึ่ง REST ตั้งไม่ได้ง่าย)
- **`updated_at` + trigger `fn_set_updated_at()`** เพิ่มให้ตาราง master ที่ผูก audit (BEFORE UPDATE set now())
- **ดูประวัติ:** หน้า `/product-history` (ProductHistory) โชว์ audit ของ `dr_products` แถวนั้น (line_name/CT/PN เปลี่ยนโดยใคร) · จุดอื่นที่อยากโชว์ audit ให้ query `audit_log` ด้วย `table_name`+`row_pk`
- **ยังไม่ apply = ไม่พัง** — โค้ดที่อ่าน audit_log ห่อ try/catch (เช่น ProductHistory) · การเขียนตาราง master ทำงานปกติ แค่ยังไม่ถูก log จนกว่าจะ apply migration

## ประวัติผลิต by Product — `/product-history` (2026-07-24)

หน้า ProductHistory (กลุ่มวิเคราะห์ & รายงาน) — เลือกสินค้า (ค้นด้วย mat_no/ชื่อ/PN) → ดูย้อนหลังว่าเคยผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ + ประวัติการแก้ master data
- **แหล่งข้อมูล (DR):** `prod_orders` embed `production_sessions!inner(line_name, work_date, shift, oee, status)` กรองช่วงวัน · `defect_logs` (NG ต่อใบ) · `audit_log` (การแก้ dr_products)
- **แสดง:** สรุป (ผลิต/เป้า/NG/กี่ไลน์) · แยกตามไลน์ · trend รายวัน · ตารางใบผลิต (วัน/ไลน์/กะ/เครื่อง/เป้า/ผลิต/NG/สถานะ) · ประวัติแก้ไข (ใครเปลี่ยน line_name/CT เมื่อไหร่)
- **Scope:** leader = family ไลน์ตัวเอง · role อื่น = ตาม sections (กรอง `production_sessions.line_name`) · **ตัวเลือกสินค้าก็ scope ด้วย** (กฎ dropdown-scope — สินค้าไลน์นอก scope ไม่โชว์ให้เลือก · สินค้า line_name ว่างยังโชว์) · สิทธิ์เข้าหน้า `page:/product-history` (ทุก role · migration `20260724_product_history_permission.sql`)
- **ตัวเลือกสินค้า = ลิสต์จัดกลุ่มตามไลน์** (ฟิลเตอร์ไลน์ + ค้นหา + กลุ่ม sticky header เลื่อนในกรอบ · จำกัดแสดง 300 · เลือกสินค้าแล้วพับลิสต์อัตโนมัติ) — เปลี่ยนจาก chip กองรวมที่อ่านยาก (2026-07-30)
- **ทุก section ย่อ/ขยายได้ตาม convention** (`CollapseCard` — จำสถานะ `ph_collapse_*` ใน localStorage · audit ว่าง default พับ) (2026-07-30)
- **ตารางใบผลิต = drill-down 3 ชั้น: วัน → ไลน์·กะ → รายใบ** (`dayGroups` — รายวันคือระดับหลัก คลิกแตกชั้นถัดไป · แสดง 45 วันแรก + ปุ่มแสดงอีก) · การ์ดสินค้าที่เลือกมีปุ่ม "✕ ปิด — เลือกสินค้าอื่น" กลับไปลิสต์ · กราฟรายวัน: แกนวัน**ต่อเนื่องไม่ข้ามวัน** (วันไม่ผลิต = ตอเทา) · แท่งซ้อนเขียว=ผลิตดี/แดง=NG · ตัวเลขบนแท่งเมื่อ ≤20 วัน + legend (2026-07-30)
- **ผลิตได้** = confirmed→`qty_ok??qty` · เปิด→`qty_actual` (สอดคล้องกับการนับใน DailyReport)

## สอบกลับ Order — `/order-trace` (Order Traceability · 2026-07-30)

หน้า OrderTrace (กลุ่มวิเคราะห์ & รายงาน) — สแกน/ค้น `prod_no` (บาร์โค้ด kanban) → เห็นทุกเหตุการณ์ของใบนั้น + สถานการณ์รอบข้าง ณ เวลาผลิต · deep-link `?prod=<PROD_NO>` · สิทธิ์ `page:/order-trace` ทุก role (migration `20260730_order_trace_permission.sql`) · scope ตาม pattern มาตรฐาน (leader = family · อื่น = sections — ทั้งผลค้นหาและข้อมูล)

> ### ⚠️ กฎเหล็ก — เวลาเปิด/ปิดใบ = "เวลาสแกน" ไม่ใช่เวลาผลิตจริงของใบนั้น (2026-08-05 · user ชี้ + ตรวจข้อมูลจริงแล้ว)
> **พนักงานสแกนเปิด/ปิดใบเป็นชุด ไม่ใช่ใบต่อใบ** — ข้อมูลจริง Assy LWR 05/08 กะเช้า: เปิด **6 ใบภายใน 10 วินาที** (10:43:21→10:43:31) · ปิด 3 ใบภายใน 51 วินาที (13:37:50→13:38:41)
> → **ห้ามเอา `confirmed_at − opened_at` ของใบเดียวไปหาร qty ใบนั้นเพื่อหา วิ/ชิ้น หรือ %ความเร็ว** (เคสจริงได้ ~250-300 วิ/ชิ้น เทียบ CT 58 = ~20% ทั้งที่ไลน์เดินปกติ)
> **⚠️ เกณฑ์ "สแกนรวบ" ต้องคำนวณจากข้อมูล ห้าม hardcode เวลาตายตัว (2026-08-05 · คำสั่ง user "อยากให้โปรแกรมฉลาดพอที่จะคำนวณจาก order ที่สแกน"):** ใช้ `scanBatch` — **ช่องว่างระหว่างสแกน < `BATCH_FRAC` (0.5) × เวลาที่ต้องใช้ผลิตของใบนั้น (qty × CT)** = ต้องผลิตเร็วกว่ามาตรฐาน 2 เท่าถึงจะทัน → เป็นไปไม่ได้ = สแกนรวบ · เกณฑ์**สเกลตามชิ้นงาน/จำนวนของแต่ละใบเอง** · ไม่ได้ตั้ง CT → ใช้อัตราจริงเฉลี่ยของกะ (ช่วงเวลา ÷ ยอดรวม) · ไม่มีทั้งคู่ค่อยถอยไป `FALLBACK_BATCH_SEC` (180 วิ) · **จับเป็นลูกโซ่** → เคส "สแกน 3 ใบ → เข้าห้องน้ำ 5 นาที → สแกนต่อ 2 ใบ" ยังเป็นชุดเดียว (5 นาที < ครึ่งหนึ่งของ 34 นาที)
> **⚠️ ห้ามใช้ `gap < need` (frac 1.0)** — ตรวจกับข้อมูลจริงแล้ว **เหมารวมการทยอยสแกนจริงผิด**: Assy LWR 05/08 ทยอยเปิดทุก 33 นาที ขณะ need = 34 นาที → 1980 < 2030 ถูกมองเป็นชุดทั้งที่ไม่ใช่ · frac 0.5 (=1015 วิ) แยกถูก: ทยอย 33 นาที = ไม่ใช่ชุด ✓ · 6 ใบห่างกัน 1-3 วินาที = ชุด ✓
> **⚠️ แต่ละ product จำนวนกับ CT ไม่เท่ากัน — ต้องเทียบกับ "ใบที่กำลังผลิตอยู่" ให้ถูกตัว (2026-08-05 · user เตือน):** ขาเปิด เทียบเวลาผลิตของ **ใบก่อนหน้า** (ใบที่ทำอยู่ กว่าจะเสร็จค่อยเปิดใบใหม่) · ขาปิด เทียบของ **ใบนี้** (ใบที่เพิ่งเสร็จ) — เทียบผิดตัวจะพังเมื่อของคนละขนาด เช่นเปิดใบ 35 ชิ้น (34 นาที) แล้ว 10 นาทีต่อมาเปิดใบ 8 ชิ้น: ถ้าเทียบกับใบ 8 ชิ้น (เกณฑ์ 4 นาที) จะหลุดว่า "ไม่ใช่ชุด" ทั้งที่ใบแรกยังทำไม่เสร็จ · **จำนวนที่ใช้ประเมิน: ใบปิดแล้ว = ยอดผลิตจริง · ใบที่ยังเปิด = เป้าของใบ** (ห้ามใช้ `qty_ok ?? qty_actual ?? qty` ตรงๆ — ใบเปิดที่ `qty_actual = 0` จะได้ need = 0 แล้วตัดกลุ่มผิด · เจอจริงที่ SUB APRON 05/08) · จำนวน ≤ 0 = ประเมินไม่ได้ → ใช้ใบข้างเคียงแทน · ข้อความหลักฐานบนจอต้องรายงานเกณฑ์ของ**คู่ที่ห่างสุดจริง** ไม่ใช่ของใบที่เลือก (ไม่งั้นเลขขัดกันเองเมื่อของคนละขนาด)
> **ตรวจข้ามไลน์แล้ว (ของคนละขนาด 81-600 ชิ้น · CT 27-58 วิ):** HDF2 03/08 → MANUAL 500 ชิ้นแยกเดี่ยว ✓ · 16 ใบเปิด 06:23-06:29 = ชุดเดียว ✓ · SUB APRON 05/08 → ใบเปิดค้าง qty_actual=0 ยังจับชุดได้ ✓ · ห่าง 3 ชม. ตัดเป็นคนละชุด ✓
> **วิธีที่ถูก (`orderAnalysis` ใน OrderTrace):** ตรวจ "สแกนรวบ" ด้วยเกณฑ์ข้างบน และจับ **กลุ่มใบที่วิ่งต่อเนื่องเชื่อมกันแบบ transitive** (ขยายช่วงจนไม่มีใบใหม่เข้า — **ห้ามเอาแค่ใบที่ทับกับใบนี้ตรงๆ** เพราะช่วงเวลาถูกดึงกว้างตามใบที่ลากเข้ามา แต่ qty ไม่รวมใบที่ทับกับใบนั้นอีกที = ตัวหารโตกว่าตัวตั้ง อัตราต่ำเกินจริง) แล้วคิด **ระดับกลุ่ม**: `Σ qty ÷ (ช่วงรวม − DT ในช่วง)` · **%เทียบมาตรฐาน = Σ(qty×CT ของชิ้นงานนั้น) ÷ เวลาเดินสุทธิ** (สูตรเดียวกับ %P ของ OEE → กลุ่มมีหลายชิ้นงานก็เทียบได้ · CT ทุก MAT ในกะโหลดเป็น `trace.ctByMat`)
> **ตรวจกับข้อมูลจริงแล้ว:** กลุ่ม 7 ใบ 218 ชิ้น · 339 นาที − DT 40 = 299 นาที → 82.2 วิ/ชิ้น · 44 ชิ้น/ชม. · **70%** (สมเหตุผล เทียบกับ ~20% ของสูตรเดิม)
> **UI ต้องไม่โชว์ตัวเลขรายใบเป็นคำตอบเมื่อเจอชุด** — ขึ้นแถบเตือน "สแกนเป็นชุด N ใบ" + โชว์บล็อกระดับกลุ่มเป็นค่าหลัก ส่วนรายใบหรี่ลงและเขียนว่า "ใช้ตัดสินความเร็วไม่ได้" · ไม่มีใบอื่นทับเลย = รายใบใช้ได้ (บอกด้วย ✅) · timeline เขียนว่า "สแกนเปิด/ปิดใบ" + ชิป "🧾 สแกนพร้อมกัน N ใบ"
> **จุดอื่นที่คิดเวลา/ความเร็วรายใบต้องระวังกฎนี้ด้วย** (ยังไม่ได้แก้: ที่อื่นในระบบยังไม่มีที่คำนวณ วิ/ชิ้น รายใบ)

- **สอบกลับ = ทวนสอบย้อนหลัง "ของที่ออกจากไลน์ไปแล้ว" → default ตัดใบที่ยังผลิตอยู่ (`status='open'`) ออกจากผลค้นหา (2026-08-05 · คำสั่ง user)** · ติ๊ก "รวมใบที่กำลังผลิต" เพื่อดูได้ · **สแกน prod_no ของใบที่ยังไม่ปิดแล้วไม่เจอ = fallback ค้นแบบรวมใบเปิดให้อัตโนมัติ + toast บอก** (สแกนแล้วต้องไม่เงียบ)
- **ผลค้นหา = แผงสรุป + ตารางข้อมูลแน่น (2026-08-05 · คำสั่ง user "พอ search ควรโชว์ข้อมูลเยอะๆ ก่อนกดเลือก · พื้นที่ล่างอย่าทิ้งว่าง"):** เหนือตารางมี **แถบสรุปของผลค้นหา** (จำนวนใบ/กำลังผลิต · เป้ารวม · ผลิตรวม+% · NG รวม+% · ไลน์ · ชิ้นงาน · ช่วงวัน) · ตารางเพิ่มเป็น 12 คอลัมน์ (MAT+ชื่อ+ลูกค้า · ไลน์+เครื่อง · เวลาเปิด→ปิด · เป้า/ผลิต/% · NG · OEE กะ · ผู้เปิด-ปิด · ชิป ⏪ย้อนหลัง ↩️ถอยใบ 🔗คู่ ⏬ยกยอด) · **ตารางสูงเต็มพื้นที่จอ** (`calc(100vh - 330px)` แทน `maxHeight:420` ที่ทิ้งพื้นที่ล่างว่าง) + sticky header · **แจ้งเตือนเมื่อชนเพดาน 300 ใบ** (ไม่ตัดเงียบ) · ⚠️ ยอดรวมในแถบสรุป = **ผลรวมของใบที่แสดง (list sum) บวกตรงๆ ต่อใบ** ไม่ใช่ยอดผลิตภาพใหญ่ → **ไม่ใช้ `pairAwareTotal`** (helper นั้นสำหรับจอสรุปยอดรวมภาพใหญ่)
- **แสดง:** การ์ดใบ (เป้า/จริง/OK/NG/สงสัย/ซ่อม, ใครเปิด-ปิด, backfill/ถอยใบ/ใบคู่, OEE กะ) · **Timeline เหตุการณ์เรียงเวลา** (เปิดใบ→ยอดสะสมรายช่วง→NG→Downtime (ไฮไลต์ช่วงทับใบ)→4M→ปิดใบ→เข้าคลัง→ตัดส่ง) · **👷 กำลังคน & จุดงาน mining (2026-08-03):** ตารางรายคน จุดที่เข้าวันนั้น (`assigned_line`→workstations รวมจุดข้ามไลน์) + จุดประจำ (`employee_home_positions`) + badge 🔀 ย้ายจุด + **skill fit ต่อจุด** (สูตรเดียว computeFit — คะแนน "ปัจจุบัน" ระบบไม่เก็บ history) + PPE รายชิ้น + 4M Man ที่พาดพิงชื่อ + 🎓 อบรม OJT วันนั้น + สรุปเทียบ std headcount กะ · **⏱️ วิเคราะห์การวิ่งของใบ:** เปิด→ปิด − DT ทับช่วงใบ (แยกนอกแผน/ตามแผน/ไม่ระบุเวลา) = เวลาสุทธิ → วิ/ชิ้นจริง vs `dr_products.cycle_time_sec` = %ความเร็ว (caveat ใบอื่นวิ่งทับ = ภาพรวมไลน์) · Downtime+ใบซ่อม MO (`source_downtime_id`→root_cause/solution) + **ประวัติซ่อมเครื่องที่ใบใช้ย้อน 30 วันก่อนเปิดใบ** (`mtn_orders.machine_no`) · 4M วันนั้น · การตรวจประจำวัน (Daily PM count / Poka-Yoke / LPA) · วัสดุ (child_lot_requests `source_prod_no` → raw_withdrawal_requests) · เส้นทาง stock (เข้าคลัง = hard link `ref_order_id` · ตัดส่ง = ยอดรวมเชิงเวลา) · 🧭 บริบทกะ: **กะก่อนหน้าของไลน์ (OEE A/P/Q)** + ใบอื่นในกะ (คลิกกระโดดได้)
### 🏭 สอบกลับถึง "อุปกรณ์ที่ใช้ผลิต" — เครื่อง/แม่พิมพ์ขาด PM ไหม ใครแตะล่าสุด (2026-08-11 · คำขอ user)

โจทย์: **ของใบนี้มีปัญหาคุณภาพ → ย้อนไปหาเครื่อง/แม่พิมพ์ที่ผลิต → ตอนนั้นขาดบำรุงรักษาไหม ครั้งล่าสุดใครทำอะไรไป**
แผง `🏭 อุปกรณ์ที่ใช้ผลิต` ใน `/order-trace` (loader + `CollapseCard id="equip"`)

> #### ⚠️ กฎเหล็ก 1 — "ใบนี้ใช้เครื่องไหน" ตัดสินด้วย **`flow_mode` ของไลน์** ห้ามเหมาว่าเป็นผู้ต้องสงสัยเสมอ (แก้ 2026-08-11 · user ทัก)
> | flow_mode | ใบหนึ่งใช้เครื่องกี่ตัว | แผงต้องพูดว่า |
> |---|---|---|
> | **`one_piece_flow`** (ดีฟอลต์ · ไลน์ full automation) | **ทุกเครื่องในไลน์ ไล่เป็น step by step** | ⛓️ "ใบนี้ผ่านเครื่องทั้ง N ตัวตามลำดับ ทุกตัวเกี่ยวข้องกับคุณภาพ" = **ยืนยัน ไม่ใช่การเดา** |
> | **`parallel_machine`** + ใบมี `machine_no` | เครื่องเดียวที่ระบุ | 🎯 "ใบนี้ระบุเครื่อง X" |
> | **`parallel_machine`** + ใบไม่มี `machine_no` | ไม่รู้ | ⚠️ "ผู้ต้องสงสัย ไม่ใช่ข้อสรุป" + ชี้ทางให้เลือกเครื่องตอนเปิด Order |
>
> **เดิมเขียนผิด** — เหมาว่าใบที่ไม่มี `machine_no` = ผู้ต้องสงสัยทุกกรณี ทั้งที่ไลน์ไหลทีละชิ้น**ใช้ทุกเครื่องจริง** (user ทัก) · อ่านโหมดผ่าน `isParallelLine(line.flow_mode)` จาก `src/utils/lineTypes.js` — **หน้าที่แตะ "ใบนี้ใช้อุปกรณ์อะไร" ต้องเช็ค flow_mode ก่อนเสมอ**
> **ห้ามทำให้ผู้ต้องสงสัยดูเหมือนคำตอบ · และห้ามลดของที่ใช้จริงให้กลายเป็นแค่ผู้ต้องสงสัย** — ผิดทั้งสองทางทำให้สอบกลับชี้ผิดเป้า
> - **ลำดับ step มาจาก `machines.sort_order`** — ถ้าตั้งเท่ากันหมด (ไม่เคยตั้ง) = ไม่รู้ลำดับจริง **ห้ามเดาเลขขั้นให้** แผงจะไม่โชว์ "ขั้นที่" แล้วบอกว่าให้ไปตั้งลำดับที่ฐานข้อมูลเครื่องจักร
> - **ทั้งไลน์ไม่มีแผน PM สักตัว = ตอบคำถามไม่ได้** ต้องขึ้นแถบบอกตรงๆ ("ยังไม่มีเกณฑ์ให้เทียบ") ไม่ใช่โชว์ค่าว่างให้ตีความเอง

> #### ⚠️ กฎเหล็ก 2 — "PM ค้าง ณ วันผลิต" ต้องคำนวณย้อนจากประวัติ **ห้ามอ่าน `pm_plans.next_due_date` ตรงๆ**
> `next_due_date` / `last_done_at` เป็น **สถานะปัจจุบัน (mutable) ไม่ใช่ประวัติ** — ช่างทำ PM หลังวันผลิต ค่าก็ขยับไปข้างหน้าแล้ว → **ใบเก่าจะดูเหมือน "PM ปกติ" ทั้งที่ตอนผลิตค้างจริง** (เทสแล้ว: วิธีเดิมตอบ "อยู่ในรอบ" ในเคสที่สำคัญที่สุด)
> **สูตรที่ใช้:** `ครบกำหนด ณ ตอนนั้น = inspections ครั้งล่าสุดก่อนเวลาผลิต (match ด้วย checklist_id) + interval_days` แล้วเทียบกับ `work_date`
> - **แผน `usage`/`hybrid` ย้อนไม่ได้ → ไม่เดา** แสดงว่า "ย้อนสถานะไม่ได้" แล้วโชว์ค่าปัจจุบัน**พร้อมป้าย "(ค่าปัจจุบัน)"** กำกับเสมอ
> - **ไม่มีประวัติตรวจก่อนวันผลิตเลย ≠ ค้าง** → ขึ้นเป็นสัญญาณของตัวเอง "มีแผน PM แต่ไม่พบประวัติการตรวจ"
> - หลักเดียวกับกฎ "ห้าม blanket-recompute OEE กะเก่าด้วย master ปัจจุบัน" — **ค่าที่เปลี่ยนได้ ห้ามเอาไปตอบคำถามย้อนหลัง**

- **ทุก query ตัดที่ "เวลาผลิต" (`opened_at`) ไม่ใช่ `now()`** — PM/ซ่อมที่เกิดหลังผลิตไม่ช่วยใบที่เสียไปแล้ว
- **ชี้เป้าก่อนกองข้อมูล** — เรียงตามความควรสงสัย: ยืนยันตัวจริง(100) → PM ค้าง(40) → เพิ่งซ่อมเสร็จ ≤7 วัน(30) → ไม่เคยตรวจ(20) → มี DT ในกะ(10) · แสดง 8 ตัวแรก ที่เหลือพับใน `<details>`
  - **"เพิ่งซ่อมเสร็จก่อนผลิต" เป็นสัญญาณคุณภาพชั้นดี** (ตั้งค่าใหม่ยังไม่นิ่ง) — อย่าตัดทิ้งเพราะดูเหมือนข่าวดี
- **แหล่งข้อมูลต่อเครื่อง:** `machines` (กรอง `is_active` + `equipment_category='production'`) → แถวเงา `jigs.machine_id` → `checklists` (module `mtn`) → `pm_plans` · ประวัติตรวจ `inspections` (180 วัน) · ใบซ่อม `mtn_orders` by `machine_no` (90 วัน) · **ใครแก้ทะเบียน `audit_log`** (table `machines`/`jigs`) · ตรวจ AM วันนั้นจาก `pm_daily_line_targets`+`inspections`
- **⚠️ ชื่อผู้ตรวจอยู่คนละ project** — `inspections.inspector_id` → `profiles` ฝั่ง **Main** (join ตรงไม่ได้ ต้องดึงแยกด้วย client `supabase`)
- **จิ๊ก/แม่พิมพ์ตัวจริง = `jigs` ที่ `machine_id IS NULL`** (ตัดแถวเงาของเครื่องออก ไม่งั้นเครื่องตัวเดียวโผล่ 2 แถว — กฎเดียวกับ `/qr-labels`) · ข้อมูลจริงยังมีจิ๊ก 1 ตัว DIE 0 → แผงบอกให้ไปลงทะเบียนที่ PM Setup แทนที่จะเงียบ
> #### ⚠️ กฎเหล็ก 3 — `inspections.status` เทียบ **ตรงตัว** ห้ามใช้ regex (2026-08-11 · QC จับได้)
> ค่าที่เป็นไปได้มีแค่ 4 (check constraint `pm_inspections_status_check`): `pending | pass | fail | warning`
> **`/fail|ng/i` จับ "pe·nd·ing" และ "warni·ng" ติดทั้งคู่** → `pending` (= **ค่า default ของคอลัมน์** และเป็นค่าที่ `computeOverall()` คืนทุกครั้งที่ผู้ตรวจเว้นจุดตรวจไม่ครบ) ขึ้นแดงว่า **"พบผิดปกติ"** = สร้างหลักฐานเท็จในแผงที่ใช้สอบสวนคุณภาพ
> ใช้ helper `inspVerdict(status)` (OrderTrace.jsx) — `pending`/ว่าง = เทา "ตรวจไม่ครบทุกจุด" (เป็นสัญญาณของตัวเอง คนละเรื่องกับพบของเสีย) · `INSP_NG = {fail, warning, ng}` = แดง

- **⚠️ ประวัติการตรวจต้องดึง "ครั้งล่าสุดต่อ checklist" ทีละใบ ห้ามกวาดรวมแล้ว `.limit(N)`** — AM ตรวจทุกต้นกะ ย้อน 180 วันทะลุพันแถวง่ายๆ → ประวัติ **PM ช่างรายไตรมาส (ตัวที่อยากสอบพอดี) ถูกเบียดตกไปก่อน** แล้วแผงพูดผิดว่า "ไม่พบประวัติการตรวจ" **+ กลบ PM ที่ค้างจริงให้กลายเป็น "อยู่ในรอบ"** (ขัดกฎเหล็กข้อ 2 ของตัวเอง) · จำนวน checklist อยู่ระดับหลักสิบ ยิงขนานด้วย `Promise.all` ได้
- **⚠️ "เพิ่งซ่อมเสร็จก่อนผลิต" ต้องกรอง `repair_done_at <= เวลาผลิต` ด้วย** — query กรองแค่ `created_at` → ใบที่ **แจ้งก่อนผลิตแต่ช่างซ่อมเสร็จหลังผลิต** (เคสธรรมดามาก) ได้ค่าติดลบ → ขึ้นชิป "🟠 ซ่อมเสร็จ **-5 วัน**ก่อนผลิต" + ดัน risk score จัดเครื่องผิดตัวขึ้นบนสุด · และเรียงด้วย `repair_done_at` ไม่ใช่ `created_at`
- **⚠️ "ตรวจ AM แล้ว" ต้องกรอง `checklists.department='production'`** — ไม่งั้นวันที่ช่าง JIG MTN เข้า PM เครื่องนั้น จะถูกนับว่าผลิตตรวจ AM แล้ว (หลักเดียวกับ `prodIds` ใน `src/lib/pmDailyAlarm.js`)
- **ทุก query เช็ค `error` + ชนเพดาน `.limit()` → ตั้ง flag `equip.partial`** ขึ้นแถบส้มบอกว่า "โหลดได้ไม่ครบ" — ห้ามให้ข้อความ "ไม่มีประวัติบำรุงรักษา" ฟังดูเป็นข้อเท็จจริงทั้งที่แค่โหลดไม่ติด (กฎ supabase-js คืน `{ error }` ไม่ throw)
- **ยังไม่ทำ:** ไม่มีการผูก "ใบผลิต ↔ แม่พิมพ์ที่ใช้" (ต้องมี field เลือกแม่พิมพ์ตอนเปิดใบ หรือสแกน QR จิ๊กเข้างาน) → แม่พิมพ์จึงยังเป็นระดับไลน์เสมอแม้ใบจะระบุเครื่องแล้ว

- **ขอบเขต/GAP ของ traceability ทั้งระบบ (audit 2026-07-30):** (1) **ขาแรกจากลูกค้า→order**: ตอนกด "ส่งแล้ว" consume เป็นยอดรวม ไม่บันทึก ref_order_id → ผูก shipment↔ใบผลิตไม่ได้ ต้องใช้ tag บนกล่อง/ช่วงเวลา (2) **วัสดุสุดทางที่เลข MAT**: การรับวัตถุดิบเข้า Store ไม่มีช่อง lot no./heat no. ของ supplier (3) **backflush เชิงปริมาณ**: `source_prod_no` ใน child_lot_requests = ใบที่ trigger สะสมครบล็อต ไม่ใช่ identity รายชิ้น · ตาราง `kanban_scans` เป็น vestigial (ไม่มีโค้ดเขียนแล้ว) — ถ้าจะปิด gap เรียงความคุ้ม: บันทึก ref_order_id ตอน consume ส่งลูกค้า → เพิ่ม lot no. supplier ตอนรับเข้า → lot genealogy รายกล่อง
- component ร่วม: `src/components/CollapseCard.jsx` (แยกจาก ProductHistory — section ย่อ/ขยาย จำสถานะ localStorage ผ่าน `storePrefix`)

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
  - **⚠️ หยุดตามแผน (`category='planned'`) ห้าม Andon แดง / ห้ามยิงแจ้งเตือน (2026-08-04 · คำสั่ง user):** นับสต๊อก / ไม่มีแผนผลิต / 5ส ไม่ใช่ความเสียหาย ไม่มีอะไรให้ "ดำเนินการทันที" — เคสจริง: SP-88 "นับสต๊อก/ไม่มีแผนผลิต" ค้าง 349 นาที เด้ง ANDON RED + ไซเรน + Telegram ทั้งวัน · แก้ 2 ชั้น: (1) client `isAlarmingDT = isOpenDT && !isPlannedDT` (แก้ที่ util จุดเดียว มีผลทั้ง Dashboard/Management/DeptHub) (2) edge `downtime-open-scan` กรอง `category !== 'planned'` ก่อนยิง `downtime_open_15min` — **ต้อง deploy edge ใหม่** (ก่อน deploy: จอไม่แดงแล้ว แต่ Telegram/ไซเรนยังดังจาก planned)
  - **แต่ห้ามซ่อนหาย:** `fetchActiveDowntimes` คืน `plannedList`/`plannedByLine` แยกออกมา · แผง Andon (Dashboard) โชว์บล็อก "🗓️ หยุดตามแผน · N รายการ (ไม่นับเป็น Andon)" สีเทาสงบ ไม่กระพริบ
  - **แผง Andon ครอบทั้ง downtime + quality (2026-08-04 · คำสั่ง user):** เพิ่มบล็อก "🚫 คุณภาพ (Quality) · ของเสียวันนี้ N ชิ้น" แยกตามประเภท + 💬 หมายเหตุพนักงาน (`qualityByLine` จาก `defect_logs` ที่ join `dr_defect_types`) · **ระดับไฟ (แดง/เหลือง/เขียว) ยังตัดสินจาก downtime ค้าง + 4M ค้างเท่านั้น** — ของเสียแสดงเป็นข้อมูลประกอบ (ถ้าจะให้ NG ยกระดับไฟ ต้องมีเกณฑ์ก่อน)
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
| `telegram-webhook` | Main | ⚠️ **ซอร์สอยู่ใน repo แต่ยังไม่เคย deploy จริง** (ตรวจ 2026-08-06 — ตาราง `telegram_messages`/`telegram_sent_messages`/`telegram_pending_actions` apply แล้ว แต่ function ไม่มีในโปรเจค) → ขา "รับ" ยังไม่ทำงาน: reply ใน Telegram ไม่กลายเป็นคอมเมนต์ · AI intake `/dt` ยังใช้ไม่ได้ · ขา "ส่ง" (send-notification/send-mtn-notification) ทำงานปกติ · เปิดใช้ต้อง deploy + ตั้ง secrets + `setWebhook` กับ Telegram (เป็น action ที่มีผลกับบอทจริง — ถาม user ก่อน) · **ขา "รับ" ของบอท** (2026-07-16): Telegram ยิงทุก update เข้า function นี้ (setWebhook + secret) → (1) กวาดเก็บข้อความกลุ่มที่ลงทะเบียน → `telegram_messages` (2) **reply ใต้ข้อความแจ้งเตือน = คอมเมนต์ `event_comments` ผูกใบงานอัตโนมัติ** (mapping จาก `telegram_sent_messages` — send-notification/send-mtn-notification ถูก patch ให้จำ message_id ของ event ที่มี ref: mtn ทุก event + downtime_call_mtn/open_15min · payload ต้องส่ง `id` มาด้วย) (3) **AI intake**: `/dt RB80 โรบอทชนจิ๊ก 14.00-14.20` ทุกกลุ่ม หรือพิมพ์อิสระในกลุ่มที่อยู่ใน env `AI_INTAKE_CHAT_IDS` → Claude Haiku แยกฟิลด์ → ground กับ machines/dr_downtime_types/production_sessions จริง (work date ตัด 08:00 ไทย) → ปุ่ม [✅ บันทึก][❌ ยกเลิก] ใน Telegram — **คนกดยืนยันเท่านั้นถึง insert `downtime_logs` · AI ห้ามเขียนฐานเอง** (คิว `telegram_pending_actions` หมดอายุ 6 ชม.) · secrets: `TELEGRAM_WEBHOOK_SECRET`, `DR_URL`, `DR_ANON_KEY`, `ANTHROPIC_API_KEY` (ไม่ตั้ง = ปิดเฉพาะ AI), `AI_INTAKE_CHAT_IDS` · migration `20260716_telegram_intake.sql` (Main — 3 ตาราง service-role-only) |

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
- **เปลี่ยน/ลบรูปแล้วต้องลบไฟล์เก่าจาก storage เสมอ** (ลบ**หลัง** DB update สำเร็จเท่านั้น + best-effort ห้ามทำ flow หลักพัง) — ทำแล้วใน: DeptHub.jsx (รูปโปรไฟล์ user — bucket `avatars` **แยกจาก employee-photos โดยเจตนา** เพราะ cleanup-orphan-photos สแกน employee-photos เทียบ employees/line_layouts เท่านั้น ไฟล์ avatar ที่ไปอยู่ที่นั่นจะโดนลบ · migration `20260714_profiles_avatar.sql`), operator.jsx (รูปพนักงาน), LineSetup.jsx (ผังไลน์ ทั้งตอนเปลี่ยนผัง/ตอนลบไลน์/**ปุ่ม 🗑 ลบรูปผัง** (2026-08-04 — เคสเผลออัพรูปทับ ลบแล้วไลน์ลูกกลับไปยืมผังไลน์แม่อัตโนมัติ · เช็ค sharers ก่อนลบไฟล์) — เฉพาะผังของตัวเอง **ห้ามลบผังที่ยืมแสดงจากไลน์แม่**), ProductMaster.jsx (dr_products + parts_master ทั้งตอนเปลี่ยนรูปและตอนลบสินค้า — มี guard ไม่ลบรูปที่สินค้า/พาร์ทอื่นแชร์ URL เดียวกัน), QAInspectionSetup.jsx (replace/delete drawing + ลบทั้งโฟลเดอร์ตอนลบ part), PMSetup.jsx (ลบ jig = ลบรูปทั้งชุด frame-*/cp-*), SignatureModal.jsx (ลายเซ็นเก่า — เฉพาะโฟลเดอร์ user ตัวเอง), Management.jsx (รูปหลักฐาน OJT แนบทับ = ลบรูปเดิม), MtnMachineLayout.jsx (รูปโซน facility), Improvements.jsx (รูป before/after ทั้งตอนเปลี่ยนและตอนลบโปรเจค) · หน้าใหม่ที่มีการเปลี่ยนรูปต้องทำแบบเดียวกัน ไม่งั้นไฟล์กำพร้าสะสม (เคยค้าง 117 ไฟล์ / 100MB เพราะอัปโหลดชื่อใหม่ `emp_<timestamp>` โดยไม่ลบของเดิม)
- **อุปกรณ์ PM ใช้ "รูปหลายมุม (spin)" เท่านั้น — ไม่มีโมเดล 3D แล้ว** (ถอดออก 2026-07-10 เพราะเกินจำเป็น + dep หนัก three/occt wasm 7.6MB): PMSetup อัปหลายรูปมุมต่างๆ (SpinAnnotator) ปักหมุดจุดตรวจต่อเฟรม, หน้าตรวจ (JigSpinCheck) ปัดหมุน+auto-play+หมุด sync checklist · **รูป spin บังคับ crop แนวตั้ง 3:4 + ลดขนาด ตอนอัปโหลด (2026-07-24 — คำสั่ง user):** `PMSetup addFrames` → `imageCompression` (normalize EXIF) → `src/utils/cropPortrait.js` (center-crop 3:4, ด้านยาว ≤1200px, q0.82) · รูปถ่ายมือถือ = แนวตั้งอยู่แล้ว, รูปแนวนอนถูก center-crop ให้เป็นแนวตั้งเท่ากันทุกเฟรม (จอตรวจ JigSpinCheck/SpinAnnotator เป็น container แนวตั้ง fit-content — ดู UI-CONVENTIONS §5.1) · คอลัมน์ vestigial `jigs.model_path`/`model_format` และ bucket `jig-images` (cap 40MB + mime GLB) ยังคงอยู่จาก migration เดิม (additive ไม่กระทบ) แต่**ไม่มีโค้ดใช้แล้ว** — ถ้าจะรื้อ 3D กลับมาให้ดู git history (`src/lib/model3d.js`, `src/components/Model3DViewer.jsx`)
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

docs/                  # ENGINEERING-PRINCIPLES.md (หลักการแก้แบบยั่งยืน — อ่านก่อนทุกงาน) ·
                       #   UI-CONVENTIONS.md (บังคับอ่านก่อนแก้ UI) · PERMISSIONS-DESIGN.md ·
                       #   ROLLBACK_*.md · sql/ (schema snapshot + seed อ้างอิง) ·
                       #   TRANSPORT_AMR_DESIGN.md · SCADA_REALTIME_DESIGN.md ·
                       #   DASHBOARD-DESIGN.md (dashboard รายส่วนงาน) ·
                       #   NAVIGATION-REVIEW.md (รีวิวโครงเมนู/แท็บ — ทำครบ 5 เฟสแล้ว 2026-08-11 ดู §6)
```

> **📡 SCADA / ข้อมูลเครื่องจักร realtime — ดู `docs/SCADA_REALTIME_DESIGN.md` ก่อนลงมือเสมอ (2026-08-06)**
> ทิศทางที่ตกลงไว้: ให้ SCADA เป็น **"เซ็นเซอร์"** ส่ง raw data (stroke/สถานะเครื่อง/เวลาหยุด) เข้ามา
> แล้ว **ESM เป็นเจ้าของสูตร** — `src/utils/oee.js` ยังเป็น single source of truth เหมือนเดิม
> **ห้ามให้ระบบภายนอกคำนวณ OEE เองแล้วเอาเลขมาโชว์** (มี OEE 2 ชุด = เถียงกันว่าจะเชื่อจอไหน)
> หลักการ: **SCADA = ข้อเท็จจริง · คน = เหตุผล** (เครื่องบอกได้ว่าหยุดตอนไหน บอกไม่ได้ว่าทำไม · และ**ไม่มีทางรู้ NG** → Q ยังต้องมาจากคนเสมอ)
> ⚠️ ข้อที่มองข้ามบ่อย: ปริมาณแถวจะโต **×113 ถึง ×450** จากที่คนกรอกวันนี้ (DR ตอนนี้ 36MB/500MB) · micro-stop ต้องแยกเป็น P ไม่ใช่ A · **1 stroke งานคู่ = 2 ชิ้น** (ต้องมี `pieces_per_stroke` ไม่งั้นยอดหายครึ่ง)

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
   - **ทุกงาน → `docs/ENGINEERING-PRINCIPLES.md`** (หลักการแก้แบบยั่งยืน + checklist ก่อน commit/merge)
   - แก้ UI → `docs/UI-CONVENTIONS.md` (บังคับ)
   - แตะสิทธิ์/role → `docs/PERMISSIONS-DESIGN.md`
   - แตะ DB → section "Supabase Projects" (2 projects!) + เขียน migration ลง `supabase/migrations/` เสมอ
2. **ทำงานให้สอดคล้องกับกฎ** — ถ้าสิ่งที่จะทำขัดกับ convention เดิม ให้ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยน (แล้วต้องไล่แก้ทุกจุดที่ใช้ pattern นั้นให้ตรงกัน)
3. **อัพเดทกฎหลังทำ** — งานที่สร้าง/เปลี่ยน pattern, schema, สิทธิ์, หรือ workflow ที่ session อื่นต้องรู้ → อัพเดทเอกสารที่เกี่ยวข้อง (CLAUDE.md / UI-CONVENTIONS.md / PERMISSIONS-DESIGN.md) **ในคอมมิทเดียวกัน** พร้อมวันที่
4. build ผ่าน (`npm run build`) ก่อน commit เสมอ · merge เข้า `main` = deploy จริง
   - **`npm run build` มีด่าน lint กฎ crash ในตัวแล้ว (2026-07-24)** — `eslint.critical.config.js` เช็ค `no-undef` ฯลฯ เฉพาะกฎที่ทำแอปพังตอน runtime (bundler ไม่จับ — เคยเกิดจริง: ใช้ useMemo โดยไม่ import → Daily Report จอขาวทั้งโรงงาน) · lint ไม่ผ่าน = build ไม่ผ่าน ห้าม bypass (`vite build` ตรงๆ) เพื่อหนีด่าน — แก้โค้ดให้ผ่านแทน · **ห้ามเพิ่มกฎ style จุกจิกใน config นี้** (ทำให้คนอยาก bypass ด่านที่กันของพังจริง)
     - **`react-hooks/rules-of-hooks` เปิดในด่านนี้แล้ว (2026-07-30)** — จับ hook ที่วางหลัง early return / ใน if / ใน loop = React #310 (จอ error ทั้งหน้า) ที่ build ธรรมดาไม่เห็น · เคสจริงที่ทำให้เปิดกฎ: MtnRepair (`useMemo` หลัง `if (loading) return`) ทำหน้าแจ้งซ่อม crash + ProtectedLayout (`if (!session) return` ก่อน useAutoLogout/useState) · **กฎเหล็ก: hook ทุกตัวต้องอยู่บนสุดของ component ก่อน early return เสมอ** — ถ้าเจอ error นี้ตอน build ให้ย้าย hook ขึ้นก่อน return ห้าม disable กฎ

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

#### ผลรอบ audit เต็ม 2026-08-03/04 — แก้ครบแล้ว (บันทึกไว้กัน regress)

| หมวด | ที่แก้ | สาระ |
|---|---|---|
| A Date/Time | `PMSchedule.jsx` | modal เลื่อนแผน PM เคยใช้ `toISOString().slice(0,10)` = UTC → วันเลื่อนเพี้ยน 1 วันช่วง 00:00-07:00 ไทย · ใช้ helper `ymd()` local แทน |
| B Supabase | `LineSetup.jsx` `handleRenameLine` | ขยาย cascade `line_name` อีก 5 ตาราง (Main `lpa_questions`/`station_assignment_logs` · DR `pm_daily_alerts`/`kanban_calc_params`/`transport_nodes`) · `lpa_questions.hidden_for_lines[]` เป็น text[] ต้องอ่าน-แก้-เขียนรายแถวด้วย `.contains()` |
| C Permissions | `permissions.js` · `operator.jsx` · `pmNotify.js` | bucket `dept_admin` บังคับข้าม key `page:*` ในโค้ด (ไม่พึ่งความถูกต้องของ seed) · แท็บ operator gate ด้วย `can()` แทน role array · ผู้รับแจ้งเตือน PM อ่าน role จาก `role_permissions` (`pm:record`/`qa:record`) ไม่ hardcode |
| D Scoping | `StoreMonitor.jsx` · `QualityControl.jsx` | 2 หน้านี้เห็นข้ามส่วนงาน — เพิ่ม mandatory scope (leader = family · อื่น = sections) ครอบทั้งลิสต์/ตัวนับ/dropdown |
| E Storage | `MtnRepair.jsx` | แก้ไขสเตปแล้วอัปรูป/ลายเซ็นทับ = ไฟล์เก่ากำพร้า → ลบไฟล์เดิมหลัง DB update สำเร็จ (best-effort · ข้ามลายเซ็นจากโปรไฟล์ที่ใช้ร่วม) |
| F UI | `DailyReport` (10 จุด) + PmCoordination/MonthlyReviewExport/TaxonomyManagerModal · `PMSetup` · `StoreMonitor` · `Improvements` · `OEEAnalytics` | ติด `mgrid` ให้ grid ใน modal · ImageAnnotator เพิ่มซูม 100-400% (§5.1) · เลิกเขียน keyframes กระพริบเอง ใช้ `.mo-card-alert` · playhead gantt ใช้ `.now-line` · แกนวันกราฟเทรนด์ต่อเนื่อง (วันไม่ผลิต = ตอว่าง ไม่ข้ามวัน) |
| G เอกสาร | Checkin/DailyReport + `20260804_doc_forms_attendance_dpr.sql` | ฟอร์ม export 3 ตัวสุดท้ายเข้าทะเบียน `doc_forms` แล้ว (ดูแถว `/doc-forms`) |

- **ปิดเคสแล้ว:** `FactoryMap.jsx` ไม่กรอง scope — **user ยืนยัน 2026-08-05 ว่าตั้งใจ ให้ทุกคนเห็นทั้งโรงงาน** (บันทึกเป็นข้อยกเว้นทางการในหัวข้อ Section Scoping แล้ว ไม่ต้องแก้โค้ด)

#### ⚠️ audit "migration ในรีโปครบแต่ยังไม่ apply" — วิธีตรวจที่เชื่อถือได้ (2026-08-06)

**`supabase migration list` เทียบชื่อไฟล์ไม่ได้** — เวอร์ชันในตาราง `supabase_migrations.schema_migrations` เป็น timestamp ที่ระบบตั้งตอน apply ผ่าน MCP ไม่ใช่ชื่อไฟล์ในรีโป · **ไฟล์ที่ไม่ได้ apply จึงไม่มีทางรู้จากทะเบียน ต้องพิสูจน์จาก schema จริง**
**วิธีที่ใช้ (ทำซ้ำได้):** สแกนทุกไฟล์ใน `supabase/migrations/` ดึงเป้าหมายที่สร้าง (`create table` / `add column` / `create function`) → query `information_schema` ของ **ทั้ง 2 project** → ของที่**ไม่มีในทั้งคู่** = migration ที่ยังไม่ apply จริง (ไม่ต้องรู้ว่าไฟล์ไหนของ project ไหน)
**ผลรอบนี้ (175 ไฟล์ · 215 object):** ค้างจริง **1 ไฟล์** = `20260722_mtn_return_reroute.sql` (apply แล้ว 2026-08-06 · ดูรายละเอียดในหัวข้อ MTN Work-Order) · อีก 6 ตาราง `pm_equipment`/`pm_checklists`/`pm_checkpoints`/`pm_inspections`/`pm_inspection_results`/`pm_schedules` จาก `20260701_add_pm_maintenance_module.sql` **ไม่มีในทั้ง 2 project และไม่ต้อง apply** — ไฟล์นั้น DEPRECATED ตั้งแต่ 2026-07-10 (โมดูล PM จริงย้ายไป `jigs`/`checklists`/`jig_checkpoints`/`inspections`/`inspection_results`/`pm_plans` ฝั่ง DR) เก็บไว้เป็นประวัติเท่านั้น
**บทเรียน:** migration ที่ค้างจะ**พังเงียบ** (write ตัวที่ไม่ tolerant ได้ error 42703 เฉพาะตอนผู้ใช้กดใช้ฟีเจอร์นั้น) — ค้างมา 2 สัปดาห์กว่าจะรู้ · เขียน migration เสร็จ **ต้อง apply แล้วบันทึกวันที่ apply ใน CLAUDE.md ทันที** (pattern เดียวกับที่ `line_type`/`flow_mode`/`equipment_category` เคยค้างแล้วทำให้ช่องเซฟไม่ติดเงียบๆ)

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
- **`display:grid` ที่วางในคอลัมน์สูงๆ (`flex:1`/`flex:7 0 0`) แล้วมีของแค่แถวเดียว → การ์ดถูกยืดสูงผิดสัดส่วน** เพราะ default `align-content: stretch` ของ grid กระจายพื้นที่ว่างแนวตั้งลงแถว → ต้องใส่ **`alignContent: 'start'`** เสมอเมื่อ grid อาจสูงกว่าเนื้อหา (เจอจริง: การ์ดพนักงานใน pool หน้า Management ยืดยาวลงมาทั้งใบ 2026-08-03) · ต่างจาก flexbox (default `align-items: stretch` ยืดแค่แกนขวาง ไม่ยืดตามความสูง container) — pattern เดียวกันกับ grid card ทุกจุดที่ container สูงกว่าเนื้อหา

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

### PWA — เพิ่มลงหน้าจอโฮม เปิดเหมือนแอป (2026-07-23)

รองรับ "เพิ่มลงหน้าจอโฮม" (iOS Safari / Android Chrome) เปิดแบบ standalone (เต็มจอ ไม่มีแถบ browser มีไอคอนเอง) เหมาะจอหน้าไลน์/มือถือหัวหน้า
- **manifest-only ตั้งใจ ไม่มี service worker** — เพราะ SW ที่ cache asset จะชนกับ **version-guard/auto-reload** ใน `main.jsx` + no-cache header ใน `render.yaml` (กลไกกัน "จอดำหลัง deploy" — ดู 3 กับดักด้านล่าง) · ถ้าจะเพิ่ม offline/auto-install-prompt (Android banner) ต้องเขียน SW แบบ **network-only ห้าม cache HTML/chunk** ไม่งั้นแอปค้างเวอร์ชันเก่า
- ไฟล์: `public/manifest.webmanifest` (name/short_name ESM, display standalone, theme/bg `#080f08`) + icons `public/icon-192.png`/`icon-512.png`/`icon-maskable-512.png`/`apple-touch-icon.png` (180 — iOS ต้อง PNG ไม่รับ SVG) · ต้นฉบับไอคอน `public/app-icon.svg` (โลโก้ TS + ESM บนพื้นเขียวเข้ม) · gen จาก TS logo ผ่าน Chromium (สร้างใหม่: rasterize `app-icon.svg` → PNG ขนาดที่ต้องการ)
- `index.html` `<head>` มี `<link rel=manifest>` + `theme-color` + `apple-touch-icon` + `apple-mobile-web-app-*` (status-bar-style = `default` กันเนื้อหาทับ notch) — **ห้ามถอด**
- **เปลี่ยนโลโก้/ไอคอน** → แก้ `app-icon.svg` แล้ว rasterize ใหม่ทับ PNG ทั้ง 4 ไฟล์ (ขนาดเดิม) · เปลี่ยนชื่อไฟล์ไอคอนต้องอัพเดท manifest + index.html ด้วย
- **Badge จุดแดง/เลขบนไอคอนแอป (2026-07-23):** `NotificationBell` (App.jsx) sync `navigator.setAppBadge(unread)`/`clearAppBadge()` ตามจำนวนแจ้งเตือนที่ยังไม่อ่าน (ตาราง `notifications`) · **guard `'setAppBadge' in navigator`** · ✅ Android/desktop Chrome-Edge (ติดตั้ง PWA) · ❌ **iOS ไม่รองรับ App Badging API** (Apple ยังไม่ทำ — iPhone จะไม่เห็นเลขบนไอคอน) · อัปเดต**เฉพาะตอนเปิดแอป**เท่านั้น (ไม่มี service worker/Web Push → ปิดแอปแล้วไม่เด้ง) · ล้าง badge ตอน logout/unmount · ถ้าจะให้เด้งตอนปิดแอป (เหมือน LINE) ต้องเพิ่ม SW network-only + Web Push VAPID (ยังไม่ทำ)
- **เสียงแจ้งเตือน (2026-07-30):** `NotificationBell` เล่นเสียง chime (Web Audio — `playNotifChime()` ใน App.jsx, ไม่ต้องมีไฟล์เสียง) ตอนมี notification ใหม่เข้ามาแบบ realtime (INSERT — initial load ไม่เล่น) · prime AudioContext ตอน gesture แรก (เบราว์เซอร์บล็อกเสียงจนกว่าจะมี user interaction) · ปุ่ม 🔔/🔕 ในหัว dropdown เปิด/ปิดเสียง จำที่ `localStorage['esm-notif-sound']` (`off`=ปิด) · **ทำงานเฉพาะตอนเปิดแอปอยู่**
- **Web Push — เด้งเข้ามือถือแม้ปิดแอป (เฟส B · 2026-07-30):** เพิ่ม service worker `public/sw.js` (**push + notificationclick เท่านั้น ไม่มี fetch handler ไม่ cache อะไร** — จงใจ กันชน version-guard/no-cache · register production-only ใน `main.jsx`) · VAPID keys เก็บใน `notification_settings` (คอลัมน์ `vapid_public/private/subject` — เหมือน bot_token, RLS on ไม่มี policy = อ่านได้เฉพาะ service role · ค่าจริง**ไม่อยู่ใน migration** set ผ่าน execute_sql) · ฝั่งเว็บดึง public key ผ่าน RPC `get_vapid_public_key()` · subscription เก็บ `push_subscriptions` (RLS ของ user เอง) · **trigger `trg_notify_push` (notifications AFTER INSERT) → pg_net ยิง edge `send-push` อัตโนมัติทุก row** (best-effort ไม่ทำ insert หลักพัง) → ทุกอย่างที่เขียน `notifications` = เด้ง push ให้เอง · edge `send-push` (Deno + `npm:web-push`, verify_jwt=false) อ่าน VAPID + subscriptions ของ user ส่ง push · 404/410 = ลบ subscription หมดอายุ · migration `20260730_web_push.sql` · **ทุกอย่าง free tier** (push service ของ browser ฟรี, VAPID ฟรี, edge function ฟรี) · util ฝั่งเว็บ `src/utils/webpush.js` · ปุ่ม "📲 เปิด" อยู่ในหัว dropdown กระดิ่ง
  - ⚠️ **iPhone:** ต้อง "เพิ่มลงหน้าจอโฮม" (standalone) + iOS 16.4+ ก่อน (Safari เฉยๆ ไม่รองรับ — util เช็ค `isIosNonStandalone` โชว์คำแนะนำแทนปุ่ม) · Android/desktop Chrome-Edge ใช้ได้เต็มที่ · เสียง push ตอนปิดแอป = เสียงระบบมือถือ (กำหนดเองไม่ได้)
  - **event ที่เข้ากระดิ่ง+เสียง+push (เขียนตาราง `notifications`):** 4M + @mention (เดิม) · **+ urgent เครื่องหยุด 2 ตัว (2026-07-30): `downtime_call_mtn` (เรียกช่าง) + `downtime_open_15min` (เครื่องค้างเกินเกณฑ์)** — ผู้รับ = `recipientsForDowntime(line_name)` = **ทีมช่างทั้งหมด (role `mtn`) + หัวหน้าของ section ไลน์นั้น** (supervisor/manager ที่ section ตรงกับไลน์ ผ่าน `headsForLine` — เทียบ `production_lines.section` กับ `profiles.section`/`sections[]` + leader ที่ `line_id` ตรงไลน์) · helper `usersByRole`/`headsForLine`/`recipientsForDowntime`/`insertNotifications` ใน `send-notification` edge (เพิ่ม event urgent อื่นเรียกซ้ำได้) · **เจตนา เน้น urgent เท่านั้น** (เช็คชื่อ/OT/ปิดกะปกติ ยังอยู่แค่ Telegram กัน notification fatigue) · **⚠️ ผู้รับ urgent 2 ตัวนี้ (mtn+heads) hardcode ในโค้ด** — แก้ต้อง redeploy `send-notification`
  - **✅ ผู้รับในแอปแบบ data-driven ต่อทุกเรื่อง (2026-07-31):** `notification_rules.inapp_roles text[]` — ตั้งจากหน้า `/notification-config` (picker "📲 แจ้งในแอปด้วย" เลือก role ผู้รับต่อเรื่อง) · edge `send-notification` มี `notifyInApp(routes, event, message)` เรียกท้ายทุก branch มาตรฐาน (checkin/OT/morning/downtime/prod_close/pm/edi/shipping…) → เรื่องที่ตั้ง `inapp_roles` ไว้ = insert `notifications` ให้ user ทุกคนใน role นั้น (title=label เรื่อง, body=ข้อความ Telegram ตัด HTML) → trigger ยิง push ต่อ · **ไม่ตั้ง role = เข้าแค่ Telegram เหมือนเดิม** · **admin เพิ่มผู้รับเรื่องไหนก็ได้จาก UI ไม่ต้องแก้โค้ด** · migration `20260731_notification_inapp_roles.sql` · ⚠️ 3 branch bespoke (4M/downtime_call_mtn/downtime_open_15min) ไม่เรียก notifyInApp (มี recipient เองแล้ว) — `inapp_roles` ของ 3 เรื่องนี้ไม่มีผล

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
