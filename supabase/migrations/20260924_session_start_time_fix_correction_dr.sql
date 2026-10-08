-- ══════════════════════════════════════════════════════════════════════════════
-- แก้ให้ถูก: 2 กะใน `20260924_session_start_time_fix_dr.sql` ตั้งเวลาเปิดกะผิด (DR · 2026-09-24)
--
-- 🔴 บทเรียน — **`prod_orders.opened_at` ไม่ใช่หลักฐานว่า "กะเปิดตอนกี่โมง"**
--    รอบแรกตั้ง Assy LWR 23/07 + 24/07 เป็น `20:00` เพราะใบผลิตใบแรกมี `opened_at = 20:00`
--    แต่ `opened_at` **ถูกเขียนทับได้** จาก 2 ทาง: ปุ่ม "✏️ แก้เวลากะ" (ช่องเวลาต่อ MAT.NO
--    เขียนกลับลง `prod_orders.opened_at` ดู `handleSaveTimes`) · และใบ ⏪ เปิดย้อนหลังที่คนกรอกเวลาเอง
--
-- ✅ หลักฐานที่ใช้แทน (แก้ไม่ได้จาก UI ไหนเลย):
--    1. `production_sessions.created_at` = เวลาที่กดเปิดกะจริง → 23/07 = 21:30 · 24/07 = 22:05
--    2. `downtime_logs.created_at` = เวลาที่กดบันทึกจริง (คนละตัวกับ `started_at` ที่พิมพ์เอง)
--       → แถวแรกของทั้ง 2 กะคือ "Set up Machine" พิมพ์ 22:00 บันทึกจริง 22:50 / 22:42
--    3. ไลน์พี่น้องคืนเดียวกัน (Assy GOR · Laser GOR 23/07) เปิด 22:00 เหมือนกัน
--       และมีคู่ `Set up Machine 30 น. → รอ QA 10 น.` ที่ 22:00/22:30 เป็นลายเซ็น "เริ่มกะ"
--  ⇒ เวลาเปิดกะที่ถูกคือ **22:00** ไม่ใช่ 20:00 (ตั้ง 20:00 = เสกเวลาว่าง 2 ชม. ที่ไม่มีหลักฐาน
--    ⇒ %P ร่วงผิดๆ · 23/07 OEE 68.62 → ที่ถูก 76.30 · 24/07 47.40 → ที่ถูก 62.74)
--
-- OEE คำนวณใหม่ด้วย `computeSessionOee()` (oee.js §8) เหมือนรอบแรก
-- ตาราง archive.session_start_time_fix_20260924 ถูกอัพเดท `new_*` ให้ตรงด้วย ⇒ rollback ยังใช้ได้เหมือนเดิม
-- ══════════════════════════════════════════════════════════════════════════════
with fix(id, new_start, new_shift_min, new_a, new_p, new_q, new_oee, new_ct) as (values
  ('27b34826-8143-4e8c-9d12-6aaf8bac3b01'::uuid, '22:00:00'::time, 600, 84.36, 90.44, 100, 76.30, '{"10100379": 54}'::jsonb),
  ('361d3658-0963-47c4-b134-bf4bc4e9888f'::uuid, '22:00:00'::time, 600, 83.82, 74.84, 100, 62.74, '{"10100333": 54, "10100379": 54}'::jsonb)
)
update archive.session_start_time_fix_20260924 b
set new_start_time = f.new_start, new_shift_min = f.new_shift_min,
    new_oee_a = f.new_a, new_oee_p = f.new_p, new_oee_q = f.new_q, new_oee = f.new_oee,
    new_ct_snapshot = f.new_ct
from fix f where f.id = b.id;

update production_sessions s
set start_time  = b.new_start_time,
    shift_min   = b.new_shift_min,
    oee_a       = b.new_oee_a,
    oee_p       = b.new_oee_p,
    oee_q       = b.new_oee_q,
    oee         = b.new_oee,
    ct_snapshot = b.new_ct_snapshot
from archive.session_start_time_fix_20260924 b
where b.id = s.id
  and s.id in ('27b34826-8143-4e8c-9d12-6aaf8bac3b01','361d3658-0963-47c4-b134-bf4bc4e9888f');
