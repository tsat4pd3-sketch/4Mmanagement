-- ═══════════════════════════════════════════════════════════════════════════
-- 📥 บล็อก "ใบที่รอฝ่ายผู้แจ้งดำเนินการ" ในสรุปงานซ่อมเช้า — Main project
--    (ewhdfqwfwofivojtsizn · ชื่อในจอ Supabase = "MAIN")            2026-09-16
--
-- ที่มา: ใบซ่อมค้างเกิน 7 วันพุ่ง 53 (11/09) → 69 (15/09) → 90 (16/09)
--   วัดฐานจริง 16/09: เปิดอยู่ 196 ใบ · ค้างเกิน 7 วัน 100 ใบ
--     → **129 ใบ (66%) รออยู่ที่ "ฝั่งผู้แจ้ง"** (ขั้น 4 ตรวจรับงานหลังซ่อม · ขั้น 6 รับมอบ · ขั้น 7 อนุมัติปิด)
--     → ในใบค้างเกิน 7 วัน **83 จาก 100 ใบเป็นของฝั่งผู้แจ้งล้วนๆ**
--   แต่สรุปเช้าเดิมส่งเข้าห้องช่างอย่างเดียว ⇒ เตือนผิดคนมาตลอด ใบจึงไม่มีวันถูกเคลียร์
--
-- ทำอะไร: seed แถว event `mtn_pickup_pending` ให้ admin ปิด/ย้ายห้อง/แก้ผู้รับได้เองที่
--   /notification-config (ไม่ hardcode ห้อง/ผู้รับในโค้ด edge)
--   · Telegram default = 🏭 Smart Production (ห้องฝั่งผลิต ไม่ใช่ห้องช่าง)
--   · กระดิ่งในแอป = supervisor/leader/manager + inapp_match_section = true
--     ⇒ ยิงถึงเฉพาะคนในส่วนงานของไลน์ที่แจ้ง (edge ส่ง p_section ให้ notify_recipients)
--
-- ย้อนกลับ: delete from notification_rules where event_key = 'mtn_pickup_pending';
--   (ลบแถว = edge เห็นเป็น event ที่ยังไม่ตั้งค่า → ส่งเข้าห้อง default เดิม ไม่พัง
--    ต้องการปิดสนิทให้ set is_enabled = false แทน)
-- ═══════════════════════════════════════════════════════════════════════════

insert into notification_rules
  (event_key, label, category, is_enabled, sort_order, channel_ids, inapp_roles, inapp_match_section)
values (
  'mtn_pickup_pending',
  'ใบซ่อมที่รอฝ่ายผู้แจ้งดำเนินการ (ขั้น 4/6/7) — สรุปเช้า 09:00',
  'maintenance',
  true,
  38,
  array['6a22ce67-6f83-4b00-bdf8-7de41254b2ab']::uuid[],   -- 🏭 Smart Production
  array['supervisor', 'leader', 'manager'],
  true
)
on conflict (event_key) do nothing;   -- รันซ้ำได้ · ไม่ทับค่าที่ admin ปรับไปแล้ว
