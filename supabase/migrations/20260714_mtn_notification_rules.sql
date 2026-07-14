-- MTN Work-Order notification events — Main project (ewhdfqwfwofivojtsizn)
-- ส่งผ่าน edge function `send-mtn-notification` (แยกจาก send-notification) แต่ route ผ่าน
-- notification_rules เดียวกัน → ปรับ/ปิด/เลือกห้อง/แก้ข้อความได้จากหน้า /notification-config
-- category 'maintenance' · channel_ids ว่าง = เข้ากลุ่ม default (fallback) จนกว่าจะเลือกห้อง MTN
-- format ข้อความ mirror ระบบเดิม: mtn_reported (แจ้งซ่อม+รูปก่อน) · mtn_repaired (สรุปผลซ่อม+รูปหลัง) · mtn_closed (อนุมัติปิด)
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order) values
  ('mtn_reported', 'แจ้งซ่อม MTN ใหม่ (รอรับงาน)',  'maintenance', true, '{}', 30),
  ('mtn_repaired', 'สรุปผลซ่อม MTN (ซ่อมเสร็จ)',     'maintenance', true, '{}', 31),
  ('mtn_closed',   'ปิด MO (ซ่อมเสร็จ อนุมัติ)',     'maintenance', true, '{}', 32)
on conflict (event_key) do nothing;
-- ถ้าเคย seed เป็น mtn_assigned จากเวอร์ชันแรก ให้เปลี่ยนเป็น mtn_repaired
update public.notification_rules set event_key='mtn_repaired', label='สรุปผลซ่อม MTN (ซ่อมเสร็จ)' where event_key='mtn_assigned';
