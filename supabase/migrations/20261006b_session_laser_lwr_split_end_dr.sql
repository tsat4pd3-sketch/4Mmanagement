-- ══════════════════════════════════════════════════════════════════════════════════════
-- DR project (eyhclzkifitbhbljgoav · "Product DB")  ·  apply แล้ว 2026-10-06
--
-- Laser LWR · work_date 2026-09-24 · กะดึก · ใบแรกของกะที่ถูก "แบ่งเป็น 2 ใบ"
--   id = 8c7f1274-18be-4893-8e18-feda889d7363
--
-- กะนี้ถูกเปิด 2 ใบต่อกัน (unique index กันแค่ "เปิดค้างพร้อมกัน" ⇒ ปิดแล้วเปิดใหม่ได้ตามดีไซน์):
--   ใบ 1 (ใบนี้)  สร้าง 20:33 → ปิด **22:33** · ใบผลิต 1 ใบ confirm 22:07 · DT 2 ใบ (setup 20:00-20:30 · รอ QA 20:30-20:40)
--                 ยอด 0 · OEE null ทั้ง 4 · แต่ `end_time` ค้างที่ default **08:00** ⇒ shift_min 720
--   ใบ 2          สร้าง **22:35** (2 นาทีหลังปิดใบ 1) → end 01:30 · shift_min 330 · 164 ชิ้น · OEE 94.86
--
-- ⇒ ใบ 1 คือครึ่งแรกของกะ (เตรียมเครื่อง/รอ QA) แล้วส่งต่อให้ใบ 2 เดินงานจริง
--    **เวลาเลิกของใบ 1 ไม่ใช่เรื่องที่ต้องเดา** — มีใบถัดไปเกิดขึ้น 22:35 เป็นพยาน
--    (ต่างจาก 3 ใบที่เหลือใน `daily-report.md` §เลิกแผน backfill ที่ไม่มีอะไรบอกเวลาจริง)
--
-- ที่แก้: end_time 08:00 → 22:33 · shift_min 720 → 153  (ปลายกะล้ำหน้า 567 → 0 นาที)
--   🔴 ไม่แตะ OEE — null อยู่แล้วทั้ง 4 คอลัมน์ (ไม่มีค่าที่ stamp ไว้ให้เสีย)
--   🔴 ไม่แตะ `start_time` ของใบนี้ — กะเริ่ม 20:00 จริง (DT setup เริ่ม 20:00)
--   🔴 **ไม่แตะใบ 2** ทั้งที่ `start_time` 20:00 ของมันก็เป็นค่า default (งานจริงเริ่ม ~22:35)
--      เพราะใบ 2 **มี OEE stamp ไว้แล้ว** (คิดบนฐาน 330 นาที) ⇒ แก้เวลาต้องคิด OEE ใหม่ด้วย
--      ซึ่งต้องทำผ่าน `computeSessionOee` (ห้ามเขียนสูตรใน SQL) · ให้เจ้าของกะกดแก้เวลาจากหน้า
--      Daily Report ซึ่งคำนวณใหม่ให้เอง · ผลข้างเคียงที่เหลือ = ช่วง 20:00-22:33 ยังทับกัน 2 ใบ
--      **แต่แคบลงจาก 330 → 153 นาที** (ก่อนแก้ใบ 1 คลุม 20:00-08:00 ทับใบ 2 ทั้งใบ)
--
-- ค่าเดิม (ไว้ย้อน): end_time '08:00:00' · shift_min 720
-- rollback:
--   update production_sessions set end_time = '08:00:00', shift_min = 720
--    where id = '8c7f1274-18be-4893-8e18-feda889d7363';
-- ══════════════════════════════════════════════════════════════════════════════════════

update production_sessions
   set end_time  = '22:33:00',
       shift_min = 153
 where id = '8c7f1274-18be-4893-8e18-feda889d7363'
   and end_time = '08:00:00' and shift_min = 720
   and oee is null and oee_a is null and oee_p is null and oee_q is null
   -- พยาน: ต้องมีใบถัดไปของ (ไลน์+วัน+กะ) เดียวกัน เกิดภายใน 15 นาทีหลังใบนี้ปิด
   and exists (select 1 from production_sessions nx
                where nx.line_name = production_sessions.line_name
                  and nx.work_date = production_sessions.work_date
                  and nx.shift     = production_sessions.shift
                  and nx.id <> production_sessions.id
                  and nx.created_at between production_sessions.closed_at
                                         and production_sessions.closed_at + interval '15 min');
