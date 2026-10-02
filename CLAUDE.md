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
- **📏 เพดาน CLAUDE.md = 120 KB (~45k tokens) — `npm run check:context` เป็น**ขั้นแรก**ของ build ⇒ ไม่ผ่าน = deploy ไม่ออก**
  ตรวจ 3 ช่องทางที่ทำให้ context บวม: (1) **ขนาดไฟล์** → ย้ายรายละเอียด/ประวัติไป `docs/modules/`
  (2) **`@path` import** ← ต้นเหตุจริงของ 550k tokens ไม่ใช่ขนาดไฟล์ (`@` ดูดไฟล์เข้า memory ทุก session) **อ้างด้วย path ธรรมดาเสมอ**
  (3) **CLAUDE.md ซ้อนในโฟลเดอร์ย่อย** · **ห้ามถอดด่านออกเพื่อให้ deploy ผ่าน — แก้ที่เอกสารแทน**
  · 📄 ผลการรีดไฟล์ + ของที่ย้ายไปไหน → `docs/modules/claude-md-slim.md`
- **ประวัติการแก้ / ผลรันจริง / ตัวเลข runtime / feedback ที่ตัดสินใจไปแล้ว → เขียนสั้นๆ ในไฟล์โมดูล ไม่ใส่ CLAUDE.md** (CLAUDE.md = กฎปัจจุบัน ไม่ใช่ changelog)
- เจอกับดัก/บั๊กที่คนถัดไปน่าจะเจอซ้ำ → บันทึกไว้ในไฟล์โมดูลที่เกี่ยวข้อง (ถ้าข้ามโมดูล เช่น "กับดัก CSS" ค่อยไว้ใน CLAUDE.md)
- เปลี่ยน DB schema → เขียน migration file ใน `supabase/migrations/` เสมอ
- **⚠️ เวลาบอก user ให้รัน migration ต้อง "วาง SQL เต็มๆ ในแชท" เสมอ ห้ามบอกแค่ชื่อไฟล์ (คำสั่งถาวรจาก user 2026-08-21)** — user รันผ่าน **Supabase SQL Editor บนเว็บ เปิดไฟล์ในรีโปไม่ได้** · เคยเกิดจริง: บอกชื่อไฟล์ไป user ก๊อป *path* ไปวาง แล้วได้ `42601 syntax error at or near "supabase"` · **user ไม่มี CLI/terminal — ห้ามส่งคำสั่ง shell/CLI ให้รัน** (07/09 เคยก๊อป `supabase functions deploy` ไปวางใน SQL Editor) · migration ที่ย้อนได้ + edge function → AI session apply/deploy เองผ่าน MCP แล้วตรวจกลับ (`docs/modules/edge-functions.md`) · ให้ user ทำเฉพาะที่ทำได้จากเว็บ (SQL Editor · secrets ใน dashboard · เมนูในแอป) · ต้องระบุ **project ปลายทาง (Main/DR) ทุกครั้ง** (ตาราง 2 ฝั่งชื่อคล้ายกัน รันผิดฝั่งได้ง่าย) · แนบคิวรีเช็คผลหลังรันด้วยจะดีที่สุด
- **เอกสาร export ใหม่ทุกตัว (ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน — ไม่มีข้อยกเว้น) ต้อง register เข้าทะเบียน `/doc-forms`** ให้ doc_control แก้เลขฟอร์ม/Rev/ลายเซ็น/footer/โลโก้ได้เองโดยไม่ต้องแก้โค้ด · **ห้าม hardcode เลขฟอร์ม/Rev/โลโก้ · ห้ามสร้างตารางทะเบียนเอกสารใหม่** · อ่านค่าผ่าน `src/utils/docForms.js` (รายงานภายในห่อด้วย `withDocFoot(html, doc_key)`) · 📄 ขั้นตอน 3 ข้อ → `docs/modules/doc-forms.md` · UI §6.6
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

🔴 **โครงสร้างจริง (ตาราง/คอลัมน์/FK/หน้าไหนใช้ตารางไหน) อ่านสดที่หน้า `/schema`** — ห้ามเขียนลิสต์คอลัมน์เป็นมือที่ไหนอีก (snapshot มือล้าสมัยทุกครั้ง)
> 📄 กฎ/เหตุผล/ประวัติรายตารางที่ pg_catalog บอกไม่ได้ (employees · production_lines · profiles · oee_targets · ot_night_bookings · workstations · employee_skills · shift_schedules · ppe_* · four_m_logs · notifications · meeting_action_items · event_comments) → **`docs/modules/db-schema.md`**

**กฎเหล็กรายตารางที่ทุก session ต้องรู้ก่อนแตะ (ที่เหลืออ่านในไฟล์โมดูล):**
- `production_lines` — กำลังคน `std_day_shift`/`std_night_shift` อ่านผ่าน **`src/utils/stdManpower.js` เท่านั้น** · `line_type` (source of truth `src/utils/lineTypes.js`) **คนละตัวกับ `process_type` ฝั่ง DR** · 🔴 **ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ** · 🔴 **ไลน์ที่ `line_type` ว่างต้องมีตะกร้ารับท้ายลิสต์ ห้ามหายจาก dropdown** · 🔴 **อ่านทะเบียนไลน์ผ่าน `src/utils/useProductionLines.js` เท่านั้น ห้าม `from('production_lines').select()` เอง** (มีด่าน) · เพิ่มคอลัมน์ = เติมใน `LINE_COLUMNS` + bump คีย์ cache
- `profiles` — **⚠️ ไม่มีคอลัมน์ `email`** (อีเมล login อยู่ที่ `auth.users` เท่านั้น — เอกสารเคยเขียนผิดจน `fn_audit` อ่าน `coalesce(full_name, email)` แล้ว**พังเงียบ ไม่บันทึกผู้แก้ทั้งระบบ**) · **ระบบไม่มีการส่งอีเมลเลย** (`notify_email` ไม่เคยถูกใช้ส่งอะไร)
- `oee_targets` — **เป้า OEE ห้ามตั้งเอง คำนวณจาก A×P×Q เสมอ** · `target_oee` เป็นคอลัมน์ vestigial ห้ามใช้
- `meeting_action_items` — ใช้ร่วมกัน `/morning-meeting` + `/obeya` แยกด้วย `source` · **ตารางเดียว ห้ามสร้างใหม่**
- `daily_production_logs.assigned_line` = **id จุดงาน ไม่ใช่ชื่อไลน์**
- `employee_skills` — ห้ามเขียนคะแนนจาก client (ดู "Employee Skills & EXP Farming")
- ทะเบียน master ที่มี picker กลางแล้ว (`cost_centers` · **DR:** `customers`/`suppliers`/`die_press_lines`/`process_types`) — คอลัมน์ปลายทางเก็บ **name/code เป็น text เหมือนเดิม ไม่ผูก FK** · `die_press_lines` ตั้งใจแยกจาก `production_lines`
- **ตารางใหม่**: RLS ครบทุก cmd ที่ client ใช้ (`upsert` ต้องมี UPDATE) + `has_perm('<คีย์เดียวกับปุ่มบนจอ>')` + ผูก audit (ดู Traceability) + migration file เสมอ

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
> **เคยเกิดจริง:** ตัวสร้าง 4M Man อัตโนมัติยิงใบท่วมคิว จน**ใบจริงถูกกลบ 2 เดือนครึ่ง**
> **กฎ:** ตัวสร้างอัตโนมัติต้องมีเพดาน/ตัวนับ + กันใบซ้ำ · แยกใบระบบออกจากใบคนให้เห็นในคิว ·
> เคลียร์คิวค้างจากบั๊กด้วย `rejected` + เหตุผล **ห้าม `delete` ห้าม `approved`**
> 📄 กฎเต็ม + เหตุการณ์ → `docs/modules/four-m-workflow.md`

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

> ### 🔴🔴 กฎเหล็กข้าม session — downtime ที่ทับ "เวลาพักตามนโยบาย" ห้ามหักซ้ำ (2026-09-15)
> พักตามนโยบาย = planned stop ที่**ถูกกันออกจากฐานเวลาไปแล้ว** ⇒ นาที downtime ที่ตกในช่วงพัก
> บวกเข้าไปอีก = หักซ้ำ (เครื่องเสีย 11:30-13:00 คร่อมพักเที่ยง 50 น. → หักไป 140 ทั้งที่จริง 90)
> · **ทุกจุดที่เอา downtime ไปหักจากฐานเวลา (netAvail/runMin/wLoad/strictOee/MTBF) ต้องผ่าน
>   `dtMinOutsideBreaks()` + `breakIntervalsIn()` ใน `src/utils/oee.js` เท่านั้น ห้ามรวม `duration_min` เองในหน้า**
> · จุดที่ตอบ "เครื่องหยุดกี่นาที" (พาเรโต/มูลค่า/MTTR/ตาราง DT) ยังใช้ `duration_min` เต็มเหมือนเดิม — **ห้ามสลับ 2 ชุดนี้**
> · backfill แล้ว (รายละเอียด+rollback ใน `oee.md`)

> ### 🔴 บอร์ดไทม์ไลน์ต้องบอก "หลุดแผนแค่ไหน" เป็น **เวลา + ยอด** ไม่ใช่ "กี่ใบ" (2026-09-30 · feedback หน้างาน)
> *"ไม่รู้ว่าดีเลย์หรือหลุดแผนไปแค่ไหน เพราะการ์ดใหม่จะต่อไปเรื่อยๆ"* — "ดีเลย์ N ใบ" ไม่บอกขนาด
> · ตัวเลขทุกตัวมาจาก **`planStatusOf()` (`utils/heijunkaQueue.js`)** · วาดด้วย **`<PlanSlipBar>`** (ใช้ร่วม 2 จอ) **ห้ามคิดเองในหน้า**
> · **ช้ากว่าแผน = คาดจบจริง − ควรจบตามแผน** (cursor 2 เส้นในคิวเดียว) · ขาดกี่ชิ้นใช้ `rowPace()` สูตรเดียวกับที่ตีสีใบ
> · 🔴 **ไม่มี CT / ไม่มีงานเหลือ / ไม่ส่งปลายกะ = `null` ห้ามคืน 0** · หลายพาร์ท CT ต่างกัน = บอกเป็นชิ้นไม่ได้
> · 🔴 **หน้าที่วาดบอร์ดต้องส่ง `frameEndMs` (08:00 วันถัดไป)** — ไม่ส่ง = ดูวันย้อนหลังแล้วขึ้น "ช้า 1368 ชม." (เคยเกิด)
> · 🔗 **สรุปวัน + ต้นเหตุ/ผู้ถูกพาล** = `dayDelaySummaryOf()` / `pushChainOf()` · วาดด้วย `<DelayBlameBar>`
>   🔴 **"ถูกพาล" นับเฉพาะใบที่ต่อท้ายต้นเหตุที่ช้าจริง · โทษได้ไม่เกินเวลาที่ต้นเหตุกินเกิน**
>   (หน้างานสแกนเปิดใบรวดเดียว ทุกใบจึง "เริ่มช้ากว่าเวลาเปิด" — เข้าคิว ≠ ดีเลย์)
>   🔴 **ดูวันย้อนหลัง (`dayOver`) "ต้องยกยอด" = ใบที่เปิดค้างทุกใบ** ไม่ใช่ "คาดจบเลยปลายวัน" (เคยขึ้น 2 เลขขัดกัน)
>   🔴 **จัดอันดับต้นเหตุด้วย "ก่อความเสียหายเท่าไหร่" (`blameTotalMin`) ห้ามเรียงด้วย `ownLateMin` ล้วน** (มีด่าน)
>   · **ใบที่ไม่ได้ทำให้ใครช้า ห้ามพาดหัวว่า "ต้นเหตุ"** · **ใบที่ยังไม่ปิด = เวลาไม่แน่ ต้องเขียน `≥`**
> · 🔴 **ใบไม่เคยถูกปิด = `neverClosed` ⇒ เขียน "N ใบไม่เคยถูกปิด" ห้ามรายงานเป็น "ช้ากว่าแผน N ชม."
>   และห้ามเดา "คาดจบ"**
> 📄 `docs/modules/oee.md` §หลุดแผนไปแค่ไหน · §รอบ 2 · §รอบ 3 (ทวนกับข้อมูลจริง)

> ### 🔴🔴 กฎเหล็กข้าม session — **ชิ้น ≠ shot** (งานคู่ gang die / RH-LH · 2026-09-18)
> CT = เวลาต่อ **1 จังหวะ** แต่ปั๊มทีเดียวได้ 2 ชิ้น ⇒ บวก `qty×CT` ทั้งสองข้าง = เวลามาตรฐาน
> 2 เท่า → **%P ทะลุ 100 แล้วถูก cap เงียบ**
> · **ยอดผลิต/%Q/ของเสีย นับ "ชิ้น" · เวลามาตรฐานของ %P นับ "shot" — ห้ามสลับ**
> · ยุบผ่าน `collapsePairShots()` (`utils/pairTotals.js`) — **ภาระกะตอนวางแผน ใช้ `pairLoadTotal()`
>   ในไฟล์เดียวกัน** (22/09 · มีด่าน) · `computeLiveOee` ต้องส่ง `pairMap`
>   ทุกจอ (มีด่าน `regressionGuards`) · **ลืม `select('pair_mat_no')` = pairMap ว่าง = นับ 2 เท่าเงียบๆ**

> ### 🔴🔴 กฎเหล็กข้าม session — **"ของสงสัย" ยังไม่ใช่ของเสีย จนกว่า QA จะตัดสิน** (2026-09-30 · คำสั่ง user)
> เดิม `qty_ng + qty_suspect` ⇒ ของสงสัยถูกหัก %Q **ทันทีที่ลง และไม่มีทางย้อน** (QA ว่า "งานดี"
> ทีหลังก็ไม่มีอะไรวิ่งกลับไปแก้) — เคสจริง Line 60 กะ 21/07 ลง 12 ชิ้น "รอพิจารณา" ค้างถึงวันนี้
> · **ของสงสัย = ยังไม่รู้ว่าดีหรือเสีย ⇒ กันออกจาก %Q แล้ว "เขียนบนจอว่ารอพิจารณากี่ชิ้น"**
>   (หลักเดียวกับงานทดลอง `is_trial`/`excl_from_q`) · ผลพิจารณาอ่านจาก `quality_bin_records`
>   ผูกด้วย `defect_log_id` · ตัดสินที่ `suspectState()` (§7.1 `oee.js`) **ห้ามคิดเองในหน้า**
>   — `scrap`/ย้ายลงถังแดง = เสีย · `good`/`repair`/`use_as_is`/`return_date` = ไม่เสีย · ไม่มีผล = **รอ**
> · 🔴 **%Q ใช้ `defectQty` · พาเรโต/มูลค่า/รายการใช้ `defectQtyAll` (เห็นของสงสัยเสมอ) — ห้ามสลับ**
> · 🔴 **คิวรีที่เอาไปคิด %Q ต้องต่อ `${QBIN_EMBED}` ใน select** ไม่ต่อ = `suspectState()` คืน `unknown`
>   แล้วถอยไปใช้พฤติกรรมเดิม (ตัวเลขเท่าเดิม ไม่เงียบ) · มีด่าน `oee-suspect-needs-qbin-embed`
> · ✅ backfill ประวัติแล้ว 30/09 (รายละเอียด+ตารางสำรองใน `oee.md`)
>   🔴 กะที่ QA ยังไม่ตัดสิน = **ค่าชั่วคราว** ตัดสินทีหลังว่า `scrap` ต้องคิด %Q กะนั้นใหม่

> 📄 รายละเอียดเต็ม → `docs/modules/oee.md` (14 หัวข้อย่อย)

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

หน้า `/lpa` (`LayerProcessAudit.jsx`, ฝ่ายผลิต — ย้ายจากหมวด QA/QC ตามคำสั่ง user 2026-07-20) — แทนฟอร์มกระดาษ 2 ใบ: แผนตรวจรายเดือน (ไลน์+กะ) + ใบผลตรวจ
> 📄 รายละเอียดเต็ม → `docs/modules/lpa-audit.md`

---

## Scrap Report — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export · 2026-07-16)

หน้า `/scrap-report` (`ScrapReport.jsx`, ฝ่ายผลิต) — แทนฟอร์มกระดาษ "ใบรายงานของเสีย" · ลงยอด scrap ต่อ ไลน์/วัน แล้ว export Excel ตรงฟอร์ม 100%
> 📄 รายละเอียดเต็ม → `docs/modules/scrap-report.md`

---

## 📦 ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01 (paperless · 2026-08-24)

แท็บ 📦 ใบเบิกทดสอบ ใน `/qa` (`src/components/MaterialRequests.jsx`) — user ส่งใบกระดาษมา
> 📄 รายละเอียดเต็ม → `docs/modules/store-requisition-form.md`

---

## ใบรายงานปัญหาการผลิต + ถังเหลือง/ถังแดง (paperless · 2026-08-19 · feedback หน้างาน)

หัวหน้ากลุ่ม Assy2 แจ้งว่ายังเขียนมือทุกครั้ง 3 ใบ (ปัญหาการผลิต · ถังเหลือง · ถังแดง) ทั้งที่ข้อมูลอยู่ในระบบแล้ว → ทำเป็น export/paperless

> ### 🔴 ฟอร์มที่ยื่นออกไปแล้ว = **บันทึก** ไม่ใช่ใบที่ generate ใหม่ (2026-09-25 · มีด่าน)
> ใบที่มีเลขที่/ต้องเก็บตามอายุเอกสาร: **ออกใบ = เขียนทะเบียนก่อนค่อยพิมพ์** (ล้ม = ห้ามพิมพ์ต่อเงียบ) ·
> เก็บ **`snapshot` = เนื้อใบ** · **พิมพ์ซ้ำ = ใบเดิม ไม่ออกเลขใหม่** · snapshot ไม่ตรงข้อมูลปัจจุบัน = เขียนบนจอ ·
> เลข running = "เลขสูงสุดของเดือน+1" **ห้าม `count()+1`** · ต้นแบบ `src/lib/prodProblemDoc.js`
> · ถังเหลือง/แดง: อายุแท็ก · ผล QA 4 ทาง · เลข WI ซ่อม → `src/utils/qualityBin.js`/`repair_wi_registry`
>   **ห้ามประกาศซ้ำในหน้า** · **ห้ามเพิ่ม `closed_at` ที่ต้องมีคนกดปิด** (ไม่มีใครกด = ของค้างเทียมเต็มจอ)

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

หน้า `AdoptionOutlook.jsx` (ภาพรวม) — ตอบผู้บริหารว่า "เมื่อทุกแผนกใช้จริงและข้อมูลเชื่อมกันหมด จะมองเห็นมิติไหนได้บ้าง" (สอบกลับ · เตือนก่อนคุณภาพหลุด · กระทบการส่ง)
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

หน้า `/production-plan` (ฝ่ายผลิต) — จากยอดลูกค้า (order รายวัน + forecast รายเดือน) เทียบ **กำลังผลิตที่ทำได้จริง** → ต้องเปิดกี่กะ วันไหน OT/กะดึก/วันหยุด

> ### 📋 แท็บ `?tab=lots` "แผนสั่งงาน (ล็อต)" — ทีมวางแผนจัดคิวงาน lot size (2026-09-30 → 10-01)
> งานที่**ไม่ได้เดินตามคัมบังแบบ first come first serve** ต้องมีคนวางคิวให้ · ตาราง `production_plan_lots` (DR)
> · สูตรทั้งหมดใน **`src/utils/planLots.js` + `planTimeline.js` ห้ามคิดเองในหน้า**
>
> **🧩 แผน = "กรอบ" (Layer 1) · ผลิตเปิดคัมบัง-คอนเฟิร์มยอด = ของจริง (Layer 2)** (01/10 · คำสั่ง user)
> 🔴 **แผนไม่สร้างใบผลิต ไม่เขียนสถานะ** — จับคู่จาก **ยอดรวมต่อพาร์ท** (`matchPlanToActual`)
>   วัดจริง 25/09: **1 พาร์ท 1 กะ = ใบผลิต 5–40 ใบ** (คัมบัง 1 ใบ = 1 กล่อง) `is_manual = 0` ทุกแถว
>   **แม้แต่ไลน์ปั๊ม A/B/C** ⇒ ออกใบตามล็อตแล้วหน้างานสแกนด้วย = **เป้านับซ้ำ** (1,000 + 7×60 = 1,420)
> · ปันยอดต่อ **(ไลน์+วันงาน+พาร์ท) ข้ามกะ** ตามลำดับ `seq` · **`over`/`offPlan` ต้องโชว์ ห้ามกลืน**
> · 🔴 **ไม่ตัดสินแทนคน** คำนวณสดทุกครั้ง · `splitPlanForSession` **ห้ามกรองด้วย `status`/`prod_order_id`**
>   (ไม่มีใครเขียนแล้ว ⇒ ล็อตค้างตลอดกาล) · **จอหน้างานห้ามกรองกะเอง** (เคสจริง 30/09 จอเงียบสนิท)
> · ⛔ ถอดแล้วอย่ารื้อกลับ: ปุ่ม "เริ่มล็อตนี้" · `reconcilePlan()` · สิทธิ์ `production_plan:start`
>
> **🧲 ไทม์ไลน์ลากจัดแผน** — **ตำแหน่งกล่องถูกคำนวณ · ลาก = เปลี่ยนลำดับ ห้ามลากไปวางเวลาอิสระ**
> · ยืดข้ามเบรคด้วย `stretchOverBreaks` + ช่วงพักจาก `breakIntervalsIn()` **ห้ามเขียนเอง**
> · **ไม่มี CT = `widthPct: null` ลายทแยง** · กล่องที่คำนวณไม่ได้ต้องไม่ทับกัน · ♿ **ห้ามถอดปุ่ม ↑↓**
> · 🔴 **ห้ามแก้ `prod_orders.session_id` ให้ null ได้** (ทั้งระบบ join `production_sessions!inner`)
> · **ยกเลิกล็อต = `cancelled` ห้าม `delete`** (มีด่าน) · **"ไม่ระบุแม่พิมพ์" ≠ "ไม่ต้องเปลี่ยนรุ่น"** ⇒ `null`
> · 🔑 สิทธิ์ฟีเจอร์ใหม่ใช้ `canSeeded()` · 🚫 **ห้ามพ่น `NaN` ออกจอ** (ใช้ `qtyText()`)
> · 🧪 **จองเครื่องทดลองงานใหม่ `source='trial'`** (01/10) — เวลา = **`est_min` "ที่ขอ" ไม่ใช่ `qty×CT`**
>   (ด่าน `plan-lot-time-via-helper`) · 🔴 **ห้ามสร้างพาร์ทใหม่ลง `dr_products`** · `mat_no` ว่างได้เฉพาะใบนี้
>   · **ไม่เข้า `matchPlanToActual`** (`state:'trial'`) · downtime "ทดลองชิ้นงาน" + `is_trial` **มีแล้ว ห้ามซ้ำ**
> · ⚠️ แม่พิมพ์ 262 ตัว **กรอกความสูง 0 ตัว** ⇒ ยังเสนอลำดับประหยัดเวลาเปลี่ยนรุ่นไม่ได้ (ท่อต่อไว้ครบ)
> 📄 รายละเอียดเต็ม → `docs/modules/production-plan.md`

---

## Remote Control — จอตาม-มือถือคุม (2026-07-15)

แก้โจทย์จอที่ไม่มีเมาส์/คีย์บอร์ด/กล้อง (Smart TV, โปรเจคเตอร์, จอบอร์ดหน้าไลน์) — ใช้ได้ทุกหน้า ผ่าน Supabase Realtime broadcast (channel `esm-remote-<รหัส 6 หลัก>`) ไม่มีตาราง/เซิร์ฟเวอร์ใหม่:
> 📄 รายละเอียดเต็ม → `docs/modules/remote-control.md`

---

## MTN Work-Order — ใบแจ้งซ่อม MO (`/mtn-repair`) · JIG/DIE/PD 7 ขั้น · **ทีม MTN 8 ขั้น ไม่มี QA**

ตารางอยู่ DR project (anon-open) · 🔴 **เลขขั้นคนละความหมายระหว่าง 2 ฟอร์ม** ⇒ แตกสาขาด้วย
`stageOf(step, { mtnForm })` (`mtnStepPerm.js`) **ห้ามเขียน `step === 7`** — มีด่าน regressionGuards
· **22/09 หน้านี้เหลือ 2 แท็บ (รายการ MO · ข้อมูลหลัก)** — KPI ช่าง → `/mtn-analysis?tab=kpi` ·
อะไหล่/ผังคลัง → `/equipment?tab=spare|rack` (`?tab=` เดิม redirect ให้) **ห้ามเอากลับมา**
> 📄 รายละเอียดเต็ม → `docs/modules/mtn-work-order.md`

## 🗑️ "อื่นๆ / ไม่ระบุ" ห้ามขึ้นอันดับ 1 ของจอวิเคราะห์ (2026-09-23 · คำสั่ง user)

*"ไม่ระบุกับอื่นๆ มาอันดับ 1 กับ 2 การวิเคราะห์จะไม่มีประโยชน์เลย"* → ใช้กับทุกจอที่วิเคราะห์ input พนักงาน
**กติกา 5 ชั้น** — `utils/unclassified.js` (1-3) · `downtimeCategory.js` (4) · `autoCategory.js` (5)
1. 🔴 **ต้นทาง — ห้ามเขียน `'อื่นๆ'` ทับค่าที่ระบบรู้อยู่แล้ว** (มีด่าน `regressionGuards`)
2. **ทะเบียน taxonomy ต้องครบ + มี group** (ทีมที่ไม่มีอาการในทะเบียน = เลือกได้แค่ "อื่นๆ")
3. **จอต้องบอกตรงๆ ว่าชี้เป้าไม่ได้กี่ %** · แยก "อื่นๆ ที่มีข้อความ" (จับกลุ่มต่อได้) ออกจาก
   "ไม่กรอกเลย" · **งานตามแผน (PM) ไม่ใช่ปัญหา กันออกจากพาเรโต แต่ห้ามซ่อน**
4. 🔑 **ถังขยะที่มีคีย์อื่นกรอกไว้แล้ว ต้องแตกด้วยคีย์นั้นก่อน อย่ารีบเดาจากคำ** (มีด่าน)
   downtime: ถัง "อื่นๆ/Alarm ไม่ระบุ" **92% มี `machine_no`** ⇒ `dtBucketName` (`utils/downtimeCategory.js`)
   แตกเป็น `"<เครื่อง> · <ประเภท>"`
5. 🔎 **เดาหมวดจากคำ — ท่าสุดท้าย** · 🔴 **พจนานุกรมมาจากข้อมูลโรงงานเท่านั้น** `STOP`/`FILLER`
   ใส่ได้แค่คำกลางของภาษา ใส่ชื่ออุปกรณ์ = เดา taxonomy = ผิดกฎ (มีด่าน) · ก้ำกึ่ง → null
   · **ห้ามเขียนผลเดากลับฐาน** จอต้องบอกว่าเดากี่ใบ/จากคำไหน
   · 🇹🇭 **ชั้นภาษา `utils/thaiText.js`** (24/09) — ICU `Intl.Segmenter` · คีย์เสียงข้ามสคริปต์ · ทนพิมพ์ผิด
     🔴 **เทียบเสียงเฉพาะข้ามสคริปต์ · ตรงเป๊ะ · คำ ≥4 ตัว คีย์ ≥3 พยัญชนะ** (ผ่อน = พังทันที)
     ข้อยกเว้นเดียว = **r ท้ายคำ** (คอนเวเย่อ=conveyor)
   · 🔴 **คำกำกวมตัดสินด้วยการใช้งานจริง ไม่ใช่ยุบป้ายทะเบียน** (`buildDtIndex` เรียนจากใบที่คนจัดแล้ว)
   · 📐 **คำที่เรียนจากใบเก่า: log-odds z ≥ 1.96 + พื้น 3 ใบ** (`utils/termStats.js`) เลิกใช้ "ชนะ 80%"
> 📄 `docs/modules/mtn-problem-analysis.md` §การจัดประเภท · §รอบ 3 · §รอบ 4 (ทฤษฎี+ตัวเลข)

## 📦 ของหน้าไลน์คุมที่ "พื้นที่ → ไลน์ → พาร์ท" — **เลิกจุด WIP แล้ว** (2026-10-01 · คำสั่ง user)

🔴 **"จุด" ที่เหลือในระบบต้องเป็น "ที่อยู่" ไม่ใช่ "ถังที่มียอด"** — ยอดคงเหลืออยู่ที่ **ไลน์ + พาร์ท**
(`line_part_levels`) ที่เดียว · ยอดที่ไม่มีใครหักออกคือยอดปลอม และยอดปลอมจุดเดียวทำให้คนเลิกเชื่อทั้งจอ
(วัดจริง 01/10: ใบขอเติม 25 ใบ **ผูกจุด WIP 0 ใบ** · `current_qty` 10 จุด **เท่ากับ min เป๊ะ ไม่ขยับตั้งแต่ 1 ก.ย.**)
· ชั้นบัญชี = **SLoc** (`P411` = ทั้ง Apron Assy — ตรง SAP · `slocOfLine()` derive จากไลน์แม่)
· **`wip_buffer_points` = ตารางอ่านประวัติเท่านั้น ห้ามมีจอไหนเขียน/เรียก `wip_point_add_qty` อีก** (มีด่าน)
· ⚠️ **คนละตัวกับ `workstations` (จุดงาน = ที่ยืนของคน) และ `line_delivery_points` (ป้าย QR จุดส่ง = ที่อยู่ ไม่มียอด)** — 2 ตัวนี้ยังใช้อยู่
📄 ตัวเลข + สิ่งที่ถอดออก + งานค้าง → `docs/modules/demand-flow-tower.md` §เลิกจุด WIP

## 🏷️ `machine_no` = คีย์ join แบบ text — เขียนต่างแบบ = แท่งซ้ำทุกจอ (2026-09-25)

`SW10` กับ `SW-10` คือเครื่องเดียวกัน แต่พาเรโต/KPI ช่าง/MTBF/Andon แตกเป็นคนละแท่ง
· 🔴 ยุบได้เฉพาะ **รูปแบบ** (ตัวพิมพ์/ช่องว่าง/ขีด/0 นำหน้า) ผ่าน `snapMachineNo` (`utils/machineNo.js`
  · ฝั่ง SQL `public.machine_key()` **ตรรกะต้องตรงกัน**) · ช่องรับเลขเครื่องใหม่ต้องผ่าน `MachineSelect`
· 🔴 **ทับศัพท์/ชื่อย่อห้ามเดา** (`เลเซอร์04`·`LWR`) — ทะเบียนมี `LS-11` ชื่อ "Laser" ใต้ HYDROFORM
  · คีย์ที่ทะเบียนเองเขียน 2 แบบ (`RB-79`/`RB79`) = ข้าม ให้คนลบตัวซ้ำก่อน
> 📄 `docs/modules/mtn-problem-analysis.md` §รอบ 5

---

## ⏱️ ตัวกรองช่วงเวลา — `<TimeRangeBar>` เหมือนกันทุกหน้า (2026-09-23 · คำสั่ง user)

ปุ่ม**ช่วง** (วันนี้/สัปดาห์นี้/เดือนนี้/ปีนี้/🔒หลายปี) + ปุ่ม**ย้อนหลัง** 30/60/90/120 + กรอบวันที่ ·
**ห้ามวาดปุ่มสเกล/ช่องวันที่เองในหน้า** (เดิม 18 ไฟล์ทำกันเอง 4 แบบ · `period` มี 2 ความหมาย)
· สูตรแบ่งถัง/ป้ายแกน/บันได = `src/utils/timeRange.js` ที่เดียว · ผูก URL ด้วย `useTimeRange()` (`?scale=&from=&to=`)
· **สเกลไม่เข้ากับช่วง = เตือน ห้ามบล็อก** · ปุ่มย้อนหลัง = ตัวเติมวัน **ไม่ใช่โหมดค้าง**
· 🪜 **บันได "ดูช่วงไหน ⇒ แท่งเล็กกว่า 1 ขั้น"** (23/09) วัน→ชม. · สัปดาห์/เดือน→วัน · ปี→เดือน · หลายปี→ปี
  **ออโต้ แต่กดทับได้ แล้วออโต้ห้ามทับซ้ำ** · จอต้องเขียน "แท่งละ 1 …" เสมอ · 🔴 **เพดานเป็นของข้อมูล
  ไม่ใช่ของจอ** (`finest`) — OEE ละเอียดสุด = **วัน** · 🔴 **"24 ชม. โรงงาน" = 08:00→07:59 วันถัดไป**
  (`bkkHourKey` บวก 7 ชม. จาก epoch เอง **ห้ามพึ่ง timezone เครื่อง**) · 🔴 **ปุ่ม "หลายปี" ล็อก default**
  เปิดเฉพาะจอที่มี RPC rollup (กฎ: โหมดปีห้ามโหลดแถวดิบ)
· 🔴 **วันทำงานใช้ `getWorkDate()` จาก `src/utils/workDate.js`** (ของกลางใหม่ — เดิมก๊อปซ้ำ 27 ไฟล์ ยังไม่กวาด)
· 🔴 **SQDCM ยกเว้น** (ปุ่มของมัน = "ดูช่วงไหน") · **หน้าที่ไม่มีตัวกรองเวลาจริง ห้ามยัดแถบลงไป** — เหตุผลรายหน้าดูในเอกสาร
> 📄 `docs/modules/time-range-filter.md` · UI §6.16

## 📐 มาตรฐานหน้าตา — กรอบหน้า · หัวเพจ · แถบกรอง · ค้นหา (2026-09-24 · คำสั่ง user)

*"แก้ทุกตัวเลย เราต้องมี standardize แล้ว"* — อ้างอิง Nielsen #4 Consistency · Carbon field sizes · Material 3 · WCAG 2.2
· รากหน้า = `<Page>` (`components/Page.jsx`) **ห้ามตั้ง padding/maxWidth เอง** · หัว = `PageHeader` · hub ครอบหน้าลูกด้วย `<Hub>`
· 🔴 **ลำดับตายตัว: ชื่อหน้า → แท็บ → แถบกรอง → เนื้อหา** — ตัวกรองส่ง `filters=` ห้ามใส่ `actions=` (ปุ่มคำสั่งเท่านั้น · มีด่าน)
· แถบกรอง = `<FilterBar>` หรือ children ของ `<TimeRangeBar>` — **ห้ามใส่ขนาด inline ที่ช่อง** (token `--ctl-*`)
· ป้าย "ทั้งหมด" = `ALL.*` (`utils/filterLabels.js`) · 2–5 ตัวเลือก (กะ) = `<Segmented>` · ค้นหา = `<SearchInput>`
· 🗂️ **ส่วนงาน/แผนก/ทีม = `sort_order` ใน /org-setup → ชื่อธรรมชาติ** (`utils/listOrder.js` · ห้าม `order('name')`/`.sort()` ดิบ · มีด่าน)
· 🏭 **รายการไลน์ทุกที่ = ส่วนงาน → แม่ → ลูก เรียงธรรมชาติ** (01/10) — `<LineSelect>` ทำให้เอง (หัวกลุ่ม 🏭 PDx) · ลิสต์ชื่อจากข้อมูล `sortLineNames`/`lineNameCompare` **ห้าม `.sort()` ดิบ** (มีด่าน)
· 🧭 **"คุณอยู่ตรงนี้" ใช้หน้าตาชุดเดียวทุกชั้นเมนู** (พื้น accent-dim + แถบซ้าย + `aria-current`) ·
  **สถานะชั่วคราว (แผงที่กดเปิด) ห้ามเด่นกว่าข้อเท็จจริงถาวร** · ห้ามเช็ค `activeGroup === group` (คืนแค่หมวดแรก)
· 🚪 **`alsoIn` = "ทางลัด" ไม่ใช่ "บ้านที่สอง"** (24/09 คำสั่ง user — เดิมโผล่ 2 หมวดหน้าตาเหมือนกัน = ดูเป็นเมนูซ้ำ)
  บ้านจริง = `item.group` **หมวดเดียว** ได้ไฮไลต์เต็ม · แถวทางลัดวาดต่าง (จาง + `↗ <หมวดบ้าน>`) ·
  ตัดสินด้วย `isNavGuest(item, group)` · "โชว์ในหมวดนี้ไหม (นับทางลัด)" = `inNavGroup()` **คนละคำถาม ห้ามปน**
  · แถวเมนูวาดจาก `navRow()` ตัวเดียวทั้ง desktop/มือถือ · ด่านข้อ 6 ใน stdsweep + `nav-alsoin-*` (UI-STANDARD §4.5)
· 📏 **แกนกราฟ: `YAxis width="auto"` · margin ซ้ายห้ามติดลบ** (เลข 100 เคยถูกตัดเหลือ "0") · `utils/chartAxis.js` · ตรวจ `node audit/chartsweep.mjs`
  · 🖤 **แท่งที่สีมาจาก `<Cell>` ต้องมี `fill={CELL_BAR_FILL}` + `<Tooltip {...tooltipProps(fs)}>`** (30/09 · ไม่มี = tooltip ตัวหนังสือดำบนการ์ดเข้ม · มีด่าน)
· ตรวจ `node audit/stdsweep.mjs` · มีด่าน `regressionGuards`
> 📄 `docs/UI-STANDARD.md` · ผลก่อน/หลัง → `docs/modules/ui-standard-sweep.md`

## 📊 กราฟ Pareto — แท่งตั้งมาตรฐานสากลเท่านั้น (2026-09-22 · คำสั่ง user)

ทุกพาเรโตในระบบวาดผ่าน `<ParetoChart>` · พิกัดจาก `paretoGeometry()` (`utils/pareto.js`)
**ห้ามคำนวณแท่งเองในหน้า — มีด่าน `regressionGuards`** · องค์ประกอบบังคับ: แท่งตั้งเรียงมาก→น้อย ·
**แท่งชิดกันสนิท** · 🔴 **แกนซ้ายเริ่ม 0 · เพดาน = ยอดรวม (accum) ไม่ใช่ค่าแท่งสูงสุด** (แท่งเตี้ย/ที่ว่างด้านบนเยอะ = *ถูกต้อง*) ·
แกนขวา % สะสม · เส้นจบ 100% ที่ขอบขวา · เส้น 80% · ป้ายแกน X เอียง -45°/-90° — **ห้ามกลับไปวาดแท่งนอน**
· 🕳️ **พาเรโตที่ประกอบด้วย Recharts เคยหลุดด่านไป 1 ตัว** (23/09) แล้ว `.slice(0,10)` ก่อนคิด % สะสม
  ⇒ เส้นจบ 100% ที่อันดับ 10 ทั้งที่ยังมีที่ 11+ = จอโกหก · มีกฎคู่ `pareto-hand-built-recharts` แล้ว
· 🔴 **ห้ามกราฟแกน Y 2 ข้าง** (`no-dual-y-axis`) — จุดที่เส้นตัดแท่งเป็นของปลอม (สเกล 2 ข้างตั้งอิสระ)
  ⇒ แยกเป็น 2 กราฟซ้อนแกน X เดียวกัน + ล็อก `YAxis width` เท่ากัน · แกนขวาของพาเรโตไม่เข้าข่าย (UI §6.19)
> 📄 กติกา + กับดักที่เจอจริง → `docs/UI-CONVENTIONS.md` §6.9

## 🔍 KPI ช่าง + QC 7 Tools · `/mtn-analysis` (2026-09-22)

2 แท็บ `?tab=kpi|qc7` · สูตร `src/utils/qc7.js` · ตัววาด `src/components/Qc7Charts.jsx` —
**โมดูลอื่นเอาไปใช้ต่อ ห้ามเขียนใหม่** · 🔴 แยกชนิดสินทรัพย์ (`?asset=`) ด้วย `machines.equipment_kind`
**ห้ามใช้ `mtn_dept`** (89% ของใบเป็นทีม production ปนทุกชนิด)
· 🔴 **พาเรโตอยู่แท็บ `qc7` ที่เดียว** (เดิมซ้ำใน KPI = จอเดียวกันตอบคนละเลข)
> 📄 `docs/modules/mtn-problem-analysis.md`

## 🧰 `/equipment` — ศูนย์ทะเบียนอุปกรณ์ของช่าง (2026-09-22)

ทะเบียนที่เคยกระจาย 3 หมวดเมนู ยุบเป็นหน้าเดียว 5 แท็บ: `?tab=machine|die|jig|spare|rack`
(route เดิม `/machine-database` `/die-registry` `/fixture` redirect เข้ามา) · **embed หน้าเดิมทั้งดุ้น
ไม่แก้ของเดิม** (pattern เดียวกับ `PmHub`) · สิทธิ์ piggyback **ไม่ต้อง seed `page:/equipment`**
· 🔴 **แท็บซ้อนแท็บต้องคนละ query param** — หน้าลูกใช้ `?die=` / `?fx=` **ห้ามใช้ `?tab=`** (UI §6.8 ข้อ 2.4)

---

## คลังอะไหล่ (Spare Part Master) — FM-JIG-009 + Rank ตาม WI-JIG-010 (2026-08-05)

แท็บ 🔩 คลังอะไหล่ ใน `/equipment?tab=spare` (`src/components/SparePartMaster.jsx`) — ค้นอะไหล่/ชั้นวาง · ยอดตรงการเบิกจริงในใบ MO · Rank A/B/C อัตโนมัติ
> 📄 รายละเอียดเต็ม → `docs/modules/spare-part-master.md` (1 หัวข้อย่อย)

---

## DIE MAINTENANCE — Layout & สถานะแม่พิมพ์ (2026-08-19)

> ### ⏱️ เวลาเปลี่ยนรุ่นงานปั๊ม (setup time · 2026-09-25) — คิดผ่าน `src/utils/pressSetup.js` เท่านั้น
> `die_height_mm` + ช่วง shut height + กฎ `press_setup_rules` (เครื่อง ชนะ ไลน์ ชนะ global · กรอกที่ `/equipment?tab=die` + `/machines`)
> ผลของความสูง = **อัตราเชิงเส้น `per_mm_sec`** (ช่างปั๊ม: 1 มม. = 1 วินาที) · **ห้ามฝังเลขเวลา setup ในโค้ด**
> · 🔴 **ไม่มีกฎ/ไม่รู้เวลาฐาน = `null` ห้ามคืน 0** · ไม่รู้ความสูง = ธง `unknown_height` + บอกว่าต่ำกว่าจริง ·
>   `fitsPress` คืน `null` ≠ `false` · ตัวไม่รู้ความสูงต่อท้ายลำดับ ห้ามตัดทิ้ง · `canPlan` ≠ `canTotal`
> · 🔴 **`varMin` (เทียบลำดับ ไม่ต้องรู้เวลาฐาน เพราะหักกลบ) ≠ `totalMin`** · ชั้น 2-3 ยังไม่ทำ ห้ามเริ่มจนกว่า user สั่ง
> 📄 `docs/modules/die-maintenance.md`

`/equipment?tab=die` (เดิม `/die-registry`) เป็น 3 แท็บ (`?die=`): 📋 ทะเบียน (ของเดิม) · 🗺️ ผังจัดเก็บ (`src/components/DieLayout.jsx`) · 📊 สถานะ (`src/components/DieStatusBoard.jsx`) — ตอบ "แม่พิมพ์ตัวนี้อยู่ตรงไหน · สถานะอะไร" · migration `20260819_die_lay…
> 📄 รายละเอียดเต็ม → `docs/modules/die-maintenance.md`

---

## Fixture Shim Record — คุมความยั่งยืนของจิ๊ก (2026-09-01 · คำขอลูกค้า)

หน้า `/equipment?tab=jig` (เดิม `/fixture` · แท็บลูก `?fx=` · `FixtureRegistry.jsx`) — ลูกค้าขอ ระบบบันทึกชิม (shim record) เพื่อคุม fixture sustainability
> 📄 รายละเอียดเต็ม → `docs/modules/fixture-shim-record.md`

---

## PM Predictive & Planner Sync — เห็นวัน PM ล่วงหน้า + buffer (2026-07-16)

หน้า `/pm-forecast` (🔧 PM ล่วงหน้า (Planner), กลุ่มการตรวจสอบและซ่อมบำรุง) — ให้ วางแผน/ผลิตเห็นวันที่จะต้อง PM ล่วงหน้า 1-2 สัปดาห์ + buffer ที่ต้องผลิตเผื่อ ก่อนเครื่องหยุดทำ PM
> 📄 รายละเอียดเต็ม → `docs/modules/pm-predictive-planner-sync.md`

---

## PM Coordination — แผนประสานงาน PM ข้ามวัน (MTN แจ้ง Production · 2026-07-23)

หน้า `/pm-coordination` (`PmCoordination.jsx`, การตรวจสอบและซ่อมบำรุง) — "ใบแจ้งแผน" ที่ MTN ส่งประสานงานกับผลิต สำหรับงาน PM/แก้เครื่องที่กินหลายวัน
> 📄 รายละเอียดเต็ม → `docs/modules/pm-coordination.md`

---

## ตั้งค่าผัง/Floorplan — แยก display ออกจาก setup (2026-07-16)

หลักการ: หน้า display (ผังรวมโรงงาน/Dashboard) = ดู + popup เท่านั้น · การตั้งค่าผังทั้งหมดรวมที่ `/layout-setup` "🗺️ ตั้งค่าผัง/Floorplan" (หมวดตั้งค่าโปรแกรม) แยกแท็บตาม POV — เตรียมรับ Store/AMR ในอนาคต
> 📄 รายละเอียดเต็ม → `docs/modules/floorplan-setup.md` (1 หัวข้อย่อย)

---

## ⚫ ของที่ยุบ/ถอดออกแล้ว (archived — อย่ารื้อกลับโดยไม่ถาม user)

- **ผังรวมโรงงาน** ยุบเป็น `/factory-map` ที่เดียว (2026-07-16) → `docs/modules/_archived/factory-overview-merged.md`
- **PM Photo-Compare** (เทียบรูปเงา) ถอดทิ้ง ไม่คุ้ม (2026-07-22) → `docs/modules/_archived/pm-photo-compare-removed.md`

---

## 🗄️ โครงสร้างฐานข้อมูล — `/schema` (2026-09-22)

จอให้ทีมงาน**เห็นเองว่าตารางชื่ออะไร · PK/FK ผูกกันแบบไหน · หน้าไหนใช้ตารางไหน** แล้วกดแจ้งบัคพร้อมบริบท
· โครงสร้างอ่าน**สด**จาก pg_catalog (RPC `esm_schema_overview` / `esm_schema_table` ทั้ง 2 project)
· **ห้ามเขียนรายชื่อตาราง/คอลัมน์เป็นลิสต์มือที่ไหนอีก** — snapshot มือล้าสมัยทุกครั้ง
· 🔴 **migration ที่ copy ข้อมูลกันพลาด ต้องสร้างใน schema `archive` ห้ามไว้ใน `public`**
  (เคยค้าง 37 ตาราง · 35 ตัวไม่มี RLS = anon อ่านสำเนาข้อมูลจริงได้ · ย้ายแล้ว 22/09 + มีด่านใน build)
> 📄 `docs/modules/schema-map.md`

---

## Employee Skills & EXP Farming (ย้ายฝั่ง server ทั้งหมด — 2026-07-13)

ระบบสะสม EXP ทักษะพนักงานจากการทำงานจริง — ห้ามเขียนคะแนน `employee_skills` จาก client นอกเหนือจาก
2 flow ที่อนุญาต · ทุกการเพิ่มคะแนนอัตโนมัติต้องเป็นฟังก์ชันฝั่ง DB เท่านั้น
- **⭐ v2 (2026-09-24) วัด "ความสามารถ" ไม่ใช่ "การมาทำงาน"** — 4 ขา (ปริมาณสะสมแบบ log · คุณภาพ ·
  ความหลากหลาย/เหตุผิดปกติ · การรับรอง) + **ประตูรายขั้น** · ค่าเกณฑ์ทุกตัวอยู่ใน `skill_exp_config`
  **ห้าม hardcode ใน SQL/JS** · `fn_skill_exp_rebuild()` **คำนวณใหม่ทั้งก้อนทุกคืน** (idempotent โดยโครงสร้าง)
- 🔴 **`shadow_score = null` = "ประเมินไม่ได้" ไม่ใช่ "ได้ 0"** (ไลน์ยังไม่มีข้อมูลยอดผลิต 18% ของแถว) —
  ห้ามเอาไปแสดงเป็น 0 ห้ามเอาไปกดคะแนนจริง · 🔴 **ขึ้นขั้น 25/50/75/100 ต้องผ่านคนอนุมัติเสมอ**
- ตอนนี้อยู่ **shadow mode** (`is_enabled=false`) — v1 ยังคุมคะแนนจริง · สลับ/เคลียร์คิวที่ `/operator?tab=levelup`
> 📄 รายละเอียดเต็ม → `docs/modules/employee-skills-exp.md` (§v2 + 4 หัวข้อย่อย) ·
> **เหตุผล/งานวิจัย/ตารางเวลาต่อขั้น → `docs/SKILL-EXP-ALGORITHM-DESIGN.md` (อ่านก่อนปรับเกณฑ์)**

---

## PE Core Tools — Process Flow / PFMEA / Control Plan (2026-08-13)

หน้า `/pe-docs` (`PEDocs.jsx`, หมวด คุณภาพ & วิศวกรรม) — โมดูลทีม Process Engineering: Process Flow / PFMEA / Control Plan ถอดโครงจากเอกสารจริง TSAT
· **📚 คลัง PFMEA กลาง (2026-09-15):** พาร์ทถือ*สำเนา* ของ master (ไม่ใช่ pointer) · ไหลกลับ = **ระบบเสนอ คนตัดสิน** (`pe_master_proposals` · ห้าม auto-update master) · RPN คำนวณใน `src/utils/peMaster.js` เท่านั้น · migration `20260915_pe_fmea_master_main.sql` (**apply แล้ว 2026-09-24** · seed 43 กระบวนการ รอ PE ยืนยันทั้งหมด)
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

## 🏛️ OBEYA — ห้องบัญชาการโรงงาน (`/obeya` · 4 แท็บ · 2026-08-27 → 09-23)

`Obeya.jsx` = 4 แท็บ: `kpi` 📋 บอร์ด KPI ราย**เดือน** (`ObeyaKpiBoard.jsx`) → `sqdcm` 🖥️ SQDCM **สัปดาห์/เดือน/ปี** (`ObeyaSqdcmBoard.jsx`)
→ `todo` 📌 งานค้างของส่วนงาน (`DeptDashboard` embed · `/dept-dashboard` redirect) → `table` ⚙️ ตั้งค่า/กรอก (`KpiMonthly.jsx`) · KPI ใน `obeyaKpi.js`/`obeyaYear.js` · OEE จาก `oee.js`
- **🔴 ขอบเขตทุกแท็บ = `<OrgScopePicker>`** (ผังทุกมิติ · `utils/orgScope.js` · `?scope=kind:value` · เขียน `scope_kind/scope_value` ผ่าน `defScopeColumns()`) ห้าม select จาก `org_nodes kind='section'` เอง
  · 🔴 **Cost Center = ช่องแยก ห้ามปนในลิสต์ผัง** (23/09) — เลือกหน่วยแล้วมีชิป `💰 รหัส` กดสลับได้ · พิมพ์รหัสในช่องค้นเจอหน่วยเจ้าของ · `ccOf`/`ccOwnersOf`/`ccLabel` · **กลุ่มไลน์ที่ลูกคนละรหัส ห้ามเดาเอารหัสเดียว** · ⚠️ ข้อมูลจริงยังขัดกัน 3 จุด (ดูเอกสาร) จอโชว์ตามจริง ห้ามกลบที่ UI
- **🔴 `kpi` กับ `sqdcm` วาดจาก `ObeyaSheet.jsx` ชิ้นเดียว** (แผ่น A4 · ไฟ · กริด · 🔍 ขยายเป็น popup — children/`foot` รับ `(k)=>node` ให้ฟอนต์โตตาม) — แก้หน้าตาแผ่นที่นั่นที่เดียว ห้ามทำ modal ขยายเองในหน้า
- **🔴 ห้ามยุบ `kpi` กับ `sqdcm` เป็นบอร์ดเดียว** (คนละหน่วยเวลา/แกน/เจ้าของตัวเลข) · `kpi` กับ `table` = **ข้อมูลชุดเดียวกัน** ห้ามแยกคลัง/ตั้งเป้าคนละที่
- **🔴 ทุกจอตัดสิน KPI ผ่าน `scoreDef()` (`kpiSetup.js`) เท่านั้น — มีด่านสแกนทั้งรีโป** · "เหลือง" = ถึง Commitment แต่ไม่ถึง Target · ระดับ 1/0.5/0 **ไม่ใช่ boolean** เทียบ `=== 1`
- **🔴 กฎความซื่อสัตย์ของจอ:** ข้อมูลไม่พอต้องเขียนบนจอ **ห้ามโชว์ 0 ห้ามซ่อนแผง** · "ไม่มีเป้า" = เทา · ไฟรวมต้องบอกว่าตัดสินจากกี่ช่อง
- **🔴 กลุ่มมีระบบ KPI ทางการ (KPI Online)** — ESM = ที่ผลิตตัวเลข Actual **ห้ามทำแข่ง/ห้ามคิดเกณฑ์สีเอง** · กติกาเลือก KPI ต่อหน่วยงาน
  = ทะเบียน `kpi_standard_items` (`fixed`/`choice`/`null`=หัวข้อแม่ · น้ำหนักรวม 50 · `checkStdSelection` **เตือนเท่านั้นห้ามบล็อก**) **ห้ามคิดเอง**
- **🔴 โหมดปีห้ามโหลดแถวดิบ** — RPC `obeya_year_rollup` (DR) / `obeya_attendance_rollup` (Main) คืน Σ รายเดือน แล้ว `obeyaYear.js` หาร/ตัดสิน
  (**RPC ห้ามคำนวณ KPI**) · ⚠️ `daily_production_logs.assigned_line` = **id จุดงาน** ไม่ใช่ชื่อไลน์ · `downtime_logs` ไม่มี `reason` (ใช้ `description`)
- ACTION BOARD ใช้ `meeting_action_items` ร่วม `/morning-meeting` แยกด้วย `source` · **ห้าม subscribe realtime `prod_orders`/`downtime_logs` ในหน้านี้**
- **🔴 คอลัมน์ที่มี `not null default` ห้ามเช็ค truthiness** (`kpi_definitions.source` default `'manual'` ⇒ `!d.source` เท็จเสมอ · มีด่าน)
- **🔴 หน่วย/ทศนิยม/วิธีรวม 12 เดือน = 2 ชั้น** (24/09) ทะเบียน `kpi_catalog` = ค่าตั้งต้น · `unit`/`decimals` override รายแถวได้ · 🔒 `summary_mode` ไม่ได้
  · อ่านผ่าน `unitOf`/`decimalsOf`/`summaryModeOf`/`fmtKpi`/`summaryOf` **มีด่าน** · `.select()` ที่ embed `kpi_catalog` ต้องมี `decimals, summary_mode` (ขาด = ตกค่า default เงียบ)
- **🏭 KPI ที่ค่าเป็นของโรงงาน (%RM · Customer Satisfaction) = `kpi_catalog.value_scope='plant'`** (30/09 · คำสั่ง user) — ค่ารายเดือนอยู่ที่นิยามระดับ ทั้งโรงงาน ตัวเดียว · นิยามหน่วยงานเก็บแค่เป้า/น้ำหนัก · ทุกจออ่านผ่าน `sharedValueDef()` **ห้ามถอยไปใช้ค่าของหน่วย** · ตั้งจากปุ่ม 📘 ไม่ hardcode ชื่อ
- **📅 แผน 12 เดือน `kpi_month_plans`** (25/09 · `planProgress()`) — 🔴 ป้าย ▲ ตามแผน/▼ ช้ากว่าแผน **ไม่ใช่คะแนน** ห้ามเปลี่ยนสี/เพิ่มขั้น · เทียบเฉพาะเดือนที่มี**ทั้งแผนและผล**
  · กราฟแผ่น = แท่งผลจริง + เส้นเป้า(แดง) + **Commitment(เหลือง)** + **เส้นแผนรายเดือน(ฟ้า · สเกลเดียวกัน ห้ามแกน 2 ข้าง)** · 📝 **กดแท่งเดือน = หมายเหตุ remark/action/note** (`kpi_month_notes` MAIN · คีย์ ปี+เดือน+ขอบเขต+`row_key` · เขียน `kpi:manage`) · แถบเตือน "ยังไม่ครบ" อยู่**ใต้บอร์ด สูงคงที่** (30/09 · ห้ามย้ายขึ้น = สเกลวิ่ง)
  · 🎯 **โฟกัสช่วงค่า `?yfocus=1`** (30/09) ช่วงจาก `focusDomain()` เท่านั้น · default ปิด · **แกนไม่เริ่ม 0 ต้องมีชิปบอกบนกราฟ** · มี 0 จริง = ไม่โฟกัส · ตัวเลขบนแท่งทุกแท่ง (แคบ = เว้นแท่งเว้นเลข)
- หยิบ KPI จากทะเบียนกลุ่ม = ปุ่ม 📘 ในแท็บ ⚙️ (`KpiStandardModal`) — **ไม่ตั้งเป้า/น้ำหนักให้เอง** · ผูก `std_item_id`
- ⚡ **KPI ช่าง (MO Closed/MBD/MTBF/MTTR) = สูตร Guideline หน้า 10 ใน `utils/kpiAuto.js` เท่านั้น** (RPC `kpi_mtn_rollup` คืน Σ) · ระบบเสนอ คนกด "ใช้ค่านี้" **ห้ามเขียนทับค่าที่กรอกมือ**
> 📄 แท็บ KPI/ตั้งค่า/ทะเบียนมาตรฐาน → `docs/modules/obeya-kpi-board.md` · จอ SQDCM (+โหมดปี §9) → `docs/modules/obeya.md` ·
> ดีไซน์ → `docs/OBEYA-DESIGN.md` · **ที่มาตัวเลข/ใบจริง/คู่มือ KPI Online → `docs/OBEYA-KPI-SOURCES.md` (อ่านก่อนแตะ KPI)**

---

## 🌳 ชั้น BOM ที่แก้ได้ + ผูกขั้นตอน (PFC/OP) — `/products` แท็บ BOM (2026-09-16)

> **🔴 ต้นไม้ BOM ต้องผ่าน `buildBomIndex()` (`src/utils/bomTree.js`) เท่านั้น · ห้ามเขียน `matOf[b.product_id]` เองอีก**
> (มีด่านสแกนทั้งรีโป `regressionGuards` แล้ว) — `bom_items.parent_mat` (ใครก็เป็นแม่ได้ ไม่ต้องเป็น `dr_products`)
> ชนะ `product_id` · `op_no` = ขั้นที่ชิ้นนี้ถูกใส่ตาม PFC · ย้ายชั้นผ่าน `moveBomLine()` (กันวนลูป)
> migration `20260916_bom_level_parent_mat.sql` (**apply แล้ว** · แถวเดิม null ทั้ง 506 = ไม่มีจอไหนเปลี่ยน)
> 📄 `docs/modules/bom-levels.md` (ทำไมเดิม ~90% ตรึงชั้นเดียว · ทำไมเหนือ SAP · งานค้าง PFC↔MAT)

---

## Traceability / Audit Log — ใครแก้อะไรเมื่อไหร่ (2026-07-24)

เดิมตาราง master ~90% track แค่ `created_at` → แก้ไขแล้วสืบไม่ได้ว่าใคร/เมื่อไหร่/ค่าเก่าอะไร (เจอจริง: `dr_products.line_name` ถูกเปลี่ยนไลน์ สืบไม่ได้) · ตาราง master/editable ใหม่ทุกตัวต้องผูก audit (เพิ่มชื่อตารางใน…
> 📄 รายละเอียดเต็ม → `docs/modules/traceability-audit-log.md`

---

## Workforce Insight — กำลังคน / เปลี่ยนจุดงาน / Turnover (`/workforce-insight` · 2026-09-02)

หน้า `WorkforceInsight.jsx` (พนักงาน & ทักษะ) — **อ่านอย่างเดียว ไม่มี resource:action ใหม่** · 3 แท็บ: กำลังคนรายวัน · การเปลี่ยนจุดงาน · Turnover
> 📄 รายละเอียดเต็ม → `docs/modules/workforce-insight.md` (3 หัวข้อย่อย)

---

## ประวัติผลิต by Product — `/product-history` (2026-07-24)

หน้า ProductHistory (กลุ่มวิเคราะห์ & รายงาน) — เลือกสินค้า (ค้นด้วย mat_no/ชื่อ/PN) → ดูย้อนหลังว่าเคยผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ + ประวัติการแก้ master data
> 📄 รายละเอียดเต็ม → `docs/modules/product-history.md` (2 หัวข้อย่อย)

---

## สอบกลับ Order — `/order-trace` (Order Traceability · 2026-07-30)

หน้า OrderTrace (วิเคราะห์ & รายงาน) — 2 แท็บ `order` (จากเลขใบผลิต · default) / `symptom` (จากอาการ) — สแกน `prod_no` แล้วเห็นทุกเหตุการณ์ของใบนั้น
> 📄 รายละเอียดเต็ม → `docs/modules/order-trace.md` (2 หัวข้อย่อย)

---

## 📌 คิวงานของฉัน — แผงในเมนูบัญชี (2026-09-25 · คำสั่ง user)

กฎการแบ่งชั้น = `src/utils/myQueue.js` (pure · มีเทส) · โหลด/วาด = `components/MyQueuePanel.jsx`
- **ดึง ไม่ใช่ยิง** — ไม่สร้างแถว `notifications` ไม่เรียก send-push (กระดิ่งวัดจริง 25/09: **19,095 แถว/7 วัน อ่าน 7.3%**)
- **🔴 3 ชั้นห้ามยุบ:** `mine` รอเราตรง · `unit` คิวหน่วยงาน · `floor` ทั้งโรงงาน (**สรุปบรรทัดเดียว ห้ามแตกรายตัว**)
  — ชื่อในใบ ≠ งานส่วนตัว (วัดจริง: ใบซ่อมรอตรวจรับ 168 ใบ มีแค่ 10 ชื่อ ส่วนงานเดียว = คิวแผนก)
- **🔴 badge นับเฉพาะ `mine` ผ่าน `badgeCount()`** · 0 หรือโหลดไม่ครบ = **ไม่วาดเลย**
- **🔴 ว่างต้องขึ้น "ไม่มีงานค้าง" ห้ามซ่อน · โหลดไม่ครบต้องเขียนบนจอ** (`partial`) — "เคลียร์หมด" ≠ "คิวรีล่ม"
> 📄 `docs/modules/my-queue.md`

---

## 📉 Monitoring — Excel ทีมวางแผนเข้าระบบ (`/monitoring` · 02/10)

13 ชีท = **การตั้งค่า ไม่ใช่ 13 จอ** — ชุดแถวอยู่ใน `monitor_boards.rows` (DR) · เลขทุกตัวออกจาก
`buildGrid()` (`utils/monitorGrid.js`) ที่เดียว (มีด่าน)
· 🔴 **ช่องยอดยกมาว่าง = `null` ทั้งแถว ห้ามเดา 0** · ระบบไม่รู้ = ขีด `–` · คนกรอกชนะระบบเสมอ
· ⚠️ **แต่ละชีทคิด Total SL คนละสูตร — เก็บเป็น `sl_row` ห้ามยุบเอง**
📄 `docs/modules/monitoring-boards.md`

---

## 📦 อัพเดทโปรแกรม — `/program-update` (2026-10-01 · คำสั่ง user)

จออ่านอย่างเดียว บอกว่าช่วงที่เลือก **เพิ่ม/แก้/ปรับ** อะไรไปบ้าง · **ไม่แตะ Supabase เลย**
· 🔴 **แหล่งความจริงคือ git** — `scripts/gen-changelog.mjs` → `public/changelog.json` (อยู่ในขั้น build)
  **ห้ามแก้ไฟล์นั้นมือ · ห้ามทำทะเบียนอัพเดทให้คนมาจดเอง** (ช่องที่ไม่มีใครกรอก = ช่องตาย)
· 🔴 **สคริปต์ห้ามทำ build ล่ม · clone ตื้นห้ามเขียนทับ** (ของใหม่น้อยกว่าเดิม >10% = ไม่เขียน)
· กฎตีชนิด = `src/utils/changelog.js` (**ต้องมีตะกร้ารับท้ายลิสต์** — commit ไม่ตามรูปห้ามหายจากจอ)
> 📄 `docs/modules/program-update.md`

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
- **🔴 ทุก `.upload()` ต้องส่ง options ผ่าน `uploadOpts()` (`src/utils/storageUpload.js`) — มีเทสในด่าน build** (2026-09-11)
  ไม่ส่ง `cacheControl` = ได้ default 1 ชม. ⇒ รูปถูกโหลดใหม่ทุกชั่วโมง · **เคยทำ egress ทะลุโควต้าจน Supabase
  ล็อกบริการทั้ง organization มาแล้ว (ทั้งโรงงาน login ไม่ได้)** · path ที่ `upsert` ทับได้ต้องใส่ `mutable: true`
- **🚫 รูปพนักงานไม่รับ GIF** (`allowGif={false}`) — บีบไม่ได้ เฉลี่ย 4.3 MB/รูป · ตัวตรวจชนิดไฟล์ =
  `src/utils/imageFileKind.js` จุดเดียว (ดูนามสกุลด้วย ไม่ใช่แค่ MIME) · **ปฏิเสธไฟล์ต้องขึ้น toast
  บอกเหตุผล+ทางแก้เสมอ ห้ามปิดหน้าต่างเงียบๆ** (คำสั่ง user 2026-09-11)
> 📄 รายละเอียดเต็ม → `docs/modules/storage-images.md`

---

## File Structure

> 📄 **ผังโฟลเดอร์เต็ม + ของกลางรายตัว (components/utils/lib · picker กลาง · edge functions) → `docs/modules/file-structure.md`**
> ของจริงดูใน `src/` เสมอ — ผังที่เขียนมือล้าสมัยทุกครั้ง

ที่ต้องรู้ข้าม session:
- **`src/App.jsx` = source of truth ของเมนู/หมวด** (`NAV_ITEMS`, `NAV_GROUP_ORDER`, `UserContext`, `Sidebar`)
- **`src/main.jsx`** — `RootErrorBoundary` + `vite:preloadError` auto-reload **ห้ามถอด**
- **`src/supabaseClient.js`** — 2 clients: `supabase` (Main) / `supabaseDR` (DR — anon เสมอ)
- **`src/utils/`** = กฎ/สูตรกลางทั้งหมด (สิทธิ์ · ขอบเขตส่วนงาน · loader ทะเบียนของ picker · ชั้นภาษาไทย)
  **แก้กฎที่นี่ที่เดียว ห้ามก๊อปสูตรไปไว้ในหน้า** · `src/lib/` = logic เฉพาะโดเมน · `src/pages/` ชื่อไฟล์ตรงกับ route (⚠️ `operator.jsx` ตัวพิมพ์เล็ก)
- **`supabase/migrations/`** — ทุกการเปลี่ยน schema ต้องมีไฟล์ที่นี่
- **`docs/`** บังคับอ่าน: `ENGINEERING-PRINCIPLES.md` (ทุกงาน) · `UI-CONVENTIONS.md` (งาน UI) ·
  `PERMISSIONS-DESIGN.md` (สิทธิ์/role) · `OBEYA-KPI-SOURCES.md` (ก่อนแตะ KPI)
  · 📌 **`*-GAP-*`/`*-DESIGN.md` บางไฟล์ = ออกแบบไว้แล้วยังไม่ลงมือ — ห้ามหยิบไปทำเองจนกว่า user สั่ง**
  (รายชื่อ + ข้อห้ามรายไฟล์ เช่น ราคาขายห้ามอยู่ใน `parts_master` ฝั่ง DR → `docs/modules/file-structure.md`)

> **📡 SCADA / ข้อมูลเครื่องจักร realtime — อ่าน `docs/SCADA_REALTIME_DESIGN.md` ก่อนลงมือเสมอ (2026-08-06)**
> SCADA = **"เซ็นเซอร์"** ส่ง raw data (stroke/สถานะ/เวลาหยุด) · **ESM เป็นเจ้าของสูตร** — `src/utils/oee.js`
> ยังเป็น single source of truth · **ห้ามให้ระบบภายนอกคำนวณ OEE เองแล้วเอาเลขมาโชว์** (มี OEE 2 ชุด = เถียงกันว่าเชื่อจอไหน)
> **SCADA = ข้อเท็จจริง · คน = เหตุผล** (เครื่องบอกไม่ได้ว่าทำไมหยุด และ**ไม่มีทางรู้ NG** → Q มาจากคนเสมอ)
> ⚠️ แถวจะโต **×113–×450** จากที่คนกรอกวันนี้ · micro-stop เป็น P ไม่ใช่ A · **1 stroke งานคู่ = 2 ชิ้น** (`pieces_per_stroke`)

## Patterns & Utilities

### Toast (Singleton)
```js
import { toast } from '../components/Toast'
toast.success('บันทึกสำเร็จ') · toast.error('เกิดข้อผิดพลาด') · toast.info('กำลังโหลด...')
```

### UserContext
```js
const { role, lineId, team, section, sections, fullName } = useContext(UserContext)
// sections = ขอบเขตส่วนงานผลลัพธ์สุดท้าย (array, [] = ไม่จำกัด)
```

### Date/Time Utilities — 📄 ตัวอย่างโค้ด + ฝั่ง SQL → `docs/modules/date-time-rules.md`

> ⚠️ **ห้ามใช้ `new Date().toISOString()` เพื่อหาวันที่งาน** — คืน UTC ต่างจากไทย (UTC+7) วันที่คลาดเคลื่อน
> · **วันที่งาน = `getWorkDate()`** (`src/utils/workDate.js` · ก่อน 08:00 = วันก่อนหน้า — กะดึกข้ามวัน)
> · กะปัจจุบัน = `getCurrentShift()` (day 08:00–19:59 / night 20:00–07:59) · `getShiftInfo()` คืน `{ shift, label }`
> · **แสดงผล**เวลาใช้ `toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })` (ไม่ใช่สำหรับ query)
> · **ฝั่ง SQL (DR) ใช้ `work_date_bangkok()` ห้ามใช้ `current_date`** (= UTC · เพี้ยน 07:00-07:59 ไทย)

> ⚠️ **"วันทำงาน" ต้องอ้างอิงปฏิทินบริษัทก่อน ห้ามใช้ค่าคงที่ 22/26 วัน** (คำสั่ง user 2026-07-21) —
> `countWorkingDaysInMonth(monthKey, fallback)` ใน `src/utils/companyCalendar.js` (เรียก `loadCompanyCalendar()` ก่อน)
> จ-ศ ไม่มาร์ค = ทำงาน · มาร์คหยุดทุกชนิด (ot15/ot2/shutdown75) = หยุด · ส-อา มาร์ค working = ทำงาน
> 📄 จุดที่ใช้แล้ว + 2 บั๊กที่เคยเจอ → `docs/modules/shift-ot.md`

### 🔴 กฎเหล็กการเขียน DB จาก client (full QC audit 2026-09-03..04 — คลาสบั๊กที่เจอซ้ำทุกรอบ)

> 📄 **คำอธิบายเต็ม + ตัวเลข/เคสจริงของทุกข้อ → `docs/modules/db-write-rules.md`** (ห้ามตัดข้อไหนออกจากลิสต์นี้)

1. **supabase-js ไม่ throw** (คืน `{ data, error }` เสมอ ⇒ `try/catch` = โค้ดตาย · `const { data } = await …` = กลืน error 100%) ⇒ **ทุก insert/update/delete ต้องอ่าน `error` ผ่าน `checkWrite(await …, 'ป้ายงาน')`** (`src/utils/dbWrite.js`) · delete-then-insert ต้องหยุดก่อน insert เมื่อ delete ล้ม
2. **RLS ปฏิเสธ UPDATE/DELETE = "สำเร็จ 0 แถว ไม่มี error"** (มีแต่ INSERT ที่โยน 42501) ⇒ ปุ่มที่ผลลัพธ์สำคัญต้อง `.select('id')` แล้ว**นับแถว** ห้าม toast เขียวจาก `!error` อย่างเดียว
3. **policy RLS ต้อง `has_perm('<คีย์เดียวกับปุ่มบนจอ>')` ห้าม hardcode role array** (role array มือจะแคบกว่าสิทธิ์ที่ `/permissions` แจกเสมอ ⇒ คนมีปุ่มแต่เขียนได้ 0 แถวเงียบ) · **ตารางใหม่ต้องมี policy ครบ 4 cmd ที่ client ใช้ — `upsert` ต้องมี UPDATE**
4. **stale-response race** — จอที่ยิงคิวรีตาม state (กะ/วัน/ไลน์) แล้ว user สลับก่อนคำตอบเก่ากลับ ⇒ คำตอบเก่าเขียนทับจอใหม่ (เคยเกิด: Daily Report ลงข้อมูลผิดกะ) ⇒ **ทุก effect ที่ await แล้ว set state ต้องมี guard** (`let alive = true` + cleanup / request id / ref ปัจจุบัน)
5. **`.in(ids)` ยาว = URL เกินเพดาน proxy → คืนค่าว่างเงียบ** ⇒ ผ่าน `fetchByIds` (chunk) · **เพดาน 1000 แถว/คิวรี** ⇒ ตารางที่โตได้ห้าม `select()` เปล่า
6. **claim สถานะ (compare-and-swap) ก่อนเขียน ledger ⇒ ledger ล้มต้องคืนสถานะ** (ดู `docs/modules/demand-flow-tower.md`)
7. **realtime ต้องมี "เพดาน" ไม่ใช่ debounce · และต้องกรองว่า "เรื่องนี้ของฉันไหม"** — **ใช้ `coalesce(fn, LIVE.x)` (`src/utils/liveRefresh.js`) เท่านั้น ห้าม debounce/`setTimeout` เอง** · ระดับอยู่ใน `src/utils/refreshRates.js` **ห้ามใส่ ms ดิบ** · **subscribe ต้องมี `filter:` เมื่อรู้ขอบเขต** — ⚠️ **DELETE กรองด้วยคอลัมน์ที่ไม่ใช่ pk ไม่ได้** (REPLICA IDENTITY default) ให้แยก subscribe DELETE ไม่กรอง **ห้ามแก้ด้วย `REPLICA IDENTITY FULL`**
8. **จอที่มี realtime — poll ต้องข้ามรอบเมื่อไม่มีอะไรเปลี่ยน** (`makeIdleGate(LIVE.FLOOR)`) · **ห้ามใช้กับจอที่ไม่มี realtime** (ไม่มีใคร touch = จอค้าง — ให้เพิ่ม realtime ก่อน) · **จอใหม่ใช้ `useLiveBoard(load, { tables, topic })` บรรทัดเดียวจบ ห้ามประกอบเองทีละชิ้น**
9. **`useCallback`/`useEffect` ที่ยิง DB ห้ามมี object/array ใน deps** — พ่อ `setState(arr)` ใบใหม่เนื้อเดิม = ลูกยิงคิวรีซ้ำฟรีๆ ให้แปลงเป็น string/primitive ก่อน · **คลาสนี้ build/lint/เทส/จอผ่านหมด เห็นจาก log เท่านั้น**
10. **สมมติฐานเรื่องสิทธิ์ที่เขียนในคอมเมนต์ "มีอายุ"** — migration ทีหลังเปิดหน้าให้ role ใหม่ได้เสมอ ห้ามพึ่ง "หน้านี้ admin-only อยู่แล้ว" เป็นด่านของแผง/ตาราง
11. **🔴 egress คิดเป็น "ไบต์" ไม่ใช่ "จำนวน request" — `select('*')` บนตารางกว้างคือตัวกินจริง** ⇒ **จอรายการเลือกเฉพาะคอลัมน์ที่ใช้ · ใบเต็มดึงตอนเปิดทีละใบ** (`.eq('id', id)`) — มีด่าน `regressionGuards` · **รูปผังห้ามเป็น PNG** ใช้ `compressLayoutImage()` (`src/utils/layoutImage.js`) = WebP 2560px **ห้ามลดความละเอียด เคยเบลอ**

### Skill Fit Scoring
```js
computeFit(employee, station)  // % ของทักษะที่ผ่าน min_score
fitColor(score)   // 80+ green | 60-79 amber | 40-59 orange | <40 red
```

## กฎการทำงานของทุก AI session (Workflow Discipline)

ลำดับที่ต้องทำทุกครั้ง ไม่ว่าจะแก้อะไร:
1. **เช็คกฎก่อนลงมือ** — section ที่เกี่ยวข้องใน CLAUDE.md + `docs/modules/<module>.md` ของโมดูลที่แตะ +
   **ทุกงาน → `docs/ENGINEERING-PRINCIPLES.md`** · แก้ UI → `docs/UI-CONVENTIONS.md` (บังคับ) ·
   แตะสิทธิ์/role → `docs/PERMISSIONS-DESIGN.md` · แตะ DB → §Supabase Projects (**2 projects!**) + เขียน migration เสมอ
2. **ทำงานให้สอดคล้องกับกฎ** — ขัดกับ convention เดิม ให้ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยน
   (แล้วต้องไล่แก้ทุกจุดที่ใช้ pattern นั้นให้ตรงกัน)
3. **อัพเดทกฎหลังทำ** — งานที่สร้าง/เปลี่ยน pattern · schema · สิทธิ์ · workflow ที่ session อื่นต้องรู้ →
   อัพเดทเอกสาร (`docs/modules/<module>.md` เป็นหลัก · CLAUDE.md เฉพาะกฎข้าม session) **ในคอมมิทเดียวกัน** พร้อมวันที่
4. **build ผ่าน (`npm run build`) ก่อน commit เสมอ** · merge เข้า `main` = deploy จริง
   📄 **ที่มาของทุกด่าน + เคสจริงที่ทำให้ต้องมี → `docs/modules/build-gates.md`** (อ่านก่อนจะแตะ/ถอดด่านใดๆ)
   - **`npm run build` = `check:context` → `lint:critical` → `npm test` → `vite build`** ·
     ตัวรันเทส = `scripts/run-tests.mjs` (เก็บ `src/**/__tests__/*.test.mjs` เอง — **วางไฟล์เทสใหม่แล้วถูกเก็บอัตโนมัติ**)
     · **ห้ามเปลี่ยนเป็น `node --test '<glob>'`** (glob ต้อง node v22 · Render อาจใช้ 20 ⇒ deploy ล่มทั้งที่โค้ดไม่ผิด)
     · **⏱️ `npm test` รัน 2 รอบ: ปกติ + "นาฬิกา +400 วัน"** จับ**เทสระเบิดเวลา** ⇒ **ฟังก์ชันที่กินเวลาปัจจุบัน
     ต้องรับ `now` เป็นพารามิเตอร์ แล้วเทสตรึงค่า** · ตกรอบนี้ให้แก้เทส **ห้ามถอดรอบนี้ออก**
   - **🛡️ `src/utils/__tests__/regressionGuards.test.mjs` = ด่าน "บั๊กเก่าห้ามกลับมา"** (คำสั่ง user
     *"ปัญหาที่เคยแก้เคยเกิด ไม่ควรเกิดซ้ำ"*) — **เจอบั๊กคลาสใหม่ที่คนถัดไปน่าจะพลาดซ้ำ → เพิ่มกฎที่ไฟล์นี้
     ในคอมมิทเดียวกับที่แก้บั๊ก** (ใส่เฉพาะกฎที่ grep ได้แม่น ห้ามใส่กฎจุกจิก)
   - **ด่าน lint กฎ crash** (`eslint.critical.config.js`) — เฉพาะกฎที่ทำแอปพังตอน runtime ที่ bundler ไม่จับ ·
     **ห้าม bypass ด้วย `vite build` ตรงๆ · ห้ามเพิ่มกฎ style จุกจิกในไฟล์นี้**
     · `react-hooks/rules-of-hooks` เปิดอยู่ — **hook ทุกตัวต้องอยู่บนสุดก่อน early return** (ผิด = React #310 จอ error ทั้งหน้า)
     **ห้าม disable กฎ** ให้ย้าย hook ขึ้น
   - **⚠️ build ผ่าน ≠ หน้าไม่พัง** — merge งานหลาย session ชนไฟล์เดียวกัน ให้รัน **`node audit/crashsweep.mjs`** เสมอ
     (ทุกหน้า @1500px + กดปุ่มหัวเพจ · ต้องเปิด `npx vite --config audit/vite.audit.mjs` ค้างไว้)
     · 🔴 **แถวพิเศษใน mock ห้ามถอด** (`NULLISH` · ชั้น OP · ไลน์แม่-ลูก 3 ชั้น · KPI `manual`+`auto:` · เอกสารที่ออกเลขใบแล้ว)
     · เพิ่มคอลัมน์ nullable ใน `ROW()` ต้องเติมใน `NULLISH()` ด้วย (เหตุผลรายตัว → `audit/README.md`)
   - **📱 `node audit/mobilesweep.mjs` (ทุกหน้า @390px)** — **แตะ layout ที่มี `isMobile` หรือ `position:sticky`
     ต้องรันก่อน merge** (จับ sticky ทับเนื้อหา · ของล้นแล้วปัดไม่ได้ · ข้อความถูกบีบกว้าง 0)

### QC Agent — ตรวจโค้ดขัดกฎโปรเจค

`/qc-audit` (ไม่มี argument = ทั้งโปรเจค · ระบุหมวด `/qc-audit B D` หรือไฟล์ได้) →
subagent `qc-project-rules` (read-only · `.claude/agents/qc-project-rules.md`) มี checklist 7 หมวด
(A Date/Time · B Supabase 2 projects · C Permissions · D Section scoping · E Storage/รูป · F UI · G Workflow/เอกสาร)
รายงาน 🔴 ขัดกฎเหล็ก / 🟡 ขัด convention / 🔵 legacy / ✅ ผ่าน พร้อม file:line + วิธีแก้
· **เพิ่ม/เปลี่ยนกฎที่ตรวจอัตโนมัติได้ → อัพเดท checklist ในไฟล์ agent ในคอมมิทเดียวกัน** ไม่งั้น QC ตรวจไม่ครบ
· แนะนำรันก่อน merge งานใหญ่ + รันเต็มเป็นระยะเพื่อจับ drift ระหว่าง session ขนาน
> 📄 ประวัติผล audit ที่ตรวจ+แก้ไปแล้ว → `docs/modules/qc-audit-history.md`

## Design System

> ### ⚠️ บังคับอ่านก่อนแก้ UI ทุกครั้ง: `docs/UI-CONVENTIONS.md`
> **ช่องกรอกที่รับ "ชื่อคน / เลขเครื่อง / MAT / ลูกค้า / รหัสคลัง / ไลน์ / ทีม / ส่วนงาน" ห้ามเป็น `<input>` เปล่า
> หรือ datalist เอง — ใช้ picker กลางเท่านั้น** (§5.1.2 · คำสั่ง user 2026-09-07)
> มาตรฐานที่ทุก session ต้องทำเหมือนกัน — marker บนผัง (**วงกลม+ป้ายใต้ ห้ามเหลี่ยม** · MK สเกลตามผัง + edge clamp) ·
> Andon เขียว/เหลือง/แดง (**กระพริบเฉพาะแดง · เหลือง = นิ่ง**) · การ์ดสูงเท่ากันใน grid · ฟอนต์ขั้นต่ำ 11-12px (จอ TV) ·
> modal ผัง fit จอเดียวไม่มี scroll · hover เฉพาะอุปกรณ์มีเมาส์ · playhead ใช้ `.now-line`/`.now-chip` ·
> สิทธิ์ action ผ่าน `can()` **ห้าม hardcode role array**
> **สร้าง/เปลี่ยน pattern ที่ใช้หลายหน้า = อัพเดท `docs/UI-CONVENTIONS.md` (พร้อมวันที่) ในคอมมิทเดียวกัน**

### CSS Variables
`--bg`/`--bg2`/`--bg3` (พื้น 3 ระดับ) · `--card` · `--border`/`--border2` · `--accent` (green) ·
`--accent2` (amber) · `--text`/`--text2`/`--muted` · `--sidebar-w: 252px` · `--radius-lg: 8px`

### 📺 เพดานเบราว์เซอร์ = **จอ TV ไม่ใช่ PC** (วัดกับบันเดิลจริง 2026-08-26)

จอหน้างาน **LG 43UR751C0SC · webOS 23 = Chromium 94** ⇒ ผ่านทุกหน้า · webOS 22 (Cr 87) **หน้าที่มีกราฟพัง** · เก่ากว่า = จอขาว

> #### ⚠️ กฎเหล็ก — ห้ามใช้ CSS ที่ต้องการ Chromium > 94 กับค่าที่ "พังแล้วมองเห็น"
> - **ห้ามใช้ `color-mix()` (Cr 111)** — parse ไม่ได้ = **ทิ้งทั้งบรรทัด declaration** (เคยหลุดจริง → พื้นการ์ดโปร่งบนจอ TV)
>   แทนด้วย `background:'var(--card)'` + `backgroundImage: linear-gradient(${c}14, ${c}14)` หรือ alpha-hex `${color}14`
> - ห้ามเช่นกัน: `@container` (105) · CSS nesting (112) · `text-wrap:balance` (114) · `dvh/svh/lvh` (108) ·
>   `:has()` **ในที่ที่พังแล้วเสียการใช้งาน** (ตัวที่มีใน `index.css` ปล่อยไว้ได้ — เบราว์เซอร์เก่าทิ้งแค่ rule นั้น ไม่พัง)
> - **ตรวจก่อน merge:** `grep -oF "color-mix(" dist/assets/*` ต้องได้ 0
> 📄 ตารางฟีเจอร์ที่วัดจากบันเดิลจริง → `docs/UI-CONVENTIONS.md` §เพดานเบราว์เซอร์

### ⚠️ กับดัก CSS ที่เจอซ้ำหลายจุด (เหตุผล+เคสจริง → `docs/UI-CONVENTIONS.md` §7 + §7.1)

- **`color-scheme` ต้องประกาศคู่กับธีมเสมอ** — ไม่ประกาศ = ไอคอนปฏิทิน/นาฬิกา/ลูกศร select วาดดำทับพื้นเข้ม
  มองไม่เห็นทั้งระบบ · **ห้ามแก้รายจุดด้วย `filter: invert()`**
- **`position:sticky` เกาะจอได้เพราะ `<main>` ใน App.jsx เป็น `overflowX:'clip'` — ห้ามเปลี่ยนเป็น `hidden`/`auto`**
  · กล่องที่แค่ตัดของล้นใช้ `clip` · sticky ไม่ทำงาน ให้ไล่หาบรรพบุรุษที่ overflow ≠ visible/clip ก่อนแก้ที่หน้า
- **`display:grid` ที่อาจสูงกว่าเนื้อหา ต้องใส่ `alignContent:'start'`** (ไม่งั้นการ์ดถูกยืดสูงผิดสัดส่วน · flexbox ไม่เป็น)
- **จอ TV/บอร์ดหน้างาน ห้าม font 8–9px** — เริ่มที่ 11–12px (ชิป/ป้าย) · 14–15px (หัวข้อ)
- 🌑 **เงา = "ของชิ้นนี้ลอยอยู่" ห้ามเขียน rgba ดิบในหน้า** (ด่าน `card-shadow-via-token`) — การ์ดแบน `var(--shadow-sm)`
  (ธีมมืด = none · ธีมสว่างยังมี) · ของที่ลอยจริง `var(--shadow-float)` · modal `--shadow-md|lg` (UI §6.20)

### Breakpoints · Fonts
Mobile < 768px · Tablet 768–1279 · Desktop 1280–1599 · Ultra-wide ≥ 1600px ·
ฟอนต์ **Sarabun** (Thai body) / **Tahoma** (display)

## Shift Logic

| กะ | เวลา | OT |
|----|------|-----|
| กะเช้า (Day) | 08:00–17:30 | 17:30–20:00 |
| กะดึก (Night) | 20:00–07:59 | 20:00–22:30 |
| Extended OT | 20:00–23:00 | กะเช้าพิเศษ |

- **Team A/B** หมุนกะสลับกัน · **Team C** กะเช้าตลอด · **work date: ก่อน 08:00 = วันก่อนหน้า** (`getWorkDate()`)
- **วันหยุด = มา OT ทั้งกะ 4 รูปแบบ** (8/10 ชม. เช้า-ดึก) — ช่วงเวลา/label/default อ่านจาก **`src/utils/otPeriods.js` ที่เดียว ห้าม hardcode ซ้ำในหน้า**
- 🔴 **"วันหยุด" มี 2 ความหมาย ห้ามเช็ค `!= 'working'` แบบเหมา** — (ก) วันหยุดโรงงาน (kanban/LPA/แผนงาน · `shutdown75` นับเป็นหยุด) (ข) **วันหยุดแบบ OT** ใช้ `isOtHolidayType()`/`isOtHoliday()` ใน `companyCalendar.js` = **ot15/ot2 เท่านั้น**
> 📄 ตาราง 4 รูปแบบ OT + มาตรา 75 (`shutdown75`) + จุดจองทุกทาง + migration → `docs/modules/shift-ot.md`

> ### 🔴🔴 กฎเหล็กข้าม session — เวลาที่คนกรอก ต้อง resolve ด้วย "กรอบกะจริง" (2026-09-23)
> **ห้าม hardcode `shift === 'night' && ชั่วโมง < 8 = วันถัดไป`** — มีด่าน `regressionGuards` แล้ว
> กะดึกจบ 08:00+ ⇒ คนกรอก 5ส./ส่งกะ "08:00" ไม่เข้าเงื่อนไข → ถูกวางไว้ **ก่อนเปิดกะ 12 ชม.**
> (วัดจริง 15 แถว กะดึกล้วน · สูตรนี้เคยถูกก๊อปไว้ 3 จุดใน DailyReport)
> · **`resolveShiftTime(hhmm, session)` / `shiftWindow()` / `checkShiftTime()` ใน `src/utils/shiftWindow.js` เท่านั้น**
>   — เลือก offset วันจาก `start_time` + `shift_min`/`end_time` ของกะนั้น ไม่เดาจากเลขชั่วโมง
> · **ช่องกรอกเวลาทุกจุดต้องมีด่าน "อยู่ในกรอบกะไหม"** — หลุดกรอบ = ไม่ให้บันทึก
>   · ±12 ชม. แล้วเข้ากรอบ = **AM/PM สลับ** (จอ 12 ชม. ไม่แตะช่อง AM/PM = ค้างที่ AM) → เสนอแก้ให้คลิกเดียว
>   · **ห้ามดัดค่าที่คนกรอกให้เข้ากรอบเอง** — คงค่าไว้แล้วเตือน (ดัดให้ = เดาแทนคน)
> · `<input type="time">` เก็บค่า 24 ชม. แต่**แสดงผลตามเครื่อง** ⇒ ต้องทวนค่าเป็น 24 ชม. ให้เห็นข้างช่องเสมอ
> 📄 เคสจริง + ตัวเลข + ด่าน 3 ชั้น → `docs/modules/daily-report.md`


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

> 📄 ตารางของที่ยกไปใช้ต่อได้เลย (Auth/Toast/Telegram/4M workflow/SignatureModal ฯลฯ) → `docs/modules/reusable-pm-checker.md`

---

## 🔗 ลูปปิด 8D → PFMEA / PFC / Control Plan (2026-08-17 · คำสั่ง user)

ปิด 8D แล้ว ระบบย้อนกลับไปชี้เองว่าต้องแก้เอกสาร PE ตัวไหน บรรทัดไหน + ขยายผลข้ามพาร์ท (yokoten)
> 📄 รายละเอียดเต็ม → `docs/modules/closed-loop-8d-pfmea.md` (4 หัวข้อย่อย)

---
