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
| DR (Daily Report/PM) | `eyhclzkifitbhbljgoav` | production_sessions, downtime_logs, defect_logs, machines, prod_orders, dr_products ฯลฯ | `supabaseDR` (`src/supabaseClient.js`) |

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
| `profiles` | User roles + scope | id, email, role, full_name, line_id, section, notify_email, signature_url |
| `role_permissions` | สิทธิ์เข้าหน้า/action ตาม role (data-driven) | role, permission_key, allowed |

### การผลิตรายวัน
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `daily_production_logs` | เช็คชื่อ + PPE | work_date, employee_id, is_present, has_helmet, has_boots, has_gloves, assigned_line, shift, has_ot, has_extended_ot |
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

---

## Pages & Routes

> สิทธิ์เข้าถึงแต่ละหน้า **ไม่ได้ hardcode ในโค้ดอีกต่อไป** — อ่านจากตาราง `role_permissions` ผ่าน `src/utils/permissions.js` (`canAccessPage`) ปรับได้จากหน้า `/permissions` (admin เท่านั้น) คอลัมน์ "Role" ด้านล่างคือ default ตอน seed ไม่ใช่ source of truth

| Group (sidebar) | Route | Component | Role (seed default) |
|---|---|---|---|
| ภาพรวม | `/`, `/dashboard` | Dashboard | ทุก role |
| ฝ่ายผลิต | `/checkin` | Checkin | ทุก role |
| ฝ่ายผลิต | `/management` | Management | ทุก role |
| ฝ่ายผลิต | `/daily-report` | DailyReport | ทุก role |
| ฝ่ายผลิต | `/oee-analytics` | OEEAnalytics | ทุก role |
| ฝ่ายผลิต | `/daily-pm` | DailyPM | ทุก role |
| Logistic - Store | `/line-stock` | LineStock | ทุก role |
| Logistic - Store | `/heijunka` | HeijunkaKanban | ทุก role |
| Logistic - Store | `/rack-center` | RackCenter | ทุก role |
| Logistic - Store | `/planner-sales` | PlannerSales | manager/supervisor/leader/qa/sale |
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
- หน้าที่ปิดช่องโหว่แล้ว: Management, Checkin, operator, Register, DailyReport (Live/History/Export), Report (ครบทั้ง 10 แท็บ — รายวัน/รายพนักงาน/Log จุดงาน/สรุปช่วงเวลา/4M + สิทธิ์อนุมัติ SV/Skill Matrix/ค่าฝีมือ/ใบบันทึก/Multi-Skill Form/จองรถ OT — 2026-07-10), ShiftOrganize (ตารางกะ/override/merge event/dropdown ใน modal — 2026-07-10) — pattern: mandatory scope filter ก่อน แล้วค่อย apply free-text filter ทับ
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

## Edge Functions

### `send-notification`
- **Endpoint:** `POST /functions/v1/send-notification`
- **Payload:** `{ event: "status_change", log: { ...four_m_log } }`
- **Events อื่น:** `checkin_summary`, `prod_close`, `downtime`, `downtime_recovered`
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
| `daily-4m-summary` | Main | สรุป 4M รายวันส่ง Telegram (เวลา Bangkok) |
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
  - **ข้อยกเว้นที่ตั้งใจ (crop ไม่เหมาะ):** รูปที่ต้องเห็นทั้งใบ/คมชัด ให้**บีบก่อนอัปโหลดแทน** — รูป jig/checkpoint (PMSetup), รูปหลักฐาน 4M/QA/เอกสาร level-up (Management/Report/operator: helper `resizeImage` 1280px q0.85) · drawing ฝั่ง QA รับ PDF ด้วยจึงไม่บีบ (≤20MB) · **ห้ามอัปโหลดรูปดิบโดยไม่บีบเลย**
  - **รูปผัง/layout (LineSetup, MtnMachineLayout) บีบเบากว่ารูปอื่น: 2560px / 2.5MB / q0.9** (2026-07-10) — layout มีจำนวนน้อยทั้งระบบ (≤20 รูป) แต่ต้องซูมอ่านรายละเอียดผังได้ **ห้ามลดกลับไป 1600px/0.5MB** เคยบีบแรงจนเบลอใช้งานไม่ได้ (รูปเดิมที่เบลอไปแล้วต้องอัปโหลดต้นฉบับซ้ำ ระบบไม่มีต้นฉบับเก็บไว้)
- **GIF (รูปขยับ) ถูกส่งทั้งไฟล์โดยไม่แปลง** เพื่อคงการเคลื่อนไหว (วาดลง canvas จะเหลือเฟรมแรกเฟรมเดียว = การขยับหายเงียบๆ) — จำกัด ≤ 2MB **ทุกจุดที่รับ GIF** (ImageCropModal + LineSetup) **ห้ามถอด cap ออก** (GIF ไม่จำกัดขนาดเฉลี่ย ~4MB เคยกินครึ่ง bucket)
- **เปลี่ยน/ลบรูปแล้วต้องลบไฟล์เก่าจาก storage เสมอ** (ลบ**หลัง** DB update สำเร็จเท่านั้น + best-effort ห้ามทำ flow หลักพัง) — ทำแล้วใน: operator.jsx (รูปพนักงาน), LineSetup.jsx (ผังไลน์ — เฉพาะผังของตัวเอง **ห้ามลบผังที่ยืมแสดงจากไลน์แม่**), ProductMaster.jsx (dr_products + parts_master — มี guard ไม่ลบรูปที่สินค้า/พาร์ทอื่นแชร์ URL เดียวกัน), QAInspectionSetup.jsx (replace/delete drawing + ลบทั้งโฟลเดอร์ตอนลบ part), PMSetup.jsx (ลบ jig = ลบรูปทั้งชุด frame-*/cp-*), SignatureModal.jsx (ลายเซ็นเก่า — เฉพาะโฟลเดอร์ user ตัวเอง) · หน้าใหม่ที่มีการเปลี่ยนรูปต้องทำแบบเดียวกัน ไม่งั้นไฟล์กำพร้าสะสม (เคยค้าง 117 ไฟล์ / 100MB เพราะอัปโหลดชื่อใหม่ `emp_<timestamp>` โดยไม่ลบของเดิม)
- **Quota Free plan (ต่อ project):** DB 500MB · Storage 1GB · Egress 5GB/เดือน — ตรวจล่าสุด 2026-07-09: Main DB 22MB (~4%), DR DB 18MB (~4%), Storage หลัก ~156MB (~15%) → พนักงาน ≤300 คน + อัตราข้อมูลโตปัจจุบัน อยู่ได้อีกหลายปี ถ้าใกล้เต็มค่อยอัป Pro ($25/เดือน = DB 8GB + Storage 100GB) โดยไม่ต้องย้ายระบบ

---

## File Structure

```
src/
├── App.jsx                    # Router + Sidebar + Auth + UserContext
├── index.css                  # Theme CSS variables (dark/light)
├── supabaseClient.js          # Supabase init
├── components/
│   ├── Toast.jsx              # Global toast singleton
│   ├── SignatureModal.jsx     # วาด/อัปโหลดลายเซ็น
│   └── ChangePasswordModal.jsx
└── pages/
    ├── Dashboard.jsx
    ├── Management.jsx
    ├── Checkin.jsx
    ├── LineSetup.jsx
    ├── Register.jsx
    ├── Operator.jsx
    ├── Report.jsx
    ├── ShiftOrganize.jsx
    ├── AddUser.jsx
    └── Login.jsx

supabase/
└── functions/
    └── send-notification/
        └── index.ts           # Telegram + in-app notifications
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
