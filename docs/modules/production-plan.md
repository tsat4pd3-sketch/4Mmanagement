# Production Plan — วางแผนการผลิต (Active Planner, 2026-07-15)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


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
