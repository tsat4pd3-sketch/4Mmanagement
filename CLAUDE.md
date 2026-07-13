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
| `production_lines` | ไลน์ผลิต | id, name, section, parent_line_name, std_day_shift, std_night_shift |
| `oee_targets` | Target OEE/A/P/Q **รายกรุ๊ป** (parent line/ไลน์เดี่ยว) — ระดับ section ไม่เก็บใน DB ใช้**ค่าเฉลี่ยของกรุ๊ป**คำนวณสดในหน้า OEE (2026-07-13) | group_name (unique), target_oee/a/p/q (null = ค่ามาตรฐาน 85/90/90/99) · ตั้งจากปุ่ม 🎯 ใน /oee-analytics (สิทธิ์ manage_master_data) · migration `20260713_oee_targets.sql` |
| `profiles` | User roles + scope | id, email, role, **position** (ตำแหน่งจริง — แสดงผลเท่านั้น), full_name, line_id, section, sections[], notify_email, signature_url |
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
| `employee_skills` | คะแนนทักษะรายพนักงาน (skill_name, score 0-100) |
| `skill_definitions` | นิยามทักษะ (id, name, label, color) |

### กะการทำงาน
| Table | คำอธิบาย |
|-------|---------|
| `shift_schedules` | ตารางกะ A/B รายสัปดาห์ |
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

---

## Pages & Routes

> สิทธิ์เข้าถึงแต่ละหน้า **ไม่ได้ hardcode ในโค้ดอีกต่อไป** — อ่านจากตาราง `role_permissions` ผ่าน `src/utils/permissions.js` (`canAccessPage`) ปรับได้จากหน้า `/permissions` (admin เท่านั้น) คอลัมน์ "Role" ด้านล่างคือ default ตอน seed ไม่ใช่ source of truth

| Group (sidebar) | Route | Component | Role (seed default) |
|---|---|---|---|
| ภาพรวม | `/` | DeptHub — หน้า Hub เลือกโมดูล (เต็มจอ ไม่มี sidebar, ชิปเมนูดึงจาก NAV_ITEMS) | ทุก role |
| ฝ่ายผลิต | `/dashboard` | Dashboard (ย้ายจากหมวด ภาพรวม 2026-07-12 — เนื้อหาส่วนใหญ่เป็นของฝ่ายผลิต) | ทุก role |
| ฝ่ายผลิต | `/morning-meeting` | MorningMeeting — ประชุมแถวเช้า (ดู section "Morning Meeting") | ทุก role (record: admin/mgr/sv/leader) |
| ฝ่ายผลิต | `/checkin` | Checkin | ทุก role |
| ฝ่ายผลิต | `/management` | Management | ทุก role |
| ฝ่ายผลิต | `/daily-report` | DailyReport | ทุก role |
| ฝ่ายผลิต | `/oee-analytics` | OEEAnalytics | ทุก role |
| ฝ่ายผลิต | `/daily-pm` | DailyPM | ทุก role |
| ฝ่ายผลิต | `/improvements` | Improvements (Kaizen — ดู section "Improvements") | ทุก role (manage: admin/mgr/sv/leader) |
| Logistic - Store | `/line-stock` | LineStock | ทุก role |
| Logistic - Store | `/heijunka` | HeijunkaKanban | ทุก role |
| Logistic - Store | `/rack-center` | RackCenter | ทุก role |
| Logistic - Store | `/planner-sales` | PlannerSales | manager/supervisor/leader/qa/sale |
| Logistic - Store | `/rundown-stock` | RundownStock | manager/supervisor/leader/qa/sale |
| Logistic - Store | `/customer-demand` | CustomerDemand (Delivery) | manager/supervisor/leader/qa/sale |
| การตรวจสอบและซ่อมบำรุง | `/pm-check` | PMCheckData | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-schedule` | PMSchedule | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/mtn-layout` | MtnMachineLayout | ทุก role |
| การตรวจสอบและซ่อมบำรุง | `/pm-setup` | PMSetup | admin/manager/supervisor |
| ควบคุมคุณภาพ QA/QC | `/qa` | QualityControl | admin/manager/supervisor/leader/qa/doc_control |
| ควบคุมคุณภาพ QA/QC | `/qa-setup` | QAInspectionSetup | admin/manager/qa |
| ควบคุมคุณภาพ QA/QC | `/event-log` | EventLog | admin/manager/supervisor/leader/qa (CQI-15 + Approval) |
| รายงาน | `/report` | Report | ทุก role (10 tabs + CSV export) |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/org-setup` | OrgSetup | admin |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/register` | Register | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/operator` | Operator | admin/manager/supervisor/leader |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/products` | ProductMaster | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/linesetup` | LineSetup | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/machine-database` | MachineDatabase | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/shift-organize` | ShiftOrganize | admin/manager/supervisor |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/company-calendar` | CompanyCalendar | ทุก role |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/notification-config` | NotificationConfig | admin เท่านั้น |
| ตั้งค่าโปรแกรม,ฐานข้อมูล | `/permissions` | PermissionsManagement | admin เท่านั้น |
| (ไม่อยู่ใน sidebar) | `/add-user` | AddUser | admin เท่านั้น |
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
- `production_lines.section` = `org_nodes.code` ของ section
- `production_lines.parent_line_name` = `name` ของ production_line ระดับแผนก (เช่น 'HYDROFORM')
- Department name ใน org_nodes ต้องตรงกับ parent production_line name เพื่อให้ Register กรอง LINE dropdown ถูก
- Register.jsx กรอง LINE โดย: `l.name === department || l.parent_line_name === department`

---

## Role System

> **role = "ชุดสิทธิ์ใช้ระบบ" ไม่ใช่ตำแหน่งงาน (2026-07-10)** — ตำแหน่งจริงในโรงงาน
> (ผู้จัดการฝ่าย/หัวหน้าแผนก/หัวหน้าส่วน/วิศวกร/เจ้าหน้าที่/ช่างเทคนิค ฯลฯ) เก็บที่ `profiles.position`
> (text อิสระ มี datalist แนะนำใน AddUser) ใช้แสดงตัวตน/รายงาน/ลายเซ็นเท่านั้น **ไม่มีผลต่อ permission**
> ตัวอย่าง: คน QA ทุกระดับ (technician→manager) ใช้ role `qa` เหมือนกันถ้าทำงานในระบบเหมือนกัน
> ต่างกันแค่ position · ถ้าวันหน้าระดับต่างกันต้องได้**สิทธิ์**ต่างกันจริง ค่อยเพิ่ม role ใหม่ + แถวใน
> role_permissions (ระบบรองรับ) — **ห้ามเพิ่ม role ตามชื่อตำแหน่งโดยที่ชุดสิทธิ์ไม่ต่างจาก role เดิม**

8 roles ใน enum `user_role`: `admin, manager, supervisor, leader, qa, document_control, sale, display`

| Role | สิทธิ์หลัก |
|------|-----------|
| `admin` | ทุกอย่าง รวมถึง Add User, จัดการสิทธิ์ |
| `manager` | ดูและแก้ไขได้ทุกหน้า ยกเว้น Add User/จัดการสิทธิ์ |
| `supervisor` | จัดการเฉพาะ section ตัวเอง, Register พนักงาน, อนุมัติ 4M step 1 |
| `leader` | เห็นเฉพาะ line/team ของตัวเอง |
| `qa` | ดู Dashboard + Report, อนุมัติ 4M step QA |
| `document_control` | จัดการเอกสาร CQI-15 |
| `sale` | ทีมขาย — Planner & Sales, Delivery, Kanban, Dashboard (seed: `20260708_sale_role_demand_page_permissions.sql`) |
| `display` | ดูอย่างเดียว (จอแสดงผลลอย ไม่ login เป็นคน) |

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
  2. `sections` มีค่า → จำกัดตาม array นั้น **ใช้ได้ทุก role** (เช่น manager ที่ดูแลเฉพาะ PD1+PD2)
  3. `supervisor` ที่มีแค่ `section` เดี่ยว → `[section]` (พฤติกรรมเดิมเป๊ะ)
  4. role อื่นที่มีแค่ `section` เดี่ยวค้างอยู่ → **ไม่จำกัด** (ตั้งใจ — กัน manager เก่าที่เคยกรอก section ไว้เฉยๆ โดนจำกัดกะทันหันหลัง deploy)
- UserContext ส่ง `sections` = array ผลลัพธ์สุดท้าย (`[]` = ไม่จำกัด) — ในหน้าเช็คด้วย `scopeSecs.length` แล้วกรองด้วย `inSectionScope(scopeSecs, value)` (เทียบ trim+lowercase) หรือ `.in('section', scopeSecs)` ใน query
- `leader` ยังผูก `profiles.line_id` + `team` เหมือนเดิม ไม่เกี่ยวกับ sections — เช็ค branch ของ leader **ก่อน** branch ของ scope เสมอ
- AddUser.jsx: ช่อง Section เป็น checkbox เลือกหลายอันได้ทุก role และ**ยังเขียน `section` เดี่ยว (= ตัวแรกที่ติ๊ก) คู่กันเสมอ — ห้ามเลิกเขียน** เพื่อให้ revert โค้ดกลับเวอร์ชันเก่าได้โดย supervisor ไม่หลุด scope · supervisor ยังบังคับติ๊กอย่างน้อย 1 (Edge Function `create-user` ยังไม่รู้จัก sections — AddUser update ตามหลังด้วย id ที่ได้กลับมา)
- หน้าที่ปิดช่องโหว่แล้ว: Management, Checkin, operator, Register, DailyReport (Live/History/Export), Report (ครบทั้ง 10 แท็บ — รายวัน/รายพนักงาน/Log จุดงาน/สรุปช่วงเวลา/4M + สิทธิ์อนุมัติ SV/Skill Matrix/ค่าฝีมือ/ใบบันทึก/Multi-Skill Form/จองรถ OT — 2026-07-10), ShiftOrganize (ตารางกะ/override/merge event/dropdown ใน modal — 2026-07-10), OEEAnalytics, LineSetup, EventLog, Improvements, Dashboard, MachineDatabase (2026-07-12 — user ยืนยัน: Dashboard/MachineDatabase ก็กรอง ใครไม่มี scope เห็นหมดเหมือนเดิม) — pattern: mandatory scope filter ก่อน แล้วค่อย apply free-text filter ทับ
- หน้าใหม่ที่ query ข้อมูลตาม line/section **ต้องเพิ่ม scope filter แบบเดียวกัน** ไม่งั้นเห็นข้อมูลข้ามส่วนงานโดยไม่ตั้งใจ
- Rollback: `docs/ROLLBACK_MULTI_SECTION_SCOPE.md` — **ห้าม drop คอลัมน์ `sections` ก่อน revert โค้ด** (App.jsx select คอลัมน์นี้ตอน login ถ้า drop ก่อนจะ login ไม่ได้ทั้งระบบ)

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
- การปรับ stock ที่กรอกมือ (type adjust) เข้าคิว ⏳ รออนุมัติก่อนมีผลต่อยอด — auto movement ไม่เข้าคิว
- แจ้งเตือน Telegram ผ่าน framework `notification_rules` category `logistic`:
  `edi_import`, `shipping_shipped`, `shipping_overdue`, `shipping_phase_alert`

---

## Daily Report — ออเดอร์ manual สำหรับไลน์ไม่มี kanban card (2026-07-12)

ไลน์บางไลน์ (เช่น HDF1 ที่ส่งงานต่อ LASER CUT 123) **ไม่มีเลข SAP order ให้สแกน** เปิด-ปิดใบแบบปกติไม่ได้:

- ปุ่ม "✍️ เปิดเป้า (ไม่มีบาร์โค้ด)" ข้างปุ่ม Scan เปิด Order — leader ตั้งเป้า (เลือกสินค้า + จำนวน) → สร้าง `prod_orders` ที่ `is_manual=true`, `prod_no='MANUAL-HHmmss'`, `qty_target`=เป้า, `qty`=เป้า (ใช้กับ capacity check/บอร์ดเหมือนใบปกติ)
- พนักงาน**อัพเดทยอดสะสม (`qty_actual`) ทุกช่วงเบรคตาม break policy** จากช่องบนการ์ดใบ — เห็นยอดจริงทุก ~2 ชม. · `qty_updated_at` เก็บเวลาล่าสุด ใบที่ไม่อัพเดท > 2.5 ชม. ขึ้นเตือนเหลือง (นิ่ง — ตาม Andon เหลืองไม่กระพริบ)
- ปิดใบด้วยปุ่ม "✓ ปิดใบนี้ (ยอดจริง)" (ไม่ต้องสแกน) → `status=confirmed`, **`qty` และ `qty_ok` ถูกแทนด้วยยอดจริง** เพื่อให้ OEE/รายงาน/stock trigger (`coalesce(qty_ok, qty)`) นับจากของที่ผลิตได้จริง — เป้าเดิมยังอยู่ที่ `qty_target`
- ใบ manual ที่ค้างเปิดตอนปิดกะ เข้า flow ยกยอด/กรอก actual ของ modal ปิดกะเหมือนใบปกติ
- migration: `20260712_prod_orders_manual_mode.sql` (DR, additive — ใบสแกนปกติไม่กระทบ)

---

## Improvements — โปรเจคปรับปรุง Kaizen (2026-07-12)

หน้า `/improvements` (กลุ่มฝ่ายผลิต) — บันทึกโปรเจคปรับปรุงผูกกับปัญหาจริง แล้ว**เทียบผลก่อน/หลังจากข้อมูลที่เกิดจริงอัตโนมัติ** ไม่ต้องกรอกผลเอง

- ตาราง `improvements` อยู่ **DR project** (anon-open ตาม convention) + bucket `improvement-images` (cap 5MB, รูปบีบ 1280px q0.85 ก่อนอัปโหลด, เปลี่ยน/ลบแล้วลบไฟล์เก่าเสมอ) — migration: `20260712_improvements_module.sql` (DR) + `20260712_improvements_page_permissions.sql` (Main)
- จุดยึดโปรเจค: `line_name` + `problem_source` (downtime/defect) + `problem_type_id` (→ `dr_downtime_types`/`dr_defect_types`) + optional `machine_no`/`mat_no` + `start_date` (วันเริ่มแก้) + `baseline_days` (หน้าต่างเทียบ 14/30/60/90 วัน)
- **สูตรเทียบผล:** ก่อน = [start−baseline, start) · หลัง = [start, min(วันนี้, start+baseline)] — ดึง `downtime_logs.duration_min` หรือ `defect_logs.qty_ng` ผ่าน session ของไลน์ แล้วหารด้วย**จำนวนวันที่มีการผลิตจริง** (นับจาก `production_sessions`) ไม่ใช่วันปฏิทิน — แสดง % ลด/เพิ่ม + แถบเทียบ ก่อน(แดง)/หลัง(เขียว)
- ตอนสร้างมี**พาเรโต้ Top 10** ของไลน์ (ตามหน้าต่างเดียวกัน) คลิกเลือกปัญหา → prefill เป้าโปรเจค + ตั้งชื่อให้อัตโนมัติ
- สถานะ: `monitoring` (เหลือง นิ่ง) → `done` (เขียว พร้อม result_note) / `cancelled` — snapshot ชื่อปัญหาไว้ใน `problem_label` กัน master ถูกลบ
- สิทธิ์: ทุก role เข้าดูได้ · สร้าง/แก้/ลบ/เปลี่ยนสถานะ = `can('improvements','manage')` (seed: admin/manager/supervisor/leader)
- Scope: leader เห็นเฉพาะ family ไลน์ตัวเอง · role อื่นกรองตาม `sections` (pattern มาตรฐาน)

---

## Morning Meeting — ประชุมแถวเช้า (2026-07-13)

หน้า `/morning-meeting` (กลุ่มฝ่ายผลิต) — บอร์ดประชุมทบทวนเช้าก่อนเริ่มงาน **ข้อมูลดึงอัตโนมัติทั้งหมด ไม่ต้องทำสไลด์** วาระ: ภาพรวมเมื่อวาน (ผลิตจริง/เป้า, OEE, DT, NG, เข้างาน) → งานหลุดแผน+สาเหตุ → Top Downtime/ของเสีย → 4M → ความพร้อมเช้านี้ → Action items

- **วันที่ default = วันงานล่าสุดที่จบ:** ก่อน 08:00 ใช้ `getWorkDate()` ตรงๆ (ยังเป็นเมื่อวาน) · หลัง 08:00 ถอย 1 วัน — ห้ามใช้ getWorkDate()-1 เสมอ (ช่วงประชุม 07:30-08:00 จะกลายเป็น 2 วันก่อน)
- **แหล่งข้อมูล:** DR = production_sessions/prod_orders/downtime_logs/defect_logs · Main = four_m_logs/daily_production_logs · เป้าใบงาน = `qty_target ?? qty`, ยอดจริง = `qty_ok ?? qty_actual` · **เป้ากะ = `target_qty` → รวมเป้าใบงานของกะ → std_day/night_shift** (เป้า 0 = แสดง "ไม่มีเป้า" ห้ามโชว์ 0% แดง) · ยอดจริงกะ = `qty_ok` → `actual_qty` → รวมจากใบงาน
- **เช็คชื่อ:** `daily_production_logs.assigned_line` เก็บ **id จุดงาน ไม่ใช่ชื่อไลน์** — หาไลน์ของคนต้อง join `employees.line_id` (เคยพลาด query ตรงแล้วได้ 0/0)
- **Downtime KPI = ผลรวมนาทีทุกรายการทุกเครื่องทุกไลน์ (เวลาซ้อนกันได้ เกิน 24 ชม./วันได้)** — ต้อง label ให้ชัดเสมอว่าไม่ใช่เวลาที่โรงงานหยุดจริง · Top Downtime/ของเสีย แสดง note ของพนักงาน (description) ใต้แต่ละประเภท — สำคัญกับประเภท "อื่นๆ"
- **กฎบังคับ (DailyReport):** บันทึก Downtime/งานเสียประเภทชื่อมี "อื่น" ต้องกรอกรายละเอียด (description) เสมอ ไม่งั้นบันทึกไม่ผ่าน — ไม่งั้นรายงาน/ประชุมเช้าอ่านไม่รู้เรื่อง (2026-07-13)
- **สาเหตุงานหลุดแผน (อัตโนมัติ):** chip จาก downtime กะเดียวกัน (top ตามนาที), NG ของใบ, คนขาดของไลน์, 4M ค้างอนุมัติ, ใบยกยอด/ยังไม่ปิด — ปุ่ม "➕ Action" prefill เป็น action item (`ref_kind`/`ref_id` ผูกที่มา)
- **Action items:** ตาราง `meeting_action_items` (Main — migration `20260713_morning_meeting.sql`) · รายการ open/doing จากวันก่อนโผล่ทุกประชุมพร้อมป้าย ⏮ จนกว่าจะปิด · เขียนได้เมื่อ `can('morning_meeting','record')` (seed: admin/manager/supervisor/leader)
- **ความพร้อมเช้านี้:** เครื่องซ่อมค้างตอนนี้ (open DT จากกะ 3 วันล่าสุด — แดงกระพริบตาม Andon), 4M ค้างอนุมัติ (เหลืองนิ่ง)
- **โหมดประชุม (📺):** full-screen ไล่วาระทีละสไลด์ (◀ ▶ / Esc) เนื้อหา component เดิม + `zoom: 1.3` สำหรับจอ TV · 🖨️ พิมพ์สรุป (pattern window.open + print เหมือน Report) · 📤 ส่งสรุป Telegram (event `morning_meeting`)
- **Scope:** leader = family ไลน์ตัวเอง (branch มาก่อน) · role อื่นตาม `sections` — pattern มาตรฐาน

---

## Edge Functions

### `send-notification`
- **Endpoint:** `POST /functions/v1/send-notification`
- **Payload:** `{ event: "status_change", log: { ...four_m_log } }`
- **Events อื่น:** `checkin_summary`, `prod_close`, `downtime`, `downtime_recovered`, `morning_meeting`
  - `morning_meeting` — สรุปประชุมแถวเช้าจากหน้า `/morning-meeting` (payload `{ event, summary: {...} }` — ผลิตรวม/เป้า, OEE, DT, NG, งานหลุดแผน, action ค้าง) · rule/template แก้ได้จากหน้าตั้งค่าการแจ้งเตือน (deploy v30 2026-07-13)
  - `downtime` — แจ้ง Telegram ทันทีที่พนักงานบันทึก Downtime ใหม่จากหน้า Daily Report (payload `{ event: "downtime", downtime: {...} }`) — คู่กับ alarm กระพริบแดงที่จุดเครื่องจักรบน Dashboard/Management (helper: `src/utils/downtimeAlarm.js` — alarm เฉพาะเมื่อ downtime ยังไม่ปิดรายการ ปิดรายการแล้วดับทันที)
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
- **เปลี่ยน/ลบรูปแล้วต้องลบไฟล์เก่าจาก storage เสมอ** (ลบ**หลัง** DB update สำเร็จเท่านั้น + best-effort ห้ามทำ flow หลักพัง) — ทำแล้วใน: operator.jsx (รูปพนักงาน), LineSetup.jsx (ผังไลน์ ทั้งตอนเปลี่ยนผังและตอนลบไลน์ — เฉพาะผังของตัวเอง **ห้ามลบผังที่ยืมแสดงจากไลน์แม่**), ProductMaster.jsx (dr_products + parts_master ทั้งตอนเปลี่ยนรูปและตอนลบสินค้า — มี guard ไม่ลบรูปที่สินค้า/พาร์ทอื่นแชร์ URL เดียวกัน), QAInspectionSetup.jsx (replace/delete drawing + ลบทั้งโฟลเดอร์ตอนลบ part), PMSetup.jsx (ลบ jig = ลบรูปทั้งชุด frame-*/cp-*), SignatureModal.jsx (ลายเซ็นเก่า — เฉพาะโฟลเดอร์ user ตัวเอง), Management.jsx (รูปหลักฐาน OJT แนบทับ = ลบรูปเดิม), MtnMachineLayout.jsx (รูปโซน facility), Improvements.jsx (รูป before/after ทั้งตอนเปลี่ยนและตอนลบโปรเจค) · หน้าใหม่ที่มีการเปลี่ยนรูปต้องทำแบบเดียวกัน ไม่งั้นไฟล์กำพร้าสะสม (เคยค้าง 117 ไฟล์ / 100MB เพราะอัปโหลดชื่อใหม่ `emp_<timestamp>` โดยไม่ลบของเดิม)
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
│                      #   InternalTimeBoard, SignatureModal, TaxonomyManagerModal, ChangePasswordModal
├── utils/             # กฎ/สูตรกลาง — permissions.js (can/canAccessPage), sectionScope.js,
│                      #   markerScale.js, timeFrame.js, downtimeAlarm.js, personAlarm.js,
│                      #   lineHierarchy.js, companyCalendar.js, otPeriods.js, dateFormat.js, useImgBox.js
├── lib/               # logic เฉพาะโดเมน (pmNotify, pmDailyAlarm, pmExportPDF/Excel, changePointChecklist)
└── pages/             # ~33 หน้า — ชื่อไฟล์ตรงกับ route (⚠️ operator.jsx ตัวพิมพ์เล็ก)

supabase/
├── migrations/        # ทุกการเปลี่ยน schema ต้องมีไฟล์ที่นี่ (ดู docs/sql/00_schema_snapshot_*.sql = โครงตารางทั้งหมด)
└── functions/         # 7 ตัว: send-notification, send-cqi15-notification, daily-4m-summary,
                       #   create-user (deploy แล้วแต่ซอร์สอยู่บน dashboard), pm-daily-scan,
                       #   pm-plan-reminder, shipping-phase-scan, cleanup-orphan-photos

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
