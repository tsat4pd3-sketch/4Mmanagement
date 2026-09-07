# ESM — Enterprise Shopfloor Management · Project Knowledge Base

ระบบบริหารจัดการโรงงานครบวงจร สำหรับ **Thai Summit Group**  
ครอบคลุม 4M Change Management, CQI-15 Welding Event Log, การเช็คชื่อ-PPE รายวัน, Daily Production Report, Employee Skills Matrix, Shift Management และ Approval Workflow

> ชื่อเดิม: 4M Management System (ยกระดับเป็น Enterprise Shopfloor Management)

---

## ⚠️ กฎการทำงานทุก session — เช็คกฎก่อน, แก้แล้วอัพเดทกฎ (คำสั่งถาวรจาก user 2026-07-09)

**ก่อนลงมือทำงานใดๆ:**
0. **อ่าน `docs/ENGINEERING-PRINCIPLES.md`** — หลักการแก้ไข/ต่อยอดอย่างยั่งยืน (คิดเผื่ออนาคต ไม่แก้ฉาบฉวย): single source of truth · data-driven ก่อน hardcode · backward-compatible migration · ห้ามล้มเหลวเงียบ · blast radius + rollback · checklist ก่อน commit/merge — **ใช้กับทุกงานไม่ว่าเล็กหรือใหญ่**
1. อ่านไฟล์นี้ (CLAUDE.md — ฉบับย่อ ~95 KB) ให้จบก่อนเสมอ — โดยเฉพาะกฎเหล็ก supabaseDR, Date/Time utilities, Workflow Discipline
   - **⚠️ ความรู้เชิงลึกของแต่ละโมดูลอยู่ใน `docs/modules/<module>.md`** (ดัชนี `docs/modules/README.md`) — เปิดอ่าน**เฉพาะโมดูลที่งานนี้แตะ** ห้าม cat ทั้งโฟลเดอร์
   - **ห้ามใช้ `@docs/...` import ใน CLAUDE.md** — `@` ทำให้ Claude Code โหลดไฟล์นั้นเป็น memory ทุก session (ต้นเหตุ context เต็ม 550k tokens ก่อน 2026-09-03) ให้อ้างด้วย path ธรรมดาเท่านั้น
2. ถ้างานแตะ UI → **ต้องอ่าน `docs/UI-CONVENTIONS.md` ก่อน** และทำตามอย่างเคร่งครัด (marker วงกลม+MK+clamp, Andon, ฟอนต์ขั้นต่ำ 11-12px, can() ฯลฯ)
   - **หน้าใหม่/แก้หัวหน้าเพจ → ต้องใช้ `PageHeader` + `useTabParam` ห้ามวาดหัวเรื่อง/แถบแท็บเอง** (UI-CONVENTIONS §6.8)
3. ถ้า convention ขัดกับสิ่งที่กำลังจะทำ → ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยนชัดเจน
4. มีหลาย session ทำงานขนานกัน — `git pull origin main` ก่อนเริ่ม และเช็คว่างานที่จะทำ session อื่นทำไปแล้วหรือยัง
5. **⭐ เป้าโปรเจค = prototype Smart Factory ที่ข้อมูลทุกอย่าง linkage กันสมบูรณ์ (คำสั่งถาวรจาก user 2026-08-17):** ระบบนี้จะถูกขยายผลทุกส่วนงาน/ทุกโรงงานในกลุ่ม — **ห้ามปัดฟีเจอร์เชื่อมโยงข้ามโมดูลด้วยเหตุผล "ข้อมูลยังมีน้อย/ไม่คุ้ม"** · ให้ทำบน**พาร์ทต้นแบบ 1-2 ตัวให้เห็นภาพเต็ม** (golden thread ปัจจุบัน: สาย 060/061 — PFC/FMEA/CP ครบ + ชั้น OP + BOM + orders ทุกสถานี) แล้ว scale ตามข้อมูลที่ทยอยเข้า — ความลึกของ linkage บนตัวอย่าง สำคัญกว่ารอ coverage ครบ

**หลังแก้/เพิ่มอะไรก็ตาม — อัพเดทกฎในคอมมิทเดียวกัน:**
- สร้าง/เปลี่ยน pattern ที่ใช้ร่วมกันหลายหน้า → อัพเดท `docs/UI-CONVENTIONS.md` (พร้อมวันที่)
- เปลี่ยน schema / ตาราง / Edge Function / workflow / กฎธุรกิจ → อัพเดท **`docs/modules/<module>.md` ของโมดูลนั้น** (พร้อมวันที่) · CLAUDE.md แก้เฉพาะเมื่อกระทบ*ทุก* session (กฎเหล็กข้ามโมดูล, Supabase project, workflow)
- **📏 เพดาน CLAUDE.md = 120 KB (~45k tokens) — อยู่ในด่าน `npm run build` แล้ว (2026-09-03)**
  `npm run check:context` (= `scripts/check-claude-md-size.mjs`) รันเป็น**ขั้นแรก**ของ build → **ไม่ผ่าน = build ล่ม = deploy ไม่ออก**
  ตรวจ 3 ช่องทางที่ทำให้ context บวม (ครบทุกทางที่ Claude Code ดูดไฟล์เข้า memory เอง):
  1. **ขนาด CLAUDE.md > 120 KB** → ย้ายรายละเอียดโมดูล/ประวัติไป `docs/modules/`
  2. **`@path` import** ← **ต้นเหตุจริงของ 550k tokens** ไม่ใช่ขนาดไฟล์ · `@` ดูดไฟล์ปลายทางเข้า memory ทุก session ต่อให้ CLAUDE.md เล็กก็บวมได้ — อ้างด้วย path ธรรมดาเสมอ
  3. **CLAUDE.md ซ้อนในโฟลเดอร์ย่อย** (Claude Code โหลดเพิ่มเองเมื่อทำงานในโฟลเดอร์นั้น)
  · **ห้ามถอดออกจาก build เพื่อให้ deploy ผ่าน** — แก้ที่เอกสารแทน (บทเรียนเดียวกับเทสที่เคยเขียนไว้แล้วไม่มี script ไหนรัน จนต้องเอาเข้าด่าน 2026-08-24)
- **ประวัติการแก้ / ผลรันจริง / ตัวเลข runtime / feedback ที่ตัดสินใจไปแล้ว → เขียนสั้นๆ ในไฟล์โมดูล ไม่ใส่ CLAUDE.md** (CLAUDE.md = กฎปัจจุบัน ไม่ใช่ changelog)
- เจอกับดัก/บั๊กที่คนถัดไปน่าจะเจอซ้ำ → บันทึกไว้ในไฟล์โมดูลที่เกี่ยวข้อง (ถ้าข้ามโมดูล เช่น "กับดัก CSS" ค่อยไว้ใน CLAUDE.md)
- เปลี่ยน DB schema → เขียน migration file ใน `supabase/migrations/` เสมอ
- **⚠️ เวลาบอก user ให้รัน migration ต้อง "วาง SQL เต็มๆ ในแชท" เสมอ ห้ามบอกแค่ชื่อไฟล์ (คำสั่งถาวรจาก user 2026-08-21)** — user รันผ่าน Supabase SQL Editor บนเว็บ **เปิดไฟล์ในรีโปไม่ได้** · เคยเกิดจริง: บอกชื่อไฟล์ไป user ก๊อป *path* ไปวางใน SQL Editor แล้วได้ `42601 syntax error at or near "supabase"` · ต้องระบุ **project ปลายทาง (Main/DR) กำกับทุกครั้ง** ด้วย (ตาราง 2 ฝั่งชื่อคล้ายกัน รันผิดฝั่งได้ง่าย) · แนบคิวรีเช็คผลหลังรันไปด้วยจะดีที่สุด
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
| Main — ชื่อในจอ Supabase **"MAIN"** | `ewhdfqwfwofivojtsizn` | auth, profiles, employees, production_lines, four_m_logs, cqi15_event_logs, role_permissions ฯลฯ | `supabase` (`src/supabaseClient.js`) |
| DR (Daily Report/PM) — ชื่อในจอ Supabase **"Product DB"** | `eyhclzkifitbhbljgoav` | production_sessions, downtime_logs, defect_logs, machines, prod_orders, dr_products, improvements ฯลฯ | `supabaseDR` (`src/supabaseClient.js`) |

> ⚠️ **ชื่อในจอ Supabase ไม่ตรงกับชื่อที่เอกสารเรียก** — dropdown หัวจอ SQL Editor เขียน "MAIN" / "Product DB" (org TSAT4-ENTERPRISE) · เคยเกิดจริง 2026-09-07: คิวรีเช็ค NPI (ตาราง Main) ถูกรันบน "Product DB" แล้วขึ้น `42P01 relation does not exist` ทั้งที่ migration ลง MAIN สำเร็จแล้ว → เวลาบอก user ให้รัน SQL ระบุ**ทั้งชื่อในจอและ project id** ทุกครั้ง
>
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
| `profiles` | User roles + scope · **⚠️ ไม่มีคอลัมน์ `email`** (อีเมล login อยู่ที่ `auth.users` เท่านั้น — เอกสารเคยเขียนผิดว่ามี จนเป็นต้นเหตุให้ `fn_audit` อ่าน `coalesce(full_name, email)` แล้วพังเงียบ ไม่บันทึกผู้แก้เลยทั้งระบบ ดูหัวข้อ Traceability) · **ระบบไม่มีการส่งอีเมล** — `notify_email` เป็นคอลัมน์ที่ไม่เคยถูกใช้ส่งอะไร (ช่องกรอกใน `/add-user` ถอดออกแล้ว 2026-08-17) | id, role, **position** (ตำแหน่งจริง — แสดงผลเท่านั้น), full_name, line_id, section, sections[], **mtn_teams[]** (ทีมช่างซ่อมที่สังกัด — แยกคิวใบแจ้งซ่อม MO · แยกจาก sections ที่คุม scope ผลิต · ตั้งที่ /add-user เฉพาะ role งานซ่อม · migration `20260722_profiles_mtn_teams.sql` · 2026-07-22), notify_email, signature_url, avatar_url (รูปโปรไฟล์ user — 2026-07-14) |
| `role_permissions` | สิทธิ์เข้าหน้า/action ตาม role (data-driven) | role, permission_key, allowed |

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

สิทธิ์เข้าถึงแต่ละหน้า ไม่ได้ hardcode ในโค้ดอีกต่อไป — อ่านจากตาราง `role_permissions` ผ่าน `src/utils/permissions.js` (`canAccessPage`) ปรับได้จากหน้า `/permissions` (admin เท่านั้น) คอลัมน์ "Role" ด้านล่างคือ default…
> 📄 รายละเอียดเต็ม → `docs/modules/pages-routes.md` (3 หัวข้อย่อย)

---

## 🔗 สายธารความต้องการ (Demand Flow) — `/flow-tower` (audit + หน้าจริง · 2026-08-19)

โจทย์จาก user: ไล่ audit การส่งต่อ "ความต้องการ" ตั้งแต่ Sales → Warehouse → Production FG → WIP →
> 📄 รายละเอียดเต็ม → `docs/modules/demand-flow-tower.md` (11 หัวข้อย่อย)

---

## Organizational Hierarchy (Thai Summit Group)

ลำดับชั้นองค์กรที่สอดคล้องกันทั้งระบบ — ห้ามเพิ่มฟีเจอร์ที่ขัดกับลำดับชั้นนี้
> 📄 รายละเอียดเต็ม → `docs/modules/org-hierarchy.md` (2 หัวข้อย่อย)

---

## Role System

role = "ชุดสิทธิ์ใช้ระบบ" ไม่ใช่ตำแหน่งงาน (2026-07-10) — ตำแหน่งจริงในโรงงาน
> 📄 รายละเอียดเต็ม → `docs/modules/role-system.md` (4 หัวข้อย่อย)

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
> **เคยเกิดจริง:** ตัวสร้าง 4M Man อัตโนมัติยิง 392 ใบใน 10 วัน (พ.ค. 2026) แล้ว **323 ใบค้างคิว 2 เดือนครึ่ง กลบใบจริง 19 ใบ**
> จนหัวหน้ามองไม่เห็นงานที่ต้องทำ · ล้างแล้ว (`20260810_void_stale_auto_4m_man.sql`) — **รายละเอียดเหตุการณ์ → `docs/modules/four-m-workflow.md`**
> **กฎที่ตกผลึก:**
> - **ตัวสร้าง 4M อัตโนมัติต้องมีเพดาน/ตัวนับ + จุดเฝ้าดู** — ยิงวันละหลายสิบใบต่อเนื่องเป็นสัปดาห์โดยไม่มีใครรู้ = บั๊กที่มองไม่เห็น · ก่อน insert อัตโนมัติ ให้เช็คว่ามีใบซ้ำของ (คน+จุดงาน+ไลน์) อยู่แล้วหรือยัง
> - **แยกใบที่ระบบสร้างออกจากใบที่คนกรอกให้เห็นในคิว** (คิวปนกันแล้วคนไม่กล้าเคลียร์ทั้งก้อน สุดท้ายค้างทั้งคู่) — ปัจจุบันแยกได้แค่ `created_by is null` + ข้อความ `[Auto]` ยังไม่มีคอลัมน์บอกที่มาจริงจัง
> - **เคลียร์คิวค้างจากบั๊ก = `rejected` + เหตุผลที่อ่านรู้เรื่อง ห้าม `delete` และห้าม `approved`** (approve = โกหกว่ามีคนพิจารณาแล้ว)
> - งานที่ค้างเกิน ~30 วันในคิวอนุมัติควรมีสัญญาณเตือน — ตอนนี้ยังไม่มี (ใบเก่าสุดที่เหลือ 81 วัน)

---

## Logistic — Planner & Sales / Delivery / Rundown Stock (2026-07-10..11)

โมดูลติดตามการส่งงานลูกค้า (ตารางทั้งหมดอยู่ DR project) — 3 หน้า:
> 📄 รายละเอียดเต็ม → `docs/modules/logistic-planner-sales.md` (3 หัวข้อย่อย)

---

## Kanban Auto-Calc — คำนวณ kanban จาก forecast (แท็บ 🎴 คำนวณ Kanban ใน /planner-sales · 2026-07-16..17)

Planner/Sale อัพโหลด forecast ลูกค้า → ระบบคำนวณจำนวน kanban ที่ใช้ในระบบดึงอัตโนมัติ · สูตรถอดจากไฟล์ Excel จริง (verify กับตัวอย่างที่คำนวณมือ) · helper กลาง `src/utils/kanbanCalc.js` (pure functions — `calcWithdrawalK…
> 📄 รายละเอียดเต็ม → `docs/modules/kanban-auto-calc.md`

---

## Daily Report — ออเดอร์ manual สำหรับไลน์ไม่มี kanban card (2026-07-12)

ไลน์บางไลน์ (เช่น HDF1 ที่ส่งงานต่อ LASER CUT 123) ไม่มีเลข SAP order ให้สแกน เปิด-ปิดใบแบบปกติไม่ได้:
> 📄 รายละเอียดเต็ม → `docs/modules/daily-report.md` (13 หัวข้อย่อย)

---

## QR / บาร์โค้ดอุปกรณ์ — สแกนเลือกเครื่อง/จิ๊ก/สินค้า (2026-08-03 · คำสั่ง user)

หน้างานเลือกอุปกรณ์จาก dropdown ยาวๆ ตอนใส่ถุงมือ/รีบ = ช้าและเลือกผิด → พิมพ์ป้าย QR ติดอุปกรณ์ แล้วสแกนเลือก
> 📄 รายละเอียดเต็ม → `docs/modules/qr-equipment-scan.md`

---

## กระบวนการผลิต (process types) — master data-driven (2026-07-23)

เลิก hardcode รายชื่อกระบวนการแล้ว (คำสั่ง user — ยืดหยุ่นกับโรงงานอื่น): ตาราง `process_types` (DR · migration `20260723_process_types_master.sql`): key (ค่าที่เก็บใน process_type ของตารางอื่น — สร้างแล้วห้ามแก้)/label/…
> 📄 รายละเอียดเต็ม → `docs/modules/process-types.md`

---

## Daily Report — ไลน์ผสมหลาย process (welding + metal forming ในไลน์เดียว · 2026-07-22)

dropdown ประเภท Downtime/งานเสีย ใช้ `sessionProcessTypesAll()` (union ทุก process ที่มีเครื่อง/สินค้าจริงในครอบครัวไลน์ — แม่+ลูกทั้งหมดผ่าน `getLineFamilyNames` ไม่ใช่ชื่อไลน์ตรงเป๊ะ: กะมักเปิดบนไลน์ลูก แต่เครื่องลงทะเ…
> 📄 รายละเอียดเต็ม → `docs/modules/daily-report-mixed-process.md`

---

## OEE (computeOEE ใน DailyReport) — กฎ P สำหรับหลาย MAT.NO (2026-07-14)

- ตรวจ parallel ระดับ "product" ไม่ใช่ระดับ MAT.NO — MAT ที่เป็น product เดียวกันแตกตามลูกค้า (ชื่อชิ้นงานเดียวกัน เช่น FVL/FTM/AAT) คืองานตัวเดียวกันแค่ส่งแยกลูกค้า ขึ้น parallel กันเองไม่ได้ ระบบรวมเป็นสายเดียวก่อน (จั…
> 📄 รายละเอียดเต็ม → `docs/modules/oee.md` (12 หัวข้อย่อย)

---

## Improvements — โปรเจคปรับปรุง Kaizen (2026-07-12)

หน้า `/improvements` (กลุ่มฝ่ายผลิต) — บันทึกโปรเจคปรับปรุงผูกกับปัญหาจริง แล้วเทียบผลก่อน/หลังจากข้อมูลที่เกิดจริงอัตโนมัติ ไม่ต้องกรอกผลเอง
> 📄 รายละเอียดเต็ม → `docs/modules/improvements-kaizen.md`

---

## Morning Meeting — ประชุมแถวเช้า (2026-07-13)

หน้า `/morning-meeting` (กลุ่มฝ่ายผลิต) — บอร์ดประชุมทบทวนเช้าก่อนเริ่มงาน ข้อมูลดึงอัตโนมัติทั้งหมด ไม่ต้องทำสไลด์ วาระ: ภาพรวมเมื่อวาน (ผลิตจริง/เป้า, OEE, DT, NG, เข้างาน) → งานหลุดแผน+สาเหตุ → Top Downtime/ของเสีย →…
> 📄 รายละเอียดเต็ม → `docs/modules/morning-meeting.md`

---

## Layer Process Audit — LPA paperless (2026-07-20)

หน้า `/lpa` (`LayerProcessAudit.jsx`, กลุ่มฝ่ายผลิต — ฝ่ายผลิตเป็นผู้ใช้งานหลัก ย้ายจากหมวด QA/QC ตามคำสั่ง user 2026-07-20) — แทนฟอร์มกระดาษ 2 ใบ: Layer Process Audit Plan (แผนตรวจรายเดือนต่อไลน์+กะ) + Layer Process Aud…
> 📄 รายละเอียดเต็ม → `docs/modules/lpa-audit.md`

---

## Scrap Report — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export · 2026-07-16)

หน้า `/scrap-report` (`ScrapReport.jsx`, กลุ่มฝ่ายผลิต — ฝ่ายผลิตเป็นผู้ใช้งานหลัก) — แทนฟอร์มกระดาษ "ใบรายงานของเสีย" ที่เขียนมือ · ลงยอด scrap ต่อ ไลน์/วัน แล้ว export Excel ตรงฟอร์ม 100% · ⚠️ `production_lines` อยู่ M…
> 📄 รายละเอียดเต็ม → `docs/modules/scrap-report.md`

---

## 📦 ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01 (paperless · 2026-08-24)

แท็บ 📦 ใบเบิกทดสอบ ใน `/qa` (`src/components/MaterialRequests.jsx`) — user ส่งใบกระดาษมา
> 📄 รายละเอียดเต็ม → `docs/modules/store-requisition-form.md`

---

## ใบรายงานปัญหาการผลิต + ถังเหลือง/ถังแดง (paperless · 2026-08-19 · feedback หน้างาน)

หัวหน้ากลุ่ม Assy2 แจ้งว่ายังเขียนมือทุกครั้ง 3 ใบ (ปัญหาการผลิต · ถังเหลือง · ถังแดง) ทั้งที่ข้อมูลอยู่ในระบบแล้ว → ทำเป็น export/paperless
> 📄 รายละเอียดเต็ม → `docs/modules/production-problem-report-bins.md` (2 หัวข้อย่อย)

---

## QA Inspection — setup → ใบตรวจ (ปิดช่องว่าง 2026-08-04)

สายงานคุณภาพแบ่งชัด 2 หน้า — อย่าเอาไปปนกัน:
> 📄 รายละเอียดเต็ม → `docs/modules/qa-inspection.md` (1 หัวข้อย่อย)

---

## 🦺 BBS — สังเกตพฤติกรรมความปลอดภัย (Behavior-Based Safety · paperless · 2026-08-21)

แท็บ 🦺 BBS ใน `/daily-checker` (`src/pages/BbsCheck.jsx`) — user ส่งฟอร์ม Excel มา
> 📄 รายละเอียดเต็ม → `docs/modules/bbs-safety.md`

---

## Factory Master Map — ผังรวมโรงงานผังเดียว (2026-07-16)

หน้า `/factory-map` (`FactoryMap.jsx`, กลุ่มฝ่ายผลิต) — รูปผังใหญ่ของทั้งโรงงาน 1 รูป แล้ววาด polygon (รูปทรงอิสระ) ล้อมพื้นที่แต่ละไลน์ ระบายสีตามสถานะการผลิตของไลน์นั้น — ดูทุกไลน์บนจอเดียว (เหมาะจอ TV)
> 📄 รายละเอียดเต็ม → `docs/modules/factory-master-map.md` (1 หัวข้อย่อย)

---

## Dashboard ส่วนงาน — 📋 `/dept-dashboard` (2026-08-06)

หน้าเดียวสลับส่วนงานด้วย `?dept=` — เฟส 1: ฝ่ายผลิต · ซ่อมบำรุง · สโตร์ · QA (ออกแบบเต็ม + ส่วนงานที่ยังไม่ทำ ดู `docs/DASHBOARD-DESIGN.md`)
> 📄 รายละเอียดเต็ม → `docs/modules/dept-dashboard-tv.md` (1 หัวข้อย่อย)

---

## Adoption Outlook — 🔮 ภาพเมื่อข้อมูลเชื่อมกันทั้งองค์กร (`/adoption-outlook` · 2026-08-13)

หน้า `AdoptionOutlook.jsx` (กลุ่มภาพรวม) — ตอบผู้บริหารว่า "เมื่อทุกแผนกใช้จริงและข้อมูลมองเห็นกันหมด เราจะมองเห็นมิติไหนได้บ้าง" (สอบกลับย้อนหลังถึงไหน · รู้ตัวก่อนคุณภาพหลุดไหม · เครื่องเบี่ยงเบนหรือยัง · กระทบการจัดส่…
> 📄 รายละเอียดเต็ม → `docs/modules/adoption-outlook.md`

---

## Group Overview — 🏢 ภาพรวมกลุ่มบริษัท TSG (MOCKUP หลายบริษัท · 2026-08-05)

หน้า `/group-overview` (`GroupOverview.jsx`, กลุ่มภาพรวม) — เป็นตัวอย่างหน้าจอ (mockup) ไม่ใช่ระบบ multi-company จริง สร้างตามคำสั่ง user เพื่อตอบผู้บริหารว่า "ระบบนี้ใช้กับหลายบริษัทในกลุ่ม + ดูภาพรวมข้ามบริษัทได้มั้ย"
> 📄 รายละเอียดเต็ม → `docs/modules/group-overview.md`

---

## Value Stream Mapping — `/vsm` (เฟส 1 · 2026-08-13)

หน้า VSM (`VSM.jsx`, กลุ่มวิเคราะห์ & รายงาน) — เลือกสินค้าสำเร็จรูป (mat เบอร์ 1) + เดือน แล้ว
> 📄 รายละเอียดเต็ม → `docs/modules/vsm.md`

---

## Production Plan — วางแผนการผลิต (Active Planner, 2026-07-15)

หน้า `/production-plan` (กลุ่มฝ่ายผลิต) — จากยอดลูกค้า (order รายวัน + forecast รายเดือน) เทียบ "กำลังผลิตที่ทำได้จริง" → บอกว่าต้องเปิดกี่กะ กี่วัน วันไหนเปิด OT/กะดึก/ทำวันหยุด วันไหนไม่ต้อง เพื่อทันดิว · เฟส 1 อ่านอย่…
> 📄 รายละเอียดเต็ม → `docs/modules/production-plan.md`

---

## Remote Control — จอตาม-มือถือคุม (2026-07-15)

แก้โจทย์จอที่ไม่มีเมาส์/คีย์บอร์ด/กล้อง (Smart TV, โปรเจคเตอร์, จอบอร์ดหน้าไลน์) — ใช้ได้ทุกหน้า ผ่าน Supabase Realtime broadcast (channel `esm-remote-<รหัส 6 หลัก>`) ไม่มีตาราง/เซิร์ฟเวอร์ใหม่:
> 📄 รายละเอียดเต็ม → `docs/modules/remote-control.md`

---

## MTN Work-Order — ใบแจ้งซ่อม MO 7 ขั้น (2026-07-14)

หน้า `/mtn-repair` (`MtnRepair.jsx`, กลุ่มการตรวจสอบและซ่อมบำรุง) — clone ระบบ AppSheet เดิม (Jig MTN) มาอยู่ใน ESM เพื่อไม่ต้องแยกระบบ + เก็บฐานข้อมูลเดียวกัน · ตารางทั้งหมดอยู่ DR project (anon-open ตาม convention)
> 📄 รายละเอียดเต็ม → `docs/modules/mtn-work-order.md`

---

## คลังอะไหล่ (Spare Part Master) — FM-JIG-009 + Rank ตาม WI-JIG-010 (2026-08-05)

แท็บ 🔩 คลังอะไหล่ ใน `/mtn-repair` (`src/components/SparePartMaster.jsx`) — ย้าย spare part list จากไฟล์ Excel เข้าระบบ: ค้นหาอะไหล่/ตำแหน่งชั้นวางได้เร็ว · ยอดคงเหลือตรงกับการเบิกจริงในใบ MO · จัด Rank A/B/C อัตโนมัติ ·…
> 📄 รายละเอียดเต็ม → `docs/modules/spare-part-master.md` (1 หัวข้อย่อย)

---

## DIE MAINTENANCE — Layout & สถานะแม่พิมพ์ (2026-08-19)

`/die-registry` เป็น 3 แท็บ: 📋 ทะเบียน (ของเดิม) · 🗺️ ผังจัดเก็บ (`src/components/DieLayout.jsx`) · 📊 สถานะ (`src/components/DieStatusBoard.jsx`) — ตอบ "แม่พิมพ์ตัวนี้อยู่ตรงไหน · สถานะอะไร" · migration `20260819_die_lay…
> 📄 รายละเอียดเต็ม → `docs/modules/die-maintenance.md`

---

## Fixture Shim Record — คุมความยั่งยืนของจิ๊ก (2026-09-01 · คำขอลูกค้า)

หน้า `/fixture` (`FixtureRegistry.jsx`) — ลูกค้าขอ ระบบบันทึกชิม (shim record) เพื่อคุม fixture sustainability
> 📄 รายละเอียดเต็ม → `docs/modules/fixture-shim-record.md`

---

## PM Predictive & Planner Sync — เห็นวัน PM ล่วงหน้า + buffer (2026-07-16)

หน้า `/pm-forecast` (🔧 PM ล่วงหน้า (Planner), กลุ่มการตรวจสอบและซ่อมบำรุง) — ให้ วางแผน/ผลิตเห็นวันที่จะต้อง PM ล่วงหน้า 1-2 สัปดาห์ + buffer ที่ต้องผลิตเผื่อ ก่อนเครื่องหยุดทำ PM
> 📄 รายละเอียดเต็ม → `docs/modules/pm-predictive-planner-sync.md`

---

## PM Coordination — แผนประสานงาน PM ข้ามวัน (MTN แจ้ง Production · 2026-07-23)

หน้า `/pm-coordination` (`PmCoordination.jsx`, กลุ่มการตรวจสอบและซ่อมบำรุง) — ทำ "ใบแจ้งแผน" แบบเมลที่ MTN ส่งประสานงาน (เช่น "RE: แผนการ Cleaning Cutting Head เครื่อง Laser LS-10") สำหรับงาน PM/แก้เครื่องที่กินหลายวัน +…
> 📄 รายละเอียดเต็ม → `docs/modules/pm-coordination.md`

---

## ตั้งค่าผัง/Floorplan — แยก display ออกจาก setup (2026-07-16)

หลักการ: หน้า display (ผังรวมโรงงาน/Dashboard) = ดู + popup เท่านั้น · การตั้งค่าผังทั้งหมดรวมที่ `/layout-setup` "🗺️ ตั้งค่าผัง/Floorplan" (หมวดตั้งค่าโปรแกรม) แยกแท็บตาม POV — เตรียมรับ Store/AMR ในอนาคต
> 📄 รายละเอียดเต็ม → `docs/modules/floorplan-setup.md` (1 หัวข้อย่อย)

---

## ผังรวมโรงงาน — ผังภาพรวมทั้งโรงงานที่เดียว (ยุบรวมแล้ว 2026-07-16)

> ⚫ **archived** — ผังรวมโรงงาน = `/factory-map` (FactoryMap) ที่เดียวเท่านั้น — polygon ต่อไลน์ + หลายโหมด (ยอดผลิต/OEE/Downtime/ของเสีย/คน/PM เครื่องจักร) ดู "Factory Master Map" ด้านบน
> 📄 รายละเอียดเต็ม → `docs/modules/_archived/factory-overview-merged.md`

---

## PM Photo-Compare Inspection — ❌ ถอดออกแล้ว (2026-07-22)

> ⚫ **archived** — ถอดระบบเทียบรูปเงา (photo-hunt / PhotoCompareModal) ออกทั้งหมด ตามคำสั่ง user: มันไม่ได้เทียบความเหมือนด้วย AI (แค่ wipe/blink/diff เงา) — ไม่คุ้ม · ใช้ฟีเจอร์ที่มีอยู่พอ = เห็นรูปมาตรฐาน + เห็นจุดที่ต้องเช็ค
> 📄 รายละเอียดเต็ม → `docs/modules/_archived/pm-photo-compare-removed.md`

---

## Employee Skills & EXP Farming (ย้ายฝั่ง server ทั้งหมด — 2026-07-13)

ระบบสะสม EXP ทักษะพนักงานจากการทำงานจริง — ห้ามเขียนคะแนน `employee_skills` จาก client นอกเหนือจาก
> 📄 รายละเอียดเต็ม → `docs/modules/employee-skills-exp.md` (4 หัวข้อย่อย)

---

## PE Core Tools — Process Flow / PFMEA / Control Plan (2026-08-13)

หน้า `/pe-docs` (`PEDocs.jsx`, หมวด คุณภาพ & วิศวกรรม ใน NAV_GROUP_ORDER — ยุบจากหมวด “วิศวกรรม (PE)” เดิม 2026-08-27) — โมดูลทีม Process Engineering ถอดโครงจากเอกสารจริง TSAT (PFC-P703-01 Rev.12 / FMEA-P703-01 Rev.33 (A…
> 📄 รายละเอียดเต็ม → `docs/modules/pe-core-tools.md`

---

## 🚀 NPI — พาร์ทใหม่ APQP / PPAP / Drawing Rev / ECI / Tooling Plan (`/npi` · 2026-09-07)

ต้นน้ำของ ESM: ติดตามพาร์ทรุ่นใหม่ตั้งแต่รับงานถึง SOP (คำสั่ง user "ให้ ESM ครอบคลุม E-SPT — ทำส่วนที่ไม่ยุ่งกับ supplier ก่อน") · หมวด คุณภาพ & วิศวกรรม
· **ตาราง `npi_*` 13 ตัวอยู่ Main project — ห้ามย้ายไป DR** (เฟส 4 จะเปิดให้ supplier ภายนอก login · DR anon-open = supplier เห็นข้อมูลผลิตทั้งโรงงาน)
· เฟส/รายการเอกสาร = **แม่แบบ data-driven ต่อลูกค้า** (APQP AIAG 5 เฟส + PPAP 18 elements · Toyota SPTT0-4) ห้าม hardcode · พาร์ทถือ snapshot + 🔄 sync เติมที่ขาด
· ไฟสี/สรุปคำนวณใน `src/utils/npi.js` เท่านั้น · ECI ปิดได้ต่อเมื่อผูกของจริงครบทุกขา (แบบ rev ใหม่ / `pe_change_requests` / ใบ 4M Method / แผน tooling — DB check)
· migration `20260907_npi_apqp_main.sql` (**apply แล้ว 2026-09-07**) · supplier portal = เฟส 4 ยังไม่ทำ
> 📄 รายละเอียดเต็ม → `docs/modules/npi-apqp.md` (9 หัวข้อย่อย)

---

## Traceability / Audit Log — ใครแก้อะไรเมื่อไหร่ (2026-07-24)

เดิมตาราง master ~90% track แค่ `created_at` → แก้ไขแล้วสืบไม่ได้ว่าใคร/เมื่อไหร่/ค่าเก่าอะไร (เจอจริง: `dr_products.line_name` ถูกเปลี่ยนไลน์ สืบไม่ได้) · ตาราง master/editable ใหม่ทุกตัวต้องผูก audit (เพิ่มชื่อตารางใน…
> 📄 รายละเอียดเต็ม → `docs/modules/traceability-audit-log.md`

---

## Workforce Insight — กำลังคน / เปลี่ยนจุดงาน / Turnover (`/workforce-insight` · 2026-09-02)

หน้า `WorkforceInsight.jsx` (กลุ่มพนักงาน & ทักษะ) — อ่านอย่างเดียว ไม่มี resource:action ใหม่ (ไม่มีปุ่มเขียนข้อมูล) · 3 แท็บจากคำขอ user เดียวกัน ("insight turn over + สรุปกำลังคนแต่ละวันเป็นกราฟ" + "สรุปการเปลี่ยนตำแห…
> 📄 รายละเอียดเต็ม → `docs/modules/workforce-insight.md` (3 หัวข้อย่อย)

---

## ประวัติผลิต by Product — `/product-history` (2026-07-24)

หน้า ProductHistory (กลุ่มวิเคราะห์ & รายงาน) — เลือกสินค้า (ค้นด้วย mat_no/ชื่อ/PN) → ดูย้อนหลังว่าเคยผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ + ประวัติการแก้ master data
> 📄 รายละเอียดเต็ม → `docs/modules/product-history.md` (2 หัวข้อย่อย)

---

## สอบกลับ Order — `/order-trace` (Order Traceability · 2026-07-30)

หน้า OrderTrace (กลุ่มวิเคราะห์ & รายงาน) — 2 แท็บ (`useTabParam`): `order` (จากเลขใบผลิต · default) / `symptom` (จากอาการที่แจ้ง) · สแกน/ค้น `prod_no` (บาร์โค้ด kanban) → เห็นทุกเหตุการณ์ของใบนั้น + สถานการณ์รอบข้าง ณ เ…
> 📄 รายละเอียดเต็ม → `docs/modules/order-trace.md` (2 หัวข้อย่อย)

---

## 💬 กล่องรับ Feedback จากหน้างาน (2026-08-14 · คำขอ user)

ปุ่ม "💬 แจ้งปัญหา / ข้อเสนอแนะ" ท้าย sidebar (ใต้เปลี่ยนรหัสผ่าน) → `src/components/FeedbackModal.jsx` (lazy chunk)
> 📄 รายละเอียดเต็ม → `docs/modules/feedback-inbox.md`

---

## Edge Functions

- Endpoint: `POST /functions/v1/send-notification`
> 📄 รายละเอียดเต็ม → `docs/modules/edge-functions.md` (3 หัวข้อย่อย)

---

## Storage & รูปภาพ (กติกาสำคัญ — 2026-07-09)

- อัปโหลดรูปทุกหน้าต้องผ่าน `ImageCropModal` — รูปนิ่งถูก crop + บีบเป็น JPEG 480px q0.85 (~100KB) อัตโนมัติ
> 📄 รายละเอียดเต็ม → `docs/modules/storage-images.md`

---

## File Structure

> รายชื่อไฟล์เต็มดูของจริงใน `src/` — ด้านล่างคือ "ไฟล์โครงสร้าง/ของกลาง" ที่ทุก session ควรรู้จัก
> (เลิกลิสต์ pages ทั้งหมดในเอกสาร — เคยลิสต์แล้วล้าสมัยตลอด · pages ปัจจุบัน ~33 ไฟล์ ดูตาราง Pages & Routes ข้างบน)

```
src/
├── App.jsx            # Router + Sidebar + UserContext + NAV_ITEMS (source of truth เมนู/หมวด)
│                      #   exports: UserContext, NAV_ITEMS, NAV_GROUP_ORDER, NAV_GROUP_META,
│                      #            navItemsForGroups, accessSummaryForRole, Sidebar
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
                       #   ENERGY_MONITORING_DESIGN.md (โมดูลพลังงาน — ทำแล้ว หน้า /energy) ·
                       #   VSM-DESIGN.md (Value Stream Mapping — เฟส 1 ทำแล้ว) ·
                       #   DASHBOARD-DESIGN.md (dashboard รายส่วนงาน) ·
                       #   NAVIGATION-REVIEW.md (รีวิวโครงเมนู/แท็บ — ทำครบ 5 เฟสแล้ว 2026-08-11 ดู §6) ·
                       #   PE-FORM-SPEC.md (สเปกฟอร์ม PE + แนวทาง export 100% — สัญญาระหว่างตัวนำเข้า/ส่งออก) ·
                       #   IATF16949-GAP-REVIEW.md (gap เทียบ IATF 16949 + ลำดับงานเสนอ — 📌 user สั่ง
                       #     "จำไว้ก่อน ยังไม่ทำ" 2026-08-14 · ห้ามหยิบไปลงมือเองจนกว่า user จะสั่ง) ·
                       #   CLOSED-LOOP-8D-PE.md (ลูปปิด 8D → PFMEA/PFC/CP + yokoten + ทะเบียนเคลม
                       #     + วัดประสิทธิผลจาก defect_logs — เฟส 1-4 ครบ 2026-08-18) ·
                       #   QC-FLOW-AUDIT-2026-08-25.md (audit multi-agent ทั้ง loop สายธารความต้องการ
                       #     45+3 findings + สถานะแก้ — ฝั่ง client เคลียร์แล้ว · ค้างฝั่ง DB/edge ดู §สถานะรวม)
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

### 🔴 กฎเหล็กการเขียน DB จาก client (ตกผลึกจาก full QC audit 2026-09-03..04 — คลาสบั๊กที่เจอซ้ำทุกรอบ)

1. **supabase-js ไม่ throw** — คืน `{ data, error }` เสมอ ⇒ `try { await supabase… } catch {}` = โค้ดตาย · `const { data } = await …` = กลืน error 100% (คิวรีล้มแล้วจอขึ้นเหมือน "ไม่มีข้อมูล") · **ทุก insert/update/delete ต้องอ่าน `error`** — helper กลาง `checkWrite(await …, 'ป้ายงาน')` ใน `src/utils/dbWrite.js` (toast แดง + คืน false · กวาดครบ 69 จุด 2026-09-07) · จุด delete-then-insert ต้องหยุดก่อน insert เมื่อ delete ล้ม
2. **RLS ปฏิเสธ UPDATE/DELETE = "สำเร็จ 0 แถว ไม่มี error"** (มีแต่ INSERT ที่โยน 42501) ⇒ ปุ่มที่ผลลัพธ์สำคัญต้อง `.select('id')` แล้ว**นับแถว** ห้ามขึ้น toast เขียวจาก `!error` อย่างเดียว
3. **policy RLS ต้อง `has_perm('<คีย์เดียวกับปุ่มบนจอ>')` ห้าม hardcode role array** — วัดจริง 04/09: 5 ตารางที่ hardcode admin/mgr/sv (`machine_points`·`machine_flow_links`·`wip_buffer_points`·`skill_sub_items`·`shift_merge_events`) แคบกว่าสิทธิ์ที่ `/permissions` แจก (dept_admin · sale/mtn/planner_store · document_control) → คนมีปุ่มแต่เขียนได้ 0 แถวเงียบ · และ `operator_special_tasks` **ไม่มี UPDATE policy เลย** → เปลี่ยนงานนอกไลน์ของคนเดิมพัง 42501 ทุก role (migration `20260904_rls_match_ui_permissions.sql`) · **ตารางใหม่ต้องมี policy ครบทั้ง 4 cmd ที่ client ใช้ — `upsert` ต้องมี UPDATE**
4. **stale-response race** — จอที่ยิงคิวรีตาม state (เลือกกะ/วัน/ไลน์) แล้ว user สลับก่อนคำตอบเก่ากลับมา ⇒ คำตอบเก่าเขียนทับจอใหม่ (เคยเกิด: Daily Report เขียนข้อมูลผิดกะ · รอบ 3) — ทุก effect ที่ await แล้ว set state ต้องมี guard (`let alive = true` + cleanup / เทียบ request id / เทียบ ref ปัจจุบัน) ก่อน set
5. **`.in(ids)` ยาว = URL เกินเพดาน proxy → คืนค่าว่างเงียบ** ⇒ ผ่าน `fetchByIds` (chunk) · **เพดาน 1000 แถว/คิวรี** ⇒ ตารางที่โตได้ห้าม `select()` เปล่า ต้อง filter/paginate
6. **claim สถานะ (compare-and-swap) ก่อนเขียน ledger ⇒ ledger ล้มต้องคืนสถานะ** (กฎเหล็ก 7 ใน `docs/modules/demand-flow-tower.md`)
7. **สมมติฐานเรื่องสิทธิ์ที่เขียนในคอมเมนต์ "มีอายุ"** — migration ทีหลังเปิดหน้าให้ role ใหม่ได้เสมอ ห้ามพึ่ง "หน้านี้ admin-only อยู่แล้ว" เป็นด่านของแผง/ตาราง (บทเรียน cost_center_rates · wip_buffer_points · line_setup)

### Skill Fit Scoring
```js
computeFit(employee, station)  // % ของทักษะที่ผ่าน min_score
fitColor(score)   // 80+ green | 60-79 amber | 40-59 orange | <40 red
```

---

## กฎการทำงานของทุก AI session (Workflow Discipline)

ลำดับที่ต้องทำทุกครั้ง ไม่ว่าจะแก้อะไร:
1. **เช็คกฎก่อนลงมือ** — อ่าน section ที่เกี่ยวข้องใน CLAUDE.md นี้ + `docs/modules/<module>.md` ของโมดูลที่แตะ + เอกสารเฉพาะทาง:
   - **ทุกงาน → `docs/ENGINEERING-PRINCIPLES.md`** (หลักการแก้แบบยั่งยืน + checklist ก่อน commit/merge)
   - แก้ UI → `docs/UI-CONVENTIONS.md` (บังคับ)
   - แตะสิทธิ์/role → `docs/PERMISSIONS-DESIGN.md`
   - แตะ DB → section "Supabase Projects" (2 projects!) + เขียน migration ลง `supabase/migrations/` เสมอ
2. **ทำงานให้สอดคล้องกับกฎ** — ถ้าสิ่งที่จะทำขัดกับ convention เดิม ให้ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยน (แล้วต้องไล่แก้ทุกจุดที่ใช้ pattern นั้นให้ตรงกัน)
3. **อัพเดทกฎหลังทำ** — งานที่สร้าง/เปลี่ยน pattern, schema, สิทธิ์, หรือ workflow ที่ session อื่นต้องรู้ → อัพเดทเอกสารที่เกี่ยวข้อง (`docs/modules/<module>.md` เป็นหลัก / UI-CONVENTIONS.md / PERMISSIONS-DESIGN.md / CLAUDE.md เฉพาะกฎข้าม session) **ในคอมมิทเดียวกัน** พร้อมวันที่
4. build ผ่าน (`npm run build`) ก่อน commit เสมอ · merge เข้า `main` = deploy จริง
   - **⚠️ `npm run build` = `check:context` → `lint:critical` → `npm test` → `vite build`** (เทสเข้าด่าน 2026-08-24 · ด่าน context 2026-09-03)
     ก่อนหน้านี้มีไฟล์เทส 9 ไฟล์ / 51 เคส ที่เอกสารอ้างว่า "ล็อกไว้แล้ว" แต่ **ไม่มี script ไหนรันมันเลย**
     → เทสที่เขียนไว้กันของพังไม่เคยถูกเรียกใช้จริงถ้าไม่มีคนพิมพ์คำสั่งเอง (พบตอน QC audit)
     · ตัวรัน = `scripts/run-tests.mjs` ไล่หา `src/**/__tests__/*.test.mjs` เอง — **วางไฟล์เทสใหม่ไว้ใน
     `__tests__/` ที่ไหนก็ได้ใต้ src/ แล้วมันถูกเก็บอัตโนมัติ ไม่ต้องแก้ script**
     · **ห้ามเปลี่ยนเป็น `node --test '<glob>'` ใน package.json** — node รองรับ glob ใน `--test` ตั้งแต่ v22
     แต่ Vite 8 รับ Node 20.19+ ได้ ถ้า Render ใช้ Node 20 อยู่จะ **deploy ล่มทั้งที่โค้ดไม่ผิด**
   - **`npm run build` มีด่าน lint กฎ crash ในตัวแล้ว (2026-07-24)** — `eslint.critical.config.js` เช็ค `no-undef` ฯลฯ เฉพาะกฎที่ทำแอปพังตอน runtime (bundler ไม่จับ — เคยเกิดจริง: ใช้ useMemo โดยไม่ import → Daily Report จอขาวทั้งโรงงาน) · lint ไม่ผ่าน = build ไม่ผ่าน ห้าม bypass (`vite build` ตรงๆ) เพื่อหนีด่าน — แก้โค้ดให้ผ่านแทน · **ห้ามเพิ่มกฎ style จุกจิกใน config นี้** (ทำให้คนอยาก bypass ด่านที่กันของพังจริง)
     - **⚠️ build ผ่าน ≠ หน้าไม่พัง — merge งานหลาย session ชนกันในไฟล์เดียว ให้รัน `node audit/crashsweep.mjs` เสมอ (2026-08-26)**
     เปิดทุกหน้าที่ 1500px + กดปุ่มบนหัวเพจทีละอัน แล้วเช็ค `window.__crash` (~3 นาที · ต้องเปิด vite audit ค้างไว้)
     · **เคสจริงวันเดียวกัน 2 เคส:** resolve conflict แล้วบรรทัด `else setSelSession(...)` หลุด → Daily Report
     เปิดมาจอหลักว่างทั้งหน้า · `/products` แท็บ Kanban Std พังจาก `undefined.toLocaleString()`
     — **ทั้งคู่ build ผ่าน lint ผ่าน เทสผ่าน**
     · mock มีแถว **`NULLISH`** (คอลัมน์ตัวเลข/ข้อความเป็น null) เป็นแถวสุดท้ายเสมอ **ห้ามถอด** —
     คอลัมน์ในฐานจริงส่วนใหญ่ nullable แถวเดียวที่ null ทำให้ทั้งหน้าพัง · เพิ่มคอลัมน์ nullable ใน `ROW()` ต้องเติมใน `NULLISH()` ด้วย
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

> 📄 **ประวัติผล audit ที่ตรวจ+แก้ไปแล้ว → `docs/modules/qc-audit-history.md`**
> (รอบเต็ม 2026-08-03/04 ครบ 7 หมวด · วิธี audit "migration ค้างไม่ได้ apply" ที่เชื่อถือได้ 2026-08-06)

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

### 📺 เพดานเบราว์เซอร์ที่ต้องรองรับ = **จอ TV ไม่ใช่ PC** (วัดกับบันเดิลจริง 2026-08-26)

จอที่ใช้จริงหน้างาน: **LG 43UR751C0SC · webOS 23 / 8.4.0 = Chromium 94** (user ยืนยัน "ส่วนใหญ่รุ่นนี้หรือใหม่กว่า")
· เทียบรุ่น: webOS 22 = Chromium 87 · webOS 23 = **94** · webOS 24 = 108 · webOS 25 = 120

**พื้นจริงของโค้ดตอนนี้ (grep จาก `dist/assets/` หลัง build):**

| ฟีเจอร์ | ต้องการ | อยู่ในชิ้นไหน | ผลถ้าไม่รองรับ |
|---|---|---|---|
| `??=` `\|\|=` `&&=` | Cr 85 | **ทุกชิ้นรวม `index-*.js`** | **จอขาว** (parse error ทั้งไฟล์) |
| `crypto.randomUUID` | Cr 92 | 5 หน้า (OjtTraining · PMSetup · QualityControl · ScrapReport · operator) | หน้านั้นพัง |
| `Object.hasOwn` | Cr 93 | Recharts (`CategoricalChart`/`Tooltip`) · exceljs · jspdf | **หน้าที่มีกราฟพัง** |
| `structuredClone` | Cr 98 | Recharts `Tooltip` — เฉพาะ branch `instanceof Error` | ไม่เกิดจริง (ข้อมูลกราฟไม่มี Error) |

⇒ **webOS 23 (Cr 94) ผ่านทุกหน้า** · webOS 22 (Cr 87) เปิดได้แต่**หน้าที่มีกราฟพัง** · เก่ากว่า webOS 22 = จอขาว

> #### ⚠️ กฎเหล็ก — ห้ามใช้ CSS ที่ต้องการ Chromium > 94 กับค่าที่ "พังแล้วมองเห็น"
> - **ห้ามใช้ `color-mix()` (Cr 111)** — ค่าที่ parse ไม่ได้ = **ทั้งบรรทัด declaration ถูกทิ้ง**
>   เคยหลุดจริง 1 จุด (`StoreMonitor` การ์ดผิดปกติ → พื้นโปร่งบนจอ TV) · แทนด้วย
>   `background: 'var(--card)'` + `backgroundImage: linear-gradient(${c}14, ${c}14)` (2 stop สีเดียว = เคลือบทับ ได้ผลเท่ากัน)
>   หรือ alpha-hex `${color}14` แบบที่ทั้งระบบใช้อยู่แล้ว
> - ตัวอื่นที่ห้ามเช่นกัน: `@container` (105) · CSS nesting (112) · `text-wrap:balance` (114) · หน่วย `dvh/svh/lvh` (108) · `:has()` **ในที่ที่พังแล้วเสียการใช้งาน**
> - **`:has()` ที่มีอยู่ (`index.css` touch target) ปล่อยไว้ได้** — เบราว์เซอร์เก่าทิ้งทั้ง **rule** (ไม่ใช่ทั้งไฟล์) = กลับไปพฤติกรรมเดิม ไม่พัง (มีคอมเมนต์กำกับแล้ว)
> - **ตรวจก่อน merge:** `grep -oF "color-mix(" dist/assets/*` ต้องได้ 0

### ⚠️ กับดัก CSS ที่เจอซ้ำหลายจุด — จำไว้

- **`color-scheme` ต้องประกาศคู่กับธีมเสมอ** (`:root { color-scheme: dark }` + `[data-theme="light"] { color-scheme: light }` — แก้แล้ว 2026-08-21 จาก feedback หน้างาน "Mode dark มองไม่เห็น"): ไอคอนปฏิทิน/นาฬิกาใน `input type=date/time` + ลูกศร select + popup ปฏิทิน เป็นของ browser วาดเอง ไม่ประกาศ = browser ถือว่าหน้าเป็น light → วาดไอคอน**สีดำ**ทับพื้นเขียวเข้ม มองไม่เห็นทั้งระบบ (วัดจริง: โซนไอคอน 0 pixel สว่าง → 77 หลังแก้) · **ห้ามแก้รายจุดด้วย `filter: invert()` ที่ input ตัวใดตัวหนึ่ง** — ประกาศที่ธีมครอบทุก native control ทีเดียว

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

Platform:    Render.com (Static Site)
> 📄 รายละเอียดเต็ม → `docs/modules/deploy.md` (1 หัวข้อย่อย)

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

---

## 🔗 ลูปปิด 8D → PFMEA / PFC / Control Plan (2026-08-17 · คำสั่ง user)

ปิด 8D แล้ว ระบบย้อนกลับไปชี้เองว่าต้องแก้เอกสาร PE ตัวไหน บรรทัดไหน + ขยายผลข้ามพาร์ท (yokoten)
> 📄 รายละเอียดเต็ม → `docs/modules/closed-loop-8d-pfmea.md` (4 หัวข้อย่อย)

---
