-- สิทธิ์ + แจ้งเตือน "แผนประสานงาน PM ข้ามวัน" — Main project (ewhdfqwfwofivojtsizn)
-- page:/pm-coordination  → ทุก role เข้าดูได้ (Production ต้องเห็นแผนที่ MTN นัด)
-- pm_coord:manage        → สร้าง/แก้/ลบ/แจ้ง : admin/manager/supervisor/mtn/engineer/leader (ทีมช่าง+หัวหน้า)
-- ⚠️ role ที่เพิ่มทีหลังต้อง seed เพิ่มเอง (fail-closed)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/pm-coordination', true
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into public.role_permissions (role, permission_key, allowed)
select r, 'pm_coord:manage', (r::text in ('admin','manager','supervisor','mtn','engineer','leader'))
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

-- แจ้งเตือนแผนประสานงาน (ยิงจากหน้า /pm-coordination → send-notification event 'pm_coordination')
-- category maintenance · channel_ids ว่าง = ห้อง default จนกว่าจะเลือกห้องที่ /notification-config
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, sort_order) values
  ('pm_coordination', 'แผนประสานงาน PM (แจ้ง Production)', 'maintenance', true, '{}', 39)
on conflict (event_key) do nothing;
