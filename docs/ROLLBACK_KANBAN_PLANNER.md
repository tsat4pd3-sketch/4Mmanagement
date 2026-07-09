# Rollback Plan — Heijunka Kanban Smart Scheduling Planner

> สำหรับกรณีพบบัคหลัง merge ฟีเจอร์ "ตู้ KANBAN แม่นยำ + Smart Scheduling Planner" เข้า main
> (branch: `claude/fable-focus-kanban-accuracy-qga2hq`)

## จุดยึดก่อนเปลี่ยนแปลง (baseline)

- **main ก่อน merge:** commit `5143c32` — "Merge branch 'claude/youthful-mayer-5ztqqm' into main"
- ไฟล์ที่เปลี่ยนมีไฟล์เดียว: `src/pages/HeijunkaKanban.jsx` (ไม่มี migration / schema / Edge Function เปลี่ยน)
- ตาราง DB ที่ระบบเขียนยังใช้คอลัมน์เดิมทั้งหมด — ข้อมูลที่บันทึกระหว่างใช้เวอร์ชันใหม่ **ไม่ต้อง migrate กลับ**

## วิธี Rollback (เลือกอย่างใดอย่างหนึ่ง)

### วิธีที่ 1 — Revert merge commit (แนะนำ · ปลอดภัยสุด · ไม่แตะประวัติ)

```bash
git checkout main && git pull origin main
# หา SHA ของ merge commit ฟีเจอร์นี้
git log --oneline --merges | grep fable-focus-kanban
git revert -m 1 <merge-sha>
git push origin main
```

Render.com จะ auto-deploy main ที่ revert แล้วให้เอง

### วิธีที่ 2 — ย้อนเฉพาะไฟล์เดียวกลับ baseline (ถ้าอยากเก็บ commit อื่นบน main ไว้)

```bash
git checkout main && git pull origin main
git checkout 5143c32 -- src/pages/HeijunkaKanban.jsx
git commit -m "Rollback HeijunkaKanban to pre-planner baseline (5143c32)"
git push origin main
```

## รอบแก้ที่ 2 — Batch confirm บน Dashboard/Management timeline

- **main ก่อน merge รอบ 2:** commit `01889c4`
- ไฟล์ที่เปลี่ยน: `src/pages/Dashboard.jsx`, `src/pages/Management.jsx`
- เนื้อหา: ใบกัมบังที่พนักงานสแกนปิดรวดเดียวทั้งล็อต (ห่างกัน ≤5 นาที) จะถูกตัดสิน
  "ปิดช้า (ส้ม ✓!)" ที่ใบสุดท้ายของชุดเท่านั้น ไม่ตีส้มใบแรก ๆ ของชุดอีก
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 2>` หรือ
  `git checkout 01889c4 -- src/pages/Dashboard.jsx src/pages/Management.jsx`

## รอบแก้ที่ 3 — MES-style planner บน Dashboard Heijunka Board

- **main ก่อน merge รอบ 3:** commit `d9430ba`
- ไฟล์ที่เปลี่ยน: `src/pages/Dashboard.jsx` (ไฟล์เดียว, อ่านข้อมูลเพิ่มจาก `downtime_logs` คอลัมน์เดิม)
- เนื้อหา: (1) 🧠 PLANNER strip คาดการณ์เวลาเสร็จ + คำแนะนำเปิด OT ต่อไลน์/กะ
  (2) แถบ ⛔ downtime บนไทม์ไลน์ + tooltip ใบที่ดีเลย์บอกสาเหตุจาก downtime ที่คาบเกี่ยว
  (3) เลือกดู Heijunka Board ย้อนหลังรายวันได้ (date picker ที่หัว section)
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 3>` หรือ
  `git checkout d9430ba -- src/pages/Dashboard.jsx`

## รอบแก้ที่ 4 — กะดึก OT หัวกะ + port planner ไปหน้า Management

- **main ก่อน merge รอบ 4:** commit `d5b7e70` (+ commits อื่นของทีมที่เข้ามาระหว่างนั้น)
- ไฟล์ที่เปลี่ยน: `src/pages/Dashboard.jsx`, `src/pages/Management.jsx`
- เนื้อหา: (1) กะดึกใช้กติกาจริง — เข้าปกติ 22:30–08:00, เปิด OT = เข้า 20:00 แทน
  planner จะบอกก่อนกะเริ่มว่า "เข้า 22:30 ทัน" หรือ "ต้องเรียกเข้า 20:00"
  (2) หน้า Management mini Heijunka ได้ครบชุด: PLANNER strip + แถบ ⛔ downtime +
  tooltip สาเหตุดีเลย์ + ดูย้อนหลังรายวัน
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 4>`

## รอบแก้ที่ 5 — Customer Demand (Forecast + Shipping) หน้าใหม่

- ไฟล์ใหม่: `src/pages/CustomerDemand.jsx` · ไฟล์แก้: `src/App.jsx`,
  `src/pages/AddUser.jsx`, `src/pages/PermissionsManagement.jsx`
- **Database (ไม่ revert อัตโนมัติด้วย git):**
  - โปรเจค DR (`eyhclzkifitbhbljgoav`): ตารางใหม่ `demand_upload_batches`,
    `customer_forecasts`, `customer_shipping_orders` (ดู `docs/sql/04_customer_demand.sql`)
    — เป็นตารางใหม่ล้วน ไม่กระทบตารางเดิม ถ้าต้องถอน: `drop table customer_shipping_orders, customer_forecasts, demand_upload_batches;`
  - โปรเจคหลัก (`ewhdfqwfwofivojtsizn`): เพิ่มค่า enum `user_role` = 'sale'
    (enum value ลบไม่ได้ แต่ไม่มีผลข้างเคียงถ้าไม่มี user ใช้) + แถว `role_permissions`
    ของ `page:/customer-demand` และ role sale — ลบได้ด้วย
    `delete from role_permissions where permission_key = 'page:/customer-demand' or role = 'sale';`
- Rollback โค้ด: `git revert -m 1 <merge-sha รอบ 5>` — หน้าใหม่หายไป ตาราง DB คงอยู่เฉยๆ ไม่มีใครเรียกใช้

## รอบแก้ที่ 6 — รองรับไฟล์ EDI จริง (Ford/AAT 830·862)

- ไฟล์แก้: `src/pages/CustomerDemand.jsx` · DB: เพิ่มคอลัมน์ `customer_part_no`, `source`,
  `dock_code` (nullable/default — ไม่กระทบข้อมูลเดิม, ดูท้าย `docs/sql/04_customer_demand.sql`)
- นำเข้า EDI เป็นแบบ "แทนที่ฉบับเดิมของ ship-to" — ถ้า rollback โค้ด ข้อมูลที่นำเข้าแล้วยังอยู่ครบ
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 6>`

## รอบแก้ที่ 7 — Ship-to Config + EDI เข้า Dashboard planner

- ไฟล์แก้: `src/pages/CustomerDemand.jsx`, `src/pages/Dashboard.jsx`
- DB (โปรเจค DR): ตารางใหม่ `ship_to_plants` (config code→ลูกค้า, seed code จากไฟล์ชุดแรก)
  — ถอนได้ด้วย `drop table ship_to_plants;`
- Dashboard planner อ่าน `customer_shipping_orders` เพิ่ม (read-only) เพื่อพยากรณ์กะดึกล่วงหน้า
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 7>`

## รอบแก้ที่ 8 — ลบ Ship-to code + วงจร FG stock พร้อมส่ง

- ไฟล์แก้: `src/pages/CustomerDemand.jsx`, `src/pages/Dashboard.jsx` (ไม่มี schema ใหม่)
- Ship-to config: เพิ่มปุ่มลบ + เปิดสิทธิ์ให้ supervisor จัดการได้
- FG stock: Shipping Chart แสดงความพร้อมส่งจาก `line_stock_summary` (FIFO ต่อรอบ),
  กด "ส่งแล้ว" จะ insert `line_stock_transactions` type consume หักคลังอัตโนมัติ,
  Dashboard planner หัก stock พร้อมส่งก่อนคำนวณยอดผลิตกะดึก
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 8>` — แถว consume ที่เกิดแล้ว
  ลบ/แก้ได้จากหน้า Line Stock ตามปกติ

## รอบแก้ที่ 9 — แจ้งเตือน Smart Logistic (EDI/Shipping)

- ไฟล์แก้: `src/pages/CustomerDemand.jsx`, `src/pages/NotificationConfig.jsx`,
  `supabase/functions/send-notification/index.ts`
- **Edge function `send-notification` deploy เป็น v28** (โปรเจคหลัก) — เพิ่ม 3 event:
  `edi_import`, `shipping_shipped`, `shipping_overdue` + sync `pm_plan_reminder` ที่ repo ตกหล่น
  ถ้าต้อง rollback edge function: redeploy โค้ดจาก commit ก่อนหน้า (v27 = repo ก่อน merge รอบนี้ + pm_plan_reminder)
- DB: แถว `notification_rules` 3 แถว (category logistic, ผูกห้อง Smart Logistic แล้ว) —
  ปิดได้จากหน้า ตั้งค่าการแจ้งเตือน หรือ `delete from notification_rules where category='logistic';`
  + คอลัมน์ `customer_shipping_orders.overdue_notified_at` (DR)
- Rollback โค้ด: `git revert -m 1 <merge-sha รอบ 9>` — event จะไม่ถูกยิงอีก edge function มี handler ค้างไว้ไม่เป็นไร

## รอบแก้ที่ 10 — Standard Workflow ส่งงาน (walkback 4 activity) + scanner cron

- ไฟล์แก้: `src/pages/CustomerDemand.jsx`, `src/pages/NotificationConfig.jsx`,
  ไฟล์ใหม่: `supabase/functions/shipping-phase-scan/index.ts` + migrations 20260710_*
- **DB (DR):** ตาราง `shipping_workflow_steps` (4 เฟส default: ยืนยันออเดอร์ 240 → เตรียม 120
  → โหลด 60 → ถึงลูกค้า 0 นาที, override รายลูกค้าได้) + `shipping_phase_alerts` (dedup)
  + สถานะ order เพิ่ม 'confirmed', 'loaded' — ถอน: drop 2 ตาราง + คืน check constraint เดิม
- **Edge functions:** `shipping-phase-scan` (DR, v2) รันทุก 10 นาทีผ่าน pg_cron
  (`select cron.unschedule('shipping-phase-scan');` เพื่อหยุด) ·
  `send-notification` (หลัก) deploy v29 เพิ่ม event `shipping_phase_alert`
- rule ใหม่: `shipping_phase_alert` (logistic, ผูก Smart Logistic แล้ว)
- การเตือน "เลยเวลา" ฝั่ง client ถูกถอด — scanner เป็นคนแจ้งแทน (ทำงานแม้ไม่มีใครเปิดหน้า)
- Rollback โค้ด: `git revert -m 1 <merge-sha รอบ 10>` + unschedule cron ถ้าไม่อยากให้แจ้งต่อ

## รอบแก้ที่ 11 — บอร์ดเวลาภายในโรงงาน (Rack Center + Store)

- ไฟล์แก้: `src/pages/RackCenter.jsx`, `src/pages/LineStock.jsx` ·
  ไฟล์ใหม่: `src/components/InternalTimeBoard.jsx` (บอร์ดเวลา reusable กรอบ 08:00→08:00),
  `src/utils/timeFrame.js` (helper แปลงเวลาเป็นนาทีบนกรอบวันงาน)
- Rack Center: เพิ่มปุ่มสลับ 3 มุมมอง (📋 บอร์ดสถานะเดิม / 🕐 บอร์ดเวลา / ⚙️ ตั้งค่า SLA)
  — มุมมองเดิมไม่ถูกแตะ แค่ห่อด้วยเงื่อนไข view
- Store (Line Stock): เพิ่ม tab ใหม่ 🕐 บอร์ดเวลา (read-only monitor รอบส่ง kanban)
  — tab เดิมทั้งสองไม่ถูกแตะ
- **DB (โปรเจค DR):** ตารางใหม่ `internal_delivery_sla` (เกณฑ์ SLA rack: เตรียม 15 นาที /
  ส่งถึง 45 นาที, RLS to public ตามกฎ DR) — migration: `20260710_internal_delivery_sla.sql`
  ถอนได้ด้วย `drop table if exists internal_delivery_sla;`
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 11>` — ไม่มีผลกับข้อมูล kanban/rack เดิม

## รอบแก้ที่ 12 — มาตรฐานบอร์ดเวลา (now-line/เงาเบรค) + แยกหน้า Planner & Sales / Delivery

- **มาตรฐานบอร์ด:** `InternalTimeBoard.jsx` (Rack Center + Store) และ Shipping Chart
  (หน้า Delivery) ได้ playhead ชมพู `.now-line` + ป้ายเวลา `.now-chip` + แถบลายเฉียง
  ช่วงเวลาพักจาก `break_policies` — มาตรฐานเดียวกับบอร์ด Heijunka (helper ใหม่
  `breaksToFrame` ใน `src/utils/timeFrame.js`)
- **แยกหน้า:** `src/pages/PlannerSales.jsx` (ใหม่ · route `/planner-sales` · Forecast
  Planner + อัพโหลด Sales ย้ายมาทั้งก้อน) — `CustomerDemand.jsx` เดิมกลายเป็นหน้า
  🚚 Delivery (เหลือ Shipping Chart + Ship-to Config) route `/customer-demand` เดิม
- ไฟล์แก้: `App.jsx` (route+เมนู), `PermissionsManagement.jsx` (เพิ่ม key หน้าใหม่)
- **DB (โปรเจคหลัก):** แถว `role_permissions` ของ `page:/planner-sales` (copy จาก
  `/customer-demand`: manager/supervisor/leader/qa/sale) — ถอน:
  `delete from role_permissions where permission_key = 'page:/planner-sales';`
- Rollback โค้ด: `git revert -m 1 <merge-sha รอบ 12>` — ข้อมูล forecast/order ไม่ถูกแตะ

## สิ่งที่ต้องรู้ตอน rollback

1. **ยอดสต็อกจาก "ยืนยันส่ง" ต่างกันสองเวอร์ชัน** — เวอร์ชันใหม่บันทึก `line_stock_transactions`
   เป็นยอด NET เฉพาะรอบนั้น (ถูกต้อง) ส่วนเวอร์ชันเก่าบันทึกยอดทั้งวันตั้งแต่รอบแรก
   ถ้า rollback กลางวันงาน ให้เช็คยอดคงเหลือที่ 📦 Line Stock ของวันนั้นด้วย
2. ธุรกรรมที่เกิดไปแล้วเป็นแถวปกติในตาราง ลบ/แก้ได้จากหน้า Line Stock ตามขั้นตอนปกติ
3. หน้าที่ควรทดสอบหลัง rollback: `/heijunka` ทุก view (ตู้รวม / Store Board / Heijunka Board /
   Pull / การ์ด / ตาราง) + การยืนยันส่งและรับของ 1 รอบ
