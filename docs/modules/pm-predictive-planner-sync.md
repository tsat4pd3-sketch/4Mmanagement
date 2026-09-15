# PM Predictive & Planner Sync — เห็นวัน PM ล่วงหน้า + buffer (2026-07-16)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


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

> ### ⭐ แผน PM "วิ่งตามผลตรวจ" แล้ว (2026-08-17 · feedback ทีมงาน "PM แผนยังไม่วิ่งหากัน")
> เดิมบันทึกผลตรวจใน **PMCheckData ไม่เคย stamp `pm_plans`** (มีแค่ปิดแผนประสานงาน PmCoordination ที่ stamp) → ตรวจแล้วแผนไม่เลื่อน: PMSchedule มี fallback อ่าน inspections แต่ **PmForecast / MtnMachineLayout / DeptDashboard อ่าน `pm_plans` ตรง** เลยเห็นแผนค้างทั้งที่ตรวจไปแล้ว
> **กติกาปัจจุบัน (`handleSave` ใน PMCheckData):** ตรวจ**ครบทุกจุด** (overall = pass/**fail ก็นับ** — PM ทำจริงแล้วแค่เจอของเสีย) → stamp `last_done_at` = วันนี้ (local date ห้าม toISOString) + แผน `plan_type !== 'usage'` ที่มี `interval_days` เลื่อน `next_due_date = วันทำ + interval` (สูตรเดียวกับ PmCoordination) · **`pending` (ตรวจไม่ครบ) ไม่นับว่าทำ PM จบ — ไม่เลื่อนรอบ** · วันเดียวกัน stamp ครั้งเดียว (AM ตรวจทุกกะไม่เขียนซ้ำ) · best-effort: พลาด = toast บอก ไม่ทำ save หลักพัง **ห้ามเงียบ**

### 🗑️ ลบอุปกรณ์ทดสอบ "TEST1 - 99" ออกจากระบบ PM (2026-09-09 · คำสั่ง user)

**เหตุ:** ยิง Telegram `🔴 ยังไม่ได้ทำ PM — เกินกำหนดมาแล้ว N วัน · TEST1 - 99 · ไลน์ test`
ทุกสัปดาห์ตั้งแต่ 11 ก.ค. (ครบกำหนด 23 ก.ค. → เกิน 48 วัน) รวม **11 ครั้ง = 31% ของการเตือน PM
ทั้งหมดในระบบ** — ของปลอมกลบของจริงจนคนเริ่มไม่อ่านข้อความเตือน
(`stageFor()` ใน `pm-plan-reminder` แตก stage `overdue_w1..wN` เตือนซ้ำรายสัปดาห์ **ไม่มีที่สิ้นสุด** —
ถูกต้องสำหรับของจริง แต่ไม่มีตัวกรองข้อมูลทดสอบ/แผนที่ตายแล้ว)

**migration `20260909_purge_test1_99_pm_equipment.sql` (DR · apply แล้ว 2026-09-09)**
วัดก่อนลบ ยืนยันว่าไม่มีของจริงอ้างถึง: `downtime_logs` 0 · `mtn_orders` 0 · `equipment_die` 0 ·
`pm_daily_alerts` ไลน์ `test` 0 · `pm_plan_deferrals` 0 · แถว `machines`(`TEST1`) ปิด `is_active` อยู่แล้ว
**ลบไป:** jigs 1 · checklists 1 · jig_checkpoints 4 · inspections 6 · inspection_results 24 ·
pm_plans 1 · pm_plan_reminders 11 · jig_images 8 · pm_daily_line_targets 1
**สำรองครบทุกแถวใน `*_bak_test1_20260909` 9 ตาราง** (ย้อนได้ · ลำดับ insert กลับอยู่ท้ายไฟล์ migration)
· ไฟล์รูป 8 ไฟล์ใน bucket กลายเป็นกำพร้า → `cleanup-orphan-photos` เก็บกวาดเองตามรอบ
· แถว `machines` `TEST1` ปล่อยไว้ (inactive · ไม่โผล่ dropdown ไหน ไม่ยิงเตือน)

**ผลหลังลบ (วัดจริง):** คิว "รออนุมัติ" **14 → 8 ใบ** (6 ใบที่หายเป็นของ TEST1 ล้วน) ·
แผน PM เกินกำหนด **3 → 2** เหลือของจริง `AUTOLOAD-03` (HDF1) กับ `BD-03` (HDF1)

**บทเรียน:** ตัวเตือนอัตโนมัติที่ยิงซ้ำไม่มีเพดาน + ไม่มีด่านกรองข้อมูลทดสอบ = **notification fatigue**
คนเลิกอ่านทั้งช่อง ของจริงก็เลยหลุดตาม (คลาสเดียวกับ 4M อัตโนมัติ 323 ใบค้างคิวจนกลบใบจริง 19 ใบ)
· **ห้ามสร้างข้อมูลทดสอบบนไลน์/อุปกรณ์จริงในฐาน production** — ถ้าเลี่ยงไม่ได้ ต้องมีวันหมดอายุหรือ flag
ให้ตัวเตือนข้ามเอง · `production_lines` ฝั่ง Main ยังมีไลน์ `test` / `test child` / `test child 2`
(section `TEST`) อยู่ — ไม่มีอุปกรณ์ผูกแล้ว แต่ยังโผล่ใน dropdown เลือกไลน์ (ยังไม่ลบ รอ user ยืนยัน)
