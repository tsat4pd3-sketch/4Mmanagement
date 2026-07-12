-- ═══════════════════════════════════════════════════════════════════
-- สิทธิ์โมดูล Improvements — Main project (ewhdfqwfwofivojtsizn)
-- page:/improvements       → ทุก role เข้าดูได้ (แนวเดียวกับ /daily-report)
-- improvements:manage      → สร้าง/แก้/ลบ/เปลี่ยนสถานะ: admin/manager/supervisor/leader
-- ปรับภายหลังได้จากหน้า /permissions
-- ═══════════════════════════════════════════════════════════════════

insert into role_permissions (role, permission_key, allowed)
select r, 'page:/improvements', true
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'improvements:manage', (r::text in ('admin','manager','supervisor','leader'))
from unnest(enum_range(null::user_role)) as r
on conflict (role, permission_key) do nothing;
