-- แจ้งเตือนในแอป (กระดิ่ง+เสียง+Web Push) ต่อเรื่อง — เลือกผู้รับตาม role (Main project)
-- แต่ละเรื่องใน notification_rules ตั้งได้ว่า role ไหนควรได้รับ "ในแอป" ด้วย (นอกจาก Telegram)
-- ตั้งจากหน้า /notification-config · edge send-notification อ่าน inapp_roles แล้ว insert notifications
-- ให้ user ตาม role นั้น → trigger trg_notify_push ยิง push ต่อเอง · additive/idempotent
alter table public.notification_rules
  add column if not exists inapp_roles text[] not null default '{}';
