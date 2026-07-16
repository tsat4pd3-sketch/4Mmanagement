-- MTN Work-Order notification events — Main project (ewhdfqwfwofivojtsizn)
-- ส่งผ่าน edge function `send-mtn-notification` (แยกจาก send-notification) แต่ route ผ่าน
-- notification_rules เดียวกัน → ปรับ/ปิด/เลือกห้อง/แก้ข้อความได้จากหน้า /notification-config
-- category 'maintenance' · channel_ids ว่าง = เข้ากลุ่ม default (fallback) จนกว่าจะเลือกห้อง MTN
-- แจ้งครบทุกสเตป (คำสั่ง user 2026-07-14) · format mirror ระบบเดิม · แนบรูปตามสเตป (ก่อน/หลัง/QA)
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order) values
  ('mtn_reported', 'แจ้งซ่อม MTN ใหม่ (step1)',       'maintenance', true, '{}', 30),
  ('mtn_assigned', 'MTN รับงาน + ออกเลข MO (step2)',  'maintenance', true, '{}', 31),
  ('mtn_repaired', 'สรุปผลซ่อม (ซ่อมเสร็จ step3)',     'maintenance', true, '{}', 32),
  ('mtn_checked',  'ตรวจสอบหลังซ่อม (step4)',         'maintenance', true, '{}', 33),
  ('mtn_qa',       'ยืนยันคุณภาพหลังซ่อม (step5)',     'maintenance', true, '{}', 34),
  ('mtn_handover', 'รับมอบหลังซ่อม (step6)',           'maintenance', true, '{}', 35),
  ('mtn_closed',   'อนุมัติปิด MO (step7)',            'maintenance', true, '{}', 36)
on conflict (event_key) do nothing;
