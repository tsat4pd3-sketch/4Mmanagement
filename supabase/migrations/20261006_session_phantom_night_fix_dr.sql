-- ══════════════════════════════════════════════════════════════════════════════════════
-- DR project (eyhclzkifitbhbljgoav · ชื่อในจอ "Product DB")  ·  apply แล้ว 2026-10-06
--
-- แก้ใบผี 1 ใบ: LINE C ( 200&250 Ton ) · work_date 2026-10-05 · กะดึก
--   id = e7700b2c-3b1e-403c-bc23-d67963a4280d
--
-- เกิดอะไรขึ้น (อ่านจากข้อมูล ไม่ใช่เดา):
--   · created_at 2026-10-05 07:40 (ไทย) · closed_at 07:41 — ใบนี้มีอายุ **1 นาที**
--   · prod_orders 0 ใบ · downtime_logs 0 ใบ · defect_logs 0 ใบ · actual_qty 0 · oee ทุกตัว null
--   · กะดึกจริงของ 05/10 คืออีกใบ (1a319c49 · 20:54 → 07:53 · 2,000 ชิ้น · OEE 34.16) — ใบนั้นถูกต้อง ไม่แตะ
--
-- ต้นเหตุ (แก้ที่โค้ดแล้วในคอมมิทเดียวกัน → `openShiftDefaults()` ใน `src/utils/workDate.js`):
--   ปุ่ม "+ เปิดกะใหม่" รีเฟรช `shift` จากนาฬิกา แต่ปล่อย `work_date` ค้างค่าเดิม
--   ⇒ ตอน 07:40 กะออโต้เป็น "ดึง" (กะดึก = 20:00–07:59) ขณะที่วันยังเป็นวันปฏิทินวันนี้
--   ⇒ ได้ "กะดึกของวันนี้" ที่เริ่ม 20:00 คืนนี้ = เปิดล่วงหน้า 12 ชม. · คนรู้ว่าผิดจึงปิดทิ้งทันที
--   แต่ `end_time` ตอนปิดถูกเดาเป็น 08:00 (default เก่าของกะดึก) ⇒ shift_min = 720
--   ⇒ ไทม์ไลน์ลากแถบเขียว 12 ชม. + จอเตือน "ปลายกะไม่มีอะไรรองรับ 1,459 นาที"
--   (ด่าน `checkCloseTime` ที่เพิ่ม 05/10 กันเคสนี้แล้ว — ใบนี้เกิดก่อนด่าน)
--
-- ที่แก้: start_time 07:40 · end_time 07:41 · shift_min 1 = อายุจริงของใบ
--   🔴 **ต้องตั้ง `start_time` ด้วย ไม่ใช่แค่ `end_time`** — รอบแรกตั้งแค่ end_time = 07:41 แล้วพบว่า
--      กฎข้ามวันของกะดึก (`end_time < start_time` ⇒ +1 วัน) ตีความเป็น 07:41 ของ **06/10**
--      ⇒ ahead พุ่งเป็น 1,440 นาที (แย่กว่าเดิม) · ตั้งคู่กันแล้วไม่มี wrap ⇒ ahead = 0
--   🔴 ไม่ใช่การเดาแทนคน — created_at/closed_at คร่อมอายุทั้งหมดของใบ และยอดผลิตเป็น 0
--      (ต่างจาก 4 ใบใน `daily-report.md` §เลิกแผน backfill ที่ "เลิกผลิตจริงกี่โมง" ไม่มีใครรู้)
--   🔴 ไม่ย้าย `work_date` ไป 04/10 — จะกลายเป็นอ้างว่าไลน์เดิน 707 นาทีในวันที่ 04/10 โดยไม่มียอด
--   🔴 ไม่ลบแถว — เก็บประวัติว่ามีการเปิดผิดแล้วปิด (ตารางนี้ไม่มีสถานะ 'cancelled')
--   🔴 ไม่แตะ OEE — null อยู่แล้วทั้ง 4 คอลัมน์ และไม่มีใบผลิต/DT/ของเสียให้คิดใหม่
--
-- ค่าเดิม (ไว้ย้อน): start_time '20:00:00' · end_time '08:00:00' · shift_min 720
-- rollback:
--   update production_sessions set start_time = '20:00:00', end_time = '08:00:00', shift_min = 720
--    where id = 'e7700b2c-3b1e-403c-bc23-d67963a4280d';
-- ══════════════════════════════════════════════════════════════════════════════════════

update production_sessions
   set start_time = '07:40:00',
       end_time   = '07:41:00',
       shift_min  = 1
 where id = 'e7700b2c-3b1e-403c-bc23-d67963a4280d'
   -- เงื่อนไขนี้คือ "นิยามของใบผี" — รันซ้ำได้ และถ้ามีใครมาแก้/มีข้อมูลผูกแล้วจะไม่แตะ
   and coalesce(actual_qty, 0) = 0
   and closed_at - created_at < interval '5 min'
   and not exists (select 1 from prod_orders   o where o.session_id = production_sessions.id)
   and not exists (select 1 from downtime_logs d where d.session_id = production_sessions.id)
   and not exists (select 1 from defect_logs   f where f.session_id = production_sessions.id);
