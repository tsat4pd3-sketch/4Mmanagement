-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- สิทธิ์หน้า 🎮 รีโมทจอ (/remote) — มือถือคุมจอ TV ที่เปิด "รับรีโมท" ผ่าน Supabase Realtime
-- ทุก role ใช้ได้ (ฝั่งรีโมทสั่งได้แค่ pointer/คลิก/เลื่อน/เปลี่ยนหน้า — สิทธิ์เข้าหน้าเป็นของฝั่งจอที่ login เอง
-- และจอต้อง opt-in เปิดรับรีโมทเองเสมอ) · ปลอดภัยต่อการรันซ้ำ
insert into role_permissions (role, permission_key, allowed)
select r.role, 'page:/remote', true
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;
